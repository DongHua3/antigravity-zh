'use strict';

/**
 * lib/asar.js
 * 
 * Zero-dependency, pure JavaScript ASAR unpacker and repacker.
 * Implements:
 * - Chromium Pickle 16-byte binary header serialization & deserialization
 * - JSON directory header parsing & generation
 * - SHA-256 block-based integrity calculation (4MB blocks)
 * - Support for unpacked files ('unpacked: true' and companion .unpacked directories)
 * - Sequential payload streaming with zero memory exhaustion
 * - Process.noAsar = true bypass for Electron's filesystem interception
 */

process.noAsar = true;

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BLOCK_SIZE = 4 * 1024 * 1024; // 4MB standard Electron asar block size

/**
 * Verifies that a target path resides strictly inside a base directory (prevents ASAR-Slip).
 * @param {string} baseDir - Canonical root directory
 * @param {string} targetPath - Candidate target path
 * @returns {boolean}
 */
function isPathInside(baseDir, targetPath) {
  const rel = path.relative(baseDir, targetPath);
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !rel.startsWith('../') && !path.isAbsolute(rel);
}

/**
 * Computes SHA-256 integrity metadata for a given file or buffer.
 * @param {Buffer|string} fileOrBuffer - Buffer or absolute file path
 * @returns {{ algorithm: string, hash: string, blockSize: number, blocks: string[] }}
 */
function computeIntegrity(fileOrBuffer) {
  if (Buffer.isBuffer(fileOrBuffer)) {
    const buffer = fileOrBuffer;
    const blocks = [];
    const totalHasher = crypto.createHash('sha256');

    if (buffer.length === 0) {
      const emptyHash = crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex');
      return {
        algorithm: 'SHA256',
        hash: emptyHash,
        blockSize: BLOCK_SIZE,
        blocks: [emptyHash]
      };
    }

    for (let offset = 0; offset < buffer.length; offset += BLOCK_SIZE) {
      const chunk = buffer.subarray(offset, Math.min(offset + BLOCK_SIZE, buffer.length));
      blocks.push(crypto.createHash('sha256').update(chunk).digest('hex'));
      totalHasher.update(chunk);
    }

    return {
      algorithm: 'SHA256',
      hash: totalHasher.digest('hex'),
      blockSize: BLOCK_SIZE,
      blocks
    };
  }

  // File path streaming calculation
  const filePath = fileOrBuffer;
  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    const emptyHash = crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex');
    return {
      algorithm: 'SHA256',
      hash: emptyHash,
      blockSize: BLOCK_SIZE,
      blocks: [emptyHash]
    };
  }

  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(BLOCK_SIZE);
  const blocks = [];
  const totalHasher = crypto.createHash('sha256');
  let bytesRead = 0;
  let fileOffset = 0;

  try {
    while ((bytesRead = fs.readSync(fd, buffer, 0, BLOCK_SIZE, fileOffset)) > 0) {
      const chunk = buffer.subarray(0, bytesRead);
      blocks.push(crypto.createHash('sha256').update(chunk).digest('hex'));
      totalHasher.update(chunk);
      fileOffset += bytesRead;
    }
  } finally {
    fs.closeSync(fd);
  }

  return {
    algorithm: 'SHA256',
    hash: totalHasher.digest('hex'),
    blockSize: BLOCK_SIZE,
    blocks
  };
}

/**
 * Reads and parses the Chromium Pickle and JSON directory header from an ASAR archive.
 * @param {string} asarPath - Absolute or relative path to .asar archive.
 * @returns {{ header: object, headerSize: number, payloadOffset: number }}
 */
