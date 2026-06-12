import {
  CHATGPT_HOME_URL
} from "../../shared/contracts.js";
import {
  enableOffscreenFramePolicyOverride
} from "../automation/offscreen-frame-policy.js";
import {
  serializeError
} from "../constants.js";

export const MODE2_MESSAGE_TYPES = Object.freeze({
  CAPTURE_VISIBLE_TAB: "chatgpt-sidebar:capture-visible-tab",
  ENABLE_CHATGPT_FRAME_POLICY: "chatgpt-sidebar:enable-chatgpt-frame-policy",
  OPEN_CHATGPT_WINDOW: "chatgpt-sidebar:open-chatgpt-window",
  OPEN_SIDE_PANEL: "chatgpt-sidebar:open-side-panel",
  SELECTION_ACTION: "chatgpt-sidebar:selection-action",
  GET_SELECTION: "chatgpt-sidebar:get-selection"
});

export const MODE2_COMMANDS = Object.freeze({
  CAPTURE_VISIBLE_SCREENSHOT: "capture-visible-screenshot",
  SUMMARIZE_SELECTION: "summarize-selection",
  EXPLAIN_SELECTION: "explain-selection"
});

const STORAGE_KEYS = Object.freeze({
  CHATGPT_WINDOW_ID: "dichrome.mode2.chatGptWindowId",
  LATEST_NOTICE: "dichrome.mode2.latestNotice",
  LATEST_PROMPT: "dichrome.mode2.latestPrompt",
  LATEST_SCREENSHOT: "dichrome.mode2.latestScreenshot"
});

const SELECTION_ACTIONS = Object.freeze({
  ask: {
    label: "Ask ChatGPT",
    instruction:
      "Please help me with the selected text below. Explain the important context, answer likely questions, and call out anything I should verify."
  },
  summarize: {
    label: "Summarize",
    instruction:
      "Summarize the selected text below. Keep the summary clear, accurate, and focused on the important points."
  },
  explain: {
    label: "Explain",
    instruction:
      "Explain the selected text below in plain language. Define any technical terms and include practical implications."
  },
  rewrite: {
    label: "Rewrite",
    instruction:
      "Rewrite the selected text below so it is clearer and more polished while preserving the original meaning."
  },
  define: {
    label: "Define",
    instruction:
      "Define the selected word or phrase in plain language. If it has multiple meanings, list the likely meanings and explain which one best fits the surrounding wording if possible."
  }
});

const MAX_SELECTED_TEXT_LENGTH = 24000;
const SCREENSHOT_FORMAT = "png";
const BACKGROUND_MESSAGE_TYPES = new Set([
  MODE2_MESSAGE_TYPES.CAPTURE_VISIBLE_TAB,
  MODE2_MESSAGE_TYPES.ENABLE_CHATGPT_FRAME_POLICY,
  MODE2_MESSAGE_TYPES.OPEN_CHATGPT_WINDOW,
  MODE2_MESSAGE_TYPES.OPEN_SIDE_PANEL,
  MODE2_MESSAGE_TYPES.SELECTION_ACTION
]);

