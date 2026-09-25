/**
 * Packs the deployment bundle into one zip the server can extract.
 *
 *   npm run build
 *   npm run build:cpanel
 *   npm run pack:cpanel
 *
 * Why this exists rather than "right-click, Send to, Compressed folder":
 * that produced a 0-byte file, a 6.73MB file and a 37.24MB file for the
 * same 628MB folder on three consecutive attempts, and each one looked
 * like a finished archive until the server failed to extract it. Windows
 * PowerShell's Compress-Archive is no better for this job — it writes
 * entry names with backslashes, which the zip format does not allow, so
 * Linux extractors either refuse the archive or create files literally
 * named "a\b\c" in one flat directory.
 *
 * So the zip is written here, to the letter of the format: forward
 * slashes, one deflate stream per file, a central directory at the end,
 * and ZIP64 records when the entry count or an offset outgrows the
 * 16- and 32-bit fields in the classic layout.
 *
 * Every file is verified after writing by reading the archive back and
 * comparing entry count and CRCs. An archive that cannot be read here
 * will not be uploaded.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const SOURCE = "cpanel-dist";

/**
 * Where the archive lands. Defaults to the project folder; override it
 * when that folder is synced:
 *
 *   npm run pack:cpanel -- --out D:/deploy/cpanel-dist.zip
 *
 * A sync client is not a neutral bystander here. OneDrive held this file
 * open for upload, so the next run could not replace it ("Device or
 * resource busy"), and on an earlier run it restored its own older copy
 * mid-write, leaving the verifier reading 6414 entries out of a file that
 * had just been written with 5528. Both failures look like a broken
 * packer and are not.
 */
const outArg = process.argv.indexOf("--out");
const OUT = outArg > -1 && process.argv[outArg + 1] ? process.argv[outArg + 1] : "cpanel-dist.zip";

/**
 * The archive is built under this name and renamed only once it has been
 * verified, so a half-written file never looks like a finished one.
 */
const TEMP = OUT + ".building";

/**
 * Above this a file is stored rather than deflated. Set high enough to
 * cover the ffmpeg binary, which is the single biggest file in the
 * bundle and compresses to well under half its size — storing it cost
 * more upload than the deflate cost in CPU.
 */
const DEFLATE_LIMIT = 256 * 1024 * 1024;
/**
 * Formats that carry their own compression, where deflate only burns CPU
 * for a percent or two. Native modules (.node) and executables are NOT
 * on this list: they are plain binaries and roughly halve.
 */
const ALREADY_COMPRESSED = new Set([".zip", ".gz", ".tgz", ".br", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".woff", ".woff2", ".mp4", ".webm"]);

const MAX16 = 0xffff;
const MAX32 = 0xffffffff;

function fail(message) {
  console.error("pack:cpanel — " + message);
  process.exit(1);
}

if (!fs.existsSync(SOURCE)) {
  fail(`${SOURCE}/ does not exist. Run \`npm run build\` then \`npm run build:cpanel\` first.`);
}

/** crc32 arrived in Node 20.15; the table is here for anything older. */
const crc32 =
  typeof zlib.crc32 === "function"
    ? (buf) => zlib.crc32(buf)
    : (() => {
        const table = new Int32Array(256);
        for (let i = 0; i < 256; i++) {
          let c = i;
          for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
          table[i] = c;
        }
        return (buf) => {
          let c = -1;
          for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
          return (c ^ -1) >>> 0;
        };
      })();

/** Every file under `dir`, as paths relative to it, with forward slashes. */
function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

/** MS-DOS date and time, which is what the zip header carries. */
function dosTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const files = walk(SOURCE).sort();
if (!files.length) fail(`${SOURCE}/ is empty.`);

console.log(`packing ${files.length} files from ${SOURCE}/`);

fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.rmSync(TEMP, { force: true });
const fd = fs.openSync(TEMP, "w");
let offset = 0;

