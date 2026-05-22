import {
  CHATGPT_CONTENT_SCRIPT_FILES,
  CHATGPT_HOME_URL,
  CHATGPT_HOSTS as CHATGPT_HOST_LIST,
  CHATGPT_LOAD_TIMEOUT_MS,
  EVENT_LIMIT,
  HISTORY_LIMIT,
  STORAGE_KEYS
} from "../shared/contracts.js";

export {
  CHATGPT_CONTENT_SCRIPT_FILES,
  CHATGPT_HOME_URL,
  CHATGPT_LOAD_TIMEOUT_MS,
  EVENT_LIMIT,
  HISTORY_LIMIT
};

export const CHATGPT_HOSTS = new Set(CHATGPT_HOST_LIST);
export const PANEL_STATE_KEY = STORAGE_KEYS.PANEL_STATE;
export const REPAIR_SETTINGS_KEY = STORAGE_KEYS.REPAIR_SETTINGS;
export const LAST_SOURCE_TAB_KEY = STORAGE_KEYS.LAST_SOURCE_TAB;
export const AUTOMATION_WINDOW_STATE_KEY = STORAGE_KEYS.AUTOMATION_WINDOW_STATE;

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
  try {
    const extensionOrigin = parseExtensionOrigin(chrome.runtime.getURL(""));
    if (!extensionOrigin) {
      return false;
    }

    return value === extensionOrigin || value.startsWith(`${extensionOrigin}/`);
  } catch (_error) {
    return false;
  }
}

function parseExtensionOrigin(value) {
  const match = /^(chrome-extension|moz-extension):\/\/[^/]+/.exec(String(value || ""));

  return match ? match[0] : "";
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
