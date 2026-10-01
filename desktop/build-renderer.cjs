const path=require('node:path');
const {buildSync}=require('esbuild');
const root=path.resolve(__dirname,'..');
buildSync({
 entryPoints:[path.join(root,'src/message-links.ts')],
 outfile:path.join(root,'dist/desktop/message-links.js'),
 bundle:true,platform:'browser',format:'esm',logLevel:'info'
});
