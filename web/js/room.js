// web/js/room.js — collapsible card + "Saved" pill + padded UI + at-a-glance + smart tips
import { $, fetchJSON, announce } from './api.js';

/* ---------- one-time style injectors ---------- */
function injectRoomStyles(){
  if (document.getElementById('room-inline-style')) return;
  const css = `
    .room-box{padding:12px 14px;border:1px solid rgba(0,0,0,.08);border-radius:10px;background:rgba(0,0,0,.02);}
    .room-heading{display:flex;align-items:center;gap:8px;margin:12px 0 8px;font-weight:600;}
    .room-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;}
    .room-big{font-size:1.1rem;font-weight:600}
    .room-list{margin:0;padding-left:18px;line-height:1.45;}
    .room-sep{height:1px;background:rgba(0,0,0,.06);margin:14px 0;}
  `;
  const s=document.createElement('style'); s.id='room-inline-style'; s.textContent=css;
  document.head.appendChild(s);
}

function injectCollapsibleStyles(){
  if (document.getElementById('room-collapsible-style')) return;
  const css = `
    .mly-collapser{appearance:none;background:rgba(0,0,0,.02);border:1px solid rgba(0,0,0,.08);
      border-radius:10px;width:100%;padding:10px 12px;margin:8px 0 10px;
      display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer}
    .mly-collapser:focus-visible{outline:2px solid #7aaaff;outline-offset:2px}
    .mly-col-left{display:flex;align-items:center;gap:8px;font-weight:600}
    .mly-col-title{letter-spacing:.2px}
    .mly-col-right{display:flex;align-items:center;gap:10px}
    .mly-pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;line-height:1.4}
    .mly-pill--ok{background:#e8f7ee;color:#0a7f3f}
    .mly-pill--warn{background:#fff6e5;color:#8a5a00}
    .mly-pill--danger{background:#fde8e8;color:#b00020}
    .mly-pill--neutral{background:#f0f0f0;color:#555}
    .mly-chevron{transition:transform .18s ease;margin-left:6px}
    .mly-collapser.is-expanded .mly-chevron{transform:rotate(180deg)}
  `;
  const s=document.createElement('style'); s.id='room-collapsible-style'; s.textContent=css;
  document.head.appendChild(s);
}

/* ---------- DOM helpers ---------- */
const cardEl = () => document.getElementById('room-heading')?.closest('.card');
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const setVal = (id, v='') => { const el=$(id); if (el) el.value = (v ?? '') };
const getVal = (id) => n($(id)?.value);

/* ---------- state ---------- */
let _baseline = null; // last saved/loaded values (rounded)

/* ---------- Collapsible scaffold (wrap the whole card content) ---------- */
function ensureRoomCollapsibleUI(){
  const card = cardEl(); if (!card || card.dataset.collapsible === '1') return;
  injectCollapsibleStyles();

  const h2 = card.querySelector('h2');
  // Move everything after <h2> into a details wrapper, add summary header
  const following = [];
  for (let n = h2?.nextSibling; n; n = n.nextSibling) following.push(n);

  const summary = document.createElement('button');
  summary.type = 'button';
  summary.className = 'mly-collapser';
  summary.setAttribute('aria-expanded', 'false');
  summary.setAttribute('aria-controls', 'roomDetailsWrap');
  summary.innerHTML = `
    <div class="mly-col-left">
      <span class="mly-col-title">Room &amp; placement</span>
    </div>
    <div class="mly-col-right">
      <span id="roomPill" class="mly-pill mly-pill--neutral">Not set</span>
      <span class="mly-chevron" aria-hidden="true">▾</span>
    </div>
  `;

  const details = document.createElement('div');
  details.id = 'roomDetailsWrap';

  if (h2?.nextSibling) {
    card.insertBefore(summary, h2.nextSibling);
    card.insertBefore(details, summary.nextSibling);
  } else {
    card.appendChild(summary);
    card.appendChild(details);
  }
  following.forEach(n => details.appendChild(n));

  // Default state from localStorage
  const expanded = localStorage.getItem('room.expanded') === '1';
  setRoomDetailsExpanded(summary, details, expanded);

  summary.addEventListener('click', ()=>{
    const open = summary.getAttribute('aria-expanded') === 'true';
    setRoomDetailsExpanded(summary, details, !open);
    localStorage.setItem('room.expanded', !open ? '1' : '0');
  });

  card.dataset.collapsible = '1';
}
function setRoomDetailsExpanded(summaryEl, detailsEl, expanded){
  summaryEl.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  summaryEl.classList.toggle('is-expanded', expanded);
  detailsEl.style.display = expanded ? '' : 'none';
}
function setRoomPill(text, variant='neutral'){
  const pill = document.getElementById('roomPill'); if (!pill) return;
  pill.textContent = text;
  const base='mly-pill'; const map={ok:'mly-pill--ok',warn:'mly-pill--warn',danger:'mly-pill--danger',neutral:'mly-pill--neutral'};
  pill.className = `${base} ${map[variant]||map.neutral}`;
}

