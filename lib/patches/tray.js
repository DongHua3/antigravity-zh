'use strict';

/**
 * lib/patches/tray.js
 *
 * Patches dist/tray.js in Google Antigravity:
 * Localizes the dynamic agent count label formatted in updateTrayAgentCount:
 * (count > 0 ? `${count}` : 'No') + ' agent' + (count === 1 ? '' : 's') + ' running'
 * ->
 * (count > 0 ? `${count} 个智能体正在运行` : '无正在运行的智能体')
 */

const TRAY_AGENT_COUNT_REGEX = /\(count\s*>\s*0\s*\?\s*`\$\{count\}`\s*:\s*['"]No['"]\)\s*\+\s*['"]\s*agent['"]\s*\+\s*\(count\s*===\s*1\s*\?\s*['"]['"]\s*:\s*['"]s['"]\)\s*\+\s*['"]\s*running['"]/g;

const REPLACEMENT_EXPRESSION = `(count > 0 ? \`\${count} 个智能体正在运行\` : '无正在运行的智能体')`;

/**
 * Patches the source code of dist/tray.js.
 * @param {string} sourceCode
 * @returns {string} Patched source code
 */
function patchTray(sourceCode) {
  if (typeof sourceCode !== 'string') {
    throw new TypeError('patchTray requires a string argument');
  }

  let patched = sourceCode;

  if (patched.includes('个智能体正在运行')) {
    return patched; // Already patched
  }

  if (TRAY_AGENT_COUNT_REGEX.test(patched)) {
    patched = patched.replace(TRAY_AGENT_COUNT_REGEX, REPLACEMENT_EXPRESSION);
  } else {
    // Fallback: search for broader pattern matching the count formatting
    const broaderRegex = /\(count\s*>\s*0\s*\?[\s\S]*?' running'/;
    if (broaderRegex.test(patched)) {
      patched = patched.replace(broaderRegex, REPLACEMENT_EXPRESSION);
    }
  }

  return patched;
}

module.exports = {
  patchTray,
  TRAY_AGENT_COUNT_REGEX,
  REPLACEMENT_EXPRESSION
};
