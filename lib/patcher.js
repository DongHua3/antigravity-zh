'use strict';

/**
 * lib/patcher.js
 *
 * Core application patcher engine for Google Antigravity 2.x Chinese localization.
 * Orchestrates:
 * 1. Extraction of app.asar into a secure temporary working tree via lib/asar.js.
 * 2. Injection of the runtime DOM translation engine (with embedded dictionaries)
 *    into dist/preload.js.
 * 3. Application of main-process static & dynamic patches:
 *    - dist/menu.js (bilingual submenu lookup and WSL templates)
 *    - dist/tray.js (dynamic running agent count formatting)
 *    - dist/loadingOverlay.js (startup loading screen HTML)
 *    - dist/ideInstall/wizardHtml.js (IDE install wizard UI strings)
 *    - dist/provisionSplash.js & dist/wsl.js (WSL splash window & status strings)
 *    - dist/main.js & dist/ipcHandlers.js (quit confirmation modal and native dialogs)
 * 4. Repacking of the modified working tree into the destination ASAR archive,
 *    preserving unpack directives and SHA-256 integrity metadata.
 */

process.noAsar = true;

const fs = require('fs');
const path = require('path');
const os = require('os');

const asar = require('./asar');
const { patchMenu } = require('./patches/menu');
const { patchTray } = require('./patches/tray');
const { patchLoadingOverlay } = require('./patches/loadingOverlay');
const { patchWizardHtml } = require('./patches/wizardHtml');
const { patchProvisionSplash, patchWsl } = require('./patches/provisionSplash');
const { patchMain, patchIpcHandlers } = require('./patches/dialogs');
const { getInjectedPreloadSource, loadDefaultDictionaries } = require('./runtime/engine');

/**
 * Traverses an ASAR header tree to collect all files marked with unpacked: true.
 * @param {object} header
 * @returns {string[]}
 */
function getUnpackedFilesFromHeader(header) {
  const unpackedFiles = [];

  function walk(node, curPath) {
    if (!node || !node.files) return;
    for (const [name, child] of Object.entries(node.files)) {
      const rel = curPath ? `${curPath}/${name}` : name;
      if (child.files) {
        walk(child, rel);
      } else if (child.unpacked) {
        unpackedFiles.push(rel);
      }
    }
  }

  walk(header, '');
  return unpackedFiles;
}

/**
 * Loads dictionaries from a specified directory or project default dicts/.
 * @param {string} [customDictsDir]
 * @returns {object} Dictionaries object
 */
