const { app, BrowserWindow, ipcMain, Menu, nativeImage, dialog, shell } = require("electron");
const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } = require("@aws-sdk/client-bedrock-runtime");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { spawn } = require("child_process");
const nodeCrypto = require("crypto");
const { load, save, VENDORS } = require("./settings");
const { expectedLicenseKey, isValidLicense } = require("./utilities.js");
const genericVendorConfig = require("./generic-vendor-config");

// ── Dynamic (user-added) generic vendors ──────────────────────────────────────
// Users can add named OpenAI-compatible or YAML vendors via Settings. They are
// stored in settings.customVendors keyed by a prefixed id and routed through
// dedicated OpenAI-compatible or YAML code paths.
//   OpenAI-compat dynamic id: "genericopenai_<Name>"  label "<Name> (OpenAI)"
//   YAML dynamic id:          "genericyaml_<Name>"     label "<Name> (YAML)"
const DYN_OPENAI_PREFIX = "genericopenai_";
const DYN_YAML_PREFIX = "genericyaml_";

// A YAML-driven vendor (dynamic genericyaml_*)
function isYamlVendor(v) {
  return v.startsWith(DYN_YAML_PREFIX);
}
// An OpenAI-compatible generic vendor (dynamic genericopenai_*)
function isOpenAIGeneric(v) {
  return v.startsWith(DYN_OPENAI_PREFIX);
}
// Any generic vendor (either flavour)
function isGenericVendor(v) {
  return isYamlVendor(v) || isOpenAIGeneric(v);
}
// The on-disk YAML path for a dynamic YAML vendor id (null for the singleton/non-YAML)
function yamlConfigPathForVendor(v) {
  if (v.startsWith(DYN_YAML_PREFIX)) {
    return genericVendorConfig.configPathForName(v.slice(DYN_YAML_PREFIX.length));
  }
  return null; // singleton "generic" uses the module default path
}
// Extract the display name from a dynamic vendor id
function dynVendorName(v) {
  if (v.startsWith(DYN_OPENAI_PREFIX)) return v.slice(DYN_OPENAI_PREFIX.length);
  if (v.startsWith(DYN_YAML_PREFIX)) return v.slice(DYN_YAML_PREFIX.length);
  return v;
}

// ── Debug logging ─────────────────────────────────────────────────────────────
// When "debug": true is set in resources/config.json, each LLM request writes the
// system prompt, the prompt sent to the model, and the response to markdown files
// in the user's home directory. Read fresh each call so toggling config.json takes
// effect without a restart. All writes are best-effort and never break a request.
const DEBUG_SYSTEM_PROMPT_PATH = path.join(require("os").homedir(), ".neuropanther-chat-ai-system-prompt.md");
const DEBUG_PROMPT_PATH        = path.join(require("os").homedir(), ".neuropanther-chat-ai-prompt.md");
const DEBUG_RESPONSE_PATH      = path.join(require("os").homedir(), ".neuropanther-chat-ai-response.md");

function isDebugEnabled() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "resources", "config.json"), "utf8"));
    return cfg.debug === true;
  } catch {
    return false;
  }
}

// Build a Markdown image tag (data URL) so the debug log renders the actual
// image bytes in any Markdown viewer. Returns null if no image data is found.
function debugImageMarkdown(part) {
  if (!part || typeof part !== "object") return null;
  // Canonical renderer shape: { type: "image", base64, mediaType }
  if (part.base64) {
    const mime = part.mediaType || "image/png";
    return `![image](data:${mime};base64,${part.base64})`;
  }
  // OpenAI-compatible shape: { type: "image_url", image_url: { url } }
  if (part.image_url && part.image_url.url) {
    return `![image](${part.image_url.url})`;
  }
  // Anthropic shape: { type: "image", source: { type: "base64", media_type, data } }
  if (part.source && part.source.data) {
    const mime = part.source.media_type || "image/png";
    return `![image](data:${mime};base64,${part.source.data})`;
  }
  // Bedrock shape: { image: { format, source: { bytes } } }
  if (part.image && part.image.source && part.image.source.bytes) {
    const buf = part.image.source.bytes;
    const b64 = Buffer.isBuffer(buf) ? buf.toString("base64") : Buffer.from(buf).toString("base64");
    const fmt = part.image.format || "png";
    return `![image](data:image/${fmt};base64,${b64})`;
  }
  // Google inlineData shape: { inlineData: { mimeType, data } }
  if (part.inlineData && part.inlineData.data) {
    const mime = part.inlineData.mimeType || "image/png";
    return `![image](data:${mime};base64,${part.inlineData.data})`;
  }
  if (part.type === "image" || part.type === "image_url" || part.type === "input_image") {
    return "![image](data:,)"; // image part with no inline data available
  }
  return null;
}

// Flatten a single message's content (string | multimodal array | tool-call object)
// into readable Markdown for the debug log. Image parts are embedded as Markdown
// images (data URLs) so the log is a complete, accurate representation of what is
// sent to the AI.
function debugStringifyContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (part == null) return "";
      if (typeof part === "string") return part;
      const imgMd = debugImageMarkdown(part);
      if (imgMd) return imgMd;
      if (part.type === "tool_use") return `[tool_use ${part.name}(${JSON.stringify(part.input || {})})]`;
      if (part.text) return part.text;
      return JSON.stringify(part);
    }).join("\n");
  }
  try { return JSON.stringify(content, null, 2); } catch { return String(content); }
}

// Write the system prompt and the full prompt (message history) to disk if debug on.
function writeDebugPrompts(messages) {
  if (!isDebugEnabled() || !Array.isArray(messages)) return;
  try {
    const systemMsg = messages.find(m => m.role === "system");
    const systemText = systemMsg ? debugStringifyContent(systemMsg.content) : "(no system prompt)";
    fs.writeFileSync(DEBUG_SYSTEM_PROMPT_PATH, `# System Prompt\n\n${systemText}\n`, "utf8");

    const promptSections = messages
      .filter(m => m.role !== "system")
      .map(m => {
        let body = debugStringifyContent(m.content);
        if (m.tool_calls) body += (body ? "\n" : "") + m.tool_calls.map(tc => `[tool_call ${tc.function?.name}(${tc.function?.arguments})]`).join("\n");
        return `## ${m.role}\n\n${body}\n`;
      });
    fs.writeFileSync(DEBUG_PROMPT_PATH, `# Prompt Sent to LLM\n\n${promptSections.join("\n")}`, "utf8");
  } catch {
    // best-effort — never break the request
  }
}

// Write the image-generation prompt (and any source image actually sent) to disk
// if debug on. Output is Markdown so the source image renders in a Markdown viewer.
function writeDebugImagePrompt({ promptText, vendor, model, sourceImageBase64, sourceMediaType }) {
  if (!isDebugEnabled()) return;
  try {
    const sections = [
      "# Image Generation Prompt Sent to LLM",
      "",
      `**Vendor:** ${vendor || "(unknown)"}`,
      `**Model:** ${model || "(unknown)"}`,
      `**Prompt length:** ${(promptText || "").length} characters`,
      "",
      "## Prompt",
      "",
      promptText || "(empty)",
      "",
      "## Source Image",
      "",
    ];
    if (sourceImageBase64) {
      const mime = sourceMediaType || "image/png";
      sections.push(`![source image](data:${mime};base64,${sourceImageBase64})`);
    } else {
      sections.push("(none — text-to-image generation)");
    }
    sections.push("");
    fs.writeFileSync(DEBUG_PROMPT_PATH, sections.join("\n"), "utf8");
  } catch {
    // best-effort — never break the request
  }
}

// Write the model's response to disk if debug on.
function writeDebugResponse(text) {
  if (!isDebugEnabled()) return;
  try {
    fs.writeFileSync(DEBUG_RESPONSE_PATH, `# LLM Response\n\n${typeof text === "string" ? text : String(text ?? "")}\n`, "utf8");
  } catch {
    // best-effort
  }
}
// Build the full vendor map (static VENDORS + user-added customVendors) for the UI.
function mergedVendors() {
  const settings = load();
  const custom = settings.customVendors || {};
  const out = { ...VENDORS };
  for (const [id, def] of Object.entries(custom)) {
    out[id] = {
      label: def.label || id,
      models: [],
      apiKeyUrl: "",
      imageGeneration: false,
    };
  }
  return out;
}

function openExternal(url) {
  if (process.platform === "linux") {
    const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    child.unref();
  } else {
    shell.openExternal(url);
  }
}

const appIcon = nativeImage.createFromPath(path.join(__dirname, "resources", "app_icon.icns"));

app.name = "NeuroPanther Chat";

app.setAboutPanelOptions({
  applicationName: "NeuroPanther Chat",
  applicationVersion: require("./package.json").version,
  credits: `by Richard Lesh\nBuilt with Electron v${process.versions.electron}`,
  website: "https://glowingcatsoftware.com/NeuroPanther-Chat.html",
  iconImage: appIcon
});

let mainWin, settingsWin;
const pendingLoadData = new Map();
// Tracks per-window metadata (name = active tab title, tab count) for the
// Window menu's "Open Windows" list. Keyed by BrowserWindow id.
const windowInfo = new Map();
let messageCount = 0;

function checkMessageNag() {
  messageCount++;
  if (messageCount % 7 !== 0) return;
  const { licenseKey, userName } = load();
  if (!isValidLicense(licenseKey, userName)) showSplash(true);
}

function loadChatFile(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const fileName = path.basename(filePath, ".chat");
    return { ...raw, chatLog: raw.chatLog ?? raw.messages ?? [], title: fileName };
  } catch { return null; }
}

// macOS: file dropped onto app icon
let pendingOpenFile = null;
app.on("open-file", (e, filePath) => {
  e.preventDefault();
  if (!filePath.endsWith(".chat")) return;
  const data = loadChatFile(filePath);
  if (!data) return;
  if (app.isReady() && mainWin) {
    // App already open — load into existing window as a new tab
    mainWin.focus();
    mainWin.webContents.send("open-chat-tab", data);
  } else {
    // App not yet ready — store and pick up after window loads
    pendingOpenFile = data;
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    icon: appIcon,
    webPreferences: { 
      nodeIntegration: true, 
      contextIsolation: false,
      enableBlinkFeatures: '',
      disableBlinkFeatures: 'AutomationControlled'
    }
  });
  win.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(["microphone", "media"].includes(permission));
  });
  win.loadFile("index.html");
  if (!mainWin) {
    mainWin = win;
    buildMenu();
  }
  // Keep the Window menu's open-windows list in sync with this window's lifecycle.
  win.on("closed", () => {
    windowInfo.delete(win.id);
    buildMenu();
  });
  win.on("focus", () => buildMenu()); // reflect checkmark on the focused window
  buildMenu();
  return win;
}

