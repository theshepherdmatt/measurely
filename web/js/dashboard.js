/* ============================================================
   MODE CONFIG (web | local)
   ============================================================ */
const MEASURELY_MODE = (window.MEASURELY_MODE === "local") ? "local" : "web";

const CAPS = {
  history: true,          // ✅ ALWAYS ENABLE HISTORY
  notes: (MEASURELY_MODE === "web"),
  uploadFlow: (MEASURELY_MODE === "web")
};

const UI = {
  historyCardSelector: ".uploads-card",
  historyIdDatasetKey: "uploadId",        // ALWAYS uploads
  historyScoreSelector: ".uploads-score", // ALWAYS uploads
  historyTimeSelector: ".uploads-time",
  navId: "uploadsNav"
};


async function safeJson(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}



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
   ROOM → ANALYSIS ADAPTER (GEOMETRY ONLY)
   ============================================================ */
function buildRoomGeometryAnalysis(room, room_context) {
    if (!room) return null;

    const measuredSBIR =
        room_context?.sbir ??
        null;

    const {
        length_m,
        width_m,
        height_m,
        spk_spacing_m,
        spk_front_m,
        listener_front_m,
        toe_in_deg,
        tweeter_height_m,
        speaker_type,
        subwoofer,
        opt_area_rug,
        opt_sofa,
        opt_coffee_table,
        wall_treatment
    } = room;

    const volume_m3 = length_m * width_m * height_m;

    // Schroeder frequency (small-room approximation)
    const schroeder_hz = 2000 * Math.sqrt(0.161 / volume_m3);

    // Triangle geometry
    const triangle_ratio =
        spk_spacing_m && listener_front_m
            ? spk_spacing_m / listener_front_m
            : null;

    const ideal_toe_deg =
        spk_spacing_m && listener_front_m
            ? Math.atan((spk_spacing_m / 2) / listener_front_m) * (180 / Math.PI)
            : null;

    let toe_comment = "—";
    if (ideal_toe_deg != null) {
        const diff = toe_in_deg - ideal_toe_deg;
        toe_comment =
            Math.abs(diff) < 3 ? "Near ideal" :
            diff > 0 ? "Over-toed" :
            "Under-toed";
    }

    // Side-wall first reflection (ms)
    const side_wall_dist_m =
        width_m && spk_spacing_m
            ? (width_m - spk_spacing_m) / 2
            : null;

    const side_reflection_ms =
        side_wall_dist_m != null
            ? Math.round((2 * side_wall_dist_m / 343) * 1000)
            : null;

    return {
        room_geometry: {
            dimensions: `${length_m.toFixed(2)} × ${width_m.toFixed(2)} × ${height_m.toFixed(2)} m`,
            volume_m3: volume_m3.toFixed(1),
            schroeder_hz: Math.round(schroeder_hz)
        },

        listening_geometry: {
            speaker_spacing_m: spk_spacing_m?.toFixed(2),
            listener_distance_m: listener_front_m?.toFixed(2),
            tweeter_height_m: tweeter_height_m?.toFixed(2),
            toe_in_deg: toe_in_deg?.toFixed(1),
            toe_comment
        },

        reflections: {
            side_wall_ms: side_reflection_ms
        },

        sbir: measuredSBIR
            ? {
                distance_m: measuredSBIR.distance_m,
                first_null_hz: measuredSBIR.nulls_hz?.[0] ?? null,
                harmonics: measuredSBIR.nulls_hz
            }
            : null,

        context: {
            speaker_type,
            subwoofer,
            opt_area_rug,
            opt_sofa,
            opt_coffee_table,
            wall_treatment
        }
    };
}

/* ============================================================
   RENDER: ROOM ANALYSIS CARDS
   ============================================================ */
