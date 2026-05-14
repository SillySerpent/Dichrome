import { CHATGPT_HOME_URL, sleep } from "../constants.js";
import {
  AUTOMATION_TARGET_TYPES,
  getAutomationSession,
  setOffscreenCapability
} from "./session.js";

const OFFSCREEN_DOCUMENT_PATH = "offscreen/automation-host.html";
const OFFSCREEN_READY_TIMEOUT_MS = 5000;

let creatingOffscreenDocument = null;

export async function probeOffscreenAutomationTarget() {
  const session = await getAutomationSession();

  if (session.offscreenCapability?.supported === false) {
    return session.offscreenCapability;
  }

  if (!chrome.offscreen?.createDocument) {
    return recordUnsupported("Chrome offscreen API is unavailable.");
  }

  try {
    await ensureOffscreenDocument();
    const response = await waitForOffscreenProbe();

    if (!response?.supported) {
      return recordUnsupported(response?.failureReason || "ChatGPT could not be loaded inside the offscreen host.");
    }

    const capability = {
      supported: false,
      checkedAt: new Date().toISOString(),
      failureReason: "ChatGPT offscreen iframe loaded, but this extension cannot inject the current tab-based automation adapter into an offscreen iframe target. Falling back to one inactive tab."
    };

    await setOffscreenCapability(capability);
    return capability;
  } catch (error) {
    return recordUnsupported(error?.message || String(error));
  }
}

export async function closeOffscreenAutomationTarget() {
  if (!chrome.offscreen?.closeDocument) {
    return;
  }

  await chrome.offscreen.closeDocument().catch(() => null);
}

export function getOffscreenDocumentUrl() {
  return chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
}

export function getOffscreenTargetDescriptor() {
  return {
    targetType: AUTOMATION_TARGET_TYPES.OFFSCREEN_FRAME,
    tabId: null,
    windowId: null,
    offscreenDocumentUrl: getOffscreenDocumentUrl(),
    lastKnownUrl: CHATGPT_HOME_URL
  };
}

async function ensureOffscreenDocument() {
  const offscreenUrl = getOffscreenDocumentUrl();
  const existingContexts = chrome.runtime.getContexts
    ? await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    })
    : [];

  if (existingContexts.length > 0) {
    return;
  }

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [getOffscreenReason()],
      justification: "Probe whether ChatGPT can run as a fully hidden internal automation target."
    }).finally(() => {
      creatingOffscreenDocument = null;
    });
  }

  await creatingOffscreenDocument;
}

async function waitForOffscreenProbe() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < OFFSCREEN_READY_TIMEOUT_MS) {
    const response = await chrome.runtime.sendMessage({
      type: "OFFSCREEN_AUTOMATION_PROBE",
      url: CHATGPT_HOME_URL
    }).catch(() => null);

    if (response?.target === "offscreen-automation-host") {
      return response;
    }

    await sleep(250);
  }

  return {
    supported: false,
    failureReason: "Timed out waiting for the offscreen ChatGPT host probe."
  };
}

async function recordUnsupported(failureReason) {
  const capability = {
    supported: false,
    checkedAt: new Date().toISOString(),
    failureReason
  };

  await setOffscreenCapability(capability);
  return capability;
}

function getOffscreenReason() {
  const reasons = chrome.offscreen?.Reason || {};

  return reasons.DOM_SCRAPING || reasons.IFRAME_SCRIPTING || reasons.CLIPBOARD || "DOM_SCRAPING";
}
