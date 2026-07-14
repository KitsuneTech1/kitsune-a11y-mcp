# Accuracy benchmark

Measures this tool against the [W3C ACT Rules test suite](https://www.w3.org/WAI/standards-guidelines/act/rules/):
1188 pages hand-authored by W3C across 87 official accessibility rules, each carrying an
authoritative passed / failed / inapplicable verdict. 377 contain a known, labelled failure.

The point is to answer the question every scanner dodges: **what does it miss?**

## Method

`run-bench.mjs` loads every test page in a real browser and runs the exact engine
configuration `server.mjs` ships with, so the numbers describe the product, not a lab variant.

`score.mjs` compares the output to W3C's answer key, per (page, rule).

Scoring is per ACT rule, not "did the tool complain about anything". A W3C page marked
`passed` for rule X can still legitimately trip an unrelated axe rule, and counting that as a
false positive would be dishonest in both directions. So for ACT rule R we only look at the
axe rules that axe-core itself declares implement R, via its `actIds` metadata.

## Run it

```bash
npm install
curl -O https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases.json
node run-bench.mjs   # loads 1188 pages, writes results.json
node score.mjs       # writes FINDINGS.txt
```

w3.org rate-limits bulk fetching. If you get HTTP 429, the same test pages are in
`w3c/wcag-act-rules` under `content-assets/wcag-act-rules/testcases/`.

## Result

Committed in `FINDINGS.txt`. Headline: **44.6% of known real failures caught, 0.6% false
alarm rate, 97.1% precision.** axe-core has no check whatsoever for 37 of the 87 rules, and
137 of the 377 known failures live in that blind spot.
