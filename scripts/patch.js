#!/usr/bin/env node
'use strict';

/**
 * scripts/patch.js
 *
 * Command-line interface for patching Google Antigravity 2.x desktop client ASAR package.
 * Can be executed via standard Node.js or Antigravity's internal Node runtime:
 *   set ELECTRON_RUN_AS_NODE=1
 *   Antigravity.exe scripts/patch.js --src <app.asar> --dest <ag_patched.asar>
 *
 * Options:
 *   --src <path>     Path to the source app.asar file (required or auto-detected)
 *   --dest <path>    Path to the destination patched asar file (default: %TEMP%/ag_patched.asar)
 *   --dicts <path>   Path to custom dictionaries directory (default: <root>/dicts)
 *   --verbose, -v    Enable verbose logging
 *   --help, -h       Show help message
 */

process.noAsar = true;

const fs = require('fs');
const path = require('path');
const os = require('os');
const { patchAsar } = require('../lib/patcher');

function printUsage() {
  console.log(`
Google Antigravity 2.x Chinese Localization Patcher CLI
Usage:
  node scripts/patch.js [options]

Options:
  --src <path>       Path to original app.asar (default: auto-detected in %LOCALAPPDATA%)
  --dest <path>      Path to output patched asar (default: %TEMP%/ag_patched.asar)
  --dicts <path>     Path to custom dicts/ directory
  -v, --verbose      Verbose logging output
  -h, --help         Show this help message

Examples:
  node scripts/patch.js --src "C:\\path\\to\\app.asar" --dest "C:\\temp\\ag_patched.asar"
  ELECTRON_RUN_AS_NODE=1 Antigravity.exe scripts/patch.js --src app.asar --dest patched.asar
`);
}

/**
 * Attempts to automatically discover the installed app.asar location on Windows.
 * @returns {string|null}
 */
function discoverDefaultAppAsar() {
  const candidates = [];

  if (process.env.LOCALAPPDATA) {
    candidates.push(
      path.join(process.env.LOCALAPPDATA, 'Programs', 'Antigravity', 'resources', 'app.asar')
    );
  }

  if (process.env['ProgramFiles']) {
    candidates.push(
      path.join(process.env['ProgramFiles'], 'Antigravity', 'resources', 'app.asar')
    );
  }

  if (process.env['ProgramFiles(x86)']) {
    candidates.push(
      path.join(process.env['ProgramFiles(x86)'], 'Antigravity', 'resources', 'app.asar')
    );
  }

  // Also check local test / inspect directory if present
  candidates.push(
    'C:\\Users\\henry\\AppData\\Local\\Programs\\Antigravity\\resources\\app.asar'
  );

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  return null;
}

function parseArgs(args) {
  const options = {
    src: null,
    dest: null,
    dictsDir: null,
    verbose: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--src') {
      options.src = args[++i];
    } else if (arg.startsWith('--src=')) {
      options.src = arg.slice(6);
    } else if (arg === '--dest') {
      options.dest = args[++i];
    } else if (arg.startsWith('--dest=')) {
      options.dest = arg.slice(7);
    } else if (arg === '--dicts') {
      options.dictsDir = args[++i];
    } else if (arg.startsWith('--dicts=')) {
      options.dictsDir = arg.slice(8);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  let srcPath = options.src;
  if (!srcPath) {
    srcPath = discoverDefaultAppAsar();
    if (srcPath) {
      console.log(`[patch] Auto-detected Antigravity app.asar at: ${srcPath}`);
    } else {
      console.error('[patch] Error: --src parameter missing and Antigravity installation not found.');
      printUsage();
      process.exit(1);
    }
  }

  srcPath = path.resolve(srcPath);
  if (!fs.existsSync(srcPath)) {
    console.error(`[patch] Error: Source ASAR file not found: ${srcPath}`);
    process.exit(1);
  }

  let destPath = options.dest;
  if (!destPath) {
    destPath = path.join(os.tmpdir(), 'ag_patched.asar');
  }
  destPath = path.resolve(destPath);

  console.log(`============================================================`);
  console.log(` Google Antigravity 2.x Chinese Localization Patcher`);
  console.log(`============================================================`);
  console.log(`  Source ASAR:      ${srcPath}`);
  console.log(`  Destination ASAR: ${destPath}`);
  if (options.dictsDir) {
    console.log(`  Dictionaries Dir: ${path.resolve(options.dictsDir)}`);
  }
  console.log(`============================================================\n`);

  const startTime = Date.now();

  try {
    await patchAsar(srcPath, destPath, {
      dictsDir: options.dictsDir,
      verbose: true,
      logger: (msg) => console.log(msg)
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n============================================================`);
    console.log(`\x1b[32m✔ SUCCESS: Antigravity ASAR successfully patched in ${elapsed}s!\x1b[0m`);
    console.log(`  Patched output ready at: ${destPath}`);
    console.log(`============================================================\n`);
    process.exit(0);
  } catch (err) {
    console.error(`\n\x1b[31m[patch] Fatal Error: Patching failed: ${err.message}\x1b[0m`);
    if (options.verbose && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('[patch] Unhandled error:', err);
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
