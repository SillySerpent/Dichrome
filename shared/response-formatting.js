import {
  RESPONSE_ALLOWED_ATTRIBUTES,
  RESPONSE_ALLOWED_TAGS
} from "./contracts.js";

const INLINE_PLACEHOLDER_PREFIX = "\uE000";
const INLINE_PLACEHOLDER_SUFFIX = "\uE001";
const WRITING_BLOCK_PLACEHOLDER_PREFIX = "@@WRITING_BLOCK_";

const LATEX_COMMANDS = Object.freeze({
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  theta: "θ",
  varepsilon: "ε",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  kappa: "κ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  upsilon: "υ",
  tau: "τ",
  phi: "φ",
  varphi: "φ",
  psi: "ψ",
  chi: "χ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  times: "×",
  cdot: "·",
  circ: "∘",
  div: "÷",
  pm: "±",
  mp: "∓",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ll: "≪",
  gg: "≫",
  neq: "≠",
  approx: "≈",
  equiv: "≡",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  emptyset: "∅",
  varnothing: "∅",
  forall: "∀",
  exists: "∃",
  rightarrow: "→",
  to: "→",
  leftarrow: "←",
  gets: "←",
  Rightarrow: "⇒",
  implies: "⇒",
  Leftrightarrow: "⇔",
  iff: "⇔",
  mapsto: "↦",
  mid: "|",
  vert: "|",
  lvert: "|",
  rvert: "|",
  lVert: "‖",
  rVert: "‖",
  langle: "⟨",
  rangle: "⟩",
  land: "∧",
  lor: "∨",
  neg: "¬",
  top: "⊤",
  bot: "⊥",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  setminus: "\\",
  ell: "ℓ",
  imath: "ı",
  jmath: "ȷ",
  degree: "°",
  dots: "…",
  ldots: "…",
  cdots: "⋯",
  prime: "′",
  sum: "∑",
  prod: "∏",
  int: "∫",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  log: "log",
  ln: "ln",
  exp: "exp",
  lim: "lim",
  det: "det",
  rank: "rank",
  min: "min",
  max: "max",
  Pr: "Pr",
  left: "",
  right: "",
  big: "",
  Big: "",
  quad: " ",
  qquad: "  ",
  ",": " ",
  ";": " ",
  ":": " ",
  "!": ""
});

const LATEX_ACCENT_COMMANDS = Object.freeze({
  hat: "hat",
  widehat: "hat",
  tilde: "tilde",
  widetilde: "tilde",
  vec: "vec",
  dot: "dot",
  ddot: "ddot",
  mathring: "ring",
  overrightarrow: "vec",
  overleftarrow: "left-vec"
});

const MATRIX_ENVIRONMENT_DELIMITERS = Object.freeze({
  matrix: ["", ""],
  smallmatrix: ["", ""],
  array: ["", ""],
  bmatrix: ["[", "]"],
  pmatrix: ["(", ")"],
  vmatrix: ["|", "|"],
  Vmatrix: ["‖", "‖"]
});

const LATEX_TEXT_STYLE_COMMANDS = Object.freeze(new Set([
  "mathrm",
  "operatorname",
  "mathbf",
  "mathit",
  "mathsf",
  "mathtt",
  "mathbb",
  "mathcal",
  "mathfrak"
]));

export function renderMarkdownToHtml(markdown) {
  const source = normalizeMarkdownText(markdown);

  if (!source) {
    return "";
  }

  const writingProtected = protectStructuredWritingBlocks(source);
  const {
    protectedSource,
    codeBlocks
  } = protectFencedCodeBlocks(writingProtected.protectedSource);
  const state = {
    codeBlocks,
    writingBlocks: writingProtected.writingBlocks
  };

  return stripChatGptMarkdownArtifacts(protectedSource)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => renderMarkdownBlock(block, state))
    .join("");
}

export function normalizeResponseText(value) {
  return stripLeakedRendererPlaceholders(stripChatGptStructuredReferences(String(value || "")));
}

