# NeuroPanther Chat v1.4.0

A cross-platform desktop chat/agent application built with Electron that supports multiple AI vendors and models.

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

### Language Translation Capability
- Seamlessly translate text across multiple languages within chat conversations.
- Supports real-time translation for more than 100 languages, enabling broader communication and understanding.

### Agentic Capability for Select Models
- Certain AI models possess advanced agentic behaviors, allowing them to perform tasks autonomously.
- Ideal for use cases that require proactive AI intervention and task management.

### Web Search using Brave API
- Integrated web search functionality through the Brave Search API.
- Allows users to retrieve real-time web data directly in their chat conversations.
- Provides an extensive search capability to enhance informational queries and responses.

### Image Upload
- Attach an image to any message using the image button
- Image is displayed in the chat window before sending
- The AI analyses the image along with your text prompt
- Supported by OpenAI and Anthropic vendors

### Image Generation
- Toggle **Generate Image** mode with the star button
- Describe an image and OpenAI/gpt-image-1 or Google/imagen-4.0-generate-001
- will generate a 1024×1024 image
- Generated images are displayed inline in the chat
- Download generated images via the download button or right-click menu
- OpenAI/gpt-image-1 allows for fine-tuning of generated images or uploaded images

### Tabbed Windows
- Run multiple independent chats simultaneously using tabs
- Open a new tab with the **+** button or **Cmd/Ctrl+T**
- Close a tab with **Cmd/Ctrl+W** or the × button on the tab
- Double-click a tab title to rename it
- Drag tabs between windows to reorganize chats
- Each tab maintains its own conversation history, vendor, and model selection
- Unsaved tabs are marked with a **•** indicator; you are prompted to save before closing

### Per-Message Actions
Each AI response includes:
- **Copy** — copies the response text to the clipboard
- **Speak** — reads the response aloud using text-to-speech; click again to stop
- **Voice Input** - allows you to send voice input to the AI model (requires OpenAI API key)

### Image Actions
Click any image to enlarge it in the chat window.

Right-click any image in the chat to:
- **Copy Image** — copies the image to the clipboard
- **Save Image As…** — saves the image to disk via a native save dialog
- **Zoom** — enlarges the image to fit the chat window

### Settings
- Select your **vendor** and **model** from dropdown menus
- Each vendor stores its own **API key** separately
- A direct link to each vendor's API key page is shown for convenience
- Settings are saved to `~/.neuropanther-settings.json`

### Vendor Configuration
Vendors, models, and API key URLs are defined in `config.json` making it easy to add new vendors or models without changing any code.

---

## Installation

### Prerequisites
- [Node.js](https://nodejs.org) (v18 or later)
- npm

### Setup
```bash
git clone https://github.com/richlesh/NeuroPanther.git
cd NeuroPanther
npm install
```

### Running
```bash
npm start
```

On first launch, open **NeuroPanther → Settings…** to enter your API key for your chosen vendor.

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

GPL 3.0
