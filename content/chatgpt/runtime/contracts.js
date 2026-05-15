(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};

  relay.contracts = Object.freeze({
    offscreenFramePortName: "chatgpt-relay-offscreen-frame",
    requestStates: Object.freeze({
      CHATGPT_TAB_READY: "CHATGPT_TAB_READY",
      PROJECT_READY: "PROJECT_READY",
      CONVERSATION_READY: "CONVERSATION_READY",
      MODEL_SELECTED: "MODEL_SELECTED",
      PROMPT_INSERTED: "PROMPT_INSERTED",
      PROMPT_SENT: "PROMPT_SENT",
      WAITING_FOR_ASSISTANT_MESSAGE: "WAITING_FOR_ASSISTANT_MESSAGE",
      STREAMING_RESPONSE: "STREAMING_RESPONSE",
      RESPONSE_COMPLETE: "RESPONSE_COMPLETE",
      ERROR_STATE: "ERROR_STATE"
    }),
    visibilityModes: Object.freeze({
      OFFSCREEN_FRAME: "offscreen-frame",
      HIDDEN: "hidden",
      SINGLE_TAB: "single-tab",
      SIDECAR: "sidecar",
      FOCUSED: "focused"
    }),
    messages: Object.freeze({
      ping: "CHATGPT_AUTOMATION_PING",
      dump: "CHATGPT_AUTOMATION_DUMP",
      cancel: "CHATGPT_AUTOMATION_CANCEL",
      navigate: "CHATGPT_AUTOMATION_NAVIGATE",
      run: "CHATGPT_AUTOMATION_RUN",
      event: "CHATGPT_AUTOMATION_EVENT",
      debug: "CHATGPT_AUTOMATION_DEBUG",
      offscreenFrameReady: "OFFSCREEN_FRAME_READY",
      offscreenFrameCommand: "OFFSCREEN_FRAME_COMMAND",
      offscreenFrameCommandResponse: "OFFSCREEN_FRAME_COMMAND_RESPONSE"
    })
  });
})();
