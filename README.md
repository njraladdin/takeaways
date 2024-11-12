# YouTube Takeaways

A Chrome extension that shows key points and generates quizzes for YouTube videos. It runs alongside educational videos, podcasts, and interviews to help reinforce what you're learning.

![YouTube Takeaways Demo](media/demo.png)

## What it Does

- Shows key takeaways next to the video as you watch
- Generates a quiz to test your understanding
- Marks important moments in the video timeline
- Works with videos that have captions enabled
- Caches results for previously watched videos

## Setup

1. Get a free Google AI (Gemini) API key from the [Google AI Studio](https://makersuite.google.com/app/apikey)
   - No credit card required
   - Free tier includes thousands of requests per month
2. Install the extension:
   ```bash
   git clone https://github.com/yourusername/youtube-takeaways.git
   ```
3. Load in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the extension folder
4. Click the extension icon and enter your API key

## How it Works

1. The extension reads video captions
2. Uses Gemini AI to identify key points
3. Displays takeaways next to the video
4. Generates relevant quiz questions
5. Caches results for faster loading

## Technical Details

- Built with JavaScript
- Uses Chrome Extension Manifest V3
- Uses free Gemini AI API
- Stores data in Chrome local storage

## Files

```
youtube-takeaways/
├── manifest.json    # Extension config
├── background.js   # Service worker
├── content.js     # YouTube integration
├── popup.js      # Settings UI
└── popup.html   # Settings page
```

## Privacy

- Only runs on youtube.com
- Processes captions locally and through Gemini AI
- Stores data only in your browser
- API key stays on your device

## Requirements

- Chrome browser
- Free Gemini API key
- YouTube videos with captions

## Issues & Support

Report issues here: [GitHub Issues](https://github.com/yourusername/youtube-takeaways/issues)

## License

MIT License - See [LICENSE](LICENSE) file

