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
  const EXCLUDED_CHATGPT_PATH_PREFIXES = ["/api/", "/backend-api/", "/cdn/"];
  const URL_PERSIST_INTERVAL_MS = 750;
  let lastPersistedHref = "";

  normalizeChatGptLinks();
  persistCurrentChatGptUrl();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      normalizeChatGptLinks();
      persistCurrentChatGptUrl();
    }, { once: true });
  }

  const linkObserver = new MutationObserver(normalizeChatGptLinks);
  linkObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  document.addEventListener("pointerdown", prepareEmbeddedChatGptLink, true);
  document.addEventListener("mousedown", prepareEmbeddedChatGptLink, true);
  document.addEventListener("click", prepareEmbeddedChatGptLink, true);
  window.addEventListener("popstate", persistCurrentChatGptUrl);
  window.addEventListener("hashchange", persistCurrentChatGptUrl);
  window.addEventListener("pageshow", persistCurrentChatGptUrl);
  window.addEventListener("pageshow", publishNavigationDiagnostic, { once: true });
  window.setInterval(persistCurrentChatGptUrl, URL_PERSIST_INTERVAL_MS);

  function publishNavigationDiagnostic() {
    if (!chrome.runtime?.id || window.origin !== location.origin
      || !["https://chatgpt.com", "https://chat.openai.com"].includes(window.origin)
      || String(window.name || "").startsWith("dichrome-offscreen-")) return;
    try {
      const navigation = performance.getEntriesByType("navigation")[0];
      const status = navigation?.responseStatus;
      window.parent.postMessage({
        type: "dichrome:mode2:frame-diagnostic",
        navigationType: navigation?.type || "unavailable",
        responseStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null
      }, `chrome-extension://${chrome.runtime.id}`);
    } catch (_error) {
      // Diagnostics are best effort if the extension frame is closing.
    }
  }

  function prepareEmbeddedChatGptLink(event) {
    const link = event.target?.closest?.("a[href]");
    if (!link) {
      return;
    }
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

  function getAllowedChatGptUrl(value) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }
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

})();
