#!/usr/bin/env node
// Minimal Markdown -> styled HTML converter for the intent docs.
// Usage: node scripts/md2html.js <input.md> <output.html>
// Styling: Arial 14pt body, bold headings, open points marked with a red "?".
// Handles: #/##/### headings, "- " bullets (one nesting level via 2-space indent),
// "1. " ordered lists, "---" rules, blank-line paragraph breaks, **bold**, *italic*.
const fs = require("fs");

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("Usage: node scripts/md2html.js <input.md> <output.html>");
  process.exit(1);
}

const md = fs.readFileSync(inPath, "utf8");

const S = "font-family:Arial, Helvetica, sans-serif;";
const H1S = S + "font-size:16pt;font-weight:bold;";
const H2S = S + "font-size:14pt;font-weight:bold;";
const H3S = S + "font-size:14pt;font-weight:bold;";
const PS = S + "font-size:14pt;";
const LIS = S + "font-size:14pt;";
// Red, bold question mark for every open point.
const RED_Q = '<font color="#cc0000"><b>?</b></font>';

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const inline = (s) => {
  s = esc(s);
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_\n]+?)_/g, "$1<em>$2</em>");
  // Any ❓ becomes a red question mark.
  s = s.replace(/\u2753/g, RED_Q);
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
  if ((m = line.match(/^# (.*)$/))) { closeAll(); out.push(`<h1 style="${H1S}">${inline(m[1])}</h1>`); continue; }
  if ((m = line.match(/^## (.*)$/))) { closeAll(); out.push(`<h2 style="${H2S}">${inline(m[1])}</h2>`); continue; }
  if ((m = line.match(/^### (.*)$/))) { closeAll(); out.push(`<h3 style="${H3S}">${inline(m[1])}</h3>`); continue; }

  if ((m = line.match(/^\d+\.\s+(.*)$/))) {
    if (nestedUl) { out.push("</ul>"); nestedUl = false; }
    if (inUl) { out.push("</ul>"); inUl = false; }
    if (!inOl) { out.push('<ol style="' + PS + '">'); inOl = true; }
    out.push(`<li style="${LIS}">${inline(m[1])}</li>`);
    continue;
  }

  if ((m = line.match(/^(\s*)[-*]\s+(.*)$/))) {
    const nested = m[1].length >= 2;
    if (inOl) { out.push("</ol>"); inOl = false; }
    if (nested) {
      if (!inUl) { out.push('<ul style="' + PS + '">'); inUl = true; }
      if (!nestedUl) { out.push('<ul style="' + PS + '">'); nestedUl = true; }
    } else {
      if (nestedUl) { out.push("</ul>"); nestedUl = false; }
      if (!inUl) { out.push('<ul style="' + PS + '">'); inUl = true; }
    }
    out.push(`<li style="${LIS}">${inline(m[2])}</li>`);
    continue;
  }

  closeAll();
  out.push(`<p style="${PS}">${inline(line)}</p>`);
}
closeAll();

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Statement of Intent</title></head>
<body style="${S}font-size:14pt;">
${out.join("\n")}
</body></html>
`;

fs.writeFileSync(outPath, html);
console.log(`Wrote ${outPath} (${out.length} blocks)`);
