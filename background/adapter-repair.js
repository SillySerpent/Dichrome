const DEFAULT_OLLAMA_URL = "http://localhost:11434/api/generate";
const DEFAULT_OLLAMA_MODEL = "llama3.2:3b";
const MAX_SNAPSHOT_BYTES = 18000;
const MAX_MODEL_OUTPUT_BYTES = 12000;
const ALLOWED_TARGETS = new Set([
  "composer",
  "sendButton",
  "assistantMessage",
  "stopButton",
  "fileInput",
  "projectNavigationItem",
  "projectCreateButton",
  "projectNameInput",
  "modelPicker",
  "modelOption"
]);
const ALLOWED_STRATEGIES = new Set([
  "aria",
  "role",
  "placeholder",
  "dataAttribute",
  "text",
  "selector",
  "relativeLayout"
]);

export const DEFAULT_REPAIR_SETTINGS = Object.freeze({
  enabled: false,
  ollamaUrl: DEFAULT_OLLAMA_URL,
  model: DEFAULT_OLLAMA_MODEL
});

export async function requestAdapterRepair({ snapshot, failure, settings }) {
  const effectiveSettings = {
    ...DEFAULT_REPAIR_SETTINGS,
    ...settings
  };

  const safeSnapshot = sanitizeSnapshot(snapshot);
  const prompt = buildRepairPrompt(safeSnapshot, failure);

  const response = await fetch(effectiveSettings.ollamaUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: effectiveSettings.model,
      prompt,
      stream: false,
      options: {
        temperature: 0.1
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Local repair model returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  const modelText = String(payload.response || "").slice(0, MAX_MODEL_OUTPUT_BYTES);
  const parsed = parseJsonObject(modelText);
  const validation = validateRepairSuggestions(parsed);

  if (!validation.valid) {
    throw new Error(`Local repair model returned invalid mappings: ${validation.errors.join("; ")}`);
  }

  return {
    hints: validation.hints,
    warnings: validation.warnings,
    rawModelText: modelText
  };
}

export function validateRepairSuggestions(value) {
  const errors = [];
  const warnings = [];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      valid: false,
      hints: [],
      warnings,
      errors: ["Top-level repair response must be an object."]
    };
  }

  const rawHints = Array.isArray(value.hints)
    ? value.hints
    : Array.isArray(value.candidates)
      ? value.candidates
      : [];

  if (!rawHints.length) {
    errors.push("Response must include a non-empty hints array.");
  }

  const hints = [];

  for (const rawHint of rawHints.slice(0, 20)) {
    const hint = sanitizeHint(rawHint, warnings);

    if (hint) {
      hints.push(hint);
    }
  }

  if (!hints.length) {
    errors.push("No usable hints remained after validation.");
  }

  return {
    valid: errors.length === 0,
    hints,
    warnings,
    errors
  };
}

export function sanitizeRepairSettings(value) {
  const settings = {
    ...DEFAULT_REPAIR_SETTINGS,
    ...(value && typeof value === "object" ? value : {})
  };

  return {
    enabled: Boolean(settings.enabled),
    ollamaUrl: sanitizeUrl(settings.ollamaUrl) || DEFAULT_OLLAMA_URL,
    model: sanitizeString(settings.model, 120) || DEFAULT_OLLAMA_MODEL
  };
}

function buildRepairPrompt(snapshot, failure) {
  return [
    "You are assisting a local browser extension prototype with ChatGPT DOM adapter repair.",
    "Return only strict JSON. Do not return markdown. Do not suggest code changes.",
    "Only suggest selector or semantic mapping hints for elements visible in the snapshot.",
    "",
    "Expected JSON schema:",
    JSON.stringify({
      hints: [
        {
          target: "composer | sendButton | assistantMessage | stopButton | fileInput | projectNavigationItem | projectCreateButton | projectNameInput | modelPicker | modelOption",
          strategy: "aria | role | placeholder | dataAttribute | text | selector | relativeLayout",
          selector: "optional CSS selector",
          role: "optional ARIA role",
          ariaLabelIncludes: "optional accessible label fragment",
          placeholderIncludes: "optional placeholder fragment",
          textIncludes: "optional visible text fragment",
          confidence: 0.0,
          rationale: "short reason"
        }
      ]
    }),
    "",
    "Failure:",
    JSON.stringify(String(failure || "DOM adapter failed")),
    "",
    "DOM snapshot:",
    JSON.stringify(snapshot)
  ].join("\n");
}

function sanitizeSnapshot(snapshot) {
  const json = JSON.stringify(snapshot || {});

  if (json.length <= MAX_SNAPSHOT_BYTES) {
    return snapshot || {};
  }

  return {
    truncated: true,
    originalBytes: json.length,
    excerpt: json.slice(0, MAX_SNAPSHOT_BYTES)
  };
}

function parseJsonObject(text) {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("No JSON object found in model response.");
    }

    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }
}

function sanitizeHint(rawHint, warnings) {
  if (!rawHint || typeof rawHint !== "object" || Array.isArray(rawHint)) {
    warnings.push("Ignored non-object hint.");
    return null;
  }

  const target = sanitizeString(rawHint.target, 40);
  const strategy = sanitizeString(rawHint.strategy, 40);

  if (!ALLOWED_TARGETS.has(target)) {
    warnings.push(`Ignored hint with unsupported target: ${target || "(empty)"}`);
    return null;
  }

  if (!ALLOWED_STRATEGIES.has(strategy)) {
    warnings.push(`Ignored hint with unsupported strategy: ${strategy || "(empty)"}`);
    return null;
  }

  const selector = sanitizeSelector(rawHint.selector);
  const role = sanitizeString(rawHint.role, 80);
  const ariaLabelIncludes = sanitizeString(rawHint.ariaLabelIncludes, 120);
  const placeholderIncludes = sanitizeString(rawHint.placeholderIncludes, 120);
  const textIncludes = sanitizeString(rawHint.textIncludes, 120);
  const rationale = sanitizeString(rawHint.rationale, 200);
  const confidence = Number(rawHint.confidence);

  return {
    target,
    strategy,
    selector: selector || null,
    role: role || null,
    ariaLabelIncludes: ariaLabelIncludes || null,
    placeholderIncludes: placeholderIncludes || null,
    textIncludes: textIncludes || null,
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0,
    rationale: rationale || ""
  };
}

function sanitizeString(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeSelector(value) {
  const selector = sanitizeString(value, 220);

  if (!selector) {
    return "";
  }

  if (/[<>`{}]/.test(selector) || /javascript:/i.test(selector)) {
    return "";
  }

  return selector;
}

function sanitizeUrl(value) {
  const url = sanitizeString(value, 220);

  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }

    if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      return "";
    }

    return parsed.toString();
  } catch (_error) {
    return "";
  }
}
