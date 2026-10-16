# Design tokens

One file decides how Insulin Buddy looks: `design/tokens.json`.

```
design/tokens.json  ──►  node tools/make-tokens.mjs  ──►  tokens.css               (the web app)
                                                     └──►  design/DesignTokens.swift (the native iOS app)
```

Never edit the two generated files by hand. A unit test (`tests/unit/tokens.test.js`) fails if they drift from the JSON.

## What is in it

| Group | Tokens | Used as |
|---|---|---|
| Colour | `ink`, `ink-soft`, `paper`, `surface`, `line`, `amber`, `brick`, `brick-soft`, `green` (light and dark sets) | `var(--ink)` … |
| Palettes | six accent sets, each `acc-1`, `acc-2`, `acc-3` | `var(--acc-1)`; `data-palette` picks the set |
| Radius | `xs` 8, `s` 10, `m` 16, `l` 22, `pill` | `var(--radius-m)` |
| Spacing | `3xs` 4, `2xs` 6, `xs` 8, `s` 10, `m` 12, `l` 16, `xl` 24 | `var(--space-m)` |
| Type | `2xs` 0.68rem … `body` 1rem, `h3`, `h2`, `h1` | `var(--fs-s)` |
| Motion | `fast`, `base`, `ease` | `var(--motion-base)` |
| Glass | light and dark sets plus the blur recipe | `var(--glass-bg)` … (web only) |

Hero numerals (the dose figure, insight totals: 1.5 to 2rem) are deliberately outside the type scale.

## Changing the look

1. Edit the value in `design/tokens.json`.
2. `node tools/make-tokens.mjs`
3. `node tools/make-diagnose.mjs`, then `npm test`.

A "redesign" is mostly this: new colours, a rounder or tighter radius scale, a different type scale. Structure changes (which screens exist) are separate and live in `index.html` and `app.js`.

## Guard rails

`tests/unit/tokens.test.js` also checks that every `var(--x)` used by the app is defined, and that `style.css` has no raw radius above a hairline or raw text size below 1.2rem. New CSS should use the tokens.

## For the iOS app

`design/DesignTokens.swift` has the same colours, palettes, radii, spacing and point sizes (1rem = 16pt). Liquid Glass is **not** exported: SwiftUI gets the real system material, so the CSS glass recipe is a web-only stand-in.

## Screens (since 2.43.0)

Three tabs: **Calculator**, **Insights** (Meals, Trends, Glucose), **Settings** (Dosing, Library, Sync, Data, General). The Calculator's **Browse** sheet picks from the library. Internally the Insights view is still `view-history` / `data-target="history"` so saved places, tests and links keep working.
