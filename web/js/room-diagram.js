/**
 * ROOM DIAGRAM — FULL PREMIUM REBUILD (VALID JS VERSION)
 */

class RoomDiagram {

    constructor() {
        this.SVG_W = 600;
        this.SVG_H = 450;

        this.ROOM_MAX_W = this.SVG_W * 1.65;
        this.ROOM_MAX_H = this.SVG_H * 1.20;

        this.SPK_SIZE = 40;
        this.SOFA_W = 200;
        this.SOFA_H = 120;

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
            width:       parseFloat(document.getElementById("room-width").value)          || 4,
            length:      parseFloat(document.getElementById("room-length").value)        || 5,
            distFront:   parseFloat(document.getElementById("speaker-distance").value)   || 0.6,
            spacing:     parseFloat(document.getElementById("speaker-width").value)      || 2,
            listenDist:  parseFloat(document.getElementById("listening-distance").value) || 2.5,
            toeIn:       parseFloat(document.getElementById("toe-angle").value)          || 0
        };
    }

    update() {
        const v = this.get();

        const scaleX = this.ROOM_MAX_W / v.width;
        const scaleY = this.ROOM_MAX_H / v.length;
        const scale  = Math.min(scaleX, scaleY);

        const drawW = v.width * scale;
        const drawH = v.length * scale;

        const roomX = (this.SVG_W - drawW) / 2;
        const roomY = (this.SVG_H - drawH) / 2;

        // VIEWBOX
        const svg = document.getElementById("room-diagram");
        // Auto-padding based on scaled room size
        const pad = Math.max(drawW, drawH) * 0.05;

        svg.setAttribute(
            "viewBox",
            `${roomX - pad} ${roomY - pad} ${drawW + pad * 2} ${drawH + pad * 2}`
        );


        // ROOM RECT
        const r = document.getElementById("room-rect");
        r.setAttribute("x", roomX);
        r.setAttribute("y", roomY);
        r.setAttribute("width", drawW);
        r.setAttribute("height", drawH);

        // SPEAKER POSITIONS
        const centerX    = this.SVG_W / 2;
        const spacingSVG = v.spacing * scale;

        const leftX  = centerX - spacingSVG / 2 - this.SPK_SIZE / 2;
        const rightX = centerX + spacingSVG / 2 - this.SPK_SIZE / 2;

        const frontY = roomY + v.distFront * scale - this.SPK_SIZE / 2;

        const LS = document.getElementById("left-speaker");
        const RS = document.getElementById("right-speaker");

        LS.setAttribute("x", leftX);
        LS.setAttribute("y", frontY);

        RS.setAttribute("x", rightX);
        RS.setAttribute("y", frontY);

        // LISTENING POSITION (SOFA)
        const listenY = roomY + (v.distFront + v.listenDist) * scale;

        const sofa = document.getElementById("sofa-icon");
        sofa.setAttribute("x", centerX - this.SOFA_W / 2);
        sofa.setAttribute("y", listenY - this.SOFA_H / 2);

        const label = document.getElementById("listening-pos-label");
        label.setAttribute("x", centerX);
        label.setAttribute("y", listenY + this.SOFA_H / 2 + 28);

        // TOE-IN LINES
        const LT = document.getElementById("left-toe-line");
        const RT = document.getElementById("right-toe-line");

        const lx1 = leftX + this.SPK_SIZE / 2;
        const ly1 = frontY + this.SPK_SIZE / 2;

        const rx1 = rightX + this.SPK_SIZE / 2;
        const ry1 = frontY + this.SPK_SIZE / 2;

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
        const toeRad   = Math.atan((v.spacing / 2) / v.listenDist);
        const idealToe = toeRad * (180 / Math.PI);

        this.setExplainer(v, idealToe);

        // ROTATE SPEAKERS TO IDEAL TOE-IN
        LS.setAttribute(
            "transform",
            `rotate(${-idealToe}, ${leftX + this.SPK_SIZE / 2}, ${frontY + this.SPK_SIZE / 2})`
        );
        RS.setAttribute(
            "transform",
            `rotate(${idealToe}, ${rightX + this.SPK_SIZE / 2}, ${frontY + this.SPK_SIZE / 2})`
        );

        // ---- MEASUREMENT OVERLAYS --------------------------------------
        // Ensure a group for measurements exists
        let measGroup = document.getElementById("measurements");
        if (!measGroup) {
            measGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
            measGroup.setAttribute("id", "measurements");
            svg.appendChild(measGroup);
        } else {
            // Clear previous measurements (lines, arcs, labels)
            while (measGroup.firstChild) measGroup.removeChild(measGroup.firstChild);
        }

        const addLine = (x1, y1, x2, y2, cls) => {
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", x1);
            line.setAttribute("y1", y1);
            line.setAttribute("x2", x2);
            line.setAttribute("y2", y2);
            line.setAttribute("class", cls);
            measGroup.appendChild(line);
        };

        const addArc = (cx, cy, r, startDeg, endDeg, cls) => {
            const startRad = (Math.PI / 180) * startDeg;
            const endRad   = (Math.PI / 180) * endDeg;

            const x1 = cx + r * Math.cos(startRad);
            const y1 = cy + r * Math.sin(startRad);
            const x2 = cx + r * Math.cos(endRad);
            const y2 = cy + r * Math.sin(endRad);

            const largeArc = endDeg - startDeg <= 180 ? 0 : 1;
            const d = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;

            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", d);
            path.setAttribute("class", cls);
            measGroup.appendChild(path);
        };

        const addLabel = (text, x, y) => {
            const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
            lbl.textContent = text;
            lbl.setAttribute("x", x);
            lbl.setAttribute("y", y);
            lbl.setAttribute("class", "distance-label");
            lbl.setAttribute("font-size", "1");
            lbl.setAttribute("fill", "rgba(255,255,255,0.75)");
            lbl.setAttribute("text-anchor", "middle");
            lbl.setAttribute("paint-order", "stroke fill");
            lbl.setAttribute("stroke", "rgba(0,0,0,0.5)");
            lbl.setAttribute("stroke-width", "1");
            measGroup.appendChild(lbl);
        };

        // Room width measurement (top)
        const widthY = roomY - 20;
        addLine(roomX, widthY, roomX + drawW, widthY, "measurement-line");
        addLabel(`${v.width.toFixed(2)}m`, roomX + drawW / 2, widthY - 6);

        // Room length measurement (left side)
        const lengthX = roomX - 20;
        addLine(lengthX, roomY, lengthX, roomY + drawH, "measurement-line");
        addLabel(`${v.length.toFixed(2)}m`, lengthX - 4, roomY + drawH / 2);

        // Listening position front distance line
        addLine(centerX, roomY, centerX, listenY, "measurement-line");
        addLabel(`${(v.distFront + v.listenDist).toFixed(2)}m`, centerX, roomY + (listenY - roomY) / 2);

        // Lines to left and right speakers
        addLine(
            centerX,
            listenY,
            leftX + this.SPK_SIZE / 2,
            frontY + this.SPK_SIZE / 2,
            "measurement-line"
        );
        addLine(
            centerX,
            listenY,
            rightX + this.SPK_SIZE / 2,
            frontY + this.SPK_SIZE / 2,
            "measurement-line"
        );

        // Speaker spacing measurement
        const spkMidX = (leftX + rightX) / 2 + this.SPK_SIZE / 2;
        addLine(spkMidX - 20, frontY, spkMidX + 20, frontY, "measurement-line");
        addLabel(`${v.spacing.toFixed(2)}m`, spkMidX, frontY - 8);

    }

    setExplainer(v, idealToe) {
        document.getElementById("explainer-width").textContent  = v.width.toFixed(2);
        document.getElementById("explainer-length").textContent = v.length.toFixed(2);
        document.getElementById("explainer-spacing").textContent = v.spacing.toFixed(2);
        document.getElementById("explainer-listen").textContent  = v.listenDist.toFixed(2);
        document.getElementById("explainer-ideal-toe").textContent = idealToe.toFixed(1);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    window.roomDiagram = new RoomDiagram();
});
