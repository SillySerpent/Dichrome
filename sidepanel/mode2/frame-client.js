const ORIGINS = ["https://chatgpt.com", "https://chat.openai.com"];
export const FRAME_MESSAGES = Object.freeze({
  PING: "dichrome:mode2:ping",
  INSERT_PROMPT: "dichrome:mode2:insert-prompt",
  ATTACH_SCREENSHOT: "dichrome:mode2:attach-screenshot"
});

export function sanitizeChatGptUrl(value) {
  try {
    const url = new URL(value);
    if (!ORIGINS.includes(url.origin) || url.username || url.password
      || /^\/(api|backend-api|cdn)(\/|$)/.test(url.pathname)) return null;
    url.searchParams.delete("chatgpt_sidebar_reload");
    return url.href;
  } catch { return null; }
}

export function createFrameClient(frame) {
  const pending = new Map();
  let peer = null;
  const onMessage = (event) => {
    if (event.source !== frame.contentWindow || !ORIGINS.includes(event.origin)) return;
    const message = event.data;
    if (message?.type === "dichrome:mode2:bridge-ready") {
      if (typeof message.documentId !== "string" || !message.documentId || message.documentId.length > 128) return;
      if (peer && peer.documentId !== message.documentId) cancel();
      peer = { origin: event.origin, documentId: message.documentId };
      for (const task of pending.values()) if (!task.sent) send(task);
      return;
    }
    if (message?.type === "dichrome:mode2:bridge-unload") {
      if (peer && peer.documentId === message.documentId) disconnect();
      return;
    }
    const task = pending.get(message?.requestId);
    if (!task?.sent || event.origin !== task.origin || message.documentId !== task.documentId
      || message.type !== `${task.type}-result`) return;
    clearTimeout(task.timeout);
    pending.delete(event.data.requestId);
    if (event.data.ok) task.resolve(event.data);
    else task.reject(new Error(event.data.error || "ChatGPT could not complete this action."));
  };
  window.addEventListener("message", onMessage);

  function request(type, values = {}, timeoutMs = 20000) {
    if (!sanitizeChatGptUrl(frame.src) || !frame.contentWindow) {
      return Promise.reject(new Error("ChatGPT is still connecting. Try again or copy your context."));
    }
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("ChatGPT did not respond. Check sign-in, then retry or use Copy."));
      }, timeoutMs);
      const task = { type, values, requestId, timeout, resolve, reject, sent: false };
      pending.set(requestId, task);
      if (peer) send(task);
    });
  }

  function send(task) {
    task.sent = true;
    task.origin = peer.origin;
    task.documentId = peer.documentId;
    const payload = { ...task.values, type: task.type, requestId: task.requestId, documentId: task.documentId };
    try {
      frame.contentWindow.postMessage(payload, task.origin);
    } catch (error) {
      clearTimeout(task.timeout);
      pending.delete(task.requestId);
      task.reject(error);
    }
  }

  function cancel() {
    for (const task of pending.values()) {
      clearTimeout(task.timeout);
      task.reject(new Error("ChatGPT was reloaded. Try the action again."));
    }
    pending.clear();
  }

  function disconnect() {
    peer = null;
    cancel();
  }

  return Object.freeze({ request, cancel, disconnect });
}
