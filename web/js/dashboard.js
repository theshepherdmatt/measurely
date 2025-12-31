window.addLog = function (msg) {
    const logBox = document.getElementById("sessionLog");
    if (!logBox) return;

    const line = document.createElement("div");
    line.textContent = msg;

    // subtle fade (optional)
    line.style.opacity = 0;
    line.style.transition = "opacity 0.3s";
    logBox.appendChild(line);
    requestAnimationFrame(() => line.style.opacity = 1);

    // auto-scroll
    logBox.scrollTop = logBox.scrollHeight;
};



/* ============================================================
    DASHBOARD CLASS
    ============================================================ */
class MeasurelyDashboard {
    constructor() {
        this.currentData = null;
        this.aiSummary = null;
        this.isSweepRunning = false;
        this.deviceStatus = {};
        this.updateInterval = null;
        this.sweepCheckInterval = null;
        this.analysisCheckInterval = null;
        this.init();
    }

    /* NEW unified scoring bucket */
    toBucket(score) {
        if (score >= 8) return 'excellent';
        if (score >= 6) return 'good';
        if (score >= 4) return 'okay';
        return 'needs_work';
    }

    SPEAKERS_BY_KEY = {};

    async loadSpeakerProfiles() {
        try {
            const res = await fetch('/api/speakers');
            if (!res.ok) throw new Error(res.status);
            const json = await res.json();

            // Build lookup table
            this.SPEAKERS_BY_KEY = {};
            if (json.list && Array.isArray(json.list)) {
                json.list.forEach(s => {
                    this.SPEAKERS_BY_KEY[s.key] = s;
                });
            }

            console.log('[SPK] Loaded speaker profiles:', this.SPEAKERS_BY_KEY);

        } catch (err) {
            console.warn("Failed to load speakers:", err);
        }
    }


    async loadDavePhrases() {
        try {
            const res = await fetch('/dave_phrases.json');
            if (!res.ok) throw new Error(res.status);
            window.daveCards = await res.json();
            console.log("dave_cards loaded");
        } catch {
            window.daveCards = {};
            console.warn("Failed to load dave_cards");
        }
    }

    /* ============================================================
    PEAK / DIP MODE LIST PARSER (from analysis.json)
    ============================================================ */
    updateModes() {
        const data = this.currentData;
        if (!data || !data.modes) return;

        const modes = data.modes;

        // Count peaks and dips from flat objects
        const numPeaks = modes.filter(m => m.type === "peak").length;
        const numDips = modes.filter(m => m.type === "dip").length;

        // Debug
        console.log("Modes detected:", numPeaks, "peaks,", numDips, "dips");

        // OPTIONAL — update DOM if you want
        const peakEl = document.getElementById('modePeakCount');
        const dipEl = document.getElementById('modeDipCount');

        if (peakEl) peakEl.textContent = numPeaks;
        if (dipEl) dipEl.textContent = numDips;
    }


    updateSpeakerSummary(room, retryCount = 0) {
        const el = document.getElementById("sum-speaker-model");
        if (!el || !room) return;

        const key = room.speaker_key;
        if (!key) {
            el.textContent = "Unknown speakers";
            return;
        }

        const spk = this.SPEAKERS_BY_KEY[key];

        if (spk) {
            el.textContent = spk.friendly_name || spk.name || key;
            return;
        }

        // 🔁 Speaker list might not be loaded yet — retry up to 10 times over 2 seconds
        if (retryCount < 10) {
            setTimeout(() => {
                this.updateSpeakerSummary(room, retryCount + 1);
            }, 200);
            return;
        }

        // Fallback if still unknown after retries
        el.textContent = key;
        console.warn(`[SPK] Speaker key unresolved after retries: ${key}`);
    }

