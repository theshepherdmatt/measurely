// web/js/devices.js - Device status management

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

function updateStatusDisplay(status) {
  const indicator = $('deviceStatusIndicator');
  const statusText = $('deviceStatusText');
  const statusDetails = $('deviceStatusDetails');
  
  const inputOk = status?.mic?.connected;
  const outputOk = status?.dac?.connected;
  const ready = inputOk && outputOk;
  
  if (indicator && statusText) {
    if (ready) {
      indicator.className = 'status-indicator status-good pulse-animation';
      statusText.textContent = 'System Ready';
    } else if (status.reason === 'error') {
      indicator.className = 'status-indicator status-poor pulse-animation';
      statusText.textContent = 'Connection Error';
    } else {
      indicator.className = 'status-indicator status-warning pulse-animation';
      statusText.textContent = 'Device Check Required';
    }
  }
  
  // Update device details if available
  const inputDevice = $('inputDevice');
  const outputDevice = $('outputDevice');
  
  if (inputDevice) {
    inputDevice.textContent = inputOk ? 
      (status.mic?.name || 'Connected') : 'Not Connected';
    inputDevice.className = inputOk ? 'text-green-600' : 'text-red-600';
  }
  
  if (outputDevice) {
    outputDevice.textContent = outputOk ? 
      (status.dac?.name || 'Connected') : 'Not Connected';
    outputDevice.className = outputOk ? 'text-green-600' : 'text-red-600';
  }
  
  // Update sweep button state
  const runBtn = $('runBtn');
  const sweepBtn = $('runSweepBtn');
  
  [runBtn, sweepBtn].forEach(btn => {
    if (btn) {
      btn.disabled = !ready;
      btn.classList.toggle('opacity-50', !ready);
    }
  });
}

export function startStatusPolling() {
  if (statusInterval) return;
  
  statusInterval = setInterval(() => {
    refreshStatus();
  }, 4000);
  
  // Initial refresh
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

async function getStatus() {
  return fetchJSON('/api/status', {}, 1);
}

// Auto-start status polling when module loads
if (typeof window !== 'undefined') {
  startStatusPolling();
}