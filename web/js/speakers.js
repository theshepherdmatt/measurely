// web/js/speakers.js

const LS_KEY = 'mly.speaker.key';

export async function initSpeakers() {
  console.log('[spk] initSpeakers() started');

  // 1. Load speakers.json
  const res = await fetch('/speakers/speakers.json', { cache: 'no-store' });
  if (!res.ok) {
    console.warn('[spk] speakers.json failed:', res.status);
    return;
  }

  const index = await res.json();
  console.log('[spk] loaded profiles:', Object.keys(index).length);

  // 🔥🔥 ADD THIS 🔥🔥
  window.SPEAKERS = index;
  console.log('[spk] window.SPEAKERS initialised');

  // 2. Find <select> element
  const sel = document.getElementById('speakerSel');
  if (!sel) {
    console.warn('[spk] #speakerSel not found');
    return;
  }

  sel.innerHTML = ''; // clear existing

  // Default top entry
  sel.appendChild(new Option('— None (generic sweep) —', ''));

  // Build grouped dropdown
  const spotlightGroup = document.createElement('optgroup');
  spotlightGroup.label = 'Spotlight Models';

  const categoryGroup = document.createElement('optgroup');
  categoryGroup.label = 'Speaker Categories';

  Object.entries(index).forEach(([key, prof]) => {
    const label = prof.name || key;
    const opt = new Option(label, key);

    if (prof.type === 'spotlight') {
      spotlightGroup.appendChild(opt);
    } else if (prof.type === 'category') {
      categoryGroup.appendChild(opt);
    } else {
      // fallback to category group if unspecified
      categoryGroup.appendChild(opt);
    }
  });

  // Only append groups if they have children
  if (spotlightGroup.children.length > 0) sel.appendChild(spotlightGroup);
  if (categoryGroup.children.length > 0) sel.appendChild(categoryGroup);

  console.log('[spk] dropdown built:',
    sel.options.length - 1, 'profiles');

  // 3. Restore saved selection
  const saved = localStorage.getItem(LS_KEY);
  if (saved && sel.querySelector(`option[value="${CSS.escape(saved)}"]`)) {
    sel.value = saved;
  }

  // 4. Hint updater
  const hint = document.getElementById('speakerHint');
  const updateHint = () => {
    const prof = index[sel.value];

    if (!prof) {
      hint.textContent = 'Generic sweep — no speaker-specific behaviour applied.';
      return;
    }

    const start = prof.sweep_start_hz ?? '?';
    const end = prof.sweep_end_hz ?? '?';
    const max = prof.safe_level_dbfs ?? '?';

    hint.textContent =
      `${prof.name} • sweep ${start}–${end} Hz • max ${max} dBFS`;
  };

  updateHint();

  sel.addEventListener('change', () => {
    localStorage.setItem(LS_KEY, sel.value);
    updateHint();
  });
}
