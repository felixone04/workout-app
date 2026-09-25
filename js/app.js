'use strict';

const APP_VERSION = '2.1.0';
const STORE_KEY = 'workoutAppV1';
const LEGACY_KEYS = ['mySigmaV3', 'mySigmaV2'];
const SETTINGS_KEY = 'workoutAppSettings';
const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const CATEGORIES = ['Carboidrati', 'Proteine', 'Grassi', 'Verdure'];
const MACRO = {
    Carboidrati: { short: 'C', label: 'Carbo', text: 'text-sky-500', bg: 'bg-sky-500/10', border: 'border-sky-500/20' },
    Proteine: { short: 'P', label: 'Proteine', text: 'text-rose-500', bg: 'bg-rose-500/10', border: 'border-rose-500/20' },
    Grassi: { short: 'G', label: 'Grassi', text: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
    Verdure: { short: 'V', label: 'Verdure', text: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' }
};

// ================= UTILITY =================
const $ = (id) => document.getElementById(id);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Converte "72,5" / "72.5" in numero; NaN se non valido. */
const parseNum = (v) => {
    const n = parseFloat(String(v ?? '').replace(',', '.').trim());
    return Number.isFinite(n) ? n : NaN;
};

const fmt = (n, digits = 1) => Number(n).toLocaleString('it-IT', { maximumFractionDigits: digits });

const todayDayIdx = () => (new Date().getDay() + 6) % 7; // Lunedì = 0

let toastTimer;
function toast(msg, icon = 'fa-circle-check') {
    const t = $('toast');
    t.innerHTML = `<i class="fa-solid ${icon}"></i> ${esc(msg)}`;
    t.classList.remove('hidden-toast');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden-toast'), 2000);
}

function shake(el) {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    el.focus();
}

// ================= DATI =================
const state = { workouts: [], weeklyDiet: {}, foodDb: [] };
let settings = { theme: 'auto', timer: { sets: 3, work: 45, rest: 90 } };

// I log della versione precedente hanno solo la data testuale ("20 set 2026"): ricava il timestamp.
const IT_MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
function withTs(h) {
    if (h.ts || typeof h.date !== 'string') return h;
    const m = h.date.toLowerCase().match(/(\d{1,2})\s+([a-z]{3})\w*\.?\s+(\d{4})/);
    const month = m ? IT_MONTHS.indexOf(m[2]) : -1;
    return month === -1 ? h : { ...h, ts: new Date(+m[3], month, +m[1], 12).getTime() };
}

const MAX_SETS = 20;
const str = (v) => (v == null ? '' : String(v).trim());

/** Serie pianificate: [{ weight, reps }]. Gli esercizi vecchi (serie × reps @ kg unici) diventano N serie uguali. */
function normalizePlan(plan, n, weight, reps) {
    const out = Array.isArray(plan) && plan.length
        ? plan.filter((s) => s && typeof s === 'object').map((s) => ({ weight: str(s.weight), reps: str(s.reps) }))
        : [];
    const base = out.length ? out[out.length - 1] : { weight: str(weight), reps: str(reps) };
    while (out.length < n) out.push({ ...base });
    return out.slice(0, n);
}

function normalizeExercise(e) {
    const type = e.type === 'superset' ? 'superset' : 'classic';
    let n = parseInt(e.sets, 10);
    if (!(n > 0)) n = Array.isArray(e.plan1) && e.plan1.length ? e.plan1.length : 3;
    n = Math.min(MAX_SETS, n);
    const ex = {
        ...e,
        name: String(e.name || 'Esercizio'),
        type,
        sets: String(n),
        plan1: normalizePlan(e.plan1, n, e.weight1, e.reps1),
        history: Array.isArray(e.history) ? e.history.filter(Boolean).map(withTs) : [],
        history2: Array.isArray(e.history2) ? e.history2.filter(Boolean).map(withTs) : []
    };
    ex.plan2 = type === 'superset' ? normalizePlan(e.plan2, n, e.weight2, e.reps2) : [];
    return ex;
}

function normalizeData(p) {
    const out = { workouts: [], weeklyDiet: {}, foodDb: [] };
    if (Array.isArray(p.workouts)) {
        out.workouts = p.workouts.filter((d) => d && typeof d === 'object').map((d) => ({
            ...d,
            name: String(d.name || 'Scheda'),
            exercises: (Array.isArray(d.exercises) ? d.exercises : []).filter((e) => e && typeof e === 'object').map(normalizeExercise)
        }));
    }
    const diet = p.weeklyDiet && typeof p.weeklyDiet === 'object' ? p.weeklyDiet : {};
    DAYS.forEach((day) => {
        const meals = Array.isArray(diet[day]) ? diet[day] : [];
        out.weeklyDiet[day] = meals.filter((m) => m && typeof m === 'object').map((m) => ({
            ...m,
            name: String(m.name || 'Pasto'),
            items: (Array.isArray(m.items) ? m.items : []).filter((i) => i && i.name).map((i) => ({
                ...i, name: String(i.name), grams: parseNum(i.grams) || 0
            }))
        }));
    });
    if (Array.isArray(p.foodDb)) {
        out.foodDb = p.foodDb.filter((f) => f && f.name).map((f, i) => ({
            id: String(f.id || `${Date.now()}-${i}`),
            name: String(f.name),
            category: CATEGORIES.includes(f.category) ? f.category : 'Carboidrati',
            macroValue: parseNum(f.macroValue) || 0
        }));
    }
    return out;
}

function loadData() {
    let raw = null;
    try {
        raw = localStorage.getItem(STORE_KEY);
        for (const k of LEGACY_KEYS) { if (!raw) raw = localStorage.getItem(k); }
    } catch (e) { /* storage non disponibile */ }
    let parsed = {};
    if (raw) { try { parsed = JSON.parse(raw) || {}; } catch (e) { parsed = {}; } }
    Object.assign(state, normalizeData(parsed));
    rebuildFoodIndex();

    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
        if (s && typeof s === 'object') settings = { ...settings, ...s, timer: { ...settings.timer, ...(s.timer || {}) } };
    } catch (e) { /* default */ }
}

function persist() {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
        toast('Impossibile salvare i dati', 'fa-triangle-exclamation');
    }
}

function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignora */ }
}

// ---- Indice alimenti (preset + personali) ----
let foodIndex = new Map();
function rebuildFoodIndex() {
    foodIndex = new Map();
    [...PRESET_FOODS, ...state.foodDb].forEach((f) => { if (!foodIndex.has(f.name)) foodIndex.set(f.name, f); });
}
const allFoods = () => [...foodIndex.values()];
const findFood = (name) => foodIndex.get(name);

function itemMacro(item) {
    const f = findFood(item.name);
    if (!f) return null;
    return { category: f.category, grams: (f.macroValue * item.grams) / 100 };
}

function sumMacros(meals) {
    const t = { Carboidrati: 0, Proteine: 0, Grassi: 0 };
    meals.forEach((m) => m.items.forEach((it) => {
        const mm = itemMacro(it);
        if (mm && t[mm.category] !== undefined) t[mm.category] += mm.grams;
    }));
    return t;
}

const dayMacros = (dayIdx) => sumMacros(state.weeklyDiet[DAYS[dayIdx]] || []);

// ================= TEMA =================
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
    const dark = settings.theme === 'dark' || (settings.theme === 'auto' && darkQuery.matches);
    document.documentElement.classList.toggle('dark', dark);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#090c14' : '#f4f6fb');
    document.querySelectorAll('#themeSeg .seg').forEach((b) => b.classList.toggle('active', b.dataset.theme === settings.theme));
}
function setTheme(t) { settings.theme = t; saveSettings(); applyTheme(); }
darkQuery.addEventListener?.('change', applyTheme);

// ================= NAVIGAZIONE =================
const VIEWS = {
    home: { nav: 'home', eyebrow: () => new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }), title: () => 'Workout' },
    workout: { nav: 'workout', eyebrow: () => 'Allenamento', title: () => 'Schede', timer: true },
    workoutDay: { nav: 'workout', parent: 'workout', eyebrow: () => 'Scheda', title: () => state.workouts[nav.workoutDay]?.name || '', timer: true },
    diet: { nav: 'diet', eyebrow: () => 'Dieta', title: () => 'Settimana' },
    dietDay: { nav: 'diet', parent: 'diet', eyebrow: () => 'Dieta', title: () => DAYS[nav.dietDay] || '' },
    db: { nav: 'db', eyebrow: () => 'Strumenti', title: () => 'Conversioni' }
};

const nav = { view: 'home', workoutDay: null, dietDay: null };

function go(view, params = {}, opts = {}) {
    Object.assign(nav, params, { view });
    const st = { view, workoutDay: nav.workoutDay, dietDay: nav.dietDay };
    if (opts.replace) history.replaceState(st, '', '#' + view);
    else if (!opts.fromHistory) history.pushState(st, '', '#' + view);
    render();
    if (!opts.keepScroll) window.scrollTo(0, 0);
}

function navTo(view) {
    if (nav.view === view) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    go(view);
}

function goBack() {
    go(VIEWS[nav.view]?.parent || 'home', {}, { replace: true });
}

