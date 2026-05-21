import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  CHATGPT_AUTOMATION_MESSAGES,
  CHATGPT_CONTENT_SCRIPT_FILES,
  OFFSCREEN_FRAME_PORT_NAME,
  PANEL_MESSAGES,
  REQUEST_STATES,
  VISIBILITY_MODES
} from "../shared/contracts.js";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const chatGptContentScript = manifest.content_scripts.find((script) => script.matches?.includes("https://chatgpt.com/*"));
const contentContractsSource = await readFile(new URL("../content/chatgpt/runtime/contracts.js", import.meta.url), "utf8");
const contentContext = vm.createContext({});

vm.runInContext(contentContractsSource, contentContext);

const contentContracts = contentContext.ChatGptRelay.contracts;

assert.deepEqual(chatGptContentScript.js, CHATGPT_CONTENT_SCRIPT_FILES);
assert.equal(OFFSCREEN_FRAME_PORT_NAME, "chatgpt-relay-offscreen-frame");
assert.equal(REQUEST_STATES.RESPONSE_COMPLETE, "RESPONSE_COMPLETE");
assert.equal(VISIBILITY_MODES.HIDDEN, "hidden");
assert.equal(PANEL_MESSAGES.RUN_MANUAL_REQUEST, "RUN_MANUAL_REQUEST");
assert.equal(PANEL_MESSAGES.GET_PROJECT_CONVERSATIONS, "GET_PROJECT_CONVERSATIONS");
assert.equal(CHATGPT_AUTOMATION_MESSAGES.RUN, "CHATGPT_AUTOMATION_RUN");
assert.equal(CHATGPT_AUTOMATION_MESSAGES.LOAD_PROJECT_CONVERSATION, "CHATGPT_AUTOMATION_LOAD_PROJECT_CONVERSATION");
assert.equal(contentContracts.offscreenFramePortName, OFFSCREEN_FRAME_PORT_NAME);
assert.equal(contentContracts.requestStates.RESPONSE_COMPLETE, REQUEST_STATES.RESPONSE_COMPLETE);
assert.equal(contentContracts.visibilityModes.HIDDEN, VISIBILITY_MODES.HIDDEN);
assert.equal(contentContracts.messages.run, CHATGPT_AUTOMATION_MESSAGES.RUN);
assert.equal(contentContracts.messages.listProjectConversations, CHATGPT_AUTOMATION_MESSAGES.LIST_PROJECT_CONVERSATIONS);

console.log("Contract tests passed.");
