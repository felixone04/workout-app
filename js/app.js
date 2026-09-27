'use strict';

const APP_VERSION = '2.8.1';
const STORE_KEY = 'workoutAppV1';
const LEGACY_KEYS = ['mySigmaV3', 'mySigmaV2'];
const SETTINGS_KEY = 'workoutAppSettings';
const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const CATEGORIES = ['Carboidrati', 'Proteine', 'Grassi', 'Verdure'];
// misure corporee in cm; "trend" indica se, per chi vuole dimagrire, un calo è un miglioramento
const MEASURES = [
    { k: 'vita', label: 'Vita', trend: true },
    { k: 'fianchi', label: 'Fianchi', trend: true },
    { k: 'petto', label: 'Petto', trend: false },
    { k: 'braccio', label: 'Braccio', trend: false },
    { k: 'coscia', label: 'Coscia', trend: false }
];
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

/** Carica una libreria esterna solo quando serve (una volta sola). */
const loadedScripts = {};
function loadScript(src) {
    if (!loadedScripts[src]) {
        loadedScripts[src] = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = () => { delete loadedScripts[src]; reject(new Error('caricamento non riuscito: ' + src)); };
            document.head.appendChild(s);
        });
    }
    return loadedScripts[src];
}

function shake(el) {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    el.focus();
}

// ================= DATI =================
const state = { workouts: [], weeklyDiet: {}, foodDb: [], weights: [], weightGoal: 'none', measures: [], kcalLog: {} };
let settings = { theme: 'auto', timer: { sets: 3, work: 45, rest: 90 }, sound: true, volume: 80, voice: true };

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
    const out = { workouts: [], weeklyDiet: {}, foodDb: [], weights: [], weightGoal: 'none', measures: [], kcalLog: {} };
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
    if (Array.isArray(p.foodDb)) out.foodDb = p.foodDb.filter((f) => f && f.name).map(normalizeCustomFood);
    out.weights = (Array.isArray(p.weights) ? p.weights : [])
        .filter((w) => w && /^\d{4}-\d{2}-\d{2}$/.test(w.date) && parseNum(w.kg) > 0)
        .map((w) => ({ date: w.date, kg: Math.round(parseNum(w.kg) * 10) / 10 }));
    // un solo valore per giorno (l'ultimo inserito), in ordine cronologico
    out.weights = [...new Map(out.weights.map((w) => [w.date, w])).values()].sort((a, b) => a.date.localeCompare(b.date));
    out.weightGoal = ['lose', 'gain', 'keep'].includes(p.weightGoal) ? p.weightGoal : 'none';
    // misure corporee (cm): una voce per giorno, solo i campi rilevati
    out.measures = (Array.isArray(p.measures) ? p.measures : [])
        .filter((m) => m && /^\d{4}-\d{2}-\d{2}$/.test(m.date))
        .map((m) => {
            const e = { date: m.date };
            MEASURES.forEach(({ k }) => { const v = parseNum(m[k]); if (v > 0) e[k] = Math.round(v * 10) / 10; });
            return e;
        })
        .filter((m) => Object.keys(m).length > 1);
    out.measures = [...new Map(out.measures.map((m) => [m.date, m])).values()].sort((a, b) => a.date.localeCompare(b.date));
    // calorie della dieta registrate giorno per giorno (per il grafico peso/calorie)
    out.kcalLog = {};
    if (p.kcalLog && typeof p.kcalLog === 'object') {
        Object.entries(p.kcalLog).forEach(([d, v]) => { if (/^\d{4}-\d{2}-\d{2}$/.test(d) && parseNum(v) >= 0) out.kcalLog[d] = Math.round(parseNum(v)); });
    }
    return out;
}

/**
 * Alimento personale con carboidrati/proteine/grassi per 100 g.
 * Quelli creati con le versioni precedenti avevano solo il macro principale:
 * gli altri due restano a 0 e l'alimento viene segnato come "da completare".
 */
function normalizeCustomFood(f, i) {
    const category = CATEGORIES.includes(f.category) ? f.category : 'Carboidrati';
    const num = (v) => { const n = parseNum(v); return n >= 0 ? n : 0; };
    const hasFull = ['c', 'p', 'f'].some((k) => f[k] !== undefined && f[k] !== null && f[k] !== '');
    const food = { id: String(f.id || `${Date.now()}-${i}`), name: String(f.name), category };
    if (hasFull) {
        food.c = num(f.c); food.p = num(f.p); food.f = num(f.f);
    } else {
        const mv = num(f.macroValue);
        food.c = category === 'Carboidrati' ? mv : 0;
        food.p = category === 'Proteine' ? mv : 0;
        food.f = category === 'Grassi' ? mv : 0;
        if (category !== 'Verdure') food.partial = true;
    }
    if (f.partial && hasFull) food.partial = true;
    food.macroValue = MAIN_MACRO_KEY[category] ? food[MAIN_MACRO_KEY[category]] : 0;
    return food;
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

/**
 * Registra le calorie della dieta di oggi (così il grafico peso/calorie ha lo storico reale,
 * anche se in futuro la dieta settimanale cambia). Si aggiorna a ogni salvataggio e all'avvio.
 */
function recordTodayKcal() {
    const kcal = Math.round(dayNutrients(todayDayIdx()).kcal);
    const today = dayKey(new Date());
    if (kcal > 0) state.kcalLog[today] = kcal;
    else delete state.kcalLog[today];
}

function persist() {
    try {
        recordTodayKcal();
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

// ---- Valori nutrizionali ----
// Ogni alimento ha carboidrati (c), proteine (p) e grassi (f) per 100 g.
// Calorie: 4 kcal per grammo di carboidrati e proteine, 9 kcal per grammo di grassi.
const NUTR = [
    { k: 'c', cat: 'Carboidrati' },
    { k: 'p', cat: 'Proteine' },
    { k: 'f', cat: 'Grassi' }
];
const kcalOf = (n) => n.c * 4 + n.p * 4 + n.f * 9;
const emptyNutr = () => ({ c: 0, p: 0, f: 0, kcal: 0 });

function nutrientsOf(food, grams) {
    const k = grams / 100;
    const n = { c: (food.c || 0) * k, p: (food.p || 0) * k, f: (food.f || 0) * k };
    n.kcal = kcalOf(n);
    return n;
}

function itemNutrients(item) {
    const f = findFood(item.name);
    return f ? nutrientsOf(f, item.grams) : null;
}

function sumNutrients(meals) {
    const t = emptyNutr();
    meals.forEach((m) => m.items.forEach((it) => {
        const n = itemNutrients(it);
        if (n) { t.c += n.c; t.p += n.p; t.f += n.f; t.kcal += n.kcal; }
    }));
    return t;
}

const dayNutrients = (dayIdx) => sumNutrients(state.weeklyDiet[DAYS[dayIdx]] || []);

/** Quota di calorie da ciascun macro (percentuali intere che sommano a 100). */
function macroSplit(n) {
    const kc = { c: n.c * 4, p: n.p * 4, f: n.f * 9 };
    const tot = kc.c + kc.p + kc.f;
    if (!tot) return { c: 0, p: 0, f: 0 };
    const raw = NUTR.map(({ k }) => ({ k, v: (kc[k] / tot) * 100 }));
    const out = {};
    raw.forEach((r) => { out[r.k] = Math.floor(r.v); });
    let rest = 100 - raw.reduce((a, r) => a + out[r.k], 0);
    raw.sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v))).forEach((r) => { if (rest > 0) { out[r.k]++; rest--; } });
    return out;
}

/** Riga compatta "C 12 · P 25 · G 3 · 180 kcal" */
function nutrLine(n, { kcal = true } = {}) {
    return NUTR.map(({ k, cat }) => `<span class="${MACRO[cat].text}">${MACRO[cat].short} ${fmt(n[k], 1)}</span>`).join(' <span class="text-muted/60">·</span> ') +
        (kcal ? ` <span class="text-muted/60">·</span> <span class="text-ink">${fmt(n.kcal, 0)} kcal</span>` : '');
}

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
    calendar: { nav: 'workout', parent: 'workout', eyebrow: () => 'Allenamento', title: () => 'Calendario' },
    weight: { nav: 'weight', eyebrow: () => 'Corpo', title: () => 'Peso e misure' },
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
        home: renderHome, workout: renderWorkoutGrid, workoutDay: renderWorkoutDay, calendar: renderCalendar, weight: renderWeight,
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

/** Riquadri calorie + macro (grammi e % delle calorie) con barra di ripartizione. */
function nutritionSummary(n, size = 'lg') {
    const split = macroSplit(n);
    const lg = size === 'lg';
    const tile = (value, unit, label, cls, bg, sub) => `
        <div class="${bg} rounded-2xl ${lg ? 'py-3' : 'py-2'} px-1 text-center">
            <p class="${lg ? 'text-xl' : 'text-base'} font-extrabold ${cls} leading-none">${value}<span class="text-[10px] font-bold">${unit}</span></p>
            <p class="text-[10px] font-bold uppercase tracking-wider text-muted mt-1">${label}</p>
            ${sub !== undefined ? `<p class="text-[10px] font-bold ${cls} opacity-80 leading-none mt-0.5">${sub}</p>` : ''}
        </div>`;
    const bar = NUTR.map(({ k, cat }) => split[k] ? `<div class="${MACRO[cat].text.replace('text-', 'bg-')} h-full" style="width:${split[k]}%"></div>` : '').join('');
    return `
        <div class="grid grid-cols-4 gap-2">
            ${tile(fmt(n.kcal, 0), '', 'Kcal', 'text-ink', 'bg-inset border border-line')}
            ${NUTR.map(({ k, cat }) => tile(fmt(n[k], 0), 'g', MACRO[cat].label, MACRO[cat].text, `${MACRO[cat].bg} border ${MACRO[cat].border}`, `${split[k]}%`)).join('')}
        </div>
        <div class="flex h-2 rounded-full overflow-hidden bg-inset mt-2">${bar}</div>`;
}

function weightHomeCard() {
    const w = state.weights;
    const last = w[w.length - 1];
    let sub = 'Registra il peso per seguire i progressi';
    let delta = '';
    if (last) {
        sub = `Ultima pesata: ${relDate(keyToDate(last.date).getTime())}`;
        const prev = w[w.length - 2];
        if (prev) delta = weightDeltaBadge(last.kg - prev.kg);
    }
    return `
        <button onclick="navTo('weight')" class="card w-full text-left p-5 mb-3 active:scale-[0.98] transition flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-accent/10 text-accent flex items-center justify-center text-xl shrink-0"><i class="fa-solid fa-weight-scale"></i></div>
            <div class="flex-1 min-w-0">
                <h3 class="text-lg font-extrabold leading-tight">Peso e misure</h3>
                <p class="text-sm text-muted font-medium truncate">${sub}</p>
            </div>
            <div class="text-right shrink-0">
                ${last ? `<p class="text-2xl font-extrabold leading-none">${fmt(last.kg)}<span class="text-xs font-bold text-muted"> kg</span></p>${delta ? `<p class="text-xs font-bold mt-1">${delta}</p>` : ''}` : '<span class="text-sm font-bold text-accent"><i class="fa-solid fa-plus"></i> Aggiungi</span>'}
            </div>
        </button>`;
}

function renderHome() {
    const t = todayDayIdx();
    const meals = state.weeklyDiet[DAYS[t]] || [];
    const n = dayNutrients(t);
    const nEx = state.workouts.reduce((a, d) => a + d.exercises.length, 0);
    const last = lastTrainingTs();
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera';

    $('view-home').innerHTML = `
        ${installCardHtml()}
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
            ${nutritionSummary(n, 'sm')}
        </button>

        ${weightHomeCard()}
    `;
}

