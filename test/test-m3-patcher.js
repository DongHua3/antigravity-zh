'use strict';

/**
 * test/test-m3-patcher.js
 *
 * Automated verification test suite for Milestone M3:
 * 1. lib/patches/menu.js
 * 2. lib/patches/tray.js
 * 3. lib/patches/loadingOverlay.js
 * 4. lib/patches/wizardHtml.js
 * 5. lib/patches/provisionSplash.js
 * 6. lib/patches/dialogs.js
 * 7. lib/patcher.js
 * 8. scripts/patch.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const { patchMenu, matchesSubmenu, normalizeMenuLabel, SUBMENU_LABEL_ALIASES } = require('../lib/patches/menu');
const { patchTray, TRAY_AGENT_COUNT_REGEX } = require('../lib/patches/tray');
const { patchLoadingOverlay } = require('../lib/patches/loadingOverlay');
const { patchWizardHtml } = require('../lib/patches/wizardHtml');
const { patchProvisionSplash, patchWsl } = require('../lib/patches/provisionSplash');
const { patchMain, patchIpcHandlers } = require('../lib/patches/dialogs');
const { patchAsar, patchDirectory, patchPreload } = require('../lib/patcher');
const asar = require('../lib/asar');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (!condition) {
    failedTests++;
    console.error(`  \x1b[31m✘ FAIL: ${message}\x1b[0m`);
    throw new Error(message);
  } else {
    passedTests++;
    console.log(`  \x1b[32m✔ PASS: ${message}\x1b[0m`);
  }
}

async function runTests() {
  console.log('============================================================');
  console.log(' Milestone M3 Automated Verification Test Suite');
  console.log('============================================================\n');

  // -------------------------------------------------------------
  // Test 1: lib/patches/menu.js
  // -------------------------------------------------------------
  console.log('>>> Testing lib/patches/menu.js:');

  // Test normalizeMenuLabel
  assert(normalizeMenuLabel('&File') === 'file', 'normalizes &File to file');
  assert(normalizeMenuLabel('文件(&F)') === '文件', 'normalizes 文件(&F) to 文件');
  assert(normalizeMenuLabel('Help (H)') === 'help', 'normalizes Help (H) to help');

  // Test matchesSubmenu
  assert(matchesSubmenu('File', 'File') === true, 'matches File to File');
  assert(matchesSubmenu('文件', 'File') === true, 'matches 文件 to File');
  assert(matchesSubmenu('File', '文件') === true, 'matches File to 文件');
  assert(matchesSubmenu('&File', '文件(&F)') === true, 'matches &File to 文件(&F)');
  assert(matchesSubmenu('帮助', 'Help') === true, 'matches 帮助 to Help');
  assert(matchesSubmenu('Edit', 'Unknown') === false, 'does not match unrelated labels');

  // Test patching sample menu.js from workspace root
  const sampleMenuPath = path.join(__dirname, '..', '..', 'menu.js');
  if (fs.existsSync(sampleMenuPath)) {
    const rawSample = fs.readFileSync(sampleMenuPath, 'utf8');
    const patchedSample = patchMenu(rawSample);

    assert(patchedSample.includes('SUBMENU_LABEL_ALIASES'), 'menu.js contains SUBMENU_LABEL_ALIASES');
    assert(patchedSample.includes('label: \'新建窗口\''), 'menu.js contains localized New Window');
    assert(patchedSample.includes('label: \'文档\''), 'menu.js contains localized Docs');
    assert(patchedSample.includes('label: \'连接到 WSL\''), 'menu.js contains localized Connect to WSL');
    assert(patchedSample.includes('label: \'在本地重新打开\''), 'menu.js contains localized Reopen Locally');

    // Idempotence test
    const doublePatched = patchMenu(patchedSample);
    assert(doublePatched === patchedSample, 'patchMenu is idempotent');
  } else {
    console.warn('  [skip] Sample menu.js not found at workspace root, testing synthetic snippet');
    const syntheticMenu = `
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
    const patched = patchMenu(syntheticMenu);
    assert(patched.includes('SUBMENU_LABEL_ALIASES'), 'synthetic menu contains SUBMENU_LABEL_ALIASES');
    assert(patched.includes('连接到 WSL'), 'synthetic menu contains localized Connect to WSL');
    assert(patched.includes('在本地重新打开'), 'synthetic menu contains localized Reopen Locally');
    assert(patched.includes('新建窗口'), 'synthetic menu contains localized New Window');
    assert(patched.includes('文档'), 'synthetic menu contains localized Docs');
  }

  // -------------------------------------------------------------
  // Test 2: lib/patches/tray.js
  // -------------------------------------------------------------
  console.log('\n>>> Testing lib/patches/tray.js:');
  const sampleTraySnippet = `
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
  const patchedTray = patchTray(sampleTraySnippet);
  assert(patchedTray.includes('(count > 0 ? `${count} 个智能体正在运行` : \'无正在运行的智能体\')'), 'tray.js formats agent count in Chinese');
  assert(!patchedTray.includes("' agent'"), 'tray.js removes English agent pluralization');
  assert(patchTray(patchedTray) === patchedTray, 'patchTray is idempotent');

  // -------------------------------------------------------------
  // Test 3: lib/patches/loadingOverlay.js
  // -------------------------------------------------------------
  console.log('\n>>> Testing lib/patches/loadingOverlay.js:');
  const sampleLoading = `<div class="loader"><div></div></div><div class="text">Loading Antigravity</div>`;
  const patchedLoading = patchLoadingOverlay(sampleLoading);
  assert(patchedLoading.includes('<div class="text">正在加载 Antigravity...</div>'), 'loadingOverlay.js replaces loading text');
  assert(patchLoadingOverlay(patchedLoading) === patchedLoading, 'patchLoadingOverlay is idempotent');

  // -------------------------------------------------------------
  // Test 4: lib/patches/wizardHtml.js
  // -------------------------------------------------------------
  console.log('\n>>> Testing lib/patches/wizardHtml.js:');
  const sampleWizard = `
<title>Welcome to Antigravity</title>
<div class="text" style="font-size: 13px;">Setting up…</div>
<h1>Welcome to the new Antigravity!</h1>
<p>Antigravity has been redesigned to put agents first with new capabilities. If you'd still like a code editor, you can download it as a separate app named <b>Antigravity IDE</b>.</p>
<span>Download the Antigravity IDE</span>
<button class="btn-primary" id="btn-skip">Explore the new Antigravity</button>
`;
  const patchedWizard = patchWizardHtml(sampleWizard);
  assert(patchedWizard.includes('<title>欢迎使用 Antigravity</title>'), 'wizard title is localized');
  assert(patchedWizard.includes('正在配置…'), 'wizard setting up text is localized');
  assert(patchedWizard.includes('<h1>欢迎体验全新 Antigravity！</h1>'), 'wizard welcome header is localized');
  assert(patchedWizard.includes('<span>下载 Antigravity IDE</span>'), 'wizard download span is localized');
  assert(patchedWizard.includes('开始探索 Antigravity'), 'wizard skip button is localized');
  assert(patchWizardHtml(patchedWizard) === patchedWizard, 'patchWizardHtml is idempotent');

  // -------------------------------------------------------------
  // Test 5: lib/patches/provisionSplash.js
  // -------------------------------------------------------------
  console.log('\n>>> Testing lib/patches/provisionSplash.js:');
  const sampleSplash = `
<div>Setting up WSL: \${escapeHtml(distro)}</div>
setStatus(text) {
    if (win.isDestroyed()) return;
    void win.webContents.executeJavaScript(\`document.getElementById('status').textContent = \${JSON.stringify(text)}\`).catch(() => {});
}
`;
  const patchedSplash = patchProvisionSplash(sampleSplash);
  assert(patchedSplash.includes('<div>正在配置 WSL: ${escapeHtml(distro)}</div>'), 'splash header is localized');
  assert(patchedSplash.includes('正在下载 Antigravity 二进制文件…'), 'splash setStatus maps download text');
  assert(patchedSplash.includes('正在安装至 $1…'), 'splash setStatus maps install text');

  const sampleWsl = `
onStatus?.('Downloading the Antigravity binary\\u2026');
onStatus?.(\`Installing into \${distro}\\u2026\`);
`;
  const patchedWsl = patchWsl(sampleWsl);
  assert(patchedWsl.includes("onStatus?.('正在下载 Antigravity 二进制文件…');"), 'wsl.js download status is localized');
  assert(patchedWsl.includes("onStatus?.(`正在安装至 ${distro}…`);"), 'wsl.js install status is localized');

  // -------------------------------------------------------------
  // Test 6: lib/patches/dialogs.js
  // -------------------------------------------------------------
  console.log('\n>>> Testing lib/patches/dialogs.js:');
  const sampleMain = `
const options = {
    type: 'question',
    buttons: ['Cancel', 'Quit'],
    defaultId: 1,
    cancelId: 0,
    title: 'Confirm Quit',
    message: 'Are you sure you want to quit?',
    detail: 'There may be agents or background tasks running.',
};
createTray([
    { id: 'running-agents', label: 'No agents running' },
    { label: \`Open \${electron_1.app.getName()}\` },
    { label: 'Quit', click: () => { electron_1.app.quit(); } }
]);
await electron_1.dialog.showErrorBox('WSL setup failed', msg);
`;
  const patchedMain = patchMain(sampleMain);
  assert(patchedMain.includes("buttons: ['取消', '退出']"), 'main.js quit modal buttons localized');
  assert(patchedMain.includes("title: '确认退出'"), 'main.js quit modal title localized');
  assert(patchedMain.includes("message: '确定要退出吗？'"), 'main.js quit modal message localized');
  assert(patchedMain.includes("detail: '可能仍有正在运行的智能体或后台任务。'"), 'main.js quit modal detail localized');
  assert(patchedMain.includes("label: '无正在运行的智能体'"), 'main.js tray initial item localized');
  assert(patchedMain.includes("label: `打开 ${electron_1.app.getName()}`"), 'main.js tray open item localized');
  assert(patchedMain.includes("label: '退出'"), 'main.js tray quit item localized');
  assert(patchedMain.includes("showErrorBox('WSL 配置失败'"), 'main.js WSL error box localized');

  const sampleIpc = `
electron_1.dialog.showErrorBox('Cannot open folder', t.error);
message: 'Folder is on the Windows filesystem',
title: 'Open workspace',
title: 'Open workspaces',
`;
  const patchedIpc = patchIpcHandlers(sampleIpc);
  assert(patchedIpc.includes("showErrorBox('无法打开文件夹'"), 'ipcHandlers error dialog localized');
  assert(patchedIpc.includes("message: '文件夹位于 Windows 文件系统'"), 'ipcHandlers filesystem warning localized');
  assert(patchedIpc.includes("title: '打开工作区'"), 'ipcHandlers open workspace title localized');
  assert(patchedIpc.includes("title: '打开多个工作区'"), 'ipcHandlers open workspaces title localized');

  // -------------------------------------------------------------
  // Test 7: Preload Injection
  // -------------------------------------------------------------
  console.log('\n>>> Testing patchPreload:');
  const originalPreload = `const electron = require('electron');\nelectron.contextBridge.exposeInMainWorld('api', {});`;
  const patchedPreload = patchPreload(originalPreload);
  assert(patchedPreload.includes('__initAntigravityZhEngine__'), 'patched preload contains engine bootstrap');
  assert(patchedPreload.includes('window.__ANTIGRAVITY_ZH_ENGINE__'), 'patched preload attaches global engine');
  assert(patchedPreload.includes(originalPreload), 'patched preload preserves original code intact');
  assert(patchPreload(patchedPreload) === patchedPreload, 'patchPreload is idempotent');

  // -------------------------------------------------------------
  // Test 8: End-to-End Mock ASAR Patching via lib/patcher.js
  // -------------------------------------------------------------
  console.log('\n>>> Testing E2E Mock ASAR Patching via lib/patcher.js:');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-m3-'));
  const mockSrcDir = path.join(tempDir, 'mock-src');
  const mockAsarPath = path.join(tempDir, 'mock-app.asar');
  const patchedAsarPath = path.join(tempDir, 'mock-patched.asar');
  const unpackedVerifyDir = path.join(tempDir, 'unpacked-verify');

  fs.mkdirSync(path.join(mockSrcDir, 'dist', 'ideInstall'), { recursive: true });

  // Populate mock files
  fs.writeFileSync(path.join(mockSrcDir, 'package.json'), JSON.stringify({ name: 'antigravity', version: '2.17.0' }));
  fs.writeFileSync(path.join(mockSrcDir, 'dist', 'preload.js'), originalPreload);
  fs.writeFileSync(path.join(mockSrcDir, 'dist', 'menu.js'), sampleMenuPath && fs.existsSync(sampleMenuPath) ? fs.readFileSync(sampleMenuPath, 'utf8') : syntheticMenu);
  fs.writeFileSync(path.join(mockSrcDir, 'dist', 'tray.js'), sampleTraySnippet);
  fs.writeFileSync(path.join(mockSrcDir, 'dist', 'loadingOverlay.js'), sampleLoading);
  fs.writeFileSync(path.join(mockSrcDir, 'dist', 'ideInstall', 'wizardHtml.js'), sampleWizard);
  fs.writeFileSync(path.join(mockSrcDir, 'dist', 'provisionSplash.js'), sampleSplash);
  fs.writeFileSync(path.join(mockSrcDir, 'dist', 'wsl.js'), sampleWsl);
  fs.writeFileSync(path.join(mockSrcDir, 'dist', 'main.js'), sampleMain);
  fs.writeFileSync(path.join(mockSrcDir, 'dist', 'ipcHandlers.js'), sampleIpc);

  // Pack mock ASAR
  asar.createPackage(mockSrcDir, mockAsarPath);
  assert(fs.existsSync(mockAsarPath), 'Mock ASAR created successfully');

  // Execute patchAsar
  const patchSuccess = await patchAsar(mockAsarPath, patchedAsarPath, { verbose: false });
  assert(patchSuccess === true, 'patchAsar returns true');
  assert(fs.existsSync(patchedAsarPath), 'Patched ASAR created successfully');

  // Verify unpacked contents from patched ASAR
  asar.extractAll(patchedAsarPath, unpackedVerifyDir);

  const verifiedPreload = fs.readFileSync(path.join(unpackedVerifyDir, 'dist', 'preload.js'), 'utf8');
  assert(verifiedPreload.includes('__initAntigravityZhEngine__'), 'verified ASAR preload has translation engine');

  const verifiedMenu = fs.readFileSync(path.join(unpackedVerifyDir, 'dist', 'menu.js'), 'utf8');
  assert(verifiedMenu.includes('SUBMENU_LABEL_ALIASES'), 'verified ASAR menu.js has bilingual lookup');

  const verifiedTray = fs.readFileSync(path.join(unpackedVerifyDir, 'dist', 'tray.js'), 'utf8');
  assert(verifiedTray.includes('个智能体正在运行'), 'verified ASAR tray.js has localized agent count');

  const verifiedLoading = fs.readFileSync(path.join(unpackedVerifyDir, 'dist', 'loadingOverlay.js'), 'utf8');
  assert(verifiedLoading.includes('正在加载 Antigravity...'), 'verified ASAR loadingOverlay.js localized');

  const verifiedWizard = fs.readFileSync(path.join(unpackedVerifyDir, 'dist', 'ideInstall', 'wizardHtml.js'), 'utf8');
  assert(verifiedWizard.includes('欢迎使用 Antigravity'), 'verified ASAR wizardHtml.js localized');

  const verifiedSplash = fs.readFileSync(path.join(unpackedVerifyDir, 'dist', 'provisionSplash.js'), 'utf8');
  assert(verifiedSplash.includes('正在配置 WSL:'), 'verified ASAR provisionSplash.js localized');

  const verifiedMain = fs.readFileSync(path.join(unpackedVerifyDir, 'dist', 'main.js'), 'utf8');
  assert(verifiedMain.includes('确认退出'), 'verified ASAR main.js localized');

  // -------------------------------------------------------------
  // Test 9: CLI scripts/patch.js Execution
  // -------------------------------------------------------------
  console.log('\n>>> Testing CLI scripts/patch.js:');
  const cliScriptPath = path.join(__dirname, '..', 'scripts', 'patch.js');
  const cliDestAsar = path.join(tempDir, 'cli-patched.asar');

  // Test --help flag
  const helpResult = spawnSync(process.execPath, [cliScriptPath, '--help'], { encoding: 'utf8' });
  assert(helpResult.status === 0, 'CLI --help exits with code 0');
  assert(helpResult.stdout.includes('Usage:'), 'CLI --help displays usage');

  // Test patching via CLI
  const patchResult = spawnSync(process.execPath, [
    cliScriptPath,
    '--src', mockAsarPath,
    '--dest', cliDestAsar,
    '--verbose'
  ], { encoding: 'utf8' });

  assert(patchResult.status === 0, `CLI patch execution exits with code 0 (status: ${patchResult.status})`);
  assert(fs.existsSync(cliDestAsar), 'CLI generated patched ASAR');

  // Test error handling on missing file
  const failResult = spawnSync(process.execPath, [
    cliScriptPath,
    '--src', path.join(tempDir, 'nonexistent.asar'),
    '--dest', path.join(tempDir, 'out.asar')
  ], { encoding: 'utf8' });
  assert(failResult.status === 1, 'CLI exits with non-zero on non-existent source ASAR');

  // Clean up test sandbox
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('\n============================================================');
  console.log(` Summary: ${passedTests} Passed, ${failedTests} Failed`);
  console.log('============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
