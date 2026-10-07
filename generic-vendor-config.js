/**
 * Generic vendor YAML configuration manager for custom LLM API endpoints.
 * Port of PurplePlatypus GenericVendorConfig.java to Node.js.
 *
 * Each user-added YAML vendor stores its configuration at
 * ~/.neuropanther-chat-config/<Name>.yml and defines how to
 * call a chat/prompt API and a models-listing API with configurable request
 * format, headers, and response parsing via JSONPath-like expressions.
 *
 * Supports two conversation modes:
 *   - single-shot: sends only the latest user prompt with a conversation GUID
 *   - multi-turn: sends the full message history array
 */

const yaml = require("js-yaml");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const http = require("http");
const nodeCrypto = require("crypto");

const CONFIG_FILENAME = ".neuropanther-chat-generic.yml";
const CONFIG_PATH = path.join(os.homedir(), CONFIG_FILENAME);

// Directory holding per-vendor YAML configs for dynamically added YAML vendors.
// Each dynamic YAML vendor stores its config at CONFIG_DIR/<Name>.yml
const CONFIG_DIR = path.join(os.homedir(), ".neuropanther-chat-config");

/**
 * Resolve the on-disk YAML path for a dynamic YAML vendor name.
 * The file is stored at ~/.neuropanther-chat-config/<Name>.yml
 */
function configPathForName(name) {
  return path.join(CONFIG_DIR, `${name}.yml`);
}

// Default YAML template loaded from resources
let DEFAULT_YAML = "";
try {
  DEFAULT_YAML = fs.readFileSync(path.join(__dirname, "resources", "generic_vendor.yml"), "utf8");
} catch {
  DEFAULT_YAML = "# Generic LLM Vendor Configuration\n# See documentation for setup instructions.\n";
}

// Parsed config sections
let promptConfig = null;
let modelsConfig = null;
let authConfig = null;

// Conversation GUID — generated once per session/clear
let conversationGuid = nodeCrypto.randomUUID();

// Cached auth token and expiry
let cachedAccessToken = null;
let tokenExpiryTime = 0;

/**
 * Load config from disk; if missing or invalid, use defaults.
 */
function load() {
  const yamlContent = loadYamlString();
  try {
    const root = yaml.load(yamlContent);
    if (root) {
      promptConfig = root.Prompt || null;
      modelsConfig = root.Models || null;
      authConfig = root.Auth || null;
    } else {
      promptConfig = null;
      modelsConfig = null;
      authConfig = null;
    }
  } catch {
    promptConfig = null;
    modelsConfig = null;
    authConfig = null;
  }
}

/**
 * Parse a YAML string into { promptConfig, modelsConfig, authConfig }.
 * Used for per-vendor (dynamic YAML) configs that must not clobber the
 * module-global singleton state used by the legacy "generic" vendor.
 */
function parseConfig(yamlContent) {
  try {
    const root = yaml.load(yamlContent);
    if (root) {
      return { promptConfig: root.Prompt || null, modelsConfig: root.Models || null, authConfig: root.Auth || null };
    }
  } catch {
    // fall through
  }
  return { promptConfig: null, modelsConfig: null, authConfig: null };
}

// Per-vendor auth-token caches, keyed by config path, so a dynamic YAML
// vendor's token exchange does not collide with the singleton's cache.
const perVendorTokenCache = new Map();

/**
 * Run fn with the module-global config/auth state temporarily replaced by the
 * config parsed from configPath. Restores all swapped state afterwards.
 * This lets dynamic YAML vendors reuse the exact same code path as the
 * singleton "generic" vendor. Calls are awaited sequentially per request.
 */
async function withConfig(configPath, fn) {
  const parsed = parseConfig(loadYamlString(configPath));
  const savedPrompt = promptConfig, savedModels = modelsConfig, savedAuth = authConfig;
  const savedToken = cachedAccessToken, savedExpiry = tokenExpiryTime;
  const cache = perVendorTokenCache.get(configPath) || { token: null, expiry: 0 };
  promptConfig = parsed.promptConfig;
  modelsConfig = parsed.modelsConfig;
  authConfig = parsed.authConfig;
  cachedAccessToken = cache.token;
  tokenExpiryTime = cache.expiry;
  try {
    return await fn();
  } finally {
    // persist this vendor's token cache, then restore singleton state
    perVendorTokenCache.set(configPath, { token: cachedAccessToken, expiry: tokenExpiryTime });
    promptConfig = savedPrompt;
    modelsConfig = savedModels;
    authConfig = savedAuth;
    cachedAccessToken = savedToken;
    tokenExpiryTime = savedExpiry;
  }
}