// ================= PESO CORPOREO E MISURE =================
// Peso: una pesata al giorno [{ date: 'AAAA-MM-GG', kg }]; misure: [{ date, vita, fianchi, ... }] in cm.
let weightRange = 90;
let bodyTab = 'weight';
let measureSel = 'vita';

/** Colore di una variazione in base all'obiettivo (verde = verso l'obiettivo). */
function weightTone(d) {
    const goal = state.weightGoal;
    if (Math.abs(d) < 0.05) return 'text-muted';
    if (goal === 'lose') return d < 0 ? 'text-emerald-500' : 'text-rose-500';
    if (goal === 'gain') return d > 0 ? 'text-emerald-500' : 'text-rose-500';
    if (goal === 'keep') return Math.abs(d) <= 0.5 ? 'text-emerald-500' : 'text-amber-500';
    return 'text-ink';
}

function deltaBadge(d, unit, tone = weightTone(d)) {
    const icon = Math.abs(d) < 0.05 ? 'fa-equals' : d > 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';
    return `<span class="${tone}"><i class="fa-solid ${icon} mr-1"></i>${d > 0 ? '+' : d < 0 ? '−' : ''}${fmt(Math.abs(d))} ${unit}</span>`;
}
const weightDeltaBadge = (d) => deltaBadge(d, 'kg');
const measureTone = (m, d) => (m.trend ? weightTone(d) : 'text-ink');

const fmtDayLong = (k) => keyToDate(k).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtDayShort = (k) => keyToDate(k).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
const rangeStart = () => (weightRange ? dayKey(new Date(Date.now() - weightRange * 86400000)) : '');

function setBodyTab(t) { bodyTab = t; render(); }
function setWeightRange(r) { weightRange = r; render(); }
function setWeightGoal(g) { state.weightGoal = state.weightGoal === g ? 'none' : g; persist(); render(); }

// ---- Peso ----
async function saveWeight() {
    const kgEl = $('weightKg');
    const kg = parseNum(kgEl.value);
    const date = $('weightDate').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > dayKey(new Date())) { shake($('weightDate')); return; }
    if (!(kg >= 20 && kg <= 400)) { shake(kgEl); return; }
    const exists = state.weights.some((w) => w.date === date);
    state.weights = state.weights.filter((w) => w.date !== date);
    state.weights.push({ date, kg: Math.round(kg * 10) / 10 });
    state.weights.sort((a, b) => a.date.localeCompare(b.date));
    persist();
    kgEl.value = '';
    kgEl.blur();
    toast(exists ? 'Pesata aggiornata' : 'Peso salvato');
    render();
}

function editWeight(date) {
    const w = state.weights.find((x) => x.date === date);
    if (!w) return;
    $('weightDate').value = w.date;
    $('weightKg').value = String(w.kg).replace('.', ',');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('weightKg').focus({ preventScroll: true });
}

async function deleteWeight(date) {
    const w = state.weights.find((x) => x.date === date);
    if (!w) return;
    if (!(await confirmDialog('Eliminare la pesata?', `${fmtDayLong(date)}: ${fmt(w.kg)} kg`))) return;
    state.weights = state.weights.filter((x) => x.date !== date);
    persist(); render();
}

