import { $, fetchJSON } from './api.js';

/* --- helpers --- */
const pillClassFromScore = (s)=>
  (s==null || !Number.isFinite(Number(s))) ? '' :
  (s>=8 ? 'great' : s>=6.5 ? 'good' : s>=5.5 ? 'ok' : s>=4.5 ? 'warn' : 'poor');

const badgeText = (o)=>{
  if(o==null || !Number.isFinite(Number(o))) return 'Unavailable';
  if(o>=9) return 'Excellent';
  if(o>=7.5) return 'Good';
  if(o>=6) return 'Decent';
  if(o>=4.5) return 'Fair';
  return 'Needs attention';
};

const fmtM = v => (v==null || !Number.isFinite(Number(v))) ? '—' : `${Number(v).toFixed(2)} m`;

// cache settings once per page load
let _roomSettingsPromise = null;
async function getRoomSettings(){
  if(!_roomSettingsPromise){
    _roomSettingsPromise = fetchJSON('/api/settings').catch(()=> ({}));
  }
  return _roomSettingsPromise;
}

function topIssues(sections, n=3){
  if(!sections) return [];
  return Object.entries(sections)
    .map(([key, sec]) => ({
      key,
      score: (sec && typeof sec.score === 'number') ? sec.score : NaN,
      advice: (sec && (sec.advice_short || sec.advice || sec.note || sec.headline)) || ''
    }))
    .filter(x => Number.isFinite(x.score))
    .sort((a,b) => a.score - b.score)   // worst first
    .slice(0, n);
}

/* --- main renderers --- */
async function renderResultsStructured(simple){
  const wrap = $('results-structured');
  if(!wrap) return;
  wrap.innerHTML = '';

  // ---- Overall card ----
  const overall = document.createElement('div');
  overall.className='result-box';
  const overallScore = Number(simple.overall);
  const scoreTxt = Number.isFinite(overallScore) ? overallScore.toFixed(1) : '—';

  overall.innerHTML = `
    <div class="result-head">
      <span class="result-label">Room score</span>
      <span class="result-pill ${pillClassFromScore(overallScore)}">
        ${scoreTxt} / 10 · ${badgeText(overallScore)}
      </span>
    </div>
    <p class="result-desc">${simple.headline || '—'}</p>
  `;

  // ---- Room facts (from /api/settings) ----
  try{
    const settings = await getRoomSettings();
    const r = (settings && settings.room) || {};
    overall.insertAdjacentHTML('beforeend', `
      <ul class="small muted" style="margin:8px 0 0 18px;">
        <li><b>Dimensions:</b> ${fmtM(r.length_m)} × ${fmtM(r.width_m)} × ${fmtM(r.height_m)}</li>
        <li><b>Speaker spacing:</b> ${fmtM(r.spk_spacing_m)}</li>
        <li><b>Speaker → front wall:</b> ${fmtM(r.spk_front_m)}</li>
        <li><b>Listener → front wall:</b> ${fmtM(r.listener_front_m)}</li>
      </ul>
    `);
  }catch{ /* keep card lean if settings missing */ }

  // ---- Highlights (worst sections first) ----
  const issues = topIssues(simple.sections, 3);
  if(issues.length){
    overall.insertAdjacentHTML('beforeend', `
      <div class="subhead" style="margin-top:10px;">Highlights</div>
      <ul class="result-actions" style="margin-left:18px;">
        ${issues.map(i=>{
          const label = i.key.replace('_','/');
          const s = Number.isFinite(i.score) ? ` (${i.score.toFixed(1)}/10)` : '';
          const tip = i.advice || 'Needs attention.';
          return `<li><b>${label}${s}:</b> ${tip}</li>`;
        }).join('')}
      </ul>
    `);
  }

  wrap.appendChild(overall);

  // ---- Actions card ----
  const actions = (simple.top_actions || []);
  if(actions.length){
    const actionsBox = document.createElement('div');
    actionsBox.className='result-box';
    const ol = document.createElement('ol'); ol.className='result-actions';
    actions.forEach(a=>{
      const name=(a.section||'advice').replace('_',' ');
      const scoreTxt=(typeof a.score==='number')?` (${a.score.toFixed(1)}/10)`:'';
      const li=document.createElement('li');
      li.innerHTML=`<b>${name}${scoreTxt}:</b> ${a.advice}`;
      ol.appendChild(li);
    });
    actionsBox.innerHTML=`<div class="result-label">How to improve your score</div>`;
    actionsBox.appendChild(ol);
    wrap.appendChild(actionsBox);
  }

  // ---- Section scores card ----
  const secCard = $('sectionScoresCard');
  const secWrap = $('sectionScoresGrid');
  if (secCard && secWrap){
    secWrap.innerHTML='';
    const order=['bandwidth','balance','peaks_dips','smoothness','reflections','reverb'];
    let rendered = 0;
    order.forEach(k=>{
      const sec = simple.sections?.[k] || {};
      const score=(typeof sec.score==='number')?sec.score:NaN;
      const label=k.replace('_','/');
      const box=document.createElement('div'); 
      box.className='mly-item';
      box.innerHTML=`
        <span class="result-label">${label}</span>
        <span class="mly-pill ${pillClassFromScore(score)}">${Number.isFinite(score)?score.toFixed(1):'—'}/10</span>
      `;
      secWrap.appendChild(box);
      rendered++;
    });
    secCard.style.display = rendered ? 'block' : 'none';
  }
}

function renderGeek(analysis){
  const box = $('mly-geek-json');
  if(box) box.textContent = JSON.stringify(analysis, null, 2);
}

/* --- public API --- */
export async function renderSimpleAndGeek(optionalSid){
  const sidQuery = optionalSid ? `?sid=${encodeURIComponent(optionalSid)}` : '';
  const simpleRes = await fetchJSON(`/api/simple${sidQuery}`);
  const geekRes   = await fetchJSON(`/api/geek${sidQuery}`);

  const simple = simpleRes.simple_view ? simpleRes.simple_view : (simpleRes.ok ? simpleRes : simpleRes);
  const analysis = geekRes.analysis ? geekRes.analysis : geekRes;

  await renderResultsStructured(simple);
  renderGeek(analysis);

  const empty=$('mly-empty'); if(empty) empty.hidden = true;
}