function write(buf) {
  fs.writeSync(fd, buf, 0, buf.length, offset);
  offset += buf.length;
}

const central = [];
let done = 0;
let rawTotal = 0;

for (const name of files) {
  const full = path.join(SOURCE, name);
  const stat = fs.statSync(full);
  const raw = fs.readFileSync(full);
  rawTotal += raw.length;

  const skipDeflate = raw.length > DEFLATE_LIMIT || ALREADY_COMPRESSED.has(path.extname(name).toLowerCase());
  const body = skipDeflate ? raw : zlib.deflateRawSync(raw, { level: 6 });
  // Deflate can grow incompressible input; store it in that case.
  const useDeflate = !skipDeflate && body.length < raw.length;
  const payload = useDeflate ? body : raw;
  const method = useDeflate ? 8 : 0;

  const crc = crc32(raw);
  const { time, date } = dosTime(stat.mtime);
  const nameBuf = Buffer.from(name, "utf8");
  const localOffset = offset;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  write(local);
  write(nameBuf);
  write(payload);

  central.push({ name: nameBuf, method, time, date, crc, comp: payload.length, size: raw.length, localOffset });

  if (++done % 2000 === 0) console.log(`  ${done}/${files.length}`);
}

// --- central directory ---------------------------------------------------
const centralStart = offset;
for (const e of central) {
  // A local offset past 4GB has to move into a ZIP64 extra field.
  const needsZip64 = e.localOffset > MAX32;
  const extra = needsZip64 ? Buffer.alloc(12) : Buffer.alloc(0);
  if (needsZip64) {
    extra.writeUInt16LE(0x0001, 0);
    extra.writeUInt16LE(8, 2);
    extra.writeBigUInt64LE(BigInt(e.localOffset), 4);
  }

  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0);
  head.writeUInt16LE(20, 4); // version made by
  head.writeUInt16LE(needsZip64 ? 45 : 20, 6); // version needed
  head.writeUInt16LE(0x0800, 8);
  head.writeUInt16LE(e.method, 10);
  head.writeUInt16LE(e.time, 12);
  head.writeUInt16LE(e.date, 14);
  head.writeUInt32LE(e.crc, 16);
  head.writeUInt32LE(e.comp, 20);
  head.writeUInt32LE(e.size, 24);
  head.writeUInt16LE(e.name.length, 28);
  head.writeUInt16LE(extra.length, 30);
  head.writeUInt16LE(0, 32); // comment length
  head.writeUInt16LE(0, 34); // disk number
  head.writeUInt16LE(0, 36); // internal attributes
  head.writeUInt32LE(0, 38); // external attributes
  head.writeUInt32LE(needsZip64 ? MAX32 : e.localOffset, 42);
  write(head);
  write(e.name);
  if (extra.length) write(extra);
}
const centralSize = offset - centralStart;

// ZIP64 records, when the classic fields cannot hold the real numbers.
const zip64Needed = central.length > MAX16 || centralStart > MAX32 || centralSize > MAX32;
if (zip64Needed) {
  const z64Start = offset;
  const z64 = Buffer.alloc(56);
  z64.writeUInt32LE(0x06064b50, 0);
  z64.writeBigUInt64LE(44n, 4); // size of this record, minus 12
  z64.writeUInt16LE(45, 12);
  z64.writeUInt16LE(45, 14);
  z64.writeUInt32LE(0, 16);
  z64.writeUInt32LE(0, 20);
  z64.writeBigUInt64LE(BigInt(central.length), 24);
  z64.writeBigUInt64LE(BigInt(central.length), 32);
  z64.writeBigUInt64LE(BigInt(centralSize), 40);
  z64.writeBigUInt64LE(BigInt(centralStart), 48);
  write(z64);

  const loc = Buffer.alloc(20);
  loc.writeUInt32LE(0x07064b50, 0);
  loc.writeUInt32LE(0, 4);
  loc.writeBigUInt64LE(BigInt(z64Start), 8);
  loc.writeUInt32LE(1, 16);
  write(loc);
}

