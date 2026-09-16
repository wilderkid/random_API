const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { parseModernLogs } = require('../logger');

const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`function ${name} not found`);
  const headerEnd = src.indexOf(')', start);
  const braceStart = src.indexOf('{', headerEnd < 0 ? start : headerEnd);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`function ${name} is unclosed`);
}

const { normalizeTokenUsage } = require('../proxyUtils');
const context = { console, Date, Buffer, setTimeout, clearTimeout, normalizeTokenUsage };
vm.createContext(context);
vm.runInContext(
  [
    extractFunction(serverSrc, 'finiteNonNegativeMs'),
    extractFunction(serverSrc, 'ssePayloadLooksLikeFirstToken'),
    extractFunction(serverSrc, 'chunkHasFirstToken'),
    extractFunction(serverSrc, 'createFirstTokenProbe'),
    extractFunction(serverSrc, 'sseChunkIncludesDone'),
    extractFunction(serverSrc, 'mergeCapturedTokenUsage'),
    extractFunction(serverSrc, 'captureTokenUsageFromPayload'),
    extractFunction(serverSrc, 'collectSseUsageAndText'),
    extractFunction(serverSrc, 'ensureStreamUsageOption')
  ].join('\n'),
  context
);

assert.strictEqual(context.ssePayloadLooksLikeFirstToken({
  choices: [{ delta: { content: 'Hi' } }]
}), true);
assert.strictEqual(context.ssePayloadLooksLikeFirstToken({
  choices: [{ delta: { role: 'assistant' } }]
}), false);
assert.strictEqual(context.ssePayloadLooksLikeFirstToken({
  choices: [{ delta: { content: '' } }]
}), false);
assert.strictEqual(context.ssePayloadLooksLikeFirstToken({
  choices: [{ delta: { reasoning_content: 'think' } }]
}), true);
assert.strictEqual(context.ssePayloadLooksLikeFirstToken({
  choices: [{ delta: { tool_calls: [{ index: 0 }] } }]
}), true);
assert.strictEqual(context.ssePayloadLooksLikeFirstToken({
  type: 'content_block_delta',
  delta: { text: 'Hi' }
}), true);
assert.strictEqual(context.ssePayloadLooksLikeFirstToken({
  type: 'message_start'
}), false);
assert.strictEqual(context.ssePayloadLooksLikeFirstToken({
  type: 'response.output_text.delta',
  delta: 'Hi'
}), true);
assert.strictEqual(context.ssePayloadLooksLikeFirstToken({
  type: 'response.function_call_arguments.delta',
  delta: '{'
}), true);

assert.strictEqual(context.chunkHasFirstToken('data: {"choices":[{"delta":{"content":"A"}}]}\n\n'), true);
assert.strictEqual(context.chunkHasFirstToken('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n'), false);
assert.strictEqual(context.finiteNonNegativeMs(null), null);
assert.strictEqual(context.finiteNonNegativeMs(0), 0);
assert.strictEqual(context.finiteNonNegativeMs('120'), 120);

const startedAt = Date.now() - 40;
const probe = context.createFirstTokenProbe(startedAt);
probe.observe('data: {"choices":[{"delta":{"cont');
assert.strictEqual(probe.firstTokenMs, null);
probe.observe('ent":"Hi"}}]}\n\n');
assert.ok(Number.isFinite(probe.firstTokenMs), 'probe should capture first token across chunks');
assert.ok(probe.firstTokenMs >= 0);

const emptyProbe = context.createFirstTokenProbe(Date.now());
emptyProbe.observe('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n');
emptyProbe.finish();
assert.strictEqual(emptyProbe.firstTokenMs, null);

