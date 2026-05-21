import {
  VISIBILITY_SETTINGS_VERSION
} from "../../background/automation/settings.js";
import {
  VISIBILITY_MODES
} from "../../shared/contracts.js";

export function createSettingsDialog({
  dom,
  defaultProjectName,
  getAutomationSettings,
  getWorkspaceReadiness,
  normalizePublicAutomationSettings
}) {
  function open() {
    render();
    dom.settingsOverlay.classList.remove("hidden");
    dom.projectNameInput.focus();
  }

  function close() {
    dom.settingsOverlay.classList.add("hidden");
    render();
  }

  function render() {
    const settings = normalizePublicAutomationSettings(getAutomationSettings() || {});
    const readiness = getWorkspaceReadiness() || {};

    dom.projectRoutingEnabled.checked = Boolean(settings.project.enabled);
    dom.projectNameInput.value = settings.project.name || defaultProjectName;
    dom.projectUrlInput.value = settings.project.url || settings.project.segment || "";
    dom.projectCreateIfMissing.checked = Boolean(settings.project.createIfMissing);
    dom.modelRequireExact.checked = Boolean(settings.model.requireExact);
    setModelLabelValue(settings.model.label);
    updateSummary(settings);
    dom.settingsStatus.textContent = readiness.message || "Hidden internal automation only.";
  }

  function updateSummary(settings = normalizePublicAutomationSettings(getAutomationSettings() || {})) {
    const project = settings.project || {};
    const model = settings.model?.label ? ` · ${settings.model.label}` : "";
    const summary = project.enabled
      ? `${project.name || defaultProjectName}${model}`
      : `No project${model}`;

    dom.routingSummary.textContent = summary;
    dom.routingSummary.title = project.enabled
      ? `New conversations route to project: ${project.name || defaultProjectName}${project.url ? ` (${project.url})` : ""}${model}`
      : `New conversations use ChatGPT default routing${model}`;
  }

  function collect() {
    const current = normalizePublicAutomationSettings(getAutomationSettings() || {});
    const modelLabel = dom.modelLabel.value.trim();
    const projectUrl = dom.projectUrlInput.value.trim();

    return {
      project: {
        enabled: Boolean(dom.projectRoutingEnabled.checked),
        name: dom.projectNameInput.value.trim() || defaultProjectName,
        createIfMissing: Boolean(dom.projectCreateIfMissing.checked),
        segment: extractProjectSegment(projectUrl) || current.project.segment || "",
        url: projectUrl || current.project.url || ""
      },
      conversation: {
        // Conversation creation is controlled per message by the sidebar's active
        // conversation state. Routing/model changes must never resume old chats.
        startNewChat: false
      },
      visibility: {
        schemaVersion: VISIBILITY_SETTINGS_VERSION,
        mode: VISIBILITY_MODES.HIDDEN
      },
      model: {
        enabled: Boolean(modelLabel),
        label: modelLabel,
        requireExact: Boolean(dom.modelRequireExact.checked)
      }
    };
  }

  function setModelLabelValue(label) {
    const normalized = String(label || "").trim();

    if (normalized && !Array.from(dom.modelLabel.options).some((option) => option.value === normalized)) {
      const option = document.createElement("option");
      option.value = normalized;
      option.textContent = normalized;
      dom.modelLabel.appendChild(option);
    }

    dom.modelLabel.value = normalized;
  }

  return {
    close,
    collect,
    open,
    render,
    updateSummary
  };
}

function extractProjectSegment(value) {
  const text = String(value || "").trim();

  if (/^g-p-[a-z0-9-]+$/i.test(text)) {
    return text;
  }

  try {
    return new URL(text).pathname.match(/^\/g\/(g-p-[^/]+)/i)?.[1] || "";
  } catch (_error) {
    return "";
  }
}
