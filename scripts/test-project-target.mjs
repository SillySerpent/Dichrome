import assert from "node:assert/strict";
import {
  mergeProjectTargetFromCandidates,
  normalizeProjectTarget
} from "../background/automation/project-target.js";

const resolved = mergeProjectTargetFromCandidates({
  enabled: true,
  name: "Dichrome",
  createIfMissing: true
}, [
  {
    active: false,
    title: "ChatGPT - Other",
    url: "https://chatgpt.com/g/g-p-other/project"
  },
  {
    active: false,
    lastAccessed: 1000,
    title: "Dichrome - Ray-sphere intersection analysis",
    url: "https://chatgpt.com/g/g-p-original-dichrome/c/abc"
  }
]);

assert.equal(resolved.segment, "g-p-original-dichrome");
assert.equal(resolved.url, "https://chatgpt.com/g/g-p-original-dichrome/project");
assert.equal(resolved.createIfMissing, true);

const preserved = mergeProjectTargetFromCandidates({
  enabled: true,
  name: "Dichrome",
  createIfMissing: false,
  segment: "g-p-pinned-dichrome"
}, [
  {
    active: true,
    title: "Dichrome - Another tab",
    url: "https://chatgpt.com/g/g-p-visible-dichrome/project"
  }
]);

assert.equal(preserved.segment, "g-p-pinned-dichrome");
assert.equal(preserved.url, "https://chatgpt.com/g/g-p-pinned-dichrome/project");
assert.equal(preserved.createIfMissing, false);

const sanitized = normalizeProjectTarget({
  enabled: true,
  name: "Dichrome",
  createIfMissing: true,
  url: "https://chatgpt.com/g/g-p-from-url-dichrome/project"
});

assert.equal(sanitized.segment, "g-p-from-url-dichrome");
assert.equal(sanitized.url, "https://chatgpt.com/g/g-p-from-url-dichrome/project");

console.log("Project target tests passed.");
