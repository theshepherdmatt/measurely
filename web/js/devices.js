// web/js/devices.js – Device status management (updated for full sidebar indicators)

import { $, fetchJSON } from './api.js';

let deviceStatus = {};
let statusInterval = null;

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
    UPDATE SIDEBAR STATUS BOX (System, IP, DAC, USB Mic, Clock)
  --------------------------------------------------------- */
  function updateStatusDisplay(status) {

    // 🚫 If the sidebar indicators are NOT present on this page,
    //     do NOT update anything (Dashboard only!)
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

    if (systemDot && systemText) {
      if (systemReady) {
        systemDot.className = "status-indicator bg-green-500 pulse-animation";
        systemText.textContent = "System Ready";
      } else {
        systemDot.className = "status-indicator bg-blue-400 pulse-animation";
        systemText.textContent = "Device Check Required";
      }
    }

    /* ------------------------------
      IP ADDRESS
    ------------------------------- */
    const ipDot = $('ipStatusDot');
    const ipText = $('ipAddressText');

    const ip = status?.ip;

    if (ipDot && ipText) {
      if (ip) {
        ipDot.className = "status-indicator bg-blue-400";
        ipText.textContent = `IP: ${ip}`;
      } else {
        ipDot.className = "status-indicator bg-red-500";
        ipText.textContent = "IP: Not Found";
      }
    }

    /* ------------------------------
      DAC CONNECTED
    ------------------------------- */
    const dacDot = $('dacStatusDot');
    const dacText = $('dacStatusText');

    if (dacDot && dacText) {
      if (dacOk) {
        dacDot.className = "status-indicator bg-yellow-500";
        dacText.textContent = `DAC: ${status.dac.name}`;
      } else {
        dacDot.className = "status-indicator bg-red-500";
        dacText.textContent = "DAC: Not Connected";
      }
    }

    /* ------------------------------
      USB MIC CONNECTED
    ------------------------------- */
    const usbDot = $('usbStatusDot');
    const usbText = $('usbStatusText');

    if (usbDot && usbText) {
      if (micOk) {
        usbDot.className = "status-indicator bg-green-500";
        usbText.textContent = `USB Mic: ${status.mic.name}`;
      } else {
        usbDot.className = "status-indicator bg-red-500";
        usbText.textContent = "USB Mic: Not Connected";
      }
    }

    /* ------------------------------
      CLOCK UPDATE
    ------------------------------- */
    const clock = $('lastUpdated');
    if (clock) clock.textContent = "Just now";

    /* ------------------------------
      SWEEP BUTTON ENABLE / DISABLE
    ------------------------------- */
    const ready = systemReady;
    const runBtn = $('runBtn');
    const sweepBtn = $('runSweepBtn');

    [runBtn, sweepBtn].forEach(btn => {
      if (btn) {
        btn.disabled = !ready;
        btn.classList.toggle('opacity-50', !ready);
      }
    });
  }


  /* ------------------------------
     IP ADDRESS
  ------------------------------- */
  const ipDot = $('ipStatusDot');
  const ipText = $('ipAddressText');

  const ip = status?.ip;

  if (ipDot && ipText) {
    if (ip) {
      // IP present = BLUE (Okay)
      ipDot.className = "status-indicator bg-blue-400";
      ipText.textContent = `IP: ${ip}`;
    } else {
      // No IP = RED
      ipDot.className = "status-indicator bg-red-500";
      ipText.textContent = "IP: Not Found";
    }
  }

  /* ------------------------------
     DAC CONNECTED
  ------------------------------- */
  const dacDot = $('dacStatusDot');
  const dacText = $('dacStatusText');

  if (dacDot && dacText) {
    if (dacOk) {
      // DAC OK = YELLOW (Good)
      dacDot.className = "status-indicator bg-yellow-500";
      dacText.textContent = `DAC: ${status.dac.name}`;
    } else {
      // DAC missing = RED
      dacDot.className = "status-indicator bg-red-500";
      dacText.textContent = "DAC: Not Connected";
    }
  }

  /* ------------------------------
     USB MIC CONNECTED
  ------------------------------- */
  const usbDot = $('usbStatusDot');
  const usbText = $('usbStatusText');

  if (usbDot && usbText) {
    if (micOk) {
      // Mic OK = GREEN
      usbDot.className = "status-indicator bg-green-500";
      usbText.textContent = `USB Mic: ${status.mic.name}`;
    } else {
      // Mic missing = RED
      usbDot.className = "status-indicator bg-red-500";
      usbText.textContent = "USB Mic: Not Connected";
    }
  }

  /* ------------------------------
     CLOCK UPDATE
  ------------------------------- */
  const clock = $('lastUpdated');
  if (clock) clock.textContent = "Just now";

  /* ------------------------------
     SWEEP BUTTON ENABLE / DISABLE
  ------------------------------- */
  const ready = systemReady;
  const runBtn = $('runBtn');
  const sweepBtn = $('runSweepBtn');

  [runBtn, sweepBtn].forEach(btn => {
    if (btn) {
      btn.disabled = !ready;
      btn.classList.toggle('opacity-50', !ready);
    }
  });

/* ---------------------------------------------------------
   POLLING LOOP
--------------------------------------------------------- */
export function startStatusPolling() {
  if (statusInterval) return;

  statusInterval = setInterval(() => {
    refreshStatus();
  }, 4000);

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
   AUTO START
--------------------------------------------------------- */
if (typeof window !== 'undefined') {
  startStatusPolling();
}
