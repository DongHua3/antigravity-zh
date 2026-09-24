'use strict';

/**
 * lib/patches/loadingOverlay.js
 *
 * Statically patches dist/loadingOverlay.js in Google Antigravity:
 * Replaces the startup overlay HTML text:
 * <div class="text">Loading Antigravity</div>
 * ->
 * <div class="text">正在加载 Antigravity...</div>
 */

const LOADING_TEXT_REGEX = /<div class="text">Loading Antigravity(?:…|\.{3})?<\/div>/g;
const REPLACEMENT_HTML = '<div class="text">正在加载 Antigravity...</div>';

/**
 * Patches the source code of dist/loadingOverlay.js.
 * @param {string} sourceCode
 * @returns {string} Patched source code
 */
function patchLoadingOverlay(sourceCode) {
  if (typeof sourceCode !== 'string') {
    throw new TypeError('patchLoadingOverlay requires a string argument');
  }

  let patched = sourceCode;

  // 1. Localize loading screen text
  patched = patched.replace(LOADING_TEXT_REGEX, REPLACEMENT_HTML);

  // 2. Add smooth transition buffer (250ms) to eliminate black screen flash before initial paint
  if (!patched.includes('setTimeout(() => {') && patched.includes("win.webContents.once('did-finish-load'")) {
    patched = patched.replace(
      /win\.webContents\.once\('did-finish-load',\s*\(\)\s*=>\s*\{([\s\S]*?win\.off\('resize',\s*updateBounds\);)\s*\}\);/,
      "win.webContents.once('did-finish-load', () => {\n        setTimeout(() => {$1\n        }, 250);\n    });"
    );
  }

  return patched;
}

module.exports = {
  patchLoadingOverlay,
  LOADING_TEXT_REGEX,
  REPLACEMENT_HTML
};
