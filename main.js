const { app, BrowserWindow, ipcMain, Menu, nativeImage, dialog, shell } = require("electron");
const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { spawn } = require("child_process");
const nodeCrypto = require("crypto");
const { load, save, VENDORS } = require("./settings");
const LICENSE_SALT = "NeuroPanther-Chat-2026";

function openExternal(url) {
  if (process.platform === "linux") {
    const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    child.unref();
  } else {
    shell.openExternal(url);
  }
}

function expectedLicenseKey(userName) {
  const hmac = nodeCrypto.createHmac("sha256", LICENSE_SALT);
  hmac.update(userName.toLowerCase().trim());
  return hmac.digest("hex").slice(0, 16).toUpperCase();
}

function isValidLicense(key, userName) {
  if (!key || !userName) return false;
  return key.toUpperCase() === expectedLicenseKey(userName);
}

const appIcon = nativeImage.createFromPath(path.join(__dirname, "app_icon.icns"));

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
  return win;
}

let aboutWin;
function showAbout() {
  if (aboutWin) return aboutWin.focus();
  aboutWin = new BrowserWindow({
    width: 320,
    height: 420,
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: mainWin,
    modal: true,
    icon: appIcon,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  aboutWin.setMenuBarVisibility(false);
  aboutWin.loadFile("about.html");
  aboutWin.webContents.once("did-finish-load", () => {
    aboutWin.webContents.send("icon-path", path.join(__dirname, "app_icon.png"));
    aboutWin.webContents.send("app-version", require("./package.json").version);
    const { licenseKey, userName } = load();
    if (isValidLicense(licenseKey, userName)) aboutWin.webContents.send("licensed");
  });
  ipcMain.handleOnce("close-about", () => aboutWin?.close());
  aboutWin.on("closed", () => { aboutWin = null; });
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
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let licenseWin;

function openLicense() {
  if (licenseWin) return licenseWin.focus();
  licenseWin = new BrowserWindow({
    width: 360,
    height: 260,
    resizable: false,
    parent: mainWin,
    modal: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  licenseWin.setMenuBarVisibility(false);
  licenseWin.loadFile("license.html");
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
    height: 480,
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
.assistant code{font-family:'JetBrains Mono NL',monospace;font-size:13px;background:#e8e8e8;padding:1px 4px;border-radius:3px;}
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
    md += `${role}\n\n`;
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
  const client = new OpenAI({ apiKey, baseURL: VENDORS[vendor]?.baseURL });
  const res = await client.models.list();
  return res.data.map(m => m.id.replace(/^models\//, "")).sort();
}

ipcMain.handle("fetch-models", async (_event, { vendor, apiKey }) => {
  try {
    return await fetchModels(vendor, apiKey);
  } catch {
    return null;
  }
});

ipcMain.handle("get-models-for-vendor", async (_event, vendor) => {
  const { apiKeys } = load();
  const apiKey = apiKeys?.[vendor] || "";
  if (!apiKey && vendor !== "ollama") return null;
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

ipcMain.handle("settings-get-data", () => ({ settings: load(), VENDORS }));

ipcMain.handle("get-vendors-and-settings", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const pending = win ? pendingLoadData.get(win.id) : null;
  if (pending) pendingLoadData.delete(win.id);
  const openFile = pendingOpenFile;
  pendingOpenFile = null;
  return { vendors: VENDORS, settings: load(), pendingLoad: pending || openFile || null };
});

ipcMain.handle("get-config", () => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")); } catch { return {}; }
});


ipcMain.handle("settings-save", (_e, newSettings) => {
  const existing = load();
  save({ ...existing, ...newSettings });
  settingsWin?.close();
  mainWin?.webContents.send("settings-updated");
});

ipcMain.handle("settings-cancel", () => settingsWin?.close());

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
      return await new Promise(resolve => {
        const proc = spawn(args.command, { shell: true, cwd: workDir });
        let stdout = "", stderr = "";
        proc.stdout.on("data", d => { stdout += d; });
        proc.stderr.on("data", d => { stderr += d; });
        proc.on("close", code => resolve({ ok: true, result: (stdout + stderr).slice(0, 4000) + (code !== 0 ? `\n[exit ${code}]` : "") }));
        setTimeout(() => { proc.kill(); resolve({ ok: true, result: "[timeout after 30s]" }); }, 30000);
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

ipcMain.on("chat-stream", async (event, { messages, vendor, model, agentMode, sid }) => {
  checkMessageNag();
  const settings = load();
  const apiKey = settings.apiKeys?.[vendor] || "";
  if (!apiKey && vendor !== "ollama") { event.sender.send("stream-error", sid, "You need to set the API key in Settings before this LLM vendor can be used."); return; }

  const tools = agentMode ? (vendor === "anthropic" ? ANTHROPIC_TOOLS : AGENT_TOOLS) : undefined;

  // Gemini (google) doesn't support streaming when tool results are in history
  const hasToolResults = messages.some(m => m.role === "tool");
  const useNonStreaming = vendor === "google" && hasToolResults;

  try {
    if (vendor === "anthropic") {
      const client = new Anthropic({ apiKey });
      const sysMsg = messages.find(m => m.role === "system");
      const userMsgs = messages.filter(m => m.role !== "system");
      const stream = await client.messages.stream({
        model, max_tokens: 8096,
        system: sysMsg?.content,
        messages: userMsgs,
        ...(tools ? { tools } : {})
      });
      let fullText = "";
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          fullText += chunk.delta.text;
          event.sender.send("stream-chunk", sid, chunk.delta.text);
        }
        if (chunk.type === "content_block_start" && chunk.content_block?.type === "tool_use") {
          // tool call coming — collect it
        }
      }
      const finalMsg = await stream.finalMessage();
      const toolUses = finalMsg.content.filter(b => b.type === "tool_use");
      if (toolUses.length > 0) {
        event.sender.send("stream-tool-calls", sid, toolUses.map(t => ({ id: t.id, name: t.name, args: t.input })));
      } else {
        event.sender.send("stream-done", sid, fullText);
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
        } else {
          googleMessages.push({ ...m, content: m.content ?? "" });
        }
      }
      if (sysTxt && googleMessages[0]?.role === "user") {
        googleMessages[0] = { ...googleMessages[0], content: sysTxt + "\n\n" + googleMessages[0].content };
      }
      const client = new OpenAI({ apiKey, baseURL: VENDORS[vendor]?.baseURL });
      const res = await client.chat.completions.create({ model, messages: googleMessages, ...(tools ? { tools, tool_choice: "auto" } : {}) });
      const choice = res.choices[0];
      if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
        event.sender.send("stream-tool-calls", sid, choice.message.tool_calls.map(tc => {
          let args = {};
          try { args = JSON.parse(tc.function.arguments); } catch { args = { raw: tc.function.arguments }; }
          return { id: tc.id, name: tc.function.name, args };
        }));
      } else {
        const text = choice.message.content || "";
        event.sender.send("stream-done", sid, text);
      }
    } else {
      const client = new OpenAI({ apiKey, baseURL: VENDORS[vendor]?.baseURL });
      const stream = await client.chat.completions.create({ model, messages, stream: true, ...(tools ? { tools, tool_choice: "auto" } : {}) });
      let fullText = "";
      const toolCallMap = {};
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
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
      const toolCalls = Object.values(toolCallMap);
      if (toolCalls.length > 0) {
        event.sender.send("stream-tool-calls", sid, toolCalls.map(tc => {
          let args = {};
          try { args = JSON.parse(tc.argsRaw); } catch { args = { raw: tc.argsRaw }; }
          return { id: tc.id, name: tc.name, args };
        }));
      } else {
        event.sender.send("stream-done", sid, fullText);
      }
    }
  } catch (err) {
    event.sender.send("stream-error", sid, err.message);
  }
});

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

ipcMain.handle("chat", async (_event, { messages, vendor: vendorOverride, model: modelOverride }) => {
  checkMessageNag();
  const settings = load();
  const vendor = vendorOverride || settings.vendor;
  const model  = modelOverride  || settings.model;
  const apiKey = settings.apiKeys?.[vendor] || "";
  if (!apiKey && vendor !== "ollama") throw new Error("You need to set the API key in Settings before this LLM vendor can be used.");

  if (vendor === "anthropic") {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model,
      max_tokens: 4096,
      messages
    });
    return res.content[0].text;
  }

  const client = new OpenAI({ apiKey, baseURL: VENDORS[vendor]?.baseURL });
  const res = await client.chat.completions.create({ model, messages });
  return res.choices[0].message.content;
});

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
    const res = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: text || "What is in this image?" }
        ]
      }]
    });
    return res.content[0].text;
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

