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
  errorBlock: document.getElementById("errorBlock"),
  retryButton: document.getElementById("retryButton"),
  retryRepairButton: document.getElementById("retryRepairButton"),
  openChatGptButton: document.getElementById("openChatGptButton"),
  cancelButton: document.getElementById("cancelButton"),
  repairEnabled: document.getElementById("repairEnabled"),
  repairModel: document.getElementById("repairModel"),
  repairUrl: document.getElementById("repairUrl"),
  saveRepairButton: document.getElementById("saveRepairButton"),
  permissionRepairButton: document.getElementById("permissionRepairButton"),
  repairSuggestions: document.getElementById("repairSuggestions"),
  eventLog: document.getElementById("eventLog")
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
  }
});

async function initialize() {
  bindEvents();
  await Promise.all([
    loadProfiles(),
    loadPanelState(),
    loadRepairSettings()
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

  dom.retryRepairButton.addEventListener("click", () => {
    void runPanelAction(() => retryActiveRequest(true));
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
  dom.responseText.textContent = request?.responseText || "";

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
  dom.retryRepairButton.disabled = !hasRepairHints;
  dom.openChatGptButton.disabled = !hasRequest;
  dom.cancelButton.disabled = !isRunning;

  renderRepairSuggestions(request);
  renderEvents(request);
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
