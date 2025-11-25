// web/js/room.js - Room configuration management

import { $, fetchJSON, showToast } from './api.js';

let currentRoom = {
  length: 4.0,
  width: 4.0,
  height: 3.0,
  seatingDistance: 3.0,
  speakerDistance: 0.2,
  speakerSpacing: 2.0,

  // new persistent fields
  speaker_key: null,
  toe_in_deg: null,
  echo_pct: null,

  opt_hardfloor: null,
  opt_barewalls: null,
  opt_rug: null,
  opt_curtains: null,
  opt_sofa: null,
  opt_wallart: null
};

export async function loadRoom() {
  try {
    const data = await fetchJSON('/api/room/latest');

    if (data) {
      currentRoom = {
        ...currentRoom,

        // main dimensions
        length: data.length_m ?? currentRoom.length,
        width: data.width_m ?? currentRoom.width,
        height: data.height_m ?? currentRoom.height,

        // placement
        speakerDistance: data.spk_front_m ?? currentRoom.speakerDistance,
        speakerSpacing: data.spk_spacing_m ?? currentRoom.speakerSpacing,
        seatingDistance: data.listener_front_m ?? currentRoom.seatingDistance,

        // NEW persistent values
        speaker_key: data.speaker_key ?? currentRoom.speaker_key,
        toe_in_deg: data.toe_in_deg ?? currentRoom.toe_in_deg,
        echo_pct: data.echo_pct ?? currentRoom.echo_pct,

        opt_hardfloor: data.opt_hardfloor ?? currentRoom.opt_hardfloor,
        opt_barewalls: data.opt_barewalls ?? currentRoom.opt_barewalls,
        opt_rug: data.opt_rug ?? currentRoom.opt_rug,
        opt_curtains: data.opt_curtains ?? currentRoom.opt_curtains,
        opt_sofa: data.opt_sofa ?? currentRoom.opt_sofa,
        opt_wallart: data.opt_wallart ?? currentRoom.opt_wallart
      };

      updateRoomForm();
      updateRoomVisualization();
    }

    return currentRoom;

  } catch (error) {
    console.error("Error loading room:", error);
    showToast("Error loading room configuration", "error");
    return currentRoom;
  }
}

export async function saveRoom() {
  try {
    const payload = {
      length_m: currentRoom.length,
      width_m: currentRoom.width,
      height_m: currentRoom.height,

      listener_front_m: currentRoom.seatingDistance,
      spk_front_m: currentRoom.speakerDistance,
      spk_spacing_m: currentRoom.speakerSpacing,

      speaker_key: currentRoom.speaker_key ?? null,
      toe_in_deg: currentRoom.toe_in_deg ?? 0,
      echo_pct: currentRoom.echo_pct ?? 50,

      opt_hardfloor: currentRoom.opt_hardfloor ?? false,
      opt_barewalls: currentRoom.opt_barewalls ?? false,
      opt_rug: currentRoom.opt_rug ?? false,
      opt_curtains: currentRoom.opt_curtains ?? false,
      opt_sofa: currentRoom.opt_sofa ?? false,
      opt_wallart: currentRoom.opt_wallart ?? false
    };

    await fetchJSON(`/api/room/latest`, {
      method: 'POST',
      body: payload
    });

    showToast("Room configuration saved", "success");
    return true;

  } catch (error) {
    console.error("Error saving room:", error);
    showToast("Error saving room configuration", "error");
    return false;
  }
}

function updateRoomForm() {
  const elements = {
    roomLength: $('room-length'),
    roomWidth: $('room-width'),
    roomHeight: $('room-height'),
    seatingDistance: $('seatingDistance'),
    speakerDistance: $('speakerDistance'),
    speakerSpacing: $('speakerSpacing')
  };

  Object.entries(elements).forEach(([key, el]) => {
    if (!el) return;

    const roomKey = key
      .replace(/([A-Z])/g, (_, letter) => letter.toLowerCase())
      .replace('room', '');

    if (currentRoom[roomKey] !== undefined) {
      el.value = currentRoom[roomKey];
    }
  });
}

