// web/js/dashboard.js — graph + section scores + tips & tweaks

/* ---------- DOM + fetch ---------- */
const $id = (id) => document.getElementById(id);
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  try { return await r.json(); } catch { return null; }
}

/* ---------- state ---------- */
let _fr = null;        // [{f,l,r}]
let _sections = null;  // { bandwidth:{score}, balance:{score}, ... }
let _topActions = null; // [{section, advice}]
let _err = '';

/* ---------- public API ---------- */
export function initDashboard() {
  const wrap = $id('dashboard');
  if (!wrap) return;
  injectDashStyles();
  wrap.innerHTML = `
    <div id="dash-graph-wrap"
        style="width:100%;height:360px;border:1px solid rgba(0,0,0,.1);border-radius:8px"></div>

    <!-- legend + status line -->
    <div id="dash-graph-meta"
        style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px">
      <div id="dash-legend" aria-label="Legend" style="display:flex;align-items:center;gap:14px">
        <span style="display:inline-flex;align-items:center;gap:6px">
          <span style="width:10px;height:10px;border-radius:50%;background:#1f77b4;display:inline-block"></span>
          <span class="small muted">Left</span>
        </span>
        <span style="display:inline-flex;align-items:center;gap:6px">
          <span style="width:10px;height:10px;border-radius:50%;background:#d62728;display:inline-block"></span>
          <span class="small muted">Right</span>
        </span>
      </div>
      <div id="dash-msg" class="small muted"></div>
    </div>

    <!-- friendly help text -->
    <p id="dash-help" class="small muted" style="margin-top:6px">
      This graph shows your room’s frequency response. The blue (Left) and red (Right) lines are the level across frequency on a log scale. 
      The shaded band marks ±3&nbsp;dB around the median—aim for smooth curves inside this band and similar Left/Right shapes.
      Scroll to zoom · drag to pan · hover to read exact values.
    </p>

    <!-- section scores -->
    <div id="dash-sections" style="margin-top:12px"></div>

    <!-- tips & tweaks -->
    <div id="dash-tips" style="margin-top:14px"></div>
  `;

  refreshDashboard();
}

export async function refreshDashboard() {
  setBusy(true); _err = ''; _fr = null; _sections = null; _topActions = null;
  try {
    const [simp, geek] = await Promise.allSettled([
      fetchJSON('/api/simple'),
      fetchJSON('/api/geek')
    ]);

    const stack = [];
    if (geek.status === 'fulfilled' && geek.value) stack.push(['geek', geek.value]);
    if (simp.status === 'fulfilled' && simp.value) stack.push(['simple', simp.value?.simple_view || simp.value]);

    for (const [, payload] of stack) {
      if (!_fr) _fr = extractFRAnywhere(payload);
      if (!_sections) _sections = extractSectionsAnywhere(payload);
      if (!_topActions) _topActions = extractTopActionsAnywhere(payload);
      if (_fr && _sections && _topActions) break;
    }

    // Demo fallback
    const wantDemo = (new URLSearchParams(location.search).get('demo') === '1') || (window.DASH_DEMO === 1);
    if (wantDemo) {
      if (!_fr) _fr = getDemoFR();
      if (!_sections) _sections = getDemoSections();
      if (!_topActions) _topActions = [
        { section: 'balance', advice: 'Center listener and match L/R distance & gain.' },
        { section: 'peaks_dips', advice: 'Try small seat/speaker moves to reduce big peaks.' },
        { section: 'reflections', advice: 'Treat side-wall first reflections or add a rug.' },
      ];
      if (!_fr) _err = '(demo data only had sections/tips)';
      else if (!_sections) _err = '(demo data only had FR)';
    }

    if (!_fr) _err = _err || 'No frequency response found in /api/geek or /api/simple.';
  } catch (e) {
    _err = String(e?.message || e);
  } finally {
    render();
    setBusy(false);
  }
}
export function setStatus(){ /* no-op */ }
export function setBusy(isBusy) {
  const msg = $id('dash-msg');
  if (msg) msg.textContent = isBusy ? 'Working…' : '';
}

