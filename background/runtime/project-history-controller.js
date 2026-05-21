import {
  CHATGPT_AUTOMATION_MESSAGES,
  PROJECT_CONVERSATION_HISTORY_LIMIT
} from "../../shared/contracts.js";
import { isChatGptUrl } from "../constants.js";
import {
  usesFocusedAutomation,
  usesFocusEmulation,
  usesHiddenAutomation
} from "../automation/settings.js";

const HISTORY_COMMAND_TIMEOUT_MS = 45000;
const HIDDEN_HISTORY_FAILURE_RETRY_DELAY_MS = 15000;
const hiddenHistoryFailureCache = new Map();
const inFlightHistoryCommands = new Map();

export function createProjectHistoryController({
  disableFocusEmulationForRequest,
  enableFocusEmulation,
  findOrCreateChatGptTab,
  getAutomationSettings,
  getExistingChatGptAutomationTab = async () => null,
  getSourceFocusTarget,
  injectAutomationScript,
  navigateTabToConversation,
  prepareAutomationTab,
  probeOffscreenAutomationTarget,
  queryBestSourceTab,
  restoreSourceFocus,
  sendMessageToOffscreenFrame,
  sendMessageToTab,
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

  async function openProjectConversation(message = {}) {
    const target = normalizeConversationTarget(message.conversation || message);

    if (!target.url || !isChatGptUrl(target.url)) {
      throw new Error("The selected conversation target is not a workspace URL.");
    }

    const settings = await getAutomationSettings();
    const sourceTab = await queryBestSourceTab();
    const sourceFocus = getSourceFocusTarget(sourceTab);
    const chatTab = await prepareAutomationTab(await findOrCreateChatGptTab({
      sourceFocus,
      visibility: settings.visibility
    }));
    const loadedTab = await navigateTabToConversation(chatTab.id, target.url);

    await chrome.tabs.update(loadedTab.id, {
      active: true
    });
    await chrome.windows.update(loadedTab.windowId, {
      focused: true
    }).catch(() => null);

    return {
      tabId: loadedTab.id
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

    let offscreenAttemptFailed = false;
    const hiddenFailureKey = getHiddenHistoryFailureKey(type, project);

    if (usesHiddenAutomation(settings.visibility) && !shouldSkipHiddenHistoryFailure(hiddenFailureKey)) {
      const hiddenCapability = await probeOffscreenAutomationTarget();

      if (hiddenCapability?.supported) {
        try {
          const response = await sendMessageToOffscreenFrame({
            type,
            project,
            ...payload
          }, HISTORY_COMMAND_TIMEOUT_MS);

          hiddenHistoryFailureCache.delete(hiddenFailureKey);
          return persistResolvedProjectTarget(settings, unwrapHistoryResponse(response, "offscreen-frame"));
        } catch (error) {
          offscreenAttemptFailed = true;
          const errorMessage = error?.message || String(error);
          
          // If it's a disconnection error, try to reconnect and retry once
          if (errorMessage.includes("disconnected")) {
            console.info("[ChatGPT Relay] Offscreen frame disconnected; attempting reconnection...", {
              type
            });

            try {
              // Give the frame a moment to reconnect naturally
              await new Promise(resolve => setTimeout(resolve, 500));
              
              // Try to probe again to reconnect
              const reconnectCapability = await probeOffscreenAutomationTarget();
              
              if (reconnectCapability?.supported) {
                try {
                  const retryResponse = await sendMessageToOffscreenFrame({
                    type,
                    project,
                    ...payload
                  }, HISTORY_COMMAND_TIMEOUT_MS);

                  hiddenHistoryFailureCache.delete(hiddenFailureKey);
                  return persistResolvedProjectTarget(settings, unwrapHistoryResponse(retryResponse, "offscreen-frame"));
                } catch (retryError) {
                  console.info("[ChatGPT Relay] Reconnection attempt failed; falling back to tab-based automation.", {
                    originalError: errorMessage,
                    retryError: retryError?.message || String(retryError),
                    type
                  });
                }
              }
            } catch (reconnectError) {
              console.info("[ChatGPT Relay] Reconnection failed; falling back to tab-based automation.", {
                error: reconnectError?.message || String(reconnectError),
                type
              });
            }
          } else {
            console.info("[ChatGPT Relay] Hidden project history command failed; retrying in a ChatGPT tab.", {
              error: errorMessage,
              type
            });
          }

          markHiddenHistoryFailure(hiddenFailureKey);
        }
      }
    } else if (usesHiddenAutomation(settings.visibility)) {
      offscreenAttemptFailed = true;
    }

    const sourceTab = await queryBestSourceTab();
    const sourceFocus = getSourceFocusTarget(sourceTab);
    const existingChatTab = await getExistingChatGptAutomationTab({
      sourceFocus,
      visibility: settings.visibility
    });

    if (!existingChatTab) {
      if (type === CHATGPT_AUTOMATION_MESSAGES.LIST_PROJECT_CONVERSATIONS) {
        return {
          project,
          conversations: [],
          nextCursor: null,
          source: offscreenAttemptFailed ? "pending-hidden-history-retry" : "pending-automation-target",
          pending: true,
          automationTargetType: null
        };
      }

      const hiddenDetail = offscreenAttemptFailed
        ? " Hidden internal history loading failed, and"
        : "";

      throw new Error(`${hiddenDetail} project history has no existing ChatGPT automation target. It will not open a new browser tab just to load history.`.trim());
    }

    const chatTab = await prepareAutomationTab(existingChatTab);
    const focusEmulationRequestId = `project-history-${Date.now()}`;

    try {
      if (usesFocusEmulation(settings.visibility)) {
        await enableFocusEmulation({
          tabId: chatTab.id,
          requestId: focusEmulationRequestId
        });
      }

      await injectAutomationScript(chatTab.id);
      const response = await sendMessageToTab(chatTab.id, {
        type,
        project,
        ...payload
      });

      return persistResolvedProjectTarget(settings, unwrapHistoryResponse(response, "single-tab"));
    } finally {
      await disableFocusEmulationForRequest(focusEmulationRequestId).catch(() => null);

      if (!usesFocusedAutomation(settings.visibility)) {
        await restoreSourceFocus(sourceFocus, chatTab.windowId).catch(() => null);
      }
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
    getProjectConversation,
    openProjectConversation
  });
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

function getHiddenHistoryFailureKey(type, project) {
  return [
    type,
    project.name,
    project.segment || project.url || ""
  ].join("|");
}

function shouldSkipHiddenHistoryFailure(key) {
  const failedAt = hiddenHistoryFailureCache.get(key);

  return Boolean(failedAt && Date.now() - failedAt < HIDDEN_HISTORY_FAILURE_RETRY_DELAY_MS);
}

function markHiddenHistoryFailure(key) {
  hiddenHistoryFailureCache.set(key, Date.now());
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

function normalizeConversationTarget(value) {
  const source = value && typeof value === "object" ? value : {};

  return {
    id: String(source.id || source.key || source.conversationKey || "").trim(),
    url: String(source.url || source.conversationUrl || "").trim()
  };
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