export function normalizeResponseHtml(value) {
  const raw = String(value || "");

  if (!raw) {
    return "";
  }

  if (/^\s*</.test(raw) && !/[#*_`|]{2,}/.test(raw.slice(0, 120))) {
    return raw;
  }

  return renderMarkdownToHtml(raw);
}

export function sanitizeResponseHtml(html, documentRef = globalThis.document) {
  if (!documentRef?.createElement) {
    return sanitizeResponseHtmlString(html);
  }

  const template = documentRef.createElement("template");
  const allowedTags = new Set(RESPONSE_ALLOWED_TAGS);
  const allowedAttributes = new Set(RESPONSE_ALLOWED_ATTRIBUTES);

  template.innerHTML = String(html || "");

  for (const element of Array.from(template.content.querySelectorAll("*"))) {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(documentRef.createTextNode(element.textContent || ""));
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      if (!allowedAttributes.has(attribute.name)) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (attribute.name === "href" && !/^https?:\/\//i.test(attribute.value)) {
        element.removeAttribute(attribute.name);
      }

      if (attribute.name === "target" && attribute.value !== "_blank") {
        element.removeAttribute(attribute.name);
      }

      if (attribute.name === "rel") {
        element.setAttribute("rel", "noopener noreferrer");
      }
    }
  }

  return template.innerHTML;
}

export function renderDisplayMath(expression) {
  const source = normalizeLatexSource(expression);
  const rendered = renderLatexLikeHtml(source);
  const fallbackClass = rendered.ok ? "" : " math-fallback";

  return `<div class="math math-display${fallbackClass}"><span class="math-rendered">${rendered.html}</span><span class="math-source">${escapeHtml(source)}</span></div>`;
}

