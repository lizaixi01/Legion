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

test('project chat links resolve against the persisted project and reject escapes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'project-links-')),id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';const chat=join(root,'.chats',id),project=join(root,'project');await mkdir(chat,{recursive:true});await mkdir(project);await writeFile(join(chat,'chat.json'),JSON.stringify({project}));await writeFile(join(project,'notes.md'),'hello');assert.equal((await resolveChatLink(root,id,'./notes.md')).target,join(project,'notes.md'));await assert.rejects(resolveChatLink(root,id,'../other.md'),/目录/);
});
test('runtime evidence links stay within the current chat turn',async()=>{
 const root=await mkdtemp(join(tmpdir(),'evidence-link-')),id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',turn='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';const dir=join(root,'.chats',id),workspace=join(dir,'workspace'),evidence=join(dir,'turns',turn);await mkdir(workspace,{recursive:true});await mkdir(evidence,{recursive:true});await writeFile(join(dir,'chat.json'),JSON.stringify({managementDir:turn}));await writeFile(join(evidence,'functional.json'),'{}');assert.equal((await resolveChatLink(root,id,join(evidence,'functional.json'))).target,join(evidence,'functional.json'));await assert.rejects(resolveChatLink(root,id,join(dir,'chat.json')),/不在/);
});
