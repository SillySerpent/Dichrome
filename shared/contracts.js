export const CHATGPT_HOME_URL = "https://chatgpt.com/";
export const CHATGPT_HOSTS = Object.freeze(["chatgpt.com", "chat.openai.com"]);
export const CHATGPT_LOAD_TIMEOUT_MS = 30000;

export const HISTORY_LIMIT = 20;
export const EVENT_LIMIT = 100;
export const PROJECT_CONVERSATION_HISTORY_LIMIT = 24;
export const PROJECT_CONVERSATION_MESSAGE_BATCH_SIZE = 12;

export const STORAGE_KEYS = Object.freeze({
  PANEL_STATE: "panelState",
  LAST_SOURCE_TAB: "lastSourceTab",
  AUTOMATION_SETTINGS: "chatGptAutomationSettings",
  AUTOMATION_SESSION: "chatGptAutomationSession"
});

export const REQUEST_STATES = Object.freeze({
  IDLE: "IDLE",
  SELECTED_TEXT_RECEIVED: "SELECTED_TEXT_RECEIVED",
  WORKSPACE_READY: "WORKSPACE_READY",
  PROJECT_READY: "PROJECT_READY",
  CONVERSATION_READY: "CONVERSATION_READY",
  MODEL_SELECTED: "MODEL_SELECTED",
  PROMPT_INSERTED: "PROMPT_INSERTED",
  PROMPT_SENT: "PROMPT_SENT",
  WAITING_FOR_ASSISTANT_MESSAGE: "WAITING_FOR_ASSISTANT_MESSAGE",
  STREAMING_RESPONSE: "STREAMING_RESPONSE",
  RESPONSE_COMPLETE: "RESPONSE_COMPLETE",
  ERROR_STATE: "ERROR_STATE"
});

const LEGACY_REQUEST_STATE_ALIASES = Object.freeze({
  CHATGPT_TAB_READY: REQUEST_STATES.WORKSPACE_READY
});

export const REQUEST_ERROR_CODES = Object.freeze({
  AUTH_REQUIRED: "AUTH_REQUIRED",
  HIDDEN_FRAME_UNAVAILABLE: "HIDDEN_FRAME_UNAVAILABLE",
  PROJECT_UNAVAILABLE: "PROJECT_UNAVAILABLE",
  MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
  UPLOAD_REJECTED: "UPLOAD_REJECTED",
  RATE_LIMITED: "RATE_LIMITED",
  CHATGPT_UNAVAILABLE: "CHATGPT_UNAVAILABLE",
  BRIDGE_DISCONNECTED: "BRIDGE_DISCONNECTED"
});

export const TERMINAL_STATES = Object.freeze([
  REQUEST_STATES.RESPONSE_COMPLETE,
  REQUEST_STATES.ERROR_STATE
]);

export const STREAMING_STATES = Object.freeze([
  REQUEST_STATES.WAITING_FOR_ASSISTANT_MESSAGE,
  REQUEST_STATES.STREAMING_RESPONSE
]);

export const VISIBILITY_SETTINGS_VERSION = 6;
export const VISIBILITY_MODES = Object.freeze({
  HIDDEN: "hidden",
  OFFSCREEN_FRAME: "offscreen-frame"
});

export const AUTOMATION_TARGET_TYPES = Object.freeze({
  OFFSCREEN_FRAME: "offscreen-frame"
});

export const OFFSCREEN_FRAME_ROLES = Object.freeze({
  CHAT: "chat",
  HISTORY: "history"
});

export const PANEL_MESSAGES = Object.freeze({
  GET_PROFILES: "GET_PROFILES",
  GET_PANEL_STATE: "GET_PANEL_STATE",
  RUN_MANUAL_REQUEST: "RUN_MANUAL_REQUEST",
  RUN_SCREENSHOT_REQUEST: "RUN_SCREENSHOT_REQUEST",
  CAPTURE_SCREENSHOT_ATTACHMENT: "CAPTURE_SCREENSHOT_ATTACHMENT",
  RUN_FOLLOWUP_REQUEST: "RUN_FOLLOWUP_REQUEST",
  RUN_HISTORY_FOLLOWUP_REQUEST: "RUN_HISTORY_FOLLOWUP_REQUEST",
  RETRY_REQUEST: "RETRY_REQUEST",
  CANCEL_REQUEST: "CANCEL_REQUEST",
  OPEN_CHATGPT_AUTH: "OPEN_CHATGPT_AUTH",
  GET_PROJECT_CONVERSATIONS: "GET_PROJECT_CONVERSATIONS",
  GET_PROJECT_CONVERSATION: "GET_PROJECT_CONVERSATION",
  GET_CHATGPT_AUTOMATION_SETTINGS: "GET_CHATGPT_AUTOMATION_SETTINGS",
  SET_CHATGPT_AUTOMATION_SETTINGS: "SET_CHATGPT_AUTOMATION_SETTINGS",
  CHECK_CHATGPT_WORKSPACE: "CHECK_CHATGPT_WORKSPACE",
  PANEL_STATE_UPDATED: "PANEL_STATE_UPDATED"
});

