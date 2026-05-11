# NeuroPanther Chat — Project Structure

## Directory Layout
```
NeuroPanther-Chat/
├── main.js                          # Electron main process — app lifecycle, IPC, API calls
├── index.html                       # Main chat renderer — UI, tabs, chat bubbles
├── settings.html                    # Settings window — vendor/model/API key UI
├── settings.js                      # Settings window renderer logic
├── about.html                       # About dialog
├── license_dialog.html                     # License display
├── splash.html                      # Splash/loading screen
├── config.json                      # Vendor/model/URL configuration (data-driven)
├── package.json                     # npm config, electron-builder config, dependencies
├── app_icon.png / .icns / .ico      # App icons for all platforms
├── generate_neuropanther_chat_license_key.py  # Standalone utility: license key generation
├── .gitignore
└── .amazonq/rules/memory-bank/      # Amazon Q memory bank documentation
```

## Core Components

### main.js — Main Process
The central orchestrator. Responsibilities:
- Electron app/window lifecycle (BrowserWindow creation, splash screen)
- IPC handlers for all renderer↔main communication
- All AI vendor API calls (OpenAI SDK, Anthropic SDK, Google GenAI SDK)
- Settings read/write to `~/.neuropanther-chat-settings.json`
- Native menus (application menu, context menus)
- Tab drag-and-drop between windows
- File dialog for image save

### index.html — Chat Renderer
Single-file renderer (HTML + embedded CSS + embedded JS). Responsibilities:
- Tab bar management (create, close, rename, drag)
- Chat message rendering (Markdown via `marked`, code highlighting via `highlight.js`)
- Input area (auto-grow textarea, image attach, generate-image toggle)
- Per-message action buttons (copy, speak/stop TTS)
- IPC communication with main process for API calls and settings

### settings.html + settings.js — Settings Renderer
Two-file settings window. Responsibilities:
- Vendor dropdown populates model dropdown dynamically
- API key input per vendor (stored/retrieved via IPC)
- Link to vendor's API key page

### config.json — Vendor Configuration
Data-driven vendor registry. Each vendor entry contains:
- `label` — display name
- `models` — array of model IDs
- `apiKeyUrl` — link shown in settings
- `baseURL` (optional) — for OpenAI-compatible endpoints
- `imageGeneration` — boolean capability flag
- `imageModel` / `imageSize` (optional) — image generation parameters

## Architectural Patterns

### Electron IPC Pattern
All AI calls and privileged operations go through IPC:
- Renderer sends `ipcRenderer.invoke('channel-name', payload)`
- Main process handles via `ipcMain.handle('channel-name', handler)`
- Async/await throughout; errors returned as `{ error: string }`

### OpenAI-Compatible Endpoint Pattern
DeepSeek, Alibaba, Meta, and Google all use the OpenAI Node SDK with a custom `baseURL`, avoiding separate SDKs for each vendor. Only Anthropic and Google image generation use their own SDKs.

### Data-Driven Vendor Config
Adding a new vendor requires only a `config.json` entry — no code changes needed for standard text chat vendors using OpenAI-compatible APIs.

### Single Settings File
All user preferences (API keys per vendor, selected vendor/model) are stored in one JSON file at `~/.neuropanther-chat-settings.json`, read/written by the main process.

### Renderer-Side State
Each tab's state (conversation history, vendor, model, pending image) is managed entirely in the renderer's in-memory JS objects, keyed by tab ID.
