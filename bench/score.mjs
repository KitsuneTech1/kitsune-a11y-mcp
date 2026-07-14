// Score the run against W3C's ground truth.
//
// Scoring is per-ACT-rule, not "did the page have any complaint at all". That matters:
// a W3C page marked "passed" for rule X can still legitimately trip an unrelated axe rule
// (no <title>, no lang, whatever), and counting that as a false positive would be dishonest
// in the tool's favour AND against it. So for ACT rule R we only look at the axe rules that
// axe-core itself declares implement R (its `actIds` metadata).
import { readFileSync, writeFileSync } from "node:fs";

const { axeVersion, actToAxe, results } = JSON.parse(readFileSync("results.json", "utf8"));
const cases = JSON.parse(readFileSync("testcases.json", "utf8")).testcases;
const nameOf = {};
for (const c of cases) nameOf[c.ruleId] = c.ruleName;

const errored = results.filter((r) => r.error);
const crashed = results.filter((r) => r.kitsuneCrash);
const ok = results.filter((r) => !r.error);

const allActRules = [...new Set(cases.map((c) => c.ruleId))];
const implemented = allActRules.filter((r) => (actToAxe[r] || []).length);
const unimplemented = allActRules.filter((r) => !(actToAxe[r] || []).length);

// ---- per-rule confusion matrix ----
const perRule = {};
for (const r of ok) {
  const axeForRule = actToAxe[r.ruleId] || [];
  const fired = r.axeViolations.some((v) => axeForRule.includes(v));
  const p = (perRule[r.ruleId] ||= { rule: r.ruleId, name: nameOf[r.ruleId], impl: axeForRule.length > 0, axeRules: axeForRule, TP: 0, FN: 0, FP: 0, TN: 0 });
  if (r.expected === "failed") fired ? p.TP++ : p.FN++;
  else fired ? p.FP++ : p.TN++;
}

const sum = (rules, k) => rules.reduce((a, r) => a + perRule[r][k], 0);

// Headline: recall across EVERY known failure in the suite, including rules axe never implemented.
const allRules = Object.keys(perRule);
const TPall = sum(allRules, "TP"), FNall = sum(allRules, "FN"), FPall = sum(allRules, "FP"), TNall = sum(allRules, "TN");

const implRules = allRules.filter((r) => perRule[r].impl);
const TPi = sum(implRules, "TP"), FNi = sum(implRules, "FN"), FPi = sum(implRules, "FP"), TNi = sum(implRules, "TN");

const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");

