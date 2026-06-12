export const APP_MODES = Object.freeze({
  MODE2: "mode2",
  MODE1: "mode1"
});

export const MODE_LABELS = Object.freeze({
  [APP_MODES.MODE2]: "Mode 2 - ChatGPT Sidebar",
  [APP_MODES.MODE1]: "Mode 1 - Original Dichrome Beta"
});

export const MODE_MESSAGES = Object.freeze({
  GET_ACTIVE_MODE: "dichrome.shell:get-active-mode",
  SET_ACTIVE_MODE: "dichrome.shell:set-active-mode",
  GET_MODE_STATUS: "dichrome.shell:get-mode-status"
});

export const ACTIVE_MODE_STORAGE_KEY = "dichrome.activeMode";

const LEGACY_MODE1_HINT_KEYS = Object.freeze([
  "chatGptAutomationSettings",
  "chatGptAutomationSession",
  "panelState"
]);

export function normalizeAppMode(value) {
  const mode = String(value || "").trim().toLowerCase();

  return Object.values(APP_MODES).includes(mode) ? mode : null;
}

export function getModeLabel(mode) {
  return MODE_LABELS[normalizeAppMode(mode)] || MODE_LABELS[APP_MODES.MODE2];
}

export async function getActiveMode({
  storageArea = chrome.storage.local
} = {}) {
  const keys = [
    ACTIVE_MODE_STORAGE_KEY,
    ...LEGACY_MODE1_HINT_KEYS
  ];
  const stored = await storageArea.get(keys);
  const explicitMode = normalizeAppMode(stored[ACTIVE_MODE_STORAGE_KEY]);

  if (explicitMode) {
    return explicitMode;
  }

  const migratedMode = hasLegacyMode1State(stored)
    ? APP_MODES.MODE1
    : APP_MODES.MODE2;

  await storageArea.set({
    [ACTIVE_MODE_STORAGE_KEY]: migratedMode
  });

  return migratedMode;
}

export async function setActiveMode(mode, {
  storageArea = chrome.storage.local
} = {}) {
  const normalizedMode = normalizeAppMode(mode);

  if (!normalizedMode) {
    throw new Error(`Unsupported Dichrome mode: ${mode}`);
  }

  await storageArea.set({
    [ACTIVE_MODE_STORAGE_KEY]: normalizedMode
  });

  return normalizedMode;
}

export function listPublicModes() {
  return Object.values(APP_MODES).map((mode) => ({
    id: mode,
    label: MODE_LABELS[mode],
    beta: mode === APP_MODES.MODE1
  }));
}

function hasLegacyMode1State(stored) {
  return LEGACY_MODE1_HINT_KEYS.some((key) => {
    const value = stored?.[key];

    if (value === null || value === undefined) {
      return false;
    }

    if (typeof value === "object") {
      return Object.keys(value).length > 0;
    }

    return Boolean(value);
  });
}
