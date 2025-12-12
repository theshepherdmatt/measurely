// web/js/sessions.js - Session management

import { $, fetchJSON, showToast } from './api.js';

let sessions = [];

export async function fetchSessions() {
  try {
    const data = await fetchJSON('/api/sessions');
    sessions = data || [];
    renderSessionsList();
    return sessions;
  } catch (error) {
    console.error('Error fetching sessions:', error);
    showToast('Error fetching sessions', 'error');
    return [];
  }
}

export async function openSession(sessionId) {
  try {
    const data = await fetchJSON(`/api/session/${encodeURIComponent(sessionId)}`);
    if (data.ok) {
      showToast(`Session ${sessionId} opened`, 'success');
      return data;
    } else {
      throw new Error(data.error || 'Failed to open session');
    }
  } catch (error) {
    console.error('Error opening session:', error);
    showToast('Error opening session', 'error');
    return null;
  }
}

export async function deleteSession(sessionId) {
  if (!confirm(`Delete session ${sessionId}?`)) return false;
  
  try {
    const data = await fetchJSON(`/api/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    if (data.ok) {
      showToast('Session deleted', 'success');
      await fetchSessions(); // Refresh list
      return true;
    } else {
      throw new Error(data.error || 'Failed to delete session');
    }
  } catch (error) {
    console.error('Error deleting session:', error);
    showToast('Error deleting session', 'error');
    return false;
  }
}

export async function clearAllSessions() {
  if (!confirm('Delete all sessions? This cannot be undone.')) return false;
  
  try {
    const data = await fetchJSON('/api/sessions', { method: 'DELETE' });
    if (data.ok) {
      showToast('All sessions deleted', 'success');
      sessions = [];
      renderSessionsList();
      return true;
    } else {
      throw new Error(data.error || 'Failed to clear sessions');
    }
  } catch (error) {
    console.error('Error clearing sessions:', error);
    showToast('Error clearing sessions', 'error');
    return false;
  }
}

function renderSessionsList() {
  const container = $('sessionsList');
  const countEl = $('sessionCount');
  
  if (!container) return;
  
  if (countEl) {
    countEl.textContent = sessions.length;
  }
  
  if (sessions.length === 0) {
    container.innerHTML = `
      <div class="text-center text-white opacity-60 py-8">
        <i class="fas fa-history text-4xl mb-4"></i>
        <p>No sessions found. Run a sweep to create your first session.</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = sessions.slice(0, 10).map(session => {
    const date = new Date(session.id).toLocaleDateString();
    const time = new Date(session.id).toLocaleTimeString();
    const isComplete = session.has_analysis && session.has_summary;
    
    return `
      <div class="session-card glass-card p-4 mb-4 rounded-lg">
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <div class="flex items-center mb-2">
              <div class="w-3 h-3 rounded-full mr-3 ${
                isComplete ? 'bg-green-500' : session.has_analysis ? 'bg-yellow-500' : 'bg-gray-500'
              }"></div>
              <h4 class="font-semibold text-white">Session ${session.id}</h4>
            </div>
            <p class="text-white opacity-80 text-sm">${date} at ${time}</p>
            <div class="text-xs text-white opacity-60 mt-1">
              ${session.has_analysis ? '✓ Analysis' : 'No analysis'} • 
              ${session.has_summary ? '✓ Summary' : 'No summary'}
            </div>
          </div>
          <div class="flex space-x-2">
            <button class="btn-primary" onclick="openSession('${session.id}')">
              <i class="fas fa-folder-open mr-1"></i>Open
            </button>
            <button class="btn-primary" onclick="deleteSession('${session.id}')">
              <i class="fas fa-trash mr-1"></i>Delete
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Global functions for HTML onclick handlers
window.openSession = openSession;
window.deleteSession = deleteSession;
window.clearAllSessions = clearAllSessions;
window.fetchSessions = fetchSessions;