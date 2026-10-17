// Runs every e2e suite (two at a time, each with a time limit) and prints one summary.
// Usage: node tests/e2e/run.js [name ...]   e.g. node tests/e2e/run.js layout undo
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
const dir = new URL(".", import.meta.url).pathname;
const only = process.argv.slice(2);
const suites = readdirSync(dir).filter(f => f.endsWith(".e2e.js")).map(f => f.replace(".e2e.js", "")).filter(n => !only.length || only.includes(n)).sort();
const LIMIT = 240000, results = [];
const run = name => new Promise(res => {
  let out = "", timedOut = false;
  const p = spawn("node", [`${dir}${name}.e2e.js`], { cwd: dir + "../.." });
  const timer = setTimeout(() => { timedOut = true; p.kill("SIGKILL"); }, LIMIT);
  p.stdout.on("data", d => out += d); p.stderr.on("data", d => out += d);
  p.on("close", code => {
    clearTimeout(timer);
    const pass = (out.match(/^\s+PASS /gm) || []).length;
    const fails = out.split("\n").filter(l => /^\s+FAIL /.test(l));
    const crashed = !timedOut && code !== 0 && !fails.length;
    results.push({ name, pass, fails, timedOut, crashed, tail: crashed || timedOut ? out.trim().split("\n").slice(-3).join(" | ") : "" });
    console.log(`${fails.length || crashed ? "✗" : timedOut ? "…" : "✓"} ${name}: ${pass} passed, ${fails.length} failed${timedOut ? " (timed out)" : ""}${crashed ? " (crashed)" : ""}`);
    res();
  });
});
const queue = [...suites];
await Promise.all([0, 1].map(async () => { while (queue.length) await run(queue.shift()); }));
const bad = results.filter(r => r.fails.length || r.crashed);
for (const r of bad) { console.log(`\n${r.name}:`); r.fails.forEach(f => console.log("  " + f.trim())); if (r.tail) console.log("  " + r.tail); }
console.log(`\n${results.length} suites, ${results.reduce((s, r) => s + r.pass, 0)} checks passed, ${bad.length} suite(s) with failures, ${results.filter(r => r.timedOut).length} timed out`);
process.exit(bad.length ? 1 : 0);