const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(Math.min(central.length, MAX16), 8);
eocd.writeUInt16LE(Math.min(central.length, MAX16), 10);
eocd.writeUInt32LE(Math.min(centralSize, MAX32), 12);
eocd.writeUInt32LE(Math.min(centralStart, MAX32), 16);
eocd.writeUInt16LE(0, 20);
write(eocd);
fs.closeSync(fd);

// --- read it back --------------------------------------------------------
/**
 * The point of the whole script: an archive nobody checked is how three
 * broken uploads got as far as the server. Walk the central directory,
 * inflate every entry, and compare the CRC the header claims.
 */
const buf = fs.readFileSync(TEMP);
if (buf.length !== offset) {
  fail(
    `${TEMP} is ${buf.length} bytes on disk but ${offset} were written to it. Something else ` +
      "changed the file while it was being packed; a sync client (OneDrive, Dropbox, Google Drive) " +
      "is the usual cause. Pause syncing for this folder and run it again."
  );
}
let eocdAt = -1;
for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) {
    eocdAt = i;
    break;
  }
}
if (eocdAt < 0) fail("the archive that was just written has no end-of-central-directory record.");

let count = buf.readUInt16LE(eocdAt + 8);
let start = buf.readUInt32LE(eocdAt + 16);
if (count === MAX16 || start === MAX32) {
  const locAt = eocdAt - 20;
  if (buf.readUInt32LE(locAt) !== 0x07064b50) fail("ZIP64 locator is missing.");
  const z64At = Number(buf.readBigUInt64LE(locAt + 8));
  if (buf.readUInt32LE(z64At) !== 0x06064b50) fail("ZIP64 end-of-central-directory record is missing.");
  count = Number(buf.readBigUInt64LE(z64At + 32));
  start = Number(buf.readBigUInt64LE(z64At + 48));
}

if (count !== files.length) fail(`the archive lists ${count} entries but ${files.length} files were packed.`);

let p = start;
let checked = 0;
for (let n = 0; n < count; n++) {
  if (buf.readUInt32LE(p) !== 0x02014b50) fail(`central directory entry ${n} is malformed.`);
  const method = buf.readUInt16LE(p + 10);
  const crc = buf.readUInt32LE(p + 16);
  const comp = buf.readUInt32LE(p + 20);
  const nameLen = buf.readUInt16LE(p + 28);
  const extraLen = buf.readUInt16LE(p + 30);
  const commentLen = buf.readUInt16LE(p + 32);
  let localOff = buf.readUInt32LE(p + 42);
  const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
  if (name.includes("\\")) fail(`entry "${name}" contains a backslash; Linux extractors cannot handle it.`);
  if (localOff === MAX32) {
    const ex = p + 46 + nameLen;
    if (buf.readUInt16LE(ex) !== 0x0001) fail(`entry "${name}" needs a ZIP64 offset and does not have one.`);
    localOff = Number(buf.readBigUInt64LE(ex + 4));
  }
  p += 46 + nameLen + extraLen + commentLen;

  const lNameLen = buf.readUInt16LE(localOff + 26);
  const lExtraLen = buf.readUInt16LE(localOff + 28);
  const dataAt = localOff + 30 + lNameLen + lExtraLen;
  const payload = buf.subarray(dataAt, dataAt + comp);
  const plain = method === 8 ? zlib.inflateRawSync(payload) : payload;
  if (crc32(plain) !== crc) fail(`entry "${name}" does not match its checksum; the archive is corrupt.`);
  checked++;
}

// Verified: now it may take the name the deploy instructions use.
fs.rmSync(OUT, { force: true });
fs.renameSync(TEMP, OUT);

const mb = (n) => (n / 1024 / 1024).toFixed(1) + "MB";
console.log(`verified ${checked} entries, every checksum matched`);
console.log(`wrote ${OUT} — ${mb(buf.length)} from ${mb(rawTotal)}`);
