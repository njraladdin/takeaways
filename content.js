console.log('[YT Captions] Content script loaded');

const processedVideos = new Set();
const MIN_TIME_REQUIRED = 3; // 3 seconds for testing 

// Track tab open time
const tabOpenTime = Date.now();
let videoPlaybackTime = 0;
let videoTimeUpdateListener = null;

let currentTakeaways = null;
let takeawaysContainer = null;

// UI Component Creation
function createProgressUI() {
  const progressIndicator = document.createElement('div');
  progressIndicator.className = 'yt-takeaways-progress';
  progressIndicator.style.cssText = `
    background: #fff;
    border-radius: 12px;
    margin-bottom: 12px;
    padding: 12px 16px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    text-shadow: none;
  `;

  progressIndicator.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
      <div style="font-size: 14px; font-weight: 500; color: #0f0f0f; text-shadow: none; display: flex; align-items: center; gap: 8px;">
        <img src="${chrome.runtime.getURL('icons/icon48.png')}" style="width: 18px; height: 18px; border-radius: 4px;" alt="Logo">
        Takeaways
        <div class="regeneration-status" style="display: none; align-items: center; gap: 6px; color: #606060; font-size: 12px; font-weight: normal;">
          <div class="regenerating-spinner" style="
            width: 12px;
            height: 12px;
            border: 2px solid #f3f3f3;
            border-top: 2px solid #3498db;
            border-radius: 50%;
            animation: spin 1s linear infinite;
          "></div>
          <span>Regenerating...</span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button class="play-quiz-button" style="
          background: #0f0f0f;
          border: none;
          cursor: pointer;
          font-size: 11px;
          padding: 1px 8px;
          color: white;
          display: flex;
          align-items: center;
          gap: 4px;
          border-radius: 10px;
          text-shadow: none;
          position: relative;
          font-weight: 500;
          height: 20px;
          transition: background-color 0.2s;
          line-height: 1;
        ">
          <svg style="width: 12px; height: 12px; fill: currentColor;" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z"/>
          </svg>
          Play Quiz
          <div class="yt-tooltip" style="
            position: absolute;
            background: rgba(28, 28, 28, 0.9);
            color: white;
            padding: 8px 10px;
            border-radius: 4px;
            font-size: 12px;
            white-space: nowrap;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%);
            margin-bottom: 8px;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.2s, visibility 0.2s;
            pointer-events: none;
            text-shadow: none;
          ">
            Test your knowledge
          </div>
        </button>
        <button class="retry-button" style="background: none; border: none; cursor: pointer; font-size: 16px; padding: 4px; color: #606060; border-radius: 50%; text-shadow: none; position: relative;">
          ↻
          <div class="yt-tooltip" style="
            position: absolute;
            background: rgba(28, 28, 28, 0.9);
            color: white;
            padding: 8px 10px;
            border-radius: 4px;
            font-size: 12px;
            white-space: nowrap;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%);
            margin-bottom: 8px;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.2s, visibility 0.2s;
            pointer-events: none;
            text-shadow: none;
          ">Regenerate takeaways</div>
        </button>
        <div class="current-time" style="font-size: 13px; color: #606060; text-shadow: none; display: none;">0:00</div>
      </div>
    </div>
    <div style="position: relative; height: 2px; background: #e5e5e5; border-radius: 1px; overflow: visible;">
      <div class="video-progress" style="position: absolute; left: 0; top: 0; height: 100%; width: 0%; background: rgba(6, 95, 212, 0.3); border-radius: 1px; z-index: 1;"></div>
      <div class="markers-container" style="position: absolute; top: -4px; left: 0; right: 0; height: 10px; z-index: 2;"></div>
    </div>
  `;

  // Add hover events for both buttons' tooltips
  const buttons = progressIndicator.querySelectorAll('.play-quiz-button, .retry-button');
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

  // Add click handlers
  progressIndicator.querySelector('.retry-button').addEventListener('click', handleRetry);
  progressIndicator.querySelector('.play-quiz-button').addEventListener('click', () => {
    const quizCard = document.querySelector('.yt-video-quiz');
    if (quizCard && currentTakeaways?.quiz) {
      quizCard.style.display = 'block';
      initializeQuiz(currentTakeaways.quiz);
    }
  });

  // Add hover effect for the play quiz button
  const playQuizButton = progressIndicator.querySelector('.play-quiz-button');
  playQuizButton.addEventListener('mouseenter', () => {
    playQuizButton.style.backgroundColor = '#272727';
  });
  playQuizButton.addEventListener('mouseleave', () => {
    playQuizButton.style.backgroundColor = '#0f0f0f';
  });

  return progressIndicator;
}

function createTakeawaysCard() {
  const card = document.createElement('div');
  card.className = 'yt-video-takeaways';
  card.style.cssText = `
    background: #fff;
    border-radius: 12px;
    padding: 16px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    opacity: 0;
    transform: translateY(10px);
    transition: opacity 0.3s ease-out, transform 0.3s ease-out;
    text-shadow: none;
  `;

  card.innerHTML = `
    <div class="takeaways-header" style="font-size: 16px; font-weight: 500; margin-bottom: 12px; color: #030303; display: flex; justify-content: space-between; align-items: center; text-shadow: none;">
      <div class="takeaways-title" style="display: flex; align-items: center; gap: 8px; text-shadow: none;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <div class="takeaway-dot" style="
            width: 10px;
            height: 10px;
            background-color: #ff0000;
            border-radius: 50%;
            display: inline-block;
            opacity: 0;
            transform: scale(0);
            transition: opacity 0.3s, transform 0.3s;
          "></div>
          <span style="text-shadow: none;">Key Takeaway</span>
        </div>
      </div>
    </div>
    <div class="takeaways-content" style="font-size: 14px; color: #606060; text-shadow: none;"></div>
  `;

  return card;
}

// Add these new functions after the existing UI component creation functions

function createQuizCard() {
  const card = document.createElement('div');
  card.className = 'yt-video-quiz';
  card.style.cssText = `
    background: #fff;
    border-radius: 12px;
    padding: 16px;
    margin-top: 12px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    display: none;
    text-shadow: none;
  `;

  card.innerHTML = `
    <div class="quiz-header" style="margin-bottom: 16px; text-shadow: none;">
      <div style="font-size: 16px; font-weight: 500; color: #030303; text-shadow: none; display: flex; align-items: center; gap: 8px;">
        <img src="${chrome.runtime.getURL('icons/icon48.png')}" style="width: 18px; height: 18px; border-radius: 4px;" alt="Logo">
        Knowledge Check
      </div>
    </div>
    <div class="quiz-content" style="text-shadow: none;"></div>
  `;

  return card;
}

function renderQuizQuestion(question, index, total) {
  return `
    <div class="quiz-question" style="display: none; text-shadow: none;" data-question="${index}">
      <div style="font-size: 14px; color: #606060; margin-bottom: 8px; text-shadow: none;">Question ${index + 1} of ${total}</div>
      <div style="font-size: 15px; color: #030303; margin-bottom: 16px; text-shadow: none;">${question.question}</div>
      <div class="quiz-options" style="display: flex; flex-direction: column; gap: 8px; text-shadow: none;">
        ${question.options.map((option, optIndex) => `
          <button class="quiz-option" data-index="${optIndex}" style="
            background: #f8f8f8;
            border: 1px solid #e5e5e5;
            padding: 12px;
            border-radius: 8px;
            text-align: left;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
            text-shadow: none;
          ">${option}</button>
        `).join('')}
      </div>
      <div class="question-feedback" style="
        margin-top: 16px;
        padding: 12px;
        border-radius: 8px;
        font-size: 14px;
        display: none;
        text-shadow: none;
      "></div>
      <div class="question-navigation" style="
        display: flex;
        justify-content: space-between;
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid #e5e5e5;
      ">
        ${index > 0 ? `
          <button class="prev-question" style="
            background: none;
            border: none;
            color: #065fd4;
            cursor: pointer;
            font-size: 14px;
          ">Previous</button>
        ` : '<div></div>'}
        <button class="next-question" style="
          background: #065fd4;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 18px;
          cursor: pointer;
          font-size: 14px;
          display: none;
        ">${index === total - 1 ? 'Finish Quiz' : 'Next Question'}</button>
      </div>
    </div>
  `;
}

function showQuizResults(score, total) {
  const quizContent = document.querySelector('.quiz-content');
  if (!quizContent) return;

  const percentage = (score / total) * 100;
  const resultMessage = percentage >= 80 ? 'Great job!' : 'Keep learning!';

  quizContent.innerHTML = `
    <div style="text-align: center; padding: 24px 0;">
      <div style="font-size: 24px; color: #030303; margin-bottom: 8px;">${resultMessage}</div>
      <div style="font-size: 16px; color: #606060;">You scored ${score} out of ${total}</div>
      <button class="retry-quiz-button" style="
        background: #065fd4;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 18px;
        cursor: pointer;
        font-size: 14px;
        margin-top: 16px;
      ">Try Again</button>
    </div>
  `;

  const retryButton = quizContent.querySelector('.retry-quiz-button');
  retryButton.addEventListener('click', () => initializeQuiz(currentTakeaways.quiz));
}

function initializeQuiz(quizData) {
  const quizContent = document.querySelector('.quiz-content');
  if (!quizContent) return;

  let currentQuestion = 0;
  let score = 0;

  // Render all questions (hidden initially)
  quizContent.innerHTML = quizData.questions.map((q, i) => 
    renderQuizQuestion(q, i, quizData.questions.length)
  ).join('');

  // Show first question
  const firstQuestion = quizContent.querySelector('[data-question="0"]');
  if (firstQuestion) firstQuestion.style.display = 'block';

  // Add event listeners for options
  quizContent.addEventListener('click', (e) => {
    const option = e.target.closest('.quiz-option');
    if (!option) return;

    const questionEl = option.closest('.quiz-question');
    const questionIndex = parseInt(questionEl.dataset.question);
    const optionIndex = parseInt(option.dataset.index);
    const question = quizData.questions[questionIndex];
    const feedback = questionEl.querySelector('.question-feedback');
    const nextButton = questionEl.querySelector('.next-question');

    // Disable all options
    questionEl.querySelectorAll('.quiz-option').forEach(opt => {
      opt.style.pointerEvents = 'none';
    });

    // Show correct/incorrect styling
    if (optionIndex === question.correctIndex) {
      option.style.backgroundColor = '#e6f4ea';
      option.style.borderColor = '#34a853';
      feedback.style.backgroundColor = '#e6f4ea';
      feedback.style.color = '#137333';
      score++;
    } else {
      option.style.backgroundColor = '#fce8e6';
      option.style.borderColor = '#ea4335';
      feedback.style.backgroundColor = '#fce8e6';
      feedback.style.color = '#c5221f';
      
      // Highlight correct answer
      const correctOption = questionEl.querySelector(`[data-index="${question.correctIndex}"]`);
      if (correctOption) {
        correctOption.style.backgroundColor = '#e6f4ea';
        correctOption.style.borderColor = '#34a853';
      }
    }

    // Show feedback and next button
    feedback.textContent = question.explanation;
    feedback.style.display = 'block';
    nextButton.style.display = 'block';
  });

  // Add navigation listeners
  quizContent.addEventListener('click', (e) => {
    if (e.target.matches('.next-question')) {
      const currentQuestionEl = quizContent.querySelector(`[data-question="${currentQuestion}"]`);
      currentQuestionEl.style.display = 'none';
      
      currentQuestion++;
      if (currentQuestion < quizData.questions.length) {
        const nextQuestionEl = quizContent.querySelector(`[data-question="${currentQuestion}"]`);
        nextQuestionEl.style.display = 'block';
      } else {
        showQuizResults(score, quizData.questions.length);
      }
    } else if (e.target.matches('.prev-question')) {
      const currentQuestionEl = quizContent.querySelector(`[data-question="${currentQuestion}"]`);
      currentQuestionEl.style.display = 'none';
      
      currentQuestion--;
      const prevQuestionEl = quizContent.querySelector(`[data-question="${currentQuestion}"]`);
      prevQuestionEl.style.display = 'block';
    }
  });
}

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
  const secondsInMinute = currentTime % 60;
  
  console.log('[YT Captions] Checking takeaways:', {
    currentMinute,
    secondsInMinute,
    takeaways
  });

  // Updated to use key_point instead of text
  const relevantTakeaways = takeaways.filter(t => { 
    console.log('[YT Captions] Checking takeaway:', t);
    return t.key_point && 
           ((t.minute === currentMinute && secondsInMinute >= 30) || 
            (t.minute === currentMinute - 1 && secondsInMinute <= 20));
  });

  console.log('[YT Captions] Relevant takeaways:', relevantTakeaways);

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
  const position = (minute * 60 / duration) * 100;
  
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
  
  // Show the regeneration status and disable retry button
  const statusElement = document.querySelector('.regeneration-status');
  const retryButton = document.querySelector('.retry-button');
  
  if (statusElement) statusElement.style.display = 'flex';
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

// Initialize UI
function initializeUI() {
  const secondary = document.querySelector('#secondary-inner');
  if (!secondary) return;

  // Remove existing UI
  const existingProgress = document.querySelector('.yt-takeaways-progress');
  const existingTakeaways = document.querySelector('.yt-video-takeaways');
  const existingQuiz = document.querySelector('.yt-video-quiz');
  if (existingProgress) existingProgress.remove();
  if (existingTakeaways) existingTakeaways.remove();
  if (existingQuiz) existingQuiz.remove();

  const progressUI = createProgressUI();
  const takeawaysCard = createTakeawaysCard();
  const quizCard = createQuizCard();
  
  secondary.insertBefore(progressUI, secondary.firstChild);
  secondary.insertBefore(takeawaysCard, progressUI.nextSibling);
  secondary.insertBefore(quizCard, takeawaysCard.nextSibling);

  takeawaysContainer = takeawaysCard;

  if (currentTakeaways) {
    const video = document.querySelector('video');
    updateMarkers(video, currentTakeaways.takeaways);
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

// Initialize on load and navigation finish
function checkForVideo() {
  if (location.href.includes('youtube.com/watch')) {
    const videoId = new URL(location.href).searchParams.get('v');
    console.log('[YT Captions] New video detected:', videoId);
    
    const video = document.querySelector('video');
    if (video) {
      console.log('[YT Captions] Found video element');
      
      // Clear previous state
      currentTakeaways = null;
      
      // Setup new video tracking
      setupVideoTracking(video);
      
      // Check cache and initialize
      chrome.storage.local.get(`takeaways_${videoId}`, (result) => {
        if (result[`takeaways_${videoId}`]) {
          console.log('[YT Captions] Found cached takeaways');
          currentTakeaways = result[`takeaways_${videoId}`];
          initializeUI();
          setTimeout(() => {
            updateMarkers(video, currentTakeaways.takeaways);
            updateUI(video, video.currentTime, currentTakeaways.takeaways);
          }, 100);
        }
      });
    }
  }
}

// Initialize on page load
checkForVideo();

// Handle YouTube's navigation events
document.addEventListener('yt-navigate-finish', () => {
  console.log('[YT Captions] Navigation finished');
  checkForVideo();
});

function updateTakeawaysStatus(status, error = null) {
  if (!takeawaysContainer) {
    initializeUI();
  }

  const content = takeawaysContainer.querySelector('.takeaways-content');
  if (!content) return;

  // Only update if the status is different or if it's an error
  if (content.dataset.currentStatus === status && status !== 'ERROR') {
    return;
  }
  
  const statusMessages = {
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
    const statusText = document.querySelector('.status-text');
    if (statusText) {
      switch (message.status) {
        case 'LOADING_VIDEO_DETAILS':
          statusText.textContent = 'Loading video details...';
          break;
        case 'CHECKING_RELEVANCE':
          statusText.textContent = 'Checking content type...';
          break;
        case 'GENERATING_TAKEAWAYS':
          statusText.textContent = 'Generating takeaways...';
          break;
      }
    }
  } else if (message.type === 'VIDEO_TAKEAWAYS') {
    // Clear any loading states
    const loadingUI = document.querySelector('.yt-takeaways-progress.initial-loading');
    const regenerationStatus = document.querySelector('.regeneration-status');
    const retryButton = document.querySelector('.retry-button');
    
    // Remove loading UI
    if (loadingUI) {
      loadingUI.remove();
    }
    
    // Reset regeneration status if it exists
    if (regenerationStatus) {
      regenerationStatus.style.display = 'none';
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
    const regenerationStatus = document.querySelector('.regeneration-status');
    const retryButton = document.querySelector('.retry-button');
    
    if (regenerationStatus) {
      regenerationStatus.style.display = 'none';
    }
    
    if (retryButton) {
      retryButton.style.opacity = '1';
      retryButton.style.cursor = 'pointer';
      retryButton.disabled = false;
    }

    const statusText = document.querySelector('.status-text');
    if (statusText) {
      statusText.textContent = message.error;
      statusText.style.color = '#cc0000';
    }

    // Remove loading UI after showing error
    setTimeout(() => {
      if (loadingUI) {
        loadingUI.remove();
      }
    }, 3000);
  }
});

// Add CSS for loading spinner
const style = document.createElement('style');
style.textContent = `
  .takeaways-content {
    transition: opacity 0.15s ease-in-out;
  }

  .loading-spinner {
    width: 20px;
    height: 20px;
    margin: 8px auto;
    border: 2px solid #f3f3f3;
    border-top: 2px solid #3498db;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .video-progress {
    transition: width 0.2s ease-out;
  }

  .takeaway-item {
    transition: opacity 0.3s ease-out, transform 0.3s ease-out;
  }

  .animate-takeaway {
    opacity: 0;
    transform: translateY(10px);
  }

  .retry-button:disabled {
    pointer-events: none;
  }
