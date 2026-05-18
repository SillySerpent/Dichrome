import assert from "node:assert/strict";
import { calculateTypewriterCps } from "../sidepanel/runtime/response-animation.js";

const shortBacklog = calculateTypewriterCps({
  displayedLength: 0,
  remaining: 120,
  targetLength: 120
});
const largeBacklog = calculateTypewriterCps({
  displayedLength: 500,
  remaining: 9000,
  targetLength: 9500
});
const hugeBacklog = calculateTypewriterCps({
  displayedLength: 1000,
  remaining: 24000,
  targetLength: 25000
});

assert(shortBacklog >= 42);
assert(largeBacklog > shortBacklog);
assert(hugeBacklog >= largeBacklog);
assert(hugeBacklog <= 2400);

console.log("Response animation tests passed.");
