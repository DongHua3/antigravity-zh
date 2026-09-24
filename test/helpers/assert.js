/**
 * Lightweight, zero-dependency test assertion and test runner helper.
 */

class TestContext {
  constructor() {
    this.currentSuite = 'Default Suite';
    this.tests = [];
    this.totalAssertions = 0;
    this.passedAssertions = 0;
    this.failedAssertions = 0;
    this.passedCount = 0;
    this.failedCount = 0;
    this.skippedCount = 0;
    this.failures = [];
  }

  describe(name, fn) {
    const prevSuite = this.currentSuite;
    this.currentSuite = name;
    try {
      fn();
    } finally {
      this.currentSuite = prevSuite;
    }
  }

  async describeAsync(name, fn) {
    const prevSuite = this.currentSuite;
    this.currentSuite = name;
    try {
      await fn();
    } finally {
      this.currentSuite = prevSuite;
    }
  }

  test(name, fn) {
    this.it(name, fn);
  }

  it(name, fn) {
    const fullName = `[${this.currentSuite}] ${name}`;
    try {
      fn();
      this.passedCount++;
      console.log(`  \x1b[32m✔\x1b[0m ${name}`);
    } catch (err) {
      this.failedCount++;
      console.error(`  \x1b[31m✘\x1b[0m ${name}`);
      console.error(`    \x1b[31m${err.message}\x1b[0m`);
      this.failures.push({ name: fullName, error: err });
    }
  }

  async itAsync(name, fn) {
    const fullName = `[${this.currentSuite}] ${name}`;
    try {
      await fn();
      this.passedCount++;
      console.log(`  \x1b[32m✔\x1b[0m ${name}`);
    } catch (err) {
      this.failedCount++;
      console.error(`  \x1b[31m✘\x1b[0m ${name}`);
      console.error(`    \x1b[31m${err.message}\x1b[0m`);
      this.failures.push({ name: fullName, error: err });
    }
  }

  skip(name, reason = 'Pending implementation') {
    this.skippedCount++;
    console.log(`  \x1b[33m-\x1b[0m ${name} \x1b[33m(skipped: ${reason})\x1b[0m`);
  }

  assert(condition, message) {
    this.totalAssertions++;
    if (!condition) {
      this.failedAssertions++;
      throw new Error(message || 'Assertion failed: condition is falsy');
    }
    this.passedAssertions++;
  }

  strictEqual(actual, expected, message) {
    this.totalAssertions++;
    if (actual !== expected) {
      this.failedAssertions++;
      throw new Error(
        message ||
          `Assertion failed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
      );
    }
    this.passedAssertions++;
  }

  notStrictEqual(actual, expected, message) {
    this.totalAssertions++;
    if (actual === expected) {
      this.failedAssertions++;
      throw new Error(
        message ||
          `Assertion failed: expected value not to equal ${JSON.stringify(expected)}`
      );
    }
    this.passedAssertions++;
  }

  deepStrictEqual(actual, expected, message) {
    this.totalAssertions++;
    const actStr = JSON.stringify(actual);
    const expStr = JSON.stringify(expected);
    if (actStr !== expStr) {
      this.failedAssertions++;
      throw new Error(
        message ||
          `Deep equality assertion failed:\nExpected: ${expStr}\nReceived: ${actStr}`
      );
    }
    this.passedAssertions++;
  }

  throws(fn, expectedRegexOrMessage, message) {
    this.totalAssertions++;
    let threw = false;
    let caughtErr = null;
    try {
      fn();
    } catch (err) {
      threw = true;
      caughtErr = err;
    }
    if (!threw) {
      this.failedAssertions++;
      throw new Error(message || 'Assertion failed: expected function to throw, but it did not');
    }
    if (expectedRegexOrMessage) {
      if (expectedRegexOrMessage instanceof RegExp) {
        if (!expectedRegexOrMessage.test(caughtErr.message)) {
          this.failedAssertions++;
          throw new Error(
            message ||
              `Assertion failed: error message "${caughtErr.message}" does not match regex ${expectedRegexOrMessage}`
          );
        }
      } else if (typeof expectedRegexOrMessage === 'string') {
        if (!caughtErr.message.includes(expectedRegexOrMessage)) {
          this.failedAssertions++;
          throw new Error(
            message ||
              `Assertion failed: error message "${caughtErr.message}" does not include "${expectedRegexOrMessage}"`
          );
        }
      }
    }
    this.passedAssertions++;
  }

  doesNotThrow(fn, message) {
    this.totalAssertions++;
    try {
      fn();
      this.passedAssertions++;
    } catch (err) {
      this.failedAssertions++;
      throw new Error(
        message ||
          `Assertion failed: expected function not to throw, but it threw: ${err.message}`
      );
    }
  }

  match(str, regex, message) {
    this.totalAssertions++;
    if (!regex.test(str)) {
      this.failedAssertions++;
      throw new Error(
        message ||
          `Assertion failed: "${str}" does not match regex ${regex}`
      );
    }
    this.passedAssertions++;
  }

  getSummary() {
    return {
      passed: this.passedCount,
      failed: this.failedCount,
      skipped: this.skippedCount,
      total: this.passedCount + this.failedCount + this.skippedCount,
      assertions: this.totalAssertions,
      passedAssertions: this.passedAssertions,
      failedAssertions: this.failedAssertions,
      failures: this.failures
    };
  }

  printSummary(title = 'Test Results') {
    console.log(`\n============================================================`);
    console.log(` ${title}`);
    console.log(`============================================================`);
    console.log(`  Tests Passed:   \x1b[32m${this.passedCount}\x1b[0m`);
    console.log(`  Tests Failed:   \x1b[${this.failedCount > 0 ? '31' : '32'}m${this.failedCount}\x1b[0m`);
    if (this.skippedCount > 0) {
      console.log(`  Tests Skipped:  \x1b[33m${this.skippedCount}\x1b[0m`);
    }
    console.log(`  Total Assertions: ${this.totalAssertions}`);
    if (this.failures.length > 0) {
      console.log(`\n  \x1b[31mFailures:\x1b[0m`);
      this.failures.forEach((f, idx) => {
        console.log(`    ${idx + 1}) ${f.name}: ${f.error.message}`);
      });
    }
    console.log(`============================================================\n`);
  }
}

module.exports = {
  TestContext,
  createTestContext: () => new TestContext()
};
