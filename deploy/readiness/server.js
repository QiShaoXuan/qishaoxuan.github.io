'use strict';

// Temporary maintenance server. Replaced by the real standalone build at launch.
const http = require('node:http');

const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/healthz' && ['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ status: 'ok', stage: 'deployment-preparation' }));
    return;
  }
  response.writeHead(503, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Retry-After': '3600',
  });
  response.end('Website is being prepared.\n');
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.listen(Number(process.env.PORT || 3000), process.env.HOSTNAME || '127.0.0.1');

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
});
