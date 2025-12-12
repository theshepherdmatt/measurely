// web/js/speakers.js

const LS_KEY = 'mly.speaker.key';

export async function initSpeakers() {
    console.log('[spk] initSpeakers() started');

    // Fetch full list from backend API
    const res = await fetch('/api/speakers', { cache: 'no-store' });
    if (!res.ok) {
        console.warn('[spk] /api/speakers failed:', res.status);
        return;
    }

    const apiData = await res.json();
    console.log('[spk] API response:', apiData);
    

    // Flatten into lookup
    const list = apiData.list || [];
    window.SPEAKERS = {};
    list.forEach(spk => {
        window.SPEAKERS[spk.key] = spk;
    });
    window.SPEAKERS_BY_KEY = window.SPEAKERS;

    console.log('[spk] Loaded profiles:', list.length);

    // 🔥 Set active speaker from saved key
    const savedKey = localStorage.getItem(LS_KEY);
    if (savedKey && window.SPEAKERS[savedKey]) {
        window.activeSpeaker = window.SPEAKERS[savedKey];
        console.log("🔥 Active speaker set from saved key:", window.activeSpeaker);
    } else {
        console.warn("⚠️ No active speaker found yet — using generic");
    }


    const sel = document.getElementById("speakerSel");
    if (!sel) {
        console.log("[SPK] No #speakerSel on this page (skipping UI binding)");
        return; // <-- stops complaining forever 😌
    }

    sel.innerHTML = '';
    sel.appendChild(new Option('— None (generic sweep) —', ''));

    const spotlightGroup = document.createElement('optgroup');
    spotlightGroup.label = 'Spotlight Models';

    const categoryGroup = document.createElement('optgroup');
    categoryGroup.label = 'Speaker Categories';

    list.forEach(prof => {
        const label = prof.friendly_name || prof.name || prof.key;
        const opt = new Option(label, prof.key);

        if (prof.type === 'spotlight') {
            spotlightGroup.appendChild(opt);
        } else {
            categoryGroup.appendChild(opt);
        }
    });

    if (spotlightGroup.children.length > 0) sel.appendChild(spotlightGroup);
    if (categoryGroup.children.length > 0) sel.appendChild(categoryGroup);

    console.log('[spk] Dropdown built:', sel.options.length - 1);

    const saved = localStorage.getItem(LS_KEY);
    if (saved && window.SPEAKERS[saved]) {
        sel.value = saved;
    }

    const hint = document.getElementById('speakerHint');
    const updateHint = () => {
        const prof = window.SPEAKERS[sel.value];

        if (!prof) {
            hint.textContent = 'Generic sweep — no speaker-specific behaviour applied.';
            return;
        }

        const start = prof.sweep_start_hz ?? '?';
        const end = prof.sweep_end_hz ?? '?';
        const max = prof.safe_level_dbfs ?? '?';

        hint.textContent = `${prof.friendly_name || prof.name} • sweep ${start}–${end} Hz • max ${max} dBFS`;
    };

    updateHint();

    sel.addEventListener('change', () => {
        localStorage.setItem(LS_KEY, sel.value);
        updateHint();
    });
}
