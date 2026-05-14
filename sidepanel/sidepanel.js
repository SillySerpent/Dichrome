import {
  VISIBILITY_MODES,
  VISIBILITY_SETTINGS_VERSION
} from "../background/automation-settings.js";

const dom = {
  statusLine: document.getElementById("statusLine"),
  refreshButton: document.getElementById("refreshButton"),
  profileSelect: document.getElementById("profileSelect"),
  manualText: document.getElementById("manualText"),
  sendManualButton: document.getElementById("sendManualButton"),
  screenshotButton: document.getElementById("screenshotButton"),
  stateBadge: document.getElementById("stateBadge"),
  profileLabel: document.getElementById("profileLabel"),
  sourceLabel: document.getElementById("sourceLabel"),
  selectedBlock: document.getElementById("selectedBlock"),
  selectedText: document.getElementById("selectedText"),
  responseText: document.getElementById("responseText"),
  followupText: document.getElementById("followupText"),
  followupButton: document.getElementById("followupButton"),
  errorBlock: document.getElementById("errorBlock"),
  retryButton: document.getElementById("retryButton"),
  retryRepairButton: document.getElementById("retryRepairButton"),
  debugDumpButton: document.getElementById("debugDumpButton"),
  openChatGptButton: document.getElementById("openChatGptButton"),
  cancelButton: document.getElementById("cancelButton"),
  repairEnabled: document.getElementById("repairEnabled"),
  repairModel: document.getElementById("repairModel"),
  repairUrl: document.getElementById("repairUrl"),
  saveRepairButton: document.getElementById("saveRepairButton"),
  permissionRepairButton: document.getElementById("permissionRepairButton"),
  repairSuggestions: document.getElementById("repairSuggestions"),
  eventLog: document.getElementById("eventLog"),
  projectRoutingEnabled: document.getElementById("projectRoutingEnabled"),
  projectName: document.getElementById("projectName"),
  projectCreateIfMissing: document.getElementById("projectCreateIfMissing"),
  startNewChat: document.getElementById("startNewChat"),
  automationVisibilityMode: document.getElementById("automationVisibilityMode"),
  automationTargetStatus: document.getElementById("automationTargetStatus"),
  modelSelectionEnabled: document.getElementById("modelSelectionEnabled"),
  modelLabel: document.getElementById("modelLabel"),
  modelRequireExact: document.getElementById("modelRequireExact"),
  saveAutomationButton: document.getElementById("saveAutomationButton")
};

let profiles = [];
let panelState = {
  activeRequestId: null,
  requests: []
};

document.addEventListener("DOMContentLoaded", () => {
  void initialize();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "PANEL_STATE_UPDATED") {
    panelState = message.panelState;
    render();
    void refreshAutomationTargetStatus();
  }
});

async function initialize() {
  bindEvents();
  await Promise.all([
    loadProfiles(),
    loadPanelState(),
    loadRepairSettings(),
    loadAutomationSettings()
  ]);
  render();
}

function bindEvents() {
  dom.refreshButton.addEventListener("click", () => {
    void runPanelAction(async () => {
      await loadPanelState();
      render();
    });
  });

  dom.sendManualButton.addEventListener("click", () => {
    void runPanelAction(sendManualRequest);
  });

  dom.screenshotButton.addEventListener("click", () => {
    void runPanelAction(sendScreenshotRequest);
  });

  dom.retryButton.addEventListener("click", () => {
    void runPanelAction(() => retryActiveRequest(false));
  });

  dom.followupButton.addEventListener("click", () => {
    void runPanelAction(sendFollowupRequest);
  });

  dom.retryRepairButton.addEventListener("click", () => {
    void runPanelAction(() => retryActiveRequest(true));
  });

  dom.debugDumpButton.addEventListener("click", () => {
    void runPanelAction(dumpDebugState);
  });

  dom.openChatGptButton.addEventListener("click", () => {
    const request = getActiveRequest();

    if (request) {
      void runPanelAction(() => sendMessage("OPEN_CHATGPT_TAB", {
        requestId: request.id
      }));
    }
  });

  dom.cancelButton.addEventListener("click", () => {
    const request = getActiveRequest();

    if (request) {
      void runPanelAction(() => sendMessage("CANCEL_REQUEST", {
        requestId: request.id
      }));
    }
  });

  dom.saveRepairButton.addEventListener("click", () => {
    void runPanelAction(saveRepairSettings);
  });

  dom.saveAutomationButton.addEventListener("click", () => {
    void runPanelAction(saveAutomationSettings);
  });

  dom.permissionRepairButton.addEventListener("click", () => {
    void runPanelAction(requestRepairPermission);
  });
}

