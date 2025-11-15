/* ===================================================
   MasKhan Convert - app.js
   Complete rebuild: crypto (locked rate), pulsa, ewallet,
   history by-invoice, accessibility, config loader, UI polish
   =================================================== */

/* ---------------------------
   Config & Defaults
   --------------------------- */
const DEFAULT_BASE_RATE = 16500; // fallback
const RATE_CACHE_TTL = 5 * 60 * 1000; // 5 min cache
const LOCK_EXPIRY_MS = 10 * 60 * 1000; // optional: 10 minutes lock expiry (we check but not auto-expire until confirm)

let CONFIG = {
  waAdmin: "6281234567890",
  onchainAddrs: {
    bsc: "0x290a91c48example000000000000",
    eth: "0x290a91c48example000000000000",
    matic: "0x290a91c48example000000000000"
  },
  exchangeIds: {
    binance: "BINANCE-EX-123"
  }
};

// try load config.json (both root & parent relative to support different hosting paths)
(async function loadConfig() {
  try {
    const res = await fetch('config.json');
    if (res.ok) {
      const j = await res.json();
      CONFIG = Object.assign({}, CONFIG, j);
      console.log('Loaded config.json', CONFIG);
      return;
    }
  } catch (e) { /* ignore */ }
  try {
    // fallback try ../config.json (if assets/js path used)
    const res2 = await fetch('../config.json');
    if (res2.ok) {
      const j2 = await res2.json();
      CONFIG = Object.assign({}, CONFIG, j2);
      console.log('Loaded config.json (rel)', CONFIG);
      return;
    }
  } catch (e) { /* ignore */ }
  // else use embedded CONFIG
})();

/* ---------------------------
   DOM helpers & elements
   --------------------------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const modeSelect = $('#modeSelect');
const cryptoSection = $('#cryptoSection');
const pulsaSection = $('#pulsaSection');
const ewalletSection = $('#ewalletSection');

const exchangeSelect = $('#exchangeSelect');
const networkWrap = $('#networkWrap');
const networkSelect = $('#networkSelect');

const usdSelect = $('#usdSelect');
const usdCustomWrap = $('#usdCustomWrap');
const usdCustomInput = $('#usdCustomInput');
const cryptoMaxBtn = $('#cryptoMaxBtn');
const calcCryptoBtn = $('#calcCryptoBtn');
const clearCryptoBtn = $('#clearCryptoBtn');

const previewCard = $('#previewCard');
const previewRate = $('#previewRate');
const previewRateTime = $('#previewRateTime');
const previewGross = $('#previewGross');
const previewFee = $('#previewFee');
const previewNet = $('#previewNet');
const confirmPreviewBtn = $('#confirmPreviewBtn');
const cancelPreviewBtn = $('#cancelPreviewBtn');

const pulsaOperator = $('#pulsaOperator');
const pulsaAmount = $('#pulsaAmount');
const pulsaTarget = $('#pulsaTarget');
const pulsaConfirmBtn = $('#pulsaConfirmBtn');
const pulsaClearBtn = $('#pulsaClearBtn');

const ewalletAmount = $('#ewalletAmount');
const ewalletTarget = $('#ewalletTarget');
const ewalletConfirmBtn = $('#ewalletConfirmBtn');
const ewalletClearBtn = $('#ewalletClearBtn');

const openHistoryBtn = $('#openHistory');
const historyOverlay = $('#historyOverlay');
const historyList = $('#historyList');
const closeHistoryBtn = $('#closeHistory');

const resultNote = $('#previewNote');

/* ---------------------------
   Local storage helpers
   --------------------------- */
const LS_KEY_HISTORY = 'mk_history_v1';
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY_HISTORY) || '[]');
  } catch (e) { return []; }
}
function saveHistory(arr) {
  localStorage.setItem(LS_KEY_HISTORY, JSON.stringify(arr));
}

/* ---------------------------
   Utilities: formatting & sanity
   --------------------------- */
function formatIDR(n) {
  if (Number.isFinite(n)) {
    return Number(Math.round(n)).toLocaleString('id-ID');
  }
  return String(n);
}
function formatRp(n) { return 'Rp ' + formatIDR(n); }
function roundTo500(x) { return Math.round(x / 500) * 500; }
function nowIso() { return new Date().toISOString(); }

/* ---------------------------
   Rate fetching + cache
   --------------------------- */
