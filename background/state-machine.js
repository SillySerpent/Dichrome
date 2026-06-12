import {
  REQUEST_STATES,
  TERMINAL_STATES as TERMINAL_STATE_VALUES
} from "../shared/contracts.js";

export { REQUEST_STATES };

export const TERMINAL_STATES = new Set(TERMINAL_STATE_VALUES);

export const REQUEST_PROFILES = Object.freeze({
  ask_selection: Object.freeze({
    id: "ask_selection",
    label: "Ask About Selection",
    shortLabel: "Ask",
    inputKind: "selection",
    contextMenuTitle: "Ask assistant about this",
    buildPrompt({ selectedText }) {
      return [
        "You are helping with text selected from a webpage.",
        "Answer clearly and be explicit when the excerpt is not enough context.",
        "",
        "Selected text:",
        selectedText
      ].join("\n");
    }
  }),
  define_selection: Object.freeze({
    id: "define_selection",
    label: "Define Selection",
    shortLabel: "Define",
    inputKind: "selection",
    contextMenuTitle: "Define this word or phrase",
    buildPrompt({ selectedText }) {
      return [
        "Define the selected word or phrase in plain language.",
        "If it has multiple meanings, list the likely meanings and explain which one best fits the surrounding wording if possible.",
        "",
        "Selected word or phrase:",
        selectedText
      ].join("\n");
    }
  }),
  summarize_selection: Object.freeze({
    id: "summarize_selection",
    label: "Summarize Selection",
    shortLabel: "Summarize",
    inputKind: "selection",
    contextMenuTitle: "Summarize this selection",
    buildPrompt({ selectedText }) {
      return [
        "Summarize the selected text in a compact, useful way.",
        "Keep the answer grounded in the excerpt. Include any key caveats or unresolved questions.",
        "",
        "Selected text:",
        selectedText
      ].join("\n");
    }
  }),
  explain_selection: Object.freeze({
    id: "explain_selection",
    label: "Explain Selection",
    shortLabel: "Explain",
    inputKind: "selection",
    contextMenuTitle: "Explain this selection",
    buildPrompt({ selectedText }) {
      return [
        "Explain the selected text in plain language.",
        "Define technical terms, describe the practical implications, and be explicit where the excerpt lacks enough context.",
        "",
        "Selected text:",
        selectedText
      ].join("\n");
    }
  }),
  rewrite_selection: Object.freeze({
    id: "rewrite_selection",
    label: "Rewrite Selection",
    shortLabel: "Rewrite",
    inputKind: "selection",
    contextMenuTitle: "Rewrite this selection",
    buildPrompt({ selectedText }) {
      return [
        "Rewrite the selected text so it is clearer and more polished while preserving the original meaning.",
        "If the excerpt is already clear, make only minimal improvements.",
        "",
        "Selected text:",
        selectedText
      ].join("\n");
    }
  }),
  custom_text: Object.freeze({
    id: "custom_text",
    label: "Custom Text Prompt",
    shortLabel: "Custom",
    inputKind: "manual_text",
    buildPrompt({ manualText }) {
      return manualText;
    }
  }),
  visible_screenshot: Object.freeze({
    id: "visible_screenshot",
    label: "Ask About Visible Screenshot",
    shortLabel: "Screenshot",
    inputKind: "visible_screenshot",
    requiresAttachment: true,
    buildPrompt({ manualText }) {
      const instruction = manualText && manualText.trim()
        ? manualText.trim()
        : "Analyze the attached browser screenshot. Focus on visible page content and call out uncertainty where the screenshot is incomplete.";

      return [
        instruction,
        "",
        "The screenshot is attached by the extension. Treat it as the source of truth for visible-page details."
      ].join("\n");
    }
  })
});

export function getProfile(profileId) {
  const profile = REQUEST_PROFILES[profileId];

  if (!profile) {
    throw new Error(`Unknown request profile: ${profileId}`);
  }

  return profile;
}

export function getPublicProfiles() {
  return Object.values(REQUEST_PROFILES).map((profile) => ({
    id: profile.id,
    label: profile.label,
    shortLabel: profile.shortLabel,
    inputKind: profile.inputKind,
    contextMenuTitle: profile.contextMenuTitle || null,
    requiresAttachment: Boolean(profile.requiresAttachment)
  }));
}

export function buildPromptForProfile(profileId, payload) {
  const profile = getProfile(profileId);
  const normalizedPayload = normalizePayload(profile, payload);

  return profile.buildPrompt(normalizedPayload);
}

export function createRequestRecord({
  id,
  profileId,
  sourceTab,
  selectedText,
  manualText,
  prompt,
  attachments = [],
  parentRequestId = null,
  conversationMode = "new",
  expectedConversationUrl = null,
  expectedConversationKey = null
}) {
  const profile = getProfile(profileId);
  const now = new Date().toISOString();

  return {
    id,
    profileId,
    profileLabel: profile.label,
    state: REQUEST_STATES.IDLE,
    source: {
      tabId: sourceTab?.id ?? sourceTab?.tabId ?? null,
      windowId: sourceTab?.windowId ?? null,
      title: sourceTab?.title ?? "",
      url: sourceTab?.url ?? ""
    },
    chatTabId: null,
    selectedText: selectedText || "",
    manualText: manualText || "",
    prompt,
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes || null
    })),
    responseText: "",
    responseHtml: "",
    parentRequestId,
    conversationMode: conversationMode === "followup" ? "followup" : "new",
    chatConversationUrl: expectedConversationUrl || null,
    chatConversationKey: expectedConversationKey || null,
    automationTargetType: null,
    expectedConversationUrl: expectedConversationUrl || null,
    expectedConversationKey: expectedConversationKey || null,
    error: null,
    errorCode: null,
    events: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null
  };
}

export function createRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function normalizePayload(profile, payload) {
  if (profile.inputKind === "selection") {
    const selectedText = normalizeText(payload.selectedText);

    if (!selectedText) {
      throw new Error("No selected text was provided.");
    }

    return {
      ...payload,
      selectedText
    };
  }

  if (profile.inputKind === "manual_text") {
    const manualText = normalizeText(payload.manualText);

    if (!manualText) {
      throw new Error("No prompt text was provided.");
    }

    return {
      ...payload,
      manualText
    };
  }

  if (profile.inputKind === "visible_screenshot") {
    return {
      ...payload,
      manualText: normalizeText(payload.manualText)
    };
  }

  return payload;
}