// ---- Grafici ----
/** Grafico a linea generico: points [{ date, v }], con media mobile a 7 giorni opzionale. */
function lineChartSvg(points, { avg = true, empty = 'Nessun dato in questo periodo.' } = {}) {
    if (points.length < 2) {
        return `<p class="text-sm text-muted text-center py-8">${points.length ? 'Aggiungi almeno un altro valore per vedere il grafico.' : empty}</p>`;
    }
    const W = 320, H = 170, L = 34, R = 8, T = 10, B = 24;
    const t0 = keyToDate(points[0].date).getTime();
    const t1 = keyToDate(points[points.length - 1].date).getTime();
    const vals = points.map((p) => p.v);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = Math.max(0.5, (hi - lo) * 0.15);
    lo -= pad; hi += pad;
    const x = (d) => L + ((keyToDate(d).getTime() - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const path = (arr) => arr.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const line = path(points);
    const area = `${line} L${x(points[points.length - 1].date).toFixed(1)},${H - B} L${x(points[0].date).toFixed(1)},${H - B} Z`;
    const showAvg = avg && points.length >= 3;
    const avgPts = showAvg ? points.map((p) => {
        const end = keyToDate(p.date).getTime();
        const win = points.filter((q) => { const t = keyToDate(q.date).getTime(); return t <= end && t > end - 7 * 86400000; });
        return { date: p.date, v: win.reduce((a, q) => a + q.v, 0) / win.length };
    }) : [];
    const grid = [0, 0.5, 1].map((f) => {
        const v = lo + (hi - lo) * (1 - f);
        const yy = T + f * (H - T - B);
        return `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="stroke-line" stroke-width="1"/><text x="${L - 5}" y="${yy + 3.5}" text-anchor="end" class="fill-muted" font-size="10" font-weight="700">${fmt(v)}</text>`;
    }).join('');
    const dots = points.length <= 40 ? points.map((p) => `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3" class="fill-surface stroke-accent" stroke-width="2"/>`).join('') : '';
    return `
        <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img" aria-label="Grafico">
            <defs><linearGradient id="lGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(var(--c-accent))" stop-opacity=".25"/><stop offset="1" stop-color="rgb(var(--c-accent))" stop-opacity="0"/></linearGradient></defs>
            ${grid}
            <path d="${area}" fill="url(#lGrad)"/>
            ${showAvg ? `<path d="${path(avgPts)}" fill="none" class="stroke-muted" stroke-width="1.5" stroke-dasharray="4 4" opacity=".7"/>` : ''}
            <path d="${line}" fill="none" class="stroke-accent" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
            ${dots}
            <text x="${L}" y="${H - 6}" class="fill-muted" font-size="10" font-weight="700">${fmtDayShort(points[0].date)}</text>
            <text x="${W - R}" y="${H - 6}" text-anchor="end" class="fill-muted" font-size="10" font-weight="700">${fmtDayShort(points[points.length - 1].date)}</text>
        </svg>
        ${showAvg ? '<p class="text-[11px] text-muted font-semibold mt-1 flex items-center gap-3"><span class="flex items-center gap-1"><span class="w-4 h-0.5 bg-accent rounded"></span> Valore</span><span class="flex items-center gap-1"><span class="w-4 border-t-2 border-dashed border-muted"></span> Media 7 giorni</span></p>' : ''}`;
}

/** Calorie di un giorno: quelle registrate quel giorno, altrimenti stimate dalla dieta settimanale. */
function kcalForDay(k) {
    if (state.kcalLog[k] !== undefined) return { kcal: state.kcalLog[k], est: false };
    if (k > dayKey(new Date())) return null;
    const kcal = Math.round(dayNutrients((keyToDate(k).getDay() + 6) % 7).kcal);
    return kcal > 0 ? { kcal, est: true } : null;
}

function kcalWeightChartSvg() {
    const today = dayKey(new Date());
    // parte dal primo dato disponibile (pesata o calorie registrate), non prima
    const firstData = [state.weights[0] && state.weights[0].date, Object.keys(state.kcalLog).sort()[0]].filter(Boolean).sort()[0]
        || dayKey(new Date(Date.now() - 14 * 86400000));
    let start = rangeStart();
    if (!start || start < firstData) start = firstData;
    const minStart = dayKey(new Date(Date.now() - 365 * 86400000));
    if (start < minStart) start = minStart;
    const days = [];
    for (let d = keyToDate(start); dayKey(d) <= today; d.setDate(d.getDate() + 1)) days.push(dayKey(d));
    const kc = days.map((k) => ({ k, ...(kcalForDay(k) || { kcal: 0, est: true }) }));
    const weights = state.weights.filter((w) => w.date >= start && w.date <= today);
    const withKcal = kc.filter((d) => d.kcal > 0);
    if (!withKcal.length && weights.length < 2) {
        return '<p class="text-sm text-muted text-center py-8">Inserisci la dieta e qualche pesata per vedere come le calorie influenzano il peso.</p>';
    }
    const W = 320, H = 190, L = 34, R = 38, T = 10, B = 24;
    const n = days.length;
    const slot = (W - L - R) / n;
    const maxK = Math.max(1000, ...kc.map((d) => d.kcal)) * 1.1;
    const yk = (v) => T + (1 - v / maxK) * (H - T - B);
    const bars = kc.map((d, i) => d.kcal > 0
        ? `<rect x="${(L + i * slot + slot * 0.15).toFixed(2)}" y="${yk(d.kcal).toFixed(1)}" width="${Math.max(0.8, slot * 0.7).toFixed(2)}" height="${(H - B - yk(d.kcal)).toFixed(1)}" rx="${Math.min(2, slot * 0.2).toFixed(1)}" class="fill-emerald-500" opacity="${d.est ? 0.22 : 0.6}"/>`
        : '').join('');
    let wline = '', wlabels = '';
    if (weights.length) {
        let lo = Math.min(...weights.map((w) => w.kg)), hi = Math.max(...weights.map((w) => w.kg));
        const pad = Math.max(0.5, (hi - lo) * 0.2);
        lo -= pad; hi += pad;
        const yw = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
        const xw = (k) => L + (days.indexOf(k) + 0.5) * slot;
        wline = `<path d="${weights.map((w, i) => `${i ? 'L' : 'M'}${xw(w.date).toFixed(1)},${yw(w.kg).toFixed(1)}`).join(' ')}" fill="none" class="stroke-accent" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` +
            (weights.length <= 40 ? weights.map((w) => `<circle cx="${xw(w.date).toFixed(1)}" cy="${yw(w.kg).toFixed(1)}" r="2.8" class="fill-surface stroke-accent" stroke-width="2"/>`).join('') : '');
        wlabels = [0, 1].map((f) => `<text x="${L - 5}" y="${(T + f * (H - T - B) + 3.5).toFixed(1)}" text-anchor="end" class="fill-accent" font-size="10" font-weight="700">${fmt(hi - (hi - lo) * f)}</text>`).join('');
    }
    const klabels = [0, 0.5].map((f) => `<text x="${W - R + 5}" y="${(T + f * (H - T - B) + 3.5).toFixed(1)}" class="fill-emerald-500" font-size="10" font-weight="700">${fmt(Math.round(maxK * (1 - f) / 10) * 10, 0)}</text>`).join('');
    const avgK = withKcal.length ? Math.round(withKcal.reduce((a, d) => a + d.kcal, 0) / withKcal.length) : 0;
    const dW = weights.length >= 2 ? weights[weights.length - 1].kg - weights[0].kg : null;
    const est = withKcal.some((d) => d.est);
    return `
        <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img" aria-label="Grafico peso e calorie">
            <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="stroke-line" stroke-width="1"/>
            <line x1="${L}" x2="${W - R}" y1="${T}" y2="${T}" class="stroke-line" stroke-width="1" stroke-dasharray="2 4"/>
            ${bars}
            ${wline}
            ${wlabels}
            ${klabels}
            <text x="${L}" y="${H - 6}" class="fill-muted" font-size="10" font-weight="700">${fmtDayShort(days[0])}</text>
            <text x="${W - R}" y="${H - 6}" text-anchor="end" class="fill-muted" font-size="10" font-weight="700">${fmtDayShort(days[n - 1])}</text>
        </svg>
        <div class="grid grid-cols-2 gap-2 mt-2">
            <div class="bg-inset border border-line rounded-xl py-2 text-center">
                <p class="text-base font-extrabold text-emerald-500 leading-none">${avgK ? fmt(avgK, 0) : '—'}</p>
                <p class="text-[10px] font-bold uppercase tracking-wider text-muted mt-1">Media kcal/giorno</p>
            </div>
            <div class="bg-inset border border-line rounded-xl py-2 text-center">
                <p class="text-base font-extrabold leading-none">${dW === null ? '—' : weightDeltaBadge(dW)}</p>
                <p class="text-[10px] font-bold uppercase tracking-wider text-muted mt-1">Peso nel periodo</p>
            </div>
        </div>
        ${est ? '<p class="text-[11px] text-muted mt-2 ml-1"><span class="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500/25 align-middle mr-1"></span>Barre chiare: stimate dalla dieta settimanale (giorni in cui l\'app non aveva ancora registrato le calorie).</p>' : ''}`;
}

// ---- Misure ----
const lastMeasure = (k) => { for (let i = state.measures.length - 1; i >= 0; i--) if (state.measures[i][k]) return state.measures[i][k]; return null; };

function renderMeasureInputs() {
    $('measureInputs').innerHTML = MEASURES.map((m) => {
        const last = lastMeasure(m.k);
        return `
            <div>
                <label for="m-${m.k}" class="block text-[11px] font-bold text-muted mb-1 ml-1">${m.label}</label>
                <div class="relative">
                    <input type="text" inputmode="decimal" id="m-${m.k}" placeholder="${last ? fmt(last) : '—'}" class="field text-center !pr-9">
                    <span class="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-xs font-bold pointer-events-none">cm</span>
                </div>
            </div>`;
    }).join('');
}

async function saveMeasures() {
    const date = $('measureDate').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > dayKey(new Date())) { shake($('measureDate')); return; }
    const vals = {};
    for (const m of MEASURES) {
        const el = $(`m-${m.k}`);
        if (!el.value.trim()) continue;
        const v = parseNum(el.value);
        if (!(v >= 10 && v <= 300)) { shake(el); return; }
        vals[m.k] = Math.round(v * 10) / 10;
    }
    if (!Object.keys(vals).length) { toast('Inserisci almeno una misura', 'fa-triangle-exclamation'); shake($('measureInputs')); return; }
    const old = state.measures.find((x) => x.date === date);
    state.measures = state.measures.filter((x) => x.date !== date);
    state.measures.push({ ...(old || {}), date, ...vals });
    state.measures.sort((a, b) => a.date.localeCompare(b.date));
    if (!state.measures.some((x) => x[measureSel])) measureSel = Object.keys(vals)[0];
    persist();
    toast(old ? 'Misure aggiornate' : 'Misure salvate');
    render();
}

function editMeasures(date) {
    const e = state.measures.find((x) => x.date === date);
    if (!e) return;
    $('measureDate').value = e.date;
    MEASURES.forEach((m) => { $(`m-${m.k}`).value = e[m.k] ? String(e[m.k]).replace('.', ',') : ''; });
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteMeasures(date) {
    if (!(await confirmDialog('Eliminare le misure?', `Tutte le misure del ${fmtDayLong(date)} verranno eliminate.`))) return;
    state.measures = state.measures.filter((x) => x.date !== date);
    persist(); render();
}

function setMeasureSel(k) { measureSel = k; render(); }

function renderMeasures() {
    if (!$('measureDate').value) $('measureDate').value = dayKey(new Date());
    $('measureDate').max = dayKey(new Date());
    renderMeasureInputs();
    const list = state.measures;

    // riepilogo: ultimo valore e variazione dalla prima misura
    $('measureStats').innerHTML = MEASURES.map((m) => {
        const series = list.filter((x) => x[m.k]);
        if (!series.length) return '';
        const last = series[series.length - 1][m.k];
        const d = series.length > 1 ? last - series[0][m.k] : null;
        return `
            <button onclick="setMeasureSel('${m.k}')" class="card py-3 px-1 text-center active:scale-95 transition ${measureSel === m.k ? '!border-accent/60 ring-2 ring-accent/20' : ''}">
                <p class="text-lg font-extrabold leading-none">${fmt(last)}<span class="text-[10px] text-muted"> cm</span></p>
                <p class="text-[10px] font-bold uppercase tracking-wider text-muted mt-1.5">${m.label}</p>
                <p class="text-[10px] font-bold mt-0.5">${d === null ? '<span class="text-muted">—</span>' : deltaBadge(d, 'cm', measureTone(m, d))}</p>
            </button>`;
    }).join('');

    $('measureChips').innerHTML = MEASURES.map((m) => `
        <button type="button" onclick="setMeasureSel('${m.k}')" class="shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border transition ${measureSel === m.k ? 'bg-ink text-bg border-ink' : 'bg-inset text-muted border-line'}">${m.label}</button>`).join('');
    const sel = MEASURES.find((m) => m.k === measureSel) || MEASURES[0];
    $('measureChart').innerHTML = lineChartSvg(list.filter((x) => x[sel.k]).map((x) => ({ date: x.date, v: x[sel.k] })), { avg: false, empty: `Nessuna misura di ${sel.label.toLowerCase()} ancora.` });

    if (!list.length) {
        $('measureList').innerHTML = '<div class="card border-dashed p-6 text-center text-sm text-muted">Nessuna misura. Prendi le misure con un metro da sarta e inseriscile qui sopra.</div>';
        return;
    }
    $('measureList').innerHTML = [...list].reverse().map((e) => {
        const chips = MEASURES.filter((m) => e[m.k]).map((m) => {
            const prev = [...list].reverse().find((x) => x.date < e.date && x[m.k]);
            const d = prev ? e[m.k] - prev[m.k] : null;
            return `<span class="chip !font-sans">${m.label} <b class="font-mono">${fmt(e[m.k])}</b>${d !== null && Math.abs(d) >= 0.05 ? `<span class="text-[10px] ${measureTone(m, d)}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</span>` : ''}</span>`;
        }).join('');
        return `
            <div class="card !rounded-2xl flex items-start gap-3 px-4 py-3">
                <button onclick="editMeasures('${e.date}')" class="flex-1 min-w-0 text-left">
                    <p class="text-sm font-bold capitalize mb-1.5">${esc(fmtDayLong(e.date))}</p>
                    <div class="flex flex-wrap gap-1">${chips}</div>
                </button>
                <button onclick="deleteMeasures('${e.date}')" class="w-8 h-8 -mr-1 rounded-full text-muted hover:text-rose-500 flex items-center justify-center shrink-0" aria-label="Elimina"><i class="fa-solid fa-xmark text-sm"></i></button>
            </div>`;
    }).join('');
}

// ---- Pagina ----
function renderWeight() {
    document.querySelectorAll('#bodyTabs .seg').forEach((b) => b.classList.toggle('active', b.dataset.tab === bodyTab));
    $('bodyWeight').classList.toggle('hidden', bodyTab !== 'weight');
    $('bodyMeasures').classList.toggle('hidden', bodyTab !== 'measures');
    if (bodyTab === 'measures') { renderMeasures(); return; }

    const all = state.weights;
    if (!$('weightDate').value) $('weightDate').value = dayKey(new Date());
    $('weightDate').max = dayKey(new Date());
    document.querySelectorAll('#weightRangeSeg .seg').forEach((b) => b.classList.toggle('active', Number(b.dataset.range) === weightRange));
    document.querySelectorAll('#weightGoalSeg .seg').forEach((b) => b.classList.toggle('active', b.dataset.goal === state.weightGoal));

    const last = all[all.length - 1];
    const prev = all[all.length - 2];
    const first = all[0];
    const stat = (value, label, sub) => `
        <div class="card py-3 px-1 text-center">
            <p class="text-xl font-extrabold leading-none">${value}</p>
            <p class="text-[10px] font-bold uppercase tracking-wider text-muted mt-1.5 leading-tight">${label}</p>
            ${sub ? `<p class="text-[10px] font-semibold text-muted mt-0.5">${sub}</p>` : ''}
        </div>`;
    $('weightStats').innerHTML = last
        ? stat(`${fmt(last.kg)}<span class="text-xs text-muted"> kg</span>`, 'Attuale', relDate(keyToDate(last.date).getTime())) +
          stat(prev ? `<span class="text-base">${weightDeltaBadge(last.kg - prev.kg)}</span>` : '—', 'Dall\'ultima', prev ? fmtDayShort(prev.date) : '') +
          stat(all.length > 1 ? `<span class="text-base">${weightDeltaBadge(last.kg - first.kg)}</span>` : '—', 'Dall\'inizio', all.length > 1 ? `${all.length} pesate` : '')
        : '';

    const from = rangeStart();
    $('weightChart').innerHTML = lineChartSvg(all.filter((w) => w.date >= from).map((w) => ({ date: w.date, v: w.kg })), { empty: 'Nessuna pesata in questo periodo.' });
    $('kcalWeightChart').innerHTML = kcalWeightChartSvg();

    if (!all.length) {
        $('weightList').innerHTML = '<div class="card border-dashed p-6 text-center text-sm text-muted">Nessuna pesata. Inserisci il peso di oggi qui sopra.</div>';
        return;
    }
    $('weightList').innerHTML = [...all].reverse().map((w, i, arr) => {
        const before = arr[i + 1];
        return `
            <div class="card !rounded-2xl flex items-center gap-3 px-4 py-3">
                <button onclick="editWeight('${w.date}')" class="flex-1 min-w-0 flex items-center gap-3 text-left">
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-bold capitalize">${esc(fmtDayLong(w.date))}</p>
                        <p class="text-xs font-bold mt-0.5">${before ? weightDeltaBadge(w.kg - before.kg) : '<span class="text-muted">Prima pesata</span>'}</p>
                    </div>
                    <p class="text-lg font-extrabold font-mono">${fmt(w.kg)}<span class="text-xs text-muted"> kg</span></p>
                </button>
                <button onclick="deleteWeight('${w.date}')" class="w-8 h-8 -mr-1 rounded-full text-muted hover:text-rose-500 flex items-center justify-center" aria-label="Elimina"><i class="fa-solid fa-xmark text-sm"></i></button>
            </div>`;
    }).join('');
}

// ---- Card dei progressi (immagine da condividere) ----
let progressBlob = null;

function progressData() {
    const from = rangeStart();
    const pts = state.weights.filter((w) => w.date >= from);
    if (pts.length < 2) return null;
    const a = pts[0], b = pts[pts.length - 1];
    const days = Math.round((keyToDate(b.date) - keyToDate(a.date)) / 86400000);
    const workouts = [...trainingDays().keys()].filter((k) => k >= a.date && k <= b.date).length;
    const vita = state.measures.filter((m) => m.vita && m.date >= a.date && m.date <= b.date);
    const kc = [];
    for (let d = keyToDate(a.date); dayKey(d) <= b.date; d.setDate(d.getDate() + 1)) { const x = kcalForDay(dayKey(d)); if (x && x.kcal > 0) kc.push(x.kcal); }
    return {
        pts, a, b, days,
        delta: b.kg - a.kg,
        workouts,
        vita: vita.length >= 2 ? vita[vita.length - 1].vita - vita[0].vita : null,
        avgKcal: kc.length ? Math.round(kc.reduce((s, v) => s + v, 0) / kc.length) : null
    };
}

const periodWords = (days) => {
    if (days < 14) return `in ${days} ${days === 1 ? 'giorno' : 'giorni'}`;
    if (days < 70) { const w = Math.round(days / 7); return `in ${w} settimane`; }
    const m = Math.round(days / 30); return `in ${m} ${m === 1 ? 'mese' : 'mesi'}`;
};

async function drawProgressCard(data) {
    const W = 1080, H = 1350;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    try { await Promise.all(['800 100px "Plus Jakarta Sans"', '700 40px "Plus Jakarta Sans"', '600 40px "Plus Jakarta Sans"'].map((f) => document.fonts.load(f))); } catch (e) { /* font di sistema */ }
    const F = (w, s) => `${w} ${s}px "Plus Jakarta Sans", system-ui, sans-serif`;
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };

    // sfondo
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#4f46e5'); g.addColorStop(1, '#7c3aed');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.arc(W - 60, 140, 260, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(80, H - 120, 200, 0, Math.PI * 2); ctx.fill();

    // intestazione
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = F(800, 34);
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('WORKOUT', 80, 120);
    ctx.textAlign = 'right';
    ctx.font = F(600, 32);
    ctx.fillText(`${fmtDayShort(data.a.date)} – ${fmtDayShort(data.b.date)} ${data.b.date.slice(0, 4)}`, W - 80, 120);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#fff';
    ctx.font = F(700, 56);
    ctx.fillText('I miei progressi', 80, 250);
    const d = data.delta;
    ctx.font = F(800, 190);
    ctx.fillText(`${d > 0 ? '+' : d < 0 ? '−' : ''}${fmt(Math.abs(d))} kg`, 72, 450);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = F(600, 42);
    ctx.fillText(`da ${fmt(data.a.kg)} a ${fmt(data.b.kg)} kg · ${periodWords(data.days)}`, 80, 530);

    // grafico
    const cx = 80, cy = 600, cw = W - 160, ch = 400;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    rr(cx, cy, cw, ch, 36); ctx.fill();
    const pts = data.pts;
    const t0 = keyToDate(pts[0].date).getTime(), t1 = keyToDate(pts[pts.length - 1].date).getTime();
    let lo = Math.min(...pts.map((p) => p.kg)), hi = Math.max(...pts.map((p) => p.kg));
    const pad = Math.max(0.4, (hi - lo) * 0.18); lo -= pad; hi += pad;
    const px = (p) => cx + 50 + ((keyToDate(p.date).getTime() - t0) / Math.max(1, t1 - t0)) * (cw - 100);
    const py = (p) => cy + 50 + (1 - (p.kg - lo) / (hi - lo)) * (ch - 100);
    const area = ctx.createLinearGradient(0, cy, 0, cy + ch);
    area.addColorStop(0, 'rgba(255,255,255,0.35)'); area.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(px(p), py(p)) : ctx.moveTo(px(p), py(p))));
    ctx.lineTo(px(pts[pts.length - 1]), cy + ch - 30); ctx.lineTo(px(pts[0]), cy + ch - 30); ctx.closePath();
    ctx.fillStyle = area; ctx.fill();
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(px(p), py(p)) : ctx.moveTo(px(p), py(p))));
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 9; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    [pts[0], pts[pts.length - 1]].forEach((p) => {
        ctx.beginPath(); ctx.arc(px(p), py(p), 16, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
        ctx.beginPath(); ctx.arc(px(p), py(p), 8, 0, Math.PI * 2); ctx.fillStyle = '#6d28d9'; ctx.fill();
    });

    // statistiche
    const stats = [['Allenamenti', String(data.workouts)]];
    if (data.vita !== null) stats.push(['Vita', `${data.vita > 0 ? '+' : data.vita < 0 ? '−' : ''}${fmt(Math.abs(data.vita))} cm`]);
    if (data.avgKcal) stats.push(['Media kcal', fmt(data.avgKcal, 0)]);
    if (stats.length < 3) stats.push(['Pesate', String(data.pts.length)]);
    const bw = (W - 160 - 2 * 24) / 3;
    stats.slice(0, 3).forEach(([label, value], i) => {
        const bx = 80 + i * (bw + 24), by = 1050;
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        rr(bx, by, bw, 170, 30); ctx.fill();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff'; ctx.font = F(800, 58);
        ctx.fillText(value, bx + bw / 2, by + 88);
        ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = F(700, 26);
        ctx.fillText(label.toUpperCase(), bx + bw / 2, by + 136);
        ctx.textAlign = 'left';
    });

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = F(600, 28);
    ctx.textAlign = 'center';
    ctx.fillText('Creato con Workout', W / 2, H - 50);
    return cv;
}

