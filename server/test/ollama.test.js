const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildSmokeTestPrompt,
  getOllamaTimeoutMs,
  pickPreferredModel,
  resolveModel,
  parseModelBillions,
} = require('../src/ollama');

test('pickPreferredModel prefers configured large model when available', () => {
  const result = pickPreferredModel(['qwen3:4b', 'qwen3:14b', 'llama3.2'], 'qwen3:14b');
  assert.equal(result, 'qwen3:14b');
});

test('pickPreferredModel falls back to the largest discovered model', () => {
  const result = pickPreferredModel(['qwen3:4b', 'qwen2.5:7b', 'llama3.1:8b'], 'missing:model');
  assert.equal(result, 'llama3.1:8b');
});

test('resolveModel prefers explicit request model over default', () => {
  assert.equal(resolveModel('qwen3:4b'), 'qwen3:4b');
});

test('parseModelBillions extracts model size when present', () => {
  assert.equal(parseModelBillions('qwen3:14b-q4_K_M'), 14);
  assert.equal(parseModelBillions('custom-model'), 0);
});

test('buildSmokeTestPrompt asks for a minimal pong response', () => {
  assert.match(buildSmokeTestPrompt(), /single word pong/i);
});

test('getOllamaTimeoutMs falls back to a longer default timeout', () => {
  const previous = process.env.OLLAMA_TIMEOUT_MS;
  try {
    delete process.env.OLLAMA_TIMEOUT_MS;
    assert.equal(getOllamaTimeoutMs(), 300000);
  } finally {
    if (previous == null) {
      delete process.env.OLLAMA_TIMEOUT_MS;
    } else {
      process.env.OLLAMA_TIMEOUT_MS = previous;
    }
  }
});
