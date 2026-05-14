import {
  REQUEST_PROFILES,
  REQUEST_STATES,
  buildPromptForProfile,
  createRequestId,
  createRequestRecord,
  getPublicProfiles,
  getProfile,
  normalizeText
} from "./state-machine.js";
import {
  DEFAULT_REPAIR_SETTINGS,
  requestAdapterRepair,
  sanitizeRepairSettings
} from "./adapter-repair.js";
import {
  AUTOMATION_SETTINGS_KEY,
  VISIBILITY_MODES,
  getDefaultAutomationSettings,
  mergeAutomationSettings,
  sanitizeAutomationSettings
} from "./automation-settings.js";
import {
  summarizeDebugData,
  summarizeRequestForDebug,
  summarizeTabForDebug,
  summarizeWindowForDebug
} from "./debug-dump.js";
import {
  disableFocusEmulationForRequest,
  enableFocusEmulation,
  getFocusEmulationDebugState,
  setFocusEmulationDetachHandler
} from "./focus-emulation.js";

const CHATGPT_HOME_URL = "https://chatgpt.com/";
const EXTENSION_NAME = chrome.runtime.getManifest().name;
const CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
const CONTENT_SCRIPT_FILE = "content/chatgpt-automation.js";
const PANEL_STATE_KEY = "panelState";
const REPAIR_SETTINGS_KEY = "adapterRepairSettings";
const AUTOMATION_WINDOW_STATE_KEY = "chatGptAutomationWindowState";
const LAST_SOURCE_TAB_KEY = "lastSourceTab";
const HISTORY_LIMIT = 20;
const EVENT_LIMIT = 100;
const CHATGPT_LOAD_TIMEOUT_MS = 30000;

const storageArea = chrome.storage.session || chrome.storage.local;
let panelStateWriteQueue = Promise.resolve();

setFocusEmulationDetachHandler((event) => {
  void handleFocusEmulationDetached(event);
});

chrome.runtime.onInstalled.addListener(() => {
  void createContextMenus();
});

chrome.runtime.onStartup?.addListener(() => {
  void createContextMenus();
});

chrome.action.onClicked.addListener((tab) => {
  void openSidePanel(tab?.id);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleContextMenuClick(info, tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  handleRuntimeMessage(message, sender)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((error) => {
      console.error("ChatGPT relay background error", error);
      sendResponse({
        ok: false,
        error: serializeError(error)
      });
    });

  return true;
});

async function createContextMenus() {
  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));

  for (const profile of Object.values(REQUEST_PROFILES)) {
    if (profile.inputKind !== "selection" || !profile.contextMenuTitle) {
      continue;
    }

    chrome.contextMenus.create({
      id: `profile:${profile.id}`,
      title: profile.contextMenuTitle,
      contexts: ["selection"]
    });
  }
}

async function handleContextMenuClick(info, tab) {
  if (!info.menuItemId || !String(info.menuItemId).startsWith("profile:")) {
    return;
  }

  const profileId = String(info.menuItemId).slice("profile:".length);
  const selectedText = normalizeText(info.selectionText);

  await openSidePanel(tab?.id);

  const { requestId } = await startRequest({
    profileId,
    sourceTab: tab,
    selectedText
  });

  await updateRequest(requestId, (request) => {
    appendEvent(request, "Context menu request created.");
  });
}

async function handleRuntimeMessage(message, sender) {
  switch (message.type) {
    case "GET_PROFILES":
      return {
        profiles: getPublicProfiles()
      };

    case "GET_PANEL_STATE":
      return {
        panelState: await getPanelState()
      };

    case "RUN_MANUAL_REQUEST":
      return startManualRequest(message);

    case "RUN_SCREENSHOT_REQUEST":
      return startScreenshotRequest(message);

    case "RUN_FOLLOWUP_REQUEST":
      return startFollowupRequest(message);

    case "RETRY_REQUEST":
      return retryRequest(message);

    case "CANCEL_REQUEST":
      return cancelRequest(message.requestId);

    case "OPEN_CHATGPT_TAB":
      return openChatGptTabForRequest(message.requestId);

    case "GET_LOCAL_REPAIR_SETTINGS":
      return {
        settings: await getRepairSettings()
      };

    case "SET_LOCAL_REPAIR_SETTINGS":
      return setRepairSettings(message.settings);

    case "GET_CHATGPT_AUTOMATION_SETTINGS":
      return {
        settings: await getAutomationSettings()
      };

    case "SET_CHATGPT_AUTOMATION_SETTINGS":
      return setAutomationSettings(message.settings);

    case "DUMP_DEBUG":
      return dumpDebugState(message.requestId);

    case "CHATGPT_AUTOMATION_DEBUG":
      await handleAutomationDebug(message, sender);
      return {};

    case "CHATGPT_AUTOMATION_EVENT":
      await handleAutomationEvent(message, sender);
      return {};

    default:
      throw new Error(`Unsupported message type: ${message.type}`);
  }
}

