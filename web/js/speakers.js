// web/js/speakers.js
// Minimal, accessible speaker-profile selector for MeasureLy

// --- tiny helpers (work with your existing $()/announce() if present) ---
const $ = (id) => document.getElementById(id);
function announce(msg){
  const live = $('sr-announcer'); if(!live) return;
  // flush then speak to SR
  live.textContent = ''; setTimeout(()=>{ live.textContent = msg; }, 10);
}

// --- state ---
let SPEAKERS_INDEX = {};
let CURRENT_KEY = null;

// localStorage keys
const LS_KEY = 'mly.speaker.key';

// --- public getters ---
export function currentSpeakerKey(){ return CURRENT_KEY; }
export function currentSpeaker(){
  if(!CURRENT_KEY) return null;
  return SPEAKERS_INDEX[CURRENT_KEY] || null;
}

// Append CLI args for backend runner (array of strings)
export function appendSpeakerArgs(args){
  const key = currentSpeakerKey();
  if(key) args.push('--speaker', key);
  return args;
}

// --- init entrypoint ---
export async function initSpeakers(){
  await loadSpeakersIndex();
  renderSpeakerUI();
  restoreSelection();
  wireEvents();
}

// --- load speakers.json ---
async function loadSpeakersIndex(){
  try{
    const res = await fetch('./speakers/speakers.json', {cache:'no-store'});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Expect { "quad_esl57": { name, folder, target_curve, ... }, ... }
    SPEAKERS_INDEX = data || {};
  }catch(err){
    console.warn('[speakers] Could not load speakers.json:', err);
    SPEAKERS_INDEX = {};
  }
}

// --- UI render: insert into Room & speaker placement card ---
function renderSpeakerUI(){
  // Find the Room & speaker placement card by its heading id used in index.html
  const roomCard = document.querySelector('section.card.compact[aria-labelledby="room-heading"]');
  if(!roomCard) return;

  // Create a tidy row above the "Save room & placement" actions
  // Insert just before the .actions block if present
  const actions = roomCard.querySelector('.actions');

  const wrap = document.createElement('div');
  wrap.className = 'subsection';
  wrap.id = 'speakerWrap';

  const label = document.createElement('label');
  label.className = 'subhead';
  label.id = 'speakerSelHelp';
  label.setAttribute('for', 'speakerSel');
  label.textContent = 'Speaker profile';

  const sel = document.createElement('select');
  sel.id = 'speakerSel';
  sel.setAttribute('aria-describedby', 'speakerSelHelp');

  // First option: none
  const optNone = document.createElement('option');
  optNone.value = '';
  optNone.textContent = '— None (generic sweep) —';
  sel.appendChild(optNone);

  // Populate from index
  Object.entries(SPEAKERS_INDEX).forEach(([key, prof])=>{
    const o = document.createElement('option');
    o.value = key;
    o.textContent = prof?.name || key;
    sel.appendChild(o);
  });

  const hint = document.createElement('div');
  hint.id = 'speakerHint';
  hint.className = 'small muted';
  hint.style.marginTop = '6px';
  hint.setAttribute('role','status');
  hint.setAttribute('aria-live','polite');
  hint.textContent = 'Choose a profile to auto-set safe sweep bounds and target curve (e.g. Quad ESL-57).';

  wrap.appendChild(label);
  wrap.appendChild(sel);
  wrap.appendChild(hint);

  if(actions?.parentNode){
    actions.parentNode.insertBefore(wrap, actions);
  }else{
    roomCard.appendChild(wrap);
  }
}

// --- restore persisted selection ---
function restoreSelection(){
  const key = localStorage.getItem(LS_KEY) || '';
  const sel = $('speakerSel');
  if(!sel) return;
  if(key && sel.querySelector(`option[value="${cssEscape(key)}"]`)){
    sel.value = key;
    CURRENT_KEY = key;
    updateHint();
  }else{
    sel.value = '';
    CURRENT_KEY = null;
    updateHint();
  }
}

// --- events ---
function wireEvents(){
  const sel = $('speakerSel'); if(!sel) return;
  sel.addEventListener('change', ()=>{
    const key = sel.value || '';
    CURRENT_KEY = key || null;
    if(key) localStorage.setItem(LS_KEY, key);
    else localStorage.removeItem(LS_KEY);
    updateHint();
    // notify other modules
    document.dispatchEvent(new CustomEvent('mly:speaker-changed', { detail:{ key, profile: currentSpeaker() }}));
    announce(key ? `Speaker profile set to ${currentSpeaker()?.name || key}` : 'Speaker profile cleared');
  });
}

// --- hint/status text ---
function updateHint(){
  const hint = $('speakerHint'); if(!hint) return;
  const prof = currentSpeaker();
  if(!prof){
    hint.textContent = 'Generic sweep. No speaker-specific limits or targets applied.';
    return;
  }
  const parts = [];
  if(prof.sweep_start_hz) parts.push(`start ${prof.sweep_start_hz} Hz`);
  if(prof.sweep_end_hz)   parts.push(`end ${prof.sweep_end_hz} Hz`);
  if(prof.safe_level_dbfs !== undefined) parts.push(`max level ${prof.safe_level_dbfs} dBFS`);
  hint.textContent = `${prof.name} • ${parts.join(' • ') || 'custom profile loaded'}`;
}

// Polyfill for CSS.escape (older browsers)
function cssEscape(s){
  return s.replace(/"/g, '\\"');
}
