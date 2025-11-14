window.usedBuddyTips = {
  boom: new Set(),
  mid: new Set(),
  top: new Set(),
  echo: new Set(),
  fix: new Set(),
  cold: new Set(),
  cool: new Set(),
  warm: new Set(),
  hot: new Set()
};

window.pickUniqueTip = function(bucket, allTips) {
  if (!allTips || allTips.length === 0) return '';

  const used = window.usedBuddyTips[bucket];

  // Reset if we’ve used all
  if (used.size >= allTips.length) used.clear();

  let tip = null;
  for (let i = 0; i < 20; i++) {
    const c = allTips[Math.floor(Math.random() * allTips.length)];
    if (!used.has(c)) {
      tip = c;
      break;
    }
  }

  if (!tip) tip = allTips[0];

  used.add(tip);
  return tip;
};


class MeasurelyDashboard {
    constructor() {
        this.currentData = null;
        this.isSweepRunning = false;
        this.deviceStatus = {};
        this.updateInterval = null;
        this.sweepCheckInterval = null;
        this.loadFootTags();
        this.loadBuddyPhrases();
        this.init();
    }
    

    /* ---------- load foot tag-lines once ---------- */
    async loadFootTags() {
        try {
            const res = await fetch('/foot_tags.json');
            if (!res.ok) throw new Error(res.status);
            window.footBank = await res.json();
            console.log("foot_tags loaded");
        } catch {
            window.footBank = {};
        }
    }

    async loadBuddyPhrases() {
    try {
        const res = await fetch('/buddy_phrases.json');
        if (!res.ok) throw new Error(res.status);
        window.buddyBank = await res.json();
        console.log("buddy_phrases loaded");
    } catch {
        window.buddyBank = {};
    }
    }


    async init() {
        console.log('Initializing Measurely Dashboard...');
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Load initial data
        await this.loadData();
        
        // Start polling for updates
        this.startPolling();
        
        console.log('Dashboard initialized successfully');
    }

    setupEventListeners() {
        // Run sweep button
        document.getElementById('runSweepBtn').addEventListener('click', () => {
            this.runSweep();
        });

        // Channel selection buttons
        document.getElementById('leftChannelBtn').addEventListener('click', () => {
            this.showChannel('left');
        });
        
        document.getElementById('rightChannelBtn').addEventListener('click', () => {
            this.showChannel('right');
        });
        
        document.getElementById('bothChannelsBtn').addEventListener('click', () => {
            this.showChannel('both');
        });

        // Action buttons
        document.getElementById('saveResultsBtn').addEventListener('click', () => {
            this.saveResults();
        });
        
        document.getElementById('exportReportBtn').addEventListener('click', () => {
            this.exportReport();
        });
    }