ipcMain.handle("generate-image", async (_event, { promptText, vendor, sourceImageBase64 }) => {
  const { apiKeys } = load();
  if (!apiKeys?.[vendor]) throw new Error("You need to set the API key in Settings before this LLM vendor can be used.");
  const vendorCfg = VENDORS[vendor];

  if (vendor === "google") {
    // Google Imagen is text-to-image only — image editing not supported
    const { GoogleGenAI } = require("@google/genai");
    const ai = new GoogleGenAI({ apiKey: apiKeys.google });
    const res = await ai.models.generateImages({
      model: vendorCfg.imageModel,
      prompt: promptText,
      config: { numberOfImages: 1, outputMimeType: "image/png" }
    });
    const b64 = res.generatedImages[0].image.imageBytes;
    return `data:image/png;base64,${b64}`;
  }

  if (vendor === "stability") {
    const form = new FormData();
    form.append("prompt", promptText);
    form.append("model", vendorCfg.imageModel);
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
      body: JSON.stringify({ prompt: promptText, modelId: vendorCfg.imageModel, num_images: 1, width: 1024, height: 1024, contrast: 3.5 })
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
    const res = await fetch("https://api.ideogram.ai/v1/ideogram-v3/generate", {
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

  const client = new OpenAI({ apiKey: apiKeys[vendor] });

  // If a source image is provided, use the edit endpoint
  if (sourceImageBase64) {
    const os = require("os");
    const tmpPath = path.join(os.tmpdir(), `neuropanther-chat-edit-${Date.now()}.png`);
    fs.writeFileSync(tmpPath, Buffer.from(sourceImageBase64, "base64"));
    try {
      const { toFile } = require("openai");
      const res = await client.images.edit({
        model: "gpt-image-1",
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
  const res = await client.images.generate({ model: vendorCfg.imageModel, prompt: promptText, n: 1, size: vendorCfg.imageSize });
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
    splash.webContents.send("icon-path", path.join(__dirname, "app_icon.png"));
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

app.whenReady().then(() => {
  // Intercept every window's close to check for unsaved tabs
  app.on("browser-window-created", (_e, win) => {
    win.on("close", (e) => {
      if (isQuitting) return;
      if (["settings", "about", "splash", "license"].some(p => win.webContents.getURL().includes(p))) return;
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