    /* ============================================================
    SWEEP HISTORY (NEWEST → OLDEST, NOTES INCLUDED)
    ============================================================ */
    async loadSweepHistory() {
        try {
            const all = await fetch("/api/sessions/all").then(r => r.json());
            const cards = document.querySelectorAll(".sweep-card");

            if (!Array.isArray(all) || all.length === 0) {
                console.warn("No sweep history found.");
                cards.forEach(card => {
                    card.dataset.sweepid = "";
                    card.querySelector(".sweep-score").textContent = "--";
                    card.querySelectorAll(
                        ".m-peaks,.m-reflections,.m-bandwidth,.m-balance,.m-smoothness,.m-clarity"
                    ).forEach(e => e.textContent = "--");

                    const preview = card.querySelector("[data-note-preview]");
                    preview.textContent = "—";
                    preview.style.opacity = "0.3";
                });
                return;
            }

            const extractNum = (id) => {
                const m = String(id).match(/(\d+)(?!.*\d)/);
                return m ? parseInt(m[1], 10) : -1;
            };

            const recent = all
                .slice()
                .sort((a, b) => extractNum(b.id) - extractNum(a.id))
                .filter(s => !(extractNum(s.id) === 0 && all.length > 1))
                .slice(0, 4);

            for (let i = 0; i < cards.length; i++) {
                const card = cards[i];
                const meta = recent[i];

                if (!meta) {
                    card.dataset.sweepid = "";
                    card.querySelector(".sweep-score").textContent = "--";
                    card.querySelectorAll(
                        ".m-peaks,.m-reflections,.m-bandwidth,.m-balance,.m-smoothness,.m-clarity"
                    ).forEach(e => e.textContent = "--");

                    const preview = card.querySelector("[data-note-preview]");
                    preview.textContent = "—";
                    preview.style.opacity = "0.3";
                    continue;
                }

                const sweepId = meta.id;
                card.dataset.sweepid = sweepId;

                /* -------------------------------------------------
                AI COMPARISON (per sweep)
                ------------------------------------------------- */
                const aiBox  = card.querySelector('.sweep-ai-summary');
                const aiText = card.querySelector('[data-ai-compare]');

                if (aiBox && aiText) {
                    try {
                        const aiRes = await fetch(
                            `/measurements/${sweepId}/ai_compare.json`,
                            { cache: 'no-store' }
                        );

                        if (aiRes.ok) {
                            const ai = await aiRes.json();
                            if (ai.summary) {
                                aiText.textContent = ai.summary;
                                aiBox.classList.remove('hidden');
                            }
                        }
                    } catch (err) {
                        // no AI is valid — stay silent
                    }
                }

                let data;
                try {
                    data = await fetch(`/api/session/${sweepId}`).then(r => r.json());
                } catch (err) {
                    console.error("Failed to load sweep:", sweepId, err);
                    continue;
                }

                const timeEl = card.querySelector(".sweep-time");
                if (timeEl) {
                    const ts =
                        data.timestamp ||
                        data.created_at ||
                        meta.timestamp ||
                        null;

                    timeEl.textContent = ts
                        ? new Date(ts).toLocaleString()
                        : "—";
                }

                card.querySelector(".sweep-score").textContent =
                    data.overall_score ?? "--";

                const setMetric = (cls, val) => {
                    const el = card.querySelector(cls);
                    if (!el) return;
                    el.textContent =
                        typeof val === "number" ? val.toFixed(1) : "--";
                };

                setMetric(".m-peaks",       data.peaks_dips);
                setMetric(".m-reflections", data.reflections);
                setMetric(".m-bandwidth",   data.bandwidth);
                setMetric(".m-balance",     data.balance);
                setMetric(".m-smoothness",  data.smoothness);
                setMetric(".m-clarity",     data.clarity);

                const note =
                    (Array.isArray(data.analysis_notes) && data.analysis_notes[0]) ||
                    data.notes ||
                    data.note ||
                    "";

                const previewEl = card.querySelector("[data-note-preview]");
                previewEl.textContent = note.trim() || "—";
                previewEl.style.opacity = note.trim() ? "1" : "0.3";
            }

        } catch (err) {
            console.error("❌ loadSweepHistory failed:", err);
        }
    }

    /* ============================================================
    AI SWEEP COMPARISON (LATEST vs PREVIOUS)
    ============================================================ */
    async loadAISweepComparison() {
        try {
            const res = await fetch('/measurements/latest/ai_compare.json', {
                cache: 'no-store'
            });
            if (!res.ok) return;

            const data = await res.json();
            if (!data || !data.summary) return;

            const card = document.getElementById('aiSweepCompareCard');
            const text = document.getElementById('aiSweepCompareText');
            const meta = document.getElementById('aiSweepCompareMeta');

            if (!card || !text) return;

            // Main AI text
            text.textContent = data.summary;

            // 👇 NEW: meta line
            if (meta) {
                const latest = data.latest || 'Latest';
                const previous = data.previous || 'Previous';
                meta.textContent = `${latest} → ${previous} · Same room, same system`;
            }

            card.removeAttribute('hidden');

            console.log('🧠 AI sweep comparison loaded');

        } catch (err) {
            console.warn('AI sweep comparison unavailable', err);
        }
    }


