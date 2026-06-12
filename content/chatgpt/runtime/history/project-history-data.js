(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  const DEFAULT_HISTORY_LIMIT = 24;
  const MAX_HISTORY_LIMIT = 50;

  function normalizeConversationListPayload(data, { project, source, trustProjectScope, deps }) {
    const rawItems = extractConversationListItems(data);
    const conversations = [];
    const seen = new Set();

    for (const item of rawItems) {
      const conversation = normalizeConversationSummary(item, {
        project,
        source,
        trustProjectScope,
        deps
      });

      if (!conversation || seen.has(conversation.id)) {
        continue;
      }

      seen.add(conversation.id);
      conversations.push(conversation);
    }

    return {
      conversations,
      rawItemCount: rawItems.length
    };
  }

  function extractConversationListItems(data) {
    const directArrays = [
      data?.items,
      data?.conversations,
      data?.data,
      data?.data?.items,
      data?.data?.conversations,
      data?.results
    ].filter(Array.isArray);

    for (const items of directArrays) {
      const summaries = items.filter(looksLikeConversationSummary);

      if (summaries.length) {
        return summaries;
      }
    }

    const discovered = [];
    visit(data, (value) => {
      if (!Array.isArray(value)) {
        return;
      }

      const summaries = value.filter(looksLikeConversationSummary);

      if (summaries.length > discovered.length) {
        discovered.splice(0, discovered.length, ...summaries);
      }
    });

    return discovered;
  }

  function looksLikeConversationSummary(value) {
    if (!value || typeof value !== "object" || value.message?.author?.role) {
      return false;
    }

    const id = value.id || value.conversation_id || value.conversationId;

    return Boolean(id && (value.title || value.name || value.create_time || value.update_time || value.current_node));
  }

  function normalizeConversationSummary(item, { project, source, trustProjectScope, deps }) {
    const id = deps.normalizeText(item.id || item.conversation_id || item.conversationId);

    if (!id) {
      return null;
    }

    const rawUrl = deps.normalizeText(item.url || item.href || item.path || item.conversation_url || item.conversationUrl);
    const itemUrl = normalizeConversationUrl(rawUrl, project);
    const itemUrlProjectSegment = itemUrl ? deps.extractProjectPathSegment(new URL(itemUrl).pathname) : "";
    const url = itemUrl || `${location.origin}/g/${project.segment}/c/${encodeURIComponent(id)}`;

    if (!trustProjectScope && !conversationDataMatchesProject(item, project) && itemUrlProjectSegment !== project.segment) {
      return null;
    }

    const title = deps.normalizeText(item.title || item.name || item.metadata?.title || "") || "Untitled conversation";

    return {
      id,
      title,
      url,
      projectName: project.name,
      projectSegment: project.segment,
      createdAt: formatTimestamp(item.create_time || item.createTime || item.created_at || item.createdAt),
      updatedAt: formatTimestamp(item.update_time || item.updateTime || item.updated_at || item.updatedAt),
      source
    };
  }

  function collectProjectConversationLinks(project, limit, deps) {
    const conversations = [];
    const seen = new Set();
    const links = Array.from(document.querySelectorAll('a[href*="/c/"]'));

    for (const link of links) {
      const rawHref = link.href || link.getAttribute("href") || "";
      let rawUrl;

      try {
        rawUrl = new URL(rawHref, location.origin);
      } catch (_error) {
        continue;
      }

      if (deps.extractProjectPathSegment(rawUrl.pathname) !== project.segment) {
        continue;
      }

      const url = normalizeConversationUrl(rawUrl.href, project);

      if (!url) {
        continue;
      }

      const id = deps.extractConversationKey(url);

      if (!id || seen.has(id)) {
        continue;
      }

      seen.add(id);
      conversations.push({
        id,
        title: deps.normalizeText(link.innerText || link.textContent || link.getAttribute("aria-label") || "") || "Untitled conversation",
        url,
        projectName: project.name,
        projectSegment: project.segment,
        createdAt: null,
        updatedAt: null,
        source: "dom-project-links"
      });

      if (conversations.length >= limit) {
        break;
      }
    }

    return conversations;
  }

  function normalizeConversationUrl(value, project) {
    if (!value) {
      return "";
    }

    try {
      const url = new URL(value, location.origin);

      if (!/^https:$/.test(url.protocol)) {
        return "";
      }

      if (project?.segment && /^\/c\//i.test(url.pathname)) {
        return `${url.origin}/g/${project.segment}${url.pathname}`;
      }

      return `${url.origin}${url.pathname}`;
    } catch (_error) {
      return "";
    }
  }

  function conversationDataMatchesProject(value, project) {
    if (!project?.segment) {
      return false;
    }

    let matched = false;

    visit(value, (item) => {
      if (matched || typeof item !== "string") {
        return;
      }

      matched = item === project.segment || item.includes(`/g/${project.segment}/`);
    });

    return matched;
  }

  function normalizePageRequest({ cursor, limit }) {
    const offset = Number.isFinite(Number(cursor)) ? Math.max(0, Number(cursor)) : 0;
    const normalizedLimit = Number.isFinite(Number(limit))
      ? Math.min(MAX_HISTORY_LIMIT, Math.max(1, Number(limit)))
      : DEFAULT_HISTORY_LIMIT;

    return {
      offset,
      limit: normalizedLimit
    };
  }

  function resolveNextCursor(data, offset, rawItemCount) {
    if (data?.has_more === false || data?.hasMore === false) {
      return null;
    }

    if (rawItemCount <= 0) {
      return null;
    }

    if (data?.has_more === true || data?.hasMore === true || rawItemCount > 0) {
      return offset + rawItemCount;
    }

    return null;
  }

  function inferConversationTitle(messages, normalizeText) {
    const firstUserMessage = messages.find((message) => message.role === "user");

    if (!firstUserMessage) {
      return "";
    }

    return normalizeText(firstUserMessage.text).replace(/\s+/g, " ").slice(0, 80);
  }

  function formatTimestamp(value) {
    const numeric = Number(value) || 0;

    if (!numeric) {
      return null;
    }

    const timeMs = numeric > 100000000000 ? numeric : numeric * 1000;

    return new Date(timeMs).toISOString();
  }

  function visit(value, visitor, seen = new Set()) {
    if (!value || typeof value !== "object" || seen.has(value)) {
      if (typeof value === "string") {
        visitor(value);
      }

      return;
    }

    seen.add(value);
    visitor(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, visitor, seen);
      }
      return;
    }

    for (const item of Object.values(value)) {
      visit(item, visitor, seen);
    }
  }

  runtime.projectHistoryData = Object.freeze({
    collectProjectConversationLinks,
    conversationDataMatchesProject,
    inferConversationTitle,
    normalizeConversationListPayload,
    normalizeConversationUrl,
    normalizePageRequest,
    resolveNextCursor
  });
})();
