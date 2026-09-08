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
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        :root {
          color-scheme: dark;
          --bg-primary: #212121;
          --bg-secondary: #2f2f2f;
          --bg-tertiary: #393939;
          --main-surface-primary: #212121;
          --main-surface-secondary: #2f2f2f;
          --main-surface-tertiary: #393939;
          --message-surface: #2f2f2f;
          --text-primary: #ececec;
          --text-secondary: #b4b4b4;
          --text-tertiary: #a0a0a0;
          --border-light: #ffffff26;
        }
        html, body { background: #212121 !important; color: #ececec; min-width: 0 !important; }
      `;
      (document.head || document.documentElement).append(style);
    }
    // Only affect this embedded document; never change the account's saved theme.
    if (document.documentElement.classList.contains("light")) document.documentElement.classList.remove("light");
    if (!document.documentElement.classList.contains("dark")) document.documentElement.classList.add("dark");
    if (document.documentElement.style.colorScheme !== "dark") document.documentElement.style.colorScheme = "dark";
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
