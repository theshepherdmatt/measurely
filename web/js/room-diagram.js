/**
 * Room Diagram – Clean Rebuild
 * Fully rewritten according to MD spec
 * Scales correctly, centres correctly, no flashing, predictable maths
 * Extended viewBox to allow toe-in lines to extend beyond listening position
 */

class RoomDiagram {

    constructor() {
        this.SVG_W = 600;
        this.SVG_H = 450;

        this.ROOM_MAX_W = this.SVG_W * 1.7;
        this.ROOM_MAX_H = this.SVG_H * 1.2;

        this.bindListeners();
        this.update();
    }

    bindListeners() {
        const ids = [
            "room-width", "room-length",
            "speaker-distance", "speaker-width",
            "listening-distance", "toe-angle"
        ];

        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener("input", () => this.update());
            el.addEventListener("change", () => this.update());
        });
    }

    get() {
        return {
            width: parseFloat(document.getElementById("room-width")?.value) || 4,
            length: parseFloat(document.getElementById("room-length")?.value) || 5,
            distFront: parseFloat(document.getElementById("speaker-distance")?.value) || 0.6,
            spacing: parseFloat(document.getElementById("speaker-width")?.value) || 2,
            listenDist: parseFloat(document.getElementById("listening-distance")?.value) || 2.5,
            //toe: parseFloat(document.getElementById("toe-angle")?.value) || 0
        };
    }

    update() {
        const v = this.get();

        // ---- SCALE ROOM ----
        const scaleX = this.ROOM_MAX_W / v.width;
        const scaleY = this.ROOM_MAX_H / v.length;
        const scale = Math.min(scaleX, scaleY);

        const drawW = v.width * scale;
        const drawH = v.length * scale;

        const roomX = (this.SVG_W - drawW) / 2;
        const roomY = (this.SVG_H - drawH) / 2;

        // ---- EXPAND SVG VIEWBOX TO ALLOW LONGER LINES ----
        const svg = document.getElementById("room-diagram");
        svg.setAttribute("viewBox", "-100 -100 800 650");  // Extended viewBox

        // ---- ROOM RECT ----
        const r = document.getElementById("room-rect");
        r.setAttribute("x", roomX);
        r.setAttribute("y", roomY);
        r.setAttribute("width", drawW);
        r.setAttribute("height", drawH);

        // ---- SPEAKERS ----
        const centerX = this.SVG_W / 2;
        const spacingSVG = v.spacing * scale;

        const leftX = centerX - spacingSVG / 2 - 16;
        const rightX = centerX + spacingSVG / 2 - 16;

        const frontY = roomY + v.distFront * scale - 16;  // offset so icons sit correctly

        const L = document.getElementById("left-speaker");
        const R = document.getElementById("right-speaker");

        L.setAttribute("x", leftX);
        L.setAttribute("y", frontY);

        R.setAttribute("x", rightX);
        R.setAttribute("y", frontY);

        // ---- LISTENING POSITION ----
        const listenY = roomY + (v.distFront + v.listenDist) * scale;

        const sofa = document.getElementById("sofa-icon");
        sofa.setAttribute("x", centerX - 50);
        sofa.setAttribute("y", listenY - 30);

        const label = document.getElementById("listening-pos-label");
        label.setAttribute("x", centerX);
        label.setAttribute("y", listenY + 45);

        // ---- TOE-IN LINES ----
        // Lines converge at listening position and extend beyond it
        const listeningCenterX = centerX;
        const listeningCenterY = listenY;

        const lx1 = leftX + 16;  // center of left speaker
        const ly1 = frontY + 16;

        const rx1 = rightX + 16;  // center of right speaker
        const ry1 = frontY + 16;

        // Calculate direction from speaker to listening position
        const leftDx = listeningCenterX - lx1;
        const leftDy = listeningCenterY - ly1;
        const leftDist = Math.sqrt(leftDx * leftDx + leftDy * leftDy);

        const rightDx = listeningCenterX - rx1;
        const rightDy = listeningCenterY - ry1;
        const rightDist = Math.sqrt(rightDx * rightDx + rightDy * rightDy);

        // Extend lines significantly beyond listening position
        const extendFactor = 1;

        const lx2 = lx1 + (leftDx / leftDist) * leftDist * extendFactor;
        const ly2 = ly1 + (leftDy / leftDist) * leftDist * extendFactor;

        const rx2 = rx1 + (rightDx / rightDist) * rightDist * extendFactor;
        const ry2 = ry1 + (rightDy / rightDist) * rightDist * extendFactor;

        const LT = document.getElementById("left-toe-line");
        const RT = document.getElementById("right-toe-line");

        LT.setAttribute("x1", lx1);
        LT.setAttribute("y1", ly1);
        LT.setAttribute("x2", lx2);
        LT.setAttribute("y2", ly2);

        RT.setAttribute("x1", rx1);
        RT.setAttribute("y1", ry1);
        RT.setAttribute("x2", rx2);
        RT.setAttribute("y2", ry2);

        // ---- CALCULATE IDEAL TOE-IN ----
        const actualToeRad = Math.atan((v.spacing / 2) / v.listenDist);
        const actualToe = actualToeRad * (180 / Math.PI);
        const idealToe = actualToe;

        // ---- UPDATE EXPLAINER ----
        this.setExplainer(v, idealToe);
    }

    setExplainer(v, idealToe) {
        // Update explainer values
        this.set("explainer-width", v.width.toFixed(2));
        this.set("explainer-length", v.length.toFixed(2));
        this.set("explainer-spacing", v.spacing.toFixed(2));
        this.set("explainer-listen", v.listenDist.toFixed(2));
        this.set("explainer-ideal-toe", idealToe.toFixed(1));

        // Generate reason based on current vs ideal toe-in
    }

    set(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }
}

// init
document.addEventListener("DOMContentLoaded", () => new RoomDiagram());
