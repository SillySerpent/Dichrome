import {
  RESPONSE_ALLOWED_ATTRIBUTES,
  RESPONSE_ALLOWED_TAGS
} from "./contracts.js";

const INLINE_PLACEHOLDER_PREFIX = "\uE000";
const INLINE_PLACEHOLDER_SUFFIX = "\uE001";

const LATEX_COMMANDS = Object.freeze({
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  phi: "φ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Omega: "Ω",
  times: "×",
  cdot: "·",
  div: "÷",
  pm: "±",
  mp: "∓",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  neq: "≠",
  approx: "≈",
  infty: "∞",
  rightarrow: "→",
  to: "→",
  leftarrow: "←",
  sum: "∑",
  prod: "∏",
  int: "∫",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  log: "log",
  ln: "ln",
  exp: "exp",
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

export function renderMarkdownToHtml(markdown) {
  const source = normalizeMarkdownText(markdown);

  if (!source) {
    return "";
  }

  const codeBlocks = [];
  const protectedSource = source.replace(/```([\w.+-]*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const index = codeBlocks.length;
    const language = String(lang || "").trim().replace(/[^\w.+-]/g, "");
    codeBlocks.push(`<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ""}>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return `\n\n@@CODE_BLOCK_${index}@@\n\n`;
  });

  return protectedSource
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => renderMarkdownBlock(block, codeBlocks))
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

function renderMarkdownBlock(block, codeBlocks) {
  const codeMatch = block.match(/^@@CODE_BLOCK_(\d+)@@$/);

  if (codeMatch) {
    return codeBlocks[Number(codeMatch[1])] || "";
  }

  const displayMath = matchDisplayMathBlock(block);

  if (displayMath !== null) {
    return renderDisplayMath(displayMath);
  }

  const lines = block.split(/\n/);

  if (looksLikeMarkdownTable(lines)) {
    return renderMarkdownTable(lines);
  }

  if (lines.every((line) => /^>\s?/.test(line))) {
    const quote = lines.map((line) => line.replace(/^>\s?/, "")).join("\n");
    return `<blockquote>${renderInlineMarkdown(quote).replace(/\n/g, "<br>")}</blockquote>`;
  }

  if (lines.every((line) => /^[-*+]\s+/.test(line))) {
    return `<ul>${lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^[-*+]\s+/, ""))}</li>`).join("")}</ul>`;
  }

  if (lines.every((line) => /^\d+[.)]\s+/.test(line))) {
    return `<ol>${lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
  }

  const firstLineHeading = lines[0]?.match(/^(#{1,6})\s+(.+)$/);

  if (firstLineHeading) {
    const level = Math.min(6, firstLineHeading[1].length);
    const headingHtml = `<h${level}>${renderInlineMarkdown(firstLineHeading[2])}</h${level}>`;
    const rest = lines.slice(1).join("\n").trim();

    return rest ? `${headingHtml}${renderMarkdownBlock(rest, codeBlocks)}` : headingHtml;
  }

  const heading = block.match(/^(#{1,6})\s+(.+)$/);

  if (heading) {
    const level = Math.min(6, heading[1].length);
    return `<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`;
  }

  if (/^---+$/.test(block)) {
    return "<hr>";
  }

  return `<p>${renderInlineMarkdown(block).replace(/\n/g, "<br>")}</p>`;
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
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  html = html.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  html = restoreInlinePlaceholders(html, "CODESPAN", codeSpans);

  return html;
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

    if (char === "\\") {
      const command = readLatexCommand(text, cursor + 1);

      if (!command.name) {
        html += escapeHtml(text[cursor + 1] || "");
        cursor += 2;
        continue;
      }

      if (command.name === "frac") {
        const numerator = readRequiredLatexArgument(text, command.index);
        const denominator = numerator ? readRequiredLatexArgument(text, numerator.index) : null;

        if (!numerator || !denominator) {
          return {
            ok: false,
            html,
            index: cursor
          };
        }

        html += `<span class="math-frac"><span class="math-num">${numerator.html}</span><span class="math-den">${denominator.html}</span></span>`;
        ok = ok && numerator.ok && denominator.ok;
        cursor = denominator.index;
        continue;
      }

      if (command.name === "sqrt") {
        const radicand = readRequiredLatexArgument(text, command.index);

        if (!radicand) {
          return {
            ok: false,
            html,
            index: cursor
          };
        }

        html += `<span class="math-root">√<span class="math-root-body">${radicand.html}</span></span>`;
        ok = ok && radicand.ok;
        cursor = radicand.index;
        continue;
      }

      if (command.name === "text" || command.name === "mathrm") {
        const argument = readRequiredLatexArgument(text, command.index, { plainText: true });

        if (!argument) {
          return {
            ok: false,
            html,
            index: cursor
          };
        }

        html += argument.html;
        ok = ok && argument.ok;
        cursor = argument.index;
        continue;
      }

      html += escapeHtml(mapLatexCommand(command.name));
      cursor = command.index;
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
  return String(value || "")
    .replace(/^\\\(|\\\)$/g, "")
    .replace(/^\\\[|\\\]$/g, "")
    .replace(/^\$\$|\$\$$/g, "")
    .trim();
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

function sanitizeResponseHtmlString(html) {
  return String(html || "")
    .replace(/<\s*(script|style|iframe|object|embed|form|button|input|textarea|select)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+href\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, "")
    .replace(/\s+src\s*=\s*(["'])[\s\S]*?\1/gi, "");
}
