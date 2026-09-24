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

  // 1. Translate static tray action labels in createTray
  if (!patched.includes('/* --- TRAY TRANSLATION START --- */') && patched.includes('function createTray(actions) {')) {
    const targetCreate = 'function createTray(actions) {';
    const replacementCreate = `function createTray(actions) {
    /* --- TRAY TRANSLATION START --- */
    const translations = {
        'No agents running': '无正在运行的智能体',
        'Open Antigravity': '打开反重力智能编程',
        'Quit': '退出'
    };
    for (const item of actions) {
        if (item && item.label && translations[item.label]) {
            item.label = translations[item.label];
        }
    }
    /* --- TRAY TRANSLATION END --- */`;
    patched = patched.replace(targetCreate, replacementCreate);
  }

  // 2. Double-click tray icon to restore/focus Antigravity
  if (!patched.includes('/* --- TRAY DOUBLE CLICK START --- */') && /tray\.setContextMenu\(contextMenu\);/.test(patched)) {
    const dblClickCode = `tray.setContextMenu(contextMenu);
    /* --- TRAY DOUBLE CLICK START --- */
    const openAction = actions.find(item => item && typeof item.click === 'function' && !['Quit', '退出'].includes(item.label));
    if (openAction) {
        tray.on('double-click', () => {
            const wins = electron_1.BrowserWindow.getAllWindows();
            if (wins.length > 0 && wins[0].isMinimized()) {
                wins[0].restore();
            }
            openAction.click();
        });
    }
    /* --- TRAY DOUBLE CLICK END --- */`;
    patched = patched.replace(/tray\.setContextMenu\(contextMenu\);/, dblClickCode);
  }

  return patched;
}

module.exports = {
  patchTray,
  TRAY_AGENT_COUNT_REGEX,
  REPLACEMENT_EXPRESSION
};