async function openProgressCard() {
    const data = progressData();
    if (!data) { toast('Servono almeno due pesate nel periodo scelto', 'fa-triangle-exclamation'); return; }
    progressBlob = null;
    $('progressPreview').innerHTML = '<i class="fa-solid fa-spinner fa-spin text-2xl"></i>';
    openModal('progressModal');
    const cv = await drawProgressCard(data);
    progressBlob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    $('progressPreview').innerHTML = `<img src="${cv.toDataURL('image/png')}" alt="Card dei progressi" class="w-full h-full object-contain">`;
}

function progressFile() {
    return new File([progressBlob], `progressi-${dayKey(new Date())}.png`, { type: 'image/png' });
}

function downloadProgressCard() {
    if (!progressBlob) return;
    const url = URL.createObjectURL(progressBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = progressFile().name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Immagine salvata');
}

async function shareProgressCard() {
    if (!progressBlob) return;
    const file = progressFile();
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'I miei progressi' }); } catch (e) { /* condivisione annullata */ }
    } else {
        downloadProgressCard();
        toast('Condivisione non supportata: immagine salvata', 'fa-download');
    }
}

// ================= ALLENAMENTO =================
// ---- Calendario allenamenti ----
// I giorni di allenamento si ricavano dai log delle sessioni (campo ts).
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const keyToDate = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const weekStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

/** Map giorno → Map(indice scheda → { name, items: [{ name, sets, ts }] }) */
function trainingDays() {
    const days = new Map();
    state.workouts.forEach((w, wi) => w.exercises.forEach((ex) => {
        const add = (h, which) => {
            if (!h.ts) return;
            const k = dayKey(new Date(h.ts));
            if (!days.has(k)) days.set(k, new Map());
            const dm = days.get(k);
            if (!dm.has(wi)) dm.set(wi, { name: w.name, items: [] });
            const name = which === 2 ? (ex.subName2 || 'Esercizio 2') : ex.type === 'superset' ? (ex.subName1 || ex.name) : ex.name;
            dm.get(wi).items.push({ name, sets: setsOf(h), ts: h.ts, which });
        };
        ex.history.forEach((h) => add(h, 1));
        ex.history2.forEach((h) => add(h, 2));
    }));
    return days;
}

function trainingStats(days) {
    const now = new Date();
    const thisWeek = dayKey(weekStart(now));
    const weeks = new Set([...days.keys()].map((k) => dayKey(weekStart(keyToDate(k)))));
    let weekCount = 0;
    days.forEach((_, k) => { if (dayKey(weekStart(keyToDate(k))) === thisWeek) weekCount++; });
    // settimane consecutive con almeno un allenamento (la settimana in corso non interrompe la serie finché non finisce)
    let streak = 0;
    const w = weekStart(now);
    if (!weeks.has(dayKey(w))) w.setDate(w.getDate() - 7);
    while (weeks.has(dayKey(w))) { streak++; w.setDate(w.getDate() - 7); }
    return { weekCount, streak };
}

function renderWeekStrip() {
    const days = trainingDays();
    const start = weekStart(new Date());
    const today = dayKey(new Date());
    const labels = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
    let count = 0;
    const cells = labels.map((l, i) => {
        const d = new Date(start); d.setDate(d.getDate() + i);
        const k = dayKey(d);
        const done = days.has(k);
        if (done) count++;
        return `
            <div class="flex flex-col items-center gap-1">
                <span class="text-[10px] font-bold text-muted">${l}</span>
                <span class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-extrabold ${done ? 'bg-brand text-white' : 'bg-inset text-muted'} ${k === today ? 'ring-2 ring-brand/50 ring-offset-2 ring-offset-surface' : ''}">${done ? '<i class="fa-solid fa-check text-[10px]"></i>' : d.getDate()}</span>
            </div>`;
    }).join('');
    $('weekStrip').innerHTML = `
        <button onclick="openCalendar()" class="card w-full p-4 text-left active:scale-[0.99] transition">
            <div class="flex items-center justify-between mb-3">
                <div>
                    <p class="font-extrabold text-sm">Questa settimana</p>
                    <p class="text-xs text-muted font-semibold">${count} ${count === 1 ? 'allenamento' : 'allenamenti'}</p>
                </div>
                <span class="text-xs font-bold text-brand flex items-center gap-1.5"><i class="fa-regular fa-calendar"></i> Calendario <i class="fa-solid fa-chevron-right text-[10px]"></i></span>
            </div>
            <div class="grid grid-cols-7">${cells}</div>
        </button>`;
}

const cal = { year: null, month: null, selected: null };

function openCalendar() {
    const now = new Date();
    cal.year = now.getFullYear();
    cal.month = now.getMonth();
    cal.selected = dayKey(now);
    go('calendar');
}

function shiftCalMonth(delta) {
    const d = new Date(cal.year, cal.month + delta, 1);
    cal.year = d.getFullYear();
    cal.month = d.getMonth();
    renderCalendar();
}

function selectCalDay(k) {
    cal.selected = k;
    renderCalendar();
}

