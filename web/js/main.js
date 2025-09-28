import { $, setDisabled } from './api.js';
import { refreshStatus } from './devices.js';
import { fetchSessions, openSession } from './sessions.js';
import { loadRoom, saveRoom } from './room.js';
import { scanWifi, connectWifi, stopHotspot, wifiStatus, bindWifiSelect } from './wifi.js';
import { renderSimpleAndGeek } from './results.js';

async function runSweep(){
  setDisabled($('runBtn'), true); $('runBtn').setAttribute('aria-busy','true');
  $('logs').textContent='Running…';
  try{
    const r=await fetch('/api/run-sweep',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
    const data=await r.json(); $('logs').textContent=data.stdout||'(no output)';
    $('logs').setAttribute('tabindex','-1'); $('logs').focus();
    if(data.session_id){ await openSession(data.session_id); await fetchSessions(); }
    else{
      $('resultCard').style.display='block'; $('summary').textContent='(no summary)';
      $('graphs').textContent='(none)'; $('graphs').classList.add('muted');
      await renderSimpleAndGeek(); // latest
    }
  }catch(e){
    $('logs').textContent='Error: '+e;
  }finally{
    $('runBtn').removeAttribute('aria-busy'); setDisabled($('runBtn'), false); refreshStatus();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // wire buttons
  $('runBtn')?.addEventListener('click', runSweep);
  $('saveRoomBtn')?.addEventListener('click', saveRoom);
  $('wifiScanBtn')?.addEventListener('click', scanWifi);
  $('wifiConnectBtn')?.addEventListener('click', connectWifi);
  $('hotspotStopBtn')?.addEventListener('click', stopHotspot);
  bindWifiSelect();

  // boot
  refreshStatus(); fetchSessions(); loadRoom();
  setInterval(refreshStatus,4000);

  wifiStatus(); setInterval(wifiStatus,5000);
  scanWifi();               // one auto-scan
  renderSimpleAndGeek();    // latest simple/geek if present
});