// Nelle pagine con titolo grande, il titolo nell'header compare solo dopo averlo superato scorrendo.
function updateHeaderTitle() {
    const show = nav.view === 'home' || window.scrollY > 70;
    $('headerTitleWrap').style.opacity = show ? '1' : '0';
}
window.addEventListener('scroll', updateHeaderTitle, { passive: true });

let lastRenderedView = null;
function render() {
    // stato non più valido (es. scheda eliminata)
    if (nav.view === 'workoutDay' && !state.workouts[nav.workoutDay]) { go('workout', {}, { replace: true }); return; }
    if (nav.view === 'dietDay' && !DAYS[nav.dietDay]) { go('diet', {}, { replace: true }); return; }

    const v = VIEWS[nav.view] || VIEWS.home;
    document.querySelectorAll('main > section').forEach((s) => s.classList.add('hidden'));
    const sec = $('view-' + nav.view);
    sec.classList.remove('hidden');
    if (lastRenderedView !== nav.view) { sec.classList.remove('view'); void sec.offsetWidth; sec.classList.add('view'); }
    lastRenderedView = nav.view;

    $('headerEyebrow').textContent = v.eyebrow();
    $('headerTitle').textContent = v.title();
    updateHeaderTitle();
    $('backBtn').classList.toggle('invisible', !v.parent);
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.nav === v.nav));

    $('timer').classList.toggle('timer-hidden', !v.timer);
    document.body.classList.toggle('with-timer', !!v.timer);

    ({
        home: renderHome, workout: renderWorkoutGrid, workoutDay: renderWorkoutDay,
        diet: renderDietGrid, dietDay: renderDietDay, db: renderDb
    })[nav.view]();
}

// ================= MODALI =================
const modalStack = [];
const modalCloseWaiters = [];
const modalHideHooks = {};

function openModal(id) {
    const m = $(id);
    if (modalStack.includes(id)) return;
    modalStack.push(id);
    m.style.zIndex = 50 + modalStack.length;
    m.classList.remove('hidden');
    history.pushState({ ...(history.state || {}), modal: id }, '', location.hash);
    requestAnimationFrame(() => requestAnimationFrame(() => m.classList.add('open')));
    const af = m.querySelector('[data-autofocus]');
    if (af && window.matchMedia('(pointer: fine)').matches) setTimeout(() => af.focus({ preventScroll: true }), 120);
}

function hideModal(id) {
    const i = modalStack.lastIndexOf(id);
    if (i === -1) return;
    modalStack.splice(i, 1);
    const m = $(id);
    m.classList.remove('open');
    if (document.activeElement && m.contains(document.activeElement)) document.activeElement.blur();
    setTimeout(() => { if (!modalStack.includes(id)) m.classList.add('hidden'); }, 300);
    if (modalHideHooks[id]) modalHideHooks[id]();
}

/** Chiude una modale; la voce di cronologia aggiunta all'apertura viene consumata (tasto Indietro coerente). */
function closeModal(id) {
    return new Promise((resolve) => {
        if (!modalStack.includes(id)) return resolve();
        if (history.state && history.state.modal === id) {
            modalCloseWaiters.push(resolve);
            history.back();
        } else {
            hideModal(id);
            resolve();
        }
    });
}

window.addEventListener('popstate', (e) => {
    if (modalStack.length) {
        hideModal(modalStack[modalStack.length - 1]);
        const w = modalCloseWaiters.shift();
        if (w) w();
        return;
    }
    const st = e.state || { view: 'home' };
    go(st.view in VIEWS ? st.view : 'home', { workoutDay: st.workoutDay ?? null, dietDay: st.dietDay ?? null }, { fromHistory: true });
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalStack.length) closeModal(modalStack[modalStack.length - 1]);
});

// ---- Dialog conferma / avviso ----
let dialogResolve = null;
modalHideHooks.dialogModal = () => { if (dialogResolve) { const r = dialogResolve; dialogResolve = null; r(false); } };

function dialog({ title, text = '', confirm = 'OK', cancel = null, danger = false, icon = null }) {
    $('dialogTitle').textContent = title;
    $('dialogText').textContent = text;
    const ic = $('dialogIcon');
    const iconName = icon || (danger ? 'fa-trash-can' : 'fa-circle-info');
    ic.className = `w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center text-lg ${danger ? 'bg-rose-500/10 text-rose-500' : 'bg-brand/10 text-brand'}`;
    ic.innerHTML = `<i class="fa-solid ${iconName}"></i>`;
    $('dialogBtns').innerHTML =
        `<button type="button" onclick="resolveDialog(true)" class="${danger ? 'w-full bg-rose-500 text-white py-3.5 rounded-2xl font-bold active:scale-[0.98] transition' : 'btn-primary'}">${esc(confirm)}</button>` +
        (cancel ? `<button type="button" onclick="resolveDialog(false)" class="btn-soft w-full py-3.5">${esc(cancel)}</button>` : '');
    return new Promise((res) => { dialogResolve = res; openModal('dialogModal'); });
}

async function resolveDialog(value) {
    const r = dialogResolve;
    dialogResolve = null;
    await closeModal('dialogModal');
    if (r) r(value);
}

const confirmDialog = (title, text, confirm = 'Elimina') => dialog({ title, text, confirm, cancel: 'Annulla', danger: true });
const alertDialog = (title, text, icon) => dialog({ title, text, icon });

// ---- Prompt testo ----
let promptResolve = null;
modalHideHooks.promptModal = () => { if (promptResolve) { const r = promptResolve; promptResolve = null; r(null); } };

function askText({ title, label = '', placeholder = '', value = '', confirm = 'Salva', inputmode = 'text' }) {
    $('promptTitle').textContent = title;
    $('promptLabel').textContent = label;
    $('promptLabel').classList.toggle('hidden', !label);
    const inp = $('promptInput');
    inp.value = value;
    inp.placeholder = placeholder;
    inp.inputMode = inputmode;
    $('promptConfirm').textContent = confirm;
    return new Promise((res) => { promptResolve = res; openModal('promptModal'); });
}

async function submitPrompt() {
    const inp = $('promptInput');
    const v = inp.value.trim();
    if (!v) { shake(inp); return; }
    const r = promptResolve;
    promptResolve = null;
    await closeModal('promptModal');
    if (r) r(v);
}

// ================= HOME =================
function lastTrainingTs() {
    let max = 0;
    state.workouts.forEach((d) => d.exercises.forEach((e) => [...e.history, ...e.history2].forEach((h) => { if (h.ts > max) max = h.ts; })));
    return max;
}

