'use strict';

/**
 * lib/patches/menu.js
 *
 * Patches dist/menu.js in Google Antigravity:
 * 1. Replaces addItemToSubmenu with bilingual alias lookup (SUBMENU_LABEL_ALIASES)
 *    so that asynchronous WSL menu mounting ('Connect to WSL', 'Reopen Locally')
 *    succeeds without breaking when menus are localized (e.g. 'File' <-> '文件', 'Help' <-> '帮助').
 * 2. Normalizes accelerator mnemonics ('&', '(&F)').
 * 3. Localizes WSL and top-level menu item templates:
 *    - 'Connect to WSL' -> '连接到 WSL'
 *    - 'Reopen Locally' -> '在本地重新打开'
 *    - 'New Window'     -> '新建窗口'
 *    - 'Docs'           -> '文档'
 */

const SUBMENU_LABEL_ALIASES = {
  'File': ['File', '文件'],
  'Help': ['Help', '帮助'],
  'Edit': ['Edit', '编辑'],
  'View': ['View', '视图'],
  'Window': ['Window', '窗口'],
  'Antigravity': ['Antigravity', '应用']
};

/**
 * Normalizes a menu label by removing accelerator keys and mnemonics.
 * e.g. '&File', '文件(&F)', 'Help (H)' -> 'file', '文件', 'help'
 * @param {string} label
 * @returns {string}
 */
