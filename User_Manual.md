# NeuroPanther Chat User Manual

**Version:** 1.4.0  
**Product:** NeuroPanther Chat  
**Author:** Richard Lesh / Glowing Cat Software

---

## Table of Contents

1. [Introduction](#introduction)
2. [System Requirements](#system-requirements)
3. [First Launch](#first-launch)
4. [Main Window Overview](#main-window-overview)
5. [Settings](#settings)
6. [API Keys](#api-keys)
7. [Choosing a Vendor and Model](#choosing-a-vendor-and-model)
8. [Sending Chat Messages](#sending-chat-messages)
9. [Markdown, Code, and Links](#markdown-code-and-links)
10. [Tabs and Chat Windows](#tabs-and-chat-windows)
11. [Saving, Loading, Exporting, and Printing Chats](#saving-loading-exporting-and-printing-chats)
12. [Attaching Files](#attaching-files)
13. [Image Upload and Image Analysis](#image-upload-and-image-analysis)
14. [Image Generation](#image-generation)
15. [Voice Input and Text-to-Speech](#voice-input-and-text-to-speech)
16. [Translation Mode](#translation-mode)
17. [Agent Mode](#agent-mode)
18. [Display and Color Customization](#display-and-color-customization)
19. [License Key and Donation Prompt](#license-key-and-donation-prompt)
20. [Troubleshooting](#troubleshooting)
21. [Privacy and Data Notes](#privacy-and-data-notes)
22. [Keyboard Shortcuts](#keyboard-shortcuts)

---

## Introduction

NeuroPanther Chat is a cross-platform desktop chat and agent application for working with multiple AI vendors from one interface. It lets you chat with cloud-hosted and local models, attach files, upload images, generate images, translate responses, use voice input, save conversations, export chats, and run agentic workflows with tool approval.

NeuroPanther Chat is built with Electron and supports macOS, Windows, and Linux.

---

## System Requirements

### Supported Platforms

- macOS
- Windows
- Linux

### Internet Requirements

Most cloud AI vendors require an internet connection and a valid API key. Local models through Ollama can run locally, but require Ollama to be installed and running on your machine.

### Optional Requirements

Some features require additional accounts or services:

- **OpenAI API key** for OpenAI chat, OpenAI image generation, and Whisper voice transcription.
- **Anthropic API key** for Claude models.
- **Google API key** for Gemini chat and Google image generation.
- **DeepSeek API key** for DeepSeek models.
- **Alibaba API key** for Qwen models.
- **Meta API key** for Llama API access.
- **Brave Search API key** for Agent Mode web search.
- **Ollama** for local model use.

---

## First Launch

When NeuroPanther Chat opens, you will see the main chat window with:

- A tab bar at the top.
- The chat transcript area in the center.
- Vendor and model selectors near the bottom.
- Buttons for file attachment, image generation, agent mode, translation, voice input, and sending messages.

On first launch, open **Settings…** and enter the API key for the vendor you want to use.

On macOS, Settings is under the application menu. On Windows and Linux, it appears in the app menu.

---

## Main Window Overview

The main window contains the following major areas.

### Tab Bar

The top of the window contains chat tabs. Each tab has its own conversation history, selected vendor, selected model, and mode state.

Use the **+** button to create a new chat tab.

### Chat Area

The center area displays the conversation. Your messages appear as user bubbles. AI responses appear as assistant bubbles.

AI responses can include:

- Markdown formatting
- Code blocks with syntax highlighting
- Images
- Links
- Agent activity messages
- Per-message action buttons

### Input Area

The bottom input area contains:

| Control | Purpose |
|---|---|
| Vendor selector | Selects the AI vendor. |
| Model selector | Selects the model for the current vendor. |
| Attach button | Attaches image or text-based files. |
| Generate Image button | Toggles image generation mode. |
| Agent Mode button | Toggles agentic tool-use mode. |
| Translate button | Toggles translation response mode. |
| Message box | Type your prompt or message. |
| Microphone button | Records speech and transcribes it with OpenAI Whisper. |
| Send button | Sends the current message. |

---

## Settings

Open **Settings…** from the application menu to configure NeuroPanther Chat.

Settings are saved in your home directory as:

```text
~/.neuropanther-chat-settings.json
```

The Settings window includes several sections.

### LLM Settings

Use this section to select:

- **Vendor**
- **Model**
- **API Key** for the selected vendor

Each vendor stores its API key separately.

### Agent Settings

Use this section to configure:

- **Working Directory** — the folder Agent Mode is allowed to read from and write to.
- **Brave Search API Key** — required for Agent Mode web search.

### Translation Settings

Use this section to choose the default response language used by Translation Mode.

### Display Settings

Use this section to enable or disable model activity display.

### Color Settings

Use this section to customize:

- Button highlight color
- User prompt bubble color
- AI response bubble color

After changing settings, click **Save**.

---

## API Keys

Cloud AI vendors require API keys. NeuroPanther Chat stores API keys locally in the settings file.

### API Key Links

The Settings window provides a convenience link for the currently selected vendor. You can also visit these sites directly:

| Vendor | API Key URL |
|---|---|
| OpenAI | <https://platform.openai.com/api-keys> |
| Anthropic | <https://console.anthropic.com/settings/keys> |
| Google | <https://aistudio.google.com/apikey> |
| DeepSeek | <https://platform.deepseek.com/api_keys> |
| Alibaba | <https://www.alibabacloud.com/help/en/model-studio/get-api-key> |
| Meta | <https://llama.developer.meta.com/docs/api-keys> |
| Stability AI | <https://platform.stability.ai/account/keys> |
| Leonardo | <https://app.leonardo.ai/api-access> |
| Ideogram | <https://ideogram.ai/manage-api> |
| Brave Search | <https://api.search.brave.com> |

### Ollama

Ollama is a local-model provider. It normally does not require a cloud API key. To use Ollama:

1. Install Ollama.
2. Start the Ollama service.
3. Pull at least one model using Ollama.
4. Select **Ollama** as the vendor in NeuroPanther Chat.

NeuroPanther Chat expects Ollama to be available at:

```text
http://localhost:11434/v1
```

---

## Choosing a Vendor and Model

Use the vendor and model dropdowns in the main window to choose which AI model will answer your messages.

Supported configured vendors include:

- OpenAI
- Anthropic
- Google
- DeepSeek
- Alibaba
- Meta
- Stability AI
- Leonardo
- Ideogram
- Ollama

Not all vendors support every feature. For example, some vendors are chat providers, while others are image-only providers.

### Default Chat Vendors

Common chat vendors include:

- OpenAI
- Anthropic
- Google
- DeepSeek
- Alibaba
- Meta
- Ollama

### Image Generation Vendors

Image generation is supported for vendors configured with image-generation support, including:

- OpenAI
- Google
- Stability AI
- Leonardo
- Ideogram

---

## Sending Chat Messages

To send a message:

1. Select a vendor and model.
2. Type your message in the message box.
3. Press **Enter** or click the send button.

Use **Shift+Enter** to insert a new line without sending.

The message box grows automatically as you type, up to a maximum height.

### Conversation Context

Each tab maintains its own conversation history. The AI receives previous messages in the tab so it can answer in context.

Changing tabs changes the active conversation.

---

## Markdown, Code, and Links

AI responses support Markdown rendering, including:

- Headings
- Lists
- Links
- Tables, depending on model output
- Inline code
- Code blocks
- Block quotes

### Code Blocks

Code blocks are syntax highlighted using `highlight.js`.

A copy button appears on code blocks when you hover over them, allowing you to copy code quickly.

### Links

Links in AI responses open in your external browser.

When hovering over supported web links, NeuroPanther Chat attempts to show a preview image. The app may use Open Graph metadata, Twitter card images, or a generated page preview.

---

## Tabs and Chat Windows

NeuroPanther Chat supports multiple independent chats.

### New Tab

Create a new tab using:

- The **+** button in the tab bar
- **File → New Chat Tab**
- **Cmd/Ctrl+T**

### Close Tab

Close the current tab using:

- The tab close button
- **File → Close Tab**
- **Cmd/Ctrl+W**

If a tab contains unsaved messages, NeuroPanther Chat prompts you before closing.

### Rename Tab

Double-click a tab title to rename it.

### New Chat Window

Create a new chat window using:

- **File → New Chat Window**
- **Cmd/Ctrl+N**

### Move Tabs Between Windows

Tabs can be dragged between windows. This lets you reorganize chats across multiple windows.

### Unsaved Indicator

Unsaved tabs are marked with a dot indicator. Save important conversations before closing the app.

---

## Saving, Loading, Exporting, and Printing Chats

### Save Chat

Use **File → Save Chat As…** or **Cmd/Ctrl+S** to save the current tab as a `.chat` file.

A `.chat` file stores the conversation data so it can be reopened later in NeuroPanther Chat.

### Load Chat

Use **File → Load Chat…** or **Cmd/Ctrl+O** to open a saved `.chat` file.

You can also drag a `.chat` file onto the NeuroPanther Chat window to open it as a new tab.

On macOS, dropping a `.chat` file on the app icon can also open the chat.

### Export Chat

Use **File → Export** to export the active chat.

Available export formats:

- **HTML**
- **Markdown**
- **PDF**

When exporting HTML or Markdown, images are saved into a companion image folder next to the exported file.

For example, exporting `My Chat.md` may create:

```text
My Chat.md
My Chat_images/
```

### Print Chat

Use **File → Print…** or **Cmd/Ctrl+P** to print the current chat.

---

## Attaching Files

Click the file attachment button or drag files onto the chat area to attach them.

NeuroPanther Chat supports:

- Image files
- Text-based files
- Source code files
- Markdown files
- JSON, CSV, XML, YAML, HTML, CSS, JavaScript, Python, and many other text formats

The maximum configured attachment size is 50 MB.

Unsupported file types are rejected with a message.

### Removing Attachments

Attached files appear as badges above the input area. Click the **x** on an attachment badge to remove it before sending.

### Text File Attachments

Text files are included as context in your message. This is useful for asking questions about documents, logs, configuration files, or source code.

### Image Attachments

Image attachments are sent to vendors that support image input.

---

## Image Upload and Image Analysis

You can attach images to a normal chat message. The image appears in the chat, and supported models can analyze it along with your prompt.

Image upload is primarily supported by vendors/models with vision capability, including OpenAI and Anthropic models configured for image input.

To analyze an image:

1. Click the attachment button or drag an image into the chat area.
2. Enter a prompt, such as `Describe this image` or `Extract the text from this screenshot`.
3. Send the message.

### Viewing Images

Click an image in the chat to enlarge it. Click again, press **Escape**, or close the modal to return to the chat.

### Image Context Menu

Right-click images to access image actions such as copying, saving, or zooming, depending on platform support.

---

## Image Generation

NeuroPanther Chat includes a Generate Image mode.

To generate an image:

1. Click the **Generate Image** button.
2. Select an image-generation-capable vendor.
3. Type a description of the image you want.
4. Send the prompt.

Generated images are displayed inline in the chat.

### Supported Image Generation Vendors

Configured image generation providers include:

- OpenAI using `gpt-image-1`
- Google using `imagen-4.0-generate-001`
- Stability AI
- Leonardo
- Ideogram

### Image Editing / Follow-Up Generation

For supported providers, NeuroPanther Chat can use an attached image or the last generated image as a source image for follow-up image work.

For example, after generating an image, you can ask for a variation or refinement while remaining in image generation mode.

### Saving Generated Images

Generated images include a download action. You can also use the image context menu to save images.

---

## Voice Input and Text-to-Speech

NeuroPanther Chat supports both voice input and spoken AI responses.

### Voice Input

Voice input uses OpenAI Whisper transcription and requires an OpenAI API key.

To use voice input:

1. Enter your OpenAI API key in Settings.
2. Click the microphone button.
3. Speak your message.
4. Click the microphone button again to stop recording.
5. The transcribed text is inserted into the message box.
6. Review or edit the text, then send it.

If no OpenAI API key is configured, the microphone button is disabled.

### Text-to-Speech

AI responses include a **Speak** action. Click it to have the response read aloud using the system text-to-speech engine.

Click again or press **Escape** to stop speaking.

---

## Translation Mode

Translation Mode tells the AI to always respond in a selected language.

To use Translation Mode:

1. Click the **Translate** button.
2. Choose the target language from the response language dropdown.
3. Send your message.

When Translation Mode is active, NeuroPanther Chat adds an instruction asking the model to respond in the selected language regardless of the language you typed.

The default target language can be changed in Settings.

Supported language options include many common languages such as English, Spanish, French, German, Italian, Portuguese, Chinese, Japanese, Korean, Arabic, Hindi, Ukrainian, Vietnamese, and others.

---

## Agent Mode

Agent Mode allows supported models to request tools and perform multi-step tasks. It is useful for workflows such as inspecting files, editing project files, searching within a folder, running commands, and searching the web.

Agent Mode is designed with safety controls:

- Tools operate within a configured working directory.
- File paths are restricted to the working directory.
- Tool calls are shown for approval before execution.
- Activity messages show what the agent is doing.
- Agent loops are limited to prevent endless execution.

### Enabling Agent Mode

1. Click the **Agent Mode** button.
2. If needed, click **Set Directory** and choose a working directory.
3. Type a task for the AI.
4. Send the message.

### Working Directory

The working directory is the folder Agent Mode is allowed to work in.

Set it from:

- The Agent Mode row in the main window
- **Settings → Agent Settings → Working Directory**

If no working directory is set, Agent Mode uses your home directory as a fallback.

For best safety, choose a project folder rather than your entire home directory.

### Agent Tools

Agent Mode can use these tools:

| Tool | Purpose |
|---|---|
| `read_file` | Reads a text file from the working directory. |
| `write_file` | Writes content to a file in the working directory. |
| `list_directory` | Lists files and folders. |
| `search_files` | Searches text files for a pattern. |
| `run_code` | Runs a shell command in the working directory. |
| `web_search` | Searches the web using Brave Search. |

### Brave Search

The `web_search` tool requires a Brave Search API key.

Add your Brave Search API key in:

```text
Settings → Agent Settings → Brave Search API Key
```

### Tool Approval

When the model requests a tool call, NeuroPanther Chat displays the requested tool and arguments. You can approve or deny the tool call.

Review tool calls carefully, especially:

- `write_file`
- `run_code`
- Any command that modifies files
- Any command that installs software or accesses sensitive data

### Agent Activity Display

Agent Mode shows activity cards such as:

- Agent started
- Agent turn started
- Model requested tools
- Running tool
- Tool completed
- Tool failed
- Agent completed

You can control display behavior in Settings.

### Agent Limitations

Agent Mode is limited to a maximum number of turns. If the model does not complete the task within the limit, the agent stops automatically.

Tool output may be truncated for large files or long command output.

---

## Display and Color Customization

In Settings, you can customize the app's appearance.

### Button Highlight

Controls the accent color used by active buttons and highlighted UI elements.

### User Prompt

Controls the color of your message bubbles.

### AI Response

Controls the color of assistant response bubbles.

### Display Model Activity

Controls whether model activity information is displayed.

---

## License Key and Donation Prompt

NeuroPanther Chat includes a license key window and donation reminder.

If you enjoy using the product, you can donate through Glowing Cat Software to receive a license key.

### Entering a License Key

Open **License Key…** from the application menu.

Enter:

- Your email address
- Your license key

The license key is validated locally and saved in the settings file.

### Donation Reminder

If no valid license is configured, NeuroPanther Chat may occasionally show a donation reminder splash screen. The splash can be closed by clicking it or waiting for it to close automatically.

---

## Troubleshooting

### The AI says an API key is missing

Open Settings and enter the API key for the selected vendor. Each vendor stores a separate API key.

### The microphone button is disabled

Voice input requires an OpenAI API key. Enter your OpenAI API key in Settings.

### Ollama models do not appear

Check that:

1. Ollama is installed.
2. The Ollama service is running.
3. You have pulled at least one model.
4. Ollama is reachable at `http://localhost:11434`.

### Image generation is not available for a vendor

Not all vendors support image generation. Turn on Generate Image mode and select a vendor that supports image generation, such as OpenAI, Google, Stability AI, Leonardo, or Ideogram.

### A file cannot be attached

Only images and text-based files are supported. Binary files, unsupported formats, and files over the size limit are rejected.

### A `.chat` file will not open

Make sure the file is a valid NeuroPanther Chat `.chat` file and contains valid JSON data.

### Agent Mode cannot read or write a file

Check that the file path is inside the configured working directory. Agent tools cannot access paths outside the working directory.

### Agent web search fails

Add a Brave Search API key in Settings.

### A response stops or errors

Possible causes include:

- Vendor API outage
- Invalid API key
- Model not available
- Network issue
- Rate limit or billing issue with the vendor
- Prompt too large for the selected model

Try a different model, check your API key, or retry later.

---

## Privacy and Data Notes

NeuroPanther Chat stores settings locally in:

```text
~/.neuropanther-chat-settings.json
```

This file can include API keys, the selected working directory, colors, and license information.

Chat data is saved only when you save a `.chat` file or export the conversation.

When you use cloud AI vendors, your prompts, conversation context, attachments, and images may be sent to the selected vendor's API. Review each vendor's privacy and data retention policies.

When you use Ollama, model inference is performed locally, but your prompts and files still remain visible to the local machine and local model environment.

Agent Mode can read files, write files, run commands, and search the web after you approve tool calls. Always review tool requests before approving them.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| **Enter** | Send message |
| **Shift+Enter** | Insert a newline in the message box |
| **Cmd/Ctrl+N** | New chat window |
| **Cmd/Ctrl+T** | New chat tab |
| **Cmd/Ctrl+W** | Close current tab |
| **Cmd/Ctrl+Shift+W** | Close current window |
| **Cmd/Ctrl+S** | Save chat as `.chat` file |
| **Cmd/Ctrl+O** | Load chat file |
| **Cmd/Ctrl+P** | Print chat |
| **Escape** | Close enlarged image or stop text-to-speech |

---

## Quick Start

1. Open NeuroPanther Chat.
2. Open **Settings…**.
3. Choose a vendor and model.
4. Enter the vendor API key.
5. Click **Save**.
6. Type a message.
7. Press **Enter**.
8. Save your conversation with **Cmd/Ctrl+S** if you want to keep it.

---

## Best Practices

- Use separate tabs for separate topics.
- Save important chats as `.chat` files.
- Export final results as Markdown, HTML, or PDF.
- Use text attachments for code review and document analysis.
- Choose a small, specific working directory for Agent Mode.
- Review all Agent Mode tool calls before approval.
- Keep API keys private and avoid sharing your settings file.
