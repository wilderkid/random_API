const assert = require('assert');
const { sanitizeForJson, extractRequestModel, isHttpLikeObject } = require('../logger');

const kept = sanitizeForJson({
  request: {
    model: 'agnes-3.0-flash',
    isPolling: true,
    apiKeyName: 'proxy-key',
    stream: true,
    messageCount: 2
  },
  providers: [{ providerName: 'Agnes', status: 'success' }],
  result: { status: 'success' }
});

assert.strictEqual(kept.request.model, 'agnes-3.0-flash');
assert.strictEqual(kept.request.isPolling, true);
assert.strictEqual(kept.request.apiKeyName, 'proxy-key');
assert.strictEqual(kept.providers[0].providerName, 'Agnes');

const httpLike = {
  headers: { host: 'example' },
  socket: {},
  method: 'POST'
};
assert.strictEqual(isHttpLikeObject(httpLike), true);
const skipped = sanitizeForJson({ request: httpLike, model: 'keep-me' });
assert.strictEqual(skipped.request, undefined);
assert.strictEqual(skipped.model, 'keep-me');

assert.strictEqual(extractRequestModel({
  message: 'API请求: agnes-3.0-flash - success',
  data: {},
  metadata: {}
}), 'agnes-3.0-flash');

assert.strictEqual(extractRequestModel({
  message: 'API请求: ignored - success',
  data: { model: 'from-data' },
  metadata: {}
}), 'from-data');

assert.strictEqual(extractRequestModel({
  message: 'API请求: ignored - success',
  data: { request: { model: 'from-request' } },
  metadata: { model: 'from-meta' }
}), 'from-request');

console.log('logSanitize tests passed');
