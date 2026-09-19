![app_icon_256](resources/app_icon_256.png)

# NeuroPanther Chat v1.11.0

A cross-platform desktop chat/agent application built with Electron that supports multiple AI vendors and models.

*by Richard Lesh*

---

## Features

### Multi-Vendor Support
Connect to any of the following AI providers:
- **OpenAI** — GPT-4o, GPT-4o Mini, GPT-4 Turbo, GPT-3.5 Turbo
- **Anthropic** — Claude Opus 4.5, Claude Sonnet 4.5, Claude Haiku 4.5
- **Google** — Gemini 2.0 Flash, Gemini 2.0 Flash Lite, Gemini 1.5 Pro, Gemini 1.5 Flash
- **Amazon** — Claude Sonnet 4, Claude Haiku 4.5, Amazon Nova Pro, Amazon Nova Lite, Meta Llama 4 Maverick (via AWS Bedrock)
- **Microsoft** — Azure OpenAI deployments (GPT-4o, GPT-4o Mini, GPT-4, etc.)
- **IBM** — Granite, Llama, and other models via watsonx.ai Model Gateway
- **DeepSeek** — DeepSeek Chat, DeepSeek Reasoner
- **Alibaba** — Qwen Max, Qwen Plus, Qwen Turbo
- **Meta** — Muse Spark 1.1
- **xAI** — Grok 3, Grok 3 Mini, Grok 2
- **Groq** — Llama 3.3 70B, Llama 3.1 8B, Gemma2 9B, Qwen QWQ 32B
- **Perplexity** — Sonar Pro, Sonar Reasoning Pro
- **Mistral** — Mistral Large, Medium, Small, Open Mistral Nemo
- **Cerebras** — Llama 4 Scout, Llama 3.3 70B, Qwen 3 32B
- **Moonshot AI** — Kimi K2, Moonshot v1 (128k, 32k, 8k context)
- **Generic 1/2/3** — Connect to any OpenAI-compatible API with custom endpoint and key
- **Generic (YAML)** — Connect to any LLM API with fully customizable YAML-driven HTTP request/response configuration
- **Ollama** — Local models (requires Ollama installed and running)

### Chat
- Scrolling chat history with user and assistant message bubbles
- Full **Markdown rendering** with syntax-highlighted code blocks
- **LaTeX math rendering** for inline (`$...$`) and display (`$$...$$`) equations
- Conversation history maintained across turns for context-aware responses
- Submit with **Enter** key or the send button; **Shift+Enter** for new lines
- Auto-growing text input
- Copy and download buttons on code blocks, tables, math equations, and diagrams

### Agentic Capability
- Agent Mode allows supported models to perform multi-step tasks autonomously
- Tools include file read/write, directory listing, file search, shell commands, and web search
- Tool calls are shown for approval before execution
- Configurable working directory restricts file access for safety
- Web search powered by Brave Search API
- Supported by OpenAI, Anthropic, Google, Amazon, DeepSeek, and other vendors with tool/function calling support

### Math Equations
- Render LaTeX math equations inline using `$...$` and in display blocks using `$$...$$`
- Powered by KaTeX for fast, high-quality typesetting
- Copy and download buttons on display equations — copy LaTeX source or download as SVG
- Ideal for science, engineering, and academic discussions