async function startManualRequest(message) {
  const profileId = message.profileId || "custom_text";
  const profile = getProfile(profileId);

  if (profile.inputKind !== "manual_text" && profile.inputKind !== "selection") {
    throw new Error(`Profile ${profileId} cannot be used with manual text.`);
  }

  const sourceTab = await queryBestSourceTab();
  const manualText = normalizeText(message.text);
  const selectedText = profile.inputKind === "selection" ? manualText : "";

  return startRequest({
    profileId,
    sourceTab,
    manualText,
    selectedText
  });
}

async function startScreenshotRequest(message) {
  const sourceTab = await queryBestSourceTab();

  if (!sourceTab?.windowId) {
    throw new Error("No source tab is available for screenshot capture.");
  }

  const screenshot = await captureVisibleTabScreenshot(sourceTab.windowId);

  return startRequest({
    profileId: "visible_screenshot",
    sourceTab,
    manualText: normalizeText(message.prompt),
    attachments: [screenshot]
  });
}

async function startFollowupRequest(message) {
  const existing = await getRequest(message.requestId);

  if (!existing) {
    throw new Error("Request not found.");
  }

  if (!existing.chatTabId) {
    throw new Error("The request does not have an associated ChatGPT tab for follow-up.");
  }

  const manualText = normalizeText(message.text);

  if (!manualText) {
    throw new Error("Follow-up prompt is empty.");
  }

  return startRequest({
    profileId: "custom_text",
    sourceTab: existing.source,
    manualText,
    preferredChatTabId: existing.chatTabId,
    chatOptionsOverride: {
      project: {
        enabled: false
      },
      conversation: {
        startNewChat: false
      },
      model: {
        enabled: false
      }
    }
  });
}

async function retryRequest(message) {
  const existing = await getRequest(message.requestId);

  if (!existing) {
    throw new Error("Request not found.");
  }

  const attachments = await restoreAttachmentPayloads(existing);
  const adapterHints = message.useRepairHints && existing.repairSuggestions
    ? existing.repairSuggestions.hints
    : [];

  const retry = await startRequest({
    profileId: existing.profileId,
    sourceTab: existing.source,
    selectedText: existing.selectedText,
    manualText: existing.manualText,
    attachments,
    adapterHints,
    preferredChatTabId: existing.chatTabId || null
  });

  await updateRequest(retry.requestId, (request) => {
    appendEvent(request, `Retry created from ${existing.id}.`);
  });

  return retry;
}

async function cancelRequest(requestId) {
  const request = await getRequest(requestId);

  if (!request) {
    throw new Error("Request not found.");
  }

  if (request.chatTabId) {
    await sendMessageToTab(request.chatTabId, {
      type: "CHATGPT_AUTOMATION_CANCEL",
      requestId
    }).catch(() => null);
  }

  await disableFocusEmulationForRequest(requestId).catch(() => null);

  await updateRequest(requestId, (draft) => {
    draft.state = REQUEST_STATES.ERROR_STATE;
    draft.error = "Cancelled by user.";
    draft.completedAt = new Date().toISOString();
    appendEvent(draft, "Request cancelled.");
  });

  return {};
}

async function openChatGptTabForRequest(requestId) {
  const request = requestId ? await getRequest(requestId) : null;
  const sourceFocus = getSourceFocusTarget(request?.source);
  const tabId = request?.chatTabId || (await findOrCreateChatGptTab({ sourceFocus })).id;

  await chrome.tabs.update(tabId, {
    active: true
  });

  return {
    tabId
  };
}

async function startRequest({
  profileId,
  sourceTab,
  selectedText = "",
  manualText = "",
  attachments = [],
  adapterHints = [],
  preferredChatTabId = null,
  chatOptionsOverride = null
}) {
  await rememberSourceTab(sourceTab);

  const prompt = buildPromptForProfile(profileId, {
    selectedText,
    manualText,
    attachments
  });
  const requestId = createRequestId();
  const request = createRequestRecord({
    id: requestId,
    profileId,
    sourceTab,
    selectedText,
    manualText,
    prompt,
    attachments
  });

  await storeAttachmentPayloads(requestId, attachments);
  await putRequest(request);
  await updateRequest(requestId, (draft) => {
    draft.state = REQUEST_STATES.SELECTED_TEXT_RECEIVED;
    appendEvent(draft, "Request accepted by background worker.");
  });
  await openSidePanel(getTabId(sourceTab));

  void orchestrateRequest(requestId, {
    attachments,
    adapterHints,
    preferredChatTabId,
    chatOptionsOverride
  });

  return {
    requestId
  };
}

