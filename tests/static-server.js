const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const host = '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const root = path.resolve(__dirname, '..', 'server');
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function sendDirectory(response, directory) {
  fs.readdir(directory, { withFileTypes: true }, (error, entries) => {
    if (error) {
      response.writeHead(500).end('Unable to read directory');
      return;
    }
    const links = entries
      .filter(entry => entry.isFile())
      .map(entry => `<a href="${escapeHtml(encodeURIComponent(entry.name))}">${escapeHtml(entry.name)}</a>`)
      .join('\n');
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><body>${links}</body></html>`);
  });
}

http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname);
  }
  catch (_error) {
    response.writeHead(400).end('Bad request');
    return;
  }

  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const target = path.resolve(root, `.${requestedPath}`);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(target, (error, stats) => {
    if (error) {
      response.writeHead(404).end('Not found');
      return;
    }
    if (stats.isDirectory()) {
      sendDirectory(response, target);
      return;
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stats.size,
    });
    fs.createReadStream(target).pipe(response);
  });
}).listen(port, host, () => {
  process.stdout.write(`Meme generator test server listening on http://${host}:${port}\n`);
});
