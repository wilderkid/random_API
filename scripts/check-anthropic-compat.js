#!/usr/bin/env node

const baseUrl = (process.env.EQUAL_ASK_BASE_URL || '').replace(/\/+$/, '');
const apiKey = process.env.EQUAL_ASK_API_KEY || '';
let model = process.env.EQUAL_ASK_MODEL || '';
const anthropicVersion = process.env.ANTHROPIC_VERSION || '2023-06-01';

function usage() {
  console.log([
    'Anthropic compatibility check for Equal Ask.',
    '',
    'Required:',
    '  EQUAL_ASK_BASE_URL  Example: http://127.0.0.1:3000',
    '  EQUAL_ASK_API_KEY   Proxy API key from the API key page',
    '',
    'Optional:',
    '  EQUAL_ASK_MODEL     If omitted, the first model from /v1/models is used',
    '  ANTHROPIC_VERSION   Defaults to 2023-06-01',
    '',
    'Example:',
    '  EQUAL_ASK_BASE_URL=http://127.0.0.1:3000 EQUAL_ASK_API_KEY=sk-... node scripts/check-anthropic-compat.js'
  ].join('\n'));
}

function snippet(value, maxLength = 800) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

async function request(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': anthropicVersion
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Keep raw text for non-JSON upstream errors.
  }

  return { status: response.status, ok: response.ok, data };
}

async function check(name, method, path, body, mustPass = true) {
  const result = await request(method, path, body);
  const status = result.ok ? 'PASS' : 'FAIL';
  console.log(`\n[${status}] ${name} ${method} ${path} -> ${result.status}`);
  console.log(snippet(result.data));

  if (mustPass && !result.ok) {
    throw new Error(`${name} failed with HTTP ${result.status}`);
  }

  return result.data;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  if (!baseUrl || !apiKey) {
    usage();
    process.exitCode = 2;
    return;
  }

  const modelsResponse = await check('List models', 'GET', '/v1/models');
  const models = Array.isArray(modelsResponse?.data) ? modelsResponse.data : [];

  if (!model) {
    model = models[0]?.id;
  }

  if (!model) {
    throw new Error('No model available from /v1/models and EQUAL_ASK_MODEL was not set.');
  }

  await check('Get model', 'GET', `/v1/models/${encodeURIComponent(model)}`);

  const messageBody = {
    model,
    max_tokens: 32,
    messages: [
      {
        role: 'user',
        content: 'Reply with the single word: ok'
      }
    ]
  };

  await check('Count tokens', 'POST', '/v1/messages/count_tokens', messageBody);
  await check('Messages', 'POST', '/v1/messages', messageBody);
}

main().catch(error => {
  console.error(`\n[ERROR] ${error.message}`);
  process.exitCode = 1;
});
