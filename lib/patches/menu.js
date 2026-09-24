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

const NATIVE_MENU_TRANSLATION_SNIPPET = `
const MENU_TRANSLATIONS = {
  'File': '文件',
  'Edit': '编辑',
  'View': '视图',
  'Window': '窗口',
  'Help': '帮助',
  'New Window': '新建窗口',
  'Create Project': '创建项目',
  'Command Palette': '命令面板',
  'Docs': '文档',
  'Check for Updates': '检查更新',
  'Toggle Developer Tools': '切换开发者工具',
  'Undo': '撤销',
  'Redo': '重做',
  'Cut': '剪切',
  'Copy': '复制',
  'Paste': '粘贴',
  'Select All': '全选',
  'Minimize': '最小化',
  'Maximize': '最大化',
  'Close': '关闭',
  'Zoom': '缩放',
  'Reset Zoom': '重置缩放',
  'Zoom In': '放大',
  'Zoom Out': '缩小',
  'Toggle Full Screen': '切换全屏',
  'Split Terminal': '拆分终端',
  'Split Conversation Horizontally': '水平拆分会话',
  'Split Conversation Vertically': '垂直拆分会话',
  'Find in conversation': '在会话中查找',
  'Connect to WSL': '连接到 WSL',
  'Reopen Locally': '在本地重新打开',
  'Version': '版本'
};

function translateNativeMenu(menuInstance) {
  if (!menuInstance || !menuInstance.items) return;
  for (const item of menuInstance.items) {
    let label = item.label || '';
    let mnemonic = '';
    let cleanLabel = label;
    const m = label.match(/&([a-zA-Z])/);
    if (m) {
      mnemonic = '(&' + m[1] + ')';
      cleanLabel = label.replace('&', '');
    }
    if (MENU_TRANSLATIONS[cleanLabel]) {
      item.label = MENU_TRANSLATIONS[cleanLabel] + mnemonic;
    } else if (MENU_TRANSLATIONS[label]) {
      item.label = MENU_TRANSLATIONS[label];
    } else if (/^Version\\s*([\\d\\.]*)$/i.test(cleanLabel)) {
      item.label = cleanLabel.replace(/^Version\\s*([\\d\\.]*)$/i, (match, v) => v ? '版本 ' + v : '版本');
    }
    if (item.submenu) {
      translateNativeMenu(item.submenu);
    }
  }
}
`;

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

  // 3. Inject recursive native menu translation before electron.Menu.setApplicationMenu(menu)
  if (!patched.includes('translateNativeMenu(menu);')) {
    patched = patched.replace(
      /electron_1\.Menu\.setApplicationMenu\(menu\);/g,
      'translateNativeMenu(menu);\n    electron_1.Menu.setApplicationMenu(menu);'
    );
    patched = patched + '\n' + NATIVE_MENU_TRANSLATION_SNIPPET;
  }

  return patched;
}

module.exports = {
  patchMenu,
  SUBMENU_LABEL_ALIASES,
  normalizeMenuLabel,
  matchesSubmenu,
  BILINGUAL_ADD_ITEM_SNIPPET,
  NATIVE_MENU_TRANSLATION_SNIPPET
};