    async loadData() {
        try {
            console.log('Loading latest measurement data...');

            // Set loading state on score UI
            this.showLoadingState();

            // Fetch latest analysis JSON from backend
            const response = await fetch('/api/latest');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            // Parse JSON into dashboard state
            this.currentData = await response.json();

            // --- ROOM DATA DEBUG ---
            if (this.currentData.room) {
                console.log("ROOM DATA:", this.currentData.room);
                console.log("Room length:", this.currentData.room.length);
                console.log("Room width :", this.currentData.room.width);
                console.log("Room height:", this.currentData.room.height);
            } else {
                console.log("No room data in analysis.json");
            }

            // Push new data into the UI
            this.updateDashboard();

            console.log('Data loaded successfully:', this.currentData);

        } catch (error) {
            console.error('Error loading data:', error);
            this.showError('Failed to load measurement data');

            // Fallback to built-in sample data
            this.currentData = this.generateSampleData();
            this.updateDashboard();
        }
    }


    
    async runSweep() {
        if (this.isSweepRunning) {
            this.showInfo('Sweep already in progress');
            return;
        }

        this.isSweepRunning = true;
        
        try {
            console.log('Starting sweep...');
            
            // Show progress bar
            this.showProgressBar();
            
            // Update button state
            const runBtn = document.getElementById('runSweepBtn');
            runBtn.disabled = true;
            runBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Running Sweep...';
            
            // Make API call to run sweep
            const response = await fetch('/api/run-sweep', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({})
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            if (result.status === 'started') {
                // Start monitoring sweep progress
                this.monitorSweepProgress();
            } else {
                throw new Error('Failed to start sweep');
            }
            
        } catch (error) {
            console.error('Sweep error:', error);
            this.showError('Sweep failed: ' + error.message);
            this.resetSweepState();
        }
    }

    async monitorSweepProgress() {
        // Check progress every 2 seconds
        this.sweepCheckInterval = setInterval(async () => {
            try {
                const response = await fetch('/api/sweep-progress');
                const progress = await response.json();
                
                // Update progress bar
                this.updateProgress(progress.progress);
                
                if (progress.message) {
                    console.log('Sweep progress:', progress.message);
                }
                
                // Check if sweep completed
                if (!progress.running && progress.progress >= 100) {
                    // Sweep completed successfully
                    clearInterval(this.sweepCheckInterval);
                    
                    // Load the new data
                    await this.loadData();
                    
                    this.showSuccess('Sweep completed successfully!');
                    this.resetSweepState();
                    
                } else if (!progress.running && progress.progress < 100) {
                    // Sweep failed
                    clearInterval(this.sweepCheckInterval);
                    
                    this.showError('Sweep failed: ' + (progress.message || 'Unknown error'));
                    this.resetSweepState();
                }
                
            } catch (error) {
                console.error('Error checking sweep progress:', error);
                clearInterval(this.sweepCheckInterval);
                this.resetSweepState();
            }
        }, 2000);
    }

    resetSweepState() {
        this.isSweepRunning = false;
        
        // Reset button
        const runBtn = document.getElementById('runSweepBtn');
        runBtn.disabled = false;
        runBtn.innerHTML = '<i class="fas fa-play mr-2"></i>Run New Sweep';
        
        // Hide progress bar
        this.hideProgressBar();
        
        // Clear any intervals
        if (this.sweepCheckInterval) {
            clearInterval(this.sweepCheckInterval);
            this.sweepCheckInterval = null;
        }
    }

    updateDashboard() {
        const data = this.currentData;

        if (!data) {
            console.warn('No data available to update dashboard');
            return;
        }

        console.log('Updating dashboard with new data...');

        // Core UI updates
        this.updateScores();
        this.updateFrequencyChart();
        this.updateRoomAnalysis();
        this.updateDetailedAnalysis();

        // --- Step 2: Update the room layout visual if supported ---
        if (window.updateRoomCanvas && data.room) {
            window.updateRoomCanvas(data.room);
        }

        console.log('Dashboard updated successfully');
    }

    updateScores() {
        const data = this.currentData;
        if (!data) return;

        /* ---------- OVERALL SCORE CARD ---------- */
        const overall = data.overall_score ?? 5.0;

        // big number
        const overallEl = document.getElementById('overallScore');
        if (overallEl) overallEl.textContent = overall.toFixed(1);

        // coloured dot
        this.updateStatusIndicator('overallStatus', overall);

        // plain-English verdict
        const overallStatusText = document.getElementById('overallStatusText');
        if (overallStatusText) {
            overallStatusText.innerHTML = this.getScoreStatusText(overall);
        }

        /* ---------- BUDDY PHRASE + ICON + FOOTER ---------- */
        this.pickOverallPhrase(overall).then(phrase => {
            const phraseEl = document.getElementById('overallBuddyPhrase');
            if (phraseEl) phraseEl.textContent = phrase;

            // score → bucket
            const bucket =
                overall < 5 ? 'cold' :
                overall < 7 ? 'cool' :
                overall < 9 ? 'warm' :
                'hot';

            // icons
            const buddyIcons = {
                cold: "❄️",
                cool: "🌤️",
                warm: "🔥",
                hot:  "☕"
            };

            // set icon
            const iconEl = document.getElementById('buddyIcon');
            if (iconEl) iconEl.textContent = buddyIcons[bucket] || "🎧";

            // FOOTER TEXT (this is the missing bit)
            const footerEl = document.getElementById('buddyFooter');
            if (footerEl) {
                const footerReasons = {
                    cold: "Your room needs warmth, lots of easy wins here.",
                    cool: "Good foundation, a few tweaks will lift it nicely.",
                    warm: "Strong acoustics, only minor refinements left.",
                    hot:  "Studio-level response, you're basically done."
                };
                footerEl.textContent = footerReasons[bucket] || "";
            }
        });

        /* ---------- SIX SMALL SCORE CARDS (NUMBER + DOTS) ---------- */
        const scores = {
            bandwidthScore:   data.bandwidth   ?? 0,
            balanceScore:     data.balance     ?? 0,
            smoothnessScore:  data.smoothness  ?? 0,
            peaksDipsScore:   data.peaks_dips  ?? 0,
            reflectionsScore: data.reflections ?? 0,
            reverbScore:      data.reverb      ?? 0
        };

        Object.entries(scores).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val.toFixed(1);

            const statusId = id.replace('Score', 'Status');
            this.updateStatusIndicator(statusId, val);
        });

