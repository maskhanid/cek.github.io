/* ===================================================
   MasKhan Convert - app.js (updated with invoice + countdown + UI fixes)
   - crypto calculation uses tiered fees (same behavior as app ori.js)
   - invoice generated when preview (locked) created
   - countdown 10 minutes shown in previewRemaining
   - network moved below exchange (HTML updated)
   - history overlay full-screen & opaque
   - pulsa & ewallet target/QR display fixed
   =================================================== */

/* ---------------------------
   Config & Defaults
   --------------------------- */
const DEFAULT_BASE_RATE = 16500; // fallback rate
const RATE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache
const LOCK_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes lock expiry

let CONFIG = {
  waAdmin: "6281234567890",
  onchainAddrs: {
    bsc: "0x290a91c48dba8b5f46480fdbe27e2318c7b53bcf",
    eth: "0x290a91c48dba8b5f46480fdbe27e2318c7b53bcf",
    matic: "0x290a91c48dba8b5f46480fdbe27e2318c7b53bcf"
  },
  exchangeIds: {
    Binance: "491222749",
    Bybit: "BYBIT-EX-456"
  }
};

// optionally load config.json (root or parent)
(async function loadConfig(){
  try{
    const r = await fetch('config.json');
    if(r.ok){
      const j = await r.json();
      CONFIG = Object.assign({}, CONFIG, j);
      console.log('Loaded config.json', CONFIG);
      return;
    }
  }catch(e){}
  try{
    const r2 = await fetch('../config.json');
    if(r2.ok){
      const j2 = await r2.json();
      CONFIG = Object.assign({}, CONFIG, j2);
      console.log('Loaded config.json (rel)', CONFIG);
      return;
    }
  }catch(e){}
})();

/* ---------------------------
   DOM refs
   --------------------------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const modeSelect = $('#modeSelect');

const cryptoSection = $('#cryptoSection');
const pulsaSection = $('#pulsaSection');
const ewalletSection = $('#ewalletSection');

const cryptoExchange = $('#cryptoExchange');
const chainWrap = $('#chainWrap');
const chainSelect = $('#chainSelect');
const usdSelect = $('#usdSelect');
const usdCustomWrap = $('#usdCustomWrap');
const usdCustomInput = $('#usdCustomInput');
const cryptoMax = $('#cryptoMax');
const calcCryptoBtn = $('#calcCryptoBtn');
const clearCryptoBtn = $('#clearCryptoBtn');

const infoArea = $('#infoArea');

const previewCard = $('#previewCard');
const previewInvoice = $('#previewInvoice');
const previewRemaining = $('#previewRemaining');
const previewRate = $('#previewRate');
const previewGross = $('#previewGross');
const previewFee = $('#previewFee');
const previewNet = $('#previewNet');
const confirmPreviewBtn = $('#confirmPreviewBtn');
const cancelPreviewBtn = $('#cancelPreviewBtn');

const pulsaOperator = $('#pulsaOperator');
const pulsaAmountEl = $('#pulsaAmount');
const pulsaTargetManual = $('#pulsaTargetManual');
const pulsaTargetWrap = $('#pulsaTargetWrap');
const pulsaTargetText = $('#pulsaTargetText');
const copyPulsaTargetBtn = $('#copyPulsaTarget');
const confirmPulsa = $('#confirmPulsa');
const clearPulsaBtn = $('#clearPulsaBtn');

const ewalletAmountEl = $('#ewalletAmount');
const ewalletTarget = $('#ewalletTarget');
const ewalletResultImg = $('#ewalletResultImg');
const ewalletQrImg = $('#ewalletQrImg');
const confirmEwallet = $('#confirmEwallet');
const clearEwalletBtn = $('#clearEwalletBtn');

const openHistoryBtn = $('#openHistory');
const historyOverlay = $('#historyOverlay');
const historyList = $('#historyList');
const closeHistoryBtn = $('#closeHistory');
const clearHistoryBtn = $('#clearHistory');
const noHistoryEl = $('#noHistory');

const confirmBtnGlobal = $('#confirmBtn'); // not used in this layout but retained if present

/* ---------------------------
   Local storage helpers
   --------------------------- */
const LS_PREF = (k) => `mk_pref_${k}`;
const LS_HIST = 'mk_history';

function savePref(key, val){ try{ localStorage.setItem(LS_PREF(key), JSON.stringify(val)); }catch(e){} }
function loadPref(key, def=null){ try{ const r = localStorage.getItem(LS_PREF(key)); return r ? JSON.parse(r) : def; }catch(e){ return def; } }