async function loadProfiles() {
  const response = await sendMessage("GET_PROFILES");
  profiles = response.profiles || [];

  const manualProfiles = profiles.filter((profile) => profile.inputKind === "manual_text" || profile.inputKind === "selection");
  dom.profileSelect.replaceChildren(...manualProfiles.map((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.label;

    return option;
  }));

  if (!dom.profileSelect.value && manualProfiles[0]) {
    dom.profileSelect.value = manualProfiles[0].id;
  }
}

async function loadPanelState() {
  const response = await sendMessage("GET_PANEL_STATE");
  panelState = response.panelState || panelState;
}

async function loadRepairSettings() {
  const response = await sendMessage("GET_LOCAL_REPAIR_SETTINGS");
  const settings = response.settings || {};

  dom.repairEnabled.checked = Boolean(settings.enabled);
  dom.repairModel.value = settings.model || "llama3.2:3b";
  dom.repairUrl.value = settings.ollamaUrl || "http://localhost:11434/api/generate";
}

async function loadAutomationSettings() {
  const response = await sendMessage("GET_CHATGPT_AUTOMATION_SETTINGS");
  const settings = response.settings || {};

  dom.projectRoutingEnabled.checked = Boolean(settings.project?.enabled);
  dom.projectName.value = settings.project?.name || "ChatGPT Page Relay Prototype";
  dom.projectCreateIfMissing.checked = settings.project?.createIfMissing !== false;
  dom.startNewChat.checked = settings.conversation?.startNewChat !== false;
  dom.automationVisibilityMode.value = normalizeVisibilityMode(settings.visibility?.mode);
  dom.modelSelectionEnabled.checked = Boolean(settings.model?.enabled);
  dom.modelLabel.value = settings.model?.label || "";
  dom.modelRequireExact.checked = Boolean(settings.model?.requireExact);
  renderAutomationTargetStatus(settings.automationSession || null);
}

async function sendManualRequest() {
  const text = dom.manualText.value.trim();

  if (!text) {
    setTransientStatus("Text prompt is empty.");
    return;
  }

  await sendMessage("RUN_MANUAL_REQUEST", {
    profileId: dom.profileSelect.value || "custom_text",
    text
  });
  dom.manualText.value = "";
  await loadPanelState();
  render();
}

async function sendScreenshotRequest() {
  await sendMessage("RUN_SCREENSHOT_REQUEST", {
    prompt: dom.manualText.value.trim()
  });
  await loadPanelState();
  render();
}

async function retryActiveRequest(useRepairHints) {
  const request = getActiveRequest();

  if (!request) {
    return;
  }

  await sendMessage("RETRY_REQUEST", {
    requestId: request.id,
    useRepairHints
  });
  await loadPanelState();
  render();
}

async function sendFollowupRequest() {
  const request = getActiveRequest();
  const text = dom.followupText.value.trim();

  if (!request) {
    return;
  }

  if (!text) {
    setTransientStatus("Follow-up prompt is empty.");
    return;
  }

  await sendMessage("RUN_FOLLOWUP_REQUEST", {
    requestId: request.id,
    text
  });
  dom.followupText.value = "";
  await loadPanelState();
  render();
}

async function saveRepairSettings() {
  const response = await sendMessage("SET_LOCAL_REPAIR_SETTINGS", {
    settings: {
      enabled: dom.repairEnabled.checked,
      model: dom.repairModel.value,
      ollamaUrl: dom.repairUrl.value
    }
  });
  const settings = response.settings;

  dom.repairEnabled.checked = Boolean(settings.enabled);
  dom.repairModel.value = settings.model;
  dom.repairUrl.value = settings.ollamaUrl;
  setTransientStatus("Local repair settings saved.");
}

