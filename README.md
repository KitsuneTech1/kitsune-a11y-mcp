<p align="center"><a href="https://kitsunetechnologies.org/work"><img src="https://raw.githubusercontent.com/KitsuneTech1/.github/main/assets/kitsune-banner.svg" alt="Built by Kitsune Technologies" width="760"></a></p>

# Kitsune a11y MCP

An accessibility audit desk your AI assistant can drive. Point it at a URL, get back every WCAG 2.2 violation grouped by impact, with fix hints.

It runs [axe-core](https://github.com/dequelabs/axe-core) in a real headless browser, so it sees the page your users actually get: JavaScript executed, styles applied, dynamic content rendered. Then it adds a second pass of checks that axe cannot do on its own.

The point is to make "is this accessible?" a question an agent can answer with a tool call instead of a guess.

## Tools

| Tool | What it does |
|---|---|
| `a11y_audit_url` | WCAG 2.2 audit of a live URL in a real browser. Returns violations sorted by impact (critical first) with the elements at fault and how to fix them. |
| `a11y_audit_html` | Same audit against a raw HTML string, for output you have not deployed yet. |
| `a11y_checklist` | Returns the standard the fixes have to meet: the WCAG 2.2 AA legal floor, plus 14 requirements above it. |

## Why the extra checks

Automated tools catch about a third of real accessibility problems. axe-core is the best of them and it still cannot tell you that your carousel has no pause button, or that your only way to reach the main content is tabbing through forty nav links.

So on top of axe, this checks for things a screen-reader user would immediately notice and a linter never will:

- a skip link near the top of the page
- a real `<main>` landmark
- a pause control on anything that moves on its own
- labels on inputs that actually associate with them

Everything critical or serious gets fixed before shipping. That is the rule this was built to enforce.

## Install

```bash
git clone https://github.com/KitsuneTech1/kitsune-a11y-mcp.git
cd kitsune-a11y-mcp && npm install
npx playwright install chromium
```

Register it with any MCP client. For Claude Code:

```bash
claude mcp add a11y -- node /path/to/kitsune-a11y-mcp/server.mjs
```

Then just ask: *"audit https://example.com for accessibility"*.

## Example

```
> a11y_audit_url https://example.com

2 axe violation rule(s) and 2 Kitsune check failure(s).
Fix every critical/serious before shipping.

MODERATE  meta-viewport        Zooming and scaling must not be disabled
                               user-scalable=no on <meta> disables zoom on mobile
MODERATE  region               All page content should be contained by landmarks

KITSUNE   no <main> landmark
KITSUNE   no skip link near top of page
```

## Measured accuracy

Most accessibility scanners tell you what they found. None of them tell you what they missed.
This one was measured against the [W3C ACT Rules test suite](https://www.w3.org/WAI/standards-guidelines/act/rules/):
1188 pages hand-authored by W3C across 87 official rules, each carrying an authoritative
verdict. 377 of them contain a known, labelled accessibility failure.

Scored per (page, rule) against W3C's answer key:

| | catches real failures | false alarms | precision |
|---|---|---|---|
| this tool (axe-core + the checks below) | **44.6%** | 0.6% | 97.1% |

Read that honestly. **It finds fewer than half of the accessibility failures W3C says are
on the page.** When it does complain it is almost always right (97% precision), but silence
from this tool is not evidence that a page is accessible.

The misses are not random. axe-core has **no check at all** for 37 of the 87 rules, and they
are all the same kind of thing: is the link text actually descriptive, does the alt text
actually describe the image, does the video actually have captions, does the accessible name
match the visible label. Those need judgement about meaning, and a static rule engine cannot
supply it. 137 of the 377 known failures live in that blind spot, and this tool catches
**zero** of them.

So: use it as a fast, high-precision filter for the machine-checkable half. Do not use it, or
any automated scanner, as proof of WCAG or ADA conformance. It is not a safe harbour, and
anyone selling you one is lying. `a11y_checklist` covers what still needs a human.

Reproduce the numbers yourself: the harness and the full per-rule breakdown are in
[`bench/`](bench/).

## Notes

- Node 18+. Chromium comes from `playwright-core`, so the audit runs against a real rendering engine, not a DOM shim.
- `best_practices` defaults to true. Set it false for the legal floor only.
- The audit is read-only. It loads the page, runs the checks, and reports.
- `npm test` runs the suite. Every test is a regression guard for a bug that shipped (see below).

## Tests

`npm test` drives the real MCP server over stdio and asserts against pages a real site would
have. Five of the ten cases fail on the version of this server released before 2026-07-14,
because that version:

- reported "no skip link" on any page whose skip link came after the logo and a couple of nav
  links, which is to say on almost every real site;
- reported every `<input type=submit|button|reset|image>` as an unlabelled form control, so
  any form with a submit button produced a fake violation;
- did not recognise `<button>Pause</button>` as a pause control, because it only looked for
  `aria-pressed` or an `aria-label`, and so falsely flagged carousels that were fine;
- crashed the **entire audit** on a legal `id` containing an apostrophe, because the id was
  interpolated raw into a CSS selector.

## License

MIT. Copyright (c) 2026 Kitsune Technologies LLC. Do what you like with it, commercially or otherwise, just keep the copyright notice. Full text in [LICENSE](LICENSE).
