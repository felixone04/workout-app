'use strict';
// Scanner codice a barre + ricerca su Open Food Facts.
// Lettura: BarcodeDetector nativo (Chrome Android) oppure libreria ZXing caricata al bisogno (iPhone, Firefox, desktop).

const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
const OFF_URL = (code) => `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_it,brands,nutriments,image_front_small_url`;

const scan = { ctx: 'picker', stream: null, timer: null, reader: null, busy: false, product: null, cat: 'Carboidrati', session: 0 };
modalHideHooks.scanModal = () => { scan.session++; stopCamera(); };

function openScanner(ctx) {
    scan.ctx = ctx;
    scan.busy = false;
    scan.product = null;
    $('scanResult').innerHTML = '';
    $('scanManual').value = '';
    $('scanCameraBox').classList.remove('hidden');
    openModal('scanModal');
    startCamera();
}

function stopCamera() {
    clearTimeout(scan.timer);
    if (scan.reader) { try { scan.reader.reset(); } catch (e) { /* già fermo */ } scan.reader = null; }
    if (scan.stream) { scan.stream.getTracks().forEach((t) => t.stop()); scan.stream = null; }
    const v = $('scanVideo');
    v.pause();
    v.srcObject = null;
}

async function startCamera() {
    const session = ++scan.session;
    const status = $('scanStatus');
    const alive = () => session === scan.session && modalStack.includes('scanModal');
    status.textContent = 'Avvio fotocamera…';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        status.textContent = 'Fotocamera non disponibile: scrivi il codice qui sotto';
        return;
    }
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
        status.textContent = e && e.name === 'NotAllowedError'
            ? 'Permesso fotocamera negato: scrivi il codice qui sotto'
            : 'Fotocamera non disponibile: scrivi il codice qui sotto';
        return;
    }
    if (!alive()) { stream.getTracks().forEach((t) => t.stop()); return; }
    scan.stream = stream;
    const v = $('scanVideo');
    v.srcObject = stream;
    try { await v.play(); } catch (e) { /* autoplay: il video parte comunque */ }

    let detector = null;
    if ('BarcodeDetector' in window) {
        try { detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] }); } catch (e) { detector = null; }
    }
    if (detector) {
        status.textContent = 'Inquadra il codice a barre';
        const loop = async () => {
            if (!alive() || !scan.stream) return;
            if (v.readyState >= 2) {
                try {
                    const codes = await detector.detect(v);
                    if (codes.length) { onBarcode(codes[0].rawValue); return; }
                } catch (e) { /* frame non leggibile */ }
            }
            scan.timer = setTimeout(loop, 200);
        };
        loop();
        return;
    }

    try {
        status.textContent = 'Caricamento lettore…';
        await loadScript(ZXING_URL);
    } catch (e) {
        status.textContent = 'Lettore non disponibile offline: scrivi il codice qui sotto';
        return;
    }
    if (!alive() || !scan.stream) return;
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E]);
    const reader = new ZXing.BrowserMultiFormatReader(hints, 250);
    scan.reader = reader;
    status.textContent = 'Inquadra il codice a barre';
    reader.decodeFromStream(scan.stream, v, (result) => {
        if (result && alive()) onBarcode(result.getText());
    }).catch(() => { if (alive()) status.textContent = 'Lettura non riuscita: scrivi il codice qui sotto'; });
}

function onBarcode(code) {
    if (scan.busy) return;
    vibrate(80);
    beep(1200, 0.08, 0.3);
    lookupBarcode(code);
}

function restartScan() {
    scan.busy = false;
    scan.product = null;
    $('scanResult').innerHTML = '';
    $('scanManual').value = '';
    $('scanCameraBox').classList.remove('hidden');
    startCamera();
}

function suggestCategory(c, p, f) {
    const vals = { Carboidrati: c || 0, Proteine: p || 0, Grassi: f || 0 };
    const best = Object.keys(vals).reduce((a, k) => (vals[k] > vals[a] ? k : a), 'Carboidrati');
    return vals[best] < 5 ? 'Verdure' : best;
}

