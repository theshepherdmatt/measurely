import { $, fetchJSON, announce } from './api.js';

export function fillRoomFields(v){
  $('roomL').value = v.length_m ?? '';
  $('roomW').value = v.width_m ?? '';
  $('roomH').value = v.height_m ?? '';
  $('spkFront').value = v.spk_front_m ?? '';
  $('lstToSpk').value = v.listener_front_m ?? '';
  $('spkSpacing').value = v.spk_spacing_m ?? '';
}
export async function loadRoom(){
  try{
    const s = await fetchJSON('/api/settings');
    fillRoomFields(s.room||{});
  }catch{}
}
export async function saveRoom(){
  const payload={room:{
    length_m:+$('roomL').value||null,
    width_m:+$('roomW').value||null,
    height_m:+$('roomH').value||null,
    spk_front_m:+$('spkFront').value||null,
    listener_front_m:+$('lstToSpk').value||null,
    spk_spacing_m:+$('spkSpacing').value||null,
    layout:null
  }};
  const r = await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(r.ok){ $('saveRoomMsg').textContent='Saved ✓'; announce('Room and placement saved.'); setTimeout(()=>{$('saveRoomMsg').textContent='';},1500); }
  else{ $('saveRoomMsg').textContent='Save failed'; announce('Saving room and placement failed.'); }
}
