import { $, announce, fetchJSON } from './api.js';
import { renderSimpleAndGeek } from './results.js';
import { tryRenderPrettyGraphs } from './graphs.js';

const urlParams = new URLSearchParams(location.search);
const FULLBLEED = urlParams.has('fullbleed'); // ?fullbleed=1 for edge-to-edge

function ensureGraphStyles(){
  if (document.getElementById('sessions-graphs-style')) return;
  const css = `
    /* match results.js sizing */
    #graphs {
      width: 100%;
      max-width: 3200px;
      margin: 28px auto 0;
    }

    /* optional full-bleed: go edge-to-edge of the viewport */
    .graphs-fullbleed #graphs {
      width: 100vw;
      max-width: 100vw;
      margin-left: calc(50% - 50vw);
      margin-right: 0;
    }

    /* Side-by-side grid, bigger gaps */
    .graphs-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 36px;
    }
    @media (max-width: 1400px){
      .graphs-grid { grid-template-columns: 1fr; gap: 28px; }
    }

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
      border: 1.25px solid var(--border);
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
  el.id = 'sessions-graphs-style';
  el.textContent = css;
  document.head.appendChild(el);
  if (FULLBLEED) document.documentElement.classList.add('graphs-fullbleed');
}

export async function fetchSessions(){
  try{
    const data = await fetchJSON('/api/sessions');
    const el = $('sessions');
    if(!Array.isArray(data) || !data.length){
      el.textContent='(none)'; 
      return;
    }
    el.classList.remove('muted');
    el.innerHTML = data.map(s=>`<a href="#" data-sid="${s.id}">${s.id}</a>`).join('');
    // delegate clicks
    el.onclick = (e)=>{
      const a = e.target.closest('a[data-sid]');
      if(!a) return;
      e.preventDefault();
      openSession(a.dataset.sid);
    };
  }catch{
    $('sessions').textContent='(error)';
  }
}

export async function openSession(id){
  ensureGraphStyles();

  const d = await fetchJSON('/api/session/'+id).catch(()=>({}));
  $('resultCard').style.display='block';
  if ($('summary')) $('summary').textContent = d.summary || '(no summary)';

  // Always render textual results + standard L/R graphs first
  await renderSimpleAndGeek(id);

  // From here on, we only REPLACE the existing graphs if we actually have something to show.
  const graphsEl = $('graphs');
  let replaced = false;

  // 1) Try pretty graphs (canvas/SVG etc.)
  try {
    const prettyOK = await tryRenderPrettyGraphs(id);
    if (prettyOK) {
      replaced = true;
      announce?.('Loaded high-quality analysis graphs.');
    }
  } catch { /* ignore and fallback */ }

  // 2) If no pretty graphs, try PNG artifacts served by the session API
  if (!replaced) {
    const pngs = (d.artifacts || []).filter(a => /\.png$/i.test(a));
    if (pngs.length) {
      graphsEl.classList.remove('muted');
      graphsEl.innerHTML = '';

      // Build side-by-side grid, try to detect left/right by filename
      const grid = document.createElement('div');
      grid.className = 'graphs-grid';

      const norm = (s)=>String(s).toLowerCase();
      const isLeft  = (s)=>/(^|[\\/_\\-\\s])left([\\/_\\-\\s]|$)/.test(norm(s));
      const isRight = (s)=>/(^|[\\/_\\-\\s])right([\\/_\\-\\s]|$)/.test(norm(s));

      const lefts  = pngs.filter(isLeft);
      const rights = pngs.filter(isRight);
      const other  = pngs.filter(a => !isLeft(a) && !isRight(a));
      const ordered = [...lefts, ...rights, ...other];

      ordered.forEach((a,i)=>{
        const isL = isLeft(a) || (i === 0 && !isRight(a));
        const isR = isRight(a);
        const sideClass = isL ? 'left' : (isR ? 'right' : '');
        const cap = isL ? 'Left response' : (isR ? 'Right response' : (String(a).replace(/\.png$/i,'').replace(/[-_]/g,' ')));

        const fig = document.createElement('figure');
        fig.className = `graph-fig ${sideClass}`.trim();

        const img = document.createElement('img');
        img.alt = `Graph: ${cap}`;
        img.src = `/api/session/${encodeURIComponent(id)}/artifact/${encodeURIComponent(a)}`;

        const fc = document.createElement('figcaption');
        fc.textContent = cap;

        fig.appendChild(img);
        fig.appendChild(fc);
        grid.appendChild(fig);
      });

      graphsEl.appendChild(grid);
      graphsEl.setAttribute('tabindex','-1');
      graphsEl.focus();
      announce?.(`Loaded ${pngs.length} analysis graphs.`);
      replaced = true;
    }
  }

  // 3) If nothing replaced, leave the L/R images from results.js alone.
  if (!replaced) {
    const hasSomething = graphsEl && graphsEl.innerHTML && graphsEl.innerHTML.trim().length > 0;
    if (!hasSomething) {
      graphsEl.classList.add('muted');
      graphsEl.textContent = '(none)';
    }
  }
}