    /* ============================================================
   SAVE NOTE TO BACKEND (PERSIST IN ANALYSIS.JSON)
   ============================================================ */
    async saveNote(sessionId, note) {
        try {
            await fetch(`/api/session/${encodeURIComponent(sessionId)}/note`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ note })
            });

            this.showSuccess("Note saved");
        } catch (err) {
            console.error("Failed to save note:", err);
            this.showError("Failed to save note");
        }
    }

    /* ============================================================
    INIT
    ============================================================ */
    async init() {
        console.log('Initializing Measurely Dashboard...');

        if (window.initSpeakers) {
            await window.initSpeakers();
        }

        this.setupEventListeners();

        // 🔑 Load Dave's phrase bank first
        await this.loadDavePhrases();
        await this.loadSpeakerProfiles(); 
        await this.loadData();

        this.startPolling();
        this.showSuccess('Sweep complete!');

        console.log('Dashboard initialized successfully');
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

            this.aiSummary = this.currentData.ai_summary || null;

            const room = this.currentData.room;
            if (room) {
                // First update attempt
                this.updateSpeakerSummary(room);

                // Retry after speakers JSON is surely loaded
                setTimeout(() => this.updateSpeakerSummary(room), 300);

                console.log("ROOM:", room);
            }

            this.updateDashboard();

            console.log('Data loaded OK:', this.currentData);

        } catch (error) {
            console.error('Error loading data:', error);
            this.showError('Failed to load measurement data.');

            this.updateDashboard();
        }
    }

    /* ============================================================
    RUN SWEEP (CLEAN — LET PYTHON DRIVE LOGGING)
    ============================================================ */
    async runSweep() {
        if (this.isSweepRunning) {
            this.showInfo('Sweep already running');
            return;
        }

        // Clear old logs
        const logBox = document.getElementById("sessionLog");
        if (logBox) logBox.innerHTML = "";
        addLog("Starting new sweep…");

        this.isSweepRunning = true;

        const runBtn = document.getElementById('runSweepBtn');
        const cancelBtn = document.getElementById("cancelSweepBtn");
        const refreshBtn = document.getElementById("refreshDashboardBtn");

        runBtn.disabled = true;
        runBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Running Sweep...';

        // 👇 Moved here — UI responds instantly
        cancelBtn.classList.remove("hidden");
        cancelBtn.disabled = false;
        refreshBtn.disabled = true;

        try {
            const response = await fetch('/api/run-sweep', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            if (!response.ok) {
                addLog(`ERROR: Sweep failed to start (HTTP ${response.status})`);
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();

            if (result.status !== 'error') {
                // 🚀 logs now flow from backend
                this.monitorSweepProgress();
            } else {
                addLog("ERROR: " + (result.message || 'Sweep failed'));
                this.showError(result.message || 'Sweep failed');
            }

        } catch (err) {
            console.error(err);
            addLog("ERROR: " + err.message);
            this.showError('Sweep failed: ' + err.message);
            this.resetSweepState();
        }
    }

    /* ============================================================
    SWEEP PROGRESS MONITOR — CANCEL SAFE
    ============================================================ */
    async monitorSweepProgress() {
        // Prevent double polling
        if (this.sweepCheckInterval) {
            clearInterval(this.sweepCheckInterval);
        }

        const logBox = document.getElementById("sessionLog");

        const logLine = (msg) => {
            if (!logBox) return;
            logBox.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
            logBox.scrollTop = logBox.scrollHeight;
        };

        this.sweepCheckInterval = setInterval(async () => {
            try {
                const res = await fetch('/api/sweep-progress');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const prog = await res.json();

                if (prog.message || prog.progress !== undefined) {
                    logLine(`Sweep: ${prog.message || "…" } (${prog.progress}%)`);
                }

                // Hand-off condition
                if (!prog.running) {
                    clearInterval(this.sweepCheckInterval);
                    this.sweepCheckInterval = null;

                    addLog("Sweep complete — starting analysis…");
                    this.simulateAnalysisSteps();
                    // Poll for analysis.json to appear
                    this.waitForAnalysisFile();
                }


            } catch (err) {
                console.error("❌ Sweep progress error:", err);
                logLine(`ERROR: ${err.message}`);

                clearInterval(this.sweepCheckInterval);
                this.sweepCheckInterval = null;
                this.resetSweepState();
            }
        }, 800); // faster + smoother than 1000ms
    }

    /* ============================================================
    ANALYSIS PROGRESS MONITOR — TEMPORARILY DISABLED
    ============================================================ */
    async monitorAnalysisProgress() {
        console.warn("⏸ Analysis progress polling disabled — pending backend API");
        return;
    }

    /* ============================================================
    RESET SWEEP UI
    ============================================================ */
    resetSweepState() {
        this.isSweepRunning = false;

        const runBtn = document.getElementById('runSweepBtn');
        const cancelBtn = document.getElementById('cancelSweepBtn');
        const refreshBtn = document.getElementById("refreshDashboardBtn");

        runBtn.disabled = false;
        runBtn.innerHTML = '<i class="fas fa-play mr-2"></i>Quick Sweep';

        if (cancelBtn) cancelBtn.classList.add("hidden");
        if (refreshBtn) refreshBtn.disabled = false;

        if (this.sweepCheckInterval) {
            clearInterval(this.sweepCheckInterval);
            this.sweepCheckInterval = null;
        }
    }

    /* ============================================================
    WAIT FOR ANALYSIS FILE — Real finish signal
    ============================================================ */
    async waitForAnalysisFile() {
        const checkInterval = 1000; // ms
        const maxChecks = 20;
        let checks = 0;

        const checkLoop = setInterval(async () => {
            checks++;

            try {
                const res = await fetch('/api/latest');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                const data = await res.json();
                const score = Number(data.overall_score);

                // Analysis considered “real” only when:
                if (data.has_analysis && Number.isFinite(score) && score > 0) {
                    clearInterval(checkLoop);

                    addLog("Analysis ready — updating dashboard…");

                    this.currentData = data;
                    this.updateDashboard();
                    this.resetSweepState();

                    addLog("Dashboard synced to new sweep.");
                    return;
                }
            } catch (err) {
                console.warn("progress poll failed:", err);
            }

            // Timeout fallback
            if (checks >= maxChecks) {
                clearInterval(checkLoop);

                addLog("Analysis timeout — showing latest data.");

                await this.loadData();
                this.updateDashboard();
                this.resetSweepState();
            }

        }, checkInterval);
    }

    

    /* ============================================================
    SIMULATED ANALYSIS LOGS — makes the process feel alive
    ============================================================ */
    simulateAnalysisSteps() {
        const steps = [
            "FFT: 16384-point transform",
            "Band energy weighting",
            "Modal behaviour scan",
            "Reflection vectors applied",
            "Decay profile measured",
            "Scoring matrix compiled"
        ];

        let i = 0;
        const interval = setInterval(() => {
            if (!this.isSweepRunning && i < steps.length) {
                // If analysis already finished unexpectedly, stop logging
                clearInterval(interval);
                return;
            }

            addLog(`• ${steps[i]}`);
            i++;

            if (i >= steps.length) clearInterval(interval);

        }, 500);
    }

    /* ============================================================
    CANCEL SWEEP — USER ABORT
    ============================================================ */
    async cancelSweep() {
        const cancelBtn = document.getElementById("cancelSweepBtn");
        const logBox = document.getElementById("sessionLog");

        console.warn("🛑 CANCEL triggered");

        cancelBtn.disabled = true;

        if (this.sweepCheckInterval) {
            clearInterval(this.sweepCheckInterval);
            this.sweepCheckInterval = null;
        }

        await fetch('/api/sweep/cancel', { method: "POST" });

        if (logBox) {
            logBox.innerHTML = "🚫 Sweep cancelled — System Ready.<br>";
        }

        await this.loadData();
        this.updateDashboard();

        this.resetSweepState();
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
        this.updateDetailedAnalysis();
        this.updateModes();

        // 🔥 ADD THIS — loads the 4 sweep cards into the dashboard
        this.loadSweepHistory();

        //this.loadAISweepComparison();

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

        console.log(
            "[DEBUG] signal integrity raw:",
            {
                root: data.signal_integrity,
                scores: data.scores,
                scores_signal: data.scores?.signal_integrity
            }
        );


        /* ---------------- OVERALL SCORE ---------------- */
        let overall = Number(data.scores?.overall ?? data.overall_score ?? data.overall);
        if (!Number.isFinite(overall)) overall = 5.0;


        // Main score number
        const overallEl = document.getElementById('overallScore');
        if (overallEl) overallEl.textContent = overall.toFixed(1);

        // Verdict text
        const statusTextEl = document.getElementById('overallStatusText');
        if (statusTextEl) {
            statusTextEl.innerHTML = this.getScoreStatusText(overall);
        }

        /* ---------------- OVERALL DAVE PHRASE — USE overall_phrases.json ONLY ---------------- */
        (async () => {
            const data = this.currentData || {};
            const room = data.room || {};
            const scoresObj = data.scores || {};

            // Overall score used for bucket + tag
            let overallScore = Number(
                scoresObj.overall ?? data.overall_score ?? data.overall ?? 5
            );
            if (!Number.isFinite(overallScore)) overallScore = 5;

            // Restore correct active speaker based on key

            const spk = this.SPEAKERS_BY_KEY[room.speaker_key]
                    || { name: "speakers", friendly_name: "speakers" };


            // Tag values for replacements
            const tagMap = {
                overall_score: overallScore.toFixed(1),
                room_width: room.width_m ?? "--",
                room_length: room.length_m ?? "--",
                room_height: room.height_m ?? "--",
                spk_distance: room.spk_spacing_m ?? "--",
                listener_distance: room.listener_front_m ?? "--",
                distance_from_wall: room.spk_front_m ?? "--",
                toe_in: room.toe_in_deg ?? "--",
                speaker_friendly_name: spk.friendly_name,
                speaker_name: spk.name
            };

            const phraseEl = document.getElementById("overallDavePhrase");
            if (phraseEl) {
                phraseEl.textContent = this.aiSummary
                    ? `“${this.aiSummary}”`
                    : "Run a sweep to get started.";
            }


        })();


        /* ---------------- SIX SMALL CARD SCORES ---------------- */
        const scores = {
            bandwidthScore: data.bandwidth ?? 0,
            balanceScore: data.balance ?? 0,
            smoothnessScore: data.smoothness ?? 0,
            peaksDipsScore: data.scores?.peaks_dips ?? data.peaks_dips ?? 0,
            reflectionsScore: data.reflections ?? 0,
            clarityScore: data.clarity ?? 0,
            signalIntegrityScore: data.signal_integrity ?? 0

        };

        for (const [id, val] of Object.entries(scores)) {

            // Score text (number)
            const el = document.getElementById(id);
            if (el) el.textContent = val.toFixed(1);


        }

        /* ---------------- SUMMARIES + Dave TIPS ---------------- */
        this.updateDescriptions(data);

    }
    
    /* ============================================================
    CARD SUMMARIES + Dave TIPS + RAW METRICS
    ============================================================ */
    updateDescriptions(data) {

        // Only run on main dashboard
        if (!document.getElementById('bandwidthSummary')) return;

        /* Extract safe numeric values */
        const bandwidth   = data.bandwidth   ?? 3;
        const balance     = data.balance     ?? 3;
        const smoothness  = data.smoothness  ?? 3;
        const peaksDips   = data.peaks_dips  ?? 3;
        const reflections = data.reflections ?? 3;
        const clarity = data.scores?.clarity ?? 3;


        /* Convert scores to buckets */
        const bwBucket   = this.toBucket(bandwidth);
        const balBucket  = this.toBucket(balance);
        const smBucket   = this.toBucket(smoothness);
        const pdBucket   = this.toBucket(peaksDips);
        const refBucket  = this.toBucket(reflections);


        const spk = this.SPEAKERS_BY_KEY[data.room?.speaker_key]
                || { friendly_name: "your speakers" };


        /* ============================================================
        1. BANDWIDTH
        ============================================================ */
        document.getElementById('bandwidthStatusText').textContent =
            bandwidth > 6 ? "Good coverage" :
            bandwidth > 3 ? "OK" :
                            "Needs extension";

        /* ============================================================
        2. BALANCE
        ============================================================ */
        document.getElementById('balanceStatusText').textContent =
            (balance > 3 && balance < 7) ? "Well balanced" : "Needs adjustment";

        /* ============================================================
        3. SMOOTHNESS
        ============================================================ */

        document.getElementById('smoothnessStatusText').textContent =
            smoothness > 6 ? "Good consistency" : "Some variation";

        /* ============================================================
        4. PEAKS & DIPS
        ============================================================ */


        document.getElementById('peaksDipsStatusText').textContent =
            peaksDips > 5 ? "OK" : "Treat";


        /* ============================================================
        5. REFLECTIONS
        ============================================================ */

        document.getElementById('reflectionsStatusText').textContent =
            reflections > 6 ? "Good control" :
            reflections > 3 ? "OK" :
                            "Needs treatment";

        /* ============================================================
        6. CLARITY
        ============================================================ */

        const clarityStatusEl = document.getElementById('clarityStatusText');
        if (clarityStatusEl) {
            clarityStatusEl.textContent =
                clarity > 6 ? "Clear presentation" :
                clarity > 3 ? "Some smearing" :
                            "Room dominates";
        }

        /* ============================================================
        Dave PHRASES (new system - no buckets)
        ============================================================ */
        const tagMap = {
            room_width: data.room?.width_m ?? "--",
            room_length: data.room?.length_m ?? "--",
            listener_distance: data.room?.listener_front_m ?? "--",
            spk_distance: data.room?.spk_distance ?? "--",
            speaker_friendly_name: spk.friendly_name
        };

        const expandTags = str => {
            if (!str) return str;
            return Object.entries(tagMap).reduce((out, [k, v]) =>
                out.replace(new RegExp(`{{${k}}}`, "g"), v ?? ""), str);
        };

        const metricMap = {
            bandwidth: "bandwidthDave",
            balance: "balanceDave",
            smoothness: "smoothnessDave",
            peaks_dips: "peaksDipsDave",
            reflections: "reflectionsDave",
            clarity: "clarityDave",

        };

        for (const [metric, elId] of Object.entries(metricMap)) {
            const el = document.getElementById(elId);
            if (!el) continue;

            const arr = window.daveCards?.[metric];
            if (!Array.isArray(arr) || arr.length === 0) {
                el.textContent = "";
                continue;
            }

            const phrase = expandTags(arr[Math.floor(Math.random() * arr.length)]);
            el.textContent = phrase;
        }

    }


    /* ============================================================
    FREQUENCY RESPONSE CHART
    Uses report_curve as the single source of truth
    ============================================================ */
    updateFrequencyChart() {

        const chartEl = document.getElementById('frequencyChart');
        if (!chartEl) return;

        const { currentData } = this;
        if (!currentData?.id) return;

        fetch(`/api/session/${currentData.id}/report_curve`)
            .then(res => {
                if (!res.ok) throw new Error('Failed to fetch report_curve');
                return res.json();
            })
            .then(curve => {

                const isMobile = window.innerWidth < 640;

                /* ---------------- TRACE ---------------- */
                const trace = {
                    x: curve.freqs,
                    y: curve.mag,
                    type: 'scatter',
                    mode: 'lines',
                    line: {
                        color: '#a855f7',          // Measurely accent purple
                        width: isMobile ? 3 : 2.5
                    }
                };

                /* ---------------- LAYOUT ---------------- */
                const layout = {
                    xaxis: {
                        title: {
                            text: 'Level (dB)',
                            standoff: 10,
                            font: {
                                color: '#ffffff',
                                size: isMobile ? 11 : 12
                            }
                        },

                        type: 'log',
                        range: [Math.log10(20), Math.log10(20000)],
                        tickvals: [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000],
                        ticktext: ['20', '50', '100', '200', '500', '1k', '2k', '5k', '10k', '20k'],
                        ticks: 'outside',
                        showline: true,
                        linewidth: 1,
                        linecolor: '#9ca3af',
                        tickfont: {
                            color: 'rgba(255,255,255,0.6)',
                            size: isMobile ? 10 : 11
                        },
                        showgrid: true,
                        gridcolor: 'rgba(255,255,255,0.04)',
                        zeroline: false
                    },

                    yaxis: {
                        title: {
                            text: 'Frequency (Hz)',
                            standoff: 10,
                            font: {
                                color: '#ffffff',
                                size: isMobile ? 11 : 12
                            }
                        },

                        tickmode: 'linear',
                        dtick: 10, 
                        ticks: 'outside',
                        showticklabels: true,
                        tickfont: {
                            color: 'rgba(255,255,255,0.6)',
                            size: isMobile ? 10 : 11
                        },
                        showgrid: true,
                        gridcolor: 'rgba(255,255,255,0.06)',
                        showline: true,
                        linewidth: 1,
                        linecolor: '#9ca3af',
                        zeroline: true,
                        zerolinecolor: 'rgba(255,255,255,0.25)',
                        zerolinewidth: 1,
                        automargin: true
                    },

                    showlegend: false,

                    margin: isMobile
                        ? { t: 10, r: 10, b: 35, l: 40 }
                        : { t: 16, r: 20, b: 45, l: 56 },

                    plot_bgcolor: '#1f2937',
                    paper_bgcolor: 'transparent'
                };

                /* ---------------- RENDER ---------------- */
                Plotly.newPlot(
                    'frequencyChart',
                    [trace],
                    layout,
                    {
                        staticPlot: true,
                        displayModeBar: false,
                        responsive: true
                    }
                );

            })
            .catch(err => {
                console.error('❌ Frequency chart error:', err);
            });
    }


    /* ============================================================
    NERDS CORNER: SESSION EXPLORER METRICS
    ============================================================ */
    updateCompareSessionMetrics() {
        const d = this.currentData;
        // Store previous band values between updates
        this._prevBands = this._prevBands || {};

        
        // Helper to update the Sesssion Explorer blocks
        const set = (id, value, isScore=false) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.innerHTML = isScore
                ? (value ? value.toFixed(1) : '--')
                : value;
        };

        if (!d || !d.has_analysis) {
             // Clear the explorer metrics if no analysis exists
            const emptyMetrics = {
                sessOverallScore: '--', sessOverallStatus: 'No Analysis',
                sessPeaksDips: '--', sessReflections: '--', sessBandwidth: '--',
                sessBalance: '--', sessSmoothness: '--', sessSignalIntegrity: '--',
                sessBass: '-- dB', sessMid: '-- dB', sessTreble: '-- dB', sessAir: '-- dB'
            };
            for (const [id, value] of Object.entries(emptyMetrics)) {
                set(id, value);
            }
            return;
        }

        const bands = d.band_levels_db || {};
        
        // Overall
        set("sessOverallScore", d.overall_score, true);
        set("sessOverallStatus", this.getScoreStatusText(d.overall_score).replace('<strong>Verdict:</strong> ', ''));

        // Six Metrics
        set("sessPeaksDips", d.peaks_dips, true);
        set("sessReflections", d.reflections, true);
        set("sessBandwidth", d.bandwidth, true);
        set("sessBalance", d.balance, true);
        set("sessSmoothness", d.smoothness, true);
        set("sessSignalIntegrity", d.scores?.signal_integrity, true);


        // Four Bands with deltas
        const arrow = () => '▲';


        const updateBand = (id, key) => {
            if (typeof bands[key] !== 'number') {
                set(id, '-- dB');
                return;
            }

            const curr = bands[key];
            const prev = this._prevBands[key];
            const sym = arrow();

            set(id, `${curr.toFixed(1)} dB ${sym}`);
            this._prevBands[key] = curr;
        };

        updateBand('sessBass',   'bass');
        updateBand('sessMid',    'mid');
        updateBand('sessTreble', 'treble');
        updateBand('sessAir',    'air');

        
    }

    /* ============================================================
    DETAILED BAND ANALYSIS (Bass / Mid / Treble / Air)
    ============================================================ */
    updateDetailedAnalysis() {
        if (!document.getElementById('bandBass')) return;

        const data = this.currentData || {};

        /* -------------------------- 
        1) Try band_levels_db FIRST
        -------------------------- */
        if (data.band_levels_db) {
            const b = data.band_levels_db;

            const bass   = (b.bass           ?? b.bass_20_200       ?? 0).toFixed(1);
            const mid    = (b.mid            ?? b.mid_200_2k        ?? 0).toFixed(1);
            const treble = (b.treble         ?? b.treble_2k_10k     ?? 0).toFixed(1);
            const air    = (b.air            ?? b.air_10k_20k       ?? 0).toFixed(1);

            document.getElementById("bandBass").textContent   = `${bass} dB`;
            document.getElementById("bandMid").textContent    = `${mid} dB`;
            document.getElementById("bandTreble").textContent = `${treble} dB`;
            document.getElementById("bandAir").textContent    = `${air} dB`;

            const norm = v => `${Math.max(0, Math.min(100, ((parseFloat(v) + 20) / 40) * 100))}%`;

            const bassBar = document.getElementById('bassBar');
            const midBar = document.getElementById('midBar');
            const trebleBar = document.getElementById('trebleBar');
            const airBar = document.getElementById('airBar');

            if (bassBar)   bassBar.style.width   = norm(bass);
            if (midBar)    midBar.style.width    = norm(mid);
            if (trebleBar) trebleBar.style.width = norm(treble);
            if (airBar)    airBar.style.width    = norm(air);

            return;
        }

        /* --------------------------
        2) No band_levels_db?
            → CALCULATE IT OURSELVES
        -------------------------- */
        const fhz = data.freq_hz;
        const mag = data.mag_db;

        if (!fhz || !mag || fhz.length !== mag.length) {
            // FINAL HARD FALLBACK (no data at all)
            document.getElementById('bassLevel').textContent   = `0.0 dB`;
            document.getElementById('midLevel').textContent    = `0.0 dB`;
            document.getElementById('trebleLevel').textContent = `0.0 dB`;
            document.getElementById('airLevel').textContent    = `0.0 dB`;

            document.getElementById('bassBar').style.width   = '50%';
            document.getElementById('midBar').style.width    = '50%';
            document.getElementById('trebleBar').style.width = '50%';
            document.getElementById('airBar').style.width    = '50%';
            return;
        }

        /* --------------------------
        3) Raw fallback calculation
        -------------------------- */
        let bSum=0,bCnt=0,mSum=0,mCnt=0,tSum=0,tCnt=0,aSum=0,aCnt=0;

        for (let i=0;i<fhz.length;i++){
            const f = fhz[i], v = mag[i];
            if (f>=20 && f<=200){ bSum+=v; bCnt++; }
            else if (f>200 && f<=2000){ mSum+=v; mCnt++; }
            else if (f>2000 && f<=10000){ tSum+=v; tCnt++; }
            else if (f>10000 && f<=20000){ aSum+=v; aCnt++; }
        }

        const bass   = (bCnt? bSum/bCnt : 0).toFixed(1);
        const mid    = (mCnt? mSum/mCnt : 0).toFixed(1);
        const treble = (tCnt? tSum/tCnt : 0).toFixed(1);
        const air    = (aCnt? aSum/aCnt : 0).toFixed(1);

        document.getElementById('bassLevel').textContent   = `${bass} dB`;
        document.getElementById('midLevel').textContent    = `${mid} dB`;
        document.getElementById('trebleLevel').textContent = `${treble} dB`;
        document.getElementById('airLevel').textContent    = `${air} dB`;

        const norm = v => `${Math.max(0, Math.min(100, ((parseFloat(v) + 20) / 40) * 100))}%`;

        document.getElementById('bassBar').style.width   = norm(bass);
        document.getElementById('midBar').style.width    = norm(mid);
        document.getElementById('trebleBar').style.width = norm(treble);
        document.getElementById('airBar').style.width    = norm(air);
    }

    updateDetailedAnalysisStandalone(data) {
        const prev = this.currentData;
        this.currentData = data;

        this.updateDetailedAnalysis();

        this.currentData = prev;
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
        // toast instantly so you know the click registered
        if (window.toast) window.toast("Generating report, please wait…", "info");

        fetch('/api/report/latest')
            .then(res => {
                if (!res.ok) throw new Error(`Report generation failed (${res.status})`);
                return res.blob();
            })
            .then(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'measurely-room-report.png';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                if (window.toast) window.toast("Report downloaded", "success");
            })
            .catch(err => {
                console.error(err);
                if (window.toast) window.toast("Report generation failed", "error");
            });
    }


    /* ============================================================
    LOADING STATE FOR SCORE CARDS
    ============================================================ */
    showLoadingState() {
        const ids = [
            'overallScore','bandwidthScore','balanceScore','smoothnessScore',
            'peaksDipsScore','reflectionsScore','signalIntegrityScore'
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
        DAC CONNECTED
        ------------------------------------------- */
        const dacDot = document.getElementById('dacStatusDot');
        const dacTxt = document.getElementById('dacStatusText');

        if (dacDot && dacTxt) {
            dacDot.className = "status-indicator " + (s.dac?.connected ? "bg-excellent" : "bg-poor");
            dacTxt.textContent = s.dac?.connected ? "DAC: Connected" : "DAC: Not Found";

        }

        /* -------------------------------------------
        USB MIC CONNECTED
        ------------------------------------------- */
        const micOk = s?.mic?.connected;
        const usbDot = document.getElementById('usbStatusDot');
        const usbTxt = document.getElementById('usbStatusText');

        if (usbDot && usbTxt) {
             usbDot.className = "status-indicator " + (s.mic?.connected ? "bg-excellent" : "bg-poor");
             usbTxt.textContent = micOk
                 ? "USB Mic: Connected" 
                 : "USB Mic: Not Connected";
        }
    }


    /* ============================================================
    LOAD SESSION BY INDEX (NEWEST → OLDEST, EXACT MATCH)
    ============================================================ */
    async loadNthSession(n) {
        try {
            console.log(`📦 Loading sweep index: ${n}`);

            // Fetch all sweeps
            const all = await fetch('/api/sessions/all').then(r => r.json());

            const extractNum = (val) => {
                const m = String(val).match(/(\d+)(?!.*\d)/);
                return m ? parseInt(m[1], 10) : 0;
            };

            // Order newest → oldest & REMOVE Sweep0 if others exist
            const sorted = all
                .slice()
                .sort((a, b) => extractNum(b.id) - extractNum(a.id))
                .filter((s) => !(extractNum(s.id) === 0 && all.length > 1));

            console.warn("🔹 SWEEP ORDER:", sorted.map(s => s.id));

            if (!sorted.length) return this.showError("No sweeps found");
            if (n >= sorted.length) return this.showError("Not enough sweeps");

            const sessionId = sorted[n].id;
            console.log(`📂 Fetching sweep → ${sessionId}`);

            const data = await fetch(`/api/session/${encodeURIComponent(sessionId)}`)
                .then(r => r.json());

            if (!data || data.error) {
                console.error("❌ Invalid sweep:", data);
                return this.showError("Sweep load failed");
            }

            this.currentData = data; // required for notes save
            this.updateFrequencyChart();

            // Restore saved note to modal
            const note = (data.analysis_notes?.[0] || data.notes || "").trim();
            const textarea = document.getElementById("notesTextarea");
            if (textarea) {
                textarea.value = note;
                textarea.style.opacity = note ? "1" : "0.3";
                console.log(`📝 Restored note for ${sessionId}:`, note);
            }

            await this.loadSweepHistory();

            // Highlight correct button
            const btns = document.querySelectorAll("#sweepNav button");
            btns.forEach(b => b.classList.remove("session-active"));
            if (btns[n]) btns[n].classList.add("session-active");

            const tag = ["Latest", "Previous", "Earlier", "Oldest"][n] || "Sweep";
            this.showSuccess(`Loaded ${tag}`);

        } catch (err) {
            console.error("❌ loadNthSession error:", err);
            this.showError("Error loading sweep");
        }
    }


    /* ============================================================
    EVENT LISTENERS — SAFE ON ALL PAGES
    ============================================================ */
    setupEventListeners() {


        const btn = document.getElementById('downloadReportBtn');
        if (btn) {
            console.log('🟢 downloadReportBtn FOUND');
            btn.onclick = (e) => {
                console.log('🟡 BUTTON CLICKED');
                e.preventDefault();
                e.stopPropagation();
                this.exportReport(e);
            };
        } else {
            console.error('🔴 downloadReportBtn NOT FOUND');
        }


        const safe = (id, handler) => {
            const el = document.getElementById(id);
            if (!el) {
                console.warn(`[WARN] Missing element for listener: ${id}`);
                return;
            }
            el.addEventListener('click', handler);
        };

        // Sweep controls — Dashboard only
        safe('runSweepBtn',      () => this.runSweep());
        safe('cancelSweepBtn', () => this.cancelSweep());
        safe('downloadReportBtn', () => this.exportReport());

        safe('refreshDashboardBtn', async () => {
            console.log("Manual dashboard refresh triggered");
            await this.loadData();
            this.updateDashboard();
        });

        safe('saveNotesBtn', async () => {
            const textarea = document.getElementById("notesTextarea");
            const note = textarea ? textarea.value.trim() : "";

            // Determine correct sweep ID from currently displayed session
            const sweepId = this.currentData?.id;
            if (!sweepId || sweepId === "latest") {
                console.error("❌ Cannot resolve real sweep ID from currentData.id:", this.currentData?.id);
                this.showError("Cannot save note – invalid sweep ID");
                return;
            }

            console.log(`💾 Saving note for ${sweepId}:`, note);

            await this.saveNote(sweepId, note);

            // Update preview on the correct sweep card
            document.querySelectorAll(".sweep-card").forEach(card => {
                if (card.dataset.sweepid === sweepId) {
                    const preview = card.querySelector("[data-note-preview]");
                    if (preview) preview.textContent = note || "—";
                }
            });

            if (typeof closeNotesModal === "function") {
                closeNotesModal();
            }

            this.showSuccess("Note saved!");
        });
    }

    /* ============================================================
     TOAST MESSAGES
    ============================================================ */
    
    showMessage(msg, type = 'info') {
        const toast = document.createElement('div');

        const colour =
            type === 'error'   ? 'bg-red-600 text-white'
        : type === 'success' ? 'bg-green-600 text-white'
                            : 'bg-blue-600 text-white';

        toast.className = `
            fixed top-4 right-4 z-50
            px-4 py-3 rounded-lg shadow-lg
            transition-all duration-300 ease-out
            transform translate-x-full opacity-0
            ${colour}
        `;

        toast.textContent = msg;
        document.body.appendChild(toast);

        // Slide in
        requestAnimationFrame(() => {
            toast.classList.remove('translate-x-full', 'opacity-0');
            toast.classList.add('translate-x-0', 'opacity-100');
        });

        // Slide out
        setTimeout(() => {
            toast.classList.remove('translate-x-0', 'opacity-100');
            toast.classList.add('translate-x-full', 'opacity-0');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    showError(msg)   { this.showMessage(msg, 'error'); }
    showSuccess(msg) { this.showMessage(msg, 'success'); }
    showInfo(msg)    { this.showMessage(msg, 'info'); }
}
