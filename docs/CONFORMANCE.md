# Conformance suite

`tests/conformance/*.json` records what the app's logic gives for a fixed set of inputs: 379 cases covering dosing, the glucose
model, merge and backup rules, the Nightscout payloads, the data contract and the food library. It is the specification of the
maths in executable form. **A Swift (or any other) port is correct when it reproduces every result.**

## Files
| File | Covers |
|---|---|
| `dose.json` | `planDose` (the one dose calculation) and the 38 hand-checked scenarios, the edit-sheet rules, the maximum-dose cap, rounding, unit conversion, decimal-comma parsing, the save guard, insulin and carbs on board |
| `glucose.json` | the "insulin alone" expected line, basal against your usual, carbs observed from readings, the projection, percentiles, time in range, estimated A1c |
| `state.json` | normalising saved data, the multi-device merge (stale device, deletes, edits, settings), change stamping, backup restore, the data-loss guard |
| `sync.json` | what is sent to Nightscout for each kind of entry (combined and split, basal as a Note), URL and token handling, glucose row conversion |
| `core.json` | the data contract validators, building a logged meal, basal checks, recipe totals, CSV and library import, time-of-day helpers |

## Format
Each file is a list of `{ "name", "fn", "args", "expect" }`.
* `fn` names a function in `tools/conformance-adapters.mjs`. Where the JavaScript function takes a `Date`, a callback or a `Map`, the
  adapter takes plain data instead (a clock time as `{ hour, minute }`, defaults as an object, ids from a counter). Read the adapter
  for the exact shape; it is a one-line wrapper.
* `args` is the argument list, as JSON. Times are epoch milliseconds in UTC (1 Oct 2026 12:00 UTC is the fixed "now").
* `expect` is the result as JSON. The numbers `NaN`, `Infinity` and `-Infinity` are written as those strings.
* A port should compare numbers with a small tolerance (relative 1e-9); everything else must match exactly. Doses are rounded to
  0.01 u inside the functions, so those compare exactly.
* Order of object keys does not matter. Order of lists does.

## How the suite stays honest
`tests/unit/conformance.test.js` fails if the code gives a different result for any case, **and** if the files on disk are not exactly
what the case list produces. So the files can't go stale and can't be edited by hand.

## When behaviour changes on purpose
1. Change the code. The conformance test fails and shows which results moved.
2. Run `node tools/make-conformance.mjs` and read the diff in `tests/conformance/`. Every changed number is a behaviour change.
3. Say so in the changelog. A change to a dose is a change to how doses are worked out: never "just update the snapshot".

## Adding cases
Add them to `tools/conformance-cases.mjs` (inputs only; the expected results are produced by running the real code), regenerate, and
read the new results as a sanity check before committing them.

## Not covered (and why)
Anything that depends on the device's time zone (grouping history by local day, the daily glucose pattern), because a fixed fixture
can't have one right answer; a port needs its own time-zone tests. Screens, and anything that talks to a network.