export function createMode2CompanionController({
  captureVisibleTabScreenshot,
  openSidePanel,
  queryBestSourceTab
}) {
  function canHandleMessage(message) {
    return BACKGROUND_MESSAGE_TYPES.has(message?.type);
  }

  async function handleMessage(message, sender) {
    switch (message.type) {
      case MODE2_MESSAGE_TYPES.SELECTION_ACTION:
        return queuePromptFromSelection({
          action: message.action,
          selectedText: message.selectedText,
          sourceTab: sender.tab,
          source: "selection-popover",
          pageTitle: message.pageTitle,
          pageUrl: message.pageUrl
        });

      case MODE2_MESSAGE_TYPES.CAPTURE_VISIBLE_TAB:
        return {
          screenshot: await captureVisibleScreenshot({
            sourceTab: sender.tab,
            source: message.source || "side-panel"
          })
        };

      case MODE2_MESSAGE_TYPES.ENABLE_CHATGPT_FRAME_POLICY:
        return {
          framePolicy: await enableOffscreenFramePolicyOverride()
        };

      case MODE2_MESSAGE_TYPES.OPEN_CHATGPT_WINDOW:
        return {
          windowId: await openChatGptWindow(sender.tab)
        };

      case MODE2_MESSAGE_TYPES.OPEN_SIDE_PANEL:
        await openSourceSidePanel(sender.tab);
        return {
          opened: true
        };

      default:
        throw new Error(`Unsupported Mode 2 message: ${message.type}`);
    }
  }

  async function handleCommand(command) {
    if (command === MODE2_COMMANDS.CAPTURE_VISIBLE_SCREENSHOT) {
      await captureVisibleScreenshot({
        source: "keyboard-shortcut"
      });
      return true;
    }

    if (command === MODE2_COMMANDS.SUMMARIZE_SELECTION) {
      await queueSelectionFromActiveTab("summarize", "keyboard-shortcut");
      return true;
    }

    if (command === MODE2_COMMANDS.EXPLAIN_SELECTION) {
      await queueSelectionFromActiveTab("explain", "keyboard-shortcut");
      return true;
    }

    return false;
  }

  async function queueSelectionFromActiveTab(action, source) {
    const sourceTab = await queryBestSourceTab();
    const selection = await readSelectionFromTab(sourceTab);

    if (!selection.selectedText) {
      await storeNotice({
        kind: "warning",
        message: "No selected text was found on the active page."
      });
      await openSourceSidePanel(sourceTab);
      return null;
    }

    return queuePromptFromSelection({
      action,
      selectedText: selection.selectedText,
      sourceTab,
      source,
      pageTitle: selection.pageTitle,
      pageUrl: selection.pageUrl
    });
  }

  async function queuePromptFromSelection({
    action,
    selectedText,
    sourceTab,
    source,
    pageTitle,
    pageUrl
  }) {
    const actionConfig = SELECTION_ACTIONS[action];
    if (!actionConfig) {
      throw new Error(`Unsupported selection action: ${action}`);
    }

    const normalizedSelection = normalizeSelectedText(selectedText);
    if (!normalizedSelection.text) {
      await storeNotice({
        kind: "warning",
        message: "No selected text was available for this shortcut."
      });
      await openSourceSidePanel(sourceTab);
      return {
        queued: false
      };
    }

    const tab = sourceTab || await queryBestSourceTab().catch(() => null);
    const sourceTitle = pageTitle || tab?.title || "Untitled page";
    const sourceUrl = pageUrl || tab?.url || "";
    const prompt = buildPrompt({
      actionConfig,
      selectedText: normalizedSelection.text,
      sourceTitle,
      sourceUrl,
      wasTruncated: normalizedSelection.wasTruncated
    });

    const record = {
      id: createId(),
      action,
      actionLabel: actionConfig.label,
      createdAt: new Date().toISOString(),
      prompt,
      selectedText: normalizedSelection.text,
      selectedTextWasTruncated: normalizedSelection.wasTruncated,
      source,
      sourceTitle,
      sourceUrl
    };

    await getTransientStorage().set({
      [STORAGE_KEYS.LATEST_PROMPT]: record,
      [STORAGE_KEYS.LATEST_NOTICE]: {
        id: createId(),
        kind: "success",
        message: `${actionConfig.label} prompt is ready. Copy it into ChatGPT or use the embedded sidebar.`,
        createdAt: new Date().toISOString()
      }
    });

    await openSourceSidePanel(tab || sourceTab);
    return {
      queued: true,
      prompt: record
    };
  }

  async function captureVisibleScreenshot({
    sourceTab = null,
    source = "side-panel"
  } = {}) {
    const tab = sourceTab || await queryBestSourceTab();

    if (!tab?.windowId) {
      throw new Error("No source browser tab was available for screenshot capture.");
    }

    try {
      const attachment = await captureVisibleTabScreenshot(tab.windowId, tab);
      const screenshot = {
        id: attachment.id || createId(),
        createdAt: new Date().toISOString(),
        dataUrl: attachment.dataUrl,
        format: SCREENSHOT_FORMAT,
        source,
        sourceTitle: tab.title || "Untitled page",
        sourceUrl: tab.url || ""
      };

      await getTransientStorage().set({
        [STORAGE_KEYS.LATEST_SCREENSHOT]: screenshot,
        [STORAGE_KEYS.LATEST_NOTICE]: {
          id: createId(),
          kind: "success",
          message: "Visible screenshot captured.",
          createdAt: new Date().toISOString()
        }
      });

      await openSourceSidePanel(tab);
      return screenshot;
    } catch (error) {
      await storeNotice({
        kind: "error",
        message: `Screenshot capture failed: ${serializeError(error)}`
      });
      await openSourceSidePanel(tab).catch(() => null);
      throw error;
    }
  }

  async function openChatGptWindow(tab) {
    const baseWindow = await getBaseWindow(tab);
    const bounds = computeSidebarWindowBounds(baseWindow);
    const storage = getTransientStorage();
    const stored = await storage.get(STORAGE_KEYS.CHATGPT_WINDOW_ID);
    const existingWindowId = stored[STORAGE_KEYS.CHATGPT_WINDOW_ID];

    if (Number.isInteger(existingWindowId)) {
      try {
        const updated = await chrome.windows.update(existingWindowId, {
          ...bounds,
          focused: true
        });

        return updated.id;
      } catch (_error) {
        await storage.remove?.(STORAGE_KEYS.CHATGPT_WINDOW_ID);
      }
    }

    const created = await chrome.windows.create({
      url: CHATGPT_HOME_URL,
      type: "popup",
      focused: true,
      ...bounds
    });

    if (Number.isInteger(created.id)) {
      await storage.set({
        [STORAGE_KEYS.CHATGPT_WINDOW_ID]: created.id
      });
    }

    return created.id;
  }

  async function openSourceSidePanel(tab) {
    if (tab?.id) {
      await openSidePanel(tab.id);
      return;
    }

    const sourceTab = await queryBestSourceTab().catch(() => null);
    if (sourceTab?.id) {
      await openSidePanel(sourceTab.id);
    }
  }

  return Object.freeze({
    canHandleMessage,
    captureVisibleScreenshot,
    handleCommand,
    handleMessage,
    queuePromptFromSelection
  });
}

