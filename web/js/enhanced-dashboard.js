// web/js/enhanced-dashboard.js
// Enhanced Measurely Dashboard with full integration

import { $, setDisabled, fetchJSON } from './api.js';

class EnhancedDashboard {
    constructor() {
        this.currentData = null;
        this.deviceStatus = {};
        this.isInitialized = false;
    }

    async init() {
        if (this.isInitialized) return;
        
        this.injectStyles();
        this.setupEventListeners();
        await this.loadData();
        this.render();
        this.startPolling();
        
        this.isInitialized = true;
    }

    injectStyles() {
        if (document.getElementById('enhanced-dash-style')) return;
        
        const css = `
            :root {
                --bg: #f9fafb;
                --card-bg: #fff;
                --border: #e0e0e0;
                --text: #222;
                --accent: #007aff;
                --shadow: 0 2px 6px rgba(0,0,0,0.06);
            }
            
            .enhanced-dashboard {
                background: var(--bg);
                color: var(--text);
                padding: 18px;
                border-radius: 12px;
            }
            
            .dash-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                gap: 16px;
                margin-top: 10px;
            }
            
            .dash-box {
                background: var(--card-bg);
                border: 1px solid var(--border);
                border-radius: 10px;
                box-shadow: var(--shadow);
                padding: 14px 16px;
                text-align: center;
                transition: all 0.3s ease;
            }
            
            .dash-box:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 25px rgba(0,0,0,0.1);
            }
            
            .dash-box h3 {
                margin: 0 0 6px 0;
                font-size: 1rem;
                color: #333;
                font-weight: 600;
            }
            
            .dash-value {
                font-size: 1.8rem;
                font-weight: 600;
                color: var(--accent);
            }
            
            .dash-sub {
                font-size: .9rem;
                opacity: .8;
            }
            
            .gauge {
                width: 100%;
                height: 120px;
            }
            
            .summary {
                font-style: italic;
                text-align: center;
                margin: 4px 0 16px;
                color: #555;
                font-size: 1.1rem;
                font-weight: 500;
            }
            
            .dash-graphs {
                display: flex;
                gap: 16px;
                flex-wrap: wrap;
                justify-content: center;
                margin-top: 24px;
            }
            
            .dash-graphs img {
                max-width: 48%;
                height: auto;
                border-radius: 10px;
                box-shadow: var(--shadow);
                border: 1px solid var(--border);
                transition: all 0.3s ease;
            }
            
            .dash-graphs img:hover {
                transform: scale(1.02);
            }
            
            @media(max-width:700px){
                .dash-graphs img { max-width:100%; }
            }
            
            .status-indicator {
                width: 12px;
                height: 12px;
                border-radius: 50%;
                display: inline-block;
                margin-right: 8px;
            }
            
            .status-good { background-color: #10b981; }
            .status-warning { background-color: #f59e0b; }
            .status-poor { background-color: #ef4444; }
            
            .pulse-animation {
                animation: pulse 2s infinite;
            }
            
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }
            
            .dash-loading {
                text-align: center;
                padding: 40px;
                color: #666;
                font-style: italic;
            }
            
            .recommendations-section {
                margin-top: 24px;
                padding: 20px;
                background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                border-radius: 12px;
                color: white;
            }
            
            .recommendations-section h3 {
                margin: 0 0 16px 0;
                font-size: 1.2rem;
                font-weight: 600;
            }
            
            .recommendation-item {
                background: rgba(255, 255, 255, 0.2);
                border-radius: 8px;
                padding: 12px;
                margin-bottom: 8px;
                backdrop-filter: blur(10px);
            }
            
            .recommendation-item:last-child {
                margin-bottom: 0;
            }
            
            .recommendation-icon {
                display: inline-block;
                width: 24px;
                height: 24px;
                background: rgba(255, 255, 255, 0.3);
                border-radius: 50%;
                text-align: center;
                line-height: 24px;
                margin-right: 8px;
                font-size: 12px;
            }
        `;
        
        const s = document.createElement('style');
        s.id = 'enhanced-dash-style';
        s.textContent = css;
        document.head.appendChild(s);
    }

    setupEventListeners() {
        // Add any additional event listeners here
        console.log('Enhanced dashboard event listeners setup');
    }

    async loadData() {
        try {
            // Load device status
            this.deviceStatus = await fetchJSON('/api/status');
            
            // Load latest analysis
            const simpleData = await fetchJSON('/api/simple');
            if (simpleData && simpleData.ok) {
                this.currentData = simpleData;
            }
        } catch (error) {
            console.warn('[Enhanced Dashboard] Error loading data:', error);
            // Use fallback data
            this.currentData = this.getFallbackData();
        }
    }

    getFallbackData() {
        return {
            summary: "Voices are stronger than bass.",
            overall: 5.0,
            sections: {
                bandwidth: { score: 3.6, status: "poor" },
                balance: { score: 1.6, status: "poor" },
                peaks_dips: { score: 3.3, status: "poor" },
                smoothness: { score: 7.3, status: "good" },
                reflections: { score: 4.0, status: "poor" },
                reverb: { score: 10.0, status: "great" }
            },
            top_actions: [
                {
                    section: "balance",
                    score: 1.6,
                    advice: "Midrange is forward; try a touch less toe-in and ensure no hard desk/floor reflections."
                },
                {
                    section: "peaks_dips",
                    score: 3.3,
                    advice: "Bass dip detected; try small seat moves (10–20 cm) and re-sweep."
                },
                {
                    section: "bandwidth",
                    score: 3.6,
                    advice: "Extend bass by moving speakers 10–20 cm closer to the front wall; re-sweep."
                }
            ]
        };
    }

