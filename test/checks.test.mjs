// Layer 1 + 2: the Kitsune checks, driven through the REAL MCP server over stdio.
// Every one of these fixtures is a page a real site would actually have. Each one is a
// regression guard for a bug that shipped: see README "Measured accuracy".
//
//   node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function server() {
  const p = spawn("node", [join(ROOT, "server.mjs")], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
  const rl = createInterface({ input: p.stdout });
  const pending = new Map();
  rl.on("line", (l) => {
    let m; try { m = JSON.parse(l); } catch { return; }
    if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  let id = 0;
  const rpc = (method, params) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, res);
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
    setTimeout(() => pending.has(myId) && (pending.delete(myId), rej(new Error("timeout"))), 90000);
  });
  return { rpc, kill: () => p.kill() };
}

const MAIN = `<main id="content"><h1>Hello</h1></main>`;
const page = (body) => `<!doctype html><html lang="en"><head><title>Test</title></head><body>${body}</body></html>`;

let S;
const audit = async (body) => {
  S ??= (await (async () => { const s = server(); await s.rpc("initialize", { protocolVersion: "2025-06-18" }); return s; })());
  const res = await S.rpc("tools/call", { name: "a11y_audit_html", arguments: { html: page(body) } });
  const j = JSON.parse(res.result.content[0].text);
  assert.ok(!res.result.isError && !j.error, `audit errored: ${j.error ?? "isError"}`);
  return (j.kitsuneChecks || []).join(" | ").toLowerCase();
};

test("skip link is found even when it follows the logo and nav links", async () => {
  // A normal header puts the logo and a couple of nav links before the skip link.
  // The old check only looked at the first 3 <a> elements and cried wolf on every real site.
  const out = await audit(`<a href="/"><img src=x alt="Logo"></a><a href="/about">About</a>
    <a href="/pricing">Pricing</a><a href="#content">Skip to content</a>${MAIN}`);
  assert.doesNotMatch(out, /skip link/, "reported a missing skip link on a page that has one");
});

test("a page with genuinely no skip link is still flagged", async () => {
  const out = await audit(`<a href="/about">About</a>${MAIN}`);
  assert.match(out, /skip link/, "failed to flag a page with no skip link");
});

test("an anchor pointing at a target that does not exist is not a skip link", async () => {
  const out = await audit(`<a href="#nope">Broken</a>${MAIN}`);
  assert.match(out, /skip link/, "counted a dangling anchor as a valid skip link");
});

test("submit, button, reset and image inputs are not 'unlabelled'", async () => {
  // These are named by value/alt. WCAG does not want a <label> on them. The old check
  // flagged every one, so any form with a submit button produced a fake violation.
  const out = await audit(`<a href="#content">Skip</a>${MAIN}<form>
    <label for="q">Search</label><input id="q" type="text">
    <input type="submit" value="Search"><input type="button" value="Clear">
    <input type="reset" value="Reset"><input type="image" src="go.png" alt="Go"></form>`);
  assert.doesNotMatch(out, /unlabelled/, "flagged a button-type input as an unlabelled control");
});

test("a genuinely unlabelled text input is still flagged", async () => {
  const out = await audit(`<a href="#content">Skip</a>${MAIN}<form><input type="text" name="q"></form>`);
  assert.match(out, /unlabelled/, "failed to flag a truly unlabelled input");
});

test("an id containing a dot does not break the audit", async () => {
  const out = await audit(`<a href="#content">Skip</a>${MAIN}
    <form><label for="user.email">Email</label><input id="user.email" type="email"></form>`);
  assert.doesNotMatch(out, /unlabelled/, "labelled control reported as unlabelled");
});

test("an id containing an apostrophe does not crash the whole audit", async () => {
  // id="a'b" is legal HTML. The old code interpolated it raw into label[for='a'b'],
  // which threw a SyntaxError, rejected page.evaluate, and failed the ENTIRE scan.
  const out = await audit(`<a href="#content">Skip</a>${MAIN}
    <form><label for="a'b">Name</label><input id="a'b" type="text"></form>`);
  assert.doesNotMatch(out, /unlabelled/, "labelled control reported as unlabelled");
});

test("a real <button>Pause</button> counts as a pause control", async () => {
  // The old selector only matched aria-pressed or aria-label*='ause', so the single most
  // common form of pause button -- one with visible text -- was never found.
  const out = await audit(`<a href="#content">Skip</a>${MAIN}
    <style>@keyframes s{from{left:0}to{left:9px}}.c{animation:s 10s infinite;position:relative}</style>
    <div class="c">slide</div><button>Pause</button>`);
  assert.doesNotMatch(out, /pause control/, "reported a missing pause control on a page that has one");
});

test("an infinite animation with no pause control is still flagged", async () => {
  const out = await audit(`<a href="#content">Skip</a>${MAIN}
    <style>@keyframes s{from{left:0}to{left:9px}}.c{animation:s 10s infinite;position:relative}</style>
    <div class="c">slide</div>`);
  assert.match(out, /pause control/, "missed a real WCAG 2.2.2 violation");
});

test("axe still reports a real violation (image with no alt)", async () => {
  S ??= (await (async () => { const s = server(); await s.rpc("initialize", { protocolVersion: "2025-06-18" }); return s; })());
  const res = await S.rpc("tools/call", { name: "a11y_audit_html", arguments: { html: page(`${MAIN}<img src="x.png">`) } });
  const j = JSON.parse(res.result.content[0].text);
  assert.ok(j.axeViolations.some((v) => v.rule === "image-alt"), "axe did not flag an image with no alt");
  assert.equal(j.passed, false);
});

test.after(() => S?.kill());
