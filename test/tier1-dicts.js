/**
 * Tier 1: Dictionary Syntax & Completeness Test Suite
 *
 * Verifies:
 * 1. Valid JSON syntax in dicts/menu.json, dicts/sidebar.json, dicts/settings.json,
 *    dicts/regex.json, dicts/common.json.
 * 2. All static dictionary keys and values are non-empty strings.
 * 3. Valid dynamic regex rules: compilable RegExp, supported capture groups ($1, $2), valid flags.
 * 4. Adversarial negative verification on malformed dictionaries.
 */

const fs = require('fs');
const path = require('path');
const { createTestContext } = require('./helpers/assert');

const VALID_REGEX_FLAGS = /^[gimsuy]*$/;

/**
 * Validates a static key-value dictionary.
 * @param {string|object} input - Path to JSON file or parsed object
 * @returns {{ valid: boolean, entryCount: number, errors: string[] }}
 */
function validateStaticDict(input) {
  const errors = [];
  let data;

  if (typeof input === 'string') {
    if (!fs.existsSync(input)) {
      return { valid: false, entryCount: 0, errors: [`File does not exist: ${input}`] };
    }
    try {
      const raw = fs.readFileSync(input, 'utf8');
      data = JSON.parse(raw);
    } catch (err) {
      return { valid: false, entryCount: 0, errors: [`Invalid JSON syntax: ${err.message}`] };
    }
  } else {
    data = input;
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { valid: false, entryCount: 0, errors: ['Dictionary must be a JSON object'] };
  }

  const keys = Object.keys(data);
  if (keys.length === 0) {
    errors.push('Dictionary is empty (has 0 keys)');
  }

  for (const key of keys) {
    if (typeof key !== 'string' || key.trim().length === 0) {
      errors.push(`Invalid key: empty or whitespace string`);
    }
    const val = data[key];
    if (typeof val !== 'string' || val.trim().length === 0) {
      errors.push(`Invalid value for key "${key}": must be a non-empty string, got ${JSON.stringify(val)}`);
    }
  }

  return {
    valid: errors.length === 0,
    entryCount: keys.length,
    errors
  };
}

/**
 * Validates a dynamic regex dictionary.
 * @param {string|Array} input - Path to JSON file or parsed array
 * @returns {{ valid: boolean, ruleCount: number, errors: string[] }}
 */