function injectDashStyles(){
  if (document.getElementById('dash-inline-style')) return;
  const css = `
    .dash-box{padding:12px 14px;border:1px solid rgba(0,0,0,.08);border-radius:10px;background:rgba(0,0,0,.02);}
    .dash-heading{display:flex;align-items:center;gap:8px;margin:12px 0 8px;font-weight:600;}
    .dash-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;}
    .dash-list{margin:0;padding-left:18px;line-height:1.45;}
    .dash-sep{height:1px;background:rgba(0,0,0,.06);margin:14px 0;}
  `;
  const s=document.createElement('style'); s.id='dash-inline-style'; s.textContent=css;
  document.head.appendChild(s);
}

/* ---------- render ---------- */
function render(){
  const host = $id('dash-graph-wrap');
  const msg  = $id('dash-msg');
  const sec  = $id('dash-sections');
  const tips = $id('dash-tips');
  if (!host) return;
  host.innerHTML = '';
  sec.innerHTML = '';
  tips.innerHTML = '';

  if (!_fr || _fr.length < 2) {
    host.textContent = '(no response data)';
    if (_err) msg.textContent = _err;
  } else {
    msg.textContent = 'Scroll to zoom · Drag to pan · Hover to read';
    renderFRGraph(host, _fr, { frac: 6 });
  }

  // Section scores
  if (_sections && Object.keys(_sections).length) {
    const order = ['bandwidth','balance','peaks_dips','smoothness','reflections','reverb'];
    const pills = order
      .filter(k => k in _sections)
      .map(k => {
        const s = Number(_sections[k]?.score);
        const cls = pillClassFromScore(s);
        const label = k.replace('_','/');
        const val = Number.isFinite(s) ? s.toFixed(1) : '—';
        return `<span class="result-pill ${cls}" style="display:block;text-align:center">${label} ${val}/10</span>`;
      }).join('');

    sec.innerHTML = `
      <div class="dash-heading"><span class="muted">Section scores</span></div>
      <div class="dash-box">
        <p class="small muted" style="margin:0 0 8px 0;">
          Scores are computed from your last sweep by comparing the measured response to a neutral target (1/6-oct smoothed), then deducting points for L/R imbalance, large or narrow peaks/dips, limited bandwidth (−3 dB points), strong early reflections, and excessive reverb; 10 means smooth (≈±3 dB), balanced, and well-damped.
        </p>
        <div class="dash-grid">
          ${pills || '<span class="muted">(none)</span>'}
        </div>
      </div>
    `;


  } else if (!_err) {
    sec.innerHTML = `<div class="muted">(no section scores)</div>`;
  }

  // Tips & tweaks (prefer API actions; else weakest-section tips)
  const tipsList = buildTipsList(_sections, _topActions);
  const focus = tipsList.focus;
  const items = tipsList.items.slice(0, 5).map(t =>
    `<li><span class="badge" style="margin-right:6px">${t.section || focus}</span> ${t.advice}</li>`
  ).join('');

  tips.innerHTML = `
    <div class="dash-sep" role="separator" aria-hidden="true"></div>
    <div class="dash-heading">
      <span class="muted">Tips &amp; tweaks${focus ? ` · focused on ${focus}` : ''}</span>
    </div>
    <div class="dash-box">
      <ol class="dash-list">
        ${items || '<li class="muted">(no tips)</li>'}
      </ol>
    </div>
  `;

}