function renderCalendar() {
    if (cal.year === null) { const n = new Date(); cal.year = n.getFullYear(); cal.month = n.getMonth(); cal.selected = dayKey(n); }
    const days = trainingDays();
    const { weekCount, streak } = trainingStats(days);
    const today = dayKey(new Date());
    const first = new Date(cal.year, cal.month, 1);
    const nDays = new Date(cal.year, cal.month + 1, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    let monthCount = 0;
    for (let d = 1; d <= nDays; d++) if (days.has(dayKey(new Date(cal.year, cal.month, d)))) monthCount++;

    const stat = (value, label) => `
        <div class="card py-3 text-center">
            <p class="text-2xl font-extrabold text-brand leading-none">${value}</p>
            <p class="text-[10px] font-bold uppercase tracking-wider text-muted mt-1.5 leading-tight">${label}</p>
        </div>`;
    $('calStats').innerHTML = stat(weekCount, 'Questa<br>settimana') + stat(monthCount, 'Nel mese<br>visualizzato') + stat(streak, 'Settimane<br>di fila');

    $('calMonthLabel').textContent = first.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    let cells = '<span></span>'.repeat(offset);
    for (let d = 1; d <= nDays; d++) {
        const k = dayKey(new Date(cal.year, cal.month, d));
        const done = days.has(k);
        const sel = k === cal.selected;
        const cls = done ? 'bg-brand text-white shadow-md shadow-brand/25' : k > today ? 'text-muted/50' : 'text-ink hover:bg-inset';
        cells += `
            <button onclick="selectCalDay('${k}')" class="aspect-square rounded-xl text-sm font-bold flex items-center justify-center transition active:scale-90 ${cls} ${k === today ? 'ring-2 ring-brand/50' : ''} ${sel ? 'ring-2 ring-offset-2 ring-offset-surface !ring-accent' : ''}">${d}</button>`;
    }
    $('calGrid').innerHTML = cells;

    const selDate = keyToDate(cal.selected);
    const title = selDate.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    const dm = days.get(cal.selected);
    if (!dm) {
        $('calDetail').innerHTML = `
            <div class="card border-dashed p-6 text-center">
                <p class="font-extrabold capitalize mb-1">${esc(title)}</p>
                <p class="text-sm text-muted">Nessun allenamento registrato in questo giorno.</p>
            </div>`;
        return;
    }
    $('calDetail').innerHTML = `
        <p class="font-extrabold capitalize mb-2 ml-1">${esc(title)}</p>
        <div class="space-y-3">${[...dm.entries()].map(([wi, g]) => `
            <article class="card p-4">
                <button onclick="go('workoutDay', { workoutDay: ${wi} })" class="w-full flex items-center gap-3 mb-3 text-left">
                    <div class="w-9 h-9 rounded-xl bg-brand/10 text-brand flex items-center justify-center font-extrabold text-sm shrink-0">${esc(String.fromCharCode(65 + (wi % 26)))}</div>
                    <div class="flex-1 min-w-0">
                        <h4 class="font-extrabold leading-tight truncate">${esc(g.name)}</h4>
                        <p class="text-xs text-muted font-semibold">${g.items.length} ${g.items.length === 1 ? 'esercizio registrato' : 'esercizi registrati'}</p>
                    </div>
                    <i class="fa-solid fa-chevron-right text-muted text-xs"></i>
                </button>
                <div class="bg-inset border border-line rounded-2xl px-3 py-1">
                    ${g.items.map((it) => `
                        <div class="py-2 border-b border-line/70 last:border-0">
                            <p class="text-sm font-bold ${it.which === 2 ? 'text-accent' : ''}">${esc(it.name)}</p>
                            <div class="mt-1.5">${setGrid(it.sets, { compact: true })}</div>
                        </div>`).join('')}
                </div>
            </article>`).join('')}
        </div>`;
}

function renderWorkoutGrid() {
    if (state.workouts.length) renderWeekStrip(); else $('weekStrip').innerHTML = '';
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

/**
 * Serie di un esercizio, senza "a capo" disordinati:
 * - scheda (compact=false): tabellina Serie | Kg | Reps, una riga per serie;
 * - sessioni e storico (compact=true): caselle uguali su un'unica riga, scorrevole col dito.
 */
function setGrid(sets, { best = null, compact = false } = {}) {
    const isBest = (s) => best !== null && parseNum(s.weight) === best;
    if (!compact) {
        const rows = sets.map((s, i) => {
            const w = fmtW(s.weight);
            return `
                <div class="grid grid-cols-[3.25rem_1fr_1fr] items-center px-3 py-1.5 ${isBest(s) ? 'bg-amber-500/10' : ''}">
                    <span class="text-xs font-extrabold text-muted">${i + 1}</span>
                    <span class="text-sm font-mono font-extrabold">${w ? `${esc(w)}<span class="text-[10px] text-muted font-bold ml-0.5">kg</span>` : '<span class="text-muted">—</span>'}</span>
                    <span class="text-sm font-mono font-extrabold">${esc(s.reps || '—')}<span class="text-[10px] text-muted font-bold ml-0.5">rip</span></span>
                </div>`;
        }).join('');
        return `
            <div class="rounded-xl border border-line overflow-hidden bg-surface">
                <div class="grid grid-cols-[3.25rem_1fr_1fr] px-3 py-1 bg-inset border-b border-line text-[10px] font-bold uppercase tracking-wider text-muted">
                    <span>Serie</span><span>Peso</span><span>Ripetizioni</span>
                </div>
                <div class="divide-y divide-line/70">${rows}</div>
            </div>`;
    }
    const cells = sets.map((s, i) => {
        const w = fmtW(s.weight);
        return `
            <div class="relative flex-1 shrink-0 min-w-[3.4rem] max-w-[5rem] rounded-xl border text-center py-1 ${isBest(s) ? 'bg-amber-500/10 border-amber-500/30' : 'bg-surface border-line'}">
                <p class="text-[9px] font-bold uppercase tracking-wider text-muted leading-none">S${i + 1}</p>
                <p class="text-xs font-mono font-extrabold leading-tight mt-0.5">${w ? `${esc(w)}<span class="text-[9px] text-muted ml-px">kg</span>` : `${esc(s.reps || '—')}<span class="text-[9px] text-muted ml-px">rip</span>`}</p>
                <p class="text-[11px] font-mono font-bold text-muted leading-none">${w ? `× ${esc(s.reps || '—')}` : '&nbsp;'}</p>
                ${isBest(s) ? '<i class="fa-solid fa-trophy text-amber-500 text-[8px] absolute top-1 right-1"></i>' : ''}
            </div>`;
    }).join('');
    return `<div class="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">${cells}</div>`;
}

/** Riepilogo compatto quando tutte le serie sono uguali: "8 REPS · 80 KG". */
function planHtml(plan) {
    const s = plan[0];
    return `<span class="chip">${esc(s.reps || '—')} <span class="text-muted text-[10px]">REPS</span></span>` +
        (fmtW(s.weight) ? `<span class="chip !bg-brand/10 !border-brand/20 !text-brand">${esc(fmtW(s.weight))} <span class="text-[10px]">KG</span></span>` : '');
}

/** Pianificazione di un esercizio: riga compatta se le serie sono uguali, altrimenti la griglia. */
function planBlock(plan, setsChip = '') {
    if (isUniform(plan)) return `<div class="flex flex-wrap items-center gap-1.5">${setsChip}${planHtml(plan)}</div>`;
    return `${setsChip ? `<div class="mb-1.5">${setsChip}</div>` : ''}${setGrid(plan)}`;
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
                <div class="mt-1.5">${setGrid(sets, { best, compact: true })}</div>
            </div>`;
    }).join('');
}

const openHistories = new Set();
// esercizi aperti (dettagli visibili); chiusi mostrano solo il nome
const openExercises = new Set();

function toggleExercise(key) {
    const open = !openExercises.has(key);
    if (open) openExercises.add(key); else openExercises.delete(key);
    const el = $('ex-' + key);
    if (!el) return;
    el.classList.toggle('open', open);
    const head = el.previousElementSibling;
    head.setAttribute('aria-expanded', open);
    head.querySelector('.ex-chevron').classList.toggle('rotate-180', open);
}

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
        const exOpen = openExercises.has(key);
        const setsChip = `<span class="chip">${esc(ex.sets)} <span class="text-muted text-[10px]">SERIE</span></span>`;

        const body = isSuper ? `
            <div class="mt-2 flex flex-wrap items-center gap-1.5">${setsChip}<span class="text-[11px] text-muted font-semibold">per entrambi gli esercizi</span></div>
            <div class="mt-2 space-y-1.5">
                <div class="bg-inset border border-line rounded-xl px-3 py-2">
                    <p class="text-xs font-bold text-brand truncate mb-1.5">1 · ${esc(ex.subName1 || ex.name)}</p>
                    ${planBlock(ex.plan1)}
                </div>
                <div class="bg-inset border border-line rounded-xl px-3 py-2">
                    <p class="text-xs font-bold text-accent truncate mb-1.5">2 · ${esc(ex.subName2 || ex.name2 || 'Esercizio 2')}</p>
                    ${planBlock(ex.plan2)}
                </div>
            </div>` : `
            <div class="mt-2">${planBlock(ex.plan1, setsChip)}</div>`;

        const last1 = ex.history[0];
        const last2 = isSuper ? ex.history2[0] : null;
        const lastRef = last1 || last2;
        const lastHtml = lastRef ? `
            <div class="mt-3">
                <p class="text-xs text-muted flex items-center gap-1.5"><i class="fa-solid fa-clock-rotate-left"></i> Ultima sessione · ${esc(lastRef.date || '')}</p>
                ${last1 ? `${isSuper ? `<p class="text-[10px] font-extrabold text-brand mt-1.5 mb-1">1 · ${esc(ex.subName1 || ex.name)}</p>` : `<div class="mt-1.5"></div>`}${setGrid(setsOf(last1), { compact: true })}` : ''}
                ${last2 ? `<p class="text-[10px] font-extrabold text-accent mt-1.5 mb-1">2 · ${esc(ex.subName2 || 'Esercizio 2')}</p>${setGrid(setsOf(last2), { compact: true })}` : ''}
            </div>` : '';

        const histHtml = !hasHist ? '' : isSuper ? `
            <div class="grid grid-cols-2 gap-2">
                <div class="bg-inset border border-line rounded-xl px-2 py-1"><p class="text-[10px] font-bold text-brand uppercase truncate pt-1">${esc(ex.subName1 || ex.name)}</p>${historyTable(ex.history, dIdx, eIdx, 1)}</div>
                <div class="bg-inset border border-line rounded-xl px-2 py-1"><p class="text-[10px] font-bold text-accent uppercase truncate pt-1">${esc(ex.subName2 || 'Es. 2')}</p>${historyTable(ex.history2, dIdx, eIdx, 2)}</div>
            </div>` : `<div class="bg-inset border border-line rounded-xl px-3 py-1">${historyTable(ex.history, dIdx, eIdx, 1)}</div>`;

        return `
            <article class="card">
                <button onclick="toggleExercise('${key}')" class="w-full flex items-center gap-3 p-4 text-left" aria-expanded="${exOpen}">
                    <div class="w-9 h-9 rounded-xl ${isSuper ? 'bg-accent/10 text-accent' : 'bg-brand/10 text-brand'} font-extrabold flex items-center justify-center text-sm shrink-0">${eIdx + 1}</div>
                    <div class="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                        <h4 class="font-extrabold text-base leading-tight break-words">${esc(ex.name)}</h4>
                        ${isSuper ? '<span class="text-[9px] font-extrabold uppercase tracking-wider bg-accent text-white px-2 py-0.5 rounded-full">Superset</span>' : ''}
                    </div>
                    <i class="ex-chevron fa-solid fa-chevron-down text-xs text-muted transition-transform duration-300 ${exOpen ? 'rotate-180' : ''}"></i>
                </button>
                <div id="ex-${key}" class="expander ${exOpen ? 'open' : ''}"><div><div class="px-4 pb-4 -mt-2">
                    ${body}
                    ${ex.desc ? `<p class="text-xs text-muted mt-3 italic border-l-2 border-brand/40 pl-2">${esc(ex.desc)}</p>` : ''}
                    ${lastHtml}
                    <div class="flex gap-2 mt-4">
                        <button onclick="promptLogSession(${eIdx})" class="flex-1 bg-brand text-white text-sm font-bold py-2.5 rounded-xl active:scale-[0.97] transition shadow-md shadow-brand/20"><i class="fa-solid fa-plus mr-1"></i> Log</button>
                        ${hasHist ? `<button onclick="toggleHistory('${key}')" class="flex-1 btn-soft text-sm py-2.5 !rounded-xl"><i class="fa-solid fa-chart-line"></i> Storico <i class="fa-solid fa-chevron-down text-[10px] transition ${open ? 'rotate-180' : ''}"></i></button>` : ''}
                        <button onclick="promptEditEx(${eIdx})" class="btn-soft w-10 !rounded-xl" aria-label="Modifica"><i class="fa-solid fa-pen text-xs"></i></button>
                        <button onclick="moveExercise(${eIdx}, -1)" class="btn-soft w-10 !rounded-xl ${eIdx === 0 ? 'opacity-30 pointer-events-none' : ''}" aria-label="Sposta su"><i class="fa-solid fa-arrow-up text-xs"></i></button>
                        <button onclick="moveExercise(${eIdx}, 1)" class="btn-soft w-10 !rounded-xl ${eIdx === n - 1 ? 'opacity-30 pointer-events-none' : ''}" aria-label="Sposta giù"><i class="fa-solid fa-arrow-down text-xs"></i></button>
                    </div>
                    ${hasHist ? `<div id="hist-${key}" class="expander ${open ? 'open' : ''}"><div><div class="pt-3"><p class="text-[10px] font-bold uppercase tracking-wider text-muted mb-1 ml-1">Storico · kg × ripetizioni</p>${histHtml}</div></div></div>` : ''}
                </div></div></div>
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
    // lo stato aperto/chiuso segue l'esercizio spostato
    [openHistories, openExercises].forEach((set) => {
        const a = `${nav.workoutDay}-${eIdx}`, b = `${nav.workoutDay}-${j}`;
        const ha = set.has(a), hb = set.has(b);
        set.delete(a); set.delete(b);
        if (ha) set.add(b);
        if (hb) set.add(a);
    });
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
        openExercises.add(`${nav.workoutDay}-${list.length - 1}`); // il nuovo esercizio si mostra aperto
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
    openHistories.clear(); openExercises.clear();
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
    openExercises.add(`${nav.workoutDay}-${loggingEx}`);
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
        const n = dayNutrients(i);
        const meals = state.weeklyDiet[day].length;
        const isToday = i === today;
        return `
            <button onclick="go('dietDay', { dietDay: ${i} })" class="card p-4 text-left active:scale-[0.97] transition relative overflow-hidden ${isToday ? '!border-emerald-500/50 ring-2 ring-emerald-500/20' : ''} ${i === 6 ? 'col-span-2' : ''}">
                <div class="flex items-center justify-between mb-1">
                    <h3 class="font-extrabold text-base">${day}</h3>
                    ${isToday ? '<span class="text-[9px] font-extrabold uppercase tracking-wider bg-emerald-500 text-white px-2 py-0.5 rounded-full">Oggi</span>' : ''}
                </div>
                <p class="text-xs text-muted font-semibold mb-2">${meals} ${meals === 1 ? 'pasto' : 'pasti'} · <b class="text-ink">${fmt(n.kcal, 0)} kcal</b></p>
                <div class="flex flex-wrap gap-1 text-[11px] font-extrabold font-mono">
                    ${NUTR.map(({ k, cat }) => `<span class="${MACRO[cat].bg} ${MACRO[cat].text} px-1.5 py-0.5 rounded-md">${MACRO[cat].short}${fmt(n[k], 0)}</span>`).join('')}
                </div>
            </button>`;
    }).join('');
}

