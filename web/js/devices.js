import { $, setDisabled, announce, fetchJSON } from './api.js';

export async function refreshStatus() {
  try {
    const s = await fetchJSON('/api/status');
    const micOK = !!(s.mic && s.mic.connected);
    const dacOK = !!(s.dac && s.dac.connected);

    // Status text
    $('micStatus').textContent = micOK ? 'Connected' : 'Not found';
    $('dacStatus').textContent = dacOK ? 'Connected' : 'Not found';
    $('micStatus').className = 'status ' + (micOK ? 'ok' : 'warn');
    $('dacStatus').className = 'status ' + (dacOK ? 'ok' : 'warn');

    // Fixed friendly names
    $('micName').textContent = micOK ? 'USB Microphone' : '';
    $('dacName').textContent = dacOK ? 'Built-in DAC' : '';

    const ready = micOK && dacOK;
    setDisabled($('runBtn'), !ready);
    $('hint').textContent = ready ? 'Ready.' : 'Plug in mic/DAC and refresh.';
  } catch (e) {
    $('micStatus').textContent = 'Error';
    $('dacStatus').textContent = 'Error';
    $('micStatus').className = 'status warn';
    $('dacStatus').className = 'status warn';
    $('hint').textContent = 'Server error.';
    announce('Error reading device status.');
  }
}
