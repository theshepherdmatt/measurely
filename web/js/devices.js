// web/js/devices.js – Device status management (clean final version)

import { $, fetchJSON } from './api.js';

let deviceStatus = {};
let statusInterval = null;

/* ---------------------------------------------------------
   MAIN REFRESH ENTRY POINT
--------------------------------------------------------- */
export async function refreshStatus() {
  try {
    const status = await getStatus();
    deviceStatus = status;
    updateStatusDisplay(status);
    return status;
  } catch (error) {
    console.error('Error refreshing status:', error);
    updateStatusDisplay({ ready: false, reason: 'error' });
    return { ready: false, reason: 'error' };
  }
}

/* ---------------------------------------------------------
   UPDATE SIDEBAR STATUS BOXES
--------------------------------------------------------- */
function updateStatusDisplay(status) {

  // If this page doesn't have the sidebar items, skip
  if (!document.getElementById('systemReadyDot')) {
    return;
  }

  const micOk = status?.mic?.connected;
  const dacOk = status?.dac?.connected;
  const systemReady = micOk && dacOk;

  /* ------------------------------
      SYSTEM READY
  ------------------------------- */
  const systemDot = $('systemReadyDot');
  const systemText = $('systemReadyText');
    // DAC
  const dacDot = $('dacDot');
  const dacText = $('dacText');

  // MIC
  const usbDot = $('usbDot');
  const usbText = $('usbText');


  if (systemDot && systemText) {
    if (systemReady) {
      systemDot.className = "status-indicator bg-green-500 pulse-animation";
      systemText.textContent = "System Ready";
    } else {
      systemDot.className = "status-indicator bg-blue-400 pulse-animation";
      systemText.textContent = "Device Check Required";
    }
  }

  /* DAC */
  if (dacDot && dacText) {
    if (dacOk) {
      dacDot.className = "status-indicator bg-green-500";
      dacText.textContent = "Connected";
    } else {
      dacDot.className = "status-indicator bg-red-500";
      dacText.textContent = "Not Connected";
    }
  }

  /* MIC */
  if (usbDot && usbText) {
    if (micOk) {
      usbDot.className = "status-indicator bg-green-500";
      usbText.textContent = "Connected";
    } else {
      usbDot.className = "status-indicator bg-red-500";
      usbText.textContent = "Not Connected";
    }
  }

  /* ------------------------------
      CLOCK ("Last Updated")
  ------------------------------- */
  const clock = $('lastUpdated');
  if (clock) clock.textContent = "Just now";

  /* ------------------------------
      SWEEP BUTTON ENABLE/DISABLE
  ------------------------------- */
  const runBtn = $('runBtn');
  const sweepBtn = $('runSweepBtn');

  [runBtn, sweepBtn].forEach(btn => {
    if (btn) {
      btn.disabled = !systemReady;
      btn.classList.toggle('opacity-50', !systemReady);
    }
  });
}

/* ---------------------------------------------------------
   POLLING LOOP
--------------------------------------------------------- */
export function startStatusPolling() {
  if (statusInterval) return;
  statusInterval = setInterval(() => refreshStatus(), 4000);
  refreshStatus();
}

export function stopStatusPolling() {
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
}

export function getCurrentStatus() {
  return deviceStatus;
}

/* ---------------------------------------------------------
   API CALL
--------------------------------------------------------- */
async function getStatus() {
  return fetchJSON('/api/status', {}, 1);
}

/* ---------------------------------------------------------
   AUTO START (Browser only)
--------------------------------------------------------- */
if (typeof window !== 'undefined') {
  startStatusPolling();
}
