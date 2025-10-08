// web/js/results.js
import { $, fetchJSON } from './api.js';

/* ---------- flags ---------- */
// Add ?debug=1 to your URL to show the Graphs Debug panel
const urlParams = new URLSearchParams(location.search);
const DEBUG_GRAPHS = urlParams.has('debug');
const FULLBLEED = new URLSearchParams(location.search).has('fullbleed'); // ?fullbleed=1 for edge-to-edge

/* ---------- helpers ---------- */
const pillClassFromScore = (s) =>
  (s == null || !Number.isFinite(Number(s))) ? '' :
  (s >= 8 ? 'great' : s >= 6.5 ? 'good' : s >= 5.5 ? 'ok' : s >= 4.5 ? 'warn' : 'poor');

const badgeText = (o) => {
  if (o == null || !Number.isFinite(Number(o))) return 'Unavailable';
  if (o >= 9)   return 'Excellent';
  if (o >= 7.5) return 'Good';
  if (o >= 6)   return 'Decent';
  if (o >= 4.5) return 'Fair';
  return 'Needs attention';
};

const fmtM = (v) => (v == null || !Number.isFinite(Number(v))) ? '—' : `${Number(v).toFixed(2)} m`;

const scoringBlurbHTML = `
  <p id="sectionScoresBlurb" class="small muted" style="margin:6px 0 10px 0;">
    Scores come from your last sweep compared to a neutral target (1/6-oct smoothed).
    We deduct points for L/R imbalance, large or narrow peaks/dips, limited bandwidth (−3 dB points),
    strong early reflections, and excessive reverb. A 10/10 means smooth (≈±3 dB), balanced, and well-damped.
  </p>
`;

/* ---------- tiny utils ---------- */
let _roomSettingsPromise = null;
async function getRoomSettings(){
  if (!_roomSettingsPromise) _roomSettingsPromise = fetchJSON('/api/settings').catch(() => ({}));
  return _roomSettingsPromise;
}
function topIssues(sections, n = 3){
  if (!sections || typeof sections !== 'object') return [];
  return Object.entries(sections)
    .map(([key, sec]) => ({
      key,
      score: (sec && typeof sec.score === 'number') ? sec.score : NaN,
      advice: (sec && (sec.advice_short || sec.advice || sec.note || sec.headline)) || ''
    }))
    .filter(x => Number.isFinite(x.score))
    .sort((a,b) => a.score - b.score)
    .slice(0, n);
}
function killNonePlaceholders(){
  const suspects = [
    $('summary'),
    document.querySelector('#resultCard .results-bottom-note'),
    document.querySelector('#resultCard .muted:last-of-type'),
  ];
  suspects.forEach(el => {
    const t = (el?.textContent || '').trim().toLowerCase();
    if (t === '(none)' || t === '(no summary)' || t === 'none' || t === 'no summary'){
      el.style.display = 'none'; el?.setAttribute?.('aria-hidden','true');
    }
  });
}

/* ---------- side-by-side styles (MUCH bigger, blue/red) ---------- */
function ensureGraphsStyles(){
  if (document.getElementById('graphs-style')) return;
  const css = `
    /* default huge container */
    #graphs { width: 100%; max-width: 3200px; margin: 28px auto 0; }

    /* optional full-bleed: go edge-to-edge of the viewport */
    .graphs-fullbleed #graphs {
      width: 100vw;
      max-width: 100vw;
      margin-left: calc(50% - 50vw); /* center the full-bleed container */
      margin-right: 0;
    }

    /* Side-by-side grid, bigger gaps */
    .graphs-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 36px;
    }
    @media (max-width: 1400px){ .graphs-grid { grid-template-columns: 1fr; gap: 28px; } }

    /* Big cards */
    .graph-fig {
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 6px 32px rgba(0,0,0,.16);
      padding: 18px 18px 22px;
      overflow: hidden;
    }
    .graph-fig.left  { border-top: 10px solid #1e90ff; } /* blue */
    .graph-fig.right { border-top: 10px solid #e53935; } /* red  */

    /* Images stretch to card width (so they get BIG) */
    .graph-fig img {
      width: 100%;
      height: auto;
      display: block;
      border-radius: 12px;
    }

    /* Larger captions */
    .graph-fig figcaption {
      text-align: center;
      margin-top: 10px;
      font-size: 16px;
      line-height: 1.3;
      opacity: .95;
      font-weight: 600;
    }
    .graph-fig.left  figcaption { color: #1e90ff; }
    .graph-fig.right figcaption { color: #e53935; }
  `;
  const el = document.createElement('style');
  el.id = 'graphs-style';
  el.textContent = css;
  document.head.appendChild(el);
}