/**
 * Load the raw YAML string from disk; returns default if file doesn't exist.
 * If configPath is provided, loads that file instead of the default singleton path.
 */
function loadYamlString(configPath) {
  const target = configPath || CONFIG_PATH;
  if (fs.existsSync(target)) {
    try {
      return fs.readFileSync(target, "utf8");
    } catch {
      return DEFAULT_YAML;
    }
  }
  return DEFAULT_YAML;
}

/**
 * Save the given YAML string to disk.
 * If configPath is provided, writes that file instead of the default singleton path.
 */
function saveYamlString(yamlStr, configPath) {
  const target = configPath || CONFIG_PATH;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, yamlStr, "utf8");
  } catch {
    // Silently fail — non-critical
  }
}

/**
 * Reset conversation GUID (called on Clear).
 */
function resetGuid() {
  conversationGuid = nodeCrypto.randomUUID();
}

/**
 * Get the current conversation GUID.
 */
function getGuid() {
  return conversationGuid;
}

/**
 * Whether the configuration is valid (has at least a Prompt section).
 */
function isValid() {
  return promptConfig !== null;
}

/**
 * Get the conversation mode: "single-shot" or "multi-turn".
 */
function getConversationMode() {
  if (!promptConfig) return "single-shot";
  const mode = promptConfig.ConversationMode;
  return typeof mode === "string" ? mode.trim().toLowerCase() : "single-shot";
}

/**
 * Perform an HTTP request and return the response body as a string.
 */
