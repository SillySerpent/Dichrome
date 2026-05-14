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
  getVisibilityMode,
  mergeAutomationSettings,
  sanitizeAutomationSettings,
  usesFocusedAutomation,
  usesFocusEmulation,
  usesHiddenAutomation,
  usesSidecarWindow
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
import {
  clearAutomationRequestActive,
  clearAutomationTabIfMatches,
  getAutomationSession,
  markAutomationRequestActive,
  summarizeAutomationSession,
  updateSessionConversation
} from "./automation/session.js";
import {
  probeOffscreenAutomationTarget
} from "./automation/offscreen-target.js";
import {
  findOrCreateChatGptTab,
  getAutomationTargetType,
  getAutomationWindowState,
  getUsableChatGptTab,
  navigateTabToConversation,
  prepareAutomationTab,
  resolvePreferredAutomationTabId,
  setAutomationWindowState
} from "./automation/tab-target.js";
import {
  CHATGPT_CONTENT_SCRIPT_FILES,
  REPAIR_SETTINGS_KEY,
  getTabId,
  isChatGptUrl,
  serializeError
} from "./constants.js";
import {
  appendEvent,
  getPanelState,
  getRequest,
  putRequest,
  restoreAttachmentPayloads,
  storeAttachmentPayloads,
  updateRequest
} from "./requests/store.js";
import {
  captureVisibleTabScreenshot,
  getSourceFocusTarget,
  queryBestSourceTab,
  rememberSourceTab,
  restoreSourceFocus
} from "./automation/source-focus.js";

