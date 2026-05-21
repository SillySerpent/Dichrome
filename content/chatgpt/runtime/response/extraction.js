(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  function selectLatestAssistantResponseFromConversationData(data, { afterMs = 0, excludedMessageIds = [] } = {}) {
    const excludedIds = new Set((excludedMessageIds || []).filter(Boolean).map(String));
    const nodes = Object.values(data?.mapping || {})
      .map((node) => ({
        node,
        message: node?.message || null
      }))
      .filter(({ message }) => message?.author?.role === "assistant")
      .map(({ node, message }) => {
        const text = extractConversationMessageText(message);
        const timeMs = getConversationMessageTimeMs(message, node);

        return {
          message,
          text,
          html: emptyCanonicalHtmlFallback(text),
          timeMs,
          status: String(message.status || message.metadata?.finish_details?.type || ""),
          messageId: message.id || node.id || null
        };
      })
      .filter((candidate) => normalizeText(candidate.text));

    if (!nodes.length) {
      return null;
    }

    const eligibleNodes = nodes.filter((candidate) => {
      if (candidate.messageId && excludedIds.has(String(candidate.messageId))) {
        return false;
      }

      return !isTransientAssistantStatusText(candidate.text);
    });

    if (!eligibleNodes.length) {
      return null;
    }

    const candidates = afterMs
      ? eligibleNodes.filter((candidate) => candidate.timeMs && candidate.timeMs >= afterMs)
      : eligibleNodes;

    if (!candidates.length) {
      return null;
    }

    candidates.sort((a, b) => {
      if (a.timeMs !== b.timeMs) {
        return a.timeMs - b.timeMs;
      }

      return String(a.messageId || "").localeCompare(String(b.messageId || ""));
    });

    return candidates[candidates.length - 1] || null;
  }

  function selectConversationMessagesFromConversationData(data, { limit = 0 } = {}) {
    const mapping = data?.mapping && typeof data.mapping === "object" ? data.mapping : {};
    const nodes = orderConversationNodes(mapping, data?.current_node || data?.currentNode || "");
    const messages = [];
    const seen = new Set();

    for (const { node, nodeId } of nodes) {
      const normalized = normalizeConversationMessage(node?.message || null, {
        node,
        nodeId
      });

      if (!normalized) {
        continue;
      }

      const identity = normalized.id
        ? `id:${normalized.id}`
        : `fallback:${normalized.role}:${normalized.createdAt || ""}:${normalized.text.length}:${normalized.text.slice(0, 120)}`;

      if (seen.has(identity)) {
        continue;
      }

      seen.add(identity);
      messages.push(normalized);
    }

    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(0, Number(limit)) : 0;

    return safeLimit ? messages.slice(-safeLimit) : messages;
  }

  function extractConversationTitleFromConversationData(data) {
    return normalizeText(
      data?.title
      || data?.conversation?.title
      || data?.metadata?.title
      || data?.conversation_template?.title
      || ""
    );
  }

  function orderConversationNodes(mapping, currentNodeId) {
    const path = [];
    const seenPath = new Set();
    let cursorId = currentNodeId ? String(currentNodeId) : "";

    while (cursorId && mapping[cursorId] && !seenPath.has(cursorId)) {
      seenPath.add(cursorId);
      path.push({
        node: mapping[cursorId],
        nodeId: cursorId
      });
      cursorId = mapping[cursorId]?.parent ? String(mapping[cursorId].parent) : "";
    }

    if (path.length > 1) {
      return path.reverse();
    }

    return Object.entries(mapping)
      .map(([nodeId, node]) => ({
        node,
        nodeId
      }))
      .sort((a, b) => {
        const aTime = getConversationMessageTimeMs(a.node?.message, a.node);
        const bTime = getConversationMessageTimeMs(b.node?.message, b.node);

        if (aTime !== bTime) {
          return aTime - bTime;
        }

        return String(a.nodeId).localeCompare(String(b.nodeId));
      });
  }

  function normalizeConversationMessage(message, { node, nodeId } = {}) {
    if (!message || typeof message !== "object") {
      return null;
    }

    if (message.metadata?.is_visually_hidden_from_conversation) {
      return null;
    }

    const role = normalizeConversationRole(message?.author?.role || message.role || "");

    if (!role) {
      return null;
    }

    const text = extractConversationMessageText(message);

    if (!text) {
      return null;
    }

    const createTimeMs = getConversationMessageTimeMs({
      create_time: message.create_time
    }, node);
    const updateTimeMs = getConversationMessageTimeMs({
      update_time: message.update_time || message.create_time
    }, node);

    return {
      id: message.id || nodeId || "",
      role,
      text,
      html: "",
      createdAt: createTimeMs ? new Date(createTimeMs).toISOString() : null,
      updatedAt: updateTimeMs ? new Date(updateTimeMs).toISOString() : null
    };
  }

  function normalizeConversationRole(role) {
    const normalized = String(role || "").toLowerCase().trim();

    if (normalized === "user" || normalized === "human") {
      return "user";
    }

    if (normalized === "assistant") {
      return "assistant";
    }

    return "";
  }

  function extractConversationMessageText(message) {
    const content = message?.content || {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const contentText = [];

    for (const part of parts) {
      const text = extractConversationPartText(part);

      if (text) {
        contentText.push(text);
      }
    }

    if (contentText.length) {
      return normalizeText(contentText.join("\n\n"));
    }

    return normalizeText(
      content.text
      || content.result
      || content.markdown
      || message.text
      || message.result
      || message.markdown
      || message.metadata?.user_message_text
      || message.metadata?.message_text
      || ""
    );
  }

  function extractConversationPartText(part) {
    if (typeof part === "string") {
      return part;
    }

    if (!part || typeof part !== "object") {
      return "";
    }

    if (typeof part.text === "string") {
      return part.text;
    }

    if (typeof part.content === "string") {
      return part.content;
    }

    if (typeof part.result === "string") {
      return part.result;
    }

    if (Array.isArray(part.parts)) {
      return part.parts.map(extractConversationPartText).filter(Boolean).join("\n\n");
    }

    return "";
  }

  function getConversationMessageTimeMs(message, node) {
    const raw = message?.update_time || message?.create_time || node?.message?.update_time || node?.message?.create_time || 0;
    const numeric = Number(raw) || 0;

    if (!numeric) {
      return 0;
    }

    return numeric > 100000000000 ? numeric : numeric * 1000;
  }

  function shouldPreferBackendResponse(backendText, domText, promptText) {
    const backend = normalizeText(backendText);
    const dom = normalizeText(domText);

    if (!backend) {
      return false;
    }

    if (!dom) {
      return true;
    }

    if (isLowConfidenceDomResponse(dom, promptText) && backend.length >= dom.length) {
      return true;
    }

    return backend.length >= Math.max(dom.length + 24, dom.length * 1.4);
  }

  function isLowConfidenceDomResponse(text, promptText = "") {
    const normalized = normalizeText(text);

    if (!normalized) {
      return true;
    }

    if (isTransientAssistantStatusText(normalized)) {
      return true;
    }

    const prompt = normalizeComparableText(promptText);
    const looksLikeDefinitionOrExplanation = /define|explain|selected word|selected phrase|plain language|multiple meanings|surrounding wording|summari[sz]e|analy[sz]e|describe/.test(prompt);
    const isSingleToken = /^[\w.-]{1,24}$/.test(normalized);

    return looksLikeDefinitionOrExplanation && isSingleToken;
  }

  function isTransientAssistantStatusText(value) {
    const normalized = normalizeText(value).replace(/[ \t]+/g, " ");

    if (!normalized || normalized.length > 96 || normalized.includes("\n\n")) {
      return false;
    }

    const comparable = normalized
      .toLowerCase()
      .replace(/[.!?…]+$/g, "")
      .trim();

    if ([
      "thinking",
      "reasoning",
      "working",
      "generating",
      "processing",
      "analyzing",
      "analysing",
      "reading",
      "searching"
    ].includes(comparable)) {
      return true;
    }

    return /^thought for\b/.test(comparable)
      || /^(thinking|reasoning|working|generating|processing|analy[sz]ing|reading|searching)\s+(for|about)\b/.test(comparable);
  }

  function isFinishedBackendStatus(status) {
    return /finish|complete|success|stop/i.test(String(status || ""));
  }

  function emptyCanonicalHtmlFallback(text) {
    // Keep plain text canonical; the side panel owns final rendering and sanitization.
    void text;
    return "";
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

  runtime.responseExtraction = Object.freeze({
    selectLatestAssistantResponseFromConversationData,
    selectConversationMessagesFromConversationData,
    extractConversationTitleFromConversationData,
    extractConversationMessageText,
    extractConversationPartText,
    getConversationMessageTimeMs,
    shouldPreferBackendResponse,
    isLowConfidenceDomResponse,
    isFinishedBackendStatus,
    isTransientAssistantStatusText,
    emptyCanonicalHtmlFallback
  });
})();
