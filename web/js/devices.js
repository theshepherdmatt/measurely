// web/js/devices.js — padded boxes + short fixed names
import { $, setDisabled, announce, fetchJSON } from './api.js';

/* one-time style injector (same vibe as dashboard) */
function injectDeviceStyles(){
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
  const s=document.createElement('style'); s.id='io-inline-style'; s.textContent=css;
  document.head.appendChild(s);
}

export async function refreshStatus() {
  try {
    injectDeviceStyles();

    const s = await fetchJSON('/api/status');
    const micOK = !!(s?.mic?.connected);
    const dacOK = !!(s?.dac?.connected);

    // Status pills
    const micStatus = $('micStatus');
    const dacStatus = $('dacStatus');
    if (micStatus){ micStatus.textContent = micOK ? 'Connected' : 'Not found'; micStatus.className = 'status ' + (micOK ? 'ok' : 'warn'); }
    if (dacStatus){ dacStatus.textContent = dacOK ? 'Connected' : 'Not found'; dacStatus.className = 'status ' + (dacOK ? 'ok' : 'warn'); }

    // SHORT, fixed names (no long device strings)
    const micName = $('micName');
    const dacName = $('dacName');
    if (micName) micName.textContent = micOK ? 'USB Microphone' : '';
    if (dacName) dacName.textContent = dacOK ? 'Built-in DAC' : '';

    // Enable “Run” only when both are present
    const ready = micOK && dacOK;
    setDisabled($('runBtn'), !ready);
    const hint = $('hint');
    if (hint) hint.textContent = ready ? 'Ready.' : 'Plug in mic/DAC and refresh.';
  } catch (e) {
    const micStatus = $('micStatus'); if (micStatus){ micStatus.textContent = 'Error'; micStatus.className = 'status warn'; }
    const dacStatus = $('dacStatus'); if (dacStatus){ dacStatus.textContent = 'Error'; dacStatus.className = 'status warn'; }
    const hint = $('hint'); if (hint) hint.textContent = 'Server error.';
    announce('Error reading device status.');
  }
}
