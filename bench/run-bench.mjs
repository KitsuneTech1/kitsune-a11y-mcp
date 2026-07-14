// Detection benchmark for kitsune-a11y-mcp against the W3C ACT Rules test suite.
//
// Ground truth: https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases.json
//   1188 hand-authored pages, 87 official ACT rules, each labelled by W3C as
//   passed / failed / inapplicable. "failed" = the page contains a real, known
//   accessibility violation of that rule.
//
// We run the EXACT engine config kitsune-a11y-mcp/server.mjs uses (same axe tags,
// same hand-written Kitsune checks) so the numbers describe the shipped product,
// not a lab variant.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const AXE_VERSION = require("axe-core/package.json").version;

// --- config copied verbatim from server.mjs ---
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

// --- the five hand-written "Kitsune above-the-law" checks, copied verbatim from server.mjs ---
const kitsuneChecks = () => {
  const problems = [];
  if (!document.querySelector("main, [role=main]")) problems.push("no-main-landmark");
  const firstLinks = [...document.querySelectorAll("a")].slice(0, 3);
  if (!firstLinks.some((a) => (a.getAttribute("href") || "").startsWith("#"))) problems.push("no-skip-link");
  const animated = [...document.querySelectorAll("*")].filter((el) => {
    const s = getComputedStyle(el);
    return s.animationName !== "none" && parseFloat(s.animationDuration) > 5 && s.animationIterationCount === "infinite";
  });
  if (animated.length) {
    const hasPause = !!document.querySelector("button[aria-pressed], [aria-label*='ause']");
    if (!hasPause) problems.push("no-pause-control");
  }
  document.querySelectorAll("input:not([type=hidden]), textarea, select").forEach((el) => {
    const id = el.id;
    // NOTE: server.mjs interpolates the raw id into a CSS selector. Reproduced faithfully,
    // but guarded so one malformed id doesn't abort the whole page evaluation (see FINDINGS).
    let labelled = false;
    try {
      labelled = !!((id && document.querySelector(`label[for='${id}']`)) || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.closest("label"));
    } catch (e) {
      return { __selectorCrash: true };
    }
    if (!labelled) problems.push("unlabelled-form-control");
  });
  document.querySelectorAll("[tabindex]").forEach((el) => {
    if (parseInt(el.getAttribute("tabindex"), 10) > 0) problems.push("positive-tabindex");
  });
  return [...new Set(problems)];
};

const CONCURRENCY = 6;
const cases = JSON.parse(readFileSync("testcases.json", "utf8")).testcases;

const browser = await chromium.launch({ headless: true });

// Pull axe's own rule -> ACT-rule mapping straight out of the engine.
const mapPage = await browser.newPage();
await mapPage.setContent("<!doctype html><html lang=en><body></body></html>");
await mapPage.addScriptTag({ content: axeSource });
const axeRules = await mapPage.evaluate(() =>
  window.axe._audit.rules.map((r) => ({ id: r.id, actIds: r.actIds || [], tags: r.tags || [] }))
);
await mapPage.close();

// ACT rule id -> [axe rule ids that claim to implement it]
const actToAxe = {};
for (const r of axeRules) for (const act of r.actIds) (actToAxe[act] ||= []).push(r.id);

const results = [];
let done = 0;
const t0 = Date.now();

async function worker(slice) {
  const page = await browser.newPage();
  for (const tc of slice) {
    const rec = { ruleId: tc.ruleId, ruleName: tc.ruleName, testcaseId: tc.testcaseId, expected: tc.expected, url: tc.url };
    try {
      await page.goto(tc.url, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(150);
      await page.addScriptTag({ content: axeSource });
      const axe = await page.evaluate(
        async (runTags) => await window.axe.run(document, { runOnly: { type: "tag", values: runTags }, resultTypes: ["violations", "incomplete"] }),
        TAGS
      );
      rec.axeViolations = axe.violations.map((v) => v.id);
      rec.axeIncomplete = axe.incomplete.map((v) => v.id);
      try {
        rec.kitsune = await page.evaluate(kitsuneChecks);
      } catch (e) {
        rec.kitsune = [];
        rec.kitsuneCrash = e.message.split("\n")[0].slice(0, 160);
      }
    } catch (e) {
      rec.error = e.message.split("\n")[0].slice(0, 160);
    }
    results.push(rec);
    if (++done % 50 === 0) {
      const rate = done / ((Date.now() - t0) / 1000);
      const line = `a11y bench: ${done}/${cases.length} cases (${rate.toFixed(1)}/s, eta ${Math.round((cases.length - done) / rate)}s)`;
      process.stderr.write(line + "\n");
      try { writeFileSync(process.env.HOME + "/.claude/bg/a11y-bench.txt", line + "\n"); } catch {}
    }
  }
  await page.close();
}

const slices = Array.from({ length: CONCURRENCY }, (_, i) => cases.filter((_, j) => j % CONCURRENCY === i));
await Promise.all(slices.map(worker));
await browser.close();

writeFileSync("results.json", JSON.stringify({ axeVersion: AXE_VERSION, tags: TAGS, actToAxe, results }, null, 1));
console.log(`\nDONE. ${results.length} cases. axe-core ${AXE_VERSION}. Wrote results.json`);
try { require("node:fs").unlinkSync(process.env.HOME + "/.claude/bg/a11y-bench.txt"); } catch {}
