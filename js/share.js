'use strict';
// Condivisione schede (link / QR) e importazione da testo.
// Una scheda condivisa viaggia interamente nel link (#import=...), compressa: nessun server coinvolto.

const QR_LIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';

// ================= CODIFICA LINK =================
const b64uEncode = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64uDecode = (str) => {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipeBytes(bytes, transform) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

function packDay(day) {
    return {
        v: 1,
        n: day.name,
        e: day.exercises.map((ex) => {
            const o = { n: ex.name, p: ex.plan1.map((s) => [s.weight, s.reps]) };
            if (ex.type === 'superset') {
                o.t = 's';
                o.a = ex.subName1 || '';
                o.b = ex.subName2 || '';
                o.q = ex.plan2.map((s) => [s.weight, s.reps]);
            }
            if (ex.desc) o.d = ex.desc;
            return o;
        })
    };
}

function unpackDay(o) {
    if (!o || o.v !== 1 || !Array.isArray(o.e)) throw new Error('formato non valido');
    const plan = (arr) => (Array.isArray(arr) ? arr.map((s) => ({ weight: str(s && s[0]), reps: str(s && s[1]) })) : []);
    return {
        name: String(o.n || 'Scheda condivisa'),
        exercises: o.e.filter((x) => x && typeof x === 'object').map((x) => {
            const p1 = plan(x.p);
            return normalizeExercise({
                name: x.n,
                type: x.t === 's' ? 'superset' : 'classic',
                subName1: str(x.a),
                subName2: str(x.b),
                sets: String(p1.length || 3),
                plan1: p1,
                plan2: plan(x.q),
                desc: str(x.d)
            });
        })
    };
}

async function encodeShareCode(day) {
    const bytes = new TextEncoder().encode(JSON.stringify(packDay(day)));
    try {
        if ('CompressionStream' in window) return 'z' + b64uEncode(await pipeBytes(bytes, new CompressionStream('deflate-raw')));
    } catch (e) { /* formato non supportato: si usa il testo non compresso */ }
    return 'j' + b64uEncode(bytes);
}

async function decodeShareCode(code) {
    const kind = code[0];
    let bytes = b64uDecode(code.slice(1));
    if (kind === 'z') bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
    else if (kind !== 'j') throw new Error('prefisso sconosciuto');
    return unpackDay(JSON.parse(new TextDecoder().decode(bytes)));
}

const shareBaseUrl = () => location.origin + location.pathname;

// ================= CONDIVIDI =================
let shareState = { link: '', name: '' };

async function openShare() {
    const day = state.workouts[nav.workoutDay];
    if (!day.exercises.length) { toast('Aggiungi almeno un esercizio da condividere', 'fa-triangle-exclamation'); return; }
    $('shareSub').textContent = `${day.name} · ${day.exercises.length} ${day.exercises.length === 1 ? 'esercizio' : 'esercizi'}`;
    $('shareLink').value = 'Preparazione…';
    $('shareQr').innerHTML = '<i class="fa-solid fa-spinner fa-spin text-2xl"></i>';
    $('shareNativeBtn').classList.toggle('hidden', !navigator.share);
    openModal('shareModal');

    const link = `${shareBaseUrl()}#import=${await encodeShareCode(day)}`;
    shareState = { link, name: day.name };
    $('shareLink').value = link;
    try {
        await loadScript(QR_LIB_URL);
        const qr = qrcode(0, 'L');
        qr.addData(link);
        qr.make();
        $('shareQr').innerHTML = qr.createSvgTag({ scalable: true, margin: 0 });
    } catch (e) {
        $('shareQr').innerHTML = /overflow/i.test(String(e && e.message))
            ? '<p class="px-4">Scheda troppo lunga per un QR.<br>Usa il link qui sotto.</p>'
            : '<p class="px-4">QR non disponibile offline.<br>Usa il link qui sotto.</p>';
    }
}

async function copyShareLink() {
    if (!shareState.link) return;
    try {
        await navigator.clipboard.writeText(shareState.link);
        toast('Link copiato');
    } catch (e) {
        $('shareLink').select();
        toast('Seleziona e copia il link', 'fa-hand-pointer');
    }
}

async function nativeShare() {
    try {
        await navigator.share({ title: `Scheda "${shareState.name}"`, text: `Ecco la mia scheda "${shareState.name}" per l'app Workout`, url: shareState.link });
    } catch (e) { /* condivisione annullata */ }
}

// ================= IMPORTA DA TESTO =================
const HEADER_RE = /^(?:#+\s*)?(?:giorno|day|scheda|allenamento|seduta|workout|sessione)\b/i;

function isHeaderLine(line) {
    if (/^#/.test(line) || HEADER_RE.test(line)) return true;
    if (/:\s*$/.test(line) && !/\d\s*[x×*]\s*\d/i.test(line)) return true;
    return !/\d/.test(line) && /[A-ZÀ-Ý]{3}/.test(line) && line === line.toUpperCase();
}

const headerName = (line) => line.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/[:\s]+$/, '').trim();

/** Toglie elenchi puntati e numerazioni ("1.", "2)", "-", "•"). */
const stripBullet = (l) => l.replace(/^\s*(?:[-•*·▪►>–]+|\d{1,2}\s*[.)\]](?!\d)|[a-z]\s*\))\s*/i, '').replace(/\*\*/g, '').trim();