function loadDictionaries(customDictsDir) {
  const dictsDir = customDictsDir ? path.resolve(customDictsDir) : path.resolve(__dirname, '..', 'dicts');
  const result = {
    menu: {},
    sidebar: {},
    settings: {},
    common: {},
    regex: []
  };

  const jsonFiles = ['menu.json', 'sidebar.json', 'settings.json', 'common.json'];
  for (const file of jsonFiles) {
    const key = path.basename(file, '.json');
    const p = path.join(dictsDir, file);
    if (fs.existsSync(p)) {
      try {
        result[key] = JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (err) {
        console.warn(`[patcher] Warning: Failed to parse ${file}: ${err.message}`);
      }
    }
  }

  const regexPath = path.join(dictsDir, 'regex.json');
  if (fs.existsSync(regexPath)) {
    try {
      result.regex = JSON.parse(fs.readFileSync(regexPath, 'utf8'));
    } catch (err) {
      console.warn(`[patcher] Warning: Failed to parse regex.json: ${err.message}`);
    }
  }

  return result;
}

/**
 * Injects the runtime DOM translation engine into preload source code.
 * @param {string} preloadSource - Original dist/preload.js content
 * @param {object} [dictionaries] - Optional dictionaries to embed
 * @returns {string} Patched preload source code
 */
function patchPreload(preloadSource, dictionaries) {
  if (typeof preloadSource !== 'string') {
    throw new TypeError('preloadSource must be a string');
  }

  if (preloadSource.includes('__initAntigravityZhEngine__')) {
    return preloadSource; // Already injected
  }

  const injectionBundle = getInjectedPreloadSource(dictionaries);
  return `${injectionBundle}\n\n${preloadSource}`;
}

/**
 * Patches target files within an unpacked directory.
 * @param {string} targetDir - Directory containing unpacked app files
 * @param {object} [options] - Options (dictsDir, verbose, logger)
 * @returns {object} Summary of files patched
 */
function patchDirectory(targetDir, options = {}) {
  const root = path.resolve(targetDir);
  const logger = options.logger || (options.verbose ? console.log : () => {});
  const results = {
    patched: [],
    skipped: [],
    errors: []
  };

  const dicts = options.dictionaries || loadDictionaries(options.dictsDir);

  // File patch registry: relative path -> patch function
  const patchRegistry = [
    {
      relPath: path.join('dist', 'preload.js'),
      name: 'Preload Runtime Engine',
      fn: (content) => patchPreload(content, dicts)
    },
    {
      relPath: path.join('dist', 'menu.js'),
      name: 'Menu Bilingual Lookup & WSL',
      fn: patchMenu
    },
    {
      relPath: path.join('dist', 'tray.js'),
      name: 'Tray Agent Count Formatting',
      fn: patchTray
    },
    {
      relPath: path.join('dist', 'loadingOverlay.js'),
      name: 'Loading Overlay Text',
      fn: patchLoadingOverlay
    },
    {
      relPath: path.join('dist', 'ideInstall', 'wizardHtml.js'),
      name: 'IDE Wizard HTML Strings',
      fn: patchWizardHtml
    },
    {
      relPath: path.join('dist', 'provisionSplash.js'),
      name: 'WSL Provision Splash Window',
      fn: patchProvisionSplash
    },
    {
      relPath: path.join('dist', 'wsl.js'),
      name: 'WSL Download & Install Status Strings',
      fn: patchWsl
    },
    {
      relPath: path.join('dist', 'main.js'),
      name: 'Main Process Dialogs & Quit Confirmation',
      fn: patchMain
    },
    {
      relPath: path.join('dist', 'ipcHandlers.js'),
      name: 'IPC Handlers Workspace Dialogs',
      fn: patchIpcHandlers
    }
  ];

  for (const item of patchRegistry) {
    const fullPath = path.join(root, item.relPath);
    if (!fs.existsSync(fullPath)) {
      results.skipped.push({ file: item.relPath, reason: 'File does not exist in target' });
      continue;
    }

    try {
      const original = fs.readFileSync(fullPath, 'utf8');
      const patched = item.fn(original);
      if (patched !== original) {
        fs.writeFileSync(fullPath, patched, 'utf8');
        logger(`[patcher] Successfully patched ${item.name} (${item.relPath})`);
        results.patched.push(item.relPath);
      } else {
        logger(`[patcher] No modifications needed for ${item.relPath} (already patched or no match)`);
        results.skipped.push({ file: item.relPath, reason: 'Content unchanged' });
      }
    } catch (err) {
      console.error(`[patcher] Error patching ${item.relPath}: ${err.message}`);
      results.errors.push({ file: item.relPath, error: err.message });
    }
  }

  return results;
}

/**
 * Core orchestrator: Unpacks an ASAR archive, applies all patches, and repacks
 * cleanly into destination ASAR.
 *
 * @param {string} srcAsar - Path to input app.asar
 * @param {string} destAsar - Path to output ag_patched.asar
 * @param {object} [options] - Options (dictsDir, verbose, logger)
 * @returns {Promise<boolean>}
 */
async function patchAsar(srcAsar, destAsar, options = {}) {
  const logger = options.logger || (options.verbose ? console.log : () => {});
  const resolvedSrc = path.resolve(srcAsar);
  const resolvedDest = path.resolve(destAsar);

  if (!fs.existsSync(resolvedSrc)) {
    throw new Error(`Source ASAR not found: ${resolvedSrc}`);
  }

  logger(`[patcher] Opening input ASAR: ${resolvedSrc}`);
  const headerInfo = asar.readArchiveHeader(resolvedSrc);
  const unpackedFiles = getUnpackedFilesFromHeader(headerInfo.header);

  logger(`[patcher] Header parsed successfully. Unpacked files count: ${unpackedFiles.length}`);

  // Create temporary scratch directory
  const tempPrefix = path.join(os.tmpdir(), 'ag-patch-');
  const tempDir = fs.mkdtempSync(tempPrefix);
  logger(`[patcher] Extracting ASAR to temporary directory: ${tempDir}`);
  let tempDest = null;

  try {
    asar.extractAll(resolvedSrc, tempDir);
    logger(`[patcher] Extraction complete.`);

    // Apply all patches
    const patchSummary = patchDirectory(tempDir, options);
    logger(`[patcher] Patched ${patchSummary.patched.length} files (${patchSummary.skipped.length} skipped, ${patchSummary.errors.length} errors).`);

    if (patchSummary.errors.length > 0) {
      throw new Error(`Patching failed with ${patchSummary.errors.length} error(s): ${patchSummary.errors.map(e => e.file).join(', ')}`);
    }

    // Repack ASAR
    // If output file is in the same location as input or exists, write to a temp file first
    tempDest = resolvedDest + '.tmp.' + Date.now();
    logger(`[patcher] Repacking ASAR to temporary destination: ${tempDest}`);

    const packOptions = {};
    if (unpackedFiles.length > 0) {
      packOptions.unpack = unpackedFiles;
    }

    asar.createPackage(tempDir, tempDest, packOptions);
    logger(`[patcher] ASAR package created successfully.`);

    // Atomic replace destination
    fs.mkdirSync(path.dirname(resolvedDest), { recursive: true });
    if (fs.existsSync(resolvedDest)) {
      fs.unlinkSync(resolvedDest);
    }
    fs.renameSync(tempDest, resolvedDest);

    // Atomically move/replace companion unpacked directory if it was created
    const tempDestUnpacked = tempDest + '.unpacked';
    const resolvedDestUnpacked = resolvedDest + '.unpacked';
    if (fs.existsSync(tempDestUnpacked)) {
      if (fs.existsSync(resolvedDestUnpacked)) {
        fs.rmSync(resolvedDestUnpacked, { recursive: true, force: true });
      }
      fs.renameSync(tempDestUnpacked, resolvedDestUnpacked);
      logger(`[patcher] Preserved companion unpacked directory: ${resolvedDestUnpacked}`);
    }

    logger(`[patcher] Saved patched ASAR to: ${resolvedDest}`);

    return true;
  } finally {
    // Clean up temporary scratch directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.warn(`[patcher] Warning: Failed to clean up tempDir ${tempDir}:`, cleanupErr.message);
    }

    // Clean up any remaining temporary destination files or unpacked directories
    try {
      if (tempDest && fs.existsSync(tempDest)) {
        fs.rmSync(tempDest, { force: true });
      }
      if (tempDest && fs.existsSync(tempDest + '.unpacked')) {
        fs.rmSync(tempDest + '.unpacked', { recursive: true, force: true });
      }
    } catch (_) {}
  }
}

module.exports = {
  patchAsar,
  patchDirectory,
  patchPreload,
  loadDictionaries,
  getUnpackedFilesFromHeader
};
