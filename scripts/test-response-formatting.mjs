import assert from "node:assert/strict";
import {
  normalizeResponseText,
  renderMarkdownToHtml,
  sanitizeResponseHtml
} from "../shared/response-formatting.js";

assert.equal(renderMarkdownToHtml("Hello\n\nWorld"), "<p>Hello</p><p>World</p>");
assert.equal(renderMarkdownToHtml("# Title\nBody"), "<h1>Title</h1><p>Body</p>");
assert.match(renderMarkdownToHtml("- one\n- two"), /^<ul><li>one<\/li><li>two<\/li><\/ul>$/);
assert.match(renderMarkdownToHtml("- one\n  wrapped detail\n- two"), /^<ul><li>one<br>wrapped detail<\/li><li>two<\/li><\/ul>$/);
assert.match(renderMarkdownToHtml("1. one\n   wrapped detail\n2. two"), /^<ol><li>one<br>wrapped detail<\/li><li>two<\/li><\/ol>$/);
assert.match(renderMarkdownToHtml("```js\nconst x = 1;\n```"), /<pre><code class="language-js">const x = 1;<\/code><\/pre>/);
{
  const html = renderMarkdownToHtml([
    '```text id="c69h1q"',
    "3+4=7,",
    "```",
    "",
    "Final result:",
    "",
    '```text id="c69h1r"',
    "[3, 7, 13]",
    "```"
  ].join("\n"));

  assert.equal((html.match(/<pre>/g) || []).length, 2);
  assert.doesNotMatch(html, /text id=/i);
  assert.match(html, /<p class="response-label"><strong>Final result:<\/strong><\/p>/);
  assert.match(html, /<code class="language-text">3\+4=7,/);
  assert.match(html, /<code class="language-text">\[3, 7, 13\]/);
}
assert.match(renderMarkdownToHtml("~~~python\nprint('ok')\n~~~"), /language-python/);
assert.match(renderMarkdownToHtml("| A | B |\n|---|---|\n| 1 | 2 |"), /<table>/);
assert.match(renderMarkdownToHtml("A\tB\n1\t2"), /<table><thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table>/);
assert.match(renderMarkdownToHtml("[ok](https://example.test)"), /href="https:\/\/example.test"/);
assert.doesNotMatch(renderMarkdownToHtml("[bad](javascript:alert(1))"), /<a /);
assert.match(renderMarkdownToHtml("This has ~~removed~~ text."), /<del>removed<\/del>/);
assert.match(renderMarkdownToHtml("[x] Done\n[ ] Pending"), /class="task-list"/);
assert.match(renderMarkdownToHtml("[x] Done\n[ ] Pending"), /task-marker-checked/);

const writing = renderMarkdownToHtml([
  ':::writing{variant="email" id="48291" subject="Assignment Submission Issue"}',
  "Hello Toby,",
  "",
  "Could you please reopen the Dropbox submission folder?",
  ":::"
].join("\n"));
assert.match(writing, /class="writing-block writing-block-email"/);
assert.match(writing, /Assignment Submission Issue/);
assert.match(writing, /Hello Toby/);
assert.doesNotMatch(writing, /:::writing|48291/);

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

