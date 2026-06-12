(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  const DEFAULT_HISTORY_LIMIT = 24;
  const ALL_HISTORY_PAGE_LIMIT_MULTIPLIER = 3;
  const MAX_ALL_HISTORY_PAGES = 4;
  const HISTORY_NAVIGATION_TIMEOUT_MS = 15000;
  const {
    collectProjectConversationLinks,
    conversationDataMatchesProject,
    inferConversationTitle,
    normalizeConversationListPayload,
    normalizeConversationUrl,
    normalizePageRequest,
    resolveNextCursor
  } = runtime.projectHistoryData || {};

  function createController({
    ChatGptDomAdapter,
    DomAdapterError,
    extractConversationKey,
    extractConversationTitleFromConversationData,
    extractProjectPathSegment,
    getChatGptAccessToken,
    isAllowedChatGptUrl,
    normalizeProjectOptions,
    normalizeText,
    selectConversationMessagesFromConversationData
  }) {
    const projectScopedEndpointCache = new Map();
    const deps = {
      extractConversationKey,
      extractProjectPathSegment,
      normalizeText
    };

    async function listProjectConversations({ project, cursor = 0, limit = DEFAULT_HISTORY_LIMIT } = {}, run = {}) {
      const context = await resolveProjectContext(project, run);
      const page = normalizePageRequest({
        cursor,
        limit
      });
      const projectScopedResult = await fetchProjectScopedConversationPage(context.project, page);

      if (projectScopedResult.authoritative || projectScopedResult.conversations.length) {
        return {
          project: context.project,
          conversations: projectScopedResult.conversations,
          nextCursor: projectScopedResult.nextCursor,
          source: projectScopedResult.source
        };
      }

      const filteredResult = await fetchFilteredConversationPages(context.project, page);

      if (filteredResult.conversations.length) {
        return {
          project: context.project,
          conversations: filteredResult.conversations,
          nextCursor: filteredResult.nextCursor,
          source: filteredResult.source
        };
      }

      await ensureProjectPageVisible(context.project, run);

      const domConversations = collectProjectConversationLinks(context.project, page.limit, deps);

      return {
        project: context.project,
        conversations: domConversations,
        nextCursor: null,
        source: domConversations.length ? "dom-project-page" : "empty"
      };
    }

    async function loadProjectConversation({ project, conversationId, conversationUrl } = {}, run = {}) {
      const context = await resolveProjectContext(project, run);
      let providedUrl = normalizeConversationUrl(conversationUrl, context.project);
      let providedUrlProjectSegment = providedUrl ? extractProjectPathSegment(new URL(providedUrl).pathname) : "";

      if (providedUrl && providedUrlProjectSegment && providedUrlProjectSegment !== context.project.segment) {
        throw new Error("The selected conversation does not belong to the configured project.");
      }

      let key = normalizeText(conversationId) || extractConversationKey(providedUrl);

      if (!key) {
        throw new Error("No conversation id was provided.");
      }

      const data = await fetchConversationData(key);
      const dataProjectMatch = conversationDataMatchesProject(data, context.project);

      if (!dataProjectMatch && providedUrlProjectSegment !== context.project.segment) {
        throw new Error("The loaded conversation did not report the configured project id.");
      }

      const messages = selectConversationMessagesFromConversationData(data);
      const title = extractConversationTitleFromConversationData(data)
        || inferConversationTitle(messages, normalizeText)
        || "Untitled conversation";
      const url = providedUrl || `${location.origin}/g/${context.project.segment}/c/${encodeURIComponent(key)}`;

      return {
        project: context.project,
        conversation: {
          id: key,
          title,
          url,
          projectName: context.project.name,
          projectSegment: context.project.segment,
          messages,
          messageCount: messages.length,
          loadedAt: new Date().toISOString(),
          source: "backend-api"
        }
      };
    }

    async function ensureProjectPageVisible(project, run) {
      const projectPath = `/g/${project.segment}/project`;

      if (location.pathname === projectPath) {
        return;
      }

      location.assign(project.url);
      const startedAt = Date.now();

      while (Date.now() - startedAt < HISTORY_NAVIGATION_TIMEOUT_MS) {
        if (run?.cancelled) {
          throw new Error("Project history load cancelled.");
        }

        if (location.pathname === projectPath && document.readyState !== "loading") {
          return;
        }

        await sleep(150);
      }

      throw new Error("Timed out returning to the project conversation list.");
    }

    async function resolveProjectContext(projectOptions, run) {
      const project = normalizeProjectOptions({
        ...(projectOptions || {}),
        createIfMissing: false
      });

      if (!project.enabled || !project.name) {
        throw new Error("Project history requires project routing to be enabled with a project name.");
      }

      if (!isAllowedChatGptUrl(new URL(location.href))) {
        throw new Error("Project history can only be loaded from a ChatGPT automation page.");
      }

      const adapter = new ChatGptDomAdapter([]);
      await adapter.waitForAppShell(run);

      const blockingUi = adapter.detectBlockingUi();

      if (blockingUi) {
        throw new DomAdapterError(blockingUi, adapter.collectSnapshot());
      }

      const configuredSegment = project.segment || "";
      const currentSegment = extractProjectPathSegment(location.pathname);

      if (configuredSegment || currentSegment) {
        const segment = configuredSegment || currentSegment;

        return {
          adapter,
          project: {
            name: project.name,
            segment,
            url: project.url || `${location.origin}/g/${segment}/project`
          }
        };
      }

      const linkedProject = findLinkedProjectInDocument(project.name, extractProjectPathSegment);

      if (linkedProject) {
        return {
          adapter,
          project: {
            name: project.name,
            segment: linkedProject.segment,
            url: linkedProject.url
          }
        };
      }

      try {
        await adapter.ensureProjectContext(project, null, run);
      } catch (error) {
        const linkedAfterRoutingAttempt = findLinkedProjectInDocument(project.name, extractProjectPathSegment);

        if (linkedAfterRoutingAttempt) {
          return {
            adapter,
            project: {
              name: project.name,
              segment: linkedAfterRoutingAttempt.segment,
              url: linkedAfterRoutingAttempt.url
            }
          };
        }

        const clickedProject = await resolveProjectByClickingNavigationItem(project.name, {
          extractProjectPathSegment,
          normalizeText,
          run
        });

        if (clickedProject) {
          return {
            adapter,
            project: clickedProject
          };
        }

        throw error;
      }

      const clickedAfterRouting = await resolveProjectByClickingNavigationItem(project.name, {
        extractProjectPathSegment,
        normalizeText,
        run,
        onlyIfUnresolved: true
      });

      if (clickedAfterRouting) {
        return {
          adapter,
          project: clickedAfterRouting
        };
      }

      const segment = extractProjectPathSegment(location.pathname)
        || extractProjectSegmentFromElement(adapter.findSelectedProjectNavigationItem(project.name), extractProjectPathSegment)
        || extractProjectSegmentFromElement(adapter.findProjectNavigationItem(project.name), extractProjectPathSegment)
        || findLinkedProjectInDocument(project.name, extractProjectPathSegment)?.segment;

      if (!segment) {
        throw new Error(`Could not resolve a ChatGPT project id for ${project.name}.`);
      }

      return {
        adapter,
        project: {
          name: project.name,
          segment,
          url: `${location.origin}/g/${segment}/project`
        }
      };
    }

    async function resolveProjectByClickingNavigationItem(projectName, { extractProjectPathSegment, normalizeText, run, onlyIfUnresolved = false }) {
      if (onlyIfUnresolved && extractProjectPathSegment(location.pathname)) {
        return null;
      }

      const candidate = findClickableProjectNavigationCandidate(projectName, {
        extractProjectPathSegment,
        normalizeText
      });

      if (!candidate) {
        return null;
      }

      if (candidate.segment) {
        return {
          name: projectName,
          segment: candidate.segment,
          url: candidate.url || `${location.origin}/g/${candidate.segment}/project`
        };
      }

      const originalHref = location.href;
      dispatchSyntheticClick(candidate.clickTarget || candidate.element);
      const startedAt = Date.now();

      while (Date.now() - startedAt < HISTORY_NAVIGATION_TIMEOUT_MS) {
        if (run?.cancelled) {
          throw new Error("Project history load cancelled.");
        }

        const segment = extractProjectPathSegment(location.pathname);

        if (segment && location.href !== originalHref && document.readyState !== "loading") {
          return {
            name: projectName,
            segment,
            url: `${location.origin}/g/${segment}/project`
          };
        }

        await sleep(150);
      }

      return null;
    }

    function findClickableProjectNavigationCandidate(projectName, { extractProjectPathSegment, normalizeText }) {
      const comparableName = normalizeLinkedProjectText(projectName);

      if (!comparableName) {
        return null;
      }

      const candidates = Array.from(document.querySelectorAll('a[href], [role="button"], [role="link"], [role="treeitem"], button'))
        .map((element) => scoreClickableProjectNavigationCandidate(element, comparableName, {
          extractProjectPathSegment,
          normalizeText
        }))
        .filter(Boolean)
        .sort((left, right) => right.score - left.score);

      return candidates[0] || null;
    }

    function scoreClickableProjectNavigationCandidate(element, projectName, { extractProjectPathSegment, normalizeText }) {
      if (!element || !element.isConnected || !elementIsVisible(element)) {
        return null;
      }

      const label = normalizeLinkedProjectText([
        element.getAttribute?.("aria-label"),
        element.getAttribute?.("title"),
        element.innerText,
        element.textContent
      ].filter(Boolean).join(" "));

      if (!label || /options|rename|delete|archive|share|more|menu/.test(label)) {
        return null;
      }

      const labelWithoutProjectSuffix = label.replace(/\s+project$/, "");
      const exactNameMatch = label === projectName || labelWithoutProjectSuffix === projectName;
      const containsName = label.includes(projectName);

      if (!exactNameMatch && !containsName) {
        return null;
      }

      const href = element.href || element.getAttribute?.("href") || "";
      const hrefProject = extractProjectFromHref(href, extractProjectPathSegment);
      const clickTarget = resolveProjectHomeClickTarget(element) || element;
      let score = exactNameMatch ? 140 : 90;

      if (hrefProject.segment) {
        score += 80;
      }

      if (normalizeLinkedProjectText(element.closest?.("aside, nav, section")?.innerText || "").includes("projects")) {
        score += 25;
      }

      if (clickTarget !== element) {
        score += 20;
      }

      return {
        element,
        clickTarget,
        score,
        segment: hrefProject.segment,
        url: hrefProject.url
      };
    }

    function resolveProjectHomeClickTarget(element) {
      const controls = Array.from(element.querySelectorAll?.('a[href], button, [role="button"], [role="link"], [role="treeitem"]') || []);

      return controls.find((candidate) => {
        if (candidate === element || !elementIsVisible(candidate)) {
          return false;
        }

        const label = normalizeLinkedProjectText([
          candidate.getAttribute?.("aria-label"),
          candidate.getAttribute?.("title"),
          candidate.innerText,
          candidate.textContent
        ].filter(Boolean).join(" "));

        return /open project home|project home/.test(label);
      }) || controls.find((candidate) => candidate !== element && elementIsVisible(candidate) && candidate.href);
    }

    function extractProjectFromHref(href, extractProjectPathSegment) {
      if (!href) {
        return { segment: "", url: "" };
      }

      try {
        const url = new URL(href, location.origin);
        const segment = extractProjectPathSegment(url.pathname);

        return {
          segment,
          url: segment ? `${url.origin}/g/${segment}/project` : ""
        };
      } catch (_error) {
        return { segment: "", url: "" };
      }
    }

    function dispatchSyntheticClick(element) {
      if (!element) {
        return;
      }

      const rect = element.getBoundingClientRect?.() || { left: 0, top: 0, width: 1, height: 1 };
      const clientX = Math.round(rect.left + Math.max(1, Math.min(32, rect.width / 2)));
      const clientY = Math.round(rect.top + Math.max(1, rect.height / 2));

      element.focus?.();

      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        element.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY
        }));
      }
    }

    function elementIsVisible(element) {
      if (!element || !element.isConnected) {
        return false;
      }

      const style = window.getComputedStyle?.(element);

      if (style && (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0)) {
        return false;
      }

      const rect = element.getBoundingClientRect?.();

      return !rect || (rect.width > 0 && rect.height > 0);
    }

    function findLinkedProjectInDocument(projectName, extractProjectPathSegment) {
      const comparableName = normalizeLinkedProjectText(projectName);

      if (!comparableName) {
        return null;
      }

      const candidates = Array.from(document.querySelectorAll('a[href*="/g/"]'))
        .map((link) => {
          const href = link.href || link.getAttribute("href") || "";
          let url;

          try {
            url = new URL(href, location.origin);
          } catch (_error) {
            return null;
          }

          const segment = extractProjectPathSegment(url.pathname);

          if (!segment) {
            return null;
          }

          const label = normalizeLinkedProjectText([
            link.getAttribute("aria-label"),
            link.getAttribute("title"),
            link.innerText,
            link.textContent
          ].filter(Boolean).join(" "));
          const score = scoreLinkedProjectCandidate({
            label,
            pathname: url.pathname,
            projectName: comparableName
          });

          if (score <= 0) {
            return null;
          }

          return {
            score,
            segment,
            url: `${url.origin}/g/${segment}/project`
          };
        })
        .filter(Boolean)
        .sort((left, right) => right.score - left.score);

      return candidates[0] || null;
    }

    function scoreLinkedProjectCandidate({ label, pathname, projectName }) {
      if (!label || !projectName) {
        return 0;
      }

      const projectLabel = label.replace(/\s+project$/, "");
      let score = 0;

      if (label === projectName || projectLabel === projectName) {
        score += 120;
      } else if (label.includes(projectName)) {
        score += 70;
      } else {
        return 0;
      }

      if (/\/project\/?$/i.test(pathname)) {
        score += 40;
      }

      return score;
    }

    function normalizeLinkedProjectText(value) {
      return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
    }

    async function fetchProjectScopedConversationPage(project, page) {
      const params = new URLSearchParams({
        offset: String(page.offset),
        limit: String(page.limit),
        order: "updated"
      });
      const endpoints = [
        {
          cacheKey: "gizmos-conversations",
          url: `${location.origin}/backend-api/gizmos/${encodeURIComponent(project.segment)}/conversations?${params}`,
          trustProjectScope: true
        },
        {
          cacheKey: "projects-conversations",
          url: `${location.origin}/backend-api/projects/${encodeURIComponent(project.segment)}/conversations?${params}`,
          trustProjectScope: true
        },
        {
          cacheKey: "conversations-gizmo-id",
          url: `${location.origin}/backend-api/conversations?${params}&gizmo_id=${encodeURIComponent(project.segment)}`,
          trustProjectScope: false
        },
        {
          cacheKey: "conversations-project-id",
          url: `${location.origin}/backend-api/conversations?${params}&project_id=${encodeURIComponent(project.segment)}`,
          trustProjectScope: false
        }
      ];
      const cacheKey = `${location.origin}|${project.segment}`;
      const cachedEndpointKey = projectScopedEndpointCache.get(cacheKey);
      const orderedEndpoints = cachedEndpointKey
        ? endpoints.slice().sort((left, right) => Number(right.cacheKey === cachedEndpointKey) - Number(left.cacheKey === cachedEndpointKey))
        : endpoints;
      const errors = [];
      let firstAuthoritativeEmptyResult = null;
      let firstEmptyResult = null;

      for (const endpoint of orderedEndpoints) {
        try {
          const data = await fetchJson(endpoint.url);
          const normalized = normalizeConversationListPayload(data, {
            project,
            source: "project-api",
            trustProjectScope: endpoint.trustProjectScope,
            deps
          });
          const result = {
            conversations: normalized.conversations.slice(0, page.limit),
            nextCursor: resolveNextCursor(data, page.offset, normalized.rawItemCount),
            source: "project-api",
            authoritative: endpoint.trustProjectScope
          };

          if (result.conversations.length) {
            projectScopedEndpointCache.set(cacheKey, endpoint.cacheKey);
            return result;
          }

          if (result.authoritative && !firstAuthoritativeEmptyResult) {
            firstAuthoritativeEmptyResult = result;
          }

          if (!firstEmptyResult) {
            firstEmptyResult = result;
          }
        } catch (error) {
          errors.push(`${endpoint.url}: ${error?.message || String(error)}`);
        }
      }

      if (firstAuthoritativeEmptyResult) {
        return firstAuthoritativeEmptyResult;
      }

      if (firstEmptyResult) {
        return firstEmptyResult;
      }

      return {
        conversations: [],
        nextCursor: null,
        source: errors.length ? `project-api-unavailable: ${errors[0]}` : "project-api-unavailable",
        authoritative: false
      };
    }

    async function fetchFilteredConversationPages(project, page) {
      const conversations = [];
      let nextOffset = page.offset;
      let lastNextCursor = null;

      for (let index = 0; index < MAX_ALL_HISTORY_PAGES && conversations.length < page.limit; index += 1) {
        const fetchLimit = Math.max(page.limit * ALL_HISTORY_PAGE_LIMIT_MULTIPLIER, page.limit);
        const params = new URLSearchParams({
          offset: String(nextOffset),
          limit: String(fetchLimit),
          order: "updated"
        });
        const data = await fetchJson(`${location.origin}/backend-api/conversations?${params}`).catch(() => null);

        if (!data) {
          break;
        }

        const normalized = normalizeConversationListPayload(data, {
          project,
          source: "all-history-api",
          trustProjectScope: false,
          deps
        });

        for (const conversation of normalized.conversations) {
          if (!conversations.some((item) => item.id === conversation.id)) {
            conversations.push(conversation);
          }
        }

        lastNextCursor = resolveNextCursor(data, nextOffset, normalized.rawItemCount);

        if (lastNextCursor === null || normalized.rawItemCount === 0) {
          break;
        }

        nextOffset = lastNextCursor;
      }

      return {
        conversations: conversations.slice(0, page.limit),
        nextCursor: lastNextCursor,
        source: "all-history-api"
      };
    }

    async function fetchConversationData(conversationKey) {
      const key = encodeURIComponent(conversationKey);
      const endpoints = [
        `${location.origin}/backend-api/conversation/${key}`,
        `${location.origin}/backend-api/conversation/${key}?metadata=true`
      ];
      const errors = [];

      for (const endpoint of endpoints) {
        try {
          return await fetchJson(endpoint);
        } catch (error) {
          errors.push(`${error?.message || String(error)} at ${endpoint}`);
        }
      }

      throw new Error(`Conversation API returned no usable conversation. ${errors.join("; ")}`);
    }

    async function fetchJson(endpoint) {
      const headers = {
        accept: "application/json"
      };
      const token = await getChatGptAccessToken();

      if (token) {
        headers.authorization = `Bearer ${token}`;
      }

      const response = await fetch(endpoint, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error(`ChatGPT authentication is required for project history (HTTP ${response.status}).`);
        }

        throw new Error(`HTTP ${response.status}`);
      }

      return response.json();
    }

    return Object.freeze({
      listProjectConversations,
      loadProjectConversation
    });
  }

  function extractProjectSegmentFromElement(element, extractProjectPathSegment) {
    const href = element?.href || element?.getAttribute?.("href") || "";

    if (!href) {
      return "";
    }

    try {
      return extractProjectPathSegment(new URL(href, location.origin).pathname);
    } catch (_error) {
      return "";
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  runtime.projectHistory = Object.freeze({
    createController
  });
})();
