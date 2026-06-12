import {
  APP_MODES
} from "../../shared/modes.js";

const MENU_IDS = Object.freeze({
  OPEN_CHATGPT_WINDOW: "dichrome:open-chatgpt-window",
  CAPTURE_VISIBLE_SCREENSHOT: "dichrome:capture-visible-screenshot",
  ASK_SELECTION: "dichrome:ask-selection",
  SUMMARIZE_SELECTION: "dichrome:summarize-selection",
  EXPLAIN_SELECTION: "dichrome:explain-selection",
  REWRITE_SELECTION: "dichrome:rewrite-selection",
  DEFINE_SELECTION: "dichrome:define-selection"
});

const SELECTION_ACTION_BY_MENU_ID = Object.freeze({
  [MENU_IDS.ASK_SELECTION]: "ask",
  [MENU_IDS.SUMMARIZE_SELECTION]: "summarize",
  [MENU_IDS.EXPLAIN_SELECTION]: "explain",
  [MENU_IDS.REWRITE_SELECTION]: "rewrite",
  [MENU_IDS.DEFINE_SELECTION]: "define"
});

const MODE1_PROFILE_BY_ACTION = Object.freeze({
  ask: "ask_selection",
  summarize: "summarize_selection",
  explain: "explain_selection",
  rewrite: "rewrite_selection",
  define: "define_selection"
});

export function createContextMenuController({
  appendEvent,
  getActiveMode,
  mode2Controller,
  normalizeText,
  openSidePanel,
  startScreenshotRequest,
  startRequest,
  updateRequest
}) {
  async function createContextMenus() {
    await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));

    await createContextMenuItem({
      id: MENU_IDS.OPEN_CHATGPT_WINDOW,
      title: "Open ChatGPT companion window",
      contexts: ["all"]
    });

    await createContextMenuItem({
      id: MENU_IDS.CAPTURE_VISIBLE_SCREENSHOT,
      title: "Capture visible screenshot",
      contexts: ["all"]
    });

    await createContextMenuItem({
      id: "dichrome-selection-separator",
      type: "separator",
      contexts: ["selection"]
    });

    await createContextMenuItem({
      id: MENU_IDS.ASK_SELECTION,
      title: "Ask with Dichrome about \"%s\"",
      contexts: ["selection"]
    });

    await createContextMenuItem({
      id: MENU_IDS.SUMMARIZE_SELECTION,
      title: "Summarize with Dichrome",
      contexts: ["selection"]
    });

    await createContextMenuItem({
      id: MENU_IDS.EXPLAIN_SELECTION,
      title: "Explain with Dichrome",
      contexts: ["selection"]
    });

    await createContextMenuItem({
      id: MENU_IDS.REWRITE_SELECTION,
      title: "Rewrite with Dichrome",
      contexts: ["selection"]
    });

    await createContextMenuItem({
      id: MENU_IDS.DEFINE_SELECTION,
      title: "Define with Dichrome",
      contexts: ["selection"]
    });
  }

  async function handleContextMenuClick(info, tab) {
    if (info.menuItemId === MENU_IDS.OPEN_CHATGPT_WINDOW) {
      await mode2Controller.handleMessage({
        type: "chatgpt-sidebar:open-chatgpt-window"
      }, {
        tab
      });
      return;
    }

    if (info.menuItemId === MENU_IDS.CAPTURE_VISIBLE_SCREENSHOT) {
      await handleScreenshotAction(tab, "context-menu");
      return;
    }

    const action = SELECTION_ACTION_BY_MENU_ID[info.menuItemId];
    if (!action) {
      return;
    }

    await handleSelectionAction({
      action,
      selectedText: info.selectionText,
      tab,
      source: "context-menu"
    });
  }

  async function handleSelectionAction({
    action,
    selectedText,
    tab,
    source,
    pageTitle,
    pageUrl
  }) {
    const activeMode = await getActiveMode();

    if (activeMode === APP_MODES.MODE2) {
      return mode2Controller.queuePromptFromSelection({
        action,
        selectedText,
        sourceTab: tab,
        source,
        pageTitle,
        pageUrl
      });
    }

    const profileId = MODE1_PROFILE_BY_ACTION[action];
    if (!profileId) {
      throw new Error(`Unsupported Dichrome selection action: ${action}`);
    }

    const normalizedSelectedText = normalizeText(selectedText);

    await openSidePanel(tab?.id);

    const { requestId } = await startRequest({
      profileId,
      sourceTab: tab,
      selectedText: normalizedSelectedText
    });

    await updateRequest(requestId, (request) => {
      appendEvent(request, `${source || "Selection"} request created.`);
    });

    return {
      requestId
    };
  }

  async function handleScreenshotAction(tab, source) {
    const activeMode = await getActiveMode();

    if (activeMode === APP_MODES.MODE2) {
      return {
        screenshot: await mode2Controller.captureVisibleScreenshot({
          sourceTab: tab,
          source
        })
      };
    }

    return startScreenshotRequest({
      sourceTab: tab,
      source
    });
  }

  return Object.freeze({
    createContextMenus,
    handleContextMenuClick,
    handleScreenshotAction,
    handleSelectionAction
  });
}

function createContextMenuItem(properties) {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(properties, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}