function relDate(ts) {
    const d = new Date(ts); d.setHours(0, 0, 0, 0);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const diff = Math.round((t - d) / 86400000);
    if (diff === 0) return 'oggi';
    if (diff === 1) return 'ieri';
    if (diff < 7) return `${diff} giorni fa`;
    return new Date(ts).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

function macroTiles(m, size = 'lg') {
    return ['Carboidrati', 'Proteine', 'Grassi'].map((k) => `
        <div class="${MACRO[k].bg} border ${MACRO[k].border} rounded-2xl ${size === 'lg' ? 'py-3' : 'py-2'} text-center">
            <p class="${size === 'lg' ? 'text-xl' : 'text-base'} font-extrabold ${MACRO[k].text} leading-none">${fmt(m[k], 0)}<span class="text-xs font-bold">g</span></p>
            <p class="text-[10px] font-bold uppercase tracking-wider text-muted mt-1">${MACRO[k].label}</p>
        </div>`).join('');
}

function renderHome() {
    const t = todayDayIdx();
    const meals = state.weeklyDiet[DAYS[t]] || [];
    const m = dayMacros(t);
    const nEx = state.workouts.reduce((a, d) => a + d.exercises.length, 0);
    const last = lastTrainingTs();
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera';

    $('view-home').innerHTML = `
        <h2 class="text-3xl font-extrabold tracking-tight mb-1">${greet}</h2>
        <p class="text-muted font-medium mb-6">Pronto per la sessione di oggi?</p>

        <button onclick="navTo('workout')" class="w-full text-left rounded-3xl p-5 mb-3 bg-gradient-to-br from-brand to-accent text-white shadow-xl shadow-brand/25 active:scale-[0.98] transition relative overflow-hidden">
            <div class="absolute -right-6 -bottom-8 text-[8rem] opacity-15 rotate-[-20deg]"><i class="fa-solid fa-dumbbell"></i></div>
            <div class="relative">
                <div class="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center text-xl mb-4"><i class="fa-solid fa-dumbbell"></i></div>
                <h3 class="text-2xl font-extrabold">Allenamento</h3>
                <p class="text-white/80 text-sm font-medium mt-1">${state.workouts.length} ${state.workouts.length === 1 ? 'scheda' : 'schede'} · ${nEx} esercizi</p>
                <p class="text-white/90 text-xs font-bold mt-3 inline-flex items-center gap-1.5 bg-white/15 px-2.5 py-1 rounded-full">
                    <i class="fa-solid fa-clock-rotate-left"></i> ${last ? 'Ultimo allenamento: ' + relDate(last) : 'Nessuna sessione registrata'}
                </p>
            </div>
        </button>

        <button onclick="go('dietDay', { dietDay: ${t} })" class="card w-full text-left p-5 mb-3 active:scale-[0.98] transition">
            <div class="flex items-center justify-between mb-4">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center text-xl"><i class="fa-solid fa-utensils"></i></div>
                    <div>
                        <h3 class="text-lg font-extrabold leading-tight">Dieta di oggi</h3>
                        <p class="text-sm text-muted font-medium">${DAYS[t]} · ${meals.length} ${meals.length === 1 ? 'pasto' : 'pasti'}</p>
                    </div>
                </div>
                <i class="fa-solid fa-chevron-right text-muted"></i>
            </div>
            <div class="grid grid-cols-3 gap-2">${macroTiles(m, 'sm')}</div>
        </button>

        <button onclick="navTo('db')" class="card w-full text-left p-5 active:scale-[0.98] transition flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-accent/10 text-accent flex items-center justify-center text-xl"><i class="fa-solid fa-scale-balanced"></i></div>
            <div class="flex-1">
                <h3 class="text-lg font-extrabold leading-tight">Conversioni</h3>
                <p class="text-sm text-muted font-medium">Equivalenze tra alimenti e database</p>
            </div>
            <i class="fa-solid fa-chevron-right text-muted"></i>
        </button>
    `;
}

// ================= ALLENAMENTO =================
function renderWorkoutGrid() {
    const c = $('workoutGrid');
    if (!state.workouts.length) {
        c.innerHTML = `
            <div class="col-span-2 card p-8 text-center">
                <div class="w-16 h-16 mx-auto rounded-full bg-brand/10 text-brand flex items-center justify-center text-2xl mb-3"><i class="fa-solid fa-clipboard-list"></i></div>
                <p class="font-extrabold text-lg">Nessuna scheda</p>
                <p class="text-sm text-muted mb-5">Crea la tua prima giornata di allenamento.</p>
                <button onclick="addWorkoutDay()" class="btn-primary"><i class="fa-solid fa-plus"></i> Crea scheda</button>
            </div>`;
        return;
    }
    c.innerHTML = state.workouts.map((day, i) => {
        let last = 0;
        day.exercises.forEach((e) => [...e.history, ...e.history2].forEach((h) => { if (h.ts > last) last = h.ts; }));
        return `
            <button onclick="go('workoutDay', { workoutDay: ${i} })" class="card p-4 text-left active:scale-[0.97] transition relative overflow-hidden min-h-[8.5rem] flex flex-col">
                <div class="absolute -right-4 -top-4 w-20 h-20 rounded-full bg-brand/5"></div>
                <div class="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center font-extrabold mb-3">${esc(String.fromCharCode(65 + (i % 26)))}</div>
                <h3 class="font-extrabold text-base leading-tight break-words line-clamp-2">${esc(day.name)}</h3>
                <p class="text-xs text-muted font-semibold mt-auto pt-2">${day.exercises.length} esercizi${last ? ' · ' + relDate(last) : ''}</p>
            </button>`;
    }).join('');
}

async function addWorkoutDay() {
    const name = await askText({ title: 'Nuova scheda', label: 'Nome della giornata', placeholder: 'Es. Petto e dorso', confirm: 'Crea scheda' });
    if (!name) return;
    state.workouts.push({ name, exercises: [] });
    persist();
    go('workoutDay', { workoutDay: state.workouts.length - 1 });
}

async function renameWorkoutDay() {
    const day = state.workouts[nav.workoutDay];
    const name = await askText({ title: 'Rinomina scheda', label: 'Nome della giornata', value: day.name });
    if (!name) return;
    day.name = name;
    persist(); render();
}

function duplicateWorkoutDay() {
    const copy = JSON.parse(JSON.stringify(state.workouts[nav.workoutDay]));
    copy.name += ' (copia)';
    copy.exercises.forEach((e) => { e.history = []; e.history2 = []; });
    state.workouts.splice(nav.workoutDay + 1, 0, copy);
    persist();
    toast('Scheda duplicata');
    go('workoutDay', { workoutDay: nav.workoutDay + 1 }, { replace: true });
}

async function deleteWorkoutDay() {
    const day = state.workouts[nav.workoutDay];
    if (!(await confirmDialog('Eliminare la scheda?', `"${day.name}" e tutti i suoi esercizi e storici verranno eliminati.`))) return;
    state.workouts.splice(nav.workoutDay, 1);
    persist();
    toast('Scheda eliminata');
    go('workout', {}, { replace: true });
}

// ---- Serie: formattazione ----
const fmtW = (w) => { const n = parseNum(w); return Number.isFinite(n) ? fmt(n, 2) : ''; };
/** "80×10" oppure "10 rip" se senza peso */
function fmtSet(s) {
    const w = fmtW(s.weight);
    return w ? `${w}×${s.reps || '—'}` : `${s.reps || '—'} rip`;
}
/** Serie di un log: i log vecchi hanno un solo peso/ripetizioni. */
const setsOf = (h) => (Array.isArray(h.sets) && h.sets.length ? h.sets : [{ weight: h.weight, reps: h.reps }]);
const isUniform = (plan) => plan.every((s) => s.weight === plan[0].weight && s.reps === plan[0].reps);
const COLOR = {
    brand: { soft: 'bg-brand/10 text-brand', text: 'text-brand' },
    accent: { soft: 'bg-accent/10 text-accent', text: 'text-accent' }
};

function bestWeight(list) {
    let best = -Infinity;
    list.forEach((h) => setsOf(h).forEach((s) => { const w = parseNum(s.weight); if (w > best) best = w; }));
    return best > 0 ? best : null;
}

function setPills(sets, { numbered = false, best = null } = {}) {
    return sets.map((s, i) => {
        const isBest = best !== null && parseNum(s.weight) === best;
        return `<span class="chip ${isBest ? '!bg-amber-500/10 !border-amber-500/30' : ''}">${numbered ? `<span class="text-muted text-[10px]">S${i + 1}</span>` : ''}${esc(fmtSet(s))}</span>`;
    }).join('');
}

/** Riepilogo della pianificazione: compatto se tutte le serie sono uguali, altrimenti serie per serie. */
function planHtml(plan) {
    if (isUniform(plan)) {
        const s = plan[0];
        return `<span class="chip">${esc(s.reps || '—')} <span class="text-muted text-[10px]">REPS</span></span>` +
            (fmtW(s.weight) ? `<span class="chip !bg-brand/10 !border-brand/20 !text-brand">${esc(fmtW(s.weight))} <span class="text-[10px]">KG</span></span>` : '');
    }
    return setPills(plan, { numbered: true });
}

function historyTable(list, dIdx, eIdx, which) {
    if (!list.length) return '<p class="text-xs text-muted py-2 text-center">Nessun log</p>';
    const best = bestWeight(list);
    return list.map((h, hIdx) => {
        const sets = setsOf(h);
        const hasBest = best !== null && sets.some((s) => parseNum(s.weight) === best);
        return `
            <div class="py-2 border-b border-line/70 last:border-0">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-bold text-muted flex-1 min-w-0 truncate">${esc(h.date || '')}</span>
                    ${hasBest ? '<i class="fa-solid fa-trophy text-amber-500 text-[10px]" title="Record"></i>' : ''}
                    <button onclick="deleteLog(${dIdx}, ${eIdx}, ${which}, ${hIdx})" class="w-7 h-7 -mr-1 -my-1 rounded-full text-muted hover:text-rose-500 flex items-center justify-center" aria-label="Elimina log"><i class="fa-solid fa-xmark text-xs"></i></button>
                </div>
                <div class="flex flex-wrap gap-1 mt-1">${setPills(sets, { best })}</div>
            </div>`;
    }).join('');
}

const openHistories = new Set();

function renderWorkoutDay() {
    const dIdx = nav.workoutDay;
    const day = state.workouts[dIdx];
    $('workoutDayTitle').textContent = day.name;
    $('workoutDaySub').textContent = `${day.exercises.length} ${day.exercises.length === 1 ? 'esercizio' : 'esercizi'}`;

    const c = $('exerciseList');
    if (!day.exercises.length) {
        c.innerHTML = `
            <div class="card border-dashed p-8 text-center">
                <i class="fa-solid fa-person-walking text-3xl text-muted/50 mb-3"></i>
                <p class="text-sm text-muted">Nessun esercizio. Inizia ad aggiungerli!</p>
            </div>`;
        return;
    }

    const n = day.exercises.length;
    c.innerHTML = day.exercises.map((ex, eIdx) => {
        const isSuper = ex.type === 'superset';
        const key = `${dIdx}-${eIdx}`;
        const hasHist = ex.history.length > 0 || (isSuper && ex.history2.length > 0);
        const open = openHistories.has(key) && hasHist;
        const setsChip = `<span class="chip">${esc(ex.sets)} <span class="text-muted text-[10px]">SERIE</span></span>`;

        const body = isSuper ? `
            <div class="mt-2 flex flex-wrap items-center gap-1.5">${setsChip}<span class="text-[11px] text-muted font-semibold">per entrambi gli esercizi</span></div>
            <div class="mt-2 space-y-1.5">
                <div class="bg-inset border border-line rounded-xl px-3 py-2">
                    <p class="text-xs font-bold text-brand truncate mb-1.5">1 · ${esc(ex.subName1 || ex.name)}</p>
                    <div class="flex flex-wrap gap-1">${planHtml(ex.plan1)}</div>
                </div>
                <div class="bg-inset border border-line rounded-xl px-3 py-2">
                    <p class="text-xs font-bold text-accent truncate mb-1.5">2 · ${esc(ex.subName2 || ex.name2 || 'Esercizio 2')}</p>
                    <div class="flex flex-wrap gap-1">${planHtml(ex.plan2)}</div>
                </div>
            </div>` : `
            <div class="mt-2 flex flex-wrap items-center gap-1.5">${setsChip}${planHtml(ex.plan1)}</div>`;

        const last1 = ex.history[0];
        const last2 = isSuper ? ex.history2[0] : null;
        const lastRef = last1 || last2;
        const lastHtml = lastRef ? `
            <div class="mt-3">
                <p class="text-xs text-muted flex items-center gap-1.5"><i class="fa-solid fa-clock-rotate-left"></i> Ultima sessione · ${esc(lastRef.date || '')}</p>
                ${last1 ? `<div class="flex flex-wrap items-center gap-1 mt-1">${isSuper ? '<span class="text-[10px] font-extrabold text-brand w-3">1</span>' : ''}${setPills(setsOf(last1))}</div>` : ''}
                ${last2 ? `<div class="flex flex-wrap items-center gap-1 mt-1"><span class="text-[10px] font-extrabold text-accent w-3">2</span>${setPills(setsOf(last2))}</div>` : ''}
            </div>` : '';

        const histHtml = !hasHist ? '' : isSuper ? `
            <div class="grid grid-cols-2 gap-2">
                <div class="bg-inset border border-line rounded-xl px-2 py-1"><p class="text-[10px] font-bold text-brand uppercase truncate pt-1">${esc(ex.subName1 || ex.name)}</p>${historyTable(ex.history, dIdx, eIdx, 1)}</div>
                <div class="bg-inset border border-line rounded-xl px-2 py-1"><p class="text-[10px] font-bold text-accent uppercase truncate pt-1">${esc(ex.subName2 || 'Es. 2')}</p>${historyTable(ex.history2, dIdx, eIdx, 2)}</div>
            </div>` : `<div class="bg-inset border border-line rounded-xl px-3 py-1">${historyTable(ex.history, dIdx, eIdx, 1)}</div>`;

        return `
            <article class="card p-4">
                <div class="flex items-start gap-3">
                    <div class="w-9 h-9 rounded-xl ${isSuper ? 'bg-accent/10 text-accent' : 'bg-brand/10 text-brand'} font-extrabold flex items-center justify-center text-sm shrink-0">${eIdx + 1}</div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                            <h4 class="font-extrabold text-base leading-tight break-words">${esc(ex.name)}</h4>
                            ${isSuper ? '<span class="text-[9px] font-extrabold uppercase tracking-wider bg-accent text-white px-2 py-0.5 rounded-full">Superset</span>' : ''}
                        </div>
                        ${body}
                        ${ex.desc ? `<p class="text-xs text-muted mt-3 italic border-l-2 border-brand/40 pl-2">${esc(ex.desc)}</p>` : ''}
                        ${lastHtml}
                    </div>
                    <button onclick="promptEditEx(${eIdx})" class="icon-btn -mr-2 -mt-1" aria-label="Modifica"><i class="fa-solid fa-pen text-xs"></i></button>
                </div>
                <div class="flex gap-2 mt-4">
                    <button onclick="promptLogSession(${eIdx})" class="flex-1 bg-brand text-white text-sm font-bold py-2.5 rounded-xl active:scale-[0.97] transition shadow-md shadow-brand/20"><i class="fa-solid fa-plus mr-1"></i> Log</button>
                    ${hasHist ? `<button onclick="toggleHistory('${key}')" class="flex-1 btn-soft text-sm py-2.5 !rounded-xl"><i class="fa-solid fa-chart-line"></i> Storico <i class="fa-solid fa-chevron-down text-[10px] transition ${open ? 'rotate-180' : ''}"></i></button>` : ''}
                    <button onclick="moveExercise(${eIdx}, -1)" class="btn-soft w-10 !rounded-xl ${eIdx === 0 ? 'opacity-30 pointer-events-none' : ''}" aria-label="Sposta su"><i class="fa-solid fa-arrow-up text-xs"></i></button>
                    <button onclick="moveExercise(${eIdx}, 1)" class="btn-soft w-10 !rounded-xl ${eIdx === n - 1 ? 'opacity-30 pointer-events-none' : ''}" aria-label="Sposta giù"><i class="fa-solid fa-arrow-down text-xs"></i></button>
                </div>
                ${hasHist ? `<div id="hist-${key}" class="expander ${open ? 'open' : ''}"><div><div class="pt-3"><p class="text-[10px] font-bold uppercase tracking-wider text-muted mb-1 ml-1">Storico · kg × ripetizioni</p>${histHtml}</div></div></div>` : ''}
            </article>`;
    }).join('');
}

function toggleHistory(key) {
    if (openHistories.has(key)) openHistories.delete(key); else openHistories.add(key);
    const el = $('hist-' + key);
    if (el) {
        el.classList.toggle('open');
        el.previousElementSibling.querySelector('.fa-chevron-down')?.classList.toggle('rotate-180');
    }
}

function moveExercise(eIdx, dir) {
    const list = state.workouts[nav.workoutDay].exercises;
    const j = eIdx + dir;
    if (j < 0 || j >= list.length) return;
    [list[eIdx], list[j]] = [list[j], list[eIdx]];
    openHistories.clear();
    persist(); render();
}

// ---- Modale esercizio ----
let editingEx = null; // indice esercizio in modifica, null = nuovo
let exDraft = { 1: [], 2: [] }; // serie in modifica (peso/reps per ogni serie)

function resizePlan(plan, n) {
    while (plan.length < n) plan.push(plan.length ? { ...plan[plan.length - 1] } : { weight: '', reps: '' });
    plan.length = n;
    return plan;
}

function syncExDraft() {
    document.querySelectorAll('#exModal [data-plan]').forEach((inp) => {
        const s = exDraft[inp.dataset.plan][inp.dataset.i];
        if (s) s[inp.dataset.k] = inp.value.trim();
    });
}

function planTableHtml(which, plan, color) {
    const c = COLOR[color];
    const rows = plan.map((s, i) => `
        <div class="grid grid-cols-[2.25rem_1fr_1fr] gap-2 items-center">
            <span class="h-10 rounded-xl ${c.soft} text-xs font-extrabold flex items-center justify-center">${i + 1}</span>
            <input type="text" inputmode="decimal" data-plan="${which}" data-i="${i}" data-k="weight" value="${esc(s.weight)}" placeholder="—" aria-label="Kg serie ${i + 1}" class="field !py-2 !px-2 text-center">
            <input type="text" data-plan="${which}" data-i="${i}" data-k="reps" value="${esc(s.reps)}" placeholder="10" aria-label="Ripetizioni serie ${i + 1}" class="field !py-2 !px-2 text-center">
        </div>`).join('');
    return `
        <div class="grid grid-cols-[2.25rem_1fr_1fr] gap-2 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted text-center"><span>Serie</span><span>Kg</span><span>Reps</span></div>
        <div class="space-y-1.5">${rows}</div>
        ${plan.length > 1 ? `<button type="button" onclick="copyFirstSet(${which})" class="mt-2 ml-1 text-xs font-bold ${c.text} active:scale-95 transition"><i class="fa-solid fa-clone mr-1"></i> Copia la serie 1 su tutte</button>` : ''}`;
}

function renderPlanTables() {
    const sup = $('exModal').dataset.type === 'superset';
    $('planTable1').innerHTML = planTableHtml(1, exDraft[1], 'brand');
    $('planTable2').innerHTML = sup ? planTableHtml(2, exDraft[2], 'accent') : '';
}

function changeExSets(delta) {
    syncExDraft();
    const inp = $('exSets');
    let n = parseInt(inp.value, 10) || exDraft[1].length || 1;
    if (delta) n = exDraft[1].length + delta;
    n = Math.max(1, Math.min(MAX_SETS, n));
    inp.value = n;
    resizePlan(exDraft[1], n);
    resizePlan(exDraft[2], n);
    renderPlanTables();
}

function copyFirstSet(which) {
    syncExDraft();
    const first = exDraft[which][0];
    exDraft[which] = exDraft[which].map(() => ({ ...first }));
    renderPlanTables();
}

function setExType(type) {
    syncExDraft();
    const sup = type === 'superset';
    $('typeClassic').classList.toggle('active', !sup);
    $('typeSuper').classList.toggle('active', sup);
    $('superFields1').classList.toggle('hidden', !sup);
    $('superFields2').classList.toggle('hidden', !sup);
    $('exSetsHint').classList.toggle('hidden', !sup);
    $('exNameLabel').textContent = sup ? 'Nome del superset' : 'Nome esercizio';
    $('exModal').dataset.type = type;
    resizePlan(exDraft[2], exDraft[1].length);
    renderPlanTables();
}

function fillExForm(ex) {
    const n = Math.min(MAX_SETS, parseInt(ex.sets, 10) || 3);
    const clone = (p) => (Array.isArray(p) ? p.map((s) => ({ weight: str(s.weight), reps: str(s.reps) })) : []);
    exDraft = { 1: resizePlan(clone(ex.plan1), n), 2: resizePlan(clone(ex.plan2), n) };
    // svuota le righe dell'esercizio aperto in precedenza, altrimenti setExType le rileggerebbe nella bozza
    $('planTable1').innerHTML = '';
    $('planTable2').innerHTML = '';
    $('exName').value = ex.name || '';
    $('exSubName1').value = ex.subName1 || '';
    $('exSubName2').value = ex.subName2 || ex.name2 || '';
    $('exSets').value = n;
    $('exDesc').value = ex.desc || '';
    setExType(ex.type || 'classic');
}

function promptAddEx() {
    editingEx = null;
    $('exModalTitle').textContent = 'Nuovo esercizio';
    $('exDeleteBtn').classList.add('hidden');
    fillExForm({});
    openModal('exModal');
}

function promptEditEx(eIdx) {
    editingEx = eIdx;
    $('exModalTitle').textContent = 'Modifica esercizio';
    $('exDeleteBtn').classList.remove('hidden');
    fillExForm(state.workouts[nav.workoutDay].exercises[eIdx]);
    openModal('exModal');
}

function cleanWeight(v) {
    const n = parseNum(v);
    return Number.isFinite(n) ? String(n) : '';
}

async function saveExercise() {
    syncExDraft();
    const type = $('exModal').dataset.type || 'classic';
    const nameEl = $('exName');
    const name = nameEl.value.trim();
    if (!name) { shake(nameEl); return; }
    const n = exDraft[1].length;
    const finalize = (plan) => plan.slice(0, n).map((s) => ({ weight: cleanWeight(s.weight), reps: s.reps || '10' }));
    const plan1 = finalize(exDraft[1]);
    const plan2 = type === 'superset' ? finalize(exDraft[2]) : [];
    const ex = {
        name,
        type,
        subName1: type === 'superset' ? $('exSubName1').value.trim() : '',
        subName2: type === 'superset' ? $('exSubName2').value.trim() : '',
        sets: String(n),
        plan1,
        plan2,
        // campi della versione precedente (prima serie), mantenuti per compatibilità dei backup
        reps1: plan1[0].reps,
        weight1: plan1[0].weight,
        reps2: plan2[0] ? plan2[0].reps : '',
        weight2: plan2[0] ? plan2[0].weight : '',
        desc: $('exDesc').value.trim()
    };
    const list = state.workouts[nav.workoutDay].exercises;
    if (editingEx !== null) {
        const old = list[editingEx];
        list[editingEx] = { ...old, ...ex, history: old.history || [], history2: old.history2 || [] };
    } else {
        list.push({ ...ex, history: [], history2: [] });
    }
    persist();
    await closeModal('exModal');
    toast(editingEx !== null ? 'Esercizio aggiornato' : 'Esercizio aggiunto');
    render();
}

async function deleteExercise() {
    const list = state.workouts[nav.workoutDay].exercises;
    const ex = list[editingEx];
    if (!ex) return;
    if (!(await confirmDialog('Eliminare l\'esercizio?', `"${ex.name}" e il suo storico verranno eliminati.`))) return;
    list.splice(editingEx, 1);
    openHistories.clear();
    persist();
    await closeModal('exModal');
    toast('Esercizio eliminato');
    render();
}

// ---- Log sessioni ----
let loggingEx = null;

/** Valori iniziali del log: ultima sessione serie per serie, altrimenti la pianificazione della scheda. */
function logStartRows(plan, last) {
    const src = last && Array.isArray(last.sets) ? last.sets : null;
    return plan.map((p, i) => {
        const s = src ? (src[i] || p) : last ? { weight: last.weight, reps: last.reps } : p;
        const reps = parseNum(s.reps);
        return { weight: str(s.weight), reps: Number.isFinite(reps) ? String(Math.trunc(reps)) : '' };
    });
}

function logGroupHtml(which, title, rows, color) {
    const c = COLOR[color];
    return `
        <div>
            <p class="text-sm font-extrabold ${c.text} mb-2 truncate"><i class="fa-solid fa-dumbbell mr-1"></i> ${esc(title)}</p>
            <div class="grid grid-cols-[2.25rem_1fr_1fr] gap-2 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted text-center"><span>Serie</span><span>Kg</span><span>Reps</span></div>
            <div class="space-y-1.5">
                ${rows.map((s, i) => `
                    <div class="grid grid-cols-[2.25rem_1fr_1fr] gap-2 items-center">
                        <span class="h-11 rounded-xl ${c.soft} text-xs font-extrabold flex items-center justify-center">${i + 1}</span>
                        <input type="text" inputmode="decimal" data-log="${which}" data-i="${i}" data-k="weight" value="${esc(s.weight)}" placeholder="0" aria-label="Kg serie ${i + 1}" class="field !py-2.5 !px-2 text-center">
                        <input type="number" inputmode="numeric" min="0" data-log="${which}" data-i="${i}" data-k="reps" value="${esc(s.reps)}" placeholder="—" aria-label="Ripetizioni serie ${i + 1}" class="field !py-2.5 !px-2 text-center">
                    </div>`).join('')}
            </div>
            ${rows.length > 1 ? `<button type="button" onclick="copyFirstLogSet(${which})" class="mt-2 ml-1 text-xs font-bold ${c.text} active:scale-95 transition"><i class="fa-solid fa-clone mr-1"></i> Copia la serie 1 su tutte</button>` : ''}
        </div>`;
}

function promptLogSession(eIdx) {
    loggingEx = eIdx;
    const ex = state.workouts[nav.workoutDay].exercises[eIdx];
    const isSuper = ex.type === 'superset';
    let html = logGroupHtml(1, isSuper ? (ex.subName1 || ex.name) : ex.name, logStartRows(ex.plan1, ex.history[0]), 'brand');
    if (isSuper) {
        html += '<div class="border-t border-line"></div>' +
            logGroupHtml(2, ex.subName2 || ex.name2 || 'Esercizio 2', logStartRows(ex.plan2, ex.history2[0]), 'accent');
    }
    $('logBody').innerHTML = html;
    openModal('logModal');
}

function copyFirstLogSet(which) {
    const get = (i, k) => document.querySelector(`#logBody [data-log="${which}"][data-i="${i}"][data-k="${k}"]`);
    const w = get(0, 'weight').value;
    const r = get(0, 'reps').value;
    document.querySelectorAll(`#logBody [data-log="${which}"][data-k="weight"]`).forEach((el) => { el.value = w; });
    document.querySelectorAll(`#logBody [data-log="${which}"][data-k="reps"]`).forEach((el) => { el.value = r; });
}

/** Serie compilate di un gruppo; quelle senza ripetizioni non vengono registrate. */
function readLogSets(which) {
    return [...document.querySelectorAll(`#logBody [data-log="${which}"][data-k="reps"]`)].map((repsEl) => {
        const wEl = document.querySelector(`#logBody [data-log="${which}"][data-i="${repsEl.dataset.i}"][data-k="weight"]`);
        return { weight: cleanWeight(wEl.value), reps: parseInt(repsEl.value, 10) };
    }).filter((s) => s.reps > 0).map((s) => ({ weight: s.weight, reps: String(s.reps) }));
}

function logEntry(sets, date, ts) {
    // peso/ripetizioni in cima = serie più pesante (compatibilità con la versione precedente)
    const top = sets.reduce((a, s) => ((parseNum(s.weight) || 0) > (parseNum(a.weight) || 0) ? s : a), sets[0]);
    return { date, ts, sets, weight: top.weight, reps: top.reps };
}

async function confirmLogSession() {
    const ex = state.workouts[nav.workoutDay].exercises[loggingEx];
    const isSuper = ex.type === 'superset';
    const sets1 = readLogSets(1);
    const sets2 = isSuper ? readLogSets(2) : [];
    const missing = !sets1.length ? 1 : isSuper && !sets2.length ? 2 : 0;
    if (missing) {
        shake(document.querySelector(`#logBody [data-log="${missing}"][data-k="reps"]`));
        toast('Inserisci le ripetizioni di almeno una serie', 'fa-triangle-exclamation');
        return;
    }
    const ts = Date.now();
    const date = new Date(ts).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
    ex.history.unshift(logEntry(sets1, date, ts));
    if (isSuper) ex.history2.unshift(logEntry(sets2, date, ts));
    persist();
    await closeModal('logModal');
    openHistories.add(`${nav.workoutDay}-${loggingEx}`);
    toast('Sessione salvata');
    render();
}

async function deleteLog(dIdx, eIdx, which, hIdx) {
    const ex = state.workouts[dIdx].exercises[eIdx];
    const list = which === 2 ? ex.history2 : ex.history;
    const h = list[hIdx];
    if (!h) return;
    if (!(await confirmDialog('Eliminare questo log?', `${h.date || ''}: ${setsOf(h).map(fmtSet).join(' · ')}`))) return;
    list.splice(hIdx, 1);
    persist(); render();
}

// ================= DIETA =================
function renderDietGrid() {
    const today = todayDayIdx();
    $('dietGrid').innerHTML = DAYS.map((day, i) => {
        const m = dayMacros(i);
        const meals = state.weeklyDiet[day].length;
        const isToday = i === today;
        return `
            <button onclick="go('dietDay', { dietDay: ${i} })" class="card p-4 text-left active:scale-[0.97] transition relative overflow-hidden ${isToday ? '!border-emerald-500/50 ring-2 ring-emerald-500/20' : ''} ${i === 6 ? 'col-span-2' : ''}">
                <div class="flex items-center justify-between mb-1">
                    <h3 class="font-extrabold text-base">${day}</h3>
                    ${isToday ? '<span class="text-[9px] font-extrabold uppercase tracking-wider bg-emerald-500 text-white px-2 py-0.5 rounded-full">Oggi</span>' : ''}
                </div>
                <p class="text-xs text-muted font-semibold mb-3">${meals} ${meals === 1 ? 'pasto' : 'pasti'}</p>
                <div class="flex gap-1.5 text-[11px] font-extrabold font-mono">
                    <span class="${MACRO.Carboidrati.bg} ${MACRO.Carboidrati.text} px-1.5 py-0.5 rounded-md">C${fmt(m.Carboidrati, 0)}</span>
                    <span class="${MACRO.Proteine.bg} ${MACRO.Proteine.text} px-1.5 py-0.5 rounded-md">P${fmt(m.Proteine, 0)}</span>
                    <span class="${MACRO.Grassi.bg} ${MACRO.Grassi.text} px-1.5 py-0.5 rounded-md">G${fmt(m.Grassi, 0)}</span>
                </div>
            </button>`;
    }).join('');
}

function renderDietDay() {
    const dayIdx = nav.dietDay;
    const day = DAYS[dayIdx];
    const meals = state.weeklyDiet[day];
    $('dietDayTitle').textContent = day;
    $('dietDayMacros').innerHTML = macroTiles(dayMacros(dayIdx));

    if (!meals.length) {
        $('mealList').innerHTML = `
            <div class="card border-dashed p-8 text-center">
                <i class="fa-solid fa-bowl-food text-3xl text-muted/50 mb-3"></i>
                <p class="text-sm text-muted">Nessun pasto inserito per questo giorno.</p>
            </div>`;
        return;
    }

    $('mealList').innerHTML = meals.map((meal, mIdx) => {
        const mm = sumMacros([meal]);
        const items = meal.items.map((item, iIdx) => {
            const mac = itemMacro(item);
            const cat = mac ? mac.category : item.category;
            const style = MACRO[cat] || MACRO.Verdure;
            const note = mac && mac.category !== 'Verdure' ? `<span class="${style.text}">${fmt(mac.grams, 0)}g ${style.short}</span>` : `<span class="text-muted">${esc(cat || '')}</span>`;
            return `
                <div class="flex items-center gap-2 py-2 border-b border-line/70 last:border-0">
                    <span class="w-1.5 self-stretch rounded-full ${style.bg.replace('/10', '')} opacity-70"></span>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-bold leading-tight break-words">${esc(item.name)}</p>
                        <p class="text-[11px] font-bold">${note}</p>
                    </div>
                    <button onclick="editItemGrams(${mIdx}, ${iIdx})" class="text-xs font-extrabold font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-lg active:scale-95 transition">${fmt(item.grams)}g</button>
                    <button onclick="promptSwapFood(${mIdx}, ${iIdx})" class="w-8 h-8 rounded-full text-muted hover:text-accent flex items-center justify-center active:scale-90" aria-label="Sostituisci"><i class="fa-solid fa-arrow-right-arrow-left text-xs"></i></button>
                    <button onclick="deleteDietItem(${mIdx}, ${iIdx})" class="w-8 h-8 -mr-1 rounded-full text-muted hover:text-rose-500 flex items-center justify-center active:scale-90" aria-label="Rimuovi"><i class="fa-solid fa-xmark text-sm"></i></button>
                </div>`;
        }).join('');

        return `
            <article class="card p-4">
                <div class="flex items-start justify-between gap-2 mb-3">
                    <button onclick="renameMeal(${mIdx})" class="text-left min-w-0">
                        <h4 class="font-extrabold text-base leading-tight break-words">${esc(meal.name)} <i class="fa-solid fa-pen text-[10px] text-muted ml-1"></i></h4>
                        <div class="flex gap-2.5 text-[11px] mt-1 font-extrabold">
                            <span class="${MACRO.Carboidrati.text}">C ${fmt(mm.Carboidrati, 0)}g</span>
                            <span class="${MACRO.Proteine.text}">P ${fmt(mm.Proteine, 0)}g</span>
                            <span class="${MACRO.Grassi.text}">G ${fmt(mm.Grassi, 0)}g</span>
                        </div>
                    </button>
                    <div class="flex gap-1.5 shrink-0">
                        <button onclick="promptAddItem(${mIdx})" class="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center active:scale-90 transition" aria-label="Aggiungi alimento"><i class="fa-solid fa-plus text-sm"></i></button>
                        <button onclick="duplicateMeal(${mIdx})" class="w-9 h-9 btn-soft !rounded-xl text-xs" aria-label="Duplica pasto"><i class="fa-solid fa-copy"></i></button>
                        <button onclick="deleteMeal(${mIdx})" class="w-9 h-9 btn-soft !rounded-xl text-xs !text-rose-500" aria-label="Elimina pasto"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <div class="bg-inset border border-line rounded-2xl px-3 py-1">
                    ${items || '<p class="text-xs text-muted text-center py-3">Nessun alimento. Tocca <b>+</b> per aggiungerne uno.</p>'}
                </div>
            </article>`;
    }).join('');
}

const currentMeals = () => state.weeklyDiet[DAYS[nav.dietDay]];

async function addMeal() {
    const n = currentMeals().length;
    const suggestions = ['Colazione', 'Spuntino', 'Pranzo', 'Merenda', 'Cena'];
    const name = await askText({ title: 'Nuovo pasto', label: 'Nome del pasto', placeholder: 'Es. ' + (suggestions[n] || 'Spuntino'), confirm: 'Aggiungi pasto' });
    if (!name) return;
    currentMeals().push({ name, items: [] });
    persist(); render();
}

async function renameMeal(mIdx) {
    const meal = currentMeals()[mIdx];
    const name = await askText({ title: 'Rinomina pasto', label: 'Nome del pasto', value: meal.name });
    if (!name) return;
    meal.name = name;
    persist(); render();
}

function duplicateMeal(mIdx) {
    const meals = currentMeals();
    const copy = JSON.parse(JSON.stringify(meals[mIdx]));
    copy.name += ' (copia)';
    meals.splice(mIdx + 1, 0, copy);
    persist(); render();
    toast('Pasto duplicato');
}

async function deleteMeal(mIdx) {
    const meal = currentMeals()[mIdx];
    if (meal.items.length && !(await confirmDialog('Eliminare il pasto?', `"${meal.name}" con ${meal.items.length} alimenti verrà eliminato.`))) return;
    currentMeals().splice(mIdx, 1);
    persist(); render();
}

async function deleteDietItem(mIdx, iIdx) {
    currentMeals()[mIdx].items.splice(iIdx, 1);
    persist(); render();
    toast('Alimento rimosso', 'fa-trash-can');
}

async function editItemGrams(mIdx, iIdx) {
    const item = currentMeals()[mIdx].items[iIdx];
    const v = await askText({ title: item.name, label: 'Grammi', value: String(item.grams), inputmode: 'decimal' });
    if (v === null) return;
    const g = parseNum(v);
    if (!(g > 0)) { toast('Valore non valido', 'fa-triangle-exclamation'); return; }
    item.grams = g;
    persist(); render();
}

// ---- Selettore alimenti ----
const picker = { mIdx: null, selected: null, cat: '' };

function promptAddItem(mIdx) {
    picker.mIdx = mIdx;
    picker.selected = null;
    picker.cat = '';
    $('pickerSearch').value = '';
    $('pickerGrams').value = '';
    renderPickerCats();
    renderPickerList();
    updatePickerPreview();
    openModal('foodPickerModal');
}

function renderPickerCats() {
    const cats = [['', 'Tutti'], ...CATEGORIES.map((c) => [c, MACRO[c].label])];
    $('pickerCats').innerHTML = cats.map(([c, l]) => `
        <button type="button" onclick="setPickerCat('${c}')" class="shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border transition ${picker.cat === c ? 'bg-ink text-bg border-ink' : 'bg-inset text-muted border-line'}">${l}</button>`).join('');
}

function setPickerCat(c) { picker.cat = c; renderPickerCats(); renderPickerList(); }

let pickerFoods = [];
function renderPickerList() {
    const q = $('pickerSearch').value.trim().toLowerCase();
    pickerFoods = allFoods()
        .filter((f) => (!picker.cat || f.category === picker.cat) && (!q || f.name.toLowerCase().includes(q)))
        .sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name, 'it'));
    $('pickerList').innerHTML = pickerFoods.map((f, i) => {
        const s = MACRO[f.category] || MACRO.Verdure;
        const sel = picker.selected === f.name;
        return `
            <button type="button" onclick="pickFood(${i})" class="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition ${sel ? 'bg-emerald-500/15 ring-1 ring-emerald-500/40' : 'hover:bg-surface'}">
                <span class="w-2 h-2 rounded-full shrink-0 ${s.text.replace('text-', 'bg-')}"></span>
                <span class="flex-1 min-w-0 text-sm font-semibold truncate">${esc(f.name)}</span>
                <span class="text-[11px] font-bold ${s.text} shrink-0">${f.category === 'Verdure' ? 'libera' : fmt(f.macroValue) + 'g ' + s.short}</span>
                ${sel ? '<i class="fa-solid fa-circle-check text-emerald-500"></i>' : ''}
            </button>`;
    }).join('') || '<p class="text-sm text-muted text-center py-6">Nessun alimento trovato.</p>';
}

