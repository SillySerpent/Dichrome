import {
  STORAGE_KEYS,
  VISIBILITY_MODES,
  VISIBILITY_SETTINGS_VERSION
} from "../../shared/contracts.js";

const MAX_PROJECT_NAME_LENGTH = 80;
const MAX_PROJECT_SEGMENT_LENGTH = 160;
const MAX_MODEL_LABEL_LENGTH = 80;

export {
  VISIBILITY_MODES,
  VISIBILITY_SETTINGS_VERSION
};

export const AUTOMATION_SETTINGS_KEY = STORAGE_KEYS.AUTOMATION_SETTINGS;

export function getDefaultAutomationSettings(extensionName) {
  return {
    project: {
      enabled: true,
      name: sanitizeText(extensionName, MAX_PROJECT_NAME_LENGTH) || "Dichrome",
      createIfMissing: true,
      segment: "",
      url: ""
    },
    conversation: {
      startNewChat: true
    },
    visibility: {
      schemaVersion: VISIBILITY_SETTINGS_VERSION,
      mode: VISIBILITY_MODES.HIDDEN
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
      createIfMissing: Boolean(project.createIfMissing ?? defaults.project.createIfMissing),
      ...sanitizeProjectTarget(project)
    },
    conversation: {
      startNewChat: Boolean(source.conversation?.startNewChat ?? defaults.conversation.startNewChat)
    },
    visibility: {
      schemaVersion: VISIBILITY_SETTINGS_VERSION,
      mode: sanitizeVisibilityMode(visibilityDefaults.mode, defaults.visibility.mode)
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

function migrateVisibilitySettings(visibility, defaults) {
  if (visibility.schemaVersion === VISIBILITY_SETTINGS_VERSION) {
    return {
      mode: VISIBILITY_MODES.HIDDEN
    };
  }

  return {
    ...defaults,
    mode: VISIBILITY_MODES.HIDDEN
  };
}

function sanitizeVisibilityMode(value, fallback) {
  return VISIBILITY_MODES.HIDDEN;
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

function sanitizeProjectTarget(project) {
  const segment = sanitizeProjectSegment(project.segment || extractProjectSegmentFromUrl(project.url));
  const origin = extractAllowedChatGptOrigin(project.url) || "https://chatgpt.com";

  return {
    segment,
    url: segment ? `${origin}/g/${segment}/project` : ""
  };
}

function sanitizeProjectSegment(value) {
  const text = sanitizeText(value, MAX_PROJECT_SEGMENT_LENGTH);

  return /^g-p-[a-z0-9-]+$/i.test(text) ? text : "";
}

function extractProjectSegmentFromUrl(value) {
  try {
    const match = new URL(value).pathname.match(/^\/g\/(g-p-[^/]+)/i);

    return match?.[1] || "";
  } catch (_error) {
    return "";
  }
}

function extractAllowedChatGptOrigin(value) {
  try {
    const url = new URL(value);

    if (url.protocol === "https:" && (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com")) {
      return url.origin;
    }
  } catch (_error) {
    return "";
  }

  return "";
}