/* ---------- tips logic ---------- */
function buildTipsList(sections, topActions){
  const allowed = new Set(['bandwidth','balance','peaks_dips','smoothness','reflections','reverb','general']);

  // Weakest section by score (our focus)
  const weakest = (() => {
    if (!sections) return 'general';
    const entries = Object.entries(sections)
      .map(([k,v]) => [k, Number(v?.score)])
      .filter(([,s]) => Number.isFinite(s));
    if (!entries.length) return 'general';
    entries.sort((a,b)=> a[1]-b[1]);
    return entries[0][0];
  })();

  // Normalize API tips (array only) and whitelist section names
  const api = (topActions || [])
    .filter(Boolean)
    .map(a => {
      if (typeof a === 'string') return { section: 'general', advice: a.trim() };
      if (typeof a === 'object') {
        const sectionRaw = (a.section || a.area || a.category || 'general') + '';
        const section = allowed.has(sectionRaw.toLowerCase().replace(/\s+/g,'_'))
          ? sectionRaw.toLowerCase().replace(/\s+/g,'_')
          : 'general';
        const advice = (a.advice || a.text || a.tip || a.recommendation || a.title || '').trim();
        return advice ? { section, advice } : null;
      }
      return null;
    })
    .filter(Boolean);

  if (api.length) {
    // Prioritize tips that match the weakest section
    const prioritized = [
      ...api.filter(t => t.section === weakest),
      ...api.filter(t => t.section !== weakest)
    ];
    return { focus: weakest.replace('_','/'), items: prioritized };
  }

  // Fallback canned tips by weakest section
  const tipMap = {
    general: [
      'Re-run a sweep after any speaker or seat move.',
      'Keep mic at ear height, ~1 m from the back wall.',
      'Close doors/windows and reduce background noise.'
    ],
    bandwidth: [
      'Aim tweeters at ear height; check speaker tilt.',
      'Reduce strong HF absorbers if the top end feels dull.',
      'Confirm mic calibration is applied.'
    ],
    balance: [
      'Center listening position; match L/R distances within 1–2 cm.',
      'Verify channel gains are equal; check wiring polarity.',
      'Symmetrize nearby boundaries (furniture, side walls).'
    ],
    peaks_dips: [
      'Nudge seat/speaker positions (5–15 cm) to reduce strong modes.',
      'Use gentle EQ cuts on the biggest peaks rather than boosts.',
      'Add bass traps or thicker broadband absorption.'
    ],
    smoothness: [
      'Match speaker distances and toe-in to align arrival times.',
      'Treat first-reflection points (side walls, desk surface).',
      'Check driver polarity on all cables/drivers.'
    ],
    reflections: [
      'Add a rug and treat side-wall first reflections.',
      'Reduce large reflective surfaces near speakers.',
      'Try slight toe-in/out to steer early reflections.'
    ],
    reverb: [
      'Add curtains/soft furnishings to bring RT60 down.',
      'Cover large bare walls with absorbers/bookshelves.',
      'Use thicker panels to be effective below 1 kHz.'
    ]
  };

  const items = (tipMap[weakest] || tipMap.general).map(advice => ({ section: weakest, advice }));
  return { focus: weakest.replace('_','/'), items };
}


/* =================================================================== */
/* ==========================  S E C T I O N S  ======================= */
/* =================================================================== */

function extractSectionsAnywhere(payload){
  if (!payload || typeof payload !== 'object') return null;

  // Likely spots
  const candidates = [
    payload?.simple_view?.sections,
    payload?.sections,
    payload?.analysis?.sections,
    payload?.analysis,
    payload
  ];
  for (const node of candidates) {
    const secs = coerceSections(node);
    if (secs) return secs;
  }
  // Deep search
  return deepFindSections(payload);
}

function coerceSections(node){
  if (!node || typeof node !== 'object') return null;

  // object with named keys -> {key:{score}}
  const keys = ['bandwidth','balance','peaks_dips','smoothness','reflections','reverb'];
  const found = {};
  let hit = false;
  for (const k of keys) {
    const v = node[k] ?? node[k?.toUpperCase?.()];
    const s = v?.score ?? v?.value ?? v;
    const n = num(s);
    if (Number.isFinite(n)) { found[k] = { score: n }; hit = true; }
  }
  if (hit) return found;

  // array of {name,score}
  if (Array.isArray(node)) {
    for (const it of node) {
      const name = String(it?.name || it?.key || '').toLowerCase().replace(/\s+/g,'_');
      const n = num(it?.score ?? it?.value);
      if (name && Number.isFinite(n)) {
        found[name] = { score: n };
        hit = true;
      }
    }
    return hit ? found : null;
  }

  return null;
}

