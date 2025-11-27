/* ============================================================
    GLOBAL TIP MEMORY + UNIQUE PICKING
    ============================================================ */
window.usedBuddyTips = {
    peaks_dips: new Set(),
    reflections: new Set(),
    bandwidth: new Set(),
    balance: new Set(),
    smoothness: new Set(),
    reverb: new Set(),

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

function updateMetricAria(labelId, scoreId, statusId, buddyId) {
    const score = document.getElementById(scoreId)?.textContent.trim() || "--";
    const status = document.getElementById(statusId)?.textContent.trim() || "";
    const buddy = document.getElementById(buddyId)?.textContent.trim() || "";

    const card = document.querySelector(`[aria-labelledby="${labelId}"]`);
    if (card) {
        card.setAttribute(
            "aria-label",
            `${document.getElementById(labelId).textContent}. Score ${score} out of 10. ${status}. Dave says: ${buddy}`
        );
    }
}

function updateAllMetricAria() {
    updateMetricAria("peaksDipsLabel", "peaksDipsScore", "peaksDipsStatusText", "peaksDipsBuddy");
    updateMetricAria("reflectionsLabel", "reflectionsScore", "reflectionsStatusText", "reflectionsBuddy");
    updateMetricAria("bandwidthLabel", "bandwidthScore", "bandwidthStatusText", "bandwidthBuddy");
    updateMetricAria("balanceLabel", "balanceScore", "balanceStatusText", "balanceBuddy");
    updateMetricAria("smoothnessLabel", "smoothnessScore", "smoothnessStatusText", "smoothnessBuddy");
    updateMetricAria("reverbLabel", "reverbScore", "reverbStatusText", "reverbBuddy");
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


    /* ============================================================
    INIT
    ============================================================ */
    async init() {
        console.log('Initializing Measurely Dashboard...');

        this.setupEventListeners();
        this.resetSessionButtonLabels();  
        
        await this.loadData();
        this.startPolling();
        this.updateDashboard(); 
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

            // Debug room
            if (this.currentData.room) {
                console.log("ROOM:", this.currentData.room);
            }

            this.updateDashboard();
            this.updateCompareSessionMetrics(); // Update Nerds Corner with current session data
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

        // 🔥 CLEAR OLD LOGS + START NEW ENTRY
        const logBox = document.getElementById("sessionLog");
        if (logBox) logBox.innerHTML = "";
        addLog("Starting new sweep…");

        this.isSweepRunning = true;
        console.log('Starting sweep...');
        addLog("Initialising…");

        this.showProgressBar();

        const runBtn = document.getElementById('runSweepBtn');
        runBtn.disabled = true;
        runBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Running Sweep...';

        try {
            // 🔥 DEVICE CHECK LOGS
            addLog("Detecting audio devices…");

            const response = await fetch('/api/run-sweep', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            // 🔥 AFTER API REQUEST
            addLog("Sweep command sent to Measurely engine…");

            if (!response.ok) {
                addLog(`ERROR: Sweep failed to start (HTTP ${response.status})`);
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();

            if (result.status !== 'error') {
                addLog("Sweep running… monitoring progress.");
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
    SWEEP PROGRESS MONITOR (CLEAN / FIXED)
    ============================================================ */
    async monitorSweepProgress() {
        this.sweepCheckInterval = setInterval(async () => {
            try {
                const response = await fetch('/api/sweep-progress');
                const progress = await response.json();

                // 🔥 PHASE LOGGING
                if (progress.phase && progress.phase !== this.lastLoggedPhase) {
                    addLog(progress.phase);   // e.g. "Left channel sweep…"
                    this.lastLoggedPhase = progress.phase;
                }

                // 🔥 PROGRESS LOGGING
                if (typeof progress.progress === "number") {
                    addLog(`Sweep progress: ${progress.progress}%`);
                }

                this.updateProgress(progress.progress);

                if (!progress.running) {
                    clearInterval(this.sweepCheckInterval);

                    try {
                        addLog("Sweep finished. Loading results…");

                        await this.loadData();
                        this.updateDashboard();

                        addLog("Sweep complete ✔");
                        this.showSuccess('Sweep complete!');

                    } catch (e) {
                        console.error("Load data failed:", e);
                        addLog("ERROR: Could not load sweep results.");
                        this.showError('Sweep failed');
                    }

                    this.resetSweepState();
                }

            } catch (err) {
                console.error(err);
                addLog("ERROR: Sweep monitor failed.");
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
        runBtn.innerHTML = '<i class="fas fa-play mr-2"></i>Quick Sweep';

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
        this.updateModes();

        // NEW: Call the dedicated tips/tweaks updater, relying on a safety check inside
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
        const overall = data.overall_score ?? 5.0;

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

        /* ---------------- OVERALL BUDDY PHRASE ---------------- */
        this.pickOverallPhrase(overall).then(dynamicPhrase => {
            const backend = this.currentData.buddy_freq_blurb || "";
            const finalPhrase = backend || dynamicPhrase;

            const phraseEl = document.getElementById('overallBuddyPhrase');
            if (phraseEl) phraseEl.textContent = `“${finalPhrase}”`;

            const footerEl = document.getElementById('buddyFooter');
            if (footerEl) footerEl.textContent = "";
        });

        /* ---------------- SIX SMALL CARD SCORES ---------------- */
        const scores = {
            bandwidthScore: data.bandwidth ?? 0,
            balanceScore: data.balance ?? 0,
            smoothnessScore: data.smoothness ?? 0,
            peaksDipsScore: data.peaks_dips ?? 0,
            reflectionsScore: data.reflections ?? 0,
            reverbScore: data.reverb ?? 0
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

        /* ---------------- SUMMARIES + BUDDY TIPS ---------------- */
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
            { id: 'reverb', score: data.reverb ?? 3, 
              rawFunc: (s) => `Decay Time: ${(s / 100).toFixed(2)}s EDT` }
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
                const choices = window.buddyBank[metric.id]?.[bucket] || ['Dave cannot compute.'];
                const translatedPhrase = window.pickUniqueTip(metric.id, choices); 
                transEl.textContent = `“${translatedPhrase}”`; // Apply quotes for Dave's voice
            }

            // --- BOX 3: SOLUTIONS (The list of specific fixes) ---
            const solutionsEl = document.getElementById(metric.id + 'Solutions');
            if (solutionsEl) {
                const solutionChoices = window.buddyBank[metric.id + '_solutions']?.[bucket] || ['<li>No fixes available.</li>'];
                
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
    CARD SUMMARIES + BUDDY TIPS + RAW METRICS
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
        const reverb      = data.reverb      ?? 3;

        /* Convert scores to buckets */
        const bwBucket   = this.toBucket(bandwidth);
        const balBucket  = this.toBucket(balance);
        const smBucket   = this.toBucket(smoothness);
        const pdBucket   = this.toBucket(peaksDips);
        const refBucket  = this.toBucket(reflections);
        const rvBucket   = this.toBucket(reverb);


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
        6. REVERB
        ============================================================ */
        const edt = (reverb / 100).toFixed(2);

        document.getElementById('reverbStatusText').textContent =
            reverb > 7 ? "Excellent control" :
            reverb > 4 ? "Acceptable" :
                        "Too live";

        const revRaw = document.getElementById("reverbRaw");
        if (revRaw) revRaw.textContent = this.pickRawMetric("reverb", rvBucket);


        /* ============================================================
        BUDDY PHRASES
        ============================================================ */
        this.injectBuddyPhrase("bandwidthBuddy",   "bandwidth",   bwBucket);
        this.injectBuddyPhrase("balanceBuddy",     "balance",     balBucket);
        this.injectBuddyPhrase("smoothnessBuddy",  "smoothness",  smBucket);
        this.injectBuddyPhrase("peaksDipsBuddy",   "peaks_dips",  pdBucket);
        this.injectBuddyPhrase("reflectionsBuddy", "reflections", refBucket);
        this.injectBuddyPhrase("reverbBuddy",      "reverb",      rvBucket);
    }


    /* ============================================================
    BUDDY TIP INJECTION (PER CARD)
    ============================================================ */
    async injectBuddyPhrase(elId, cardName, bucket) {
        const el = document.getElementById(elId);
        if (!el) return;

        const bank = window.buddyBank || {};

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
    FREQUENCY RESPONSE CHART
    ============================================================ */
    updateFrequencyChart() {
        const chart = document.getElementById('frequencyChart');
        if (!chart) {
            return; // <-- skip whole function on non-dashboard pages
        }
        const data = this.currentData;
        if (!data) return;

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

        const active = document.querySelector('.channel-active')?.dataset.channel || 'both';
        const toPlot = active === 'left' ? [traces[0]]
                     : active === 'right' ? [traces[1]]
                     : traces;

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

        // NEW — update the chart’s aria label (fixed)
        const activeChannel = document.querySelector('.channel-active')?.dataset.channel || 'both';

        updateChartAria(
            activeChannel,
            `Showing ${activeChannel} channel frequency response.`
        );

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
                sessBalance: '--', sessSmoothness: '--', sessReverb: '--',
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
        set("sessReverb", d.reverb, true);

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
            reverb: 8.5,
            has_analysis: true,
            band_levels_db: { bass: 5.5, mid: 0.5, treble: -3.0, air: -8.0 }
        };
    }

    /* ============================================================
    SESSION LOADING (Latest / Previous / Last)
    ============================================================ */
    async loadNthSession(n) {
        try {
            // Fetch list of real sessions
            const all = await fetch('/api/sessions').then(r => r.json());

            // --- Safety checks ----------------------------------------------------
            if (!Array.isArray(all) || all.length === 0) {
                this.showError("No real sessions found");
                return;
            }

            if (n >= all.length) {
                this.showError("Not enough sessions yet");
                return;
            }

            const sessionId = all[n].id;
            if (!sessionId) {
                this.showError("Invalid session ID");
                return;
            }

            // --- Fetch actual session data ---------------------------------------
            const data = await fetch(`/api/session/${encodeURIComponent(sessionId)}`)
                .then(r => r.json());

            if (!data || data.error) {
                this.showError("Failed to load session");
                return;
            }

            // The API returns the whole session, not wrapped in data.session
            this.currentData = data;

            // Redraw the dashboard
            this.updateDashboard();

            // Highlight the correct button
            this.highlightSessionButton(n);

            // Success toast
            const label = (n === 0 ? "Latest" : n === 1 ? "Previous" : "Last");
            this.showSuccess(`Loaded ${label} session`);

        } catch (err) {
            console.error(err);
            this.showError("Error loading session");
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
            if (el) el.addEventListener('click', handler);
        };

        // Sweep controls — only on Dashboard
        safe('runSweepBtn', () => this.runSweep());
        safe('saveResultsBtn', () => this.saveResults());
        safe('exportReportBtn', () => this.exportReport());

        // Channel buttons — only on Dashboard
        safe('leftChannelBtn',  () => this.showChannel('left'));
        safe('rightChannelBtn', () => this.showChannel('right'));
        safe('bothChannelsBtn', () => this.showChannel('both'));

        safe('sessionLatestBtn',   () => this.loadNthSession(0));
        safe('sessionPreviousBtn', () => this.loadNthSession(1));
        safe('sessionLastBtn',     () => this.loadNthSession(2));


        // Removed session comparison event listeners as they are handled in index.html script
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