(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  function extractConversationKey(value) {
    try {
      const url = new URL(value);
      const match = url.pathname.match(/\/c\/([^/?#]+)/);

      return match?.[1] || null;
    } catch (_error) {
      return null;
    }
  }

  function sanitizeChatGptNavigationUrl(value) {
    try {
      const url = new URL(value);

      return isAllowedChatGptUrl(url) ? url.href : "";
    } catch (_error) {
      return "";
    }
  }

  function normalizeLocationForComparison(value) {
    try {
      const url = new URL(value);

      return `${url.origin}${url.pathname}`;
    } catch (_error) {
      return "";
    }
  }

  function isChatGptLocation(value) {
    try {
      return isAllowedChatGptUrl(new URL(value));
    } catch (_error) {
      return false;
    }
  }

  function isNonAutomationChatGptFrame(value) {
    try {
      const url = new URL(value);
      const path = url.pathname.toLowerCase();

      return path.startsWith("/backend-api/")
        || path.startsWith("/api/")
        || path.startsWith("/auth/")
        || path.includes("/sentinel/");
    } catch (_error) {
      return true;
    }
  }

  function isAllowedChatGptUrl(url) {
    return url.protocol === "https:" && (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com");
  }

  function extractProjectPathSegment(pathname) {
    const match = String(pathname || "").match(/^\/g\/(g-p-[^/]+)/i);

    return match?.[1] || "";
  }

  function normalizeProjectNavigationHref(href) {
    if (!href) {
      return "";
    }

    let url;

    try {
      url = new URL(href, location.origin);
    } catch (_error) {
      return "";
    }

    const projectSegment = extractProjectPathSegment(url.pathname);

    if (!projectSegment) {
      return "";
    }

    return `${url.origin}/g/${projectSegment}/project`;
  }

  function urlLooksProjectScopedForName(projectName) {
    const comparableName = normalizeComparableText(projectName);

    if (!comparableName || !/\/g\/g-p-/.test(location.pathname.toLowerCase())) {
      return false;
    }

    const title = normalizeComparableText(document.title || "");

    if (title === comparableName || title === `chatgpt - ${comparableName}` || title.includes(comparableName)) {
      return true;
    }

    const slug = normalizeComparableText(decodeURIComponent(location.pathname.split("/")[2] || ""));
    const slugLikeName = comparableName.replace(/[^a-z0-9]+/g, " ").trim();

    return Boolean(slugLikeName && slug.includes(slugLikeName.replace(/\s+/g, "-")))
      || slug.includes(comparableName.replace(/\s+/g, "-"));
  }

  function normalizeComparableText(value) {
    return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  runtime.chatGptUrl = Object.freeze({
    extractConversationKey,
    sanitizeChatGptNavigationUrl,
    normalizeLocationForComparison,
    isChatGptLocation,
    isNonAutomationChatGptFrame,
    isAllowedChatGptUrl,
    extractProjectPathSegment,
    normalizeProjectNavigationHref,
    urlLooksProjectScopedForName
  });
})();
