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

## Notes

- Node 18+. Chromium comes from `playwright-core`, so the audit runs against a real rendering engine, not a DOM shim.
- `best_practices` defaults to true. Set it false for the legal floor only.
- The audit is read-only. It loads the page, runs the checks, and reports.

## License

MIT. Copyright (c) 2026 Kitsune Technologies LLC. Do what you like with it, commercially or otherwise, just keep the copyright notice. Full text in [LICENSE](LICENSE).
