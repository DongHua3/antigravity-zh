'use strict';

/**
 * lib/patches/updater.js
 *
 * Patches dist/updater.js in Google Antigravity:
 * Localizes update checking dialogs and update menu labels.
 */
function patchUpdater(sourceCode) {
  if (typeof sourceCode !== 'string') {
    throw new TypeError('patchUpdater requires a string argument');
  }

  let patched = sourceCode;

  if (patched.includes('暂无可用更新')) {
    return patched;
  }

  // 1. Localize Check for Updates info modal
  const targetOptions = /title:\s*['"]Check for Updates['"],\s*message:\s*['"]No updates available['"],\s*buttons:\s*\[['"]OK['"]\]/;
  if (targetOptions.test(patched)) {
    patched = patched.replace(
      targetOptions,
      "title: '检查更新',\n                message: '暂无可用更新',\n                buttons: ['确定']"
    );
  }

  // 2. Localize MenuUpdateStep enum labels
  patched = patched
    .replace('MenuUpdateStep["CheckForUpdates"] = "Check for Updates";', 'MenuUpdateStep["CheckForUpdates"] = "检查更新";')
    .replace('MenuUpdateStep["CheckingForUpdates"] = "Checking for Updates...";', 'MenuUpdateStep["CheckingForUpdates"] = "正在检查更新...";')
    .replace('MenuUpdateStep["DownloadingUpdate"] = "Downloading Update...";', 'MenuUpdateStep["DownloadingUpdate"] = "正在下载更新...";')
    .replace('MenuUpdateStep["RestartToUpdate"] = "Restart to Update";', 'MenuUpdateStep["RestartToUpdate"] = "重启以应用更新";');

  return patched;
}

module.exports = {
  patchUpdater
};
