// web/js/api.js
// Tiny DOM helpers + API abstraction

/* -------------------- DOM + Accessibility -------------------- */
export const $ = (id) => document.getElementById(id);

export function announce(msg) {
  const live = $('sr-announcer');
  if (!live) return;
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 10);
}

export function setBusy(el, b = true) {
  if (!el) return;
  el.setAttribute('aria-busy', b ? 'true' : 'false');
}

export function setDisabled(el, d = true) {
  if (!el) return;
  el.disabled = d;
  el.setAttribute('aria-disabled', d ? 'true' : 'false');
}

/* -------------------- JSON Fetcher (with retry support) -------------------- */
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

/* -------------------- Device Status -------------------- */
// Single source of truth for current input/output/wifi status
// Example:
// {
//   input: { connected: true, name: "UMIK-1" },
//   output: { connected: true, name: "Hypex FA123" },
//   wifi: { state: "connected", ssid: "MyWiFi" },
//   ready: true,
//   reason: ""
// }

export async function getStatus() {
  const data = await fetchJSON('/api/status', {}, 1); // retry once
  if (!data) return { ready: false, reason: 'no-status' };

  const inputOk = !!data?.input?.connected;
  const outputOk = !!data?.output?.connected;

  return {
    ...data,
    ready: typeof data.ready === 'boolean' ? data.ready : (inputOk && outputOk),
    reason: data.reason || (!inputOk ? 'no-input' : !outputOk ? 'no-output' : '')
  };
}

/* -------------------- Sweep + Sessions -------------------- */
export async function runSweepAPI(payload = {}) {
  return fetchJSON('/api/run-sweep', { method: 'POST', body: payload });
}

export async function openSessionAPI(sessionId) {
  return fetchJSON(`/api/session/${encodeURIComponent(sessionId)}`);
}

export async function fetchSessionsAPI() {
  return fetchJSON('/api/sessions');
}

/* -------------------- Results -------------------- */
export async function simpleResultAPI(sessionId = '') {
  return fetchJSON(sessionId ? `/api/simple?sid=${encodeURIComponent(sessionId)}` : '/api/simple');
}

export async function geekResultAPI(sessionId = '') {
  return fetchJSON(sessionId ? `/api/geek?sid=${encodeURIComponent(sessionId)}` : '/api/geek');
}

/* -------------------- Filters -------------------- */
export async function filterGenerate() {
  return fetchJSON('/api/filter', { method: 'POST' });
}

/* -------------------- Audio Quip / Speech -------------------- */
export async function quipAndSpeak(savedDir) {
  if (!savedDir) return { ok: false, error: 'missing-dir' };
  return fetchJSON('/api/quip-and-speak', { method: 'POST', body: { dir: savedDir } });
}

/* -------------------- Device Name Normaliser -------------------- */
export function niceDeviceName(s) {
  if (!s) return '';
  const t = String(s).replace(/\s*\([^)]*\)\s*/g, ' ').trim().toLowerCase();

  if (t.includes('hifiberry')) return 'HiFiBerry DAC';
  if (t.includes('fa123') || t.includes('hypex')) return 'Hypex FA123';
  if (t.includes('qutest') || t.includes('2qute')) return 'Chord DAC';
  if (t.includes('usb audio')) return 'USB Audio DAC';
  if (t.includes('codec') && t.includes('bcm')) return 'Pi audio';

  return String(s).split(/[\n,]/)[0].trim().replace(/\s{2,}/g, ' ');
}
