// web/js/speakers.js  --  MINIMAL, CLEAN
const LS_KEY = 'mly.speaker.key';

export async function initSpeakers(){
  console.log('[spk] initSpeakers() started');

  // 1. load index
  const res = await fetch('/speakers/speakers.json', {cache:'no-store'});
  if(!res.ok){ console.warn('[spk] speakers.json failed:', res.status); return; }
  const index = await res.json();          // { quad_esl57:{ name, ... }, ... }
  console.log('[spk] index loaded:', Object.keys(index).length, 'profiles');

  // 2. fill the <select> that already exists
  const sel = document.getElementById('speakerSel');
  if(!sel){ console.warn('[spk] #speakerSel not found'); return; }

  sel.innerHTML = '';                                           // clear
  sel.appendChild(new Option('— None (generic sweep) —', '')); // default

  Object.entries(index).forEach(([key, prof]) =>
    sel.appendChild(new Option(prof.name || key, key))
  );
  console.log('[spk] filled dropdown with', sel.options.length - 1, 'profiles');

  // 3. restore last choice
  const saved = localStorage.getItem(LS_KEY);
  if(saved && sel.querySelector(`option[value="${CSS.escape(saved)}"]`)) sel.value = saved;

  // 4. hint updater
  const hint = document.getElementById('speakerHint');
  const updateHint = () => {
    const prof = index[sel.value];
    hint.textContent = prof
      ? `${prof.name} • start ${prof.sweep_start_hz || '?'} Hz • end ${prof.sweep_end_hz || '?'} Hz • max ${prof.safe_level_dbfs || '?'} dBFS`
      : 'Generic sweep. No speaker-specific limits or targets applied.';
  };
  updateHint();
  sel.addEventListener('change', () => {
    localStorage.setItem(LS_KEY, sel.value);
    updateHint();
  });
}