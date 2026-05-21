import {
  DEFAULT_REPAIR_SETTINGS,
  sanitizeRepairSettings
} from "../adapter-repair.js";
import {
  AUTOMATION_SETTINGS_KEY,
  getDefaultAutomationSettings,
  sanitizeAutomationSettings
} from "../automation/settings.js";
import { REPAIR_SETTINGS_KEY } from "../constants.js";
import {
  getAutomationSession,
  summarizeAutomationSession
} from "../automation/session.js";

export async function setRepairSettings(settings) {
  const sanitized = sanitizeRepairSettings(settings);

  await chrome.storage.local.set({
    [REPAIR_SETTINGS_KEY]: sanitized
  });

  return {
    settings: sanitized
  };
}

export async function getRepairSettings() {
  const result = await chrome.storage.local.get(REPAIR_SETTINGS_KEY);

  return sanitizeRepairSettings(result[REPAIR_SETTINGS_KEY] || DEFAULT_REPAIR_SETTINGS);
}

export async function setAutomationSettings(settings, extensionName) {
  const result = await chrome.storage.local.get(AUTOMATION_SETTINGS_KEY);
  const existing = sanitizeAutomationSettings(
    result[AUTOMATION_SETTINGS_KEY] || getDefaultAutomationSettings(extensionName),
    extensionName
  );
  const incomingProject = settings?.project && typeof settings.project === "object" ? settings.project : {};
  const mergedProject = preserveExistingProjectTarget(incomingProject, existing.project, extensionName);
  const sanitized = sanitizeAutomationSettings({
    ...settings,
    project: mergedProject
  }, extensionName);

  await chrome.storage.local.set({
    [AUTOMATION_SETTINGS_KEY]: sanitized
  });

  return {
    settings: await getPublicAutomationSettings(extensionName)
  };
}

export async function getAutomationSettings(extensionName) {
  const result = await chrome.storage.local.get(AUTOMATION_SETTINGS_KEY);

  return sanitizeAutomationSettings(
    result[AUTOMATION_SETTINGS_KEY] || getDefaultAutomationSettings(extensionName),
    extensionName
  );
}

export async function getPublicAutomationSettings(extensionName) {
  const settings = await getAutomationSettings(extensionName);
  const session = await getAutomationSession();

  return {
    ...settings,
    automationSession: summarizeAutomationSession(session)
  };
}

function preserveExistingProjectTarget(incomingProject, existingProject, extensionName) {
  const incoming = sanitizeAutomationSettings({
    project: incomingProject
  }, extensionName).project;

  if (
    existingProject?.segment
    && incoming.name === existingProject.name
    && !incomingProject.segment
    && !incomingProject.url
  ) {
    return {
      ...incomingProject,
      segment: existingProject.segment,
      url: existingProject.url
    };
  }

  return incomingProject;
}
