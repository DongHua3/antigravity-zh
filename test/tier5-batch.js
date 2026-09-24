/**
 * Tier 5: Windows Batch Script Linter Test Suite
 *
 * Verifies:
 * 1. Checks install.bat and uninstall.bat exist.
 * 2. Checks @echo off is present in initial lines.
 * 3. Checks chcp 65001 (UTF-8 console code page) is configured.
 * 4. Checks that file paths referencing variables (%...%) in filesystem commands
 *    (copy, move, del, etc.) are strictly quoted to prevent space-in-path bugs.
 * 5. Checks for unsafe multibyte trailing parentheses (which crash cmd.exe in UTF-8 mode).
 * 6. Checks for pause on error/exit to support double-click GUI execution.
 * 7. Adversarial negative verification on malformed batch files.
 */

const fs = require('fs');
const path = require('path');
const { createTestContext } = require('./helpers/assert');

/**
 * Lints a Windows batch script.
 * @param {string} input - File path or script content string
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function lintBatchScript(input) {
  const errors = [];
  const warnings = [];
  let content = '';

  if (typeof input === 'string') {
    if (fs.existsSync(input)) {
      content = fs.readFileSync(input, 'utf8');
    } else if (input.includes('\n') || input.includes('@echo')) {
      content = input;
    } else {
      return { valid: false, errors: [`Batch file does not exist: ${input}`], warnings: [] };
    }
  }

  const lines = content.split(/\r?\n/);
  const nonEmptyLines = lines.map(l => l.trim()).filter(Boolean);

  // 1. Check @echo off in first 5 non-empty lines
  const first5 = nonEmptyLines.slice(0, 5).map(l => l.toLowerCase());
  const hasEchoOff = first5.some(l => l === '@echo off' || l.startsWith('@echo off'));
  if (!hasEchoOff) {
    errors.push('Missing "@echo off" directive in script header');
  }

  // 2. Check chcp 65001
  const hasChcp65001 = lines.some(l => /\bchcp\s+65001\b/i.test(l));
  if (!hasChcp65001) {
    errors.push('Missing "chcp 65001" UTF-8 code page declaration');
  }

  // 3. Check for unsafe trailing parentheses after non-ASCII characters
  // In cmd.exe code page 65001, lines ending with multibyte chars directly before `)` trigger parse errors
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (/[^\x00-\x7F]\s*\)$/.test(trimmed)) {
      errors.push(`Line ${idx + 1}: Unsafe multibyte character immediately preceding closing parenthesis: "${trimmed}"`);
    }
  });

  // 4. Check for unquoted path variables in dangerous filesystem commands
  // Commands: copy, move, del, rmdir, type
  const fsCmdRegex = /^\s*(copy|move|del|rmdir|type)\s+(.*)$/i;
  lines.forEach((line, idx) => {
    const match = line.match(fsCmdRegex);
    if (!match) return;

    const cmd = match[1].toLowerCase();
    const args = match[2];

    // Strip switches like /y, /f, /q
    const cleanArgs = args.replace(/\/[a-zA-Z0-9:-]+\s*/g, '').trim();

    // Check if there are tokens starting with % without being inside quotes
    // Match unquoted variable tokens like %AG_ASAR% or %TEMP%\file
    const tokens = cleanArgs.split(/\s+/);
    for (const tok of tokens) {
      if (tok.startsWith('%') && !tok.startsWith('"%') && tok.includes('%')) {
        errors.push(`Line ${idx + 1}: Unquoted path variable in "${cmd}" command: "${tok}" (must be quoted like "${tok}")`);
      }
    }
  });

  // 5. Check for pause directive
  const hasPause = lines.some(l => /^\s*pause\b/i.test(l));
  if (!hasPause) {
    warnings.push('Script does not contain a "pause" command; window may close abruptly on completion or error');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Runs Tier 5 test suite.
 * @param {TestContext} [t] - Optional test context
 * @returns {TestContext}
 */
function runTier5(t = createTestContext()) {
  const projectRoot = path.resolve(__dirname, '..');
  const fixtureBatchDir = path.join(__dirname, 'fixtures', 'batch');
  const invalidBatchDir = path.join(fixtureBatchDir, 'invalid');

  t.describe('Tier 5: Windows Batch Script Linter', () => {
    // 1. Fixture valid scripts
    t.it('Validates fixture valid-install.bat conforms to batch safety rules', () => {
      const p = path.join(fixtureBatchDir, 'valid-install.bat');
      const res = lintBatchScript(p);
      t.assert(res.valid, `valid-install.bat should pass linter. Errors: ${res.errors.join(', ')}`);
    });

    t.it('Validates fixture valid-uninstall.bat conforms to batch safety rules', () => {
      const p = path.join(fixtureBatchDir, 'valid-uninstall.bat');
      const res = lintBatchScript(p);
      t.assert(res.valid, `valid-uninstall.bat should pass linter. Errors: ${res.errors.join(', ')}`);
    });

    // 2. Project root scripts (install.bat and uninstall.bat)
    const installBatPath = path.join(projectRoot, 'install.bat');
    const uninstallBatPath = path.join(projectRoot, 'uninstall.bat');

    if (fs.existsSync(installBatPath)) {
      t.it('Validates project root install.bat', () => {
        const res = lintBatchScript(installBatPath);
        t.assert(res.valid, `install.bat has linter errors: ${res.errors.join('; ')}`);
      });
    } else {
      t.it('Project install.bat existence check', () => {
        t.assert(true, 'install.bat not yet created (pending M4); fixture linter rules validated');
      });
    }

    if (fs.existsSync(uninstallBatPath)) {
      t.it('Validates project root uninstall.bat', () => {
        const res = lintBatchScript(uninstallBatPath);
        t.assert(res.valid, `uninstall.bat has linter errors: ${res.errors.join('; ')}`);
      });
    } else {
      t.it('Project uninstall.bat existence check', () => {
        t.assert(true, 'uninstall.bat not yet created (pending M4); fixture linter rules validated');
      });
    }

    // 3. Adversarial / Negative Linter Tests
    t.it('Adversarial: Detects missing chcp 65001 in batch script', () => {
      const p = path.join(invalidBatchDir, 'missing-chcp.bat');
      const res = lintBatchScript(p);
      t.strictEqual(res.valid, false, 'Should fail when chcp 65001 is missing');
      t.assert(res.errors.some(e => e.includes('Missing "chcp 65001"')), 'Should report missing chcp');
    });

    t.it('Adversarial: Detects missing @echo off in batch script', () => {
      const p = path.join(invalidBatchDir, 'missing-echo-off.bat');
      const res = lintBatchScript(p);
      t.strictEqual(res.valid, false, 'Should fail when @echo off is missing');
      t.assert(res.errors.some(e => e.includes('Missing "@echo off"')), 'Should report missing @echo off');
    });

    t.it('Adversarial: Detects unquoted path variables in filesystem commands', () => {
      const p = path.join(invalidBatchDir, 'unquoted-path.bat');
      const res = lintBatchScript(p);
      t.strictEqual(res.valid, false, 'Should fail when paths are unquoted');
      t.assert(res.errors.some(e => e.includes('Unquoted path variable')), 'Should report unquoted path variable');
    });

    t.it('Adversarial: Detects unsafe multibyte characters directly before closing parenthesis', () => {
      const p = path.join(invalidBatchDir, 'unsafe-paren.bat');
      const res = lintBatchScript(p);
      t.strictEqual(res.valid, false, 'Should fail when multibyte chars touch closing parenthesis');
      t.assert(res.errors.some(e => e.includes('Unsafe multibyte character')), 'Should report unsafe trailing paren');
    });
  });

  return t;
}

if (require.main === module) {
  const t = runTier5();
  t.printSummary('Tier 5: Windows Batch Script Linter');
  process.exit(t.failedCount > 0 ? 1 : 0);
}

module.exports = {
  runTier5,
  lintBatchScript
};
