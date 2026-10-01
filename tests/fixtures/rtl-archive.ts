import {gzipSync} from 'node:zlib';
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

export function tarGz(entries: {name: string; body?: string; typeflag?: string}[]) {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? 'module core; endmodule\n');
    parts.push(header(entry.name, body.length, entry.typeflag));
    parts.push(body, block.subarray(0, (512 - (body.length % 512)) % 512));
  }
  parts.push(block, block);
  return gzipSync(Buffer.concat(parts));
}

