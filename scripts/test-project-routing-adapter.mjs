import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const context = vm.createContext({
  ChatGptRelay: {},
  document: {
    body: {
      innerText: "",
      textContent: ""
    }
  },
  location: new URL("https://chatgpt.com/")
});
const source = await readFile(new URL("../content/chatgpt/runtime/adapter/project-routing.js", import.meta.url), "utf8");

assert(
  source.includes('a[href], [role="link"], [role="button"], [role="treeitem"], [aria-current], button'),
  "Project lookup must include ChatGPT project rows exposed as role=button elements."
);

vm.runInContext(source, context);

const methods = context.ChatGptRelay.runtime.adapterProjectRouting.createMethods({
  REQUEST_STATES: {
    PROJECT_READY: "PROJECT_READY"
  },
  DomAdapterError: class DomAdapterError extends Error {},
  clickElement() {},
  emitState() {},
  extractProjectPathSegment(pathname) {
    return String(pathname || "").match(/^\/g\/(g-p-[^/]+)/)?.[1] || "";
  },
  findAncestorContainingProjectSubmit() {
    return null;
  },
  findVisible(elements) {
    return elements[0] || null;
  },
  getElementLabel() {
    return "";
  },
  isDisabled() {
    return false;
  },
  isOffscreenAutomationFrame() {
    return true;
  },
  isVisible() {
    return true;
  },
  isProjectNameInputCandidate() {
    return false;
  },
  isProjectNavigationTarget() {
    return false;
  },
  isProjectOverflowControl() {
    return false;
  },
  isSelectedNavigationElement() {
    return false;
  },
  normalizeComparableText(value) {
    return String(value || "").trim().toLowerCase();
  },
  normalizeProjectOptions(value) {
    return {
      enabled: Boolean(value?.enabled),
      name: String(value?.name || ""),
      createIfMissing: value?.createIfMissing !== false,
      segment: String(value?.segment || ""),
      url: String(value?.url || "")
    };
  },
  queryAllSafe() {
    return [];
  },
  queryAllWithin() {
    return [];
  },
  scoreCreateProjectLabel() {
    return 0;
  },
  scoreDialogActionCandidate() {
    return 0;
  },
  scoreProjectCandidate() {
    return 0;
  },
  scoreProjectNameInputCandidate() {
    return 0;
  },
  setEditableText: async () => null,
  sleep: async () => null,
  textMatchesName() {
    return false;
  },
  uniqueElements(elements) {
    return elements;
  },
  urlLooksProjectScopedForName() {
    return false;
  },
  waitFor: async (producer) => producer(),
  waitForOptional: async () => null
});

const adapter = {
  ...methods,
  collectSnapshot() {
    return {
      candidates: []
    };
  },
  findComposer() {
    return null;
  }
};

await assert.rejects(
  () => adapter.ensureProjectContextBySegment({
    enabled: true,
    name: "Dichrome",
    segment: "g-p-dichrome",
    url: "https://chatgpt.com/g/g-p-dichrome/project"
  }, "request-id", {}),
  /Hidden project routing was not prepared/
);

console.log("Project routing adapter tests passed.");