function deepFindSections(obj, depth=0){
  if (!obj || depth > 5) return null;
  const attempt = coerceSections(obj);
  if (attempt) return attempt;
  if (typeof obj === 'object') {
    for (const v of Object.values(obj)) {
      const r = deepFindSections(v, depth+1);
      if (r) return r;
    }
  }
  return null;
}

function pillClassFromScore(s) {
  if (s == null || isNaN(s)) return '';
  return s >= 8 ? 'great'
       : s >= 6.5 ? 'good'
       : s >= 5.5 ? 'ok'
       : s >= 4.5 ? 'warn'
       : 'poor';
}

/* =================================================================== */
/* =====================  T O P   A C T I O N S  ====================== */
/* =================================================================== */

function extractTopActionsAnywhere(payload){
  if (!payload || typeof payload !== 'object') return null;
  // Only accept ARRAY fields; do NOT treat random objects as tips
  const candidates = [
    payload?.simple_view?.top_actions,
    payload?.top_actions,
    payload?.analysis?.top_actions,
    payload?.analysis?.actions,
    payload?.recommendations,
    payload?.advice
  ];
  for (const node of candidates) {
    if (Array.isArray(node)) {
      const arr = normalizeTopActionsArray(node);
      if (arr?.length) return arr;
    }
  }
  return null; // no arrays => no API tips
}

function normalizeTopActionsArray(arr){
  const out = [];
  for (const it of arr) {
    if (typeof it === 'string') {
      const s = it.trim();
      if (s) out.push({ section: 'general', advice: s });
    } else if (it && typeof it === 'object') {
      const advice = (it.advice || it.text || it.tip || it.recommendation || it.title || '').trim();
      if (!advice) continue;
      const sectionRaw = (it.section || it.area || it.category || 'general') + '';
      const section = sectionRaw.toLowerCase().replace(/\s+/g,'_');
      out.push({ section, advice });
    }
  }
  return out;
}


function normalizeTopActions(node){
  if (!node) return null;
  const out = [];

  if (Array.isArray(node)) {
    for (const it of node) {
      if (typeof it === 'string') out.push({ section: 'general', advice: it });
      else if (typeof it === 'object') {
        const section = (it.section || it.area || it.category || 'general');
        const advice  = it.advice || it.text || it.tip || it.recommendation || it.title;
        if (advice) out.push({ section, advice });
      }
    }
  } else if (typeof node === 'object') {
    // Map<string,string|array>
    for (const [k,v] of Object.entries(node)) {
      if (typeof v === 'string') out.push({ section: k, advice: v });
      else if (Array.isArray(v)) {
        v.forEach(s => { if (typeof s === 'string') out.push({ section: k, advice: s }); });
      }
    }
  }
  return out.length ? out : null;
}

function deepFindTopActions(obj, depth=0){
  if (!obj || depth > 5) return null;
  const direct = normalizeTopActions(obj);
  if (direct?.length) return direct;
  if (typeof obj === 'object') {
    for (const v of Object.values(obj)) {
      const r = deepFindTopActions(v, depth+1);
      if (r?.length) return r;
    }
  }
  return null;
}

/* =================================================================== */
/* =====================  F R   E X T R A C T O R  ==================== */
/* =================================================================== */

function extractFRAnywhere(payload){
  if (!payload) return null;
  const shortcuts = [
    payload?.analysis,
    payload?.analysis?.graphs,
    payload?.analysis?.frequency_response,
    payload?.analysis?.fr,
    payload?.analysis?.fr_smoothed,
    payload?.frequency_response,
    payload?.fr,
    payload?.fr_smoothed,
    payload?.mini_fr,
    payload
  ];
  for (const node of shortcuts) {
    const fr = coerceToFR(node);
    if (fr?.length >= 8) return fr;
  }
  return deepSearchFR(payload);
}