function loadHistory(){ try{ const raw = localStorage.getItem(LS_HIST); return raw ? JSON.parse(raw) : []; }catch(e){ return []; } }
function saveHistory(arr){ try{ localStorage.setItem(LS_HIST, JSON.stringify(arr)); }catch(e){} }

/* ---------------------------
   Utilities
   --------------------------- */
function formatIDR(n){ if(typeof n !== 'number') n = Number(n) || 0; return n.toLocaleString('id-ID'); }
function formatRp(n){ return `Rp ${formatIDR(n)}`; }
function toNumberFromInput(v){ if(!v && v!==0) return 0; const s = String(v).replace(/[^\d\.\,]/g,'').replace(',','.'); return Number(s) || 0; }
function escapeHtml(s=''){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ---------------------------
   Rate fetch + cache
   --------------------------- */
const RATE_CACHE_KEY = 'mk_rate_cache_v2';
const RATE_TTL = RATE_CACHE_TTL;
async function fetchLiveRate(){
  try{
    const cachedRaw = localStorage.getItem(RATE_CACHE_KEY);
    if(cachedRaw){
      const obj = JSON.parse(cachedRaw);
      if(obj.ts && (Date.now() - obj.ts) < RATE_TTL) return obj.value;
    }
    const res = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=IDR');
    if(!res.ok) throw new Error('fetch fail');
    const j = await res.json();
    const val = j?.rates?.IDR ? Math.round(j.rates.IDR) : DEFAULT_BASE_RATE;
    localStorage.setItem(RATE_CACHE_KEY, JSON.stringify({ value: val, ts: Date.now() }));
    return val;
  }catch(e){
    console.warn('rate fetch failed, fallback', e);
    const cachedRaw = localStorage.getItem(RATE_CACHE_KEY);
    if(cachedRaw){ try{ return JSON.parse(cachedRaw).value; }catch(e){} }
    return DEFAULT_BASE_RATE;
  }
}

/* ---------------------------
   Crypto fee tiers (matching app ori.js behavior)
   --------------------------- */
function cryptoFee(rup){
  const tiers = [
    { max: 10000, fee: 1500 },
    { max: 30000, fee: 2000 },
    { max: 70000, fee: 3000 },
    { max: 100000, fee: 4000 },
    { max: 200000, fee: 5000 },
    { max: 250000, fee: 6000 },
    { max: 400000, fee: 7000 },
    { max: 500000, fee: 8000 },
    { max: 750000, fee: 9000 },
    { max: 950000, fee: 10000 },
    { max: 1500000, fee: 12000 }
  ];
  for(const t of tiers) if(rup <= t.max) return t.fee;
  return 15000;
}

/* ---------------------------
   Locked preview state (for crypto)
   --------------------------- */
let locked = null; // object when preview locked
let lockedTimer = null; // interval id for countdown

function clearLockedPreview(){
  locked = null;
  if(lockedTimer){ clearInterval(lockedTimer); lockedTimer = null; }
  previewInvoice.textContent = '-';
  previewRemaining.textContent = '-';
  previewRate.textContent = '-';
  previewGross.textContent = '-';
  previewFee.textContent = '-';
  previewNet.textContent = '-';
  previewCard.classList.add('hidden');
  // enable inputs again (if you disabled any)
  if(usdCustomWrap) usdCustomWrap.classList.toggle('hidden', usdSelect.value !== 'custom');
}

/* start countdown (updates previewRemaining) */
function startLockCountdown(createdAtTs){
  if(lockedTimer) clearInterval(lockedTimer);
  lockedTimer = setInterval(()=>{
    const elapsed = Date.now() - createdAtTs;
    const remain = LOCK_EXPIRY_MS - elapsed;
    if(remain <= 0){
      previewRemaining.textContent = '00:00';
      confirmPreviewBtn.disabled = true;
      clearInterval(lockedTimer);
      lockedTimer = null;
      // show expired notice
      if(typeof Swal !== 'undefined') Swal.fire({ icon:'warning', title:'Preview kadaluarsa', text:'Silakan hitung ulang.', toast:true, position:'top-end', timer:1600, showConfirmButton:false });
      return;
    }
    const mm = Math.floor(remain / 60000);
    const ss = Math.floor((remain % 60000) / 1000);
    previewRemaining.textContent = `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  }, 800);
}

/* ---------------------------
   Calculation & show preview (crypto)
   --------------------------- */
function createCryptoPreview(usdVal, rate, exchange='', network=''){
  // gross (IDR)
  const gross = Math.round(usdVal * rate);
  const fee = cryptoFee(gross);
  const netBefore = gross - fee;
  // rounding to nearest 500
  const netRounded = Math.round(netBefore / 500) * 500;

  // invoice generate
  const invoice = 'INV-' + Date.now().toString(36).toUpperCase();

  locked = {
    invoice,
    usd: usdVal,
    rate,
    gross,
    fee,
    netRounded,
    exchange,
    network,
    createdAtTs: Date.now()
  };

  // render preview
  previewInvoice.textContent = invoice;
  previewRate.textContent = `Rp ${formatIDR(rate)}`;
  previewGross.textContent = formatRp(gross);
  previewFee.textContent = formatRp(fee);
  previewNet.textContent = formatRp(netRounded);
  previewCard.classList.remove('hidden');
  confirmPreviewBtn.disabled = false;

  // start countdown
  startLockCountdown(locked.createdAtTs);
}

/* ---------------------------
   Confirm locked crypto -> WA + save history
   --------------------------- */
async function confirmLockedCryptoFlow(){
  if(!locked) return Swal.fire({ icon:'warning', title:'Preview belum dibuat' });
  const age = Date.now() - locked.createdAtTs;
  if(age > LOCK_EXPIRY_MS) return Swal.fire({ icon:'warning', title:'Preview kadaluarsa', text:'Silakan hitung ulang.' });

  // save history entry
  const item = {
    invoice: locked.invoice,
    mode: 'crypto',
    exchange: locked.exchange || '-',
    network: locked.network || '-',
    usd: locked.usd,
    rate: locked.rate,
    fee: locked.fee,
    total: locked.netRounded,
    target: locked.exchange && (CONFIG.exchangeIds && CONFIG.exchangeIds[locked.exchange]) ? CONFIG.exchangeIds[locked.exchange] : (locked.network ? (CONFIG.onchainAddrs[locked.network] || '-') : '-'),
    ts: Date.now()
  };
  const arr = loadHistory(); arr.unshift(item); saveHistory(arr); renderHistory();

  // build message and open WA
  const wa = CONFIG.waAdmin || '6281234567890';
  let body = `Halo admin,%0AInvoice: ${item.invoice}%0AJenis: Crypto%0AExchange: ${encodeURIComponent(item.exchange)}%0AUSD: ${encodeURIComponent(String(item.usd))}%0ARate: Rp ${formatIDR(item.rate)}%0AGross: ${formatRp(item.gross)}%0AFee: ${formatRp(item.fee)}%0ATotal: ${formatRp(item.total)}%0ATujuan: ${encodeURIComponent(item.target)}%0A%0AMohon konfirmasi.`;
  const url = `https://wa.me/${wa}?text=${body}`;
  window.open(url, '_blank');
}

/* ---------------------------
   Update crypto view handler (when user presses Hitung)
   --------------------------- */
async function handleCalcCrypto(){
  const ex = cryptoExchange.value || '';
  // validate USD
  let usdVal = usdSelect.value;
  if(!usdVal || usdVal === '') return Swal.fire({ icon:'warning', title:'Pilih nominal USD' });
  if(usdVal === 'custom'){
    usdVal = toNumberFromInput(usdCustomInput.value);
    if(!usdVal || usdVal <= 0) return Swal.fire({ icon:'warning', title:'Masukkan USD valid' });
  } else {
    usdVal = Number(usdVal);
  }

  // if onchain, ensure network chosen
  const network = (ex === 'Wallet Crypto / Onchain') ? (chainSelect.value || '') : '';
  if(ex === 'Wallet Crypto / Onchain' && !network) return Swal.fire({ icon:'warning', title:'Pilih network (on-chain)' });

  // fetch rate (cached)
  const rate = await fetchLiveRate();

  // create preview and lock
  createCryptoPreview(usdVal, rate, ex, network);
}

/* ---------------------------
   Pulsa behavior
   --------------------------- */
const pulsaRates = { axis:85, indosat:80 };
const pulsaTargets = { axis:'083121196257', indosat:'08557112334' };

function computePulsaPreview(){
  const op = pulsaOperator.value;
  const num = toNumberFromInput(pulsaAmountEl.value);
  if(!op || !num || num < 5000){ return hidePreviewBlock(); }
  const ratePercent = pulsaRates[op] || 100;
  const received = Math.round(num * (ratePercent / 100));
  // display in right preview area (reuse previewCard)
  previewRate.textContent = '-';
  previewGross.textContent = formatRp(num);
  previewFee.textContent = `${ratePercent}%`;
  previewNet.textContent = formatRp(received);
  previewInvoice.textContent = '-';
  previewCard.classList.remove('hidden');

  // show pulsa target
  const manual = pulsaTargetManual.value && pulsaTargetManual.value.trim();
  const target = manual || (pulsaTargets[op] || '-');
  pulsaTargetText.textContent = target;
  pulsaTargetWrap.classList.remove('hidden');
  ewalletResultImg.classList.add('hidden');
}

function hidePreviewBlock(){
  previewCard.classList.add('hidden');
  pulsaTargetWrap.classList.add('hidden');
  ewalletResultImg.classList.add('hidden');
}

/* confirm pulsa flow (this confirms + opens WA and saves history) */
function confirmPulsaFlow(){
  const op = pulsaOperator.value;
  const num = toNumberFromInput(pulsaAmountEl.value);
  const manualTarget = pulsaTargetManual.value && pulsaTargetManual.value.trim();
  if(!op) return Swal.fire({ icon:'warning', title:'Pilih operator' });
  if(!num) return Swal.fire({ icon:'warning', title:'Masukkan nominal' });
  if(num < 5000) return Swal.fire({ icon:'warning', title:'Minimal pulsa Rp 5.000' });

  const ratePercent = pulsaRates[op] || 100;
  const received = Math.round(num * (ratePercent / 100));
  const target = manualTarget || (pulsaTargets[op] || '-');
  const invoice = 'INV-' + Date.now().toString(36).toUpperCase();

  // save history
  const item = { invoice, mode:'pulsa', exchange: op, nominal: 'Rp ' + formatIDR(num), fee: `${ratePercent}%`, result: received, target, ts: Date.now() };
  const arr = loadHistory(); arr.unshift(item); saveHistory(arr); renderHistory();

  // build WA message and open
  const wa = CONFIG.waAdmin || '6281234567890';
  const body = `Halo admin,%0AInvoice: ${invoice}%0AJenis: Pulsa%0AOperator: ${op}%0ANominal: Rp ${formatIDR(num)}%0AHasil: Rp ${formatIDR(received)}%0ATujuan: ${encodeURIComponent(target)}%0A%0AMohon konfirmasi.`;
  window.open(`https://wa.me/${wa}?text=${body}`, '_blank');
}

/* ---------------------------
   E-Wallet behavior
   --------------------------- */
function ewalletFee(amount){
  if(amount <= 49999) return 1000;
  if(amount <= 99999) return 3000;
  if(amount <= 499999) return 5000;
  if(amount <= 999999) return 10000;
  return Math.round(amount * 0.01);
}

function computeEwalletPreview(){
  const num = toNumberFromInput(ewalletAmountEl.value);
  if(!num || num < 2000) return hidePreviewBlock();
  const fee = ewalletFee(num);
  const received = num - fee;
  previewRate.textContent = '-';
  previewGross.textContent = formatRp(num);
  previewFee.textContent = formatRp(fee);
  previewNet.textContent = formatRp(received);
  previewInvoice.textContent = '-';
  previewCard.classList.remove('hidden');

  // show QR
  const QR_IMAGE_URL = 'https://iili.io/f9hdce2.jpg';
  ewalletQrImg.src = QR_IMAGE_URL;
  ewalletResultImg.classList.remove('hidden');
}

/* confirm ewallet flow */
function confirmEwalletFlow(){
  const num = toNumberFromInput(ewalletAmountEl.value);
  const target = ewalletTarget.value && ewalletTarget.value.trim();
  if(!num) return Swal.fire({ icon:'warning', title:'Masukkan nominal' });
  if(num < 2000) return Swal.fire({ icon:'warning', title:'Minimal Rp 2.000' });

  const fee = ewalletFee(num);
  const received = num - fee;
  const invoice = 'INV-' + Date.now().toString(36).toUpperCase();
  const item = { invoice, mode:'ewallet', nominal: 'Rp ' + formatIDR(num), fee, result: received, target: target || 'QRIS', ts: Date.now() };
  const arr = loadHistory(); arr.unshift(item); saveHistory(arr); renderHistory();

  const wa = CONFIG.waAdmin || '6281234567890';
  const body = `Halo admin,%0AInvoice: ${invoice}%0AJenis: E-Wallet%0ANominal: Rp ${formatIDR(num)}%0AFee: Rp ${formatIDR(fee)}%0AHasil: Rp ${formatIDR(received)}%0ATujuan: ${encodeURIComponent(item.target)}%0A%0AMohon konfirmasi.`;
  window.open(`https://wa.me/${wa}?text=${body}`, '_blank');
}

/* ---------------------------
   Event wiring
   --------------------------- */

// populate USD select (1..200 + custom)
(function populateUsd(){
  const sel = usdSelect;
  sel.innerHTML = '<option value="">Pilih nominal (contoh 1, 5, 10 ...)</option>';
  for(let i=1;i<=200;i++){
    const o = document.createElement('option'); o.value = i; o.textContent = i; sel.appendChild(o);
  }
  const o2 = document.createElement('option'); o2.value = 'custom'; o2.textContent = 'Ketik manual...'; sel.appendChild(o2);
})();

// mode switch
function showMode(mode){
  cryptoSection.classList.toggle('hidden', mode !== 'crypto');
  pulsaSection.classList.toggle('hidden', mode !== 'pulsa');
  ewalletSection.classList.toggle('hidden', mode !== 'ewallet');
  // clear preview when switching
  clearLockedPreview();
}
modeSelect.addEventListener('change', ()=> showMode(modeSelect.value));
(function initMode(){ const saved = loadPref('mode'); if(saved) modeSelect.value = saved; showMode(modeSelect.value); })();

// exchange -> network visibility
cryptoExchange && cryptoExchange.addEventListener('change', ()=>{
  const v = cryptoExchange.value;
  if(v === 'Wallet Crypto / Onchain') chainWrap.classList.remove('hidden'); else chainWrap.classList.add('hidden');
  clearLockedPreview();
});

// usd select -> custom
usdSelect && usdSelect.addEventListener('change', ()=>{
  if(usdSelect.value === 'custom') usdCustomWrap.classList.remove('hidden'); else usdCustomWrap.classList.add('hidden');
  clearLockedPreview();
});
usdCustomInput && usdCustomInput.addEventListener('keydown', (e)=> { if(e.key === 'Enter') calcCryptoBtn.click(); });

// MAX button
cryptoMax && cryptoMax.addEventListener('click', ()=> { usdSelect.value = '100'; usdCustomWrap.classList.add('hidden');});

// calc crypto
calcCryptoBtn && calcCryptoBtn.addEventListener('click', ()=> {
  handleCalcCrypto().catch(err => { console.error(err); Swal.fire({icon:'error',title:'Kesalahan', text:'Gagal menghitung. Coba lagi.'}); });
});

// cancel preview
cancelPreviewBtn && cancelPreviewBtn.addEventListener('click', ()=> {
  clearLockedPreview();
  if(typeof Swal !== 'undefined') Swal.fire({ toast:true, position:'top-end', icon:'info', title:'Preview dibatalkan', showConfirmButton:false, timer:900 });
});

// confirm preview
confirmPreviewBtn && confirmPreviewBtn.addEventListener('click', ()=> {
  confirmLockedCryptoFlow().catch(()=>{});
});

// pulsa events
pulsaOperator && pulsaOperator.addEventListener('change', ()=> { computePulsaPreview(); });
pulsaAmountEl && pulsaAmountEl.addEventListener('input', ()=> { computePulsaPreview(); });
confirmPulsa && confirmPulsa.addEventListener('click', ()=> confirmPulsaFlow());
clearPulsaBtn && clearPulsaBtn.addEventListener('click', ()=> { pulsaAmountEl.value=''; pulsaTargetManual.value=''; hidePreviewBlock(); });

// copy pulsa target
copyPulsaTargetBtn && copyPulsaTargetBtn.addEventListener('click', ()=> {
  const txt = pulsaTargetText.textContent.trim();
  if(!txt) return;
  navigator.clipboard.writeText(txt).then(()=> { if(typeof Swal!=='undefined') Swal.fire({ toast:true, position:'top-end', icon:'success', title:'Tersalin', showConfirmButton:false, timer:900 }); });
});

// ewallet events
ewalletAmountEl && ewalletAmountEl.addEventListener('input', ()=> computeEwalletPreview());
confirmEwallet && confirmEwallet.addEventListener('click', ()=> confirmEwalletFlow());
clearEwalletBtn && clearEwalletBtn.addEventListener('click', ()=> { ewalletAmountEl.value=''; ewalletTarget.value=''; ewalletResultImg.classList.add('hidden'); hidePreviewBlock(); });

// copy/copy-icon delegated
document.body.addEventListener('click', (ev)=> {
  const btn = ev.target.closest && ev.target.closest('.copy-icon');
  if(!btn) return;
  const box = btn.closest('.addr-box');
  const addr = box ? box.querySelector('.addr-text')?.textContent.trim() : null;
  if(addr){
    navigator.clipboard.writeText(addr).then(()=> {
      if(typeof Swal !== 'undefined') Swal.fire({ toast:true, position:'top-end', icon:'success', title:'Tersalin', showConfirmButton:false, timer:900 });
    });
  }
});

/* ---------------------------
   History overlay & render
   --------------------------- */
openHistoryBtn && openHistoryBtn.addEventListener('click', ()=> {
  renderHistory();
  historyOverlay.classList.remove('hidden');
  historyOverlay.setAttribute('aria-hidden','false');
  // scroll to top
  historyOverlay.scrollTop = 0;
});
closeHistoryBtn && closeHistoryBtn.addEventListener('click', ()=> {
  historyOverlay.classList.add('hidden');
  historyOverlay.setAttribute('aria-hidden','true');
});
clearHistoryBtn && clearHistoryBtn.addEventListener('click', ()=> {
  if(typeof Swal !== 'undefined'){
    Swal.fire({ title:'Hapus semua riwayat?', icon:'warning', showCancelButton:true, confirmButtonText:'Ya', cancelButtonText:'Batal' })
      .then(res => { if(res.isConfirmed){ localStorage.removeItem(LS_HIST); renderHistory(); Swal.fire({ toast:true, position:'top-end', icon:'success', title:'Riwayat dihapus', timer:900 }); } });
  }
});

function renderHistory(){
  const arr = loadHistory() || [];
  historyList.innerHTML = '';
  if(!arr.length){ noHistoryEl && (noHistoryEl.style.display = 'block'); return; } else { if(noHistoryEl) noHistoryEl.style.display='none'; }
  arr.forEach((h, idx) => {
    const time = new Date(h.ts || Date.now());
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:8px;">
        <div style="flex:1">
          <div style="font-weight:700">${escapeHtml((h.mode||'').toUpperCase())} ${h.exchange?('• '+escapeHtml(h.exchange)) : ''}</div>
          <div class="muted-xs" style="margin-top:6px">${time.toLocaleString()}</div>
          <div class="muted-xs" style="margin-top:8px">Invoice: <strong>${escapeHtml(h.invoice || '-')}</strong></div>
          <div class="muted-xs" style="margin-top:6px">Nominal: <strong>${escapeHtml(h.nominal || '-')}</strong></div>
          <div class="muted-xs">Hasil: <strong>Rp ${formatIDR(h.result || 0)}</strong> • Fee: <strong>${typeof h.fee === 'number' ? 'Rp ' + formatIDR(h.fee) : escapeHtml(String(h.fee))}</strong></div>
          <div class="muted-xs" style="margin-top:6px">Tujuan: <span class="addr-text">${escapeHtml(h.target || '-')}</span></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button class="btn-ghost" data-del="${idx}">Hapus</button>
        </div>
      </div>
    `;
    historyList.appendChild(div);
  });

  // attach delete handlers (by index)
  historyList.querySelectorAll('button[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.getAttribute('data-del'));
      const arr2 = loadHistory();
      arr2.splice(i,1);
      saveHistory(arr2);
      renderHistory();
      if(typeof Swal !== 'undefined') Swal.fire({ toast:true, position:'top-end', icon:'success', title:'Item dihapus', timer:900, showConfirmButton:false });
    });
  });
}

/* ---------------------------
   init
   --------------------------- */
(function init(){
  // restore prefs
  const m = loadPref('mode'); if(m) modeSelect.value = m;
  const ex = loadPref('exchange'); if(ex) cryptoExchange.value = ex;
  const usd = loadPref('usd'); if(usd) usdSelect.value = String(usd);
  const chain = loadPref('chain'); if(chain) chainSelect.value = chain;

  showMode(modeSelect.value);
  fetchLiveRate().catch(()=>{});
  renderHistory();
})();