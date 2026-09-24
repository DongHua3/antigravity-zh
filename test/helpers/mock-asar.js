/**
 * Pure JavaScript Chromium Pickle ASAR unpacker and repacker oracle.
 * Zero external dependencies. Uses only Node.js built-ins: fs, path, crypto.
 */

process.noAsar = true;

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BLOCK_SIZE = 4 * 1024 * 1024; // 4MB standard Electron ASAR block size

/**
 * Computes Electron ASAR SHA256 integrity metadata.
 * @param {Buffer} buffer
 * @returns {{ algorithm: string, hash: string, blockSize: number, blocks: string[] }}
 */
function computeIntegrity(buffer) {
  const blocks = [];
  const fullHasher = crypto.createHash('sha256');

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
    const end = Math.min(offset + BLOCK_SIZE, buffer.length);
    const chunk = buffer.subarray(offset, end);
    blocks.push(crypto.createHash('sha256').update(chunk).digest('hex'));
    fullHasher.update(chunk);
  }

  return {
    algorithm: 'SHA256',
    hash: fullHasher.digest('hex'),
    blockSize: BLOCK_SIZE,
    blocks
  };
}

/**
 * Reads and parses the ASAR header pickle.
 * @param {string|Buffer} asarInput - File path or buffer
 * @returns {{ header: object, headerSize: number, payloadOffset: number, rawHeaderBuf: Buffer }}
 */
function readArchiveHeader(asarInput) {
  let fd = null;
  let headerBuf;

  try {
    if (typeof asarInput === 'string') {
      if (!fs.existsSync(asarInput)) {
        throw new Error(`ASAR file not found: ${asarInput}`);
      }
      const stat = fs.statSync(asarInput);
      if (stat.size < 16) {
        throw new Error(`Invalid ASAR archive: file size (${stat.size} bytes) is smaller than 16-byte pickle header`);
      }

      fd = fs.openSync(asarInput, 'r');
      const prefixBuf = Buffer.alloc(16);
      fs.readSync(fd, prefixBuf, 0, 16, 0);

      const u0 = prefixBuf.readUInt32LE(0);
      if (u0 !== 4) {
        throw new Error(`Invalid ASAR archive: invalid pickle magic uint32 (expected 4, got ${u0})`);
      }

      const outerPayloadSize = prefixBuf.readUInt32LE(4);
      const headerPicklePayloadSize = prefixBuf.readUInt32LE(8);
      const jsonLen = prefixBuf.readUInt32LE(12);

      const alignedHeaderLen = (jsonLen + 3) & ~3;
      if (outerPayloadSize !== alignedHeaderLen + 8 || headerPicklePayloadSize !== alignedHeaderLen + 4) {
        throw new Error(
          `Invalid ASAR archive: corrupt pickle header sizing (outer=${outerPayloadSize}, headerPickle=${headerPicklePayloadSize}, alignedLen=${alignedHeaderLen})`
        );
      }

      const fullHeaderSize = 16 + alignedHeaderLen;
      if (stat.size < fullHeaderSize) {
        throw new Error(
          `Invalid ASAR archive: file size (${stat.size}) smaller than header size (${fullHeaderSize})`
        );
      }

      headerBuf = Buffer.alloc(jsonLen);
      fs.readSync(fd, headerBuf, 0, jsonLen, 16);

      let parsedHeader;
      try {
        parsedHeader = JSON.parse(headerBuf.toString('utf8'));
      } catch (err) {
        throw new Error(`Corrupt ASAR header JSON: ${err.message}`);
      }

      return {
        header: parsedHeader,
        headerSize: fullHeaderSize,
        payloadOffset: fullHeaderSize,
        rawHeaderBuf: prefixBuf
      };
    } else if (Buffer.isBuffer(asarInput)) {
      if (asarInput.length < 16) {
        throw new Error(`Invalid ASAR buffer: size (${asarInput.length} bytes) is smaller than 16 bytes`);
      }

      const u0 = asarInput.readUInt32LE(0);
      if (u0 !== 4) {
        throw new Error(`Invalid ASAR archive: invalid pickle magic uint32 (expected 4, got ${u0})`);
      }

      const outerPayloadSize = asarInput.readUInt32LE(4);
      const headerPicklePayloadSize = asarInput.readUInt32LE(8);
      const jsonLen = asarInput.readUInt32LE(12);

      const alignedHeaderLen = (jsonLen + 3) & ~3;
      if (outerPayloadSize !== alignedHeaderLen + 8 || headerPicklePayloadSize !== alignedHeaderLen + 4) {
        throw new Error(
          `Invalid ASAR archive: corrupt pickle header sizing (outer=${outerPayloadSize}, headerPickle=${headerPicklePayloadSize}, alignedLen=${alignedHeaderLen})`
        );
      }

      const fullHeaderSize = 16 + alignedHeaderLen;
      if (asarInput.length < fullHeaderSize) {
        throw new Error(`Invalid ASAR buffer: buffer length smaller than header size`);
      }

      const jsonStr = asarInput.subarray(16, 16 + jsonLen).toString('utf8');
      let parsedHeader;
      try {
        parsedHeader = JSON.parse(jsonStr);
      } catch (err) {
        throw new Error(`Corrupt ASAR header JSON: ${err.message}`);
      }

      return {
        header: parsedHeader,
        headerSize: fullHeaderSize,
        payloadOffset: fullHeaderSize,
        rawHeaderBuf: asarInput.subarray(0, 16)
      };
    } else {
      throw new Error('asarInput must be a file path string or Buffer');
    }
  } finally {
    if (fd !== null) {
      fs.closeSync(fd);
    }
  }
}