let aboutWin;
function showAbout() {
  if (aboutWin && !aboutWin.isDestroyed()) return aboutWin.focus();
  aboutWin = new BrowserWindow({
    width: 320,
    height: 440,
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: mainWin,
    modal: true,
    icon: appIcon,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  aboutWin.setMenuBarVisibility(false);
  aboutWin.loadFile("about.html");
  aboutWin.once("ready-to-show", () => {
    if (mainWin && !mainWin.isDestroyed()) {
      const [px, py] = mainWin.getPosition();
      const [pw, ph] = mainWin.getSize();
      const [w, h] = aboutWin.getSize();
      aboutWin.setPosition(Math.round(px + (pw - w) / 2), Math.round(py + (ph - h) / 2));
    }
    aboutWin.show();
  });
  aboutWin.webContents.once("did-finish-load", () => {
    aboutWin.webContents.send("icon-path", path.join(__dirname, "resources", "app_icon.png"));
    aboutWin.webContents.send("app-version", require("./package.json").version);
    const { licenseKey, userName } = load();
    if (isValidLicense(licenseKey, userName)) aboutWin.webContents.send("licensed");
  });
  ipcMain.handleOnce("close-about", () => aboutWin?.close());
  aboutWin.on("closed", () => { aboutWin = null; });
}

// Build the dynamic "Open Windows" section for the Window menu: one item per open
// chat window, labeled "<name> (<tabCount>)". Selecting an item brings that window
// to the front. Returns [] when there are no chat windows.
function buildOpenWindowsMenuItems() {
  const chatWindows = BrowserWindow.getAllWindows().filter(w => {
    if (w.isDestroyed()) return false;
    const url = w.webContents.getURL();
    return url.includes("index.html");
  });
  if (chatWindows.length === 0) return [];
  const focused = BrowserWindow.getFocusedWindow();
  const items = chatWindows.map(w => {
    const info = windowInfo.get(w.id) || { name: "NeuroPanther Chat", tabCount: 0 };
    const count = info.tabCount || 0;
    const label = `${info.name || "NeuroPanther Chat"} (${count})`;
    return {
      label,
      type: "checkbox",
      checked: !!focused && focused.id === w.id,
      click: () => {
        if (w.isDestroyed()) return;
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
      }
    };
  });
  return [{ type: "separator" }, { label: "Open Windows", enabled: false }, ...items];
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    {
      label: app.name,
      submenu: [
        { label: "About NeuroPanther Chat", click: showAbout },
        { type: "separator" },
        { label: "Settings…", click: openSettings },
        { label: "License Key…", click: openLicense },
        { type: "separator" },
        ...(isMac ? [
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
        ] : []),
        { role: "quit" }
      ]
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Chat Window",
          accelerator: "CmdOrCtrl+N",
          click: () => createWindow()
        },
        {
          label: "New Chat Tab",
          accelerator: "CmdOrCtrl+T",
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send("new-tab")
        },
        { type: "separator" },
        {
          label: "Close Tab",
          accelerator: "CmdOrCtrl+W",
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send("close-tab")
        },
        { type: "separator" },
        {
          label: "Save Chat As…",
          accelerator: "CmdOrCtrl+S",
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send("save-chat")
        },
        {
          label: "Load Chat…",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const { filePaths } = await dialog.showOpenDialog(mainWin, {
              title: "Load Chat",
              filters: [{ name: "Chat Files", extensions: ["chat"] }],
              properties: ["openFile"]
            });
            if (!filePaths?.length) return;
            const raw = JSON.parse(fs.readFileSync(filePaths[0], "utf8"));
            const fileName = path.basename(filePaths[0], ".chat");
            const data = { ...raw, chatLog: raw.chatLog ?? raw.messages ?? [], title: fileName };
            const win = createWindow();
            pendingLoadData.set(win.id, data);
          }
        },
        { type: "separator" },
        {
          label: "Export",
          submenu: [
            {
              label: "HTML…",
              click: () => BrowserWindow.getFocusedWindow()?.webContents.send("export-chat", "html")
            },
            {
              label: "Markdown…",
              click: () => BrowserWindow.getFocusedWindow()?.webContents.send("export-chat", "markdown")
            },
            {
              label: "PDF…",
              click: () => BrowserWindow.getFocusedWindow()?.webContents.send("export-chat", "pdf")
            }
          ]
        },
        { type: "separator" },
        {
          label: "Print…",
          accelerator: "CmdOrCtrl+P",
          click: () => BrowserWindow.getFocusedWindow()?.webContents.print()
        },
        { type: "separator" },
        {
          label: "Close Window",
          accelerator: "CmdOrCtrl+Shift+W",
          click: () => BrowserWindow.getFocusedWindow()?.close()
        }
      ]
    },
    { role: "editMenu" },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        ...(isMac ? [{ role: "zoom" }] : []),
        { type: "separator" },
        {
          label: "Toggle Developer Tools",
          accelerator: isMac ? "Cmd+Option+I" : "Ctrl+Shift+I",
          click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools()
        },
        ...(isMac ? [
          { type: "separator" },
          { role: "front" },
        ] : []),
        ...buildOpenWindowsMenuItems(),
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Online Help",
          click: () => shell.openExternal("https://github.com/richlesh/NeuroPanther-Chat/blob/main/User_Manual.md")
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let licenseWin;

