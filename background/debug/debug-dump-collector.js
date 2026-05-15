import {
  getOffscreenFrameStatus,
  getOffscreenHostStatus,
  sendMessageToOffscreenFrame
} from "../automation/offscreen-target.js";
import {
  getAutomationSession,
  summarizeAutomationSession
} from "../automation/session.js";
import { getAutomationWindowState } from "../automation/tab-target.js";
import { getSourceFocusTarget } from "../automation/source-focus.js";
import { getFocusEmulationDebugState } from "../focus-emulation.js";
import { getPanelState } from "../requests/store.js";
import {
  isChatGptUrl,
  serializeError
} from "../constants.js";
import {
  summarizeRequestForDebug,
  summarizeTabForDebug,
  summarizeWindowForDebug
} from "../debug-dump.js";
import { CHATGPT_AUTOMATION_MESSAGES } from "../../shared/contracts.js";

export async function dumpDebugState({
  requestId,
  extensionName,
  getAutomationSettings,
  getRepairSettings,
  injectAutomationScript,
  sendMessageToTab
}) {
  const panelState = await getPanelState();
  const request = requestId
    ? panelState.requests.find((item) => item.id === requestId)
    : panelState.requests.find((item) => item.id === panelState.activeRequestId) || panelState.requests[0] || null;
  const settings = await getAutomationSettings();
  const repairSettings = await getRepairSettings();
  const automationWindowState = await getAutomationWindowState();
  const automationSession = await getAutomationSession();
  const offscreenHost = await getOffscreenHostStatus();
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
  const prefersOffscreenDump = request?.automationTargetType === "offscreen-frame"
    || automationSession?.targetType === "offscreen-frame";
  const contentDumpResult = await collectContentDebugDump(contentDumpCandidates, {
    preferOffscreen: prefersOffscreenDump,
    injectAutomationScript,
    sendMessageToTab
  });
  const dump = {
    createdAt: new Date().toISOString(),
    extension: {
      id: chrome.runtime.id,
      name: extensionName,
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
    offscreenHost,
    offscreenFrame: getOffscreenFrameStatus(),
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

async function collectContentDebugDump(tabIds, {
  preferOffscreen = false,
  injectAutomationScript,
  sendMessageToTab
} = {}) {
  let lastFailure = null;

  if (preferOffscreen) {
    const offscreenResult = await collectOffscreenContentDebugDump();

    if (offscreenResult.dump) {
      return offscreenResult;
    }

    lastFailure = offscreenResult.failure || lastFailure;
  }

  for (const tabId of tabIds) {
    await injectAutomationScript(tabId).catch(() => null);

    const dump = await sendMessageToTab(tabId, {
      type: CHATGPT_AUTOMATION_MESSAGES.DUMP
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

  if (!preferOffscreen) {
    const offscreenResult = await collectOffscreenContentDebugDump();

    if (offscreenResult.dump) {
      return offscreenResult;
    }

    lastFailure = offscreenResult.failure || lastFailure;
  }

  return {
    tabId: null,
    dump: lastFailure
  };
}

async function collectOffscreenContentDebugDump() {
  const offscreenDump = await sendMessageToOffscreenFrame({
    type: CHATGPT_AUTOMATION_MESSAGES.DUMP
  }).catch((error) => ({
    __error: serializeError(error)
  }));

  if (offscreenDump && !offscreenDump.__error) {
    return {
      tabId: null,
      dump: {
        offscreenFrame: true,
        ...offscreenDump
      }
    };
  }

  return {
    tabId: null,
    dump: null,
    failure: {
      ok: false,
      error: offscreenDump?.__error || "Offscreen ChatGPT frame did not return a dump."
    }
  };
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