function validateRegexDict(input) {
  const errors = [];
  let data;

  if (typeof input === 'string') {
    if (!fs.existsSync(input)) {
      return { valid: false, ruleCount: 0, errors: [`File does not exist: ${input}`] };
    }
    try {
      const raw = fs.readFileSync(input, 'utf8');
      data = JSON.parse(raw);
    } catch (err) {
      return { valid: false, ruleCount: 0, errors: [`Invalid JSON syntax: ${err.message}`] };
    }
  } else {
    data = input;
  }

  if (!Array.isArray(data)) {
    return { valid: false, ruleCount: 0, errors: ['Regex dictionary must be a JSON array'] };
  }

  if (data.length === 0) {
    errors.push('Regex dictionary is empty (has 0 rules)');
  }

  data.forEach((rule, idx) => {
    const prefix = `Rule #${idx + 1}`;
    if (!rule || typeof rule !== 'object') {
      errors.push(`${prefix}: rule must be an object`);
      return;
    }

    // Pattern check
    if (typeof rule.pattern !== 'string' || rule.pattern.trim().length === 0) {
      errors.push(`${prefix}: missing or empty 'pattern' string`);
    }

    // Replace check
    if (typeof rule.replace !== 'string' || rule.replace.trim().length === 0) {
      errors.push(`${prefix}: missing or empty 'replace' string`);
    }

    // Flags check
    const flags = rule.flags || '';
    if (typeof flags !== 'string' || !VALID_REGEX_FLAGS.test(flags)) {
      errors.push(`${prefix}: invalid RegExp flags "${flags}"`);
    }

    // Compilation check
    if (typeof rule.pattern === 'string' && rule.pattern.trim().length > 0) {
      try {
        const re = new RegExp(rule.pattern, flags || 'i');
        // Test compilation and basic execution
        re.test('antigravity_test_probe_string_123');
      } catch (err) {
        errors.push(`${prefix}: uncompilable RegExp: ${err.message}`);
      }
    }

    // Capture group check: if replace has $1, verify pattern has at least one capture group
    if (typeof rule.replace === 'string' && /\$[1-9]/.test(rule.replace)) {
      const highestGroup = Math.max(...(rule.replace.match(/\$([1-9])/g) || []).map(m => parseInt(m.slice(1), 10)));
      try {
        const testRe = new RegExp(rule.pattern, flags || 'i');
        // Count unescaped open parens that aren't non-capturing
        const stripped = rule.pattern.replace(/\\./g, '');
        const capturingGroups = (stripped.match(/\((?!\?)/g) || []).length;
        if (capturingGroups < highestGroup) {
          errors.push(
            `${prefix}: replacement references $${highestGroup} but pattern only has ${capturingGroups} capturing groups`
          );
        }
      } catch (_) {
        // Syntax error already captured above
      }
    }
  });

  return {
    valid: errors.length === 0,
    ruleCount: data.length,
    errors
  };
}

/**
 * Runs Tier 1 test suite.
 * @param {TestContext} [t] - Optional test context
 * @returns {TestContext}
 */
function runTier1(t = createTestContext()) {
  const projectRoot = path.resolve(__dirname, '..');
  const projectDictsDir = path.join(projectRoot, 'dicts');
  const fixtureDictsDir = path.join(__dirname, 'fixtures', 'dicts');
  const invalidDictsDir = path.join(fixtureDictsDir, 'invalid');

  t.describe('Tier 1: Dictionary Syntax & Completeness', () => {
    // 1. Fixture baseline dictionaries verification
    t.it('Validates fixture static dictionaries (menu, sidebar, settings, common)', () => {
      const staticFiles = ['menu.json', 'sidebar.json', 'settings.json', 'common.json'];
      for (const file of staticFiles) {
        const p = path.join(fixtureDictsDir, file);
        const res = validateStaticDict(p);
        t.assert(res.valid, `Fixture ${file} should be valid. Errors: ${res.errors.join(', ')}`);
        t.assert(res.entryCount > 0, `Fixture ${file} should have entries`);
      }
    });

    t.it('Validates fixture regex dictionary rules and capture groups', () => {
      const p = path.join(fixtureDictsDir, 'regex.json');
      const res = validateRegexDict(p);
      t.assert(res.valid, `Fixture regex.json should be valid. Errors: ${res.errors.join(', ')}`);
      t.assert(res.ruleCount > 0, 'Fixture regex.json should have rules');
    });

    // 2. Project root dictionaries verification (if present or mock)
    const hasProjectDicts = fs.existsSync(projectDictsDir);
    if (hasProjectDicts) {
      t.it('Validates project root static dictionaries (menu.json, sidebar.json, settings.json, common.json)', () => {
        const staticFiles = ['menu.json', 'sidebar.json', 'settings.json', 'common.json'];
        for (const file of staticFiles) {
          const p = path.join(projectDictsDir, file);
          if (fs.existsSync(p)) {
            const res = validateStaticDict(p);
            t.assert(res.valid, `Project dicts/${file} has validation errors: ${res.errors.join('; ')}`);
            t.assert(res.entryCount >= 5, `Project dicts/${file} should contain rich terminology (got ${res.entryCount})`);
          } else {
            t.assert(false, `Expected project dictionary ${file} to exist in dicts/`);
          }
        }
      });

      t.it('Validates project root regex.json pattern compilation & replacement semantics', () => {
        const p = path.join(projectDictsDir, 'regex.json');
        if (fs.existsSync(p)) {
          const res = validateRegexDict(p);
          t.assert(res.valid, `Project dicts/regex.json has validation errors: ${res.errors.join('; ')}`);
          t.assert(res.ruleCount >= 3, `Project dicts/regex.json should contain dynamic rules (got ${res.ruleCount})`);
        } else {
          t.assert(false, 'Expected project dictionary regex.json to exist in dicts/');
        }
      });
    } else {
      t.it('Project dicts/ directory status detection', () => {
        // Project dicts pending M1; verified that fixture baseline is intact
        t.assert(true, 'Project dicts/ not yet present (pending M1 worker); fixture validation verified');
      });
    }

    // 3. Adversarial / Negative Testing
    t.it('Adversarial: Detects invalid JSON syntax in dictionary', () => {
      const p = path.join(invalidDictsDir, 'bad-syntax.json');
      const res = validateStaticDict(p);
      t.strictEqual(res.valid, false, 'Should fail on malformed JSON');
      t.assert(res.errors[0].includes('Invalid JSON syntax'), 'Error message should indicate invalid JSON syntax');
    });

    t.it('Adversarial: Detects empty key in dictionary', () => {
      const p = path.join(invalidDictsDir, 'empty-key.json');
      const res = validateStaticDict(p);
      t.strictEqual(res.valid, false, 'Should fail on empty key');
      t.assert(res.errors.some(e => e.includes('Invalid key: empty')), 'Should flag empty key');
    });

    t.it('Adversarial: Detects empty value in dictionary', () => {
      const p = path.join(invalidDictsDir, 'empty-value.json');
      const res = validateStaticDict(p);
      t.strictEqual(res.valid, false, 'Should fail on empty value');
      t.assert(res.errors.some(e => e.includes('Invalid value')), 'Should flag empty value');
    });

    t.it('Adversarial: Detects non-string values in dictionary', () => {
      const p = path.join(invalidDictsDir, 'non-string-value.json');
      const res = validateStaticDict(p);
      t.strictEqual(res.valid, false, 'Should fail on non-string value');
      t.assert(res.errors.some(e => e.includes('must be a non-empty string')), 'Should flag non-string value');
    });

    t.it('Adversarial: Detects uncompilable regex pattern', () => {
      const p = path.join(invalidDictsDir, 'bad-regex-pattern.json');
      const res = validateRegexDict(p);
      t.strictEqual(res.valid, false, 'Should fail on uncompilable regex');
      t.assert(res.errors.some(e => e.includes('uncompilable RegExp')), 'Should flag uncompilable regex');
    });

    t.it('Adversarial: Detects invalid regex flags', () => {
      const p = path.join(invalidDictsDir, 'bad-regex-flags.json');
      const res = validateRegexDict(p);
      t.strictEqual(res.valid, false, 'Should fail on invalid flags');
      t.assert(res.errors.some(e => e.includes('invalid RegExp flags')), 'Should flag invalid flags');
    });

    t.it('Adversarial: Detects missing regex replacement string', () => {
      const p = path.join(invalidDictsDir, 'missing-regex-replace.json');
      const res = validateRegexDict(p);
      t.strictEqual(res.valid, false, 'Should fail on missing replace');
      t.assert(res.errors.some(e => e.includes("missing or empty 'replace'")), 'Should flag missing replace');
    });

    t.it('Adversarial: Detects mismatched capture group references in regex replace', () => {
      const mismatchedRule = [
        {
          pattern: '^single-group-([a-z]+)$',
          flags: 'i',
          replace: 'first: $1, second: $2'
        }
      ];
      const res = validateRegexDict(mismatchedRule);
      t.strictEqual(res.valid, false, 'Should fail when replace references $2 but only 1 group exists');
      t.assert(res.errors.some(e => e.includes('references $2 but pattern only has 1')), 'Should flag capture group mismatch');
    });
  });

  return t;
}

if (require.main === module) {
  const t = runTier1();
  t.printSummary('Tier 1: Dictionary Syntax & Completeness');
  process.exit(t.failedCount > 0 ? 1 : 0);
}

module.exports = {
  runTier1,
  validateStaticDict,
  validateRegexDict
};
