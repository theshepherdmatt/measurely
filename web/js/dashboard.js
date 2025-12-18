/* ============================================================
    GLOBAL TIP MEMORY + UNIQUE PICKING
    ============================================================ */
window.usedDaveTips = {
    peaks_dips: new Set(),
    reflections: new Set(),
    bandwidth: new Set(),
    balance: new Set(),
    smoothness: new Set(),
    signal_integrity: new Set(),
    

    // score buckets
    excellent: new Set(),
    good: new Set(),
    okay: new Set(),
    needs_work: new Set(),

    // overall buckets
    overall_excellent: new Set(),
    overall_good: new Set(),
    overall_fair: new Set(),
    overall_poor: new Set()
};

// Helper function to replace **markdown** with <span class="font-bold">html</span>
const replaceBold = (text) => text.replace(/\*\*(.*?)\*\*/g, '<span class="font-bold">$1</span>');


window.pickUniqueTip = function(bucket, allTips) {
    if (!allTips || allTips.length === 0) return '';

    const used = window.usedDaveTips[bucket];

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


function applyDynamicColor(el, score) {
    if (!el || score === null || score === undefined) return;

    el.classList.remove(
        "score-excellent", "score-good", "score-okay", "score-poor"
    );

    if (score >= 8) el.classList.add("score-excellent");
    else if (score >= 6) el.classList.add("score-good");
    else if (score >= 4) el.classList.add("score-okay");
    else el.classList.add("score-poor");
}

function applyMainBand(elLevel, elBar, value) {
    if (!elLevel || !elBar) return;

    // Remove old classes
    elLevel.classList.remove("mainband-excellent", "mainband-good", "mainband-okay", "mainband-poor");
    elBar.classList.remove("mainbar-excellent", "mainbar-good", "mainbar-okay", "mainbar-poor");

    // Apply thresholds
    let c = "";
    if (value > -0.5)       c = "excellent";
    else if (value > -3)    c = "good";
    else if (value > -6)    c = "okay";
    else                    c = "poor";

    elLevel.classList.add(`mainband-${c}`);
    elBar.classList.add(`mainbar-${c}`);
}

function updateMetricAria(labelId, scoreId, statusId, daveId) {
    const score = document.getElementById(scoreId)?.textContent.trim() || "--";
    const status = document.getElementById(statusId)?.textContent.trim() || "";
    const dave = document.getElementById(daveId)?.textContent.trim() || "";

    const card = document.querySelector(`[aria-labelledby="${labelId}"]`);
    if (card) {
        card.setAttribute(
            "aria-label",
            `${document.getElementById(labelId).textContent}. Score ${score} out of 10. ${status}. Dave says: ${dave}`
        );
    }
}

function updateAllMetricAria() {
    updateMetricAria("peaksDipsLabel", "peaksDipsScore", "peaksDipsStatusText", "peaksDipsDave");
    updateMetricAria("reflectionsLabel", "reflectionsScore", "reflectionsStatusText", "reflectionsDave");
    updateMetricAria("bandwidthLabel", "bandwidthScore", "bandwidthStatusText", "bandwidthDave");
    updateMetricAria("balanceLabel", "balanceScore", "balanceStatusText", "balanceDave");
    updateMetricAria("smoothnessLabel", "smoothnessScore", "smoothnessStatusText", "smoothnessDave");
    updateMetricAria("signalIntegrityLabel", "signalIntegrityScore", "signalIntegrityStatusText", "signalIntegrityDave");
}

function updateChartAria(channel, summaryText) {
    const chart = document.getElementById("frequencyChart");
    const desc = document.getElementById("frequencyChartDescription");

    if (!chart || !desc) return;

    chart.setAttribute(
        "aria-label",
        `Frequency response chart showing the ${channel} channel. ${summaryText}`
    );

    desc.textContent = summaryText;
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
        this.analysisCheckInterval = null;

        this.loadDavePhrases();
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

    async loadDaveOverall() {
        try {
            const res = await fetch('/overall_phrases.json');
            if (!res.ok) throw new Error(res.status);
            window.daveOverall = await res.json();
            console.log("dave_overall loaded");
        } catch {
            window.daveOverall = {};
            console.warn("Failed to load dave_overall");
        }
    }

    async loadDaveFixes() {
        try {
            const res = await fetch('/tipstweaks_phrases.json');
            if (!res.ok) throw new Error(res.status);
            window.daveFixes = await res.json();
            console.log("dave_fixes loaded");
        } catch {
            window.daveFixes = {};
            console.warn("Failed to load dave_fixes");
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
                        ".m-peaks,.m-reflections,.m-bandwidth,.m-balance,.m-smoothness,.m-signal-integrity"
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

            // Sort newest → oldest and filter Sweep0 if others exist
            const filtered = all
                .slice()
                .sort((a, b) => extractNum(b.id) - extractNum(a.id))
                .filter(s => !(extractNum(s.id) === 0 && all.length > 1));

            const recent = filtered.slice(0, 4);
            console.warn("🟪 SWEEP MAP:", recent.map(s => s.id));

            for (let i = 0; i < cards.length; i++) {
                const card = cards[i];
                const meta = recent[i];

                if (!meta) {
                    card.dataset.sweepid = "";
                    card.querySelector(".sweep-score").textContent = "--";
                    card.querySelectorAll(
                        ".m-peaks,.m-reflections,.m-bandwidth,.m-balance,.m-smoothness,.m-signal-integrity"
                    ).forEach(e => e.textContent = "--");
                    const preview = card.querySelector("[data-note-preview]");
                    preview.textContent = "—";
                    preview.style.opacity = "0.3";
                    continue;
                }

                const sweepId = meta.id;
                card.dataset.sweepid = sweepId;

                let data;
                try {
                    data = await fetch(`/api/session/${sweepId}`).then(r => r.json());
                } catch (err) {
                    console.error("Failed to load sweep for card:", sweepId, err);
                    continue;
                }

                // Scores
                const scoreEl = card.querySelector(".sweep-score");
                scoreEl.textContent = (data.overall_score ?? "--");

                const setMetric = (cls, val) => {
                    const el = card.querySelector(cls);
                    if (!el) return;
                    el.textContent = (val !== undefined && val !== null)
                        ? val.toFixed(1)
                        : "--";
                };

                setMetric(".m-peaks",       data.peaks_dips);
                setMetric(".m-reflections", data.reflections);
                setMetric(".m-bandwidth",   data.bandwidth);
                setMetric(".m-balance",     data.balance);
                setMetric(".m-smoothness",  data.smoothness);
                setMetric(".m-signal-integrity", data.signal_integrity);

                // 📝 Load note preview correctly from saved sweep
                const note =
                    (Array.isArray(data.analysis_notes) && data.analysis_notes.length > 0 && data.analysis_notes[0]) ||
                    data.notes ||
                    data.note ||
                    "";

                const tidiedNote = note.trim();


                const previewEl = card.querySelector("[data-note-preview]");
                previewEl.textContent = tidiedNote !== "" ? tidiedNote : "—";
                previewEl.style.opacity = tidiedNote !== "" ? "1" : "0.3";

                console.log(`📝 Note restored into card(${i}): ${sweepId} → "${tidiedNote}"`);

            }

        } catch (err) {
            console.error("❌ loadSweepHistory failed:", err);
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
        this.resetSessionButtonLabels();  

        // 🔑 Load Dave's phrase bank first
        await this.loadDavePhrases();
        await this.loadDaveOverall();
        await this.loadDaveFixes();
        await this.loadSpeakerProfiles(); 
        // Then load measurement data
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

            const room = this.currentData.room;
            if (room) {
                // First update attempt
                this.updateSpeakerSummary(room);

                // Retry after speakers JSON is surely loaded
                setTimeout(() => this.updateSpeakerSummary(room), 300);

                console.log("ROOM:", room);
            }

            this.updateDashboard();
            this.updateCompareSessionMetrics();

            console.log('Data loaded OK:', this.currentData);

        } catch (error) {
            console.error('Error loading data:', error);
            this.showError('Failed to load measurement data.');

            this.currentData = this.generateSampleData();
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
        this.showProgressBar();

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

        this.hideProgressBar();

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
        this.updateRoomAnalysis();
        this.updateDetailedAnalysis();
        this.updateModes();

        // 🔥 ADD THIS — loads the 4 sweep cards into the dashboard
        this.loadSweepHistory();

        // Tips/tweaks updater
        this.updateTipsAndTweaksCards(this.currentData);

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


        /* ----------------- HELPER FOR DOT COLOURS ----------------- */
        const setDotColour = (el, score) => {
            if (!el) return;
            if (score >= 8) {
                el.className = "w-3 h-3 rounded-full mr-2 bg-green-500";
            } else if (score >= 6) {
                el.className = "w-3 h-3 rounded-full mr-2 bg-blue-400";
            } else if (score >= 4) {
                el.className = "w-3 h-3 rounded-full mr-2 bg-yellow-400";
            } else {
                el.className = "w-3 h-3 rounded-full mr-2 bg-red-500";
            }
        };

        /* ---------------- OVERALL SCORE ---------------- */
        let overall = Number(data.scores?.overall ?? data.overall_score ?? data.overall);
        if (!Number.isFinite(overall)) overall = 5.0;


        // Main score number
        const overallEl = document.getElementById('overallScore');
        if (overallEl) overallEl.textContent = overall.toFixed(1);

        // Dynamic score colour (text)
        this.applySixCardColor("overallScore", overall);

        // Overall dot colour (fixed bug)
        const overallDot = document.getElementById('overallStatus');
        setDotColour(overallDot, overall);

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
            const speakerKey = room.speaker_key;
            let spkSource = null;

            if (speakerKey) {
                spkSource =
                    (window.speaker_profiles && window.speaker_profiles[speakerKey]) ||
                    (window.speakerProfiles && window.speakerProfiles[speakerKey]) ||
                    null;
            }

            // Use the already set and correct active speaker
            const spk = window.activeSpeaker || {
                name: "speakers",
                friendly_name: "speakers"
            };

            // IMPORTANT for ALL phrases
            window.activeSpeaker = spk;

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

            const expandTags = (str) => {
                if (!str) return str;
                let out = str;
                for (const [key, value] of Object.entries(tagMap)) {
                    const re = new RegExp(`{{${key}}}`, "g");
                    out = out.replace(re, value ?? "");
                }
                return out;
            };

            const template = await this.pickOverallPhrase(overallScore);
            const phrase = expandTags(template);

            const phraseEl = document.getElementById("overallDavePhrase");
            if (phraseEl) {
                phraseEl.textContent = `“${phrase}”`;
            }
        })();


        /* ---------------- SIX SMALL CARD SCORES ---------------- */
        const scores = {
            bandwidthScore: data.bandwidth ?? 0,
            balanceScore: data.balance ?? 0,
            smoothnessScore: data.smoothness ?? 0,
            peaksDipsScore: data.scores?.peaks_dips ?? data.peaks_dips ?? 0,
            reflectionsScore: data.reflections ?? 0,
            signalIntegrityScore:
                data.scores?.signal_integrity ??
                data.signal_integrity ??
                0
        };

        for (const [id, val] of Object.entries(scores)) {

            // Score text (number)
            const el = document.getElementById(id);
            if (el) el.textContent = val.toFixed(1);

            // Dot element
            const dotEl = document.getElementById(id.replace('Score', 'Status'));
            setDotColour(dotEl, val);

            // Number colour (text)
            const baseId = id.replace('Score', '').replace(/([A-Z])/g, m => m);
            this.applySixCardColor(baseId, val);
        }

        /* ---------------- SUMMARIES + Dave TIPS ---------------- */
        this.updateDescriptions(data);

    }

    /* ============================================================
    UPDATE TIPS AND TWEAKS CARDS (NEW CORE LOGIC FOR tipsandtweaks.html)
    ============================================================ */
    updateTipsAndTweaksCards(data) {
        // Only run this logic if we are on the tips page and the elements exist
        if (!document.getElementById('peaksDipsRawMetric')) {
            return; 
        }

        const metrics = [
            { id: 'peaksDips', score: data.peaks_dips ?? 3, 
              rawFunc: (s) => `Low Frequency Std Dev: ${(10 - s).toFixed(1)} dB` },
            { id: 'reflections', score: data.reflections ?? 3, 
              rawFunc: (s) => (s > 6 ? 'Low Early Reflection Energy' : 'High Early Reflection Energy') },
            { id: 'bandwidth', score: data.bandwidth ?? 3, 
              rawFunc: (s) => (s > 6 ? 'Wide ±3dB Range' : 'Limited ±3dB Range') },
            { id: 'balance', score: data.balance ?? 3, 
              rawFunc: (s) => (s > 4 && s < 7 ? 'Low L/R Skew' : 'High L/R Skew') },
            { id: 'smoothness', score: data.smoothness ?? 3, 
              rawFunc: (s) => `Mid/High Variance: ${(10 - s).toFixed(1)} dB` },
            { id: 'signal_integrity', score: data.scores?.signal_integrity ?? 3,
                rawFunc: (s) => s >= 7
                    ? 'Clean sweep signal'
                    : 'Weak or unreliable sweep signal'
                }

        ];
        
        metrics.forEach(metric => {
            const bucket = this.toBucket(metric.score);
            
            // --- BOX 1: RAW DATA (Technical Metric) ---
            const rawEl = document.getElementById(metric.id + 'RawMetric');
            if (rawEl) {
                rawEl.textContent = metric.rawFunc(metric.score);
            }

            // --- BOX 2: DAVE'S TRANSLATION (Uses the simple descriptive phrase) ---
            const transEl = document.getElementById(metric.id + 'Translation');
            if (transEl) {
                const choices = window.daveFixes[metric.id]?.[bucket] || ['Dave cannot compute.'];
                const translatedPhrase = window.pickUniqueTip(metric.id, choices); 
                transEl.textContent = `“${translatedPhrase}”`; // Apply quotes for Dave's voice
            }

            // --- BOX 3: SOLUTIONS (The list of specific fixes) ---
            const solutionsEl = document.getElementById(metric.id + 'Solutions');
            if (solutionsEl) {
                const solutionChoices = window.daveFixes[metric.id + '_solutions']?.[bucket] || ['<li>No fixes available.</li>'];
                
                // Format the specific solutions into an HTML list
                const htmlList = solutionChoices.map(solution => {
                    // Apply the bold replacement helper
                    const text = replaceBold(solution);
                    return `<li>${text}</li>`;
                }).join('');

                solutionsEl.innerHTML = htmlList;
            }
        });
    }

    /* ============================================================
    Dave TIP PICKER — OVERALL
    ============================================================ */
    async pickOverallPhrase(score) {

        let bucket =
            score >= 8 ? 'overall_excellent' :
            score >= 6 ? 'overall_good' :
            score >= 4 ? 'overall_fair' :
                        'overall_poor';

        const bank = window.daveOverall || {};
        const choices = bank[bucket] || [];

        if (choices.length === 0) {
            if (bucket === 'overall_excellent') return 'Superb acoustics — nothing fighting the music.';
            if (bucket === 'overall_good') return 'Strong performance — just a few tiny tweaks.';
            if (bucket === 'overall_fair') return 'Decent start — room interactions still audible.';
            return 'Room needs some love, loads of easy wins ahead.';
        }

        return window.pickUniqueTip(bucket, choices);
    }

    /* ============================================================
    RAW METRIC PICKER HELPERS
    ============================================================ */

    pickRawMetric(card, bucket) {
        const rm = window.rawMetrics?.[card]?.[bucket] || [];
        if (!rm.length) return "--";
        // Pick a random line from the fake metrics
        return rm[Math.floor(Math.random() * rm.length)];
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


        /* Convert scores to buckets */
        const bwBucket   = this.toBucket(bandwidth);
        const balBucket  = this.toBucket(balance);
        const smBucket   = this.toBucket(smoothness);
        const pdBucket   = this.toBucket(peaksDips);
        const refBucket  = this.toBucket(reflections);



        /* ============================================================
        1. BANDWIDTH
        ============================================================ */
        document.getElementById('bandwidthStatusText').textContent =
            bandwidth > 6 ? "Good coverage" :
            bandwidth > 3 ? "OK" :
                            "Needs extension";

        const bwRaw = document.getElementById("bandwidthRaw");
        if (bwRaw) bwRaw.textContent = this.pickRawMetric("bandwidth", bwBucket);


        /* ============================================================
        2. BALANCE
        ============================================================ */
        document.getElementById('balanceStatusText').textContent =
            (balance > 3 && balance < 7) ? "Well balanced" : "Needs adjustment";

        const balRaw = document.getElementById("balanceRaw");
        if (balRaw) balRaw.textContent = this.pickRawMetric("balance", balBucket);


        /* ============================================================
        3. SMOOTHNESS
        ============================================================ */
        const smoothDev = (10 - smoothness).toFixed(1);

        document.getElementById('smoothnessStatusText').textContent =
            smoothness > 6 ? "Good consistency" : "Some variation";

        const smRaw = document.getElementById("smoothnessRaw");
        if (smRaw) smRaw.textContent = this.pickRawMetric("smoothness", smBucket);


        /* ============================================================
        4. PEAKS & DIPS
        ============================================================ */
        const lfStdDev = (10 - peaksDips).toFixed(1);

        document.getElementById("peaksDipsRaw").textContent =
            this.pickRawMetric("peaks_dips", pdBucket);

        document.getElementById('peaksDipsStatusText').textContent =
            peaksDips > 5 ? "OK" : "Treat";


        /* ============================================================
        5. REFLECTIONS
        ============================================================ */

        document.getElementById('reflectionsStatusText').textContent =
            reflections > 6 ? "Good control" :
            reflections > 3 ? "OK" :
                            "Needs treatment";

        const refRaw = document.getElementById("reflectionsRaw");
        if (refRaw) refRaw.textContent = this.pickRawMetric("reflections", refBucket);


        /* ============================================================
        Dave PHRASES (new system - no buckets)
        ============================================================ */
        const spk = (data.room?.speaker_key && window.SPEAKERS?.[data.room.speaker_key])
            ? window.SPEAKERS[data.room.speaker_key]
            : { friendly_name: "your speakers" };

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
            signal_integrity: "signalIntegrityDave"
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
    Dave TIP INJECTION (PER CARD)
    ============================================================ */
    async injectDavePhrase(elId, cardName, bucket) {
        const el = document.getElementById(elId);
        if (!el) return;

        const bank = window.daveCards || {};

        const cardBucket = bank[cardName];
        if (!cardBucket) {
            console.warn("No card bucket for", cardName);
            el.textContent = "--";
            return;
        }

        const choices = cardBucket[bucket] || [];
        if (choices.length === 0) {
            console.warn("No tips for", cardName, bucket);
            el.textContent = "--";
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

        if (score >= 8) verdict = 'Excellent acoustics';
        else if (score >= 6) verdict = 'Good room response';
        else if (score >= 4) verdict = 'Room for improvement';
        else verdict = 'Needs significant treatment';

        return `<strong>Verdict:</strong> ${verdict}`;
    }

    /* ============================================================
    FIXED — UNIFIED COLOUR SYSTEM (GREEN / BLUE / YELLOW / RED)
    ============================================================ */

    statusClasses = {
        green:   { text: "text-green-500",  dot: "bg-green-500",  icon: "text-green-500" },
        yellow:  { text: "text-yellow-500", dot: "bg-yellow-500", icon: "text-yellow-500" },
        orange:  { text: "text-blue-400",   dot: "bg-blue-400",   icon: "text-blue-400" },
        red:     { text: "text-red-500",    dot: "bg-red-500",    icon: "text-red-500" }
    };


    /* ============================================================
    FIXED — APPLY CARD COLOUR (correct removal lists)
    ============================================================ */
    applySixCardColor(cardId, value) {
        let bucket;
        if (value >= 8) bucket = "green";
        else if (value >= 6) bucket = "yellow";
        else if (value >= 4) bucket = "orange";
        else bucket = "red";

        const palette = this.statusClasses[bucket];
        if (!palette) return;

        /* ---------------- MAIN SCORE ---------------- */
        const scoreEl = document.querySelector(`[data-color-target="${cardId}"]`);
        if (scoreEl) {
            scoreEl.classList.remove(
                "text-green-500","text-yellow-500","text-red-500",
                "text-blue-400","text-purple-600",
                "text-orange-500","text-orange-600","text-orange-400"
            );
            scoreEl.classList.add(palette.text);
        }

        /* ---------------- SUMMARY TEXT ---------------- */
        document.querySelectorAll(`[data-color-summary="${cardId}"]`).forEach(el => {
            el.classList.remove(
                "text-green-500","text-yellow-500","text-red-500",
                "text-blue-400","text-purple-600",
                "text-orange-500","text-orange-600","text-orange-400"
            );
            el.classList.add(palette.text);
        });

        /* ---------------- TITLE (FIXED) ---------------- */
        const titleEl = document.querySelector(`[data-color-title="${cardId}"]`);
        if (titleEl) {
            titleEl.classList.remove(
                "text-green-500","text-yellow-500","text-red-500",
                "text-blue-400","text-purple-600"
            );
            titleEl.classList.add(palette.text);
        }

        /* ---------------- DOT ---------------- */
        const dotEl = document.getElementById(`${cardId}Status`);
        if (dotEl) {
            dotEl.classList.remove(
                "bg-green-500","bg-yellow-500","bg-red-500",
                "bg-blue-400","bg-purple-600",
                "bg-orange-500","bg-orange-600","bg-orange-400"
            );
            dotEl.classList.add(palette.dot);
        }

        /* ---------------- ICON (FIXED) ---------------- */
        const iconEl = document.querySelector(`[data-color-icon="${cardId}"]`);
        if (iconEl) {
            iconEl.classList.remove(
                "text-green-500","text-yellow-500","text-red-500",
                "text-blue-400","text-purple-600"
            );
            iconEl.classList.add(palette.icon);
        }
    }



    /* ============================================================
    FREQUENCY RESPONSE CHART  (REPORT-CURVE SOURCE OF TRUTH)
    ============================================================ */
    updateFrequencyChart() {

        const chart = document.getElementById('frequencyChart');
        if (!chart) return;

        const data = this.currentData;
        if (!data || !data.id) return;

        fetch(`/api/session/${data.id}/report_curve`)
            .then(res => {
                if (!res.ok) throw new Error("report_curve fetch failed");
                return res.json();
            })
            .then(curve => {

                const mobile = window.innerWidth < 640;

                Plotly.newPlot('frequencyChart', [{
                    x: curve.freqs,
                    y: curve.mag,
                    mode: 'lines',
                    line: {
                        color: '#a855f7',   // Measurely purple
                        width: mobile ? 3 : 2.5
                    }
                }], {
                    xaxis: {
                        type: 'log',
                        range: [Math.log10(20), Math.log10(20000)],
                        tickvals: [20,50,100,200,500,1000,2000,5000,10000,20000],
                        ticktext: ['20','50','100','200','500','1k','2k','5k','10k','20k'],
                        showline: true,
                        linewidth: 1,
                        linecolor: '#9ca3af',
                        tickfont: {
                            color: '#e5e7eb',
                            size: mobile ? 10 : 11
                        },
                        showgrid: true,
                        gridcolor: 'rgba(255,255,255,0.08)',
                        zeroline: false
                    },

                    yaxis: {
                        range: [-10, 15],
                        showline: true,
                        linewidth: 1,
                        linecolor: '#9ca3af',
                        tickfont: {
                            color: '#e5e7eb',
                            size: mobile ? 10 : 11
                        },
                        tickvals: [-10, -5, 0, 5, 10, 15],
                        showgrid: true,
                        gridcolor: 'rgba(255,255,255,0.08)',
                        zeroline: true,
                        zerolinecolor: 'rgba(255,255,255,0.25)',
                        zerolinewidth: 1
                    },

                    showlegend: false,
                    margin: mobile
                        ? { t: 5, r: 5, b: 25, l: 30 }
                        : { t: 20, r: 20, b: 50, l: 55 },
                    plot_bgcolor: '#1f2937',      // dark grey graph area
                    paper_bgcolor: 'transparent',
                }, {
                    staticPlot: true,
                    displayModeBar: false,
                    responsive: true
                });

                updateChartAria(
                    'both',
                    'Showing frequency response.'
                );

            })
            .catch(err => {
                console.error("❌ Frequency chart error:", err);
            });
    }



    /* ============================================================
    NERDS CORNER: SESSION EXPLORER METRICS
    ============================================================ */
    updateCompareSessionMetrics() {
        const d = this.currentData;
        
        // Helper to update the Sesssion Explorer blocks
        const set = (id, value, isScore=false) => {
            const el = document.getElementById(id);
            if (el) el.textContent = isScore ? (value ? value.toFixed(1) : '--') : value;
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

        // Four Bands
        set("sessBass", bands.bass ? `${bands.bass.toFixed(1)} dB` : '-- dB');
        set("sessMid", bands.mid ? `${bands.mid.toFixed(1)} dB` : '-- dB');
        set("sessTreble", bands.treble ? `${bands.treble.toFixed(1)} dB` : '-- dB');
        set("sessAir", bands.air ? `${bands.air.toFixed(1)} dB` : '-- dB');
    }


    /* ============================================================
    ROOM MODE ANALYSIS (L × W × H)
    ============================================================ */
    updateRoomAnalysis() {
        // NOTE: This function's target IDs (roomDimensions, lengthMode, etc.) are not present in index.html
        if (!document.getElementById('roomDimensions')) return;

        const data = this.currentData || {};
        const length = Number(data.length) || 4.0;
        const width = Number(data.width) || 4.0;
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
        if (!document.getElementById('bassLevel')) return;

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

            document.getElementById('bassLevel').textContent   = `${bass} dB`;
            document.getElementById('midLevel').textContent    = `${mid} dB`;
            document.getElementById('trebleLevel').textContent = `${treble} dB`;
            document.getElementById('airLevel').textContent    = `${air} dB`;

            const norm = v => `${Math.max(0, Math.min(100, ((parseFloat(v) + 20) / 40) * 100))}%`;

            document.getElementById('bassBar').style.width   = norm(bass);
            document.getElementById('midBar').style.width    = norm(mid);
            document.getElementById('trebleBar').style.width = norm(treble);
            document.getElementById('airBar').style.width    = norm(air);
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


    /* ============================================================
    SHOW CHANNEL (Left / Right / Both)
    ============================================================ */
        showChannel(channel) {

            const chart = document.getElementById('frequencyChart');
            if (!chart) return;

            const data = this.currentData;
            if (!data) return;

        /* ---------------------------------------------------------
        BUILD TRACES
        --------------------------------------------------------- */
        const mobile = window.innerWidth < 640;
        const leftTrace = {
            x: data.left_freq_hz || [],
            y: data.left_mag_db || [],
            type: 'scatter',
            mode: 'lines',
            name: 'Left',
            line: { color: '#6D28D9', width: mobile ? 3 : 2.5 }
        };

        const rightTrace = {
            x: data.right_freq_hz || [],
            y: data.right_mag_db || [],
            type: 'scatter',
            mode: 'lines',
            name: 'Right',
            line: { color: '#3B82F6', width: mobile ? 3 : 2.5 }
        };

        let traces = [];
        if (channel === 'left') traces = [leftTrace];
        if (channel === 'right') traces = [rightTrace];
        if (channel === 'both') traces = [leftTrace, rightTrace];

        /* ---------------------------------------------------------
        UPDATE ACTIVE BUTTON
        --------------------------------------------------------- */
        document.querySelectorAll('.channel-btn')
            .forEach(btn => {
                btn.classList.remove('channel-active', 'bg-gray-200');
                if (btn.dataset.channel === channel) {
                    btn.classList.add('channel-active', 'bg-gray-200');
                } else {
                    btn.classList.add('bg-gray-200'); 
                }
            });


        /* ---------------------------------------------------------
        RESPONSIVE LAYOUT FIXES (MOBILE SAFE)
        --------------------------------------------------------- */
        const isMobile = window.innerWidth < 640;

        const layout = {
            xaxis: { 
                type: 'log',
                showline: true,
                linewidth: 1,
                linecolor: '#d1d5db',
                tickfont: { size: isMobile ? 10 : 11 },
                title: isMobile ? '' : 'Frequency (Hz)'  
            },
            yaxis: { 
                showline: true,
                linewidth: 1,
                linecolor: '#d1d5db',
                tickfont: { size: isMobile ? 10 : 11 },
                title: isMobile ? '' : 'Magnitude (dB)'  
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
        Plotly.newPlot('frequencyChart', traces, layout, { responsive: true, displayModeBar: false, showLegend: false });
        this.updateCompareSessionMetrics(); // Redraw metrics after chart update

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
        window.location.href = '/api/report/latest';
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
     SAMPLE DATA (used when API is missing / errors)
     ============================================================ */
    generateSampleData() {
        const freq = [];
        const mag = [];
        const phase = [];

        let f = 20;
        while (f <= 20000) {
            freq.push(f);

            let m = -8;
            if (f >= 40 && f <= 60) m += 6 * Math.exp(-Math.pow(f - 50, 2)/50);
            if (f >= 80 && f <= 120) m += 4 * Math.exp(-Math.pow(f - 100,2)/200);
            if (f > 8000) m -= (f - 8000)/2000;

            m += Math.sin(f/100) * 2 + (Math.random() - 0.5);
            mag.push(m);
            phase.push(Math.sin(f/500) * 180);

            f *= 1.1;
        }

        return {
            timestamp: new Date().toISOString(),
            room: { length_m: 4.0, width_m: 4.0, height_m: 3.0 },
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
            signal_integrity: 9.5,
            has_analysis: true,
            band_levels_db: { bass: 5.5, mid: 0.5, treble: -3.0, air: -8.0 }
        };
    }

    updateFrequencyChartStandalone(data) {
        const chart = document.getElementById('frequencyChart');
        if (!chart) return;

        const mobile = window.innerWidth < 640;

        const traces = [
            {
                x: data.left_freq_hz || [],
                y: data.left_mag_db || [],
                type: 'scatter',
                mode: 'lines',
                name: 'Left',
                line: { color: '#6D28D9', width: mobile ? 3 : 2.5 }
            },
            {
                x: data.right_freq_hz || [],
                y: data.right_mag_db || [],
                type: 'scatter',
                mode: 'lines',
                name: 'Right',
                line: { color: '#3B82F6', width: mobile ? 3 : 2.5 }
            }
        ];

        const layout = {
            xaxis: {
                type: 'log',
                showline: true,
                linewidth: 1,
                linecolor: '#d1d5db',
                tickfont: { size: mobile ? 10 : 11 },
                title: mobile ? '' : 'Frequency (Hz)'
            },
            yaxis: {
                showline: true,
                linewidth: 1,
                linecolor: '#d1d5db',
                tickfont: { size: mobile ? 10 : 11 },
                title: mobile ? '' : 'Magnitude (dB)'
            },
            showlegend: false,
            margin: mobile
                ? { t: 5, r: 5, b: 25, l: 30 }
                : { t: 20, r: 20, b: 50, l: 55 },
            plot_bgcolor: '#fff',
            paper_bgcolor: '#fff',
            font: { color: '#111', size: mobile ? 9 : 11 },
            displayModeBar: false,
            staticPlot: true
        };

        Plotly.newPlot('frequencyChart', traces, layout, {
            responsive: true,
            displayModeBar: false,
            showLegend: false
        });
    }


    updateCompareSessionMetricsStandalone(data) {
        // temporarily use this.currentData ONLY for Nerds Corner
        const prev = this.currentData;
        this.currentData = data;

        this.updateCompareSessionMetrics();

        // restore original dashboard data afterwards
        this.currentData = prev;
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
            this.updateFrequencyChartStandalone(data);
            this.updateCompareSessionMetricsStandalone(data);

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
    SESSION BUTTON HIGHLIGHTING
    ============================================================ */

    highlightSessionButton(n) {
        const map = {
            0: 'sessionLatestBtn',
            1: 'sessionPreviousBtn',
            2: 'sessionLastBtn'
        };

        ['sessionLatestBtn','sessionPreviousBtn','sessionLastBtn'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.remove('bg-indigo-50','text-indigo-700');
            }
        });

        const active = document.getElementById(map[n]);
        if (active) {
            active.classList.add('bg-indigo-50','text-indigo-700');
        }
    }

    /* ============================================================
    FORCE STATIC SESSION BUTTON LABELS
    ============================================================ */
    resetSessionButtonLabels() {
        const map = {
            sessionLatestBtn:   'Latest',
            sessionPreviousBtn: 'Previous',
            sessionLastBtn:     'Last'
        };

        Object.entries(map).forEach(([id, label]) => {
            const btn = document.getElementById(id);
            if (btn) btn.textContent = label;
        });
    }

    /* ============================================================
    EVENT LISTENERS — SAFE ON ALL PAGES
    ============================================================ */
    setupEventListeners() {

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
        //safe('saveResultsBtn',   () => this.saveResults());
        //safe('exportReportBtn',  () => this.exportReport());

        // Channel buttons — toggle frequency chart
        //safe('leftChannelBtn',   () => this.showChannel('left'));
        //safe('rightChannelBtn',  () => this.showChannel('right'));
        //safe('bothChannelsBtn',  () => this.showChannel('both'));

        // Sweep Navigation – handled exclusively via index.html listener
        // (see bottom of index.html for sweepNav click handler)
        // ❌ No direct sessionLatestBtn or legacy event bindings here

        // Refresh dashboard
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

    showError(msg) { this.showMessage(msg, 'error'); }
    showSuccess(msg) { this.showMessage(msg, 'success'); }
    showInfo(msg) { this.showMessage(msg, 'info'); }
}