function renderDietDay() {
    const dayIdx = nav.dietDay;
    const day = DAYS[dayIdx];
    const meals = state.weeklyDiet[day];
    $('dietDayTitle').textContent = day;
    $('dietDayMacros').innerHTML = nutritionSummary(dayNutrients(dayIdx));

    if (!meals.length) {
        $('mealList').innerHTML = `
            <div class="card border-dashed p-8 text-center">
                <i class="fa-solid fa-bowl-food text-3xl text-muted/50 mb-3"></i>
                <p class="text-sm text-muted">Nessun pasto inserito per questo giorno.</p>
            </div>`;
        return;
    }

    $('mealList').innerHTML = meals.map((meal, mIdx) => {
        const mm = sumNutrients([meal]);
        const items = meal.items.map((item, iIdx) => {
            const food = findFood(item.name);
            const n = itemNutrients(item);
            const style = MACRO[food ? food.category : item.category] || MACRO.Verdure;
            const detail = n ? nutrLine(n) : '<span class="text-muted">Alimento non più presente nel database</span>';
            return `
                <div class="flex items-center gap-2 py-2 border-b border-line/70 last:border-0">
                    <span class="w-1.5 self-stretch rounded-full ${style.bg.replace('/10', '')} opacity-70"></span>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-bold leading-tight break-words">${esc(item.name)}</p>
                        <p class="text-[11px] font-bold mt-0.5">${detail}</p>
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
                        <p class="text-[11px] mt-1 font-extrabold">${nutrLine(mm)}</p>
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

// ---- Copia giorno ----
const copyDay = { targets: new Set(), mode: 'replace' };

function promptCopyDay() {
    const src = nav.dietDay;
    const meals = currentMeals();
    if (!meals.length) { toast('Nessun pasto da copiare', 'fa-triangle-exclamation'); return; }
    copyDay.targets = new Set();
    $('copyDayTitle').textContent = `Copia ${DAYS[src]}`;
    const nItems = meals.reduce((a, m) => a + m.items.length, 0);
    $('copyDaySub').textContent = `${meals.length} ${meals.length === 1 ? 'pasto' : 'pasti'} · ${nItems} ${nItems === 1 ? 'alimento' : 'alimenti'}`;
    setCopyMode(copyDay.mode);
    openModal('copyDayModal');
}

function renderCopyDayList() {
    const src = nav.dietDay;
    $('copyDayList').innerHTML = DAYS.map((day, i) => {
        if (i === src) return '';
        const on = copyDay.targets.has(i);
        const n = state.weeklyDiet[day].length;
        return `
            <button type="button" onclick="toggleCopyDay(${i})" class="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl border transition ${on ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-inset border-line'}">
                <span class="w-6 h-6 rounded-lg flex items-center justify-center text-xs shrink-0 ${on ? 'bg-emerald-500 text-white' : 'border-2 border-line'}">${on ? '<i class="fa-solid fa-check"></i>' : ''}</span>
                <span class="flex-1 text-left font-bold text-sm">${day}</span>
                <span class="text-xs font-semibold ${n ? 'text-amber-500' : 'text-muted'}">${n ? `${n} ${n === 1 ? 'pasto' : 'pasti'}` : 'vuoto'}</span>
            </button>`;
    }).join('');
    const count = copyDay.targets.size;
    $('copyAllBtn').textContent = count === DAYS.length - 1 ? 'Deseleziona tutti' : 'Seleziona tutti';
    const btn = $('copyDaySubmit');
    btn.disabled = !count;
    btn.innerHTML = `<i class="fa-solid fa-copy"></i> ${count ? `Copia su ${count} ${count === 1 ? 'giorno' : 'giorni'}` : 'Scegli almeno un giorno'}`;
}

function toggleCopyDay(i) {
    if (copyDay.targets.has(i)) copyDay.targets.delete(i); else copyDay.targets.add(i);
    renderCopyDayList();
}

function toggleAllCopyDays() {
    const all = copyDay.targets.size === DAYS.length - 1;
    copyDay.targets = new Set(all ? [] : DAYS.map((_, i) => i).filter((i) => i !== nav.dietDay));
    renderCopyDayList();
}

function setCopyMode(mode) {
    copyDay.mode = mode;
    $('copyModeReplace').classList.toggle('active', mode === 'replace');
    $('copyModeAppend').classList.toggle('active', mode === 'append');
    $('copyModeHint').textContent = mode === 'replace'
        ? 'I pasti già presenti nei giorni scelti verranno eliminati e sostituiti.'
        : 'I pasti copiati verranno aggiunti dopo quelli già presenti.';
    renderCopyDayList();
}

async function confirmCopyDay() {
    const targets = [...copyDay.targets].sort();
    if (!targets.length) return;
    const src = currentMeals();
    const overwritten = targets.filter((i) => state.weeklyDiet[DAYS[i]].length);
    if (copyDay.mode === 'replace' && overwritten.length) {
        const names = overwritten.map((i) => DAYS[i]).join(', ');
        if (!(await confirmDialog('Sostituire i pasti?', `I pasti di ${names} verranno eliminati e sostituiti con quelli di ${DAYS[nav.dietDay]}.`, 'Sostituisci'))) return;
    }
    targets.forEach((i) => {
        const copy = JSON.parse(JSON.stringify(src));
        const day = DAYS[i];
        state.weeklyDiet[day] = copyDay.mode === 'replace' ? copy : [...state.weeklyDiet[day], ...copy];
    });
    persist();
    await closeModal('copyDayModal');
    toast(`Copiato su ${targets.length} ${targets.length === 1 ? 'giorno' : 'giorni'}`);
    render();
}

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
                <span class="text-[11px] font-bold text-muted shrink-0">${fmt(nutrientsOf(f, 100).kcal, 0)} kcal</span>
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
    if (f && g > 0) p.innerHTML = nutrLine(nutrientsOf(f, g));
    else if (f) p.innerHTML = `<span class="text-muted">Per 100 g:</span> ${nutrLine(nutrientsOf(f, 100))}`;
    else p.textContent = '';
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

// ---- Equivalenze tra alimenti (sostituzioni e convertitore) ----
/**
 * Alternative con la stessa quantità del macro principale (es. stesse proteine),
 * con tutti i valori e la differenza rispetto all'alimento di partenza.
 */
function equivalents(src, grams) {
    const key = MAIN_MACRO_KEY[src.category];
    const target = (src[key] * grams) / 100;
    const base = nutrientsOf(src, grams);
    return allFoods()
        .filter((f) => f.category === src.category && f.name !== src.name && f[key] > 0)
        .map((f) => {
            const g = Math.max(1, Math.round((target * 100) / f[key]));
            const n = nutrientsOf(f, g);
            return { name: f.name, grams: g, n, d: { c: n.c - base.c, p: n.p - base.p, f: n.f - base.f, kcal: n.kcal - base.kcal } };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

function signed(v, digits = 1) {
    if (Math.abs(v) < (digits ? 0.5 : 1)) return '=';
    return `${v > 0 ? '+' : '−'}${fmt(Math.abs(v), digits)}`;
}

/** Riga di un'alternativa: nome, grammi, valori completi e differenze. */
function equivRowHtml(a, onclick) {
    const diff = NUTR.map(({ k, cat }) => `<span class="${MACRO[cat].text}">${MACRO[cat].short} ${signed(a.d[k])}</span>`).join(' ') +
        ` <span class="${a.d.kcal > 1 ? 'text-rose-500' : a.d.kcal < -1 ? 'text-emerald-500' : 'text-muted'}">${signed(a.d.kcal, 0)} kcal</span>`;
    const tag = onclick ? 'button' : 'div';
    return `
        <${tag} ${onclick ? `onclick="${onclick}"` : ''} class="w-full text-left bg-inset border border-line px-3 py-2.5 rounded-xl ${onclick ? 'active:scale-[0.98] transition hover:border-accent/40' : ''}">
            <div class="flex justify-between items-center gap-2">
                <span class="font-bold text-sm">${esc(a.name)}</span>
                <span class="text-accent font-extrabold font-mono bg-accent/10 px-2.5 py-1 rounded-lg shrink-0">${fmt(a.grams, 0)}g</span>
            </div>
            <p class="text-[11px] font-bold mt-1">${nutrLine(a.n)}</p>
            <p class="text-[11px] font-bold mt-0.5 text-muted">Differenza: ${diff}</p>
        </${tag}>`;
}

function sourceBoxHtml(label, food, grams) {
    const s = MACRO[food.category];
    return `
        <div class="${s.bg} border ${s.border} p-4 rounded-2xl text-center">
            <p class="text-[10px] uppercase font-bold tracking-wider text-muted mb-1">${label}</p>
            <p class="text-lg font-extrabold leading-tight">${fmt(grams)}g di ${esc(food.name)}</p>
            <p class="text-xs mt-1.5 font-bold">${nutrLine(nutrientsOf(food, grams))}</p>
            <p class="text-[11px] mt-1 text-muted font-semibold">Le alternative hanno gli stessi grammi di <b class="${s.text}">${s.label.toLowerCase()}</b></p>
        </div>`;
}

// ---- Sostituzione alimento ----
const swap = { mIdx: null, iIdx: null, alts: [] };

function promptSwapFood(mIdx, iIdx) {
    const item = currentMeals()[mIdx].items[iIdx];
    const src = findFood(item.name);
    if (!src || !MAIN_MACRO_KEY[src.category] || !(src[MAIN_MACRO_KEY[src.category]] > 0)) {
        alertDialog('Nessuna alternativa', 'Le verdure si gestiscono liberamente: non hanno un macro principale da pareggiare.', 'fa-leaf');
        return;
    }
    swap.mIdx = mIdx;
    swap.iIdx = iIdx;
    swap.alts = equivalents(src, item.grams);
    $('swapInfo').innerHTML = sourceBoxHtml('Stai sostituendo', src, item.grams);
    $('swapSearch').value = '';
    renderSwapList();
    openModal('swapModal');
}

function renderSwapList() {
    const q = $('swapSearch').value.trim().toLowerCase();
    $('swapList').innerHTML = swap.alts.map((a, i) => (q && !a.name.toLowerCase().includes(q)) ? '' : equivRowHtml(a, `confirmSwapFood(${i})`)).join('') ||
        '<p class="text-sm text-muted text-center py-4">Nessuna alternativa trovata.</p>';
}

async function confirmSwapFood(i) {
    const a = swap.alts[i];
    const f = a && findFood(a.name);
    if (!f) return;
    currentMeals()[swap.mIdx].items[swap.iIdx] = { name: f.name, category: f.category, grams: a.grams };
    persist();
    await closeModal('swapModal');
    toast('Alimento sostituito');
    render();
}

// ================= CONVERSIONI / DB =================
let smartCat = '';
let smartFoods = [];
const smart = { alts: [], open: true };

function setSmartCat(cat) {
    smartCat = cat;
    document.querySelectorAll('#smartCatSeg .seg').forEach((b) => b.classList.toggle('active', b.dataset.cat === cat));
    updateSmartDropdown();
}

function updateSmartDropdown() {
    const sel = $('smartFood');
    const prev = sel.value !== '' ? smartFoods[sel.value]?.name : null;
    const key = MAIN_MACRO_KEY[smartCat];
    smartFoods = allFoods().filter((f) => f.category === smartCat && f[key] > 0).sort((a, b) => a.name.localeCompare(b.name, 'it'));
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
    smart.alts = equivalents(src, grams);
    smart.open = true;
    $('smartResult').innerHTML = `
        ${sourceBoxHtml('Punto di partenza', src, grams)}
        <div class="flex items-center gap-2 mt-3 mb-2">
            <div id="smartFilterBox" class="relative flex-1 min-w-0">
                <i class="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-muted text-xs"></i>
                <input type="search" id="smartFilter" placeholder="Filtra per prodotto…" autocomplete="off" class="field !py-2.5 !pl-9 !text-sm" oninput="renderSmartList()">
            </div>
            <button type="button" id="smartToggle" onclick="toggleSmartList()" class="btn-soft px-3.5 py-2.5 text-sm shrink-0"></button>
        </div>
        <div id="smartListBox" class="max-h-[60dvh] overflow-y-auto no-scrollbar rounded-2xl">
            <div id="smartList" class="space-y-1.5"></div>
        </div>`;
    $('smartResult').classList.remove('hidden');
    renderSmartList();
}

function renderSmartList() {
    const q = ($('smartFilter')?.value || '').trim().toLowerCase();
    const shown = smart.alts.filter((a) => !q || a.name.toLowerCase().includes(q));
    $('smartList').innerHTML = shown.map((a) => equivRowHtml(a)).join('') ||
        '<p class="text-sm text-muted text-center py-4">Nessun prodotto corrisponde al filtro.</p>';
    updateSmartToggle();
}

function updateSmartToggle() {
    $('smartListBox').classList.toggle('hidden', !smart.open);
    $('smartFilterBox').classList.toggle('invisible', !smart.open);
    $('smartToggle').innerHTML = smart.open
        ? '<i class="fa-solid fa-chevron-up"></i> Chiudi lista'
        : `<i class="fa-solid fa-chevron-down"></i> Mostra ${smart.alts.length} alternative`;
}

function toggleSmartList() {
    smart.open = !smart.open;
    updateSmartToggle();
    if (!smart.open) $('smartResult').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
            <button onclick="promptEditFood(${i})" class="w-full text-left flex items-center gap-3 bg-inset border border-line p-3 rounded-2xl active:scale-[0.99] transition">
                <span class="w-9 h-9 rounded-xl ${s.bg} ${s.text} font-extrabold text-sm flex items-center justify-center shrink-0">${s.short}</span>
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-sm truncate">${esc(f.name)}</p>
                    <p class="text-[11px] font-bold">${nutrLine(nutrientsOf(f, 100))} <span class="text-muted font-semibold">/100g</span></p>
                    ${f.partial ? '<p class="text-[11px] font-bold text-amber-500 mt-0.5"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Completa carboidrati, proteine e grassi</p>' : ''}
                </div>
                <i class="fa-solid fa-pen text-xs text-muted"></i>
            </button>`;
    }).join('');
}

// ---- Alimento personale: nuovo / modifica ----
let editingFood = null; // indice in state.foodDb, null = nuovo
let foodCatTouched = false;

function suggestFoodCategory(c, p, f) {
    const vals = { Carboidrati: c || 0, Proteine: p || 0, Grassi: f || 0 };
    const best = Object.keys(vals).reduce((a, k) => (vals[k] > vals[a] ? k : a), 'Carboidrati');
    return vals[best] < 5 ? 'Verdure' : best;
}

function readFoodForm() {
    const num = (id) => parseNum($(id).value);
    return { c: num('dbFoodC'), p: num('dbFoodP'), f: num('dbFoodF') };
}

function updateFoodFormPreview() {
    const v = readFoodForm();
    const n = { c: v.c || 0, p: v.p || 0, f: v.f || 0 };
    if (!foodCatTouched && [v.c, v.p, v.f].some(Number.isFinite)) $('dbFoodCat').value = suggestFoodCategory(n.c, n.p, n.f);
    $('dbFoodKcal').textContent = `${fmt(kcalOf(n), 0)} kcal per 100 g`;
}

function fillFoodForm(f) {
    $('dbFoodName').value = f ? f.name : '';
    const val = (v) => (f && !(f.partial && !v) ? String(v).replace('.', ',') : '');
    $('dbFoodC').value = val(f && f.c);
    $('dbFoodP').value = val(f && f.p);
    $('dbFoodF').value = val(f && f.f);
    $('dbFoodCat').value = f ? f.category : (smartCat || 'Carboidrati');
    foodCatTouched = !!f;
    updateFoodFormPreview();
}

function promptAddFood() {
    editingFood = null;
    $('addFoodTitle').textContent = 'Nuovo alimento';
    $('dbFoodDelete').classList.add('hidden');
    fillFoodForm(null);
    openModal('addFoodModal');
}

function promptEditFood(i) {
    editingFood = i;
    $('addFoodTitle').textContent = 'Modifica alimento';
    $('dbFoodDelete').classList.remove('hidden');
    fillFoodForm(state.foodDb[i]);
    openModal('addFoodModal');
}

async function saveDbFood() {
    const nameEl = $('dbFoodName');
    const name = nameEl.value.trim();
    const category = $('dbFoodCat').value;
    const v = readFoodForm();
    if (!name) { shake(nameEl); return; }
    for (const [k, id] of [['c', 'dbFoodC'], ['p', 'dbFoodP'], ['f', 'dbFoodF']]) {
        if ($(id).value.trim() === '') v[k] = 0;
        else if (!(v[k] >= 0) || v[k] > 100) { shake($(id)); return; }
    }
    if (v.c + v.p + v.f > 100.5) { toast('La somma dei macro supera 100 g', 'fa-triangle-exclamation'); shake($('dbFoodC')); return; }
    const key = MAIN_MACRO_KEY[category];
    if (key && !(v[key] > 0)) { toast(`Inserisci i grammi di ${MACRO[category].label.toLowerCase()}`, 'fa-triangle-exclamation'); shake($(`dbFood${key.toUpperCase()}`)); return; }
    const old = editingFood !== null ? state.foodDb[editingFood] : null;
    const clash = [...foodIndex.keys()].some((k) => k.toLowerCase() === name.toLowerCase() && (!old || k !== old.name));
    if (clash) { toast('Esiste già un alimento con questo nome', 'fa-triangle-exclamation'); shake(nameEl); return; }

    const food = { id: old ? old.id : Date.now().toString(36), name, category, c: v.c, p: v.p, f: v.f, macroValue: key ? v[key] : 0 };
    if (old) {
        state.foodDb[editingFood] = food;
        // i pasti fanno riferimento al nome: se cambia, aggiorna anche quelli
        if (old.name !== name) DAYS.forEach((d) => state.weeklyDiet[d].forEach((m) => m.items.forEach((it) => { if (it.name === old.name) it.name = name; })));
    } else {
        state.foodDb.push(food);
    }
    DAYS.forEach((d) => state.weeklyDiet[d].forEach((m) => m.items.forEach((it) => { if (it.name === name) it.category = category; })));
    rebuildFoodIndex();
    persist();
    await closeModal('addFoodModal');
    toast(old ? 'Alimento aggiornato' : 'Alimento salvato');
    render();
}

async function deleteDbFood() {
    const f = state.foodDb[editingFood];
    if (!f) return;
    if (!(await confirmDialog('Eliminare l\'alimento?', `"${f.name}" verrà rimosso dal tuo database. Nei pasti in cui è usato non verranno più calcolati i valori.`))) return;
    state.foodDb = state.foodDb.filter((x) => x !== f);
    rebuildFoodIndex();
    persist();
    await closeModal('addFoodModal');
    render();
}

// ================= IMPOSTAZIONI / BACKUP =================
function openSettings() {
    applyTheme();
    $('appVersion').textContent = `Workout v${APP_VERSION}`;
    renderInstallBox();
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
        if (!json || typeof json !== 'object' || !(json.weeklyDiet || json.workouts || json.foodDb || json.weights || json.measures)) {
            alertDialog('File non valido', 'Il file selezionato non è un backup di Workout.', 'fa-triangle-exclamation');
            return;
        }
        const data = normalizeData(json);
        const ok = await dialog({
            title: 'Importare il backup?',
            text: `${data.workouts.length} ${data.workouts.length === 1 ? 'scheda' : 'schede'}, ${data.foodDb.length} ${data.foodDb.length === 1 ? 'alimento personale' : 'alimenti personali'} e ${data.weights.length} ${data.weights.length === 1 ? 'pesata' : 'pesate'}. I dati attuali su questo dispositivo verranno sostituiti.`,
            confirm: 'Importa', cancel: 'Annulla', icon: 'fa-upload'
        });
        if (!ok) return;
        Object.assign(state, data);
        rebuildFoodIndex();
        persist();
        openHistories.clear(); openExercises.clear();
        await closeModal('settingsModal');
        toast('Dati importati');
        go('home');
    };
    reader.readAsText(file);
}

// ================= TIMER =================
const T = { mode: 'free', running: false, phase: 'idle', set: 0, sets: 0, cfg: null, endAt: 0, dur: 0, remaining: 0, startAt: 0, elapsed: 0, lastBeepSec: null, lastMinute: 0, warned: false, interval: null, wakeLock: null };

// ---- Suoni ----
// Catena audio: oscillatori → compressore (limita i picchi, così si può alzare molto il volume) → volume generale.
let audioCtx = null;
let masterGain = null;

function unlockAudio() {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const comp = audioCtx.createDynamicsCompressor();
            comp.threshold.value = -12;
            comp.knee.value = 6;
            comp.ratio.value = 12;
            comp.attack.value = 0.002;
            comp.release.value = 0.1;
            masterGain = audioCtx.createGain();
            comp.connect(masterGain).connect(audioCtx.destination);
            audioCtx.compIn = comp;
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        applyVolume();
    } catch (e) { audioCtx = null; }
    unlockVoice();
}

