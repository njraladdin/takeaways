console.log('[YT Captions] Content script loaded');

const processedVideos = new Set();
const MIN_TIME_REQUIRED = 3; // 3 seconds for testing 

// Track tab open time
const tabOpenTime = Date.now();
let videoPlaybackTime = 0;
let videoTimeUpdateListener = null;

let currentTakeaways = null;
let takeawaysContainer = null;

let isInjectingUI = false;

// At the top of the file, inject the content CSS if not already present
(function injectContentCSS() {
  if (!document.getElementById('yt-takeaways-content-css')) {
    const link = document.createElement('link');
    link.id = 'yt-takeaways-content-css';
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = chrome.runtime.getURL('css/takeaways.css');
    document.head.appendChild(link);
  }
})();

// UI Updates
function updateTakeawayVisibility(currentTime, takeaways) {
  if (!takeaways) {
    return [];
  }

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
  
  const takeawayDot = document.querySelector('.takeaway-dot');
  
  // Reset takeaway dot if no current takeaway
  if (!currentTakeaway && takeawayDot) {
    takeawayDot.style.opacity = '0';
    takeawayDot.style.transform = 'scale(0)';
    return [];
  } else if (takeawayDot) {
    takeawayDot.style.opacity = '1';
    takeawayDot.style.transform = 'scale(1)';
  }

  return currentTakeaway ? [currentTakeaway] : [];
}

// Main Update Function
function updateUI(video, currentTime, takeaways) {
  console.log('[YT Captions] UpdateUI called:', { currentTime, takeaways });
  
  const relevantTakeaways = updateTakeawayVisibility(currentTime, takeaways);
  
  if (relevantTakeaways?.length) {
    console.log('[YT Captions] Updating takeaway content with:', relevantTakeaways);
    updateTakeawayContent(relevantTakeaways);
  }
}

// Event Handlers
function handleVideoTimeUpdate(e) {
  const video = e.target;
  const currentTime = video.currentTime;
  updateUI(video, currentTime, currentTakeaways?.takeaways);
}

function handleRetry() {
  const videoId = new URL(location.href).searchParams.get('v');
  // Force regeneration by setting forceRegenerate flag
  chrome.runtime.sendMessage({ 
    type: 'NEW_VIDEO', 
    videoId,
    forceRegenerate: true 
  });
  
  // Show the unified status and disable retry button
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
}

