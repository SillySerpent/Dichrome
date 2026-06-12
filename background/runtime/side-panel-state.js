import {
  getTabId
} from "../constants.js";

export function createSidePanelState() {
  const state = {
    tabIds: new Set(),
    windowIds: new Set()
  };

  async function openSidePanel(tabId) {
    if (tabId && chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ tabId }).then(() => {
        markSidePanelOpen({ tabId });
      }).catch(() => null);
      return;
    }

  }

  async function closeSidePanel(tab) {
    if (chrome.sidePanel?.close) {
      for (const context of getSidePanelCloseContexts(tab)) {
        const closed = await chrome.sidePanel.close(context).then(() => true).catch(() => false);

        if (closed) {
          markSidePanelClosed(context);
          markSidePanelClosed(tab);
          return;
        }
      }
    }

  }

  function shouldCloseSidePanel(tab) {
    if (!chrome.sidePanel?.close) {
      return false;
    }

    const tabId = getTabId(tab);
    const windowId = getWindowId(tab);

    return Boolean(
      tabId !== null && state.tabIds.has(tabId)
      || windowId !== null && state.windowIds.has(windowId)
    );
  }

  function markSidePanelOpen(info = {}) {
    const tabId = getTabId(info);
    const windowId = getWindowId(info);

    if (tabId !== null) {
      state.tabIds.add(tabId);
    }

    if (windowId !== null) {
      state.windowIds.add(windowId);
    }
  }

  function markSidePanelClosed(info = {}) {
    const tabId = getTabId(info);
    const windowId = getWindowId(info);

    if (tabId !== null) {
      state.tabIds.delete(tabId);
    }

    if (windowId !== null) {
      state.windowIds.delete(windowId);
    }
  }

  function forgetTab(tabId) {
    state.tabIds.delete(tabId);
  }

  return Object.freeze({
    closeSidePanel,
    forgetTab,
    markSidePanelClosed,
    markSidePanelOpen,
    openSidePanel,
    shouldCloseSidePanel
  });
}

function getSidePanelCloseContexts(tab) {
  const contexts = [];
  const tabId = getTabId(tab);
  const windowId = getWindowId(tab);

  if (tabId !== null) {
    contexts.push({ tabId });
  }

  if (windowId !== null) {
    contexts.push({ windowId });
  }

  contexts.push({});

  return contexts;
}

function getWindowId(value) {
  return Number.isInteger(value?.windowId) ? value.windowId : null;
}