/* ---------- DEBUG UI (only with ?debug=1) ---------- */
function ensureDebugPanel(){
  if (!DEBUG_GRAPHS) return null;
  const card = document.getElementById('resultCard') || document.body;
  let dbg = $('graphs-debug');
  if (!dbg){
    dbg = document.createElement('div');
    dbg.id = 'graphs-debug';
    dbg.style.cssText = 'margin-top:10px;padding:10px;border:1px dashed #999;border-radius:8px;font-size:12px;line-height:1.4;background:#fafafa;';
    dbg.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <strong>Graphs Debug</strong>
        <span id="gd-measid" style="opacity:.8"></span>
        <input id="gd-override" placeholder="paste measId (folder name)" style="min-width:220px;padding:4px 6px">
        <button id="gd-set" style="padding:4px 8px;border-radius:6px;border:1px solid #bbb;background:#fff;cursor:pointer">Set</button>
        <button id="gd-recheck" style="padding:4px 8px;border-radius:6px;border:1px solid #bbb;background:#fff;cursor:pointer">Re-check</button>
      </div>
      <div id="gd-urls" style="margin-top:6px;word-break:break-all"></div>
      <div id="gd-status" style="margin-top:6px"></div>
    `;
    card.appendChild(dbg);
    // wire buttons
    dbg.querySelector('#gd-set')?.addEventListener('click', () => {
      const v = (dbg.querySelector('#gd-override')?.value || '').trim();
      if (v){ window.currentMeasurementId = v; renderGraphsForId(v, true); }
    });
    dbg.querySelector('#gd-recheck')?.addEventListener('click', async () => {
      const simple = await fetchJSON('/api/simple').catch(()=>({}));
      const geek   = await fetchJSON('/api/geek').catch(()=>({}));
      resolveMeasId(null, simple, geek).then(id => renderGraphsForId(id, true));
    });
  }
  return dbg;
}
function setDebugInfo(id, leftURL, rightURL){
  if (!DEBUG_GRAPHS) return;
  const dbg = ensureDebugPanel();
  const mid = dbg.querySelector('#gd-measid');
  const urls = dbg.querySelector('#gd-urls');
  mid.textContent = id ? `· measId: ${id}` : '· measId: (none)';
  urls.innerHTML = `
    <div>Left: <code>${leftURL || '(n/a)'}</code></div>
    <div>Right: <code>${rightURL || '(n/a)'}</code></div>
  `;
}
async function updateDebugStatus(leftURL, rightURL){
  if (!DEBUG_GRAPHS) return;
  const st = $('gd-status'); if (!st) return;
  st.textContent = 'Checking…';
  const check = async (url) => {
    if (!url) return { ok:false, code:'n/a' };
    try {
      let r = await fetch(url, { method:'HEAD', cache:'no-store' });
      if (!r.ok) throw { code:r.status };
      return { ok:true, code:r.status };
    } catch {
      try {
        let r2 = await fetch(url, { method:'GET', headers:{Range:'bytes=0-0'}, cache:'no-store' });
        return { ok:r2.ok, code:r2.status };
      } catch {
        return { ok:false, code:'net' };
      }
    }
  };
  const [L, R] = await Promise.all([check(leftURL), check(rightURL)]);
  const pill = (res,label)=>`<span style="display:inline-block;padding:2px 6px;margin-left:6px;border-radius:10px;${res.ok?'background:#e6f7ea;color:#0a7a2d;border:1px solid #9ad3a9':'background:#fdeaea;color:#8a0f0f;border:1px solid #e6a1a1'}">${label} ${res.ok?'✅':'❌'} (HTTP ${res.code})</span>`;
  st.innerHTML = `Left ${pill(L,'left')} Right ${pill(R,'right')}`;
}

/* ---------- graphs (side-by-side) ---------- */
function ensureGraphsContainer(){
  ensureGraphsStyles();
  if (FULLBLEED) document.documentElement.classList.add('graphs-fullbleed');

  const card = document.getElementById('resultCard') || document.body;
  let g = $('graphs');
  if (!g) {
    g = document.createElement('div');
    g.id = 'graphs';
    g.className = 'muted';
    g.setAttribute('role', 'region');
    g.setAttribute('aria-label', 'Analysis graphs');
    card.appendChild(g);
  } else if (g.parentElement !== card) {
    card.appendChild(g);
  }
  g.innerHTML = '';
  return g;
}

function imgEl(src, alt){
  const img = new Image();
  img.alt = alt;
  img.decoding = 'async';
  img.loading = 'lazy';
  img.src = src;
  return img;
}

async function renderGraphsForId(measId){
  const g = ensureGraphsContainer();

  const bust = `?v=${Date.now()}`;
  const leftURL  = measId ? `/measurements/${measId}/left/response.png${bust}`  : null;
  const rightURL = measId ? `/measurements/${measId}/right/response.png${bust}` : null;

  ensureDebugPanel();
  setDebugInfo(measId || null, leftURL, rightURL);
  updateDebugStatus(leftURL, rightURL);

  if (!measId){
    g.innerHTML = '<div class="small muted">No measurement ID found. Cannot load graphs.</div>';
    killNonePlaceholders();
    return;
  }

  // Big side-by-side grid
  const grid = document.createElement('div');
  grid.className = 'graphs-grid';

  // Left (blue)
  const figL = document.createElement('figure');
  figL.className = 'graph-fig left';
  figL.appendChild(imgEl(leftURL, 'Left response'));
  const capL = document.createElement('figcaption');
  capL.textContent = 'Left response';
  figL.appendChild(capL);

  // Right (red)
  const figR = document.createElement('figure');
  figR.className = 'graph-fig right';
  figR.appendChild(imgEl(rightURL, 'Right response'));
  const capR = document.createElement('figcaption');
  capR.textContent = 'Right response';
  figR.appendChild(capR);

  grid.appendChild(figL);
  grid.appendChild(figR);
  g.appendChild(grid);

  killNonePlaceholders();
}

/* ---------- measId resolver ---------- */
function uniqPush(arr, v){ if (v==null) return; const s=String(v); if (!arr.includes(s)) arr.push(s); }
async function headOk(url){
  try {
    const r = await fetch(url, { method:'HEAD', cache:'no-store' });
    if (r.ok) return true;
  } catch {}
  try {
    const r2 = await fetch(url, { method:'GET', headers:{Range:'bytes=0-0'}, cache:'no-store' });
    return r2.ok;
  } catch { return false; }
}
async function tryValidateId(id){
  if (!id) return false;
  const bust = `?v=${Date.now()}`;
  const L = `/measurements/${id}/left/response.png${bust}`;
  const R = `/measurements/${id}/right/response.png${bust}`;
  const [okL, okR] = await Promise.all([headOk(L), headOk(R)]);
  return okL && okR;
}
function extractSessionIds(payload){
  const out = [];
  const pushFrom = (x)=>{
    if (!x) return;
    const cand = x.measid || x.sid || x.session_id || x.id || x.timestamp || x.folder || x.uuid;
    uniqPush(out, cand);
  };
  if (Array.isArray(payload)) payload.forEach(pushFrom);
  if (Array.isArray(payload?.sessions)) payload.sessions.forEach(pushFrom);
  if (Array.isArray(payload?.data)) payload.data.forEach(pushFrom);
  if (payload?.latest) pushFrom(payload.latest);
  return out;
}
async function resolveMeasId(optionalSid, simple, analysis){
  const candidates = [];
  uniqPush(candidates, optionalSid);
  uniqPush(candidates, simple?.measid);
  uniqPush(candidates, simple?.sid);
  uniqPush(candidates, simple?.session_id);
  uniqPush(candidates, analysis?.measurement_id);
  uniqPush(candidates, analysis?.session_id);
  uniqPush(candidates, analysis?.sid);
  uniqPush(candidates, analysis?.timestamp);
  uniqPush(candidates, window.currentMeasurementId);

  for (const id of candidates){ if (await tryValidateId(id)) return id; }

  try {
    const sessions = await fetchJSON('/api/sessions').catch(()=>null);
    const ids = extractSessionIds(sessions);
    for (const id of ids){ if (await tryValidateId(id)) return id; }
  } catch {}

  try {
    const ls = await fetchJSON('/api/simple?latest=1').catch(()=>null);
    const lsid = ls?.measid || ls?.sid || ls?.session_id || ls?.timestamp;
    if (await tryValidateId(lsid)) return lsid;
  } catch {}

  try {
    const lg = await fetchJSON('/api/geek?latest=1').catch(()=>null);
    const gsid = lg?.analysis?.measurement_id || lg?.analysis?.sid || lg?.analysis?.session_id || lg?.analysis?.timestamp;
    if (await tryValidateId(gsid)) return gsid;
  } catch {}

  return null;
}

/* ---------- main renderers ---------- */
async function renderResultsStructured(simple){
  const wrap = $('results-structured'); if (!wrap) return;
  wrap.innerHTML = '';

  const overall = document.createElement('div');
  overall.className = 'result-box';
  const overallScore = Number(simple?.overall);
  const scoreTxt = Number.isFinite(overallScore) ? overallScore.toFixed(1) : '—';
  overall.innerHTML = `
    <div class="result-head">
      <span class="result-label">Room score</span>
      <span class="result-pill ${pillClassFromScore(overallScore)}">
        ${scoreTxt} / 10 · ${badgeText(overallScore)}
      </span>
    </div>
    <p class="result-desc">${simple?.headline || '—'}</p>
  `;

  try {
    const settings = await getRoomSettings();
    const r = settings?.room || {};
    overall.insertAdjacentHTML('beforeend', `
      <ul class="small muted" style="margin:8px 0 0 18px;">
        <li><b>Dimensions:</b> ${fmtM(r.length_m)} × ${fmtM(r.width_m)} × ${fmtM(r.height_m)}</li>
        <li><b>Speaker spacing:</b> ${fmtM(r.spk_spacing_m)}</li>
        <li><b>Speaker → front wall:</b> ${fmtM(r.spk_front_m)}</li>
        <li><b>Listener → front wall:</b> ${fmtM(r.listener_front_m)}</li>
      </ul>
    `);
  } catch {}

  const issues = topIssues(simple?.sections, 3);
  if (issues.length){
    overall.insertAdjacentHTML('beforeend', `
      <div class="subhead" style="margin-top:10px;">Highlights</div>
      <ul class="result-actions" style="margin-left:18px;">
        ${issues.map(i => {
          const label = i.key.replace('_', '/');
          const s = Number.isFinite(i.score) ? ` (${i.score.toFixed(1)}/10)` : '';
          const tip = i.advice || 'Needs attention.';
          return `<li><b>${label}${s}:</b> ${tip}</li>`;
        }).join('')}
      </ul>
    `);
  }

  wrap.appendChild(overall);

  const actions = Array.isArray(simple?.top_actions) ? simple.top_actions : [];
  if (actions.length){
    const actionsBox = document.createElement('div');
    actionsBox.className = 'result-box';
    const ol = document.createElement('ol'); ol.className = 'result-actions';
    actions.forEach(a => {
      const name = String(a?.section || 'advice').replace('_', ' ');
      const scoreTxt = (typeof a?.score === 'number') ? ` (${a?.score.toFixed(1)}/10)` : '';
      const li = document.createElement('li');
      li.innerHTML = `<b>${name}${scoreTxt}:</b> ${a?.advice || ''}`;
      ol.appendChild(li);
    });
    actionsBox.innerHTML = `<div class="result-label">How to improve your score</div>`;
    actionsBox.appendChild(ol);
    wrap.appendChild(actionsBox);
  }

  const secCard = $('sectionScoresCard');
  const secWrap = $('sectionScoresGrid');
  if (secCard && secWrap){
    if (!$('sectionScoresBlurb')) secWrap.insertAdjacentHTML('beforebegin', scoringBlurbHTML);
    secWrap.innerHTML = '';
    const order = ['bandwidth','balance','peaks_dips','smoothness','reflections','reverb'];
    let rendered = 0;
    order.forEach(k => {
      const sec = simple?.sections?.[k] || {};
      const score = (typeof sec.score === 'number') ? sec.score : NaN;
      const label = k.replace('_', '/');
      const box = document.createElement('div');
      box.className = 'mly-item';
      box.innerHTML = `
        <span class="result-label">${label}</span>
        <span class="mly-pill ${pillClassFromScore(score)}">${Number.isFinite(score) ? score.toFixed(1) : '—'}/10</span>
      `;
      secWrap.appendChild(box);
      rendered++;
    });
    secCard.style.display = rendered ? 'block' : 'none';
  } else {
    if (!overall.querySelector('#sectionScoresBlurb')) {
      overall.insertAdjacentHTML('beforeend', scoringBlurbHTML);
    }
  }
}

function renderGeek(analysis){
  const box = $('mly-geek-json');
  if (box) box.textContent = JSON.stringify(analysis ?? {}, null, 2);
}

/* ---------- public API ---------- */
export async function renderSimpleAndGeek(optionalSid){
  // Ensure the graphs container exists + styles are applied
  ensureGraphsContainer();

  // Build the debug panel only if requested
  ensureDebugPanel();

  // Fetch data
  const sidQuery = optionalSid ? `?sid=${encodeURIComponent(optionalSid)}` : '';
  const simpleRes = await fetchJSON(`/api/simple${sidQuery}`).catch(() => ({}));
  const geekRes   = await fetchJSON(`/api/geek${sidQuery}`).catch(() => ({}));

  const simple   = simpleRes?.simple_view ? simpleRes.simple_view : simpleRes;
  const analysis = geekRes?.analysis     ? geekRes.analysis       : geekRes;

  await renderResultsStructured(simple || {});
  renderGeek(analysis || {});
  killNonePlaceholders();

  const measId = await resolveMeasId(optionalSid, simple || {}, analysis || {});
  if (measId) window.currentMeasurementId = measId;

  await renderGraphsForId(measId);
}