function openLicense() {
  if (licenseWin) return licenseWin.focus();
  licenseWin = new BrowserWindow({
    width: 400,
    height: 290,
    resizable: false,
    parent: mainWin,
    modal: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  licenseWin.setMenuBarVisibility(false);
  licenseWin.loadFile("license_dialog.html");
  licenseWin.webContents.once("did-finish-load", () => {
    const { licenseKey, userName } = load();
    licenseWin.webContents.send("license-data", { key: licenseKey || "", userName: userName || "" });
  });
  licenseWin.on("closed", () => { licenseWin = null; });
}

ipcMain.handle("license-save", (_e, { key, userName }) => {
  if (!isValidLicense(key, userName)) return;
  const settings = load();
  settings.licenseKey = key.toUpperCase();
  settings.userName   = userName;
  save(settings);
  licenseWin?.close();
});

ipcMain.handle("license-cancel", () => licenseWin?.close());

function openSettings() {
  if (settingsWin) return settingsWin.focus();
  settingsWin = new BrowserWindow({
    width: 840,
    height: 765,
    resizable: false,
    parent: mainWin,
    modal: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile("settings.html");
  settingsWin.on("closed", () => { settingsWin = null; });
}

ipcMain.handle("export-html", async (_event, { messages, title }) => {
  const safeName = (title || "chat").replace(/[^a-z0-9\-_ ]/gi, "_");
  const { filePath } = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() || mainWin, {
    title: "Export as HTML",
    defaultPath: path.join(require("os").homedir(), "Documents", `${safeName}.html`),
    filters: [{ name: "HTML Files", extensions: ["html"] }]
  });
  if (!filePath) return;
  const folder = path.dirname(filePath);
  const baseName = path.basename(filePath, ".html");
  const imagesDirName = `${baseName}_images`;
  const imagesDir = path.join(folder, imagesDirName);
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir);

  const { marked } = require("marked");
  let body = "";
  for (const msg of messages) {
    const role = msg.role === "user" ? "user" : "assistant";
    let content = "";
    if (msg.images?.length) {
      for (let i = 0; i < msg.images.length; i++) {
        const src = msg.images[i];
        const imgName = `${role}-${Date.now()}-${i}.png`;
        const imgPath = path.join(imagesDir, imgName);
        if (src.startsWith("data:")) {
          fs.writeFileSync(imgPath, Buffer.from(src.split(",")[1], "base64"));
          content += `<img src="${imagesDirName}/${imgName}" style="max-width:200px"><br>`;
        }
      }
    }
    if (msg.content) {
      content += role === "user"
        ? `<p>${msg.content.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>")}</p>`
        : marked.parse(msg.content);
    }
    body += `<div class="msg ${role}">${content}</div>\n`;
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${title || "Chat Export"}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono+NL:wght@400;700&display=swap">
<style>
body{font-family:-apple-system,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;}
.msg{margin-bottom:16px;padding:10px 14px;border-radius:12px;}
.user{background:#e8f0fe;text-align:right;}
.assistant{background:#f5f5f5;}
.assistant p{margin:0 0 8px;}
.assistant p:last-child{margin-bottom:0;}
.assistant pre{background:#e8e8e8;border-radius:8px;padding:12px;overflow-x:auto;margin:8px 0;}
.assistant code{font-family:'JetBrains Mono',monospace;font-size:13px;background:#e8e8e8;padding:1px 4px;border-radius:3px;}
.assistant pre code{background:none;padding:0;}
img{border-radius:8px;display:block;margin:6px 0;}
</style></head><body>${body}</body></html>`;
  fs.writeFileSync(filePath, html, "utf8");
});

ipcMain.handle("export-markdown", async (_event, { messages, title }) => {
  const safeName = (title || "chat").replace(/[^a-z0-9\-_ ]/gi, "_");
  const { filePath } = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() || mainWin, {
    title: "Export as Markdown",
    defaultPath: path.join(require("os").homedir(), "Documents", `${safeName}.md`),
    filters: [{ name: "Markdown Files", extensions: ["md"] }]
  });
  if (!filePath) return;
  const folder = path.dirname(filePath);
  const baseName = path.basename(filePath, ".md");
  const imagesDirName = `${baseName}_images`;
  const imagesDir = path.join(folder, imagesDirName);
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir);

  let md = title ? `# ${title}\n\n` : "";
  for (const msg of messages) {
    const role = msg.role === "user" ? "**You**" : "**Assistant**";
    let header = role;
    if (msg.timestamp != null) {
      const ts = new Date(msg.timestamp * 1000).toLocaleString(undefined, {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        timeZoneName: "short"
      });
      header += ` — ${ts}`;
    }
    md += `${header}\n\n`;
    if (msg.images?.length) {
      for (let i = 0; i < msg.images.length; i++) {
        const src = msg.images[i];
        const imgName = `${msg.role}-${Date.now()}-${i}.png`;
        const imgPath = path.join(imagesDir, imgName);
        if (src.startsWith("data:")) {
          fs.writeFileSync(imgPath, Buffer.from(src.split(",")[1], "base64"));
          md += `![image](${imagesDirName}/${imgName})\n\n`;
        }
      }
    }
    if (msg.content) md += `${msg.content}\n\n`;
    md += "---\n\n";
  }
  fs.writeFileSync(filePath, md, "utf8");
});

ipcMain.handle("export-pdf", async (_event, dummy, win) => {
  const focusedWin = BrowserWindow.getFocusedWindow() || mainWin;
  const { filePath } = await dialog.showSaveDialog(focusedWin, {
    title: "Export as PDF",
    defaultPath: path.join(require("os").homedir(), "Documents", "chat.pdf"),
    filters: [{ name: "PDF Files", extensions: ["pdf"] }]
  });
  if (!filePath) return;
  const data = await focusedWin.webContents.printToPDF({ printBackground: false });
  fs.writeFileSync(filePath, data);
});

ipcMain.handle("save-chat-dialog", async (_event, data) => {
  const win = BrowserWindow.getFocusedWindow() || mainWin;
  const safeName = (data.title || "chat").replace(/[^a-z0-9\-_ ]/gi, "_");
  const { filePath } = await dialog.showSaveDialog(win, {
    title: "Save Chat",
    defaultPath: path.join(require("os").homedir(), "Documents", `${safeName}.chat`),
    filters: [{ name: "Chat Files", extensions: ["chat"] }]
  });
  if (!filePath) return false;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  return true;
});

async function fetchModels(vendor, apiKey) {
  if (vendor === "ollama") {
    const res = await fetch("http://localhost:11434/api/tags");
    const json = await res.json();
    return (json.models || []).map(m => m.name).sort();
  }
  if (vendor === "anthropic") {
    const client = new Anthropic({ apiKey });
    const res = await client.models.list();
    return res.data.map(m => m.id).sort();
  }
  if (vendor === "perplexity") {
    const base = (VENDORS[vendor]?.baseURL || "").replace(/\/+$/, "");
    const client = new OpenAI({ apiKey, baseURL: `${base}/v1` });
    const res = await client.models.list();
    return res.data.map(m => m.id.replace(/^[^/]+\//, "")).sort();
  }
  const client = new OpenAI({ apiKey, baseURL: VENDORS[vendor]?.baseURL });
  const res = await client.models.list();
  return res.data.map(m => m.id.replace(/^models\//, "")).sort();
}

ipcMain.handle("fetch-models", async (_event, { vendor, apiKey, baseURL }) => {
  try {
    if (baseURL) {
      const client = new OpenAI({ apiKey: apiKey || "none", baseURL });
      const res = await client.models.list();
      return res.data.map(m => m.id).sort();
    }
    return await fetchModels(vendor, apiKey);
  } catch {
    return null;
  }
});

ipcMain.handle("get-models-for-vendor", async (_event, vendor) => {
  const { apiKeys } = load();
  const apiKey = apiKeys?.[vendor] || "";
  if (!apiKey && vendor !== "ollama" && vendor !== "amazon" && vendor !== "microsoft" && vendor !== "ibm" && !vendor.startsWith("generic")) return null;
  if (vendor === "amazon") {
    if (!apiKeys?.amazonAccessKey || !apiKeys?.amazonSecretKey) return null;
    return VENDORS[vendor]?.models || null;
  }
  if (vendor === "microsoft") {
    if (!apiKeys?.microsoftApiKey || !apiKeys?.microsoftEndpoint) return null;
    try {
      const endpoint = (apiKeys.microsoftEndpoint || "").replace(/\/+$/, "");
      const client = new OpenAI({ apiKey: apiKeys.microsoftApiKey, baseURL: `${endpoint}/openai/v1/`, defaultHeaders: { "api-key": apiKeys.microsoftApiKey } });
      const res = await client.models.list();
      const models = res.data.map(m => m.id).sort();
      return models.length ? models : VENDORS[vendor]?.models || null;
    } catch {
      return VENDORS[vendor]?.models || null;
    }
  }
  if (vendor === "ibm") {
    if (!apiKeys?.ibmApiKey || !apiKeys?.ibmEndpoint) return null;
    try {
      const endpoint = (apiKeys.ibmEndpoint || "").replace(/\/+$/, "");
      const headers = apiKeys.ibmProjectId ? { "X-IBM-Project-Id": apiKeys.ibmProjectId } : undefined;
      const client = new OpenAI({ apiKey: apiKeys.ibmApiKey, baseURL: `${endpoint}/ml/gateway/v1`, defaultHeaders: headers });
      const res = await client.models.list();
      const models = res.data.map(m => m.id).sort();
      return models.length ? models : VENDORS[vendor]?.models || null;
    } catch {
      return VENDORS[vendor]?.models || null;
    }
  }
  if (isYamlVendor(vendor)) {
    const gApiKey = apiKeys?.[vendor + "ApiKey"] || "";
    try {
      const configPath = yamlConfigPathForVendor(vendor);
      const models = await genericVendorConfig.fetchModels(gApiKey, configPath);
      return models.length ? models : null;
    } catch {
      return null;
    }
  }
  if (isOpenAIGeneric(vendor)) {
    const gApiKey = apiKeys?.[vendor + "ApiKey"] || "";
    const gEndpoint = (apiKeys?.[vendor + "Endpoint"] || "").replace(/\/+$/, "");
    if (!gEndpoint) return null;
    try {
      const client = new OpenAI({ apiKey: gApiKey || "none", baseURL: gEndpoint });
      const res = await client.models.list();
      const models = res.data.map(m => m.id).sort();
      return models.length ? models : null;
    } catch {
      return null;
    }
  }
  try {
    return await fetchModels(vendor, apiKey);
  } catch (e) {
    console.error(`get-models-for-vendor [${vendor}]:`, e.message);
    return VENDORS[vendor]?.models || null;
  }
});

ipcMain.handle("ollama-available", async () => {
  try {
    const res = await fetch("http://localhost:11434/api/tags");
    if (!res.ok) return false;
    const json = await res.json();
    return (json.models || []).map(m => m.name).sort();
  } catch {
    return false;
  }
});

ipcMain.handle("settings-get-data", () => ({ settings: load(), VENDORS: mergedVendors() }));

ipcMain.handle("get-vendors-and-settings", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const pending = win ? pendingLoadData.get(win.id) : null;
  if (pending) pendingLoadData.delete(win.id);
  const openFile = pendingOpenFile;
  pendingOpenFile = null;
  return { vendors: mergedVendors(), settings: load(), pendingLoad: pending || openFile || null };
});

ipcMain.handle("get-config", () => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "resources", "config.json"), "utf8")); } catch { return {}; }
});

ipcMain.handle("get-system-prompt", () => {
  try {
    return fs.readFileSync(path.join(__dirname, "resources", "system_prompt.md"), "utf8").trim();
  } catch {
    return "";
  }
});


ipcMain.handle("settings-save", (_e, newSettings) => {
  const existing = load();
  save({ ...existing, ...newSettings });
  settingsWin?.close();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("settings-updated");
  }
});

ipcMain.handle("settings-cancel", () => settingsWin?.close());

// ── Generic (YAML) vendor editor ──────────────────────────────────────────────
let genericEditorWin;
let genericEditorConfigPath = null; // null => singleton "generic" vendor

ipcMain.handle("open-generic-yaml-editor", (_e, vendor) => {
  // vendor is a dynamic YAML vendor id (genericyaml_<Name>)
  genericEditorConfigPath = vendor ? yamlConfigPathForVendor(vendor) : null;
  if (genericEditorWin) { genericEditorWin.focus(); return; }
  genericEditorWin = new BrowserWindow({
    width: 700,
    height: 600,
    resizable: true,
    icon: appIcon,
    parent: settingsWin || undefined,
    modal: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  genericEditorWin.setMenuBarVisibility(false);
  genericEditorWin.loadFile("generic-config-editor.html");
  genericEditorWin.webContents.once("did-finish-load", () => {
    const settings = load();
    const theme = settings.theme || "system";
    const isDark = theme === "dark";
    genericEditorWin.webContents.send("set-theme", isDark ? "dark" : "light");
    genericEditorWin.webContents.send("load-yaml", genericVendorConfig.loadYamlString(genericEditorConfigPath));
  });
  genericEditorWin.on("closed", () => { genericEditorWin = null; });
});

ipcMain.handle("save-generic-yaml", (_e, yamlStr) => {
  genericVendorConfig.saveYamlString(yamlStr, genericEditorConfigPath);
  if (!genericEditorConfigPath) genericVendorConfig.load();
  // Tell the Settings window to refresh its model list for the edited vendor.
  settingsWin?.webContents.send("generic-yaml-saved");
});

// Create a new user-added (dynamic) generic vendor.
//   type: "openai" | "yaml"; name: alphanumeric string
// Returns { ok, id, label } or { ok:false, error }
ipcMain.handle("create-custom-vendor", (_e, { type, name }) => {
  const clean = String(name || "").trim();
  if (!/^[A-Za-z0-9]+$/.test(clean)) {
    return { ok: false, error: "Name must be alphanumeric (letters and digits only, no spaces)." };
  }
  const settings = load();
  const custom = settings.customVendors || {};
  const prefix = type === "yaml" ? DYN_YAML_PREFIX : DYN_OPENAI_PREFIX;
  const id = prefix + clean;
  const suffix = type === "yaml" ? "(YAML)" : "(OpenAI)";
  const label = `${clean} ${suffix}`;
  // Reject duplicate id or duplicate label against built-ins/customs
  const existingLabels = new Set([
    ...Object.values(VENDORS).map(v => v.label),
    ...Object.values(custom).map(v => v.label),
  ]);
  if (custom[id] || VENDORS[id]) {
    return { ok: false, error: `A vendor named "${clean}" already exists.` };
  }
  if (existingLabels.has(label)) {
    return { ok: false, error: `A vendor labelled "${label}" already exists.` };
  }
  custom[id] = { label, type: (type === "yaml" ? "yaml" : "openai"), name: clean };
  settings.customVendors = custom;
  // For YAML vendors, seed the per-vendor config file with the default template.
  if (type === "yaml") {
    const cfgPath = yamlConfigPathForVendor(id);
    if (cfgPath && !fs.existsSync(cfgPath)) {
      genericVendorConfig.saveYamlString(genericVendorConfig.DEFAULT_YAML, cfgPath);
    }
  }
  save(settings);
  // Notify all windows (e.g. the main chat window) so their vendor lists refresh.
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("settings-updated");
  }
  return { ok: true, id, label };
});

ipcMain.handle("close-generic-yaml-editor", () => {
  genericEditorWin?.close();
});

ipcMain.handle("get-generic-yaml-default", () => {
  return genericVendorConfig.DEFAULT_YAML;
});

ipcMain.handle("open-external", (_e, url) => openExternal(url));

const linkPreviewCache = new Map();

ipcMain.handle("get-link-preview", async (_e, url) => {
  // Check cache first
  if (linkPreviewCache.has(url)) {
    return linkPreviewCache.get(url);
  }
  
  try {
    const response = await fetch(url, { 
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000)
    });
    const html = await response.text();
    
    // Try og:image first
    const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    if (ogMatch) {
      linkPreviewCache.set(url, ogMatch[1]);
      return ogMatch[1];
    }
    
    // Try twitter:image
    const twitterMatch = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
    if (twitterMatch) {
      linkPreviewCache.set(url, twitterMatch[1]);
      return twitterMatch[1];
    }
    
    // Fallback: capture screenshot of the page
    const { BrowserWindow } = require("electron");
    const screenshotWin = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      webPreferences: {
        offscreen: true
      }
    });
    
    await screenshotWin.loadURL(url);
    await new Promise(resolve => setTimeout(resolve, 2000)); // wait for page load
    const image = await screenshotWin.webContents.capturePage();
    screenshotWin.close();
    
    const dataUrl = image.toDataURL();
    linkPreviewCache.set(url, dataUrl);
    return dataUrl;
  } catch {
    linkPreviewCache.set(url, null);
    return null;
  }
});

ipcMain.handle("drop-chat-file", (_e, filePath) => {
  if (!filePath.endsWith(".chat")) return null;
  return loadChatFile(filePath);
});

// ── Agent tools ────────────────────────────────────────────────────────────────
function resolveSafePath(workDir, filePath) {
  const resolved = path.resolve(workDir, filePath);
  if (!resolved.startsWith(path.resolve(workDir))) throw new Error(`Path outside working directory: ${filePath}`);
  return resolved;
}

ipcMain.handle("agent-get-working-dir", () => load().workingDir || null);

ipcMain.handle("agent-browse-dir", async () => {
  const { filePaths } = await dialog.showOpenDialog(settingsWin || mainWin, {
    title: "Select Working Directory",
    properties: ["openDirectory"]
  });
  return filePaths?.[0] || null;
});

ipcMain.handle("agent-set-working-dir", async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWin, {
    title: "Select Working Directory",
    properties: ["openDirectory"]
  });
  if (!filePaths?.length) return null;
  const settings = load();
  save({ ...settings, workingDir: filePaths[0] });
  return filePaths[0];
});

