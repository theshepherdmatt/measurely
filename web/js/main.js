// main.js
import { $, setDisabled } from './api.js';
import { refreshStatus } from './devices.js';
import { fetchSessions, openSession } from './sessions.js';
import { loadRoom, saveRoom } from './room.js';
import { scanWifi, connectWifi, stopHotspot, wifiStatus, bindWifiSelect } from './wifi.js';
import { renderSimpleAndGeek } from './results.js';
import { initDashboard, refreshDashboard, setStatus } from './dashboard.js';
import { initSpeakers, currentSpeakerKey } from './speakers.js';

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
    logsEl.removeAttribute('aria-live'); // avoid double-speaking while logs stream in
  }

  try {
    const payload = { speaker: currentSpeakerKey() || null };

    const resp = await fetch('/api/run-sweep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
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
      // Make the session active in UI *and* render results using that ID immediately.
      await openSession(data.session_id);
      await fetchSessions();
      await renderSimpleAndGeek(data.session_id);
    } else {
      $('resultCard')?.style.setProperty('display', 'block');
      if ($('summary')) $('summary').textContent = '(no summary)';
      const g = $('graphs'); if (g) g.remove();
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
document.addEventListener('DOMContentLoaded', async () => {
  // Wire controls
  $('runBtn')?.addEventListener('click', runSweep);
  $('saveRoomBtn')?.addEventListener('click', saveRoom);
  $('wifiScanBtn')?.addEventListener('click', scanWifi);
  $('wifiConnectBtn')?.addEventListener('click', connectWifi);
  $('hotspotStopBtn')?.addEventListener('click', stopHotspot);
  bindWifiSelect();

  // Speakers (builds the UI control + restores saved selection)
  await initSpeakers();

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

  // First render (resolver will auto-find the newest measurement if no sid)
  renderSimpleAndGeek();
  refreshDashboard();

  // Polling
  setInterval(refreshStatus, 4000);
  setInterval(wifiStatus, 5000);
});
