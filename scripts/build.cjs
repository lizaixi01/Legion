const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.resolve(root, 'dist');
if (path.dirname(output) !== root || (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink())) {
  throw Error('Build output must be the workspace dist directory');
}
fs.rmSync(output, {recursive: true, force: true});
const compiler = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
const compiled = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.build.json'], {cwd: root, stdio: 'inherit'});
if (compiled.error) throw compiled.error;
if (compiled.status !== 0) process.exit(compiled.status ?? 1);
require('../desktop/build-renderer.cjs');
