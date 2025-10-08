// tiny DOM + ARIA helpers used everywhere
export const $ = (id) => document.getElementById(id);
export function announce(msg){
  const live = $('sr-announcer'); if(!live) return;
  live.textContent = ''; setTimeout(()=>{ live.textContent = msg; }, 10);
}
export function setBusy(el,b=true){ el && el.setAttribute('aria-busy', b?'true':'false'); }
export function setDisabled(el,d=true){ if(!el) return; el.disabled=d; el.setAttribute('aria-disabled', d?'true':'false'); }
export async function fetchJSON(url, opts = {}) {
  // If they passed a plain object as body, JSON-encode it and set header
  const init = { cache: 'no-store', ...opts };
  if (init.body && typeof init.body === 'object' && !(init.body instanceof FormData)) {
    init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    init.body = JSON.stringify(init.body);
  }
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

// friendly device name
export function simplifyName(raw){
  if(!raw) return '';
  const bracket = String(raw).match(/\[([^\]]+)\]/); if(bracket) return bracket[1];
  let s = String(raw)
    .replace(/card\s*\d+\s*:?\s*/i,'')
    .replace(/device\s*\d+\s*:?\s*/i,'')
    .replace(/\balsa\b/ig,'').replace(/snd[-_]?/ig,'')
    .replace(/\s*\([^)]*\)\s*/g,' ').trim();
  const l = s.toLowerCase();
  if(l.includes('hifiberry')) return 'HiFiBerry DAC';
  if(l.includes('fa123') || l.includes('hypex')) return 'Hypex FA123';
  if(l.includes('qutest') || l.includes('2qute')) return 'Chord DAC';
  if(l.includes('usb audio')) return 'USB Audio DAC';
  if(l.includes('codec') && l.includes('bcm')) return 'Pi audio';
  return s.split(/[\n,]/)[0].trim().replace(/\s{2,}/g,' ');
}


export async function filterGenerate(){
  return fetchJSON('/api/filter', { method: 'POST' });
}
