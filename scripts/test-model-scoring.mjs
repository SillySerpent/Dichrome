import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const context = vm.createContext({
  ChatGptRelay: {
    runtime: {
      domUtils: {
        getElementLabel(element) {
          return [
            element.label,
            element.attributes?.["aria-label"],
            element.attributes?.title,
            element.text
          ].filter(Boolean).join(" ");
        },
        isDisabled(element) {
          return Boolean(element.disabled);
        },
        isTextInput(element) {
          return element.tagName === "INPUT" || element.tagName === "TEXTAREA";
        },
        isVisible(element) {
          return element.visible !== false;
        },
        normalizeText(value) {
          return String(value || "").replace(/\s+/g, " ").trim();
        },
        queryAllWithin() {
          return [];
        }
      }
    }
  }
});
const source = await readFile(new URL("../content/chatgpt/runtime/adapter/scoring.js", import.meta.url), "utf8");

vm.runInContext(source, context);

const scoring = context.ChatGptRelay.runtime.adapterScoring;

assert(scoring.scoreModelPickerCandidate(createElement({
  label: "Extended",
  attributes: {
    "aria-haspopup": "menu"
  },
  form: true,
  top: 720
})) > 0);
assert.equal(scoring.scoreModelPickerCandidate(createElement({
  label: "Recents",
  attributes: {
    "aria-haspopup": "menu"
  },
  top: 132
})), 0);
assert.equal(scoring.scoreModelPickerCandidate(createElement({
  label: "",
  attributes: {
    "aria-label": "Open project options for gpt reply extension",
    "aria-haspopup": "menu"
  },
  top: 353
})), 0);
assert(scoring.scoreModelPickerCandidate(createElement({
  label: "Start voice mode",
  attributes: {
    "aria-haspopup": "menu"
  },
  form: true,
  top: 720
})) === 0);
assert(scoring.scoreModelOptionCandidate(createElement({
  label: "Extended selected"
}), "Extended") > 0);
assert(scoring.scoreModelOptionCandidate(createElement({
  label: "Thinking recommended"
}), "Thinking") > 0);

assert.equal(scoring.scoreModelOptionCandidate(createElement({
  tagName: "BUTTON",
  label: "Open conversation options for Thinking Model Inquiry",
  attributes: {
    "data-testid": "history-item-9-options"
  }
}), "Thinking"), 0);

assert.equal(scoring.scoreModelOptionCandidate(createElement({
  tagName: "BUTTON",
  label: "Open project options for Thinking Project"
}), "Thinking"), 0);

assert(scoring.scoreModelOptionCandidate(createElement({
  tagName: "DIV",
  label: "GPT-5.5 Instant Fast answers"
}), "Instant") > 0);

assert.equal(scoring.scoreModelOptionCandidate(createElement({
  tagName: "DIV",
  label: "Auto GPT-5.5 Instant GPT-5.5 Thinking Extended Pro",
  attributes: {
    role: "dialog"
  }
}), "Instant"), 0);

assert(scoring.scoreModelOptionCandidate(createElement({
  tagName: "BUTTON",
  label: "GPT-5.5 Instant Fast answers"
}), "Instant") > scoring.scoreModelOptionCandidate(createElement({
  tagName: "SPAN",
  label: "GPT-5.5 Instant Fast answers"
}), "Instant"));

console.log("Model scoring tests passed.");

function createElement({
  tagName = "BUTTON",
  label = "",
  text = "",
  attributes = {},
  disabled = false,
  visible = true,
  form = false,
  top = 20
} = {}) {
  return {
    tagName,
    label,
    text,
    attributes,
    disabled,
    visible,
    getAttribute(name) {
      return this.attributes[name] || "";
    },
    hasAttribute(name) {
      return Object.hasOwn(this.attributes, name);
    },
    closest(selector) {
      if (selector === "form" && form) {
        return {};
      }

      if (selector === "header" && this.header) {
        return {};
      }

      return null;
    },
    querySelector() {
      return null;
    },
    getBoundingClientRect() {
      return {
        top,
        left: 0,
        width: 120,
        height: 36
      };
    }
  };
}
