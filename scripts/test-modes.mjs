import assert from "node:assert/strict";
import {
  ACTIVE_MODE_STORAGE_KEY,
  APP_MODES,
  getActiveMode,
  listPublicModes,
  normalizeAppMode,
  setActiveMode
} from "../shared/modes.js";

const emptyStorage = createStorage();

assert.equal(await getActiveMode({ storageArea: emptyStorage }), APP_MODES.MODE2);
assert.equal(emptyStorage.values.get(ACTIVE_MODE_STORAGE_KEY), APP_MODES.MODE2);
assert.equal(normalizeAppMode("MODE1"), APP_MODES.MODE1);
assert.equal(normalizeAppMode("missing"), null);
assert.deepEqual(listPublicModes().map((mode) => mode.id), [APP_MODES.MODE2, APP_MODES.MODE1]);

const legacyStorage = createStorage({
  chatGptAutomationSettings: {
    project: {
      enabled: true
    }
  }
});

assert.equal(await getActiveMode({ storageArea: legacyStorage }), APP_MODES.MODE1);
assert.equal(legacyStorage.values.get(ACTIVE_MODE_STORAGE_KEY), APP_MODES.MODE1);
assert.equal(await setActiveMode(APP_MODES.MODE2, { storageArea: legacyStorage }), APP_MODES.MODE2);
assert.equal(await getActiveMode({ storageArea: legacyStorage }), APP_MODES.MODE2);
await assert.rejects(
  () => setActiveMode("unsupported-browser", { storageArea: legacyStorage }),
  /Unsupported Dichrome mode/
);

console.log("Mode storage tests passed.");

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));

  return {
    values,
    async get(keys) {
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((key) => [key, values.get(key)]));
      }

      if (typeof keys === "string") {
        return {
          [keys]: values.get(keys)
        };
      }

      return Object.fromEntries(Object.keys(keys || {}).map((key) => [key, values.get(key) ?? keys[key]]));
    },
    async set(nextValues) {
      for (const [key, value] of Object.entries(nextValues)) {
        values.set(key, value);
      }
    }
  };
}
