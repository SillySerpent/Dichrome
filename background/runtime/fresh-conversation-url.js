export function getFreshConversationUrl(automationSettings, currentHref) {
  const settings = automationSettings && typeof automationSettings === "object" ? automationSettings : {};

  if (settings.conversation?.startNewChat === false) {
    return null;
  }

  const projectUrl = getProjectFreshConversationUrl(settings.project);

  if (projectUrl) {
    return projectUrl;
  }

  const currentUrl = parseAllowedChatGptUrl(currentHref);

  if (currentUrl && /\/c\//i.test(currentUrl.pathname)) {
    return `${currentUrl.origin}/`;
  }

  return null;
}

function getProjectFreshConversationUrl(project) {
  const source = project && typeof project === "object" ? project : {};

  if (!source.enabled || !source.name || !source.segment) {
    return null;
  }

  const projectUrl = parseAllowedChatGptUrl(source.url);

  if (projectUrl && projectUrl.pathname.toLowerCase() === `/g/${source.segment.toLowerCase()}/project`) {
    return `${projectUrl.origin}${projectUrl.pathname}`;
  }

  return `https://chatgpt.com/g/${source.segment}/project`;
}

function parseAllowedChatGptUrl(value) {
  try {
    const url = new URL(value);

    if (url.protocol === "https:" && (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com")) {
      return url;
    }
  } catch (_error) {
    return null;
  }

  return null;
}
