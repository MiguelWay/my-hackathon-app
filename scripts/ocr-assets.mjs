// Copies the Tesseract runtime into `public/tesseract/` so the browser OCR runs entirely on-device:
// no CDN, no third-party request, no CSP exception for an external host.
//
// Vite copies `public/` into `dist/` verbatim, so the files ship with the app and are served from the
// same origin. Everything comes from node_modules, so `npm ci` is the only network step.
//
// Runs automatically before `npm run build` and `npm run dev` (prebuild / predev). Idempotent: a file
// of the expected size is left alone.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "tesseract");

/** [source relative to node_modules, destination name] */
const files = [
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  // The LSTM core is the accurate one. tesseract.js asks for relaxed-SIMD, then SIMD, then the plain
  // build, depending on what the browser supports, so all three have to be present.
  ["tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm", "tesseract-core-relaxedsimd-lstm.wasm"],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm", "tesseract-core-simd-lstm.wasm"],
  ["tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract-core-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-lstm.wasm", "tesseract-core-lstm.wasm"],
];

/** The English model. `best_int` is the accuracy-optimised model, integer-quantised to ~3 MB. */
function modelPath() {
  const pkg = join(root, "node_modules", "@tesseract.js-data", "eng");
  if (!existsSync(pkg)) return null;
  const variants = readdirSync(pkg).filter((name) => name.includes("best_int"));
  for (const variant of variants) {
    const candidate = join(pkg, variant, "eng.traineddata.gz");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function size(path) {
  try {
    return statSync(path).size;
  } catch {
    return -1;
  }
}

mkdirSync(out, { recursive: true });

let copied = 0;
let skipped = 0;
const missing = [];

for (const [from, to] of files) {
  const source = join(root, "node_modules", from);
  const target = join(out, to);
  if (!existsSync(source)) {
    missing.push(from);
    continue;
  }
  if (size(source) === size(target)) {
    skipped += 1;
    continue;
  }
  copyFileSync(source, target);
  copied += 1;
}

const model = modelPath();
if (model) {
  const target = join(out, "eng.traineddata.gz");
  if (size(model) === size(target)) {
    skipped += 1;
  } else {
    copyFileSync(model, target);
    copied += 1;
  }
} else {
  missing.push("@tesseract.js-data/eng/<best_int>/eng.traineddata.gz");
}

if (missing.length) {
  console.error("ocr-assets: missing from node_modules (run `npm ci`):");
  for (const item of missing) console.error(`  - ${item}`);
  process.exit(1);
}

console.log(`ocr-assets: ${copied} copied, ${skipped} up to date → public/tesseract/`);