// Refactored initializeUI to inject HTML from html/takeaways.html
async function initializeUI() {
  if (isInjectingUI) return;
  isInjectingUI = true;
  try {
    const secondary = document.querySelector('#secondary-inner');
    if (!secondary) {
      isInjectingUI = false;
      return;
    }

    // Remove ALL existing UI (in case there are multiple)
    document.querySelectorAll('.yt-takeaways-card').forEach(el => el.remove());

    // Fetch and inject the HTML
    const htmlUrl = chrome.runtime.getURL('html/takeaways.html');
    const response = await fetch(htmlUrl);
    const htmlText = await response.text();
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlText;

    // Extract the relevant elements
    const takeawaysCard = tempDiv.querySelector('.yt-takeaways-card');

    // Insert into the DOM
    secondary.insertBefore(takeawaysCard, secondary.firstChild);

    // Replace icon placeholders with extension URLs
    takeawaysCard.querySelectorAll('img[src="__ICON_48__"]').forEach(img => {
      img.src = chrome.runtime.getURL('icons/icon48.png');
    });

    takeawaysContainer = takeawaysCard;

    // Hide the takeaways section by default until we have actual takeaways
    const takeawaysSection = takeawaysCard.querySelector('.takeaways-section');
    if (takeawaysSection) {
      takeawaysSection.style.display = 'none';
    }

    // Attach event listeners
    // Tooltips for buttons
    const buttons = takeawaysCard.querySelectorAll('.retry-button');
    buttons.forEach(button => {
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
    takeawaysCard.querySelector('.retry-button').addEventListener('click', handleRetry);
  } finally {
    isInjectingUI = false;
  }
}

function updateTakeawayContent(relevantTakeaways) {
  const content = document.querySelector('.takeaways-content');
  const titleSpan = document.querySelector('.takeaways-title span');
  const takeawayDot = document.querySelector('.takeaway-dot');
  const container = document.querySelector('.yt-takeaways-card');
  
  if (!content || !titleSpan) return;

  // Deduplicate by key_point
  const uniqueTakeaways = [];
  const seen = new Set();
  for (const t of relevantTakeaways) {
    if (!seen.has(t.key_point)) {
      uniqueTakeaways.push(t);
      seen.add(t.key_point);
    }
  }
  if (uniqueTakeaways.length < relevantTakeaways.length) {
    console.warn('[YT Captions] Duplicate key takeaways detected and removed:', relevantTakeaways);
  }

  // Create a string of all takeaway content to check for changes
  const newContent = uniqueTakeaways.map(t => t.key_point).join('|||');
  if (content.dataset.currentTakeaway === newContent) return;
  
  // Update tracking
  content.dataset.currentTakeaway = newContent;

  if (uniqueTakeaways.length > 0) {
    // Find the index of this takeaway in the full takeaways array
    const takeawayIndex = currentTakeaways.takeaways.findIndex(t => t.key_point === uniqueTakeaways[0].key_point) + 1;
    
    // Format timestamp
    const minutes = uniqueTakeaways[0].minute;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const timestamp = hours > 0 
      ? `${hours}:${mins.toString().padStart(2, '0')}`
      : `${mins}:00`;
    
    // Update the header with the takeaway number and timestamp
    titleSpan.innerHTML = `Key Takeaway <strong>#${takeawayIndex}</strong> <span class="takeaway-header-timestamp">${timestamp}</span>`;
    
    // Display takeaway in the content area
    content.innerHTML = uniqueTakeaways.map((takeaway, index) => `
      <div class="takeaway-item" style="
        padding: ${index === 0 ? '12px 0 8px 0' : '8px 0 12px 0'};
        ${index > 0 ? 'border-top: 1px solid rgba(0,0,0,0.1);' : ''}
      ">
        <span class="takeaway-text">${takeaway.key_point}</span>
      </div>
    `).join('');
    
    // Flash the dot
    if (takeawayDot) {
      takeawayDot.style.opacity = '1';
      takeawayDot.style.transform = 'scale(1.5)';
      setTimeout(() => {
        takeawayDot.style.transform = 'scale(1)';
      }, 300);
    }

    // Update all takeaways list
    const allList = container.querySelector('.all-takeaways-list');
    if (allList && currentTakeaways?.takeaways) {
      const currentKeys = new Set(uniqueTakeaways.map(t => t.key_point));
      
      // Only rebuild the list if it's not already populated
      if (allList.children.length === 0 || allList.dataset.lastUpdated !== currentTakeaways.id) {
        // First, deduplicate the takeaways in the full list
        const uniqueFullTakeaways = [];
        const seenFullTakeaways = new Set();
        
        for (const takeaway of currentTakeaways.takeaways) {
          if (!seenFullTakeaways.has(takeaway.key_point)) {
            uniqueFullTakeaways.push(takeaway);
            seenFullTakeaways.add(takeaway.key_point);
          }
        }
        
        // Sort takeaways by minute for the full list
        const sortedTakeaways = [...uniqueFullTakeaways].sort((a, b) => a.minute - b.minute);
        
        allList.innerHTML = sortedTakeaways.map((t, i) => {
          // Format timestamp for each takeaway
          const mins = t.minute;
          const hrs = Math.floor(mins / 60);
          const m = mins % 60;
          const ts = hrs > 0 
            ? `${hrs}:${m.toString().padStart(2, '0')}`
            : `${m}:00`;
          
          return `
            <div class="all-takeaway-item${currentKeys.has(t.key_point) ? ' current' : ''}" data-key="${t.key_point}" data-seconds="${t.minute * 60}">
              <div class="takeaway-dot"></div>
              <span class="takeaway-timestamp">${ts}</span>
              <span class="takeaway-content">${t.key_point}</span>
            </div>
          `;
        }).join('');
        
        allList.dataset.lastUpdated = currentTakeaways.id;
        
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
      const currentItem = allList.querySelector('.all-takeaway-item.current');
      if (currentItem) {
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
      }
    }
  }
}

// Add event listener for video seeking
function setupVideoSeekListener(video) {
  video.addEventListener('seeking', () => {
    const textElement = document.querySelector('.takeaway-text');
    if (textElement && textElement.dataset.fullText) {
      // Show full text immediately when seeking
      textElement.textContent = textElement.dataset.fullText;
    }
  });
}

// Update your existing video setup code to include the seek listener
function setupVideoTracking(video) {
  videoPlaybackTime = 0;
  
  if (videoTimeUpdateListener) {
    video.removeEventListener('timeupdate', videoTimeUpdateListener);
  }
  
  videoTimeUpdateListener = (e) => {
    videoPlaybackTime = e.target.currentTime;
    checkTimeRequirements(video);
    updateUI(e.target, videoPlaybackTime, currentTakeaways?.takeaways);
  };
  
  video.addEventListener('timeupdate', videoTimeUpdateListener);
  
  setupVideoSeekListener(video);
}

function checkForVideo() {
  if (location.href.includes('youtube.com/watch')) {
    const video = document.querySelector('video');
    if (video) {
      console.log('[YT Captions] Found video element');
      setupVideoTracking(video);
      
      // Force initial UI creation if we already have takeaways
      if (currentTakeaways) {
        initializeUI().then(() => {
          updateUI(video, video.currentTime, currentTakeaways.takeaways);
        });
      } else {
        // Initialize UI with loading state if no takeaways yet
        initializeUI().then(() => {
          updateTakeawaysStatus('LOADING_VIDEO_DETAILS');
        });
      }
    }
  }
}

function checkTimeRequirements(video) {
  const tabOpenDuration = (Date.now() - tabOpenTime) / 1000;
  
  if (tabOpenDuration >= MIN_TIME_REQUIRED && videoPlaybackTime >= MIN_TIME_REQUIRED) {
    const videoId = new URL(location.href).searchParams.get('v');
    if (!processedVideos.has(videoId)) {
      console.log('[YT Captions] Time requirements met, requesting takeaways');
      processedVideos.add(videoId);
      
      // Request takeaways, cache will be checked in the background script
      chrome.runtime.sendMessage({ type: 'NEW_VIDEO', videoId });
    }
  }
}

// Navigation handling
document.addEventListener('yt-navigate-start', () => {
  console.log('[YT Captions] Navigation started - clearing state');
  
  // Clear video listener
  if (videoTimeUpdateListener) {
    const video = document.querySelector('video');
    if (video) {
      video.removeEventListener('timeupdate', videoTimeUpdateListener);
    }
    videoTimeUpdateListener = null;
  }
  
  // Reset all state
  videoPlaybackTime = 0;
  currentTakeaways = null;
  
  // Clear UI
  const existingTakeaways = document.querySelector('.yt-takeaways-card');
  
  if (existingTakeaways) existingTakeaways.remove();
  
  takeawaysContainer = null;
});

// Utility: Wait for #secondary-inner to exist
function waitForSecondaryInner(callback) {
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

// Initialize on page load
if (location.href.includes('youtube.com/watch')) {
  waitForSecondaryInner(() => {
    initializeUI().then(() => {
      updateTakeawaysStatus('LOADING_VIDEO_DETAILS');
      checkForVideo();
    });
  });
}

// Handle YouTube's navigation events
document.addEventListener('yt-navigate-finish', () => {
  console.log('[YT Captions] Navigation finished');
  if (location.href.includes('youtube.com/watch')) {
    waitForSecondaryInner(() => {
      initializeUI().then(() => {
        updateTakeawaysStatus('LOADING_VIDEO_DETAILS');
        checkForVideo();
      });
    });
  }
});

// Refactored to be async-aware and prevent null errors
async function updateTakeawaysStatus(status, error = null, _retry = false) {
  if (!takeawaysContainer) {
    await initializeUI();
    // Only retry once to avoid infinite loops
    if (!_retry) {
      return updateTakeawaysStatus(status, error, true);
    } else {
      // If still not set, abort
      return;
    }
  }

  const content = takeawaysContainer.querySelector('.takeaways-content');
  const titleSpan = takeawaysContainer.querySelector('.takeaways-title span');
  const takeawayDot = takeawaysContainer.querySelector('.takeaway-dot');
  const takeawaysHeader = takeawaysContainer.querySelector('.takeaways-header');
  const takeawaysSection = takeawaysContainer.querySelector('.takeaways-section');
  const allTakeawaysList = takeawaysContainer.querySelector('.all-takeaways-list');
  
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
  const statusElement = takeawaysContainer.querySelector('.takeaways-status');
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
}

// Update the message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PROCESSING_STATUS') {
    const statusElement = document.querySelector('.takeaways-status');
    if (statusElement) {
      statusElement.style.display = 'flex';
      const spinner = statusElement.querySelector('.takeaways-spinner');
      const span = statusElement.querySelector('span');
      if (spinner) spinner.style.display = (message.status === 'GENERATING_TAKEAWAYS' || message.status === 'LOADING_VIDEO_DETAILS' || message.status === 'CHECKING_RELEVANCE') ? 'block' : 'none';
      if (span) {
        if (message.status === 'LOADING_VIDEO_DETAILS') span.textContent = 'Loading video details...';
        else if (message.status === 'CHECKING_RELEVANCE') span.textContent = 'Checking content type...';
        else if (message.status === 'GENERATING_TAKEAWAYS') span.textContent = 'Generating takeaways...';
        else span.textContent = '';
      }
    }
    updateTakeawaysStatus(message.status);
  } else if (message.type === 'VIDEO_TAKEAWAYS') {
    // Clear any loading states
    const statusElement = document.querySelector('.takeaways-status');
    const retryButton = document.querySelector('.retry-button');
    
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

    // Initialize the full UI
    initializeUI().then(() => {
      // Show the takeaways section now that we have data
      const takeawaysSection = document.querySelector('.takeaways-section');
      if (takeawaysSection) {
        takeawaysSection.style.display = 'block';
      }
      
      // Handle the takeaways data
      if (message.takeaways) {
        // Deduplicate takeaways before storing them
        if (message.takeaways.takeaways && Array.isArray(message.takeaways.takeaways)) {
          const uniqueTakeaways = [];
          const seen = new Set();
          
          for (const takeaway of message.takeaways.takeaways) {
            if (!seen.has(takeaway.key_point)) {
              uniqueTakeaways.push(takeaway);
              seen.add(takeaway.key_point);
            }
          }
          
          // Replace with deduplicated array
          message.takeaways.takeaways = uniqueTakeaways;
          
          // Add a unique ID to the takeaways object if not present
          if (!message.takeaways.id) {
            message.takeaways.id = Date.now().toString();
          }
        }
        
        currentTakeaways = message.takeaways;
        
        // Show a small indicator if the takeaways were loaded from cache
        if (message.fromCache) {
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
        }
        
        const video = document.querySelector('video');
        if (video) {
          updateUI(video, video.currentTime, message.takeaways.takeaways);
        }
      }
    });
  } else if (message.type === 'PROCESSING_ERROR') {
    // Clear loading states and show error
    const statusElement = document.querySelector('.takeaways-status');
    const retryButton = document.querySelector('.retry-button');
    
    if (statusElement) {
      statusElement.style.display = 'flex';
      const spinner = statusElement.querySelector('.takeaways-spinner');
      if (spinner) spinner.style.display = 'none';
      const span = statusElement.querySelector('span');
      if (span) span.textContent = message.error || 'An error occurred';
    }
    
    if (retryButton) {
      retryButton.style.opacity = '1';
      retryButton.style.cursor = 'pointer';
      retryButton.disabled = false;
    }

    updateTakeawaysStatus('ERROR', message.error);
  }
});