async function orchestrateRequest(requestId, {
  attachments = [],
  adapterHints = [],
  preferredChatTabId = null,
  chatOptionsOverride = null
} = {}) {
  try {
    const request = await getRequest(requestId);

    if (!request) {
      throw new Error("Request disappeared before orchestration started.");
    }

    const automationSettings = mergeAutomationSettings(
      await getAutomationSettings(),
      chatOptionsOverride,
      EXTENSION_NAME
    );
    const visibility = automationSettings.visibility;
    const sourceFocus = getSourceFocusTarget(request.source);
    const discoveredChatTab = preferredChatTabId
      ? await getUsableChatGptTab(preferredChatTabId, {
        sourceFocus,
        visibility
      })
      : await findOrCreateChatGptTab({
        sourceFocus,
        visibility
      });
    const chatTab = await prepareAutomationTab(discoveredChatTab);

    await updateRequest(requestId, (draft) => {
      draft.chatTabId = chatTab.id;
      draft.automationVisibilityMode = getVisibilityMode(visibility);
      draft.state = REQUEST_STATES.CHATGPT_TAB_READY;
      appendEvent(draft, `Using ChatGPT tab ${chatTab.id}.`);
    });

    if (usesFocusEmulation(visibility)) {
      await enableFocusEmulation({
        tabId: chatTab.id,
        requestId
      });
      await updateRequest(requestId, (draft) => {
        appendEvent(draft, "Chrome debugger focus emulation enabled for seamless ChatGPT streaming.");
      });
    }

    await injectAutomationScript(chatTab.id);

    if (usesSidecarWindow(visibility) && !usesFocusedAutomation(visibility)) {
      await restoreSourceFocus(sourceFocus, chatTab.windowId);
    }

    const response = await sendMessageToTab(chatTab.id, {
      type: "CHATGPT_AUTOMATION_RUN",
      request: {
        id: request.id,
        profileId: request.profileId,
        prompt: request.prompt,
        attachments,
        adapterHints,
        chatOptions: automationSettings
      }
    });

    if (!response?.accepted) {
      throw new Error(response?.error || "ChatGPT automation script did not accept the request.");
    }

    if (usesSidecarWindow(visibility) && !usesFocusedAutomation(visibility)) {
      await restoreSourceFocus(sourceFocus, chatTab.windowId);
    }
  } catch (error) {
    await disableFocusEmulationForRequest(requestId).catch(() => null);
    await markRequestError(requestId, error);
  }
}

async function prepareAutomationTab(tab) {
  if (!tab?.id) {
    return tab;
  }

  await chrome.tabs.update(tab.id, {
    autoDiscardable: false
  }).catch(() => null);

  return chrome.tabs.get(tab.id).catch(() => tab);
}

async function findOrCreateChatGptTab({ sourceFocus, visibility } = {}) {
  if (usesSidecarWindow(visibility)) {
    return findOrCreateVisibleChatGptTab({
      sourceFocus,
      visibility
    });
  }

  return findOrCreateSeamlessChatGptTab({
    sourceFocus
  });
}

async function findOrCreateSeamlessChatGptTab({ sourceFocus } = {}) {
  const sourceWindowId = sourceFocus?.windowId || null;
  const rememberedTab = await findRememberedChatGptTab();

  if (rememberedTab) {
    const usableRememberedTab = await getAvailableChatGptTab([rememberedTab]);

    if (usableRememberedTab) {
      console.info("[ChatGPT Relay] Reusing seamless ChatGPT automation tab", {
        tabId: usableRememberedTab.id,
        windowId: usableRememberedTab.windowId,
        sourceWindowId
      });
      return usableRememberedTab;
    }
  }

  const tabs = await chrome.tabs.query({});
  const existingTab = await getAvailableChatGptTab(
    tabs
      .filter((tab) => isChatGptUrl(tab.url || tab.pendingUrl || ""))
      .sort((a, b) => scoreChatTab(b, sourceWindowId) - scoreChatTab(a, sourceWindowId))
  );

  if (existingTab) {
    console.info("[ChatGPT Relay] Reusing existing ChatGPT tab for seamless automation", {
      tabId: existingTab.id,
      windowId: existingTab.windowId,
      sourceWindowId
    });
    return existingTab;
  }

  const createOptions = {
    url: CHATGPT_HOME_URL,
    active: false
  };

  if (sourceWindowId) {
    createOptions.windowId = sourceWindowId;
  }

  const created = await chrome.tabs.create(createOptions);
  console.info("[ChatGPT Relay] Created inactive ChatGPT tab for seamless automation", {
    tabId: created.id,
    windowId: created.windowId,
    sourceWindowId
  });

  return waitForTabToLoad(created.id, CHATGPT_LOAD_TIMEOUT_MS);
}