export const CHATGPT_AUTOMATION_MESSAGES = Object.freeze({
  PING: "CHATGPT_AUTOMATION_PING",
  DUMP: "CHATGPT_AUTOMATION_DUMP",
  CANCEL: "CHATGPT_AUTOMATION_CANCEL",
  NAVIGATE: "CHATGPT_AUTOMATION_NAVIGATE",
  RUN: "CHATGPT_AUTOMATION_RUN",
  LIST_PROJECT_CONVERSATIONS: "CHATGPT_AUTOMATION_LIST_PROJECT_CONVERSATIONS",
  LOAD_PROJECT_CONVERSATION: "CHATGPT_AUTOMATION_LOAD_PROJECT_CONVERSATION",
  EVENT: "CHATGPT_AUTOMATION_EVENT",
  DEBUG: "CHATGPT_AUTOMATION_DEBUG"
});

export const OFFSCREEN_MESSAGES = Object.freeze({
  HOST_PROBE: "OFFSCREEN_AUTOMATION_PROBE",
  HOST_STATUS: "OFFSCREEN_AUTOMATION_STATUS",
  HOST_RELOAD_FRAME: "OFFSCREEN_AUTOMATION_RELOAD_FRAME",
  BRIDGE_STATUS: "OFFSCREEN_AUTOMATION_BRIDGE_STATUS",
  FRAME_READY: "OFFSCREEN_FRAME_READY",
  FRAME_COMMAND: "OFFSCREEN_FRAME_COMMAND",
  FRAME_COMMAND_RESPONSE: "OFFSCREEN_FRAME_COMMAND_RESPONSE"
});

export const OFFSCREEN_FRAME_PORT_NAME = "chatgpt-relay-offscreen-frame";

export const CHATGPT_CONTENT_SCRIPT_FILES = Object.freeze([
  "content/chatgpt/00-namespace.js",
  "content/chatgpt/runtime/contracts.js",
  "content/chatgpt/runtime/messaging/messages.js",
  "content/chatgpt/runtime/url/chatgpt-url.js",
  "content/chatgpt/runtime/errors/errors.js",
  "content/chatgpt/runtime/dom/utils.js",
  "content/chatgpt/runtime/async/wait.js",
  "content/chatgpt/runtime/adapter/options.js",
  "content/chatgpt/runtime/adapter/scoring.js",
  "content/chatgpt/runtime/adapter/base.js",
  "content/chatgpt/runtime/adapter/project-routing.js",
  "content/chatgpt/runtime/adapter/conversation.js",
  "content/chatgpt/runtime/adapter/model-selection.js",
  "content/chatgpt/runtime/adapter/composer-controls.js",
  "content/chatgpt/runtime/adapter/assistant-response.js",
  "content/chatgpt/runtime/response/extraction.js",
  "content/chatgpt/runtime/history/project-history-data.js",
  "content/chatgpt/runtime/history/project-history.js",
  "content/chatgpt/runtime/network/capture-client.js",
  "content/chatgpt/runtime/offscreen/bridge.js",
  "content/chatgpt/runtime/page/visibility.js",
  "content/chatgpt/runtime/debug/dump.js",
  "content/chatgpt/runtime/response/observer.js",
  "content/chatgpt/runtime/runner/automation-runner.js",
  "content/chatgpt/runtime/app.js",
  "content/chatgpt/90-bootstrap.js"
]);

export const RESPONSE_ALLOWED_TAGS = Object.freeze([
  "A",
  "B",
  "BLOCKQUOTE",
  "BR",
  "CODE",
  "DEL",
  "DIV",
  "EM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HR",
  "I",
  "KBD",
  "LI",
  "OL",
  "P",
  "PRE",
  "S",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TABLE",
  "TBODY",
  "TD",
  "TH",
  "THEAD",
  "TR",
  "UL"
]);

export const RESPONSE_ALLOWED_ATTRIBUTES = Object.freeze([
  "class",
  "href",
  "title",
  "target",
  "rel"
]);

export function isTerminalState(state) {
  return TERMINAL_STATES.includes(normalizeRequestState(state));
}

export function isStreamingState(state) {
  return STREAMING_STATES.includes(normalizeRequestState(state));
}

export function normalizeRequestState(state) {
  const value = String(state || "");

  return LEGACY_REQUEST_STATE_ALIASES[value] || value;
}
