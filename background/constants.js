export const CHATGPT_HOME_URL = "https://chatgpt.com/";
export const CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
export const CHATGPT_LOAD_TIMEOUT_MS = 30000;
export const HISTORY_LIMIT = 20;
export const EVENT_LIMIT = 100;
export const PANEL_STATE_KEY = "panelState";
export const REPAIR_SETTINGS_KEY = "adapterRepairSettings";
export const LAST_SOURCE_TAB_KEY = "lastSourceTab";
export const AUTOMATION_WINDOW_STATE_KEY = "chatGptAutomationWindowState";

export const CHATGPT_CONTENT_SCRIPT_FILES = Object.freeze([
  "content/chatgpt/00-namespace.js",
  "content/chatgpt/90-bootstrap.js"
]);

export const storageArea = chrome.storage.session || chrome.storage.local;

export function isChatGptUrl(value) {
  try {
    const url = new URL(value);

    return url.protocol === "https:" && CHATGPT_HOSTS.has(url.hostname);
  } catch (_error) {
    return false;
  }
}

export function isExtensionUrl(value) {
  return value.startsWith(`chrome-extension://${chrome.runtime.id}/`);
}

export function getTabId(tabLike) {
  return tabLike?.id ?? tabLike?.tabId ?? null;
}

export function serializeError(error) {
  if (!error) {
    return "Unknown error";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error.message) {
    return error.message;
  }

  return String(error);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