async function findOrCreateVisibleChatGptTab({ sourceFocus, visibility }) {
  const sourceWindowId = sourceFocus?.windowId || null;
  const rememberedTab = await findRememberedChatGptTab({
    excludeWindowId: sourceWindowId
  });

  if (rememberedTab) {
    console.info("[ChatGPT Relay] Reusing visible ChatGPT automation tab", {
      tabId: rememberedTab.id,
      windowId: rememberedTab.windowId,
      sourceWindowId
    });
    return ensureChatGptTabVisible(rememberedTab, {
      sourceFocus,
      visibility
    });
  }

  const tabs = await chrome.tabs.query({});
  const existingAutomationTab = tabs
    .filter((tab) => {
      if (!isChatGptUrl(tab.url || tab.pendingUrl || "")) {
        return false;
      }

      return !sourceWindowId || tab.windowId !== sourceWindowId;
    })
    .sort((a, b) => scoreChatTab(b, sourceWindowId) - scoreChatTab(a, sourceWindowId))[0];

  if (existingAutomationTab) {
    console.info("[ChatGPT Relay] Reusing existing ChatGPT tab outside source window", {
      tabId: existingAutomationTab.id,
      windowId: existingAutomationTab.windowId,
      sourceWindowId
    });
    return ensureChatGptTabVisible(existingAutomationTab, {
      sourceFocus,
      visibility
    });
  }

  return createVisibleAutomationWindow({
    sourceFocus,
    visibility
  });
}

async function createVisibleAutomationWindow({ sourceFocus, visibility }) {
  const sourceWindowId = sourceFocus?.windowId || null;
  const sourceWindow = sourceFocus?.windowId
    ? await chrome.windows.get(sourceFocus.windowId).catch(() => null)
    : null;
  const width = visibility?.windowWidth || 520;
  const height = visibility?.windowHeight || 760;
  const focused = usesFocusedAutomation(visibility);
  const createOptions = {
    url: CHATGPT_HOME_URL,
    type: "popup",
    focused,
    width,
    height,
    state: "normal"
  };

  if (sourceWindow && Number.isFinite(sourceWindow.left) && Number.isFinite(sourceWindow.width)) {
    createOptions.left = Math.max(0, sourceWindow.left + sourceWindow.width - width - 24);
  }

  if (sourceWindow && Number.isFinite(sourceWindow.top)) {
    createOptions.top = Math.max(0, sourceWindow.top + 64);
  }

  const createdWindow = await chrome.windows.create(createOptions);
  const createdTab = createdWindow.tabs?.[0];

  if (!createdTab?.id) {
    throw new Error("Chrome did not return a tab for the ChatGPT automation window.");
  }

  await setAutomationWindowState({
    windowId: createdWindow.id,
    tabId: createdTab.id
  });
  console.info("[ChatGPT Relay] Created visible ChatGPT automation window", {
    tabId: createdTab.id,
    windowId: createdWindow.id,
    sourceWindowId,
    focused
  });
  if (!focused) {
    await restoreSourceFocus(sourceFocus, createdWindow.id);
  }

  const loadedTab = await waitForTabToLoad(createdTab.id, CHATGPT_LOAD_TIMEOUT_MS);

  if (!focused) {
    await restoreSourceFocus(sourceFocus, loadedTab.windowId);
  }

  return loadedTab;
}

async function ensureChatGptTabVisible(tab, { sourceFocus, visibility }) {
  if (sourceFocus?.windowId && tab.windowId === sourceFocus.windowId) {
    console.info("[ChatGPT Relay] ChatGPT tab is in source window; creating dedicated automation window instead", {
      tabId: tab.id,
      sourceWindowId: sourceFocus.windowId
    });
    return createVisibleAutomationWindow({
      sourceFocus,
      visibility
    });
  }

  const window = await chrome.windows.get(tab.windowId).catch(() => null);

  if (window?.state === "minimized") {
    await chrome.windows.update(tab.windowId, {
      state: "normal"
    }).catch(() => null);
  }

  if (visibility?.windowWidth || visibility?.windowHeight) {
    await chrome.windows.update(tab.windowId, {
      width: visibility.windowWidth,
      height: visibility.windowHeight
    }).catch(() => null);
  }

  await chrome.tabs.update(tab.id, {
    active: true
  });

  if (usesFocusedAutomation(visibility)) {
    await chrome.windows.update(tab.windowId, {
      focused: true
    }).catch(() => null);
  }

  await setAutomationWindowState({
    windowId: tab.windowId,
    tabId: tab.id
  });
  if (!usesFocusedAutomation(visibility)) {
    await restoreSourceFocus(sourceFocus, tab.windowId);
  }

  const updatedTab = await chrome.tabs.get(tab.id);

  if (!usesFocusedAutomation(visibility)) {
    await restoreSourceFocus(sourceFocus, updatedTab.windowId);
  }

  return updatedTab;
}

async function restoreSourceFocus(sourceFocus, automationWindowId) {
  if (!sourceFocus?.windowId || sourceFocus.windowId === automationWindowId) {
    return;
  }

  await focusSourceTarget(sourceFocus);
  await sleep(120);
  await focusSourceTarget(sourceFocus);
}

