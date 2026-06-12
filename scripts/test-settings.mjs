import assert from "node:assert/strict";
import {
  VISIBILITY_MODES,
  VISIBILITY_SETTINGS_VERSION,
  getDefaultAutomationSettings,
  sanitizeAutomationSettings
} from "../background/automation/settings.js";

const defaults = getDefaultAutomationSettings("ChatGPT Page Relay Prototype");

assert.equal(defaults.project.enabled, true);
assert.equal(defaults.project.name, "ChatGPT Page Relay Prototype");
assert.equal(defaults.project.createIfMissing, true);
assert.equal(defaults.project.segment, "");
assert.equal(defaults.project.url, "");
assert.equal(defaults.conversation.startNewChat, true);
assert.equal(defaults.visibility.schemaVersion, VISIBILITY_SETTINGS_VERSION);
assert.equal(defaults.visibility.mode, VISIBILITY_MODES.HIDDEN);
assert.equal("windowWidth" in defaults.visibility, false);
assert.equal("windowHeight" in defaults.visibility, false);
assert.equal(defaults.model.enabled, false);

const sanitized = sanitizeAutomationSettings({
  project: {
    enabled: false,
    name: "  My   Project  ",
    createIfMissing: false
  },
  conversation: {
    startNewChat: false
  },
  visibility: {
    schemaVersion: VISIBILITY_SETTINGS_VERSION,
    mode: "sidecar",
    windowWidth: 10000,
    windowHeight: 1
  },
  model: {
    enabled: true,
    label: "  Thinking  ",
    requireExact: true
  }
}, "Fallback Name");

assert.deepEqual(sanitized, {
  project: {
    enabled: false,
    name: "My Project",
    createIfMissing: false,
    segment: "",
    url: ""
  },
  conversation: {
    startNewChat: false
  },
  visibility: {
    schemaVersion: VISIBILITY_SETTINGS_VERSION,
    mode: VISIBILITY_MODES.HIDDEN
  },
  model: {
    enabled: true,
    label: "Thinking",
    requireExact: true
  }
});

const sanitizedProjectTarget = sanitizeAutomationSettings({
  project: {
    enabled: true,
    name: "Dichrome",
    createIfMissing: true,
    url: "https://chatgpt.com/g/g-p-target-dichrome/project"
  }
}, "Fallback Name");

assert.equal(sanitizedProjectTarget.project.segment, "g-p-target-dichrome");
assert.equal(sanitizedProjectTarget.project.url, "https://chatgpt.com/g/g-p-target-dichrome/project");

const migrated = sanitizeAutomationSettings({
  visibility: {
    keepVisible: true,
    focusDuringRun: false
  }
}, "Fallback Name");

assert.equal(migrated.visibility.mode, VISIBILITY_MODES.HIDDEN);
assert.equal("windowWidth" in migrated.visibility, false);
assert.equal("windowHeight" in migrated.visibility, false);

const migratedSeamlessMode = sanitizeAutomationSettings({
  visibility: {
    schemaVersion: VISIBILITY_SETTINGS_VERSION - 1,
    mode: "seamless"
  }
}, "Fallback Name");

assert.equal(migratedSeamlessMode.visibility.mode, VISIBILITY_MODES.HIDDEN);

const previousSchemaVisibility = sanitizeAutomationSettings({
  visibility: {
    schemaVersion: VISIBILITY_SETTINGS_VERSION - 1,
    keepVisible: false,
    focusDuringRun: true
  }
}, "Fallback Name");

assert.equal(previousSchemaVisibility.visibility.mode, VISIBILITY_MODES.HIDDEN);

const explicitVisibility = sanitizeAutomationSettings({
  visibility: {
    schemaVersion: VISIBILITY_SETTINGS_VERSION,
    mode: "focused"
  }
}, "Fallback Name");

assert.equal(explicitVisibility.visibility.mode, VISIBILITY_MODES.HIDDEN);

const invalidVisibility = sanitizeAutomationSettings({
  visibility: {
    schemaVersion: VISIBILITY_SETTINGS_VERSION,
    mode: "background-magic"
  }
}, "Fallback Name");

assert.equal(invalidVisibility.visibility.mode, VISIBILITY_MODES.HIDDEN);

console.log("Settings tests passed.");