### Mermaid Diagrams
- Render Mermaid diagrams inline when the AI responds with a ` ```mermaid ` code block
- Supports flowcharts, sequence diagrams, class diagrams, state diagrams, Gantt charts, pie charts, and more
- Diagrams are rendered as scalable SVG graphics directly in the chat
- Copy and download buttons — copy Mermaid source or download as SVG (exported with light theme)
- Powered by Mermaid.js with a dark theme to match the app UI

### Language Translation
- Seamlessly translate AI responses into a selected language
- Supports real-time translation for more than 100 languages

### Web Search using Brave API
- Integrated web search functionality through the Brave Search API in Agent Mode
- Allows the AI to retrieve real-time web data during agentic workflows

### File Attachments
- Attach text-based files (source code, Markdown, JSON, CSV, logs, etc.) to provide context
- Drag and drop files onto the chat area
- Maximum attachment size: 50 MB
- Attached files appear as removable badges above the input area

### Image Upload and Analysis
- Attach an image to any message using the attachment button
- Image is displayed in the chat window before sending
- The AI analyses the image along with your text prompt
- Image context is preserved in conversation history for follow-up questions
- Supported by OpenAI, Anthropic, Google, and other vision-capable vendors

### Image Generation
- Toggle **Generate Image** mode with the star button
- Supported vendors: **OpenAI** (gpt-image-1), **Google** (Imagen 4.0, Imagen 4.0 Ultra), **Alibaba** (Qwen Image), **xAI** (Grok Imagine), **Stability AI**, **Leonardo**, **Ideogram**, **Recraft**, **Flux (BFL)**, **fal.ai**
- Generated images are displayed inline in the chat
- Download generated images via the download button or right-click menu
- Follow-up image refinement supported for select providers

### Tabbed Windows
- Run multiple independent chats simultaneously using tabs
- Open a new tab with the **+** button or **Cmd/Ctrl+T**
- Open a new window with **Cmd/Ctrl+N**
- Close a tab with **Cmd/Ctrl+W** or the × button on the tab
- Double-click a tab title to rename it
- Drag tabs between windows to reorganize chats
- Each tab maintains its own conversation history, vendor, and model selection
- Unsaved tabs are marked with a **•** indicator; you are prompted to save before closing

### Saving, Loading, and Exporting
- Save conversations as `.chat` files (**Cmd/Ctrl+S**)
- Load saved chats (**Cmd/Ctrl+O**) or drag `.chat` files onto the window
- Export chats as **HTML**, **Markdown**, or **PDF**
- Print chats with **Cmd/Ctrl+P**

### Per-Message Actions
Each AI response includes:
- **Copy** — copies the response text to the clipboard
- **Speak** — reads the response aloud using text-to-speech; click again to stop

### Voice Input
- Record speech and transcribe with OpenAI Whisper (requires OpenAI API key)
- Transcribed text is inserted into the message box for review before sending

### Image Actions
Click any image to enlarge it in the chat window.

Right-click any image in the chat to:
- **Copy Image** — copies the image to the clipboard
- **Save Image As…** — saves the image to disk via a native save dialog
- **Zoom** — enlarges the image to fit the chat window

### Display and Color Customization
- Customize button highlight color, user bubble color, and AI bubble color
- Toggle model activity display

### Settings
- Select your **vendor** and **model** from dropdown menus
- Each vendor stores its own credentials separately
- Vendors with custom authentication (Amazon, Microsoft, IBM, Generic) have dedicated credential fields
- A direct link to each vendor's API key page is shown for convenience
- Configure Agent Mode working directory and Brave Search API key
- Settings are saved to `~/.neuropanther-chat-settings.json`

### Vendor Configuration
Vendors, models, and API key URLs are defined in `config.json` making it easy to add new vendors or models without changing any code. Three generic vendor slots allow connecting to any OpenAI-compatible API. A YAML-configured generic vendor allows connecting to any LLM API with fully custom HTTP request/response formats, optional OAuth/IAM token exchange, and configurable model listing.

### System Prompt
The base system prompt is loaded from `resources/system_prompt.md` at startup. Edit this file to customize the AI's default behavior, supported output formats, and instructions across all vendors. The system prompt is automatically combined with agent and translation instructions as needed.

---

## Installation

### Prerequisites
- [Node.js](https://nodejs.org) (v18 or later)
- npm

### Setup
```bash
git clone https://github.com/richlesh/NeuroPanther-Chat.git
cd NeuroPanther-Chat
npm install
```

### Running
```bash
npm start
```

On first launch, open **NeuroPanther Chat → Settings…** to enter your API key for your chosen vendor.

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
| Amazon | https://console.aws.amazon.com/iam/home#/security_credentials |
| Microsoft | https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI |
| IBM | https://cloud.ibm.com/iam/apikeys |
| DeepSeek | https://platform.deepseek.com/api_keys |
| Alibaba | https://www.alibabacloud.com/help/en/model-studio/get-api-key |
| Meta | https://developer.meta.com/ai/ |
| xAI | https://console.x.ai/team/default/api-keys |
| Groq | https://console.groq.com/keys |
| Perplexity | https://www.perplexity.ai/settings/api |
| Mistral | https://console.mistral.ai/api-keys |
| Cerebras | https://cloud.cerebras.ai/platform/api-keys |
| Moonshot AI | https://platform.kimi.ai/console/api-keys |
| Stability AI | https://platform.stability.ai/account/keys |
| Leonardo | https://app.leonardo.ai/api-access |
| Ideogram | https://ideogram.ai/manage-api |
| Recraft | https://app.recraft.ai/profile/api |
| Flux (BFL) | https://dashboard.bfl.ai/ |
| fal.ai | https://fal.ai/dashboard/keys |
| Brave Search | https://api.search.brave.com |
| Ollama | Local — no API key required |

---

## Tech Stack

- [Electron](https://www.electronjs.org)
- [OpenAI Node SDK](https://github.com/openai/openai-node) — OpenAI, Microsoft, DeepSeek, Alibaba, Meta, Google text, xAI, Groq, Perplexity, Mistral, Cerebras, Moonshot AI, Generic vendors, Ollama
- [Anthropic Node SDK](https://github.com/anthropics/anthropic-sdk-node) — Anthropic Claude models
- [AWS SDK Bedrock Runtime](https://github.com/aws/aws-sdk-js-v3) — Amazon Bedrock (Claude, Nova, Llama)
- [Google GenAI SDK](https://github.com/googleapis/google-cloud-node) — Google Imagen image generation
- [marked](https://marked.js.org) — Markdown rendering
- [KaTeX](https://katex.org) — LaTeX math rendering
- [highlight.js](https://highlightjs.org) — Code syntax highlighting
- [Mermaid](https://mermaid.js.org) — Diagram and chart rendering
- [js-yaml](https://github.com/nodeca/js-yaml) — YAML parsing for Generic (YAML) vendor configuration

---

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE) for details.

© 2026 Richard Lesh
