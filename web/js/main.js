// web/js/main.js - Fixed for Enhanced Dashboard Integration

import { $, setDisabled, runSweepAPI, quipAndSpeak, getStatus, simpleResult, geekResult, fetchSessions, filterGenerate } from './api.js';

// Configuration for dashboard selection
window.DASH_CONFIG = {
  useDashboard: true,  // Set to false to use original dashboard
  debugMode: 1,               // Enable debug logging
  demoMode: false             // Set to true for demo mode
};

// Enhanced Dashboard Class
let Dashboard = null;

function toggleAnalysisSpinner(show = true) {
  const sp = document.getElementById('analysisSpinner');
  if (sp) sp.classList.toggle('active', show);
}

/* -------------------- Actions -------------------- */
async function runSweep() {
  const runBtn = $('runBtn');
  const logsEl = $('logs');

  setDisabled(runBtn, true);
  runBtn?.setAttribute('aria-busy', 'true');
  if (logsEl) {
    logsEl.textContent = 'Running…';
    logsEl.removeAttribute('aria-live');
  }

  try {
    const payload = { speaker: currentSpeakerKey() || null };
    const data = await runSweepAPI(payload);

    if (logsEl) {
      logsEl.textContent = data?.stdout || '(no output)';
      logsEl.setAttribute('tabindex', '-1');
      logsEl.focus();
    }

    if (data?.session_id) {
      await openSession(data.session_id);
      await fetchSessions();
      await renderSimpleAndGeek(data.session_id);

      // Replaces browser-side child_process with a safe server call:
      if (data?.savedDir) {
        try { await quipAndSpeak(data.savedDir); } catch(e) { /* non-fatal */ }
      }
    }

    await refreshStatus();
    
    // Refresh both dashboards if available
    if (window.DASH_CONFIG.useDashboard && Dashboard) {
      await Dashboard.refresh();
    } else {
      await refreshDashboard();
    }
  } catch (e) {
    if (logsEl) {
      logsEl.setAttribute('aria-live', 'polite');
      logsEl.textContent = `Error: ${e?.message || e}`;
    }
  } finally {
    runBtn?.removeAttribute('aria-busy');
    setDisabled(runBtn, false);
    refreshStatus();
  }
}

/* -------------------- Enhanced Dashboard Class -------------------- */
class DashboardApp {
  constructor() {
    this.currentSection = 'dashboard';
    this.deviceStatus = {};
    this.currentData = null;
    this.sessions = [];
    this.settings = {};
    this.isSweepRunning = false;
    this.lastMicOK = null;
    this.lastDacOK = null;
  }

  async init() {
    await this.loadInitialData();
    this.setupEventListeners();
    this.startPolling();
    this.showSection('dashboard');
    this.render();
  }

  async loadInitialData() {
    try {
      // Load device status
      this.deviceStatus = await this.getStatus();
      
      // Load latest analysis
      const simpleData = await this.simpleResult();
      if (simpleData && simpleData.ok) {
        this.currentData = simpleData;
      }
      
      // Load sessions
      const sessionsData = await this.fetchSessions();
      if (sessionsData) {
        this.sessions = sessionsData;
      }
      
      // Load speakers
      await this.loadSpeakers();
      
    } catch (error) {
      console.error('Error loading initial data:', error);
      this.showError('Failed to load initial data');
    }
  }

  async loadSpeakers() {
    try {
      const response = await fetch('/speakers/speakers.json');
      if (response.ok) {
        const speakers = await response.json();
        const select = document.getElementById('speakerSelect');
        select.innerHTML = '<option value="">Default</option>';
        
        Object.keys(speakers).forEach(key => {
          const option = document.createElement('option');
          option.value = key;
          option.textContent = speakers[key].name || key;
          select.appendChild(option);
        });
      }
    } catch (error) {
      console.warn('Could not load speakers:', error);
    }
  }

