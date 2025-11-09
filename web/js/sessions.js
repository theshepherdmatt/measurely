// web/js/sessions.js
// Simplified sessions viewer — no oversized PNG graphs.

import { $, announce, fetchJSON } from './api.js';
import { renderSimpleAndGeek } from './results.js';
import { tryRenderPrettyGraphs } from './graphs.js';

const urlParams = new URLSearchParams(location.search);
const FULLBLEED = urlParams.has('fullbleed'); // ?fullbleed=1 for edge-to-edge view

function ensureGraphStyles(){
  if (document.getElementById('sessions-graphs-style')) return;
  const css = `
    #graphs {
      width: 100%;
      max-width: 1800px;
      margin: 28px auto 0;
    }
    .graphs-fullbleed #graphs {
      width: 100vw;
      max-width: 100vw;
      margin-left: calc(50% - 50vw);
    }
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

  // Render textual + base graphs
  await renderSimpleAndGeek(id);

  // Replace only if pretty graphs load successfully
  try {
    const prettyOK = await tryRenderPrettyGraphs(id);
    if (prettyOK) {
      announce?.('Loaded high-quality analysis graphs.');
    } else {
      announce?.('Standard results shown.');
    }
  } catch {
    announce?.('Standard results shown.');
  }
}
