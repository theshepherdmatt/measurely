// main.js
import { $, setDisabled } from './api.js';
import { refreshStatus } from './devices.js';
import { fetchSessions, openSession } from './sessions.js';
import { loadRoom, saveRoom } from './room.js';
import { scanWifi, connectWifi, stopHotspot, wifiStatus, bindWifiSelect } from './wifi.js';
import { renderSimpleAndGeek } from './results.js';
import { initDashboard, refreshDashboard, setStatus } from './dashboard.js';

window.DASH_DEBUG = 1;  // verbose console logs from dashboard.js
window.DASH_DEMO  = 1;  // force a demo snapshot so the mini FR + balance render

/* -------------------- Actions -------------------- */
async function runSweep() {
  const runBtn = $('runBtn');
  const logsEl = $('logs');

  setDisabled(runBtn, true);
  runBtn?.setAttribute('aria-busy', 'true');
  if (logsEl) {
    logsEl.textContent = 'Running…';
    logsEl.removeAttribute('aria-live');
  }

  try {
    const resp = await fetch('/api/run-sweep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status} ${resp.statusText}${txt ? ` – ${txt}` : ''}`);
    }

    const data = await resp.json().catch(() => ({}));

    if (logsEl) {
      logsEl.textContent = data.stdout || '(no output)';
      logsEl.setAttribute('tabindex', '-1');
      logsEl.focus();
    }

    if (data.session_id) {
      await openSession(data.session_id);
      await fetchSessions();
    } else {
      $('resultCard')?.style.setProperty('display', 'block');
      if ($('summary')) $('summary').textContent = '(no summary)';
      const g = $('graphs');
      if (g) g.remove();

      await renderSimpleAndGeek();
    }

    await refreshStatus();
    await refreshDashboard();
  } catch (e) {
    if (logsEl) {
      logsEl.setAttribute('aria-live', 'polite');
      logsEl.textContent = `Error: ${e?.message || e}`;
    }
  } finally {
    runBtn?.removeAttribute('aria-busy');
    setDisabled(runBtn, false);
    refreshStatus();
  }
}

/* -------------------- Bootstrapping -------------------- */
document.addEventListener('DOMContentLoaded', () => {
  // Wire controls
  $('runBtn')?.addEventListener('click', runSweep);
  $('saveRoomBtn')?.addEventListener('click', saveRoom);
  $('wifiScanBtn')?.addEventListener('click', scanWifi);
  $('wifiConnectBtn')?.addEventListener('click', connectWifi);
  $('hotspotStopBtn')?.addEventListener('click', stopHotspot);
  bindWifiSelect();

  // Dashboard
  initDashboard({
    onRunSweep: runSweep,
    onViewResults: () => renderSimpleAndGeek(),
    onOpenWifi: () => document.getElementById('wifiCard')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    onOpenIO: () => document.getElementById('io-heading')
      ?.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    onOpenPlacement: () => document.getElementById('room-heading')
      ?.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  });

  // Initial fetches
  refreshStatus();
  fetchSessions();
  loadRoom();
  wifiStatus();
  scanWifi();
  renderSimpleAndGeek();
  refreshDashboard();

  // Polling
  setInterval(refreshStatus, 4000);
  setInterval(wifiStatus, 5000);
});

/* -------------------- Optional bridge -------------------- */
// Call setStatus() with richer info if refreshStatus() returns it
/*
function mirrorStatusToDashboard(dev) {
  setStatus({
    wifi: dev?.wifi_ok ? 'ok' : (dev?.wifi_warn ? 'warn' : 'missing'),
    inputs: dev?.io_ok ? 'ok' : 'warn',
    mic: dev?.mic_present ? 'ok' : 'missing',
    storage: dev?.storage_used_pct,
    deviceTemp: dev?.cpu_temp_c
  });
}
*/