function normalizeMenuLabel(label) {
  if (!label || typeof label !== 'string') return '';
  return label
    .replace(/&/g, '')
    .replace(/\s*\([A-Za-z0-9]\)/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Checks if a menu item's label matches the target submenu label,
 * supporting bilingual aliases and accelerator variations.
 * @param {string} itemLabel
 * @param {string} targetLabel
 * @returns {boolean}
 */
function matchesSubmenu(itemLabel, targetLabel) {
  const normItem = normalizeMenuLabel(itemLabel);
  const normTarget = normalizeMenuLabel(targetLabel);
  if (!normItem || !normTarget) return false;
  if (normItem === normTarget) return true;

  for (const group of Object.values(SUBMENU_LABEL_ALIASES)) {
    const normGroup = group.map(normalizeMenuLabel);
    if (normGroup.includes(normTarget) && normGroup.includes(normItem)) {
      return true;
    }
  }

  return false;
}

const BILINGUAL_ADD_ITEM_SNIPPET = `
const SUBMENU_LABEL_ALIASES = {
  'File': ['File', '文件'],
  'Help': ['Help', '帮助'],
  'Edit': ['Edit', '编辑'],
  'View': ['View', '视图'],
  'Window': ['Window', '窗口'],
  'Antigravity': ['Antigravity', '应用']
};

function normalizeMenuLabel(label) {
  if (!label || typeof label !== 'string') return '';
  return label.replace(/&/g, '').replace(/\\s*\\([A-Za-z0-9]\\)/g, '').trim().toLowerCase();
}

function matchesSubmenu(itemLabel, targetLabel) {
  const normItem = normalizeMenuLabel(itemLabel);
  const normTarget = normalizeMenuLabel(targetLabel);
  if (!normItem || !normTarget) return false;
  if (normItem === normTarget) return true;
  for (const group of Object.values(SUBMENU_LABEL_ALIASES)) {
    const normGroup = group.map(normalizeMenuLabel);
    if (normGroup.includes(normTarget) && normGroup.includes(normItem)) {
      return true;
    }
  }
  return false;
}

function addItemToSubmenu(appMenu, submenuLabel, position, item) {
  if (!appMenu || !appMenu.items) return;
  const submenuItem = appMenu.items.find((item) => matchesSubmenu(item?.label, submenuLabel));
  if (!submenuItem?.submenu) {
    return;
  }
  submenuItem.submenu.insert(position, item);
}
`;

/**
 * Robustly replaces a top-level function declaration by counting balanced braces,
 * ignoring braces inside strings and comments. Avoids regex greediness and indentation traps.
 * @param {string} sourceCode
 * @param {string} functionName
 * @param {string} replacement
 * @returns {string}
 */
function replaceFunction(sourceCode, functionName, replacement) {
  const funcHeaderRegex = new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`);
  const match = funcHeaderRegex.exec(sourceCode);
  if (!match) return sourceCode;

  const startIndex = match.index;
  const braceStartIndex = startIndex + match[0].length - 1; // position of initial '{'

  let braceCount = 1;
  let inString = false;
  let stringChar = '';
  let inComment = false;
  let commentType = '';
  let inRegex = false;
  let endIndex = -1;

  for (let i = braceStartIndex + 1; i < sourceCode.length; i++) {
    const char = sourceCode[i];
    const prevChar = sourceCode[i - 1];

    if (inComment) {
      if (commentType === '//' && char === '\n') {
        inComment = false;
      } else if (commentType === '/*' && prevChar === '*' && char === '/') {
        inComment = false;
      }
      continue;
    }

    if (inRegex) {
      if (char === '/') {
        let backslashes = 0;
        let k = i - 1;
        while (k >= braceStartIndex && sourceCode[k] === '\\') {
          backslashes++;
          k--;
        }
        if (backslashes % 2 === 0) {
          inRegex = false;
        }
      }
      continue;
    }

    if (inString) {
      if (char === stringChar) {
        let backslashes = 0;
        let k = i - 1;
        while (k >= braceStartIndex && sourceCode[k] === '\\') {
          backslashes++;
          k--;
        }
        if (backslashes % 2 === 0) {
          inString = false;
        }
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      inString = true;
      stringChar = char;
      continue;
    }

    if (char === '/' && sourceCode[i + 1] === '/') {
      inComment = true;
      commentType = '//';
      i++;
      continue;
    }
    if (char === '/' && sourceCode[i + 1] === '*') {
      inComment = true;
      commentType = '/*';
      i++;
      continue;
    }

    // Check if '/' starts a regex literal (preceded by punctuation/operators)
    if (char === '/') {
      let prevNonWs = '';
      for (let k = i - 1; k >= braceStartIndex; k--) {
        if (!/\s/.test(sourceCode[k])) {
          prevNonWs = sourceCode[k];
          break;
        }
      }
      if (/[\(=:,;!&|?{\[]/.test(prevNonWs)) {
        inRegex = true;
        continue;
      }
    }

    if (char === '{') {
      braceCount++;
    } else if (char === '}') {
      braceCount--;
      if (braceCount === 0) {
        endIndex = i + 1;
        break;
      }
    }
  }

  if (endIndex !== -1) {
    return sourceCode.slice(0, startIndex) + replacement + sourceCode.slice(endIndex);
  }

  return sourceCode;
}

/**
 * Patches the source code of dist/menu.js.
 * @param {string} sourceCode
 * @returns {string} Patched source code
 */
function patchMenu(sourceCode) {
  if (typeof sourceCode !== 'string') {
    throw new TypeError('patchMenu requires a string argument');
  }

  let patched = sourceCode;

  // 1. Replace addItemToSubmenu with bilingual alias lookup using brace-balanced extraction
  if (!patched.includes('SUBMENU_LABEL_ALIASES')) {
    patched = replaceFunction(patched, 'addItemToSubmenu', BILINGUAL_ADD_ITEM_SNIPPET.trim());
  }

  // 2. Localize WSL menu item templates and standard items
  patched = patched.replace(/(label:\s*['"])Connect to WSL(['"])/g, '$1连接到 WSL$2');
  patched = patched.replace(/(label:\s*['"])Reopen Locally(['"])/g, '$1在本地重新打开$2');
  patched = patched.replace(/(label:\s*['"])New Window(['"])/g, '$1新建窗口$2');
  patched = patched.replace(/(label:\s*['"])Docs(['"])/g, '$1文档$2');

  return patched;
}

module.exports = {
  patchMenu,
  SUBMENU_LABEL_ALIASES,
  normalizeMenuLabel,
  matchesSubmenu,
  BILINGUAL_ADD_ITEM_SNIPPET
};