function httpRequest(uri, method, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(uri);
    const transport = url.protocol === "https:" ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method: method || "GET",
      headers: headers || {},
      timeout: 120000,
    };

    const req = transport.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const responseBody = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${responseBody.substring(0, 300)}`));
        } else {
          resolve(responseBody);
        }
      });
    });

    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });

    if (body && method && method.toUpperCase() === "POST") {
      req.write(body);
    }
    req.end();
  });
}

/**
 * Resolve the auth token. If an Auth section is configured, performs a token
 * exchange (e.g., OAuth/IAM) using the raw API key and caches the result.
 * If no Auth section, returns the raw authToken as-is.
 */
async function resolveAuthToken(rawAuthToken) {
  if (!authConfig) return rawAuthToken;

  // Return cached token if still valid (with 60-second buffer)
  if (cachedAccessToken && Date.now() < (tokenExpiryTime - 60000)) {
    return cachedAccessToken;
  }

  const tokenUri = getString(authConfig, "TokenURI");
  if (!tokenUri || !tokenUri.trim()) return rawAuthToken;

  const method = getString(authConfig, "Method") || "POST";

  // Substitute ${AUTH_TOKEN} in the auth request body and headers
  let body = getString(authConfig, "Body");
  if (body) {
    body = body.replace(/\$\{AUTH_TOKEN\}/g, safeReplacement(rawAuthToken || ""));
  }

  const headers = {};
  if (authConfig.Headers && typeof authConfig.Headers === "object") {
    for (const [key, val] of Object.entries(authConfig.Headers)) {
      headers[key] = String(val || "").replace(/\$\{AUTH_TOKEN\}/g, safeReplacement(rawAuthToken || ""));
    }
  }

  const respBody = await httpRequest(tokenUri, method, headers, body);

  // Extract the token from the response
  const responseConfig = authConfig.Response;
  if (!responseConfig) {
    throw new Error("Auth section missing Response configuration");
  }

  const tokenPath = responseConfig.TokenPath;
  if (!tokenPath || !tokenPath.trim()) {
    throw new Error("Auth section missing Response.TokenPath");
  }

  const token = evaluateJsonPath(respBody, tokenPath);
  if (!token || !token.trim()) {
    throw new Error("Failed to extract token from auth response");
  }

  cachedAccessToken = token;

  // Check for expiry info
  const expiresInPath = responseConfig.ExpiresInPath;
  if (expiresInPath && expiresInPath.trim()) {
    try {
      const expiresStr = evaluateJsonPath(respBody, expiresInPath);
      if (expiresStr) {
        const expiresIn = parseInt(expiresStr.trim(), 10);
        // If value > 1_000_000_000, treat as epoch seconds; otherwise as duration in seconds
        if (expiresIn > 1000000000) {
          tokenExpiryTime = expiresIn * 1000;
        } else {
          tokenExpiryTime = Date.now() + (expiresIn * 1000);
        }
      }
    } catch {
      // Default to 50 minutes if we can't parse
      tokenExpiryTime = Date.now() + (50 * 60 * 1000);
    }
  } else {
    // Default: assume token is valid for 50 minutes
    tokenExpiryTime = Date.now() + (50 * 60 * 1000);
  }

  return cachedAccessToken;
}

/**
 * Call the prompt/chat endpoint.
 *
 * @param {string} authToken - the API key / auth token from settings
 * @param {string} model - the selected model
 * @param {string} prompt - the current user prompt text
 * @param {Array} messages - full conversation history (array of {role, content} objects)
 * @returns {Promise<string>} the extracted response content
 */
async function callPrompt(authToken, model, prompt, messages, configPath) {
  // For dynamic (per-vendor) YAML configs, temporarily swap in that vendor's
  // parsed config and auth-token cache so we reuse the exact same code path
  // as the legacy singleton "generic" vendor without clobbering its state.
  if (configPath) {
    return await withConfig(configPath, () => callPromptInternal(authToken, model, prompt, messages));
  }
  return await callPromptInternal(authToken, model, prompt, messages);
}

async function callPromptInternal(authToken, model, prompt, messages) {
  if (!promptConfig) {
    throw new Error("Generic vendor not configured. Use Configure in Settings.");
  }

  // Resolve token (performs exchange if Auth section is configured)
  const resolvedToken = await resolveAuthToken(authToken);

  const uri = substituteVars(getString(promptConfig, "URI"), resolvedToken, model, prompt, messages);
  const method = getString(promptConfig, "Method") || "POST";
  const headers = getHeaders(promptConfig, resolvedToken, model, prompt, messages);
  const body = substituteVars(getString(promptConfig, "Body"), resolvedToken, model, prompt, messages);

  const respBody = await httpRequest(uri, method, headers, body);

  // Extract content using ContentPath
  const responseConfig = promptConfig.Response;
  if (!responseConfig) {
    throw new Error("No Response section in Generic vendor config");
  }
  const contentPath = responseConfig.ContentPath;
  if (!contentPath || !contentPath.trim()) {
    // If no path specified, return the whole body
    return respBody;
  }

  return evaluateJsonPath(respBody, contentPath);
}

/**
 * Fetch the list of available models from the configured endpoint.
 *
 * @param {string} authToken - the API key / auth token
 * @returns {Promise<Array<string>>} list of model ID strings
 */
async function fetchModels(authToken, configPath) {
  if (configPath) {
    return await withConfig(configPath, () => fetchModelsInternal(authToken));
  }
  return await fetchModelsInternal(authToken);
}

async function fetchModelsInternal(authToken) {
  if (!modelsConfig) return [];

  try {
    // Resolve token (performs exchange if Auth section is configured)
    const resolvedToken = await resolveAuthToken(authToken);

    const uri = substituteVars(getString(modelsConfig, "URI"), resolvedToken, "", "", null);
    const method = getString(modelsConfig, "Method") || "GET";
    const headers = getHeaders(modelsConfig, resolvedToken, "", "", null);

    let body = null;
    if (method.toUpperCase() === "POST") {
      body = substituteVars(getString(modelsConfig, "Body"), resolvedToken, "", "", null);
    }

    const respBody = await httpRequest(uri, method, headers, body);

    const responseConfig = modelsConfig.Response;
    if (!responseConfig) return [];

    const listPath = responseConfig.ListPath || "";
    const idField = responseConfig.IdField || "id";

    // Navigate to the array using ListPath
    let arrayJson;
    if (!listPath || !listPath.trim()) {
      arrayJson = respBody.trim();
    } else {
      arrayJson = evaluateJsonPath(respBody, listPath);
    }

    // Extract model IDs from the JSON array
    const result = [];
    if (arrayJson && arrayJson.trim().startsWith("[")) {
      const pattern = new RegExp(`"${escapeRegex(idField)}"\\s*:\\s*"([^"]+)"`, "g");
      let match;
      while ((match = pattern.exec(arrayJson)) !== null) {
        result.push(match[1]);
      }
    }
    return result;
  } catch {
    return [];
  }
}

// --- Private helpers ---

function getString(map, key) {
  if (!map || map[key] === undefined || map[key] === null) return null;
  return String(map[key]);
}

function getHeaders(config, authToken, model, prompt, messages) {
  const result = {};
  if (config.Headers && typeof config.Headers === "object") {
    for (const [key, val] of Object.entries(config.Headers)) {
      result[key] = substituteVars(String(val || ""), authToken, model, prompt, messages);
    }
  }
  return result;
}

