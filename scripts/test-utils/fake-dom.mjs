export function installFakeDocument() {
  const documentRef = {
    createElement(tagName) {
      return new FakeElement(tagName);
    }
  };

  globalThis.document = documentRef;

  return documentRef;
}

export class FakeElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName || "div").toUpperCase();
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.className = "";
    this.textContent = "";
    this.innerHTML = "";
    this.alt = "";
    this.decoding = "";
    this.height = 0;
    this.loading = "";
    this.src = "";
    this.type = "";
    this.width = 0;
    this.classList = {
      toggle: (className, force) => {
        const classes = new Set(String(this.className || "").split(/\s+/).filter(Boolean));
        const shouldAdd = force === undefined ? !classes.has(className) : Boolean(force);

        if (shouldAdd) {
          classes.add(className);
        } else {
          classes.delete(className);
        }

        this.className = Array.from(classes).join(" ");
      }
    };
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] || "";
  }
}