  setupEventListeners() {
    // Navigation for enhanced dashboard
    document.querySelectorAll('.nav-item[data-section]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const section = e.target.getAttribute('data-section');
        if (section) {
          this.showSection(section);
          
          // Update active nav item
          document.querySelectorAll('.nav-item[data-section]').forEach(nav => {
            nav.classList.remove('active');
            nav.removeAttribute('aria-current');
          });
          e.target.classList.add('active');
          e.target.setAttribute('aria-current', 'page');
        }
      });
    });

    // Sweep controls
    document.getElementById('runSweepBtn').addEventListener('click', () => this.runSweep());
    document.getElementById('stopSweepBtn').addEventListener('click', () => this.stopSweep());

    // Channel selection
    document.getElementById('leftChannelBtn').addEventListener('click', () => this.showChannel('left'));
    document.getElementById('rightChannelBtn').addEventListener('click', () => this.showChannel('right'));
    document.getElementById('bothChannelsBtn').addEventListener('click', () => this.showChannel('both'));

    // Action buttons
    document.getElementById('saveResultsBtn').addEventListener('click', () => this.saveResults());
    document.getElementById('exportReportBtn').addEventListener('click', () => this.exportReport());
    document.getElementById('generateFiltersBtn').addEventListener('click', () => this.generateFilters());
    document.getElementById('downloadFiltersBtn').addEventListener('click', () => this.downloadFilters());
    document.getElementById('refreshSessionsBtn').addEventListener('click', () => this.refreshSessions());
    document.getElementById('clearAllSessionsBtn').addEventListener('click', () => this.clearAllSessions());

    // Room setup forms
    document.getElementById('roomDimensionsForm').addEventListener('submit', (e) => this.saveRoomSetup(e));
    document.getElementById('speakerPlacementForm').addEventListener('submit', (e) => this.saveSpeakerSetup(e));
  }

  showSection(sectionName) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(section => {
      section.classList.remove('active');
    });
    
    // Show selected section
    const targetSection = document.getElementById(sectionName + '-section');
    if (targetSection) {
      targetSection.classList.add('active');
      this.currentSection = sectionName;
      
      // Load section-specific data
      if (sectionName === 'sessions') {
        this.refreshSessions();
      } else if (sectionName === 'room-setup') {
        this.loadRoomSetup();
      }
    }
  }

  async refresh() {
    await this.loadInitialData();
    this.render();
  }

  async refreshSessions() {
    try {
      const sessionsData = await this.fetchSessions();
      if (sessionsData) {
        this.sessions = sessionsData;
        this.renderSessions();
      }
    } catch (error) {
      console.error('Error refreshing sessions:', error);
    }
  }

  loadRoomSetup() {
    // Load existing room setup from settings
    if (this.settings.room) {
      const room = this.settings.room;
      const roomLength = document.getElementById('roomLength');
      const roomWidth = document.getElementById('roomWidth');
      const roomHeight = document.getElementById('roomHeight');
      const seatingDistance = document.getElementById('seatingDistance');
      
      if (roomLength) roomLength.value = room.length || 4.0;
      if (roomWidth) roomWidth.value = room.width || 4.0;
      if (roomHeight) roomHeight.value = room.height || 3.0;
      if (seatingDistance) seatingDistance.value = room.seatingDistance || 3.0;
    }
  }

  render() {
    // Update device status display
    this.updateDeviceStatus();
    this.renderSessions();
  }

  renderSessions() {
    const container = document.getElementById('sessionsList');
    if (!container) return;
    
    if (this.sessions.length === 0) {
      container.innerHTML = '<div class="text-center text-gray-500 py-8">No sessions found</div>';
      return;
    }
    
    container.innerHTML = this.sessions.slice(0, 10).map(session => {
      const date = new Date(session.id).toLocaleDateString();
      const time = new Date(session.id).toLocaleTimeString();
      
      return `
        <div class="session-card flex items-center justify-between">
          <div>
            <div class="font-semibold text-gray-800">Session ${session.id}</div>
            <div class="text-sm text-gray-600">${date} at ${time}</div>
            <div class="text-xs text-gray-500 mt-1">
              ${session.has_analysis ? '✓ Analysis' : 'No analysis'} • 
              ${session.has_summary ? '✓ Summary' : 'No summary'}
            </div>
          </div>
          <div class="flex space-x-2">
            <button class="btn btn-primary btn-sm" onclick="openSession('${session.id}')">
              <i class="fas fa-folder-open mr-1"></i>Open
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteSession('${session.id}')">
              <i class="fas fa-trash mr-1"></i>Delete
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  async runSweep() {
    if (this.isSweepRunning) return;

    const btn   = document.getElementById('runSweepBtn');
    const stopBtn = document.getElementById('stopSweepBtn');
    const logsEl = document.getElementById('logs');

    this.isSweepRunning = true;
    if (btn) {
      btn.disabled = true;
      btn.classList.add('opacity-50');
    }
    if (stopBtn) stopBtn.classList.remove('hidden');
    if (logsEl) logsEl.textContent = 'Starting sweep...\n';

    try {
      const speakerVal = document.getElementById('speakerSelect')?.value || null;
      const data = await this.runSweepAPI({ speaker: speakerVal });

      if (!data.ok) throw new Error(data.error || 'Sweep failed');

      /* 1.  show spinner while analysis runs  */
      toggleAnalysisSpinner(true);
      if (logsEl) logsEl.textContent += '\nAnalysing…\n';

      /* 2.  wait for analysis to finish  */
      await this.waitForAnalysis(data.session_id);   // helper below

      /* 3.  hide spinner  */
      toggleAnalysisSpinner(false);

      if (logsEl) logsEl.textContent += data.stdout || 'Sweep completed';

      // refresh UI
      setTimeout(async () => {
        await this.loadInitialData();
        this.render();
      }, 500);

    } catch (err) {
      console.error('Sweep error:', err);
      if (logsEl) logsEl.textContent += `\nError: ${err.message}`;
      this.showError('Sweep failed: ' + err.message);
    } finally {
      this.isSweepRunning = false;
      toggleAnalysisSpinner(false);          // belt-and-braces
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('opacity-50');
      }
      if (stopBtn) stopBtn.classList.add('hidden');
    }
  }

  /* helper: poll until analysis.ready == true */
  async waitForAnalysis(sessionId) {
    for (let i = 0; i < 60; i++) {          // 60 × 1 s = 60 s max
      const st = await this.getStatus();
      if (st.ready) return;                 // analysis finished
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('Analysis timed out');
  }
  stopSweep() {
    console.log('Stop sweep requested');
    this.showInfo('Sweep stop requested - feature coming soon');
  }

  updateDeviceStatus() {
    const status = this.deviceStatus;
    const indicator = document.getElementById('deviceStatusIndicator');
    const statusText = document.getElementById('deviceStatusText');
    
    const inputConnected = status?.mic?.connected;
    const outputConnected = status?.dac?.connected;
    const ready = inputConnected && outputConnected;
    
    if (indicator && statusText) {
      if (ready) {
        indicator.className = 'status-indicator status-good pulse-animation';
        statusText.textContent = 'System Ready';
      } else {
        indicator.className = 'status-indicator status-warning pulse-animation';
        statusText.textContent = 'Device Check Required';
      }
    }

    // Update device details
    const inputDevice = document.getElementById('inputDevice');
    const outputDevice = document.getElementById('outputDevice');
    const wifiStatus = document.getElementById('wifiStatus');
    
    if (inputDevice) inputDevice.textContent = inputConnected ? (status.mic.name || 'Connected') : 'Not Connected';
    if (outputDevice) outputDevice.textContent = outputConnected ? (status.dac.name || 'Connected') : 'Not Connected';
    if (wifiStatus) wifiStatus.textContent = 'Checking...';

    // Update sweep button
    const sweepBtn = document.getElementById('runSweepBtn');
    if (sweepBtn) {
      if (ready) {
        sweepBtn.disabled = false;
        sweepBtn.classList.remove('opacity-50');
      } else {
        sweepBtn.disabled = true;
        sweepBtn.classList.add('opacity-50');
      }
    }
  }

  startPolling() {
    // Poll device status every 4 seconds
    setInterval(async () => {
      try {
        this.deviceStatus = await this.getStatus();
        this.updateDeviceStatus();
      } catch (error) {
        console.error('Error polling device status:', error);
      }
    }, 4000);
    
    // Update last updated time
    setInterval(() => {
      const lastUpdated = document.getElementById('lastUpdated');
      if (lastUpdated) lastUpdated.textContent = new Date().toLocaleTimeString();
    }, 1000);
  }

  // API methods (copied from api.js to ensure they work)
  async fetchJSON(url, opts = {}, retries = 0) {
    const init = { cache: 'no-store', ...opts };

    if (init.body && typeof init.body === 'object' && !(init.body instanceof FormData)) {
      init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
      init.body = JSON.stringify(init.body);
    }

    for (let i = 0; i <= retries; i++) {
      try {
        const res = await fetch(url, init);
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(`${url} → HTTP ${res.status}${txt ? ` – ${txt}` : ''}`);
        }
        return await res.json();
      } catch (err) {
        if (i === retries) throw err;
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }

  async getStatus() {
    const data = await this.fetchJSON('/api/status', {}, 1); // retry once
    if (!data) return { ready: false, reason: 'no-status' };

    const inputOk = !!data?.mic?.connected;
    const outputOk = !!data?.dac?.connected;

    return {
      ...data,
      ready: typeof data.ready === 'boolean' ? data.ready : (inputOk && outputOk),
      reason: data.reason || (!inputOk ? 'no-input' : !outputOk ? 'no-output' : '')
    };
  }

  async runSweepAPI(payload = {}) {
    return this.fetchJSON('/api/run-sweep', { method: 'POST', body: payload });
  }

  async openSessionAPI(sessionId) {
    return this.fetchJSON(`/api/session/${encodeURIComponent(sessionId)}`);
  }

  async fetchSessionsAPI() {
    return this.fetchJSON('/api/sessions');
  }

  async simpleResultAPI(sessionId = '') {
    return this.fetchJSON(sessionId ? `/api/simple?sid=${encodeURIComponent(sessionId)}` : '/api/simple');
  }

  async geekResultAPI(sessionId = '') {
    return this.fetchJSON(sessionId ? `/api/geek?sid=${encodeURIComponent(sessionId)}` : '/api/geek');
  }

  async filterGenerate() {
    return this.fetchJSON('/api/filter', { method: 'POST' });
  }

  async quipAndSpeak(savedDir) {
    if (!savedDir) return { ok: false, error: 'missing-dir' };
    return this.fetchJSON('/api/quip-and-speak', { method: 'POST', body: { dir: savedDir } });
  }

  showError(message) {
    this.showMessage(message, 'error');
  }

  showSuccess(message) {
    this.showMessage(message, 'success');
  }

  showInfo(message) {
    this.showMessage(message, 'info');
  }

  showMessage(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 ${
      type === 'error' ? 'bg-red-600 text-white' :
      type === 'success' ? 'bg-green-600 text-white' :
      'bg-blue-600 text-white'
    }`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.remove();
    }, 5000);
  }
}


