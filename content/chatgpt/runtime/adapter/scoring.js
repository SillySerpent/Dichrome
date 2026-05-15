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

    if (!label || /send|stop|attach|upload|sidebar|project|new chat/.test(label)) {
      return 0;
    }

    const rect = element.getBoundingClientRect();
    let score = 0;

    if (/model|change model|select model/.test(label)) {
      score += 100;
    }

    if (/\bgpt\b|gpt-|gpt\s|auto|instant|thinking|pro|o3|o4/.test(label)) {
      score += 60;
    }

    if (rect.top >= 0 && rect.top < 180) {
      score += 30;
    }

    if (element.closest("header")) {
      score += 20;
    }

    return score;
  }

  function scoreModelOptionCandidate(element, modelLabel) {
    if (element.tagName === "DIV" && element.querySelector('button, [role="option"], [role="menuitem"]')) {
      return 0;
    }

    const label = normalizeComparableText(getElementLabel(element));
    const target = normalizeComparableText(modelLabel);

    if (!label || !target) {
      return 0;
    }

    if (label === target) {
      return 120;
    }

    if (label.startsWith(target)) {
      return 100;
    }

    if (label.includes(target)) {
      return 80;
    }

    return 0;
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
