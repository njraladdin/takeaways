/**
 * YouTube Takeaways - Content Script
 * Modularized structure for better organization and maintainability
 */
console.log('[YT Takeaways] Content script loaded');

// Main namespace for the extension
const YTTakeaways = {
  // State
  state: {
    currentTakeaways: null,
    takeawaysContainer: null,
    isInjectingUI: false,
    processedVideos: new Set()
  },
  
  // Initialize the extension
  init() {
    this.injectCSS();
    this.setupMessageListeners();
    
    // Initialize if we're already on a watch page
    if (this.utils.isWatchPage()) {
      this.initializeForCurrentVideo();
    }
    
    // Setup navigation listeners
    document.addEventListener('yt-navigate-start', () => this.handleNavigationStart());
    document.addEventListener('yt-navigate-finish', () => this.handleNavigationFinish());
  },
  
  // Inject required CSS
  injectCSS() {
    if (!document.getElementById('yt-takeaways-content-css')) {
      const link = document.createElement('link');
      link.id = 'yt-takeaways-content-css';
      link.rel = 'stylesheet';
      link.type = 'text/css';
      link.href = chrome.runtime.getURL('css/takeaways.css');
      document.head.appendChild(link);
    }
  },
  
  // Initialize for the current video
  initializeForCurrentVideo() {
    if (!this.utils.isWatchPage()) return;
    
    this.ui.waitForSecondaryInner(() => {
      this.ui.initializeUI().then(() => {
        this.ui.updateStatus('LOADING_VIDEO_DETAILS');
        this.setupVideoTracking();
      });
    });
  },
  
  // Setup video tracking and request takeaways
  setupVideoTracking() {
    const video = document.querySelector('video');
    if (!video) {
      console.log('[YT Takeaways] Video element not found, will retry');
      setTimeout(() => this.setupVideoTracking(), 500);
      return;
    }
    
    console.log('[YT Takeaways] Found video element, setting up tracking');
    
    // Clean up existing listeners
    video.removeEventListener('timeupdate', this.handleVideoTimeUpdate);
    
    // Add timeupdate listener for UI updates
    video.addEventListener('timeupdate', (e) => this.handleVideoTimeUpdate(e));
    
    // Request takeaways immediately
    this.requestTakeaways();
  },
  
  // Handle video time updates
  handleVideoTimeUpdate(e) {
    const video = e.target;
    const currentTime = video.currentTime;
    this.ui.updateTakeawayDisplay(video, currentTime, this.state.currentTakeaways?.takeaways);
  },
  
  // Request takeaways for the current video
  requestTakeaways() {
    const videoId = this.utils.getCurrentVideoId();
    if (!videoId) return;
    
    if (!this.state.processedVideos.has(videoId)) {
      console.log('[YT Takeaways] Requesting takeaways for video:', videoId);
      this.state.processedVideos.add(videoId);
      
      // Request takeaways, cache will be checked in the background script
      chrome.runtime.sendMessage({ type: 'NEW_VIDEO', videoId });
    }
  },
  
  // Handle retry button click
  handleRetry() {
    const videoId = this.utils.getCurrentVideoId();
    if (!videoId) return;
    
    console.log('[YT Takeaways] Retrying takeaway generation for:', videoId);
    
    // Force regeneration
    chrome.runtime.sendMessage({ 
      type: 'NEW_VIDEO', 
      videoId,
      forceRegenerate: true 
    });
    
    // Update UI to show regenerating state
    this.ui.showRegeneratingState();
  },
  
  // Handle YouTube navigation start
  handleNavigationStart() {
    console.log('[YT Takeaways] Navigation started - clearing state');
    
    // Reset state
    this.state.currentTakeaways = null;
    
    // Clear UI
    this.ui.clearUI();
  },
  
  // Handle YouTube navigation finish
  handleNavigationFinish() {
    console.log('[YT Takeaways] Navigation finished');
    if (this.utils.isWatchPage()) {
      this.initializeForCurrentVideo();
    }
  },
  
  // Setup message listeners for communication with background script
  setupMessageListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'PROCESSING_STATUS') {
        this.ui.updateStatus(message.status);
      } 
      else if (message.type === 'VIDEO_TAKEAWAYS') {
        this.handleTakeawaysReceived(message);
      } 
      else if (message.type === 'PROCESSING_ERROR') {
        this.ui.showError(message.error);
      }
    });
  },
  
  // Handle received takeaways data
  handleTakeawaysReceived(message) {
    // Process and store takeaways
    if (message.takeaways) {
      // Deduplicate takeaways
      if (message.takeaways.takeaways && Array.isArray(message.takeaways.takeaways)) {
        message.takeaways.takeaways = this.utils.deduplicateTakeaways(message.takeaways.takeaways);
        
        // Add a unique ID if not present
        if (!message.takeaways.id) {
          message.takeaways.id = Date.now().toString();
        }
      }
      
      // Store the takeaways
      this.state.currentTakeaways = message.takeaways;
      
      // Initialize UI and update display
      this.ui.initializeUI().then(() => {
        // Show the takeaways section
        this.ui.showTakeawaysSection();
        
        // Show cache indicator if needed
        if (message.fromCache) {
          this.ui.showCacheIndicator();
        }
        
        // Update the display with current video time
        const video = document.querySelector('video');
        if (video) {
          this.ui.updateTakeawayDisplay(video, video.currentTime, message.takeaways.takeaways);
        }
      });
    }
  },
  
  // Utility functions
  utils: {
    // Check if current page is a watch page
    isWatchPage() {
      return location.href.includes('youtube.com/watch');
    },
    
    // Get current video ID
    getCurrentVideoId() {
      const url = new URL(location.href);
      return url.searchParams.get('v');
    },
    
    // Deduplicate takeaways array
    deduplicateTakeaways(takeaways) {
      const uniqueTakeaways = [];
      const seen = new Set();
      
      for (const takeaway of takeaways) {
        if (!seen.has(takeaway.key_point)) {
          uniqueTakeaways.push(takeaway);
          seen.add(takeaway.key_point);
        }
      }
      
      return uniqueTakeaways;
    },
    
    // Format timestamp for display
    formatTimestamp(minutes) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return hours > 0 
        ? `${hours}:${mins.toString().padStart(2, '0')}`
        : `${mins}:00`;
    }
  },
  
  // UI-related functions
  ui: {
    // Initialize the UI
    async initializeUI() {
      if (YTTakeaways.state.isInjectingUI) return;
      YTTakeaways.state.isInjectingUI = true;
      
      try {
        const secondary = document.querySelector('#secondary-inner');
        if (!secondary) {
          YTTakeaways.state.isInjectingUI = false;
          return;
        }
    
        // Remove existing UI
        document.querySelectorAll('.yt-takeaways-card').forEach(el => el.remove());
    
        // Fetch and inject the HTML
        const htmlUrl = chrome.runtime.getURL('html/takeaways.html');
        const response = await fetch(htmlUrl);
        const htmlText = await response.text();
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlText;
    
        // Extract and insert the card
        const takeawaysCard = tempDiv.querySelector('.yt-takeaways-card');
        secondary.insertBefore(takeawaysCard, secondary.firstChild);
    
        // Replace icon placeholders
        takeawaysCard.querySelectorAll('img[src="__ICON_48__"]').forEach(img => {
          img.src = chrome.runtime.getURL('icons/icon48.png');
        });
    
        YTTakeaways.state.takeawaysContainer = takeawaysCard;
    
        // Hide the takeaways section by default
        const takeawaysSection = takeawaysCard.querySelector('.takeaways-section');
        if (takeawaysSection) {
          takeawaysSection.style.display = 'none';
        }
    
        // Attach event listeners
        this.setupEventListeners(takeawaysCard);
      } finally {
        YTTakeaways.state.isInjectingUI = false;
      }
    },
    
    // Setup event listeners for UI elements
    setupEventListeners(container) {
      // Tooltips for buttons
      container.querySelectorAll('.retry-button').forEach(button => {
        const tooltip = button.querySelector('.yt-tooltip');
        button.addEventListener('mouseenter', () => {
          tooltip.style.opacity = '1';
          tooltip.style.visibility = 'visible';
        });
        button.addEventListener('mouseleave', () => {
          tooltip.style.opacity = '0';
          tooltip.style.visibility = 'hidden';
        });
      });
    
      // Retry button
      container.querySelector('.retry-button').addEventListener('click', () => YTTakeaways.handleRetry());
    },
    
    // Update the takeaway display based on current video time
    updateTakeawayDisplay(video, currentTime, takeaways) {
      if (!takeaways) return;
      
      // Find relevant takeaways for current time
      const relevantTakeaways = this.findRelevantTakeaways(currentTime, takeaways);
      
      if (relevantTakeaways.length > 0) {
        this.updateTakeawayContent(relevantTakeaways);
      }
    },
    
    // Find takeaways relevant to the current video time
    findRelevantTakeaways(currentTime, takeaways) {
      if (!takeaways) return [];
    
      // Convert minutes to seconds for each takeaway
      const takeawaysWithSeconds = takeaways.map(takeaway => ({
        ...takeaway,
        startSeconds: takeaway.minute * 60
      }));
      
      // Sort takeaways by their start time
      takeawaysWithSeconds.sort((a, b) => a.startSeconds - b.startSeconds);
      
      // Find the current takeaway - the one with the highest start time that's less than or equal to current time
      let currentTakeaway = null;
      for (let i = takeawaysWithSeconds.length - 1; i >= 0; i--) {
        if (takeawaysWithSeconds[i].startSeconds <= currentTime) {
          currentTakeaway = takeawaysWithSeconds[i];
          break;
        }
      }
      
      return currentTakeaway ? [currentTakeaway] : [];
    },
    
    // Update the takeaway content in the UI
    updateTakeawayContent(relevantTakeaways) {
      const content = document.querySelector('.takeaways-content');
      const titleSpan = document.querySelector('.takeaways-title span');
      const container = document.querySelector('.yt-takeaways-card');
      
      if (!content || !titleSpan) return;
    
      // Create a string of all takeaway content to check for changes
      const newContent = relevantTakeaways.map(t => t.key_point).join('|||');
      if (content.dataset.currentTakeaway === newContent) return;
      
      // Update tracking
      content.dataset.currentTakeaway = newContent;
    
      if (relevantTakeaways.length > 0) {
        // Find the index of this takeaway in the full takeaways array
        const takeawayIndex = YTTakeaways.state.currentTakeaways.takeaways
          .findIndex(t => t.key_point === relevantTakeaways[0].key_point) + 1;
        
        // Format timestamp
        const timestamp = YTTakeaways.utils.formatTimestamp(relevantTakeaways[0].minute);
        
        // Update the header with the takeaway number and timestamp
        titleSpan.innerHTML = `Key Takeaway <strong>#${takeawayIndex}</strong> <span class="takeaway-header-timestamp">${timestamp}</span>`;
        
        // Display takeaway in the content area
        content.innerHTML = relevantTakeaways.map((takeaway, index) => `
          <div class="takeaway-item" style="
            padding: ${index === 0 ? '12px 0 8px 0' : '8px 0 12px 0'};
            ${index > 0 ? 'border-top: 1px solid rgba(0,0,0,0.1);' : ''}
          ">
            <span class="takeaway-text">${takeaway.key_point}</span>
          </div>
        `).join('');
    
        // Update all takeaways list
        this.updateAllTakeawaysList(container, relevantTakeaways);
      }
    },
    
    // Update the list of all takeaways
    updateAllTakeawaysList(container, currentTakeaways) {
      const allList = container.querySelector('.all-takeaways-list');
      if (!allList || !YTTakeaways.state.currentTakeaways?.takeaways) return;
      
      const currentKeys = new Set(currentTakeaways.map(t => t.key_point));
      
      // Only rebuild the list if it's not already populated
      if (allList.children.length === 0 || 
          allList.dataset.lastUpdated !== YTTakeaways.state.currentTakeaways.id) {
        
        // Sort takeaways by minute for the full list
        const sortedTakeaways = [...YTTakeaways.state.currentTakeaways.takeaways]
          .sort((a, b) => a.minute - b.minute);
        
        allList.innerHTML = sortedTakeaways.map(t => {
          // Format timestamp for each takeaway
          const ts = YTTakeaways.utils.formatTimestamp(t.minute);
          
          return `
            <div class="all-takeaway-item${currentKeys.has(t.key_point) ? ' current' : ''}" 
                 data-key="${t.key_point}" 
                 data-seconds="${t.minute * 60}">
              <div class="takeaway-dot"></div>
              <span class="takeaway-timestamp">${ts}</span>
              <span class="takeaway-content">${t.key_point}</span>
            </div>
          `;
        }).join('');
        
        allList.dataset.lastUpdated = YTTakeaways.state.currentTakeaways.id;
        
        // Add click handlers to jump to timestamp
        allList.querySelectorAll('.all-takeaway-item').forEach(item => {
          item.addEventListener('click', () => {
            const seconds = parseInt(item.dataset.seconds, 10);
            const video = document.querySelector('video');
            if (video && !isNaN(seconds)) {
              video.currentTime = seconds;
              video.play().catch(e => console.error('Failed to play video:', e));
            }
          });
        });
      } else {
        // Just update the current class
        Array.from(allList.querySelectorAll('.all-takeaway-item')).forEach(item => {
          const keyPoint = item.dataset.key;
          if (currentKeys.has(keyPoint)) {
            item.classList.add('current');
          } else {
            item.classList.remove('current');
          }
        });
      }
      
      // Scroll to the current takeaway
      this.scrollToCurrentTakeaway(allList);
    },
    
    // Scroll to the current takeaway in the list
    scrollToCurrentTakeaway(allList) {
      const currentItem = allList.querySelector('.all-takeaway-item.current');
      if (!currentItem) return;
      
      // Scroll the item into view with some padding
      const containerRect = allList.getBoundingClientRect();
      const itemRect = currentItem.getBoundingClientRect();
      
      // Calculate if the item is fully visible
      const isFullyVisible = 
        itemRect.top >= containerRect.top && 
        itemRect.bottom <= containerRect.bottom;
      
      if (!isFullyVisible) {
        // Scroll to position the item in the center
        const scrollTop = 
          itemRect.top + 
          allList.scrollTop - 
          containerRect.top - 
          (containerRect.height / 2) + 
          (itemRect.height / 2);
        
        allList.scrollTo({
          top: scrollTop,
          behavior: 'smooth'
        });
      }
    },
    
    // Update the status display
    updateStatus(status, error = null) {
      if (!YTTakeaways.state.takeawaysContainer) {
        this.initializeUI().then(() => this.updateStatus(status, error));
        return;
      }
    
      const content = YTTakeaways.state.takeawaysContainer.querySelector('.takeaways-content');
      const takeawaysSection = YTTakeaways.state.takeawaysContainer.querySelector('.takeaways-section');
      
      if (!content || !takeawaysSection) return;
    
      // Only update if the status is different or if it's an error
      if (content.dataset.currentStatus === status && status !== 'ERROR') {
        return;
      }
      
      const statusMessages = {
        LOADING_VIDEO_DETAILS: 'Loading video details...',
        CHECKING_RELEVANCE: 'Checking content type...',
        NOT_RELEVANT: 'This content is not suitable for generating takeaways.',
        GENERATING: 'Generating takeaways...',
        GENERATING_TAKEAWAYS: 'Generating takeaways...',
        ERROR: error || 'An error occurred'
      };
    
      // During loading or error states, only show the status in the header
      const isLoading = status === 'LOADING_VIDEO_DETAILS' || 
                      status === 'CHECKING_RELEVANCE' || 
                      status === 'GENERATING' || 
                      status === 'GENERATING_TAKEAWAYS';
      
      // Show status in the header
      const statusElement = YTTakeaways.state.takeawaysContainer.querySelector('.takeaways-status');
      if (statusElement) {
        statusElement.style.display = 'flex';
        const spinner = statusElement.querySelector('.takeaways-spinner');
        const span = statusElement.querySelector('span');
        if (spinner) spinner.style.display = isLoading ? 'block' : 'none';
        if (span) span.textContent = statusMessages[status] || '';
      }
      
      // Hide the takeaway section completely during loading/error
      if (isLoading || status === 'ERROR' || status === 'NOT_RELEVANT') {
        takeawaysSection.style.display = 'none';
      } else {
        takeawaysSection.style.display = 'block';
      }
      
      content.dataset.currentStatus = status;
    },
    
    // Show error state
    showError(error) {
      this.updateStatus('ERROR', error);
      
      const retryButton = document.querySelector('.retry-button');
      if (retryButton) {
        retryButton.style.opacity = '1';
        retryButton.style.cursor = 'pointer';
        retryButton.disabled = false;
      }
    },
    
    // Show regenerating state
    showRegeneratingState() {
      const statusElement = document.querySelector('.takeaways-status');
      const retryButton = document.querySelector('.retry-button');
      const takeawaysSection = document.querySelector('.takeaways-section');
      
      // Hide the takeaways section during regeneration
      if (takeawaysSection) {
        takeawaysSection.style.display = 'none';
      }
      
      if (statusElement) {
        statusElement.style.display = 'flex';
        const spinner = statusElement.querySelector('.takeaways-spinner');
        const span = statusElement.querySelector('span');
        if (spinner) spinner.style.display = 'block';
        if (span) span.textContent = 'Regenerating...';
      }
      
      if (retryButton) {
        retryButton.style.opacity = '0.5';
        retryButton.style.cursor = 'default';
        retryButton.disabled = true;
      }
    },
    
    // Show the takeaways section
    showTakeawaysSection() {
      const statusElement = document.querySelector('.takeaways-status');
      const retryButton = document.querySelector('.retry-button');
      const takeawaysSection = document.querySelector('.takeaways-section');
      
      // Reset status if it exists
      if (statusElement) {
        statusElement.style.display = 'none';
        const spinner = statusElement.querySelector('.takeaways-spinner');
        if (spinner) spinner.style.display = 'none';
        const span = statusElement.querySelector('span');
        if (span) span.textContent = '';
      }
      
      // Re-enable retry button if it exists
      if (retryButton) {
        retryButton.style.opacity = '1';
        retryButton.style.cursor = 'pointer';
        retryButton.disabled = false;
      }
      
      // Show the takeaways section
      if (takeawaysSection) {
        takeawaysSection.style.display = 'block';
      }
    },
    
    // Show cache indicator
    showCacheIndicator() {
      const statusElement = document.querySelector('.takeaways-status');
      if (statusElement) {
        statusElement.style.display = 'flex';
        const spinner = statusElement.querySelector('.takeaways-spinner');
        if (spinner) spinner.style.display = 'none';
        const span = statusElement.querySelector('span');
        if (span) {
          span.textContent = 'Loaded from cache';
          
          // Hide the cache indicator after 3 seconds
          setTimeout(() => {
            if (span.textContent === 'Loaded from cache') {
              statusElement.style.display = 'none';
            }
          }, 3000);
        }
      }
    },
    
    // Clear the UI
    clearUI() {
      const existingTakeaways = document.querySelector('.yt-takeaways-card');
      if (existingTakeaways) existingTakeaways.remove();
      YTTakeaways.state.takeawaysContainer = null;
    },
    
    // Wait for #secondary-inner to exist
    waitForSecondaryInner(callback) {
      const secondary = document.querySelector('#secondary-inner');
      if (secondary) {
        callback();
        return;
      }
      
      const observer = new MutationObserver(() => {
        const secondaryNow = document.querySelector('#secondary-inner');
        if (secondaryNow) {
          observer.disconnect();
          callback();
        }
      });
      
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }
};

// Initialize the extension
YTTakeaways.init();

