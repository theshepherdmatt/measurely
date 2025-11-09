// web/js/dashboard.js
// Measurely Dashboard (light theme, full visual cards + gauges)

import { $, setDisabled, fetchJSON } from './api.js';

let _data = null;

function injectStyles() {
  if (document.getElementById('dash-light-style')) return;
  const css = `
    :root {
      --bg: #f9fafb;
      --card-bg: #fff;
      --border: #e0e0e0;
      --text: #222;
      --accent: #007aff;
      --shadow: 0 2px 6px rgba(0,0,0,0.06);
    }
    #dashboard {
      background: var(--bg);
      color: var(--text);
      padding: 18px;
      border-radius: 12px;
    }
    .dash-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-top: 10px;
    }
    .dash-box {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      box-shadow: var(--shadow);
      padding: 14px 16px;
      text-align: center;
    }
    .dash-box h3 {
      margin: 0 0 6px 0;
      font-size: 1rem;
      color: #333;
    }
    .dash-value {
      font-size: 1.8rem;
      font-weight: 600;
      color: var(--accent);
    }
    .dash-sub {
      font-size: .9rem;
      opacity: .8;
    }
    .gauge {
      width: 100%;
      height: 120px;
    }
    .summary {
      font-style: italic;
      text-align: center;
      margin: 4px 0 16px;
      color: #555;
    }
    .dash-graphs {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      justify-content: center;
      margin-top: 24px;
    }
    .dash-graphs img {
      max-width: 48%;
      height: auto;
      border-radius: 10px;
      box-shadow: var(--shadow);
      border: 1px solid var(--border);
    }
    @media(max-width:700px){
      .dash-graphs img { max-width:100%; }
    }
  `;
  const s = document.createElement('style');
  s.id = 'dash-light-style';
  s.textContent = css;
  document.head.appendChild(s);
}

// simple gauge arc (0–10)
function renderGauge(score, color) {
  const pct = Math.max(0, Math.min(score / 10, 1));
  const angle = pct * 180;
  const radius = 40;
  const start = polarToCartesian(radius, radius, radius, 180);
  const end = polarToCartesian(radius, radius, radius, 180 - angle);
  const largeArc = angle > 180 ? 1 : 0;
  const d = `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`;
  return `
    <svg viewBox="0 0 80 45" class="gauge">
      <path d="M0 40 A40 40 0 0 0 80 40" fill="none" stroke="#eee" stroke-width="8"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"/>
      <text x="40" y="38" text-anchor="middle" font-size="14" fill="#333">${score.toFixed(1)}/10</text>
    </svg>
  `;
}
function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * Math.PI / 180.0;
  return { x: cx + (r * Math.cos(rad)), y: cy + (r * Math.sin(rad)) };
}

function colorForScore(s) {
  if (s >= 8) return '#2ecc71';
  if (s >= 6.5) return '#27ae60';
  if (s >= 5) return '#f39c12';
  if (s >= 3.5) return '#e67e22';
  return '#e74c3c';
}

function render() {
  const wrap = $('dashboard');
  if (!wrap) return;

  const d = _data || {
    summary: "Voices are stronger than bass.",
    scores: {
      bandwidth: 3.6, balance: 1.6, peaks_dips: 3.3,
      smoothness: 7.3, reflections: 4.0, reverb: 10.0, overall: 5.0
    },
    tips: [
      "Move speakers closer to the wall or add a small sub.",
      "Add something soft at the first side-wall reflection points."
    ]
  };

  const s = d.scores;
  wrap.innerHTML = `
    <h2 style="text-align:center;margin-bottom:0;">Room Dashboard</h2>
    <div class="summary">${d.summary}</div>

    <div class="dash-grid">
      <div class="dash-box">
        <h3>Overall</h3>
        ${renderGauge(s.overall, colorForScore(s.overall))}
      </div>
      <div class="dash-box">
        <h3>Bandwidth</h3>
        ${renderGauge(s.bandwidth, colorForScore(s.bandwidth))}
      </div>
      <div class="dash-box">
        <h3>Balance</h3>
        ${renderGauge(s.balance, colorForScore(s.balance))}
      </div>
      <div class="dash-box">
        <h3>Peaks & Dips</h3>
        ${renderGauge(s.peaks_dips, colorForScore(s.peaks_dips))}
      </div>
      <div class="dash-box">
        <h3>Smoothness</h3>
        ${renderGauge(s.smoothness, colorForScore(s.smoothness))}
      </div>
      <div class="dash-box">
        <h3>Reflections</h3>
        ${renderGauge(s.reflections, colorForScore(s.reflections))}
      </div>
      <div class="dash-box">
        <h3>Reverb</h3>
        ${renderGauge(s.reverb, colorForScore(s.reverb))}
      </div>
    </div>

    <div class="dash-graphs">
      <img src="/latest/left-response.png" alt="Left frequency response">
      <img src="/latest/right-response.png" alt="Right frequency response">
    </div>

    <div class="dash-grid" style="margin-top:24px;">
      <div class="dash-box" style="grid-column:span 2;">
        <h3>Recommendations</h3>
        <ul style="text-align:left;line-height:1.6;margin:0;padding-left:20px;">
          ${d.tips.map(t => `<li>${t}</li>`).join('')}
        </ul>
      </div>
    </div>
  `;
}

async function pullResults() {
  try {
    const res = await fetchJSON('/api/simple');
    const sec = res?.simple_view?.sections || res?.sections || null;
    if (sec) {
      _data = {
        summary: res?.simple_view?.summary || "Voices are stronger than bass.",
        scores: {
          bandwidth: sec.bandwidth?.score ?? 0,
          balance: sec.balance?.score ?? 0,
          peaks_dips: sec.peaks_dips?.score ?? 0,
          smoothness: sec.smoothness?.score ?? 0,
          reflections: sec.reflections?.score ?? 0,
          reverb: sec.reverb?.score ?? 0,
          overall: res?.simple_view?.overall ?? 0
        },
        tips: res?.simple_view?.tips || []
      };
    }
  } catch (e) {
    console.warn('[Dashboard] Using default data', e);
  }
}

export async function initDashboard() {
  injectStyles();
  const wrap = $('dashboard');
  if (wrap) wrap.innerHTML = '<div class="dash-loading">Loading...</div>';
  await pullResults();
  render();
}

export async function refreshDashboard() {
  await pullResults();
  render();
}