function pickFood(i) {
    const f = pickerFoods[i];
    if (!f) return;
    picker.selected = f.name;
    renderPickerList();
    updatePickerPreview();
    const g = $('pickerGrams');
    if (!g.value) g.focus({ preventScroll: true });
}

function updatePickerPreview() {
    const f = picker.selected ? findFood(picker.selected) : null;
    const sel = $('pickerSelected');
    sel.textContent = f ? f.name : 'Nessuno';
    sel.classList.toggle('text-muted', !f);
    const g = parseNum($('pickerGrams').value);
    const p = $('pickerPreview');
    if (f && g > 0 && f.category !== 'Verdure') {
        const s = MACRO[f.category];
        p.innerHTML = `≈ <span class="${s.text}">${fmt((f.macroValue * g) / 100)}g di ${s.label.toLowerCase()}</span>`;
    } else p.textContent = '';
}

async function confirmAddDietItem() {
    const f = picker.selected ? findFood(picker.selected) : null;
    if (!f) { shake($('pickerList')); return; }
    const g = parseNum($('pickerGrams').value);
    if (!(g > 0)) { shake($('pickerGrams')); return; }
    currentMeals()[picker.mIdx].items.push({ name: f.name, category: f.category, grams: g });
    persist();
    await closeModal('foodPickerModal');
    render();
}

