const MAX_PROJECT_NAME_LENGTH = 80;
const MAX_MODEL_LABEL_LENGTH = 80;
const MIN_AUTOMATION_WINDOW_WIDTH = 420;
const MAX_AUTOMATION_WINDOW_WIDTH = 900;
const MIN_AUTOMATION_WINDOW_HEIGHT = 520;
const MAX_AUTOMATION_WINDOW_HEIGHT = 1200;
export const VISIBILITY_SETTINGS_VERSION = 5;
export const VISIBILITY_MODES = Object.freeze({
  HIDDEN: "hidden",
  SINGLE_TAB: "single-tab",
  SIDECAR: "sidecar",
  FOCUSED: "focused"
});

export const AUTOMATION_SETTINGS_KEY = "chatGptAutomationSettings";

export function getDefaultAutomationSettings(extensionName) {
  return {
    project: {
      enabled: true,
      name: sanitizeText(extensionName, MAX_PROJECT_NAME_LENGTH) || "ChatGPT Page Relay Prototype",
      createIfMissing: true
    },
    conversation: {
      startNewChat: true
    },
    visibility: {
      schemaVersion: VISIBILITY_SETTINGS_VERSION,
      mode: VISIBILITY_MODES.HIDDEN,
      windowWidth: 520,
      windowHeight: 760
    },
    model: {
      enabled: false,
      label: "",
      requireExact: false
    }
  };
}

export function sanitizeAutomationSettings(value, extensionName) {
  const defaults = getDefaultAutomationSettings(extensionName);
  const source = value && typeof value === "object" ? value : {};
  const project = source.project && typeof source.project === "object" ? source.project : {};
  const model = source.model && typeof source.model === "object" ? source.model : {};
  const visibility = source.visibility && typeof source.visibility === "object" ? source.visibility : {};
  const visibilityDefaults = migrateVisibilitySettings(visibility, defaults.visibility);

  return {
    project: {
      enabled: Boolean(project.enabled ?? defaults.project.enabled),
      name: sanitizeText(project.name, MAX_PROJECT_NAME_LENGTH) || defaults.project.name,
      createIfMissing: Boolean(project.createIfMissing ?? defaults.project.createIfMissing)
    },
    conversation: {
      startNewChat: Boolean(source.conversation?.startNewChat ?? defaults.conversation.startNewChat)
    },
    visibility: {
      schemaVersion: VISIBILITY_SETTINGS_VERSION,
      mode: sanitizeVisibilityMode(visibilityDefaults.mode, defaults.visibility.mode),
      windowWidth: clampInteger(visibilityDefaults.windowWidth, MIN_AUTOMATION_WINDOW_WIDTH, MAX_AUTOMATION_WINDOW_WIDTH, defaults.visibility.windowWidth),
      windowHeight: clampInteger(visibilityDefaults.windowHeight, MIN_AUTOMATION_WINDOW_HEIGHT, MAX_AUTOMATION_WINDOW_HEIGHT, defaults.visibility.windowHeight)
    },
    model: {
      enabled: Boolean(model.enabled ?? defaults.model.enabled),
      label: sanitizeText(model.label, MAX_MODEL_LABEL_LENGTH),
      requireExact: Boolean(model.requireExact ?? defaults.model.requireExact)
    }
  };
}

export function mergeAutomationSettings(baseSettings, overrideSettings, extensionName) {
  const base = sanitizeAutomationSettings(baseSettings, extensionName);
  const override = overrideSettings && typeof overrideSettings === "object" ? overrideSettings : {};

  return sanitizeAutomationSettings({
    project: {
      ...base.project,
      ...(override.project && typeof override.project === "object" ? override.project : {})
    },
    conversation: {
      ...base.conversation,
      ...(override.conversation && typeof override.conversation === "object" ? override.conversation : {})
    },
    visibility: {
      ...base.visibility,
      ...(override.visibility && typeof override.visibility === "object" ? override.visibility : {})
    },
    model: {
      ...base.model,
      ...(override.model && typeof override.model === "object" ? override.model : {})
    }
  }, extensionName);
}

export function getVisibilityMode(visibility) {
  return sanitizeVisibilityMode(visibility?.mode, VISIBILITY_MODES.HIDDEN);
}

export function usesHiddenAutomation(visibility) {
  return getVisibilityMode(visibility) === VISIBILITY_MODES.HIDDEN;
}

export function usesSingleTabAutomation(visibility) {
  const mode = getVisibilityMode(visibility);

  return mode === VISIBILITY_MODES.HIDDEN || mode === VISIBILITY_MODES.SINGLE_TAB;
}

export function usesSidecarWindow(visibility) {
  const mode = getVisibilityMode(visibility);

  return mode === VISIBILITY_MODES.SIDECAR || mode === VISIBILITY_MODES.FOCUSED;
}

export function usesFocusedAutomation(visibility) {
  return getVisibilityMode(visibility) === VISIBILITY_MODES.FOCUSED;
}

export function usesFocusEmulation(visibility) {
  const mode = getVisibilityMode(visibility);

  return mode === VISIBILITY_MODES.HIDDEN
    || mode === VISIBILITY_MODES.SINGLE_TAB
    || mode === VISIBILITY_MODES.SIDECAR;
}

function migrateVisibilitySettings(visibility, defaults) {
  if (visibility.schemaVersion === VISIBILITY_SETTINGS_VERSION) {
    return visibility;
  }

  const legacyMode = visibility.mode === "seamless" ? VISIBILITY_MODES.HIDDEN : visibility.mode;
  const mode = sanitizeVisibilityMode(legacyMode, null)
    || (visibility.focusDuringRun === true ? VISIBILITY_MODES.FOCUSED : VISIBILITY_MODES.HIDDEN);

  return {
    ...defaults,
    mode,
    windowWidth: visibility.windowWidth,
    windowHeight: visibility.windowHeight
  };
}

function sanitizeVisibilityMode(value, fallback) {
  if (Object.values(VISIBILITY_MODES).includes(value)) {
    return value;
  }

  return fallback;
}

function sanitizeText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(number)));
}
