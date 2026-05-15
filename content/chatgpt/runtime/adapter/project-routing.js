(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};

  function createMethods({
    REQUEST_STATES,
    DomAdapterError,
    clickElement,
    emitState,
    findAncestorContainingProjectSubmit,
    findVisible,
    getElementLabel,
    isDisabled,
    isVisible,
    isProjectNameInputCandidate,
    isProjectNavigationTarget,
    isProjectOverflowControl,
    isSelectedNavigationElement,
    normalizeComparableText,
    normalizeProjectOptions,
    queryAllSafe,
    queryAllWithin,
    scoreCreateProjectLabel,
    scoreDialogActionCandidate,
    scoreProjectCandidate,
    scoreProjectNameInputCandidate,
    setEditableText,
    sleep,
    textMatchesName,
    uniqueElements,
    urlLooksProjectScopedForName,
    waitFor,
    waitForOptional
  }) {
    return {
      async ensureProjectContext(projectOptions, requestId, run) {
        const project = normalizeProjectOptions(projectOptions);

        if (!project.enabled || !project.name) {
          return;
        }

        await this.ensureSidebarOpen();

        if (this.hasProjectContext(project.name)) {
          emitState(requestId, REQUEST_STATES.PROJECT_READY, {
            detail: `Already routed to project: ${project.name}`
          });
          return;
        }

        const existingProject = await waitForOptional(
          () => this.findProjectNavigationItem(project.name),
          3500,
          run
        );

        if (existingProject) {
          const originalUrl = location.href;
          clickProjectNavigationElement(existingProject, {
            isProjectOverflowControl,
            isVisible,
            queryAllWithin
          });
          await this.waitForProjectContext(project.name, originalUrl, run);
          emitState(requestId, REQUEST_STATES.PROJECT_READY, {
            detail: `Routed to existing project: ${project.name}`
          });
          return;
        }

        if (!project.createIfMissing) {
          throw new DomAdapterError(`ChatGPT project was not found: ${project.name}`, this.collectSnapshot());
        }

        await this.createProject(project.name, requestId, run);
      },

      async createProject(projectName, requestId, run) {
        const createButton = this.findProjectCreateButton();

        if (!createButton) {
          throw new DomAdapterError("Could not find ChatGPT's New project control.", this.collectSnapshot());
        }

        clickElement(createButton);

        const dialog = await waitFor(
          () => this.findVisibleDialog() || this.findProjectNameInput(document.body)?.closest?.("form, [role='dialog'], dialog") || this.findProjectNameInput(document.body),
          10000,
          run,
          "Timed out waiting for the ChatGPT project creation dialog."
        );
        const nameInput = await waitFor(
          () => this.findProjectNameInput(dialog) || this.findProjectNameInput(document.body),
          10000,
          run,
          "Timed out waiting for the ChatGPT project name input."
        );

        await setEditableText(nameInput, projectName);

        const actionRoot = this.findProjectCreationActionRoot(nameInput, dialog);
        const submitButton = await waitFor(
          () => this.findDialogAction(actionRoot, /create|continue|done|save/i)
            || this.findDialogAction(dialog, /create|continue|done|save/i),
          10000,
          run,
          "Timed out waiting for the ChatGPT project creation button."
        );
        const originalUrl = location.href;

        clickElement(submitButton);

        try {
          await this.waitForProjectContext(projectName, originalUrl, run);
        } catch (_error) {
          const createdProject = this.findProjectNavigationItem(projectName);

          if (!createdProject) {
            throw new DomAdapterError(`Project was created or submitted, but ChatGPT did not expose project context for: ${projectName}`, this.collectSnapshot());
          }

          clickProjectNavigationElement(createdProject, {
            isProjectOverflowControl,
            isVisible,
            queryAllWithin
          });
          await this.waitForProjectContext(projectName, location.href, run);
        }

        emitState(requestId, REQUEST_STATES.PROJECT_READY, {
          detail: `Created and routed to project: ${projectName}`
        });
      },

      async ensureSidebarOpen() {
        if (this.findSidebar()) {
          return;
        }

        const toggle = findVisible(queryAllSafe('button, [role="button"]')
          .filter((element) => {
            const label = getElementLabel(element).toLowerCase();

            return /open sidebar|show sidebar|sidebar/.test(label) && !/close|hide/.test(label);
          }));

        if (toggle) {
          clickElement(toggle);
          await sleep(350);
        }
      },

      findSidebar() {
        return findVisible(queryAllSafe('aside, nav[aria-label*="sidebar" i], [data-testid*="sidebar" i], [aria-label*="chat history" i]')
          .filter((element) => {
            const text = getElementLabel(element).toLowerCase();

            return /project|chat|history/.test(text);
          }));
      },

      hasProjectContext(projectName) {
        return Boolean(this.findCurrentProjectIndicator(projectName));
      },

      findCurrentProjectIndicator(projectName) {
        const exactHeading = findVisible(queryAllSafe('main h1, main h2, [aria-current="page"], [data-current="true"]')
          .filter((element) => textMatchesName(getElementLabel(element), projectName)));

        if (exactHeading) {
          return exactHeading;
        }

        if (urlLooksProjectScopedForName(projectName)) {
          return document.body;
        }

        const pathLooksProjectScoped = /\/project|\/projects/.test(location.pathname.toLowerCase())
          || /project/.test(location.search.toLowerCase())
          || /\/g\/g-p-/.test(location.pathname.toLowerCase());

        if (!pathLooksProjectScoped) {
          return null;
        }

        const bodyText = normalizeComparableText(document.body?.innerText || document.body?.textContent || "");

        return bodyText.includes(normalizeComparableText(projectName)) ? document.body : null;
      },

      findProjectNavigationItem(projectName) {
        const hinted = this.findByHints(
          "projectNavigationItem",
          (element) => isProjectNavigationTarget(element, projectName)
        );

        if (hinted) {
          return hinted;
        }

        const root = this.findSidebar() || document.body;
        const candidates = queryAllWithin(root, 'a[href], [role="link"], [role="treeitem"], [aria-current], button')
          .filter((element) => isProjectNavigationTarget(element, projectName))
          .map((element) => ({
            element,
            score: scoreProjectCandidate(element, projectName)
          }))
          .filter((candidate) => candidate.score >= 80)
          .sort((a, b) => b.score - a.score);

        return candidates[0]?.element || null;
      },

      findSelectedProjectNavigationItem(projectName) {
        const projectItem = this.findProjectNavigationItem(projectName);

        if (projectItem && isSelectedNavigationElement(projectItem)) {
          return projectItem;
        }

        return null;
      },

      findProjectCreateButton() {
        const hinted = this.findByHints(
          "projectCreateButton",
          (element) => isVisible(element) && !isDisabled(element) && /new project|create project|add project/.test(getElementLabel(element).toLowerCase())
        );

        if (hinted) {
          return hinted;
        }

        const roots = uniqueElements([this.findSidebar(), document.body]);
        const candidates = roots.flatMap((root) => queryAllWithin(root, 'button, a, [role="button"], [role="menuitem"]'))
          .filter((element) => isVisible(element) && !isDisabled(element))
          .map((element) => ({
            element,
            label: getElementLabel(element).toLowerCase()
          }))
          .filter(({ label }) => /new project|create project|add project/.test(label))
          .sort((a, b) => scoreCreateProjectLabel(b.label) - scoreCreateProjectLabel(a.label));

        return candidates[0]?.element || null;
      },

      findVisibleDialog() {
        return findVisible(queryAllSafe('[role="dialog"], dialog'));
      },

      findProjectNameInput(root) {
        const roots = uniqueElements([
          root,
          this.findVisibleDialog(),
          document.body
        ]).filter(Boolean);

        for (const candidateRoot of roots) {
          const hinted = this.findByHints(
            "projectNameInput",
            (element) => candidateRoot.contains(element)
              && isVisible(element)
              && !isDisabled(element)
              && isProjectNameInputCandidate(element)
          );

          if (hinted) {
            return hinted;
          }

          const candidates = queryAllWithin(candidateRoot, 'input:not([type]), input[type="text"], textarea, [contenteditable="true"], [role="textbox"]')
            .filter((element) => isVisible(element) && !isDisabled(element))
            .map((element) => ({
              element,
              score: scoreProjectNameInputCandidate(element)
            }))
            .filter((candidate) => candidate.score > 0)
            .sort((a, b) => b.score - a.score);

          if (candidates[0]?.element) {
            return candidates[0].element;
          }
        }

        return null;
      },

      findProjectCreationActionRoot(nameInput, dialog) {
        const roots = uniqueElements([
          nameInput?.closest?.("form"),
          nameInput?.closest?.('[role="dialog"], dialog'),
          dialog && dialog.contains?.(nameInput) ? dialog : null,
          findAncestorContainingProjectSubmit(nameInput),
          this.findVisibleDialog()
        ]).filter(Boolean);

        return roots[0] || document.body;
      },

      findDialogAction(root, labelPattern) {
        if (!root) {
          return null;
        }

        const actions = queryAllWithin(root, 'button, [role="button"], input[type="submit"]')
          .filter((element) => isVisible(element) && !isDisabled(element))
          .map((element) => ({
            element,
            score: scoreDialogActionCandidate(element, labelPattern)
          }))
          .filter((candidate) => candidate.score > 0)
          .sort((a, b) => b.score - a.score);

        return actions[0]?.element || null;
      },

      async waitForProjectContext(projectName, originalUrl, run) {
        await waitFor(
          () => {
            if (this.hasProjectContext(projectName)) {
              return true;
            }

            if (this.findSelectedProjectNavigationItem(projectName) && this.findComposer()) {
              return true;
            }

            return location.href !== originalUrl && this.findCurrentProjectIndicator(projectName);
          },
          18000,
          run,
          `Timed out waiting for ChatGPT project context: ${projectName}`
        );

        await sleep(400);
      }
    };
  }

  function clickProjectNavigationElement(element, {
    isProjectOverflowControl,
    isVisible,
    queryAllWithin
  }) {
    const target = resolveProjectNavigationClickTarget(element, {
      isProjectOverflowControl,
      isVisible,
      queryAllWithin
    });
    const rect = target.getBoundingClientRect();
    const clientX = Math.round(rect.left + Math.min(32, Math.max(8, rect.width * 0.25)));
    const clientY = Math.round(rect.top + rect.height / 2);

    target.focus?.();

    for (const type of ["mousedown", "mouseup", "click"]) {
      target.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY
      }));
    }
  }

  function resolveProjectNavigationClickTarget(element, {
    isProjectOverflowControl,
    isVisible,
    queryAllWithin
  }) {
    if (!element) {
      return element;
    }

    if (isProjectOverflowControl(element)) {
      return element;
    }

    const nestedLink = queryAllWithin(element, 'a[href], [role="link"], [role="treeitem"]')
      .find((candidate) => candidate !== element && isVisible(candidate) && !isProjectOverflowControl(candidate));

    return nestedLink || element;
  }

  runtime.adapterProjectRouting = Object.freeze({
    createMethods
  });
})();
