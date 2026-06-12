import {
  CHATGPT_AUTOMATION_MESSAGES,
  CHATGPT_HOME_URL,
  OFFSCREEN_FRAME_ROLES,
  PROJECT_CONVERSATION_HISTORY_LIMIT,
  REQUEST_ERROR_CODES
} from "../../shared/contracts.js";
import { usesHiddenAutomation } from "../automation/settings.js";

const HISTORY_COMMAND_TIMEOUT_MS = 45000;
const inFlightHistoryCommands = new Map();

export function createProjectHistoryController({
  getAutomationSettings,
  probeOffscreenAutomationTarget,
  reloadOffscreenFrameToUrl = async () => null,
  sendMessageToOffscreenFrame,
  setAutomationSettings = null
}) {
  async function getProjectConversations(message = {}) {
    const response = await runProjectHistoryCommand(CHATGPT_AUTOMATION_MESSAGES.LIST_PROJECT_CONVERSATIONS, {
      cursor: message.cursor,
      limit: message.limit || PROJECT_CONVERSATION_HISTORY_LIMIT
    });

    return {
      project: response.project,
      conversations: response.conversations || [],
      nextCursor: response.nextCursor ?? null,
      source: response.source || "",
      pending: Boolean(response.pending),
      automationTargetType: response.automationTargetType
    };
  }

  async function getProjectConversation(message = {}) {
    const response = await runProjectHistoryCommand(CHATGPT_AUTOMATION_MESSAGES.LOAD_PROJECT_CONVERSATION, {
      conversationId: message.conversationId,
      conversationUrl: message.conversationUrl
    });

    return {
      project: response.project,
      conversation: response.conversation,
      automationTargetType: response.automationTargetType
    };
  }

  async function runProjectHistoryCommand(type, payload = {}) {
    const settings = await getAutomationSettings();
    const project = normalizeProjectSettings(settings.project);
    const commandKey = getHistoryCommandKey(type, project, payload);
    const existing = inFlightHistoryCommands.get(commandKey);

    if (existing) {
      return existing;
    }

    const command = runProjectHistoryCommandInner(type, payload, settings, project)
      .finally(() => {
        inFlightHistoryCommands.delete(commandKey);
      });

    inFlightHistoryCommands.set(commandKey, command);
    return command;
  }

  async function runProjectHistoryCommandInner(type, payload = {}, settings, project) {
    if (!project.enabled || !project.name) {
      throw new Error("Project history requires project routing to be enabled with a project name.");
    }

    if (!usesHiddenAutomation(settings.visibility)) {
      throw createHistoryError(
        "Project history only supports hidden internal automation.",
        REQUEST_ERROR_CODES.HIDDEN_FRAME_UNAVAILABLE
      );
    }

    const hiddenCapability = await probeOffscreenAutomationTarget();

    if (!hiddenCapability?.supported) {
      throw createHistoryError(
        `Hidden internal project history is unavailable. ${hiddenCapability?.failureReason || "Open ChatGPT to sign in, then retry."}`.trim(),
        classifyHistoryError(hiddenCapability?.failureReason)
      );
    }

    try {
      await reloadOffscreenFrameToUrl(getProjectHistoryFrameUrl(project), {
        timeoutMessage: "Timed out waiting for the hidden ChatGPT history frame to reload project history."
      }, {
        frameRole: OFFSCREEN_FRAME_ROLES.HISTORY
      });

      const response = await sendMessageToOffscreenFrame({
        type,
        project,
        ...payload
      }, HISTORY_COMMAND_TIMEOUT_MS, {
        frameRole: OFFSCREEN_FRAME_ROLES.HISTORY
      });

      return persistResolvedProjectTarget(settings, unwrapHistoryResponse(response, "offscreen-frame"));
    } catch (error) {
      throw createHistoryError(error?.message || String(error), classifyHistoryError(error));
    }
  }

  async function persistResolvedProjectTarget(settings, response) {
    const resolvedProject = normalizeProjectSettings(response?.project);

    if (!resolvedProject.segment || settings?.project?.segment === resolvedProject.segment) {
      return response;
    }

    if (typeof setAutomationSettings === "function") {
      await setAutomationSettings({
        ...settings,
        project: {
          ...(settings.project || {}),
          segment: resolvedProject.segment,
          url: resolvedProject.url
        }
      }).catch(() => null);
    }

    return response;
  }

  return Object.freeze({
    getProjectConversations,
    getProjectConversation
  });
}

function getProjectHistoryFrameUrl(project) {
  return project.url || CHATGPT_HOME_URL;
}

function unwrapHistoryResponse(response, automationTargetType) {
  if (!response?.ok) {
    throw new Error(response?.error || "Project history command failed.");
  }

  return {
    ...response,
    automationTargetType
  };
}

function getHistoryCommandKey(type, project, payload = {}) {
  return JSON.stringify({
    type,
    projectName: project.name,
    projectSegment: project.segment || "",
    projectUrl: project.url || "",
    cursor: payload.cursor ?? null,
    limit: payload.limit ?? null,
    conversationId: payload.conversationId || "",
    conversationUrl: payload.conversationUrl || ""
  });
}

function normalizeProjectSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const segment = sanitizeProjectSegment(source.segment || extractProjectSegmentFromUrl(source.url));
  const origin = extractAllowedChatGptOrigin(source.url) || "https://chatgpt.com";

  return {
    enabled: Boolean(source.enabled),
    name: String(source.name || "").trim(),
    createIfMissing: false,
    segment,
    url: segment ? `${origin}/g/${segment}/project` : ""
  };
}

function createHistoryError(message, errorCode) {
  const error = new Error(message);
  error.errorCode = errorCode || REQUEST_ERROR_CODES.CHATGPT_UNAVAILABLE;
  return error;
}

function classifyHistoryError(error) {
  const message = String(error?.message || error || "").toLowerCase();

  if (/\b(log in|login|sign in|auth|account gate|401|403|session|access token)\b/.test(message)) {
    return REQUEST_ERROR_CODES.AUTH_REQUIRED;
  }

  if (/\b(project)\b/.test(message)) {
    return REQUEST_ERROR_CODES.PROJECT_UNAVAILABLE;
  }

  if (/\b(hidden|offscreen|frame|iframe|bridge|connected|unavailable)\b/.test(message)) {
    return REQUEST_ERROR_CODES.HIDDEN_FRAME_UNAVAILABLE;
  }

  return REQUEST_ERROR_CODES.CHATGPT_UNAVAILABLE;
}

function sanitizeProjectSegment(value) {
  const text = String(value || "").trim().slice(0, 160);

  return /^g-p-[a-z0-9-]+$/i.test(text) ? text : "";
}

function extractProjectSegmentFromUrl(value) {
  try {
    return new URL(value).pathname.match(/^\/g\/(g-p-[^/]+)/i)?.[1] || "";
  } catch (_error) {
    return "";
  }
}

function extractAllowedChatGptOrigin(value) {
  try {
    const url = new URL(value);

    if (url.protocol === "https:" && (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com")) {
      return url.origin;
    }
  } catch (_error) {
    return "";
  }

  return "";
}
