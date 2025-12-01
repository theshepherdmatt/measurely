/**
 * MEASURELY – 4-SWEEP HISTORY (ALIGNED + TITLES)
 * ----------------------------------------------
 * Clean layout, aligned rows, fixed column heights.
 */

const fetchJSON = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
    return res.json();
};

class SweepHistory {
    constructor() {
        this.container = document.getElementById("sweepHistorySection");
        if (!this.container) return;
        this.sweeps = [];
        this.currentSweepId = null;
        this.init();
    }

    async init() {
        let sessions = [];
        try {
            sessions = await fetchJSON("/api/sessions/all");
        } catch {
            return this.renderEmpty();
        }

        const recent = Array.isArray(sessions) ? sessions.slice(0, 4) : [];

        const data = [];
        for (const s of recent) {
            try {
                const d = await fetchJSON(`/api/session/${encodeURIComponent(s.id)}`);
                data.push(this.mapSession(d));
            } catch {}
        }

        this.sweeps = data;
        this.render();
        this.attachEvents();
    }

    mapSession(s) {
        return {
            id: s.id,
            overall: s.overall_score ?? s.overall ?? 0,
            peaks: s.peaks_dips ?? 0,
            reflections: s.reflections ?? 0,
            bandwidth: s.bandwidth ?? 0,
            balance: s.balance ?? 0,
            smoothness: s.smoothness ?? 0,
            reverb: s.reverb ?? 0,
            notes: s.notes ?? ""
        };
    }

    renderEmpty() {
        this.container.innerHTML = `<p style="color:var(--c-text-muted);padding:1rem;">No sweep history available.</p>`;
    }

    render() {
        if (!this.sweeps.length) return this.renderEmpty();

        this.container.innerHTML = `
        <h3 class="sweep-history-title">Sweep History</h3>
        <p class="sweep-history-subtitle">Compare your last four sweeps at a glance</p>

        <div class="sweep-history-grid-clean">
            ${this.sweeps.map((s, i) => this.renderSweepColumn(s, i)).join("")}
        </div>

        ${this.renderNotesModal()}
        `;

        this.injectStyles();
    }

    renderSweepColumn(s, i) {
        const label = `Sweep ${i + 1}`;

        return `
        <div class="sweep-col" data-sweep-id="${s.id}">
            <h4 class="sweep-col-title">${label}</h4>

            <div class="overall-card-clean row">
                <div class="overall-score">${s.overall.toFixed(1)}</div>
                <div class="overall-label">Overall</div>
            </div>

            <div class="metrics-list row">
                <div class="metric-row"><span>Peaks & Dips</span><span>${s.peaks.toFixed(1)}</span></div>
                <div class="metric-row"><span>Reflections</span><span>${s.reflections.toFixed(1)}</span></div>
                <div class="metric-row"><span>Bandwidth</span><span>${s.bandwidth.toFixed(1)}</span></div>
                <div class="metric-row"><span>Balance</span><span>${s.balance.toFixed(1)}</span></div>
                <div class="metric-row"><span>Smoothness</span><span>${s.smoothness.toFixed(1)}</span></div>
                <div class="metric-row"><span>Reverb</span><span>${s.reverb.toFixed(1)}</span></div>
            </div>

            <div class="notes-wrapper row">
                <button class="notes-btn" data-sweep-id="${s.id}">Notes</button>
                <div class="notes-preview" id="notes-preview-${s.id}">
                    ${s.notes ? this.escape(s.notes) : ""}
                </div>
            </div>
        </div>`;
    }

    renderNotesModal() {
        return `
        <div id="notesModal" class="notes-modal" style="display:none;">
            <div class="notes-backdrop"></div>
            <div class="notes-window">
                <div class="notes-header">
                    <h3>Edit Notes</h3>
                    <button id="notesClose" class="notes-close">×</button>
                </div>
                <textarea id="notesTextarea" class="notes-textarea" rows="4"></textarea>
                <div class="notes-footer">
                    <button id="notesCancel" class="notes-cancel">Cancel</button>
                    <button id="notesSave" class="notes-save">Save</button>
                </div>
            </div>
        </div>`;
    }

    attachEvents() {
        document.querySelectorAll(".notes-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                this.currentSweepId = btn.dataset.sweepId;
                const sweep = this.sweeps.find(s => s.id === this.currentSweepId);
                document.getElementById("notesTextarea").value = sweep.notes ?? "";
                document.getElementById("notesModal").style.display = "flex";
            });
        });

        document.getElementById("notesClose").onclick = () => this.closeModal();
        document.getElementById("notesCancel").onclick = () => this.closeModal();
        document.querySelector(".notes-backdrop").onclick = () => this.closeModal();
        document.getElementById("notesSave").onclick = () => this.saveNotes();
    }

    closeModal() {
        document.getElementById("notesModal").style.display = "none";
    }

    saveNotes() {
        const text = document.getElementById("notesTextarea").value.trim();
        const sweep = this.sweeps.find(s => s.id === this.currentSweepId);
        sweep.notes = text;

        document.getElementById(`notes-preview-${sweep.id}`).innerHTML = text ? this.escape(text) : "";

        this.closeModal();
    }

    escape(str) {
        return str.replace(/[&<>"']/g, m => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[m]);
    }

    injectStyles() {
        if (document.getElementById("sweepHistoryCleanStyles")) return;

        const style = document.createElement("style");
        style.id = "sweepHistoryCleanStyles";
        style.textContent = `
        .sweep-history-title {
            font-size: 1.6rem;
            font-weight: 700;
            margin-bottom: 0.2rem;
        }

        .sweep-history-subtitle {
            opacity: 0.7;
            margin-bottom: 1rem;
        }

        .sweep-history-grid-clean {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 1.2rem;
        }

        .sweep-col {
            background: rgba(255,255,255,0.05);
            padding: 1rem;
            border-radius: 12px;
            display: flex;
            flex-direction: column;
            gap: 1.2rem;
        }

        .sweep-col-title {
            text-align: center;
            font-size: 1rem;
            opacity: 0.8;
            margin-bottom: -0.3rem;
        }

        .row {
            min-height: 120px; /* Forces alignment */
            display: flex;
            flex-direction: column;
            justify-content: center;
        }

        .overall-card-clean {
            background: rgba(255,255,255,0.08);
            padding: 1rem;
            border-radius: 10px;
            text-align: center;
        }

        .overall-score {
            font-size: 2rem;
            font-weight: 700;
        }

        .metrics-list {
            gap: 0.4rem;
        }

        .metric-row {
            display: flex;
            justify-content: space-between;
        }

        .notes-btn {
            background: rgba(255,255,255,0.12);
            padding: 0.6rem;
            border: none;
            border-radius: 8px;
            cursor: pointer;
        }

        .notes-preview {
            margin-top: 0.3rem;
            font-size: 0.8rem;
            opacity: 0.8;
            white-space: pre-wrap;
        }

        /* Modal */
        .notes-modal {
            position: fixed;
            inset: 0;
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 999;
        }

        .notes-backdrop {
            position: absolute;
            inset: 0;
            background: rgba(0,0,0,0.6);
        }

        .notes-window {
            background: rgba(20,20,30,0.95);
            padding: 1rem;
            border-radius: 10px;
            width: 90%;
            max-width: 380px;
            z-index: 1000;
        }
        `;
        document.head.appendChild(style);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("sweepHistorySection")) {
        window.sweepHistory = new SweepHistory();
    }
});