/**
 * Extracts all files from an ASAR archive to destDir.
 * @param {string} asarPath - Absolute path to .asar archive
 * @param {string} destDir - Destination directory
 */
function extractAll(asarPath, destDir) {
  const { header, payloadOffset } = readArchiveHeader(asarPath);
  const fd = fs.openSync(asarPath, 'r');

  try {
    fs.mkdirSync(destDir, { recursive: true });

    function walk(node, currentPath) {
      if (node.files) {
        fs.mkdirSync(currentPath, { recursive: true });
        for (const childName of Object.keys(node.files).sort()) {
          walk(node.files[childName], path.join(currentPath, childName));
        }
      } else if (typeof node.size === 'number') {
        if (node.unpacked) {
          // Unpacked file, skips ASAR payload
          return;
        }
        const fileOffset = payloadOffset + parseInt(node.offset, 10);
        const fileBuf = Buffer.alloc(node.size);
        fs.readSync(fd, fileBuf, 0, node.size, fileOffset);
        fs.mkdirSync(path.dirname(currentPath), { recursive: true });
        fs.writeFileSync(currentPath, fileBuf);
      }
    }

    walk(header, destDir);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Creates an ASAR archive from a directory.
 * @param {string} srcDir - Source directory to pack
 * @param {string} destAsarPath - Target .asar archive path
 */
function createPackage(srcDir, destAsarPath) {
  if (!fs.existsSync(srcDir)) {
    throw new Error(`Source directory does not exist: ${srcDir}`);
  }

  // 1. Collect all files and build directory tree
  const fileEntries = [];
  let currentOffset = 0;

  function scanDir(dir, relPath) {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const tree = { files: {} };

    for (const ent of entries) {
      const fullChild = path.join(dir, ent.name);
      const childRel = relPath ? `${relPath}/${ent.name}` : ent.name;

      if (ent.isDirectory()) {
        tree.files[ent.name] = scanDir(fullChild, childRel);
      } else if (ent.isFile()) {
        const buf = fs.readFileSync(fullChild);
        const integrity = computeIntegrity(buf);
        const size = buf.length;
        const offsetStr = String(currentOffset);
        currentOffset += size;

        tree.files[ent.name] = {
          size,
          offset: offsetStr,
          integrity
        };

        fileEntries.push({
          fullPath: fullChild,
          size,
          buf
        });
      }
    }

    return tree;
  }

  const headerTree = scanDir(srcDir, '');

  // 2. Format JSON header
  const jsonStr = JSON.stringify(headerTree);
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const jsonLen = jsonBuf.length;

  const padding = (4 - (jsonLen % 4)) % 4;
  const alignedHeaderLen = jsonLen + padding;

  // 3. Construct 16-byte pickle header
  const pickleHeader = Buffer.alloc(16);
  pickleHeader.writeUInt32LE(4, 0);                        // pickle uint32 tag
  pickleHeader.writeUInt32LE(alignedHeaderLen + 8, 4);      // outer payload size
  pickleHeader.writeUInt32LE(alignedHeaderLen + 4, 8);      // header pickle payload size
  pickleHeader.writeUInt32LE(jsonLen, 12);                  // JSON string byte length

  const paddingBuf = Buffer.alloc(padding, 0);

  // 4. Assemble output buffers
  const outFd = fs.openSync(destAsarPath, 'w');
  try {
    fs.writeSync(outFd, pickleHeader);
    fs.writeSync(outFd, jsonBuf);
    if (padding > 0) {
      fs.writeSync(outFd, paddingBuf);
    }

    for (const entry of fileEntries) {
      fs.writeSync(outFd, entry.buf);
    }
  } finally {
    fs.closeSync(outFd);
  }
}

module.exports = {
  computeIntegrity,
  readArchiveHeader,
  extractAll,
  createPackage,
  BLOCK_SIZE
};