// ---- Sostituzione alimento ----
const swap = { mIdx: null, iIdx: null, totalMacro: 0, alts: [] };

function promptSwapFood(mIdx, iIdx) {
    const item = currentMeals()[mIdx].items[iIdx];
    const src = findFood(item.name);
    if (!src || !(src.macroValue > 0)) {
        alertDialog('Nessuna alternativa', 'Le verdure e gli alimenti senza macro principale si gestiscono liberamente.', 'fa-leaf');
        return;
    }
    swap.mIdx = mIdx;
    swap.iIdx = iIdx;
    swap.totalMacro = (src.macroValue / 100) * item.grams;
    swap.alts = allFoods()
        .filter((f) => f.category === src.category && f.name !== src.name && f.macroValue > 0)
        .map((f) => ({ name: f.name, grams: (swap.totalMacro * 100) / f.macroValue }))
        .sort((a, b) => a.name.localeCompare(b.name, 'it'));
    const s = MACRO[src.category];
    $('swapInfo').innerHTML = `
        <p class="text-[10px] uppercase font-bold tracking-wider text-accent mb-1">Stai sostituendo</p>
        <p class="text-lg font-extrabold leading-tight">${fmt(item.grams)}g di ${esc(item.name)}</p>
        <p class="text-xs mt-1 font-bold ${s.text}">${fmt(swap.totalMacro)}g di ${s.label.toLowerCase()}</p>`;
    $('swapSearch').value = '';
    renderSwapList();
    openModal('swapModal');
}

