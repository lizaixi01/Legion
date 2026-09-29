import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {renderMessage} from '../src/message-links.js';
import {resolveChatLink} from '../src/chat-links.js';

test('message links render relative and spaced absolute paths without trusting HTML or code examples',()=>{
 assert.match(renderMessage('[教程](./typescript-guide.html)'),/data-message-link="\.\/typescript-guide.html"/);
 assert.match(renderMessage('[教程](<D:/Project Files/guide.html>)'),/data-message-link="D:\/Project Files\/guide.html"/);
 assert.doesNotMatch(renderMessage('`[example](./test.html)`'),/<a /);
 assert.doesNotMatch(renderMessage('[bad](javascript:alert(1))'),/<a /);
 assert.match(renderMessage('<img src=x onerror=alert(1)>'),/&lt;img/);
 assert.doesNotMatch(renderMessage('[<img>](./file.html)'),/<img>/);
});

test('chat link opening resolves existing outputs and rejects escaping paths or command schemes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'chat-links-')),id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
 const workspace=join(root,'.chats',id,'workspace');await mkdir(workspace,{recursive:true});
 const html=join(workspace,'guide.html');await writeFile(html,'<h1>Guide</h1>');await writeFile(join(workspace,'run.cmd'),'echo test');
 assert.deepEqual(await resolveChatLink(root,id,'./guide.html'),{kind:'file',target:html});
 assert.equal((await resolveChatLink(root,id,html)).target,html);
 assert.equal((await resolveChatLink(root,id,'run.cmd')).kind,'reveal');
 await assert.rejects(resolveChatLink(root,id,'../../outside.html'),/目录/);
 await assert.rejects(resolveChatLink(root,id,'javascript:alert(1)'),/类型/);
 await assert.rejects(resolveChatLink(root,id,'missing.html'));
 assert.equal((await resolveChatLink(root,id,'https://example.com/a')).kind,'web');
});
