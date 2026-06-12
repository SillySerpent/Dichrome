import {
  RESPONSE_ALLOWED_ATTRIBUTES,
  RESPONSE_ALLOWED_TAGS
} from "../contracts.js";

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

function sanitizeResponseHtmlString(html) {
  return String(html || "")
    .replace(/<\s*(script|style|iframe|object|embed|form|button|input|textarea|select)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+href\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, "")
    .replace(/\s+src\s*=\s*(["'])[\s\S]*?\1/gi, "");
}
