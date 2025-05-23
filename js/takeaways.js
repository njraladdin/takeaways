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

// UI Component Creation

// UI Updates
function updateProgressBar(video, currentTime) {
  const progressBar = document.querySelector('.video-progress');
  if (progressBar && video) {
    const progress = (currentTime / video.duration) * 100;
    progressBar.style.width = `${progress}%`;
  }
}

function updateTimeDisplay(currentTime) {
  const timeDisplay = document.querySelector('.current-time');
  if (timeDisplay) {
    const minutes = Math.floor(currentTime / 60);
    const seconds = Math.floor(currentTime % 60);
    timeDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}

function updateTakeawayVisibility(currentTime, takeaways) {
  const container = document.querySelector('.yt-video-takeaways');
  if (!container || !takeaways) {
    console.log('[YT Captions] No container or takeaways:', { container, takeaways });
    return [];
  }

  const currentMinute = Math.floor(currentTime / 60);
  const secondsIntoMinute = currentTime % 60;
  
  // Find all takeaways for the current minute
  let relevantTakeaways = [];
  
  // Find the highest minute that's less than or equal to current minute
  const validMinutes = takeaways
    .map(t => t.minute)
    .filter(m => m <= currentMinute);
  
  if (validMinutes.length > 0) {
    const lastValidMinute = Math.max(...validMinutes);
    
    // Only show takeaways after 10 seconds into the minute
    if (secondsIntoMinute >= 10 || lastValidMinute < currentMinute) {
      // Get all takeaways for that minute
      relevantTakeaways = takeaways.filter(t => t.minute === lastValidMinute);
    } else if (lastValidMinute < currentMinute) {
      // If we're in a new minute but before 10 seconds, show previous minute's takeaways
      const previousValidMinute = Math.max(...validMinutes.filter(m => m < currentMinute));
      if (previousValidMinute >= 0) {
        relevantTakeaways = takeaways.filter(t => t.minute === previousValidMinute);
      }
    }
  }

  // Update visibility
  container.style.opacity = relevantTakeaways.length ? '1' : '0';
  container.style.transform = relevantTakeaways.length ? 'translateY(0)' : 'translateY(10px)';

  // Update markers active state
  const markers = document.querySelectorAll('.markers-container > div');
  const takeawayDot = document.querySelector('.takeaway-dot');
  
  // Reset takeaway dot if no relevant takeaways
  if (!relevantTakeaways.length && takeawayDot) {
    takeawayDot.style.opacity = '0';
    takeawayDot.style.transform = 'scale(0)';
  }

  markers.forEach((marker, index) => {
    const minute = parseInt(marker.dataset.minute);
    const isActive = relevantTakeaways.some(t => t.minute === minute);
    
    const dot = marker.querySelector('div:nth-child(2)');
    const line = marker.querySelector('div:nth-child(1)');
    
    if (isActive) {
      marker.classList.add('active');
      dot.style.opacity = '1';
      dot.style.backgroundColor = '#ff0000';
      dot.style.transform = 'translateX(-50%) scale(1.5)';
      line.style.opacity = '0.7';
      line.style.backgroundColor = '#ff0000';
      
      // Reduced base push distance and adjusted falloff rate
      const basePushDistance = 4; // Reduced from 12 to 8
      const falloffRate = 0.6; // Reduced from 0.7 to 0.6 for faster falloff
      
      markers.forEach((otherMarker, otherIndex) => {
        if (otherIndex !== index) {
          const distance = Math.abs(otherIndex - index);
          const pushDistance = basePushDistance * Math.pow(falloffRate, distance - 1);
          const direction = otherIndex < index ? -1 : 1;
          otherMarker.style.transform = `translateX(calc(-50% + ${pushDistance * direction}px))`;
        }
      });
      
      // Show and animate the takeaway dot
      if (takeawayDot) {
        takeawayDot.style.opacity = '1';
        takeawayDot.style.transform = 'scale(1)';
      }
    } else {
      marker.classList.remove('active');
      dot.style.opacity = '0.5';
      dot.style.backgroundColor = '#065fd4';
      dot.style.transform = 'translateX(-50%) scale(1)';
      line.style.opacity = '0.3';
      line.style.backgroundColor = '#065fd4';
      
      // Only reset position if there are no active markers
      const hasActiveMarker = Array.from(markers).some(m => m.classList.contains('active'));
      if (!hasActiveMarker) {
        marker.style.transform = 'translateX(-50%)';
      }
    }
  });

  return relevantTakeaways;
}

// Markers Management
function createMarker(minute, duration) {
  const markerContainer = document.createElement('div');
  const position = ((minute * 60 + 10) / duration) * 100;
  
  markerContainer.style.cssText = `
    position: absolute;
    left: ${position}%;
    top: 0;
    transform: translateX(-50%);
    transition: transform 0.3s ease-out;
  `;

  // Create dot element with transition for size
  const dot = document.createElement('div');
  dot.style.cssText = `
    width: 6px;
    height: 6px;
    background: #065fd4;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 50%;
    transform: translateX(-50%) scale(1);
    opacity: 0.5;
    transition: opacity 0.3s, background-color 0.3s, transform 0.3s;
    z-index: 1;
  `;

  // Create duration line element
  const durationLine = document.createElement('div');
  durationLine.style.cssText = `
    position: absolute;
    left: 50%;
    width: ${(30 / duration) * 100 * 2}%;
    height: 2px;
    background: #065fd4;
    top: 4px;
    transform: translateX(-50%);
    opacity: 0.3;
    transition: opacity 0.3s, background-color 0.3s;
  `;

  markerContainer.appendChild(durationLine);
  markerContainer.appendChild(dot);
  
  markerContainer.dataset.minute = minute;

  markerContainer.addEventListener('mouseenter', () => {
    dot.style.opacity = '1';
    durationLine.style.opacity = '0.7';
  });
  
  markerContainer.addEventListener('mouseleave', () => {
    // Only reduce opacity if not active
    if (!markerContainer.classList.contains('active')) {
      dot.style.opacity = '0.5';
      durationLine.style.opacity = '0.3';
    }
  });

  return markerContainer;
}

function updateMarkers(video, takeaways) {
  if (!video?.duration || !takeaways) return;
  
  const container = document.querySelector('.markers-container');
  if (!container) return;

  container.innerHTML = '';
  takeaways.forEach(takeaway => {
    container.appendChild(createMarker(takeaway.minute, video.duration));
  });
}

// Main Update Function
function updateUI(video, currentTime, takeaways) {
  console.log('[YT Captions] UpdateUI called:', { currentTime, takeaways });
  
  updateTimeDisplay(currentTime);
  updateProgressBar(video, currentTime);
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
  chrome.storage.local.remove(`takeaways_${videoId}`);
  chrome.runtime.sendMessage({ type: 'NEW_VIDEO', videoId });
  
  // Show the unified status and disable retry button
  const statusElement = document.querySelector('.takeaways-status');
  const retryButton = document.querySelector('.retry-button');
  
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
  
  const content = document.querySelector('.takeaways-content');
  if (content) {
    content.innerHTML = '<div style="padding: 8px 0;">Generating new takeaways...</div>';
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
    document.querySelectorAll('.yt-takeaways-progress').forEach(el => el.remove());
    document.querySelectorAll('.yt-video-takeaways').forEach(el => el.remove());
    document.querySelectorAll('.yt-video-quiz').forEach(el => el.remove());

    // Fetch and inject the HTML
    const htmlUrl = chrome.runtime.getURL('html/takeaways.html');
    const response = await fetch(htmlUrl);
    const htmlText = await response.text();
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlText;

    // Extract the relevant elements
    const progressUI = tempDiv.querySelector('.yt-takeaways-progress');
    const takeawaysCard = tempDiv.querySelector('.yt-video-takeaways');
    const quizCard = tempDiv.querySelector('.yt-video-quiz');

    // Insert into the DOM
    secondary.insertBefore(progressUI, secondary.firstChild);
    secondary.insertBefore(takeawaysCard, progressUI.nextSibling);
    secondary.insertBefore(quizCard, takeawaysCard.nextSibling);

    // Replace icon placeholders with extension URLs
    [progressUI, takeawaysCard, quizCard].forEach(card => {
      card.querySelectorAll('img[src="__ICON_48__"]').forEach(img => {
        img.src = chrome.runtime.getURL('icons/icon48.png');
      });
    });

    takeawaysContainer = takeawaysCard;

    // Attach event listeners (retry, play quiz, tooltips, etc.)
    // Tooltips for buttons
    const buttons = progressUI.querySelectorAll('.play-quiz-button, .retry-button');
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
    progressUI.querySelector('.retry-button').addEventListener('click', handleRetry);

    // Play quiz button
    progressUI.querySelector('.play-quiz-button').addEventListener('click', () => {
      const quizCard = document.querySelector('.yt-video-quiz');
      if (quizCard && currentTakeaways?.quiz) {
        quizCard.style.display = 'block';
        initializeQuiz(currentTakeaways.quiz);
      }
    });

    // Hover effect for play quiz button
    const playQuizButton = progressUI.querySelector('.play-quiz-button');
    playQuizButton.addEventListener('mouseenter', () => {
      playQuizButton.style.backgroundColor = '#e5e5e5';
    });
    playQuizButton.addEventListener('mouseleave', () => {
      playQuizButton.style.backgroundColor = '#f2f2f2';
    });

    if (currentTakeaways) {
      const video = document.querySelector('video');
      updateMarkers(video, currentTakeaways.takeaways);
    }
  } finally {
    isInjectingUI = false;
  }
}

function checkTimeRequirements(video) {
  const tabOpenDuration = (Date.now() - tabOpenTime) / 1000;
  
  if (tabOpenDuration >= MIN_TIME_REQUIRED && videoPlaybackTime >= MIN_TIME_REQUIRED) {
    const videoId = new URL(location.href).searchParams.get('v');
    if (!processedVideos.has(videoId)) {
      console.log('[YT Captions] Time requirements met, checking cache');
      processedVideos.add(videoId);
      
      // Check cache first
      chrome.storage.local.get(`takeaways_${videoId}`, (result) => {
        if (result[`takeaways_${videoId}`]) {
          console.log('[YT Captions] Found cached takeaways');
          currentTakeaways = result[`takeaways_${videoId}`];
          initializeUI(); // Only create UI when we have cached data
          updateMarkers(video, currentTakeaways.takeaways);
          updateUI(video, video.currentTime, currentTakeaways.takeaways);
        } else {
          console.log('[YT Captions] No cache found, requesting new takeaways');
          // Don't create UI yet, wait for relevance check
          chrome.runtime.sendMessage({ type: 'NEW_VIDEO', videoId });
        }
      });
    }
  }
}

// Add this new function to handle the typewriter effect
function typewriterEffect(element, text, speed = 10) {
  let index = 0;
  element.textContent = '';
  
  // Store the full text for instant display later
  element.dataset.fullText = text;
  
  function type() {
    if (index < text.length) {
      element.textContent += text.charAt(index);
      index++;
      setTimeout(type, speed);
    }
  }
  
  type();
}

function updateTakeawayContent(relevantTakeaways) {
  const content = document.querySelector('.takeaways-content');
  const titleSpan = document.querySelector('.takeaways-title span');
  const takeawayDot = document.querySelector('.takeaway-dot');
  const container = document.querySelector('.yt-video-takeaways');
  
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
  
  // Track if these takeaways are being shown for the first time
  const isFirstShow = content.dataset.currentTakeaway === undefined || 
                     !content.dataset.shownTakeaways?.includes(newContent);
  
  // Update tracking
  content.dataset.currentTakeaway = newContent;
  content.dataset.shownTakeaways = content.dataset.shownTakeaways 
    ? `${content.dataset.shownTakeaways},${newContent}`
    : newContent;

  if (uniqueTakeaways.length > 0) {
    let wipeOverlay = container.querySelector('.wipe-overlay');
    if (!wipeOverlay) {
      wipeOverlay = document.createElement('div');
      wipeOverlay.className = 'wipe-overlay';
      wipeOverlay.innerHTML = `
        <div class="wipe-overlay-content">
          <div class="logo-container">
            <svg class="thinking-lines" viewBox="0 0 100 100">
              <path class="sparkle-1" d="M20,20 L22,22 M20,24 L22,22 M24,20 L22,22 M24,24 L22,22"/>
              <path class="sparkle-2" d="M80,20 L82,22 M80,24 L82,22 M84,20 L82,22 M84,24 L82,22"/>
              <path class="sparkle-3" d="M20,80 L22,82 M20,84 L22,82 M24,80 L22,82 M24,84 L22,82"/>
              <path class="sparkle-4" d="M80,80 L82,82 M80,84 L82,82 M84,80 L82,82 M84,84 L82,82"/>
              <path class="sparkle-5" d="M50,10 L52,12 M50,14 L52,12 M54,10 L52,12 M54,14 L52,12"/>
              <path class="sparkle-6" d="M50,90 L52,92 M50,94 L52,92 M54,90 L52,92 M54,94 L52,92"/>
            </svg>
            <img src="${chrome.runtime.getURL('icons/icon48.png')}" 
                 class="wipe-overlay-logo" 
                 alt="Logo">
          </div>
        </div>
      `;
      container.appendChild(wipeOverlay);
    }

    // Start wipe-in transition
    wipeOverlay.style.transform = 'scaleX(1)';
    
    // Wait longer (500ms) before updating content
    setTimeout(() => {
      // Update content while overlay is covering
      // Find the index of this takeaway in the full takeaways array
      const takeawayIndex = currentTakeaways.takeaways.findIndex(t => t.key_point === uniqueTakeaways[0].key_point) + 1;
      titleSpan.textContent = `Key Takeaway${uniqueTakeaways.length > 1 ? 's' : ''} #${takeawayIndex}`;
      
      content.innerHTML = uniqueTakeaways.map((takeaway, index) => `
        <div class="takeaway-item" style="
          padding: ${index === 0 ? '8px 0 4px 0' : '4px 0 8px 0'}; 
          text-shadow: none;
          ${index > 0 ? 'border-top: 1px solid rgba(0,0,0,0.1);' : ''}
        ">
          <span class="takeaway-text"></span>
        </div>
      `).join('');
      
      const textElements = content.querySelectorAll('.takeaway-text');
      
      // Flash the dot
      if (takeawayDot) {
        takeawayDot.style.transform = 'scale(1.5)';
        setTimeout(() => {
          takeawayDot.style.transform = 'scale(1)';
        }, 300);
      }

      // Start wipe-out transition after a longer delay (800ms)
      setTimeout(() => {
        wipeOverlay.style.transform = 'scaleX(0)';
      }, 800);

      // Delay the typewriter effect to account for longer overlay
      textElements.forEach((element, index) => {
        if (isFirstShow) {
          setTimeout(() => {
            typewriterEffect(element, uniqueTakeaways[index].key_point);
          }, index * 1000 + 1100); // Increased delay to account for longer overlay
        } else {
          element.textContent = uniqueTakeaways[index].key_point;
        }
      });

      // --- Render all takeaways list ---
      const allList = container.querySelector('.all-takeaways-list');
      if (allList && currentTakeaways?.takeaways) {
        const currentKeys = new Set(uniqueTakeaways.map(t => t.key_point));
        allList.innerHTML = currentTakeaways.takeaways.map((t, i) => `
          <div class="all-takeaway-item${currentKeys.has(t.key_point) ? ' current' : ''}">
            <span style="font-size:12px;color:#888;margin-right:8px;">${i+1}.</span> ${t.key_point}
          </div>
        `).join('');
      }
      // ---
    }, 500); // Increased delay before content update
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
  video.addEventListener('durationchange', () => {
    if (currentTakeaways) {
      updateMarkers(video, currentTakeaways.takeaways);
    }
  });
  
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
        initializeUI();
        setTimeout(() => {
          updateMarkers(video, currentTakeaways.takeaways);
          updateUI(video, video.currentTime, currentTakeaways.takeaways);
        }, 100);
      }
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
  const existingProgress = document.querySelector('.yt-takeaways-progress');
  const existingTakeaways = document.querySelector('.yt-video-takeaways');
  const existingQuiz = document.querySelector('.yt-video-quiz');
  
  if (existingProgress) existingProgress.remove();
  if (existingTakeaways) existingTakeaways.remove();
  if (existingQuiz) existingQuiz.remove();
  
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
    initializeUI();
    updateTakeawaysStatus('LOADING_VIDEO_DETAILS');
    checkForVideo();
  });
}

