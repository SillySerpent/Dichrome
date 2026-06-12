import {
  normalizeResponseHtml,
  normalizeResponseText,
  renderMarkdownToHtml
} from "../../shared/response-formatting.js";

export function createMessageCardFactory({
  responseText,
  responseView
}) {
  function createHistoryMessageCard(message) {
    return createMessageCard({
      role: message.role,
      bodyText: message.text || "",
      bodyHtml: message.html || ""
    });
  }

  function createUserRequestCard(request) {
    const card = createMessageCard({
      role: "user",
      bodyText: request.manualText || request.prompt || "Sent attachment/context."
    });

    if (request.selectedText) {
      const context = document.createElement("div");
      context.className = "sent-context";
      context.textContent = `Selected text: ${truncateText(request.selectedText, 420)}`;
      card.append(context);
    }

    if (request.attachments?.length) {
      const list = document.createElement("div");
      list.className = "sent-attachments";

      for (const attachment of request.attachments) {
        const chip = document.createElement("span");
        chip.textContent = attachment.name || attachment.kind || "attachment";
        list.append(chip);
      }

      card.append(list);
    }

    return card;
  }

  function createAssistantRequestCard(request, isActive) {
    if (isActive) {
      return createMessageCard({
        role: "assistant",
        metaText: request.state === "ERROR_STATE" ? "Assistant - error" : "Assistant",
        bodyNode: responseText
      });
    }

    return createMessageCard({
      role: "assistant",
      metaText: request.state === "ERROR_STATE" ? "Assistant - error" : "Assistant",
      bodyText: normalizeResponseText(request.responseText || ""),
      bodyHtml: request.responseHtml || ""
    });
  }

  function createEmptyChat({ title, body, includeShortcutHint = false }) {
    const empty = document.createElement("div");
    empty.className = "empty-chat";
    const titleNode = document.createElement("strong");
    titleNode.textContent = title;
    const bodyNode = document.createElement("span");
    bodyNode.textContent = body;
    empty.append(titleNode, bodyNode);

    if (includeShortcutHint) {
      empty.append(createShortcutHint());
    }

    return empty;
  }

  function createMessageCard({ role, metaText = "", bodyText = "", bodyHtml = "", bodyNode = null }) {
    const isAssistant = role === "assistant";
    const card = document.createElement("article");
    card.className = `message-card ${isAssistant ? "assistant-message" : "user-message"}`;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = metaText || (isAssistant ? "Assistant" : "You");

    const body = document.createElement("div");
    body.className = `message-body${isAssistant ? " assistant-body" : ""}`;

    if (bodyNode) {
      body.append(bodyNode);
    } else if (isAssistant) {
      const content = document.createElement("div");
      content.className = "response-content";
      content.innerHTML = bodyText ? renderMarkdownToHtml(bodyText) : normalizeResponseHtml(bodyHtml || "");
      responseView.enhanceContainer(content);
      body.append(content);
    } else {
      body.textContent = bodyText || "";
    }

    card.append(meta, body);
    return card;
  }

  return Object.freeze({
    createAssistantRequestCard,
    createEmptyChat,
    createHistoryMessageCard,
    createUserRequestCard
  });
}

function createShortcutHint() {
  const hint = document.createElement("div");
  hint.className = "shortcut-hint";
  hint.setAttribute("aria-label", "Side panel shortcut");

  const mac = document.createElement("span");
  mac.append("Mac ", createKeyCap("Option"), createKeyCap("Shift"), createKeyCap("D"));

  const windows = document.createElement("span");
  windows.append("Windows ", createKeyCap("Alt"), createKeyCap("Shift"), createKeyCap("D"));

  hint.append(mac, windows);
  return hint;
}

function createKeyCap(value) {
  const key = document.createElement("kbd");
  key.textContent = value;

  return key;
}

function truncateText(text, maxLength) {
  const normalized = String(text || "").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}