function renderRoomAnalysisCards(analysis) {
    if (!analysis) return;

    // -------- Room Geometry --------
    const dim = document.getElementById("analysisRoomDimensions");
    const vol = document.getElementById("analysisRoomVolume");
    const sch = document.getElementById("analysisSchroeder");

    if (dim) dim.textContent = analysis.room_geometry.dimensions;
    if (vol) vol.textContent = `${analysis.room_geometry.volume_m3} m³`;
    if (sch) sch.textContent = `${analysis.room_geometry.schroeder_hz} Hz`;

    // -------- Listening Geometry --------
    const spk = document.getElementById("analysisSpeakerSpacing");
    const lst = document.getElementById("analysisListenerDistance");
    const toe = document.getElementById("analysisToeIn");
    const toeNote = document.getElementById("analysisToeComment");

    if (spk) spk.textContent = `${analysis.listening_geometry.speaker_spacing_m} m`;
    if (lst) lst.textContent = `${analysis.listening_geometry.listener_distance_m} m`;
    if (toe) toe.textContent = `${analysis.listening_geometry.toe_in_deg}°`;
    if (toeNote) toeNote.textContent = analysis.listening_geometry.toe_comment;

    // -------- Side-wall reflection --------
    const sideEl = document.getElementById("sideRefMs");
    if (sideEl) {
        sideEl.textContent =
            Number.isFinite(analysis.reflections?.side_wall_ms)
                ? analysis.reflections.side_wall_ms
                : "—";
    }

    // -------- SBIR (Measured) --------
    const sbirFreqEl   = document.getElementById("sbirFreq");
    const sbirDetailEl = document.getElementById("sbirDetail");

    if (analysis.sbir && sbirFreqEl && sbirDetailEl) {
        const d = analysis.sbir.distance_m;
        const f = analysis.sbir.first_null_hz;

        sbirFreqEl.textContent =
            Number.isFinite(f) ? Math.round(f) : "—";

        sbirDetailEl.innerHTML = `
            <p><strong>Measured condition:</strong> Your speakers are ${d.toFixed(2)} m from the front wall.</p>

            <p><strong>Acoustic maths:</strong>  
            A rear-radiated wave reflects off the wall and returns 180° out of phase when its path equals half a wavelength.</p>

            <p><code>f = 343 / (4 × ${d.toFixed(2)})</code></p>

            <p><strong>Result:</strong> This predicts a cancellation at <strong>${Math.round(f)} Hz</strong>, which matches the energy dip seen in your sweep.</p>

            <p><strong>What this means:</strong>  
            This isn’t a speaker fault — it’s boundary interference.  
            Moving the speakers closer raises this null; moving them further lowers it.</p>
        `;
    }

    // -------- Bandwidth (Room Geometry Contribution) --------
    const bwEl = document.getElementById("bandwidthRange");
    const schEl = document.getElementById("bandwidthSchroeder");

    if (analysis.room_geometry && bwEl) {
        bwEl.textContent =
            `Below ${analysis.room_geometry.schroeder_hz} Hz`;
    }

    if (analysis.room_geometry && schEl) {
        schEl.textContent =
            `${analysis.room_geometry.schroeder_hz} Hz`;
    }


}

function updateMeasurementIntegrity(data) {
    if (!data) return;

    // --- Sweep duration ---
    const sweepEl = document.getElementById("sweepLength");
    if (sweepEl) {
        const dur =
            data.sweep_duration_s ??
            data.analysis?.sweep_duration_s ??
            null;

        sweepEl.textContent =
            Number.isFinite(dur) ? `${dur.toFixed(1)} s` : "— s";
    }

    // --- Noise floor ---
    const noiseEl = document.getElementById("noiseFloor");
    if (noiseEl) {
        const nf =
            data.noise_floor_db ??
            data.signal_integrity?.noise_floor_db;

        noiseEl.textContent =
            Number.isFinite(nf) ? `${nf.toFixed(1)} dB` : "— dB";
    }

    // --- Peak SPL ---
    const peakEl = document.getElementById("peakSPL");
    if (peakEl && Array.isArray(data.mag_db)) {
        const peak = Math.max(...data.mag_db);
        peakEl.textContent =
            Number.isFinite(peak) ? `${peak.toFixed(1)} dB` : "— dB";
    }

    // --- L / R balance ---
    const lrEl = document.getElementById("lrBalance");
    if (lrEl) {
        const lr =
            data.lr_balance_db ??
            data.signal_integrity?.lr_balance_db;

        lrEl.textContent =
            Number.isFinite(lr) ? `± ${lr.toFixed(1)} dB` : "—";
    }
}




/* ============================================================
    DASHBOARD CLASS
    ============================================================ */
