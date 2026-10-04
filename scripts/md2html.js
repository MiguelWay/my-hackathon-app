#!/usr/bin/env node
// Minimal Markdown -> HTML converter for the intent docs.
// Usage: node scripts/md2html.js <input.md> <output.html>
// Handles: #/##/### headings, "- " bullets (one nesting level via 2-space indent),
// "1. " ordered lists, blank-line paragraph breaks, **bold**, *italic* / _italic_.
const fs = require("fs");

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("Usage: node scripts/md2html.js <input.md> <output.html>");
  process.exit(1);
}

const md = fs.readFileSync(inPath, "utf8");

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const inline = (s) => {
  s = esc(s);
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_\n]+?)_/g, "$1<em>$2</em>");
  return s;
};

const out = [];
let inUl = false;
let nestedUl = false;
let inOl = false;

const closeAll = () => {
  if (nestedUl) { out.push("</ul>"); nestedUl = false; }
  if (inUl) { out.push("</ul>"); inUl = false; }
  if (inOl) { out.push("</ol>"); inOl = false; }
};

for (const raw of md.split(/\r?\n/)) {
  const line = raw.replace(/\s+$/, "");
  if (line.trim() === "") { closeAll(); continue; }

  let m;
  if (line === "---") { closeAll(); out.push("<hr>"); continue; }
  if ((m = line.match(/^# (.*)$/))) { closeAll(); out.push(`<h1>${inline(m[1])}</h1>`); continue; }
  if ((m = line.match(/^## (.*)$/))) { closeAll(); out.push(`<h2>${inline(m[1])}</h2>`); continue; }
  if ((m = line.match(/^### (.*)$/))) { closeAll(); out.push(`<h3>${inline(m[1])}</h3>`); continue; }

  // ordered list item
  if ((m = line.match(/^\d+\.\s+(.*)$/))) {
    if (nestedUl) { out.push("</ul>"); nestedUl = false; }
    if (inUl) { out.push("</ul>"); inUl = false; }
    if (!inOl) { out.push("<ol>"); inOl = true; }
    out.push(`<li>${inline(m[1])}</li>`);
    continue;
  }

  // bullet item (indent >= 2 => nested level)
  if ((m = line.match(/^(\s*)[-*]\s+(.*)$/))) {
    const nested = m[1].length >= 2;
    if (inOl) { out.push("</ol>"); inOl = false; }
    if (nested) {
      if (!inUl) { out.push("<ul>"); inUl = true; }
      if (!nestedUl) { out.push("<ul>"); nestedUl = true; }
    } else {
      if (nestedUl) { out.push("</ul>"); nestedUl = false; }
      if (!inUl) { out.push("<ul>"); inUl = true; }
    }
    out.push(`<li>${inline(m[2])}</li>`);
    continue;
  }

  closeAll();
  out.push(`<p>${inline(line)}</p>`);
}
closeAll();

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Statement of Intent</title>
<style>
body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 12pt; line-height: 1.45; }
h1 { font-size: 20pt; }
h2 { font-size: 15pt; }
h3 { font-size: 13pt; }
p { margin: 6pt 0; }
li { margin: 2pt 0; }
</style>
</head>
<body>
${out.join("\n")}
</body></html>
`;

fs.writeFileSync(outPath, html);
console.log(`Wrote ${outPath} (${out.length} blocks)`);
