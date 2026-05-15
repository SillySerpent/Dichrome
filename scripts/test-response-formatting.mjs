import assert from "node:assert/strict";
import {
  normalizeResponseText,
  renderMarkdownToHtml,
  sanitizeResponseHtml
} from "../shared/response-formatting.js";

assert.equal(renderMarkdownToHtml("Hello\n\nWorld"), "<p>Hello</p><p>World</p>");
assert.equal(renderMarkdownToHtml("# Title\nBody"), "<h1>Title</h1><p>Body</p>");
assert.match(renderMarkdownToHtml("- one\n- two"), /^<ul><li>one<\/li><li>two<\/li><\/ul>$/);
assert.match(renderMarkdownToHtml("```js\nconst x = 1;\n```"), /<pre><code class="language-js">const x = 1;<\/code><\/pre>/);
assert.match(renderMarkdownToHtml("| A | B |\n|---|---|\n| 1 | 2 |"), /<table>/);
assert.match(renderMarkdownToHtml("[ok](https://example.test)"), /href="https:\/\/example.test"/);
assert.doesNotMatch(renderMarkdownToHtml("[bad](javascript:alert(1))"), /<a /);

const math = renderMarkdownToHtml("$$\\frac{a_1}{\\sqrt{b^2}} + \\alpha$$");
assert.match(math, /class="math math-display"/);
assert.match(math, /math-frac/);
assert.match(math, /math-root/);
assert.match(math, /<sub>1<\/sub>/);
assert.match(math, /<sup>2<\/sup>/);
assert.match(math, /α/);

const inlineMath = renderMarkdownToHtml("Use \\(x_i^2\\) now.");
assert.match(inlineMath, /class="math math-inline"/);
assert.match(inlineMath, /<sub>i<\/sub>/);
assert.match(inlineMath, /<sup>2<\/sup>/);

const bracketDisplayMath = renderMarkdownToHtml("\\[\\text{speed} = 9.8\\,\\mathrm{m}\\]");
assert.match(bracketDisplayMath, /class="math math-display"/);
assert.match(bracketDisplayMath, /speed/);
assert.match(bracketDisplayMath, /m/);

const fallbackMath = renderMarkdownToHtml("$$\\frac{a}$$");
assert.match(fallbackMath, /math-fallback/);
assert.match(fallbackMath, /\\frac\{a\}/);

assert.equal(
  normalizeResponseText("A @@CODE_SPAN_1@@ B @@ CODE_BLOCK_2 @@ C"),
  "A  B  C"
);
assert.equal(
  normalizeResponseText("hello entity[\"turn0search0\",\"Visible Name\"] world"),
  "hello Visible Name world"
);
assert.doesNotMatch(sanitizeResponseHtml("<p onclick=\"x()\"><a href=\"javascript:bad()\">bad</a><script>x()</script></p>"), /script|onclick|javascript/i);

console.log("Response formatting tests passed.");