ipcMain.handle("agent-execute-tool", async (_event, { tool, args }) => {
  const settings = load();
  const workDir = settings.workingDir || require("os").homedir();
  try {
    if (tool === "read_file") {
      const p = resolveSafePath(workDir, args.path);
      const content = fs.readFileSync(p, "utf8");
      const MAX = 8000;
      if (content.length > MAX) {
        return { ok: true, result: content.slice(0, MAX) + `\n\n[FILE TRUNCATED: ${content.length} chars total, showing first ${MAX}. File is too large to rewrite safely in one operation — use search_files to find specific sections instead.]` };
      }
      return { ok: true, result: content };
    }
    if (tool === "write_file") {
      const p = resolveSafePath(workDir, args.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, args.content, "utf8");
      return { ok: true, result: `Written ${args.path}` };
    }
    if (tool === "list_directory") {
      const p = resolveSafePath(workDir, args.path || ".");
      const entries = fs.readdirSync(p, { withFileTypes: true });
      return { ok: true, result: entries.map(e => (e.isDirectory() ? `[dir] ${e.name}` : e.name)).join("\n") };
    }
    if (tool === "search_files") {
      const results = [];
      function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") walk(full);
          else if (e.isFile()) {
            try {
              const content = fs.readFileSync(full, "utf8");
              const lines = content.split("\n");
              lines.forEach((line, i) => {
                if (line.toLowerCase().includes(args.pattern.toLowerCase())) {
                  results.push(`${path.relative(workDir, full)}:${i + 1}: ${line.trim()}`);
                }
              });
            } catch { /* skip binary files */ }
          }
        }
      }
      walk(resolveSafePath(workDir, args.path || "."));
      return { ok: true, result: results.slice(0, 100).join("\n") || "No matches found" };
    }
    if (tool === "run_code") {
      if (!fs.existsSync(workDir)) return { ok: false, result: `Working directory does not exist: ${workDir}` };
      return await new Promise(resolve => {
        let resolved = false;
        const proc = spawn(args.command, { shell: process.env.SHELL || true, cwd: workDir });
        let stdout = "", stderr = "";
        proc.stdout.on("data", d => { stdout += d; });
        proc.stderr.on("data", d => { stderr += d; });
        proc.on("error", err => { if (!resolved) { resolved = true; resolve({ ok: false, result: err.message }); } });
        proc.on("close", code => { if (!resolved) { resolved = true; resolve({ ok: true, result: (stdout + stderr).slice(0, 4000) + (code !== 0 ? `\n[exit ${code}]` : "") }); } });
        setTimeout(() => { if (!resolved) { resolved = true; proc.kill(); resolve({ ok: true, result: "[timeout after 30s]" }); } }, 30000);
      });
    }
    if (tool === "web_search") {
      const apiKey = settings.apiKeys?.["brave"] || "";
      if (!apiKey) return { ok: false, result: "Brave Search API key not set in Settings" };
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(args.query)}&count=5`;
      const res = await fetch(url, { headers: { "Accept": "application/json", "X-Subscription-Token": apiKey } });
      const data = await res.json();
      const results = (data.web?.results || []).map(r => `${r.title}\n${r.url}\n${r.description}`).join("\n\n");
      return { ok: true, result: results || "No results" };
    }
    return { ok: false, result: `Unknown tool: ${tool}` };
  } catch (err) {
    return { ok: false, result: err.message };
  }
});

// ── Streaming chat ─────────────────────────────────────────────────────────────
const AGENT_TOOLS = [
  { type: "function", function: { name: "read_file",      description: "Read a file from the working directory",                    parameters: { type: "object", properties: { path: { type: "string", description: "Relative file path" } }, required: ["path"] } } },
  { type: "function", function: { name: "write_file",     description: "Write content to a file in the working directory",          parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function", function: { name: "list_directory", description: "List files and folders in a directory",                     parameters: { type: "object", properties: { path: { type: "string", description: "Relative path, defaults to root" } }, required: [] } } },
  { type: "function", function: { name: "search_files",   description: "Search for a text pattern across files in the project",    parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string", description: "Directory to search, defaults to root" } }, required: ["pattern"] } } },
  { type: "function", function: { name: "run_code",       description: "Run a shell command in the working directory",              parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
  { type: "function", function: { name: "web_search",     description: "Search the web using Brave Search",                        parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } }
];

const ANTHROPIC_TOOLS = AGENT_TOOLS.map(t => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters
}));

const activeAborts = {}; // sid → AbortController
const thinkingDisabled = new Set(); // tracks "vendor:model" keys where thinking is unsupported

ipcMain.on("cancel-stream", (_event, sid) => {
  if (activeAborts[sid]) {
    activeAborts[sid].abort();
    delete activeAborts[sid];
  }
});

async function handleChatStream(event, { messages, vendor, model, agentMode, sid }) {
  const abortController = new AbortController();
  activeAborts[sid] = abortController;
  // Debug logging: dump the system prompt and the prompt sent to the LLM (if enabled).
  writeDebugPrompts(messages);
  // Wrapper that logs the response (if debug) before forwarding stream completion.
  const emitDone = (text) => { writeDebugResponse(text); event.sender.send("stream-done", sid, text); };
  checkMessageNag();
  const settings = load();
  const displayModelActivity = settings.displayModelActivity !== false;
  let apiKey = settings.apiKeys?.[vendor] || "";
  let baseURL = VENDORS[vendor]?.baseURL;
  let defaultHeaders;
  // Microsoft Azure: resolve credentials
  if (vendor === "microsoft") {
    apiKey = settings.apiKeys?.microsoftApiKey || "";
    const endpoint = (settings.apiKeys?.microsoftEndpoint || "").replace(/\/+$/, "");
    if (!apiKey || !endpoint) { event.sender.send("stream-error", sid, "You need to set Azure API Key and Endpoint in Settings before Microsoft can be used."); return; }
    baseURL = `${endpoint}/openai/v1/`;
    defaultHeaders = { "api-key": apiKey };
  }
  // IBM watsonx.ai: resolve credentials
  if (vendor === "ibm") {
    apiKey = settings.apiKeys?.ibmApiKey || "";
    const endpoint = (settings.apiKeys?.ibmEndpoint || "").replace(/\/+$/, "");
    const projectId = settings.apiKeys?.ibmProjectId || "";
    if (!apiKey || !endpoint) { event.sender.send("stream-error", sid, "You need to set IBM Cloud API Key and Endpoint in Settings before IBM can be used."); return; }
    baseURL = `${endpoint}/ml/gateway/v1`;
    defaultHeaders = { ...(projectId ? { "X-IBM-Project-Id": projectId } : {}) };
  }
  // Generic (YAML) vendor: use non-streaming call via generic-vendor-config
  if (isYamlVendor(vendor)) {
    apiKey = settings.apiKeys?.[vendor + "ApiKey"] || "";
    // No key requirement: the YAML config's Headers decide whether auth is sent
    // (e.g. a local Ollama endpoint needs none).
  }
  // Generic vendors: resolve credentials
  if (isOpenAIGeneric(vendor)) {
    apiKey = settings.apiKeys?.[vendor + "ApiKey"] || "";
    const endpoint = (settings.apiKeys?.[vendor + "Endpoint"] || "").replace(/\/+$/, "");
    if (!endpoint) { event.sender.send("stream-error", sid, "You need to set the Endpoint in Settings before this vendor can be used."); return; }
    if (!apiKey) apiKey = "none";
    baseURL = endpoint;
  }
  if (!apiKey && vendor !== "ollama" && vendor !== "amazon" && vendor !== "microsoft" && vendor !== "ibm" && !vendor.startsWith("generic")) { event.sender.send("stream-error", sid, "You need to set the API key in Settings before this LLM vendor can be used."); return; }

  const tools = agentMode ? (vendor === "anthropic" ? ANTHROPIC_TOOLS : AGENT_TOOLS) : undefined;

  // Gemini (google) doesn't support streaming when tool results are in history
  const hasToolResults = messages.some(m => m.role === "tool");
  const useNonStreaming = vendor === "google" && hasToolResults;

  try {
    if (isYamlVendor(vendor)) {
      // Generic (YAML) vendor — non-streaming via custom HTTP
      const lastPrompt = [...messages].reverse().find(m => m.role === "user")?.content || "";
      const plainMessages = messages.map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : (Array.isArray(m.content) ? m.content.map(p => p.text || "").join("") : "") }));
      const configPath = yamlConfigPathForVendor(vendor);
      const content = await genericVendorConfig.callPrompt(apiKey, model, lastPrompt, plainMessages, configPath);
      emitDone(content || "");
      delete activeAborts[sid];
      return;
    }
    if (vendor === "amazon") {
      const amazonAccessKey = settings.apiKeys?.amazonAccessKey || "";
      const amazonSecretKey = settings.apiKeys?.amazonSecretKey || "";
      const amazonRegion    = settings.apiKeys?.amazonRegion || "us-east-1";
      if (!amazonAccessKey || !amazonSecretKey) { event.sender.send("stream-error", sid, "You need to set AWS Access Key and Secret Key in Settings before Amazon can be used."); return; }
      const client = new BedrockRuntimeClient({
        region: amazonRegion,
        credentials: { accessKeyId: amazonAccessKey, secretAccessKey: amazonSecretKey }
      });
      // Convert messages to Amazon Bedrock format
      const systemPrompt = messages.find(m => m.role === "system");
      const amazonMessages = [];
      for (const m of messages) {
        if (m.role === "system") continue;
        if (m.role === "assistant" && m.tool_calls) {
          const content = [];
          if (m.content) content.push({ text: m.content });
          for (const tc of m.tool_calls) {
            let args = {};
            try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
            content.push({ toolUse: { toolUseId: tc.id, name: tc.function.name, input: args } });
          }
          amazonMessages.push({ role: "assistant", content });
        } else if (m.role === "tool") {
          const toolResultBlock = { toolResult: { toolUseId: m.tool_call_id, content: [{ text: m.content || "" }] } };
          const last = amazonMessages[amazonMessages.length - 1];
          if (last && last.role === "user") {
            last.content.push(toolResultBlock);
          } else {
            amazonMessages.push({ role: "user", content: [toolResultBlock] });
          }
        } else {
          const role = m.role === "assistant" ? "assistant" : "user";
          const content = [];
          if (Array.isArray(m.content)) {
            for (const part of m.content) {
              if (part.type === "image") {
                content.push({ image: { format: (part.mediaType || "image/png").split("/")[1] || "png", source: { bytes: Buffer.from(part.base64, "base64") } } });
              } else {
                content.push({ text: part.text || "" });
              }
            }
          } else {
            content.push({ text: m.content || "" });
          }
          const last = amazonMessages[amazonMessages.length - 1];
          if (last && last.role === role) {
            last.content.push(...content);
          } else {
            amazonMessages.push({ role, content });
          }
        }
      }
      const amazonToolConfig = agentMode ? {
        tools: AGENT_TOOLS.map(t => ({
          toolSpec: { name: t.function.name, description: t.function.description, inputSchema: { json: t.function.parameters } }
        }))
      } : undefined;
      // Only enable thinking for Claude models that support it (Sonnet 3.7+, Opus 4+)
      const supportsBedrockThinking = displayModelActivity && /anthropic\.claude-(sonnet|opus)/i.test(model) && !thinkingDisabled.has(`${vendor}:${model}`);
      const command = new ConverseStreamCommand({
        modelId: model,
        messages: amazonMessages,
        ...(systemPrompt ? { system: [{ text: systemPrompt.content }] } : {}),
        ...(amazonToolConfig ? { toolConfig: amazonToolConfig } : {}),
        inferenceConfig: { maxTokens: 4096 },
        ...(supportsBedrockThinking ? { additionalModelRequestFields: { thinking: { type: "enabled", budget_tokens: 4096 } } } : {})
      });
      const response = await client.send(command, { abortSignal: abortController.signal });
      let fullText = "";
      let inBedrockThinking = false;
      const toolUseBlocks = [];
      let currentToolUse = null;
      for await (const item of response.stream) {
        if (item.contentBlockStart?.start?.toolUse) {
          currentToolUse = { id: item.contentBlockStart.start.toolUse.toolUseId, name: item.contentBlockStart.start.toolUse.name, argsRaw: "" };
        } else if (item.contentBlockDelta) {
          if (item.contentBlockDelta.delta?.toolUse) {
            if (currentToolUse) currentToolUse.argsRaw += item.contentBlockDelta.delta.toolUse.input || "";
          } else if (item.contentBlockDelta.delta?.reasoningContent?.text) {
            if (!inBedrockThinking) {
              inBedrockThinking = true;
              fullText += "<think>";
              event.sender.send("stream-chunk", sid, "<think>");
            }
            const thinkText = item.contentBlockDelta.delta.reasoningContent.text;
            fullText += thinkText;
            event.sender.send("stream-chunk", sid, thinkText);
          } else {
            const text = item.contentBlockDelta.delta?.text || "";
            if (text) {
              if (inBedrockThinking) {
                inBedrockThinking = false;
                fullText += "</think>";
                event.sender.send("stream-chunk", sid, "</think>");
              }
              fullText += text;
              event.sender.send("stream-chunk", sid, text);
            }
          }
        } else if (item.contentBlockStop) {
          if (currentToolUse) {
            toolUseBlocks.push(currentToolUse);
            currentToolUse = null;
          }
        }
      }
      if (inBedrockThinking) {
        fullText += "</think>";
        event.sender.send("stream-chunk", sid, "</think>");
      }
      if (toolUseBlocks.length > 0) {
        event.sender.send("stream-tool-calls", sid, toolUseBlocks.map(tc => {
          let args = {};
          try { args = JSON.parse(tc.argsRaw); } catch { args = {}; }
          return { id: tc.id, name: tc.name, args };
        }));
      } else {
        emitDone(fullText);
      }
    } else if (vendor === "anthropic") {
      const client = new Anthropic({ apiKey });
      const sysMsg = messages.find(m => m.role === "system");
      const userMsgs = messages.filter(m => m.role !== "system").map(m => {
        if (Array.isArray(m.content)) {
          // Convert image+text array to Anthropic format, pass through native blocks
          const content = m.content.map(part => {
            if (part.type === "image") {
              return { type: "image", source: { type: "base64", media_type: part.mediaType, data: part.base64 } };
            }
            if (part.type === "tool_use" || part.type === "tool_result") {
              return part;
            }
            return { type: "text", text: part.text || part.content || "" };
          }).filter(part => !(part.type === "text" && !part.text));
          return { role: m.role, content };
        }
        return m;
      });
      const anthropicThinking = displayModelActivity && !thinkingDisabled.has(`${vendor}:${model}`) ? { thinking: { type: "adaptive", display: "summarized" } } : {};
      const stream = await client.messages.stream({
        model, max_tokens: 128000,
        system: sysMsg?.content,
        messages: userMsgs,
        ...anthropicThinking,
        ...(tools ? { tools } : {})
      }, { signal: abortController.signal });
      let fullText = "";
      let inThinking = false;
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "thinking_delta") {
          if (!inThinking) {
            inThinking = true;
            fullText += "<think>";
            event.sender.send("stream-chunk", sid, "<think>");
          }
          fullText += chunk.delta.thinking;
          event.sender.send("stream-chunk", sid, chunk.delta.thinking);
        }
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          if (inThinking) {
            inThinking = false;
            fullText += "</think>";
            event.sender.send("stream-chunk", sid, "</think>");
          }
          fullText += chunk.delta.text;
          event.sender.send("stream-chunk", sid, chunk.delta.text);
        }
        if (chunk.type === "content_block_start" && chunk.content_block?.type === "tool_use") {
          // tool call coming — collect it
        }
      }
      if (inThinking) {
        fullText += "</think>";
        event.sender.send("stream-chunk", sid, "</think>");
      }
      const finalMsg = await stream.finalMessage();
      const toolUses = finalMsg.content.filter(b => b.type === "tool_use");
      if (toolUses.length > 0) {
        event.sender.send("stream-tool-calls", sid, toolUses.map(t => ({ id: t.id, name: t.name, args: t.input })));
      } else {
        emitDone(fullText);
      }
    } else if (useNonStreaming) {
      // Google with tool results in history — use non-streaming
      // Gemini rejects null content and system role in this path
      // Gemini OpenAI-compat: strip system, fix null content, convert tool->user
      let googleMessages = [];
      let sysTxt = "";
      for (const m of messages) {
        if (m.role === "system") { sysTxt = m.content || ""; continue; }
        if (m.role === "tool") {
          googleMessages.push({ role: "user", content: "Tool result for " + m.name + ": " + m.content });
        } else if (Array.isArray(m.content)) {
          const content = m.content.map(part => {
            if (part.type === "image") {
              return { type: "image_url", image_url: { url: `data:${part.mediaType};base64,${part.base64}` } };
            }
            return { type: "text", text: part.text || "" };
          });
          googleMessages.push({ role: m.role, content });
        } else {
          googleMessages.push({ ...m, content: m.content ?? "" });
        }
      }
      if (sysTxt && googleMessages[0]?.role === "user") {
        googleMessages[0] = { ...googleMessages[0], content: sysTxt + "\n\n" + googleMessages[0].content };
      }
      const client = new OpenAI({ apiKey, baseURL, defaultHeaders });
      const res = await client.chat.completions.create({ model, messages: googleMessages, ...(tools ? { tools, tool_choice: "auto" } : {}) }, { signal: abortController.signal });
      const choice = res.choices[0];
      if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
        event.sender.send("stream-tool-calls", sid, choice.message.tool_calls.map(tc => {
          let args = {};
          try { args = JSON.parse(tc.function.arguments); } catch { args = { raw: tc.function.arguments }; }
          return { id: tc.id, name: tc.function.name, args };
        }));
      } else {
        const text = choice.message.content || "";
        emitDone(text);
      }
    } else {
      const client = new OpenAI({ apiKey, baseURL, defaultHeaders });
      // Transform array content messages to OpenAI image_url format
      const openaiMessages = messages.map(m => {
        if (Array.isArray(m.content)) {
          const content = m.content.map(part => {
            if (part.type === "image") {
              return { type: "image_url", image_url: { url: `data:${part.mediaType};base64,${part.base64}` } };
            }
            return { type: "text", text: part.text || "" };
          });
          return { role: m.role, content };
        }
        return m;
      });
      const reasoningWithTools = tools && (vendor === "openai");
      const stream = await client.chat.completions.create({ model, messages: openaiMessages, stream: true, ...(tools ? { tools, tool_choice: "auto" } : {}), ...(reasoningWithTools ? { reasoning_effort: "none" } : {}) }, { signal: abortController.signal });
      let fullText = "";
      let inReasoning = false;
      const toolCallMap = {};
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        // Handle reasoning/thinking field from Ollama and DeepSeek (separate from content)
        const reasoning = delta?.reasoning_content || delta?.reasoning;
        if (reasoning) {
          if (!inReasoning) {
            inReasoning = true;
            fullText += "<think>";
            event.sender.send("stream-chunk", sid, "<think>");
          }
          fullText += reasoning;
          event.sender.send("stream-chunk", sid, reasoning);
        }
        if (delta?.content) {
          if (inReasoning) {
            inReasoning = false;
            fullText += "</think>";
            event.sender.send("stream-chunk", sid, "</think>");
          }
          fullText += delta.content;
          event.sender.send("stream-chunk", sid, delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!toolCallMap[tc.index]) toolCallMap[tc.index] = { id: "", name: "", argsRaw: "" };
            if (tc.id)            toolCallMap[tc.index].id       += tc.id;
            if (tc.function?.name) toolCallMap[tc.index].name    += tc.function.name;
            if (tc.function?.arguments) toolCallMap[tc.index].argsRaw += tc.function.arguments;
          }
        }
      }
      // Close any unclosed thinking block
      if (inReasoning) {
        fullText += "</think>";
        event.sender.send("stream-chunk", sid, "</think>");
      }
      const toolCalls = Object.values(toolCallMap);
      if (toolCalls.length > 0) {
        event.sender.send("stream-tool-calls", sid, toolCalls.map(tc => {
          let args = {};
          try { args = JSON.parse(tc.argsRaw); } catch { args = { raw: tc.argsRaw }; }
          return { id: tc.id, name: tc.name, args };
        }));
      } else {
        emitDone(fullText);
      }
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      event.sender.send("stream-error", sid, "cancelled");
    } else if (/think/i.test(err.message) && !thinkingDisabled.has(`${vendor}:${model}`)) {
      // Thinking parameter caused an error — disable it for this vendor:model and retry silently
      thinkingDisabled.add(`${vendor}:${model}`);
      delete activeAborts[sid];
      handleChatStream(event, { messages, vendor, model, agentMode, sid });
      return;
    } else {
      event.sender.send("stream-error", sid, err.message);
    }
  } finally {
    delete activeAborts[sid];
  }
}
ipcMain.on("chat-stream", handleChatStream);

ipcMain.handle("copy-to-clipboard", (_e, text) => {
  const { clipboard } = require("electron");
  clipboard.writeText(text);
});

ipcMain.handle("whisper-transcribe", async (_event, { base64, mimeType }) => {
  const { apiKeys } = load();
  const apiKey = apiKeys?.openai || "";
  if (!apiKey) throw new Error("OpenAI API key not set");
  const os = require("os");
  const tmpPath = path.join(os.tmpdir(), `neuropanther-chat-audio-${Date.now()}.webm`);
  fs.writeFileSync(tmpPath, Buffer.from(base64, "base64"));
  try {
    const client = new OpenAI({ apiKey });
    const transcription = await client.audio.transcriptions.create({
      model: "whisper-1",
      file: fs.createReadStream(tmpPath),
      response_format: "text"
    });
    return typeof transcription === "string" ? transcription : transcription.text;
  } finally {
    fs.unlinkSync(tmpPath);
  }
});

ipcMain.handle("chat", async (_event, args) => {
  // Debug logging: dump system prompt + prompt, run the request, then dump response.
  writeDebugPrompts(args.messages);
  const result = await chatCompletion(args);
  writeDebugResponse(result);
  return result;
});

// Non-streaming single-shot completion. Returns the response text as a string.
async function chatCompletion({ messages, vendor: vendorOverride, model: modelOverride }) {
  checkMessageNag();
  const settings = load();
  const vendor = vendorOverride || settings.vendor;
  const model  = modelOverride  || settings.model;
  let apiKey = settings.apiKeys?.[vendor] || "";
  if (vendor === "microsoft") {
    apiKey = settings.apiKeys?.microsoftApiKey || "";
    if (!apiKey || !settings.apiKeys?.microsoftEndpoint) throw new Error("You need to set Azure API Key and Endpoint in Settings before Microsoft can be used.");
  }
  if (!apiKey && vendor !== "ollama" && vendor !== "amazon" && vendor !== "microsoft" && vendor !== "ibm" && !vendor.startsWith("generic")) throw new Error("You need to set the API key in Settings before this LLM vendor can be used.");

  if (isYamlVendor(vendor)) {
    apiKey = settings.apiKeys?.[vendor + "ApiKey"] || "";
    // No key requirement: the YAML config's Headers decide whether auth is sent.
    const lastPrompt = [...messages].reverse().find(m => m.role === "user")?.content || "";
    const plainMessages = messages.map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : (Array.isArray(m.content) ? m.content.map(p => p.text || "").join("") : "") }));
    const configPath = yamlConfigPathForVendor(vendor);
    return await genericVendorConfig.callPrompt(apiKey, model, lastPrompt, plainMessages, configPath);
  }

  if (vendor === "amazon") {
    const amazonAccessKey = settings.apiKeys?.amazonAccessKey || "";
    const amazonSecretKey = settings.apiKeys?.amazonSecretKey || "";
    const amazonRegion    = settings.apiKeys?.amazonRegion || "us-east-1";
    if (!amazonAccessKey || !amazonSecretKey) throw new Error("You need to set AWS Access Key and Secret Key in Settings before Amazon can be used.");
    const client = new BedrockRuntimeClient({
      region: amazonRegion,
      credentials: { accessKeyId: amazonAccessKey, secretAccessKey: amazonSecretKey }
    });
    const systemPrompt = messages.find(m => m.role === "system");
    const amazonMessages = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      if (m.role === "assistant" && m.tool_calls) {
        const content = [];
        if (m.content) content.push({ text: m.content });
        for (const tc of m.tool_calls) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
          content.push({ toolUse: { toolUseId: tc.id, name: tc.function.name, input: args } });
        }
        amazonMessages.push({ role: "assistant", content });
      } else if (m.role === "tool") {
        const toolResultBlock = { toolResult: { toolUseId: m.tool_call_id, content: [{ text: m.content || "" }] } };
        const last = amazonMessages[amazonMessages.length - 1];
        if (last && last.role === "user") {
          last.content.push(toolResultBlock);
        } else {
          amazonMessages.push({ role: "user", content: [toolResultBlock] });
        }
      } else {
        const role = m.role === "assistant" ? "assistant" : "user";
        const last = amazonMessages[amazonMessages.length - 1];
        if (last && last.role === role) {
          last.content.push({ text: m.content || "" });
        } else {
          amazonMessages.push({ role, content: [{ text: m.content || "" }] });
        }
      }
    }
    const command = new ConverseCommand({
      modelId: model,
      messages: amazonMessages,
      ...(systemPrompt ? { system: [{ text: systemPrompt.content }] } : {}),
      inferenceConfig: { maxTokens: 4096 }
    });
    const response = await client.send(command);
    return response.output.message.content[0].text;
  }

  if (vendor === "anthropic") {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model,
      max_tokens: 128000,
      messages
    });
    return res.content[0].text;
  }

  let chatBaseURL;
  if (vendor === "microsoft") {
    chatBaseURL = `${(settings.apiKeys?.microsoftEndpoint || "").replace(/\/+$/, "")}/openai/v1/`;
  } else if (vendor === "ibm") {
    apiKey = settings.apiKeys?.ibmApiKey || "";
    chatBaseURL = `${(settings.apiKeys?.ibmEndpoint || "").replace(/\/+$/, "")}/ml/gateway/v1`;
  } else if (isOpenAIGeneric(vendor)) {
    apiKey = settings.apiKeys?.[vendor + "ApiKey"] || "";
    chatBaseURL = (settings.apiKeys?.[vendor + "Endpoint"] || "").replace(/\/+$/, "");
  } else {
    chatBaseURL = VENDORS[vendor]?.baseURL;
  }
  let chatHeaders;
  if (vendor === "microsoft") chatHeaders = { "api-key": apiKey };
  else if (vendor === "ibm" && settings.apiKeys?.ibmProjectId) chatHeaders = { "X-IBM-Project-Id": settings.apiKeys.ibmProjectId };
  const client = new OpenAI({ apiKey: apiKey || "none", baseURL: chatBaseURL, defaultHeaders: chatHeaders });
  const res = await client.chat.completions.create({ model, messages });
  return res.choices[0].message.content;
}

ipcMain.handle("save-temp-image", (_event, { base64, mediaType }) => {
  const os = require("os");
  const ext = mediaType.split("/")[1] || "png";
  const tempPath = path.join(os.tmpdir(), `neuropanther-chat-img-${Date.now()}.${ext}`);
  fs.writeFileSync(tempPath, Buffer.from(base64, "base64"));
  return tempPath;
});

ipcMain.handle("chat-with-image", async (_event, { tempPath, mediaType, text, vendor: vendorOverride, model: modelOverride }) => {
  checkMessageNag();
  const settings = load();
  const vendor = vendorOverride || settings.vendor;
  const model  = modelOverride  || settings.model;
  const apiKey = settings.apiKeys?.[vendor] || "";
  
  if (vendor !== "ollama" && !apiKey) {
    throw new Error("You need to set the API key in Settings before this LLM vendor can be used.");
  }

  const base64 = fs.readFileSync(tempPath).toString("base64");
  fs.unlinkSync(tempPath);

  if (vendor === "ollama") {
    const client = new OpenAI({ apiKey: "ollama", baseURL: "http://localhost:11434/v1" });
    try {
      const res = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: [
          { type: "text", text: text || "What is in this image?" },
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } }
        ]}]
      });
      return res.choices[0].message.content;
    } catch (err) {
      if (err.message?.includes("does not support images")) {
        throw new Error(`The model "${model}" does not support image analysis. Try a vision-capable model like llava or llama3.2-vision.`);
      }
      throw err;
    }
  }

  if (vendor === "anthropic") {
    const client = new Anthropic({ apiKey });
    const stream = await client.messages.stream({
      model,
      max_tokens: 128000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: text || "What is in this image?" }
        ]
      }]
    });
    let fullText = "";
    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        fullText += chunk.delta.text;
      }
    }
    return fullText;
  }

  // Vendors that don't support image/vision analysis
  const noVisionVendors = new Set(["deepseek", "perplexity", "mistral", "cerebras"]);
  if (noVisionVendors.has(vendor)) {
    throw new Error(`${VENDORS[vendor]?.label || vendor} does not support image analysis. Try OpenAI, Anthropic, Google, or another vision-capable vendor.`);
  }

  const client = new OpenAI({ apiKey, baseURL: VENDORS[vendor]?.baseURL });
  const res = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: [
      { type: "text", text: text || "What is in this image?" },
      { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } }
    ]}]
  });
  return res.choices[0].message.content;
});

ipcMain.handle("generate-image", async (_event, { promptText, vendor, sourceImageBase64, imageModel }) => {
  const { apiKeys } = load();
  if (!apiKeys?.[vendor]) throw new Error("You need to set the API key in Settings before this LLM vendor can be used.");
  const vendorCfg = VENDORS[vendor];
  const model = imageModel || vendorCfg.imageModel;

  // Debug logging: dump the image-generation prompt and any source image sent (if enabled).
  writeDebugImagePrompt({ promptText, vendor, model, sourceImageBase64 });

  if (vendor === "google") {
    // Google Imagen is text-to-image only — image editing not supported
    const { GoogleGenAI } = require("@google/genai");
    const ai = new GoogleGenAI({ apiKey: apiKeys.google });
    const res = await ai.models.generateImages({
      model,
      prompt: promptText,
      config: { numberOfImages: 1, outputMimeType: "image/png" }
    });
    const b64 = res.generatedImages[0].image.imageBytes;
    return `data:image/png;base64,${b64}`;
  }

  if (vendor === "stability") {
    const form = new FormData();
    form.append("prompt", promptText);
    form.append("model", model);
    form.append("output_format", "png");
    const res = await fetch("https://api.stability.ai/v2beta/stable-image/generate/sd3", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKeys.stability}`, "Accept": "image/*" },
      body: form
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || `Stability AI error ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:image/png;base64,${buf.toString("base64")}`;
  }

  if (vendor === "leonardo") {
    const apiKey = apiKeys.leonardo;
    const baseUrl = "https://cloud.leonardo.ai/api/rest/v1";
    const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "Accept": "application/json" };
    const genRes = await fetch(`${baseUrl}/generations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: promptText, modelId: model, num_images: 1, width: 1024, height: 1024, contrast: 3.5 })
    });
    if (!genRes.ok) {
      const err = await genRes.json().catch(() => ({ message: genRes.statusText }));
      throw new Error(err.message || `Leonardo error ${genRes.status}`);
    }
    const genData = await genRes.json();
    const generationId = genData.sdGenerationJob?.generationId;
    if (!generationId) throw new Error("Leonardo did not return a generation ID");
    // Poll for completion
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(`${baseUrl}/generations/${generationId}`, { headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" } });
      if (!pollRes.ok) continue;
      const pollData = await pollRes.json();
      const gen = pollData.generations_by_pk;
      if (gen?.status === "COMPLETE" && gen.generated_images?.length) {
        const imgRes = await fetch(gen.generated_images[0].url);
        return `data:image/png;base64,${Buffer.from(await imgRes.arrayBuffer()).toString("base64")}`;
      }
      if (gen?.status === "FAILED") throw new Error("Leonardo image generation failed");
    }
    throw new Error("Leonardo image generation timed out");
  }

  if (vendor === "ideogram") {
    const form = new FormData();
    form.append("prompt", promptText);
    form.append("rendering_speed", "DEFAULT");
    const res = await fetch(`https://api.ideogram.ai/v1/${model}/generate`, {
      method: "POST",
      headers: { "Api-Key": apiKeys.ideogram },
      body: form
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || `Ideogram error ${res.status}`);
    }
    const data = await res.json();
    const imageUrl = data.data?.[0]?.url;
    if (!imageUrl) throw new Error("Ideogram did not return an image URL");
    const imgRes = await fetch(imageUrl);
    return `data:image/png;base64,${Buffer.from(await imgRes.arrayBuffer()).toString("base64")}`;
  }

  if (vendor === "flux") {
    // Black Forest Labs FLUX async API — submit then poll
    const apiKey = apiKeys.flux;
    const submitRes = await fetch(`https://api.bfl.ai/v1/${model}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-key": apiKey },
      body: JSON.stringify({ prompt: promptText, width: 1024, height: 1024 })
    });
    if (!submitRes.ok) {
      const err = await submitRes.json().catch(() => ({ message: submitRes.statusText }));
      throw new Error(err.message || `Flux error ${submitRes.status}`);
    }
    const submitData = await submitRes.json();
    const pollingUrl = submitData.polling_url || `https://api.bfl.ai/v1/get_result?id=${submitData.id}`;
    // Poll for result
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const pollRes = await fetch(pollingUrl, {
        headers: { "x-key": apiKey }
      });
      if (!pollRes.ok) continue;
      const pollData = await pollRes.json();
      if (pollData.status === "Ready") {
        const imgUrl = pollData.result?.sample;
        if (!imgUrl) throw new Error("Flux did not return an image URL");
        const imgRes = await fetch(imgUrl);
        return `data:image/png;base64,${Buffer.from(await imgRes.arrayBuffer()).toString("base64")}`;
      }
      if (pollData.status === "Error" || pollData.status === "Failed" || pollData.status === "Request Moderated" || pollData.status === "Content Moderated") {
        throw new Error(`Flux generation failed: ${pollData.status}`);
      }
    }
    throw new Error("Flux image generation timed out");
  }

  if (vendor === "xai") {
    // xAI Grok Imagine uses JSON body for both generation and editing
    const apiKey = apiKeys.xai;
    if (sourceImageBase64) {
      // Image editing endpoint
      const res = await fetch("https://api.x.ai/v1/images/edits", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({ model, prompt: promptText, image: { url: `data:image/png;base64,${sourceImageBase64}`, type: "image_url" } })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.error?.message || err.message || `xAI error ${res.status}`);
      }
      const data = await res.json();
      const imgUrl = data.data?.[0]?.url;
      if (!imgUrl) throw new Error("xAI did not return an image URL");
      const imgRes = await fetch(imgUrl);
      return `data:image/png;base64,${Buffer.from(await imgRes.arrayBuffer()).toString("base64")}`;
    }
    // New image generation
    const res = await fetch("https://api.x.ai/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model, prompt: promptText, n: 1 })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.error?.message || err.message || `xAI error ${res.status}`);
    }
    const data = await res.json();
    const imgUrl = data.data?.[0]?.url || data.data?.[0]?.b64_json;
    if (!imgUrl) throw new Error("xAI did not return an image");
    if (imgUrl.startsWith("data:") || !imgUrl.startsWith("http")) {
      return `data:image/png;base64,${imgUrl}`;
    }
    const imgRes = await fetch(imgUrl);
    return `data:image/png;base64,${Buffer.from(await imgRes.arrayBuffer()).toString("base64")}`;
  }

  if (vendor === "alibaba") {
    // Alibaba Qwen Image uses DashScope native API (not OpenAI-compatible for image gen)
    const apiKey = apiKeys.alibaba;
    const baseURL = vendorCfg?.baseURL || "";
    // Derive the image generation endpoint from the configured text chat baseURL region
    let host = "dashscope-intl.aliyuncs.com";
    if (baseURL.includes("dashscope-us")) host = "dashscope-us.aliyuncs.com";
    else if (baseURL.includes("dashscope-intl")) host = "dashscope-intl.aliyuncs.com";
    const imageEndpoint = `https://${host}/api/v1/services/aigc/multimodal-generation/generation`;
    const res = await fetch(imageEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        input: { messages: [{ role: "user", content: [{ text: promptText }] }] },
        parameters: { size: "1024*1024", n: 1 }
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || `Alibaba error ${res.status}`);
    }
    const data = await res.json();
    const imageUrl = data.output?.choices?.[0]?.message?.content?.[0]?.image;
    if (!imageUrl) throw new Error("Alibaba Qwen Image did not return an image URL");
    const imgRes = await fetch(imageUrl);
    return `data:image/png;base64,${Buffer.from(await imgRes.arrayBuffer()).toString("base64")}`;
  }

  if (vendor === "recraft") {
    // Recraft uses OpenAI-compatible API at external.api.recraft.ai/v1
    const client = new OpenAI({ apiKey: apiKeys.recraft, baseURL: "https://external.api.recraft.ai/v1" });
    const res = await client.images.generate({ model, prompt: promptText, n: 1 });
    const imageUrl = res.data[0]?.url;
    if (!imageUrl) throw new Error("Recraft did not return an image URL");
    const imgRes = await fetch(imageUrl);
    return `data:image/png;base64,${Buffer.from(await imgRes.arrayBuffer()).toString("base64")}`;
  }

  if (vendor === "fal") {
    // fal.ai REST API — POST to https://fal.run/{model-id}
    const apiKey = apiKeys.fal;
    const res = await fetch(`https://fal.run/${model}`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prompt: promptText })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.detail || err.message || `fal.ai error ${res.status}`);
    }
    const data = await res.json();
    // fal.ai returns images in data.images[0].url or data.output.images[0].url
    const imageUrl = data.images?.[0]?.url || data.output?.images?.[0]?.url;
    if (!imageUrl) throw new Error("fal.ai did not return an image URL");
    const imgRes = await fetch(imageUrl);
    return `data:image/png;base64,${Buffer.from(await imgRes.arrayBuffer()).toString("base64")}`;
  }

  const client = new OpenAI({ apiKey: apiKeys[vendor], baseURL: vendorCfg?.baseURL });

  // If a source image is provided, use the edit endpoint
  if (sourceImageBase64) {
    const os = require("os");
    const tmpPath = path.join(os.tmpdir(), `neuropanther-chat-edit-${Date.now()}.png`);
    fs.writeFileSync(tmpPath, Buffer.from(sourceImageBase64, "base64"));
    try {
      const { toFile } = require("openai");
      const res = await client.images.edit({
        model,
        image: await toFile(fs.createReadStream(tmpPath), "image.png", { type: "image/png" }),
        prompt: promptText,
        n: 1,
        size: vendorCfg.imageSize
      });
      const b64 = res.data[0].b64_json;
      if (b64) return `data:image/png;base64,${b64}`;
      const imgRes = await fetch(res.data[0].url);
      return `data:image/png;base64,${Buffer.from(await imgRes.arrayBuffer()).toString("base64")}`;
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  // Generate new image
  const res = await client.images.generate({ model, prompt: promptText, n: 1, size: vendorCfg.imageSize });
  const b64 = res.data[0].b64_json;
  if (b64) return `data:image/png;base64,${b64}`;
  const imageUrl = res.data[0].url;
  const response = await fetch(imageUrl);
  const arrayBuffer = await response.arrayBuffer();
  return `data:image/png;base64,${Buffer.from(arrayBuffer).toString("base64")}`;
});

