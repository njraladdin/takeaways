<div align="center">
  <img src="icons/icon128.png" alt="Takeaways Logo" width="96" height="96">
  <h1>Takeaways</h1>
  <p>A Chrome extension that shows key points for YouTube videos. It runs alongside educational videos, podcasts, and interviews to help reinforce what you're learning.</p>
</div>

![Takeaways Demo](media/demo.png)

## Download Extension

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/[extension-id].svg)](https://chrome.google.com/webstore/detail/takeaways/[extension-id])

➡️ [Install from Chrome Web Store](https://chrome.google.com/webstore/detail/takeaways/[extension-id])

## What it Does

- Shows key takeaways next to the video as you watch
- Works with videos that have captions enabled
- Caches results for previously watched videos

## Setup

1. Get a free Google AI (Gemini) API key from the [Google AI Studio](https://aistudio.google.com/app/)

2. Install the extension (choose one option):

   ### Option 1: Chrome Web Store (Recommended)
   - Visit the [Chrome Web Store](https://chrome.google.com/webstore/detail/takeaways/[extension-id])
   - Click "Add to Chrome"
   - Click the extension icon and enter your API key

   ### Option 2: Developer Mode
   ```bash
   git clone https://github.com/aladynjr/takeaways.git
   ```
   Then:
   - Go to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked" and select the extension folder
   - Click the extension icon and enter your API key

## How it Works

1. The extension reads video captions
2. Uses Gemini AI to identify key points
3. Displays takeaways next to the video
4. Caches results for faster loading

## Technical Details

- Built with JavaScript
- Uses Chrome Extension Manifest V3
- Uses free Gemini AI API
- Stores data in Chrome local storage

## Files

```
takeaways/
├── manifest.json    # Extension config
├── background.js   # Service worker
├── takeaways.js     # YouTube integration
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

Report issues here: [GitHub Issues](https://github.com/aladynjr/takeaways/issues)

## Contact Developer

Follow me on X (Twitter): [@aladdinnjr](https://x.com/aladdinnjr)

## License

MIT License - See [LICENSE](LICENSE) file

