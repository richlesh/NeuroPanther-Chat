const { app, BrowserWindow, ipcMain, Menu, nativeImage, dialog, shell } = require("electron");
const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { spawn } = require("child_process");
const nodeCrypto = require("crypto");
const { load, save, VENDORS } = require("./settings");
const LICENSE_SALT = "GlowingCat-OmniLLM-2026";

function openExternal(url) {
  if (process.platform === "linux") {
    const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    child.unref();
    // After a short delay, try to raise the browser window via wmctrl if available
    setTimeout(() => {
      const wm = spawn("wmctrl", ["-a", "firefox"], { detached: true, stdio: "ignore" });
      wm.unref();
    }, 500);
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

app.name = "OmniLLM";

app.setAboutPanelOptions({
  applicationName: "OmniLLM",
  applicationVersion: require("./package.json").version,
  credits: `by Richard Lesh\nBuilt with Electron v${process.versions.electron}`,
  website: "https://glowingcatsoftware.com/OmniLLM.html",
  iconImage: appIcon
});

let mainWin, settingsWin;
const pendingLoadData = new Map();

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    icon: appIcon,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.loadFile("index.html");
  if (!mainWin) {
    mainWin = win;
    buildMenu();
  }
  return win;
}

function showAbout() {
  const aboutWin = new BrowserWindow({
    width: 320,
    height: 340,
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
  });
  ipcMain.handleOnce("close-about", () => aboutWin.close());
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { label: "About OmniLLM", click: showAbout },
        { type: "separator" },
        { label: "Settings…", click: openSettings },
        { label: "License Key…", click: openLicense },
        { type: "separator" },
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
              filters: [{ name: "Chat Files", extensions: ["json"] }],
              properties: ["openFile"]
            });
            if (!filePaths?.length) return;
            const raw = JSON.parse(fs.readFileSync(filePaths[0], "utf8"));
            const fileName = path.basename(filePaths[0], ".json");
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
    { role: "windowMenu" }
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
    width: 420,
    height: 350,
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
    defaultPath: path.join(require("os").homedir(), "Documents", `${safeName}.json`),
    filters: [{ name: "Chat Files", extensions: ["json"] }]
  });
  if (!filePath) return false;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  return true;
});

async function fetchModels(vendor, apiKey) {
  if (vendor === "anthropic") {
    const client = new Anthropic({ apiKey });
    const res = await client.models.list();
    return res.data.map(m => m.id).sort();
  }
  const client = new OpenAI({ apiKey, baseURL: VENDORS[vendor]?.baseURL });
  const res = await client.models.list();
  return res.data.map(m => m.id).sort();
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
  if (!apiKey) return null;
  try {
    return await fetchModels(vendor, apiKey);
  } catch (e) {
    console.error(`get-models-for-vendor [${vendor}]:`, e.message);
    return VENDORS[vendor]?.models || null;
  }
});

ipcMain.handle("settings-get-data", () => ({ settings: load(), VENDORS }));

ipcMain.handle("get-vendors-and-settings", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const pending = win ? pendingLoadData.get(win.id) : null;
  if (pending) pendingLoadData.delete(win.id);
  return { vendors: VENDORS, settings: load(), pendingLoad: pending || null };
});


ipcMain.handle("settings-save", (_e, newSettings) => {
  const existing = load();
  save({ ...existing, ...newSettings });
  settingsWin?.close();
});

ipcMain.handle("settings-cancel", () => settingsWin?.close());

ipcMain.handle("open-external", (_e, url) => openExternal(url));

ipcMain.handle("chat", async (_event, { messages, vendor: vendorOverride, model: modelOverride }) => {
  const settings = load();
  const vendor = vendorOverride || settings.vendor;
  const model  = modelOverride  || settings.model;
  const apiKey = settings.apiKeys?.[vendor] || "";
  if (!apiKey) throw new Error("You need to set the API key in Settings before this LLM vendor can be used.");

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
  const tempPath = path.join(os.tmpdir(), `omnillm-img-${Date.now()}.${ext}`);
  fs.writeFileSync(tempPath, Buffer.from(base64, "base64"));
  return tempPath;
});

ipcMain.handle("chat-with-image", async (_event, { tempPath, mediaType, text, vendor: vendorOverride, model: modelOverride }) => {
  const settings = load();
  const vendor = vendorOverride || settings.vendor;
  const model  = modelOverride  || settings.model;
  const apiKey = settings.apiKeys?.[vendor] || "";
  if (!apiKey) throw new Error("You need to set the API key in Settings before this LLM vendor can be used.");

  const base64 = fs.readFileSync(tempPath).toString("base64");
  fs.unlinkSync(tempPath);

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

ipcMain.handle("generate-image", async (_event, { promptText, vendor }) => {
  const { apiKeys } = load();
  if (!apiKeys?.[vendor]) throw new Error("You need to set the API key in Settings before this LLM vendor can be used.");
  const vendorCfg = VENDORS[vendor];

  if (vendor === "google") {
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

  // OpenAI DALL-E - fetch and convert to base64 immediately so URL doesn't expire
  const client = new OpenAI({ apiKey: apiKeys[vendor] });
  const res = await client.images.generate({ model: vendorCfg.imageModel, prompt: promptText, n: 1, size: vendorCfg.imageSize });
  const imageUrl = res.data[0].url;
  const response = await fetch(imageUrl);
  const arrayBuffer = await response.arrayBuffer();
  const b64 = Buffer.from(arrayBuffer).toString("base64");
  return `data:image/png;base64,${b64}`;
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
    }
  ]);
  menu.popup({ window: mainWin });
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

ipcMain.on("close-confirmed", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    windowsAwaitingClose.add(win.id);
    win.close();
  }
});

function showSplash() {
  const splash = new BrowserWindow({
    width: 320,
    height: 340,
    resizable: false,
    minimizable: false,
    maximizable: false,
    frame: false,
    icon: appIcon,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  splash.loadFile("splash.html");
  splash.webContents.once("did-finish-load", () => {
    splash.webContents.send("icon-path", path.join(__dirname, "app_icon.png"));
    splash.webContents.send("app-version", require("./package.json").version);
  });

  ipcMain.once("splash-close", () => {
    splash.close();
    createWindow();
  });
}

app.whenReady().then(() => {
  // Intercept every window's close to check for unsaved tabs
  app.on("browser-window-created", (_e, win) => {
    win.on("close", (e) => {
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