async function dumpDebugState() {
  const request = getActiveRequest();
  const response = await sendMessage("DUMP_DEBUG", {
    requestId: request?.id || null
  });

  console.log("[ChatGPT Relay] Side panel debug dump", response.dump);
  setTransientStatus("Debug dump written to console.");
}

async function saveAutomationSettings() {
  const response = await sendMessage("SET_CHATGPT_AUTOMATION_SETTINGS", {
    settings: {
      project: {
        enabled: dom.projectRoutingEnabled.checked,
        name: dom.projectName.value,
        createIfMissing: dom.projectCreateIfMissing.checked
      },
      conversation: {
        startNewChat: dom.startNewChat.checked
      },
      visibility: {
        schemaVersion: VISIBILITY_SETTINGS_VERSION,
        mode: normalizeVisibilityMode(dom.automationVisibilityMode.value)
      },
      model: {
        enabled: dom.modelSelectionEnabled.checked,
        label: dom.modelLabel.value,
        requireExact: dom.modelRequireExact.checked
      }
    }
  });
  const settings = response.settings;

  dom.projectRoutingEnabled.checked = Boolean(settings.project.enabled);
  dom.projectName.value = settings.project.name;
  dom.projectCreateIfMissing.checked = Boolean(settings.project.createIfMissing);
  dom.startNewChat.checked = Boolean(settings.conversation.startNewChat);
  dom.automationVisibilityMode.value = normalizeVisibilityMode(settings.visibility.mode);
  dom.modelSelectionEnabled.checked = Boolean(settings.model.enabled);
  dom.modelLabel.value = settings.model.label;
  dom.modelRequireExact.checked = Boolean(settings.model.requireExact);
  renderAutomationTargetStatus(settings.automationSession || null);
  setTransientStatus("ChatGPT routing settings saved.");
}

async function refreshAutomationTargetStatus() {
  const response = await sendMessage("GET_AUTOMATION_SESSION").catch(() => null);

  if (response?.automationSession) {
    renderAutomationTargetStatus(response.automationSession);
  }
}

async function requestRepairPermission() {
  const granted = await chrome.permissions.request({
    origins: ["http://localhost:11434/*"]
  });
  setTransientStatus(granted ? "Localhost permission granted." : "Localhost permission was not granted.");
}

function render() {
  const request = getActiveRequest();

  dom.statusLine.textContent = request
    ? `${request.profileLabel} - ${formatState(request.state)}`
    : "Idle";
  dom.stateBadge.textContent = request ? request.state : "IDLE";
  dom.profileLabel.textContent = request?.profileLabel || "-";
  dom.sourceLabel.textContent = request?.source?.title || request?.source?.url || "-";
  dom.selectedText.textContent = request?.selectedText || "";
  dom.selectedBlock.classList.toggle("hidden", !request?.selectedText);
  renderResponse(request);

  if (request?.error) {
    dom.errorBlock.textContent = request.error;
    dom.errorBlock.classList.remove("hidden");
  } else {
    dom.errorBlock.textContent = "";
    dom.errorBlock.classList.add("hidden");
  }

  const hasRequest = Boolean(request);
  const isRunning = hasRequest && !["RESPONSE_COMPLETE", "ERROR_STATE"].includes(request.state);
  const hasRepairHints = Boolean(request?.repairSuggestions?.hints?.length);

  dom.retryButton.disabled = !hasRequest;
  dom.followupButton.disabled = !hasRequest || isRunning || (!request?.chatConversationUrl && !request?.chatTabId);
  dom.retryRepairButton.disabled = !hasRepairHints;
  dom.openChatGptButton.disabled = !hasRequest;
  dom.cancelButton.disabled = !isRunning;

  renderRepairSuggestions(request);
  renderEvents(request);
}

