/**
 * Measurely Dashboard - Real-time frequency response data integration
 * Handles API calls, data visualization, and user interactions
 * Updated to work with actual measurely sweep system
 */

class MeasurelyDashboard {
    constructor() {
        this.currentData = null;
        this.isSweepRunning = false;
        this.deviceStatus = {};
        this.updateInterval = null;
        this.sweepCheckInterval = null;
        
        this.init();
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
            
            // Show loading state
            this.showLoadingState();
            
            // Fetch latest data
            const response = await fetch('/api/latest');
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            this.currentData = await response.json();
            
            // Update UI with new data
            this.updateDashboard();
            
            console.log('Data loaded successfully:', this.currentData);
            
        } catch (error) {
            console.error('Error loading data:', error);
            this.showError('Failed to load measurement data');
            
            // Load fallback sample data
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
        if (!this.currentData) {
            console.warn('No data to update dashboard');
            return;
        }

        console.log('Updating dashboard with new data...');
        
        // Update scores
        this.updateScores();
        
        // Update frequency chart
        this.updateFrequencyChart();
        
        // Update room analysis
        this.updateRoomAnalysis();
        
        // Update detailed analysis
        this.updateDetailedAnalysis();
        
        console.log('Dashboard updated successfully');
    }

    updateScores() {
        const data = this.currentData;
        
        // Overall score
        const overallScore = data.overall_score || 5.0;
        document.getElementById('overallScore').textContent = overallScore.toFixed(1);
        this.updateStatusIndicator('overallStatus', overallScore);
        
        // Update status text
        const statusText = this.getScoreStatusText(overallScore);
        document.getElementById('overallStatusText').textContent = statusText;
        
        // Individual scores
        const scores = {
            bandwidthScore: data.bandwidth || 3.6,
            balanceScore: data.balance || 1.6,
            smoothnessScore: data.smoothness || 7.3,
            peaksDipsScore: data.peaks_dips || 3.3,
            reflectionsScore: data.reflections || 4.0,
            reverbScore: data.reverb || 10.0
        };

        Object.entries(scores).forEach(([id, value]) => {
            document.getElementById(id).textContent = value.toFixed(1);
            
            // Update individual status indicators
            const statusId = id.replace('Score', 'Status');
            this.updateStatusIndicator(statusId, value);
        });

        // Update descriptions
        this.updateDescriptions(data);
    }

    updateDescriptions(data) {
        // Bandwidth description
        const bandwidth = data.bandwidth || 3.6;
        const bandwidthRange = bandwidth > 6 ? "Wide frequency range" : "Limited frequency range";
        document.getElementById('bandwidthRange').textContent = bandwidthRange;
        
        const bandwidthStatusText = bandwidth > 6 ? "Good coverage" : "Needs extension";
        document.getElementById('bandwidthStatusText').textContent = bandwidthStatusText;
        
        // Balance description
        const balance = data.balance || 1.6;
        let balanceDesc = "Well balanced";
        if (balance < 3) {
            balanceDesc = "Voices stronger than bass";
        } else if (balance > 7) {
            balanceDesc = "Bass stronger than voices";
        }
        document.getElementById('balanceDescription').textContent = balanceDesc;
        
        const balanceStatusText = balance > 3 && balance < 7 ? "Well balanced" : "Needs adjustment";
        document.getElementById('balanceStatusText').textContent = balanceStatusText;
        
        // Smoothness description
        const smoothness = data.smoothness || 7.3;
        const smoothnessDesc = `${(10 - smoothness).toFixed(1)} dB std deviation`;
        document.getElementById('smoothnessDescription').textContent = smoothnessDesc;
        
        const smoothnessStatusText = smoothness > 6 ? "Good consistency" : "Some variation";
        document.getElementById('smoothnessStatusText').textContent = smoothnessStatusText;
        
        // Peaks & dips description
        const peaksDips = data.peaks_dips || 3.3;
        const peaksDipsDesc = peaksDips > 5 ? "Few room modes" : "Room modes present";
        document.getElementById('peaksDipsDescription').textContent = peaksDipsDesc;
        
        const peaksDipsStatusText = peaksDips > 5 ? "Well controlled" : "Needs treatment";
        document.getElementById('peaksDipsStatusText').textContent = peaksDipsStatusText;
        
        // Reflections description
        const reflections = data.reflections || 4.0;
        const reflectionsDesc = reflections > 6 ? "Few reflections" : "Some reflections detected";
        document.getElementById('reflectionsDescription').textContent = reflectionsDesc;
        
        const reflectionsStatusText = reflections > 6 ? "Good control" : "Some treatment needed";
        document.getElementById('reflectionsStatusText').textContent = reflectionsStatusText;
        
        // Reverb description
        const reverb = data.reverb || 10.0;
        const reverbDesc = `${(reverb / 100).toFixed(2)}s EDT`;
        document.getElementById('reverbDescription').textContent = reverbDesc;
        
        const reverbStatusText = reverb > 7 ? "Excellent control" : "May be too live";
        document.getElementById('reverbStatusText').textContent = reverbStatusText;
    }