        /* ---------- DESCRIPTIONS + BUDDY TIPS + FOOTERS ---------- */
        this.updateDescriptions(data);

    }



    updateDescriptions(data) {
    /* ---------- 1. Bandwidth ---------- */
    const bandwidth = data.bandwidth || 3.6;
    document.getElementById('bandwidthSummary').textContent =
        bandwidth > 6 ? 'Wide frequency range' : 'Limited frequency range';
    document.getElementById('bandwidthStatusText').textContent =
        bandwidth > 6 ? 'Good coverage' : 'Needs extension';

    /* ---------- 2. Balance ---------- */
    const balance = data.balance || 1.6;
    document.getElementById('balanceSummary').textContent =
        balance < 3 ? 'Voices stronger than bass' :
        balance > 7 ? 'Bass stronger than voices' : 'Well balanced';
    document.getElementById('balanceStatusText').textContent =
        balance > 3 && balance < 7 ? 'Well balanced' : 'Needs adjustment';

    /* ---------- 3. Smoothness ---------- */
    const smoothness = data.smoothness || 7.3;
    document.getElementById('smoothnessSummary').textContent =
        `${(10 - smoothness).toFixed(1)} dB std deviation`;
    document.getElementById('smoothnessStatusText').textContent =
        smoothness > 6 ? 'Good consistency' : 'Some variation';

    /* ---------- 4. Peaks & Dips ---------- */
    const peaksDips = data.peaks_dips || 3.3;
    document.getElementById('peaksDipsSummary').textContent =
        peaksDips > 5 ? 'Pretty smooth' : 'Some notes jump out';
    document.getElementById('peaksDipsStatusText').textContent =
        peaksDips > 5 ? 'OK' : 'Treat';

    /* ---------- 5. Reflections ---------- */
    const reflections = data.reflections || 4.0;
    document.getElementById('reflectionsSummary').textContent =
        reflections > 6 ? 'Few reflections' : 'Some reflections detected';
    document.getElementById('reflectionsStatusText').textContent =
        reflections > 6 ? 'Good control' : 'Some treatment needed';

    /* ---------- 6. Reverb ---------- */
    const reverb = data.reverb || 10.0;
    document.getElementById('reverbSummary').textContent =
        `${(reverb / 100).toFixed(2)}s EDT`;
    document.getElementById('reverbStatusText').textContent =
        reverb > 7 ? 'Excellent control' : 'May be too live';

    /* ---------- buddy tips ---------- */
    this.injectBuddyPhrase('bandwidthBuddy',   bandwidth > 6 ? 'fix' : 'boom');
    this.injectBuddyPhrase('balanceBuddy',     balance > 3 && balance < 7 ? 'fix' : 'mid');
    this.injectBuddyPhrase('smoothnessBuddy',  smoothness > 6 ? 'fix' : 'top');
    this.injectBuddyPhrase('peaksDipsBuddy',   peaksDips > 5 ? 'fix' : 'boom');
    this.injectBuddyPhrase('reflectionsBuddy', reflections > 6 ? 'fix' : 'echo');
    this.injectBuddyPhrase('reverbBuddy',      reverb > 7 ? 'fix' : 'echo');

    /* ---------- foot tag-lines ---------- */
    const safeSet = (id, key) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (window.footBank && window.footBank[key]) {
            el.textContent = window.footBank[key];
        }
    };

    safeSet('peaksDipsFoot',   'peaksDips');
    safeSet('reflectionsFoot', 'reflections');
    safeSet('bandwidthFoot',   'bandwidth');
    safeSet('balanceFoot',     'balance');
    safeSet('smoothnessFoot',  'smoothness');
    safeSet('reverbFoot',      'reverb');
    }

    updateStatusIndicator(prefix, value) {
        const el = document.getElementById(prefix + 'Indicator') ||
                document.getElementById(prefix);

        if (!el) return;

        // Remove all existing status classes
        el.classList.remove('status-good', 'status-warning', 'status-poor');

        // Apply correct one
        if (value >= 7) {
            el.classList.add('status-good');
        } else if (value >= 4) {
            el.classList.add('status-warning');
        } else {
            el.classList.add('status-poor');
        }
    }


    // tiny helper to fetch & inject a random buddy phrase
    async injectBuddyPhrase(elId, bucket) {
        const el = document.getElementById(elId);
        if (!el) return;

        const bank = window.buddyBank || {};
        const choices = bank[bucket] || [];

        if (choices.length === 0) {
            el.textContent = '';
            return;
        }

        const tip = window.pickUniqueTip(bucket, choices);
        el.textContent = tip;

        // -------------------------
        // DEBUG: Log all 6 card tips
        // -------------------------
        if (!window.debugBuddy) window.debugBuddy = {};

        window.debugBuddy[elId] = {
            element: elId,
            bucket: bucket,
            tip: tip
        };

        console.log("Buddy Tips Used:", window.debugBuddy);
    }

    getScoreStatusText(score) {
        let verdict = '';
        if (score >= 8) verdict = 'Excellent acoustics';
        else if (score >= 6) verdict = 'Good room response';
        else if (score >= 4) verdict = 'Room for improvement';
        else verdict = 'Needs significant treatment';

        return `<strong>Verdict:</strong> ${verdict}`;
    }

    /* ----------  NEW : buddy-style dynamic status  ---------- */
    async pickOverallPhrase(score) {
        const bucket =
            score < 5 ? 'cold' :
            score < 7 ? 'cool' :
            score < 9 ? 'warm' :
            'hot';

        const bank = window.buddyBank || {};
        const choices = bank[bucket] || [];

        if (choices.length === 0) {
            return score < 5 ? 'Room needs love.' :
                score < 7 ? 'Not bad at all.' :
                score < 9 ? 'Room is cosy.' : 'Studio-grade!';
        }

        // Use the SAME global uniqueness engine used by all other cards
        return window.pickUniqueTip(bucket, choices);
    }

    updateFrequencyChart() {
        const data = this.currentData;
        if (!data) return;

        const leftTrace = {
            x: data.left_freq_hz || [],
            y: data.left_mag_db  || [],
            type: 'scatter',
            mode: 'lines',
            name: 'Left',
            line: { color: '#7c3aed', width: 2.5 }   // violet (sidebar)
        };
        const rightTrace = {
            x: data.right_freq_hz || [],
            y: data.right_mag_db  || [],
            type: 'scatter',
            mode: 'lines',
            name: 'Right',
            line: { color: '#3b82f6', width: 2.5 }   // indigo (buttons)
        };

        let traces = [];
        const active = document.querySelector('.channel-active')?.dataset.channel || 'both';
        if (active === 'left')   traces = [leftTrace];
        if (active === 'right')  traces = [rightTrace];
        if (active === 'both')   traces = [leftTrace, rightTrace];

        const layout = {
            xaxis: { title: 'Frequency (Hz)', type: 'log', color: '#111', gridcolor: '#e5e7eb' },
            yaxis: { title: 'Magnitude (dB)', color: '#111', gridcolor: '#e5e7eb' },
            margin: { t: 20, r: 20, b: 60, l: 60 },
            plot_bgcolor: '#fff', paper_bgcolor: '#fff',
            font: { color: '#111' },
            displayModeBar: false
        };

        Plotly.newPlot('frequencyChart', traces, layout, { responsive: true });
    }

    updateRoomAnalysis() {

        // Skip if the card doesn't exist
        if (!document.getElementById('roomDimensions')) return;

        const data = this.currentData || {};
        const room = {
            length: data.length,
            width: data.width,
            height: data.height
        };


        // Extract + normalise to numbers
        const length = Number(room.length) || 4.0;
        const width  = Number(room.width)  || 4.0;
        const height = Number(room.height) || 3.0;

        // Update text display
        document.getElementById('roomDimensions').textContent =
            `${length} × ${width} × ${height} m`;

        // Basic modal frequencies
        const c = 343; // speed of sound m/s

        document.getElementById('lengthMode').textContent =
            `${(c / (2 * length)).toFixed(1)} Hz`;

        document.getElementById('widthMode').textContent  =
            `${(c / (2 * width)).toFixed(1)} Hz`;

        document.getElementById('heightMode').textContent =
            `${(c / (2 * height)).toFixed(1)} Hz`;
    }

    updateDetailedAnalysis() {
        const data = this.currentData;
        
        if (!data.freq_hz || !data.mag_db) {
            return;
        }

        // Calculate frequency band averages
        const freqHz = data.freq_hz;
        const magDb = data.mag_db;
        
        let bassSum = 0, bassCount = 0;
        let midSum = 0, midCount = 0;
        let trebleSum = 0, trebleCount = 0;
        let airSum = 0, airCount = 0;
        
        for (let i = 0; i < freqHz.length; i++) {
            const freq = freqHz[i];
            const mag = magDb[i];
            
            if (freq >= 20 && freq <= 200) {
                bassSum += mag;
                bassCount++;
            } else if (freq > 200 && freq <= 2000) {
                midSum += mag;
                midCount++;
            } else if (freq > 2000 && freq <= 10000) {
                trebleSum += mag;
                trebleCount++;
            } else if (freq > 10000 && freq <= 20000) {
                airSum += mag;
                airCount++;
            }
        }
        
        const bassAvg = bassCount > 0 ? (bassSum / bassCount).toFixed(1) : 0;
        const midAvg = midCount > 0 ? (midSum / midCount).toFixed(1) : 0;
        const trebleAvg = trebleCount > 0 ? (trebleSum / trebleCount).toFixed(1) : 0;
        const airAvg = airCount > 0 ? (airSum / airCount).toFixed(1) : 0;
        
        // Update display
        document.getElementById('bassLevel').textContent = `${bassAvg} dB`;
        document.getElementById('midLevel').textContent = `${midAvg} dB`;
        document.getElementById('trebleLevel').textContent = `${trebleAvg} dB`;
        document.getElementById('airLevel').textContent = `${airAvg} dB`;
        
        // Update bars (normalized to -20 to +20 dB range)
        const normalize = (value) => {
            return Math.max(0, Math.min(100, ((parseFloat(value) + 20) / 40) * 100));
        };
        
        document.getElementById('bassBar').style.width = `${normalize(bassAvg)}%`;
        document.getElementById('midBar').style.width = `${normalize(midAvg)}%`;
        document.getElementById('trebleBar').style.width = `${normalize(trebleAvg)}%`;
        document.getElementById('airBar').style.width = `${normalize(airAvg)}%`;
    }

    showChannel(channel) {
        const data = this.currentData;
        if (!data) return;

        const leftTrace = {
            x: data.left_freq_hz || [],
            y: data.left_mag_db  || [],
            type: 'scatter',
            mode: 'lines',
            name: 'Left',
            line: { color: '#3b82f6', width: 2 }
        };
        const rightTrace = {
            x: data.right_freq_hz || [],
            y: data.right_mag_db  || [],
            type: 'scatter',
            mode: 'lines',
            name: 'Right',
            line: { color: '#ef4444', width: 2 }
        };

        let traces = [];
        if (channel === 'left')   traces = [leftTrace];
        if (channel === 'right')  traces = [rightTrace];
        if (channel === 'both')   traces = [leftTrace, rightTrace];

        const layout = {
            xaxis: { title: 'Frequency (Hz)', type: 'log', color: '#111', gridcolor: '#e5e7eb' },
            yaxis: { title: 'Magnitude (dB)', color: '#111', gridcolor: '#e5e7eb' },
            margin: { t: 20, r: 20, b: 60, l: 60 },
            plot_bgcolor: '#fff', paper_bgcolor: '#fff',
            font: { color: '#111' }, displayModeBar: false, staticPlot: true
        };

        Plotly.newPlot('frequencyChart', traces, layout, { responsive: true });
    }

    saveResults() {
        if (!this.currentData) {
            this.showError('No data to save');
            return;
        }
        
        // Create downloadable JSON file
        const dataStr = JSON.stringify(this.currentData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `measurely_results_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        URL.revokeObjectURL(url);
        this.showSuccess('Results saved successfully');
    }

    exportReport() {
        this.showInfo('Export report feature coming soon');
    }

    showProgressBar() {
        const container = document.getElementById('progressContainer');
        container.classList.add('active');
    }

    hideProgressBar() {
        const container = document.getElementById('progressContainer');
        container.classList.remove('active');
        document.getElementById('progressBar').style.width = '0%';
    }

    updateProgress(percentage) {
        const progressBar = document.getElementById('progressBar');
        progressBar.style.width = `${percentage}%`;
    }

    showLoadingState() {
        // Show loading indicators on all score elements
        const scoreElements = [
            'overallScore', 'bandwidthScore', 'balanceScore', 'smoothnessScore',
            'peaksDipsScore', 'reflectionsScore', 'reverbScore'
        ];
        
        scoreElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) element.textContent = '--';
        });
    }

    startPolling() {
        // Poll for device status every 5 seconds
        this.updateInterval = setInterval(async () => {
            try {
                await this.updateDeviceStatus();
            } catch (error) {
                console.error('Error updating device status:', error);
            }
        }, 5000);
    }

    async updateDeviceStatus() {
        try {
            const response = await fetch('/api/status');
            if (response.ok) {
                this.deviceStatus = await response.json();
                this.updateDeviceStatusDisplay();
            }
        } catch (error) {
            console.error('Failed to fetch device status:', error);
        }
    }

    updateDeviceStatusDisplay() {
        const status = this.deviceStatus;
        const indicator = document.getElementById('deviceStatusIndicator');
        const statusText = document.getElementById('deviceStatusText');
        
        if (status.ready) {
            indicator.className = 'status-indicator status-good pulse-animation';
            statusText.textContent = 'System Ready';
        } else {
            indicator.className = 'status-indicator status-warning pulse-animation';
            statusText.textContent = 'Device Check Required';
        }
    }

    generateSampleData() {
        // Generate sample frequency response data for testing
        const frequencies = [];
        const magnitudes = [];
        const phases = [];
        
        let freq = 20.0;
        while (freq <= 20000) {
            frequencies.push(freq);
            
            // Generate realistic frequency response
            let magnitude = -8.0;
            
            // Room mode peaks
            if (40 <= freq && freq <= 60) {
                magnitude += 6.0 * Math.exp(-Math.pow(freq - 50, 2) / 50);
            } else if (80 <= freq && freq <= 120) {
                magnitude += 4.0 * Math.exp(-Math.pow(freq - 100, 2) / 200);
            }
            
            // High frequency roll-off
            if (freq > 8000) {
                magnitude -= (freq - 8000) / 2000;
            }
            
            // Add some variation
            magnitude += Math.sin(freq / 100) * 2.0 + (Math.random() - 0.5) * 1.0;
            
            magnitudes.push(magnitude);
            phases.push(Math.sin(freq / 500) * 180);
            
            freq *= 1.1;
        }
        
        return {
            timestamp: new Date().toISOString(),
            room: "Sample Room",
            length: 4.0,
            width: 4.0,
            height: 3.0,
            freq_hz: frequencies,
            mag_db: magnitudes,
            phase_deg: phases,
            overall_score: 6.8,
            bandwidth: 5.2,
            balance: 4.1,
            smoothness: 7.3,
            peaks_dips: 3.9,
            reflections: 5.0,
            reverb: 8.5
        };
    }

    showMessage(message, type = 'info') {
        // Create toast notification
        const toast = document.createElement('div');
        toast.className = `fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 transition-all duration-300 ${
            type === 'error' ? 'bg-red-600 text-white' :
            type === 'success' ? 'bg-green-600 text-white' :
            'bg-blue-600 text-white'
        }`;
        toast.textContent = message;
        
        document.body.appendChild(toast);
        
        // Animate in
        setTimeout(() => toast.classList.add('translate-x-0'), 10);
        
        // Remove after 3 seconds
        setTimeout(() => {
            toast.classList.add('translate-x-full');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
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
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new MeasurelyDashboard();
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && window.dashboard) {
        // Page became visible, refresh data
        window.dashboard.loadData();
    }
});