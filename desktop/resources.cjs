const fs = require('node:fs');
const path = require('node:path');

const files = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/app.js': 'app.js',
  '/drop-files.js': 'drop-files.js',
  '/attachment-cards.js': 'attachment-cards.js',
  '/conversation-view.js': 'conversation-view.js',
  '/ui-icons.js': 'ui-icons.js',
  '/style.css': 'style.css',
  '/message-links.js': '../dist/desktop/message-links.js',
};

function serveDesktopResource(request) {
  const url = new URL(request.url);
  if (url.protocol !== 'proactive:' || url.host !== 'app' || !Object.hasOwn(files, url.pathname)) {
    return new Response('Not found', { status: 404 });
  }
  try {
    // fs also supports resources inside packaged asar archives.
    const bytes = fs.readFileSync(path.join(__dirname, files[url.pathname]));
    const type = url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html';
    return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

module.exports = { serveDesktopResource };
