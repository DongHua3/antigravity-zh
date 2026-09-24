/**
 * Tier 2: ASAR Engine & Boundary Verification Test Suite
 *
 * Verifies:
 * 1. Mock app.asar generation with sample files (package.json, menu.js, dummy files).
 * 2. Pure JS ASAR unpacking and repacking.
 * 3. Chromium Pickle 16-byte framing validation.
 * 4. SHA256 integrity block generation (empty files, single blocks, multi-4MB blocks).
 * 5. Byte-for-byte roundtrip fidelity and modification preservation.
 * 6. Adversarial input rejection (corrupt headers, truncated archives, bad magic).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { createTestContext } = require('./helpers/assert');
const mockAsar = require('./helpers/mock-asar');

/**
 * Recursively compares two directories for byte-for-byte identity.
 * @param {string} dirA
 * @param {string} dirB
 * @returns {{ identical: boolean, mismatches: string[] }}
 */
function compareDirectories(dirA, dirB) {
  const mismatches = [];

  function walkAndCompare(sub) {
    const curA = path.join(dirA, sub);
    const curB = path.join(dirB, sub);

    if (!fs.existsSync(curB)) {
      mismatches.push(`Missing in destination: ${sub}`);
      return;
    }

    const statA = fs.statSync(curA);
    const statB = fs.statSync(curB);

    if (statA.isDirectory()) {
      if (!statB.isDirectory()) {
        mismatches.push(`Type mismatch at ${sub}: expected directory`);
        return;
      }
      const children = fs.readdirSync(curA);
      for (const child of children) {
        walkAndCompare(path.join(sub, child));
      }
    } else if (statA.isFile()) {
      if (!statB.isFile()) {
        mismatches.push(`Type mismatch at ${sub}: expected file`);
        return;
      }
      const bufA = fs.readFileSync(curA);
      const bufB = fs.readFileSync(curB);
      if (!bufA.equals(bufB)) {
        mismatches.push(`Content mismatch at ${sub} (sizeA=${bufA.length}, sizeB=${bufB.length})`);
      }
    }
  }

  walkAndCompare('');
  return { identical: mismatches.length === 0, mismatches };
}

/**
 * Runs Tier 2 test suite.
 * @param {TestContext} [t] - Optional test context
 * @returns {TestContext}
 */
