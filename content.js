console.log('[YT Captions] Content script loaded');

const processedVideos = new Set();
const MIN_TIME_REQUIRED = 3; // 3 seconds for testing 

// Track tab open time
const tabOpenTime = Date.now();
let videoPlaybackTime = 0;
let videoTimeUpdateListener = null;

let currentTakeaways = null;
let takeawaysContainer = null;

function createTakeawaysUI() {
  // Remove existing container if any
  if (takeawaysContainer) {
    takeawaysContainer.remove();
  }

  // Create container
  takeawaysContainer = document.createElement('div');
  takeawaysContainer.className = 'yt-video-takeaways';
  takeawaysContainer.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.12);
  `;

  // Add header with playback time
  const header = document.createElement('div');
  header.style.cssText = `
    font-size: 16px;
    font-weight: 500;
    margin-bottom: 12px;
    color: #030303;
    display: flex;
    justify-content: space-between;
    text-shadow: none;
  `;
  header.innerHTML = `
    <span>Key Takeaways</span>
    <span class="current-time" style="color: #606060; font-size: 14px;">
      Current Time: 0:00
    </span>
  `;
  takeawaysContainer.appendChild(header);

  // Add content container
  const content = document.createElement('div');
  content.className = 'takeaways-content';
  content.style.cssText = `
    font-size: 14px;
    color: #606060;
    text-shadow: none;
  `;
  takeawaysContainer.appendChild(content);

  // Insert into page
  const secondary = document.querySelector('#secondary-inner');
  if (secondary) {
    secondary.insertBefore(takeawaysContainer, secondary.firstChild);
  }
}

function updateActiveTakeaway(currentMinute) {
  if (!takeawaysContainer) return;

  // Update current time display
  const timeDisplay = takeawaysContainer.querySelector('.current-time');
  if (timeDisplay) {
    const minutes = Math.floor(videoPlaybackTime / 60);
    const seconds = Math.floor(videoPlaybackTime % 60);
    timeDisplay.textContent = `Current Time: ${minutes}:${seconds.toString().padStart(2, '0')}`;
    console.log('[YT Captions] Updated time display:', `${minutes}:${seconds}`);
  }

  // Debug logging
  console.log('[YT Captions] Updating takeaways for minute:', currentMinute);
  console.log('[YT Captions] Current takeaways:', currentTakeaways);

  const content = takeawaysContainer.querySelector('.takeaways-content');
  if (!content) return;

  if (!currentTakeaways || !currentTakeaways.takeaways) {
    content.innerHTML = '<div style="padding: 8px 0;">Waiting for takeaways data...</div>';
    return;
  }

  // Find relevant takeaways for current minute
  const relevantTakeaways = currentTakeaways.takeaways.filter(t => 
    t.minute === currentMinute
  );

  console.log('[YT Captions] Relevant takeaways:', relevantTakeaways);

  if (relevantTakeaways.length > 0) {
    content.innerHTML = relevantTakeaways.map(takeaway => `
      <div class="takeaway-item" style="
        padding: 8px 0;
        border-bottom: 1px solid #e5e5e5;
        text-shadow: none;
      ">
        <div style="
          font-weight: 500;
          color: #030303;
          margin-bottom: 4px;
          text-shadow: none;
        ">${takeaway.minute}</div>
        <div style="text-shadow: none;">${takeaway.key_point}</div>
        <div style="
          display: flex;
          gap: 16px;
          margin-top: 4px;
          font-size: 12px;
          color: #606060;
          text-shadow: none;
        ">
          <span>Significance: ${takeaway.significanceScore}%</span>
          <span>Interest: ${takeaway.interestScore}%</span>
        </div>
      </div>
    `).join('');
  } else {
    content.innerHTML = '<div style="padding: 8px 0;">No insights for current minute...</div>';
  }
}

function checkTimeRequirements(video) {
  const tabOpenDuration = (Date.now() - tabOpenTime) / 1000; // Convert to seconds
  
  if (tabOpenDuration >= MIN_TIME_REQUIRED && videoPlaybackTime >= MIN_TIME_REQUIRED) {
    const videoId = new URL(location.href).searchParams.get('v');
    if (!processedVideos.has(videoId)) {
      console.log('[YT Captions] Time requirements met, processing video');
      processedVideos.add(videoId);
      chrome.runtime.sendMessage({ type: 'NEW_VIDEO', videoId });
      
      // Remove this part - we want to keep tracking time for takeaways
      // if (videoTimeUpdateListener) {
      //   video.removeEventListener('timeupdate', videoTimeUpdateListener);
      //   videoTimeUpdateListener = null;
      // }
    }
  }
}

function setupVideoTracking(video) {
  // Reset playback time for new video
  videoPlaybackTime = 0;
  
  // Remove existing listener if any
  if (videoTimeUpdateListener) {
    video.removeEventListener('timeupdate', videoTimeUpdateListener);
  }
  
  // Create new listener
  videoTimeUpdateListener = (e) => {
    videoPlaybackTime = e.target.currentTime;
    checkTimeRequirements(video);
    
    // Update takeaways based on current video time
    const currentMinute = Math.floor(videoPlaybackTime / 60);
    updateActiveTakeaway(currentMinute);
  };
  
  video.addEventListener('timeupdate', videoTimeUpdateListener);
}

function checkForVideo() {
  if (location.href.includes('youtube.com/watch')) {
    // Find video element and setup tracking
    const video = document.querySelector('video');
    if (video) {
      console.log('[YT Captions] Found video element:', video);
      setupVideoTracking(video);
      
      // Force initial UI creation if we already have takeaways
      if (currentTakeaways) {
        createTakeawaysUI();
        updateActiveTakeaway(Math.floor(video.currentTime / 60));
      }
    }
  }
}

// Clear processed videos and reset time when navigating
document.addEventListener('yt-navigate-start', () => {
  processedVideos.clear();
  videoPlaybackTime = 0;
  if (videoTimeUpdateListener) {
    const video = document.querySelector('video');
    if (video) {
      video.removeEventListener('timeupdate', videoTimeUpdateListener);
    }
    videoTimeUpdateListener = null;
  }
  currentTakeaways = null;
  if (takeawaysContainer) {
    takeawaysContainer.remove();
    takeawaysContainer = null;
  }
});

// Check on initial load and subsequent navigations
checkForVideo();
document.addEventListener('yt-navigate-finish', checkForVideo);

// Listen for takeaways from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'VIDEO_TAKEAWAYS') {
    console.log('[YT Captions] Received takeaways:', message.takeaways);
    console.log('[YT Captions] Takeaways structure:', JSON.stringify(message.takeaways, null, 2));
    currentTakeaways = message.takeaways;
    createTakeawaysUI();
    // Force an initial update
    const currentMinute = Math.floor(videoPlaybackTime / 60);
    updateActiveTakeaway(currentMinute);
  }
});