const L = [];
L.push(`ENGINE: axe-core ${axeVersion}, tags = the exact set kitsune-a11y-mcp/server.mjs runs`);
L.push(`CORPUS: W3C ACT Rules test suite, ${cases.length} cases / ${allActRules.length} official rules`);
L.push(`LOADED: ${ok.length} ok, ${errored.length} failed to load`);
L.push("");
L.push("=".repeat(78));
L.push("1. COVERAGE  (does the engine even TRY the rule?)");
L.push("=".repeat(78));
L.push(`  ACT rules axe-core implements : ${implemented.length}/${allActRules.length}  (${pct(implemented.length, allActRules.length)})`);
L.push(`  ACT rules with NO check at all: ${unimplemented.length}/${allActRules.length}  (${pct(unimplemented.length, allActRules.length)})`);
L.push("");
L.push("=".repeat(78));
L.push("2. DETECTION on the 382 pages W3C labels as REAL FAILURES");
L.push("=".repeat(78));
L.push(`  Across ALL ${allActRules.length} rules   -> caught ${TPall}, missed ${FNall}   RECALL ${pct(TPall, TPall + FNall)}   <-- the honest headline`);
L.push(`  Only the ${implemented.length} implemented -> caught ${TPi}, missed ${FNi}   RECALL ${pct(TPi, TPi + FNi)}`);
L.push("");
L.push("=".repeat(78));
L.push("3. FALSE POSITIVES on the pages W3C labels CLEAN (passed / inapplicable)");
L.push("=".repeat(78));
L.push(`  Wrongly flagged: ${FPall} of ${FPall + TNall}   FP RATE ${pct(FPall, FPall + TNall)}`);
L.push(`  Precision (of everything it flagged, how much was real): ${pct(TPall, TPall + FPall)}`);
L.push("");
L.push("=".repeat(78));
L.push(`4. THE ${unimplemented.length} ACT RULES THIS TOOL CANNOT SEE AT ALL`);
L.push("=".repeat(78));
const blindFails = {};
for (const r of ok) if (!perRule[r.ruleId].impl && r.expected === "failed") blindFails[r.ruleId] = (blindFails[r.ruleId] || 0) + 1;
for (const r of unimplemented.sort((a, b) => (blindFails[b] || 0) - (blindFails[a] || 0))) {
  L.push(`  [${blindFails[r] ? String(blindFails[r]).padStart(2) + " known failures missed" : " 0 failure cases      "}]  ${nameOf[r]}`);
}
L.push("");
L.push("=".repeat(78));
L.push("5. WORST IMPLEMENTED RULES (it tries, and still misses)");
L.push("=".repeat(78));
const leaky = implRules.map((r) => perRule[r]).filter((p) => p.FN > 0).sort((a, b) => b.FN - a.FN);
for (const p of leaky) L.push(`  missed ${String(p.FN).padStart(2)}/${String(p.TP + p.FN).padStart(2)}  ${p.name}   [axe: ${p.axeRules.join(", ")}]`);
L.push("");
L.push("=".repeat(78));
L.push("6. NOISIEST IMPLEMENTED RULES (flags clean pages)");
L.push("=".repeat(78));
const noisy = implRules.map((r) => perRule[r]).filter((p) => p.FP > 0).sort((a, b) => b.FP - a.FP);
if (!noisy.length) L.push("  none");
for (const p of noisy) L.push(`  false-flagged ${String(p.FP).padStart(2)}/${String(p.FP + p.TN).padStart(2)} clean pages  ${p.name}   [axe: ${p.axeRules.join(", ")}]`);

// ---- the 5 hand-written Kitsune checks: measured on the CLEAN pages only ----
L.push("");
L.push("=".repeat(78));
L.push("7. THE 5 HAND-WRITTEN 'KITSUNE' CHECKS  (not ACT rules; measured for noise)");
L.push("=".repeat(78));
const clean = ok.filter((r) => r.expected !== "failed");
const kcount = {};
for (const r of ok) for (const k of r.kitsune || []) kcount[k] = (kcount[k] || 0) + 1;
const kclean = {};
for (const r of clean) for (const k of r.kitsune || []) kclean[k] = (kclean[k] || 0) + 1;
L.push(`  Fired on ${clean.length} pages W3C considers CLEAN for the rule under test:`);
for (const [k, v] of Object.entries(kclean).sort((a, b) => b[1] - a[1])) {
  L.push(`    ${k.padEnd(24)} fired on ${String(v).padStart(4)}/${clean.length} clean pages  (${pct(v, clean.length)})`);
}
L.push(`  Pages where the label check CRASHED the evaluation: ${crashed.length}`);

const out = L.join("\n");
console.log(out);
writeFileSync("FINDINGS.txt", out + "\n");
writeFileSync(
  "scored.json",
  JSON.stringify({ axeVersion, headline: { coverage: [implemented.length, allActRules.length], recallAll: [TPall, TPall + FNall], recallImpl: [TPi, TPi + FNi], fp: [FPall, FPall + TNall], precision: [TPall, TPall + FPall] }, perRule, unimplemented: unimplemented.map((r) => ({ rule: r, name: nameOf[r], missedFailures: blindFails[r] || 0 })), kitsuneNoise: kclean, cleanPages: clean.length }, null, 1)
);
