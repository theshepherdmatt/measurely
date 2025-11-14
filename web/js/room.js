// web/js/room.js - Room configuration management

import { $, fetchJSON, showToast } from './api.js';

let currentRoom = {
  length: 4.0,
  width: 4.0,
  height: 3.0,
  seatingDistance: 3.0,
  speakerDistance: 0.2,
  speakerSpacing: 2.0
};

export async function loadRoom() {
  try {
    const data = await fetchJSON('/api/room/latest');

    if (data) {
      currentRoom = {
        ...currentRoom,
        length: data.length_m ?? currentRoom.length,
        width: data.width_m ?? currentRoom.width,
        height: data.height_m ?? currentRoom.height,
        speakerDistance: data.spk_front_m ?? currentRoom.speakerDistance,
        speakerSpacing: data.spk_spacing_m ?? currentRoom.speakerSpacing,
        seatingDistance: data.listener_front_m ?? currentRoom.seatingDistance
      };

      updateRoomForm();
      updateRoomVisualization();
    }

    return currentRoom;

  } catch (error) {
    console.error('Error loading room:', error);
    showToast('Error loading room configuration', 'error');
    return currentRoom;
  }
}


export async function saveRoom() {
  try {
    const payload = {
      length_m: currentRoom.length,
      width_m: currentRoom.width,
      height_m: currentRoom.height,
      spk_front_m: currentRoom.speakerDistance,
      spk_spacing_m: currentRoom.speakerSpacing,
      listener_front_m: currentRoom.seatingDistance
    };

    await fetchJSON(`/api/room/${window.activeSessionId}`, {
      method: 'POST',
      body: payload
    });


    showToast('Room configuration saved', 'success');
    return true;

  } catch (error) {
    console.error('Error saving room:', error);
    showToast('Error saving room configuration', 'error');
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
  
  Object.entries(elements).forEach(([key, element]) => {
    if (element) {
      const roomKey = key.replace(/([A-Z])/g, (match, letter) => 
        letter.toLowerCase()
      ).replace('room', '');
      
      if (currentRoom[roomKey] !== undefined) {
        element.value = currentRoom[roomKey];
      }
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
  
  Object.entries(elements).forEach(([key, element]) => {
    if (element) {
      const roomKey = key.replace(/([A-Z])/g, (match, letter) => 
        letter.toLowerCase()
      ).replace('room', '');
      
      const value = parseFloat(element.value);
      if (!isNaN(value)) {
        currentRoom[roomKey] = value;
      }
    }
  });
}

export function calculateOptimalPlacement() {
  // 38% rule for listening position
  const optimalDistance = currentRoom.length * 0.38;
  currentRoom.seatingDistance = optimalDistance;
  
  // Speaker spacing should be about 60% of listening distance
  const optimalSpacing = optimalDistance * 0.6;
  currentRoom.speakerSpacing = optimalSpacing;
  
  updateRoomForm();
  updateRoomVisualization();
  
  showToast('Optimal placement calculated! Your listening position is now at the 38% point for best bass response.', 'success');
}

export function calculateRoomModes() {
  const speedOfSound = 343; // m/s
  const modes = [];
  
  // Axial modes
  const lengthMode = speedOfSound / (2 * currentRoom.length);
  const widthMode = speedOfSound / (2 * currentRoom.width);
  const heightMode = speedOfSound / (2 * currentRoom.height);
  
  modes.push(
    { type: 'length', frequency: lengthMode, dimension: currentRoom.length },
    { type: 'width', frequency: widthMode, dimension: currentRoom.width },
    { type: 'height', frequency: heightMode, dimension: currentRoom.height }
  );
  
  // Tangential modes (first order)
  modes.push(
    { 
      type: 'length-width', 
      frequency: Math.sqrt(Math.pow(speedOfSound / (2 * currentRoom.length), 2) + 
                          Math.pow(speedOfSound / (2 * currentRoom.width), 2)),
      dimensions: [currentRoom.length, currentRoom.width]
    }
  );
  
  return modes.sort((a, b) => a.frequency - b.frequency);
}

export function calculateReverbTime() {
  // Simplified Sabine formula
  const volume = currentRoom.length * currentRoom.width * currentRoom.height;
  const surfaceArea = 2 * (currentRoom.length * currentRoom.width + 
                          currentRoom.length * currentRoom.height + 
                          currentRoom.width * currentRoom.height);
  
  // Assume average absorption coefficient of 0.2
  const absorption = surfaceArea * 0.2;
  
  return (0.161 * volume) / absorption; // Sabine formula in seconds
}

export function calculateCriticalDistance() {
  const volume = currentRoom.length * currentRoom.width * currentRoom.height;
  const reverbTime = calculateReverbTime();
  
  // Critical distance formula
  return 0.057 * Math.sqrt(volume / reverbTime);
}

function updateRoomVisualization() {
  // Update room visualization if available
  const roomVisual = $('room-visual');
  if (roomVisual && typeof window.updateRoomVisualization === 'function') {
    window.updateRoomVisualization();
  }
}

// Form handlers
export function setupRoomFormHandlers() {
  const roomForm = $('roomForm');
  if (roomForm) {
    roomForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      updateRoomFromForm();
      await saveRoom();
    });
  }

  // Auto-save on input change
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
    if (el) {
      el.addEventListener('change', () => {
        updateRoomFromForm();
        updateRoomVisualization();
      });
    }
  });

  // Optimal placement
  const optimalBtn = $('optimalPlacementBtn');
  if (optimalBtn) {
    optimalBtn.addEventListener('click', calculateOptimalPlacement);
  }

  // *** THIS IS THE MISSING BUTTON ***
  const updateBtn = $('updateRoomBtn');     // <-- must match your HTML button ID
  if (updateBtn) {
    updateBtn.addEventListener('click', async () => {
      updateRoomFromForm();
      updateRoomVisualization();
      await saveRoom();
    });
  }
  
  // Save-setup button
  const saveBtn = document.getElementById('save-room-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      updateRoomFromForm();          // grab current form values
      await saveRoom();              // persist to /api/room/latest
    });
  }
}

  
  // Auto-save on input change
  const inputs = ['room-length', 'room-width', 'room-height', 'seatingDistance', 'speakerDistance', 'speakerSpacing'];
  inputs.forEach(id => {
    const element = $(id);
    if (element) {
      element.addEventListener('change', () => {
        updateRoomFromForm();
        updateRoomVisualization();
      });
    }
  });
  
  // Optimal placement button
  const optimalBtn = $('optimalPlacementBtn');
  if (optimalBtn) {
    optimalBtn.addEventListener('click', calculateOptimalPlacement);
  }


// Initialize room functionality
export function initRoom() {
  setupRoomFormHandlers();
  loadRoom();
}

window.updateRoomCanvas = function(room) {
    const length = Number(room.length) || 4.0;
    const width  = Number(room.width)  || 4.0;

    const canvas = document.getElementById("room-layout-canvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    // Clear old drawing
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Scale room to fit
    const scale = Math.min(
        canvas.width / length,
        canvas.height / width
    );

    const drawLength = length * scale;
    const drawWidth  = width  * scale;

    // Draw room border
    ctx.strokeStyle = "#888";
    ctx.lineWidth = 2;
    ctx.strokeRect(
        (canvas.width  - drawLength) / 2,
        (canvas.height - drawWidth)  / 2,
        drawLength,
        drawWidth
    );

    // TODO later: draw speakers + ear using real saved coordinates
};


// Global functions for HTML handlers
window.calculateOptimalPlacement = calculateOptimalPlacement;
window.updateRoomFromForm = updateRoomFromForm;