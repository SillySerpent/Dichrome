import {
  VISIBILITY_MODES,
  getVisibilityMode,
  usesFocusedAutomation,
  usesSidecarWindow,
  usesSingleTabAutomation
} from "./settings.js";
import {
  AUTOMATION_WINDOW_STATE_KEY,
  CHATGPT_HOME_URL,
  CHATGPT_LOAD_TIMEOUT_MS,
  isChatGptUrl,
  sleep
} from "../constants.js";
import { restoreSourceFocus } from "./source-focus.js";
import {
  AUTOMATION_TARGET_TYPES,
  getAutomationSession,
  markAutomationTargetReady
} from "./session.js";

export async function prepareAutomationTab(tab) {
  if (!tab?.id) {
    return tab;
  }

  await chrome.tabs.update(tab.id, {
    autoDiscardable: false
  }).catch(() => null);

  return chrome.tabs.get(tab.id).catch(() => tab);
}

export async function navigateTabToConversation(tabId, conversationUrl) {
  const currentTab = await chrome.tabs.get(tabId);
  const currentUrl = currentTab.url || currentTab.pendingUrl || "";

  if (sanitizeConversationUrl(currentUrl) === sanitizeConversationUrl(conversationUrl)) {
    return currentTab;
  }

  if (!isChatGptUrl(conversationUrl)) {
    throw new Error("The saved ChatGPT conversation URL is not a ChatGPT URL.");
  }

  await chrome.tabs.update(tabId, {
    url: conversationUrl,
    active: false
  });

  const loadedTab = await waitForTabToLoad(tabId, CHATGPT_LOAD_TIMEOUT_MS);

  if (sanitizeConversationUrl(loadedTab.url || loadedTab.pendingUrl || "") !== sanitizeConversationUrl(conversationUrl)) {
    throw new Error("Could not reopen the previous ChatGPT conversation for follow-up.");
  }

  return loadedTab;
}

export async function findOrCreateChatGptTab({ sourceFocus, visibility } = {}) {
  if (usesSidecarWindow(visibility)) {
    return findOrCreateVisibleChatGptTab({
      sourceFocus,
      visibility
    });
  }

  return findOrCreateSingleChatGptTab({
    sourceFocus
  });
}

