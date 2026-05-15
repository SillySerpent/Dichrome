import { sanitizeResponseHtml } from "../../shared/response-formatting.js";

const RESPONSE_AUTOSCROLL_BOTTOM_THRESHOLD_PX = 36;

export function createResponseView({ responseText }) {
  const scrollState = {
    autoScroll: true,
    lastProgrammaticScrollAt: 0
  };

  function bindInteractions() {
    responseText.addEventListener("click", (event) => {
      const button = event.target?.closest?.(".response-copy-button");

      if (button) {
        void copyResponseBlock(button);
      }
    });

    responseText.addEventListener("scroll", () => {
      const now = Date.now();

      if (now - scrollState.lastProgrammaticScrollAt < 180) {
        return;
      }

      scrollState.autoScroll = isScrolledNearBottom();
    }, {
      passive: true
    });
  }

  function setHtml(html, options = {}) {
    const shouldScroll = Boolean(options.forceScroll) || scrollState.autoScroll || isScrolledNearBottom();
    const previousScrollTop = responseText.scrollTop;
    responseText.innerHTML = sanitizeResponseHtml(html || "");
    enhanceBlocks();

    if (shouldScroll) {
      scrollToBottom();
    } else {
      responseText.scrollTop = previousScrollTop;
    }
  }

  function resetAutoScroll() {
    scrollState.autoScroll = true;
  }

  function isScrolledNearBottom() {
    const distanceFromBottom = responseText.scrollHeight - responseText.clientHeight - responseText.scrollTop;
    return distanceFromBottom <= RESPONSE_AUTOSCROLL_BOTTOM_THRESHOLD_PX;
  }

  function scrollToBottom() {
    scrollState.lastProgrammaticScrollAt = Date.now();
    responseText.scrollTop = responseText.scrollHeight;
  }

  function enhanceBlocks() {
    enhanceCopyableCodeBlocks();
    enhanceCopyableMathBlocks();
  }

  function enhanceCopyableCodeBlocks() {
    for (const pre of Array.from(responseText.querySelectorAll("pre"))) {
      if (pre.closest(".response-copy-wrapper")) {
        continue;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "response-copy-wrapper code-copy-wrapper";
      const toolbar = document.createElement("div");
      toolbar.className = "response-copy-toolbar";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "response-copy-button";
      button.textContent = "Copy";
      button.dataset.copyKind = "code";
      toolbar.append(button);
      pre.replaceWith(wrapper);
      wrapper.append(toolbar, pre);
    }
  }

  function enhanceCopyableMathBlocks() {
    for (const math of Array.from(responseText.querySelectorAll(".math-display"))) {
      if (math.closest(".response-copy-wrapper")) {
        continue;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "response-copy-wrapper math-copy-wrapper";
      const toolbar = document.createElement("div");
      toolbar.className = "response-copy-toolbar";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "response-copy-button";
      button.textContent = "Copy";
      button.dataset.copyKind = "math";
      toolbar.append(button);
      math.replaceWith(wrapper);
      wrapper.append(toolbar, math);
    }
  }

  async function copyResponseBlock(button) {
    const wrapper = button.closest(".response-copy-wrapper");
    const kind = button.dataset.copyKind;
    let text = "";

    if (kind === "code") {
      text = wrapper?.querySelector("pre code")?.textContent || wrapper?.querySelector("pre")?.textContent || "";
    } else if (kind === "math") {
      text = wrapper?.querySelector(".math-source")?.textContent || wrapper?.querySelector(".math-rendered")?.textContent || "";
    }

    text = text.trim();

    if (!text) {
      return;
    }

    await writeClipboardText(text);
    const previous = button.textContent;
    button.textContent = "Copied";
    window.setTimeout(() => {
      button.textContent = previous || "Copy";
    }, 900);
  }

  async function writeClipboardText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  return Object.freeze({
    bindInteractions,
    setHtml,
    resetAutoScroll
  });
}
