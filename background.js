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
      captionsByMinute[minute].push(caption.text);
    });

    // Format captions grouped by minute
    const groupedTranscript = Object.entries(captionsByMinute)
      .map(([minute, texts]) => (
        `Minute ${minute}:\n${texts.join(' ')}`
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
        ]
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
    `;

    console.log('[YT Video] Sending AI request for video:', videoDetails.video.title);
    console.log('[YT Video] Generated AI Prompt:', prompt);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`,
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
            responseMimeType: "application/json"
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
      const summaryText = data.candidates[0].content.parts[0].text;
      const summary = JSON.parse(summaryText);
      console.log('[YT Video] AI Summary parsed:', summary);
      return summary;
    } catch (parseError) {
      console.error('[YT Video] Failed to parse AI response as JSON:', parseError);
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent?key=${apiKey}`,
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent?key=${apiKey}`,
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
    
    // Process the video
    getVideoDetails(message).then(async result => {
      if (result && result.captions.available) {
        console.log('[YT Video] Video Details:', result);
        
        // Check if content is relevant before getting takeaways
        const isRelevant = await isRelevantContent(result);
        
        if (isRelevant) {
          const takeaways = await getVideoSummary(result);
          if (takeaways) {
            // Send takeaways back to content script
            chrome.tabs.sendMessage(sender.tab.id, {
              type: 'VIDEO_TAKEAWAYS',
              takeaways: takeaways
            });
          }
        } else {
          console.log('[YT Video] Content not relevant for takeaways');
        }
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