/** Un singolo esercizio: nome, serie (peso/reps), note. */
function parseSingleExercise(seg) {
    const desc = [];
    let s = seg.replace(/\(([^)]*)\)/g, (_, d) => { if (d.trim()) desc.push(d.trim()); return ' '; });
    s = s.replace(/\b(?:rec(?:upero)?|pausa|riposo)\b\.?\s*:?\s*\d[\d'’"″:.,]*\s*(?:minuti|min|secondi|sec|s|m)?\b['’"″]*/gi, (m) => { desc.push(m.trim()); return ' '; });
    const t = s.replace(/[×*✕]/g, 'x')
        .replace(/(\d),(\d)(?!\d)/g, '$1.$2') // 72,5 → 72.5
        .replace(/(\d)\s*per\s*(\d)/gi, '$1x$2')
        .replace(/\b(?:ripetizioni|reps?|rip)\b\.?/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // nome = testo prima del primo numero
    const idx = t.search(/(^|[\s:@])@?\d/);
    let name = (idx >= 0 ? t.slice(0, idx) : t).replace(/[\s:@,;–—-]+$/, '').trim();
    const r = idx >= 0 ? t.slice(idx).toLowerCase() : '';
    if (!name) {
        name = t.split(' ').filter((w) => !/\d/.test(w) && !/^(kg|x|serie|da|di|con|@|-|–)$/i.test(w)).join(' ').trim();
    }

    let plan = null, sets = null, repsArr = null, weights = null;
    let leftover = r;
    const pairs = [...r.matchAll(/(\d+(?:\.\d+)?)\s*(kg)?\s*x\s*(\d+(?:\s*-\s*\d+)?)/g)];

    if (pairs.length >= 2) {
        // "80x10, 85x8, 90x6": peso × ripetizioni per ogni serie
        plan = pairs.map((p) => ({ weight: p[1], reps: p[3].replace(/\s/g, '') }));
    } else if (pairs.length === 1) {
        const p = pairs[0];
        const after = r.slice(p.index + p[0].length);
        leftover = r.slice(0, p.index) + ' ' + after;
        if (p[2] || p[1].includes('.')) {
            // "80kg x 10": peso × ripetizioni
            weights = [p[1]];
            repsArr = [p[3].replace(/\s/g, '')];
            const sm = leftover.match(/(\d+)\s*serie/);
            sets = sm ? +sm[1] : 1;
        } else {
            // "4x8" (serie × ripetizioni), anche "4x10/8/6/6"
            sets = +p[1];
            repsArr = [p[3].replace(/\s/g, '')];
            const more = after.match(/^\s*((?:[/,]\s*\d+(?:\s*-\s*\d+)?)+)/);
            if (more) {
                repsArr = repsArr.concat(more[1].split(/[/,]/).map((x) => x.replace(/\s/g, '')).filter(Boolean));
                leftover = leftover.replace(more[1], ' ');
            }
        }
    } else {
        const sm = r.match(/(\d+)\s*serie\b(?:\s*(?:da|x|di)?\s*(\d+(?:\s*-\s*\d+)?))?/);
        if (sm) {
            sets = +sm[1];
            if (sm[2]) repsArr = [sm[2].replace(/\s/g, '')];
            leftover = r.replace(sm[0], ' ');
        }
    }

    if (!plan && !weights) {
        const list = leftover.match(/(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)+)\s*kg/);
        const one = leftover.match(/(\d+(?:\.\d+)?)\s*kg\b/) || leftover.match(/@\s*(\d+(?:\.\d+)?)/);
        if (list) weights = list[1].split('/').map((x) => x.trim());
        else if (one) weights = [one[1]];
        else if (sets !== null) {
            const lone = leftover.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*$/);
            if (lone) weights = [lone[1]];
        }
    }

    const flagged = !plan && sets === null && !repsArr && !weights;
    const n = Math.max(1, Math.min(MAX_SETS, plan ? plan.length : (sets || Math.max(repsArr ? repsArr.length : 0, weights ? weights.length : 0) || 3)));
    if (!plan) {
        const pick = (arr, i, def) => (arr && arr.length ? (arr[i] ?? arr[arr.length - 1]) : def);
        plan = Array.from({ length: n }, (_, i) => ({ weight: pick(weights, i, ''), reps: pick(repsArr, i, '10') }));
    }
    plan = plan.map((st) => ({ weight: cleanWeight(st.weight), reps: str(st.reps) || '10' }));
    return { name: name || 'Esercizio', plan, desc: desc.join(' · '), flagged };
}