async function focusSourceTarget(sourceFocus) {
  if (sourceFocus.tabId) {
    await chrome.tabs.update(sourceFocus.tabId, {
      active: true
    }).catch(() => null);
  }

  await chrome.windows.update(sourceFocus.windowId, {
    focused: true
  }).catch(() => null);
}

async function getUsableChatGptTab(tabId, { sourceFocus, visibility } = {}) {
  try {
    const tab = await chrome.tabs.get(tabId);

    if (isChatGptUrl(tab.url || tab.pendingUrl || "")) {
      if (usesSeamlessAutomation(visibility)) {
        return ensureChatGptTabLoaded(tab);
      }

      if (usesSidecarWindow(visibility) && sourceFocus?.windowId && tab.windowId === sourceFocus.windowId) {
        console.info("[ChatGPT Relay] Preferred ChatGPT tab is in source window; using dedicated automation window instead", {
          tabId: tab.id,
          sourceWindowId: sourceFocus.windowId
        });
        return findOrCreateVisibleChatGptTab({
          sourceFocus,
          visibility
        });
      }

      return ensureChatGptTabVisible(tab, {
        sourceFocus,
        visibility
      });
    }
  } catch (_error) {
    // Fall through to regular discovery.
  }

  return findOrCreateChatGptTab({
    sourceFocus,
    visibility
  });
}

async function getChatGptTabOrNull(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);

    return isChatGptUrl(tab.url || tab.pendingUrl || "") ? tab : null;
  } catch (_error) {
    return null;
  }
}

async function getAutomationWindowState() {
  const result = await chrome.storage.local.get(AUTOMATION_WINDOW_STATE_KEY);

  return result[AUTOMATION_WINDOW_STATE_KEY] || null;
}

async function setAutomationWindowState(state) {
  await chrome.storage.local.set({
    [AUTOMATION_WINDOW_STATE_KEY]: state
  });
}

async function findRememberedChatGptTab({ excludeWindowId = null } = {}) {
  const stored = await getAutomationWindowState();

  if (stored?.tabId) {
    const storedTab = await getChatGptTabOrNull(stored.tabId);

    if (storedTab && (!excludeWindowId || storedTab.windowId !== excludeWindowId)) {
      return storedTab;
    }
  }

  const panelState = await getPanelState();
  const recentChatTabIds = panelState.requests
    .map((request) => request.chatTabId)
    .filter(Boolean);

  for (const tabId of recentChatTabIds) {
    const tab = await getChatGptTabOrNull(tabId);

    if (tab && (!excludeWindowId || tab.windowId !== excludeWindowId)) {
      return tab;
    }
  }

  return null;
}

async function getAvailableChatGptTab(candidates) {
  for (const tab of candidates) {
    const loadedTab = await ensureChatGptTabLoaded(tab);
    const probe = await probeChatGptTab(loadedTab.id);

    if (probe.ok && !probe.busy) {
      return loadedTab;
    }
  }

  return null;
}

async function ensureChatGptTabLoaded(tab) {
  if (tab.discarded) {
    await chrome.tabs.reload(tab.id).catch(() => null);
    return waitForTabToLoad(tab.id, CHATGPT_LOAD_TIMEOUT_MS);
  }

  if (tab.status !== "complete") {
    return waitForTabToLoad(tab.id, CHATGPT_LOAD_TIMEOUT_MS);
  }

  return tab;
}

async function probeChatGptTab(tabId) {
  try {
    await injectAutomationScript(tabId);
    const response = await sendMessageToTab(tabId, {
      type: "CHATGPT_AUTOMATION_PING"
    });

    return {
      ok: Boolean(response?.ok),
      busy: Boolean(response?.busy)
    };
  } catch (_error) {
    return {
      ok: false,
      busy: false
    };
  }
}

async function waitForTabToLoad(tabId, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);

    if (isChatGptUrl(tab.url || tab.pendingUrl || "") && tab.status === "complete") {
      return tab;
    }

    await sleep(300);
  }

  return chrome.tabs.get(tabId);
}

async function injectAutomationScript(tabId) {
  await chrome.scripting.executeScript({
    target: {
      tabId
    },
    files: [CONTENT_SCRIPT_FILE]
  });
}

