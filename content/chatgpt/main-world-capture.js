(() => {
  if (window.__chatGptRelayMainWorldCaptureInstalled) {
    return;
  }

  window.__chatGptRelayMainWorldCaptureInstalled = true;

  const SOURCE = "chatgpt-relay-main-world-capture";
  const originalFetch = window.fetch;
  const streamState = {
    text: "",
    status: "installed",
    done: false,
    conversationKey: null,
    messageId: null,
    lastPublishedText: "",
    lastPublishedAt: 0
  };

  function normalizeText(value) {
    return stripChatGptStructuredReferences(String(value || ""))
      .replace(/\u00a0/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }

  function stripChatGptStructuredReferences(value) {
    return String(value || "")
      .replace(/([a-zA-Z_][\w-]*)([\s\S]*?)/g, (_match, kind, payload) => renderStructuredReferenceFallback(kind, payload))
      .replace(/\n{3,}/g, "\n\n");
  }

  function renderStructuredReferenceFallback(kind, payload) {
    const type = String(kind || "").toLowerCase();
    const rawPayload = String(payload || "").trim();

    if (type === "entity") {
      const parsed = tryParseJson(rawPayload);

      if (Array.isArray(parsed)) {
        const display = parsed.find((item, index) => index > 0 && typeof item === "string" && item && !/^turn\d+/i.test(item));
        return display || parsed.find((item) => typeof item === "string" && item && !/^turn\d+/i.test(item)) || "";
      }

      return "";
    }

    if (type === "genui") {
      const parsed = tryParseJson(rawPayload);
      const mathContent = parsed?.math_block_widget_always_prefetch_v2?.content;

      return typeof mathContent === "string" && mathContent.trim()
        ? `\n\n$$${mathContent.trim()}$$\n\n`
        : "";
    }

    return "";
  }

  function tryParseJson(value) {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }

  function getComparableText(value) {
    return normalizeText(value).replace(/\s+/g, " ").trim();
  }

  function getFetchUrl(input) {
    if (typeof input === "string") {
      return input;
    }

    if (input instanceof URL) {
      return input.href;
    }

    return input?.url || "";
  }

  function getFetchMethod(input, init) {
    return String(init?.method || input?.method || "GET").toUpperCase();
  }

  function isConversationStreamRequest(input, init) {
    const url = getFetchUrl(input);
    const method = getFetchMethod(input, init);

    if (method !== "POST") {
      return false;
    }

    try {
      const parsed = new URL(url, location.href);
      const path = parsed.pathname.toLowerCase();

      return parsed.hostname === location.hostname
        && path.includes("/backend-api/conversation")
        && !/\/backend-api\/conversation\/[^/]+/.test(path);
    } catch (_error) {
      return false;
    }
  }

  window.fetch = async function chatGptRelayFetchCapture(input, init) {
    const response = await originalFetch.apply(this, arguments);

    try {
      if (isConversationStreamRequest(input, init)) {
        resetStreamState();
        captureConversationResponse(response.clone()).catch((error) => {
          publish({
            error: error?.message || String(error),
            status: "capture_error"
          }, true);
        });
      }
    } catch (error) {
      publish({
        error: error?.message || String(error),
        status: "capture_setup_error"
      }, true);
    }

    return response;
  };

  function resetStreamState() {
    streamState.text = "";
    streamState.status = "streaming";
    streamState.done = false;
    streamState.conversationKey = null;
    streamState.messageId = null;
    streamState.lastPublishedText = "";
    streamState.lastPublishedAt = 0;
  }

  async function captureConversationResponse(response) {
    const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();

    if (contentType.includes("application/json")) {
      const data = await response.json();
      processConversationPayload(data, true);
      return;
    }

    if (!response.body?.getReader) {
      const text = await response.text();
      processSseText(text, true);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        const tail = decoder.decode();

        if (tail) {
          buffer += tail;
        }

        if (buffer.trim()) {
          processSseText(buffer, true);
        }

        streamState.done = true;
        publish({ done: true, status: streamState.status || "finished" }, true);
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split(/\n\n+/);
      buffer = chunks.pop() || "";

      for (const chunk of chunks) {
        processSseText(chunk, false);
      }
    }
  }

  function processSseText(text, streamDone) {
    const blocks = String(text || "").split(/\n\n+/);

    for (const block of blocks) {
      const lines = block.split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const dataLines = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());

      if (!dataLines.length && block.trim().startsWith("{")) {
        dataLines.push(block.trim());
      }

      for (const dataLine of dataLines) {
        if (!dataLine || dataLine === "[DONE]") {
          streamState.done = true;
          publish({ done: true, status: "finished" }, true);
          continue;
        }

        try {
          processConversationPayload(JSON.parse(dataLine), streamDone);
        } catch (_error) {
          // Ignore non-JSON SSE noise.
        }
      }
    }
  }

  function processConversationPayload(payload, streamDone) {
    const selected = selectBestAssistantPayload(payload);
    const patch = extractStreamingPatch(payload);

    if (selected?.conversationKey || payload?.conversation_id || payload?.conversationId) {
      streamState.conversationKey = selected?.conversationKey || payload?.conversation_id || payload?.conversationId;
    }

    if (selected?.messageId) {
      streamState.messageId = selected.messageId;
    }

    if (selected?.status) {
      streamState.status = selected.status;
    }

    if (patch?.status) {
      streamState.status = patch.status;
    }

    if (patch?.messageId) {
      streamState.messageId = patch.messageId;
    }

    if (patch?.conversationKey) {
      streamState.conversationKey = patch.conversationKey;
    }

    let changed = false;

    if (selected?.text && getComparableText(selected.text).length >= getComparableText(streamState.text).length) {
      streamState.text = normalizeText(selected.text);
      changed = true;
    }

    if (patch?.text) {
      if (patch.operation === "replace") {
        streamState.text = normalizeText(patch.text);
      } else if (patch.operation === "append") {
        streamState.text = normalizeText(`${streamState.text}${patch.text}`);
      } else if (getComparableText(patch.text).length >= getComparableText(streamState.text).length) {
        streamState.text = normalizeText(patch.text);
      }
      changed = true;
    }

    if (streamDone || selected?.done || patch?.done) {
      streamState.done = true;
      streamState.status = streamState.status || "finished_successfully";
    }

    if (changed || streamState.done) {
      publish({}, Boolean(streamDone || streamState.done));
    }
  }

  function extractStreamingPatch(payload) {
    const patches = [];

    visit(payload, (value) => {
      if (!value || typeof value !== "object") {
        return;
      }

      const path = String(value.p || value.path || value.pointer || "").toLowerCase();
      const operation = String(value.o || value.op || value.operation || "").toLowerCase();
      const type = String(value.type || value.event || "").toLowerCase();
      const raw = value.v ?? value.value ?? value.text_delta ?? value.delta ?? value.content ?? value.output_text ?? value.text;
      const text = typeof raw === "string" ? raw : extractPartText(raw);

      if (!text) {
        return;
      }

      const looksLikeContentPath = path && /message|content|parts|text|markdown/.test(path);
      const looksLikeDeltaType = /delta|append|output_text|content/.test(type) || /append|add|replace/.test(operation);

      if (!looksLikeContentPath && !looksLikeDeltaType) {
        return;
      }

      const patchOperation = /replace|set/.test(operation) ? "replace" : /append|add|delta/.test(operation) || /delta|append/.test(type) ? "append" : "full";
      patches.push({
        text,
        operation: patchOperation,
        messageId: value.message_id || value.messageId || value.id || null,
        conversationKey: value.conversation_id || value.conversationId || null,
        status: value.status || value.finish_reason || null,
        done: /done|finish|complete|stop|success/.test(type) || /finish|complete|success|stop/i.test(String(value.status || value.finish_reason || ""))
      });
    });

    if (!patches.length) {
      return null;
    }

    const appendPatches = patches.filter((patch) => patch.operation === "append");

    if (appendPatches.length) {
      return {
        text: appendPatches.map((patch) => patch.text).join(""),
        operation: "append",
        messageId: appendPatches.find((patch) => patch.messageId)?.messageId || null,
        conversationKey: appendPatches.find((patch) => patch.conversationKey)?.conversationKey || null,
        status: appendPatches.find((patch) => patch.status)?.status || "streaming",
        done: appendPatches.some((patch) => patch.done)
      };
    }

    patches.sort((a, b) => getComparableText(a.text).length - getComparableText(b.text).length);
    return patches[patches.length - 1];
  }

  function selectBestAssistantPayload(payload) {
    const candidates = [];

    visit(payload, (value) => {
      if (!value || typeof value !== "object") {
        return;
      }

      const role = value?.author?.role || value?.message?.author?.role || value?.role;
      const message = value?.message || value;

      if (role !== "assistant") {
        return;
      }

      const text = extractMessageText(message);

      if (!text) {
        return;
      }

      candidates.push({
        text,
        html: "",
        status: String(message.status || message?.metadata?.finish_details?.type || value.status || ""),
        done: /finish|complete|success|stop/i.test(String(message.status || value.status || "")),
        messageId: message.id || value.id || null,
        conversationKey: value.conversation_id || payload?.conversation_id || null
      });
    });

    if (!candidates.length) {
      return null;
    }

    candidates.sort((a, b) => getComparableText(a.text).length - getComparableText(b.text).length);
    return candidates[candidates.length - 1];
  }

  function extractMessageText(message) {
    const content = message?.content || {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const texts = [];

    for (const part of parts) {
      const text = extractPartText(part);

      if (text) {
        texts.push(text);
      }
    }

    if (texts.length) {
      return normalizeText(texts.join("\n\n"));
    }

    return normalizeText(content.text || content.result || content.markdown || message.text || message.result || message.markdown || "");
  }

  function extractPartText(part) {
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

    if (typeof part.markdown === "string") {
      return part.markdown;
    }

    if (typeof part.result === "string") {
      return part.result;
    }

    if (Array.isArray(part.parts)) {
      return part.parts.map(extractPartText).filter(Boolean).join("\n\n");
    }

    return "";
  }

  function visit(value, visitor, seen = new Set()) {
    if (!value || typeof value !== "object" || seen.has(value)) {
      return;
    }

    seen.add(value);
    visitor(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, visitor, seen);
      }
      return;
    }

    for (const item of Object.values(value)) {
      visit(item, visitor, seen);
    }
  }

  function publish(payload = {}, force = false) {
    const text = normalizeText(payload.text ?? streamState.text);
    const now = Date.now();

    if (!force && text === streamState.lastPublishedText && now - streamState.lastPublishedAt < 120) {
      return;
    }

    if (text || payload.done || payload.error || force) {
      streamState.lastPublishedText = text;
      streamState.lastPublishedAt = now;
    }

    window.postMessage({
      source: SOURCE,
      type: "CHATGPT_CONVERSATION_RESPONSE",
      timestamp: now,
      text,
      html: payload.html || "",
      status: payload.status || streamState.status || (payload.done ? "finished" : "streaming"),
      done: Boolean(payload.done ?? streamState.done),
      conversationKey: payload.conversationKey || streamState.conversationKey,
      messageId: payload.messageId || streamState.messageId,
      error: payload.error || null
    }, location.origin);
  }

  publish({ status: "installed" }, true);
})();