const mixedDisplayMath = renderMarkdownToHtml([
  "1. **Write the ray coordinates**",
  "\\[",
  "p(t)=",
  "\\begin{pmatrix}0\\\\-1\\\\-1\\end{pmatrix}",
  "+t\\begin{pmatrix}1\\\\1\\\\1\\end{pmatrix}",
  "=",
  "\\begin{pmatrix}t\\\\-1+t\\\\-1+t\\end{pmatrix}",
  "\\]"
].join("\n"));
assert.match(mixedDisplayMath, /<ol><li><strong>Write the ray coordinates<\/strong><\/li><\/ol>/);
assert.equal((mixedDisplayMath.match(/class="math-environment math-pmatrix"/g) || []).length, 3);
assert.doesNotMatch(mixedDisplayMath, /<br>\\\[|<br>\\begin\{pmatrix\}/);
assert.doesNotMatch(mixedDisplayMath, /math-fallback/);

const matrixMath = renderMarkdownToHtml("$$\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}$$");
assert.match(matrixMath, /math-bmatrix/);
assert.match(matrixMath, /math-row/);
assert.doesNotMatch(matrixMath, /beginbmatrix|endbmatrix/);

const casesMath = renderMarkdownToHtml("$$\\begin{cases} x^2, & x \\ge 0 \\\\ -x, & x < 0 \\end{cases}$$");
assert.match(casesMath, /math-cases/);
assert.match(casesMath, /≥/);
assert.doesNotMatch(casesMath, /begincases|endcases/);

const symbolMath = renderMarkdownToHtml("Use \\(A \\land B \\Rightarrow \\bar{x} \\in S\\).");
assert.match(symbolMath, /∧/);
assert.match(symbolMath, /⇒/);
assert.match(symbolMath, /math-overline/);
assert.match(symbolMath, /∈/);

const accentAndPrimeMath = renderMarkdownToHtml(`Use \\(\\hat{x} + P' + x\u02c6 + y\u0302 + \\widehat{AB} + x < 0\\).`);
assert.match(accentAndPrimeMath, /math-accent-hat/);
assert.match(accentAndPrimeMath, /<sup class="math-prime">′<\/sup>/);
assert.match(accentAndPrimeMath, /\\hat\{x\}/);
assert.match(accentAndPrimeMath, /&lt; 0/);
assert.doesNotMatch(accentAndPrimeMath, /&amp;#039;|&amp;lt;/);

const matrixProductMath = renderMarkdownToHtml([
  "$$\\begin{bmatrix} 1 & 20 \\\\ 300 & 4 \\end{bmatrix}",
  "\\begin{pmatrix} x \\\\ y \\end{pmatrix}",
  "= \\begin{bmatrix} 1x + 20y \\\\ 300x + 4y \\end{bmatrix}$$"
].join(""));
assert.equal((matrixProductMath.match(/math-environment/g) || []).length, 3);
assert.match(matrixProductMath, /math-pmatrix/);
assert.match(matrixProductMath, /math-bracket-square/);
assert.doesNotMatch(matrixProductMath, /beginbmatrix|endbmatrix|beginpmatrix|endpmatrix/);

const complexBoxedMatrixMath = renderMarkdownToHtml([
  "$$\\boxed{\\det\\left(",
  "\\begin{pmatrix}",
  "\\lambda-\\ddot{a} & \\sqrt{\\Delta} & \\partial_t\\varnothing \\\\",
  "\\sum_i & \\lambda+\\tilde{\\beta} & \\hat{f} \\\\",
  "\\dot{a}_{\\neg} & \\nabla^2\\psi & \\lambda-\\Omega",
  "\\end{pmatrix}",
  "\\right)=0}$$"
].join(" "));
assert.match(complexBoxedMatrixMath, /math-boxed/);
assert.match(complexBoxedMatrixMath, /math-pmatrix/);
assert.match(complexBoxedMatrixMath, /∂<sub>t<\/sub>∅/);
assert.match(complexBoxedMatrixMath, /∇<sup>2<\/sup>ψ/);
assert.match(complexBoxedMatrixMath, /math-accent-ddot/);
assert.match(complexBoxedMatrixMath, /math-accent-tilde/);
assert.doesNotMatch(complexBoxedMatrixMath, />boxed|>partial|>varnothing|>nabla|beginpmatrix|endpmatrix/);

const alignedMath = renderMarkdownToHtml([
  "$$\\begin{aligned}",
  "\\tilde f(x) &= \\sum_{n=-\\infty}^{\\infty} \\hat c_n e^{i\\pi nx/L} \\\\",
  "\\hat c_n &= \\frac{1}{2L}\\int_{-L}^{L} f(x)e^{-i\\pi nx/L}\\,dx",
  "\\end{aligned}$$"
].join(" "));
assert.match(alignedMath, /math-aligned/);
assert.match(alignedMath, /∞/);
assert.match(alignedMath, /π/);
assert.match(alignedMath, /∫/);
assert.doesNotMatch(alignedMath, /beginaligned|endaligned/);

const compactFractionMath = renderMarkdownToHtml("$$t=\\frac13 \\quad \\text{or} \\quad t=1$$");
assert.match(compactFractionMath, /class="math math-display"/);
assert.match(compactFractionMath, /math-frac/);
assert.match(compactFractionMath, /<span class="math-num">1<\/span>/);
assert.match(compactFractionMath, /<span class="math-den">3<\/span>/);
assert.doesNotMatch(compactFractionMath, /math-fallback/);

const quotedDisplayMath = renderMarkdownToHtml([
  "> $$",
  "> \\boxed{",
  "> \\tilde{z}",
  "> =",
  "> \\frac{\\hat{\\alpha}+i\\ddot{\\beta}}",
  "> {\\sqrt{\\Delta}-\\mathring{\\varnothing}i}",
  "> +",
  "> e^{i\\pi}",
  "> +",
  "> \\sum_{n=1}^{\\infty}\\frac{1}{n^2}",
  "> }",
  "> $$"
].join("\n"));
assert.match(quotedDisplayMath, /^<blockquote><div class="math math-display/);
assert.match(quotedDisplayMath, /math-boxed/);
assert.match(quotedDisplayMath, /math-accent-tilde/);
assert.match(quotedDisplayMath, /math-accent-ddot/);
assert.match(quotedDisplayMath, /∑/);
assert.doesNotMatch(quotedDisplayMath, /<br>\\boxed|\$\$/);

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
