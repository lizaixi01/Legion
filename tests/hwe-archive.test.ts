import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {inspectRtlArchive} from '../src/hwe-archive.js';

const block = Buffer.alloc(512);

function octal(value: number, width: number) {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

function header(name: string, size: number, typeflag = '0') {
  const entry = Buffer.alloc(512);
  entry.write(name, 0, 100, 'utf8');
  entry.write(octal(0o644, 8), 100, 8, 'ascii');
  entry.write(octal(0, 8), 108, 8, 'ascii');
  entry.write(octal(0, 8), 116, 8, 'ascii');
  entry.write(octal(size, 12), 124, 12, 'ascii');
  entry.write(octal(0, 12), 136, 12, 'ascii');
  entry.write('        ', 148, 8, 'ascii');
  entry.write(typeflag, 156, 1, 'ascii');
  entry.write('ustar\0', 257, 6, 'ascii');
  entry.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const byte of entry) sum += byte;
  entry.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return entry;
}

function tarGz(entries: {name: string; body?: string; typeflag?: string}[]) {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? 'module core; endmodule\n');
    parts.push(header(entry.name, body.length, entry.typeflag));
    parts.push(body, block.subarray(0, (512 - (body.length % 512)) % 512));
  }
  parts.push(block, block);
  return gzipSync(Buffer.concat(parts));
}

test('a flat archive of .sv files is accepted', () => {
  const result = inspectRtlArchive(tarGz([{name: 'alu.sv'}, {name: 'core.sv'}]));
  assert.equal(result.ok, true, result.detail);
  assert.deepEqual(result.files, ['alu.sv', 'core.sv']);
});

test('archiving the directory is rejected with a fixable reason', () => {
  const nested = inspectRtlArchive(tarGz([{name: 'cores/baseline/rtl/alu.sv'}]));
  assert.equal(nested.ok, false);
  assert.match(nested.detail, /nested path/);
  assert.match(nested.detail, /tar -czf out\.tar\.gz \*\.sv/);
  const dotted = inspectRtlArchive(tarGz([{name: './alu.sv'}]));
  assert.equal(dotted.ok, false);
  assert.match(dotted.detail, /nested path/);
});

test('non-RTL entries and directory entries are rejected', () => {
  const mixed = inspectRtlArchive(tarGz([{name: 'alu.sv'}, {name: 'notes.txt'}]));
  assert.equal(mixed.ok, false);
  assert.match(mixed.detail, /notes\.txt \(not a \.sv file\)/);
  const directory = inspectRtlArchive(tarGz([{name: 'rtl/', body: '', typeflag: '5'}]));
  assert.equal(directory.ok, false);
  assert.match(directory.detail, /not a regular file|directory entry/);
});

test('an unreadable or empty archive is rejected before any container starts', () => {
  const notGzip = inspectRtlArchive(Buffer.from('plain text, not a tarball'));
  assert.equal(notGzip.ok, false);
  assert.match(notGzip.detail, /readable gzip/);
  const empty = inspectRtlArchive(tarGz([]));
  assert.equal(empty.ok, false);
  assert.match(empty.detail, /empty|no \.sv files/);
});

test('unsafe names, links, duplicate entries and corrupt tar headers are rejected', () => {
  for (const entries of [
    [{name: '../core.sv'}], [{name: '..\\core.sv'}], [{name: 'C:core.sv'}],
    [{name: 'core.sv', typeflag: '2'}], [{name: 'core.sv', typeflag: '1'}],
    [{name: 'core.sv'}, {name: 'core.sv', body: 'different'}],
  ]) assert.equal(inspectRtlArchive(tarGz(entries)).ok, false);
  const corrupt = header('core.sv', 20);corrupt[0] = 0x78;
  assert.equal(inspectRtlArchive(gzipSync(Buffer.concat([corrupt, Buffer.alloc(512)]))).ok, false);
  assert.equal(inspectRtlArchive(gzipSync(header('core.sv', 2000))).ok, false);
  assert.equal(inspectRtlArchive(tarGz(Array.from({length: 513}, (_, i) => ({name: `file${i}.sv`})))).ok, false);
});

test('bridge PAX timestamps are accepted while layout overrides are rejected', () => {
  function pax(key: string, value: string) {
    const body = `${key}=${value}\n`;let length = Buffer.byteLength(body) + 2;
    while (length !== Buffer.byteLength(body) + String(length).length + 1) length = Buffer.byteLength(body) + String(length).length + 1;
    const metadata = Buffer.from(`${length} ${body}`),rtl = Buffer.from('module core; endmodule\n');
    return gzipSync(Buffer.concat([header('././@PaxHeader', metadata.length, 'x'), metadata, Buffer.alloc((512 - metadata.length % 512) % 512),
      header('core.sv', rtl.length),rtl,Buffer.alloc((512 - rtl.length % 512) % 512),block,block]));
  }
  const timestamp = inspectRtlArchive(pax('mtime', '1790613656.0737135'));assert.equal(timestamp.ok, true, timestamp.detail);assert.deepEqual(timestamp.files, ['core.sv']);
  for (const key of ['path', 'linkpath', 'size', 'GNU.sparse.map']) assert.equal(inspectRtlArchive(pax(key, '../outside.sv')).ok, false);
});
