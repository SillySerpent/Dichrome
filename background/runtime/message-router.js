import {
  CHATGPT_AUTOMATION_MESSAGES,
  OFFSCREEN_MESSAGES,
  PANEL_MESSAGES
} from "../../shared/contracts.js";

export function createRuntimeMessageRouter(handlers) {
  return Object.freeze({
    async handle(message, sender) {
      switch (message.type) {
        case PANEL_MESSAGES.GET_PROFILES:
          return handlers.getProfiles();

        case PANEL_MESSAGES.GET_PANEL_STATE:
          return handlers.getPanelState();

        case PANEL_MESSAGES.RUN_MANUAL_REQUEST:
          return handlers.startManualRequest(message);

        case PANEL_MESSAGES.RUN_SCREENSHOT_REQUEST:
          return handlers.startScreenshotRequest(message);

        case PANEL_MESSAGES.CAPTURE_SCREENSHOT_ATTACHMENT:
          return handlers.captureScreenshotAttachment(message);

        case PANEL_MESSAGES.RUN_FOLLOWUP_REQUEST:
          return handlers.startFollowupRequest(message);

        case PANEL_MESSAGES.RUN_HISTORY_FOLLOWUP_REQUEST:
          return handlers.startHistoryFollowupRequest(message);

        case PANEL_MESSAGES.RETRY_REQUEST:
          return handlers.retryRequest(message);

        case PANEL_MESSAGES.CANCEL_REQUEST:
          return handlers.cancelRequest(message.requestId);

        case PANEL_MESSAGES.OPEN_CHATGPT_AUTH:
          return handlers.openChatGptAuth();

        case PANEL_MESSAGES.GET_PROJECT_CONVERSATIONS:
          return handlers.getProjectConversations(message);

        case PANEL_MESSAGES.GET_PROJECT_CONVERSATION:
          return handlers.getProjectConversation(message);

        case PANEL_MESSAGES.GET_CHATGPT_AUTOMATION_SETTINGS:
          return handlers.getChatGptAutomationSettings();

        case PANEL_MESSAGES.SET_CHATGPT_AUTOMATION_SETTINGS:
          return handlers.setChatGptAutomationSettings(message.settings);

        case PANEL_MESSAGES.CHECK_CHATGPT_WORKSPACE:
          return handlers.checkChatGptWorkspace();

        case CHATGPT_AUTOMATION_MESSAGES.DEBUG:
          await handlers.handleAutomationDebug(message, sender);
          return {};

        case CHATGPT_AUTOMATION_MESSAGES.EVENT:
          await handlers.handleAutomationEvent(message, sender);
          return {};

        case OFFSCREEN_MESSAGES.BRIDGE_STATUS:
          return {};

        default:
          throw new Error(`Unsupported message type: ${message.type}`);
      }
    }
  });
}
