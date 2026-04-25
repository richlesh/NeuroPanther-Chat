# LLM Chatbot

A cross-platform desktop chatbot application built with Electron that supports multiple AI vendors and models.

*by Richard Lesh*

---

## Features

### Multi-Vendor Support
Connect to any of the following AI providers:
- **OpenAI** — GPT-4o, GPT-4o Mini, GPT-4 Turbo, GPT-3.5 Turbo
- **Anthropic** — Claude Opus, Claude Sonnet, Claude Haiku
- **Google** — Gemini 2.0 Flash, Gemini 1.5 Pro, Gemini 1.5 Flash
- **DeepSeek** — DeepSeek Chat, DeepSeek Reasoner
- **Alibaba** — Qwen Max, Qwen Plus, Qwen Turbo
- **Meta** — Llama 3.3 70B, Llama 3.1 8B

### Chat
- Scrolling chat history with user and assistant message bubbles
- Full **Markdown rendering** with syntax-highlighted code blocks
- Conversation history maintained across turns for context-aware responses
- Submit with **Enter** key or the return button; **Shift+Enter** for new lines
- Auto-growing text input

### Image Upload
- Attach an image to any message using the image button
- Image is displayed in the chat window before sending
- The AI analyses the image along with your text prompt
- Supported by OpenAI and Anthropic vendors

### Image Generation
- Toggle **Generate Image** mode with the star button
- Describe an image and DALL-E 3 generates a 1024×1024 image
- Generated images are displayed inline in the chat
- Download generated images via the download button or right-click menu

### Per-Message Actions
Each AI response includes:
- **Copy** — copies the response text to the clipboard
- **Speak** — reads the response aloud using text-to-speech; click again to stop

### Right-Click Image Menu
Right-click any image in the chat to:
- **Copy Image** — copies the image to the clipboard
- **Save Image As…** — saves the image to disk via a native save dialog

### Settings
- Select your **vendor** and **model** from dropdown menus
- Each vendor stores its own **API key** separately
- A direct link to each vendor's API key page is shown for convenience
- Settings are saved to `~/.chatbot-settings.json`

### Vendor Configuration
Vendors, models, and API key URLs are defined in `config.json` making it easy to add new vendors or models without changing any code.

---

## Installation

### Prerequisites
- [Node.js](https://nodejs.org) (v18 or later)
- npm

### Setup
```bash
git clone https://github.com/richlesh/LLM-Chatbot.git
cd LLM-Chatbot
npm install
```

### Running
```bash
npm start
```

On first launch, open **Chatbot → Settings…** to enter your API key for your chosen vendor.

---

## Building Distribution Packages

```bash
# All platforms and architectures
npm run dist:all

# Individual builds
npm run dist:mac:x64       # macOS Intel
npm run dist:mac:arm64     # macOS Apple Silicon
npm run dist:win:x64       # Windows x64
npm run dist:win:arm64     # Windows ARM64
npm run dist:linux:x64     # Linux x64
npm run dist:linux:arm64   # Linux ARM64
```

Output files are placed in the `dist/` folder.

---

## Getting API Keys

| Vendor | API Key URL |
|--------|-------------|
| OpenAI | https://platform.openai.com/api-keys |
| Anthropic | https://console.anthropic.com/settings/keys |
| Google | https://aistudio.google.com/apikey |
| DeepSeek | https://platform.deepseek.com/api_keys |
| Alibaba | https://bailian.console.aliyun.com |
| Meta | https://llama.developer.meta.com |

---

## Tech Stack

- [Electron](https://www.electronjs.org)
- [OpenAI Node SDK](https://github.com/openai/openai-node)
- [Anthropic Node SDK](https://github.com/anthropics/anthropic-sdk-node)
- [marked](https://marked.js.org) — Markdown rendering
- [highlight.js](https://highlightjs.org) — Code syntax highlighting

---

## License

ISC
