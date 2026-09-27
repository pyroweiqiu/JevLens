import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('../tests/fixtures/article.html', import.meta.url));
createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(4173, '127.0.0.1', () =>
  console.log('Demo article: http://127.0.0.1:4173 · Open the Jev Lens extension on this page.'),
);
