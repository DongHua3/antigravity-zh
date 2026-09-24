'use strict';

/**
 * lib/patches/dialogs.js
 *
 * Patches main process dialogs and confirmation modals in Google Antigravity:
 * 1. dist/main.js:
 *    - Quit confirmation modal:
 *      'Confirm Quit' -> '确认退出'
 *      'Are you sure you want to quit?' -> '确定要退出吗？'
 *      'There may be agents or background tasks running.' -> '可能仍有正在运行的智能体或后台任务。'
 *      ['Cancel', 'Quit'] -> ['取消', '退出']
 *    - Initial tray context menu entries:
 *      'No agents running' -> '无正在运行的智能体'
 *      `Open ${...}` -> `打开 ${...}`
 *      'Quit' -> '退出'
 *    - Native error dialogs:
 *      'WSL setup failed' -> 'WSL 配置失败'
 * 2. dist/ipcHandlers.js:
 *    - Folder picker and error dialogs:
 *      'Cannot open folder' -> '无法打开文件夹'
 *      'Folder is on the Windows filesystem' -> '文件夹位于 Windows 文件系统'
 *      'Open workspace' -> '打开工作区'
 *      'Open workspaces' -> '打开多个工作区'
 */

/**
 * Patches the source code of dist/main.js.
 * @param {string} sourceCode
 * @returns {string} Patched source code
 */
function patchMain(sourceCode) {
  if (typeof sourceCode !== 'string') {
    throw new TypeError('patchMain requires a string argument');
  }

  let patched = sourceCode;

  // 1. Quit confirmation modal options
  const quitModalRegex = /buttons:\s*\[['"]Cancel['"],\s*['"]Quit['"]\],[\s\S]*?defaultId:\s*1,[\s\S]*?cancelId:\s*0,[\s\S]*?title:\s*['"]Confirm Quit['"],[\s\S]*?message:\s*['"]Are you sure you want to quit\?['"],[\s\S]*?detail:\s*['"]There may be agents or background tasks running\.['"],?/;

  const quitModalReplacement = `buttons: ['取消', '退出'],
        defaultId: 1,
        cancelId: 0,
        title: '确认退出',
        message: '确定要退出吗？',
        detail: '可能仍有正在运行的智能体或后台任务。',`;

  if (quitModalRegex.test(patched)) {
    patched = patched.replace(quitModalRegex, quitModalReplacement);
  } else {
    // Individual fallback replacements
    patched = patched.replace(/(title:\s*['"])Confirm Quit(['"])/g, '$1确认退出$2');
    patched = patched.replace(/(message:\s*['"])Are you sure you want to quit\?(['"])/g, '$1确定要退出吗？$2');
    patched = patched.replace(/(detail:\s*['"])There may be agents or background tasks running\.(['"])/g, '$1可能仍有正在运行的智能体或后台任务。$2');
    patched = patched.replace(/buttons:\s*\[['"]Cancel['"],\s*['"]Quit['"]\]/g, "buttons: ['取消', '退出']");
  }

  patched = patched.replace(/(label:\s*['"])No agents running(['"])/g, '$1无正在运行的智能体$2');
  patched = patched.replace(/label:\s*`Open\s+(\$\{electron_1\.app\.getName\(\)\}`)/g, 'label: `打开 $1');
  patched = patched.replace(/label:\s*['"]Open\s+['"]\s*\+\s*electron_1\.app\.getName\(\)/g, "label: '打开 ' + electron_1.app.getName()");

  // Quit action in tray menu: replace 'Quit' specifically inside createTray call
  patched = patched.replace(
    /(label:\s*['"])Quit(['"],\s*click:\s*\(\)\s*=>\s*\{[\s\S]*?electron_1\.app\.quit)/g,
    '$1退出$2'
  );

  // New Window in dockMenu
  patched = patched.replace(/(label:\s*['"])New Window(['"],\s*click:\s*\(\)\s*=>\s*\(0,\s*utils_1\.createWindow\))/g, '$1新建窗口$2');

  // WSL setup error box
  patched = patched.replace(/showErrorBox\(['"]WSL setup failed['"]/g, "showErrorBox('WSL 配置失败'");

  return patched;
}

/**
 * Patches the source code of dist/ipcHandlers.js.
 * @param {string} sourceCode
 * @returns {string} Patched source code
 */
function patchIpcHandlers(sourceCode) {
  if (typeof sourceCode !== 'string') {
    throw new TypeError('patchIpcHandlers requires a string argument');
  }

  let patched = sourceCode;

  // Error and warning dialogs
  patched = patched.replace(/showErrorBox\(['"]Cannot open folder['"]/g, "showErrorBox('无法打开文件夹'");
  patched = patched.replace(/message:\s*['"]Folder is on the Windows filesystem['"]/g, "message: '文件夹位于 Windows 文件系统'");

  // Open workspace titles
  patched = patched.replace(/title:\s*['"]Open workspace['"]/g, "title: '打开工作区'");
  patched = patched.replace(/title:\s*['"]Open workspaces['"]/g, "title: '打开多个工作区'");

  return patched;
}

module.exports = {
  patchMain,
  patchIpcHandlers
};