/**
 * Escape $ characters in a replacement string so that String.replace()
 * does not interpret $`, $', $$, $&, or $<digits> as special patterns.
 */
function safeReplacement(str) {
  return str.replace(/\$/g, "$$$$");
}

/**
 * Substitute ${AUTH_TOKEN}, ${MODEL}, ${PROMPT}, ${GUID}, ${MESSAGES},
 * ${MESSAGES_NO_SYSTEM}, and ${SYSTEM_PROMPT} in a template string.
 */
function substituteVars(template, authToken, model, prompt, messages) {
  if (template === null || template === undefined) return null;
  let result = template;

  // Replace simple scalar variables first
  result = result.replace(/\$\{AUTH_TOKEN\}/g, safeReplacement(authToken || ""));
  result = result.replace(/\$\{MODEL\}/g, safeReplacement(model || ""));
  result = result.replace(/\$\{PROMPT\}/g, safeReplacement(jsonEscape(prompt || "")));
  result = result.replace(/\$\{GUID\}/g, safeReplacement(conversationGuid));

  // Replace ${SYSTEM_PROMPT} before message arrays
  if (messages) {
    if (template.includes("${SYSTEM_PROMPT}")) {
      const sysMsg = messages.find(m => m.role === "system");
      const sysContent = sysMsg ? (sysMsg.content || "") : "";
      result = result.replace(/\$\{SYSTEM_PROMPT\}/g, safeReplacement(jsonEscape(sysContent)));
    }

    // Replace message arrays LAST to prevent further variable substitution in user content
    if (template.includes("${MESSAGES}")) {
      const arr = messages.map(m =>
        `{"role":"${jsonEscape(m.role)}","content":"${jsonEscape(m.content || "")}"}`
      );
      result = result.replace(/\$\{MESSAGES\}/g, safeReplacement(`[${arr.join(",")}]`));
    }

    if (template.includes("${MESSAGES_NO_SYSTEM}")) {
      const arr = messages
        .filter(m => m.role !== "system")
        .map(m => `{"role":"${jsonEscape(m.role)}","content":"${jsonEscape(m.content || "")}"}`);
      result = result.replace(/\$\{MESSAGES_NO_SYSTEM\}/g, safeReplacement(`[${arr.join(",")}]`));
    }
  }

  return result;
}

/**
 * JSON-escape a string for embedding in a JSON value.
 */
function jsonEscape(s) {
  if (!s) return "";
  let result = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    switch (c) {
      case "\\": result += "\\\\"; break;
      case "\"": result += "\\\""; break;
      case "\n": result += "\\n"; break;
      case "\r": result += "\\r"; break;
      case "\t": result += "\\t"; break;
      case "\b": result += "\\b"; break;
      case "\f": result += "\\f"; break;
      default:
        if (c.charCodeAt(0) < 0x20) {
          result += "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
        } else {
          result += c;
        }
    }
  }
  return result;
}

/**
 * Evaluate a simple JSONPath expression against a JSON string.
 * Supports: field.field, field[index].field, etc.
 * Examples: "choices[0].message.content", "data[0].id", "result"
 */