export function renderInlineMath(expression) {
  const source = normalizeLatexSource(expression);
  const rendered = renderLatexLikeHtml(source);
  const fallbackClass = rendered.ok ? "" : " math-fallback";

  return `<span class="math math-inline${fallbackClass}"><span class="math-rendered">${rendered.html}</span><span class="math-source">${escapeHtml(source)}</span></span>`;
}

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMarkdownBlock(block, state) {
  const codeMatch = block.match(/^@@CODE_BLOCK_(\d+)@@$/);

  if (codeMatch) {
    return state.codeBlocks[Number(codeMatch[1])] || "";
  }

  const writingMatch = block.match(new RegExp(`^${escapeRegExp(WRITING_BLOCK_PLACEHOLDER_PREFIX)}(\\d+)@@$`));

  if (writingMatch) {
    return renderWritingBlock(state.writingBlocks[Number(writingMatch[1])]);
  }

  const displayMath = matchDisplayMathBlock(block);

  if (displayMath !== null) {
    return renderDisplayMath(displayMath);
  }

  const lines = block.split(/\n/);

  if (looksLikeMarkdownTable(lines)) {
    return renderMarkdownTable(lines);
  }

  if (looksLikeTabDelimitedTable(lines)) {
    return renderDelimitedTable(lines, "\t");
  }

  if (lines.every(isBlockquoteLine)) {
    return renderBlockquoteBlock(lines);
  }

  const standaloneTaskList = parseTaskListBlock(lines);

  if (standaloneTaskList) {
    return renderListBlock("ul", standaloneTaskList, {
      taskList: true
    });
  }

  const unorderedList = parseListBlock(lines, /^[-*+]\s+(.*)$/);

  if (unorderedList) {
    return renderListBlock("ul", unorderedList, {
      taskList: unorderedList.every((item) => isTaskListItemText(item[0]))
    });
  }

  const orderedList = parseListBlock(lines, /^\d+[.)]\s+(.*)$/);

  if (orderedList) {
    return renderListBlock("ol", orderedList);
  }

  const firstLineHeading = lines[0]?.match(/^(#{1,6})\s+(.+)$/);

  if (firstLineHeading) {
    const level = Math.min(6, firstLineHeading[1].length);
    const headingHtml = `<h${level}>${renderInlineMarkdown(firstLineHeading[2])}</h${level}>`;
    const rest = lines.slice(1).join("\n").trim();

    return rest ? `${headingHtml}${renderMarkdownBlock(rest, state)}` : headingHtml;
  }

  const heading = block.match(/^(#{1,6})\s+(.+)$/);

  if (heading) {
    const level = Math.min(6, heading[1].length);
    return `<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`;
  }

  if (/^---+$/.test(block)) {
    return "<hr>";
  }

  if (lines.length === 1 && looksLikeStandaloneLabel(block)) {
    return `<p class="response-label"><strong>${renderInlineMarkdown(block)}</strong></p>`;
  }

  return `<p>${renderInlineMarkdown(block).replace(/\n/g, "<br>")}</p>`;
}

function isBlockquoteLine(line) {
  return /^>\s?/.test(String(line || "")) || !String(line || "").trim();
}

function renderBlockquoteBlock(lines) {
  const quote = lines
    .map((line) => String(line || "").replace(/^>\s?/, ""))
    .join("\n")
    .trim();

  return `<blockquote>${quote ? renderMarkdownToHtml(quote) : ""}</blockquote>`;
}

function protectFencedCodeBlocks(source) {
  const lines = String(source || "").split("\n");
  const output = [];
  const codeBlocks = [];
  let index = 0;

  while (index < lines.length) {
    const openingFence = matchOpeningFence(lines[index]);

    if (!openingFence) {
      output.push(lines[index]);
      index += 1;
      continue;
    }

    const codeLines = [];
    index += 1;

    while (index < lines.length && !matchesClosingFence(lines[index], openingFence.fence)) {
      codeLines.push(lines[index]);
      index += 1;
    }

    if (index < lines.length) {
      index += 1;
    }

    const codeBlockIndex = codeBlocks.length;
    const language = extractFenceLanguage(openingFence.info);
    const code = codeLines.join("\n").replace(/\n$/, "");

    codeBlocks.push(`<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ""}>${escapeHtml(code)}</code></pre>`);
    output.push("", `@@CODE_BLOCK_${codeBlockIndex}@@`, "");
  }

  return {
    protectedSource: output.join("\n"),
    codeBlocks
  };
}

function protectStructuredWritingBlocks(source) {
  const lines = String(source || "").split("\n");
  const output = [];
  const writingBlocks = [];
  let index = 0;

  while (index < lines.length) {
    const codeFence = matchOpeningFence(lines[index]);

    if (codeFence) {
      output.push(lines[index]);
      index += 1;

      while (index < lines.length) {
        output.push(lines[index]);

        if (matchesClosingFence(lines[index], codeFence.fence)) {
          index += 1;
          break;
        }

        index += 1;
      }

      continue;
    }

    const writingOpening = matchWritingBlockOpening(lines[index]);

    if (!writingOpening) {
      output.push(lines[index]);
      index += 1;
      continue;
    }

    const startIndex = index;
    const bodyLines = [];
    index += 1;

    while (index < lines.length && !matchesWritingBlockClosing(lines[index])) {
      bodyLines.push(lines[index]);
      index += 1;
    }

    if (index >= lines.length) {
      output.push(...lines.slice(startIndex));
      break;
    }

    index += 1;
    const writingBlockIndex = writingBlocks.length;
    writingBlocks.push({
      attributes: parseWritingBlockAttributes(writingOpening.attributes),
      body: bodyLines.join("\n").trim()
    });
    output.push("", `${WRITING_BLOCK_PLACEHOLDER_PREFIX}${writingBlockIndex}@@`, "");
  }

  return {
    protectedSource: output.join("\n"),
    writingBlocks
  };
}

function matchWritingBlockOpening(line) {
  const match = String(line || "").match(/^[ \t]{0,3}:::\s*writing(?:\{([^}]*)\})?\s*$/i);

  return match ? {
    attributes: match[1] || ""
  } : null;
}

function matchesWritingBlockClosing(line) {
  return /^[ \t]{0,3}:::\s*$/.test(String(line || ""));
}

function parseWritingBlockAttributes(value) {
  const attributes = {};
  const source = String(value || "");
  const pattern = /([A-Za-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s}]+))/g;
  let match = pattern.exec(source);

  while (match) {
    attributes[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
    match = pattern.exec(source);
  }

  return attributes;
}

function renderWritingBlock(block) {
  if (!block) {
    return "";
  }

  const variant = String(block.attributes?.variant || "").trim();
  const subject = String(block.attributes?.subject || "").trim();
  const label = getWritingVariantLabel(variant);
  const variantClass = variant ? ` writing-block-${sanitizeClassName(variant)}` : "";
  const subjectHtml = subject ? `<span>${escapeHtml(subject)}</span>` : "";
  const metaHtml = label || subjectHtml
    ? `<div class="writing-block-meta">${label ? `<strong>${escapeHtml(label)}</strong>` : ""}${subjectHtml}</div>`
    : "";
  const bodyHtml = renderMarkdownToHtml(block.body || "");

  return `<div class="writing-block${variantClass}">${metaHtml}<div class="writing-block-body">${bodyHtml}</div></div>`;
}

function getWritingVariantLabel(value) {
  const variant = String(value || "").toLowerCase();

  if (variant === "email") {
    return "Email";
  }

  if (variant === "chat_message") {
    return "Chat message";
  }

  if (variant === "social_post") {
    return "Social post";
  }

  return variant ? variant.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "";
}

function sanitizeClassName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "generic";
}

