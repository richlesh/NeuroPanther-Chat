# NeuroPanther Chat — Development Guidelines

## Code Style & Formatting

- **Quotes**: Double quotes for all strings (`"value"`, not `'value'`) — consistent across all JS files
- **Semicolons**: Always present at end of statements
- **Indentation**: 2 spaces throughout
- **Braces**: Same-line opening braces (`if (x) {`, not next-line)
- **Trailing commas**: Used in multi-line object/array literals
- **Arrow functions**: Preferred for callbacks and short handlers
- **Optional chaining**: Used freely (`win?.close()`, `settings.apiKeys?.[vendor]`)

## Naming Conventions

- **Variables/functions**: camelCase (`createWindow`, `openSettings`, `vendorCfg`)
- **Constants**: camelCase for module-level (`SETTINGS_PATH`, `VENDORS`, `LICENSE_SALT` are SCREAMING_SNAKE for true constants)
- **IPC channel names**: kebab-case strings (`"chat"`, `"save-chat-dialog"`, `"get-vendors-and-settings"`)
- **File names**: kebab-case (`settings.js`, `generate_neuropanther_chat_license_key.py`)
- **HTML files**: lowercase, descriptive (`about.html`, `splash.html`, `license_dialog.html`)

## IPC Architecture Pattern

All privileged operations follow this exact pattern:

**Main process (main.js):**
```js
ipcMain.handle("channel-name", async (_event, payload) => {
  // do work
  return result; // or throw on error
});
```

**Renderer (index.html inline script):**
```js
const result = await ipcRenderer.invoke("channel-name", payload);
```

- Use `ipcMain.handle` / `ipcRenderer.invoke` for request-response (async, returns value)
- Use `ipcMain.on` / `ipcRenderer.send` for fire-and-forget events (tab drag, close-confirmed)
- Use `ipcMain.handleOnce` / `ipcMain.once` for one-shot dialogs (about close, splash close)
- First parameter of handlers is always `_event` or `_e` (underscore-prefixed when unused)
- Errors from API calls are thrown (not returned as error objects) so the renderer's try/catch handles them

## Vendor API Call Pattern

Text chat follows a branching pattern — Anthropic uses its own SDK, everything else uses OpenAI SDK with `baseURL`:

```js
if (vendor === "anthropic") {
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({ model, max_tokens: 4096, messages });
  return res.content[0].text;
}
// All other vendors (OpenAI, DeepSeek, Alibaba, Meta, Google text)
const client = new OpenAI({ apiKey, baseURL: VENDORS[vendor]?.baseURL });
const res = await client.chat.completions.create({ model, messages });
return res.choices[0].message.content;
```

- Always instantiate SDK clients fresh per request (no caching)
- `VENDORS[vendor]?.baseURL` is `undefined` for OpenAI (uses default), set for others
- API key missing check: `if (!apiKey) throw new Error("You need to set the API key in Settings...")`

## Settings Module Pattern

`settings.js` is the single source of truth for persistence:

```js
const { load, save, VENDORS } = require("./settings");
```

- `load()` always returns a complete settings object with defaults merged in
- `save(settings)` writes the full object (caller merges first: `save({ ...existing, ...newSettings })`)
- Migration logic lives in `load()` (e.g., legacy `apiKey` → `apiKeys` map)
- `VENDORS` is re-exported from `settings.js` so main.js has one import for both

## Window Management Pattern

- Singleton windows (settings, license) use a module-level variable + guard:
  ```js
  let settingsWin;
  function openSettings() {
    if (settingsWin) return settingsWin.focus();
    settingsWin = new BrowserWindow({ ... });
    settingsWin.on("closed", () => { settingsWin = null; });
  }
  ```
- All secondary windows: `resizable: false`, `modal: true`, `parent: mainWin`, `setMenuBarVisibility(false)`
- All windows use `nodeIntegration: true, contextIsolation: false` (renderer has full Node access)
- Data passed to new windows via `webContents.send` inside `webContents.once("did-finish-load", ...)`

## Data URL / Base64 Image Pattern

Images are always converted to `data:image/png;base64,...` strings immediately after generation/fetch, so URLs never expire:

```js
const response = await fetch(imageUrl);
const arrayBuffer = await response.arrayBuffer();
const b64 = Buffer.from(arrayBuffer).toString("base64");
return `data:image/png;base64,${b64}`;
```

Decoding back to buffer for file writes:
```js
const base64 = url.split(",")[1];
fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
```

## File Save Dialog Pattern

Consistent pattern for all save dialogs:
```js
const { filePath } = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() || mainWin, {
  title: "Save ...",
  defaultPath: path.join(require("os").homedir(), "Documents", `${safeName}.ext`),
  filters: [{ name: "Type", extensions: ["ext"] }]
});
if (!filePath) return; // user cancelled — always guard
```

- Filename sanitization: `.replace(/[^a-z0-9\-_ ]/gi, "_")`
- Default save location: `~/Documents` for chat exports, `~/Downloads` for images

## License Key Pattern

HMAC-SHA256 based, shared between JS (main.js) and Python (generate_neuropanther_chat_license_key.py):
- Salt: `"NeuroPanther-Chat-2026"`
- Input: `userName.toLowerCase().trim()`
- Output: first 16 hex chars, uppercased
- Validation: constant-time string comparison after normalizing to uppercase

## Config-Driven Vendor Extension

To add a new vendor, only `config.json` needs updating:
```json
"newvendor": {
  "label": "Display Name",
  "models": ["model-id-1"],
  "apiKeyUrl": "https://...",
  "baseURL": "https://api.newvendor.com/v1",
  "imageGeneration": false
}
```
If the vendor uses an OpenAI-compatible API, no code changes are needed. Only Anthropic and Google image generation require SDK-specific branches in main.js.

## Error Handling

- API calls in IPC handlers: let errors propagate (throw), renderer wraps in try/catch
- Settings load: silent catch returns defaults (`catch { return { ...DEFAULTS }; }`)
- Model fetch failures: return `null` or fall back to `VENDORS[vendor]?.models`
- No global error handlers — errors surface naturally to the renderer

## Python Utility Style

- Shebang: `#!/usr/bin/env python3`
- stdlib only (no third-party deps)
- Minimal: argument validation → compute → print, no classes or extra abstraction