async function handleAutomationEvent(message, sender) {
  const requestId = message.requestId;

  if (!requestId) {
    return;
  }

  console.debug("[ChatGPT Relay] Automation event", {
    requestId,
    tabId: sender.tab?.id || null,
    state: message.state || null,
    textLength: typeof message.text === "string" ? message.text.length : null,
    htmlLength: typeof message.html === "string" ? message.html.length : null,
    detail: message.detail || null
  });

  await updateRequest(requestId, (draft) => {
    if (sender.tab?.id) {
      draft.chatTabId = sender.tab.id;
    }

    if (message.state) {
      draft.state = message.state;
    }

    if (typeof message.text === "string") {
      draft.responseText = message.text;
    }

    if (typeof message.html === "string") {
      draft.responseHtml = message.html;
    }

    if (message.error) {
      draft.error = message.error;
    }

    if (message.state === REQUEST_STATES.RESPONSE_COMPLETE) {
      draft.completedAt = new Date().toISOString();
    }

    if (message.state === REQUEST_STATES.ERROR_STATE) {
      draft.completedAt = new Date().toISOString();
    }

    appendEvent(draft, message.detail || message.state || "Automation event received.");
  });

  if (sender.tab?.id && isChatGptUrl(sender.tab.url || sender.tab.pendingUrl || "")) {
    await setAutomationWindowState({
      windowId: sender.tab.windowId,
      tabId: sender.tab.id
    });
  }

  if (
    message.state === REQUEST_STATES.RESPONSE_COMPLETE
    || message.state === REQUEST_STATES.ERROR_STATE
  ) {
    const request = await getRequest(requestId);
    const settings = await getAutomationSettings();
    const requestVisibilityMode = request?.automationVisibilityMode || getVisibilityMode(settings.visibility);

    await disableFocusEmulationForRequest(requestId).catch(() => null);

    if (requestVisibilityMode === VISIBILITY_MODES.FOCUSED) {
      await restoreSourceFocus(getSourceFocusTarget(request?.source), sender.tab?.windowId);
    }
  }

  if (message.state === REQUEST_STATES.ERROR_STATE && message.domSnapshot) {
    await maybeRequestLocalAdapterRepair(requestId, message);
  }
}

async function handleFocusEmulationDetached({ requestId, reason }) {
  const request = await getRequest(requestId).catch(() => null);

  if (!request || request.completedAt || request.state === REQUEST_STATES.RESPONSE_COMPLETE || request.state === REQUEST_STATES.ERROR_STATE) {
    return;
  }

  await markRequestError(
    requestId,
    new Error(`Chrome debugger focus emulation detached (${reason}). Seamless ChatGPT streaming cannot continue while the ChatGPT page is hidden. Close DevTools for the ChatGPT tab and retry, or switch routing mode to Focus ChatGPT.`)
  );
}

async function handleAutomationDebug(message, sender) {
  const requestId = message.requestId || null;
  const stage = message.stage || "debug";

  console.debug("[ChatGPT Relay] Content debug", {
    requestId,
    tabId: sender.tab?.id || null,
    stage,
    data: message.data || null
  });

  if (!requestId) {
    return;
  }

  if (stage === "stream-update") {
    return;
  }

  await updateRequest(requestId, (draft) => {
    appendEvent(draft, `Debug ${stage}: ${summarizeDebugData(message.data)}`);
  }).catch(() => null);
}

async function dumpDebugState(requestId) {
  const panelState = await getPanelState();
  const request = requestId
    ? panelState.requests.find((item) => item.id === requestId)
    : panelState.requests.find((item) => item.id === panelState.activeRequestId) || panelState.requests[0] || null;
  const settings = await getAutomationSettings();
  const repairSettings = await getRepairSettings();
  const automationWindowState = await getAutomationWindowState();
  const tabs = await chrome.tabs.query({});
  const windows = await chrome.windows.getAll({
    populate: true
  });
  const sourceWindowId = getSourceFocusTarget(request?.source)?.windowId || null;
  const fallbackChatTab = tabs
    .filter((tab) => isChatGptUrl(tab.url || tab.pendingUrl || ""))
    .sort((a, b) => scoreChatTab(b, sourceWindowId) - scoreChatTab(a, sourceWindowId))[0] || null;
  const contentDumpCandidates = [
    request?.chatTabId,
    automationWindowState?.tabId,
    fallbackChatTab?.id
  ].filter((tabId, index, values) => tabId && values.indexOf(tabId) === index);
  const contentDumpResult = await collectContentDebugDump(contentDumpCandidates);
  const dump = {
    createdAt: new Date().toISOString(),
    extension: {
      id: chrome.runtime.id,
      name: EXTENSION_NAME,
      version: chrome.runtime.getManifest().version
    },
    settings,
    repairSettings,
    panelState: {
      activeRequestId: panelState.activeRequestId,
      requestCount: panelState.requests.length
    },
    request: request ? summarizeRequestForDebug(request) : null,
    automationWindowState,
    focusEmulation: getFocusEmulationDebugState(),
    contentDumpTabId: contentDumpResult.tabId,
    tabs: tabs.map(summarizeTabForDebug),
    windows: windows.map(summarizeWindowForDebug),
    contentDump: contentDumpResult.dump
  };

  console.log("[ChatGPT Relay] Debug dump", dump);

  return {
    dump
  };
}

