'use strict';

/**
 * test/adversarial-stress.js
 *
 * Comprehensive Empirical Adversarial Stress Test Suite (Challenger 1)
 *
 * Targets:
 * 1. Corrupt ASAR Header Stress Testing (lib/asar.js)
 * 2. Boundary & Edge Case Archive Testing (lib/asar.js)
 * 3. End-to-End Patcher Simulation & CLI Robustness (lib/patcher.js, scripts/patch.js)
 * 4. Adversarial Security Fuzzing (Directory Traversal / Path Escapes)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const asar = require('../lib/asar');
const { patchAsar, patchDirectory } = require('../lib/patcher');

const RESULTS = {
  passed: 0,
  failed: 0,
  findings: []
};

function record(section, name, passed, detail = null) {
  if (passed) {
    RESULTS.passed++;
    console.log(`  \x1b[32m✔ [PASS]\x1b[0m ${name}`);
  } else {
    RESULTS.failed++;
    console.log(`  \x1b[31m✘ [FAIL/FINDING]\x1b[0m ${name}${detail ? `\n      -> Detail: ${detail}` : ''}`);
    RESULTS.findings.push({ section, name, detail });
  }
}

function computeSha256(filePathOrBuf) {
  const buf = Buffer.isBuffer(filePathOrBuf) ? filePathOrBuf : fs.readFileSync(filePathOrBuf);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function compareDirs(dirA, dirB) {
  const mismatches = [];
  function walk(sub) {
    const curA = path.join(dirA, sub);
    const curB = path.join(dirB, sub);
    if (!fs.existsSync(curB)) {
      mismatches.push(`Missing in dest: ${sub}`);
      return;
    }
    const statA = fs.statSync(curA);
    const statB = fs.statSync(curB);
    if (statA.isDirectory()) {
      if (!statB.isDirectory()) {
        mismatches.push(`Type mismatch at ${sub}`);
        return;
      }
      for (const f of fs.readdirSync(curA)) {
        walk(path.join(sub, f));
      }
    } else {
      if (!statB.isFile()) {
        mismatches.push(`Type mismatch at ${sub}`);
        return;
      }
      const hA = computeSha256(curA);
      const hB = computeSha256(curB);
      if (hA !== hB) {
        mismatches.push(`Hash mismatch at ${sub}`);
      }
    }
  }
  walk('');
  return mismatches;
}

// =========================================================================
// SECTION 1: Corrupt ASAR Header Stress Tests
// =========================================================================
function runCorruptHeaderTests() {
  console.log('\n============================================================');
  console.log(' SECTION 1: Corrupt ASAR Header Stress Tests');
  console.log('============================================================\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-corrupt-'));

  try {
    // 1.1 Non-existent file
    try {
      asar.readArchiveHeader(path.join(tmpDir, 'does-not-exist.asar'));
      record(1, 'Rejects non-existent file path cleanly', false, 'Did not throw');
    } catch (err) {
      record(1, 'Rejects non-existent file path cleanly', err.code === 'ENOENT' || /no such file/i.test(err.message));
    }

    // 1.2 Truncated files: 0, 1, 4, 8, 15 bytes
    const truncatedSizes = [0, 1, 4, 8, 15];
    for (const size of truncatedSizes) {
      const p = path.join(tmpDir, `trunc-${size}.asar`);
      fs.writeFileSync(p, Buffer.alloc(size));
      try {
        asar.readArchiveHeader(p);
        record(1, `Rejects truncated archive of ${size} bytes`, false, 'Did not throw');
      } catch (err) {
        record(1, `Rejects truncated archive of ${size} bytes`, /header too short/i.test(err.message));
      }
    }

    // 1.3 Invalid Pickle Magic Tags
    const badMagicTags = [0, 1, 3, 5, 255, 0xDEADBEEF];
    for (const tag of badMagicTags) {
      const p = path.join(tmpDir, `magic-${tag}.asar`);
      const buf = Buffer.alloc(32);
      buf.writeUInt32LE(tag, 0);
      fs.writeFileSync(p, buf);
      try {
        asar.readArchiveHeader(p);
        record(1, `Rejects invalid pickle magic tag (${tag})`, false, 'Did not throw');
      } catch (err) {
        record(1, `Rejects invalid pickle magic tag (${tag})`, /invalid pickle magic tag/i.test(err.message));
      }
    }

    // 1.4 Invalid JSON Length (0 bytes)
    {
      const p = path.join(tmpDir, 'json-len-0.asar');
      const buf = Buffer.alloc(32);
      buf.writeUInt32LE(4, 0);
      buf.writeUInt32LE(16, 4);
      buf.writeUInt32LE(12, 8);
      buf.writeUInt32LE(0, 12);
      fs.writeFileSync(p, buf);
      try {
        asar.readArchiveHeader(p);
        record(1, 'Rejects jsonLen = 0 with informative error', false, 'Did not throw');
      } catch (err) {
        record(1, 'Rejects jsonLen = 0 with informative error', /invalid asar json header length/i.test(err.message));
      }
    }

    // 1.5 Invalid JSON Length (> 100MB)
    {
      const p = path.join(tmpDir, 'json-len-huge.asar');
      const buf = Buffer.alloc(32);
      buf.writeUInt32LE(4, 0);
      buf.writeUInt32LE(150 * 1024 * 1024 + 8, 4);
      buf.writeUInt32LE(150 * 1024 * 1024 + 4, 8);
      buf.writeUInt32LE(150 * 1024 * 1024, 12);
      fs.writeFileSync(p, buf);
      try {
        asar.readArchiveHeader(p);
        record(1, 'Rejects jsonLen > 100MB cleanly without OOM', false, 'Did not throw');
      } catch (err) {
        record(1, 'Rejects jsonLen > 100MB cleanly without OOM', /invalid asar json header length/i.test(err.message));
      }
    }

    // 1.6 Truncated JSON Body
    {
      const p = path.join(tmpDir, 'json-trunc-body.asar');
      const buf = Buffer.alloc(40);
      buf.writeUInt32LE(4, 0);
      buf.writeUInt32LE(1032, 4);
      buf.writeUInt32LE(1028, 8);
      buf.writeUInt32LE(1024, 12);
      fs.writeFileSync(p, buf);
      try {
        asar.readArchiveHeader(p);
        record(1, 'Rejects EOF during JSON header reading cleanly', false, 'Did not throw');
      } catch (err) {
        record(1, 'Rejects EOF during JSON header reading cleanly', /unexpected end of file/i.test(err.message));
      }
    }

    // 1.7 Malformed JSON Syntax
    {
      const p = path.join(tmpDir, 'json-bad-syntax.asar');
      const corruptJson = '{"files": {"broken": ';
      const jsonBuf = Buffer.from(corruptJson, 'utf8');
      const jsonLen = jsonBuf.length;
      const aligned = (jsonLen + 3) & ~3;
      const buf = Buffer.alloc(16 + aligned);
      buf.writeUInt32LE(4, 0);
      buf.writeUInt32LE(aligned + 8, 4);
      buf.writeUInt32LE(aligned + 4, 8);
      buf.writeUInt32LE(jsonLen, 12);
      jsonBuf.copy(buf, 16);
      fs.writeFileSync(p, buf);
      try {
        asar.readArchiveHeader(p);
        record(1, 'Throws on malformed JSON syntax without crash or hang', false, 'Did not throw');
      } catch (err) {
        record(1, 'Throws on malformed JSON syntax without crash or hang', err instanceof SyntaxError || /json/i.test(err.message));
      }
    }

    // 1.8 Valid JSON but primitive (null, number, string, array)
    const primitives = ['null', '12345', '"hello"', '[]'];
    for (const prim of primitives) {
      const p = path.join(tmpDir, `json-prim-${prim.replace(/"/g, '')}.asar`);
      const jsonBuf = Buffer.from(prim, 'utf8');
      const jsonLen = jsonBuf.length;
      const aligned = (jsonLen + 3) & ~3;
      const buf = Buffer.alloc(16 + aligned);
      buf.writeUInt32LE(4, 0);
      buf.writeUInt32LE(aligned + 8, 4);
      buf.writeUInt32LE(aligned + 4, 8);
      buf.writeUInt32LE(jsonLen, 12);
      jsonBuf.copy(buf, 16);
      fs.writeFileSync(p, buf);

      const outDir = path.join(tmpDir, `out-prim-${prim.replace(/"/g, '')}`);
      try {
        asar.extractAll(p, outDir);
        record(1, `Handles non-object JSON header (${prim}) in extractAll gracefully`, true);
      } catch (err) {
        record(1, `Handles non-object JSON header (${prim}) in extractAll gracefully`, false, err.message);
      }
    }

    // 1.9 Inconsistent Pickle Sizes (outerPayloadSize < jsonLen)
    {
      const p = path.join(tmpDir, 'corrupt-outer-size.asar');
      const validJson = JSON.stringify({ files: { "a.txt": { size: 5, offset: "0" } } });
      const jsonBuf = Buffer.from(validJson, 'utf8');
      const jsonLen = jsonBuf.length;
      const aligned = (jsonLen + 3) & ~3;
      const buf = Buffer.alloc(16 + aligned + 5);
      buf.writeUInt32LE(4, 0);
      buf.writeUInt32LE(2, 4); // outerPayloadSize = 2 (inconsistent, smaller than header!)
      buf.writeUInt32LE(aligned + 4, 8);
      buf.writeUInt32LE(jsonLen, 12);
      jsonBuf.copy(buf, 16);
      Buffer.from('hello').copy(buf, 16 + aligned);
      fs.writeFileSync(p, buf);

      // Check whether readArchiveHeader validates pickle size consistency
      const parsed = asar.readArchiveHeader(p);
      const isRobust = parsed.payloadOffset >= 16 + aligned;
      record(1, 'Pickle outerPayloadSize consistency validation (Finding 5)', isRobust,
        `payloadOffset was calculated as ${parsed.payloadOffset}, which overlaps header (expected >= ${16 + aligned})`);
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

// =========================================================================
// SECTION 2: Boundary & Edge Case Archive Test
// =========================================================================
function runBoundaryArchiveTests() {
  console.log('\n============================================================');
  console.log(' SECTION 2: Boundary & Edge Case Archive Tests');
  console.log('============================================================\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-boundary-'));

  try {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    // 2.1 Deep directory tree (>10 levels: 15 levels)
    let deepPath = srcDir;
    for (let i = 1; i <= 15; i++) {
      deepPath = path.join(deepPath, `level_${i}`);
    }
    fs.mkdirSync(deepPath, { recursive: true });
    const deepFile = path.join(deepPath, 'deep_nested_target.txt');
    const deepContent = 'Deep directory nesting content at depth 15!';
    fs.writeFileSync(deepFile, deepContent, 'utf8');

    // 2.2 0-byte (empty) files in multiple places
    fs.writeFileSync(path.join(srcDir, 'empty_root.txt'), Buffer.alloc(0));
    fs.writeFileSync(path.join(deepPath, 'empty_deep.txt'), Buffer.alloc(0));

    // 2.3 Unicode filenames
    const unicodeDir = path.join(srcDir, 'unicode_测试');
    fs.mkdirSync(unicodeDir, { recursive: true });

    const unicodeFiles = [
      { name: '智能体_中文测试.js', content: 'console.log("Antigravity 智能体汉化");' },
      { name: '日本語_こんにちは_世界.txt', content: 'こんにちは世界' },
      { name: '🚀_rocket_launch_🎉.json', content: JSON.stringify({ emoji: '🎉', status: 'ok' }) },
      { name: 'café_naïve_résumé.md', content: '# Café & Naïve' },
      { name: 'file with spaces & (brackets) [v2.0] + special # chars.dat', content: 'Binary or text content with spaces' },
      { name: 'русский_текст.txt', content: 'Привет мир' }
    ];

    for (const f of unicodeFiles) {
      fs.writeFileSync(path.join(unicodeDir, f.name), f.content, 'utf8');
    }

    // 2.4 Companion .unpacked files with exact paths
    const nativeDir = path.join(srcDir, 'native');
    fs.mkdirSync(nativeDir, { recursive: true });
    const nodeBinary = Buffer.alloc(1024 * 64, 0xef);
    fs.writeFileSync(path.join(nativeDir, 'binding.node'), nodeBinary);
    fs.writeFileSync(path.join(nativeDir, 'helper.dll'), Buffer.from('MOCK_DLL_HEADER_12345'));

    // Test Glob Matching in shouldUnpack (Finding 2)
    const asarGlobPath = path.join(tmpDir, 'glob-test.asar');
    asar.createPackage(srcDir, asarGlobPath, { unpack: ['*.node'] });
    const globHeader = asar.readArchiveHeader(asarGlobPath);
    const globNodeEntry = asar.stat(asarGlobPath, 'native/binding.node');
    const globPatternMatchesNested = globNodeEntry && globNodeEntry.unpacked === true;
    record(2, 'Wildcard unpack: "*.node" matches nested native modules (Finding 2)', globPatternMatchesNested,
      'shouldUnpack("^[^/]*\\.node$") fails to match nested path "native/binding.node"');

    // Pack with exact relative paths
    const asarPath = path.join(tmpDir, 'boundary.asar');
    asar.createPackage(srcDir, asarPath, {
      unpack: ['native/binding.node', 'native/helper.dll']
    });

    record(2, 'ASAR packing with deep tree, 0-byte, unicode, and exact unpack succeeded', fs.existsSync(asarPath));
    record(2, 'Companion .unpacked directory created next to ASAR', fs.existsSync(asarPath + '.unpacked'));
    record(2, 'Companion .unpacked contains binding.node', fs.existsSync(path.join(asarPath + '.unpacked', 'native', 'binding.node')));
    record(2, 'Companion .unpacked contains helper.dll', fs.existsSync(path.join(asarPath + '.unpacked', 'native', 'helper.dll')));

    // Inspect header
    const nodeEntry = asar.stat(asarPath, 'native/binding.node');
    record(2, 'Header marks native/binding.node with unpacked: true', nodeEntry && nodeEntry.unpacked === true);

    const emptyRootEntry = asar.stat(asarPath, 'empty_root.txt');
    record(2, 'Header marks empty_root.txt with size: 0', emptyRootEntry && emptyRootEntry.size === 0);

    // Extract individual files via extractFile
    const extractedDeep = asar.extractFile(asarPath, 'level_1/level_2/level_3/level_4/level_5/level_6/level_7/level_8/level_9/level_10/level_11/level_12/level_13/level_14/level_15/deep_nested_target.txt');
    record(2, 'extractFile recovers 15-level deep file content', extractedDeep.toString('utf8') === deepContent);

    const extractedEmpty = asar.extractFile(asarPath, 'empty_root.txt');
    record(2, 'extractFile recovers 0-byte file buffer', extractedEmpty.length === 0);

    const extractedUnpacked = asar.extractFile(asarPath, 'native/binding.node');
    record(2, 'extractFile recovers unpacked file buffer matching source SHA256', computeSha256(extractedUnpacked) === computeSha256(nodeBinary));

    // Full Unpack via extractAll
    const unpackedDir = path.join(tmpDir, 'unpacked');
    asar.extractAll(asarPath, unpackedDir);

    const mismatches = compareDirs(srcDir, unpackedDir);
    record(2, 'extractAll roundtrip byte-for-byte fidelity (all 0-byte, deep, unicode, unpacked files match)', mismatches.length === 0, mismatches.join('; '));

    // Fallback when companion .unpacked is missing
    const asarNoCompanion = path.join(tmpDir, 'orphan.asar');
    fs.copyFileSync(asarPath, asarNoCompanion);
    const outOrphan = path.join(tmpDir, 'orphan_unpacked');
    try {
      asar.extractAll(asarNoCompanion, outOrphan);
      const orphanNode = path.join(outOrphan, 'native', 'binding.node');
      record(2, 'extractAll falls back cleanly without crash when companion .unpacked is missing', fs.existsSync(orphanNode));
    } catch (err) {
      record(2, 'extractAll falls back cleanly without crash when companion .unpacked is missing', false, err.message);
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

// =========================================================================
// SECTION 3: End-to-End Patcher Simulation & Adversarial Scenarios
// =========================================================================
async function runEndToEndPatcherTests() {
  console.log('\n============================================================');
  console.log(' SECTION 3: End-to-End Patcher Simulation');
  console.log('============================================================\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-e2e-patch-'));

  try {
    const mockAppDir = path.join(tmpDir, 'mock-app');
    fs.mkdirSync(path.join(mockAppDir, 'dist', 'ideInstall'), { recursive: true });
    fs.mkdirSync(path.join(mockAppDir, 'native'), { recursive: true });

    fs.writeFileSync(path.join(mockAppDir, 'package.json'), JSON.stringify({
      name: 'Google Antigravity',
      version: '2.17.0',
      main: 'dist/main.js'
    }, null, 2));

    const mockPreload = `
const electron = require('electron');
electron.contextBridge.exposeInMainWorld('api', { ping: () => 'pong' });
`;
    fs.writeFileSync(path.join(mockAppDir, 'dist', 'preload.js'), mockPreload);

    const mockMenu = `
function addItemToSubmenu(appMenu, submenuLabel, position, item) {
    const submenuItem = appMenu.items.find((item) => item.label === submenuLabel);
    if (!submenuItem?.submenu) return;
    submenuItem.submenu.insert(position, item);
}
return { label: 'Connect to WSL', submenu };
return { label: 'Reopen Locally', click: () => {} };
addItemToSubmenu(menu, 'File', 0, new electron_1.MenuItem({ label: 'New Window' }));
addItemToSubmenu(menu, 'Help', 0, new electron_1.MenuItem({ label: 'Docs' }));
`;
    fs.writeFileSync(path.join(mockAppDir, 'dist', 'menu.js'), mockMenu);

    const mockTray = `
function updateTrayAgentCount(count) {
    if (tray && contextMenu) {
        const countItem = contextMenu.items.find((item) => item.id === 'running-agents');
        if (countItem) {
            countItem.label =
                (count > 0 ? \`\${count}\` : 'No') +
                    ' agent' +
                    (count === 1 ? '' : 's') +
                    ' running';
            tray.setContextMenu(contextMenu);
        }
    }
}
`;
    fs.writeFileSync(path.join(mockAppDir, 'dist', 'tray.js'), mockTray);

    fs.writeFileSync(path.join(mockAppDir, 'dist', 'loadingOverlay.js'), '<div class="text">Loading Antigravity</div>');
    fs.writeFileSync(path.join(mockAppDir, 'dist', 'ideInstall', 'wizardHtml.js'), '<title>Welcome to Antigravity</title><button id="btn-skip">Explore the new Antigravity</button>');
    fs.writeFileSync(path.join(mockAppDir, 'dist', 'provisionSplash.js'), '<div>Setting up WSL: ${escapeHtml(distro)}</div>');
    fs.writeFileSync(path.join(mockAppDir, 'dist', 'wsl.js'), "onStatus?.('Downloading the Antigravity binary\\u2026');");
    fs.writeFileSync(path.join(mockAppDir, 'dist', 'main.js'), "const options = { title: 'Confirm Quit', message: 'Are you sure you want to quit?' };");
    fs.writeFileSync(path.join(mockAppDir, 'dist', 'ipcHandlers.js'), "electron_1.dialog.showErrorBox('Cannot open folder', t.error);");

    const nativeBinaryContent = Buffer.from('ANTIGRAVITY_NATIVE_NODE_BINARY_TEST_MOCK_BYTES');
    fs.writeFileSync(path.join(mockAppDir, 'native', 'agent_runtime.node'), nativeBinaryContent);

    // Create mock app.asar with exact unpacked path
    const mockAsarPath = path.join(tmpDir, 'app.asar');
    asar.createPackage(mockAppDir, mockAsarPath, {
      unpack: ['native/agent_runtime.node']
    });

    record(3, 'Mock app.asar created with companion .unpacked', fs.existsSync(mockAsarPath) && fs.existsSync(mockAsarPath + '.unpacked'));

    // Test 3.1: Execute patch via scripts/patch.js CLI
    const patchedAsarPath = path.join(tmpDir, 'ag_patched.asar');
    const cliScript = path.join(__dirname, '..', 'scripts', 'patch.js');

    const cliResult = spawnSync(process.execPath, [
      cliScript,
      '--src', mockAsarPath,
      '--dest', patchedAsarPath,
      '--verbose'
    ], { encoding: 'utf8' });

    record(3, 'scripts/patch.js CLI exits with code 0', cliResult.status === 0, `Status: ${cliResult.status}, stderr: ${cliResult.stderr}`);
    record(3, 'scripts/patch.js output file exists', fs.existsSync(patchedAsarPath));

    // Test 3.2: Verify companion .unpacked preservation after patchAsar (Finding 1)
    const patchedUnpackedDir = patchedAsarPath + '.unpacked';
    const companionPreserved = fs.existsSync(patchedUnpackedDir) &&
      fs.existsSync(path.join(patchedUnpackedDir, 'native', 'agent_runtime.node'));
    record(3, 'Companion .unpacked directory preserved and placed next to patched ASAR (Finding 1)', companionPreserved,
      `Expected ${patchedUnpackedDir} to exist; temp unpacked dir was leaked instead`);

    // Check for stray temporary .unpacked folders in target directory
    const strayUnpackedDirs = fs.readdirSync(tmpDir).filter(f => f.includes('.tmp.') && f.endsWith('.unpacked'));
    record(3, 'No stray temporary .unpacked directories leaked in destination directory (Finding 1)', strayUnpackedDirs.length === 0,
      `Stray leaked dirs found: ${strayUnpackedDirs.join(', ')}`);

    // Test 3.3: Inspect patched ASAR content and unpackability
    const outVerifyDir = path.join(tmpDir, 'verify-patched');
    asar.extractAll(patchedAsarPath, outVerifyDir);

    const patchedPreloadContent = fs.readFileSync(path.join(outVerifyDir, 'dist', 'preload.js'), 'utf8');
    record(3, 'Patched preload.js contains translation engine bootstrap', patchedPreloadContent.includes('__initAntigravityZhEngine__'));
    record(3, 'Patched preload.js contains window.__ANTIGRAVITY_ZH_ENGINE__', patchedPreloadContent.includes('window.__ANTIGRAVITY_ZH_ENGINE__'));
    record(3, 'Patched preload.js preserves original exposure code', patchedPreloadContent.includes("exposeInMainWorld('api'"));

    const patchedMenuContent = fs.readFileSync(path.join(outVerifyDir, 'dist', 'menu.js'), 'utf8');
    record(3, 'Patched menu.js contains SUBMENU_LABEL_ALIASES', patchedMenuContent.includes('SUBMENU_LABEL_ALIASES'));
    record(3, 'Patched menu.js contains localized New Window (新建窗口)', patchedMenuContent.includes('新建窗口'));

    const patchedTrayContent = fs.readFileSync(path.join(outVerifyDir, 'dist', 'tray.js'), 'utf8');
    record(3, 'Patched tray.js formats agent count in Chinese (个智能体正在运行)', patchedTrayContent.includes('个智能体正在运行'));

    const patchedOverlay = fs.readFileSync(path.join(outVerifyDir, 'dist', 'loadingOverlay.js'), 'utf8');
    record(3, 'Patched loadingOverlay.js localized (正在加载 Antigravity...)', patchedOverlay.includes('正在加载 Antigravity...'));

    const patchedWizard = fs.readFileSync(path.join(outVerifyDir, 'dist', 'ideInstall', 'wizardHtml.js'), 'utf8');
    record(3, 'Patched wizardHtml.js localized (欢迎使用 Antigravity)', patchedWizard.includes('欢迎使用 Antigravity'));

    const patchedSplash = fs.readFileSync(path.join(outVerifyDir, 'dist', 'provisionSplash.js'), 'utf8');
    record(3, 'Patched provisionSplash.js localized (正在配置 WSL:)', patchedSplash.includes('正在配置 WSL:'));

    const patchedMain = fs.readFileSync(path.join(outVerifyDir, 'dist', 'main.js'), 'utf8');
    record(3, 'Patched main.js localized (确认退出)', patchedMain.includes('确认退出'));

    const patchedIpc = fs.readFileSync(path.join(outVerifyDir, 'dist', 'ipcHandlers.js'), 'utf8');
    record(3, 'Patched ipcHandlers.js localized (无法打开文件夹)', patchedIpc.includes('无法打开文件夹'));

    const untouchedPkg = fs.readFileSync(path.join(outVerifyDir, 'package.json'), 'utf8');
    record(3, 'Untouched package.json remains 100% identical', untouchedPkg.includes('"version": "2.17.0"'));

    // Test 3.4: Idempotence of scripts/patch.js CLI on already patched ASAR
    const repatchedAsarPath = path.join(tmpDir, 'repatched.asar');
    const repatchResult = spawnSync(process.execPath, [
      cliScript,
      '--src', patchedAsarPath,
      '--dest', repatchedAsarPath
    ], { encoding: 'utf8' });

    record(3, 'Repatching already patched ASAR succeeds cleanly (idempotence)', repatchResult.status === 0);

    const repatchVerifyDir = path.join(tmpDir, 'verify-repatched');
    asar.extractAll(repatchedAsarPath, repatchVerifyDir);
    const repatchedPreload = fs.readFileSync(path.join(repatchVerifyDir, 'dist', 'preload.js'), 'utf8');
    const engineMatchCount = (repatchedPreload.match(/__initAntigravityZhEngine__/g) || []).length;
    record(3, 'Preload is not double-injected on re-patching (engine instance count === 1)', engineMatchCount === 1);

    // Test 3.5: CLI error handling on invalid / corrupt source ASAR
    const corruptAsar = path.join(tmpDir, 'corrupt.asar');
    fs.writeFileSync(corruptAsar, Buffer.from('NOT_AN_ASAR_FILE'));
    const cliCorruptResult = spawnSync(process.execPath, [
      cliScript,
      '--src', corruptAsar,
      '--dest', path.join(tmpDir, 'out.asar')
    ], { encoding: 'utf8' });

    record(3, 'CLI scripts/patch.js exits with code 1 on corrupt source ASAR', cliCorruptResult.status === 1);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

// =========================================================================
// SECTION 4: Adversarial Security Fuzzing (Directory Traversal / Path Escapes)
// =========================================================================
function runSecurityTests() {
  console.log('\n============================================================');
  console.log(' SECTION 4: Adversarial Security Fuzzing (ASAR-Slip)');
  console.log('============================================================\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-sec-'));

  try {
    const destDir = path.join(tmpDir, 'extract_dest');
    fs.mkdirSync(destDir);
    const outsideFile = path.join(tmpDir, 'outside.txt');

    // Craft malicious header attempting path traversal to parent directory
    const evilHeader = {
      files: {
        '..': {
          files: {
            'outside.txt': {
              size: 9,
              offset: '0'
            }
          }
        }
      }
    };

    const jsonStr = JSON.stringify(evilHeader);
    const jsonBuf = Buffer.from(jsonStr, 'utf8');
    const aligned = (jsonBuf.length + 3) & ~3;
    const headerBuf = Buffer.alloc(16 + aligned);
    headerBuf.writeUInt32LE(4, 0);
    headerBuf.writeUInt32LE(aligned + 8, 4);
    headerBuf.writeUInt32LE(aligned + 4, 8);
    headerBuf.writeUInt32LE(jsonBuf.length, 12);
    jsonBuf.copy(headerBuf, 16);

    const payload = Buffer.from('PWNED1234');
    const evilAsar = path.join(tmpDir, 'evil.asar');
    fs.writeFileSync(evilAsar, Buffer.concat([headerBuf, payload]));

    try {
      asar.extractAll(evilAsar, destDir);
    } catch (_) {}

    const escapedDestination = fs.existsSync(outsideFile);
    record(4, 'ASAR-Slip: extractAll prevents writing files outside destDir (Finding 3)', !escapedDestination,
      'extractAll allowed writing outside.txt to parent directory via ".." header entry');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

async function main() {
  console.log('============================================================');
  console.log(' EMPIRICAL ADVERSARIAL STRESS TEST HARNESS (Challenger 1)');
  console.log('============================================================');

  runCorruptHeaderTests();
  runBoundaryArchiveTests();
  await runEndToEndPatcherTests();
  runSecurityTests();

  console.log('\n============================================================');
  console.log(` SUMMARY: ${RESULTS.passed} Passed, ${RESULTS.failed} Failed / Findings`);
  console.log('============================================================\n');

  if (RESULTS.findings.length > 0) {
    console.log('\x1b[33mSummary of Adversarial Findings / Deficiencies Discovered:\x1b[0m');
    RESULTS.findings.forEach((f, idx) => {
      console.log(`  ${idx + 1}. [Section ${f.section}] ${f.name}`);
      if (f.detail) console.log(`     Details: ${f.detail}`);
    });
    console.log('\n');
  }
}

main().catch(err => {
  console.error('Fatal stress test runner error:', err);
  process.exit(1);
});
