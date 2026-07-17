const fs = require("fs");
const path = require("path");
const os = require("os");

const SETTINGS_PATH = path.join(os.homedir(), ".neuropanther-chat-settings.json");
const { vendors: VENDORS } = require("./config.json");

const DEFAULTS = { vendor: "openai", model: "gpt-4o-mini", apiKeys: {} };

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    if (saved.apiKey && !saved.apiKeys) {
      saved.apiKeys = { [saved.vendor]: saved.apiKey };
      delete saved.apiKey;
    }
    // Migration: remove stale "bedrock", "amazon", "microsoft" keys (credentials are stored as amazonAccessKey, microsoftApiKey, etc.)
    if (saved.apiKeys) {
      delete saved.apiKeys.bedrock;
      delete saved.apiKeys.amazon;
      delete saved.apiKeys.microsoft;
      delete saved.apiKeys.ibm;
      // Migrate old bedrockAccessKey → amazonAccessKey
      if (saved.apiKeys.bedrockAccessKey && !saved.apiKeys.amazonAccessKey) {
        saved.apiKeys.amazonAccessKey = saved.apiKeys.bedrockAccessKey;
        saved.apiKeys.amazonSecretKey = saved.apiKeys.bedrockSecretKey;
        saved.apiKeys.amazonRegion = saved.apiKeys.bedrockRegion;
      }
      delete saved.apiKeys.bedrockAccessKey;
      delete saved.apiKeys.bedrockSecretKey;
      delete saved.apiKeys.bedrockRegion;
    }
    if (saved.defaultModels) {
      delete saved.defaultModels.bedrock;
    }
    return { ...DEFAULTS, ...saved, apiKeys: { ...DEFAULTS.apiKeys, ...saved.apiKeys } };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf8");
}

module.exports = { load, save, VENDORS };