function renderResponse(request) {
  const html = request?.responseHtml || "";
  const text = request?.responseText || "";

  if (html) {
    dom.responseText.innerHTML = sanitizeResponseHtml(html);
    dom.responseText.scrollTop = dom.responseText.scrollHeight;
    return;
  }

  dom.responseText.textContent = text;
  dom.responseText.scrollTop = dom.responseText.scrollHeight;
}

function sanitizeResponseHtml(html) {
  const template = document.createElement("template");
  const allowedTags = new Set([
    "A",
    "B",
    "BLOCKQUOTE",
    "BR",
    "CODE",
    "DEL",
    "DIV",
    "EM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HR",
    "I",
    "KBD",
    "LI",
    "OL",
    "P",
    "PRE",
    "S",
    "SPAN",
    "STRONG",
    "SUB",
    "SUP",
    "TABLE",
    "TBODY",
    "TD",
    "TH",
    "THEAD",
    "TR",
    "UL"
  ]);
  const allowedAttributes = new Set(["class", "href", "title"]);

  template.innerHTML = html;

  for (const element of Array.from(template.content.querySelectorAll("*"))) {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(document.createTextNode(element.textContent || ""));
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      if (!allowedAttributes.has(attribute.name)) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (attribute.name === "href" && !/^https?:\/\//i.test(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  return template.innerHTML;
}

function renderRepairSuggestions(request) {
  dom.repairSuggestions.replaceChildren();

  const hints = request?.repairSuggestions?.hints || [];

  if (!hints.length) {
    return;
  }

  for (const hint of hints) {
    const card = document.createElement("div");
    card.className = "repair-card";
    const title = document.createElement("strong");
    title.textContent = `${hint.target} - ${hint.strategy} (${Math.round(hint.confidence * 100)}%)`;
    const body = document.createElement("div");
    body.textContent = [
      hint.selector ? `selector: ${hint.selector}` : "",
      hint.ariaLabelIncludes ? `aria: ${hint.ariaLabelIncludes}` : "",
      hint.placeholderIncludes ? `placeholder: ${hint.placeholderIncludes}` : "",
      hint.textIncludes ? `text: ${hint.textIncludes}` : "",
      hint.rationale || ""
    ].filter(Boolean).join(" | ");
    card.append(title, body);
    dom.repairSuggestions.append(card);
  }
}

function renderEvents(request) {
  dom.eventLog.replaceChildren();

  const events = request?.events || [];

  for (const event of events.slice().reverse()) {
    const item = document.createElement("li");
    item.textContent = `${formatTime(event.at)} - ${event.detail}`;
    dom.eventLog.append(item);
  }
}

function getActiveRequest() {
  return panelState.requests.find((request) => request.id === panelState.activeRequestId) || panelState.requests[0] || null;
}

async function sendMessage(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({
    type,
    ...payload
  });

  if (!response?.ok) {
    throw new Error(response?.error || `Message failed: ${type}`);
  }

  return response;
}

async function runPanelAction(action) {
  try {
    await action();
  } catch (error) {
    setTransientStatus(error.message || String(error));
  }
}

function setTransientStatus(text) {
  const previous = dom.statusLine.textContent;
  dom.statusLine.textContent = text;
  window.setTimeout(() => {
    dom.statusLine.textContent = previous;
  }, 2400);
}

function formatState(state) {
  return String(state || "IDLE").toLowerCase().replace(/_/g, " ");
}

function normalizeVisibilityMode(value) {
  if (value === VISIBILITY_MODES.HIDDEN || value === VISIBILITY_MODES.SINGLE_TAB || value === VISIBILITY_MODES.SIDECAR || value === VISIBILITY_MODES.FOCUSED) {
    return value;
  }

  return VISIBILITY_MODES.HIDDEN;
}

function renderAutomationTargetStatus(session) {
  if (!dom.automationTargetStatus) {
    return;
  }

  if (!session?.targetType) {
    dom.automationTargetStatus.textContent = "Automation target: not created yet.";
    return;
  }

  const fallback = session.offscreenCapability && !session.offscreenCapability.supported
    ? ` (${session.offscreenCapability.failureReason || "hidden internal unavailable"})`
    : "";

  dom.automationTargetStatus.textContent = `Automation target: ${session.targetType}${fallback}`;
}

function formatTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}