const stats = parseModernLogs([
  {
    type: 'API_REQUEST',
    data: {
      request: { model: 'gpt-4' },
      providers: [
        { providerName: 'alpha', providerId: 'p1', status: 'failed', duration: 80 },
        { providerName: 'beta', providerId: 'p2', status: 'success', duration: 900, firstTokenMs: 120 }
      ],
      result: {
        status: 'success',
        successfulProvider: 'p2',
        totalDuration: 980,
        firstTokenMs: 120
      }
    }
  },
  {
    type: 'API_REQUEST',
    data: {
      request: { model: 'gpt-4' },
      providers: [
        { providerName: 'beta', providerId: 'p2', status: 'success', duration: 700 }
      ],
      result: {
        status: 'success',
        successfulProvider: 'p2',
        totalDuration: 700,
        firstTokenMs: 80
      }
    }
  },
  {
    type: 'API_REQUEST',
    data: {
      request: { model: 'gpt-4' },
      providers: [
        { providerName: 'gamma', providerId: 'p3', status: 'failed', duration: 50 }
      ],
      result: {
        status: 'failed',
        successfulProvider: null,
        totalDuration: 50
      }
    }
  }
]);

assert.strictEqual(stats.performanceStats.firstTokenCount, 2);
assert.strictEqual(stats.performanceStats.avgFirstTokenMs, 100);
assert.strictEqual(stats.performanceStats.minFirstTokenMs, 80);
assert.strictEqual(stats.performanceStats.maxFirstTokenMs, 120);
assert.strictEqual(stats.providerStats.beta.avgFirstTokenMs, 100);
assert.strictEqual(stats.providerStats.beta.models['gpt-4'].avgFirstTokenMs, 100);
assert.strictEqual(stats.providerStats.alpha.firstTokenCount || 0, 0);
assert.strictEqual(stats.providerStats.gamma.firstTokenCount || 0, 0);

assert.ok(stats.modelStats['gpt-4']);
assert.strictEqual(stats.modelStats['gpt-4'].total, 3);
assert.strictEqual(stats.modelStats['gpt-4'].success, 2);

const tokenStats = require('../logger').parseModernLogs([
  {
    type: 'API_REQUEST',
    message: 'API request: demo - success',
    data: {
      request: { model: 'demo' },
      providers: [{ providerName: 'alpha', providerId: 'p1', status: 'success', duration: 10 }],
      result: {
        status: 'success',
        successfulProvider: 'p1',
        totalDuration: 10,
        tokenUsage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
      }
    }
  }
]);
assert.strictEqual(tokenStats.tokenStats.totalPromptTokens, 11);
assert.strictEqual(tokenStats.tokenStats.totalCompletionTokens, 7);
assert.strictEqual(tokenStats.modelStats.demo.totalTokens, 18);

const callStats = parseModernLogs([
  {
    type: 'API_CALL',
    message: 'API call success: Agnes/agnes-3.0-flash',
    data: {
      provider: 'Agnes',
      model: 'agnes-3.0-flash',
      status: 'SUCCESS',
      duration: 1500,
      firstTokenMs: 220,
      tokenUsage: { promptTokens: 9, completionTokens: 4, totalTokens: 13 }
    }
  }
]);
assert.strictEqual(callStats.tokenStats.totalTokens, 13);
assert.strictEqual(callStats.performanceStats.avgDuration, 1500);
assert.strictEqual(callStats.performanceStats.avgFirstTokenMs, 220);
assert.strictEqual(callStats.providerStats.Agnes.avgFirstTokenMs, 220);

const usageState = context.collectSseUsageAndText(
  'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
  { tokenUsage: null, text: '' }
);
context.collectSseUsageAndText(
  'data: {"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n',
  usageState
);
assert.strictEqual(usageState.text, 'Hi');
assert.strictEqual(usageState.tokenUsage.totalTokens, 7);

const merged = context.mergeCapturedTokenUsage(
  { promptTokens: 10, completionTokens: 0, totalTokens: 10, cachedTokens: 0, cacheWriteTokens: 0 },
  { input_tokens: 0, output_tokens: 20 }
);
assert.strictEqual(merged.promptTokens, 10);
assert.strictEqual(merged.completionTokens, 20);
assert.strictEqual(merged.totalTokens, 30);

const body = context.ensureStreamUsageOption({ model: 'gpt', stream: true }, 'openai');
assert.strictEqual(body.stream_options.include_usage, true);
assert.strictEqual(context.sseChunkIncludesDone('data: [DONE]\n\n'), true);
assert.strictEqual(context.sseChunkIncludesDone('data: {"choices":[]}'), false);

console.log('firstTokenStats.test.js passed');
