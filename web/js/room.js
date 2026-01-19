// web/js/room.js - Room configuration management

console.log("📌 room.js loaded");

import { $, fetchJSON, showToast } from './api.js';

let currentRoom = {
  length_m: 4.0,
  width_m: 4.0,
  height_m: 2.5,

  spk_front_m: 0.3,
  spk_spacing_m: 2.0,
  listener_front_m: 2.5,
  toe_in_deg: 15,

  speaker_key: null,
  subwoofer: "unknown",

  floor_material: "hard",
  wall_treatment: "bare",

  opt_area_rug: false,
  opt_sofa: false,
  opt_coffee_table: false,

  tweeter_height_m: null
};


// 🔍 Diagnostic log
function logState(msg) {
  console.log(`📌 ${msg}:`, JSON.parse(JSON.stringify(currentRoom)));
}

// -----------------------------------------------------
// LOAD ROOM DATA FROM BACKEND
// -----------------------------------------------------
export async function loadRoom() {
  console.log("🔄 loadRoom called…");

  try {
    const data = await fetchJSON('/api/room/latest');
    console.log("📥 API Response:", data);

    if (data) {
      currentRoom = {
        ...currentRoom,
        length: data.length_m ?? currentRoom.length,
        width: data.width_m ?? currentRoom.width,
        height: data.height_m ?? currentRoom.height,
        speakerDistance: data.spk_front_m ?? currentRoom.speakerDistance,
        speakerSpacing: data.spk_spacing_m ?? currentRoom.speakerSpacing,
        seatingDistance: data.listener_front_m ?? currentRoom.seatingDistance,
        speaker_key: data.speaker_key ?? currentRoom.speaker_key,
        toe_in_deg: data.toe_in_deg ?? currentRoom.toe_in_deg,
        echo_pct: data.echo_pct ?? currentRoom.echo_pct,
        subwoofer: data.subwoofer ?? currentRoom.subwoofer,
        opt_hardfloor: data.opt_hardfloor ?? currentRoom.opt_hardfloor,
        opt_rug: data.opt_area_rug ?? currentRoom.opt_rug,
        opt_sofa: data.opt_sofa ?? currentRoom.opt_sofa,
        wall_treatment: data.wall_treatment ?? currentRoom.wall_treatment,
        opt_coffee_table: data.opt_coffee_table ?? currentRoom.opt_coffee_table,
        tweeter_height_m: data.tweeter_height_m ?? currentRoom.tweeter_height_m

      };

      logState("After API load");
      window.currentRoom = currentRoom;
      console.log("[ROOM] Loaded API data:", currentRoom);

      updateRoomForm();          // 1st sync
      updateRoomVisualization();
      updateRoomSummary();
      updateSpeakerNameInSummary();

      // 🔥 Guarantee second sync after DOM fully drawn
      setTimeout(() => {
        console.log("🎯 Post-load sync (setTimeout) running…");
        updateRoomForm();
      }, 200);
    }

    return currentRoom;

  } catch (error) {
    console.error("❌ Error loading room:", error);
    return currentRoom;
  }
}

