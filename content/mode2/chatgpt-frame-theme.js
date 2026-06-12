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
  const STYLE_ID = "chatgpt-sidebar-dark-frame-theme";
  const EXCLUDED_CHATGPT_PATH_PREFIXES = ["/api/", "/backend-api/", "/cdn/"];
  const URL_PERSIST_INTERVAL_MS = 750;
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
