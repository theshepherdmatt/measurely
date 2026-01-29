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

    // 🔧 NORMALISE ROOM SHAPE (onboarding vs analysis)
    const r = {
        length_m: room.length_m ?? room.length ?? null,
        width_m:  room.width_m  ?? room.width  ?? null,
        height_m: room.height_m ?? room.height ?? null,

        spk_spacing_m:    room.spk_spacing_m    ?? room.speakerSpacing   ?? null,
        spk_front_m:      room.spk_front_m      ?? room.speakerDistance  ?? null,
        listener_front_m: room.listener_front_m ?? room.seatingDistance  ?? null,

        toe_in_deg: room.toe_in_deg ?? null,
        tweeter_height_m: room.tweeter_height_m ?? null,

        speaker_type: room.speaker_type ?? null,
        subwoofer: room.subwoofer ?? null,

        opt_area_rug: room.opt_area_rug ?? null,
        opt_sofa: room.opt_sofa ?? null,
        opt_coffee_table: room.opt_coffee_table ?? null,
        wall_treatment: room.wall_treatment ?? null
    };

    const {
        length_m,
        width_m,
        height_m,
        spk_spacing_m,
        listener_front_m,
        toe_in_deg,
        tweeter_height_m,
        speaker_type,
        subwoofer,
        opt_area_rug,
        opt_sofa,
        opt_coffee_table,
        wall_treatment
    } = r;

    const measuredSBIR = room_context?.sbir ?? null;

    const hasGeometry =
        typeof length_m === "number" &&
        typeof width_m === "number" &&
        typeof height_m === "number";

    const volume_m3 = hasGeometry
        ? length_m * width_m * height_m
        : null;

    const schroeder_hz = volume_m3
        ? 2000 * Math.sqrt(0.161 / volume_m3)
        : null;

    return {
        room_geometry: hasGeometry
            ? {
                dimensions: `${length_m.toFixed(2)} × ${width_m.toFixed(2)} × ${height_m.toFixed(2)} m`,
                volume_m3: volume_m3.toFixed(1),
                schroeder_hz: Math.round(schroeder_hz)
            }
            : null,

        listening_geometry: {
            speaker_spacing_m: spk_spacing_m?.toFixed?.(2) ?? null,
            listener_distance_m: listener_front_m?.toFixed?.(2) ?? null,
            tweeter_height_m: tweeter_height_m?.toFixed?.(2) ?? null,
            toe_in_deg: toe_in_deg?.toFixed?.(1) ?? null
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


function addSweepLogLine(msg) {
    const panel = document.getElementById("sweepLogPanel");
    if (!panel) {
        console.warn("[SweepLog] sweepLogPanel not found");
        return;
    }

    const line = document.createElement("div");
    line.textContent = msg;
    panel.appendChild(line);

    // Auto-scroll to bottom
    panel.scrollTop = panel.scrollHeight;

    console.log("[SweepLog] UI +", msg);
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

function updateRoomInsightText(metric, data) {
    console.log("🧠 updateRoomInsightText called with:", metric, data);

  const el = document.getElementById("roomInsightText");
  if (!el) return;

  // If we don't recognise the metric, don't break anything — just clear.
  const supported = new Set(["sbir", "peaks_dips", "side_reflections", "bandwidth"]);
  if (!supported.has(metric)) {
    el.innerHTML = "";
    return;
  }

  // -----------------------------
  // SBIR (your existing logic)
  // -----------------------------
  if (metric === "sbir" || metric === "peaks_dips") {
    const sbir =
      data?.geom?.sbir ||
      data?.room_context?.sbir ||
      null;

    if (!sbir) {
      el.innerHTML = `
        <div class="insight-block">
          <h3>Peaks & Dips (SBIR)</h3>
          <p>Speaker boundary interaction analysis not available for this session.</p>
        </div>
      `;
      return;
    }

    const d = Number(sbir.distance_m);
    const f = Number(sbir.first_null_hz ?? sbir.nulls_hz?.[0]);

    if (!Number.isFinite(d) || !Number.isFinite(f)) {
      el.innerHTML = `<div class="insight-block"><p>SBIR data incomplete.</p></div>`;
      return;
    }

    el.innerHTML = `
      <div class="insight-block">
        <h3>Peaks & Dips (SBIR)</h3>

        <p><b>What’s happening:</b><br>
        Sound from your speakers reflects off the wall behind them and interferes with the direct sound.</p>

        <p><b>Measured speaker distance:</b> ${d.toFixed(2)} m</p>

        <p class="math">
          SBIR null frequency:<br>
          <code>f = c / (4d)</code><br>
          <code>f = 343 / (4 × ${d.toFixed(2)}) = ${Math.round(f)} Hz</code>
        </p>

        <p>This predicted cancellation aligns with the dip visible in your measurement.</p>
        <p>Moving the speakers changes this frequency — closer raises it, further lowers it.</p>
      </div>
    `;
    return;
  }

    // -----------------------------
    // SIDE REFLECTIONS
    // -----------------------------
    if (metric === "side_reflections") {

    const room = window.__MEASURELY_ROOM__;

    console.log("🔎 SIDE REFLECTION ROOM DATA:", room);

    if (!room) {
        el.innerHTML = `
        <div class="insight-block">
            <h3>Side Wall Reflections</h3>
            <p>Room geometry not available yet.</p>
        </div>
        `;
        return;
    }

    const c = 343;

    const spkSpacing = Number(room.spk_spacing_m);
    const spkFront   = Number(room.spk_front_m);
    const listener   = Number(room.listener_front_m);
    const width      = Number(room.width_m);

    if (![spkSpacing, spkFront, listener, width].every(Number.isFinite)) {
        el.innerHTML = `
        <div class="insight-block">
            <h3>Side Wall Reflections</h3>
            <p>Room values missing — can’t compute reflection delay.</p>
        </div>
        `;
        return;
    }

    const speakerX = spkSpacing / 2;
    const speakerZ = spkFront;
    const listenerX = 0;
    const listenerZ = listener;

    const direct = Math.hypot(listenerX - speakerX, listenerZ - speakerZ);

    const wallX = width / 2;
    const mirrorSpeakerX = wallX + (wallX - speakerX);

    const reflected = Math.hypot(listenerX - mirrorSpeakerX, listenerZ - speakerZ);

    const delta = reflected - direct;
    const delayMs = (delta / c) * 1000;

    el.innerHTML = `
        <div class="insight-block">
        <h3>Side Wall Reflections</h3>

        <p><b>What’s happening:</b><br>
        Sound reflects off the side walls and reaches you slightly after the direct sound.</p>

        <p class="math">
            Direct path: <code>${direct.toFixed(2)} m</code><br>
            Reflected path: <code>${reflected.toFixed(2)} m</code><br>
            Extra distance: <code>${delta.toFixed(2)} m</code><br>
            Delay: <code>${delayMs.toFixed(2)} ms</code>
        </p>

        <p>
            Reflections under ~5 ms are most likely to blur stereo focus.
        </p>
        </div>
    `;
    return;
    }

    // -----------------------------
    // BANDWIDTH (room LF support)
    // -----------------------------
    if (metric === "bandwidth") {

        console.log("🔥 BANDWIDTH BLOCK ENTERED");

        const room = window.__MEASURELY_ROOM__;
        console.log("🔎 ROOM FOR BANDWIDTH:", room);

        if (!room) {
            el.innerHTML = `
            <div class="insight-block">
                <h3>Low Frequency Bandwidth</h3>
                <p>Room geometry not available yet.</p>
            </div>
            `;
            return;
        }

        const L = Number(room.length_m);
        const W = Number(room.width_m);
        const H = Number(room.height_m);

        if (![L, W, H].every(Number.isFinite)) {
            el.innerHTML = `
            <div class="insight-block">
                <h3>Low Frequency Bandwidth</h3>
                <p>Room dimensions incomplete.</p>
            </div>
            `;
            return;
        }

        const c = 343;
        const longest = Math.max(L, W, H);
        const fLowest = c / (2 * longest);

        el.innerHTML = `
            <div class="insight-block">
            <h3>Low Frequency Bandwidth</h3>

            <p><b>What’s happening:</b><br>
            Your room size sets the lowest frequency the space can naturally support before strong modal behaviour dominates.</p>

            <p class="math">
                Largest dimension: <code>${longest.toFixed(2)} m</code><br>
                Lowest axial mode: <code>f = c / (2L) = ${Math.round(fLowest)} Hz</code>
            </p>

            <p>
                Below this frequency, bass becomes increasingly uneven because full wavelengths cannot properly develop inside the room.
            </p>
            </div>
        `;
        return;
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
        this.sessions = [];
        this.sessionOrder = [];
        this._lastLogCount = 0;
        this._lastStatusMessage = null;

        this.SPEAKERS_BY_KEY = {};

        this.init();
        
    }

    /* NEW unified scoring bucket */
    toBucket(score) {
        if (score >= 8) return 'excellent';
        if (score >= 6) return 'good';
        if (score >= 4) return 'okay';
        return 'needs_work';
    }


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
    HISTORY (uploads in web, sweeps in local)
    ============================================================ */
    async loadHistory() {

        console.group("📜 loadHistory()");
        console.log("CAPS.history =", CAPS.history);

        if (!CAPS.history) return;

        try {
            const history = await safeJson("/api/sweephistory");
            console.log("history raw =", history);
            console.log("history.sweeps =", history?.sweeps);

            const all = Array.isArray(history?.sweeps) ? history.sweeps : [];
            const cards = document.querySelectorAll(UI.historyCardSelector);

            console.log("Found history cards =", cards.length);

            // =====================================================
            // 🔗 HYDRATE SESSION MODEL (SINGLE SOURCE OF TRUTH)
            // =====================================================
            const extractNum = (id) => {
                const m = String(id).match(/(\d+)(?!.*\d)/);
                return m ? parseInt(m[1], 10) : -1;
            };

            this.sessions = all
                
                .filter(s =>
                    s.has_analysis === true ||
                    Number.isFinite(s.overall_score) ||
                    s.scores ||
                    s.analysis
                )


                .map(s => ({
                    id: s.id,
                    timestamp: s.timestamp,
                    overall: s.overall_score,
                    metrics: s.metrics || {
                        peaks_dips: s.peaks_dips,
                        reflections: s.reflections,
                        bandwidth: s.bandwidth,
                        balance: s.balance,
                        smoothness: s.smoothness,
                        clarity: s.clarity
                    },
                    note: s.note || ""
                }));

            this.sessionOrder = this.sessions
                .map(s => s.id)
                .sort((a, b) => extractNum(b) - extractNum(a));

            console.log("📦 Sessions hydrated:", this.sessionOrder);

            // =====================================================
            // EMPTY / RESET STATE
            // =====================================================
            if (this.sessions.length === 0) {
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

            // =====================================================
            // POPULATE HISTORY CARDS (NEWEST → OLDEST)
            // =====================================================
            const recent = this.sessions
                .slice()
                .sort((a, b) => extractNum(b.id) - extractNum(a.id))
                .slice(0, cards.length);

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
                        typeof meta.overall === "number"
                            ? meta.overall.toFixed(1)
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
                const previewEl = card.querySelector("[data-note-preview]");
                if (previewEl) {
                    previewEl.textContent = meta.note?.trim() || "—";
                    previewEl.style.opacity = meta.note?.trim() ? "1" : "0.3";
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

        // 🧠 Dave Phrase Engine
        this.dave = new window.DavePhraseEngine();
        await this.dave.load();


        // Load phrase bank + speaker metadata
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
            console.log("Analysis card clicked →", overlay);

            updateRoomInsightText(overlay, {
                room_context: this.currentData.room_context,
                geom: this.roomGeomAnalysis   // 🔥 add this
            });

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

        // 🔒 HARD GUARD — ignore cancelled / incomplete sweeps
        if (
            window.__IGNORE_LATEST_SWEEP__ ||
            !latest ||
            latest.has_analysis !== true
        ) {
            console.warn("⚠️ Ignoring incomplete / cancelled latest sweep");
            window.__IGNORE_LATEST_SWEEP__ = false;
            this.currentData = null;
            this.updateDashboard();
            return;
        }

        this.currentData = latest;
        this.aiSummary = latest.ai_summary || null;

        this.updateDashboard();
        return;
        }

        const extractNum = (id) =>
        parseInt(String(id).match(/(\d+)(?!.*\d)/)?.[1] || "-1", 10);

        const latestMeta = all.slice().sort((a, b) => extractNum(b.id) - extractNum(a.id))[0];
        const id = encodeURIComponent(latestMeta.id);

        const data = await safeJson(`/api/session/${id}`);
        const ai   = await safeJson(`/api/session/${id}/analysis_ai`);

        if (!data || !data.freq_hz || !data.mag_db) throw new Error("invalid session data");

        this.currentData = {
            ...data,
            room_context: ai?.room_context || null  // 🔥 flatten here
        };

        this.aiSummary = data.ai_summary || null;

        console.log("ROOM CONTEXT ATTACHED:", this.currentData.room_context);

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

        if (this.isSweepRunning) {
            console.warn("[Sweep] already running");
            this.showInfo("Sweep already running");
            return;
        }

        this.isSweepRunning = true;

        // ---- UI: open progress modal ----
        this._closeSweepProgress = null;

        try {
            if (window.showSweepProgress) {
                console.log("[SweepUI] Opening progress modal");
                this._sweepUI = showSweepProgress();

                // 🔥 Reset log tracking + clear panel
                this._lastLogCount = 0;

                const panel = document.getElementById("sweepLogPanel");
                if (panel) {
                    panel.innerHTML = "";
                    console.log("[SweepLog] Cleared previous logs");
                }

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

            try {
                const result = await response.json();
                console.log("[Sweep] response JSON:", result);
            } catch {
                console.warn("[Sweep] No JSON body (expected)");
            }

            console.log("[Sweep] Assuming sweep started");

            // ---- Start polling (modal will close from poller) ----
            this.monitorSweepProgress();

        } catch (err) {
            console.error("[Sweep] HARD FAILURE", err);

            if (this._sweepUI) {
                this._sweepUI.error("Sweep failed to start");
                this._sweepUI = null;
            }

            this.isSweepRunning = false;
            this.showError("Sweep failed to start");
        }
    }

    async fetchSweepLogs() {
        try {
            const res = await fetch('/api/sweep-logs');
            if (!res.ok) return [];
            return await res.json();
        } catch {
            return [];
        }
    }

    async monitorSweepProgress() {
        console.log("[SweepPoll] Polling /api/sweep-progress…");

        if (this.sweepCheckInterval) {
            clearInterval(this.sweepCheckInterval);
        }

        // 🔥 Reset log tracking for THIS sweep
        this._lastLogCount = 0;
        this._lastStatusMessage = null;

        this.sweepCheckInterval = setInterval(async () => {
            try {
                const res = await fetch('/api/sweep-progress');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                const prog = await res.json();

                // Show basic stage progress
                if (this._sweepUI) {
                    this._sweepUI.update(prog.progress, prog.message);
                }

                if (prog.message && prog.message !== this._lastStatusMessage) {
                    addSweepLogLine("[STATUS] " + prog.message);
                    this._lastStatusMessage = prog.message;
                }

                // 🔥 Pull real sweep logs
                console.log("[SweepLog] Fetching logs...");
                const logLines = await this.fetchSweepLogs();

                console.log("[SweepLog] Received", logLines.length, "lines");

                if (!Array.isArray(logLines)) {
                    console.warn("[SweepLog] Invalid log payload");
                    return;
                }

                // Only append new lines
                const newLines = logLines.slice(this._lastLogCount);

                if (newLines.length) {
                    console.log("[SweepLog] Writing", newLines.length, "new lines to modal");
                }

                newLines.forEach(line => addSweepLogLine(line));

                // Update cursor
                this._lastLogCount = logLines.length;

                if (!prog.running) {
                    clearInterval(this.sweepCheckInterval);
                    this.sweepCheckInterval = null;

                    // ❌ Detect backend-reported error
                    if (prog.message && prog.message.toLowerCase().includes("error")) {
                        addLog("Sweep failed — no analysis will be generated.");

                        if (this._sweepUI) {
                            this._sweepUI.error("Sweep failed");
                            this._sweepUI = null;
                        }

                        this.resetSweepState();
                        return; // 🚨 STOP — do NOT wait for analysis
                    }

                    // ✅ Normal successful sweep
                    addLog("Sweep complete — starting analysis…");

                    if (this._sweepUI) {
                        this._sweepUI.complete();
                    }

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

        const extractNum = (id) => {
            const m = String(id).match(/(\d+)(?!.*\d)/);
            return m ? parseInt(m[1], 10) : -1;
        };

        const checkLoop = setInterval(async () => {
            checks++;

            try {
                // 1️⃣ Get list of sessions
                const listRes = await fetch('/api/sessions/all');
                if (!listRes.ok) throw new Error(`HTTP ${listRes.status}`);

                const sessions = await listRes.json();
                if (!Array.isArray(sessions) || sessions.length === 0) return;

                // 2️⃣ Find newest session
                const latestMeta = sessions
                    .slice()
                    .sort((a, b) => extractNum(b.id) - extractNum(a.id))[0];

                if (!latestMeta) return;

                // 3️⃣ Fetch full analysis data for that session
                const dataRes = await fetch(`/api/session/${encodeURIComponent(latestMeta.id)}`);
                if (!dataRes.ok) return;

                const data = await dataRes.json();
                const score = Number(data.overall_score);

                // 4️⃣ Analysis is considered “ready” only when fully scored
                if (data.has_analysis && Number.isFinite(score) && score > 0) {
                    clearInterval(checkLoop);

                    addLog("Analysis ready — displaying results…");

                    if (this._sweepUI) {
                        this._sweepUI.showAnalysis(data);
                    }

                    this.currentData = data;
                    this.updateDashboard();

                    // 🔥 Switch UI to dashboard view
                    if (typeof window.showDashboard === "function") {
                        window.showDashboard();
                    } else {
                        // Fallback if you're using page anchors or sections
                        window.location.hash = "#dashboard";
                    }

                    setTimeout(() => {
                        if (this._sweepUI) {
                            this._sweepUI.close();
                            this._sweepUI = null;
                        }
                        this.resetSweepState();
                    }, 4000); // keep modal open 4s so user sees data

                    return;
                }

            } catch (err) {
                console.warn("analysis poll failed:", err);
            }

            // ⏳ Timeout fallback
            if (checks >= maxChecks) {
                clearInterval(checkLoop);

                addLog("Analysis timeout — showing latest available data.");

                await this.loadData();
                this.updateDashboard();
                this.resetSweepState();
            }

        }, checkInterval);
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

        console.log("ROOM CONTEXT:", this.currentData.room_context);

        // 🧠 NEW: Room geometry analysis (pre-measurement facts)
        if (this.currentData.room) {
            this.roomGeomAnalysis = buildRoomGeometryAnalysis(
                this.currentData.room,
                this.currentData.room_context
            );

            renderRoomAnalysisCards(this.roomGeomAnalysis);
            console.log("GEOM SBIR:", this.roomGeomAnalysis.sbir);

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
            const el = document.getElementById("overallDavePhrase");
            if (!el) return;

            const score = Number(s.overall ?? data.overall_score ?? 5);
            const phrase = this.dave.overall(score);

            el.textContent = phrase || "Analysis complete. Review the measured metrics below.";
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
        const speakerType =
            data.room?.speaker_type === "standmount"     ? "standmount speakers" :
            data.room?.speaker_type === "floorstander"   ? "floorstanding speakers" :
            data.room?.speaker_type === "electrostatic"  ? "electrostatic speakers" :
            "your speakers";

        /* ------------------------------------------------------------
        Tag values for Dave phrase expansion
        ------------------------------------------------------------ */
        const tagMap = {
            room_width: data.room?.width_m ?? "--",
            room_length: data.room?.length_m ?? "--",
            listener_distance: data.room?.listener_front_m ?? "--",
            spk_distance: data.room?.spk_front_m ?? "--",
            speaker_friendly_name: speakerType
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

            const score = Number(data.scores?.[metric] ?? 5);
            const phrase = this.dave.category(metric, score);
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

        const chartEl = document.getElementById("frequencyChart");
        if (!chartEl) return;

        // Fetch sessions (newest → oldest)
        const all = CAPS.history
            ? await fetch("/api/sessions/all").then(r => r.json())
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

        const LABELS  = ["Latest", "Previous", "Earlier", "Oldest"];
        const COLOURS = ["#3b82f6", "#a855f7", "#22c55e", "#f59e0b"];

        const traces = [];

        // Build traces in fixed order, Set only controls visibility
        for (let i = 0; i < sessions.length; i++) {

            if (!this.activeChartSessions.has(i)) continue;

            const meta = sessions[i];
            if (!meta) continue;

            try {
                const curve = await fetch(
                    `/api/session/${meta.id}/report_curve`
                ).then(r => r.json());

                traces.push({
                    x: curve.freqs,
                    y: curve.mag,
                    type: "scatter",
                    mode: "lines",
                    name: LABELS[i],
                    line: {
                        width: 2.5,
                        color: COLOURS[i],
                        shape: "spline",
                        smoothing: 0.6
                    },
                    hoverinfo: "skip"
                });

            } catch {
                console.warn("Curve load failed:", meta.id);
            }
        }

        const layout = {
            xaxis: {
                title: "Frequency (Hz)",
                type: "log",
                range: [Math.log10(20), Math.log10(20000)],
                tickvals: [20,50,100,200,500,1000,2000,5000,10000,20000],
                ticktext: ["20","50","100","200","500","1k","2k","5k","10k","20k"],
                ticks: "outside",
                showline: true,
                linewidth: 1,
                linecolor: "#9ca3af",
                showgrid: true,
                gridcolor: "rgba(255,255,255,0.025)",
                zeroline: false,
                tickfont: {
                    size: 11,
                    color: "rgba(255,255,255,0.6)"
                }
            },

            yaxis: {
                title: "Level (dB)",
                ticks: "outside",
                showline: true,
                linewidth: 1,
                linecolor: "#9ca3af",
                showgrid: true,
                gridcolor: "rgba(255,255,255,0.03)",
                zeroline: false,
                tickfont: {
                    size: 11,
                    color: "rgba(255,255,255,0.6)"
                }
            },

            showlegend: true,

            legend: {
                orientation: "h",
                x: 0.5,
                xanchor: "center",
                y: -0.24,
                yanchor: "top",
                font: {
                    size: 10,
                    color: "rgba(255,255,255,0.55)"
                }
            },

            plot_bgcolor: "#1f2937",
            paper_bgcolor: "transparent",

            margin: {
                t: 16,
                r: 20,
                b: 90,
                l: 56
            }
        };

        Plotly.react("frequencyChart", traces, layout, {
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
        // always allow loading sessions
 
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

        const safe = (id, handler) => {
            const el = document.getElementById(id);
            if (!el) {
                console.warn(`[WARN] Missing element for listener: ${id}`);
                return;
            }
            el.addEventListener('click', handler);
        };


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
    console.log("[SweepUI] showSweepProgress() called");

    const modal   = document.getElementById("sweepProgressModal");
    const fill    = document.getElementById("sweepProgressFill");
    const percent = document.getElementById("sweepPercent");
    const stage   = document.getElementById("sweepStageText");

    console.log("[SweepUI] Elements found:", {
        modal: !!modal,
        fill: !!fill,
        percent: !!percent,
        stage: !!stage
    });

    if (!modal || !fill || !percent || !stage) {
        console.error("[SweepUI] ❌ Required progress elements missing");
        return null;
    }

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    console.log("[SweepUI] ✅ Modal opened");

    fill.style.width = "0%";
    percent.textContent = "0%";
    stage.textContent = "Starting measurement…";

    return {
        update(progress, message) {
            console.log("[SweepUI] update()", { progress, message });

            if (typeof progress === "number") {
                const p = Math.max(0, Math.min(100, progress));
                fill.style.width = `${p}%`;
                percent.textContent = `${p}%`;
            }

            if (message) {
                stage.textContent = message;
            }
        },

        complete() {
            console.log("[SweepUI] Sweep finished — waiting for analysis");

            fill.style.width = "100%";
            percent.textContent = "100%";
            stage.textContent = "Finalising analysis…";

        },
        
        showAnalysis(data) {
            console.log("[SweepUI] Showing analysis data in modal", data);

            const logPanel = document.getElementById("sweepLogPanel");
            if (!logPanel) return;

            const a = data.analysis || data;

            logPanel.innerHTML += `
        <hr style="opacity:0.2;margin:10px 0;">
        <b>Analysis Summary</b>

        SNR: ${a.signal?.snr_db?.toFixed(2)} dB  
        Peak Level: ${a.signal?.peak?.toFixed(4)}

        Bandwidth: ${a.bandwidth?.low_hz?.toFixed(1)} – ${a.bandwidth?.high_hz?.toFixed(1)} Hz  
        Balance Spread: ${a.balance?.spread_db?.toFixed(2)} dB  
        Smoothness σ: ${a.smoothness?.std_db?.toFixed(2)}

        Modes Found: ${a.modes?.length || 0}  
        First Reflection: ${a.reflections?.first_ms?.toFixed(2)} ms  

        Schroeder: ${a.acoustics?.schroeder_hz?.toFixed(1)} Hz  
        SBIR Nulls: ${a.acoustics?.sbir_nulls?.map(n=>n.toFixed(1)).join(", ")}
        `;

            stage.textContent = "Analysis complete";
        },


        close() {
            console.log("[SweepUI] Closing modal after analysis");
            modal.classList.add("hidden");
            modal.setAttribute("aria-hidden", "true");
        },

        error(msg = "Sweep failed") {
            console.log("[SweepUI] error()", msg);
            stage.textContent = msg;
            fill.style.width = "100%";
            percent.textContent = "!";
        }
    };
}