/* -------------------- Bootstrapping -------------------- */
document.addEventListener('DOMContentLoaded', async () => {
  // Check if enhanced dashboard should be used
  if (window.DASH_CONFIG.useDashboard) {
    console.log('[Main] Using enhanced dashboard');
    
    // Initialize enhanced dashboard
    Dashboard = new DashboardApp();
    window.dashboard = Dashboard;
    
  } else {
    console.log('[Main] Using original dashboard');
    
    // Wire original controls
    $('runBtn')?.addEventListener('click', runSweep);
    $('saveRoomBtn')?.addEventListener('click', saveRoom);
    $('wifiScanBtn')?.addEventListener('click', scanWifi);
    $('wifiConnectBtn')?.addEventListener('click', connectWifi);
    $('hotspotStopBtn')?.addEventListener('click', stopHotspot);
    bindWifiSelect();

    // Initialize original components
    await initSpeakers();
    initDashboard();

    // Initial fetches
    refreshStatus();
    fetchSessions();
    loadRoom();
    wifiStatus();
    scanWifi();

    // First render
    renderSimpleAndGeek();
    refreshDashboard();

    // Polling
    setInterval(refreshStatus, 4000);
    setInterval(wifiStatus, 5000);
  }
});

/* -------------------- Export for Enhanced Dashboard -------------------- */
function toggleAnalysisSpinner(show = true) {
  const sp = document.getElementById('analysisSpinner');
  if (sp) sp.classList.toggle('active', show);
}

/*  always boot the single dashboard  */
const dashboard = new DashboardApp();
dashboard.init();