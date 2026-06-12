(() => {
  try {
    if (window.top === window) {
      return;
    }
  } catch (_error) {
    return;
  }

  if (!isDirectExtensionHostedFrame()) {
    return;
  }

  const STORAGE_KEYS = Object.freeze({
    CHATGPT_FRAME_URL: "dichrome.mode2.chatGptFrameUrl"
  });
  const FRAME_MESSAGE_TYPES = Object.freeze({
    ATTACH_SCREENSHOT: "dichrome:mode2:attach-screenshot",
    ATTACH_SCREENSHOT_RESULT: "dichrome:mode2:attach-screenshot-result"
  });
  const STYLE_ID = "chatgpt-sidebar-dark-frame-theme";
  const EXCLUDED_CHATGPT_PATH_PREFIXES = ["/api/", "/backend-api/", "/cdn/"];
  const URL_PERSIST_INTERVAL_MS = 750;
  const COMPOSER_READY_TIMEOUT_MS = 15000;
  let lastPersistedHref = "";

  applyDarkThemeHint();
  normalizeChatGptLinks();
  persistCurrentChatGptUrl();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      applyDarkThemeHint();
      normalizeChatGptLinks();
      persistCurrentChatGptUrl();
    }, { once: true });
  }

  const observer = new MutationObserver(applyDarkThemeHint);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme"]
  });

  const linkObserver = new MutationObserver(normalizeChatGptLinks);
  linkObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  document.addEventListener("pointerdown", prepareEmbeddedChatGptLink, true);
  document.addEventListener("mousedown", prepareEmbeddedChatGptLink, true);
  document.addEventListener("click", prepareEmbeddedChatGptLink, true);
  window.addEventListener("message", handleParentMessage);
  window.addEventListener("popstate", persistCurrentChatGptUrl);
  window.addEventListener("hashchange", persistCurrentChatGptUrl);
  window.addEventListener("pageshow", persistCurrentChatGptUrl);
  window.setInterval(persistCurrentChatGptUrl, URL_PERSIST_INTERVAL_MS);

  function applyDarkThemeHint() {
    if (!document.documentElement.classList.contains("dark")) {
      document.documentElement.classList.add("dark");
    }

    if (document.documentElement.dataset.theme !== "dark") {
      document.documentElement.dataset.theme = "dark";
    }

    if (document.documentElement.style.colorScheme !== "dark") {
      document.documentElement.style.colorScheme = "dark";
    }

    if (document.body) {
      const bodyBackground = document.body.style.getPropertyValue("background-color");
      if (bodyBackground !== "#0b0f14") {
        document.body.style.setProperty("background-color", "#0b0f14", "important");
      }
    }

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        html,
        body {
          background: #0b0f14 !important;
          color-scheme: dark !important;
        }
      `;
      (document.head || document.documentElement).append(style);
    }
  }

  function prepareEmbeddedChatGptLink(event) {
    const link = event.target?.closest?.("a[href]");
    const url = getAllowedChatGptUrl(link?.href);
    if (!url) {
      return;
    }

    link.target = "_self";
  }

  function normalizeChatGptLinks() {
    if (!document.body) {
      return;
    }

    for (const link of document.body.querySelectorAll("a[href]")) {
      if (getAllowedChatGptUrl(link.href)) {
        link.target = "_self";
      }
    }
  }

  function handleParentMessage(event) {
    if (event.source !== window.parent || !isExtensionParentOrigin(event.origin)) {
      return;
    }

    const message = event.data;
    if (message?.type !== FRAME_MESSAGE_TYPES.ATTACH_SCREENSHOT) {
      return;
    }

    void attachScreenshotFromParent(message, event.origin);
  }

  async function attachScreenshotFromParent(message, parentOrigin) {
    const requestId = typeof message.requestId === "string" ? message.requestId : "";

    try {
      const attachment = normalizeScreenshotAttachment(message.screenshot);

      await attachScreenshotToComposer(attachment, requestId || createId());
      postParentMessage(parentOrigin, {
        type: FRAME_MESSAGE_TYPES.ATTACH_SCREENSHOT_RESULT,
        requestId,
        ok: true,
        attachment: {
          name: attachment.name,
          mimeType: attachment.mimeType
        }
      });
    } catch (error) {
      postParentMessage(parentOrigin, {
        type: FRAME_MESSAGE_TYPES.ATTACH_SCREENSHOT_RESULT,
        requestId,
        ok: false,
        error: toErrorMessage(error)
      });
    }
  }

  async function attachScreenshotToComposer(attachment, requestId) {
    const {
      adapter,
      waitFor
    } = createMode2ComposerAdapter();
    const run = {
      cancelled: false
    };

    await waitFor(() => {
      const blockingUi = adapter.detectBlockingUi?.();
      if (blockingUi) {
        throw new Error(blockingUi);
      }

      return adapter.findComposer();
    }, COMPOSER_READY_TIMEOUT_MS, run, "Timed out waiting for the ChatGPT prompt box.");

    await adapter.attachFiles([attachment], requestId, run);
    adapter.findComposer()?.focus?.();
  }

  function createMode2ComposerAdapter() {
    const runtime = globalThis.ChatGptRelay?.runtime || {};
    const contracts = globalThis.ChatGptRelay?.contracts || {};
    const domUtils = runtime.domUtils;
    const waitRuntime = runtime.wait;
    const adapterOptions = runtime.adapterOptions;
    const adapterBase = runtime.adapterBase;
    const adapterComposerControls = runtime.adapterComposerControls;

    if (!domUtils || !waitRuntime || !adapterOptions || !adapterBase || !adapterComposerControls) {
      throw new Error("ChatGPT attachment runtime is not ready.");
    }

    const ChatGptDomAdapter = adapterBase.createClass({
      SNAPSHOT_LIMITS: {
        inputs: 30,
        buttons: 60,
        messages: 40
      },
      collectCandidates: domUtils.collectCandidates,
      findVisible: domUtils.findVisible,
      normalizeAdapterHints: adapterOptions.normalizeAdapterHints,
      normalizeText: domUtils.normalizeText,
      queryAllSafe: domUtils.queryAllSafe,
      resolveHintElements: domUtils.resolveHintElements,
      uniqueElements: domUtils.uniqueElements,
      waitFor: waitRuntime.waitFor
    });

    Object.assign(ChatGptDomAdapter.prototype, adapterComposerControls.createMethods({
      REQUEST_STATES: contracts.requestStates || {
        WORKSPACE_READY: "WORKSPACE_READY"
      },
      dataUrlToFile: domUtils.dataUrlToFile,
      emitState: () => null,
      findVisible: domUtils.findVisible,
      getElementLabel: domUtils.getElementLabel,
      isDisabled: domUtils.isDisabled,
      isTextInput: domUtils.isTextInput,
      isVisible: domUtils.isVisible,
      normalizeText: domUtils.normalizeText,
      prioritizeComposerButtons: domUtils.prioritizeComposerButtons,
      queryAllSafe: domUtils.queryAllSafe,
      setEditableText: domUtils.setEditableText,
      sleep: waitRuntime.sleep,
      waitFor: waitRuntime.waitFor
    }));

    return {
      adapter: new ChatGptDomAdapter([]),
      waitFor: waitRuntime.waitFor
    };
  }

  function normalizeScreenshotAttachment(screenshot) {
    const dataUrl = String(screenshot?.dataUrl || "");
    if (!isSupportedScreenshotDataUrl(dataUrl)) {
      throw new Error("Screenshot data was missing or was not a supported image.");
    }

    const mimeType = getDataUrlMimeType(dataUrl) || "image/png";

    return {
      kind: "image",
      dataUrl,
      mimeType,
      name: createScreenshotFileName(screenshot, mimeType)
    };
  }

  function isSupportedScreenshotDataUrl(dataUrl) {
    return /^data:image\/(?:png|jpeg|jpg|webp);base64,[a-z0-9+/=\s]+$/i.test(dataUrl);
  }

  function getDataUrlMimeType(dataUrl) {
    const match = dataUrl.match(/^data:([^;,]+)[;,]/i);

    return match ? match[1].toLowerCase().replace("image/jpg", "image/jpeg") : "";
  }

  function createScreenshotFileName(screenshot, mimeType) {
    const extension = mimeType === "image/webp"
      ? "webp"
      : mimeType === "image/jpeg"
        ? "jpg"
        : "png";
    const timestamp = fileSafeTimestamp(screenshot?.createdAt);

    return `visible-tab-${timestamp}.${extension}`;
  }

  function postParentMessage(parentOrigin, payload) {
    window.parent.postMessage(payload, parentOrigin);
  }

  function getAllowedChatGptUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (url.protocol === "https:" && (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com")) {
        if (EXCLUDED_CHATGPT_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
          return null;
        }

        return url;
      }
    } catch (_error) {
      // Ignore malformed links.
    }

    return null;
  }

  function isDirectExtensionHostedFrame() {
    try {
      const parentOrigin = window.location.ancestorOrigins?.[0] || "";
      if (parentOrigin) {
        return parentOrigin.startsWith("chrome-extension://");
      }
    } catch (_error) {
      // Fall back to document.referrer below.
    }

    return String(document.referrer || "").startsWith("chrome-extension://");
  }

  function isExtensionParentOrigin(origin) {
    return Boolean(chrome.runtime?.id && origin === `chrome-extension://${chrome.runtime.id}`);
  }

  function persistCurrentChatGptUrl() {
    const url = getAllowedChatGptUrl(location.href);
    if (!url) {
      return;
    }

    url.searchParams.delete("chatgpt_sidebar_reload");
    const href = url.href;
    if (href === lastPersistedHref) {
      return;
    }

    lastPersistedHref = href;
    chrome.storage?.local?.set?.({
      [STORAGE_KEYS.CHATGPT_FRAME_URL]: href
    }, () => {
      void chrome.runtime?.lastError;
    });
  }

  function fileSafeTimestamp(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) {
      return Date.now();
    }

    return date.toISOString().replace(/[:.]/g, "-");
  }

  function createId() {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function toErrorMessage(error) {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return String(error || "Unknown error");
  }
})();
