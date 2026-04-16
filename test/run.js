// 304 test runner. Zero external deps.
// Requires each `*.test.js` file in this directory in alphabetical order.
// Each test file may either (a) run its assertions synchronously at require
// time via helpers.ok(), or (b) export `run` returning a Promise that does
// so. Prints a summary and exits non-zero on any failure.

const fs = require('node:fs');
const path = require('node:path');
const helpers = require('./helpers');

const DIR = __dirname;
const SELF = path.basename(__filename);

const files = fs.readdirSync(DIR)
  .filter((f) => f.endsWith('.test.js'))
  .filter((f) => f !== SELF && f !== 'helpers.js')
  .sort();

const t0 = Date.now();
let totalPassed = 0;
let totalFailed = 0;
const fileFailures = [];

(async () => {
  for (const file of files) {
    process.stdout.write(`\u25b6 ${file}\n`);
    helpers.resetCounts();
    try {
      const mod = require(path.join(DIR, file));
      if (mod && typeof mod.run === 'function') {
        await mod.run();
      }
    } catch (err) {
      process.stdout.write(`  \x1b[31m\u2717 module load failed\x1b[0m\n`);
      process.stdout.write(`      ${err && err.stack ? err.stack : String(err)}\n`);
      totalFailed += 1;
      fileFailures.push({ file, err });
      continue;
    }
    const s = helpers.summary();
    totalPassed += s.passed;
    totalFailed += s.failed;
    if (s.failed) fileFailures.push({ file, count: s.failed });
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  const color = totalFailed ? '\x1b[31m' : '\x1b[32m';
  process.stdout.write(`\n${color}SUMMARY: ${totalPassed} passed, ${totalFailed} failed in ${dt}s\x1b[0m\n`);

  if (totalFailed) process.exit(1);
  process.exit(0);
})();