let rateCache = { value: DEFAULT_BASE_RATE, updatedAt: 0 };

async function fetchLiveRate() {
  const now = Date.now();
  if (rateCache.value && (now - rateCache.updatedAt) < RATE_CACHE_TTL) {
    return rateCache.value;
  }
  try {
    const res = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=IDR');
    if (!res.ok) throw new Error('bad');
    const j = await res.json();
    const r = j && j.rates && j.rates.IDR ? Math.round(j.rates.IDR) : DEFAULT_BASE_RATE;
    rateCache.value = r;
    rateCache.updatedAt = Date.now();
    return r;
  } catch (err) {
    // fallback
    return rateCache.value || DEFAULT_BASE_RATE;
  }
}

/* ---------------------------
   Locked calculation state (for Crypto preview)
   --------------------------- */
let locked = {
  rate: null,
  rateTimestamp: null,
  feePercent: null,
  feeAmount: null,
  gross: null,
  netBeforeRound: null,
  netRounded: null,
  usd: null,
  exchange: null,
  network: null,
  createdAt: null
};

function clearLocked() {
  locked = {
    rate: null,
    rateTimestamp: null,
    feePercent: null,
    feeAmount: null,
    gross: null,
    netBeforeRound: null,
    netRounded: null,
    usd: null,
    exchange: null,
    network: null,
    createdAt: null
  };
  hidePreview();
}

/* ---------------------------
   Business logic: fee tiers (example)
   - customize this function according to merchant rules
   --------------------------- */
function cryptoFee(grossIdr) {
  // Example tiered fee (you can adapt)
  if (grossIdr <= 100_000) return 500; // small flat
  if (grossIdr <= 1_000_000) return Math.round(grossIdr * 0.004); // 0.4%
  return Math.round(grossIdr * 0.0035); // 0.35%
}

/* ---------------------------
   Render preview (uses locked)
   --------------------------- */
function showPreview() {
  if (!locked.rate) return;
  previewRate.textContent = `Rp ${formatIDR(locked.rate)}`;
  previewRateTime.textContent = new Date(locked.rateTimestamp).toLocaleTimeString();
  previewGross.textContent = formatRp(locked.gross);
  previewFee.textContent = formatRp(locked.feeAmount);
  previewNet.textContent = formatRp(locked.netRounded);
  previewCard.classList.remove('hidden');

  // show cancel, ensure confirm enabled
  confirmPreviewBtn.disabled = false;
}

/* hide preview */
function hidePreview() {
  previewCard.classList.add('hidden');
}

/* ---------------------------
   Create locked calculation & render
   --------------------------- */
function createLockedCalculation(usdVal, rate, feePercentOrFnOrFlag = null, exchange = '', network = '') {
  // usdVal: number, rate: number
  const gross = usdVal * rate;
  // feePercentOrFnOrFlag can be boolean (use default fn), number (percent), or function
  let feeAmount = 0;
  if (typeof feePercentOrFnOrFlag === 'function') {
    feeAmount = feePercentOrFnOrFlag(gross);
  } else if (typeof feePercentOrFnOrFlag === 'number') {
    feeAmount = Math.round(gross * feePercentOrFnOrFlag);
  } else {
    feeAmount = cryptoFee(gross);
  }
  const netBefore = gross - feeAmount;
  const netRounded = roundTo500(netBefore);

  locked.rate = rate;
  locked.rateTimestamp = new Date().toISOString();
  locked.feePercent = (typeof feePercentOrFnOrFlag === 'number') ? feePercentOrFnOrFlag : null;
  locked.feeAmount = feeAmount;
  locked.gross = gross;
  locked.netBeforeRound = netBefore;
  locked.netRounded = netRounded;
  locked.usd = usdVal;
  locked.exchange = exchange;
  locked.network = network;
  locked.createdAt = Date.now();

  showPreview();
}

/* ---------------------------
   Confirmation (uses locked) -> WA + save history
   --------------------------- */