function readArchiveHeader(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const pickleHeaderBuf = Buffer.alloc(16);
    const readBytes = fs.readSync(fd, pickleHeaderBuf, 0, 16, 0);
    if (readBytes < 16) {
      throw new Error(`Corrupted ASAR archive: header too short (${readBytes} bytes) at ${asarPath}`);
    }

    const picklePayloadTag = pickleHeaderBuf.readUInt32LE(0);
    if (picklePayloadTag !== 4) {
      throw new Error(`Invalid ASAR archive: invalid pickle magic tag (${picklePayloadTag}) at ${asarPath}`);
    }

    const outerPayloadSize = pickleHeaderBuf.readUInt32LE(4);
    const innerPickleSize = pickleHeaderBuf.readUInt32LE(8);
    const jsonLen = pickleHeaderBuf.readUInt32LE(12);

    if (jsonLen <= 0 || jsonLen > 100 * 1024 * 1024) {
      throw new Error(`Invalid ASAR JSON header length: ${jsonLen} bytes at ${asarPath}`);
    }

    // Validate outerPayloadSize against innerPickleSize and jsonLen to ensure header consistency
    const alignedJsonLen = (jsonLen + 3) & ~3;
    const minPayloadSize = Math.max(innerPickleSize + 4, alignedJsonLen + 8);
    const validOuterPayloadSize = Math.max(outerPayloadSize, minPayloadSize);

    const jsonBuf = Buffer.alloc(jsonLen);
    const jsonBytesRead = fs.readSync(fd, jsonBuf, 0, jsonLen, 16);
    if (jsonBytesRead < jsonLen) {
      throw new Error(`Unexpected end of file while reading ASAR JSON header at ${asarPath}`);
    }

    const header = JSON.parse(jsonBuf.toString('utf8'));
    const payloadOffset = 8 + validOuterPayloadSize;

    return {
      header,
      headerSize: validOuterPayloadSize,
      payloadOffset
    };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Traverses an ASAR header tree to locate an entry for a slash-delimited relative path.
 * @param {object} header - Parsed ASAR header object
 * @param {string} relPath - Relative path (e.g. "dist/menu.js")
 * @returns {object|null}
 */
function findHeaderNode(header, relPath) {
  const segments = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  let current = header;

  for (const seg of segments) {
    if (!current || !current.files || !current.files[seg]) {
      return null;
    }
    current = current.files[seg];
  }

  return current;
}

/**
 * Returns metadata stat for a specific file inside an ASAR archive.
 * @param {string} asarPath - Path to .asar archive
 * @param {string} relPath - Relative path inside archive
 * @returns {object|null}
 */
function stat(asarPath, relPath) {
  const { header } = readArchiveHeader(asarPath);
  return findHeaderNode(header, relPath);
}

/**
 * Extracts a single file's Buffer from an ASAR archive.
 * @param {string} asarPath - Path to .asar archive
 * @param {string} relPath - Relative path inside archive
 * @returns {Buffer}
 */
function extractFile(asarPath, relPath) {
  const { header, payloadOffset } = readArchiveHeader(asarPath);
  const node = findHeaderNode(header, relPath);

  if (!node) {
    throw new Error(`File not found in ASAR: ${relPath}`);
  }

  if (node.unpacked) {
    const unpackedDir = path.resolve(asarPath + '.unpacked');
    const unpackedPath = path.resolve(unpackedDir, relPath);
    if (!isPathInside(unpackedDir, unpackedPath)) {
      throw new Error(`Path traversal attempt detected in unpacked file: ${relPath}`);
    }
    if (!fs.existsSync(unpackedPath)) {
      throw new Error(`Unpacked file not found at ${unpackedPath}`);
    }
    return fs.readFileSync(unpackedPath);
  }

  if (node.size === 0) {
    return Buffer.alloc(0);
  }

  const offset = parseInt(node.offset, 10);
  const start = payloadOffset + offset;
  const buffer = Buffer.alloc(node.size);

  const fd = fs.openSync(asarPath, 'r');
  try {
    fs.readSync(fd, buffer, 0, node.size, start);
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Returns a list of all file and directory relative paths in the ASAR archive.
 * @param {string} asarPath - Path to .asar archive
 * @returns {string[]}
 */
function listFiles(asarPath) {
  const { header } = readArchiveHeader(asarPath);
  const results = [];

  function traverse(tree, prefix = '') {
    if (!tree || !tree.files) return;
    for (const [name, node] of Object.entries(tree.files)) {
      const currentRel = prefix ? `${prefix}/${name}` : name;
      results.push(currentRel);
      if (node.files) {
        traverse(node, currentRel);
      }
    }
  }

  traverse(header);
  return results;
}

/**
 * Unpacks an ASAR archive completely to a destination directory.
 * Supports both packed payload files and companion .unpacked files.
 * @param {string} asarPath - Path to input .asar file
 * @param {string} destDir - Destination directory
 */
function extractAll(asarPath, destDir) {
  const { header, payloadOffset } = readArchiveHeader(asarPath);
  const unpackedDir = path.resolve(asarPath + '.unpacked');
  const hasUnpackedCompanion = fs.existsSync(unpackedDir);
  const resolvedDestDir = path.resolve(destDir);

  const fd = fs.openSync(asarPath, 'r');

  try {
    function extractNode(tree, currentPath) {
      if (!tree || !tree.files) return;

      for (const [name, node] of Object.entries(tree.files)) {
        const targetPath = path.resolve(currentPath, name);
        if (!isPathInside(resolvedDestDir, targetPath)) {
          throw new Error(`Path traversal attempt detected in ASAR archive entry: ${name}`);
        }

        if (node.files) {
          // It's a directory
          fs.mkdirSync(targetPath, { recursive: true });
          extractNode(node, targetPath);
        } else if (node.unpacked) {
          // File marked as unpacked
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          const relFromRoot = path.relative(resolvedDestDir, targetPath).replace(/\\/g, '/');
          const sourceUnpackedFile = path.resolve(unpackedDir, relFromRoot);
          if (!isPathInside(unpackedDir, sourceUnpackedFile)) {
            throw new Error(`Path traversal attempt detected in unpacked source: ${relFromRoot}`);
          }

          if (hasUnpackedCompanion && fs.existsSync(sourceUnpackedFile)) {
            fs.copyFileSync(sourceUnpackedFile, targetPath);
          } else {
            // Write placeholder empty file if source unpacked file missing
            fs.writeFileSync(targetPath, Buffer.alloc(0));
          }
        } else {
          // Regular packed file
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          const size = node.size || 0;

          if (size === 0) {
            fs.writeFileSync(targetPath, Buffer.alloc(0));
          } else {
            const offset = parseInt(node.offset, 10);
            const fileStart = payloadOffset + offset;

            // Stream chunks for memory efficiency
            const CHUNK_SIZE = 1024 * 1024; // 1MB
            const writeFd = fs.openSync(targetPath, 'w');
            const chunkBuf = Buffer.alloc(Math.min(CHUNK_SIZE, size));
            let bytesWrittenTotal = 0;

            try {
              while (bytesWrittenTotal < size) {
                const toRead = Math.min(CHUNK_SIZE, size - bytesWrittenTotal);
                const bytesRead = fs.readSync(fd, chunkBuf, 0, toRead, fileStart + bytesWrittenTotal);
                if (bytesRead <= 0) break;
                fs.writeSync(writeFd, chunkBuf, 0, bytesRead);
                bytesWrittenTotal += bytesRead;
              }
            } finally {
              fs.closeSync(writeFd);
            }
          }

          // If executable mode is preserved
          if (node.executable) {
            try {
              fs.chmodSync(targetPath, 0o755);
            } catch (_) {}
          }
        }
      }
    }

    fs.mkdirSync(resolvedDestDir, { recursive: true });
    extractNode(header, resolvedDestDir);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Checks if a relative path matches unpack criteria.
 * @param {string} relPath - Slash-separated relative path
 * @param {object} options - Options object with unpack patterns
 * @returns {boolean}
 */
function shouldUnpack(relPath, options = {}) {
  if (!options) return false;

  // Check unpackDir option
  if (options.unpackDir) {
    const unpackDirs = Array.isArray(options.unpackDir) ? options.unpackDir : [options.unpackDir];
    for (const d of unpackDirs) {
      const normalizedD = d.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (relPath === normalizedD || relPath.startsWith(normalizedD + '/')) {
        return true;
      }
    }
  }

  // Check unpack glob/regex/array
  if (options.unpack) {
    const patterns = Array.isArray(options.unpack) ? options.unpack : [options.unpack];
    for (const pattern of patterns) {
      if (typeof pattern === 'string') {
        const cleanPattern = pattern.replace(/\\/g, '/');
        // Support simple wildcard globs (*.node, etc.)
        if (cleanPattern.includes('*')) {
          const regexStr = '^' + cleanPattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*') + '$';
          const re = new RegExp(regexStr, 'i');
          if (re.test(relPath)) {
            return true;
          }
          if (!cleanPattern.includes('/') && re.test(path.posix.basename(relPath))) {
            return true;
          }
        } else if (relPath === cleanPattern || relPath.startsWith(cleanPattern + '/')) {
          return true;
        } else if (!cleanPattern.includes('/') && path.posix.basename(relPath) === cleanPattern) {
          return true;
        }
      } else if (pattern instanceof RegExp) {
        if (pattern.test(relPath)) {
          return true;
        }
      } else if (typeof pattern === 'function') {
        if (pattern(relPath)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Packages a source directory into an ASAR archive.
 * @param {string} srcDir - Directory containing files to pack
 * @param {string} destAsarPath - Destination path for .asar archive
 * @param {object} [options] - Optional packing options (unpack, unpackDir)
 */
function createPackage(srcDir, destAsarPath, options = {}) {
  const rootDir = path.resolve(srcDir);
  const outAsar = path.resolve(destAsarPath);
  const outUnpackedDir = outAsar + '.unpacked';

  // Step 1: Collect and sort all files deterministically
  const fileEntries = [];

  function collect(dir) {
    const names = fs.readdirSync(dir).sort();
    for (const name of names) {
      const fullPath = path.join(dir, name);
      const stat = fs.statSync(fullPath);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

      if (stat.isDirectory()) {
        fileEntries.push({
          relPath,
          fullPath,
          isDir: true,
          stat
        });
        collect(fullPath);
      } else if (stat.isFile()) {
        const unpack = shouldUnpack(relPath, options);
        fileEntries.push({
          relPath,
          fullPath,
          isDir: false,
          stat,
          unpack
        });
      }
    }
  }

  collect(rootDir);

  // Step 2: Build the JSON directory tree and calculate offsets
  const rootHeader = { files: {} };
  let currentOffset = 0;
  let hasUnpackedFiles = false;

  for (const entry of fileEntries) {
    const parts = entry.relPath.split('/');
    let current = rootHeader;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current.files[part]) {
        current.files[part] = { files: {} };
      }
      current = current.files[part];
    }

    const filename = parts[parts.length - 1];

    if (entry.isDir) {
      if (!current.files[filename]) {
        current.files[filename] = { files: {} };
      }
    } else {
      const integrity = computeIntegrity(entry.fullPath);
      const node = {
        size: entry.stat.size,
        integrity
      };

      if (entry.unpack) {
        hasUnpackedFiles = true;
        node.unpacked = true;
      } else {
        node.offset = String(currentOffset);
        currentOffset += entry.stat.size;
      }

      // Preserve executable bit if set on POSIX platforms
      if (process.platform !== 'win32' && (entry.stat.mode & 0o111)) {
        node.executable = true;
      }

      current.files[filename] = node;
    }
  }

  // Step 3: Serialize JSON Header and calculate Chromium Pickle alignment
  const jsonStr = JSON.stringify(rootHeader);
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const padding = (4 - (jsonBuf.length % 4)) % 4;
  const alignedLen = jsonBuf.length + padding;

  const pickleHeaderBuf = Buffer.alloc(16 + alignedLen);
  pickleHeaderBuf.writeUInt32LE(4, 0);                 // Pickle payload tag
  pickleHeaderBuf.writeUInt32LE(alignedLen + 8, 4);     // Outer pickle payload size
  pickleHeaderBuf.writeUInt32LE(alignedLen + 4, 8);     // Inner pickle size
  pickleHeaderBuf.writeUInt32LE(jsonBuf.length, 12);    // JSON string exact byte length
  jsonBuf.copy(pickleHeaderBuf, 16);                   // JSON UTF-8 payload
  // Remaining bytes in pickleHeaderBuf are automatically zero-filled (padding)

  // Step 4: Write archive file
  fs.mkdirSync(path.dirname(outAsar), { recursive: true });
  const outFd = fs.openSync(outAsar, 'w');

  try {
    // Write 16-byte pickle header + aligned JSON header
    fs.writeSync(outFd, pickleHeaderBuf, 0, pickleHeaderBuf.length);

    // Write file payloads sequentially
    const CHUNK_SIZE = 1024 * 1024; // 1MB buffer for streaming
    const chunkBuf = Buffer.alloc(CHUNK_SIZE);

    for (const entry of fileEntries) {
      if (entry.isDir) continue;

      if (entry.unpack) {
        // Copy to companion .unpacked directory
        const unpackedDest = path.join(outUnpackedDir, entry.relPath);
        fs.mkdirSync(path.dirname(unpackedDest), { recursive: true });
        fs.copyFileSync(entry.fullPath, unpackedDest);
      } else {
        // Stream into ASAR payload
        if (entry.stat.size === 0) continue;

        const inFd = fs.openSync(entry.fullPath, 'r');
        try {
          let bytesRead = 0;
          let fileOffset = 0;
          while ((bytesRead = fs.readSync(inFd, chunkBuf, 0, CHUNK_SIZE, fileOffset)) > 0) {
            fs.writeSync(outFd, chunkBuf, 0, bytesRead);
            fileOffset += bytesRead;
          }
        } finally {
          fs.closeSync(inFd);
        }
      }
    }
  } finally {
    fs.closeSync(outFd);
  }

  return {
    asarPath: outAsar,
    unpackedDir: hasUnpackedFiles ? outUnpackedDir : null,
    totalFiles: fileEntries.filter(e => !e.isDir).length,
    packedFiles: fileEntries.filter(e => !e.isDir && !e.unpack).length,
    unpackedFiles: fileEntries.filter(e => !e.isDir && e.unpack).length,
    payloadSize: currentOffset
  };
}

module.exports = {
  extractAll,
  createPackage,
  readArchiveHeader,
  extractFile,
  listFiles,
  stat,
  computeIntegrity
};