function runTier2(t = createTestContext()) {
  const projectRoot = path.resolve(__dirname, '..');
  const libAsarPath = path.join(projectRoot, 'lib', 'asar.js');
  const asarEngines = [{ name: 'Reference Mock ASAR Engine', module: mockAsar }];

  if (fs.existsSync(libAsarPath)) {
    try {
      const realAsar = require(libAsarPath);
      asarEngines.push({ name: 'Project lib/asar.js Engine', module: realAsar });
    } catch (err) {
      console.warn(`[Tier 2] Note: Failed to load lib/asar.js: ${err.message}`);
    }
  }

  t.describe('Tier 2: ASAR Engine & Boundary Verification', () => {
    // 1. SHA-256 Integrity Block Generation
    t.it('Generates valid SHA256 integrity block for empty (0-byte) file', () => {
      const emptyBuf = Buffer.alloc(0);
      const integrity = mockAsar.computeIntegrity(emptyBuf);

      t.strictEqual(integrity.algorithm, 'SHA256');
      t.strictEqual(integrity.blockSize, 4 * 1024 * 1024);
      t.strictEqual(integrity.blocks.length, 1);
      const expectedEmptyHash = crypto.createHash('sha256').update(emptyBuf).digest('hex');
      t.strictEqual(integrity.hash, expectedEmptyHash);
      t.strictEqual(integrity.blocks[0], expectedEmptyHash);
    });

    t.it('Generates multi-block SHA256 integrity for files exceeding 4MB', () => {
      // 4MB + 100KB buffer
      const size = 4 * 1024 * 1024 + 100 * 1024;
      const largeBuf = Buffer.alloc(size, 0x42);
      const integrity = mockAsar.computeIntegrity(largeBuf);

      t.strictEqual(integrity.blocks.length, 2, 'Should produce 2 blocks for 4.1MB file');
      t.strictEqual(
        integrity.blocks[0],
        crypto.createHash('sha256').update(largeBuf.subarray(0, 4 * 1024 * 1024)).digest('hex')
      );
      t.strictEqual(
        integrity.blocks[1],
        crypto.createHash('sha256').update(largeBuf.subarray(4 * 1024 * 1024)).digest('hex')
      );
      t.strictEqual(
        integrity.hash,
        crypto.createHash('sha256').update(largeBuf).digest('hex')
      );
    });

    // 2. Test each available ASAR engine
    for (const engine of asarEngines) {
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-asar-test-'));
      const srcDir = path.join(testDir, 'src');
      const asarPath = path.join(testDir, 'test.asar');
      const unpackedDir = path.join(testDir, 'unpacked');
      const repackedAsarPath = path.join(testDir, 'repacked.asar');
      const repackedUnpackedDir = path.join(testDir, 'repacked_unpacked');

      try {
        // Setup mock application files
        fs.mkdirSync(path.join(srcDir, 'dist', 'sub'), { recursive: true });

        const pkgContent = JSON.stringify({ name: 'antigravity-mock', version: '2.17.0', main: 'dist/main.js' });
        fs.writeFileSync(path.join(srcDir, 'package.json'), pkgContent, 'utf8');

        const menuContent = 'function setupApplicationMenu() { return { items: [] }; }\nmodule.exports = { setupApplicationMenu };';
        fs.writeFileSync(path.join(srcDir, 'dist', 'menu.js'), menuContent, 'utf8');

        fs.writeFileSync(path.join(srcDir, 'dist', 'sub', 'nested.txt'), 'nested file content 12345', 'utf8');
        fs.writeFileSync(path.join(srcDir, 'empty.txt'), Buffer.alloc(0));
        fs.writeFileSync(path.join(srcDir, 'unicode-中文测试.txt'), 'Antigravity 中文汉化自动化测试套件', 'utf8');

        // Add 4.2MB dummy file to test multi-block integrity in archive
        const chunk4M = Buffer.alloc(4 * 1024 * 1024 + 1024, 0x5a);
        fs.writeFileSync(path.join(srcDir, 'large.bin'), chunk4M);

        t.it(`[${engine.name}] Packs directory into ASAR archive`, () => {
          engine.module.createPackage(srcDir, asarPath);
          t.assert(fs.existsSync(asarPath), 'Target .asar file must exist');
          t.assert(fs.statSync(asarPath).size > 16, 'Archive must be larger than header');
        });

        t.it(`[${engine.name}] Validates 16-byte Chromium Pickle header framing`, () => {
          const { header, headerSize, rawHeaderBuf } = mockAsar.readArchiveHeader(asarPath);

          t.assert(header && typeof header.files === 'object', 'Header must have files object');
          t.assert(headerSize % 4 === 0, 'Header size must be 4-byte aligned');

          const fd = fs.openSync(asarPath, 'r');
          const prefix = Buffer.alloc(16);
          fs.readSync(fd, prefix, 0, 16, 0);
          fs.closeSync(fd);

          const u0 = prefix.readUInt32LE(0);
          const u1 = prefix.readUInt32LE(4);
          const u2 = prefix.readUInt32LE(8);
          const u3 = prefix.readUInt32LE(12);

          t.strictEqual(u0, 4, 'Magic uint32 tag must be 4');
          t.strictEqual(u1, u2 + 4, 'Outer payload size must be headerPickle + 4');
          const jsonLen = u3;
          const alignedLen = (jsonLen + 3) & ~3;
          t.strictEqual(u2, alignedLen + 4, 'Header pickle payload must be alignedLen + 4');
        });

        t.it(`[${engine.name}] Unpacks ASAR archive and verifies byte-for-byte fidelity`, () => {
          engine.module.extractAll(asarPath, unpackedDir);

          const cmp = compareDirectories(srcDir, unpackedDir);
          t.assert(cmp.identical, `Unpacked files must match original exactly. Mismatches: ${cmp.mismatches.join(', ')}`);
        });

        t.it(`[${engine.name}] Repacks modified files and preserves integrity`, () => {
          // Modify dist/menu.js in unpacked directory
          const patchedMenu = menuContent + '\n// Injected Chinese Localization Patch';
          fs.writeFileSync(path.join(unpackedDir, 'dist', 'menu.js'), patchedMenu, 'utf8');

          // Repack
          engine.module.createPackage(unpackedDir, repackedAsarPath);
          t.assert(fs.existsSync(repackedAsarPath), 'Repacked .asar must exist');

          // Unpack repacked
          engine.module.extractAll(repackedAsarPath, repackedUnpackedDir);

          // Verify modified file
          const readPatched = fs.readFileSync(path.join(repackedUnpackedDir, 'dist', 'menu.js'), 'utf8');
          t.strictEqual(readPatched, patchedMenu, 'Modified file in repacked ASAR must match patched content');

          // Verify untouched files
          const readPkg = fs.readFileSync(path.join(repackedUnpackedDir, 'package.json'), 'utf8');
          t.strictEqual(readPkg, pkgContent, 'Untouched files must remain identical');
        });
      } finally {
        try {
          fs.rmSync(testDir, { recursive: true, force: true });
        } catch (_) {}
      }
    }

    // 3. Adversarial / Error Handling Verification
    t.it('Adversarial: Throws on archive smaller than 16 bytes', () => {
      const corruptBuf = Buffer.alloc(10);
      t.throws(() => {
        mockAsar.readArchiveHeader(corruptBuf);
      }, /smaller than 16 bytes/i, 'Should reject undersized buffers');
    });

    t.it('Adversarial: Throws on invalid pickle magic uint32', () => {
      const corruptBuf = Buffer.alloc(32);
      corruptBuf.writeUInt32LE(999, 0); // Invalid magic
      t.throws(() => {
        mockAsar.readArchiveHeader(corruptBuf);
      }, /invalid pickle magic/i, 'Should reject invalid pickle magic');
    });

    t.it('Adversarial: Throws on corrupt header JSON string', () => {
      const corruptJson = '{ "files": { invalid json syntax...';
      const jsonBuf = Buffer.from(corruptJson, 'utf8');
      const jsonLen = jsonBuf.length;
      const aligned = (jsonLen + 3) & ~3;

      const corruptBuf = Buffer.alloc(16 + aligned);
      corruptBuf.writeUInt32LE(4, 0);
      corruptBuf.writeUInt32LE(aligned + 8, 4);
      corruptBuf.writeUInt32LE(aligned + 4, 8);
      corruptBuf.writeUInt32LE(jsonLen, 12);
      jsonBuf.copy(corruptBuf, 16);

      t.throws(() => {
        mockAsar.readArchiveHeader(corruptBuf);
      }, /corrupt asar header json/i, 'Should reject unparseable header JSON');
    });

    t.it('Adversarial: Throws on non-existent archive path', () => {
      t.throws(() => {
        mockAsar.readArchiveHeader('C:\\non_existent_antigravity_asar_file_123.asar');
      }, /not found/i, 'Should reject non-existent file path');
    });
  });

  return t;
}

if (require.main === module) {
  const t = runTier2();
  t.printSummary('Tier 2: ASAR Engine & Boundary Verification');
  process.exit(t.failedCount > 0 ? 1 : 0);
}

module.exports = {
  runTier2,
  compareDirectories
};
