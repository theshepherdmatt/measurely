// web/js/results.js - Results display and management

import { $, simpleResult, geekResult, showToast } from './api.js';

let currentSessionId = '';
let simpleData = null;
let geekData = null;

export async function renderSimpleAndGeek(sessionId = '') {
  currentSessionId = sessionId;
  
  try {
    // Fetch both simple and geek results
    const [simple, geek] = await Promise.all([
      simpleResult(sessionId),
      geekResult(sessionId)
    ]);
    
    simpleData = simple;
    geekData = geek;
    
    if (simple?.ok) {
      renderSimpleResults(simple);
    }
    
    if (geek?.ok) {
      renderGeekResults(geek);
    }
    
    if (!simple?.ok && !geek?.ok) {
      showNoResults();
    }
    
  } catch (error) {
    console.error('Error rendering results:', error);
    showToast('Error loading results', 'error');
    showNoResults();
  }
}

function renderSimpleResults(data) {
  const container = $('simpleResults');
  if (!container) return;
  
  // Update dashboard scores if available
  updateDashboardScores(data);
  
  container.innerHTML = `
    <div class="bg-white rounded-lg shadow-lg p-6">
      <h3 class="text-xl font-semibold mb-4">Analysis Results</h3>
      
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <div class="text-center p-4 bg-blue-50 rounded-lg">
          <div class="text-2xl font-bold text-blue-600">${data.scores?.overall || 'N/A'}</div>
          <div class="text-sm text-gray-600">Overall Score</div>
        </div>
        <div class="text-center p-4 bg-green-50 rounded-lg">
          <div class="text-2xl font-bold text-green-600">${data.scores?.bandwidth || 'N/A'}</div>
          <div class="text-sm text-gray-600">Bandwidth</div>
        </div>
        <div class="text-center p-4 bg-yellow-50 rounded-lg">
          <div class="text-2xl font-bold text-yellow-600">${data.scores?.balance || 'N/A'}</div>
          <div class="text-sm text-gray-600">Balance</div>
        </div>
      </div>
      
      <div class="space-y-4">
        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
          <span class="font-medium">Frequency Range</span>
          <span>${data.bandwidth_lo_3db_hz?.toFixed(0) || 'N/A'} - ${data.bandwidth_hi_3db_hz?.toFixed(0) || 'N/A'} Hz</span>
        </div>
        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
          <span class="font-medium">Smoothness</span>
          <span>${data.smoothness_std_db?.toFixed(1) || 'N/A'} dB std dev</span>
        </div>
      </div>
    </div>
  `;
}

function renderGeekResults(data) {
  const container = $('geekResults');
  if (!container) return;
  
  container.innerHTML = `
    <div class="bg-white rounded-lg shadow-lg p-6">
      <h3 class="text-xl font-semibold mb-4">Detailed Analysis</h3>
      
      <div class="space-y-6">
        <!-- Frequency Bands -->
        <div>
          <h4 class="font-semibold mb-3">Frequency Band Levels</h4>
          <div class="grid grid-cols-2 gap-3">
            <div class="flex justify-between p-2 bg-blue-50 rounded">
              <span>Bass (20-200Hz)</span>
              <span class="font-mono">${data.band_levels_db?.bass_20_200?.toFixed(1) || 'N/A'} dB</span>
            </div>
            <div class="flex justify-between p-2 bg-green-50 rounded">
              <span>Mid (200-2kHz)</span>
              <span class="font-mono">${data.band_levels_db?.mid_200_2k?.toFixed(1) || 'N/A'} dB</span>
            </div>
            <div class="flex justify-between p-2 bg-yellow-50 rounded">
              <span>Treble (2-10kHz)</span>
              <span class="font-mono">${data.band_levels_db?.treble_2k_10k?.toFixed(1) || 'N/A'} dB</span>
            </div>
            <div class="flex justify-between p-2 bg-purple-50 rounded">
              <span>Air (10-20kHz)</span>
              <span class="font-mono">${data.band_levels_db?.air_10k_20k?.toFixed(1) || 'N/A'} dB</span>
            </div>
          </div>
        </div>
        
        <!-- Room Modes -->
        ${data.modes && data.modes.length > 0 ? `
          <div>
            <h4 class="font-semibold mb-3">Detected Room Modes</h4>
            <div class="space-y-2">
              ${data.modes.map(mode => `
                <div class="flex justify-between items-center p-2 bg-gray-50 rounded">
                  <span>${mode.freq_hz?.toFixed(0) || 'N/A'} Hz</span>
                  <span class="font-mono ${mode.delta_db > 0 ? 'text-red-600' : 'text-blue-600'}">
                    ${mode.delta_db > 0 ? 'PEAK' : 'DIP'} ${mode.delta_db?.toFixed(1) || 'N/A'} dB
                  </span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function updateDashboardScores(data) {
  // Update scores in the main dashboard if available
  const scoreElements = {
    overallScore: data.scores?.overall,
    bandwidthScore: data.scores?.bandwidth,
    balanceScore: data.scores?.balance,
    smoothnessScore: data.scores?.smoothness,
    peaksDipsScore: data.scores?.peaks_dips,
    reflectionsScore: data.scores?.reflections,
    reverbScore: data.scores?.reverb
  };
  
  Object.entries(scoreElements).forEach(([id, value]) => {
    const element = $(id);
    if (element && value !== undefined) {
      element.textContent = value.toFixed(1);
    }
  });
  
  // Update frequency bands
  if (data.band_levels_db) {
    updateFrequencyBands(data.band_levels_db);
  }
}

function updateFrequencyBands(bands) {
  const bandElements = {
    'bass-value': bands.bass_20_200,
    'mid-value': bands.mid_200_2k,
    'treble-value': bands.treble_2k_10k,
    'air-value': bands.air_10k_20k
  };
  
  Object.entries(bandElements).forEach(([id, value]) => {
    const element = $(id);
    if (element && value !== undefined) {
      element.textContent = `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
    }
  });
}

