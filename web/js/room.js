// web/js/room.js — padded UI + at-a-glance + smart tips (no HTML changes)
import { $, fetchJSON, announce } from './api.js';

/* ---------- one-time style injector ---------- */
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

/* ---------- DOM helpers ---------- */
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const setVal = (id, v='') => { const el=$(id); if (el) el.value = (v ?? '') };
const getVal = (id) => n($(id)?.value);

/* ---------- UI scaffold (appended to the Room card) ---------- */
function ensureRoomUX(){
  const card = document.getElementById('room-heading')?.closest('.card');
  if (!card) return;
  if (document.getElementById('roomExtras')) return;

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
  card.appendChild(extras);
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
    ? (() => {
        const m = Math.min(L,W,H);
        return `${(L/m).toFixed(1)} : ${(W/m).toFixed(1)} : ${(H/m).toFixed(1)}`;
      })()
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
  if (!tipsEl) return;

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

  // Spacing vs room width (keep at least ~0.25 m from side walls if data present)
  if (W && SS){
    const sideClear = (W - SS) / 2;
    if (sideClear < 0.25) tips.push('Increase side-wall clearance (≥ 0.25 m) to reduce early reflections and comb filtering.');
  }

  // Reasonable ranges for inputs
  if (L && (L < 2.0 || L > 12.0)) tips.push('Room length looks unusual; typical is 3–8 m.');
  if (W && (W < 2.0 || W > 12.0)) tips.push('Room width looks unusual; typical is 3–6 m.');
  if (H && (H < 2.1 || H > 4.0)) tips.push('Ceiling height looks unusual; typical is 2.2–3.0 m.');

  // Generic helpful tips when not enough data
  if (!L || !W || !H){
    tips.push('Enter room length, width and height to compute modes and better placement suggestions.');
  }
  if (!SF || !SS){
    tips.push('Add speaker distance and spacing to refine placement tips.');
  }

  tipsEl.innerHTML = tips.slice(0,5).map(t => `<li>${t}</li>`).join('') || '<li class="muted">(no tips)</li>';
}

function wireInputs(){
  const ids = ['roomL','roomW','roomH','spkFront','lstToSpk','spkSpacing'];
  ids.forEach(id => $(id)?.addEventListener('input', computeAndRender));
}

/* ---------- Public API (unchanged signatures) ---------- */
export function fillRoomFields(v){
  setVal('roomL', v.length_m ?? '');
  setVal('roomW', v.width_m ?? '');
  setVal('roomH', v.height_m ?? '');
  setVal('spkFront', v.spk_front_m ?? '');
  setVal('lstToSpk', v.listener_front_m ?? '');
  setVal('spkSpacing', v.spk_spacing_m ?? '');
  // Recompute after filling
  computeAndRender();
}

export async function loadRoom(){
  try{
    injectRoomStyles();
    ensureRoomUX();
    wireInputs();
    const s = await fetchJSON('/api/settings');
    fillRoomFields(s?.room || {});
  }catch{
    // still ensure UX exists
    injectRoomStyles();
    ensureRoomUX();
    wireInputs();
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
      // Keep UI consistent with rounded values
      fillRoomFields(payload.room);
    } else {
      if (msg) msg.textContent='Save failed';
      announce('Saving room and placement failed.');
    }
  }catch{
    const msg = $('saveRoomMsg'); if (msg) msg.textContent='Save failed';
    announce('Saving room and placement failed.');
  }
}
