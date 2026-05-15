(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  function createClient({
    emptyCanonicalHtmlFallback,
    extractConversationKey,
    isAllowedChatGptUrl,
    isNonAutomationChatGptFrame,
    normalizeText
  }) {
    let cachedChatGptAccessToken = null;
    let cachedChatGptAccessTokenAt = 0;
    const state = {
      installed: false,
      injectedAt: 0,
      requestId: null,
      startedAt: 0,
      latest: null,
      events: []
    };

    function install() {
      if (state.installed || isNonAutomationChatGptFrame(location.href)) {
        return;
      }

      state.installed = true;
      state.injectedAt = Date.now();

      const inject = () => {
        if (document.getElementById("chatgpt-relay-main-world-capture")) {
          return;
        }

        const script = document.createElement("script");
        script.id = "chatgpt-relay-main-world-capture";
        script.src = chrome.runtime.getURL("content/chatgpt/main-world-capture.js");
        script.async = false;
        (document.documentElement || document.head || document.body)?.appendChild(script);
        script.remove();
      };

      if (document.documentElement || document.head || document.body) {
        inject();
        return;
      }

      document.addEventListener("DOMContentLoaded", inject, { once: true });
    }

    function resetForRequest(requestId) {
      state.requestId = requestId || null;
      state.startedAt = Date.now();
      state.latest = null;
      state.events = [];
    }

    function handleMessage(event) {
      if (event.source !== window || event.origin !== location.origin) {
        return;
      }

      const payload = event.data;

      if (!payload || payload.source !== "chatgpt-relay-main-world-capture" || payload.type !== "CHATGPT_CONVERSATION_RESPONSE") {
        return;
      }

      const timestamp = Number(payload.timestamp || Date.now());

      if (state.startedAt && timestamp < state.startedAt - 2000) {
        return;
      }

      const text = normalizeText(payload.text || "");
      const current = state.latest;
      const next = {
        text,
        html: payload.html || emptyCanonicalHtmlFallback(text),
        status: payload.status || (payload.done ? "finished_successfully" : "streaming"),
        done: Boolean(payload.done),
        conversationKey: payload.conversationKey || extractConversationKey(location.href) || null,
        messageId: payload.messageId || null,
        timestamp
      };

      state.events.push({
        textLength: text.length,
        status: next.status,
        done: next.done,
        conversationKey: next.conversationKey,
        messageId: next.messageId,
        timestamp
      });

      if (state.events.length > 30) {
        state.events.shift();
      }

      if (!current || text.length >= normalizeText(current.text || "").length || next.done) {
        state.latest = next;
      }
    }

    function getLatestAssistantResponse(requestId, { afterMs = 0 } = {}) {
      if (state.requestId && requestId && state.requestId !== requestId) {
        return null;
      }

      const latest = state.latest;

      if (!latest || !latest.text || (afterMs && latest.timestamp < afterMs)) {
        return null;
      }

      return latest;
    }

    async function getAccessToken() {
      if (cachedChatGptAccessToken && Date.now() - cachedChatGptAccessTokenAt < 60_000) {
        return cachedChatGptAccessToken;
      }

      try {
        const response = await fetch(`${location.origin}/api/auth/session`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: {
            accept: "application/json"
          }
        });

        if (!response.ok) {
          return null;
        }

        const data = await response.json();
        const token = data?.accessToken || data?.access_token || null;

        if (typeof token === "string" && token) {
          cachedChatGptAccessToken = token;
          cachedChatGptAccessTokenAt = Date.now();
          return token;
        }
      } catch (_error) {
        return null;
      }

      return null;
    }

    function collectDebug() {
      return {
        installed: state.installed,
        requestId: state.requestId,
        startedAt: state.startedAt ? new Date(state.startedAt).toISOString() : null,
        latestTextLength: normalizeText(state.latest?.text || "").length,
        latestStatus: state.latest?.status || null,
        latestDone: Boolean(state.latest?.done),
        latestConversationKey: state.latest?.conversationKey || null,
        eventCount: state.events.length,
        recentEvents: state.events.slice(-5)
      };
    }

    return Object.freeze({
      collectDebug,
      getAccessToken,
      getLatestAssistantResponse,
      handleMessage,
      install,
      resetForRequest
    });
  }

  runtime.networkCaptureClient = Object.freeze({
    createClient
  });
})();