export async function getUsableChatGptTab(tabId, { sourceFocus, visibility } = {}) {
  try {
    const tab = await chrome.tabs.get(tabId);

    if (isChatGptUrl(tab.url || tab.pendingUrl || "")) {
      if (usesSingleTabAutomation(visibility)) {
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

export async function resolvePreferredAutomationTabId(preferredChatTabId, visibility) {
  if (!preferredChatTabId) {
    return null;
  }

  if (!usesSingleTabAutomation(visibility)) {
    return preferredChatTabId;
  }

  const session = await getAutomationSession();

  return session.tabId ? null : preferredChatTabId;
}

export async function getAutomationWindowState() {
  const result = await chrome.storage.local.get(AUTOMATION_WINDOW_STATE_KEY);

  return result[AUTOMATION_WINDOW_STATE_KEY] || null;
}

export async function setAutomationWindowState(state) {
  await chrome.storage.local.set({
    [AUTOMATION_WINDOW_STATE_KEY]: state
  });
}

async function findOrCreateSingleChatGptTab({ sourceFocus } = {}) {
  const sourceWindowId = sourceFocus?.windowId || null;
  const session = await getAutomationSession();

  if (session.tabId) {
    const sessionTab = await getChatGptTabOrNull(session.tabId);

    if (sessionTab) {
      const loadedSessionTab = await ensureChatGptTabLoaded(sessionTab);
      await markSingleTabReady(loadedSessionTab);
      console.info("[ChatGPT Relay] Reusing session ChatGPT automation tab", {
        tabId: loadedSessionTab.id,
        windowId: loadedSessionTab.windowId,
        sourceWindowId
      });
      return loadedSessionTab;
    }
  }

  const tabs = await chrome.tabs.query({});
  const existingTab = tabs
    .filter((tab) => isChatGptUrl(tab.url || tab.pendingUrl || ""))
    .sort((a, b) => scoreChatTab(b, sourceWindowId) - scoreChatTab(a, sourceWindowId))[0] || null;

  if (existingTab) {
    const loadedExistingTab = await ensureChatGptTabLoaded(existingTab);
    await markSingleTabReady(loadedExistingTab);
    console.info("[ChatGPT Relay] Reusing existing ChatGPT tab for background automation", {
      tabId: loadedExistingTab.id,
      windowId: loadedExistingTab.windowId,
      sourceWindowId
    });
    return loadedExistingTab;
  }

  const createOptions = {
    url: CHATGPT_HOME_URL,
    active: false
  };

  if (sourceWindowId) {
    createOptions.windowId = sourceWindowId;
  }

  const created = await chrome.tabs.create(createOptions);
  console.info("[ChatGPT Relay] Created inactive ChatGPT tab for background automation", {
    tabId: created.id,
    windowId: created.windowId,
    sourceWindowId
  });

  const loadedCreatedTab = await waitForTabToLoad(created.id, CHATGPT_LOAD_TIMEOUT_MS);
  await markSingleTabReady(loadedCreatedTab);

  return loadedCreatedTab;
}

async function findOrCreateVisibleChatGptTab({ sourceFocus, visibility }) {
  const sourceWindowId = sourceFocus?.windowId || null;
  const rememberedTab = await findRememberedVisibleChatGptTab({
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
  await markAutomationTargetReady({
    targetType: focused ? AUTOMATION_TARGET_TYPES.FOCUSED : AUTOMATION_TARGET_TYPES.SIDECAR,
    tabId: createdTab.id,
    windowId: createdWindow.id,
    lastKnownUrl: createdTab.url || createdTab.pendingUrl || ""
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
  await markAutomationTargetReady({
    targetType: usesFocusedAutomation(visibility) ? AUTOMATION_TARGET_TYPES.FOCUSED : AUTOMATION_TARGET_TYPES.SIDECAR,
    tabId: tab.id,
    windowId: tab.windowId,
    lastKnownUrl: tab.url || tab.pendingUrl || ""
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

async function findRememberedVisibleChatGptTab({ excludeWindowId = null } = {}) {
  const session = await getAutomationSession();

  if (
    session.tabId
    && (session.targetType === AUTOMATION_TARGET_TYPES.SIDECAR || session.targetType === AUTOMATION_TARGET_TYPES.FOCUSED)
  ) {
    const sessionTab = await getChatGptTabOrNull(session.tabId);

    if (sessionTab && (!excludeWindowId || sessionTab.windowId !== excludeWindowId)) {
      return sessionTab;
    }
  }

  const stored = await getAutomationWindowState();

  if (stored?.tabId) {
    const storedTab = await getChatGptTabOrNull(stored.tabId);

    if (storedTab && (!excludeWindowId || storedTab.windowId !== excludeWindowId)) {
      return storedTab;
    }
  }

  return null;
}

async function getChatGptTabOrNull(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);

    return isChatGptUrl(tab.url || tab.pendingUrl || "") ? tab : null;
  } catch (_error) {
    return null;
  }
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

async function markSingleTabReady(tab) {
  await markAutomationTargetReady({
    targetType: AUTOMATION_TARGET_TYPES.SINGLE_TAB,
    tabId: tab.id,
    windowId: tab.windowId,
    lastKnownUrl: tab.url || tab.pendingUrl || ""
  });
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

function sanitizeConversationUrl(value) {
  try {
    const url = new URL(value);

    return `${url.origin}${url.pathname}`;
  } catch (_error) {
    return "";
  }
}

export function getAutomationTargetType(visibility) {
  switch (getVisibilityMode(visibility)) {
    case VISIBILITY_MODES.FOCUSED:
      return AUTOMATION_TARGET_TYPES.FOCUSED;
    case VISIBILITY_MODES.SIDECAR:
      return AUTOMATION_TARGET_TYPES.SIDECAR;
    default:
      return AUTOMATION_TARGET_TYPES.SINGLE_TAB;
  }
}
