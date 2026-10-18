/**
 * scan-status checks - the ONE reader of RequestAttachment.scan_status, and a
 * source guard that keeps a lowercase comparison from creeping back in.
 *
 * Runs bundled (vite's own rolldown): `npm run check:scan-status` (see
 * package.json). The bug this guards was a comparison against lowercase
 * ("clean"/"pending") while the server emits UPPERCASE (PENDING/CLEAN/FAILED/
 * REJECTED, reqs/models.py) — which can never match, so every attachment
 * rendered as quarantined. That is a class of bug, so besides asserting the
 * helper's behaviour, this scans the whole src/ tree for any `scan_status`
 * compared to a non-uppercase literal.
 */
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { isQuarantined, scanStatusLabel } from "../src/app/scanStatus";

// ── the label agrees with the server's real values ──
// CLEAN must NOT read as quarantined (this is the exact bug).
assert.equal(scanStatusLabel("CLEAN", "ar"), "فحص سليم");
assert.equal(scanStatusLabel("CLEAN", "en"), "Scan clean");
assert.ok(!scanStatusLabel("CLEAN", "ar").includes("محجوز"), "CLEAN must not read as quarantined (ar)");
assert.ok(!scanStatusLabel("CLEAN", "en").includes("Quarantined"), "CLEAN must not read as quarantined (en)");

assert.equal(scanStatusLabel("PENDING", "ar"), "بانتظار الفحص");
assert.equal(scanStatusLabel("PENDING", "en"), "Awaiting scan");

// A genuinely non-clean file IS quarantined.
for (const held of ["FAILED", "REJECTED"] as const) {
  assert.ok(scanStatusLabel(held, "ar").includes("محجوز"), `${held} must read as quarantined (ar)`);
  assert.ok(scanStatusLabel(held, "en").includes("Quarantined"), `${held} must read as quarantined (en)`);
}

// ── only CLEAN is un-held (the server blocks submit on every other state) ──
assert.equal(isQuarantined("CLEAN"), false);
assert.equal(isQuarantined("PENDING"), true);
assert.equal(isQuarantined("FAILED"), true);
assert.equal(isQuarantined("REJECTED"), true);

// ── source guard: no screen compares scan_status against a lowercase literal ──
const SRC = resolve(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const COMPARE = /scan_status\s*(?:===|!==)\s*"([^"]*)"/g;
let comparisons = 0;
for (const file of walk(SRC)) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(COMPARE)) {
    comparisons += 1;
    const literal = match[1] ?? "";
    assert.equal(
      literal,
      literal.toUpperCase(),
      `${file}: scan_status compared to "${literal}" — the server emits UPPERCASE; use scanStatusLabel()`,
    );
  }
}
// The screens that render attachments must go through the one helper.
for (const screen of ["screens/RequestDetailPage.tsx", "screens/TeamReviewsPage.tsx", "screens/MyRequestsPage.tsx"]) {
  const text = readFileSync(join(SRC, screen), "utf8");
  assert.ok(text.includes("scanStatusLabel("), `${screen} must render scan status via scanStatusLabel()`);
}

console.log(`check-scan-status: all assertions passed (${comparisons} direct comparisons, all uppercase)`);
