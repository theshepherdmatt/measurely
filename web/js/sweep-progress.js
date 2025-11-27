/* ============================================================
   SWEEP PROGRESS MANAGER
   Handles real-time sweep progress updates and UI
============================================================ */

class SweepProgressManager {
  constructor() {
    this.overlay = null;
    this.modal = null;
    this.progressBar = null;
    this.percentageElement = null;
    this.statusElement = null;
    this.logMessages = null;
    this.currentProgress = 0;
    this.sweepId = null;
    this.pollInterval = null;
    this.isActive = false;
  }

  /**
   * Initialize the progress modal
   */
  init() {
    this.createModal();
    this.attachEventListeners();
  }

  /**
   * Create the modal HTML structure
   */
  createModal() {
    const modalHTML = `
      <div id="sweep-progress-overlay" class="sweep-progress-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="sweep-progress-title">
        <div class="sweep-progress-modal">
          <div class="sweep-progress-header">
            <div class="sweep-progress-icon" aria-hidden="true">🎵</div>
            <div class="sweep-progress-title">
              <h3 id="sweep-progress-title">Running Acoustic Sweep</h3>
              <p>Please wait while we analyze your room...</p>
            </div>
          </div>

          <div class="sweep-progress-bar-container">
            <div class="sweep-progress-percentage">
              <span class="sweep-progress-percentage-value" id="sweep-progress-percentage" aria-live="polite">0%</span>
              <span class="sweep-progress-status" id="sweep-progress-status">Initializing...</span>
            </div>
            <div class="sweep-progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
              <div class="sweep-progress-bar-fill" id="sweep-progress-bar-fill" style="width: 0%"></div>
            </div>
          </div>

          <div class="sweep-log-window">
            <div class="sweep-log-header">
              <img src="icons/list.svg" alt="" aria-hidden="true">
              <span>Live Log</span>
            </div>
            <div class="sweep-log-messages" id="sweep-log-messages" role="log" aria-live="polite" aria-atomic="false">
              <!-- Log messages will be inserted here -->
            </div>
          </div>

          <div class="sweep-progress-actions">
            <button id="sweep-cancel-btn" class="btn btn-secondary">Cancel Sweep</button>
            <button id="sweep-close-btn" class="btn btn-primary hidden">View Results</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Store references
    this.overlay = document.getElementById('sweep-progress-overlay');
    this.modal = this.overlay.querySelector('.sweep-progress-modal');
    this.progressBar = document.getElementById('sweep-progress-bar-fill');
    this.percentageElement = document.getElementById('sweep-progress-percentage');
    this.statusElement = document.getElementById('sweep-progress-status');
    this.logMessages = document.getElementById('sweep-log-messages');
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    const cancelBtn = document.getElementById('sweep-cancel-btn');
    const closeBtn = document.getElementById('sweep-close-btn');

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.cancelSweep());
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isActive) {
        this.cancelSweep();
      }
    });
  }

  /**
   * Show the progress modal and start a sweep
   */
  async start(sweepId = null) {
    this.sweepId = sweepId || `sweep_${Date.now()}`;
    this.isActive = true;
    this.currentProgress = 0;

    // Reset UI
    this.reset();

    // Show modal
    this.overlay.classList.remove('hidden');
    this.modal.classList.remove('success', 'error');

    // Add initial log message
    this.addLogMessage('Initializing sweep...', 'progress');

    // Start polling for progress (or use WebSocket if available)
    this.startProgressPolling();

    // Simulate sweep for demo (remove this in production)
    if (!sweepId) {
      this.simulateSweep();
    }
  }

  /**
   * Start polling for sweep progress
   */
  startProgressPolling() {
    this.pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/sweep/${this.sweepId}/progress`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch progress');
        }

        const data = await response.json();
        this.updateProgress(data.percentage, data.message, data.status);

