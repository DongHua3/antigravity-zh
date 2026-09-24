'use strict';

/**
 * lib/patches/provisionSplash.js
 *
 * Statically patches dist/provisionSplash.js and dist/wsl.js in Google Antigravity:
 * 1. dist/provisionSplash.js:
 *    - Replaces 'Setting up WSL: ${escapeHtml(distro)}' with '正在配置 WSL: ${escapeHtml(distro)}'
 *    - Wraps setStatus(text) with fallback translation for WSL provisioning messages.
 * 2. dist/wsl.js:
 *    - Replaces status notifications:
 *      'Downloading the Antigravity binary…' -> '正在下载 Antigravity 二进制文件…'
 *      `Installing into ${distro}…` -> `正在安装至 ${distro}…`
 */

/**
 * Patches the source code of dist/provisionSplash.js.
 * @param {string} sourceCode
 * @returns {string} Patched source code
 */
function patchProvisionSplash(sourceCode) {
  if (typeof sourceCode !== 'string') {
    throw new TypeError('patchProvisionSplash requires a string argument');
  }

  let patched = sourceCode;

  // 1. Header template string
  patched = patched.replace(
    /<div>Setting up WSL: \$\{escapeHtml\(distro\)\}<\/div>/g,
    '<div>正在配置 WSL: ${escapeHtml(distro)}</div>'
  );

  // 2. Wrap setStatus to dynamically translate status strings
  if (!patched.includes('正在下载 Antigravity 二进制文件')) {
    const originalSetStatusRegex = /setStatus\s*\(\s*text\s*\)\s*\{[\s\S]*?win\.webContents[\s\S]*?\.catch\(\(\)\s*=>\s*\{[\s\S]*?\}\);?\s*\}/;
    const replacementSetStatus = `setStatus(text) {
            if (win.isDestroyed()) {
                return;
            }
            let localized = text;
            if (localized === 'Downloading the Antigravity binary\\u2026' || localized === 'Downloading the Antigravity binary…') {
                localized = '正在下载 Antigravity 二进制文件…';
            } else if (typeof localized === 'string' && /^Installing into (.+)[…\\u2026]$/.test(localized)) {
                localized = localized.replace(/^Installing into (.+)[…\\u2026]$/, '正在安装至 $1…');
            }
            void win.webContents
                .executeJavaScript(\`document.getElementById('status').textContent = \${JSON.stringify(localized)}\`)
                .catch(() => {
                // Non-fatal: the splash is purely informational.
            });
        }`;

    if (originalSetStatusRegex.test(patched)) {
      patched = patched.replace(originalSetStatusRegex, replacementSetStatus);
    }
  }

  return patched;
}

/**
 * Patches the source code of dist/wsl.js.
 * @param {string} sourceCode
 * @returns {string} Patched source code
 */
function patchWsl(sourceCode) {
  if (typeof sourceCode !== 'string') {
    throw new TypeError('patchWsl requires a string argument');
  }

  let patched = sourceCode;

  // 1. Downloading status message (handling both \u2026 and literal …)
  patched = patched.replace(
    /onStatus\?\.\(['"]Downloading the Antigravity binary(?:\\u2026|…|\.{3})['"]\);/g,
    "onStatus?.('正在下载 Antigravity 二进制文件…');"
  );

  // 2. Installing status message
  patched = patched.replace(
    /onStatus\?\.\(`Installing into \$\{distro\}(?:\\u2026|…|\.{3})`\);/g,
    "onStatus?.(`正在安装至 ${distro}…`);"
  );

  return patched;
}

module.exports = {
  patchProvisionSplash,
  patchWsl
};
