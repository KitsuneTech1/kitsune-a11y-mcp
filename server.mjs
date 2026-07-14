// kitsune-a11y-mcp: stdio MCP server for accessibility audits.
// Tools: a11y_audit_url (axe-core WCAG 2.2 scan in a real browser),
//        a11y_audit_html (same, for raw HTML), a11y_checklist (the standard).
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const CHECKLIST = `KITSUNE ACCESSIBILITY STANDARD (applies to every public website; the law is the floor, this is the spec)

Legal floor: WCAG 2.2 Level AA on every page (ADA Title III / EAA alignment).
Above the floor, all REQUIRED:
1. Skip link to main content on every page; <main> landmark; nav has aria-label.
2. Full keyboard operation: every interactive element reachable and operable, visible :focus-visible ring, Escape closes overlays, focus returns to the opener.
3. Nothing moves that can't be stopped: any auto-scrolling/animating content gets a pause control AND honors prefers-reduced-motion AND screen readers get a static text equivalent.
4. No hover-only information: tooltips also open on focus, dismiss with Escape (WCAG 1.4.13).
5. Modals: role="dialog", aria-modal, aria-labelledby, focus moves in on open.
6. Every input has a real <label> (visually-hidden is fine); status messages use role="status"/aria-live.
7. Charts/canvas/images of data carry text alternatives updated WITH the data, not static alt text.
8. Contrast: AA minimum everywhere, plus a prefers-contrast: more override that pushes toward AAA.
9. No positive tabindex, no title-attribute-as-tooltip, no placeholder-as-label.
10. Target size: interactive targets 24px minimum (WCAG 2.5.8).
11. Emoji/decoration: aria-hidden on decorative glyphs; informative emoji get text.
12. If the product has an API, state in an accessibility statement that the full product is drivable as text through it.
13. Ship an /accessibility page: commitments, known gaps (honestly listed), contact, fix SLA.
14. Audit every release: run a11y_audit_url on each page, fix every serious/critical, document any moderate you defer.`;