        if (data.status === 'complete' || data.status === 'error') {
          this.stopProgressPolling();
          
          if (data.status === 'complete') {
            this.complete();
          } else {
            this.error(data.message || 'Sweep failed');
          }
        }
      } catch (error) {
        console.error('Progress polling error:', error);
        // Continue polling unless explicitly stopped
      }
    }, 500); // Poll every 500ms
  }

  /**
   * Stop polling for progress
   */
  stopProgressPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Update progress bar and status
   */
  updateProgress(percentage, message = null, status = 'progress') {
    this.currentProgress = Math.min(100, Math.max(0, percentage));

    // Update progress bar
    this.progressBar.style.width = `${this.currentProgress}%`;
    this.progressBar.parentElement.setAttribute('aria-valuenow', this.currentProgress);

    // Update percentage text
    this.percentageElement.textContent = `${Math.round(this.currentProgress)}%`;

    // Update status if provided
    if (message) {
      this.statusElement.textContent = message;
      this.addLogMessage(message, status);
    }
  }

  /**
   * Add a message to the log window
   */
  addLogMessage(message, type = 'progress') {
    const timestamp = new Date().toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });

    const icons = {
      complete: '✓',
      progress: '⏳',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };

    const icon = icons[type] || icons.info;

    const messageHTML = `
      <div class="sweep-log-message ${type}">
        <span class="sweep-log-icon" aria-hidden="true">${icon}</span>
        <span class="sweep-log-text">${message}</span>
        <span class="sweep-log-time">${timestamp}</span>
      </div>
    `;

    this.logMessages.insertAdjacentHTML('beforeend', messageHTML);

    // Auto-scroll to bottom
    this.logMessages.parentElement.scrollTop = this.logMessages.parentElement.scrollHeight;
  }

  /**
   * Mark sweep as complete
   */
  complete() {
    this.isActive = false;
    this.modal.classList.add('success');
    this.updateProgress(100, 'Sweep complete!', 'complete');
    
    // Update UI
    this.statusElement.textContent = 'Complete';
    document.getElementById('sweep-cancel-btn').classList.add('hidden');
    document.getElementById('sweep-close-btn').classList.remove('hidden');

    // Play success sound (optional)
    // this.playSound('success');
  }

  /**
   * Mark sweep as failed
   */
  error(message = 'Sweep failed') {
    this.isActive = false;
    this.modal.classList.add('error');
    this.addLogMessage(message, 'error');
    this.statusElement.textContent = 'Error';
    
    // Update button
    const cancelBtn = document.getElementById('sweep-cancel-btn');
    cancelBtn.textContent = 'Close';
    cancelBtn.onclick = () => this.close();
  }

  /**
   * Cancel the sweep
   */
  async cancelSweep() {
    if (!this.isActive) {
      this.close();
      return;
    }

    const confirmed = confirm('Are you sure you want to cancel the sweep?');
    if (!confirmed) return;

    try {
      // Call cancel API
      await fetch(`/api/sweep/${this.sweepId}/cancel`, { method: 'POST' });
      
      this.addLogMessage('Sweep cancelled by user', 'warning');
      this.stopProgressPolling();
      this.isActive = false;
      
      setTimeout(() => this.close(), 1000);
    } catch (error) {
      console.error('Failed to cancel sweep:', error);
      this.close();
    }
  }

  /**
   * Close the modal
   */
  close() {
    this.stopProgressPolling();
    this.overlay.classList.add('hidden');
    this.isActive = false;

    // Reload dashboard if sweep completed
    if (this.modal.classList.contains('success')) {
      if (window.dashboard && typeof window.dashboard.loadData === 'function') {
        window.dashboard.loadData();
        window.dashboard.updateDashboard();
      } else {
        window.location.reload();
      }
    }
  }

  /**
   * Reset the modal to initial state
   */
  reset() {
    this.currentProgress = 0;
    this.progressBar.style.width = '0%';
    this.percentageElement.textContent = '0%';
    this.statusElement.textContent = 'Initializing...';
    this.logMessages.innerHTML = '';
    this.modal.classList.remove('success', 'error');
    
    document.getElementById('sweep-cancel-btn').classList.remove('hidden');
    document.getElementById('sweep-cancel-btn').textContent = 'Cancel Sweep';
    document.getElementById('sweep-close-btn').classList.add('hidden');
  }

  /**
   * Simulate a sweep for demo purposes (REMOVE IN PRODUCTION)
   */
  simulateSweep() {
    const steps = [
      { progress: 0, message: 'Initializing sweep...', delay: 0 },
      { progress: 10, message: 'Checking USB microphone...', delay: 1000 },
      { progress: 15, message: 'Checking DAC output...', delay: 1500 },
      { progress: 20, message: 'Calibrating levels...', delay: 2000 },
      { progress: 25, message: 'Playing test tones (20Hz-20kHz)...', delay: 2500 },
      { progress: 40, message: 'Recording left channel...', delay: 5000 },
      { progress: 60, message: 'Recording right channel...', delay: 7500 },
      { progress: 75, message: 'Analyzing frequency response...', delay: 10000 },
      { progress: 85, message: 'Calculating metrics...', delay: 12000 },
      { progress: 95, message: 'Generating recommendations...', delay: 13500 },
      { progress: 100, message: 'Sweep complete!', delay: 15000 }
    ];

    steps.forEach(step => {
      setTimeout(() => {
        if (!this.isActive) return;
        
        const status = step.progress === 100 ? 'complete' : 'progress';
        this.updateProgress(step.progress, step.message, status);
        
        if (step.progress === 100) {
          this.complete();
        }
      }, step.delay);
    });
  }
}

// Initialize on page load
let sweepProgress;
document.addEventListener('DOMContentLoaded', () => {
  sweepProgress = new SweepProgressManager();
  sweepProgress.init();
});

// Export for use in other scripts
window.SweepProgressManager = SweepProgressManager;
window.sweepProgress = sweepProgress;