const EXTENSION_NAME = chrome.runtime.getManifest().name;

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

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearAutomationTabIfMatches(tabId);
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
        settings: await getPublicAutomationSettings()
      };

    case "GET_AUTOMATION_SESSION":
      return {
        automationSession: summarizeAutomationSession(await getAutomationSession())
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

  const manualText = normalizeText(message.text);

  if (!manualText) {
    throw new Error("Follow-up prompt is empty.");
  }

  if (!existing.chatConversationUrl && !existing.chatTabId) {
    throw new Error("The previous request does not have a saved ChatGPT conversation for follow-up.");
  }

  return startRequest({
    profileId: "custom_text",
    sourceTab: existing.source,
    manualText,
    parentRequestId: existing.id,
    conversationMode: "followup",
    expectedConversationUrl: existing.chatConversationUrl || null,
    expectedConversationKey: existing.chatConversationKey || null,
    preferredChatTabId: existing.chatTabId || null,
    chatOptionsOverride: {
      project: {
        enabled: false
      },
      conversation: {
        mode: "continue",
        startNewChat: false,
        expectedConversationUrl: existing.chatConversationUrl || null
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
    parentRequestId: existing.parentRequestId || null,
    conversationMode: existing.conversationMode || "new",
    expectedConversationUrl: existing.conversationMode === "followup" ? existing.chatConversationUrl || null : null,
    expectedConversationKey: existing.conversationMode === "followup" ? existing.chatConversationKey || null : null,
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
  chatOptionsOverride = null,
  parentRequestId = null,
  conversationMode = "new",
  expectedConversationUrl = null,
  expectedConversationKey = null
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
    attachments,
    parentRequestId,
    conversationMode,
    expectedConversationUrl,
    expectedConversationKey
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
    const hiddenCapability = usesHiddenAutomation(visibility)
      ? await probeOffscreenAutomationTarget()
      : null;

    if (hiddenCapability && !hiddenCapability.supported) {
      await updateRequest(requestId, (draft) => {
        appendEvent(draft, `Hidden internal target unavailable; using one inactive tab. ${hiddenCapability.failureReason || ""}`.trim());
      });
    }

    const preferredAutomationTabId = await resolvePreferredAutomationTabId(preferredChatTabId, visibility);
    const discoveredChatTab = preferredAutomationTabId
      ? await getUsableChatGptTab(preferredAutomationTabId, {
        sourceFocus,
        visibility
      })
      : await findOrCreateChatGptTab({
        sourceFocus,
        visibility
      });
    const chatTab = await prepareAutomationTab(discoveredChatTab);

    if (request.conversationMode === "followup") {
      if (request.expectedConversationUrl) {
        await navigateTabToConversation(chatTab.id, request.expectedConversationUrl);
      } else if (!preferredChatTabId || chatTab.id !== preferredChatTabId) {
        throw new Error("The previous request has no saved ChatGPT conversation URL, and its original ChatGPT tab is not available. The extension will not start a new chat for this follow-up.");
      }
    }

    await markAutomationRequestActive(requestId);

    await updateRequest(requestId, (draft) => {
      draft.chatTabId = chatTab.id;
      draft.automationVisibilityMode = getVisibilityMode(visibility);
      draft.automationTargetType = getAutomationTargetType(visibility);
      draft.state = REQUEST_STATES.CHATGPT_TAB_READY;
      appendEvent(draft, `Using ChatGPT tab ${chatTab.id}.`);
    });

    if (usesFocusEmulation(visibility)) {
      await enableFocusEmulation({
        tabId: chatTab.id,
        requestId
      });
      await updateRequest(requestId, (draft) => {
        appendEvent(draft, "Chrome debugger focus emulation enabled for background ChatGPT streaming.");
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
        chatOptions: {
          ...automationSettings,
          conversation: {
            ...automationSettings.conversation,
            mode: request.conversationMode === "followup" ? "continue" : "new",
            startNewChat: request.conversationMode === "followup"
              ? false
              : automationSettings.conversation.startNewChat,
            expectedConversationUrl: request.expectedConversationUrl || null
          }
        }
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
    await clearAutomationRequestActive(requestId).catch(() => null);
    await markRequestError(requestId, error);
  }
}

async function injectAutomationScript(tabId) {
  await chrome.scripting.executeScript({
    target: {
      tabId
    },
    files: CHATGPT_CONTENT_SCRIPT_FILES
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

    if (message.conversationUrl) {
      draft.chatConversationUrl = message.conversationUrl;
    }

    if (message.conversationKey) {
      draft.chatConversationKey = message.conversationKey;
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

  if (message.conversationUrl || message.conversationKey) {
    await updateSessionConversation({
      conversationUrl: message.conversationUrl || null,
      conversationKey: message.conversationKey || null
    }).catch(() => null);
  }

  if (
    message.state === REQUEST_STATES.RESPONSE_COMPLETE
    || message.state === REQUEST_STATES.ERROR_STATE
  ) {
    const request = await getRequest(requestId);
    const settings = await getAutomationSettings();
    const requestVisibilityMode = request?.automationVisibilityMode || getVisibilityMode(settings.visibility);

    await disableFocusEmulationForRequest(requestId).catch(() => null);
    await clearAutomationRequestActive(requestId).catch(() => null);

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
    new Error(`Chrome debugger focus emulation detached (${reason}). Background ChatGPT streaming cannot continue while the ChatGPT page is hidden. Close DevTools for the ChatGPT tab and retry, or switch routing mode to Focus ChatGPT.`)
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
  const automationSession = await getAutomationSession();
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
    automationSession?.tabId,
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
    automationSession: summarizeAutomationSession(automationSession),
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
    settings: await getPublicAutomationSettings()
  };
}

async function getAutomationSettings() {
  const result = await chrome.storage.local.get(AUTOMATION_SETTINGS_KEY);

  return sanitizeAutomationSettings(
    result[AUTOMATION_SETTINGS_KEY] || getDefaultAutomationSettings(EXTENSION_NAME),
    EXTENSION_NAME
  );
}

async function getPublicAutomationSettings() {
  const settings = await getAutomationSettings();
  const session = await getAutomationSession();

  return {
    ...settings,
    automationSession: summarizeAutomationSession(session)
  };
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