ipcMain.handle("download-image", async (_event, { url, promptText }) => {
  const { filePath } = await dialog.showSaveDialog(mainWin, {
    title: "Save Image",
    defaultPath: path.join(require("os").homedir(), "Downloads", `${promptText.slice(0, 40).replace(/[^a-z0-9]/gi, "_")}.png`),
    filters: [{ name: "Images", extensions: ["png"] }]
  });
  if (!filePath) return;
  if (url.startsWith("data:")) {
    const base64 = url.split(",")[1];
    fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
  } else {
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(filePath);
      https.get(url, res => res.pipe(file).on("finish", resolve).on("error", reject));
    });
  }
});

ipcMain.handle("save-mermaid-svg", async (_event, svgContent) => {
  const win = BrowserWindow.getFocusedWindow() || mainWin;
  const { filePath } = await dialog.showSaveDialog(win, {
    title: "Save Mermaid Diagram",
    defaultPath: path.join(require("os").homedir(), "Downloads", "diagram.svg"),
    filters: [{ name: "SVG Image", extensions: ["svg"] }]
  });
  if (!filePath) return { filePath: null };
  fs.writeFileSync(filePath, svgContent, "utf-8");
  return { filePath };
});

ipcMain.handle("save-code-block", async (_event, { code, lang }) => {
  const extMap = {
    javascript: "js", typescript: "ts", python: "py", ruby: "rb",
    java: "java", c: "c", cpp: "cpp", csharp: "cs", go: "go",
    rust: "rs", swift: "swift", kotlin: "kt", php: "php",
    html: "html", css: "css", json: "json", yaml: "yml",
    xml: "xml", sql: "sql", bash: "sh", shell: "sh",
    markdown: "md", plaintext: "txt"
  };
  const ext = extMap[lang] || lang || "txt";
  const win = BrowserWindow.getFocusedWindow() || mainWin;
  const { filePath } = await dialog.showSaveDialog(win, {
    title: "Save Code",
    defaultPath: path.join(require("os").homedir(), "Downloads", `code.${ext}`),
    filters: [
      { name: `${lang || "Text"} file`, extensions: [ext] },
      { name: "All Files", extensions: ["*"] }
    ]
  });
  if (!filePath) return { filePath: null };
  fs.writeFileSync(filePath, code, "utf-8");
  return { filePath };
});