// -----------------------------------------------------
// SAVE ROOM — POST to backend
// -----------------------------------------------------
export async function saveRoom() {
  console.log("💾 saveRoom() called");

  const num = (id) => {
    const el = document.getElementById(id);
    return el ? parseFloat(el.value) : null;
  };

  const val = (id) => {
    const el = document.getElementById(id);
    return el ? el.value : null;
  };

  const chk = (id) => {
    const el = document.getElementById(id);
    return !!(el && el.checked);
  };

  const payload = {
    // Room geometry
    length_m: num('room-length-num'),
    width_m:  num('room-width-num'),
    height_m: num('room-height-num'),

    // Placement
    spk_front_m:     num('speaker-distance-num'),
    spk_spacing_m:  num('speaker-width-num'),
    listener_front_m: num('listening-distance-num'),
    toe_in_deg:     num('toe-angle'),
    tweeter_height_m: num('tweeter-height-num'),

    // Acoustics
    echo_pct: parseInt(val('room-echo')),
    floor_material: val('floor-material'),
    wall_treatment: val('wall_treatment'),

    // System
    speaker_key: val('speakerSel'),
    subwoofer: val('subwoofer-present') || "unknown",
    layout: "stereo",

    // Furnishings
    opt_area_rug:  chk('opt-area-rug'),
    opt_sofa:      chk('opt-sofa'),
    opt_coffee_table: chk('opt-coffee-table')
  };

  console.log("💾 Sending payload:", payload);

  try {
    const res = await fetch('/api/room/latest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`Save failed (${res.status})`);

    showToast?.("Room setup saved", "success");

    // Reload canonical state
    await loadRoom();

  } catch (err) {
    console.error("❌ Save error:", err);
    showToast?.("Save failed", "error");
  }
}


// -----------------------------------------------------
// LOAD ROOM DATA & APPLY TO FORM
// -----------------------------------------------------
export async function loadRoomSetup() {
  console.log("🔄 loadRoomSetup()");

  try {
    const res = await fetch('/api/room/latest');
    if (!res.ok) {
      console.warn("⚠ No saved room yet");
      return;
    }

    const j = await res.json();
    console.log("📥 Loaded backend room:", j);

    const assign = (key, elId) => {
      if (j[key] != null) {
        const el = document.getElementById(elId);
        if (el) el.value = j[key];
      }
    };

    assign('length_m', 'room-length');
    assign('width_m', 'room-width');
    assign('height_m', 'room-height');
    assign('spk_front_m', 'speaker-distance');
    assign('spk_spacing_m', 'speaker-width');
    assign('listener_front_m', 'listening-distance');
    assign('toe_in_deg', 'toe-angle');
    assign('echo_pct', 'room-echo');
    assign('floor_material', 'floor-material');
    assign('speaker_key', 'speakerSel');
    assign('wall_treatment', 'wall_treatment');
    assign('subwoofer', 'subwoofer-present');
    assign('tweeter_height_m', 'tweeter-height-num');

    document.getElementById('opt-area-rug').checked = !!j.opt_area_rug;
    document.getElementById('wall_treatment').value = j.wall_treatment ?? "bare";
    document.getElementById('opt-sofa').checked = !!j.opt_sofa;
    document.getElementById('opt-coffee-table').checked = !!j.opt_coffee_table;

    updateRoomForm(); // sync sliders + nums

    if (window.roomDiagram?.update) roomDiagram.update();

  } catch (err) {
    console.error("❌ loadRoomSetup failed:", err);
  }
}


// -----------------------------------------------------
// SLIDER-SPINBOX LINKING
// -----------------------------------------------------
function linkInputPair(id) {
  const slider = document.getElementById(id);
  const num = document.getElementById(id + '-num');
  const val = document.getElementById(id + '-val');

  if (!slider || !num) return;

  console.log(`🔗 Linking ${id}`);

  num.value = slider.value;

  slider.addEventListener('input', () => {
    num.value = slider.value;
    if (val) val.textContent = slider.value;
  });

  num.addEventListener('input', () => {
    slider.value = num.value;
    if (val) val.textContent = num.value;
  });
}

function showDaveSummary() {
    const room = window.currentRoom || {}; // already loaded via loadRoomSetup()

    const w = room.width_m;
    const l = room.length_m;
    const h = room.height_m;
    const spkDist = room.listener_front_m;
    const spacing = room.speakerSpacing;
    const toe = room.toe_in_deg;

    const sofa = room.opt_sofa;
    const rug = room.opt_area_rug;
    const wall_treatment = room.wall_treatment;
    const coffee = room.opt_coffee_table;
    const tweeterH = room.tweeter_height_m;


    let furnText = "";
    if (rug) furnText += "A rug helps calm reflections. ";
    if (sofa) furnText += "A large sofa is friendly to bass. ";
    if (wall_treatment === "treated") { furnText += "Wall treatment helps tame reflections and smooth the top end. ";
    }
    if (wall_treatment === "bare") { furnText += "Bare walls will keep the room more lively and reflective. ";
    }
    if (coffee) furnText += "A coffee table between the speakers and seat can add early mid-range reflections. ";
    if (tweeterH && tweeterH < 0.8) { furnText += "Tweeters are relatively low, which may be reinforcing floor reflections. ";
}



    const summary = `
        Cool. You’re working with a room around <strong>${w} × ${l}m</strong>
        and <strong>${h}m</strong> high.
        Speakers are spaced <strong>${spacing}m</strong> apart,
        you’re about <strong>${spkDist}m</strong> back,
        and toe-in is around <strong>${toe}°</strong> —
        nice baseline for a focused soundstage.<br><br>
        ${furnText || "Room is pretty neutral so far — easy to shape later."}
        
    `;

    const el = document.getElementById("dave-summary-text");
    el.innerHTML = summary;
    el.style.opacity = 1;
    el.style.transform = "translateY(0)";

    document.getElementById("dave-card").style.display = "block";
}

async function updateSpeakerNameInSummary() {
  try {
    const data = await fetchJSON('/api/speakers');
    const spk = data.current || {};

    const friendly =
      spk.friendly_name ||
      spk.name ||
      spk.key ||
      "Unknown speaker";

    console.log("🔊 Speaker from API:", spk);

    const el = document.getElementById("sum-speaker-model");
    if (el) el.textContent = friendly;

  } catch (err) {
    console.warn("⚠ Speaker API failed:", err);
  }
}

function updateRoomSummary() {
    const w = parseFloat(document.getElementById("room-width-num")?.value) || 0;
    const l = parseFloat(document.getElementById("room-length-num")?.value) || 0;
    const h = parseFloat(document.getElementById("room-height-num")?.value) || 0;

    const spacing = parseFloat(document.getElementById("speaker-width-num")?.value) || 0;
    const dist = parseFloat(document.getElementById("speaker-distance-num")?.value) || 0;
    const listen = parseFloat(document.getElementById("listening-distance-num")?.value) || 0;

    const toe = parseFloat(document.getElementById("toe-angle")?.value) || 0;


    // 🔊 SPEAKER NAME FROM SPEAKERS INDEX
    //const spkKey = currentRoom.speaker_key;
    //const spkProf = window.SPEAKERS?.[spkKey];
    //const model =
        //spkProf?.friendly_name ||
        //spkProf?.name ||
        //spkKey ||
        //"Unknown";

    //console.log("🔈 Using speaker profile:", spkKey, spkProf);
    

    // Room volume + shape calc
    const volume = (w * l * h).toFixed(1);
    let shape = "Balanced shape";
    if (l > w * 1.3) shape = "Long room";
    if (w > l * 1.3) shape = "Wide room";

    // Triangle geometry
    const tri = spacing && listen
        ? `Triangles: ${(spacing / listen).toFixed(2)} spacing ratio`
        : "—";

    // Ideal toe-in (geometry-based)
    let idealToe = spacing && listen
        ? Math.round(Math.atan((spacing / 2) / listen) * (180 / Math.PI))
        : null;

    let toeMsg = "—";
    if (idealToe !== null) {
        const diff = toe - idealToe;
        toeMsg = diff > 3 ? "Slightly wide" :
                diff < -3 ? "Slightly narrow" :
                "Near ideal";
        toeMsg += ` (ideal ~${idealToe}°)`;
    }

    // 🖥 UI updates
    document.getElementById("sum-room-size").textContent =
        `${w.toFixed(2)}m × ${l.toFixed(2)}m × ${h.toFixed(2)}m`;
    document.getElementById("sum-room-volume").textContent = volume;
    document.getElementById("sum-room-shape").textContent = shape;

    //document.getElementById("sum-speaker-model").textContent = model;
    document.getElementById("sum-speaker-spacing").textContent =
        `${spacing.toFixed(2)}m`;
    document.getElementById("sum-speaker-distance").textContent =
        `${dist.toFixed(2)}m`;
    document.getElementById("sum-triangle").textContent = tri;

    document.getElementById("sum-toe-angle").textContent =
        `${toe.toFixed(1)}°`;
    document.getElementById("sum-toe-comment").textContent = toeMsg;
}


// -----------------------------------------------------
// APPLY DATA TO UI ELEMENTS
// -----------------------------------------------------
function updateRoomForm() {
  console.log("[ROOM] updateRoomForm() applying values:", currentRoom);

  const map = [
    { key: "width", slider: "room-width", num: "room-width-num", val: "room-width-val" },
    { key: "length", slider: "room-length", num: "room-length-num", val: "room-length-val" },
    { key: "height", slider: "room-height", num: "room-height-num", val: "room-height-val" },

    { key: "speakerDistance", slider: "speaker-distance", num: "speaker-distance-num", val: "speaker-distance-val" },
    { key: "speakerSpacing", slider: "speaker-width", num: "speaker-width-num", val: "speaker-width-val" },
    { key: "seatingDistance", slider: "listening-distance", num: "listening-distance-num", val: "listening-distance-val" },

    { key: "toe_in_deg", slider: "toe-angle", num: "toe-angle", val: "toe-angle-val" }
  ];

  map.forEach(({ key, slider, num, val }) => {
    const s = document.getElementById(slider);
    const n = document.getElementById(num);
    const v = document.getElementById(val);

    if (currentRoom[key] !== undefined) {
      if (s) s.value = currentRoom[key];
      if (n) n.value = currentRoom[key];
      if (v) v.textContent = currentRoom[key];
    }
  });

  // ✅ SUBWOOFER SELECT SYNC (state → UI)
  const subSel = document.getElementById('subwoofer-present');
  if (subSel && currentRoom.subwoofer) {
    subSel.value = currentRoom.subwoofer;
  }

  // 🪑 Furnishings → UI sync
  const setChk = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== null) el.checked = !!val;
  };

  setChk('opt-area-rug', currentRoom.opt_rug);
  setChk('opt-sofa', currentRoom.opt_sofa);

  const wt = document.getElementById('wall_treatment');
  if (wt && currentRoom.wall_treatment) {
    wt.value = currentRoom.wall_treatment;
  }

  setChk('opt-coffee-table', currentRoom.opt_coffee_table);

  // 🎯 Tweeter height → UI sync
  const th = document.getElementById('tweeter-height-num');
  if (th && currentRoom.tweeter_height_m != null) {
    th.value = currentRoom.tweeter_height_m;
  }


}