    updateStatusIndicator(elementId, score) {
        const element = document.getElementById(elementId);
        if (!element) return;

        // Remove existing status classes
        element.className = element.className.replace(/status-\w+/g, '');
        
        // Add appropriate status class based on score
        if (score >= 7) {
            element.classList.add('status-good');
        } else if (score >= 4) {
            element.classList.add('status-warning');
        } else {
            element.classList.add('status-poor');
        }
    }

    getScoreStatusText(score) {
        if (score >= 8) return "Excellent acoustics";
        if (score >= 6) return "Good room response";
        if (score >= 4) return "Room for improvement";
        return "Needs significant treatment";
    }

    updateFrequencyChart() {
        const data = this.currentData;
        
        if (!data.freq_hz || !data.mag_db) {
            console.warn('No frequency data available');
            return;
        }

        console.log('Updating frequency chart with', data.freq_hz.length, 'data points');
        
        const trace = {
            x: data.freq_hz,
            y: data.mag_db,
            type: 'scatter',
            mode: 'lines',
            line: {
                color: '#3b82f6',
                width: 2
            },
            name: 'Frequency Response'
        };

        const layout = {
            xaxis: {
                title: 'Frequency (Hz)',
                type: 'log',
                color: '#111',
                gridcolor: '#e5e7eb',
                tickfont: { color: '#111' }
            },
            yaxis: {
                title: 'Magnitude (dB)',
                color: '#111',
                gridcolor: '#e5e7eb',
                tickfont: { color: '#111' }
            },
            margin: { t: 20, r: 20, b: 60, l: 60 },
            plot_bgcolor: '#fff',
            paper_bgcolor: '#fff',
            font: { color: '#111' },
            displayModeBar: false,
            staticPlot: true
        };

        const config = {
            responsive: true,
            displayModeBar: false
        };

        Plotly.newPlot('frequencyChart', [trace], layout, config);
    }

    updateRoomAnalysis() {
        const data = this.currentData;
        
        // Room dimensions
        const length = data.length || 4.0;
        const width = data.width || 4.0;
        const height = data.height || 3.0;
        
        document.getElementById('roomDimensions').textContent = `${length} × ${width} × ${height} m`;
        
        // Calculate axial modes (speed of sound / (2 * dimension))
        const speedOfSound = 343; // m/s
        
        const lengthMode = (speedOfSound / (2 * length)).toFixed(1);
        const widthMode = (speedOfSound / (2 * width)).toFixed(1);
        const heightMode = (speedOfSound / (2 * height)).toFixed(1);
        
        document.getElementById('lengthMode').textContent = `${lengthMode} Hz`;
        document.getElementById('widthMode').textContent = `${widthMode} Hz`;
        document.getElementById('heightMode').textContent = `${heightMode} Hz`;
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
        console.log(`Showing channel: ${channel}`);
        // For now, just show a message
        this.showInfo(`${channel.charAt(0).toUpperCase() + channel.slice(1)} channel selected`);
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