function buildPrompt({
  actionConfig,
  selectedText,
  sourceTitle,
  sourceUrl,
  wasTruncated
}) {
  const sourceLines = [`Source title: ${sourceTitle}`];
  if (sourceUrl) {
    sourceLines.push(`Source URL: ${sourceUrl}`);
  }

  if (wasTruncated) {
    sourceLines.push(
      `Note: The selection was truncated to ${MAX_SELECTED_TEXT_LENGTH} characters before handoff.`
    );
  }

  return [
    actionConfig.instruction,
    "",
    sourceLines.join("\n"),
    "",
    "Selected text:",
    "```",
    selectedText,
    "```"
  ].join("\n");
}

async function readSelectionFromTab(tab) {
  if (!tab?.id) {
    return {
      selectedText: "",
      pageTitle: tab?.title || "",
      pageUrl: tab?.url || ""
    };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: MODE2_MESSAGE_TYPES.GET_SELECTION
    });

    return {
      selectedText: response?.selectedText || "",
      pageTitle: response?.pageTitle || tab.title || "",
      pageUrl: response?.pageUrl || tab.url || ""
    };
  } catch (_error) {
    return {
      selectedText: "",
      pageTitle: tab.title || "",
      pageUrl: tab.url || ""
    };
  }
}

async function storeNotice({ kind, message }) {
  await getTransientStorage().set({
    [STORAGE_KEYS.LATEST_NOTICE]: {
      id: createId(),
      kind,
      message,
      createdAt: new Date().toISOString()
    }
  });
}

function normalizeSelectedText(value) {
  const normalized = String(value || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (normalized.length <= MAX_SELECTED_TEXT_LENGTH) {
    return {
      text: normalized,
      wasTruncated: false
    };
  }

  return {
    text: normalized.slice(0, MAX_SELECTED_TEXT_LENGTH).trimEnd(),
    wasTruncated: true
  };
}

function getTransientStorage() {
  return chrome.storage.session || chrome.storage.local;
}

async function getBaseWindow(tab) {
  if (tab?.windowId) {
    return chrome.windows.get(tab.windowId);
  }

  return chrome.windows.getCurrent();
}

function computeSidebarWindowBounds(baseWindow) {
  const baseWidth = baseWindow?.width || 1280;
  const baseHeight = baseWindow?.height || 900;
  const baseLeft = baseWindow?.left || 0;
  const baseTop = baseWindow?.top || 0;
  const width = clamp(Math.round(baseWidth * 0.36), 420, 620);
  const height = Math.max(baseHeight, 620);
  const left = Math.max(baseLeft + baseWidth - width, 0);

  return {
    height,
    left,
    top: Math.max(baseTop, 0),
    width
  };
}

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