function confirmLockedCrypto() {
  // check locked exists + expiry
  if (!locked.rate || locked.netRounded == null) {
    Swal.fire({ icon: 'warning', title: 'Preview belum dibuat', text: 'Silakan buat preview terlebih dahulu.' });
    return;
  }
  const age = Date.now() - locked.createdAt;
  if (age > LOCK_EXPIRY_MS) {
    Swal.fire({ icon: 'warning', title: 'Preview kadaluarsa', text: 'Preview lebih dari 10 menit. Silakan hitung ulang.' });
    return;
  }

  // invoice id
  const invoice = 'INV-' + Date.now().toString(36).toUpperCase();

  // build summary lines
  const lines = [
    `INVOICE: ${invoice}`,
    `Mode: Crypto`,
    `Exchange: ${locked.exchange}`,
    locked.network ? `Network: ${locked.network}` : null,
    `USD: ${locked.usd}`,
    `Rate: Rp ${formatIDR(locked.rate)}`,
    `Gross: ${formatRp(locked.gross)}`,
    `Fee: ${formatRp(locked.feeAmount)}`,
    `Total Bayar: ${formatRp(locked.netRounded)}`,
    `—`,
    `Mohon konfirmasi & instruksi transfer. Terima kasih.`
  ].filter(Boolean);

  // save history
  const hist = loadHistory();
  hist.unshift({
    invoice,
    mode: 'crypto',
    exchange: locked.exchange,
    network: locked.network,
    usd: locked.usd,
    rate: locked.rate,
    fee: locked.feeAmount,
    total: locked.netRounded,
    createdAt: new Date().toISOString()
  });
  saveHistory(hist);
  renderHistory();

  // open WA
  const wa = (CONFIG && CONFIG.waAdmin) ? CONFIG.waAdmin : CONFIG.waAdmin;
  const waUrl = `https://wa.me/${wa}?text=${encodeURIComponent(lines.join('\n'))}`;
  window.open(waUrl, '_blank');
}

/* ---------------------------
   Pulsa confirm flow (no locked state; simple)
   --------------------------- */
function confirmPulsaFlow() {
  const op = pulsaOperator.value;
  const amt = Number(pulsaAmount.value);
  const target = pulsaTarget.value && pulsaTarget.value.trim();

  if (!op) return Swal.fire({ icon: 'warning', title: 'Pilih operator' });
  if (!amt || amt < 1000) return Swal.fire({ icon: 'warning', title: 'Nominal pulsa tidak valid' });
  if (!target) return Swal.fire({ icon: 'warning', title: 'Isi nomor tujuan' });

  // simple fee example: operator credit percent (this is placeholder logic)
  const operatorRatePercent = { telkomsel: 100, xl: 100, indosat: 100, tri: 99, smartfren: 98 };
  const ratePercent = operatorRatePercent[op] || 100;
  // the merchant receives maybe: Math.round(amt * (ratePercent/100))
  const received = Math.round(amt * (ratePercent / 100));

  const invoice = 'INV-' + Date.now().toString(36).toUpperCase();
  const summary = [
    `INVOICE: ${invoice}`,
    `Mode: Pulsa`,
    `Operator: ${op}`,
    `Nominal: Rp ${formatIDR(amt)}`,
    `Nominal diterima: Rp ${formatIDR(received)}`,
    `Tujuan: ${target}`,
    '',
    'Mohon proses, terima kasih.'
  ].join('\n');

  // save history
  const hist = loadHistory();
  hist.unshift({
    invoice,
    mode: 'pulsa',
    operator: op,
    nominal: amt,
    total: received,
    target: target,
    createdAt: new Date().toISOString()
  });
  saveHistory(hist);
  renderHistory();

  const wa = (CONFIG && CONFIG.waAdmin) ? CONFIG.waAdmin : CONFIG.waAdmin;
  const waUrl = `https://wa.me/${wa}?text=${encodeURIComponent(summary)}`;
  window.open(waUrl, '_blank');
}

/* ---------------------------
   E-wallet confirm flow
   --------------------------- */
function confirmEwalletFlow() {
  const amt = Number(ewalletAmount.value);
  const target = ewalletTarget.value && ewalletTarget.value.trim();

  if (!amt || amt < 2000) return Swal.fire({ icon: 'warning', title: 'Nominal e-wallet minimal 2000' });
  if (!target) return Swal.fire({ icon: 'warning', title: 'Isi nomor/ID tujuan' });

  // e-wallet fee example: flat 1500 or 0.5% min 1500
  const fee = Math.max(1500, Math.round(amt * 0.005));
  const received = amt - fee;

  const invoice = 'INV-' + Date.now().toString(36).toUpperCase();
  const summary = [
    `INVOICE: ${invoice}`,
    `Mode: E-Wallet`,
    `Nominal: Rp ${formatIDR(amt)}`,
    `Fee: Rp ${formatIDR(fee)}`,
    `Jumlah diterima: Rp ${formatIDR(received)}`,
    `Tujuan: ${target}`,
    '',
    'Mohon proses.'
  ].join('\n');

  // save history
  const hist = loadHistory();
  hist.unshift({
    invoice,
    mode: 'ewallet',
    nominal: amt,
    fee,
    total: received,
    target,
    createdAt: new Date().toISOString()
  });
  saveHistory(hist);
  renderHistory();

  const wa = (CONFIG && CONFIG.waAdmin) ? CONFIG.waAdmin : CONFIG.waAdmin;
  const waUrl = `https://wa.me/${wa}?text=${encodeURIComponent(summary)}`;
  window.open(waUrl, '_blank');
}

