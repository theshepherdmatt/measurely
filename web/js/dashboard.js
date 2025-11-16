/* ============================================================
   GLOBAL TIP MEMORY + UNIQUE PICKING
   ============================================================ */
window.usedBuddyTips = {
    peaks_dips:   new Set(),
    reflections:  new Set(),
    bandwidth:    new Set(),
    balance:      new Set(),
    smoothness:   new Set(),
    reverb:       new Set(),

    // score buckets
    excellent:    new Set(),
    good:         new Set(),
    okay:         new Set(),
    needs_work:   new Set(),

    // overall buckets
    overall_excellent: new Set(),
    overall_good:      new Set(),
    overall_fair:      new Set(),
    overall_poor:      new Set()
};



window.pickUniqueTip = function(bucket, allTips) {
    if (!allTips || allTips.length === 0) return '';

    const used = window.usedBuddyTips[bucket];

    // Reset if we've used all
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

// Fetch the list of sessions from the backend
async function fetchSessions() {
    const r = await fetch('/api/sessions');
    if (!r.ok) throw new Error(r.status);
    return r.json();
}


/* ============================================================
   DASHBOARD CLASS
   ============================================================ */
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

    /* NEW unified scoring bucket */
    toBucket(score) {
        if (score >= 8) return 'excellent';
        if (score >= 6) return 'good';
        if (score >= 4) return 'okay';
        return 'needs_work';
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

    /* ============================================================
       INIT
       ============================================================ */
    async init() {
        console.log('Initializing Measurely Dashboard...');

        this.setupEventListeners();

        // LOAD AVAILABLE SESSIONS FOR COMPARE UI
        try {
            const sessionObjs = await fetchSessions();
            this.sessionList = sessionObjs
                .map(s => s.id)
                .filter(id => id !== "latest")      // remove symlink
                .sort()                             // sort newest→oldest (timestamps in ID)
                .reverse();                         // newest first

            // Take only the top 3
            this.sessionList = this.sessionList.slice(0, 3);

            console.log("Compare sessions:", this.sessionList);
        } catch (err) {
            console.error("Failed loading sessions for compare UI", err);
            this.sessionList = [];
        }

        await this.loadData();
        this.startPolling();

        console.log('Dashboard initialized successfully');
    }

    /* ============================================================
       EVENT LISTENERS
       ============================================================ */
    setupEventListeners() {
        // Run sweep
        document.getElementById('runSweepBtn')
            .addEventListener('click', () => this.runSweep());

        // Channel buttons
        document.getElementById('leftChannelBtn')
            .addEventListener('click', () => this.showChannel('left'));

        document.getElementById('rightChannelBtn')
            .addEventListener('click', () => this.showChannel('right'));

        document.getElementById('bothChannelsBtn')
            .addEventListener('click', () => this.showChannel('both'));

        // Save / Export
        document.getElementById('saveResultsBtn')
            .addEventListener('click', () => this.saveResults());

        document.getElementById('exportReportBtn')
            .addEventListener('click', () => this.exportReport());


        const latestBtn   = document.getElementById('sessionLatestBtn');
        const previousBtn = document.getElementById('sessionPreviousBtn');
        const lastBtn     = document.getElementById('sessionLastBtn');

        if (latestBtn)
            latestBtn.addEventListener('click', () => this.loadSessionByIndex(0));

        if (previousBtn)
            previousBtn.addEventListener('click', () => this.loadSessionByIndex(1));

        if (lastBtn)
            lastBtn.addEventListener('click', () => this.loadSessionByIndex(2));

    }


    /* ============================================================
       LOAD DATA
       ============================================================ */
    async loadData() {
        try {
            console.log('Loading latest measurement data...');
            this.showLoadingState();

            const response = await fetch('/api/latest');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            this.currentData = await response.json();

            // Debug room
            if (this.currentData.room) {
                console.log("ROOM:", this.currentData.room);
            }

            this.updateDashboard();
            this.updateCompareSessionMetrics();
            console.log('Data loaded OK:', this.currentData);

        } catch (error) {
            console.error('Error loading data:', error);
            this.showError('Failed to load measurement data.');

            // Fallback sample
            this.currentData = this.generateSampleData();
            this.updateDashboard();
        }
    }

    /* ============================================================
       RUN SWEEP
       ============================================================ */
    async runSweep() {
        if (this.isSweepRunning) {
            this.showInfo('Sweep already running');
            return;
        }

        this.isSweepRunning = true;
        console.log('Starting sweep...');

        this.showProgressBar();

        const runBtn = document.getElementById('runSweepBtn');
        runBtn.disabled = true;
        runBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Running Sweep...';

        try {
            const response = await fetch('/api/run-sweep', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();

            if (result.status === 'started') {
                this.monitorSweepProgress();
            } else {
                throw new Error('Failed to start sweep');
            }

        } catch (err) {
            console.error(err);
            this.showError('Sweep failed: ' + err.message);
            this.resetSweepState();
        }
    }

    /* ============================================================
       SWEEP PROGRESS MONITOR
       ============================================================ */
    async monitorSweepProgress() {
        this.sweepCheckInterval = setInterval(async () => {
            try {
                const response = await fetch('/api/sweep-progress');
                const progress = await response.json();

                this.updateProgress(progress.progress);

                if (!progress.running && progress.progress >= 100) {
                    clearInterval(this.sweepCheckInterval);
                    await this.loadData();
                    this.showSuccess('Sweep complete!');
                    this.resetSweepState();

                } else if (!progress.running) {
                    clearInterval(this.sweepCheckInterval);
                    this.showError('Sweep failed');
                    this.resetSweepState();
                }

            } catch (err) {
                console.error(err);
                clearInterval(this.sweepCheckInterval);
                this.resetSweepState();
            }
        }, 2000);
    }

    /* ============================================================
       RESET SWEEP UI
       ============================================================ */
    resetSweepState() {
        this.isSweepRunning = false;

        const runBtn = document.getElementById('runSweepBtn');
        runBtn.disabled = false;
        runBtn.innerHTML = '<i class="fas fa-play mr-2"></i>Run New Sweep';

        this.hideProgressBar();

        if (this.sweepCheckInterval) {
            clearInterval(this.sweepCheckInterval);
            this.sweepCheckInterval = null;
        }
    }

    /* ============================================================
       UPDATE DASHBOARD (MAIN REFRESH)
       ============================================================ */
    updateDashboard() {
        if (!this.currentData) {
            console.warn('No data to update');
            return;
        }

        console.log('Updating dashboard…');

        this.updateScores();
        this.updateFrequencyChart();
        this.updateRoomAnalysis();
        this.updateDetailedAnalysis();

        if (window.updateRoomCanvas && this.currentData.room) {
            window.updateRoomCanvas(this.currentData.room);
        }

        console.log('Dashboard update complete.');
    }

    /* ============================================================
       UPDATE SCORES (OVERALL + 6 CARDS)
       ============================================================ */
    updateScores() {
        const data = this.currentData;
        if (!data) return;

        /* ---------------- OVERALL SCORE ---------------- */
        const overall = data.overall_score ?? 5.0;

        // Main number
        const overallEl = document.getElementById('overallScore');
        if (overallEl) overallEl.textContent = overall.toFixed(1);

        // Dot colour
        this.updateStatusIndicator('overallStatus', overall);

        // Verdict
        const statusTextEl = document.getElementById('overallStatusText');
        if (statusTextEl) {
            statusTextEl.innerHTML = this.getScoreStatusText(overall);
        }

        /* ---------------- OVERALL BUDDY PHRASE ---------------- */
        this.pickOverallPhrase(overall).then(dynamicPhrase => {
            const backend = this.currentData.buddy_summary;
            let finalPhrase;

            if (backend && backend.length > 0) {
                const first = backend.split('. ')[0] + '.';
                finalPhrase = `${first} ${dynamicPhrase}`;
            } else {
                finalPhrase = dynamicPhrase;
            }

            const phraseEl = document.getElementById('overallBuddyPhrase');
            if (phraseEl) phraseEl.textContent = finalPhrase;

            const footerEl = document.getElementById('buddyFooter');
            if (footerEl) footerEl.textContent = "";
        });

        /* ---------------- SIX SMALL CARD SCORES ---------------- */
        const scores = {
            bandwidthScore:   data.bandwidth   ?? 0,
            balanceScore:     data.balance     ?? 0,
            smoothnessScore:  data.smoothness  ?? 0,
            peaksDipsScore:   data.peaks_dips  ?? 0,
            reflectionsScore: data.reflections ?? 0,
            reverbScore:      data.reverb      ?? 0
        };

        for (const [id, val] of Object.entries(scores)) {
            // Score number
            const el = document.getElementById(id);
            if (el) el.textContent = val.toFixed(1);

            // Dot
            const statusId = id.replace('Score', 'Status');
            this.updateStatusIndicator(statusId, val);

            // Colour group
            const baseId = id.replace('Score', '');
            this.applySixCardColor(baseId, val);
        }

        /* ---------------- SUMMARIES + BUDDY TIPS ---------------- */
        this.updateDescriptions(data);
    }

    /* ============================================================
       CARD SUMMARIES + BUDDY TIPS
       ============================================================ */
    updateDescriptions(data) {

        /* ---------- Extract ---------- */
        const bandwidth   = data.bandwidth   ?? 3;
        const balance     = data.balance     ?? 3;
        const smoothness  = data.smoothness  ?? 3;
        const peaksDips   = data.peaks_dips  ?? 3;
        const reflections = data.reflections ?? 3;
        const reverb      = data.reverb      ?? 3;

        /* ---------- 1. Bandwidth ---------- */
        document.getElementById('bandwidthSummary').textContent =
            bandwidth > 6 ? 'Wide frequency range' : 'Limited frequency range';

        document.getElementById('bandwidthStatusText').textContent =
            bandwidth > 6 ? 'Good coverage' : 'Needs extension';

        /* ---------- 2. Balance ---------- */
        document.getElementById('balanceSummary').textContent =
            balance < 3 ? 'Voices stronger than bass' :
            balance > 7 ? 'Bass stronger than voices' :
                           'Well balanced';

        document.getElementById('balanceStatusText').textContent =
            balance > 3 && balance < 7 ? 'Well balanced' : 'Needs adjustment';

        /* ---------- 3. Smoothness ---------- */
        document.getElementById('smoothnessSummary').textContent =
            `${(10 - smoothness).toFixed(1)} dB std deviation`;

        document.getElementById('smoothnessStatusText').textContent =
            smoothness > 6 ? 'Good consistency' : 'Some variation';

        /* ---------- 4. Peaks & Dips ---------- */
        document.getElementById('peaksDipsSummary').textContent =
            peaksDips > 5 ? 'Pretty smooth' : 'Some notes jump out';

        document.getElementById('peaksDipsStatusText').textContent =
            peaksDips > 5 ? 'OK' : 'Treat';

        /* ---------- 5. Reflections ---------- */
        document.getElementById('reflectionsSummary').textContent =
            reflections > 6 ? 'Few reflections' : 'Some reflections detected';

        document.getElementById('reflectionsStatusText').textContent =
            reflections > 6 ? 'Good control' : 'Some treatment needed';

        /* ---------- 6. Reverb ---------- */
        document.getElementById('reverbSummary').textContent =
            `${(reverb / 100).toFixed(2)}s EDT`;

        document.getElementById('reverbStatusText').textContent =
            reverb > 7 ? 'Excellent control' : 'May be too live';


        /* ---------- BUDDY TIPS (using new buckets) ---------- */
        this.injectBuddyPhrase('bandwidthBuddy',   'bandwidth',   this.toBucket(bandwidth));
        this.injectBuddyPhrase('balanceBuddy',     'balance',     this.toBucket(balance));
        this.injectBuddyPhrase('smoothnessBuddy',  'smoothness',  this.toBucket(smoothness));
        this.injectBuddyPhrase('peaksDipsBuddy',   'peaks_dips',  this.toBucket(peaksDips));
        this.injectBuddyPhrase('reflectionsBuddy', 'reflections', this.toBucket(reflections));
        this.injectBuddyPhrase('reverbBuddy',      'reverb',      this.toBucket(reverb));


        /* ---------- Foot tags ---------- */
        const safeSet = (id, key) => {
            const el = document.getElementById(id);
            if (el && window.footBank?.[key]) {
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
    
    async loadSession(which) {

        // Convert "latest" to your newest real session ID
        if (which === "latest") {
            if (this.sessionList && this.sessionList.length > 0) {
                which = this.sessionList[0];
            } else {
                console.warn("No sessions found");
                return;
            }
        }

        // NEVER request /api/session/latest (it doesn't exist)
        const endpoint = `/api/session/${encodeURIComponent(which)}`;

        try {
            const response = await fetch(endpoint);
            if (!response.ok) {
                throw new Error(`Session load failed: ${response.status}`);
            }

            this.currentData = await response.json();
            this.updateDashboard();
            this.updateCompareSessionMetrics();

        } catch (err) {
            console.error("Error loading session", err);
            this.showError("Couldn't load that session");
        }
    }


    async loadSessionByIndex(index) {
        if (!this.sessionList || !this.sessionList[index]) {
            console.warn("No session at index", index);
            return;
        }

        const id = this.sessionList[index];
        console.log("Loading compare session:", id);

        try {
            const r = await fetch(`/api/session/${encodeURIComponent(id)}`);
            if (!r.ok) throw new Error(r.status);

            const d = await r.json();

            this.currentData = d;        // replace dashboard data
            this.updateDashboard();      // redraw EVERYTHING
            this.updateCompareSessionMetrics();  // redraw peak/dip/mismatch/mid
        } catch (err) {
            console.error("Failed to load session:", id, err);
        }
    }


    /* ============================================================
       BUDDY TIP PICKER — OVERALL
       ============================================================ */
    async pickOverallPhrase(score) {

        let bucket =
            score >= 8 ? 'overall_excellent' :
            score >= 6 ? 'overall_good' :
            score >= 4 ? 'overall_fair' :
                         'overall_poor';

        const bank = window.buddyBank || {};
        const choices = bank[bucket] || [];

        if (choices.length === 0) {
            if (bucket === 'overall_excellent') return 'Superb acoustics — nothing fighting the music.';
            if (bucket === 'overall_good')      return 'Strong performance — just a few tiny tweaks.';
            if (bucket === 'overall_fair')      return 'Decent start — room interactions still audible.';
            return 'Room needs some love, loads of easy wins ahead.';
        }

        return window.pickUniqueTip(bucket, choices);
    }

    /* ============================================================
       STATUS DOT / TEXT COLOUR
       ============================================================ */
    updateStatusIndicator(prefix, value) {
        const el =
            document.getElementById(prefix + 'Indicator') ||
            document.getElementById(prefix);

        if (!el) return;

        const bucket =
            value >= 8 ? 'status-good' :
            value >= 4 ? 'status-warning' :
                         'status-poor';

        el.classList.remove('status-good', 'status-warning', 'status-poor');
        el.classList.add(bucket);
    }

    /* ============================================================
       BUDDY TIP INJECTION (PER CARD)
       ============================================================ */
    async injectBuddyPhrase(elId, cardName, bucket) {
        const el = document.getElementById(elId);
        if (!el) return;

        const bank = window.buddyBank || {};

        // Example lookup:
        // bank["peaks_dips"]["okay"]
        const cardBucket = bank[cardName];
        if (!cardBucket) {
            console.warn("No card bucket for", cardName);
            el.textContent = "";
            return;
        }

        const choices = cardBucket[bucket] || [];
        if (choices.length === 0) {
            console.warn("No tips for", cardName, bucket);
            el.textContent = "";
            return;
        }

        const tip = window.pickUniqueTip(bucket, choices);
        el.textContent = tip;
    }


    /* ============================================================
       VERDICT TEXT (OVERALL)
       ============================================================ */
    getScoreStatusText(score) {
        let verdict;

        if (score >= 8)      verdict = 'Excellent acoustics';
        else if (score >= 6) verdict = 'Good room response';
        else if (score >= 4) verdict = 'Room for improvement';
        else                 verdict = 'Needs significant treatment';

        return `<strong>Verdict:</strong> ${verdict}`;
    }

    /* ============================================================
       STATUS COLOUR MAPPINGS FOR CARDS
       ============================================================ */
    statusClasses = {
        green:  {
            text: "text-green-500",
            dot:  "bg-green-500",
            icon: "text-green-500"
        },
        yellow: {
            text: "text-yellow-500",
            dot:  "bg-yellow-500",
            icon: "text-yellow-500"
        },
        orange: {
            text: "text-blue-400",
            dot:  "bg-blue-400",
            icon: "text-blue-400"
        },
        red: {
            text: "text-red-500",
            dot:  "bg-red-500",
            icon: "text-red-500"
        }
    };

    /* ============================================================
       APPLY CARD COLOURS — SCORE, TEXT, DOT, ICON
       ============================================================ */
    applySixCardColor(cardId, value) {
        let bucket;
        if (value >= 8)      bucket = "green";
        else if (value >= 6) bucket = "yellow";
        else if (value >= 4) bucket = "orange";
        else                 bucket = "red";

        const palette = this.statusClasses[bucket];
        if (!palette) return;

        // Score number
        const scoreEl = document.querySelector(`[data-color-target="${cardId}"]`);
        if (scoreEl) {
            scoreEl.classList.remove(
                "text-green-600", "text-yellow-600",
                "text-orange-600", "text-red-600"
            );
            scoreEl.classList.add(palette.text);
        }

        // Summary + small texts
        document.querySelectorAll(`[data-color-summary="${cardId}"]`).forEach(el => {
            el.classList.remove(
                "text-green-600", "text-yellow-600",
                "text-orange-600", "text-red-600"
            );
            el.classList.add(palette.text);
        });

        // Dot
        const dotEl = document.getElementById(`${cardId}Status`);
        if (dotEl) {
            dotEl.classList.remove(
                "bg-green-500","bg-yellow-500",
                "bg-orange-500","bg-red-500"
            );
            dotEl.classList.add(palette.dot);
        }

        // Icon
        const iconEl = document.querySelector(`[data-color-icon="${cardId}"]`);
        if (iconEl) {
            iconEl.classList.remove(
                "text-green-600", "text-yellow-600",
                "text-orange-600", "text-red-600"
            );
            iconEl.classList.add(palette.icon);
        }
    }

    /* ============================================================
       FREQUENCY RESPONSE CHART
       ============================================================ */
    updateFrequencyChart() {
        const data = this.currentData;
        if (!data) return;

        const mobile = window.innerWidth < 640;

        const traces = [
            {
                x: data.left_freq_hz  || [],
                y: data.left_mag_db   || [],
                type: 'scatter',
                mode: 'lines',
                name: 'Left',
                line: { color: '#6D28D9', width: mobile ? 3 : 2.5 }
            },
            {
                x: data.right_freq_hz || [],
                y: data.right_mag_db  || [],
                type: 'scatter',
                mode: 'lines',
                name: 'Right',
                line: { color: '#3B82F6', width: mobile ? 3 : 2.5 }
            }
        ];

        const active = document.querySelector('.channel-active')?.dataset.channel || 'both';
        const toPlot = active === 'left'  ? [traces[0]]
                    : active === 'right' ? [traces[1]]
                    : traces;

        const layout = {
            xaxis: {
                type: 'log',
                showline: true,
                linewidth: 1,
                linecolor: '#d1d5db',
                tickfont: { size: mobile ? 10 : 11 },
                title: mobile ? '' : 'Frequency (Hz)'   // <- remove title on mobile
            },
            yaxis: {
                showline: true,
                linewidth: 1,
                linecolor: '#d1d5db',
                tickfont: { size: mobile ? 10 : 11 },
                title: mobile ? '' : 'Magnitude (dB)'   // <- remove title on mobile
            },
            showlegend: false,
            margin: mobile
                ? { t: 5, r: 5, b: 25, l: 30 }   // tiny margins on phone
                : { t: 20, r: 20, b: 50, l: 55 },
            plot_bgcolor: '#fff',
            paper_bgcolor: '#fff',
            font: { color: '#111', size: mobile ? 9 : 11 },
            displayModeBar: false,
            staticPlot: true
        };

        Plotly.newPlot('frequencyChart', toPlot, layout, {
            responsive: true,
            displayModeBar: false,
            showLegend: false   // <- extra insurance
        });
    }

    updateCompareSessionMetrics() {
        const d = this.currentData;
        if (!d) return;

        const L = d.left_mag_db || [];
        const R = d.right_mag_db || [];
        const F = d.left_freq_hz || [];

        if (!L.length || !R.length || !F.length) return;

        // Peak and dip
        const peak = Math.max(...L, ...R);
        const dip  = Math.min(...L, ...R);

        // L/R mismatch average
        let mismatch = 0;
        const n = Math.min(L.length, R.length);
        for (let i = 0; i < n; i++) {
            mismatch += Math.abs(L[i] - R[i]);
        }
        mismatch = mismatch / n;

        // Roll-off (3dB down from start)
        let roll = "--";
        const ref = (L[0] + R[0]) / 2;
        for (let i = F.length - 1; i >= 0; i--) {
            const avg = (L[i] + R[i]) / 2;
            if (avg <= ref - 3) {
                roll = `${F[i].toFixed(0)} Hz`;
                break;
            }
        }

        // DOM update helper
        const set = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };

        set("metricPeak", `${peak.toFixed(1)} dB`);
        set("metricDip", `${dip.toFixed(1)} dB`);
        set("metricLR", `${mismatch.toFixed(1)} dB`);
        // Midrange average from 200–2000 Hz (like your other mid calculations)
        let midSum = 0, midCount = 0;
        for (let i = 0; i < F.length; i++) {
            const f = F[i];
            const avg = (L[i] + R[i]) / 2;

            if (f > 200 && f <= 2000) {
                midSum += avg;
                midCount++;
            }
        }

        const midAvg = midCount ? (midSum / midCount) : 0;

        // Update the new metric box
        set("metricMid", `${midAvg.toFixed(1)} dB`);

    }


    /* ============================================================
       ROOM MODE ANALYSIS (L × W × H)
       ============================================================ */
    updateRoomAnalysis() {
        if (!document.getElementById('roomDimensions')) return;

        const data = this.currentData || {};
        const length = Number(data.length) || 4.0;
        const width  = Number(data.width)  || 4.0;
        const height = Number(data.height) || 3.0;

        document.getElementById('roomDimensions').textContent =
            `${length} × ${width} × ${height} m`;

        const c = 343; // speed of sound in m/s

        document.getElementById('lengthMode').textContent =
            `${(c / (2 * length)).toFixed(1)} Hz`;
        document.getElementById('widthMode').textContent =
            `${(c / (2 * width)).toFixed(1)} Hz`;
        document.getElementById('heightMode').textContent =
            `${(c / (2 * height)).toFixed(1)} Hz`;
    }

    /* ============================================================
       DETAILED BAND ANALYSIS (Bass / Mid / Treble / Air)
       ============================================================ */
    updateDetailedAnalysis() {
        const data = this.currentData;
        if (!data.freq_hz || !data.mag_db) return;

        const freqHz = data.freq_hz;
        const magDb  = data.mag_db;

        let bassSum = 0, bassCount = 0;
        let midSum = 0, midCount = 0;
        let trebleSum = 0, trebleCount = 0;
        let airSum = 0, airCount = 0;

        for (let i = 0; i < freqHz.length; i++) {
            const f = freqHz[i];
            const m = magDb[i];

            if (f >= 20 && f <= 200) {
                bassSum += m; bassCount++;
            } else if (f > 200 && f <= 2000) {
                midSum += m; midCount++;
            } else if (f > 2000 && f <= 10000) {
                trebleSum += m; trebleCount++;
            } else if (f > 10000 && f <= 20000) {
                airSum += m; airCount++;
            }
        }

        const bassAvg   = bassCount   ? (bassSum / bassCount).toFixed(1)   : "0.0";
        const midAvg    = midCount    ? (midSum / midCount).toFixed(1)    : "0.0";
        const trebleAvg = trebleCount ? (trebleSum / trebleCount).toFixed(1) : "0.0";
        const airAvg    = airCount    ? (airSum / airCount).toFixed(1)    : "0.0";

        // Set values
        document.getElementById('bassLevel').textContent   = `${bassAvg} dB`;
        document.getElementById('midLevel').textContent    = `${midAvg} dB`;
        document.getElementById('trebleLevel').textContent = `${trebleAvg} dB`;
        document.getElementById('airLevel').textContent    = `${airAvg} dB`;

        // Normalise bar lengths for UI
        const normalize = (val) =>
            Math.max(0, Math.min(100, ((parseFloat(val) + 20) / 40) * 100));

        document.getElementById('bassBar').style.width   = `${normalize(bassAvg)}%`;
        document.getElementById('midBar').style.width    = `${normalize(midAvg)}%`;
        document.getElementById('trebleBar').style.width = `${normalize(trebleAvg)}%`;
        document.getElementById('airBar').style.width    = `${normalize(airAvg)}%`;
    }

    /* ============================================================
       SHOW CHANNEL (Left / Right / Both)
       ============================================================ */
    showChannel(channel) {
        const data = this.currentData;
        if (!data) return;

        /* ---------------------------------------------------------
        BUILD TRACES
        --------------------------------------------------------- */
        const leftTrace = {
            x: data.left_freq_hz || [],
            y: data.left_mag_db  || [],
            type: 'scatter',
            mode: 'lines',
            name: 'Left',
            line: { color: '#6D28D9', width: 2 }
        };

        const rightTrace = {
            x: data.right_freq_hz || [],
            y: data.right_mag_db  || [],
            type: 'scatter',
            mode: 'lines',
            name: 'Right',
            line: { color: '#3B82F6', width: 2 }
        };

        let traces = [];
        if (channel === 'left')   traces = [leftTrace];
        if (channel === 'right')  traces = [rightTrace];
        if (channel === 'both')   traces = [leftTrace, rightTrace];

        /* ---------------------------------------------------------
        UPDATE ACTIVE BUTTON
        --------------------------------------------------------- */
        document.querySelectorAll('.channel-btn')
            .forEach(btn => btn.classList.remove('channel-active'));

        const activeBtn = document.querySelector(`[data-channel="${channel}"]`);
        if (activeBtn) activeBtn.classList.add('channel-active');

        /* ---------------------------------------------------------
        RESPONSIVE LAYOUT FIXES (MOBILE SAFE)
        --------------------------------------------------------- */
        const isMobile = window.innerWidth < 640;

        const layout = {
            xaxis: { 
                title: 'Frequency (Hz)',
                type: 'log',
                color: '#111',
                gridcolor: '#e5e7eb',
                automargin: true,
                nticks: isMobile ? 4 : 10
            },
            yaxis: { 
                title: 'Magnitude (dB)',
                color: '#111',
                gridcolor: '#e5e7eb',
                automargin: true,
                nticks: isMobile ? 4 : 10
            },

            /* Mobile margins tighter */
            margin: { 
                t: 20, 
                r: isMobile ? 10 : 20,
                b: isMobile ? 40 : 60,
                l: isMobile ? 40 : 60
            },

            /* Background + font */
            plot_bgcolor: '#fff',
            paper_bgcolor: '#fff',
            font: { color: '#111', size: isMobile ? 10 : 12 },

            /* UI control disabled */
            displayModeBar: false,
            staticPlot: true
        };

        /* ---------------------------------------------------------
        RENDER
        --------------------------------------------------------- */
        Plotly.newPlot('frequencyChart', traces, layout, { responsive: true });
        this.updateCompareSessionMetrics();

    }


    /* ============================================================
       SAVE RESULTS (JSON Download)
       ============================================================ */
    saveResults() {
        if (!this.currentData) {
            this.showError('No data to save');
            return;
        }

        const dataStr = JSON.stringify(this.currentData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const fileName = `measurely_results_${new Date()
            .toISOString()
            .slice(0,19)
            .replace(/:/g,'-')}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        URL.revokeObjectURL(url);
        this.showSuccess('Results saved successfully');
    }

    /* ============================================================
       EXPORT REPORT (Placeholder)
       ============================================================ */
    exportReport() {
        this.showInfo('Export report feature coming soon');
    }

    /* ============================================================
       PROGRESS BAR CONTROL
       ============================================================ */
    showProgressBar() {
        const container = document.getElementById('progressContainer');
        if (container) container.classList.add('active');
    }

    hideProgressBar() {
        const container = document.getElementById('progressContainer');
        if (container) container.classList.remove('active');

        const bar = document.getElementById('progressBar');
        if (bar) bar.style.width = '0%';
    }

    updateProgress(pct) {
        const bar = document.getElementById('progressBar');
        if (bar) bar.style.width = `${pct}%`;
    }

    /* ============================================================
       LOADING STATE FOR SCORE CARDS
       ============================================================ */
    showLoadingState() {
        const ids = [
            'overallScore','bandwidthScore','balanceScore','smoothnessScore',
            'peaksDipsScore','reflectionsScore','reverbScore'
        ];

        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '--';
        });
    }

    /* ============================================================
       POLLING FOR DEVICE STATUS
       ============================================================ */
    startPolling() {
        this.updateInterval = setInterval(async () => {
            try {
                await this.updateDeviceStatus();
            } catch (err) {
                console.error('Device polling error:', err);
            }
        }, 5000);
    }

    async updateDeviceStatus() {
        try {
            const res = await fetch('/api/status');
            if (!res.ok) return;

            this.deviceStatus = await res.json();
            this.updateDeviceStatusDisplay();
        } catch (err) {
            console.error('Failed to fetch device status:', err);
        }
    }

    updateDeviceStatusDisplay() {
        const s = this.deviceStatus;
        if (!s) return;

        /* -------------------------------------------
        SYSTEM READY
        ------------------------------------------- */
        const sysDot = document.getElementById('systemReadyDot');
        const sysTxt = document.getElementById('systemReadyText');

        if (sysDot && sysTxt) {
            if (s.ready) {
                sysDot.className = "status-indicator bg-green-500 pulse-animation";
                sysTxt.textContent = "System Ready";
            } else {
                sysDot.className = "status-indicator bg-red-500 pulse-animation";
                sysTxt.textContent = "System Check Required";
            }
        }

        /* -------------------------------------------
        IP ADDRESS
        ------------------------------------------- */
        const ipDot = document.getElementById('ipStatusDot');
        const ipTxt = document.getElementById('ipAddressText');

        if (ipDot && ipTxt) {
            const hasIP = Boolean(s.ip);

            ipDot.className = "status-indicator " + (hasIP ? "bg-blue-400" : "bg-red-500");
            ipTxt.textContent = "IP: " + (hasIP ? s.ip : "--.--.--.--");
        }

        /* -------------------------------------------
        DAC CONNECTED
        ------------------------------------------- */
        const dacDot = document.getElementById('dacStatusDot');
        const dacTxt = document.getElementById('dacStatusText');

        if (dacDot && dacTxt) {
            dacDot.className = "status-indicator " + (s.dac ? "bg-yellow-500" : "bg-red-500");
            dacTxt.textContent = s.dac ? "DAC: Connected" : "DAC: Not Found";
        }

        /* -------------------------------------------
        USB MIC CONNECTED
        ------------------------------------------- */
        const usbDot = document.getElementById('usbStatusDot');
        const usbTxt = document.getElementById('usbStatusText');

        if (usbDot && usbTxt) {
            usbDot.className = "status-indicator " + (s.usb ? "bg-green-500" : "bg-red-500");
            usbTxt.textContent = s.usb ? "USB Mic: Connected" : "USB Mic: Not Connected";
        }

        /* -------------------------------------------
        LAST UPDATED CLOCK
        ------------------------------------------- */
        const clock = document.getElementById('lastUpdated');
        if (clock) {
            clock.textContent = new Date().toLocaleTimeString();
        }
    }


    /* ============================================================
       SAMPLE DATA (used when API is missing / errors)
       ============================================================ */
    generateSampleData() {
        const freq = [];
        const mag  = [];
        const phase = [];

        let f = 20;
        while (f <= 20000) {
            freq.push(f);

            let m = -8;
            if (f >= 40 && f <= 60)  m += 6 * Math.exp(-Math.pow(f - 50, 2)/50);
            if (f >= 80 && f <= 120) m += 4 * Math.exp(-Math.pow(f - 100,2)/200);
            if (f > 8000) m -= (f - 8000)/2000;

            m += Math.sin(f/100) * 2 + (Math.random() - 0.5);
            mag.push(m);
            phase.push(Math.sin(f/500) * 180);

            f *= 1.1;
        }

        return {
            timestamp: new Date().toISOString(),
            room: "Sample Room",
            length: 4.0,
            width: 4.0,
            height: 3.0,
            freq_hz: freq,
            mag_db: mag,
            phase_deg: phase,
            overall_score: 6.8,
            bandwidth: 5.2,
            balance: 4.1,
            smoothness: 7.3,
            peaks_dips: 3.9,
            reflections: 5.0,
            reverb: 8.5
        };
    }

    /* ============================================================
       TOAST MESSAGES
       ============================================================ */
    showMessage(msg, type='info') {
        const toast = document.createElement('div');
        toast.className = `fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 transition-all duration-300
            ${type === 'error' ? 'bg-red-600 text-white'
             : type === 'success' ? 'bg-green-600 text-white'
             : 'bg-blue-600 text-white'}`;

        toast.textContent = msg;
        document.body.appendChild(toast);

        setTimeout(() => toast.classList.add('translate-x-0'), 10);

        setTimeout(() => {
            toast.classList.add('translate-x-full');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    showError(msg)   { this.showMessage(msg, 'error'); }
    showSuccess(msg) { this.showMessage(msg, 'success'); }
    showInfo(msg)    { this.showMessage(msg, 'info'); }
}

/* -----  BOOTSTRAP  ----- */
let firstDrawDone = false;

document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new MeasurelyDashboard();

    /*  wait until layout + CSS size is settled, then draw  */
    const draw = () => {
        if (firstDrawDone) return;
        const box = document.getElementById('frequencyChart');
        if (!box) return;                       // node not ready yet
        if (box.clientHeight === 0) {           // parent collapsed / zero
            requestAnimationFrame(draw);
            return;
        }
        firstDrawDone = true;
        dashboard.showChannel('both');          // real size now known
    };
    requestAnimationFrame(draw);
});

/*  background refresh  -------------------------------------- */
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && window.dashboard) window.dashboard.loadData();
});