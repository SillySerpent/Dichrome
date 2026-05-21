const PROJECT_SEGMENT_PATTERN = /^\/g\/(g-p-[^/]+)/i;

export async function resolveProjectTarget(project, {
  getAutomationSession = null,
  queryTabs = null
} = {}) {
  const normalized = normalizeProjectTarget(project);

  if (!normalized.enabled || !normalized.name || normalized.segment) {
    return normalized;
  }

  const candidates = [];

  if (typeof queryTabs === "function") {
    const tabs = await queryTabs().catch(() => []);

    for (const tab of Array.isArray(tabs) ? tabs : []) {
      candidates.push({
        active: Boolean(tab.active),
        lastAccessed: Number(tab.lastAccessed) || 0,
        title: tab.title || "",
        url: tab.url || tab.pendingUrl || ""
      });
    }
  }

  if (typeof getAutomationSession === "function") {
    const session = await getAutomationSession().catch(() => null);

    if (session?.currentConversationUrl) {
      candidates.push({
        active: false,
        lastAccessed: 0,
        title: "",
        url: session.currentConversationUrl
      });
    }

    if (session?.lastKnownUrl) {
      candidates.push({
        active: false,
        lastAccessed: 0,
        title: "",
        url: session.lastKnownUrl
      });
    }
  }

  return mergeProjectTargetFromCandidates(normalized, candidates);
}

export function mergeProjectTargetFromCandidates(project, candidates = []) {
  const normalized = normalizeProjectTarget(project);

  if (!normalized.enabled || !normalized.name || normalized.segment) {
    return normalized;
  }

  const scored = candidates
    .map((candidate) => scoreProjectCandidate(candidate, normalized.name))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.lastAccessed - a.lastAccessed);

  const selected = scored[0];

  if (!selected) {
    return normalized;
  }

  return {
    ...normalized,
    segment: selected.segment,
    url: `${selected.origin}/g/${selected.segment}/project`
  };
}

export function normalizeProjectTarget(project) {
  const source = project && typeof project === "object" ? project : {};
  const name = sanitizeText(source.name, 80);
  const segment = sanitizeProjectSegment(source.segment || extractProjectSegmentFromUrl(source.url));
  const origin = extractAllowedChatGptOrigin(source.url) || "https://chatgpt.com";

  return {
    enabled: Boolean(source.enabled),
    name,
    createIfMissing: Boolean(source.createIfMissing),
    segment,
    url: segment ? `${origin}/g/${segment}/project` : ""
  };
}

export function extractProjectSegmentFromUrl(value) {
  try {
    return sanitizeProjectSegment(new URL(value).pathname.match(PROJECT_SEGMENT_PATTERN)?.[1] || "");
  } catch (_error) {
    return "";
  }
}

function scoreProjectCandidate(candidate, projectName) {
  const url = parseAllowedChatGptUrl(candidate?.url);

  if (!url) {
    return {
      score: 0
    };
  }

  const segment = extractProjectSegmentFromUrl(url.href);

  if (!segment) {
    return {
      score: 0
    };
  }

  const comparableName = normalizeComparableText(projectName);
  const title = normalizeComparableText(candidate?.title || "");
  const slug = normalizeComparableText(decodeURIComponent(segment));
  const slugName = comparableName.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  let score = 0;

  if (title === comparableName || title === `chatgpt - ${comparableName}` || title.startsWith(`${comparableName} - `)) {
    score += 120;
  } else if (title.includes(comparableName)) {
    score += 90;
  }

  if (slugName && slug.includes(slugName)) {
    score += 80;
  }

  if (url.pathname.endsWith("/project")) {
    score += 25;
  } else if (/\/c\//i.test(url.pathname)) {
    score += 20;
  }

  if (candidate?.active) {
    score += 10;
  }

  return {
    lastAccessed: Number(candidate?.lastAccessed) || 0,
    origin: url.origin,
    score,
    segment
  };
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

function extractAllowedChatGptOrigin(value) {
  const url = parseAllowedChatGptUrl(value);

  return url?.origin || "";
}

function sanitizeProjectSegment(value) {
  const text = sanitizeText(value, 160);

  return /^g-p-[a-z0-9-]+$/i.test(text) ? text : "";
}

function sanitizeText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeComparableText(value) {
  return sanitizeText(value, 240).toLowerCase().replace(/\s+/g, " ");
}
