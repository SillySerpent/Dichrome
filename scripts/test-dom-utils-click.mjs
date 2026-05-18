import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

class FakeMouseEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}

class FakePointerEvent extends FakeMouseEvent {}

const context = vm.createContext({
  ChatGptRelay: {},
  MouseEvent: FakeMouseEvent,
  InputEvent: FakeMouseEvent,
  window: {
    PointerEvent: FakePointerEvent,
    CSS: {
      escape(value) {
        return String(value);
      }
    }
  }
});
const source = await readFile(new URL("../content/chatgpt/runtime/dom/utils.js", import.meta.url), "utf8");

vm.runInContext(source, context);

const { clickElement } = context.ChatGptRelay.runtime.domUtils;

{
  const events = [];
  const element = createElement({
    events,
    click() {
      events.push("native-click");
      this.dispatchEvent(new FakeMouseEvent("click"));
    }
  });

  clickElement(element);

  assert.equal(events.filter((event) => event === "click").length, 1);
  assert.equal(events.filter((event) => event === "native-click").length, 1);
  assert(events.includes("pointerdown"));
  assert(events.includes("mousedown"));
  assert(events.includes("pointerup"));
  assert(events.includes("mouseup"));
}

{
  const events = [];
  const element = createElement({
    events
  });

  clickElement(element);

  assert.equal(events.filter((event) => event === "click").length, 1);
  assert.equal(events.filter((event) => event === "native-click").length, 0);
}

console.log("DOM click utility tests passed.");

function createElement({ events, click } = {}) {
  const element = {
    dispatchEvent(event) {
      events.push(event.type);
      return true;
    },
    focus() {
      events.push("focus");
    },
    scrollIntoView() {
      events.push("scroll");
    },
    getBoundingClientRect() {
      return {
        left: 0,
        top: 0,
        width: 20,
        height: 10
      };
    }
  };

  if (click) {
    element.click = click;
  }

  return element;
}
