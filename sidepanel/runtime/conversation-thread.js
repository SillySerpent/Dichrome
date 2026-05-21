export function getUnreflectedLiveRequestsForHistory(messages, liveRequests) {
  const historyMessages = Array.isArray(messages) ? messages : [];
  const requests = Array.isArray(liveRequests) ? liveRequests : [];

  return requests.filter((request) => !historyContainsRequest(historyMessages, request));
}

export function historyContainsRequest(messages, request) {
  const userText = normalizeComparableMessageText(request?.manualText || request?.prompt || "");

  if (!userText) {
    return false;
  }

  const assistantText = normalizeComparableMessageText(request?.responseText || "");

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];

    if (message?.role !== "user" || normalizeComparableMessageText(message.text) !== userText) {
      continue;
    }

    if (!assistantText) {
      return true;
    }

    const nextAssistant = findNextAssistantMessage(messages, index + 1);

    if (nextAssistant && normalizeComparableMessageText(nextAssistant.text) === assistantText) {
      return true;
    }
  }

  return false;
}

function findNextAssistantMessage(messages, startIndex) {
  for (let index = startIndex; index < messages.length; index += 1) {
    const message = messages[index];

    if (message?.role === "assistant") {
      return message;
    }

    if (message?.role === "user") {
      return null;
    }
  }

  return null;
}

function normalizeComparableMessageText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}
