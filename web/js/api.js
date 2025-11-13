// web/js/api.js - API wrapper functions

export function $(id) { return document.getElementById(id); }

export function setDisabled(el, disabled) {
  if (typeof el === 'string') el = $(el);
  if (!el) return;
  el.disabled = disabled;
  el.classList.toggle('opacity-50', disabled);
}

export async function fetchJSON(url, opts = {}, retries = 0) {
  const init = { cache: 'no-store', ...opts };

  if (init.body && typeof init.body === 'object' && !(init.body instanceof FormData)) {
    init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    init.body = JSON.stringify(init.body);
  }

  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`${url} → HTTP ${res.status}${txt ? ` – ${txt}` : ''}`);
      }
      return await res.json();
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

export async function buddyPhrases() {
  return fetchJSON('/buddy_phrases.json');
}

export async function footTags() {
  return fetchJSON('/foot_tags.json');
}

export async function getStatus() {
  const data = await fetchJSON('/api/status', {}, 1); // retry once
  if (!data) return { ready: false, reason: 'no-status' };

  const inputOk = !!data?.mic?.connected;
  const outputOk = !!data?.dac?.connected;

  return {
    ...data,
    ready: typeof data.ready === 'boolean' ? data.ready : (inputOk && outputOk),
    reason: data.reason || (!inputOk ? 'no-input' : !outputOk ? 'no-output' : '')
  };
}

export async function runSweepAPI(payload = {}) {
  return fetchJSON('/api/run-sweep', { method: 'POST', body: payload });
}

export async function openSession(sessionId) {
  return fetchJSON(`/api/session/${encodeURIComponent(sessionId)}`);
}

export async function fetchSessions() {
  return fetchJSON('/api/sessions');
}

export async function simpleResult(sessionId = '') {
  return fetchJSON(sessionId ? `/api/simple?sid=${encodeURIComponent(sessionId)}` : '/api/simple');
}

export async function geekResult(sessionId = '') {
  return fetchJSON(sessionId ? `/api/geek?sid=${encodeURIComponent(sessionId)}` : '/api/geek');
}

export async function filterGenerate() {
  return fetchJSON('/api/filter', { method: 'POST' });
}

export async function quipAndSpeak(savedDir) {
  if (!savedDir) return { ok: false, error: 'missing-dir' };
  return fetchJSON('/api/quip-and-speak', { method: 'POST', body: { dir: savedDir } });
}

export async function scanWifi() {
  return fetchJSON('/api/wifi/scan', { method: 'POST' });
}

export async function connectWifi(ssid, password) {
  return fetchJSON('/api/wifi/connect', { method: 'POST', body: { ssid, password } });
}

export async function wifiStatus() {
  return fetchJSON('/api/wifi/status');
}

export async function stopHotspot() {
  return fetchJSON('/api/wifi/stop-hotspot', { method: 'POST' });
}

export function bindWifiSelect() {
  const select = $('wifiSelect');
  if (!select) return;
  
  select.addEventListener('change', () => {
    const selected = select.options[select.selectedIndex];
    const passwordInput = $('wifiPassword');
    if (passwordInput) {
      passwordInput.disabled = !selected.dataset.needsPassword;
      if (!selected.dataset.needsPassword) passwordInput.value = '';
    }
  });
}

export function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 ${
    type === 'error' ? 'bg-red-600 text-white' :
    type === 'success' ? 'bg-green-600 text-white' :
    'bg-blue-600 text-white'
  }`;
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}