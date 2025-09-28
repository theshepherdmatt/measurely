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
    const j=await fetchJSON('/api/wifi/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
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
    const j = await fetchJSON('/api/wifi/status');
    const mode = String(j.mode||'').toLowerCase();
    const hotspotActive = !!j.hotspot_active;
    const ip = j.ip4 || j.ipv4 || '';
    const ssid = j.ssid || '';
    const connectedMode = (mode==='station' || mode==='sta' || mode==='client');
    const connected = (connectedMode || j.connected===true) && (!!ip || !!ssid);

    wifiCard().hidden = false;
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
    wifiStatusLine().textContent='Status: error';
    announce('Error reading Wi-Fi status.');
  }
}