async function collectContentDebugDump(tabIds) {
  let lastFailure = null;

  for (const tabId of tabIds) {
    await injectAutomationScript(tabId).catch(() => null);

    const dump = await sendMessageToTab(tabId, {
      type: "CHATGPT_AUTOMATION_DUMP"
    }).catch((error) => {
      lastFailure = {
        ok: false,
        error: serializeError(error)
      };
      return null;
    });

    if (dump) {
      return {
        tabId,
        dump
      };
    }
  }

  return {
    tabId: null,
    dump: lastFailure
  };
}

async function maybeRequestLocalAdapterRepair(requestId, message) {
  const settings = await getRepairSettings();

  if (!settings.enabled) {
    return;
  }

  await updateRequest(requestId, (draft) => {
    appendEvent(draft, "Requesting local DOM adapter repair suggestions.");
  });

  try {
    const suggestions = await requestAdapterRepair({
      snapshot: message.domSnapshot,
      failure: message.error || message.detail,
      settings
    });

    await updateRequest(requestId, (draft) => {
      draft.repairSuggestions = {
        hints: suggestions.hints,
        warnings: suggestions.warnings,
        createdAt: new Date().toISOString()
      };
      appendEvent(draft, `Local repair returned ${suggestions.hints.length} validated hint(s).`);
    });
  } catch (error) {
    await updateRequest(requestId, (draft) => {
      appendEvent(draft, `Local repair failed: ${serializeError(error)}`);
    });
  }
}

async function markRequestError(requestId, error) {
  await updateRequest(requestId, (draft) => {
    draft.state = REQUEST_STATES.ERROR_STATE;
    draft.error = serializeError(error);
    draft.completedAt = new Date().toISOString();
    appendEvent(draft, `Error: ${draft.error}`);
  });
}

async function queryBestSourceTab() {
  const [lastFocusedTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  if (isUsableSourceTab(lastFocusedTab)) {
    return lastFocusedTab;
  }

  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (isUsableSourceTab(activeTab)) {
    return activeTab;
  }

  return getRememberedSourceTab();
}

async function rememberSourceTab(tab) {
  if (!isUsableSourceTab(tab)) {
    return;
  }

  await storageArea.set({
    [LAST_SOURCE_TAB_KEY]: {
      tabId: tab.id,
      windowId: tab.windowId,
      title: tab.title || "",
      url: tab.url || ""
    }
  });
}

async function getRememberedSourceTab() {
  const result = await storageArea.get(LAST_SOURCE_TAB_KEY);
  const remembered = result[LAST_SOURCE_TAB_KEY];

  if (!remembered?.tabId) {
    return null;
  }

  try {
    const tab = await chrome.tabs.get(remembered.tabId);

    return isUsableSourceTab(tab) ? tab : null;
  } catch (_error) {
    return null;
  }
}

function getSourceFocusTarget(source) {
  return {
    tabId: source?.tabId ?? source?.id ?? null,
    windowId: source?.windowId ?? null
  };
}

function isUsableSourceTab(tab) {
  const url = tab?.url || tab?.pendingUrl || "";

  return Boolean(tab?.id && tab?.windowId && url && !isExtensionUrl(url) && !isChatGptUrl(url));
}

async function captureVisibleTabScreenshot(windowId) {
  let dataUrl;

  try {
    dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "png"
    });
  } catch (error) {
    throw new Error(`Visible screenshot capture failed. Chrome usually requires a recent extension gesture for page capture. ${serializeError(error)}`);
  }

  const sizeBytes = Math.ceil((dataUrl.length * 3) / 4);

  return {
    id: createRequestId(),
    kind: "image",
    name: `visible-tab-${Date.now()}.png`,
    mimeType: "image/png",
    dataUrl,
    sizeBytes
  };
}

async function storeAttachmentPayloads(requestId, attachments) {
  if (!attachments.length) {
    return;
  }

  await storageArea.set({
    [`attachments:${requestId}`]: attachments
  });
}

async function restoreAttachmentPayloads(request) {
  if (!request?.attachments?.length) {
    return [];
  }

  const result = await storageArea.get(`attachments:${request.id}`);

  return result[`attachments:${request.id}`] || [];
}

async function putRequest(request) {
  const panelState = await getPanelState();
  const nextRequests = [
    request,
    ...panelState.requests.filter((item) => item.id !== request.id)
  ].slice(0, HISTORY_LIMIT);

  await setPanelState({
    activeRequestId: request.id,
    requests: nextRequests
  });
}

async function updateRequest(requestId, mutator) {
  const nextWrite = panelStateWriteQueue.then(() => updateRequestImmediately(requestId, mutator));
  panelStateWriteQueue = nextWrite.catch(() => null);

  return nextWrite;
}

