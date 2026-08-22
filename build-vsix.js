/**
 * 手动创建 VSIX 包（VSIX = ZIP + vsixmanifest + [Content_Types].xml）
 * 用法: node build-vsix.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
const FILES = ['dist', 'resources', 'scripts', 'README.md', 'LICENSE', 'CHANGELOG.md', 'images'];
const OUT = path.join(ROOT, 'growth-log-0.9.9.vsix');

// ── 读取 package.json ──
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// ── 递归收集文件 ──
function collectFiles(dir, base) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = base ? base + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, rel));
    } else {
      results.push({ abs: full, rel });
    }
  }
  return results;
}

// ── ZIP 写入器（简化版，Store + Deflate）──
function writeZip(entries) {
  const chunks = [];
  const centralDir = [];
  let offset = 0;

  for (const { zipPath, data } of entries) {
    const nameBuf = Buffer.from(zipPath, 'utf8');
    const isDir = zipPath.endsWith('/');

    // Local file header
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4);          // version needed
    localHeader.writeUInt16LE(0, 6);           // flags
    localHeader.writeUInt16LE(isDir ? 0 : 8, 8); // compression: 0=store, 8=deflate
    localHeader.writeUInt16LE(0, 10);          // mod time
    localHeader.writeUInt16LE(0, 12);          // mod date
    const compressed = isDir ? Buffer.alloc(0) : zlib.deflateRawSync(data);
    localHeader.writeUInt32LE(isDir ? 0 : crc32(data), 14); // CRC
    localHeader.writeUInt32LE(compressed.length, 18);       // compressed size
    localHeader.writeUInt32LE(data.length, 22);              // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);           // filename length
    localHeader.writeUInt16LE(0, 28);                        // extra field length

    const localEntry = Buffer.concat([localHeader, nameBuf, compressed]);
    chunks.push(localEntry);

    // Central directory header
    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0); // signature
    cdHeader.writeUInt16LE(20, 4);          // version made by
    cdHeader.writeUInt16LE(20, 6);          // version needed
    cdHeader.writeUInt16LE(0, 8);          // flags
    cdHeader.writeUInt16LE(isDir ? 0 : 8, 10); // compression
    cdHeader.writeUInt16LE(0, 12);          // mod time
    cdHeader.writeUInt16LE(0, 14);          // mod date
    cdHeader.writeUInt32LE(isDir ? 0 : crc32(data), 16); // CRC
    cdHeader.writeUInt32LE(compressed.length, 20);       // compressed size
    cdHeader.writeUInt32LE(data.length, 24);              // uncompressed size
    cdHeader.writeUInt16LE(nameBuf.length, 28);           // filename length
    cdHeader.writeUInt16LE(0, 30);                         // extra field length
    cdHeader.writeUInt16LE(0, 32);                         // comment length
    cdHeader.writeUInt16LE(0, 34);                         // disk number start
    cdHeader.writeUInt16LE(0, 36);                         // internal attrs
    cdHeader.writeUInt32LE(0, 38);                         // external attrs
    cdHeader.writeUInt32LE(offset, 42);                    // local header offset

    centralDir.push(Buffer.concat([cdHeader, nameBuf]));
    offset += localEntry.length;
  }

  // End of central directory
  const cdBuf = Buffer.concat(centralDir);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);       // signature
  eocd.writeUInt16LE(0, 4);                // disk number
  eocd.writeUInt16LE(0, 6);                // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);    // entries on this disk
  eocd.writeUInt16LE(entries.length, 10);   // total entries
  eocd.writeUInt32LE(cdBuf.length, 12);     // central dir size
  eocd.writeUInt32LE(offset, 16);           // central dir offset
  eocd.writeUInt16LE(0, 20);                // comment length

  return Buffer.concat([...chunks, cdBuf, eocd]);
}

// ── CRC32 ──
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── 生成 vsixmanifest ──
function buildManifest() {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2010/10" xmlns:vsix="http://schemas.microsoft.com/developer/vsx-schema/2010/10/vsix">
  <Metadata>
    <Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}" />
    <DisplayName>${pkg.displayName}</DisplayName>
    <Description xml:space="preserve">${pkg.description}</Description>
    <Tags>growth,log,record,interview</Tags>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="github.repository" Value="${pkg.repository?.url || ''}" />
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${(pkg.engines?.vscode || '^1.85.0').replace(/[\^~]/g, '')}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.PreRelease" Value="false" />
    </Properties>
    <License>${pkg.license || 'MIT'}</License>
    <Icon>extension/resources/icon.png</Icon>
  </Metadata>
  <Installation InstalledByMsi="false">
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies>
    <Dependency Id="Microsoft.VisualStudio.Code" Version="${(pkg.engines?.vscode || '^1.85.0').replace(/[\^~]/g, '')}" DisplayName="VS Code" />
  </Dependencies>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.VSIX" Path="extension/${pkg.icon || 'resources/icon.png'}" Addressable="true" />
  </Assets>
</PackageManifest>`;
}

// ── 生成 [Content_Types].xml ──
function buildContentTypes() {
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="text/javascript" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="svg" ContentType="image/svg+xml" />
  <Default Extension="png" ContentType="image/png" />
  <Default Extension="txt" ContentType="text/plain" />
  <Default Extension="html" ContentType="text/html" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="jsmap" ContentType="application/json" />
  <Default Extension="sh" ContentType="application/x-sh" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
</Types>`;
}

// ── 主流程 ──
console.log('=== 收集文件 ===');
const zipEntries = [];

// [Content_Types].xml
zipEntries.push({ zipPath: '[Content_Types].xml', data: Buffer.from(buildContentTypes(), 'utf8') });

// extension.vsixmanifest
zipEntries.push({ zipPath: 'extension.vsixmanifest', data: Buffer.from(buildManifest(), 'utf8') });

// extension/ 下的文件
for (const item of FILES) {
  const fullPath = path.join(ROOT, item);
  if (!fs.existsSync(fullPath)) {
    console.log(`  跳过(不存在): ${item}`);
    continue;
  }
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    const files = collectFiles(fullPath, '');
    for (const f of files) {
      const data = fs.readFileSync(f.abs);
      zipEntries.push({ zipPath: `extension/${item}/${f.rel}`, data });
      console.log(`  + extension/${item}/${f.rel}`);
    }
  } else {
    const data = fs.readFileSync(fullPath);
    zipEntries.push({ zipPath: `extension/${item}`, data });
    console.log(`  + extension/${item}`);
  }
}

// package.json
zipEntries.push({ zipPath: 'extension/package.json', data: Buffer.from(JSON.stringify(pkg, null, 2), 'utf8') });
console.log('  + extension/package.json');

console.log(`\n=== 共 ${zipEntries.length} 个文件 ===`);

const zipBuf = writeZip(zipEntries);
fs.writeFileSync(OUT, zipBuf);
console.log(`\n=== 已生成: ${OUT} (${(zipBuf.length / 1024).toFixed(1)} KB) ===`);