// Handle YouTube's navigation events
document.addEventListener('yt-navigate-finish', () => {
  console.log('[YT Captions] Navigation finished');
  if (location.href.includes('youtube.com/watch')) {
    waitForSecondaryInner(() => {
      initializeUI();
      updateTakeawaysStatus('LOADING_VIDEO_DETAILS');
      checkForVideo();
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
  if (!content) return;

  // Only update if the status is different or if it's an error
  if (content.dataset.currentStatus === status && status !== 'ERROR') {
    return;
  }
  
  const statusMessages = {
    LOADING_VIDEO_DETAILS: 'Loading video details...',
    CHECKING_RELEVANCE: 'Checking content type...',
    NOT_RELEVANT: 'This content is not suitable for generating takeaways.',
    GENERATING: 'Generating takeaways...',
    ERROR: error || 'An error occurred'
  };

  // Add fade transition
  content.style.opacity = '0';
  setTimeout(() => {
    content.innerHTML = `
      <div style="padding: 8px 0;">
        ${statusMessages[status]}
        ${status === 'GENERATING' ? '<div class="loading-spinner"></div>' : ''}
      </div>
    `;
    content.dataset.currentStatus = status;
    content.style.opacity = '1';
  }, 150);
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
    const loadingUI = document.querySelector('.yt-takeaways-progress.initial-loading');
    const statusElement = document.querySelector('.takeaways-status');
    const retryButton = document.querySelector('.retry-button');
    
    // Remove loading UI
    if (loadingUI) {
      loadingUI.remove();
    }
    
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
    initializeUI();
    
    // Handle the takeaways data
    if (message.takeaways) {
      currentTakeaways = message.takeaways;
      const video = document.querySelector('video');
      if (video) {
        updateMarkers(video, message.takeaways.takeaways);
        updateUI(video, video.currentTime, message.takeaways.takeaways);
      }
    }
  } else if (message.type === 'PROCESSING_ERROR') {
    // Clear loading states and show error
    const loadingUI = document.querySelector('.yt-takeaways-progress.initial-loading');
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

    // Remove loading UI after showing error
    setTimeout(() => {
      if (loadingUI) {
        loadingUI.remove();
      }
    }, 3000);
  }
});

