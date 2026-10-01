import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderMessage} from '../src/message-links.js';

test('Chinese replies render bold next to punctuation and lists as Markdown',()=>{
 const html=renderMessage('可以。附件要求的是一次**基于真实源码的 coding agent 架构分析**，涵盖长期记忆。\n\n我可以逐项给出：\n\n- 功能入口、关键文件和调用链。\n- 实现原理、数据流。\n\n开始前需要确定两点：**你想分析哪个仓库（Codex、OpenCode）？附件中的“用 Claude Code”是硬性要求吗？**');
 assert.match(html,/<strong>基于真实源码的 coding agent 架构分析<\/strong>/);
 assert.match(html,/<strong>你想分析哪个仓库（Codex、OpenCode）？附件中的“用 Claude Code”是硬性要求吗？<\/strong>/);
 assert.match(html,/<ul>\s*<li>功能入口/);
 assert.doesNotMatch(html,/\*\*/);
});

test('headings, ordered lists, quotes and GFM tables render with structural elements',()=>{
 const html=renderMessage('## 方案\n\n1. 第一步\n2. 第二步\n\n> 一段说明\n\n| 项目 | 状态 |\n| --- | --- |\n| 编译 | 通过 |');
 for(const tag of ['h2','ol','li','blockquote','table','th','td'])assert.match(html,new RegExp('<'+tag+'(?:>| )'));
 assert.match(renderMessage('第一行\n第二行'),/第一行<br>第二行/);
});

test('inline and fenced code retain literal formatting and cannot create links or executable HTML',()=>{
 const html=renderMessage('`**原样** [示例](./x.html)`\n\n```html\n<script>alert(1)</script>\n**不是粗体**\n[示例](./x.html)\n```');
 assert.match(html,/<code>\*\*原样\*\* \[示例\]\(\.\/x.html\)<\/code>/);
 assert.match(html,/<pre><code class="language-html">&lt;script&gt;/);
 assert.doesNotMatch(html,/<a |<script>|<strong>/);
});

test('rich Markdown keeps raw HTML inert and restricts every link to the checked opener',()=>{
 const html=renderMessage('<script>alert(1)</script>\n\n[**教程**](<D:/Project Files/guide.html>)\n\n[bad](javascript:alert(1))\n\n![bad](data:text/html,bad)\n\n<img src=x onerror=alert(1)>');
 assert.doesNotMatch(html,/<script|<img|data-message-link="(?:javascript|data):/);
 assert.match(html,/&lt;script&gt;/);
 assert.match(html,/data-message-link="D:\/Project Files\/guide.html"[^>]*><strong>教程<\/strong><\/a>/);
});