function parseExerciseLine(line) {
    const l = stripBullet(line).replace(/^(?:super\s?set|ss)\s*[:\-–]?\s*/i, '');
    if (!l) return null;
    const parts = l.split(/\s+[+&]\s+/).filter((p) => p.trim());
    if (parts.length >= 2) {
        const a = parseSingleExercise(parts[0]);
        const b = parseSingleExercise(parts[1]);
        const n = a.plan.length;
        const ex = normalizeExercise({
            name: `${a.name} + ${b.name}`,
            type: 'superset',
            subName1: a.name,
            subName2: b.name,
            sets: String(n),
            plan1: a.plan,
            plan2: resizePlan(b.plan, n),
            desc: [a.desc, b.desc].filter(Boolean).join(' · ')
        });
        ex._flag = a.flagged || b.flagged;
        return ex;
    }
    const a = parseSingleExercise(l);
    const ex = normalizeExercise({ name: a.name, type: 'classic', sets: String(a.plan.length), plan1: a.plan, desc: a.desc });
    ex._flag = a.flagged;
    return ex;
}

function parseWorkoutText(text) {
    const days = [];
    let cur = null;
    text.split(/\r?\n/).forEach((raw) => {
        const line = raw.trim();
        if (!line) return;
        if (isHeaderLine(line)) {
            cur = { name: headerName(line) || `Scheda ${days.length + 1}`, exercises: [] };
            days.push(cur);
            return;
        }
        const ex = parseExerciseLine(line);
        if (!ex) return;
        if (!cur) { cur = { name: 'Scheda importata', exercises: [] }; days.push(cur); }
        cur.exercises.push(ex);
    });
    return days.filter((d) => d.exercises.length);
}

let importDays = [];
let importTimer = null;

function openImport() {
    $('importText').value = '';
    $('importHelp').classList.add('hidden');
    importDays = [];
    renderImportPreview();
    openModal('importModal');
}

function showImportHelp() { $('importHelp').classList.toggle('hidden'); }

function scheduleImportPreview() {
    clearTimeout(importTimer);
    importTimer = setTimeout(updateImportPreview, 250);
}

