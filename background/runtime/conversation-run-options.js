export function buildChatOptionsForAutomationRun({
  automationSettings,
  request,
  visibilityModeOverride = null
}) {
  const settings = automationSettings && typeof automationSettings === "object" ? automationSettings : {};
  const requestMode = request?.conversationMode === "followup" ? "continue" : "new";
  const isFollowup = requestMode === "continue";

  return {
    ...settings,
    visibility: {
      ...(settings.visibility || {}),
      mode: visibilityModeOverride || settings.visibility?.mode
    },
    conversation: {
      ...(settings.conversation || {}),
      mode: requestMode,
      startNewChat: !isFollowup,
      expectedConversationUrl: isFollowup ? request.expectedConversationUrl || null : null
    }
  };
}