function renderSwapList() {
    const q = $('swapSearch').value.trim().toLowerCase();
    $('swapList').innerHTML = swap.alts.map((a, i) => (q && !a.name.toLowerCase().includes(q)) ? '' : `
        <button onclick="confirmSwapFood(${i})" class="w-full flex justify-between items-center gap-2 bg-inset border border-line p-3 rounded-xl active:scale-[0.98] transition hover:border-accent/40">
            <span class="font-bold text-sm text-left">${esc(a.name)}</span>
            <span class="text-accent font-extrabold font-mono bg-accent/10 px-2.5 py-1 rounded-lg shrink-0">${fmt(Math.round(a.grams), 0)}g</span>
        </button>`).join('') || '<p class="text-sm text-muted text-center py-4">Nessuna alternativa trovata.</p>';
}

async function confirmSwapFood(i) {
    const a = swap.alts[i];
    const f = a && findFood(a.name);
    if (!f) return;
    currentMeals()[swap.mIdx].items[swap.iIdx] = { name: f.name, category: f.category, grams: Math.round(a.grams) };
    persist();
    await closeModal('swapModal');
    toast('Alimento sostituito');
    render();
}

// ================= CONVERSIONI / DB =================
let smartCat = '';
let smartFoods = [];

function setSmartCat(cat) {
    smartCat = cat;
    document.querySelectorAll('#smartCatSeg .seg').forEach((b) => b.classList.toggle('active', b.dataset.cat === cat));
    updateSmartDropdown();
}

