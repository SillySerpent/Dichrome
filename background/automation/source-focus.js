import {
  LAST_SOURCE_TAB_KEY,
  getTabId,
  isChatGptUrl,
  isExtensionUrl,
  serializeError,
  sleep,
  storageArea
} from "../constants.js";
import { createRequestId } from "../state-machine.js";

export async function queryBestSourceTab() {
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

export async function rememberSourceTab(tab) {
  if (!isUsableSourceTab(tab)) {
    return;
  }

  await storageArea.set({
    [LAST_SOURCE_TAB_KEY]: {
      tabId: getTabId(tab),
      windowId: tab.windowId,
      title: tab.title || "",
      url: tab.url || ""
    }
  });
}

export async function getRememberedSourceTab() {
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

export function getSourceFocusTarget(source) {
  return {
    tabId: source?.tabId ?? source?.id ?? null,
    windowId: source?.windowId ?? null
  };
}

export async function restoreSourceFocus(sourceFocus, automationWindowId) {
  if (!sourceFocus?.windowId || sourceFocus.windowId === automationWindowId) {
    return;
  }

  await focusSourceTarget(sourceFocus);
  await sleep(120);
  await focusSourceTarget(sourceFocus);
}

export async function captureVisibleTabScreenshot(windowId, sourceTab = null) {
  let dataUrl;

  try {
    dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "png"
    });
  } catch (error) {
    const sourceUrl = sourceTab?.url || sourceTab?.pendingUrl || "";
    const target = sourceUrl ? ` for ${sourceUrl}` : "";

    throw new Error(`Visible screenshot capture failed${target}. Grant the extension All Sites access when prompted, reload the unpacked extension if the manifest just changed, then retry. Chrome may still require opening the panel from the extension toolbar for browser-internal pages such as chrome://newtab. ${serializeError(error)}`);
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

export function isUsableSourceTab(tab) {
  const url = tab?.url || tab?.pendingUrl || "";

  return Boolean(tab?.id && tab?.windowId && url && !isExtensionUrl(url) && !isChatGptUrl(url));
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