// -----------------------------------------------------
// FORM & UI EVENT HANDLERS
// -----------------------------------------------------
export function updateRoomFromForm() {
  console.log("✍ updateRoomFromForm");

  const mapping = {
    length: $('room-length'),
    width: $('room-width'),
    height: $('room-height'),
    seatingDistance: $('listening-distance'),
    speakerDistance: $('speaker-distance'),
    speakerSpacing: $('speaker-width')
  };

  Object.entries(mapping).forEach(([key, el]) => {
    if (!el) return;
    const v = parseFloat(el.value);
    if (!isNaN(v)) currentRoom[key] = v;
  });

  logState("After form update");
}

// -----------------------------------------------------
// INIT — RUN ONLY AFTER DOM IS READY
// -----------------------------------------------------
function initUI() {
  console.log("🚀 DOM READY — Initialising room UI…");

  //setupRoomFormHandlers();

  [
    "room-width", "room-length", "room-height",
    "speaker-distance", "speaker-width", "listening-distance"
  ].forEach(linkInputPair);

  loadRoom(); // async data load
}

document.addEventListener("DOMContentLoaded", initUI);

// -----------------------------------------------------
function updateRoomVisualization() {
  if (typeof window.updateRoomVisualization === 'function') {
    window.updateRoomVisualization();
  }
}

window.saveRoom = saveRoom;
window.loadRoomSetup = loadRoomSetup;