export function updateRoomFromForm() {
  const elements = {
    roomLength: $('room-length'),
    roomWidth: $('room-width'),
    roomHeight: $('room-height'),
    seatingDistance: $('seatingDistance'),
    speakerDistance: $('speakerDistance'),
    speakerSpacing: $('speakerSpacing')
  };

  Object.entries(elements).forEach(([key, el]) => {
    if (!el) return;

    const roomKey = key
      .replace(/([A-Z])/g, (_, letter) => letter.toLowerCase())
      .replace('room', '');

    const value = parseFloat(el.value);
    if (!isNaN(value)) currentRoom[roomKey] = value;
  });
}

export function calculateOptimalPlacement() {
  const optimalDistance = currentRoom.length * 0.38;
  currentRoom.seatingDistance = optimalDistance;

  const optimalSpacing = optimalDistance * 0.6;
  currentRoom.speakerSpacing = optimalSpacing;

  updateRoomForm();
  updateRoomVisualization();

  showToast(
    "Optimal placement calculated! Listening position set to the 38% rule.",
    "success"
  );
}

export function calculateRoomModes() {
  const speed = 343;
  return [
    { type: "length", frequency: speed / (2 * currentRoom.length) },
    { type: "width", frequency: speed / (2 * currentRoom.width) },
    { type: "height", frequency: speed / (2 * currentRoom.height) },
    {
      type: "length-width",
      frequency: Math.sqrt(
        Math.pow(speed / (2 * currentRoom.length), 2) +
        Math.pow(speed / (2 * currentRoom.width), 2)
      )
    }
  ].sort((a, b) => a.frequency - b.frequency);
}

export function calculateReverbTime() {
  const vol = currentRoom.length * currentRoom.width * currentRoom.height;
  const area =
    2 *
    (currentRoom.length * currentRoom.width +
      currentRoom.length * currentRoom.height +
      currentRoom.width * currentRoom.height);

  return (0.161 * vol) / (area * 0.2);
}

export function calculateCriticalDistance() {
  const vol = currentRoom.length * currentRoom.width * currentRoom.height;
  const rt = calculateReverbTime();
  return 0.057 * Math.sqrt(vol / rt);
}

function updateRoomVisualization() {
  const box = $('room-visual');
  if (box && typeof window.updateRoomVisualization === 'function') {
    window.updateRoomVisualization();
  }
}

export function setupRoomFormHandlers() {
  const form = $('roomForm');
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      updateRoomFromForm();
      await saveRoom();
    });
  }

  const inputs = [
    'room-length',
    'room-width',
    'room-height',
    'seatingDistance',
    'speakerDistance',
    'speakerSpacing'
  ];

  inputs.forEach(id => {
    const el = $(id);
    if (!el) return;

    el.addEventListener("change", () => {
      updateRoomFromForm();
      updateRoomVisualization();
    });
  });

  const optimalBtn = $('optimalPlacementBtn');
  if (optimalBtn) {
    optimalBtn.addEventListener('click', calculateOptimalPlacement);
  }

  const updateBtn = $('updateRoomBtn');
  if (updateBtn) {
    updateBtn.addEventListener('click', async () => {
      updateRoomFromForm();
      updateRoomVisualization();
      await saveRoom();
    });
  }

  const saveBtn = $('save-room-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      updateRoomFromForm();
      await saveRoom();
    });
  }
}

export function initRoom() {
  setupRoomFormHandlers();
  loadRoom();
}

// canvas drawing (kept as-is)
window.updateRoomCanvas = function(room) {
  const length = Number(room.length) || 4.0;
  const width = Number(room.width) || 4.0;

  const canvas = document.getElementById("room-layout-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const scale = Math.min(canvas.width / length, canvas.height / width);
  const drawLength = length * scale;
  const drawWidth = width * scale;

  ctx.strokeStyle = "#888";
  ctx.lineWidth = 2;
  ctx.strokeRect(
    (canvas.width - drawLength) / 2,
    (canvas.height - drawWidth) / 2,
    drawLength,
    drawWidth
  );
};

window.calculateOptimalPlacement = calculateOptimalPlacement;
window.updateRoomFromForm = updateRoomFromForm;