/** Volume 0–100 → guadagno fino a 2.5 (il compressore evita la distorsione). */
function applyVolume() {
    if (masterGain) masterGain.gain.value = (settings.volume / 100) * 2.5;
}

/** Beep deciso: onda quadra + sinusoide all'ottava, con attacco rapido. */
function beep(freq = 880, dur = 0.15, level = 1) {
    if (!audioCtx || !settings.sound || settings.volume <= 0) return;
    try {
        const t0 = audioCtx.currentTime;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.9 * level, t0 + 0.006);
        g.gain.setValueAtTime(0.9 * level, t0 + Math.max(0.01, dur - 0.05));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        g.connect(audioCtx.compIn);
        [['square', freq, 0.55], ['sine', freq * 2, 0.45]].forEach(([type, f, v]) => {
            const o = audioCtx.createOscillator();
            const og = audioCtx.createGain();
            o.type = type;
            o.frequency.value = f;
            og.gain.value = v;
            o.connect(og).connect(g);
            o.start(t0);
            o.stop(t0 + dur + 0.02);
        });
    } catch (e) { /* audio non disponibile */ }
}

// ---- Voce ----
let itVoice = null;
function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const voices = speechSynthesis.getVoices();
    itVoice = voices.find((v) => /^it[-_]IT/i.test(v.lang) && /google|natural|premium|enhanced/i.test(v.name)) ||
        voices.find((v) => /^it/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) {
    pickVoice();
    speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

let voiceUnlocked = false;
function unlockVoice() {
    // iPhone: la sintesi vocale parte solo se attivata da un tocco dell'utente
    if (voiceUnlocked || !('speechSynthesis' in window)) return;
    voiceUnlocked = true;
    try { const u = new SpeechSynthesisUtterance(''); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* ignora */ }
}

function speak(text, { interrupt = true, delay = 0 } = {}) {
    if (!settings.voice || !('speechSynthesis' in window)) return;
    const go = () => {
        try {
            if (interrupt) speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text);
            u.lang = 'it-IT';
            if (itVoice) u.voice = itVoice;
            u.rate = 1.05;
            u.volume = Math.min(1, Math.max(0.2, settings.volume / 100));
            speechSynthesis.speak(u);
        } catch (e) { /* voce non disponibile */ }
    };
    if (delay) setTimeout(go, delay); else go();
}