function evaluateJsonPath(json, pathStr) {
  let current = json.trim();

  // Split path into segments: "choices[0].message.content" -> ["choices", "[0]", "message", "content"]
  const segments = [];
  const regex = /([^.\[]+)|\[(\d+)\]/g;
  let m;
  while ((m = regex.exec(pathStr)) !== null) {
    if (m[1] !== undefined) segments.push(m[1]);
    else if (m[2] !== undefined) segments.push(`[${m[2]}]`);
  }

  for (const seg of segments) {
    if (current === null || current === undefined) return null;
    current = current.trim();

    if (seg.startsWith("[") && seg.endsWith("]")) {
      // Array index access
      const index = parseInt(seg.substring(1, seg.length - 1), 10);
      current = getArrayElement(current, index);
    } else {
      // Object field access
      current = getObjectField(current, seg);
    }
  }

  if (current === null || current === undefined) return null;
  current = current.trim();

  // If the result is a JSON string, unwrap the quotes and unescape
  if (current.startsWith("\"")) {
    return unescapeJsonString(current);
  }
  return current;
}

/**
 * Get the value of a field in a JSON object string.
 */
function getObjectField(json, field) {
  if (!json.startsWith("{")) return null;

  const pattern = `"${field}"`;
  let searchFrom = 0;

  // Find the field key at the top level of this object
  while (searchFrom < json.length) {
    const candidate = json.indexOf(pattern, searchFrom);
    if (candidate < 0) return null;

    // Check that this is at the top level (depth 0)
    let depth = 0;
    let inString = false;
    for (let i = 1; i < candidate; i++) {
      const c = json.charAt(i);
      if (inString) {
        if (c === "\\") { i++; continue; }
        if (c === "\"") inString = false;
      } else {
        if (c === "\"") inString = true;
        else if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") depth--;
      }
    }
    if (depth === 0) {
      // Found the key at top level — find the colon and value
      let colonIdx = json.indexOf(":", candidate + pattern.length);
      if (colonIdx < 0) return null;

      let valStart = colonIdx + 1;
      while (valStart < json.length && /\s/.test(json.charAt(valStart))) valStart++;
      if (valStart >= json.length) return null;

      return extractJsonValue(json, valStart);
    }
    searchFrom = candidate + 1;
  }

  return null;
}

/**
 * Get an element from a JSON array string by index.
 */
function getArrayElement(json, index) {
  if (!json.startsWith("[")) return null;

  let pos = 1; // after opening [
  let currentIndex = 0;

  while (pos < json.length) {
    while (pos < json.length && /\s/.test(json.charAt(pos))) pos++;
    if (pos >= json.length || json.charAt(pos) === "]") return null;

    const valueStart = pos;
    const valueEnd = findValueEnd(json, pos);
    if (valueEnd < 0) return null;

    if (currentIndex === index) {
      return json.substring(valueStart, valueEnd).trim();
    }

    pos = valueEnd;
    while (pos < json.length && /\s/.test(json.charAt(pos))) pos++;
    if (pos < json.length && json.charAt(pos) === ",") pos++;
    currentIndex++;
  }

  return null;
}

/**
 * Extract a JSON value starting at the given position.
 */
function extractJsonValue(json, start) {
  const end = findValueEnd(json, start);
  if (end < 0) return null;
  return json.substring(start, end).trim();
}

/**
 * Find the end position of a JSON value starting at pos.
 */
function findValueEnd(json, pos) {
  while (pos < json.length && /\s/.test(json.charAt(pos))) pos++;
  if (pos >= json.length) return -1;

  const c = json.charAt(pos);

  if (c === "\"") {
    // String
    let i = pos + 1;
    while (i < json.length) {
      if (json.charAt(i) === "\\") { i += 2; continue; }
      if (json.charAt(i) === "\"") return i + 1;
      i++;
    }
    return -1;
  } else if (c === "{" || c === "[") {
    // Object or Array
    const close = c === "{" ? "}" : "]";
    let depth = 1;
    let i = pos + 1;
    let inStr = false;
    while (i < json.length && depth > 0) {
      const ch = json.charAt(i);
      if (inStr) {
        if (ch === "\\") { i++; }
        else if (ch === "\"") inStr = false;
      } else {
        if (ch === "\"") inStr = true;
        else if (ch === c) depth++;
        else if (ch === close) depth--;
      }
      i++;
    }
    return i;
  } else {
    // Number, boolean, null
    let i = pos;
    while (i < json.length) {
      const ch = json.charAt(i);
      if (ch === "," || ch === "}" || ch === "]" || /\s/.test(ch)) break;
      i++;
    }
    return i;
  }
}

/**
 * Unescape a JSON string value (remove surrounding quotes, process escape sequences).
 */
function unescapeJsonString(jsonStr) {
  if (jsonStr.length < 2) return jsonStr;
  const inner = jsonStr.substring(1, jsonStr.length - 1);
  let result = "";
  let i = 0;
  while (i < inner.length) {
    const c = inner.charAt(i);
    if (c === "\\" && i + 1 < inner.length) {
      const next = inner.charAt(i + 1);
      switch (next) {
        case "n": result += "\n"; break;
        case "r": result += "\r"; break;
        case "t": result += "\t"; break;
        case "\"": result += "\""; break;
        case "\\": result += "\\"; break;
        case "/": result += "/"; break;
        case "u":
          if (i + 5 < inner.length) {
            result += String.fromCharCode(parseInt(inner.substring(i + 2, i + 6), 16));
            i += 4;
          }
          break;
        default:
          result += "\\";
          result += next;
      }
      i += 2;
    } else {
      result += c;
      i++;
    }
  }
  return result;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Load config on module initialization
load();

module.exports = {
  load,
  loadYamlString,
  saveYamlString,
  resetGuid,
  getGuid,
  isValid,
  getConversationMode,
  callPrompt,
  fetchModels,
  DEFAULT_YAML,
  CONFIG_PATH,
  CONFIG_DIR,
  configPathForName,
};