function updateSmartDropdown() {
    const sel = $('smartFood');
    const prev = sel.value !== '' ? smartFoods[sel.value]?.name : null;
    smartFoods = allFoods().filter((f) => f.category === smartCat && f.macroValue > 0).sort((a, b) => a.name.localeCompare(b.name, 'it'));
    sel.disabled = !smartCat;
    sel.innerHTML = `<option value="">${smartCat ? 'Alimento di partenza' : 'Scegli prima il macro'}</option>` +
        smartFoods.map((f, i) => `<option value="${i}" ${f.name === prev ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
}

function findAlternatives() {
    const idx = $('smartFood').value;
    const grams = parseNum($('smartGrams').value);
    if (!smartCat) { shake($('smartCatSeg')); return; }
    if (idx === '') { shake($('smartFood')); return; }
    if (!(grams > 0)) { shake($('smartGrams')); return; }

    const src = smartFoods[idx];
    const total = (src.macroValue / 100) * grams;
    const s = MACRO[smartCat];
    const rows = smartFoods.filter((f) => f !== src).map((f) => `
        <div class="flex justify-between items-center gap-2 bg-inset border border-line px-3 py-2.5 rounded-xl">
            <span class="font-semibold text-sm">${esc(f.name)}</span>
            <span class="text-accent font-extrabold font-mono bg-accent/10 px-2.5 py-1 rounded-lg shrink-0">${fmt(Math.round((total * 100) / f.macroValue), 0)}g</span>
        </div>`).join('');
    const res = $('smartResult');
    res.innerHTML = `
        <div class="${s.bg} border ${s.border} p-4 rounded-2xl mb-3 text-center">
            <p class="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">${fmt(grams)}g di ${esc(src.name)} =</p>
            <p class="text-2xl font-extrabold ${s.text}">${fmt(total)}g <span class="text-sm font-bold">di ${s.label.toLowerCase()}</span></p>
        </div>
        <div class="space-y-1.5">${rows}</div>`;
    res.classList.remove('hidden');
}

function renderDb() {
    if (!smartCat) setSmartCat('Carboidrati'); else updateSmartDropdown();
    const list = $('foodList');
    if (!state.foodDb.length) {
        list.innerHTML = '<p class="text-sm text-muted text-center p-5 bg-inset rounded-2xl border border-dashed border-line">Nessun alimento personale.<br>Aggiungi quelli che usi più spesso con <b>+</b>.</p>';
        return;
    }
    list.innerHTML = state.foodDb.map((f, i) => {
        const s = MACRO[f.category] || MACRO.Verdure;
        return `
            <div class="flex items-center gap-3 bg-inset border border-line p-3 rounded-2xl">
                <span class="w-9 h-9 rounded-xl ${s.bg} ${s.text} font-extrabold text-sm flex items-center justify-center shrink-0">${s.short}</span>
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-sm truncate">${esc(f.name)}</p>
                    <p class="text-xs text-muted font-semibold">${f.category === 'Verdure' ? 'Verdura libera' : `${fmt(f.macroValue)}g ${s.label.toLowerCase()} / 100g`}</p>
                </div>
                <button onclick="deleteDbFood(${i})" class="w-9 h-9 rounded-full text-muted hover:text-rose-500 flex items-center justify-center" aria-label="Elimina"><i class="fa-solid fa-trash-can text-sm"></i></button>
            </div>`;
    }).join('');
}

function promptAddFood() {
    $('dbFoodName').value = '';
    $('dbFoodMacro').value = '';
    $('dbFoodCat').value = smartCat || 'Carboidrati';
    openModal('addFoodModal');
}

async function saveDbFood() {
    const nameEl = $('dbFoodName');
    const name = nameEl.value.trim();
    const category = $('dbFoodCat').value;
    let macroValue = parseNum($('dbFoodMacro').value);
    if (!name) { shake(nameEl); return; }
    if (category === 'Verdure') macroValue = 0;
    else if (!(macroValue > 0) || macroValue > 100) { shake($('dbFoodMacro')); return; }
    if (findFood(name) || [...foodIndex.keys()].some((k) => k.toLowerCase() === name.toLowerCase())) {
        toast('Esiste già un alimento con questo nome', 'fa-triangle-exclamation');
        shake(nameEl);
        return;
    }
    state.foodDb.push({ id: Date.now().toString(36), name, category, macroValue });
    rebuildFoodIndex();
    persist();
    await closeModal('addFoodModal');
    toast('Alimento salvato');
    render();
}

async function deleteDbFood(i) {
    const f = state.foodDb[i];
    if (!f) return;
    if (!(await confirmDialog('Eliminare l\'alimento?', `"${f.name}" verrà rimosso dal tuo database. Nei pasti in cui è usato non verranno più calcolati i macro.`))) return;
    state.foodDb = state.foodDb.filter((x) => x !== f);
    rebuildFoodIndex();
    persist(); render();
}

// ================= IMPOSTAZIONI / BACKUP =================
function openSettings() {
    applyTheme();
    $('appVersion').textContent = `Workout v${APP_VERSION}`;
    openModal('settingsModal');
}

function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Workout_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Backup esportato');
}

function triggerImport() { $('importFile').click(); }

function handleImport(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
        let json;
        try { json = JSON.parse(ev.target.result); } catch (err) { json = null; }
        if (!json || typeof json !== 'object' || !(json.weeklyDiet || json.workouts || json.foodDb)) {
            alertDialog('File non valido', 'Il file selezionato non è un backup di Workout.', 'fa-triangle-exclamation');
            return;
        }
        const data = normalizeData(json);
        const ok = await dialog({
            title: 'Importare il backup?',
            text: `${data.workouts.length} ${data.workouts.length === 1 ? 'scheda' : 'schede'} e ${data.foodDb.length} ${data.foodDb.length === 1 ? 'alimento personale' : 'alimenti personali'}. I dati attuali su questo dispositivo verranno sostituiti.`,
            confirm: 'Importa', cancel: 'Annulla', icon: 'fa-upload'
        });
        if (!ok) return;
        Object.assign(state, data);
        rebuildFoodIndex();
        persist();
        openHistories.clear();
        await closeModal('settingsModal');
        toast('Dati importati');
        go('home');
    };
    reader.readAsText(file);
}

// ================= TIMER =================
const T = { mode: 'free', running: false, phase: 'idle', set: 0, sets: 0, cfg: null, endAt: 0, dur: 0, remaining: 0, startAt: 0, elapsed: 0, lastBeepSec: null, interval: null, wakeLock: null };
let audioCtx = null;

function unlockAudio() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { audioCtx = null; }
}

function beep(freq = 880, dur = 0.15, vol = 0.6) {
    if (!audioCtx) return;
    try {
        const t0 = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(vol, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(g).connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    } catch (e) { /* audio non disponibile */ }
}

const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* ignora */ } };

async function requestWakeLock() {
    try { if ('wakeLock' in navigator && !T.wakeLock) T.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { T.wakeLock = null; }
}
function releaseWakeLock() {
    try { T.wakeLock && T.wakeLock.release(); } catch (e) { /* ignora */ }
    T.wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && T.running) { T.wakeLock = null; requestWakeLock(); timerTick(); }
});

const fmtClock = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return h ? `${h}:${m}:${s}` : `${m}:${s}`;
};

function readTimerCfg() {
    const int = (id) => Math.max(0, parseInt($(id).value, 10) || 0);
    return {
        sets: Math.max(1, int('tSets')),
        work: int('tWorkMin') * 60 + Math.min(59, int('tWorkSec')),
        rest: int('tRestMin') * 60 + Math.min(59, int('tRestSec'))
    };
}

function fillTimerCfg() {
    const c = settings.timer;
    $('tSets').value = c.sets;
    $('tWorkMin').value = String(Math.floor(c.work / 60)).padStart(2, '0');
    $('tWorkSec').value = String(c.work % 60).padStart(2, '0');
    $('tRestMin').value = String(Math.floor(c.rest / 60)).padStart(2, '0');
    $('tRestSec').value = String(c.rest % 60).padStart(2, '0');
}

function saveTimerCfg() {
    settings.timer = readTimerCfg();
    saveSettings();
    fillTimerCfg();
    if (T.mode === 'interval' && T.phase === 'idle') updateTimerUI();
}

function toggleTimerSettings() { $('timerSettings').classList.toggle('open'); }

function setTimerMode(mode) {
    resetTimer();
    T.mode = mode;
    settings.timerMode = mode;
    saveSettings();
    $('tModeFree').classList.toggle('active', mode === 'free');
    $('tModeInt').classList.toggle('active', mode === 'interval');
    $('intervalInputs').classList.toggle('hidden', mode !== 'interval');
    updateTimerUI();
}

function startPhase(phase, secs, from) {
    T.phase = phase;
    T.dur = secs * 1000;
    T.endAt = from + T.dur;
    T.lastBeepSec = null;
    const late = Date.now() - from > 1500; // transizione recuperata dopo il background: niente suoni in ritardo
    if (!late) {
        if (phase === 'work') { beep(1046, 0.25); vibrate(200); } else { beep(523, 0.5); vibrate([100, 80, 100]); }
    }
}

function advancePhase(at) {
    if (T.phase === 'work') {
        if (T.set >= T.sets) return finishTimer();
        if (T.cfg.rest > 0) startPhase('rest', T.cfg.rest, at);
        else { T.set++; startPhase('work', T.cfg.work, at); }
    } else if (T.phase === 'rest') {
        T.set++;
        startPhase('work', T.cfg.work, at);
    }
}

function finishTimer() {
    clearInterval(T.interval);
    T.running = false;
    T.phase = 'done';
    releaseWakeLock();
    beep(784, 0.2); setTimeout(() => beep(988, 0.2), 220); setTimeout(() => beep(1318, 0.45), 440);
    vibrate([200, 100, 200, 100, 400]);
    updateTimerUI();
}

function timerTick() {
    if (!T.running) return;
    const now = Date.now();
    if (T.mode === 'interval') {
        while (T.running && now >= T.endAt) advancePhase(T.endAt);
        if (!T.running) return;
        const secLeft = Math.ceil((T.endAt - now) / 1000);
        if (secLeft <= 3 && secLeft >= 1 && T.lastBeepSec !== secLeft) { T.lastBeepSec = secLeft; beep(660, 0.08, 0.4); }
    }
    updateTimerUI();
}

function toggleTimer() {
    unlockAudio();
    if (T.running) {
        clearInterval(T.interval);
        T.running = false;
        if (T.mode === 'free') T.elapsed = (Date.now() - T.startAt) / 1000;
        else T.remaining = T.endAt - Date.now();
        releaseWakeLock();
        updateTimerUI();
        return;
    }
    const now = Date.now();
    if (T.mode === 'free') {
        T.startAt = now - T.elapsed * 1000;
    } else if (T.phase === 'idle' || T.phase === 'done') {
        T.cfg = readTimerCfg();
        if (T.cfg.work <= 0) {
            $('timerSettings').classList.add('open');
            shake($('tWorkSec'));
            toast('Imposta la durata del lavoro', 'fa-triangle-exclamation');
            return;
        }
        T.sets = T.cfg.sets;
        T.set = 1;
        startPhase('work', T.cfg.work, now);
    } else {
        T.endAt = now + T.remaining;
    }
    T.running = true;
    clearInterval(T.interval);
    T.interval = setInterval(timerTick, 200);
    requestWakeLock();
    updateTimerUI();
}

function resetTimer() {
    clearInterval(T.interval);
    Object.assign(T, { running: false, phase: 'idle', set: 0, elapsed: 0, remaining: 0, startAt: 0, endAt: 0 });
    releaseWakeLock();
    updateTimerUI();
}

function updateTimerUI() {
    const disp = $('timerDisplay');
    const label = $('timerLabel');
    const prog = $('timerProgress');
    const btn = $('timerPlayBtn');
    let text, lab, color = 'text-accent', pct = 0, barColor = 'bg-brand';

    if (T.mode === 'free') {
        const secs = T.running ? (Date.now() - T.startAt) / 1000 : T.elapsed;
        text = fmtClock(secs);
        lab = T.running ? 'Cronometro · in corso' : secs > 0 ? 'Cronometro · in pausa' : 'Cronometro';
    } else {
        const cfg = T.phase === 'idle' ? readTimerCfg() : T.cfg;
        if (T.phase === 'idle') {
            text = fmtClock(cfg.work);
            lab = `Circuito · ${cfg.sets} serie`;
        } else if (T.phase === 'done') {
            text = '00:00';
            lab = 'Completato!';
            color = 'text-emerald-500';
            pct = 100; barColor = 'bg-emerald-500';
        } else {
            const left = T.running ? T.endAt - Date.now() : T.remaining;
            text = fmtClock(Math.ceil(left / 1000));
            const work = T.phase === 'work';
            lab = `Serie ${T.set}/${T.sets} · ${work ? 'Lavoro' : 'Recupero'}${T.running ? '' : ' · pausa'}`;
            color = work ? 'text-emerald-500' : 'text-amber-500';
            barColor = work ? 'bg-emerald-500' : 'bg-amber-500';
            pct = T.dur ? Math.min(100, Math.max(0, (1 - left / T.dur) * 100)) : 0;
        }
    }
    disp.textContent = text;
    label.textContent = lab;
    label.className = `text-[10px] font-bold uppercase tracking-widest mt-1 truncate ${color}`;
    prog.style.width = pct + '%';
    prog.className = `h-full transition-[width] duration-200 ease-linear ${barColor}`;
    btn.innerHTML = `<i class="fa-solid ${T.running ? 'fa-pause' : 'fa-play'}"></i>`;
    btn.classList.toggle('bg-brand', !T.running);
    btn.classList.toggle('shadow-brand/40', !T.running);
    btn.classList.toggle('bg-amber-500', T.running);
    btn.classList.toggle('shadow-amber-500/40', T.running);
}

// ================= AVVIO =================
loadData();
applyTheme();
fillTimerCfg();
setTimerMode(settings.timerMode === 'interval' ? 'interval' : 'free');

(function boot() {
    const hash = location.hash.replace('#', '');
    const start = ['workout', 'diet', 'db'].includes(hash) ? hash : 'home';
    go(start, {}, { replace: true });
})();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
