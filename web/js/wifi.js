import { $, setBusy, setDisabled, announce, fetchJSON } from './api.js';

const wifiCard = () => $('wifiCard');
const wifiSel  = () => $('wifiSel');
const wifiPwd  = () => $('wifiPwd');
const wifiPwdWrap = () => $('wifiPwdWrap');
const wifiScanBtn = () => $('wifiScanBtn');
const wifiConnectBtn = () => $('wifiConnectBtn');
const wifiMsg = () => $('wifiMsg');
const wifiStatusLine = () => $('wifiStatusLine');
const wifiHint = () => $('wifiHint');
const hotspotStopBtn = () => $('hotspotStopBtn');
const needsPwd = (sec)=> !!(sec && sec !== 'OPEN' && sec !== '--');

/* -------- Collapsible card UI (Wi-Fi) -------- */
function injectCollapsibleStyles(){
  if (document.getElementById('wifi-collapsible-style')) return;
  const css = `
    .mly-collapser{appearance:none;background:rgba(0,0,0,.02);border:1px solid rgba(0,0,0,.08);
      border-radius:10px;width:100%;padding:10px 12px;margin-bottom:10px;
      display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer}
    .mly-collapser:focus-visible{outline:2px solid #7aaaff;outline-offset:2px}
    .mly-col-left{display:flex;align-items:center;gap:8px;font-weight:600}
    .mly-col-title{letter-spacing:.2px}
    .mly-col-right{display:flex;align-items:center;gap:10px}
    .mly-pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;line-height:1.4}
    .mly-pill--ok{background:#e8f7ee;color:#0a7f3f}
    .mly-pill--warn{background:#fff6e5;color:#8a5a00}
    .mly-pill--danger{background:#fde8e8;color:#b00020}
    .mly-pill--neutral{background:#f0f0f0;color:#555}
    .mly-chevron{transition:transform .18s ease;margin-left:6px}
    .mly-collapser.is-expanded .mly-chevron{transform:rotate(180deg)}
  `;
  const s = document.createElement('style');
  s.id = 'wifi-collapsible-style';
  s.textContent = css;
  document.head.appendChild(s);
}

function ensureWifiCollapsibleUI(){
  const card = wifiCard(); 
  if (!card || card.dataset.collapsible === '1') return;

  injectCollapsibleStyles();

  // Keep the H2 visible; only move siblings after it
  const h2 = card.querySelector('h2');

  // Collect everything after the H2
  const following = [];
  for (let n = h2?.nextSibling; n; n = n.nextSibling) {
    following.push(n);
  }

  // Summary button goes right after the H2
  const summary = document.createElement('button');
  summary.type = 'button';
  summary.className = 'mly-collapser';
  summary.setAttribute('aria-expanded', 'false');
  summary.setAttribute('aria-controls', 'wifiDetailsWrap');
  summary.innerHTML = `
    <div class="mly-col-left">
      <span class="mly-col-title">Wi-Fi</span>
    </div>
    <div class="mly-col-right">
      <span id="wifiPill" class="mly-pill mly-pill--neutral">Checking…</span>
      <span class="mly-chevron" aria-hidden="true">▾</span>
    </div>
  `;

  const details = document.createElement('div');
  details.id = 'wifiDetailsWrap';

  if (h2?.nextSibling) {
    card.insertBefore(summary, h2.nextSibling);
    card.insertBefore(details, summary.nextSibling);
  } else {
    card.appendChild(summary);
    card.appendChild(details);
  }

  // Move the original content AFTER the H2 into details
  following.forEach(n => details.appendChild(n));

  // default collapsed (remember user choice)
  const expanded = localStorage.getItem('wifi.expanded') === '1';
  setWifiDetailsExpanded(summary, details, expanded);

  summary.addEventListener('click', ()=>{
    const isOpen = summary.getAttribute('aria-expanded') === 'true';
    setWifiDetailsExpanded(summary, details, !isOpen);
    localStorage.setItem('wifi.expanded', !isOpen ? '1' : '0');
  });

  card.dataset.collapsible = '1';
}


function setWifiDetailsExpanded(summaryEl, detailsEl, expanded){
  summaryEl.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  summaryEl.classList.toggle('is-expanded', expanded);
  detailsEl.style.display = expanded ? '' : 'none';
}

function setWifiPill(text, variant){
  const pill = document.getElementById('wifiPill');
  if (!pill) return;
  pill.textContent = text;
  const base = 'mly-pill';
  const map = {
    ok: 'mly-pill--ok',
    warn: 'mly-pill--warn',
    danger: 'mly-pill--danger',
    neutral: 'mly-pill--neutral'
  };
  pill.className = `${base} ${map[variant] || map.neutral}`;
}

export async function scanWifi(){
  wifiMsg().textContent='Scanning…'; announce('Scanning for Wi-Fi networks.');
  setDisabled(wifiScanBtn(), true);
  try{
    const j = await fetchJSON('/api/wifi/scan');
    wifiSel().innerHTML='';
    j.networks.forEach(n=>{
      const opt=document.createElement('option');
      opt.value=n.ssid; opt.textContent=`${n.ssid} • ${n.security} • ${n.signal}%`;
      opt.dataset.security=n.security;
      opt.setAttribute('aria-label', `${n.ssid}, security ${n.security}, signal ${n.signal} percent`);
      wifiSel().appendChild(opt);
    });
    if(j.networks.length){
      const sec = wifiSel().options[wifiSel().selectedIndex].dataset.security;
      wifiPwdWrap().style.display = needsPwd(sec)?'block':'none';
      wifiMsg().textContent='Select a network.'; announce(`${j.networks.length} networks found. Select a network.`);
      wifiSel().focus();
    }else{
      wifiPwdWrap().style.display='none'; wifiMsg().textContent='No networks found.'; announce('No networks found.');
    }
  }catch(e){
    wifiMsg().textContent='Error: '+e; announce('Wi-Fi scan failed.');
  }finally{ setDisabled(wifiScanBtn(), false); }
}

