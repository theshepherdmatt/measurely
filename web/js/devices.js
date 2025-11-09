// web/js/devices.js
import { $, setDisabled, announce, fetchJSON } from './api.js';

/* -------- DOM helpers -------- */
const ioCard = () => document.getElementById('io-heading')?.closest('.card');

/* -------- persistent state -------- */
let lastMicOK = null;
let lastDacOK = null;

/* -------- one-time style injectors -------- */
function injectDeviceStyles() {
  if (document.getElementById('io-inline-style')) return;
  const css = `
    .io-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:var(--gap,12px);}
    .io-box{padding:12px 14px;border:1px solid rgba(0,0,0,.08);border-radius:10px;background:rgba(0,0,0,.02);}
    .io-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;}
    .io-label{font-weight:600;}
    .io-name{line-height:1.45}
    .status{padding:.25rem .55rem;border-radius:999px;font-size:.85rem;line-height:1;border:1px solid transparent;}
    .status.ok{background:#e9f7ef;border-color:#bfe9d1;color:#176a3a;}
    .status.warn{background:#fff7e6;border-color:#ffe3b3;color:#8a6d3b;}
  `;
  const s = document.createElement('style');
  s.id = 'io-inline-style';
  s.textContent = css;
  document.head.appendChild(s);
}

function injectCollapsibleStyles() {
  if (document.getElementById('io-collapsible-style')) return;
  const css = `
    .mly-collapser{appearance:none;background:rgba(0,0,0,.02);border:1px solid rgba(0,0,0,.08);
      border-radius:10px;width:100%;padding:10px 12px;margin:8px 0 10px;
      display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer}
    .mly-collapser:focus-visible{outline:2px solid #7aaaff;outline-offset:2px}
    .mly-col-left{display:flex;align-items:center;gap:8px;font-weight:600}
    .mly-col-title{letter-spacing:.2px}
    .mly-col-right{display:flex;align-items:center;gap:10px}
    .mly-pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;line-height:1.4}
    .mly-pill--ok{background:#e8f7ee;color:#0a7f3f}
    .mly-pill--warn{background:#fff6e5;color:#8a5a00}
    .mly-pill--danger{background:#fde8e8;color:#b00020}
    .mly-pill--neutral{background:#f0f0f0;color:#555}
    .mly-chevron{transition:transform .18s ease;margin-left:6px}
    .mly-collapser.is-expanded .mly-chevron{transform:rotate(180deg)}
  `;
  const s = document.createElement('style');
  s.id = 'io-collapsible-style';
  s.textContent = css;
  document.head.appendChild(s);
}

function ensureIOCollapsibleUI() {
  const card = ioCard();
  if (!card || card.dataset.collapsible === '1') return;

  injectCollapsibleStyles();

  const heading = card.querySelector('h2');
  const following = [];
  for (let n = heading?.nextSibling; n; n = n.nextSibling) { following.push(n); }

  const details = document.createElement('div');
  details.id = 'ioDetailsWrap';

  const summary = document.createElement('button');
  summary.type = 'button';
  summary.className = 'mly-collapser';
  summary.setAttribute('aria-expanded', 'false');
  summary.setAttribute('aria-controls', 'ioDetailsWrap');
  summary.innerHTML = `
    <div class="mly-col-left">
      <span class="mly-col-title">Inputs &amp; outputs</span>
    </div>
    <div class="mly-col-right">
      <span id="ioPill" class="mly-pill mly-pill--neutral">Checking…</span>
      <span class="mly-chevron" aria-hidden="true">▾</span>
    </div>
  `;

  card.insertBefore(summary, heading.nextSibling);
  card.insertBefore(details, summary.nextSibling);
  following.forEach(n => details.appendChild(n));

  const expanded = localStorage.getItem('io.expanded') === '1';
  setIODetailsExpanded(summary, details, expanded);

  summary.addEventListener('click', () => {
    const isOpen = summary.getAttribute('aria-expanded') === 'true';
    setIODetailsExpanded(summary, details, !isOpen);
    localStorage.setItem('io.expanded', !isOpen ? '1' : '0');
  });

  card.dataset.collapsible = '1';
}

function setIODetailsExpanded(summaryEl, detailsEl, expanded) {
  summaryEl.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  summaryEl.classList.toggle('is-expanded', expanded);
  detailsEl.style.display = expanded ? '' : 'none';
}

function setIOPill(text, variant) {
  const pill = document.getElementById('ioPill');
  if (!pill) return;
  pill.textContent = text;
  const base = 'mly-pill';
  const map = { ok: 'mly-pill--ok', warn: 'mly-pill--warn', danger: 'mly-pill--danger', neutral: 'mly-pill--neutral' };
  pill.className = `${base} ${map[variant] || map.neutral}`;
}

/* -------- main refresh -------- */
export async function refreshStatus() {
  try {
    injectDeviceStyles();
    ensureIOCollapsibleUI();

    let s;
    try {
      s = await fetchJSON('/api/status');
    } catch {
      // retry once on failure
      await new Promise(r => setTimeout(r, 400));
      s = await fetchJSON('/api/status');
    }

    const micOK = !!(s?.mic?.connected);
    const dacOK = !!(s?.dac?.connected);

    // Only update UI if there's been a change
    const micChanged = micOK !== lastMicOK;
    const dacChanged = dacOK !== lastDacOK;
    if (!micChanged && !dacChanged) return;

    lastMicOK = micOK;
    lastDacOK = dacOK;

    // Summary pill
    if (micOK && dacOK) {
      setIOPill('Ready', 'ok');
    } else if (micOK || dacOK) {
      setIOPill('Check devices', 'warn');
    } else {
      setIOPill('Not connected', 'danger');
    }

    // Individual box statuses
    const micStatus = $('micStatus');
    const dacStatus = $('dacStatus');
    if (micStatus) {
      micStatus.textContent = micOK ? 'Connected' : 'Not found';
      micStatus.className = 'status ' + (micOK ? 'ok' : 'warn');
    }
    if (dacStatus) {
      dacStatus.textContent = dacOK ? 'Connected' : 'Not found';
      dacStatus.className = 'status ' + (dacOK ? 'ok' : 'warn');
    }

    const micName = $('micName');
    const dacName = $('dacName');
    if (micName) micName.textContent = micOK ? 'USB Microphone' : '';
    if (dacName) dacName.textContent = dacOK ? 'Built-in DAC' : '';

    const ready = micOK && dacOK;
    setDisabled($('runBtn'), !ready);
    const hint = $('hint');
    if (hint) hint.textContent = ready ? 'Ready.' : 'Plug in mic/DAC and refresh.';
  } catch (e) {
    setIOPill('Error', 'danger');
    const micStatus = $('micStatus');
    const dacStatus = $('dacStatus');
    if (micStatus) {
      micStatus.textContent = 'Error';
      micStatus.className = 'status warn';
    }
    if (dacStatus) {
      dacStatus.textContent = 'Error';
      dacStatus.className = 'status warn';
    }
    const hint = $('hint');
    if (hint) hint.textContent = 'Server error.';
    announce('Error reading device status.');
  }
}