const TOOLS = [
  {
    name: "a11y_audit_url",
    description: "Run a WCAG 2.2 accessibility audit (axe-core) against a live URL in a real headless browser, plus Kitsune above-the-law checks (skip link, main landmark, pause control for animations, labels). Returns violations grouped by impact with fix hints.",
    inputSchema: { type: "object", properties: { url: { type: "string", description: "Full URL, e.g. http://localhost:8890/" }, best_practices: { type: "boolean", description: "Also include axe best-practice rules (default true)" } }, required: ["url"] },
  },
  {
    name: "a11y_audit_html",
    description: "Audit a raw HTML string the same way as a11y_audit_url (rendered in a real browser).",
    inputSchema: { type: "object", properties: { html: { type: "string" } }, required: ["html"] },
  },
  {
    name: "a11y_checklist",
    description: "Return the Kitsune accessibility standard: the WCAG 2.2 AA legal floor plus the 14 above-the-law requirements every public website must ship with.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function launchBrowser() {
  const { chromium } = await import("playwright-core");
  const errors = [];
  for (const channel of ["msedge", "chrome"]) {
    try { return await chromium.launch({ channel, headless: true }); }
    catch (e) { errors.push(`${channel}: ${e.message.split("\n")[0]}`); }
  }
  try { return await chromium.launch({ headless: true }); }
  catch (e) { errors.push(`bundled: ${e.message.split("\n")[0]}`); }
  throw new Error("No browser available. Tried Edge, Chrome, bundled. " + errors.join(" | "));
}

async function audit({ url, html, best_practices = true }) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    if (html != null) await page.setContent(html, { waitUntil: "load" });
    else await page.goto(url, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(800);
    await page.addScriptTag({ content: axeSource });
    const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
    if (best_practices) tags.push("best-practice");
    const axe = await page.evaluate(async (runTags) => {
      return await window.axe.run(document, { runOnly: { type: "tag", values: runTags }, resultTypes: ["violations", "incomplete"] });
    }, tags);

    // Kitsune above-the-law checks
    const extra = await page.evaluate(() => {
      const problems = [];
      if (!document.querySelector("main, [role=main]")) problems.push("no <main> landmark");

      // A skip link has to be early in the TAB ORDER, not literally the first <a> in the DOM.
      // A normal header is logo link, a couple of nav links, then the skip link. Look at the
      // first handful of links and require the target to actually exist on the page.
      const links = [...document.querySelectorAll("a[href]")].slice(0, 6);
      const isSkip = (a) => {
        const href = a.getAttribute("href") || "";
        if (!href.startsWith("#") || href === "#") return false;
        try { return !!document.getElementById(decodeURIComponent(href.slice(1))); } catch { return false; }
      };
      if (!links.some(isSkip)) problems.push("no skip link near top of page");

      const animated = [...document.querySelectorAll("*")].filter(el => {
        const s = getComputedStyle(el);
        return s.animationName !== "none" && parseFloat(s.animationDuration) > 5 && s.animationIterationCount === "infinite";
      });
      if (animated.length) {
        // A pause control is a button whose NAME says pause/stop, however that name is supplied.
        // The old selector only matched aria-pressed or an aria-label, so a plain
        // <button>Pause</button> (the most common form there is) was never found.
        const controls = [...document.querySelectorAll("button, [role=button], input[type=button], input[type=submit], a[href]")];
        const nameOf = (el) => [el.getAttribute("aria-label"), el.getAttribute("title"), el.value, el.textContent].filter(Boolean).join(" ");
        const hasPause = controls.some(el => /\b(pause|stop|freeze|disable animation)\b/i.test(nameOf(el)));
        if (!hasPause) problems.push(`${animated.length} infinite animation(s) longer than 5s with no visible pause control (WCAG 2.2.2)`);
      }

      // Buttons carry their own name (value / alt), and WCAG does not want a <label> on them.
      // Flagging them produced a fake violation on every form that has a submit button.
      const NO_LABEL_NEEDED = new Set(["hidden", "submit", "button", "reset", "image"]);
      document.querySelectorAll("input, textarea, select").forEach(el => {
        if (el.tagName === "INPUT" && NO_LABEL_NEEDED.has((el.type || "").toLowerCase())) return;
        if (el.closest("[aria-hidden=true]") || el.hidden) return;
        // el.labels is the native association. It needs no CSS selector, so an id like
        // "user.email" or "a'b" can no longer throw and take the whole audit down with it.
        const labelled =
          (el.labels && el.labels.length > 0) ||
          el.getAttribute("aria-label") ||
          el.getAttribute("aria-labelledby") ||
          el.closest("label") ||
          (el.getAttribute("title") || "").trim();
        if (!labelled) problems.push(`unlabelled form control: ${el.outerHTML.slice(0, 80)}`);
      });

      document.querySelectorAll("[tabindex]").forEach(el => {
        if (parseInt(el.getAttribute("tabindex"), 10) > 0) problems.push(`positive tabindex on ${el.tagName.toLowerCase()}`);
      });
      return problems;
    });

    const fmt = (v) => ({
      rule: v.id,
      impact: v.impact,
      wcag: v.tags.filter(t => /^wcag\d/.test(t)),
      summary: v.help,
      howToFix: v.nodes[0]?.failureSummary?.replace(/\s+/g, " ").slice(0, 300) ?? v.helpUrl,
      instances: v.nodes.length,
      sampleTargets: v.nodes.slice(0, 3).map(n => n.target.join(" ")),
    });
    const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    const violations = axe.violations.map(fmt).sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9));
    return {
      target: url ?? "(inline html)",
      passed: violations.length === 0 && extra.length === 0,
      axeViolations: violations,
      needsManualReview: axe.incomplete.length,
      kitsuneChecks: extra.length ? extra : ["all Kitsune above-the-law checks passed"],
      verdict: violations.length === 0 && extra.length === 0
        ? "Clean. WCAG 2.2 AA automated pass plus Kitsune standard. Do a manual keyboard + screen reader pass before calling it done."
        : `${violations.length} axe violation rule(s) and ${extra.length} Kitsune check failure(s). Fix every critical/serious before shipping.`,
    };
  } finally {
    await browser.close();
  }
}

// ---- stdio MCP plumbing (newline-delimited JSON-RPC) ----
const out = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  const reply = (result) => out({ jsonrpc: "2.0", id: m.id, result });
  const fail = (code, message) => out({ jsonrpc: "2.0", id: m.id ?? null, error: { code, message } });
  try {
    switch (m.method) {
      case "initialize":
        return reply({
          protocolVersion: m.params?.protocolVersion || "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "kitsune-a11y", version: "1.0.0" },
          instructions: "Accessibility audit desk. Run a11y_audit_url on every page of every public website before shipping; consult a11y_checklist for the standard the fixes must meet.",
        });
      case "notifications/initialized": return; // no response to notifications
      case "ping": return reply({});
      case "tools/list": return reply({ tools: TOOLS });
      case "tools/call": {
        const { name, arguments: args = {} } = m.params || {};
        if (name === "a11y_checklist") return reply({ content: [{ type: "text", text: CHECKLIST }], isError: false });
        if (name === "a11y_audit_url" || name === "a11y_audit_html") {
          try {
            const r = await audit(name === "a11y_audit_url" ? { url: args.url, best_practices: args.best_practices } : { html: args.html });
            return reply({ content: [{ type: "text", text: JSON.stringify(r, null, 1) }], isError: false });
          } catch (e) {
            return reply({ content: [{ type: "text", text: JSON.stringify({ error: e.message }) }], isError: true });
          }
        }
        return fail(-32602, `unknown tool ${name}`);
      }
      default:
        if (m.id !== undefined) return fail(-32601, `method not found: ${m.method}`);
    }
  } catch (e) { fail(-32603, e.message); }
});