async function updateRequestImmediately(requestId, mutator) {
  const panelState = await getPanelState();
  const index = panelState.requests.findIndex((request) => request.id === requestId);

  if (index === -1) {
    throw new Error(`Request not found: ${requestId}`);
  }

  const request = structuredClone(panelState.requests[index]);
  mutator(request);
  request.updatedAt = new Date().toISOString();

  const requests = [...panelState.requests];
  requests[index] = request;

  await setPanelState({
    ...panelState,
    requests
  });
}

async function getRequest(requestId) {
  const panelState = await getPanelState();

  return panelState.requests.find((request) => request.id === requestId) || null;
}

async function getPanelState() {
  const result = await storageArea.get(PANEL_STATE_KEY);

  return normalizePanelState(result[PANEL_STATE_KEY]);
}

async function setPanelState(panelState) {
  const normalized = normalizePanelState(panelState);

  await storageArea.set({
    [PANEL_STATE_KEY]: normalized
  });

  await broadcastPanelState(normalized);
}

function normalizePanelState(value) {
  if (!value || typeof value !== "object") {
    return {
      activeRequestId: null,
      requests: []
    };
  }

  const requests = Array.isArray(value.requests)
    ? value.requests.slice(0, HISTORY_LIMIT)
    : [];
  const activeRequestId = value.activeRequestId && requests.some((request) => request.id === value.activeRequestId)
    ? value.activeRequestId
    : requests[0]?.id || null;

  return {
    activeRequestId,
    requests
  };
}

async function broadcastPanelState(panelState) {
  await chrome.runtime.sendMessage({
    type: "PANEL_STATE_UPDATED",
    panelState
  }).catch(() => null);
}

function appendEvent(request, detail) {
  request.events = [
    ...(Array.isArray(request.events) ? request.events : []),
    {
      at: new Date().toISOString(),
      detail
    }
  ].slice(-EVENT_LIMIT);
}

async function openSidePanel(tabId) {
  if (!tabId || !chrome.sidePanel?.open) {
    return;
  }

  await chrome.sidePanel.open({
    tabId
  }).catch(() => null);
}

async function setRepairSettings(settings) {
  const sanitized = sanitizeRepairSettings(settings);

  await chrome.storage.local.set({
    [REPAIR_SETTINGS_KEY]: sanitized
  });

  return {
    settings: sanitized
  };
}

async function getRepairSettings() {
  const result = await chrome.storage.local.get(REPAIR_SETTINGS_KEY);

  return sanitizeRepairSettings(result[REPAIR_SETTINGS_KEY] || DEFAULT_REPAIR_SETTINGS);
}

async function setAutomationSettings(settings) {
  const sanitized = sanitizeAutomationSettings(settings, EXTENSION_NAME);

  await chrome.storage.local.set({
    [AUTOMATION_SETTINGS_KEY]: sanitized
  });

  return {
    settings: sanitized
  };
}

async function getAutomationSettings() {
  const result = await chrome.storage.local.get(AUTOMATION_SETTINGS_KEY);

  return sanitizeAutomationSettings(
    result[AUTOMATION_SETTINGS_KEY] || getDefaultAutomationSettings(EXTENSION_NAME),
    EXTENSION_NAME
  );
}

async function sendMessageToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

function scoreChatTab(tab, sourceWindowId) {
  let score = 0;

  if (sourceWindowId && tab.windowId === sourceWindowId) {
    score += 100;
  }

  if (tab.active) {
    score += 10;
  }

  if (!tab.discarded) {
    score += 5;
  }

  return score;
}

function getVisibilityMode(visibility) {
  switch (visibility?.mode) {
    case VISIBILITY_MODES.SIDECAR:
    case VISIBILITY_MODES.FOCUSED:
    case VISIBILITY_MODES.SEAMLESS:
      return visibility.mode;
    default:
      return VISIBILITY_MODES.SEAMLESS;
  }
}

function usesSeamlessAutomation(visibility) {
  return getVisibilityMode(visibility) === VISIBILITY_MODES.SEAMLESS;
}

function usesSidecarWindow(visibility) {
  const mode = getVisibilityMode(visibility);

  return mode === VISIBILITY_MODES.SIDECAR || mode === VISIBILITY_MODES.FOCUSED;
}

function usesFocusedAutomation(visibility) {
  return getVisibilityMode(visibility) === VISIBILITY_MODES.FOCUSED;
}

function usesFocusEmulation(visibility) {
  const mode = getVisibilityMode(visibility);

  return mode === VISIBILITY_MODES.SEAMLESS || mode === VISIBILITY_MODES.SIDECAR;
}

function isChatGptUrl(value) {
  try {
    const url = new URL(value);

    return url.protocol === "https:" && CHATGPT_HOSTS.has(url.hostname);
  } catch (_error) {
    return false;
  }
}

function isExtensionUrl(value) {
  return value.startsWith(`chrome-extension://${chrome.runtime.id}/`);
}

function getTabId(tabLike) {
  return tabLike?.id ?? tabLike?.tabId ?? null;
}

function serializeError(error) {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
