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

  if (patched.includes('正在加载 Antigravity')) {
    return patched; // Already patched
  }

  return patched.replace(LOADING_TEXT_REGEX, REPLACEMENT_HTML);
}

module.exports = {
  patchLoadingOverlay,
  LOADING_TEXT_REGEX,
  REPLACEMENT_HTML
};