/* ---------- Extra UI inside the card (at-a-glance + tips) ---------- */
function ensureRoomExtras(){
  const details = document.getElementById('roomDetailsWrap');
  if (!details || document.getElementById('roomExtras')) return;

  const extras = document.createElement('div');
  extras.id = 'roomExtras';
  extras.innerHTML = `
    <div class="room-sep" role="separator" aria-hidden="true"></div>
    <div class="room-heading"><span class="muted">At a glance</span></div>
    <div class="room-box">
      <div class="room-grid" id="roomAtGlance">
        <div>
          <div class="muted">Room volume</div>
          <div class="room-big" id="roomVol">—</div>
        </div>
        <div>
          <div class="muted">Aspect ratio (L:W:H)</div>
          <div class="room-big" id="roomAspect">—</div>
        </div>
        <div>
          <div class="muted">Primary modes</div>
          <div class="room-big" id="roomModes">—</div>
        </div>
      </div>
    </div>

    <div class="room-heading"><span class="muted">Tips &amp; tweaks</span></div>
    <div class="room-box">
      <ol class="room-list" id="roomTips">
        <li class="muted">(enter room sizes and placement to see suggestions)</li>
      </ol>
    </div>
  `;
  details.appendChild(extras);
}

/* ---------- Compare & pill logic ---------- */
function snapshotCurrent(){
  return {
    length_m:       getVal('roomL'),
    width_m:        getVal('roomW'),
    height_m:       getVal('roomH'),
    spk_front_m:    getVal('spkFront'),
    listener_front_m:getVal('lstToSpk'),
    spk_spacing_m:  getVal('spkSpacing'),
    layout: null
  };
}
function approxEq(a,b){ if (a==null && b==null) return true; if (a==null || b==null) return false; return Math.abs(a-b) < 0.005; }
function sameAsBaseline(cur, base){
  if (!base) return false;
  const keys = ['length_m','width_m','height_m','spk_front_m','listener_front_m','spk_spacing_m'];
  return keys.every(k => approxEq(cur[k], base[k]));
}
function hasAnyValue(cur){
  return ['length_m','width_m','height_m','spk_front_m','listener_front_m','spk_spacing_m'].some(k => cur[k] != null);
}
function updateRoomPill(){
  const cur = snapshotCurrent();
  if (!_baseline && !hasAnyValue(cur)) { setRoomPill('Not set','neutral'); return; }
  if (_baseline && sameAsBaseline(cur,_baseline)) { setRoomPill('Saved','ok'); return; }
  if (hasAnyValue(cur)) { setRoomPill('Unsaved changes','warn'); return; }
  setRoomPill('Not set','neutral');
}

/* ---------- Live compute + render ---------- */
function computeAndRender(){
  const L = getVal('roomL');      // length (m)
  const W = getVal('roomW');      // width (m)
  const H = getVal('roomH');      // height (m)
  const SF = getVal('spkFront');  // speaker to front wall (m)
  const LF = getVal('lstToSpk');  // listener to front wall (m)
  const SS = getVal('spkSpacing');// speaker spacing (m)

  // At a glance
  const vol = (L && W && H) ? (L*W*H) : null;
  const volStr = vol ? `${vol.toFixed(1)} m³` : '—';

  const aspectStr = (L && W && H)
    ? (() => { const m = Math.min(L,W,H); return `${(L/m).toFixed(1)} : ${(W/m).toFixed(1)} : ${(H/m).toFixed(1)}`; })()
    : '—';

  // Primary axial modes (c/2d) with c=343 m/s
  const c = 343;
  const fL = L ? (c/(2*L)) : null;
  const fW = W ? (c/(2*W)) : null;
  const fH = H ? (c/(2*H)) : null;
  const modesStr = (fL||fW||fH)
    ? `${fL?`${Math.round(fL)} Hz`:'—'}, ${fW?`${Math.round(fW)} Hz`:'—'}, ${fH?`${Math.round(fH)} Hz`:'—'}`
    : '—';

  const roomVol = document.getElementById('roomVol');
  const roomAspect = document.getElementById('roomAspect');
  const roomModes = document.getElementById('roomModes');
  if (roomVol) roomVol.textContent = volStr;
  if (roomAspect) roomAspect.textContent = aspectStr;
  if (roomModes) roomModes.textContent = modesStr;

  // Tips
  const tipsEl = document.getElementById('roomTips');
  if (tipsEl){
    const tips = [];

    // 38% guideline for listener (distance from front wall)
    if (L && LF){
      const targetLF = 0.38 * L;
      const diff = LF - targetLF;
      if (Math.abs(diff) > 0.2){
        tips.push(`Try the 38% rule: listener ~${targetLF.toFixed(2)} m from the front wall (now ${LF.toFixed(2)} m).`);
      }
    }
    // Speaker distance to front wall
    if (SF){
      if (SF < 0.30) tips.push('Pull speakers 0.4–0.8 m from the front wall to reduce strong low-mid reflections.');
      if (SF > 1.20) tips.push('Speakers may be too far from the front wall; try 0.4–0.8 m as a starting point.');
    }
    // Spacing vs room width (side clearance)
    if (W && SS){
      const sideClear = (W - SS) / 2;
      if (sideClear < 0.25) tips.push('Increase side-wall clearance (≥ 0.25 m) to reduce early reflections and comb filtering.');
    }
    // Reasonable ranges
    if (L && (L < 2.0 || L > 12.0)) tips.push('Room length looks unusual; typical is 3–8 m.');
    if (W && (W < 2.0 || W > 12.0)) tips.push('Room width looks unusual; typical is 3–6 m.');
    if (H && (H < 2.1 || H > 4.0)) tips.push('Ceiling height looks unusual; typical is 2.2–3.0 m.');
    // Data completeness nudges
    if (!L || !W || !H) tips.push('Enter room length, width and height to compute modes and better placement suggestions.');
    if (!SF || !SS) tips.push('Add speaker distance and spacing to refine placement tips.');

    tipsEl.innerHTML = tips.slice(0,5).map(t => `<li>${t}</li>`).join('') || '<li class="muted">(no tips)</li>';
  }

  // Pill
  updateRoomPill();
}