/* ---------------------------
   Render History & Delete-by-invoice
   --------------------------- */
function renderHistory() {
  const hist = loadHistory();
  if (!historyList) return;
  if (!hist.length) {
    historyList.innerHTML = '<div class="opacity-70">Belum ada riwayat.</div>';
    return;
  }
  historyList.innerHTML = hist.map(h => {
    if (h.mode === 'crypto') {
      return `<div class="history-item">
        <div class="flex justify-between"><div><strong>${h.invoice}</strong></div><div class="meta">${new Date(h.createdAt).toLocaleString()}</div></div>
        <div class="mt-1">Mode: Crypto — ${h.exchange || '-'} ${h.network ? '('+h.network+')':''}</div>
        <div class="mt-1">USD: ${h.usd} • Total: ${formatRp(h.total)}</div>
        <div class="mt-2"><button class="btn-secondary" data-delete-invoice="${h.invoice}">Hapus</button></div>
      </div>`;
    } else if (h.mode === 'pulsa') {
      return `<div class="history-item">
        <div class="flex justify-between"><div><strong>${h.invoice}</strong></div><div class="meta">${new Date(h.createdAt).toLocaleString()}</div></div>
        <div class="mt-1">Mode: Pulsa — ${h.operator}</div>
        <div class="mt-1">Nominal: Rp ${formatIDR(h.nominal)} • Hasil: Rp ${formatIDR(h.total)}</div>
        <div class="mt-2"><button class="btn-secondary" data-delete-invoice="${h.invoice}">Hapus</button></div>
      </div>`;
    } else {
      return `<div class="history-item">
        <div class="flex justify-between"><div><strong>${h.invoice}</strong></div><div class="meta">${new Date(h.createdAt).toLocaleString()}</div></div>
        <div class="mt-1">Mode: E-Wallet</div>
        <div class="mt-1">Nominal: Rp ${formatIDR(h.nominal)} • Hasil: Rp ${formatIDR(h.total)}</div>
        <div class="mt-2"><button class="btn-secondary" data-delete-invoice="${h.invoice}">Hapus</button></div>
      </div>`;
    }
  }).join('');
}

/* delegated deletion */
document.body.addEventListener('click', (ev) => {
  const btn = ev.target.closest && ev.target.closest('[data-delete-invoice]');
  if (!btn) return;
  const id = btn.getAttribute('data-delete-invoice');
  if (!id) return;
  const hist = loadHistory().filter(x => x.invoice !== id);
  saveHistory(hist);
  renderHistory();
  if (typeof Swal !== 'undefined') Swal.fire({ toast:true, position:'top-end', icon:'success', title:'Item dihapus', showConfirmButton:false, timer:900 });
});

/* ---------------------------
   Accessibility & Overlay controls
   --------------------------- */
function openHistory() {
  if (!historyOverlay) return;
  renderHistory();
  historyOverlay.classList.remove('hidden');
  historyOverlay.setAttribute('aria-hidden', 'false');
  // focus on close for keyboard users
  closeHistoryBtn && closeHistoryBtn.focus();
}
function closeHistory() {
  if (!historyOverlay) return;
  historyOverlay.classList.add('hidden');
  historyOverlay.setAttribute('aria-hidden', 'true');
  openHistoryBtn && openHistoryBtn.focus();
}
openHistoryBtn && openHistoryBtn.addEventListener('click', openHistory);
closeHistoryBtn && closeHistoryBtn.addEventListener('click', closeHistory);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (historyOverlay && !historyOverlay.classList.contains('hidden')) {
      closeHistory();
    } else if (!previewCard.classList.contains('hidden')) {
      // cancel preview if open
      clearLocked();
    }
  }
});