function coerceToFR(node){
  if (isArrayLike(node)) {
    const fr = fromArray(toArray(node));
    if (fr?.length) return fr;
  }
  if (node && typeof node === 'object') {
    // Columnar vectors
    const variants = [
      ['f','l','r'], ['freq','L','R'], ['frequency','left','right'],
      ['frequency','left_db','right_db'], ['hz','magL','magR'],
      ['x','y'], ['frequency','magnitude'], ['f','mag']
    ];
    for (const keys of variants) {
      const fArr = toMaybeArray(node[keys[0]]);
      const aArr = toMaybeArray(node[keys[1]]);
      const bArr = toMaybeArray(node[keys[2]]);
      if (fArr && aArr && bArr && fArr.length === aArr.length && fArr.length === bArr.length) {
        const fr = fromVectors(fArr, aArr, bArr);
        if (fr?.length) return fr;
      }
      if (fArr && aArr && !bArr && fArr.length === aArr.length) {
        const fr = fromVectors(fArr, aArr, aArr);
        if (fr?.length) return fr;
      }
    }
    // Try any array field inside
    for (const v of Object.values(node)) {
      if (isArrayLike(v)) {
        const fr = fromArray(toArray(v));
        if (fr?.length) return fr;
      }
    }
  }
  return null;
}

function deepSearchFR(obj, depth=0){
  if (!obj || depth > 6) return null;
  if (isArrayLike(obj)) {
    const fr = fromArray(toArray(obj));
    return (fr?.length >= 8) ? fr : null;
  }
  if (typeof obj === 'object') {
    for (const v of Object.values(obj)) {
      const fr = coerceToFR(v) || deepSearchFR(v, depth+1);
      if (fr?.length >= 8) return fr;
    }
  }
  return null;
}

/* ---------- FR shape helpers ---------- */
function isArrayLike(x){ return Array.isArray(x) || (x && typeof x === 'object' && Number.isFinite(x.length)); }
function toArray(x){ return Array.isArray(x) ? x : (x && typeof x === 'object' && Number.isFinite(x.length) ? Array.from(x) : []); }
function toMaybeArray(x){ return isArrayLike(x) ? toArray(x) : null; }
function num(x){ const n = Number(x); return Number.isFinite(n) ? n : null; }
function inRange(n, lo, hi){ return n!=null && n>=lo && n<=hi; }
function pickNum(o, keys){ for (const k of keys){ const n = num(o?.[k]); if (n!=null) return n; } return null; }

function fromArray(arr){
  if (!arr || arr.length < 2) return null;
  const out = [];
  for (const p of arr){
    if (p == null) continue;
    if (isArrayLike(p)) {
      const a = toArray(p);
      const f = num(a[0]);
      const L = num(a[1]);
      const R = num(a[2] ?? a[1]);
      if (inRange(f, 5, 50000) && (L!=null || R!=null)) out.push({ f, l: L ?? R ?? 0, r: R ?? L ?? 0 });
      continue;
    }
    if (typeof p === 'object') {
      const f = pickNum(p, ['f','freq','frequency','hz','F','x']);
      let L = pickNum(p, ['l','L','left','left_db','dBL','magL','y','mag','magnitude','db','spl','value']);
      let R = pickNum(p, ['r','R','right','right_db','dBR','magR']);
      if (R == null) R = L;
      if (inRange(f, 5, 50000) && (L!=null || R!=null)) out.push({ f, l: L ?? R ?? 0, r: R ?? L ?? 0 });
      continue;
    }
  }
  out.sort((a,b)=> a.f - b.f);
  return out.length >= 2 ? out : null;
}