export function bindWifiSelect(){
  wifiSel()?.addEventListener('change',()=>{
    const sec = wifiSel().options[wifiSel().selectedIndex]?.dataset.security;
    wifiPwdWrap().style.display = needsPwd(sec)?'block':'none';
  });
}

export async function connectWifi(){
  const ssid=wifiSel().value;
  const sec = wifiSel().options[wifiSel().selectedIndex]?.dataset.security;
  const body={ssid:ssid, psk: needsPwd(sec)? wifiPwd().value:''};
  if(needsPwd(sec) && !body.psk){ wifiMsg().textContent='Password required.'; announce('Password required.'); wifiPwd().focus(); return; }
  wifiMsg().textContent='Connecting…'; wifiConnectBtn().textContent='Connecting…'; announce(`Connecting to ${ssid}.`);
  setDisabled(wifiConnectBtn(),true); setBusy(wifiConnectBtn(),true);
  try{
    const j=await fetchJSON('/api/wifi/connect', { method:'POST', body });
    wifiMsg().textContent='Connected. The hotspot will switch off shortly.'; announce(`Connected to ${ssid}.`);
    wifiStatus();
  }catch(e){
    wifiMsg().textContent='Error: '+e; announce('Wi-Fi connection failed.');
    setDisabled(wifiConnectBtn(),false); wifiConnectBtn().textContent='Connect';
  }finally{ setBusy(wifiConnectBtn(),false); }
}

export async function stopHotspot(){
  setDisabled(hotspotStopBtn(),true);
  wifiMsg().textContent='Stopping hotspot…'; announce('Stopping hotspot.');
  try{
    const j=await fetchJSON('/api/hotspot/stop',{method:'POST'});
    wifiMsg().textContent='Hotspot stopping. If this page drops, join your home Wi-Fi.'; announce('Hotspot stopping.');
  }catch(e){
    wifiMsg().textContent='Error: '+e; announce('Failed to stop hotspot.'); setDisabled(hotspotStopBtn(),false);
  }
}

export async function wifiStatus(){
  try{
    ensureWifiCollapsibleUI(); // <-- set up the collapsible header the first time we run

    const j = await fetchJSON('/api/wifi/status');
    const mode = String(j.mode||'').toLowerCase();
    const hotspotActive = !!j.hotspot_active;
    const ip = j.ip4 || j.ipv4 || '';
    const ssid = j.ssid || '';
    const connectedMode = (mode==='station' || mode==='sta' || mode==='client');
    const connected = (connectedMode || j.connected===true) && (!!ip || !!ssid);

    wifiCard().hidden = false;

    // Compact header pill state
    if (connected && !hotspotActive){
      setWifiPill('Connected', 'ok');
    } else if (mode==='ap' || hotspotActive){
      setWifiPill('Hotspot', 'warn');
    } else if (!!ip || !!ssid){
      setWifiPill('Connected', 'ok');
    } else {
      setWifiPill('Wi-Fi down', 'danger');
    }

    // Full details (inside the collapsed area) keep your original behavior
    if(connected && !hotspotActive){
      wifiStatusLine().textContent = `Status: Connected to ${ssid || 'Wi-Fi'} • IP ${ip || '-'}`;
      [wifiScanBtn(),hotspotStopBtn(),wifiConnectBtn()].forEach(b=>setDisabled(b,true));
      wifiConnectBtn().textContent = 'Connected';
      wifiMsg().textContent = `Use ${j.hostname||'measurely.local'} on your network.`;
      wifiHint().style.display='';
      return;
    }

    if(mode==='ap' || mode==='hotspot'){
      wifiStatusLine().textContent='Status: Onboarding hotspot active';
      [wifiScanBtn(),wifiConnectBtn(),hotspotStopBtn()].forEach(b=>setDisabled(b,false));
      wifiConnectBtn().textContent = 'Connect';
      wifiHint().style.display='';
      return;
    }

    const maybeConnected = (!!ip || !!ssid);
    if(maybeConnected){
      wifiStatusLine().textContent = `Status: Connected${ssid?` to ${ssid}`:''}${ip?` • IP ${ip}`:''}`;
      [wifiScanBtn(),hotspotStopBtn(),wifiConnectBtn()].forEach(b=>setDisabled(b,true));
      wifiConnectBtn().textContent = 'Connected';
    }else{
      wifiStatusLine().textContent = 'Status: Wi-Fi down';
      [wifiScanBtn(), hotspotStopBtn()].forEach(b=>setDisabled(b,false));
      setDisabled(wifiConnectBtn(),false);
      wifiConnectBtn().textContent = 'Connect';
    }
    wifiHint().style.display='';
  }catch(e){
    wifiCard().hidden = false;
    setWifiPill('Error', 'danger');
    wifiStatusLine().textContent='Status: error';
    announce('Error reading Wi-Fi status.');
  }
}

