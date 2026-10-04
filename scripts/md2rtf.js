#!/usr/bin/env node
// Markdown -> RTF converter for the intent docs, with exact control over fonts.
// Usage: node scripts/md2rtf.js <input.md> <output.rtf>
// Styling: Arial 14pt (fs28) everywhere; headings bold.
// Every bullet that sits under an "**Open / to confirm:**" line is prefixed with a red "?".
// (A literal ❓ anywhere is also turned into a red "?".)
// Handles: #/##/### headings, "- " bullets (1 nesting level), "1. " lists, "---" rules,
// blank-line paragraph breaks, **bold**, *italic* / _italic_.
const fs = require("fs");

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("Usage: node scripts/md2rtf.js <input.md> <output.rtf>");
  process.exit(1);
}

const md = fs.readFileSync(inPath, "utf8");

const Q_ESCAPED = "\\u10067?"; // RTF escape of the ❓ character (U+2753)
const RED_Q = "\\cf2 ?\\cf1 "; // red, question mark

function rtfEsc(s) {
  let o = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === "\\") o += "\\\\";
    else if (ch === "{") o += "\\{";
    else if (ch === "}") o += "\\}";
    else if (c > 127) {
      const n = c > 32767 ? c - 65536 : c;
      o += "\\u" + n + "?";
    } else if (ch === "\t") o += "\\tab ";
    else o += ch;
  }
  return o;
}

function rtfInline(s) {
  s = rtfEsc(s);
  s = s.split(Q_ESCAPED).join(RED_Q);
  s = s.replace(/\*\*(.+?)\*\*/g, "\\b $1\\b0 ");
  s = s.replace(/\*([^*\n]+?)\*/g, "\\i $1\\i0 ");
  s = s.replace(/(^|[^_])_([^_\n]+?)_/g, "$1\\i $2\\i0 ");
  return s;
}

function para(text, opts = {}) {
  const { bold = false, indent = 0, bullet = false, size = 28, border = false } = opts;
  let p = "\\pard";
  if (indent) p += `\\li${indent}\\fi-360`;
  if (border) p += "\\brdrb\\brdrs\\brdrw10\\brsp40";
  p += "\\sa120";
  if (bold) p += "\\b";
  p += `\\fs${size} `;
  if (bullet) p += "\\bullet\\tab ";
  p += text;
  if (bold) p += "\\b0";
  return p + "\\par\n";
}

const out = [];
let inOpen = false; // inside an "Open / to confirm:" list

for (const raw of md.split(/\r?\n/)) {
  const line = raw.replace(/\s+$/, "");
  if (line.trim() === "") continue;

  let m;
  if (line === "---") { inOpen = false; out.push(para("", { border: true, size: 28 })); continue; }
  if ((m = line.match(/^#{1,3} (.*)$/))) { inOpen = false; out.push(para(rtfInline(m[1]), { bold: true, size: 28 })); continue; }
  if ((m = line.match(/^(\d+)\.\s+(.*)$/))) {
    out.push(para((inOpen ? RED_Q : "") + `${m[1]}. ${rtfInline(m[2])}`, { indent: 720, size: 28 }));
    continue;
  }
  if ((m = line.match(/^(\s*)[-*]\s+(.*)$/))) {
    const indent = m[1].length >= 2 ? 1440 : 720;
    out.push(para((inOpen ? RED_Q : "") + rtfInline(m[2]), { indent, bullet: true, size: 28 }));
    continue;
  }

  // Normal paragraph. A line that is exactly the "Open / to confirm:" heading opens a
  // question list; any other prose/heading closes it.
  inOpen = /^\*\*Open \/ to confirm:\*\*\s*$/.test(line);
  out.push(para(rtfInline(line), { size: 28 }));
}

const rtf =
  "{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1\n" +
  "{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}}\n" +
  "{\\colortbl;\\red0\\green0\\blue0;\\red204\\green0\\blue0;}\n" +
  "\\viewkind4\\f0\\fs28\n" +
  out.join("") +
  "}\n";

fs.writeFileSync(outPath, rtf);
console.log(`Wrote ${outPath} (${out.length} paragraphs)`);