function fromVectors(fArr, aArr, bArr){
  const N = Math.min(fArr.length, aArr.length, bArr.length);
  const out = [];
  for (let i=0;i<N;i++){
    const f = num(fArr[i]);
    const L = num(aArr[i]);
    const R = num(bArr[i]);
    if (inRange(f, 5, 50000) && (L!=null || R!=null)) out.push({ f, l: L ?? R ?? 0, r: R ?? L ?? 0 });
  }
  out.sort((a,b)=> a.f - b.f);
  return out.length >= 2 ? out : null;
}

/* =================================================================== */
/* ============================  G R A P H  =========================== */
/* =================================================================== */

function renderFRGraph(host, rawFr, { frac=6 } = {}){
  const w = Math.max(360, Math.floor(host.getBoundingClientRect().width || 640));
  const h = Math.max(260, Math.floor(host.getBoundingClientRect().height || 360));
  const pad = { l: 46, r: 14, t: 8, b: 28 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;

  const fr = smoothFracOctDual(rawFr, frac);

  const fmin = Math.max(20, fr[0].f);
  const fmax = Math.min(20000, fr[fr.length-1].f);

  const mids = fr.map(p => (p.l + p.r) / 2).slice().sort((a,b)=>a-b);
  const med = mids[Math.floor(mids.length/2)] ?? 0;

  // Percentile-based Y window (clean auto-scale) with min ±12 dB around median
  const vals = fr.flatMap(p => [p.l, p.r]).filter(Number.isFinite);
  const pct = (arr, q) => { const a = arr.slice().sort((x,y)=>x-y); const i=(a.length-1)*q, lo=Math.floor(i), hi=Math.ceil(i); return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(i-lo); };
  const p10 = pct(vals, 0.10), p90 = pct(vals, 0.90);
  const ymin = Math.min(med - 12, p10 - 3);
  const ymax = Math.max(med + 12, p90 + 3);

  const xOfF = (f)=> pad.l + iw * logNorm(f, fmin, fmax);
  const yOfV = (v)=> pad.t + ih * (1 - clamp01((v - ymin)/(ymax - ymin)));

  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  svg.setAttribute('width','100%');
  svg.setAttribute('height','100%');
  host.appendChild(svg);

  // ±3 dB band
  rect(svg, pad.l, yOfV(med+3), iw, Math.abs(yOfV(med-3)-yOfV(med+3)), '#6a6a6a', 0.10);

  // grid + labels
  [20,50,100,200,500,1000,2000,5000,10000,20000].filter(f=>f>=fmin&&f<=fmax).forEach(f=>{
    line(svg, xOfF(f), pad.t, xOfF(f), pad.t+ih, '#999', .25);
    if ([100,1000,10000].includes(f)) text(svg, xOfF(f), h-6, f>=1000?`${f/1000}k`:`${f}`, 10, 'middle');
  });
  for (let v = Math.ceil(ymin/6)*6; v <= ymax; v+=6){
    const y = yOfV(v);
    line(svg, pad.l, y, pad.l+iw, y, '#999', .25);
    text(svg, pad.l-6, y+3, `${(v - med).toFixed(0)} dB`, 10, 'end');
  }
  // 0 dB reference (median)
  line(svg, pad.l, yOfV(med), pad.l + iw, yOfV(med), '#666', 0.35);

  // paths
  let pathsGroup = groupPaths([
    ['#1f77b4', fr.map(p=>[xOfF(p.f), yOfV(p.l)])],
    ['#d62728', fr.map(p=>[xOfF(p.f), yOfV(p.r)])],
  ]);
  svg.appendChild(pathsGroup);

  // hover readout
  const readout = document.createElement('div');
  Object.assign(readout.style, {position:'absolute',transform:'translate(-50%,-110%)',background:'rgba(0,0,0,.6)',color:'#fff',
    padding:'2px 6px',borderRadius:'4px',fontSize:'12px',pointerEvents:'none',display:'none'});
  host.style.position='relative'; host.appendChild(readout);

  const vline = line(svg, 0, pad.t, 0, pad.t+ih, '#333', .35); vline.style.display='none';

  const overlay=document.createElementNS(ns,'rect');
  overlay.setAttribute('x', pad.l); overlay.setAttribute('y', pad.t);
  overlay.setAttribute('width', iw); overlay.setAttribute('height', ih);
  overlay.setAttribute('fill','transparent'); svg.appendChild(overlay);

  const xs = fr.map(p=> xOfF(p.f));
  const nearestIndex = (x)=> {
    let lo=0, hi=xs.length-1;
    while (hi-lo>1){ const mid=(lo+hi)>>1; if (xs[mid] < x) lo=mid; else hi=mid; }
    return (x - xs[lo] < xs[hi] - x) ? lo : hi;
  };

  overlay.addEventListener('mousemove', (ev)=>{
    const rectB = svg.getBoundingClientRect();
    const x = Math.max(pad.l, Math.min(pad.l+iw, ev.clientX - rectB.left));
    const idx = nearestIndex(x);
    vline.setAttribute('x1', x); vline.setAttribute('x2', x); vline.style.display='';
    readout.style.left = `${x}px`; readout.style.top = `${pad.t}px`; readout.style.display = '';
    const f = fr[idx].f;
    readout.textContent = `${f>=1000 ? (f/1000).toFixed(2)+' kHz' : Math.round(f)+' Hz'} · L ${fr[idx].l.toFixed(1)} dB · R ${fr[idx].r.toFixed(1)} dB`;
  });
  overlay.addEventListener('mouseleave', ()=>{ vline.style.display='none'; readout.style.display='none'; });

  // zoom & pan; dblclick resets
  let f0 = fmin, f1 = fmax, lastX = null;
  function redraw(){
    const xOf = (f)=> pad.l + iw * logNorm(f, f0, f1);
    const newGroup = groupPaths([
      ['#1f77b4', fr.map(p=>[xOf(p.f), yOfV(p.l)])],
      ['#d62728', fr.map(p=>[xOf(p.f), yOfV(p.r)])],
    ]);
    svg.replaceChild(newGroup, pathsGroup);
    pathsGroup = newGroup;
  }
  host.addEventListener('wheel', (e)=>{
    e.preventDefault();
    const rectB = svg.getBoundingClientRect();
    const x = Math.max(pad.l, Math.min(pad.l+iw, e.clientX - rectB.left));
    const t = (x - pad.l) / iw;
    const a = Math.log10(f0), b = Math.log10(f1);
    const fx = Math.pow(10, a + t*(b-a));
    const factor = e.deltaY < 0 ? 0.9 : 1.1;
    const newA = Math.log10(fx) - (Math.log10(fx)-a)*factor;
    const newB = Math.log10(fx) + (b-Math.log10(fx))*factor;
    f0 = Math.max(10, Math.pow(10, newA));
    f1 = Math.min(24000, Math.pow(10, newB));
    redraw();
  }, { passive:false });
  host.addEventListener('mousedown', (e)=>{
    const rectB = svg.getBoundingClientRect();
    lastX = e.clientX - rectB.left;
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', onUp, { once:true });
  });
  host.addEventListener('dblclick', ()=>{ f0 = fmin; f1 = fmax; redraw(); });
  function onDrag(e){
    const rectB = svg.getBoundingClientRect();
    const x = e.clientX - rectB.left;
    const dx = (x - lastX) / iw;
    lastX = x;
    const a = Math.log10(f0), b = Math.log10(f1), span = b-a;
    let na = a - dx*span, nb = b - dx*span;
    const totalA = Math.log10(10), totalB = Math.log10(24000);
    if (na < totalA){ nb += (totalA - na); na = totalA; }
    if (nb > totalB){ na -= (nb - totalB); nb = totalB; }
    f0 = Math.pow(10, na); f1 = Math.pow(10, nb);
    redraw();
  }
  function onUp(){ window.removeEventListener('mousemove', onDrag); }
}

/* ---------- SVG helpers ---------- */
function groupPaths(specs){
  const ns='http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns,'g');
  for (const [color, pts] of specs){
    const p = document.createElementNS(ns,'path');
    p.setAttribute('d', toPath(pts));
    p.setAttribute('fill','none');
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width','1.6');
    p.setAttribute('vector-effect','non-scaling-stroke');
    g.appendChild(p);
  }
  return g;
}
function toPath(pts){
  let d=''; for (const [x,y] of pts){ d += (d?'L':'M') + x.toFixed(2)+','+y.toFixed(2); } return d;
}
function line(svg, x1,y1,x2,y2, color, opacity=1){
  const ns='http://www.w3.org/2000/svg';
  const l=document.createElementNS(ns,'line');
  l.setAttribute('x1',x1); l.setAttribute('y1',y1);
  l.setAttribute('x2',x2); l.setAttribute('y2',y2);
  l.setAttribute('stroke',color); l.setAttribute('opacity',String(opacity));
  svg.appendChild(l); return l;
}
function rect(svg, x,y,w,h, color, opacity=1){
  const ns='http://www.w3.org/2000/svg';
  const r=document.createElementNS(ns,'rect');
  r.setAttribute('x',x); r.setAttribute('y',y);
  r.setAttribute('width',w); r.setAttribute('height',h);
  r.setAttribute('fill',color); r.setAttribute('opacity',String(opacity));
  svg.appendChild(r); return r;
}
function text(svg, x,y, str, size=10, anchor='start'){
  const ns='http://www.w3.org/2000/svg';
  const t=document.createElementNS(ns,'text');
  t.setAttribute('x',x); t.setAttribute('y',y);
  t.setAttribute('font-size',String(size));
  t.setAttribute('text-anchor',anchor);
  t.textContent = str; svg.appendChild(t); return t;
}
function clamp01(v){ return Math.max(0, Math.min(1, v)); }
function logNorm(f, fmin, fmax){
  const ln = (x)=> Math.log10(Math.max(1e-9, x));
  return (ln(f)-ln(fmin))/(ln(fmax)-ln(fmin));
}

/* ---------- smoothing ---------- */
function smoothFracOctDual(fr, frac){
  if (!frac || frac <= 0) return fr.slice();
  const out=[]; const k = Math.pow(2, 1/frac)/2;
  for (let i=0;i<fr.length;i++){
    const fi = fr[i].f; const lo=fi/(1+k); const hi=fi*(1+k);
    let sl=0,sr=0,n=0;
    for (let j=i;j<fr.length;j++){
      const fj = fr[j].f; if (fj<lo) continue; if (fj>hi) break;
      sl += Number(fr[j].l ?? 0);
      sr += Number(fr[j].r ?? Number(fr[j].l ?? 0));
      n++;
    }
    if (n) out.push({f:fi, l:sl/n, r:sr/n});
  }
  return out;
}

/* ---------- demo ---------- */
function getDemoFR(){
  const N = 240, fmin=20, fmax=20000;
  const fr = [];
  for (let i=0;i<N;i++){
    const t = i/(N-1);
    const f = Math.pow(10, Math.log10(fmin) + t*(Math.log10(fmax)-Math.log10(fmin)));
    const wiggle = Math.sin(Math.log(f)*1.7)*2.2 + Math.cos(Math.log(f)*0.9)*1.1;
    const tilt = -0.0008*(f-1000);
    const mL = -3 + tilt + wiggle + (Math.random()*0.6-0.3);
    const mR = -3 + tilt + wiggle*0.9 + (Math.random()*0.6-0.3);
    fr.push({ f, l:mL, r:mR });
  }
  return fr;
}
function getDemoSections(){
  return {
    bandwidth:{score:7.8}, balance:{score:6.4}, peaks_dips:{score:5.6},
    smoothness:{score:6.2}, reflections:{score:7.0}, reverb:{score:6.8},
  };
}
