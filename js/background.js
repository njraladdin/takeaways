importScripts('geminiModels.js');

async function getVideoDetails(message) {
  const videoId = message.videoId;
  
  try {
    // Get video page
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    const html = await response.text();
    
    // Extract video metadata from ytInitialPlayerResponse
    const playerResponseMatch = html.match(/var\s+ytInitialPlayerResponse\s*=\s*({.+?})\s*;/);
    if (!playerResponseMatch) return null;
    
    try {
      const metadata = JSON.parse(playerResponseMatch[1]);
      const videoDetails = metadata?.videoDetails;
      
      const result = {
        video: {
          id: videoId,
          title: videoDetails?.title,
          description: videoDetails?.shortDescription,
          lengthSeconds: parseInt(videoDetails?.lengthSeconds),
          viewCount: parseInt(videoDetails?.viewCount),
          url: `https://www.youtube.com/watch?v=${videoId}`
        },
        channel: {
          name: videoDetails?.author,
          id: videoDetails?.channelId,
          url: `https://www.youtube.com/channel/${videoDetails?.channelId}`
        },
        captions: {
          available: false,
          count: 0,
          language: null,
          items: []
        },
        timestamp: new Date().toISOString()
      };

      // Extract captions data
      const captionsMatch = html.match(/"captions":(\{.+?\}),"videoDetails/);
      if (captionsMatch) {
        const captionsData = captionsMatch[1];
        const { playerCaptionsTracklistRenderer } = JSON.parse(captionsData);
        
        if (playerCaptionsTracklistRenderer?.captionTracks) {
          const track = playerCaptionsTracklistRenderer.captionTracks[0];
          if (track?.baseUrl) {
            const captionsResponse = await fetch(track.baseUrl);
            const captionsXml = await captionsResponse.text();
            
            const captionItems = captionsXml
              .replace('<?xml version="1.0" encoding="utf-8" ?><transcript>', '')
              .replace('</transcript>', '')
              .split('</text>')
              .filter(line => line.trim())
              .map(line => ({
                start: parseFloat(line.match(/start="([\d.]+)"/)?.[1] || 0),
                duration: parseFloat(line.match(/dur="([\d.]+)"/)?.[1] || 0),
                text: line
                  .replace(/<text[^>]*>/, '')
                  .replace(/&amp;#39;/g, "'")
                  .replace(/&amp;quot;/g, '"')
                  .replace(/&amp;/g, '&')
                  .trim()
              }));

            result.captions = {
              available: true,
              count: captionItems.length,
              language: track.languageCode,
              kind: track.kind, // 'asr' for auto-generated, 'standard' for manual
              items: captionItems
            };
          }
        }
      }
      
      return result;
      
    } catch (parseError) {
      console.error('[YT Video] JSON Parse Error:', parseError);
      return null;
    }
      
  } catch (error) {
    console.error('[YT Video] Fetch Error:', error);
    return null;
  }
}

async function getVideoSummary(videoDetails) {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  
  if (!apiKey) {
    console.error('[YT Video] No API key found. Please set it in the extension options.');
    return null;
  }
  
  try {
    // Group captions by minute
    const captionsByMinute = {};
    videoDetails.captions.items.forEach(caption => {
      const minute = Math.floor(caption.start / 60);
      if (!captionsByMinute[minute]) {
        captionsByMinute[minute] = [];
      }
      captionsByMinute[minute].push({
        text: caption.text,
        start: caption.start
      });
    });

    // Format captions grouped by minute
    const groupedTranscript = Object.entries(captionsByMinute)
      .map(([minute, captions]) => (
        `Minute ${minute}:\n${captions.map(caption => {
          const totalSeconds = Math.floor(caption.start);
          const hours = Math.floor(totalSeconds / 3600);
          const minutes = Math.floor((totalSeconds % 3600) / 60);
          const seconds = totalSeconds % 60;
          const timestamp = hours > 0 
            ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
            : `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
          return `[${timestamp}] ${caption.text}`;
        }).join(' ')}`
      ))
      .join('\n\n');

    const prompt = `
      Analyze this YouTube video and return a JSON response with specific, concrete takeaways for each minute.
      Focus on extracting memorable facts, specific examples, unique insights, or actionable advice.
      
      Title: ${videoDetails.video.title}
      Channel: ${videoDetails.channel.name}
      Duration: ${Math.floor(videoDetails.video.lengthSeconds / 60)} minutes
      
      Description: ${videoDetails.video.description}
      
      Transcript by minute:
      ${groupedTranscript}
      
      Writing Style:
      - Extract specific facts, examples, or key insights 
      - Include concrete numbers, statistics, or real examples when available
      - Focus on memorable details that someone might want to reference later
      - Avoid redundant insights - Skip minutes without new information, unless they contain novel details or significantly expand/contradict previous points
        
      - Bad example: "AI is rapidly evolving, creating significant opportunities"
      - Good example: "OpenAI's GPT-4 can score in top 1% on bar exams, outperforming 99% of human lawyers"
      - Bad example: "The speaker discussed marketing strategies"
      - Good example: "Companies that post 3 times per week on LinkedIn see 200% more engagement than weekly posters"
      
      Generally, keep it interesting and engaging, and also useful and actionable.

      Please return a JSON object with:
      {
        "title": "video title",
        "duration_minutes": total minutes,
        "takeaways": [
          {
            "minute": minute_number,
            "key_point": "main takeaway from this minute",
            "significanceScore": number_between_1_and_100,
            "interestScore": number_between_1_and_100
          }
        ],
        "quiz": {
          "description": "Test your understanding of the key concepts",
          "questions": [
            {
              "question": "Clear, specific question about an important takeaway",
              "options": [
                "Option A (correct answer)",
                "Option B",
                "Option C",
                "Option D"
              ],
              "correctIndex": 0,
              "explanation": "Brief explanation of why this answer is correct"
            }
          ]
        }
      }

      For the quiz:
      - Generate exactly 4 questions
      - Focus on the most practical and actionable takeaways
      - Questions should test understanding, not just memory
      - Each question should have exactly 4 options
      - Include a brief explanation for the correct answer
      - Make wrong options plausible but clearly incorrect
      - Ensure questions are specific and based on concrete facts from the video
      
      Example quiz question:
      {
        "question": "According to the video, what percentage increase in engagement do companies see when posting 3 times per week on LinkedIn?",
        "options": [
          "200%",
          "100%",
          "150%",
          "50%"
        ],
        "correctIndex": 0,
        "explanation": "The video specifically mentioned that posting 3 times per week results in 200% higher engagement compared to weekly posters."
      }

      For each takeaway:
      - Focus only on substantive content and key insights
      - Skip general housekeeping, outros, or non-content segments
      
      Scoring criteria:

      significanceScore (1-100):
      - How important this point is to the overall message
      - How actionable or practical the insight is
      - How novel or unique the information is
      - Higher scores (70-100) for major insights or crucial turning points
      - Lower scores (1-30) for supporting details or context

      interestScore (1-100):
      - How likely is this to grab attention or surprise the reader
      - How memorable or thought-provoking is the insight
      - How well it illustrates a complex idea with a clear example
      - Higher scores (70-100) for "wow moments" or counterintuitive insights
      - Lower scores (1-30) for expected or commonly known information

      Example takeaway:
      {
        "minute": 6,
        "key_point": "Lawyers reject AI tools that are 99% accurate because one mistake could cost millions in lawsuits",
        "significanceScore": 85,
        "interestScore": 90
      }
              For takeaways:
      - Include at least one takeaway for every 2-3 minutes of content
      - Minimum of 5 takeaways for any video longer than 10 minutes
      - Maximum of 20 takeaways for very long videos

    `;

    console.log('[YT Video] Sending AI request for video:', videoDetails.video.title);
    console.log('[YT Video] Generated AI Prompt:', prompt);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TAKEAWAYS_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.4,
            topK: 40,
            topP: 0.7,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: {
                title: { type: "string" },
                duration_minutes: { type: "integer" },
                takeaways: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      minute: { type: "integer" },
                      key_point: { type: "string" },
                      significanceScore: { type: "integer", minimum: 1, maximum: 100 },
                      interestScore: { type: "integer", minimum: 1, maximum: 100 }
                    },
                    required: ["minute", "key_point", "significanceScore", "interestScore"]
                  }
                },
                quiz: {
                  type: "object",
                  properties: {
                    description: { type: "string" },
                    questions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          question: { type: "string" },
                          options: { 
                            type: "array",
                            items: { type: "string" },
                            minItems: 4,
                            maxItems: 4
                          },
                          correctIndex: { type: "integer", minimum: 0, maximum: 3 },
                          explanation: { type: "string" }
                        },
                        required: ["question", "options", "correctIndex", "explanation"]
                      },
                      minItems: 5,
                      maxItems: 5
                    }
                  },
                  required: ["description", "questions"]
                }
              },
              required: ["title", "duration_minutes", "takeaways", "quiz"]
            }
          }
        })
      }
    );

    if (!response.ok) {
      console.error('[YT Video] API Response Error:', response.status, response.statusText);
      const errorData = await response.json();
      console.error('[YT Video] API Error Details:', errorData);
      return null;
    }

    console.log('[YT Video] AI response received successfully');
    const data = await response.json();
    
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.error('[YT Video] No valid content in AI response:', data);
      return null;
    }

    // Parse the JSON string into an object
    try {
      let summaryText = data.candidates[0].content.parts[0].text;
      
      // Enhanced cleanup that preserves JSON structure
      summaryText = summaryText
        // Remove any markdown code block markers
        .replace(/```json\s*|\s*```/g, '')
        // Fix common JSON structural issues
        .replace(/}\s*,\s*{/g, '}, {')  // Ensure proper array element separation
        .replace(/}\s*{/g, '}, {')      // Fix missing commas between objects
        .replace(/}\s*]/g, '}]')        // Fix array closing
        .replace(/]\s*}/g, ']}')        // Fix object closing
        // Remove any leading/trailing whitespace
        .trim();

      try {
        const summary = JSON.parse(summaryText);
        console.log('[YT Video] AI Summary parsed:', summary);
        return summary;
      } catch (firstParseError) {
        console.warn('[YT Video] First parse attempt failed:', firstParseError);
        
        // More aggressive cleanup if needed
        try {
          summaryText = summaryText
            // Remove any potential control characters
            .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
            // Ensure proper line endings
            .replace(/\n/g, ' ')
            // Remove any extra spaces
            .replace(/\s+/g, ' ')
            // Fix any trailing commas in arrays/objects
            .replace(/,\s*([}\]])/g, '$1');
            
          const summary = JSON.parse(summaryText);
          console.log('[YT Video] AI Summary parsed with cleanup:', summary);
          return summary;
        } catch (secondParseError) {
          console.error('[YT Video] All parsing attempts failed');
          throw secondParseError;
        }
      }
    } catch (parseError) {
      console.error('[YT Video] Failed to parse AI response as JSON:', parseError);
      console.error('[YT Video] Raw response text:', data.candidates[0].content.parts[0].text);
      return null;
    }
    
  } catch (error) {
    console.error('[YT Video] Gemini API Error:', error);
    console.error('[YT Video] Error Stack:', error.stack);
    return null;
  }
}

async function isRelevantContent(videoDetails) {
  // Get API key from storage instead of hardcoding
  const { apiKey } = await chrome.storage.local.get('apiKey');
  
  if (!apiKey) {
    console.error('[YT Video] No API key found. Please set it in the extension options.');
    return false;
  }
  
  // Sample captions throughout the video to get a good overview
  const captionCount = videoDetails.captions.items.length;
  const sampleSize = 10;
  const sampledCaptions = [];
  
  for (let i = 0; i < sampleSize; i++) {
    const index = Math.floor((i / sampleSize) * captionCount);
    sampledCaptions.push(videoDetails.captions.items[index].text);
  }

  const prompt = `
    Determine if this YouTube video is a podcast, interview, essay, commentary, or long-form educational content.
    Return only "true" or "false".

    Title: ${videoDetails.video.title}
    Channel: ${videoDetails.channel.name}
    Duration: ${Math.floor(videoDetails.video.lengthSeconds / 60)} minutes
    Description: ${videoDetails.video.description}

    Sample transcript:
    ${sampledCaptions.join(' ')}
  `;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VALIDATION_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            topK: 1,
            topP: 0.1,
            maxOutputTokens: 1,
          }
        })
      }
    );

    if (!response.ok) {
      console.error('[YT Video] Relevance Check API Error:', response.status);
      return false;
    }

    const data = await response.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.toLowerCase().trim() === 'true';
    console.log('[YT Video] Content relevance check:', result);
    return result;

  } catch (error) {
    console.error('[YT Video] Relevance Check Error:', error);
    return false;
  }
}

// Add this new function to validate the API key
async function validateApiKey(apiKey) {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VALIDATION_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Reply with 'ok' if you can read this." }]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1,
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'API request failed');
    }

    return { success: true };
  } catch (error) {
    console.error('[YT Video] API Key Validation Error:', error);
    return { 
      success: false, 
      error: error.message.includes('API key') ? 'Invalid API key' : 'Connection error'
    };
  }
}

// Update the message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'NEW_VIDEO' && message.videoId) {
    console.log('[YT Video] Processing new video:', message.videoId);
    
    // Check cache first
    chrome.storage.local.get(`takeaways_${message.videoId}`, async (result) => {
      if (result[`takeaways_${message.videoId}`]) {
        console.log('[YT Video] Found cached takeaways, sending directly');
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'VIDEO_TAKEAWAYS',
          takeaways: result[`takeaways_${message.videoId}`]
        });
        return;
      }

      // Process the video
      try {
        const videoDetails = await getVideoDetails(message);
        if (!videoDetails || !videoDetails.captions.available) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'PROCESSING_ERROR',
            error: 'No captions available'
          });
          return;
        }

        console.log('[YT Video] Video Details:', videoDetails);
        
        // Show initial loading UI when checking relevance
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'PROCESSING_STATUS',
          status: 'CHECKING_RELEVANCE'
        });
        
        const isRelevant = await isRelevantContent(videoDetails);
        
        if (!isRelevant) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'PROCESSING_ERROR',
            error: 'Content not suitable for takeaways'
          });
          return;
        }

        // Create initial loading UI
        try {
          await chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            func: () => {
              if (!document.querySelector('.yt-takeaways-progress')) {
                const secondary = document.querySelector('#secondary-inner');
                if (secondary) {
                  secondary.insertBefore(createInitialLoadingUI(), secondary.firstChild);
                }
              }
            }
          });

          // Update status - generating takeaways
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'PROCESSING_STATUS',
            status: 'GENERATING_TAKEAWAYS'
          });
          
          const takeaways = await getVideoSummary(videoDetails);
          if (!takeaways) {
            throw new Error('Failed to generate takeaways');
          }

          // Cache the results
          await chrome.storage.local.set({
            [`takeaways_${message.videoId}`]: takeaways
          });
          
          // Send final takeaways and ensure UI update
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'VIDEO_TAKEAWAYS',
            takeaways: takeaways
          });

        } catch (error) {
          console.error('[YT Video] Processing error:', error);
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'PROCESSING_ERROR',
            error: error.message || 'Failed to process video'
          });
        }
      } catch (error) {
        console.error('[YT Video] Top-level error:', error);
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'PROCESSING_ERROR',
          error: 'An unexpected error occurred'
        });
      }
    });

    return true;
  }
  return false;
});

// Update the message listener for API key operations
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'VALIDATE_API_KEY') {
    validateApiKey(message.apiKey).then(result => {
      if (result.success) {
        // Only save the API key if validation was successful
        chrome.storage.local.set({ apiKey: message.apiKey }, () => {
          sendResponse(result);
        });
      } else {
        sendResponse(result);
      }
    });
    return true;
  }
  return false;
});