ipcMain.handle("image-context-menu", async (_event, src) => {
  const { Menu: CtxMenu, clipboard, nativeImage: ni } = require("electron");
  const menu = CtxMenu.buildFromTemplate([
    {
      label: "Copy Image",
      click: async () => {
        if (src.startsWith("http")) {
          // fetch URL into buffer then copy
          const { net } = require("electron");
          const res = await net.fetch(src);
          const buf = Buffer.from(await res.arrayBuffer());
          clipboard.writeImage(ni.createFromBuffer(buf));
        } else {
          // data URL
          const base64 = src.split(",")[1];
          clipboard.writeImage(ni.createFromBuffer(Buffer.from(base64, "base64")));
        }
      }
    },
    {
      label: "Save Image As…",
      click: async () => {
        const { filePath } = await dialog.showSaveDialog(mainWin, {
          title: "Save Image",
          defaultPath: path.join(require("os").homedir(), "Downloads", "image.png"),
          filters: [{ name: "Images", extensions: ["png", "jpg"] }]
        });
        if (!filePath) return;
        if (src.startsWith("http")) {
          await new Promise((resolve, reject) => {
            const file = fs.createWriteStream(filePath);
            https.get(src, res => res.pipe(file).on("finish", resolve).on("error", reject));
          });
        } else {
          const base64 = src.split(",")[1];
          fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
        }
      }
    },
    {
      label: "Zoom",
      click: () => {
        const win = BrowserWindow.getFocusedWindow() || mainWin;
        win.webContents.send("zoom-image", src);
      }
    }
  ]);
  menu.popup({ window: BrowserWindow.getFocusedWindow() || mainWin });
});

