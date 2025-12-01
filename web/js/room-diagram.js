/**
 * Room Acoustics Diagram - Interactive SVG visualization
 * Updates based on user inputs for room dimensions and speaker placement
 */

class RoomDiagram {
    constructor() {
        this.svgWidth = 800;
        this.svgHeight = 600;
        this.padding = 100;
        this.maxRoomWidth = this.svgWidth - (this.padding * 2);
        this.maxRoomHeight = this.svgHeight - (this.padding * 2);

        this.initializeEventListeners();
        this.updateDiagram();
    }

    initializeEventListeners() {
        // Listen to all relevant input changes
        const inputs = [
            'room-length', 'room-width', 'speaker-distance',
            'speaker-width', 'toe-angle', 'listening-distance'
        ];

        inputs.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('input', () => this.updateDiagram());
                element.addEventListener('change', () => this.updateDiagram());
            }
        });
    }

    getInputValues() {
        return {
            roomLength: parseFloat(document.getElementById('room-length')?.value) || 4.9,
            roomWidth: parseFloat(document.getElementById('room-width')?.value) || 3.7,
            speakerDistance: parseFloat(document.getElementById('speaker-distance')?.value) || 0.6,
            speakerSpacing: parseFloat(document.getElementById('speaker-width')?.value) || 2.4,
            toeAngle: parseFloat(document.getElementById('toe-angle')?.value) || 15,
            listeningDistance: parseFloat(document.getElementById('listening-distance')?.value) || 2.5
        };
    }

    updateDiagram() {
        const values = this.getInputValues();

        // Calculate scale to fit room in SVG
        const scaleX = this.maxRoomWidth / values.roomWidth;
        const scaleY = this.maxRoomHeight / values.roomLength;
        const scale = Math.min(scaleX, scaleY);

        // Calculate room dimensions in SVG coordinates
        const roomWidthSVG = values.roomWidth * scale;
        const roomLengthSVG = values.roomLength * scale;

        // Center the room
        const roomX = (this.svgWidth - roomWidthSVG) / 2;
        const roomY = (this.svgHeight - roomLengthSVG) / 2;

        // Update room rectangle
        const roomRect = document.getElementById('room-rect');
        if (roomRect) {
            roomRect.setAttribute('x', roomX);
            roomRect.setAttribute('y', roomY);
            roomRect.setAttribute('width', roomWidthSVG);
            roomRect.setAttribute('height', roomLengthSVG);
        }

        // Calculate speaker positions
        const frontWallY = roomY + (values.speakerDistance * scale);
        const centerX = this.svgWidth / 2;
        const speakerSpacingSVG = values.speakerSpacing * scale;

        const leftSpeakerX = centerX - (speakerSpacingSVG / 2);
        const rightSpeakerX = centerX + (speakerSpacingSVG / 2);

        // Update speaker positions
        const leftSpeaker = document.getElementById('left-speaker');
        const rightSpeaker = document.getElementById('right-speaker');

        if (leftSpeaker) {
            leftSpeaker.setAttribute('transform', `translate(${leftSpeakerX}, ${frontWallY})`);
        }
        if (rightSpeaker) {
            rightSpeaker.setAttribute('transform', `translate(${rightSpeakerX}, ${frontWallY})`);
        }

        // Calculate listening position
        const listeningY = frontWallY + (values.listeningDistance * scale);
        const listeningPos = document.getElementById('listening-pos-label');

        if (listeningPos) {
            listeningPos.setAttribute('transform', `translate(${centerX}, ${listeningY})`);
        }

        // Update sofa rotation to face speakers
        const sofa = document.getElementById('sofa-icon');
        if (sofa) {
            sofa.setAttribute('transform', `translate(${centerX}, ${listeningY}) rotate(180)`);
        }

        // Update toe-in lines
        const leftToeLine = document.getElementById('left-toe-line');
        const rightToeLine = document.getElementById('right-toe-line');

        if (leftToeLine) {
            leftToeLine.setAttribute('x1', leftSpeakerX);
            leftToeLine.setAttribute('y1', frontWallY);
            leftToeLine.setAttribute('x2', centerX);
            leftToeLine.setAttribute('y2', listeningY);
        }

        if (rightToeLine) {
            rightToeLine.setAttribute('x1', rightSpeakerX);
            rightToeLine.setAttribute('y1', frontWallY);
            rightToeLine.setAttribute('x2', centerX);
            rightToeLine.setAttribute('y2', listeningY);
        }

        // Update dimension labels
        this.updateDimensionLabels(values, scale, {
            roomX, roomY, roomWidthSVG, roomLengthSVG,
            leftSpeakerX, rightSpeakerX, frontWallY, centerX, listeningY
        });

        // Calculate and display metrics
        this.updateCalculatedMetrics(values);
    }

    updateDimensionLabels(values, scale, positions) {
        const { roomX, roomY, roomWidthSVG, roomLengthSVG, leftSpeakerX, rightSpeakerX, frontWallY, centerX, listeningY } = positions;

        // Speaker spacing label
        const spacingLabel = document.getElementById('spacing-label');
        if (spacingLabel) {
            spacingLabel.textContent = `${values.speakerSpacing.toFixed(2)}m`;
        }

        // Front wall distance label
        const frontWallLabel = document.getElementById('front-wall-label');
        if (frontWallLabel) {
            frontWallLabel.textContent = `${values.speakerDistance.toFixed(2)}m`;
        }

        // Listening distance label
        const listeningDistLabel = document.getElementById('listening-dist-label');
        if (listeningDistLabel) {
            listeningDistLabel.textContent = `${values.listeningDistance.toFixed(2)}m`;
        }

        // Side wall distances (calculated)
        const leftWallDist = ((values.roomWidth - values.speakerSpacing) / 2).toFixed(2);
        const leftWallLabel = document.getElementById('left-wall-label');
        const rightWallLabel = document.getElementById('right-wall-label');

        if (leftWallLabel) leftWallLabel.textContent = `${leftWallDist}m`;
        if (rightWallLabel) rightWallLabel.textContent = `${leftWallDist}m`;

        // Room dimension labels
        const roomWidthLabel = document.getElementById('room-width-label');
        const roomLengthLabel = document.getElementById('room-length-label');

        if (roomWidthLabel) roomWidthLabel.textContent = `Width: ${values.roomWidth.toFixed(2)}m`;
        if (roomLengthLabel) roomLengthLabel.textContent = `Length: ${values.roomLength.toFixed(2)}m`;

        // Toe-in angle labels
        const leftAngleLabel = document.getElementById('left-angle-label');
        const rightAngleLabel = document.getElementById('right-angle-label');

        if (leftAngleLabel) leftAngleLabel.textContent = `${values.toeAngle}°`;
        if (rightAngleLabel) rightAngleLabel.textContent = `${values.toeAngle}°`;
    }

    updateCalculatedMetrics(values) {
        // Calculate ideal toe-in angle based on geometry
        const halfSpacing = values.speakerSpacing / 2;
        const idealToeAngle = Math.atan(halfSpacing / values.listeningDistance) * (180 / Math.PI);

        // Calculate triangle side length (speaker to listener)
        const triangleSide = Math.sqrt(
            Math.pow(halfSpacing, 2) + Math.pow(values.listeningDistance, 2)
        );

        // Update display elements
        const calcToeAngle = document.getElementById('calc-toe-angle');
        const calcSpacing = document.getElementById('calc-spacing');
        const calcTriangleSide = document.getElementById('calc-triangle-side');

        if (calcToeAngle) {
            calcToeAngle.textContent = `${idealToeAngle.toFixed(1)}°`;
        }

        if (calcSpacing) {
            calcSpacing.textContent = `${values.speakerSpacing.toFixed(2)}m`;
        }

        if (calcTriangleSide) {
            calcTriangleSide.textContent = `${triangleSide.toFixed(2)}m`;
        }
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.roomDiagram = new RoomDiagram();
    });
} else {
    window.roomDiagram = new RoomDiagram();
}
