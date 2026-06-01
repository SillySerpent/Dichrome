import { sanitizeResponseHtml } from "../../shared/response-formatting.js";

const RESPONSE_AUTOSCROLL_BOTTOM_THRESHOLD_PX = 36;
const MIN_DISPLAY_MATH_SCALE = 0.38;

export function createResponseView({ responseText }) {
  const scrollState = {
    autoScroll: true,
    lastProgrammaticScrollAt: 0
  };
  let mathFitObserver = null;
  const observedMathFitRoots = new WeakSet();

  function bindInteractions() {
    document.addEventListener("click", (event) => {
      const button = event.target?.closest?.(".response-copy-button");

      if (!button || !button.closest(".response-content")) {
        return;
      }

      void copyResponseBlock(button);
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

    window.addEventListener("resize", () => {
      fitDisplayMathBlocks(document.body);
    }, {
      passive: true
    });
  }

  function setHtml(html, options = {}) {
    const shouldScroll = Boolean(options.forceScroll) || scrollState.autoScroll || isScrolledNearBottom();
    const previousScrollTop = responseText.scrollTop;
    responseText.innerHTML = sanitizeResponseHtml(html || "");
    enhanceContainer(responseText);

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

  function enhanceContainer(container) {
    if (!container) {
      return;
    }

    enhanceCopyableCodeBlocks(container);
    enhanceCopyableMathBlocks(container);
    scheduleDisplayMathFit(container);
  }

  function enhanceCopyableCodeBlocks(container) {
    for (const pre of Array.from(container.querySelectorAll("pre"))) {
      if (pre.closest(".response-copy-wrapper")) {
        continue;
      }

      const wrapper = createCopyWrapper("code", "Copy code block");
      pre.replaceWith(wrapper);
      wrapper.append(pre);
    }
  }

  function enhanceCopyableMathBlocks(container) {
    for (const math of Array.from(container.querySelectorAll(".math-display"))) {
      if (math.closest(".response-copy-wrapper")) {
        continue;
      }

      const wrapper = createCopyWrapper("math", "Copy math source");
      math.replaceWith(wrapper);
      wrapper.append(math);
    }
  }

  function createCopyWrapper(kind, label) {
    const wrapper = document.createElement("div");
    wrapper.className = `response-copy-wrapper ${kind}-copy-wrapper`;
    const toolbar = document.createElement("div");
    toolbar.className = "response-copy-toolbar";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "response-copy-button";
    button.textContent = "Copy";
    button.dataset.copyKind = kind;
    button.setAttribute("aria-label", label);
    button.title = label;
    toolbar.append(button);
    wrapper.append(toolbar);

    return wrapper;
  }

  function scheduleDisplayMathFit(container) {
    fitDisplayMathBlocks(container);

    const scheduleFrame = typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : (callback) => window.setTimeout(callback, 0);

    scheduleFrame(() => {
      fitDisplayMathBlocks(container);
      observeMathFitRoot(container);
    });
  }

  function observeMathFitRoot(container) {
    if (!window.ResizeObserver || !container?.isConnected) {
      return;
    }

    const root = container.closest?.(".chat-messages") || container;

    if (!root || observedMathFitRoots.has(root)) {
      return;
    }

    if (!mathFitObserver) {
      mathFitObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          fitDisplayMathBlocks(entry.target);
        }
      });
    }

    observedMathFitRoots.add(root);
    mathFitObserver.observe(root);
  }

  function fitDisplayMathBlocks(container) {
    if (!container?.querySelectorAll) {
      return;
    }

    for (const math of Array.from(container.querySelectorAll(".math-display"))) {
      fitDisplayMathBlock(math);
    }
  }

  function fitDisplayMathBlock(math) {
    const rendered = math.querySelector(".math-rendered");

    if (!rendered) {
      return;
    }

    math.classList.remove("math-fit-scaled", "math-fit-scrollable");
    math.style.removeProperty("--math-fit-scale");

    const availableWidth = getAvailableMathWidth(math);

    if (availableWidth <= 0) {
      return;
    }

    const naturalWidth = rendered.scrollWidth;

    if (naturalWidth <= availableWidth) {
      return;
    }

    const naturalScale = availableWidth / naturalWidth;
    const scale = Math.max(MIN_DISPLAY_MATH_SCALE, Math.min(1, naturalScale));
    math.style.setProperty("--math-fit-scale", scale.toFixed(3));
    math.classList.add("math-fit-scaled");

    if (naturalWidth * scale > availableWidth + 1) {
      math.classList.add("math-fit-scrollable");
    }
  }

  function getAvailableMathWidth(math) {
    const style = window.getComputedStyle?.(math);
    const paddingLeft = Number.parseFloat(style?.paddingLeft || "0") || 0;
    const paddingRight = Number.parseFloat(style?.paddingRight || "0") || 0;

    return Math.max(0, math.clientWidth - paddingLeft - paddingRight);
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
    enhanceContainer,
    setHtml,
    resetAutoScroll
  });
}
