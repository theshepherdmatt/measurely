// =====================================================
// FINAL ANALYSIS — HARD FACTS → EXPLANATION
// =====================================================

console.log("🧠 final-analysis.js loaded");

window.renderFinalAnalysis = function (data, decisions) {
    console.group("🧠 Final Analysis Renderer");

    if (!data || !decisions) {
        console.warn("❌ Missing analysis or decision data");
        console.groupEnd();
        return;
    }

    console.log("Analysis data:", data);
    console.log("Decision data:", decisions);

    // 🔹 NEW: render room plan (2D)
    if (window.renderRoomPlan2D && data.room) {
        try {
                window.renderRoomPlan2D({
                    mountId: "roomPlan2D",
                    roomData: data.room,
                    mode: "final"
                });
        } catch (e) {
            console.warn("⚠️ RoomPlan2D render failed", e);
        }
    }

    renderWhyThisScore(data);
    renderPrimaryLimiter(decisions);
    renderConfidence(decisions);

    console.groupEnd();
};


// -----------------------------------------------------
// WHY THIS ROOM MEASURES THIS WAY
// -----------------------------------------------------
function renderWhyThisScore(data) {
    const summaryEl = document.getElementById("finalAnalysisSummary");
    const listEl = document.getElementById("finalAnalysisReasons");

    if (!summaryEl || !listEl) return;

    listEl.innerHTML = "";

    const reasons = [];
    const ctx = data.room_context || {};

    // Room geometry
    const geom = ctx.geometry;
    if (geom?.schroeder_hz && geom.schroeder_hz > 250) {
        reasons.push(
            `A high Schroeder frequency (${Math.round(geom.schroeder_hz)} Hz) means room modes dominate much of the bass region.`
        );
    }

    // Listening triangle
    const triangle = ctx.triangle;
    if (triangle && triangle.ideal === false && typeof triangle.ratio === "number") {
        reasons.push(
            `Listening triangle ratio (${triangle.ratio.toFixed(2)}) deviates from ideal, affecting stereo focus and imaging.`
        );
    }

    // Speaker-boundary interference
    const sbir = ctx.sbir;
    if (sbir?.distance_m !== undefined && sbir.distance_m < 0.4) {
        reasons.push(
            `Speakers are positioned close to the front wall (${sbir.distance_m.toFixed(2)} m), increasing SBIR cancellations.`
        );
    }

    // Room modes
    const modes = ctx.modes;
    if (Array.isArray(modes) && modes.length >= 6) {
        reasons.push(
            `${modes.length} axial room modes detected at low frequencies, contributing to peaks and dips.`
        );
    }

    if (reasons.length === 0) {
        reasons.push(
            "No dominant physical issues are indicated by room geometry alone."
        );
    }

    summaryEl.textContent =
        "These results are primarily driven by room geometry and speaker placement rather than electronics or EQ.";

    reasons.forEach(text => {
        const li = document.createElement("li");
        li.textContent = text;
        listEl.appendChild(li);
    });
}

// -----------------------------------------------------
// PRIMARY LIMITING FACTOR
// -----------------------------------------------------
function renderPrimaryLimiter(decisions) {
    const el = document.getElementById("primaryLimiterText");
    if (!el) return;

    const limiter = decisions.primary_limiter;

    if (!limiter || !limiter.type) {
        el.textContent =
            "No single dominant limiting factor could be identified.";
        return;
    }

    if (limiter.type === "measurement_confidence") {
        el.textContent =
            "Measurement confidence limits how strongly conclusions can be drawn from this sweep.";
        return;
    }

    el.textContent =
        "A dominant physical limiting factor was identified, but does not clearly outweigh other influences.";
}

// -----------------------------------------------------
// CONFIDENCE & STABILITY
// -----------------------------------------------------
function renderConfidence(decisions) {
    const scoreEl = document.getElementById("analysisConfidenceScore");
    const stabEl  = document.getElementById("analysisStability");

    if (!scoreEl || !stabEl) return;

    const gate = decisions.meta?.confidence_gate;
    const stability = decisions.stability;

    scoreEl.textContent = gate
        ? `${gate.score} / 100 (${gate.class})`
        : "—";

    stabEl.textContent = stability
        ? `${stability.class} (${stability.index})`
        : "—";
}