`;
document.head.appendChild(style);

function updateTakeawayContent(relevantTakeaways) {
  const content = document.querySelector('.takeaways-content');
  const titleSpan = document.querySelector('.takeaways-title span');
  const takeawayDot = document.querySelector('.takeaway-dot');
  
  if (!content || !titleSpan) return;

  const takeaway = relevantTakeaways[0];
  if (takeaway?.key_point) {
    // Update the title to include the takeaway number
    titleSpan.textContent = `Key Takeaway #${takeaway.minute + 1}`; // Add 1 since minutes start at 0
    content.innerHTML = `<div style="padding: 8px 0; text-shadow: none;">${takeaway.key_point}</div>`;
    
    // Ensure dot is visible
    if (takeawayDot) {
      takeawayDot.style.opacity = '1';
      takeawayDot.style.transform = 'scale(1)';
    }
  }
}

// Add this new function to create a simplified loading state UI
function createInitialLoadingUI() {
  const progressIndicator = document.createElement('div');
  progressIndicator.className = 'yt-takeaways-progress initial-loading';
  progressIndicator.style.cssText = `
    background: #fff;
    border-radius: 12px;
    margin-bottom: 12px;
    padding: 12px 16px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    text-shadow: none;
  `;

  progressIndicator.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <img src="${chrome.runtime.getURL('icons/icon48.png')}" style="width: 18px; height: 18px; border-radius: 4px;" alt="Logo">
      <div style="font-size: 14px; font-weight: 500; color: #0f0f0f; text-shadow: none;">
        Takeaways
      </div>
      <div class="generation-status" style="display: flex; align-items: center; gap: 6px; color: #606060; font-size: 12px; font-weight: normal;">
        <div class="generating-spinner" style="
          width: 12px;
          height: 12px;
          border: 2px solid #f3f3f3;
          border-top: 2px solid #3498db;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        "></div>
        <span class="status-text">Analyzing video content...</span>
      </div>
    </div>
  `;

  return progressIndicator;
}