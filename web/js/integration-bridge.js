// web/js/integration-bridge.js
// Bridge between original Measurely and Enhanced Dashboard

import { initEnhancedDashboard, refreshEnhancedDashboard } from './enhanced-dashboard.js';
import { initDashboard, refreshDashboard } from './dashboard.js';

// Configuration
const DASHBOARD_CONFIG = {
    useEnhanced: true,  // Set to false to use original dashboard
    debugMode: false    // Enable debug logging
};

// Dashboard Manager
class DashboardManager {
    constructor() {
        this.currentDashboard = null;
        this.isEnhanced = DASHBOARD_CONFIG.useEnhanced;
    }

    async init() {
        if (this.isEnhanced) {
            console.log('[Dashboard] Using enhanced dashboard');
            await initEnhancedDashboard();
            this.currentDashboard = 'enhanced';
        } else {
            console.log('[Dashboard] Using original dashboard');
            await initDashboard();
            this.currentDashboard = 'original';
        }
    }

    async refresh() {
        if (this.isEnhanced && this.currentDashboard === 'enhanced') {
            await refreshEnhancedDashboard();
        } else if (!this.isEnhanced && this.currentDashboard === 'original') {
            await refreshDashboard();
        }
    }

    async switchToEnhanced() {
        if (!this.isEnhanced) {
            console.log('[Dashboard] Switching to enhanced dashboard');
            this.isEnhanced = true;
            this.currentDashboard = 'enhanced';
            await initEnhancedDashboard();
        }
    }

    async switchToOriginal() {
        if (this.isEnhanced) {
            console.log('[Dashboard] Switching to original dashboard');
            this.isEnhanced = false;
            this.currentDashboard = 'original';
            await initDashboard();
        }
    }

    toggleDashboard() {
        if (this.isEnhanced) {
            this.switchToOriginal();
        } else {
            this.switchToEnhanced();
        }
    }

    getCurrentDashboard() {
        return this.currentDashboard;
    }

    isUsingEnhanced() {
        return this.isEnhanced;
    }
}

// Create singleton instance
const dashboardManager = new DashboardManager();

// Export functions that match the original API
export async function initDashboard() {
    await dashboardManager.init();
}

export async function refreshDashboard() {
    await dashboardManager.refresh();
}

// Additional utility functions
export function switchToEnhancedDashboard() {
    dashboardManager.switchToEnhanced();
}

export function switchToOriginalDashboard() {
    dashboardManager.switchToOriginal();
}

export function toggleDashboardType() {
    dashboardManager.toggleDashboard();
}

export function getDashboardInfo() {
    return {
        current: dashboardManager.getCurrentDashboard(),
        isEnhanced: dashboardManager.isUsingEnhanced()
    };
}

// Auto-detection and fallback
export async function autoDetectAndInit() {
    try {
        // Try to detect if enhanced dashboard files are available
        const response = await fetch('/js/enhanced-dashboard.js', { method: 'HEAD' });
        if (response.ok) {
            console.log('[Dashboard] Enhanced dashboard detected');
            DASHBOARD_CONFIG.useEnhanced = true;
        } else {
            console.log('[Dashboard] Enhanced dashboard not found, using original');
            DASHBOARD_CONFIG.useEnhanced = false;
        }
    } catch (error) {
        console.warn('[Dashboard] Error detecting dashboard type:', error);
        DASHBOARD_CONFIG.useEnhanced = false;
    }
    
    await dashboardManager.init();
}

// Debug utilities
export function setDebugMode(enabled) {
    DASHBOARD_CONFIG.debugMode = enabled;
    window.DASH_DEBUG = enabled;
}

export function setDashboardType(type) {
    if (type === 'enhanced') {
        dashboardManager.switchToEnhanced();
    } else if (type === 'original') {
        dashboardManager.switchToOriginal();
    }
}

// Migration helper
export async function migrateToEnhanced() {
    try {
        console.log('[Dashboard] Starting migration to enhanced dashboard');
        
        // Check if enhanced dashboard is available
        const response = await fetch('/measurely-dashboard.html');
        if (!response.ok) {
            throw new Error('Enhanced dashboard HTML not found');
        }
        
        // Switch to enhanced
        await dashboardManager.switchToEnhanced();
        
        console.log('[Dashboard] Migration completed successfully');
        return true;
        
    } catch (error) {
        console.error('[Dashboard] Migration failed:', error);
        return false;
    }
}

// Feature detection
export function getAvailableFeatures() {
    const features = {
        original: {
            gauges: true,
            basicMetrics: true,
            simpleRecommendations: true,
            staticGraphs: true
        },
        enhanced: {
            interactiveCharts: true,
            realTimeUpdates: true,
            sessionManagement: true,
            filterGeneration: true,
            exportCapabilities: true,
            advancedRecommendations: true,
            deviceStatusMonitoring: true
        }
    };
    
    return dashboardManager.isUsingEnhanced() ? features.enhanced : features.original;
}

// Performance monitoring
export function getDashboardMetrics() {
    return {
        loadTime: performance.now(),
        dashboardType: dashboardManager.getCurrentDashboard(),
        isEnhanced: dashboardManager.isUsingEnhanced(),
        features: getAvailableFeatures()
    };
}

// Default exports for compatibility
export default {
    init: initDashboard,
    refresh: refreshDashboard,
    switchToEnhanced: switchToEnhancedDashboard,
    switchToOriginal: switchToOriginalDashboard,
    toggle: toggleDashboardType,
    getInfo: getDashboardInfo,
    autoDetect: autoDetectAndInit,
    migrate: migrateToEnhanced,
    getFeatures: getAvailableFeatures,
    getMetrics: getDashboardMetrics
};