async function lookupBarcode(raw) {
    const code = String(raw || '').replace(/\D/g, '');
    if (code.length < 8) { shake($('scanManual')); return; }
    scan.busy = true;
    scan.session++;
    stopCamera();
    $('scanCameraBox').classList.add('hidden');
    $('scanManual').value = code;

    const known = state.foodDb.find((f) => f.barcode === code);
    if (known) {
        scan.product = { code, known };
        renderScanKnown(known);
        return;
    }

    $('scanResult').innerHTML = `<div class="card p-6 text-center text-muted text-sm"><i class="fa-solid fa-spinner fa-spin text-xl mb-2"></i><p>Cerco il codice ${esc(code)}…</p></div>`;
    let data;
    try {
        const res = await fetch(OFF_URL(code));
        data = res.status === 404 ? { status: 0 } : await res.json();
    } catch (e) {
        renderScanError('Connessione assente', 'Per cercare i prodotti serve internet. Puoi comunque inserire l\'alimento a mano.');
        return;
    }
    const p = data && data.status === 1 ? data.product : null;
    const n = (p && p.nutriments) || {};
    const num = (v) => (Number.isFinite(parseFloat(v)) ? Math.round(parseFloat(v) * 10) / 10 : null);
    const c = num(n.carbohydrates_100g), pr = num(n.proteins_100g), f = num(n.fat_100g);
    if (!p || (c === null && pr === null && f === null)) {
        renderScanError(p ? 'Valori nutrizionali mancanti' : 'Prodotto non trovato', `Il codice ${code} non ha dati su Open Food Facts. Puoi inserire l'alimento a mano con i valori dell'etichetta.`);
        return;
    }
    let kcal = num(n['energy-kcal_100g']);
    if (kcal === null && Number.isFinite(parseFloat(n.energy_100g))) kcal = Math.round(parseFloat(n.energy_100g) / 4.184);
    const name = String(p.product_name_it || p.product_name || 'Prodotto').trim();
    const brand = String(p.brands || '').split(',')[0].trim();
    scan.product = {
        code,
        name: brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${name} (${brand})` : name,
        c, p: pr, f, kcal,
        image: p.image_front_small_url || ''
    };
    scan.cat = suggestCategory(c, pr, f);
    renderScanProduct();
}

function renderScanError(title, text) {
    $('scanResult').innerHTML = `
        <div class="card p-5 text-center">
            <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center text-lg"><i class="fa-solid fa-magnifying-glass"></i></div>
            <p class="font-extrabold mb-1">${esc(title)}</p>
            <p class="text-sm text-muted mb-4">${esc(text)}</p>
            <button onclick="scanManualEntry()" class="btn-primary !from-emerald-500 !to-emerald-600 !shadow-emerald-500/25 mb-2"><i class="fa-solid fa-pen"></i> Inserisci a mano</button>
            <button onclick="restartScan()" class="btn-soft w-full py-3 text-sm"><i class="fa-solid fa-barcode"></i> Scansiona un altro</button>
        </div>`;
}

function renderScanKnown(food) {
    $('scanResult').innerHTML = `
        <div class="card p-5 text-center">
            <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center text-lg"><i class="fa-solid fa-circle-check"></i></div>
            <p class="font-extrabold mb-1">${esc(food.name)}</p>
            <p class="text-sm text-muted mb-4">È già nel tuo database.</p>
            ${scan.ctx === 'picker' ? `<button onclick="useScannedFood()" class="btn-primary !from-emerald-500 !to-emerald-600 !shadow-emerald-500/25 mb-2"><i class="fa-solid fa-plus"></i> Aggiungi al pasto</button>` : ''}
            <button onclick="restartScan()" class="btn-soft w-full py-3 text-sm"><i class="fa-solid fa-barcode"></i> Scansiona un altro</button>
        </div>`;
}

function renderScanProduct() {
    const pr = scan.product;
    const tile = (label, v, cls) => `
        <div class="bg-inset border border-line rounded-2xl py-2 text-center">
            <p class="text-base font-extrabold ${cls} leading-none">${v === null || v === undefined ? '—' : fmt(v)}</p>
            <p class="text-[10px] font-bold uppercase tracking-wider text-muted mt-1">${label}</p>
        </div>`;
    const catBtn = (c) => `<button type="button" onclick="setScanCat('${c}')" class="seg ${scan.cat === c ? 'active' : ''}">${MACRO[c].label}</button>`;
    $('scanResult').innerHTML = `
        <div class="card p-4">
            <div class="flex gap-3 items-end mb-3">
                ${pr.image ? `<img src="${esc(pr.image)}" alt="" class="w-14 h-14 rounded-xl object-contain bg-white border border-line shrink-0" referrerpolicy="no-referrer">` : '<div class="w-14 h-14 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center text-xl shrink-0"><i class="fa-solid fa-box"></i></div>'}
                <div class="flex-1 min-w-0">
                    <label for="scanName" class="field-label">Nome</label>
                    <input id="scanName" type="text" value="${esc(pr.name)}" class="field !py-2.5 !text-sm">
                </div>
            </div>
            <p class="field-label">Valori per 100 g</p>
            <div class="grid grid-cols-4 gap-2 mb-3">
                ${tile('Carbo', pr.c, 'text-sky-500')}${tile('Proteine', pr.p, 'text-rose-500')}${tile('Grassi', pr.f, 'text-amber-500')}${tile('Kcal', pr.kcal, 'text-ink')}
            </div>
            <p class="field-label">Macro principale (per totali e sostituzioni)</p>
            <div class="seg-group mb-4">${CATEGORIES.map(catBtn).join('')}</div>
            <button onclick="saveScannedFood()" class="btn-primary !from-emerald-500 !to-emerald-600 !shadow-emerald-500/25"><i class="fa-solid fa-check"></i> ${scan.ctx === 'picker' ? 'Salva e aggiungi al pasto' : 'Salva nel database'}</button>
            <button onclick="restartScan()" class="btn-soft w-full py-3 text-sm mt-2"><i class="fa-solid fa-barcode"></i> Scansiona un altro</button>
        </div>`;
}

function setScanCat(c) {
    const name = $('scanName') ? $('scanName').value : null;
    scan.cat = c;
    renderScanProduct();
    if (name !== null) $('scanName').value = name;
}

async function saveScannedFood() {
    const pr = scan.product;
    const nameEl = $('scanName');
    const name = nameEl.value.trim();
    if (!name) { shake(nameEl); return; }
    const key = { Carboidrati: 'c', Proteine: 'p', Grassi: 'f' }[scan.cat];
    const macroValue = scan.cat === 'Verdure' ? 0 : (pr[key] || 0);
    if (scan.cat !== 'Verdure' && !(macroValue > 0)) { toast(`Questo prodotto non contiene ${MACRO[scan.cat].label.toLowerCase()}`, 'fa-triangle-exclamation'); return; }
    if ([...foodIndex.keys()].some((k) => k.toLowerCase() === name.toLowerCase())) {
        toast('Esiste già un alimento con questo nome', 'fa-triangle-exclamation');
        shake(nameEl);
        return;
    }
    const food = {
        id: Date.now().toString(36),
        name,
        category: scan.cat,
        macroValue,
        barcode: pr.code,
        macros: { c: pr.c, p: pr.p, f: pr.f, kcal: pr.kcal }
    };
    state.foodDb.push(food);
    rebuildFoodIndex();
    persist();
    scan.product = { code: pr.code, known: food };
    await useScannedFood();
}

async function useScannedFood() {
    const food = scan.product && scan.product.known;
    if (!food) return;
    await closeModal('scanModal');
    if (scan.ctx === 'picker' && modalStack.includes('foodPickerModal')) {
        picker.selected = food.name;
        picker.cat = '';
        $('pickerSearch').value = '';
        renderPickerCats();
        renderPickerList();
        updatePickerPreview();
        document.querySelector('#pickerList .ring-1')?.scrollIntoView({ block: 'center' });
        $('pickerGrams').focus({ preventScroll: true });
        toast('Alimento pronto: inserisci i grammi');
    } else {
        toast('Alimento salvato');
        render();
    }
}

async function scanManualEntry() {
    await closeModal('scanModal');
    if (scan.ctx === 'picker' && modalStack.includes('foodPickerModal')) await closeModal('foodPickerModal');
    promptAddFood();
}
