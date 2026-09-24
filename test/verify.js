#!/usr/bin/env node
/**
 * Master Verification Test Suite for antigravity-zh
 *
 * Self-contained, zero-dependency test runner executing Tiers 1 through 5:
 *   Tier 1: Dictionary Syntax & Completeness
 *   Tier 2: Pure JS ASAR Engine & Boundary Verification
 *   Tier 3: Runtime DOM Translation & Code Skipping Simulation
 *   Tier 4: Chinese IME Input Session Protection
 *   Tier 5: Windows Batch Script Safety Linter
 *
 * Usage:
 *   node test/verify.js
 *   node test/verify.js --tier=1|2|3|4|5
 */

const path = require('path');
const { createTestContext } = require('./helpers/assert');

const { runTier1 } = require('./tier1-dicts');
const { runTier2 } = require('./tier2-asar');
const { runTier3 } = require('./tier3-dom');
const { runTier4 } = require('./tier4-ime');
const { runTier5 } = require('./tier5-batch');

async function main() {
  const args = process.argv.slice(2);
  const tierArg = args.find(a => a.startsWith('--tier='));
  const selectedTier = tierArg ? parseInt(tierArg.split('=')[1], 10) : null;

  console.log(`\n============================================================`);
  console.log(` antigravity-zh Master Automated Test Suite`);
  console.log(` Execution Mode: ${selectedTier ? `Tier ${selectedTier} Only` : 'Full Suite (Tiers 1-5)'}`);
  console.log(`============================================================\n`);

  const t = createTestContext();
  const startTime = Date.now();

  const tierRunners = [
    { tier: 1, name: 'Tier 1: Dictionary Syntax & Completeness', fn: () => runTier1(t) },
    { tier: 2, name: 'Tier 2: Pure JS ASAR Engine & Boundary Verification', fn: () => runTier2(t) },
    { tier: 3, name: 'Tier 3: Runtime DOM Translation & Code Skipping', fn: () => runTier3(t) },
    { tier: 4, name: 'Tier 4: Chinese IME Composition Protection', fn: () => runTier4(t) },
    { tier: 5, name: 'Tier 5: Windows Batch Script Safety Linter', fn: () => runTier5(t) }
  ];

  for (const runner of tierRunners) {
    if (selectedTier && selectedTier !== runner.tier) {
      continue;
    }
    console.log(`\n>>> Executing [${runner.name}]`);
    try {
      await runner.fn();
    } catch (err) {
      t.failedCount++;
      t.failures.push({ name: runner.name, error: err });
      console.error(`  \x1b[31mCritical error executing ${runner.name}: ${err.message}\x1b[0m`);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const summary = t.getSummary();

  console.log(`\n============================================================`);
  console.log(` Test Execution Summary (${duration}s)`);
  console.log(`============================================================`);
  console.log(`  Total Tests Run:     ${summary.total}`);
  console.log(`  Tests Passed:        \x1b[32m${summary.passed}\x1b[0m`);
  console.log(`  Tests Failed:        \x1b[${summary.failed > 0 ? '31' : '32'}m${summary.failed}\x1b[0m`);
  if (summary.skipped > 0) {
    console.log(`  Tests Skipped:       \x1b[33m${summary.skipped}\x1b[0m`);
  }
  console.log(`  Total Assertions:    ${summary.assertions} (${summary.passedAssertions} passed, ${summary.failedAssertions} failed)`);

  if (summary.failures.length > 0) {
    console.log(`\n\x1b[31mFailure Details:\x1b[0m`);
    summary.failures.forEach((f, i) => {
      console.log(`  ${i + 1}. ${f.name}`);
      console.log(`     Error: ${f.error.message}`);
      if (f.error.stack) {
        console.log(`     Stack: ${f.error.stack.split('\n').slice(1, 3).join('\n')}`);
      }
    });
  }

  console.log(`============================================================`);
  const statusLine = summary.failed === 0
    ? '\x1b[32m✔ ALL VERIFICATION TESTS PASSED SUCCESSFULLY\x1b[0m'
    : `\x1b[31m✘ VERIFICATION SUITE FAILED WITH ${summary.failed} FAILURE(S)\x1b[0m`;
  console.log(` ${statusLine}`);
  console.log(`============================================================\n`);

  process.exit(summary.failed > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal runner error:', err);
    process.exit(1);
  });
}

module.exports = { main };
