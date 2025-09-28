import { $, announce, fetchJSON } from './api.js';
import { renderSimpleAndGeek } from './results.js';
import { tryRenderPrettyGraphs } from './graphs.js';

export async function fetchSessions(){
  try{
    const data = await fetchJSON('/api/sessions');
    const el = $('sessions');
    if(!Array.isArray(data)||!data.length){ el.textContent='(none)'; return; }
    el.classList.remove('muted');
    el.innerHTML = data.map(s=>`<a href="#" data-sid="${s.id}">${s.id}</a>`).join('');
    // delegate clicks
    el.onclick = (e)=>{
      const a = e.target.closest('a[data-sid]');
      if(!a) return;
      e.preventDefault();
      openSession(a.dataset.sid);
    };
  }catch{ $('sessions').textContent='(error)'; }
}

export async function openSession(id){
  const d = await fetchJSON('/api/session/'+id);
  $('resultCard').style.display='block';
  $('summary').textContent=d.summary||'(no summary)';

  await renderSimpleAndGeek(id);

  // pretty graph first, fallback to PNGs
  const prettyOK = await tryRenderPrettyGraphs(id);
  const graphsEl=$('graphs');
  graphsEl.innerHTML='';
  if(!prettyOK){
    const pngs=(d.artifacts||[]).filter(a=>/\.png$/i.test(a));
    if(pngs.length){
      graphsEl.classList.remove('muted');
      graphsEl.innerHTML=pngs.map((a,i)=>{
        const clean=String(a).replace(/\.png$/i,'').replace(/[-_]/g,' ');
        const alt=`Graph ${i+1}: ${clean}`;
        return `<img alt="${alt}" src="/api/session/${id}/artifact/${encodeURIComponent(a)}"
                 style="display:block;max-width:100%;height:auto;border:1.25px solid var(--border);border-radius:10px;">`;
      }).join('');
      graphsEl.setAttribute('tabindex','-1'); graphsEl.focus();
      announce(`Loaded ${pngs.length} analysis graphs.`);
    }else{
      graphsEl.classList.add('muted'); graphsEl.textContent='(none)';
    }
  }
}