/* ---------------------------
   Wiring up events (DOMContentLoaded)
   --------------------------- */
document.addEventListener('DOMContentLoaded', () => {

  // Mode switch
  modeSelect && modeSelect.addEventListener('change', (e) => {
    const v = modeSelect.value;
    cryptoSection.classList.toggle('hidden', v !== 'crypto');
    pulsaSection.classList.toggle('hidden', v !== 'pulsa');
    ewalletSection.classList.toggle('hidden', v !== 'ewallet');
    // clear preview on mode change
    clearLocked();
  });

  // Exchange -> show network if onchain
  exchangeSelect && exchangeSelect.addEventListener('change', () => {
    const v = exchangeSelect.value;
    if (v === 'onchain') { networkWrap.classList.remove('hidden'); } else { networkWrap.classList.add('hidden'); }
    clearLocked();
  });

  // USD select -> show custom input
  usdSelect && usdSelect.addEventListener('change', () => {
    if (usdSelect.value === 'custom') {
      usdCustomWrap.classList.remove('hidden');
      usdCustomInput && usdCustomInput.focus();
    } else {
      usdCustomWrap.classList.add('hidden');
    }
    clearLocked();
  });

  // MAX button (example behavior: set to 100)
  cryptoMaxBtn && cryptoMaxBtn.addEventListener('click', () => {
    const max = 100;
    usdSelect.value = String(max);
    usdCustomWrap.classList.add('hidden');
    clearLocked();
  });

  // USD custom input: allow Enter to compute
  usdCustomInput && usdCustomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      calcCryptoBtn && calcCryptoBtn.click();
    }
  });

  // Calculate crypto preview
  calcCryptoBtn && calcCryptoBtn.addEventListener('click', async () => {
    const ex = exchangeSelect.value;
    if (!ex) return Swal.fire({ icon: 'warning', title: 'Pilih tujuan terlebih dahulu' });

    let usd;
    if (usdSelect.value === 'custom') {
      const v = parseFloat(usdCustomInput.value);
      if (!v || v <= 0) return Swal.fire({ icon: 'warning', title: 'Nominal USD tidak valid' });
      usd = v;
    } else {
      const v = parseFloat(usdSelect.value);
      if (!v || v <= 0) return Swal.fire({ icon: 'warning', title: 'Pilih nominal USD' });
      usd = v;
    }

    // fetch rate (cached)
    const rate = await fetchLiveRate();

    // Determine network if onchain
    const network = (ex === 'onchain') ? networkSelect.value : null;
    if (ex === 'onchain' && !network) return Swal.fire({ icon: 'warning', title: 'Pilih network untuk transaksi on-chain' });

    // Compute & lock using createLockedCalculation
    createLockedCalculation(usd, rate, null, ex, network);

    // Disable inputs lightly to indicate lock (but allow cancel)
    // (Don't permanently disable; user can cancel to re-edit)
  });

  // Cancel preview
  cancelPreviewBtn && cancelPreviewBtn.addEventListener('click', () => {
    clearLocked();
    if (typeof Swal !== 'undefined') Swal.fire({ toast:true, position:'top-end', icon:'info', title:'Preview dibatalkan', showConfirmButton:false, timer:900 });
  });

  // Confirm preview -> send WA and save history
  confirmPreviewBtn && confirmPreviewBtn.addEventListener('click', () => {
    confirmLockedCrypto();
  });

  // Clear crypto fields
  clearCryptoBtn && clearCryptoBtn.addEventListener('click', () => {
    usdSelect.value = '';
    usdCustomInput.value = '';
    usdCustomWrap.classList.add('hidden');
    exchangeSelect.value = '';
    networkSelect.value = '';
    clearLocked();
  });

  // Pulsa handlers
  pulsaConfirmBtn && pulsaConfirmBtn.addEventListener('click', () => {
    confirmPulsaFlow();
  });
  pulsaClearBtn && pulsaClearBtn.addEventListener('click', () => {
    pulsaOperator.value = '';
    pulsaAmount.value = '';
    pulsaTarget.value = '';
  });

  // E-wallet handlers
  ewalletConfirmBtn && ewalletConfirmBtn.addEventListener('click', () => {
    confirmEwalletFlow();
  });
  ewalletClearBtn && ewalletClearBtn.addEventListener('click', () => {
    ewalletAmount.value = '';
    ewalletTarget.value = '';
  });

  // initial render history if needed
  renderHistory();
});