function wireInputs(){
  const ids = ['roomL','roomW','roomH','spkFront','lstToSpk','spkSpacing'];
  ids.forEach(id => $(id)?.addEventListener('input', computeAndRender));
}

/* ---------- Public API (same signatures) ---------- */
export function fillRoomFields(v){
  setVal('roomL', v.length_m ?? '');
  setVal('roomW', v.width_m ?? '');
  setVal('roomH', v.height_m ?? '');
  setVal('spkFront', v.spk_front_m ?? '');
  setVal('lstToSpk', v.listener_front_m ?? '');
  setVal('spkSpacing', v.spk_spacing_m ?? '');
  computeAndRender();
}

export async function loadRoom(){
  try{
    injectRoomStyles();
    ensureRoomCollapsibleUI();
    ensureRoomExtras();
    wireInputs();

    setRoomPill('Checking…','neutral');
    const s = await fetchJSON('/api/settings');
    const room = s?.room || {};
    fillRoomFields(room);

    // establish baseline from loaded (rounded) values
    _baseline = {
      length_m: room.length_m ?? null,
      width_m: room.width_m ?? null,
      height_m: room.height_m ?? null,
      spk_front_m: room.spk_front_m ?? null,
      listener_front_m: room.listener_front_m ?? null,
      spk_spacing_m: room.spk_spacing_m ?? null,
      layout: null
    };
    updateRoomPill();
  }catch{
    injectRoomStyles();
    ensureRoomCollapsibleUI();
    ensureRoomExtras();
    wireInputs();
    setRoomPill('Error','danger');
  }
}

export async function saveRoom(){
  // Read + clamp + round to 2 decimals
  const clamp = (x, lo, hi) => x==null ? null : Math.max(lo, Math.min(hi, x));
  const round2 = (x) => x==null ? null : Math.round(x*100)/100;

  let L  = getVal('roomL');      L  = round2(clamp(L, 0, 50));
  let W  = getVal('roomW');      W  = round2(clamp(W, 0, 50));
  let H  = getVal('roomH');      H  = round2(clamp(H, 0, 20));
  let SF = getVal('spkFront');   SF = round2(clamp(SF, 0, 10));
  let LF = getVal('lstToSpk');   LF = round2(clamp(LF, 0, 50));
  let SS = getVal('spkSpacing'); SS = round2(clamp(SS, 0, 20));

  const payload = { room:{
    length_m: L ?? null,
    width_m: W ?? null,
    height_m: H ?? null,
    spk_front_m: SF ?? null,
    listener_front_m: LF ?? null,
    spk_spacing_m: SS ?? null,
    layout: null
  }};

  try{
    const r = await fetch('/api/settings', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const msg = $('saveRoomMsg');
    if(r.ok){
      if (msg) { msg.textContent='Saved ✓'; setTimeout(()=>{ msg.textContent=''; }, 1500); }
      announce('Room and placement saved.');

      // Update baseline to newly-saved values + refresh pill
      _baseline = { ...payload.room };
      // Also reflect any rounding in the fields themselves
      fillRoomFields(_baseline);
      setRoomPill('Saved','ok');
    } else {
      if (msg) msg.textContent='Save failed';
      setRoomPill('Error','danger');
      announce('Saving room and placement failed.');
    }
  }catch{
    const msg = $('saveRoomMsg'); if (msg) msg.textContent='Save failed';
    setRoomPill('Error','danger');
    announce('Saving room and placement failed.');
  }
}