async function updateImportPreview() {
    const text = $('importText').value;
    const link = text.match(/#import=([A-Za-z0-9_-]+)/);
    let error = '';
    if (link) {
        try { importDays = [await decodeShareCode(link[1])]; } catch (e) { importDays = []; error = 'Il link sembra incompleto o danneggiato.'; }
    } else {
        importDays = parseWorkoutText(text);
    }
    renderImportPreview(error);
}

function renderImportPreview(error = '') {
    const text = $('importText').value.trim();
    const btn = $('importSubmit');
    const n = importDays.length;
    btn.disabled = !n;
    btn.innerHTML = `<i class="fa-solid fa-file-import"></i> ${n > 1 ? `Importa ${n} schede` : 'Importa scheda'}`;
    if (!text) { $('importPreview').innerHTML = ''; return; }
    if (!n) {
        $('importPreview').innerHTML = `<p class="text-sm font-semibold text-amber-500"><i class="fa-solid fa-triangle-exclamation mr-1"></i> ${esc(error || 'Non ho trovato esercizi nel testo.')}</p>`;
        return;
    }
    const flagged = importDays.some((d) => d.exercises.some((e) => e._flag));
    $('importPreview').innerHTML = `
        <p class="field-label">Anteprima</p>
        ${importDays.map((d) => `
            <div class="bg-inset border border-line rounded-2xl p-3 mb-2">
                <p class="font-extrabold text-sm mb-1"><i class="fa-solid fa-clipboard-list text-brand mr-1"></i> ${esc(d.name)} <span class="text-muted font-semibold">· ${d.exercises.length} ${d.exercises.length === 1 ? 'esercizio' : 'esercizi'}</span></p>
                ${d.exercises.map((ex) => `
                    <div class="py-1.5 border-t border-line/70 first:border-0">
                        <p class="text-sm font-bold">${ex._flag ? '<i class="fa-solid fa-triangle-exclamation text-amber-500 mr-1"></i>' : ''}${esc(ex.name)}${ex.type === 'superset' ? ' <span class="text-[9px] font-extrabold uppercase tracking-wider bg-accent text-white px-1.5 py-0.5 rounded-full align-middle">Superset</span>' : ''}</p>
                        <div class="flex flex-wrap gap-1 mt-1"><span class="chip">${esc(ex.sets)} <span class="text-muted text-[10px]">SERIE</span></span>${planHtml(ex.plan1)}${ex.type === 'superset' ? '<span class="text-muted text-xs self-center">+</span>' + planHtml(ex.plan2) : ''}</div>
                        ${ex.desc ? `<p class="text-[11px] text-muted italic mt-1">${esc(ex.desc)}</p>` : ''}
                    </div>`).join('')}
            </div>`).join('')}
        ${flagged ? '<p class="text-xs text-amber-500 font-semibold ml-1"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Serie non trovate: messi 3×10, potrai modificarli dopo.</p>' : ''}`;
}

function addImportedDays(days) {
    const firstIdx = state.workouts.length;
    days.forEach((d) => {
        d.exercises.forEach((e) => { delete e._flag; e.history = []; e.history2 = []; });
        state.workouts.push({ name: d.name, exercises: d.exercises });
    });
    persist();
    toast(days.length > 1 ? `${days.length} schede importate` : 'Scheda importata');
    if (days.length === 1) go('workoutDay', { workoutDay: firstIdx });
    else go('workout');
}

async function confirmImportText() {
    clearTimeout(importTimer);
    await updateImportPreview();
    if (!importDays.length) { shake($('importText')); return; }
    const days = importDays;
    importDays = [];
    await closeModal('importModal');
    addImportedDays(days);
}

// ================= LINK IN ARRIVO =================
async function handleIncomingShare(code) {
    history.replaceState({ ...(history.state || {}), view: nav.view }, '', '#' + nav.view);
    let day;
    try { day = await decodeShareCode(code); } catch (e) {
        alertDialog('Link non valido', 'Il link della scheda è incompleto o danneggiato.', 'fa-triangle-exclamation');
        return;
    }
    const ok = await dialog({
        title: 'Importare la scheda?',
        text: `"${day.name}" · ${day.exercises.length} ${day.exercises.length === 1 ? 'esercizio' : 'esercizi'}. Verrà aggiunta alle tue schede.`,
        confirm: 'Importa', cancel: 'Annulla', icon: 'fa-file-import'
    });
    if (ok) addImportedDays([day]);
}

window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#import=')) handleIncomingShare(location.hash.slice(8));
});
if (window.pendingShareCode) handleIncomingShare(window.pendingShareCode);
