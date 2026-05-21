(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};
  const contractMessages = relay.contracts?.messages || {};

  const types = Object.freeze({
    ping: contractMessages.ping || "CHATGPT_AUTOMATION_PING",
    dump: contractMessages.dump || "CHATGPT_AUTOMATION_DUMP",
    cancel: contractMessages.cancel || "CHATGPT_AUTOMATION_CANCEL",
    navigate: contractMessages.navigate || "CHATGPT_AUTOMATION_NAVIGATE",
    run: contractMessages.run || "CHATGPT_AUTOMATION_RUN",
    listProjectConversations: contractMessages.listProjectConversations || "CHATGPT_AUTOMATION_LIST_PROJECT_CONVERSATIONS",
    loadProjectConversation: contractMessages.loadProjectConversation || "CHATGPT_AUTOMATION_LOAD_PROJECT_CONVERSATION",
    event: contractMessages.event || "CHATGPT_AUTOMATION_EVENT",
    debug: contractMessages.debug || "CHATGPT_AUTOMATION_DEBUG",
    offscreenFrameReady: contractMessages.offscreenFrameReady || "OFFSCREEN_FRAME_READY",
    offscreenFrameCommand: contractMessages.offscreenFrameCommand || "OFFSCREEN_FRAME_COMMAND",
    offscreenFrameCommandResponse: contractMessages.offscreenFrameCommandResponse || "OFFSCREEN_FRAME_COMMAND_RESPONSE"
  });

  function send(payload) {
    try {
      chrome.runtime.sendMessage(payload).catch(() => null);
    } catch (_error) {
      // Runtime messaging can fail during page navigation or service-worker restart.
    }
  }

  function buildDebugPayload(requestId, stage, data = {}) {
    return {
      type: types.debug,
      requestId,
      stage,
      data: {
        ...data,
        url: location.href,
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
        at: new Date().toISOString()
      }
    };
  }

  runtime.messages = Object.freeze({
    types,
    send,
    buildDebugPayload
  });
})();
