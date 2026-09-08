(() => {
  if (window.top === window || !chrome.runtime?.id) return;
  const parentOrigin = `chrome-extension://${chrome.runtime.id}`;
  if ((location.ancestorOrigins?.[0] || new URL(document.referrer || "about:blank").origin) !== parentOrigin) return;
  const COMPOSER_READY_TIMEOUT_MS = 15000;
  let activeOperation = false;
  const completed = new Map();

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== parentOrigin) return;
    const { type, requestId } = event.data || {};
    if (typeof requestId !== "string" || !requestId || requestId.length > 128) return;
    if (!["dichrome:mode2:ping", "dichrome:mode2:insert-prompt", "dichrome:mode2:attach-screenshot"].includes(type)) return;
    void handleRequest(event.data);
  });

  async function handleRequest(message) {
    const { type, requestId } = message;
    const reply = (result) => postParentMessage(parentOrigin, { ...result, type: `${type}-result`, requestId });
    if (type === "dichrome:mode2:ping") {
      try {
        const { adapter } = createMode2ComposerAdapter();
        reply({ ok: true, ready: Boolean(adapter.findComposer()) && !adapter.detectBlockingUi?.() });
      } catch { reply({ ok: true, ready: false }); }
      return;
    }
    if (completed.has(requestId)) { reply(completed.get(requestId)); return; }
    if (activeOperation) { reply({ ok: false, error: "Another context action is in progress. Try again in a moment." }); return; }
    activeOperation = true;
    let result;
    try {
      const { adapter, waitFor } = createMode2ComposerAdapter();
      const run = { cancelled: false };
      const composer = await waitFor(() => {
        const blockingUi = adapter.detectBlockingUi?.();
        if (blockingUi) throw new Error(blockingUi);
        return adapter.findComposer();
      }, COMPOSER_READY_TIMEOUT_MS, run, "Sign in to ChatGPT and wait for the prompt box, then try again.");
      if (type === "dichrome:mode2:insert-prompt") {
        const prompt = typeof message.prompt === "string" ? message.prompt.trim() : "";
        if (!prompt || prompt.length > 30000) throw new Error("The prompt must contain between 1 and 30,000 characters.");
        const existing = readComposer(composer).trim();
        if (existing && existing !== prompt) throw new Error("ChatGPT already has a draft. Clear it there first, or use Copy to add this text yourself.");
        if (!existing) await adapter.insertPrompt(composer, prompt);
        const normalize = (text) => text.replace(/\s+/g, " ").trim();
        if (normalize(readComposer(composer)) !== normalize(prompt)) throw new Error("ChatGPT did not retain the prompt. Use Copy to paste it instead.");
      } else {
        const attachment = normalizeScreenshotAttachment(message.screenshot);
        await adapter.attachFiles([attachment], requestId, run);
      }
      composer.focus();
      result = { ok: true };
    } catch (error) {
      result = { ok: false, error: toErrorMessage(error) };
    } finally { activeOperation = false; }
    completed.set(requestId, result);
    if (completed.size > 100) completed.delete(completed.keys().next().value);
    reply(result);
  }

  function readComposer(composer) {
    return typeof composer.value === "string" ? composer.value : composer.innerText || composer.textContent || "";
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

  function fileSafeTimestamp(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) {
      return Date.now();
    }

    return date.toISOString().replace(/[:.]/g, "-");
  }

  function toErrorMessage(error) {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return String(error || "Unknown error");
  }
})();
