// SIMULATED ONLY: fixed synthetic actor and in-memory repository. Never accepts a real DB.
const http = require('node:http');
const { fixture } = require('./backend-fixture');
const MARKER = 'SIMULATED-loopback'; // Routing marker, NOT authentication.
async function startLoopbackBackend({ now = () => new Date() } = {}) {
  const backend = fixture();
  const requests = [];
  let fault = null;
  const setFault = (action, mode, delayMs = 600) => {
    if (
      !['journal.upsert', 'journal.delete'].includes(action) ||
      !['drop', 'malformed', 'delay'].includes(mode) ||
      !Number.isInteger(delayMs) ||
      delayMs < 0 ||
      delayMs > 1500
    ) {
      throw new Error('Invalid synthetic fault');
    }
    fault = { action, mode, delayMs };
  };
  const server = http.createServer(async (request, response) => {
    const send = (status, data) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
    };
    try {
      if (request.method !== 'POST' || request.headers['x-moodsky-test'] !== MARKER) {
        send(403, { simulated: true });
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 16384) {
          send(413, { simulated: true });
          return;
        }
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        send(400, { simulated: true });
        return;
      }
      if (request.url === '/control') {
        if (body.action === 'stop') {
          send(200, { simulated: true });
          server.close();
          return;
        }
        if (body.action === 'stats') {
          send(200, { simulated: true, requests });
          return;
        }
        if (body.action === 'fault') {
          setFault(body.target, body.mode, body.delayMs);
          send(200, { simulated: true });
          return;
        }
        send(400, { simulated: true });
        return;
      }
      if (request.url !== '/api') {
        send(404, { simulated: true });
        return;
      }
      backend.setClock(now().toISOString());
      const result = await backend.router(body, { OPENID: 'a' });
      // Metadata only; never retain or log date/tags/writing/identity/payload.
      requests.push({
        requestId: typeof body.requestId === 'string' ? body.requestId : '',
        action: typeof body.action === 'string' ? body.action : '',
        ok: result.ok,
      });
      const next = fault && body.action === fault.action ? fault : null;
      if (next) {
        fault = null;
        if (next.mode === 'drop') {
          response.destroy();
          return;
        }
        if (next.mode === 'delay') {
          await new Promise((resolve) => setTimeout(resolve, next.delayMs));
        }
        if (next.mode === 'malformed') {
          send(200, { apiVersion: '1', requestId: body.requestId, ok: true });
          return;
        }
      }
      send(200, result);
    } catch (_error) {
      if (!response.destroyed && !response.headersSent) {
        send(500, { simulated: true });
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    server,
    setFault,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeIdleConnections();
      }),
  };
}
module.exports = { startLoopbackBackend, MARKER };
