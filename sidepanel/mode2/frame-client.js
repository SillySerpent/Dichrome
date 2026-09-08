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
  const onMessage = (event) => {
    if (event.source !== frame.contentWindow || !ORIGINS.includes(event.origin)) return;
    const task = pending.get(event.data?.requestId);
    if (!task || event.data.type !== `${task.type}-result`) return;
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
      pending.set(requestId, { type, timeout, resolve, reject });
      const payload = { ...values, type, requestId };
      for (const origin of ORIGINS) frame.contentWindow.postMessage(payload, origin);
    });
  }

  function cancel() {
    for (const task of pending.values()) {
      clearTimeout(task.timeout);
      task.reject(new Error("ChatGPT was reloaded. Try the action again."));
    }
    pending.clear();
  }

  return Object.freeze({ request, cancel });
}
