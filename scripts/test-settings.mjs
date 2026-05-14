import assert from "node:assert/strict";
import {
  VISIBILITY_MODES,
  VISIBILITY_SETTINGS_VERSION,
  getDefaultAutomationSettings,
  sanitizeAutomationSettings
} from "../background/automation-settings.js";
import { validateRepairSuggestions } from "../background/adapter-repair.js";

const defaults = getDefaultAutomationSettings("ChatGPT Page Relay Prototype");

assert.equal(defaults.project.enabled, true);
assert.equal(defaults.project.name, "ChatGPT Page Relay Prototype");
assert.equal(defaults.project.createIfMissing, true);
assert.equal(defaults.conversation.startNewChat, true);
assert.equal(defaults.visibility.schemaVersion, VISIBILITY_SETTINGS_VERSION);
assert.equal(defaults.visibility.mode, VISIBILITY_MODES.HIDDEN);
assert.equal(defaults.visibility.windowWidth, 520);
assert.equal(defaults.visibility.windowHeight, 760);
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
    mode: VISIBILITY_MODES.SIDECAR,
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
    createIfMissing: false
  },
  conversation: {
    startNewChat: false
  },
  visibility: {
    schemaVersion: VISIBILITY_SETTINGS_VERSION,
    mode: VISIBILITY_MODES.SIDECAR,
    windowWidth: 900,
    windowHeight: 520
  },
  model: {
    enabled: true,
    label: "Thinking",
    requireExact: true
  }
});

const migrated = sanitizeAutomationSettings({
  visibility: {
    keepVisible: true,
    focusDuringRun: false
  }
}, "Fallback Name");

assert.equal(migrated.visibility.mode, VISIBILITY_MODES.HIDDEN);

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

assert.equal(previousSchemaVisibility.visibility.mode, VISIBILITY_MODES.FOCUSED);

const explicitVisibility = sanitizeAutomationSettings({
  visibility: {
    schemaVersion: VISIBILITY_SETTINGS_VERSION,
    mode: VISIBILITY_MODES.FOCUSED
  }
}, "Fallback Name");

assert.equal(explicitVisibility.visibility.mode, VISIBILITY_MODES.FOCUSED);

const invalidVisibility = sanitizeAutomationSettings({
  visibility: {
    schemaVersion: VISIBILITY_SETTINGS_VERSION,
    mode: "background-magic"
  }
}, "Fallback Name");

assert.equal(invalidVisibility.visibility.mode, VISIBILITY_MODES.HIDDEN);

const repairValidation = validateRepairSuggestions({
  hints: [
    {
      target: "projectNavigationItem",
      strategy: "aria",
      ariaLabelIncludes: "ChatGPT Page Relay Prototype",
      confidence: 0.8
    },
    {
      target: "modelPicker",
      strategy: "role",
      role: "button",
      confidence: 0.7
    }
  ]
});

assert.equal(repairValidation.valid, true);
assert.equal(repairValidation.hints.length, 2);
assert.equal(repairValidation.hints[0].target, "projectNavigationItem");
assert.equal(repairValidation.hints[1].target, "modelPicker");

const invalidRepairValidation = validateRepairSuggestions({
  hints: [
    {
      target: "extensionSourceCode",
      strategy: "selector",
      selector: "script"
    }
  ]
});

assert.equal(invalidRepairValidation.valid, false);

console.log("Settings tests passed.");
