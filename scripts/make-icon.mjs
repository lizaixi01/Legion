// Generates build/icon.ico + build/icon.png for the packaged app.
import {mkdirSync,writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const OUT=join(dirname(fileURLToPath(import.meta.url)),'..','build');
const S=256,SS=4,W=S*SS;
const BG=[0x16,0x18,0x1d,255],FG=[0x4c,0x8d,0xff,255];
const radius=56*SS;

function sample(x,y){
  const cx=Math.min(Math.max(x,radius),W-1-radius),cy=Math.min(Math.max(y,radius),W-1-radius);
  const dx=x-cx,dy=y-cy;
  if(dx*dx+dy*dy>radius*radius)return [0,0,0,0];
  const inV=x>=86*SS&&x<112*SS&&y>=62*SS&&y<188*SS;
  const inH=x>=86*SS&&x<180*SS&&y>=162*SS&&y<188*SS;
  return inV||inH?FG:BG;
}

const px=Buffer.alloc(S*S*4);
for(let y=0;y<S;y++)for(let x=0;x<S;x++){
  let r=0,g=0,b=0,a=0;
  for(let sy=0;sy<SS;sy++)for(let sx=0;sx<SS;sx++){
    const c=sample(x*SS+sx,y*SS+sy);r+=c[0];g+=c[1];b+=c[2];a+=c[3];
  }
  const n=SS*SS,i=(y*S+x)*4;
  px[i]=Math.round(r/n);px[i+1]=Math.round(g/n);px[i+2]=Math.round(b/n);px[i+3]=Math.round(a/n);
}

const crc32=(buf)=>{let crc=0xffffffff;for(const byte of buf){let c=(crc^byte)&0xff;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crc=(crc>>>8)^c;}return (crc^0xffffffff)>>>0;};
const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type,'ascii'),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body));return Buffer.concat([len,body,crc]);};

const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(S,0);ihdr.writeUInt32BE(S,4);ihdr[8]=8;ihdr[9]=6;
const raw=Buffer.alloc((S*4+1)*S);
for(let y=0;y<S;y++)px.copy(raw,y*(S*4+1)+1,y*S*4,(y+1)*S*4);
const png=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);

const dir=Buffer.alloc(6);dir.writeUInt16LE(1,2);dir.writeUInt16LE(1,4);
const entry=Buffer.alloc(16);entry.writeUInt16LE(1,4);entry.writeUInt16LE(32,6);entry.writeUInt32LE(png.length,8);entry.writeUInt32LE(22,12);

mkdirSync(OUT,{recursive:true});
writeFileSync(join(OUT,'icon.png'),png);
writeFileSync(join(OUT,'icon.ico'),Buffer.concat([dir,entry,png]));
console.log('wrote build/icon.ico and build/icon.png');