// ── Tab drag-and-drop between windows ─────────────────────────────────────────
let draggedTabState = null;  // { sourceWinId, tabId, state }

// Renderer reports its window name (active tab title) and tab count so the
// Window menu can list all open chat windows.
ipcMain.on("report-window-info", (event, { name, tabCount }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  windowInfo.set(win.id, { name: name || "NeuroPanther Chat", tabCount: tabCount || 0 });
  buildMenu();
});

ipcMain.on("tab-drag-start", (event, { tabId, state, tabCount }) => {
  draggedTabState = { sourceWinId: event.sender.id, tabId, state, tabCount };
});

ipcMain.on("tab-drag-end", (event, { tabId }) => {
  // If drop never happened on another window, clear
  if (draggedTabState?.sourceWinId === event.sender.id) {
    draggedTabState = null;
  }
});

ipcMain.on("tab-drop-here", (event) => {
  if (!draggedTabState) return;
  const targetWinId = event.sender.id;
  if (targetWinId === draggedTabState.sourceWinId) {
    draggedTabState = null;
    return;
  }
  // Send state to target window
  event.sender.send("receive-tab", draggedTabState.state);
  // Tell source window to remove the tab, or close it if it was the only tab
  const sourceWin = BrowserWindow.fromId(draggedTabState.sourceWinId);
  if (draggedTabState.tabCount === 1) {
    sourceWin?.destroy();
  } else {
    sourceWin?.webContents.send("remove-tab-after-drag", draggedTabState.tabId);
  }
  draggedTabState = null;
});

