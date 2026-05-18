(() => {
  const relay = globalThis.ChatGptRelay = globalThis.ChatGptRelay || {};
  const runtime = relay.runtime = relay.runtime || {};
  const {
    getElementLabel,
    isDisabled,
    isTextInput,
    isVisible,
    normalizeText,
    queryAllWithin
  } = runtime.domUtils || {};

  function scoreProjectCandidate(element, projectName) {
    if (!isProjectNavigationTarget(element, projectName)) {
      return 0;
    }

    const label = getElementLabel(element);
    const comparableLabel = normalizeComparableText(label);
    const comparableName = normalizeComparableText(projectName);

    if (!comparableName) {
      return 0;
    }

    let score = 0;

    if (comparableLabel === comparableName || comparableLabel === `${comparableName} project`) {
      score += 110;
    } else if (comparableLabel.includes(comparableName)) {
      score += 75;
    } else {
      return 0;
    }

    const href = getElementHref(element);

    if (/project/.test(href)) {
      score += 50;
    }

    const aria = normalizeComparableText(element.getAttribute("aria-label") || "");

    if (aria.includes("project")) {
      score += 30;
    }

    const sectionText = normalizeComparableText(element.closest("section, nav, aside, [role='navigation'], div")?.innerText || "");

    if (sectionText.includes("projects")) {
      score += 20;
    }

    return score;
  }

  function isProjectNavigationTarget(element, projectName) {
    if (!element || !isVisible(element) || isDisabled(element) || isProjectOverflowControl(element)) {
      return false;
    }

    if (element.closest('[role="menu"], [role="dialog"]')) {
      return false;
    }

    const comparableLabel = normalizeComparableText(getElementLabel(element));
    const comparableName = normalizeComparableText(projectName);

    if (!comparableName || !comparableLabel.includes(comparableName)) {
      return false;
    }

    const tag = element.tagName;
    const role = element.getAttribute("role") || "";

    return tag === "A"
      || role === "link"
      || role === "treeitem"
      || element.hasAttribute("aria-current")
      || (tag === "BUTTON" && !isProjectOverflowControl(element));
  }

  function isProjectOverflowControl(element) {
    const label = normalizeComparableText(getElementLabel(element));
    const ariaLabel = normalizeComparableText(element?.getAttribute?.("aria-label") || "");
    const testId = normalizeComparableText(element?.getAttribute?.("data-testid") || "");
    const title = normalizeComparableText(element?.getAttribute?.("title") || "");
    const combined = `${label} ${ariaLabel} ${testId} ${title}`;

    if (element?.getAttribute?.("aria-haspopup") && !combined.includes("project")) {
      return true;
    }

    if (/more|options|menu|overflow|ellipsis|share|rename|delete|archive/.test(combined)) {
      return true;
    }

    return label === "..." || label === "\u2026" || combined.trim() === "";
  }

  function isSelectedNavigationElement(element) {
    const selectedTarget = element.closest?.('[aria-current="page"], [aria-current="true"], [aria-selected="true"], [data-selected="true"], [data-active="true"]')
      || element.matches?.('[aria-current="page"], [aria-current="true"], [aria-selected="true"], [data-selected="true"], [data-active="true"]');

    if (selectedTarget) {
      return true;
    }

    const className = String(element.className || element.closest?.("a, button, [role='link'], [role='treeitem']")?.className || "").toLowerCase();

    return /\b(active|selected|current)\b/.test(className);
  }

  function scoreNewChatCandidate(element) {
    const href = getElementHref(element);
    let score = 0;

    if (element.closest("aside, nav")) {
      score += 30;
    }

    if (href === "/" || href.endsWith("/")) {
      score += 20;
    }

    if (element.tagName === "A") {
      score += 10;
    }

    return score;
  }

  function scoreCreateProjectLabel(label) {
    if (/^new project$|^create project$/.test(label)) {
      return 100;
    }

    if (/new project|create project/.test(label)) {
      return 80;
    }

    return /add project/.test(label) ? 60 : 0;
  }

  function isProjectNameInputCandidate(element) {
    return scoreProjectNameInputCandidate(element) > 0;
  }

  function scoreProjectNameInputCandidate(element) {
    if (!element || !(isTextInput(element) || element.getAttribute("role") === "textbox" || element.isContentEditable)) {
      return 0;
    }

    const label = normalizeComparableText(getElementLabel(element));
    const metadata = normalizeComparableText([
      element.id,
      element.name,
      element.getAttribute?.("data-testid"),
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("placeholder")
    ].filter(Boolean).join(" "));
    const combined = `${metadata} ${label}`.trim();

    if (/prompt|composer|message|chat with chatgpt|attach|upload|file/.test(combined)) {
      return 0;
    }

    let score = 0;

    if (/\bproject-name\b|\bproject name\b/.test(combined)) {
      score += 200;
    }

    if (/\bproject\b/.test(combined)) {
      score += 90;
    }

    if (/\bname\b/.test(combined)) {
      score += 45;
    }

    if (element.tagName === "INPUT") {
      score += 35;
    } else if (element.tagName === "TEXTAREA") {
      score += 15;
    }

    const actionRoot = findAncestorContainingProjectSubmit(element);
    if (actionRoot) {
      score += 50;
    }

    const rect = element.getBoundingClientRect();
    if (rect.top >= -10 && rect.top < 180) {
      score += 20;
    }

    return score;
  }

  function findAncestorContainingProjectSubmit(element) {
    let node = element?.parentElement || null;
    let depth = 0;

    while (node && node !== document.body && depth < 8) {
      const hasProjectSubmit = queryAllWithin(node, 'button, [role="button"], input[type="submit"]')
        .some((candidate) => scoreDialogActionCandidate(candidate, /create|continue|done|save/i, { allowDisabled: true }) > 0);

      if (hasProjectSubmit) {
        return node;
      }

      node = node.parentElement;
      depth += 1;
    }

    return null;
  }

  function scoreDialogActionCandidate(element, labelPattern, options = {}) {
    const label = normalizeComparableText(getElementLabel(element));

    if (!label || !labelPattern.test(label)) {
      return 0;
    }

    if (!options.allowDisabled && isDisabled(element)) {
      return 0;
    }

    if (/cancel|back|close|dismiss/.test(label)) {
      return 0;
    }

    if (/create an image|write or edit|look something up|new project/.test(label)) {
      return 0;
    }

    if (/^create project$/.test(label)) {
      return 220;
    }

    if (/^create$/.test(label)) {
      return 180;
    }

    if (/create project/.test(label)) {
      return 160;
    }

    if (/continue|done|save/.test(label)) {
      return 120;
    }

    return /create/.test(label) ? 80 : 0;
  }

  function scoreModelPickerCandidate(element) {
    const label = normalizeComparableText(getElementLabel(element));
    const metadata = normalizeComparableText([
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("data-testid"),
      element.getAttribute?.("title"),
      element.getAttribute?.("aria-haspopup"),
      element.getAttribute?.("role")
    ].filter(Boolean).join(" "));
    const combined = `${label} ${metadata}`.trim();

    if (!combined || /send|stop|attach|upload|sidebar|project|new chat|voice|microphone/.test(combined)) {
      return 0;
    }

    const rect = element.getBoundingClientRect();
    let score = 0;

    if (/model|change model|select model/.test(combined)) {
      score += 100;
    }

    if (/\bgpt\b|gpt-|gpt\s|auto|instant|thinking|reason|reasoning|extended|standard|fast|pro|o3|o4|deep research/.test(label)) {
      score += 60;
    }

    if (/menu|listbox|dialog|true/.test(metadata) && score > 0) {
      score += 20;
    }

    if (element.closest("form") && /\b(auto|instant|thinking|reasoning|extended|standard|fast|pro)\b/.test(label)) {
      score += 25;
    }

    if (rect.top >= 0 && rect.top < 180) {
      score += 30;
    }

    if (element.closest("header")) {
      score += 20;
    }

    return score;
  }

  function scoreModelOptionCandidate(element, modelLabel, options = {}) {
    const label = normalizeComparableText(getElementLabel(element));
    const target = normalizeComparableText(modelLabel);

    if (!label || !target || isLikelyModelOptionContainer(element, label, target)) {
      return 0;
    }

    if (isModelOptionNavigationNoise(element, label)) {
      return 0;
    }

    const selectedNoise = /selected|current|recommended|default|unavailable|upgrade|coming soon|new|beta/g;
    const simplifiedLabel = label.replace(selectedNoise, "").replace(/\s+/g, " ").trim();
    const targets = options.requireExact ? [target] : expandModelTargets(target);
    let score = 0;

    for (const candidateTarget of targets) {
      const candidateScore = scoreModelLabelText(label, simplifiedLabel, candidateTarget);

      if (candidateScore > score) {
        score = candidateScore;
      }
    }

    if (!score) {
      return 0;
    }

    if (isDirectlyActionableModelElement(element)) {
      score += 35;
    }

    if (element.getAttribute?.("aria-checked") === "true" || element.getAttribute?.("aria-selected") === "true" || element.getAttribute?.("data-state") === "checked") {
      score += 12;
    }

    const rect = element.getBoundingClientRect?.();

    if (rect && rect.width > 32 && rect.height > 18) {
      score += 8;
    }

    return score;
  }

  function scoreModelLabelText(label, simplifiedLabel, target) {
    if (!target) {
      return 0;
    }

    if (label === target) {
      return 190;
    }

    if (simplifiedLabel === target) {
      return 180;
    }

    if (label.startsWith(target) || simplifiedLabel.startsWith(target)) {
      return 155;
    }

    if (containsStandalonePhrase(label, target) || containsStandalonePhrase(simplifiedLabel, target)) {
      return 145;
    }

    if (label.includes(target) || simplifiedLabel.includes(target)) {
      return 100;
    }

    return 0;
  }

  function expandModelTargets(target) {
    const aliases = new Set([target]);

    if (target === "instant" || target === "fast") {
      aliases.add("instant");
      aliases.add("fast");
      aliases.add("fast answers");
      aliases.add("quick answers");
    }

    if (target === "thinking" || target === "reasoning" || target === "think") {
      aliases.add("thinking");
      aliases.add("reasoning");
      aliases.add("reason");
      aliases.add("thinks before answering");
    }

    if (target === "auto") {
      aliases.add("auto");
      aliases.add("automatic");
      aliases.add("best available");
    }

    if (target === "extended") {
      aliases.add("extended");
      aliases.add("extended thinking");
      aliases.add("deep thinking");
    }

    if (target === "pro") {
      aliases.add("pro");
    }

    return Array.from(aliases).filter(Boolean);
  }

  function isModelOptionNavigationNoise(element, label) {
    const metadata = normalizeComparableText([
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("data-testid"),
      element.getAttribute?.("title"),
      element.getAttribute?.("href")
    ].filter(Boolean).join(" "));
    const combined = `${label} ${metadata}`.trim();

    return /open conversation options|conversation options|history-item|open project options|project options|show chats|hide chats|search chats|recents|new project|share|profile menu|download apps|copy message|edit message|sidebar/.test(combined);
  }

  function isLikelyModelOptionContainer(element, label, target) {
    const descendantActionCount = queryAllWithin(element, 'button, a, li, [role="option"], [role="menuitem"], [role="menuitemradio"], [role="radio"], [aria-checked], [aria-selected], [cmdk-item], [data-radix-collection-item]')
      .filter((candidate) => candidate !== element && isVisible(candidate) && !isDisabled(candidate))
      .length;

    if (descendantActionCount > 0) {
      const labelIsLarge = label.length > target.length + 32;
      const keywordHits = countModelKeywordHits(label);

      if (!isDirectlyActionableModelElement(element) || keywordHits >= 2 || labelIsLarge) {
        return true;
      }
    }

    const role = element.getAttribute?.("role") || "";
    const keywordHits = countModelKeywordHits(label);
    const targetIsOnlyModelKeyword = countModelKeywordHits(target) <= 1;

    if ((role === "dialog" || role === "menu" || role === "listbox" || role === "presentation") && keywordHits >= 2 && targetIsOnlyModelKeyword) {
      return true;
    }

    return !isDirectlyActionableModelElement(element)
      && keywordHits >= 3
      && label.length > target.length + 24;
  }

  function isDirectlyActionableModelElement(element) {
    if (!element) {
      return false;
    }

    const role = element.getAttribute?.("role") || "";

    return element.tagName === "BUTTON"
      || element.tagName === "A"
      || element.tagName === "LI"
      || role === "option"
      || role === "menuitem"
      || role === "menuitemradio"
      || role === "radio"
      || element.hasAttribute?.("aria-checked")
      || element.hasAttribute?.("aria-selected")
      || element.hasAttribute?.("cmdk-item")
      || element.hasAttribute?.("data-radix-collection-item");
  }

  function containsStandalonePhrase(value, phrase) {
    if (!value || !phrase) {
      return false;
    }

    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");

    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(value);
  }

  function countModelKeywordHits(value) {
    const keywords = [
      "auto",
      "automatic",
      "instant",
      "thinking",
      "reason",
      "reasoning",
      "extended",
      "standard",
      "fast",
      "fast answers",
      "quick answers",
      "pro",
      "o3",
      "o4",
      "gpt",
      "deep research"
    ];

    return keywords.reduce((count, keyword) => count + (containsStandalonePhrase(value, keyword) ? 1 : 0), 0);
  }

  function textMatchesName(value, name) {
    const comparableValue = normalizeComparableText(value);
    const comparableName = normalizeComparableText(name);

    return comparableValue === comparableName || comparableValue === `${comparableName} project`;
  }

  function elementMatchesText(element, targetText) {
    const label = normalizeComparableText(getElementLabel(element));
    const target = normalizeComparableText(targetText);

    return Boolean(target && (label === target || label.includes(target)));
  }

  function normalizeComparableText(value) {
    return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
  }

  function getElementHref(element) {
    const link = element.closest?.("a[href]") || (element.matches?.("a[href]") ? element : null);

    return String(link?.getAttribute("href") || link?.href || "").toLowerCase();
  }

  runtime.adapterScoring = Object.freeze({
    scoreProjectCandidate,
    isProjectNavigationTarget,
    isProjectOverflowControl,
    isSelectedNavigationElement,
    scoreNewChatCandidate,
    scoreCreateProjectLabel,
    isProjectNameInputCandidate,
    scoreProjectNameInputCandidate,
    findAncestorContainingProjectSubmit,
    scoreDialogActionCandidate,
    scoreModelPickerCandidate,
    scoreModelOptionCandidate,
    textMatchesName,
    elementMatchesText,
    normalizeComparableText,
    getElementHref
  });
})();