function showNoResults() {
  const simpleContainer = $('simpleResults');
  const geekContainer = $('geekResults');
  
  if (simpleContainer) {
    simpleContainer.innerHTML = `
      <div class="bg-white rounded-lg shadow-lg p-6 text-center">
        <i class="fas fa-chart-line text-4xl text-gray-400 mb-4"></i>
        <h3 class="text-lg font-semibold text-gray-600 mb-2">No Results Available</h3>
        <p class="text-gray-500">Run a sweep to see your room analysis results.</p>
      </div>
    `;
  }
  
  if (geekContainer) {
    geekContainer.innerHTML = `
      <div class="bg-white rounded-lg shadow-lg p-6 text-center">
        <i class="fas fa-microscope text-4xl text-gray-400 mb-4"></i>
        <h3 class="text-lg font-semibold text-gray-600 mb-2">No Detailed Data</h3>
        <p class="text-gray-500">Detailed analysis will appear after your first sweep.</p>
      </div>
    `;
  }
}

export function exportResults(format = 'json') {
  if (!simpleData && !geekData) {
    showToast('No results to export', 'error');
    return;
  }
  
  const exportData = {
    sessionId: currentSessionId,
    timestamp: new Date().toISOString(),
    simple: simpleData,
    geek: geekData,
    format: format
  };
  
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `measurely-results-${currentSessionId || 'latest'}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showToast('Results exported successfully', 'success');
}

export function generateReport() {
  if (!simpleData) {
    showToast('No data available for report generation', 'error');
    return;
  }
  
  // Generate a simple text report
  const report = `
Measurely Room Acoustic Analysis Report
Generated: ${new Date().toLocaleString()}
Session: ${currentSessionId || 'Latest'}

Overall Score: ${simpleData.scores?.overall || 'N/A'}/10

Frequency Analysis:
- Bandwidth: ${simpleData.bandwidth_lo_3db_hz?.toFixed(0) || 'N/A'} - ${simpleData.bandwidth_hi_3db_hz?.toFixed(0) || 'N/A'} Hz
- Smoothness: ${simpleData.smoothness_std_db?.toFixed(1) || 'N/A'} dB std deviation

Band Levels:
- Bass (20-200Hz): ${simpleData.band_levels_db?.bass_20_200?.toFixed(1) || 'N/A'} dB
- Mid (200-2kHz): ${simpleData.band_levels_db?.mid_200_2k?.toFixed(1) || 'N/A'} dB
- Treble (2-10kHz): ${simpleData.band_levels_db?.treble_2k_10k?.toFixed(1) || 'N/A'} dB
- Air (10-20kHz): ${simpleData.band_levels_db?.air_10k_20k?.toFixed(1) || 'N/A'} dB

Recommendations:
${generateRecommendations(simpleData)}
  `.trim();
  
  const blob = new Blob([report], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `measurely-report-${currentSessionId || 'latest'}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showToast('Report generated successfully', 'success');
}

function generateRecommendations(data) {
  const recommendations = [];
  
  if (data.scores?.bandwidth < 5) {
    recommendations.push('- Limited frequency response detected. Consider speaker placement or room treatment.');
  }
  
  if (data.scores?.balance < 3) {
    recommendations.push('- Frequency balance needs improvement. Check speaker positioning and room acoustics.');
  }
  
  if (data.scores?.smoothness < 5) {
    recommendations.push('- Response smoothness could be better. Consider acoustic treatment.');
  }
  
  if (data.modes && data.modes.length > 0) {
    recommendations.push('- Room modes detected. Consider bass traps and acoustic treatment.');
  }
  
  return recommendations.length > 0 ? recommendations.join('\n') : '- Your room shows good acoustic characteristics!';
}

// Global functions for HTML handlers
window.exportResults = exportResults;
window.generateReport = generateReport;