// ── Confirm dialogs ────────────────────────────────────────────────────────────
ipcMain.handle("confirm-close-tab", async (event, { title }) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWin;
  return dialog.showMessageBox(win, {
    type: "warning",
    buttons: ["Save", "Close Without Saving", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    message: `"${title}" has unsaved changes.`,
    detail: "Do you want to save before closing this tab?"
  });
});

ipcMain.handle("confirm-close-window", async (event, { names }) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWin;
  return dialog.showMessageBox(win, {
    type: "warning",
    buttons: ["Save All", "Close Without Saving", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    message: "You have unsaved chats.",
    detail: `${names} ${names.includes(",") ? "have" : "has"} unsaved changes. Save before closing?`
  });
});

// ── Window close: ask renderer to check for unsaved tabs ──────────────────────
const windowsAwaitingClose = new Set();
let isQuitting = false;

app.on("before-quit", () => { isQuitting = true; });

ipcMain.on("close-confirmed", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    windowsAwaitingClose.add(win.id);
    win.close();
  }
});

function showSplash(nagOnly) {
  const splash = new BrowserWindow({
    width: 320,
    height: 340,
    resizable: false,
    minimizable: false,
    maximizable: false,
    frame: false,
    icon: appIcon,
    parent: nagOnly ? mainWin : undefined,
    modal: !!nagOnly,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  splash.loadFile("splash.html");
  splash.webContents.once("did-finish-load", () => {
    splash.webContents.send("icon-path", path.join(__dirname, "resources", "app_icon.png"));
    splash.webContents.send("app-version", require("./package.json").version);
  });

  const handler = () => {
    if (!splash.isDestroyed()) splash.close();
    if (!nagOnly) createWindow();
  };
  ipcMain.once("splash-close", handler);
  splash.on("closed", () => ipcMain.removeListener("splash-close", handler));
}

// Disable Chromium's code block actions menu
app.commandLine.appendSwitch('disable-features', 'ContextMenuEnableCodeActions');

// Enable speech-dispatcher integration on Linux for TTS
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-speech-dispatcher");
}

app.whenReady().then(() => {
  // Copy config examples to Desktop on first launch
  const desktopConfigDir = path.join(require("os").homedir(), "Desktop", "AI Config Examples");
  if (!fs.existsSync(desktopConfigDir)) {
    const sourceConfigDir = path.join(__dirname, "config");
    if (fs.existsSync(sourceConfigDir)) {
      try {
        fs.mkdirSync(desktopConfigDir, { recursive: true });
        for (const file of fs.readdirSync(sourceConfigDir)) {
          fs.copyFileSync(path.join(sourceConfigDir, file), path.join(desktopConfigDir, file));
        }
      } catch {
        // Silently fail — non-critical
      }
    }
  }

  // Intercept every window's close to check for unsaved tabs
  app.on("browser-window-created", (_e, win) => {
    win.on("close", (e) => {
      if (isQuitting) return;
      if (["settings", "about", "splash", "license", "generic-config-editor"].some(p => win.webContents.getURL().includes(p))) return;
      if (windowsAwaitingClose.has(win.id)) {
        windowsAwaitingClose.delete(win.id);
        return; // confirmed — allow close
      }
      e.preventDefault();
      win.webContents.send("check-unsaved-before-close");
    });
  });
  const { licenseKey, userName } = load();
  if (isValidLicense(licenseKey, userName)) {
    createWindow();
  } else {
    showSplash();
  }
});
