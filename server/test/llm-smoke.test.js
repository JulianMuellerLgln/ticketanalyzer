const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const axios = require('axios');

const { app } = require('../index');

async function startTestServer() {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function requestJson(server, method, route, body) {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

test('POST /api/llm/smoke-test returns the model reply for a test prompt', async (t) => {
  const originalPost = axios.post;
  const server = await startTestServer();
  t.after(() => {
    axios.post = originalPost;
    server.close();
  });

  axios.post = async (url, payload) => {
    assert.match(url, /\/api\/generate$/);
    assert.equal(payload.model, 'qwen3:14b');
    assert.match(payload.prompt, /single word pong/i);
    assert.equal(payload.stream, false);
    return { data: { response: 'pong' } };
  };

  const response = await requestJson(server, 'POST', '/api/llm/smoke-test', { model: 'qwen3:14b' });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.model, 'qwen3:14b');
  assert.equal(response.body.response, 'pong');
  assert.match(response.body.prompt, /single word pong/i);
});
