(() => {
  if (!shouldInstallSelectionPopover()) {
    return;
  }

  const MESSAGE_TYPES = Object.freeze({
    CAPTURE_VISIBLE_TAB: "chatgpt-sidebar:capture-visible-tab",
    SELECTION_ACTION: "chatgpt-sidebar:selection-action",
    GET_SELECTION: "chatgpt-sidebar:get-selection"
  });

  const ACTIONS = [
    { id: "ask", label: "Ask" },
    { id: "summarize", label: "Summarize" },
    { id: "explain", label: "Explain" },
    { id: "rewrite", label: "Rewrite" },
    { id: "screenshot", label: "Screenshot" }
  ];

  const MIN_SELECTION_LENGTH = 2;
  const MAX_SELECTION_LENGTH = 24000;
  const POPOVER_MARGIN = 8;

  let host = null;
  let shadow = null;
  let latestSelectionText = "";
  let showTimer = 0;
  let suppressNextDocumentClick = false;

  document.addEventListener("mouseup", () => schedulePopoverUpdate(), true);
  document.addEventListener("keyup", (event) => {
    if (event.key === "Escape") {
      hidePopover();
      return;
    }

    schedulePopoverUpdate();
  }, true);
  document.addEventListener("selectionchange", () => schedulePopoverUpdate(), true);
  document.addEventListener("contextmenu", () => schedulePopoverUpdate(0), true);
  document.addEventListener("mousedown", (event) => {
    if (suppressNextDocumentClick) {
      suppressNextDocumentClick = false;
      return;
    }

    if (host && event.composedPath().includes(host)) {
      return;
    }

    hidePopover();
  }, true);
  window.addEventListener("scroll", hidePopover, true);
  window.addEventListener("resize", hidePopover, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPES.GET_SELECTION) {
      return false;
    }

    const selection = readSelection();
    sendResponse({
      selectedText: selection?.text || "",
      pageTitle: document.title || "",
      pageUrl: location.href
    });
    return false;
  });

  function schedulePopoverUpdate(delay = 80) {
    window.clearTimeout(showTimer);
    showTimer = window.setTimeout(updatePopoverFromSelection, delay);
  }

  function updatePopoverFromSelection() {
    const selection = readSelection();
    if (!selection) {
      hidePopover();
      return;
    }

    latestSelectionText = selection.text;
    showPopover(selection.rect);
  }

  function readSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return null;
    }

    const text = selection
      .toString()
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (text.length < MIN_SELECTION_LENGTH) {
      return null;
    }

    const range = selection.getRangeAt(selection.rangeCount - 1);
    const rect = getUsableSelectionRect(range);
    if (!rect) {
      return null;
    }

    return {
      rect,
      text: text.length > MAX_SELECTION_LENGTH ? text.slice(0, MAX_SELECTION_LENGTH) : text
    };
  }

  function getUsableSelectionRect(range) {
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0
    );

    if (rects.length > 0) {
      return rects[rects.length - 1];
    }

    const boundingRect = range.getBoundingClientRect();
    if (boundingRect.width > 0 && boundingRect.height > 0) {
      return boundingRect;
    }

    return null;
  }

  function showPopover(selectionRect) {
    ensurePopover();
    renderPopover();

    host.style.visibility = "hidden";
    host.style.display = "block";

    requestAnimationFrame(() => {
      const popoverRect = host.getBoundingClientRect();
      const left = clamp(
        selectionRect.left,
        POPOVER_MARGIN,
        window.innerWidth - popoverRect.width - POPOVER_MARGIN
      );
      const preferredTop = selectionRect.bottom + POPOVER_MARGIN;
      const fallbackTop = selectionRect.top - popoverRect.height - POPOVER_MARGIN;
      const top =
        preferredTop + popoverRect.height <= window.innerHeight - POPOVER_MARGIN
          ? preferredTop
          : Math.max(POPOVER_MARGIN, fallbackTop);

      host.style.left = `${Math.round(left)}px`;
      host.style.top = `${Math.round(top)}px`;
      host.style.visibility = "visible";
    });
  }

  function ensurePopover() {
    if (host && shadow) {
      return;
    }

    host = document.createElement("div");
    host.setAttribute("data-chatgpt-sidebar-popover", "true");
    host.style.position = "fixed";
    host.style.zIndex = "2147483647";
    host.style.display = "none";
    host.style.left = "0";
    host.style.top = "0";
    shadow = host.attachShadow({ mode: "closed" });
    document.documentElement.appendChild(host);
  }

  function renderPopover() {
    shadow.textContent = "";

    const style = document.createElement("style");
    style.textContent = `
      .toolbar {
        align-items: center;
        background: #ffffff;
        border: 1px solid #d8dee4;
        border-radius: 8px;
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
        color: #1f2328;
        display: flex;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        gap: 4px;
        padding: 6px;
      }

      button {
        appearance: none;
        background: transparent;
        border: 0;
        border-radius: 6px;
        color: #1f2328;
        cursor: pointer;
        font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 8px 9px;
        white-space: nowrap;
      }

      button:hover,
      button:focus {
        background: #eef6f4;
        color: #0f766e;
        outline: none;
      }

      .divider {
        background: #d8dee4;
        height: 20px;
        margin: 0 2px;
        width: 1px;
      }
    `;

    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "ChatGPT selection shortcuts");

    ACTIONS.forEach((action, index) => {
      if (action.id === "screenshot" && index > 0) {
        const divider = document.createElement("span");
        divider.className = "divider";
        toolbar.appendChild(divider);
      }

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("mousedown", (event) => {
        suppressNextDocumentClick = true;
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void handleShortcutClick(action.id);
      });
      toolbar.appendChild(button);
    });

    shadow.append(style, toolbar);
  }

  async function handleShortcutClick(action) {
    const selectedText = latestSelectionText || readSelection()?.text || "";
    hidePopover();

    if (action === "screenshot") {
      await sendMessage({
        type: MESSAGE_TYPES.CAPTURE_VISIBLE_TAB,
        source: "selection-popover"
      });
      return;
    }

    await sendMessage({
      type: MESSAGE_TYPES.SELECTION_ACTION,
      action,
      selectedText,
      pageTitle: document.title || "",
      pageUrl: location.href
    });
  }

  async function sendMessage(payload) {
    try {
      const response = await chrome.runtime.sendMessage(payload);
      if (!response?.ok) {
        throw new Error(response?.error || "Extension action failed.");
      }
    } catch {
      // The extension may have been reloaded while the page was already open.
      // Failing quietly avoids breaking the host page.
    }
  }

  function hidePopover() {
    window.clearTimeout(showTimer);
    if (host) {
      host.style.display = "none";
    }
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function shouldInstallSelectionPopover() {
    if (!["http:", "https:"].includes(location.protocol)) {
      return false;
    }

    return !["chatgpt.com", "chat.openai.com"].includes(location.hostname);
  }
})();