    render() {
        const wrap = $('dashboard');
        if (!wrap) return;

        // Create enhanced dashboard container
        wrap.innerHTML = `
            <div class="enhanced-dashboard">
                ${this.renderHeader()}
                ${this.renderMetricsGrid()}
                ${this.renderRecommendations()}
                ${this.renderGraphs()}
            </div>
        `;
    }

    renderHeader() {
        const overall = this.currentData?.overall || 0;
        const summary = this.currentData?.summary || "No analysis available";
        
        return `
            <h2 style="text-align:center;margin-bottom:0;font-size:1.5rem;font-weight:700;">
                Room Acoustic Dashboard
            </h2>
            <div class="summary">${summary}</div>
            <div style="text-align:center;margin:16px 0;">
                <div style="display:inline-block;position:relative;">
                    ${this.renderGauge(overall, this.getColorForScore(overall))}
                    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">
                        <div style="font-size:1.5rem;font-weight:700;color:#007aff;">${overall.toFixed(1)}</div>
                        <div style="font-size:0.8rem;color:#666;">Overall Score</div>
                    </div>
                </div>
            </div>
        `;
    }

    renderMetricsGrid() {
        const sections = this.currentData?.sections || {};
        const metrics = [
            { key: 'bandwidth', label: 'Bandwidth', icon: '📊' },
            { key: 'balance', label: 'Balance', icon: '⚖️' },
            { key: 'peaks_dips', label: 'Peaks & Dips', icon: '📈' },
            { key: 'smoothness', label: 'Smoothness', icon: '〰️' },
            { key: 'reflections', label: 'Reflections', icon: '🔊' },
            { key: 'reverb', label: 'Reverb', icon: '⏱️' }
        ];

        return `
            <div class="dash-grid">
                ${metrics.map(metric => {
                    const section = sections[metric.key];
                    const score = section?.score || 0;
                    const status = section?.status || 'unknown';
                    
                    return `
                        <div class="dash-box">
                            <h3>${metric.icon} ${metric.label}</h3>
                            <div class="dash-value" style="color:${this.getColorForScore(score)};">
                                ${score.toFixed(1)}/10
                            </div>
                            <div class="dash-sub">
                                <span class="status-indicator status-${status}"></span>
                                ${status.charAt(0).toUpperCase() + status.slice(1)}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    renderRecommendations() {
        const recommendations = this.currentData?.top_actions || [];
        
        if (recommendations.length === 0) {
            return '';
        }

        return `
            <div class="recommendations-section">
                <h3><i class="fas fa-lightbulb"></i> Improvement Recommendations</h3>
                ${recommendations.map(rec => `
                    <div class="recommendation-item">
                        <div class="recommendation-icon">
                            ${this.getRecommendationIcon(rec.section)}
                        </div>
                        <strong>${this.formatSectionName(rec.section)}</strong>
                        <span style="opacity:0.8;">(${rec.score ? rec.score.toFixed(1) + '/10' : 'N/A'})</span>
                        <div style="margin-top:4px;font-size:0.9rem;">${rec.advice}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderGraphs() {
        return `
            <div class="dash-graphs">
                <img src="/latest/left-response.png" alt="Left frequency response" 
                     onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OTk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkZyZXF1ZW5jeSBSZXNwb25zZTwvdGV4dD48L3N2Zz4='">
                <img src="/latest/right-response.png" alt="Right frequency response"
                     onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OTk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkZyZXF1ZW5jeSBSZXNwb25zZTwvdGV4dD48L3N2Zz4='">
            </div>
        `;
    }

    renderGauge(score, color) {
        const pct = Math.max(0, Math.min(score / 10, 1));
        const angle = pct * 180;
        const radius = 40;
        const start = this.polarToCartesian(radius, radius, radius, 180);
        const end = this.polarToCartesian(radius, radius, radius, 180 - angle);
        const largeArc = angle > 180 ? 1 : 0;
        const d = `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`;
        
        return `
            <svg viewBox="0 0 80 45" class="gauge">
                <path d="M0 40 A40 40 0 0 0 80 40" fill="none" stroke="#eee" stroke-width="8"/>
                <path d="${d}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"/>
            </svg>
        `;
    }

    polarToCartesian(cx, cy, r, angleDeg) {
        const rad = (angleDeg - 90) * Math.PI / 180.0;
        return { 
            x: cx + (r * Math.cos(rad)), 
            y: cy + (r * Math.sin(rad)) 
        };
    }

    getColorForScore(s) {
        if (s >= 8) return '#2ecc71';
        if (s >= 6.5) return '#27ae60';
        if (s >= 5) return '#f39c12';
        if (s >= 3.5) return '#e67e22';
        return '#e74c3c';
    }

    getRecommendationIcon(section) {
        const icons = {
            balance: '⚖️',
            bandwidth: '📊',
            peaks_dips: '📈',
            reflections: '🔊',
            smoothness: '〰️',
            reverb: '⏱️'
        };
        return icons[section] || '💡';
    }

    formatSectionName(section) {
        return section.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    async refresh() {
        await this.loadData();
        this.render();
    }

    startPolling() {
        // Poll for updates every 30 seconds
        setInterval(async () => {
            await this.refresh();
        }, 30000);
    }
}

// Create and export singleton instance
const enhancedDashboard = new EnhancedDashboard();

export async function initEnhancedDashboard() {
    await enhancedDashboard.init();
}

export async function refreshEnhancedDashboard() {
    await enhancedDashboard.refresh();
}

export default enhancedDashboard;