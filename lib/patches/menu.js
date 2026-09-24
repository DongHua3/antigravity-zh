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
 * Patches the source code of dist/menu.js.
 * @param {string} sourceCode
 * @returns {string} Patched source code
 */
function patchMenu(sourceCode) {
  if (typeof sourceCode !== 'string') {
    throw new TypeError('patchMenu requires a string argument');
  }

  let patched = sourceCode;

  // 1. Replace addItemToSubmenu with bilingual alias lookup
  if (!patched.includes('SUBMENU_LABEL_ALIASES')) {
    const funcRegex = /function\s+addItemToSubmenu\s*\([^)]*\)\s*\{[\s\S]*?\n\}/;
    if (funcRegex.test(patched)) {
      patched = patched.replace(funcRegex, BILINGUAL_ADD_ITEM_SNIPPET.trim());
    }
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