function matchOpeningFence(line) {
  const match = String(line || "").match(/^[ \t]{0,3}(```|~~~)(.*)$/);

  if (!match) {
    return null;
  }

  return {
    fence: match[1],
    info: match[2] || ""
  };
}

function matchesClosingFence(line, fence) {
  return new RegExp(`^[ \\t]{0,3}${escapeRegExp(fence)}[ \\t]*$`).test(String(line || ""));
}

function extractFenceLanguage(info) {
  const match = String(info || "").trim().match(/^([A-Za-z0-9_+.-]+)/);

  return match ? match[1].replace(/[^\w.+-]/g, "") : "";
}

function stripChatGptMarkdownArtifacts(value) {
  return String(value || "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();

      if (/^(?:```|~~~)$/.test(trimmed)) {
        return false;
      }

      return !/^text\s+id\s*=\s*(?:"[^"]*"|'[^']*'|[A-Za-z0-9_-]+)\s*$/i.test(trimmed);
    })
    .join("\n");
}

function looksLikeStandaloneLabel(value) {
  const text = String(value || "").trim();

  return text.length >= 3
    && text.length <= 96
    && /:\s*$/.test(text)
    && !/[{}()[\]|`<>]/.test(text)
    && !/^https?:\/\//i.test(text);
}

function parseListBlock(lines, markerPattern) {
  const items = [];
  let current = null;

  for (const line of lines) {
    const trimmed = String(line || "").trimEnd();
    const markerMatch = trimmed.match(markerPattern);

    if (markerMatch) {
      current = [markerMatch[1].trim()];
      items.push(current);
      continue;
    }

    if (!trimmed.trim()) {
      continue;
    }

    if (!current || !/^\s{2,}\S/.test(line)) {
      return null;
    }

    current.push(trimmed.trim());
  }

  return items.length ? items : null;
}

function parseTaskListBlock(lines) {
  const items = [];

  for (const line of lines) {
    const match = String(line || "").trimEnd().match(/^\[(x|X| )\]\s+(.+)$/);

    if (!match) {
      return null;
    }

    items.push([`[${match[1]}] ${match[2].trim()}`]);
  }

  return items.length ? items : null;
}

function renderListBlock(tag, items, options = {}) {
  const listClass = options.taskList ? ' class="task-list"' : "";

  return `<${tag}${listClass}>${items.map((item) => {
    const text = item
      .filter(Boolean)
      .map((line, index) => options.taskList && index === 0 ? renderTaskListItem(line) : renderInlineMarkdown(line))
      .join("<br>");

    return `<li>${text}</li>`;
  }).join("")}</${tag}>`;
}

function renderInlineMarkdown(value) {
  let html = escapeHtml(value);
  const codeSpans = [];

  html = html.replace(/`([^`]+)`/g, (_match, code) => {
    const index = codeSpans.length;
    codeSpans.push(`<code>${code}</code>`);
    return makeInlinePlaceholder("CODESPAN", index);
  });

  html = html.replace(/\\\(([\s\S]*?)\\\)/g, (_match, expression) => renderInlineMath(expression));
  html = html.replace(/\$([^$\n]+)\$/g, (_match, expression) => renderInlineMath(expression));
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  html = html.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  html = restoreInlinePlaceholders(html, "CODESPAN", codeSpans);

  return html;
}

function isTaskListItemText(value) {
  return /^\[(?:x|X| )\]\s+\S/.test(String(value || ""));
}

function renderTaskListItem(value) {
  const match = String(value || "").match(/^\[(x|X| )\]\s+([\s\S]+)$/);

  if (!match) {
    return renderInlineMarkdown(value);
  }

  const checked = match[1].toLowerCase() === "x";
  const marker = checked ? "✓" : "";
  const stateClass = checked ? " task-marker-checked" : "";

  return `<span class="task-marker${stateClass}">${marker}</span><span class="task-text">${renderInlineMarkdown(match[2])}</span>`;
}

function matchDisplayMathBlock(block) {
  const trimmed = String(block || "").trim();
  const dollarMatch = trimmed.match(/^\$\$([\s\S]*)\$\$$/);

  if (dollarMatch) {
    return dollarMatch[1].trim();
  }

  const bracketMatch = trimmed.match(/^\\\[([\s\S]*)\\\]$/);

  return bracketMatch ? bracketMatch[1].trim() : null;
}

function looksLikeMarkdownTable(lines) {
  return lines.length >= 2
    && lines[0].includes("|")
    && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[1]);
}

function renderMarkdownTable(lines) {
  const parseRow = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  const header = parseRow(lines[0]);
  const rows = lines.slice(2).map(parseRow).filter((row) => row.length);

  return `<table><thead><tr>${header.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function looksLikeTabDelimitedTable(lines) {
  if (lines.length < 2 || !lines.every((line) => line.includes("\t"))) {
    return false;
  }

  const widths = lines.map((line) => line.split("\t").length);
  const firstWidth = widths[0];

  return firstWidth >= 2 && widths.every((width) => width === firstWidth);
}

function renderDelimitedTable(lines, delimiter) {
  const rows = lines
    .map((line) => String(line || "").split(delimiter).map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
  const header = rows[0] || [];
  const bodyRows = rows.slice(1);

  return `<table><thead><tr>${header.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function normalizeMarkdownText(value) {
  return normalizeResponseText(value)
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function stripLeakedRendererPlaceholders(value) {
  return String(value || "")
    .replace(/@@\s*CODE\s*_?\s*SPAN\s*_?\s*\d+\s*@@/gi, "")
    .replace(/@@\s*CODE\s*_?\s*BLOCK\s*_?\s*\d+\s*@@/gi, "");
}

function stripChatGptStructuredReferences(value) {
  return String(value || "")
    .replace(/([a-zA-Z_][\w-]*)([\s\S]*?)/g, (_match, kind, payload) => renderStructuredReferenceFallback(kind, payload))
    .replace(/\n{3,}/g, "\n\n");
}

function renderStructuredReferenceFallback(kind, payload) {
  const type = String(kind || "").toLowerCase();
  const rawPayload = String(payload || "").trim();

  if (type === "entity") {
    const parsed = tryParseJson(rawPayload);

    if (Array.isArray(parsed)) {
      const display = parsed.find((item, index) => index > 0 && typeof item === "string" && item && !/^turn\d+/i.test(item));
      return display || parsed.find((item) => typeof item === "string" && item && !/^turn\d+/i.test(item)) || "";
    }

    return "";
  }

  if (type === "genui") {
    const parsed = tryParseJson(rawPayload);
    const mathContent = parsed?.math_block_widget_always_prefetch_v2?.content;

    return typeof mathContent === "string" && mathContent.trim()
      ? `\n\n$$${mathContent.trim()}$$\n\n`
      : "";
  }

  if (type === "citation" || type === "cite" || type === "i" || type === "products" || type === "product" || type === "explore_more") {
    return "";
  }

  return "";
}

function renderLatexLikeHtml(source) {
  const normalized = normalizeLatexSource(source);
  const result = renderLatexFragment(normalized, 0, null);

  if (!normalized || !result.ok || result.index !== normalized.length) {
    return {
      ok: false,
      html: escapeHtml(normalized)
    };
  }

  return {
    ok: true,
    html: result.html
  };
}

function renderLatexFragment(text, index, terminator) {
  let html = "";
  let cursor = index;
  let ok = true;

  while (cursor < text.length) {
    const char = text[cursor];

    if (terminator && char === terminator) {
      return {
        ok,
        html,
        index: cursor + 1
      };
    }

    if (!terminator && char === "}") {
      return {
        ok: false,
        html,
        index: cursor
      };
    }

    if (char === "{") {
      const group = renderLatexFragment(text, cursor + 1, "}");
      ok = ok && group.ok;
      html += group.html;
      cursor = group.index;
      continue;
    }

    if (char === "^" || char === "_") {
      const atom = readLatexAtom(text, cursor + 1);
      const tag = char === "^" ? "sup" : "sub";

      if (!atom) {
        return {
          ok: false,
          html,
          index: cursor
        };
      }

      html += `<${tag}>${atom.html}</${tag}>`;
      ok = ok && atom.ok;
      cursor = atom.index;
      continue;
    }

    if (char === "'" || char === "′") {
      const prime = readLatexPrimeRun(text, cursor);

      html += `<sup class="math-prime">${escapeHtml(prime.value)}</sup>`;
      cursor = prime.index;
      continue;
    }

    if (char === "\\") {
      const command = readLatexCommand(text, cursor + 1);

      if (!command.name) {
        html += escapeHtml(text[cursor + 1] || "");
        cursor += 2;
        continue;
      }

      const renderedCommand = renderLatexCommandInvocation(text, command);

      if (!renderedCommand) {
        return {
          ok: false,
          html,
          index: cursor
        };
      }

      html += renderedCommand.html;
      ok = ok && renderedCommand.ok;
      cursor = renderedCommand.index;
      continue;
    }

    html += escapeHtml(char);
    cursor += 1;
  }

  if (terminator) {
    return {
      ok: false,
      html,
      index: cursor
    };
  }

  return {
    ok,
    html,
    index: cursor
  };
}

function renderLatexCommandInvocation(text, command) {
  if (command.name === "frac") {
    const numerator = readRequiredLatexArgument(text, command.index);
    const denominator = numerator ? readRequiredLatexArgument(text, numerator.index) : null;

    if (!numerator || !denominator) {
      return null;
    }

    return {
      ok: numerator.ok && denominator.ok,
      html: `<span class="math-frac"><span class="math-num">${numerator.html}</span><span class="math-den">${denominator.html}</span></span>`,
      index: denominator.index
    };
  }

  if (command.name === "sqrt") {
    const rootIndex = readOptionalLatexArgument(text, command.index);
    const radicand = readRequiredLatexArgument(text, rootIndex ? rootIndex.index : command.index);

    if (!radicand) {
      return null;
    }

    return {
      ok: radicand.ok && (!rootIndex || rootIndex.ok),
      html: `<span class="math-root">${rootIndex ? `<sup class="math-root-index">${rootIndex.html}</sup>` : ""}√<span class="math-root-body">${radicand.html}</span></span>`,
      index: radicand.index
    };
  }

  if (command.name === "boxed") {
    const argument = readRequiredLatexArgument(text, command.index);

    if (!argument) {
      return null;
    }

    return {
      ok: argument.ok,
      html: `<span class="math-boxed">${argument.html}</span>`,
      index: argument.index
    };
  }

  if (command.name === "bar" || command.name === "overline") {
    const argument = readLatexArgumentOrAtom(text, command.index);

    if (!argument) {
      return null;
    }

    return {
      ok: argument.ok,
      html: `<span class="math-overline">${argument.html}</span>`,
      index: argument.index
    };
  }

  if (Object.prototype.hasOwnProperty.call(LATEX_ACCENT_COMMANDS, command.name)) {
    const argument = readLatexArgumentOrAtom(text, command.index);

    if (!argument) {
      return null;
    }

    return {
      ok: argument.ok,
      html: renderLatexAccent(command.name, argument.html),
      index: argument.index
    };
  }

  if (command.name === "begin") {
    const environment = readLatexEnvironment(text, command.index);

    if (!environment) {
      return null;
    }

    const renderedEnvironment = renderLatexEnvironment(environment.name, environment.body);

    return {
      ok: renderedEnvironment.ok,
      html: renderedEnvironment.html,
      index: environment.index
    };
  }

  if (command.name === "left" || command.name === "right") {
    return readLatexDelimiter(text, command.index);
  }

  if (command.name === "text") {
    const argument = readRequiredLatexArgument(text, command.index, { plainText: true });

    if (!argument) {
      return null;
    }

    return {
      ok: argument.ok,
      html: argument.html,
      index: argument.index
    };
  }

  if (LATEX_TEXT_STYLE_COMMANDS.has(command.name)) {
    const argument = readRequiredLatexArgument(text, command.index);

    if (!argument) {
      return null;
    }

    return {
      ok: argument.ok,
      html: `<span class="math-text math-text-${sanitizeClassName(command.name)}">${argument.html}</span>`,
      index: argument.index
    };
  }

  return {
    ok: true,
    html: escapeHtml(mapLatexCommand(command.name)),
    index: command.index
  };
}

function readLatexDelimiter(text, index) {
  const cursor = skipLatexWhitespace(text, index);

  if (cursor >= text.length) {
    return {
      ok: true,
      html: "",
      index: cursor
    };
  }

  if (text[cursor] === ".") {
    return {
      ok: true,
      html: "",
      index: cursor + 1
    };
  }

  if (text[cursor] === "\\") {
    const command = readLatexCommand(text, cursor + 1);

    return {
      ok: true,
      html: escapeHtml(mapLatexCommand(command.name)),
      index: command.index
    };
  }

  return {
    ok: true,
    html: escapeHtml(text[cursor]),
    index: cursor + 1
  };
}

function renderLatexAccent(commandName, html) {
  const accent = LATEX_ACCENT_COMMANDS[commandName] || "hat";

  return `<span class="math-accent math-accent-${accent}"><span class="math-accent-body">${html}</span></span>`;
}

function readLatexArgumentOrAtom(text, index) {
  const cursor = skipLatexWhitespace(text, index);

  if (text[cursor] === "{") {
    return readRequiredLatexArgument(text, cursor);
  }

  return readLatexAtom(text, cursor);
}

function readLatexPrimeRun(text, index) {
  let cursor = index;
  let value = "";

  while (text[cursor] === "'" || text[cursor] === "′") {
    value += "′";
    cursor += 1;
  }

  return {
    value,
    index: cursor
  };
}

function readRequiredLatexArgument(text, index, options = {}) {
  const cursor = skipLatexWhitespace(text, index);

  if (text[cursor] !== "{") {
    return null;
  }

  if (options.plainText) {
    const raw = readRawLatexGroup(text, cursor);

    return raw ? {
      ok: true,
      html: escapeHtml(raw.value),
      index: raw.index
    } : null;
  }

  return renderLatexFragment(text, cursor + 1, "}");
}

function readOptionalLatexArgument(text, index) {
  const cursor = skipLatexWhitespace(text, index);

  if (text[cursor] !== "[") {
    return null;
  }

  const argument = renderLatexFragment(text, cursor + 1, "]");

  return argument.ok ? argument : null;
}

function readLatexEnvironment(text, index) {
  const nameGroupStart = skipLatexWhitespace(text, index);
  const nameGroup = readRawLatexGroup(text, nameGroupStart);

  if (!nameGroup) {
    return null;
  }

  const name = nameGroup.value.trim();
  const endToken = `\\end{${name}}`;
  const bodyStartIndex = skipLatexEnvironmentArguments(text, nameGroup.index, name);
  const endIndex = text.indexOf(endToken, bodyStartIndex);

  if (!name || endIndex === -1) {
    return null;
  }

  return {
    name,
    body: text.slice(bodyStartIndex, endIndex).trim(),
    index: endIndex + endToken.length
  };
}

function renderLatexEnvironment(name, body) {
  const normalizedName = String(name || "").trim();

  if (Object.prototype.hasOwnProperty.call(MATRIX_ENVIRONMENT_DELIMITERS, normalizedName)) {
    const rows = parseLatexEnvironmentRows(body);
    const renderedRows = rows.map((row) => row.map(renderLatexCell));
    const ok = renderedRows.length > 0 && renderedRows.every((row) => row.length > 0 && row.every((cell) => cell.ok));
    const [left, right] = MATRIX_ENVIRONMENT_DELIMITERS[normalizedName];
    const bodyHtml = renderMathRows(renderedRows, "math-matrix");
    const environmentClassName = normalizedName === "Vmatrix" ? "double-vmatrix" : normalizedName;

    return {
      ok,
      html: `<span class="math-environment math-${sanitizeClassName(environmentClassName)}">${left ? renderMathBracket(left, "left") : ""}${bodyHtml}${right ? renderMathBracket(right, "right") : ""}</span>`
    };
  }

  if (normalizedName === "cases") {
    const rows = parseLatexEnvironmentRows(body);
    const renderedRows = rows.map((row) => row.map(renderLatexCell));
    const ok = renderedRows.length > 0 && renderedRows.every((row) => row.length > 0 && row.every((cell) => cell.ok));

    return {
      ok,
      html: `<span class="math-environment math-cases">${renderMathBracket("{", "left")}${renderMathRows(renderedRows, "math-cases-body")}</span>`
    };
  }

  if (["aligned", "alignedat", "gathered"].includes(normalizedName)) {
    const rows = parseLatexEnvironmentRows(body);
    const renderedRows = rows.map((row) => row.map(renderLatexCell));
    const ok = renderedRows.length > 0 && renderedRows.every((row) => row.length > 0 && row.every((cell) => cell.ok));

    return {
      ok,
      html: `<span class="math-environment math-${sanitizeClassName(normalizedName)}">${renderMathRows(renderedRows, `math-${sanitizeClassName(normalizedName)}-body`)}</span>`
    };
  }

  return {
    ok: false,
    html: escapeHtml(`\\begin{${normalizedName}}${body}\\end{${normalizedName}}`)
  };
}

function skipLatexEnvironmentArguments(text, index, name) {
  let cursor = skipLatexWhitespace(text, index);

  while (text[cursor] === "[") {
    const closingIndex = text.indexOf("]", cursor + 1);

    if (closingIndex === -1) {
      return cursor;
    }

    cursor = skipLatexWhitespace(text, closingIndex + 1);
  }

  if ((name === "array" || name === "alignedat") && text[cursor] === "{") {
    const columnSpec = readRawLatexGroup(text, cursor);

    if (columnSpec) {
      cursor = skipLatexWhitespace(text, columnSpec.index);
    }
  }

  return cursor;
}

function renderMathBracket(symbol, side) {
  return `<span class="math-bracket math-bracket-${side} math-bracket-${getMathBracketClassName(symbol)}">${escapeHtml(symbol)}</span>`;
}

function getMathBracketClassName(symbol) {
  if (symbol === "[") {
    return "square";
  }

  if (symbol === "(") {
    return "round";
  }

  if (symbol === "{") {
    return "brace";
  }

  if (symbol === "‖") {
    return "double-vertical";
  }

  if (symbol === "|") {
    return "vertical";
  }

  return "plain";
}

function parseLatexEnvironmentRows(body) {
  return String(body || "")
    .split(/\\\\(?:\[[^\]]*\])?/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => row.split(/\s*&\s*/).map((cell) => cell.trim()));
}

function renderLatexCell(value) {
  const source = String(value || "").trim();
  const rendered = renderLatexFragment(source, 0, null);
  const ok = Boolean(source) && rendered.ok && rendered.index === source.length;

  return {
    ok,
    html: ok ? rendered.html : escapeHtml(source)
  };
}

function renderMathRows(rows, className) {
  return `<span class="${className}">${rows.map((row) => `<span class="math-row">${row.map((cell) => `<span class="math-cell">${cell.html}</span>`).join("")}</span>`).join("")}</span>`;
}

function readLatexAtom(text, index) {
  const cursor = skipLatexWhitespace(text, index);

  if (cursor >= text.length) {
    return null;
  }

  if (text[cursor] === "{") {
    return renderLatexFragment(text, cursor + 1, "}");
  }

  if (text[cursor] === "\\") {
    const command = readLatexCommand(text, cursor + 1);

    if (!command.name) {
      return {
        ok: true,
        html: escapeHtml(text[cursor + 1] || ""),
        index: cursor + 2
      };
    }

    return renderLatexCommandInvocation(text, command);
  }

  if (text[cursor] === "'" || text[cursor] === "′") {
    const prime = readLatexPrimeRun(text, cursor);

    return {
      ok: true,
      html: `<sup class="math-prime">${escapeHtml(prime.value)}</sup>`,
      index: prime.index
    };
  }

  return {
    ok: true,
    html: escapeHtml(text[cursor]),
    index: cursor + 1
  };
}

function readRawLatexGroup(text, startIndex) {
  let depth = 0;

  for (let index = startIndex; index < text.length; index += 1) {
    if (text[index] === "{" && text[index - 1] !== "\\") {
      depth += 1;
    } else if (text[index] === "}" && text[index - 1] !== "\\") {
      depth -= 1;

      if (depth === 0) {
        return {
          value: text.slice(startIndex + 1, index),
          index: index + 1
        };
      }
    }
  }

  return null;
}

function readLatexCommand(text, index) {
  const match = String(text).slice(index).match(/^[A-Za-z]+|^./);
  const name = match ? match[0] : "";

  return {
    name,
    index: index + name.length
  };
}

function skipLatexWhitespace(text, index) {
  let cursor = index;

  while (/\s/.test(text[cursor] || "")) {
    cursor += 1;
  }

  return cursor;
}

function normalizeLatexSource(value) {
  return decodeEscapedMathEntities(value)
    .replace(/^\\\(|\\\)$/g, "")
    .replace(/^\\\[|\\\]$/g, "")
    .replace(/^\$\$|\$\$$/g, "")
    .replace(/([A-Za-z0-9)\]])\u02c6/g, "\\hat{$1}")
    .replace(/([A-Za-z0-9)\]])\u0302/g, "\\hat{$1}")
    .trim();
}

function decodeEscapedMathEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0*39;/g, "'");
}

function mapLatexCommand(command) {
  return Object.prototype.hasOwnProperty.call(LATEX_COMMANDS, command)
    ? LATEX_COMMANDS[command]
    : command;
}

function makeInlinePlaceholder(kind, index) {
  return `${INLINE_PLACEHOLDER_PREFIX}${kind}${index}${INLINE_PLACEHOLDER_SUFFIX}`;
}

function restoreInlinePlaceholders(html, kind, replacements) {
  const pattern = new RegExp(`${INLINE_PLACEHOLDER_PREFIX}${kind}(\\d+)${INLINE_PLACEHOLDER_SUFFIX}`, "g");
  return String(html || "").replace(pattern, (_match, index) => replacements[Number(index)] || "");
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeResponseHtmlString(html) {
  return String(html || "")
    .replace(/<\s*(script|style|iframe|object|embed|form|button|input|textarea|select)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+href\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, "")
    .replace(/\s+src\s*=\s*(["'])[\s\S]*?\1/gi, "");
}
