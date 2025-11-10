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
    const data = await fetchJSON('/api/room');
    if (data.ok && data.room) {
      currentRoom = { ...currentRoom, ...data.room };
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
    const data = await fetchJSON('/api/room', { 
      method: 'POST', 
      body: { room: currentRoom } 
    });
    
    if (data.ok) {
      showToast('Room configuration saved', 'success');
      return true;
    } else {
      throw new Error(data.error || 'Failed to save room');
    }
  } catch (error) {
    console.error('Error saving room:', error);
    showToast('Error saving room configuration', 'error');
    return false;
  }
}

function updateRoomForm() {
  const elements = {
    roomLength: $('roomLength'),
    roomWidth: $('roomWidth'),
    roomHeight: $('roomHeight'),
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
    roomLength: $('roomLength'),
    roomWidth: $('roomWidth'),
    roomHeight: $('roomHeight'),
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
  const inputs = ['roomLength', 'roomWidth', 'roomHeight', 'seatingDistance', 'speakerDistance', 'speakerSpacing'];
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
}

// Initialize room functionality
export function initRoom() {
  setupRoomFormHandlers();
  loadRoom();
}

// Global functions for HTML handlers
window.calculateOptimalPlacement = calculateOptimalPlacement;
window.updateRoomFromForm = updateRoomFromForm;