const COUNT_WORDS = { 1: 'Uno', 2: 'Due', 3: 'Tre' };
const durWords = (s) => {
    const m = Math.floor(s / 60), r = s % 60;
    if (!m) return `${r} secondi`;
    return `${m} ${m === 1 ? 'minuto' : 'minuti'}${r ? ` e ${r}` : ''}`;
};

// ---- Controlli audio (pannello del timer) ----
function renderAudioControls() {
    const on = 'bg-brand text-white shadow-md shadow-brand/25';
    const off = 'bg-surface border border-line text-muted';
    const sBtn = $('tSoundBtn');
    sBtn.className = `w-10 h-10 rounded-xl flex items-center justify-center shrink-0 active:scale-90 transition ${settings.sound ? on : off}`;
    sBtn.innerHTML = `<i class="fa-solid ${settings.sound ? 'fa-volume-high' : 'fa-volume-xmark'}"></i>`;
    const vBtn = $('tVoiceBtn');
    vBtn.className = `w-10 h-10 rounded-xl flex items-center justify-center shrink-0 active:scale-90 transition ${settings.voice ? on : off}`;
    vBtn.innerHTML = `<i class="fa-solid ${settings.voice ? 'fa-microphone' : 'fa-microphone-slash'}"></i>`;
    $('tVolume').value = settings.volume;
    $('tVolumeLabel').textContent = `${settings.volume}%`;
    $('tVoiceHint').textContent = !('speechSynthesis' in window)
        ? 'Non supportata da questo browser'
        : settings.voice ? 'Conto alla rovescia e annuncio di ogni fase' : 'Disattivata';
}

function toggleTimerSound() {
    settings.sound = !settings.sound;
    saveSettings();
    renderAudioControls();
    if (settings.sound) testTimerSound();
}

function toggleTimerVoice() {
    settings.voice = !settings.voice;
    saveSettings();
    renderAudioControls();
    unlockAudio();
    if (settings.voice) speak('Voce attivata');
}

function setTimerVolume(v) {
    settings.volume = Math.max(0, Math.min(100, parseInt(v, 10) || 0));
    saveSettings();
    applyVolume();
    $('tVolumeLabel').textContent = `${settings.volume}%`;
}

function testTimerSound() {
    unlockAudio();
    beep(1046, 0.25);
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
    T.warned = false;
    const late = Date.now() - from > 1500; // transizione recuperata dopo il background: niente suoni in ritardo
    if (late) return;
    if (phase === 'work') {
        beep(1046, 0.35); vibrate(200);
        speak(T.set === 1 && T.sets > 1 ? `Si parte! Serie 1 di ${T.sets}` : T.set === T.sets && T.sets > 1 ? 'Ultima serie, via!' : `Serie ${T.set} di ${T.sets}, via!`, { delay: 250 });
    } else {
        beep(523, 0.6); vibrate([100, 80, 100]);
        speak(`Recupero, ${durWords(secs)}`, { delay: 350 });
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
    beep(784, 0.22); setTimeout(() => beep(988, 0.22), 240); setTimeout(() => beep(1318, 0.6), 480);
    vibrate([200, 100, 200, 100, 400]);
    speak('Allenamento completato, ottimo lavoro!', { delay: 1100 });
    updateTimerUI();
}

function timerTick() {
    if (!T.running) return;
    const now = Date.now();
    if (T.mode === 'interval') {
        while (T.running && now >= T.endAt) advancePhase(T.endAt);
        if (!T.running) return;
        const secLeft = Math.ceil((T.endAt - now) / 1000);
        // avviso che la fase sta per finire (solo se c'è tempo di dirlo prima del conto alla rovescia)
        if (!T.warned && secLeft === 5 && T.dur >= 9000) {
            T.warned = true;
            const lastWork = T.phase === 'work' && T.set >= T.sets;
            speak(T.phase === 'work' ? (lastWork ? 'Ultimi secondi, stai finendo!' : 'Sta finendo la serie') : 'Sta finendo il recupero, preparati');
        }
        if (secLeft <= 3 && secLeft >= 1 && T.lastBeepSec !== secLeft) {
            T.lastBeepSec = secLeft;
            beep(660, 0.12, 0.8);
            speak(COUNT_WORDS[secLeft]);
        }
    } else {
        // cronometro libero: segnale a ogni minuto intero
        const min = Math.floor((now - T.startAt) / 60000);
        if (min > T.lastMinute) {
            T.lastMinute = min;
            beep(880, 0.18); setTimeout(() => beep(880, 0.18), 260);
            speak(min === 1 ? 'Un minuto' : `${min} minuti`, { delay: 550 });
        }
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
        if ('speechSynthesis' in window) speechSynthesis.cancel();
        updateTimerUI();
        return;
    }
    const now = Date.now();
    if (T.mode === 'free') {
        T.startAt = now - T.elapsed * 1000;
        T.lastMinute = Math.floor(T.elapsed / 60);
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
    Object.assign(T, { running: false, phase: 'idle', set: 0, elapsed: 0, remaining: 0, startAt: 0, endAt: 0, lastMinute: 0, warned: false });
    releaseWakeLock();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
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

// ================= INSTALLAZIONE APP =================
// Su Android l'icona senza logo si ottiene solo con l'installazione vera di Chrome ("Installa app").
// "Aggiungi a schermata Home" dal browser dell'app Google (o di Facebook, Instagram…) crea invece
// un semplice collegamento con il logo del browser sopra l'icona.
let installPrompt = null;
const UA = navigator.userAgent;
const IS_ANDROID = /Android/i.test(UA);
const IS_IOS = /iPhone|iPad|iPod/i.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_IN_APP_BROWSER = /GSA\/|FBAN|FBAV|Instagram|Line\/|MicroMessenger|; wv\)/i.test(UA);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    refreshInstallUI();
});
window.addEventListener('appinstalled', () => {
    installPrompt = null;
    toast('App installata');
    refreshInstallUI();
});

function installState() {
    if (isStandalone()) return 'installed';
    if (installPrompt) return 'ready';
    if (IS_ANDROID && IS_IN_APP_BROWSER) return 'inapp';
    if (IS_IOS) return 'ios';
    if (IS_ANDROID) return 'android';
    return 'other';
}

const chromeIntentUrl = () => `intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;end`;

async function installApp() {
    const st = installState();
    if (st === 'ready') {
        const p = installPrompt;
        installPrompt = null;
        p.prompt();
        try { await p.userChoice; } catch (e) { /* finestra chiusa */ }
        refreshInstallUI();
        return;
    }
    if (st === 'inapp') { location.href = chromeIntentUrl(); return; }
    const texts = {
        ios: 'In Safari tocca il pulsante Condividi (il quadrato con la freccia) e scegli «Aggiungi alla schermata Home».',
        android: 'Apri il sito in Chrome, tocca il menu ⋮ e scegli «Installa app». Se trovi solo «Aggiungi a schermata Home», l\'app probabilmente è già installata: cercala tra le app. Se sulla Home hai una vecchia icona con il logo, tienila premuta, rimuovila e reinstalla.',
        other: 'Apri il sito con Chrome o Edge e usa il pulsante di installazione nella barra degli indirizzi o nel menu.'
    };
    alertDialog('Come installare l\'app', texts[st] || texts.other, 'fa-mobile-screen');
}

function dismissInstallCard() {
    settings.installCardHidden = true;
    saveSettings();
    refreshInstallUI();
}

function installCardHtml() {
    const st = installState();
    if (settings.installCardHidden || !['ready', 'inapp'].includes(st)) return '';
    const inapp = st === 'inapp';
    return `
        <div class="card p-4 mb-4 flex items-start gap-3 !border-brand/30">
            <div class="w-11 h-11 rounded-2xl ${inapp ? 'bg-amber-500/10 text-amber-500' : 'bg-brand/10 text-brand'} flex items-center justify-center text-lg shrink-0"><i class="fa-solid ${inapp ? 'fa-triangle-exclamation' : 'fa-mobile-screen'}"></i></div>
            <div class="flex-1 min-w-0">
                <p class="font-extrabold text-sm leading-tight">${inapp ? 'Apri in Chrome per installare' : 'Installa Workout sul telefono'}</p>
                <p class="text-xs text-muted font-medium mt-0.5">${inapp
                    ? 'Stai usando il browser interno di un\'altra app: da qui l\'icona avrebbe il suo logo.'
                    : 'Si apre a schermo intero, come un\'app vera, senza barra e senza logo del browser.'}</p>
                <button onclick="installApp()" class="mt-3 bg-brand text-white text-sm font-bold px-4 py-2 rounded-xl active:scale-95 transition shadow-md shadow-brand/20">
                    <i class="${inapp ? 'fa-brands fa-chrome' : 'fa-solid fa-download'} mr-1"></i> ${inapp ? 'Apri in Chrome' : 'Installa app'}
                </button>
            </div>
            <button onclick="dismissInstallCard()" class="icon-btn -mr-2 -mt-2 w-8 h-8" aria-label="Nascondi"><i class="fa-solid fa-xmark text-sm"></i></button>
        </div>`;
}

function renderInstallBox() {
    const st = installState();
    const box = $('installBox');
    // nell'app installata la sezione non serve: niente da mostrare
    if (st === 'installed') { box.innerHTML = ''; return; }
    const label = { ready: 'Installa app', inapp: 'Apri in Chrome per installare' }[st] || 'Come installare l\'app';
    const icon = { ready: 'fa-solid fa-download', inapp: 'fa-brands fa-chrome' }[st] || 'fa-solid fa-circle-question';
    box.innerHTML = `
        <p class="field-label">App</p>
        <button onclick="installApp()" class="btn-soft w-full py-3.5 mb-6 !text-brand"><i class="${icon}"></i> ${label}</button>`;
}

function refreshInstallUI() {
    if (modalStack.includes('settingsModal')) renderInstallBox();
    if (nav.view === 'home') render();
}

// ================= AVVIO =================
loadData();
recordTodayKcal(); // calorie di oggi nello storico del grafico peso/calorie
applyTheme();
fillTimerCfg();
renderAudioControls();
setTimerMode(settings.timerMode === 'interval' ? 'interval' : 'free');

(function boot() {
    // link di condivisione scheda: gestito da share.js dopo l'avvio
    if (location.hash.startsWith('#import=')) window.pendingShareCode = location.hash.slice(8);
    const hash = location.hash.replace('#', '');
    const start = ['workout', 'diet', 'weight', 'db'].includes(hash) ? hash : 'home';
    go(start, {}, { replace: true });
})();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
    // Aggiornamenti automatici: quando è pubblicata una nuova versione il nuovo service worker
    // prende il controllo e la pagina si ricarica da sola (solo se ne esisteva già uno prima).
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading || modalStack.length) return; // non interrompere chi sta compilando
        reloading = true;
        location.reload();
    });
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
            // controlla se c'è una nuova versione ogni volta che l'app torna in primo piano
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') reg.update().catch(() => {});
            });
        }).catch(() => {});
    });
}
