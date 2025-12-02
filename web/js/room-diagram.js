/**
 * ROOM DIAGRAM — FULL PREMIUM REBUILD (VALID JS VERSION)
 */

class RoomDiagram {

    constructor() {
        this.SVG_W = 600;
        this.SVG_H = 450;

        this.ROOM_MAX_W = this.SVG_W * 1.65;
        this.ROOM_MAX_H = this.SVG_H * 1.20;

        this.SPK_SIZE = 54;
        this.SOFA_W = 150;
        this.SOFA_H = 90;

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
            width:      parseFloat(document.getElementById("room-width").value)         || 4,
            length:     parseFloat(document.getElementById("room-length").value)        || 5,
            distFront:  parseFloat(document.getElementById("speaker-distance").value)   || 0.6,
            spacing:    parseFloat(document.getElementById("speaker-width").value)      || 2,
            listenDist: parseFloat(document.getElementById("listening-distance").value) || 2.5
        };
    }

    update() {
        const v = this.get();

        const scaleX = this.ROOM_MAX_W / v.width;
        const scaleY = this.ROOM_MAX_H / v.length;
        const scale  = Math.min(scaleX, scaleY);

        const drawW  = v.width  * scale;
        const drawH  = v.length * scale;

        const roomX = (this.SVG_W - drawW) / 2;
        const roomY = (this.SVG_H - drawH) / 2;

        // VIEWBOX
        const svg = document.getElementById("room-diagram");
        svg.setAttribute("viewBox", "-70 -70 740 560");

        // ROOM RECT
        const r = document.getElementById("room-rect");
        r.setAttribute("x", roomX);
        r.setAttribute("y", roomY);
        r.setAttribute("width",  drawW);
        r.setAttribute("height", drawH);

        // SPEAKER POSITIONS
        const centerX = this.SVG_W / 2;
        const spacingSVG = v.spacing * scale;

        const leftX  = centerX - spacingSVG / 2 - this.SPK_SIZE/2;
        const rightX = centerX + spacingSVG / 2 - this.SPK_SIZE/2;

        const frontY = roomY + v.distFront * scale - this.SPK_SIZE/2;

        const LS = document.getElementById("left-speaker");
        const RS = document.getElementById("right-speaker");

        LS.setAttribute("x", leftX);
        LS.setAttribute("y", frontY);

        RS.setAttribute("x", rightX);
        RS.setAttribute("y", frontY);

        // LISTENING POSITION (SOFA)
        const listenY = roomY + (v.distFront + v.listenDist) * scale;

        const sofa = document.getElementById("sofa-icon");
        sofa.setAttribute("x", centerX - this.SOFA_W/2);
        sofa.setAttribute("y", listenY - this.SOFA_H/2);

        const label = document.getElementById("listening-pos-label");
        label.setAttribute("x", centerX);
        label.setAttribute("y", listenY + this.SOFA_H/2 + 28);

        // TOE-IN LINES
        const LT = document.getElementById("left-toe-line");
        const RT = document.getElementById("right-toe-line");

        const lx1 = leftX  + this.SPK_SIZE/2;
        const ly1 = frontY + this.SPK_SIZE/2;

        const rx1 = rightX + this.SPK_SIZE/2;
        const ry1 = frontY + this.SPK_SIZE/2;

        const lx2 = centerX;
        const ly2 = listenY;

        const rx2 = centerX;
        const ry2 = listenY;

        LT.setAttribute("x1", lx1);
        LT.setAttribute("y1", ly1);
        LT.setAttribute("x2", lx2);
        LT.setAttribute("y2", ly2);

        RT.setAttribute("x1", rx1);
        RT.setAttribute("y1", ry1);
        RT.setAttribute("x2", rx2);
        RT.setAttribute("y2", ry2);

        // IDEAL TOE
        const toeRad = Math.atan((v.spacing / 2) / v.listenDist);
        const idealToe = toeRad * (180/Math.PI);

        this.setExplainer(v, idealToe);
    }

    setExplainer(v, idealToe) {
        document.getElementById("explainer-width").textContent   = v.width.toFixed(2);
        document.getElementById("explainer-length").textContent  = v.length.toFixed(2);
        document.getElementById("explainer-spacing").textContent = v.spacing.toFixed(2);
        document.getElementById("explainer-listen").textContent  = v.listenDist.toFixed(2);
        document.getElementById("explainer-ideal-toe").textContent = idealToe.toFixed(1);
    }
}

document.addEventListener("DOMContentLoaded", () => new RoomDiagram());