class MeasurelyDashboard {
    constructor() {
        this.currentData = null;
        this.aiSummary = null;
        this.deviceStatus = {};
        this.updateInterval = null;
        this.activeChartSessions = new Set([0]);
        this.isSweepRunning = false;
        this.sweepCheckInterval = null;
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

    bindSideReflections() {
        const el = document.getElementById("sideRefItem");
        const detail = document.getElementById("sideRefDetail");

        if (!el) return;

        let active = false;

        el.addEventListener("click", () => {
            active = !active;
            detail?.classList.toggle("hidden", !active);

            if (window.room3D) {
                window.room3D.setOverlay("side_reflections", active);
            }
        });
    }

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
    HISTORY (uploads in web, sweeps in local)
    ============================================================ */
    async loadHistory() {

        console.group("📜 loadHistory()");
        console.log("CAPS.history =", CAPS.history);
        console.log("MEASURELY_MODE =", MEASURELY_MODE);

        if (!CAPS.history) return;

        try {
            const history = await safeJson("/api/sweephistory");
            console.log("history raw =", history);
            console.log("history.sweeps =", history?.sweeps);

            const all = Array.isArray(history?.sweeps) ? history.sweeps : [];
            const cards = document.querySelectorAll(UI.historyCardSelector);

            console.log("Found history cards =", cards.length);

            // -------------------------
            // EMPTY / RESET STATE
            // -------------------------
            if (all.length === 0) {
                console.warn("⚠️ HISTORY EMPTY — CLEARING UI");

                cards.forEach(card => {
                    card.dataset.uploadId = "";
                    card.dataset.sweepid = "";
                    card.dataset[UI.historyIdDatasetKey] = "";

                    const scoreEl = card.querySelector(UI.historyScoreSelector);
                    if (scoreEl) scoreEl.textContent = "--";

                    card.querySelectorAll(
                        ".m-peaks,.m-reflections,.m-bandwidth,.m-balance,.m-smoothness,.m-clarity"
                    ).forEach(e => e.textContent = "--");

                    const preview = card.querySelector("[data-note-preview]");
                    if (preview) {
                        preview.textContent = "—";
                        preview.style.opacity = "0.3";
                    }

                    const timeEl = card.querySelector(UI.historyTimeSelector);
                    if (timeEl) timeEl.textContent = "—";
                });

                return;
            }

            // -------------------------
            // SORT NEWEST → OLDEST
            // -------------------------
            const extractNum = (id) => {
                const m = String(id).match(/(\d+)(?!.*\d)/);
                return m ? parseInt(m[1], 10) : -1;
            };

            const recent = all
                .slice()
                .sort((a, b) => extractNum(b.id) - extractNum(a.id))
                .filter(s => !(extractNum(s.id) === 0 && all.length > 1))
                .slice(0, cards.length);

            // -------------------------
            // POPULATE CARDS
            // -------------------------
            for (let i = 0; i < cards.length; i++) {
                const card = cards[i];
                const meta = recent[i];

                if (!meta) {
                    card.dataset.uploadId = "";
                    card.dataset.sweepid = "";
                    card.dataset[UI.historyIdDatasetKey] = "";

                    const scoreEl = card.querySelector(UI.historyScoreSelector);
                    if (scoreEl) scoreEl.textContent = "--";

                    card.querySelectorAll(
                        ".m-peaks,.m-reflections,.m-bandwidth,.m-balance,.m-smoothness,.m-clarity"
                    ).forEach(e => e.textContent = "--");

                    const preview = card.querySelector("[data-note-preview]");
                    if (preview) {
                        preview.textContent = "—";
                        preview.style.opacity = "0.3";
                    }

                    const timeEl = card.querySelector(UI.historyTimeSelector);
                    if (timeEl) timeEl.textContent = "—";

                    continue;
                }

                const sessionId = meta.id;

                // keep BOTH dataset keys for safety
                card.dataset.uploadId = sessionId;
                card.dataset.sweepid = sessionId;
                card.dataset[UI.historyIdDatasetKey] = sessionId;

                // ---- time ----
                const timeEl = card.querySelector(UI.historyTimeSelector);
                if (timeEl) {
                    timeEl.textContent = meta.timestamp
                        ? new Date(meta.timestamp).toLocaleString()
                        : "—";
                }

                // ---- overall score ----
                const scoreEl = card.querySelector(UI.historyScoreSelector);
                if (scoreEl) {
                    scoreEl.textContent =
                        typeof meta.overall_score === "number"
                            ? meta.overall_score.toFixed(1)
                            : "--";
                }

                // ---- metrics ----
                const setMetric = (cls, val) => {
                    const el = card.querySelector(cls);
                    if (!el) return;
                    el.textContent = (typeof val === "number") ? val.toFixed(1) : "--";
                };

                const m = meta.metrics || {};
                setMetric(".m-peaks",       m.peaks_dips);
                setMetric(".m-reflections", m.reflections);
                setMetric(".m-bandwidth",   m.bandwidth);
                setMetric(".m-balance",     m.balance);
                setMetric(".m-smoothness",  m.smoothness);
                setMetric(".m-clarity",     m.clarity);

                // ---- note preview ----
                const note = meta.note || "";
                const previewEl = card.querySelector("[data-note-preview]");
                if (previewEl) {
                    previewEl.textContent = note.trim() || "—";
                    previewEl.style.opacity = note.trim() ? "1" : "0.3";
                }
            }

        } catch (err) {
            console.error("❌ loadHistory failed:", err);
        }

        console.groupEnd();
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

        // Load phrase bank + speaker metadata
        await this.loadDavePhrases();
        await this.loadSpeakerProfiles();
        await this.loadData();

        this.startPolling();
        this.showSuccess('Analysis loaded');

        /* --------------------------------------------
        ANALYSIS ITEM → OVERLAY + DETAIL CONTROLLER
        -------------------------------------------- */
        document.querySelectorAll(".analysis-item").forEach(item => {
        item.addEventListener("click", () => {

            const overlay = item.dataset.overlay;
            const score   = Number(item.dataset.score || 5);
            const isOpen  = item.getAttribute("aria-expanded") === "true";

            const detailId = item.getAttribute("aria-controls");
            const detail   = document.getElementById(detailId);

            // 1️⃣ Collapse ALL items first
            document.querySelectorAll(".analysis-item").forEach(other => {
            other.setAttribute("aria-expanded", "false");

            const otherDetailId = other.getAttribute("aria-controls");
            const otherDetail   = document.getElementById(otherDetailId);
            if (otherDetail) otherDetail.classList.add("hidden");
            });


            if (isOpen) {
            if (window.room3D?.resetView) {
                window.room3D.resetView();
            }
            return;
            }

            // 3️⃣ Expand THIS item
            item.setAttribute("aria-expanded", "true");
            if (detail) detail.classList.remove("hidden");

            // 4️⃣ Activate 3D overlay
            if (overlay && window.room3D) {
            window.room3D.focusIssue(overlay, score);
            }

        });
        });


        console.log('Dashboard initialized successfully');
    }

    /* ============================================================
    LOAD DATA (works in web + local)
    ============================================================ */
    async loadData() {
    try {
        this.showLoadingState();

        // Prefer sessions/all if it exists
        const all = CAPS.history
            ? await safeJson("/api/sessions/all")
            : null;

        // If no history endpoint (or empty), fall back to /api/latest
        if (!Array.isArray(all) || all.length === 0) {
        const latest = await safeJson("/api/latest");
        this.currentData = (latest && latest.freq_hz && latest.mag_db) ? latest : null;
        this.aiSummary = this.currentData?.ai_summary || null;

        if (this.currentData?.room) {
            this.updateSpeakerSummary(this.currentData.room);
            setTimeout(() => this.updateSpeakerSummary(this.currentData.room), 300);
        }

        this.updateDashboard();
        return;
        }

        const extractNum = (id) =>
        parseInt(String(id).match(/(\d+)(?!.*\d)/)?.[1] || "-1", 10);

        const latestMeta = all.slice().sort((a, b) => extractNum(b.id) - extractNum(a.id))[0];
        const data = await safeJson(`/api/session/${encodeURIComponent(latestMeta.id)}`);

        if (!data || !data.freq_hz || !data.mag_db) throw new Error("invalid session data");

        this.currentData = data;
        this.aiSummary = data.ai_summary || null;

        if (data.room) {
        this.updateSpeakerSummary(data.room);
        setTimeout(() => this.updateSpeakerSummary(data.room), 300);
        }

        this.updateDashboard();
    } catch (err) {
        console.error(err);
        this.currentData = null;
        this.updateDashboard();
    }
    }


    async uploadAndAnalyze(file) {
        console.log("📤 uploadAndAnalyze called with:", file);

        if (!CAPS.uploadFlow) {
            console.warn("uploadAndAnalyze called in local mode — ignored");
            return;
        }

        const formData = new FormData();
        formData.append("file", file);   // 🔥 THIS IS CRITICAL

        // 🔍 DEBUG: confirm FormData actually has the file
        for (const [k, v] of formData.entries()) {
            console.log("FormData:", k, v);
        }

        // 1️⃣ UPLOAD WAV
        const uploadResp = await fetch("/api/upload-wav", {
            method: "POST",
            body: formData
            // ❌ DO NOT set headers manually
        });

        if (!uploadResp.ok) {
            const text = await uploadResp.text();
            console.error("Upload failed:", text);
            throw new Error("Upload failed");
        }

        const uploadData = await uploadResp.json();
        console.log("✅ Uploaded:", uploadData);

        const uploadId = uploadData.upload_id;

        // 2️⃣ RUN ANALYSIS
        const analyseResp = await fetch(`/api/run-analysis/${uploadId}`, {
            method: "POST"
        });

        if (!analyseResp.ok) {
            const text = await analyseResp.text();
            console.error("Analysis start failed:", text);
            throw new Error("Analysis start failed");
        }

        console.log("🚀 Analysis started for", uploadId);
    }


    async runSweep() {
        console.log("[Sweep] runSweep() called");
        this.startSweepProgressModal();

        if (this.isSweepRunning) {
            console.warn("[Sweep] already running");
            this.showInfo("Sweep already running");
            return;
        }

        this.isSweepRunning = true;

        // ---- UI: open progress modal (safe) ----
        let closeProgress = null;
        try {
            if (window.showSweepProgress) {
                console.log("[SweepUI] Opening progress modal");
                closeProgress = showSweepProgress();
            } else {
                console.warn("[SweepUI] showSweepProgress() not found");
            }
        } catch (e) {
            console.error("[SweepUI] Failed to open progress modal", e);
        }

        try {
            console.log("[Sweep] POST /api/run-sweep");

            const response = await fetch("/api/run-sweep", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}"
            });

            console.log("[Sweep] HTTP status:", response.status);

            // IMPORTANT: backend runs async — 500 does NOT mean failure
            let result = {};
            try {
                result = await response.json();
                console.log("[Sweep] response JSON:", result);
            } catch {
                console.warn("[Sweep] No JSON body (expected)");
            }

            console.log("[Sweep] Assuming sweep started");

            // ---- Start polling ----
            this.monitorSweepProgress(() => {
                console.log("[Sweep] sweep complete");

                if (closeProgress) closeProgress();

                this.isSweepRunning = false;
                this.updateDashboard?.();
            });

        } catch (err) {
            console.error("[Sweep] HARD FAILURE", err);

            if (closeProgress) closeProgress();

            this.isSweepRunning = false;
            this.showError("Sweep failed to start");
        }
    }


    async monitorSweepProgress() {

        if (this.sweepCheckInterval) {
            clearInterval(this.sweepCheckInterval);
        }

        this.sweepCheckInterval = setInterval(async () => {
            try {
                const res = await fetch('/api/sweep-progress');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                const prog = await res.json();

                if (prog.message || prog.progress !== undefined) {
                    addLog(`Sweep: ${prog.message || "…"} (${prog.progress}%)`);
                }

                if (!prog.running) {
                    clearInterval(this.sweepCheckInterval);
                    this.sweepCheckInterval = null;

                    addLog("Sweep complete — starting analysis…");

                    // 🔥 CLOSE SWEEP MODAL HERE
                    if (this._closeSweepProgress) {
                        this._closeSweepProgress();
                        this._closeSweepProgress = null;
                    }

                    this.simulateAnalysisSteps();
                    this.waitForAnalysisFile();
                }


            } catch (err) {
                console.error("Sweep progress error:", err);
                addLog("ERROR: " + err.message);
                this.resetSweepState();
            }
        }, 800);
    }

    resetSweepState() {
        this.isSweepRunning = false;

        if (this.sweepCheckInterval) {
            clearInterval(this.sweepCheckInterval);
            this.sweepCheckInterval = null;
        }
    }

    startSweepProgressModal() {
    const modal   = document.getElementById("sweepProgressModal");
    const fill    = document.getElementById("sweepProgressFill");
    const percent = document.getElementById("sweepPercent");
    const stage   = document.getElementById("sweepStageText");

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");

    fill.style.width = "0%";
    percent.textContent = "0%";
    stage.textContent = "Starting sweep…";

    if (this._sweepPollTimer) {
        clearInterval(this._sweepPollTimer);
    }

    this._sweepPollTimer = setInterval(async () => {
        try {
        const res = await fetch("/api/sweep-progress");
        if (!res.ok) return;

        const data = await res.json();

        fill.style.width = `${data.progress}%`;
        percent.textContent = `${data.progress}%`;
        stage.textContent = data.message || "Running sweep…";

        if (!data.running && data.progress >= 100) {
            clearInterval(this._sweepPollTimer);
            this._sweepPollTimer = null;

            modal.classList.add("hidden");
            modal.setAttribute("aria-hidden", "true");

            // refresh dashboard after sweep
            this.refreshLatest?.();
        }
        } catch (e) {
        console.warn("Sweep progress polling failed", e);
        }
    }, 1000);
    }


    /* ============================================================
    ANALYSIS PROGRESS MONITOR — TEMPORARILY DISABLED
    ============================================================ */
    async monitorAnalysisProgress() {
        console.warn("⏸ Analysis progress polling disabled — pending backend API");
        return;
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

                    addLog("Dashboard synced to new upload.");
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
                this.resetUploadState();
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
            if (!this.isUploadRunning && i < steps.length) {
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
    UPDATE DASHBOARD (MAIN REFRESH)
    ============================================================ */
    updateDashboard() {
        if (!this.currentData) {
            console.warn('No data to update');
            return;
        }

        console.log('Updating dashboard…');

        this.updateScores();
        this.updateFrequencyChartMulti();
        this.updateDetailedAnalysis();
        this.updateAcousticReality();
        this.updateModes();

        updateMeasurementIntegrity(this.currentData);

        // 🔥 ADD THIS — loads the 4 upload cards into the dashboard
        if (!this._historyLoaded) {
            this._historyLoaded = true;
            this.loadHistory();
        }

        if (window.updateRoomCanvas && this.currentData.room) {
            window.updateRoomCanvas(this.currentData.room);
        }

        // 🧠 NEW: Room geometry analysis (pre-measurement facts)
        if (this.currentData.room) {
            const geom = buildRoomGeometryAnalysis(
                this.currentData.room,
                this.currentData.room_context
            );

            renderRoomAnalysisCards(geom);
            console.log("GEOM SBIR:", geom.sbir);

        }

        console.log('Dashboard update complete.');
    }
    

    /* ============================================================
    UPDATE SCORES (OVERALL + 6 CARDS)
    ============================================================ */
    updateScores() {
        const data = this.currentData;
        if (!data) return;

        // Debugging Signal Integrity
        console.log("[DEBUG] signal integrity raw:", {
            root: data.signal_integrity,
            scores: data.scores,
            scores_signal: data.scores?.signal_integrity
        });

        const s = data.scores || {};

        /* ---------------- 1. OVERALL SCORE & INSTRUMENT GAUGE ---------------- */
        let overall = Number(s.overall ?? data.overall_score ?? data.overall ?? 5.0);
        if (!Number.isFinite(overall)) overall = 5.0;

        const overallEl = document.getElementById('overallScore');
        const overallGauge = document.getElementById('overallGauge');
        const overallPercent = document.getElementById('overallScorePercent');

        if (overallEl) overallEl.textContent = overall.toFixed(1);
        if (overallPercent) overallPercent.textContent = (overall * 10).toFixed(0) + '%';

        if (overallGauge) {
            requestAnimationFrame(() => {
                overallGauge.style.width = (overall * 10) + '%';
            });
        }

        /* ---------------- 2. OVERALL DAVE PHRASE ---------------- */
        (() => {
            const phraseEl = document.getElementById("overallDavePhrase");
            if (phraseEl) {
                phraseEl.textContent = this.aiSummary
                    ? `“${this.aiSummary}”`
                    : "Analysis complete. Review the measured metrics below.";
            }
        })();

        /* ---------------- 3. SIX SMALL CARD SCORES ---------------- */
        const metrics = {
            peaksDips:   s.peaks_dips ?? 0,
            reflections: s.reflections ?? 0,
            bandwidth:   s.bandwidth ?? 0,
            balance:     s.balance ?? 0,
            smoothness:  s.smoothness ?? 0,
            clarity:     s.clarity ?? 0
        };

        for (const [key, val] of Object.entries(metrics)) {
            const scoreEl = document.getElementById(`${key}Score`);
            if (scoreEl) scoreEl.textContent = val.toFixed(1);

            const trackEl = document.getElementById(`${key}Track`);
            if (trackEl) {
                const percent = val * 10;
                trackEl.style.width = `${percent}%`;

                if (percent < 40) trackEl.style.background = 'var(--c-poor)';
                else if (percent > 75) trackEl.style.background = 'var(--c-excellent)';
                else trackEl.style.background = 'var(--c-accent)';
            }
        }

        /* ---------------- 4. META STATS GRID ---------------- */
        const metaSchroeder = document.getElementById('metaSchroeder');
        if (metaSchroeder) {
            const sch = data.room_context?.room?.schroeder_hz || data.room?.schroeder_hz;
            metaSchroeder.textContent = Number.isFinite(sch) ? `${Math.round(sch)} Hz` : "-- Hz";
        }

        const metaVolume = document.getElementById('metaVolume');
        if (metaVolume) {
            const vol = data.room_context?.room?.volume_m3 || data.room?.volume_m3;
            metaVolume.textContent = Number.isFinite(vol) ? `${vol} m³` : "-- m³";
        }

        const metaSmoothness = document.getElementById('metaSmoothness');
        if (metaSmoothness) {
            const dev = data.smoothness_std_db;
            metaSmoothness.textContent = Number.isFinite(dev) ? `± ${dev.toFixed(1)} dB` : "-- dB";
        }

        /* ---------------- 5. MEASURED ACOUSTIC REALITY (NEW CARD) ---------------- */
        const freqDevEl = document.getElementById('analysisFreqDeviation');
        const modeEl    = document.getElementById('analysisModalActivity');
        const reflEl    = document.getElementById('analysisReflections');
        const decayEl   = document.getElementById('analysisDecay');

        if (freqDevEl) {
            const dev = data.smoothness_std_db;
            freqDevEl.textContent = Number.isFinite(dev) ? `± ${dev.toFixed(1)} dB` : "—";
        }

        if (modeEl && Array.isArray(data.modes)) {
            modeEl.textContent = `${data.modes.length} modes`;
        }

        if (reflEl) {
            const r = s.reflections;
            reflEl.textContent = Number.isFinite(r) ? `${r.toFixed(1)} / 10` : "—";
        }

        if (decayEl) {
            const d = s.smoothness;
            decayEl.textContent = Number.isFinite(d) ? `${d.toFixed(1)} / 10` : "—";
        }

        /* ---------------- 6. DAVE PHRASES (SMALL CARDS) ---------------- */
        this.updateDescriptions(data);
    }

    updateAcousticReality() {
        const d = this.currentData;
        if (!d || !d.has_analysis) return;

        // --- Frequency deviation (measured flatness)
        const dev = d.smoothness_std_db;
        const freqEl = document.getElementById("analysisFreqDeviation");
        if (freqEl) {
            freqEl.textContent = Number.isFinite(dev)
                ? `± ${dev.toFixed(1)} dB`
                : "—";
        }

        // --- Modal activity (measured)
        const modeEl = document.getElementById("analysisModalActivity");
        if (modeEl && Array.isArray(d.modes)) {
            modeEl.textContent = `${d.modes.length} dominant modes`;
        }

        // --- Reflection score (measured)
        const reflEl = document.getElementById("analysisReflections");
        if (reflEl) {
            reflEl.textContent =
                Number.isFinite(d.scores?.reflections)
                    ? `${d.scores.reflections.toFixed(1)} / 10`
                    : "—";
        }

        // --- Decay / smoothness proxy
        const decayEl = document.getElementById("analysisDecay");
        if (decayEl) {
            decayEl.textContent =
                Number.isFinite(d.scores?.smoothness)
                    ? `${d.scores.smoothness.toFixed(1)} / 10`
                    : "—";
        }
    }

   /* ============================================================
   METRIC META-DATA (Schroeder / Volume / Smoothness)
   ============================================================ */
    updateMetaStats(data) {
        // Volume & Schroeder usually come from the room context
        const metaSchroeder = document.getElementById('metaSchroeder');
        const metaVolume = document.getElementById('metaVolume');
        const metaSmoothness = document.getElementById('metaSmoothness');

        if (metaSchroeder && data.room?.schroeder_hz) {
            metaSchroeder.textContent = `${Math.round(data.room.schroeder_hz)} Hz`;
        }
        
        if (metaVolume && data.room?.volume_m3) {
            metaVolume.textContent = `${data.room.volume_m3} m³`;
        }

        if (metaSmoothness && data.smoothness_std_db) {
            // Show the raw standard deviation (e.g., ± 3.8 dB)
            metaSmoothness.textContent = `± ${data.smoothness_std_db.toFixed(1)} dB`;
        }
    }
    
    /* ============================================================
    CARD SUMMARIES + Dave PHRASES (SAFE, DOM-ALIGNED)
    ============================================================ */
    updateDescriptions(data) {

        if (!data) return;

        /* ------------------------------------------------------------
        Resolve speaker (optional tag use)
        ------------------------------------------------------------ */
        const spk =
            this.SPEAKERS_BY_KEY[data.room?.speaker_key] ||
            { friendly_name: "your speakers" };

        /* ------------------------------------------------------------
        Tag values for Dave phrase expansion
        ------------------------------------------------------------ */
        const tagMap = {
            room_width: data.room?.width_m ?? "--",
            room_length: data.room?.length_m ?? "--",
            listener_distance: data.room?.listener_front_m ?? "--",
            spk_distance: data.room?.spk_distance ?? "--",
            speaker_friendly_name: spk.friendly_name
        };

        const expandTags = (str) => {
            if (!str) return str;
            return Object.entries(tagMap).reduce(
                (out, [k, v]) =>
                    out.replace(new RegExp(`{{${k}}}`, "g"), v ?? ""),
                str
            );
        };

        /* ------------------------------------------------------------
        Metric → DOM target mapping (THIS MUST MATCH HTML)
        ------------------------------------------------------------ */
        const metricMap = {
            bandwidth:   "bandwidthDave",
            balance:     "balanceDave",
            smoothness:  "smoothnessDave",
            peaks_dips:  "peaksDipsDave",
            reflections: "reflectionsDave",
            clarity:     "clarityDave"
        };

        /* ------------------------------------------------------------
        Inject Dave phrases
        ------------------------------------------------------------ */
        for (const [metric, elId] of Object.entries(metricMap)) {
            const el = document.getElementById(elId);
            if (!el) continue;

            const phrases = window.daveCards?.[metric];
            if (!Array.isArray(phrases) || phrases.length === 0) {
                el.textContent = "";
                continue;
            }

            const phrase =
                phrases[Math.floor(Math.random() * phrases.length)];

            el.textContent = expandTags(phrase);
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

    async updateFrequencyChartMulti() {

        if (MEASURELY_MODE !== "web") {
            this.updateFrequencyChart();
            return;
        }

        const chartEl = document.getElementById('frequencyChart');
        if (!chartEl) return;

        // Fetch session list
        const all = CAPS.history
            ? await fetch('/api/sessions/all').then(r => r.json())
            : [];


        const extractNum = (id) => {
            const m = String(id).match(/(\d+)(?!.*\d)/);
            return m ? parseInt(m[1], 10) : -1;
        };

        const sessions = all
            .slice()
            .sort((a, b) => extractNum(b.id) - extractNum(a.id))
            .filter(s => !(extractNum(s.id) === 0 && all.length > 1))
            .slice(0, 4);

        const traces = [];

        for (const index of this.activeChartSessions) {
            const meta = sessions[index];
            if (!meta) continue;

            try {
                const curve = await fetch(
                    `/api/session/${meta.id}/report_curve`
                ).then(r => r.json());

                traces.push({
                    x: curve.freqs,
                    y: curve.mag,
                    type: 'scatter',
                    mode: 'lines',
                    name: meta.id,
                    line: {
                        width: 2.5
                    }
                });

            } catch (err) {
                console.warn("Curve load failed:", meta.id);
            }
        }

        const layout = {
            xaxis: {
                title: 'Level (dB)',
                type: 'log',
                range: [Math.log10(20), Math.log10(20000)],
                tickvals: [20,50,100,200,500,1000,2000,5000,10000,20000],
                ticktext: ['20','50','100','200','500','1k','2k','5k','10k','20k'],
                gridcolor: 'rgba(255,255,255,0.04)',
                linecolor: '#9ca3af'
            },
            yaxis: {
                title: 'Frequency (Hz)',
                gridcolor: 'rgba(255,255,255,0.06)',
                zerolinecolor: 'rgba(255,255,255,0.25)'
            },
            showlegend: true,
            plot_bgcolor: '#1f2937',
            paper_bgcolor: 'transparent',
            margin: { t: 16, r: 20, b: 45, l: 56 }
        };

        Plotly.react('frequencyChart', traces, layout, {
            staticPlot: true,
            displayModeBar: false,
            responsive: true
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
        if (MEASURELY_MODE !== "web") return; 

        try {
            console.log(`📦 Loading session index: ${n}`);


            // Fetch all uploads
            const all = CAPS.history
                ? await fetch('/api/sessions/all').then(r => r.json())
                : [];

            const extractNum = (val) => {
                const m = String(val).match(/(\d+)(?!.*\d)/);
                return m ? parseInt(m[1], 10) : 0;
            };

            // Order newest → oldest & REMOVE upload0 if others exist
            const sorted = all
                .slice()
                .sort((a, b) => extractNum(b.id) - extractNum(a.id))
                .filter((s) => !(extractNum(s.id) === 0 && all.length > 1));

            console.warn("🔹 upload ORDER:", sorted.map(s => s.id));

            if (!sorted.length) return this.showError("No uploads found");
            if (n >= sorted.length) return this.showError("Not enough uploads");

            const sessionId = sorted[n].id;
            console.log(`📂 Fetching upload → ${sessionId}`);

            const data = await fetch(`/api/session/${encodeURIComponent(sessionId)}`)
                .then(r => r.json());

            if (!data || data.error) {
                console.error("❌ Invalid upload:", data);
                return this.showError("upload load failed");
            }

            this.currentData = data; // required for notes save
            this.updateFrequencyChartMulti();

            // Restore saved note to modal
            const note = (data.analysis_notes?.[0] || data.notes || "").trim();
            const textarea = document.getElementById("notesTextarea");
            if (textarea) {
                textarea.value = note;
                textarea.style.opacity = note ? "1" : "0.3";
                console.log(`📝 Restored note for ${sessionId}:`, note);
            }

            await this.loadHistory();

            // Highlight correct button
            const btns = document.querySelectorAll("#uploadsNav button");
            btns.forEach(b => b.classList.remove("session-active"));
            if (btns[n]) btns[n].classList.add("session-active");

            const tag = ["Latest", "Previous", "Earlier", "Oldest"][n] || "upload";
            this.showSuccess(`Loaded ${tag}`);

        } catch (err) {
            console.error("❌ loadNthSession error:", err);
            this.showError("Error loading upload");
        }
    }


    /* ============================================================
    EVENT LISTENERS — SAFE ON ALL PAGES
    ============================================================ */
    setupEventListeners() {

        if (!CAPS.notes) {
            document.querySelectorAll('[data-sweep-note]').forEach(b => b.remove());
        }

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


        safe('downloadReportBtn', () => this.exportReport());


        safe('saveNotesBtn', async () => {

            if (!CAPS.notes) return;

            const textarea = document.getElementById("notesTextarea");
            const note = textarea ? textarea.value.trim() : "";

            // Determine correct upload ID from currently displayed session
            const uploadId = this.currentData?.id;
            if (!uploadId || uploadId === "latest") {
                console.error("❌ Cannot resolve real upload ID from currentData.id:", this.currentData?.id);
                this.showError("Cannot save note – invalid upload ID");
                return;
            }

            console.log(`💾 Saving note for ${uploadId}:`, note);

            await this.saveNote(uploadId, note);

            // Update preview on the correct upload card
            document.querySelectorAll(".uploads-card").forEach(card => {
                if (card.dataset.uploadId === uploadId) {
                    const preview = card.querySelector("[data-note-preview]");
                    if (preview) preview.textContent = note || "—";
                }
            });

            if (typeof closeNotesModal === "function") {
                closeNotesModal();
            }

            this.showSuccess("Note saved!");
        });


        const nav = document.getElementById(UI.navId)
        || document.getElementById("uploadsNav")
        || document.getElementById("sweepsNav");

        if (nav) {
        nav.querySelectorAll(".session-btn").forEach(btn => {
            const index =
            Number(btn.dataset.uploads ?? btn.dataset.sweeps ?? btn.dataset.session ?? 0);

            btn.addEventListener("click", () => {
            // Toggle ON
            if (!this.activeChartSessions.has(index)) {
                this.activeChartSessions.add(index);
                btn.classList.add("session-active");
            } else {
                // Toggle OFF (but never allow all off)
                if (this.activeChartSessions.size === 1) return;
                this.activeChartSessions.delete(index);
                btn.classList.remove("session-active");
            }

            this.updateFrequencyChartMulti();
            });
        });
        }

       
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

function showSweepProgress() {
    const modal   = document.getElementById("sweepProgressModal");
    const fill    = document.getElementById("sweepProgressFill");
    const percent = document.getElementById("sweepPercent");
    const stage   = document.getElementById("sweepStageText");

    if (!modal || !fill || !percent || !stage) {
        console.error("[SweepUI] Required progress elements missing");
        return null;
    }

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");

    const steps = [
        { msg: "Preparing measurement system…", pct: 10 },
        { msg: "Running sweep (left channel)…", pct: 30 },
        { msg: "Running sweep (right channel)…", pct: 55 },
        { msg: "Capturing impulse response…", pct: 70 },
        { msg: "Analysing room response…", pct: 85 },
        { msg: "Finalising results…", pct: 95 }
    ];

    let i = 0;
    fill.style.width = "0%";
    percent.textContent = "0%";
    stage.textContent = steps[0].msg;

    const interval = setInterval(() => {
        if (i >= steps.length) {
            clearInterval(interval);
            return;
        }

        stage.textContent = steps[i].msg;
        fill.style.width = `${steps[i].pct}%`;
        percent.textContent = `${steps[i].pct}%`;
        i++;
    }, 1000);

    return () => {
        clearInterval(interval);
        fill.style.width = "100%";
        percent.textContent = "100%";
        stage.textContent = "Complete";

        setTimeout(() => {
            modal.classList.add("hidden");
            modal.setAttribute("aria-hidden", "true");
        }, 600);
    };
}

