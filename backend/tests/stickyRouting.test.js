const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

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

function extractConst(src, name) {
  const start = src.indexOf(`const ${name} =`);
  if (start < 0) throw new Error(`const ${name} not found`);
  const end = src.indexOf('\n', start);
  return src.slice(start, end);
}

const context = {
  crypto,
  console,
  Date,
  module: { exports: {} },
  exports: {},
  CONFIG: { MODEL_FAIL_THRESHOLD: 3 }
};
vm.createContext(context);
vm.runInContext(
  [
    extractConst(serverSrc, 'TOOL_ARTIFACT_TYPES'),
    extractFunction(serverSrc, 'getMessagePlainText'),
    extractFunction(serverSrc, 'hasToolArtifacts'),
    extractFunction(serverSrc, 'isToolCallingRequest'),
    extractFunction(serverSrc, 'requestHasToolHistory'),
    extractFunction(serverSrc, 'isStickyNewConversation'),
    extractFunction(serverSrc, 'getFirstUserFingerprint'),
    extractFunction(serverSrc, 'extractSessionId'),
    extractFunction(serverSrc, 'getRequestSessionIdentifier'),
    extractFunction(serverSrc, 'normalizeProviderKeysForRuntime'),
    extractFunction(serverSrc, 'selectProviderKey'),
    extractConst(serverSrc, 'VALID_CLIENT_TAGS'),
    extractConst(serverSrc, 'AGENT_CLIENT_TAGS'),
    extractFunction(serverSrc, 'normalizeModelName'),
    extractFunction(serverSrc, 'extractModelName'),
    extractFunction(serverSrc, 'getProviderDisplayName'),
    extractFunction(serverSrc, 'getExposedProviderPrefix'),
    extractFunction(serverSrc, 'buildExposedModelId'),
    extractFunction(serverSrc, 'getRequestedProviderId'),
    extractFunction(serverSrc, 'getPollingExcludedProviderIds'),
    extractFunction(serverSrc, 'providerHasVisibleModel'),
    extractFunction(serverSrc, 'providerAllowedByScope'),
    extractFunction(serverSrc, 'isModelDisabledForProvider'),
    extractFunction(serverSrc, 'normalizeProviderClientTags'),
    extractFunction(serverSrc, 'getApiKeyClientTag'),
    extractFunction(serverSrc, 'isAgentClientKey'),
    extractFunction(serverSrc, 'shouldUsePolling'),
    extractFunction(serverSrc, 'incrementModelFailCount'),
    extractFunction(serverSrc, 'providerMatchesClientTag'),
    extractFunction(serverSrc, 'isProviderEligibleForModel'),
    extractFunction(serverSrc, 'getScopedPollingProviderIds'),
    extractFunction(serverSrc, 'getFailoverProviders'),
    extractFunction(serverSrc, 'providerSupportsAnthropicProtocol'),
    extractFunction(serverSrc, 'providerSupportsOpenAIChatProtocol'),
    extractFunction(serverSrc, 'getProviderChatApiType'),
    extractFunction(serverSrc, 'nonPollingModelAvailable'),
    extractFunction(serverSrc, 'isModelAllowedByApiKey'),
    extractFunction(serverSrc, 'modelHasPollingPool'),
    extractFunction(serverSrc, 'getProxyModelAccessDenial'),
    extractFunction(serverSrc, 'convertImageUrlToAnthropic'),
    extractFunction(serverSrc, 'convertContentPartToAnthropic'),
    extractFunction(serverSrc, 'normalizeAnthropicContent'),
    extractFunction(serverSrc, 'appendAnthropicMessage'),
    extractFunction(serverSrc, 'convertOpenAIMessagesToAnthropic'),
    extractFunction(serverSrc, 'convertOpenAIToolsToAnthropic'),
    extractFunction(serverSrc, 'collectToolCallDelta'),
    extractFunction(serverSrc, 'normalizeResponsesContent'),
    extractFunction(serverSrc, 'isResponsesInputItem'),
    extractFunction(serverSrc, 'convertResponsesToolCall'),
    extractFunction(serverSrc, 'convertResponsesItemsToMessages'),
    extractFunction(serverSrc, 'responsesInputToMessages'),
    extractFunction(serverSrc, 'extractTextFromMessageContent'),
    extractFunction(serverSrc, 'buildResponsesFromChatCompletion'),
    extractFunction(serverSrc, 'mergeResponseContinuationMessages'),
    extractFunction(serverSrc, 'convertAnthropicJsonToOpenAI')
  ].join('\n'),
  context
);

const {
  isToolCallingRequest,
  isStickyNewConversation,
  getRequestSessionIdentifier,
  hasToolArtifacts,
  selectProviderKey,
  getRequestedProviderId,
  buildExposedModelId,
  isModelAllowedByApiKey,
  isProviderEligibleForModel,
  getScopedPollingProviderIds,
  getFailoverProviders,
  isAgentClientKey,
  shouldUsePolling,
  incrementModelFailCount,
  providerSupportsAnthropicProtocol,
  providerSupportsOpenAIChatProtocol,
  getProviderChatApiType,
  getPollingExcludedProviderIds,
  getProxyModelAccessDenial,
  modelHasPollingPool,
  convertOpenAIMessagesToAnthropic,
  convertOpenAIToolsToAnthropic,
  collectToolCallDelta,
  convertAnthropicJsonToOpenAI,
  responsesInputToMessages,
  buildResponsesFromChatCompletion,
  mergeResponseContinuationMessages
} = context;

assert.strictEqual(isToolCallingRequest({ body: { messages: [{ role: 'user', content: 'hi' }] } }), false);
assert.strictEqual(isToolCallingRequest({ body: { tools: [{ function: { name: 'bash' } }], messages: [{ role: 'user', content: 'hi' }] } }), true);
assert.strictEqual(isToolCallingRequest({ body: { tool_choice: { type: 'none' }, messages: [{ role: 'user', content: 'hi' }] } }), false);
assert.strictEqual(isToolCallingRequest({ body: { input: [{ type: 'function_call', name: 'bash' }] } }), true);

assert.strictEqual(isStickyNewConversation([{ role: 'user', content: 'hi' }], { body: { tools: [{ name: 'bash' }] } }), true);
assert.strictEqual(isStickyNewConversation(
  [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'ok' }],
  { body: { tools: [{ name: 'bash' }] } }
), false);
assert.strictEqual(isStickyNewConversation([{ role: 'user', content: 'hi' }], { body: { previous_response_id: 'resp_1' } }), false);
assert.strictEqual(hasToolArtifacts({ type: 'function_call_output', call_id: 'c1' }), true);

const first = getRequestSessionIdentifier(
  { headers: {}, body: { input: [{ type: 'message', role: 'user', content: 'hello world' }] } },
  [{ role: 'user', content: 'hello world' }],
  'gpt-5',
  true
);
const second = getRequestSessionIdentifier(
  {
    headers: {},
    body: {
      input: [
        { type: 'message', role: 'user', content: 'hello world' },
        { type: 'function_call', name: 'bash', arguments: '{}' },
        { type: 'function_call_output', output: 'ok' }
      ]
    }
  },
  [{ role: 'user', content: 'hello world and more' }],
  'gpt-5',
  true
);
assert.strictEqual(first, second);

const headerId = getRequestSessionIdentifier(
  { headers: { 'x-session-id': 'abc' }, body: {} },
  [{ role: 'user', content: 'hi' }],
  'gpt-5',
  true
);
assert.strictEqual(headerId, 'abc');

const continued = getRequestSessionIdentifier(
  { headers: {}, body: { previous_response_id: 'resp_abc', input: [{ type: 'message', role: 'user', content: 'next' }] } },
  [{ role: 'user', content: 'next' }],
  'gpt-5',
  true
);
assert.strictEqual(continued, 'resp:resp_abc');

const provider = {
  id: 'p1',
  keyPollingEnabled: true,
  apiKeys: [
    { id: 'k1', apiKey: 'sk-1', enabled: true, weight: 1 },
    { id: 'k2', apiKey: 'sk-2', enabled: true, weight: 1 }
  ]
};
const userSettings = { keyFailCounts: {}, keyPollingState: {} };
const peeked = selectProviderKey(provider, userSettings, { peek: true });
assert.strictEqual(peeked.key.id, 'k1');
assert.strictEqual(userSettings.keyPollingState.p1, undefined);
const firstKey = selectProviderKey(provider, userSettings);
const secondKey = selectProviderKey(provider, userSettings);
assert.strictEqual(firstKey.key.id, 'k1');
assert.strictEqual(secondKey.key.id, 'k2');
assert.strictEqual(userSettings.keyPollingState.p1.currentIndex, 0);



const zeroWeightProvider = {
  id: 'p-weight',
  keyPollingEnabled: true,
  apiKeys: [
    { id: 'kz', apiKey: 'sk-z', enabled: true, weight: 0 },
    { id: 'k3', apiKey: 'sk-3', enabled: true, weight: 2 }
  ]
};
const zeroSettings = { keyFailCounts: {}, keyPollingState: {} };
assert.strictEqual(selectProviderKey(zeroWeightProvider, zeroSettings).key.id, 'k3');
assert.strictEqual(selectProviderKey(zeroWeightProvider, zeroSettings).key.id, 'k3');

const allZeroProvider = {
  id: 'p-all-zero',
  keyPollingEnabled: true,
  apiKeys: [
    { id: 'za', apiKey: 'sk-a', enabled: true, weight: 0 },
    { id: 'zb', apiKey: 'sk-b', enabled: true, weight: 0 }
  ]
};
const allZeroSettings = { keyFailCounts: {}, keyPollingState: {} };
assert.strictEqual(selectProviderKey(allZeroProvider, allZeroSettings).key.id, 'za');
assert.strictEqual(selectProviderKey(allZeroProvider, allZeroSettings).key.id, 'zb');

const preferredPeek = selectProviderKey(provider, { keyFailCounts: {}, keyPollingState: {} }, { preferredKeyId: 'k2', peek: true });
assert.strictEqual(preferredPeek.key.id, 'k2');

assert.strictEqual(providerSupportsAnthropicProtocol({ apiType: 'openai', clientTags: { claude: true } }), false);
assert.strictEqual(providerSupportsAnthropicProtocol({ apiType: 'anthropic' }), true);
assert.strictEqual(providerSupportsAnthropicProtocol({ apiType: 'openai', customEndpoints: { chat: '/v1/messages' } }), true);
assert.strictEqual(providerSupportsOpenAIChatProtocol({ apiType: 'openai', clientTags: { claude: true } }), true);
assert.strictEqual(providerSupportsOpenAIChatProtocol({ apiType: 'anthropic' }), false);
assert.strictEqual(getProviderChatApiType({ apiType: 'openai' }), 'openai');
assert.strictEqual(getProviderChatApiType({ apiType: 'anthropic' }), 'anthropic');
assert.strictEqual(getProviderChatApiType({ apiType: 'openai', customEndpoints: { chat: '/v1/messages' } }), 'anthropic');

assert.strictEqual(getRequestedProviderId('p2::gpt-4'), 'p2');
assert.strictEqual(getRequestedProviderId('gpt-4'), null);

const namedProviders = [
  { id: 'abc-id', name: 'OpenAI' },
  { id: 'dup-1', name: 'Twin' },
  { id: 'dup-2', name: 'Twin' }
];
assert.strictEqual(getRequestedProviderId('OpenAI::gpt-4', namedProviders), 'abc-id');
assert.strictEqual(getRequestedProviderId('abc-id::gpt-4', namedProviders), 'abc-id');
assert.strictEqual(buildExposedModelId(namedProviders[0], 'gpt-4', namedProviders), 'OpenAI::gpt-4');
assert.strictEqual(buildExposedModelId(namedProviders[1], 'gpt-4', namedProviders), 'dup-1::gpt-4');
assert.strictEqual(
  isModelAllowedByApiKey('OpenAI::gpt-4', 'gpt-4', { allowedModels: ['abc-id::gpt-4'] }, false, namedProviders),
  true
);

const poolProvider = {
  id: 'pool-1',
  name: 'Pool',
  disabled: false,
  groupId: 'default',
  clientTags: { normal: true },
  models: [{ id: 'gpt-4', visible: true }]
};
const outsider = {
  id: 'out-1',
  name: 'Outsider',
  disabled: false,
  groupId: 'default',
  clientTags: { normal: true },
  models: [{ id: 'gpt-4', visible: true }]
};
const hiddenPool = {
  id: 'pool-2',
  name: 'Hidden',
  disabled: false,
  groupId: 'default',
  clientTags: { normal: true },
  models: [{ id: 'gpt-4', visible: false }]
};
const providers = [outsider, poolProvider, hiddenPool];
const routingSettings = { disabledModels: {}, pollingState: {} };
const pollingConfig = {
  available: { 'gpt-4': ['pool-2', 'pool-1'] },
  excluded: []
};
const apiKeyInfo = { usePolling: true, clientTag: 'normal' };

assert.strictEqual(isProviderEligibleForModel(hiddenPool, 'gpt-4', routingSettings, apiKeyInfo, { usePolling: true }), false);
assert.strictEqual(isProviderEligibleForModel(poolProvider, 'gpt-4', routingSettings, apiKeyInfo, { usePolling: true }), true);
assert.strictEqual(getScopedPollingProviderIds('gpt-4', providers, pollingConfig, apiKeyInfo, routingSettings).join(','), 'pool-1');

const failover = getFailoverProviders(providers, 'gpt-4', pollingConfig, routingSettings, [], apiKeyInfo, { reservePolling: false });
assert.strictEqual(failover.map(provider => provider.id).join(','), 'pool-1');

const nonPollingKey = { usePolling: false, clientTag: 'normal' };
const nonPolling = getFailoverProviders(
  providers,
  'gpt-4',
  pollingConfig,
  routingSettings,
  [],
  nonPollingKey,
  { requestedModel: 'out-1::gpt-4', reservePolling: false }
);
assert.strictEqual(nonPolling[0].id, 'out-1');

assert.strictEqual(isAgentClientKey({ clientTag: 'codex', usePolling: true }), true);
assert.strictEqual(shouldUsePolling({ clientTag: 'codex', usePolling: true }), false);
assert.strictEqual(shouldUsePolling({ clientTag: 'claude' }), false);
assert.strictEqual(shouldUsePolling({ clientTag: 'openclaw', usePolling: true }), false);
assert.strictEqual(shouldUsePolling({ clientTag: 'normal', usePolling: true }), true);
assert.strictEqual(shouldUsePolling({ clientTag: 'normal' }), true);

const agentProviders = [
  { id: 'codex-a', name: 'CodexA', disabled: false, groupId: 'default', clientTags: { codex: true }, models: [{ id: 'gpt-5', visible: true }] },
  { id: 'codex-b', name: 'CodexB', disabled: false, groupId: 'default', clientTags: { codex: true }, models: [{ id: 'gpt-5', visible: true }] }
];
const agentKey = { usePolling: true, clientTag: 'codex' };
const agentFailover = getFailoverProviders(
  agentProviders,
  'gpt-5',
  { available: { 'gpt-5': ['codex-a', 'codex-b'] }, excluded: [] },
  routingSettings,
  [],
  agentKey,
  { reservePolling: false }
);
assert.strictEqual(agentFailover.length, 1);
assert.strictEqual(agentFailover[0].id, 'codex-a');

const agentNamed = getFailoverProviders(
  agentProviders,
  'gpt-5',
  { available: { 'gpt-5': ['codex-a', 'codex-b'] }, excluded: [] },
  routingSettings,
  [],
  agentKey,
  { requestedModel: 'CodexB::gpt-5', reservePolling: false }
);
assert.strictEqual(agentNamed.length, 1);
assert.strictEqual(agentNamed[0].id, 'codex-b');

const agentIgnoresPool = getFailoverProviders(
  agentProviders,
  'gpt-5',
  { available: { 'gpt-5': ['codex-b'] }, excluded: [] },
  routingSettings,
  [],
  agentKey,
  { reservePolling: false }
);
assert.strictEqual(agentIgnoresPool.length, 1);
assert.strictEqual(agentIgnoresPool[0].id, 'codex-a');

const pinnedIgnoresPool = getFailoverProviders(
  providers,
  'gpt-4',
  pollingConfig,
  routingSettings,
  [],
  apiKeyInfo,
  { reservePolling: false, requestedModel: 'out-1::gpt-4' }
);
assert.strictEqual(pinnedIgnoresPool[0].id, 'out-1');

const pollingFailSettings = { disabledModels: {}, modelFailCounts: {} };
incrementModelFailCount('pool-1', 'gpt-4', pollingFailSettings, { clientTag: 'normal', usePolling: true });
incrementModelFailCount('pool-1', 'gpt-4', pollingFailSettings, { clientTag: 'normal', usePolling: true });
incrementModelFailCount('pool-1', 'gpt-4', pollingFailSettings, { clientTag: 'normal', usePolling: true });
assert.strictEqual(pollingFailSettings.disabledModels['pool-1'].includes('gpt-4'), true);
assert.strictEqual(isProviderEligibleForModel(poolProvider, 'gpt-4', pollingFailSettings, apiKeyInfo, { usePolling: true }), false);

const agentFailSettings = { disabledModels: {}, modelFailCounts: {} };
incrementModelFailCount('codex-a', 'gpt-5', agentFailSettings, { clientTag: 'codex', usePolling: true });
incrementModelFailCount('codex-a', 'gpt-5', agentFailSettings, { clientTag: 'codex', usePolling: true });
incrementModelFailCount('codex-a', 'gpt-5', agentFailSettings, { clientTag: 'codex', usePolling: true });
assert.deepStrictEqual(agentFailSettings.disabledModels, {});
assert.strictEqual(agentFailSettings.modelFailCounts['codex-a:gpt-5'] || 0, 0);

const alreadyDisabled = {
  disabledModels: { 'codex-a': ['gpt-5'] },
  pollingState: {}
};
assert.strictEqual(isProviderEligibleForModel(agentProviders[0], 'gpt-5', alreadyDisabled, agentKey, { usePolling: false }), true);
const agentStillAvailable = getFailoverProviders(
  agentProviders,
  'gpt-5',
  { available: { 'gpt-5': ['codex-a', 'codex-b'] }, excluded: [] },
  alreadyDisabled,
  [],
  agentKey,
  { reservePolling: false }
);
assert.strictEqual(agentStillAvailable.length, 1);
assert.strictEqual(agentStillAvailable[0].id, 'codex-a');


const converted = responsesInputToMessages([
  { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'run ls' }] },
  { type: 'function_call', call_id: 'call_1', name: 'bash', arguments: '{"cmd":"ls"}' },
  { type: 'function_call_output', call_id: 'call_1', output: 'ok' }
]);
assert.strictEqual(converted.length, 3);
assert.strictEqual(converted[0].role, 'user');
assert.strictEqual(converted[1].role, 'assistant');
assert.strictEqual(converted[1].tool_calls[0].id, 'call_1');
assert.strictEqual(converted[1].tool_calls[0].function.name, 'bash');
assert.strictEqual(converted[2].role, 'tool');
assert.strictEqual(converted[2].tool_call_id, 'call_1');
assert.strictEqual(converted[2].content, 'ok');

const contentPartsOnly = responsesInputToMessages([
  { type: 'input_text', text: 'hello' }
]);
assert.strictEqual(contentPartsOnly.length, 1);
assert.strictEqual(contentPartsOnly[0].role, 'user');

const built = buildResponsesFromChatCompletion({
  id: 'chatcmpl-1',
  created: 1,
  model: 'gpt-5',
  choices: [{
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'bash', arguments: '{}' } }]
    }
  }]
});
assert.strictEqual(built.output[0].type, 'function_call');
assert.strictEqual(built.output[0].call_id, 'call_9');
assert.strictEqual(built.output[0].name, 'bash');


const storedHistory = [
  { role: 'user', content: 'run ls' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{}' } }] }
];
const onlyToolResult = [{ role: 'tool', tool_call_id: 'call_1', content: 'ok' }];
const continuedMsgs = mergeResponseContinuationMessages(storedHistory, onlyToolResult);
assert.strictEqual(continuedMsgs.length, 3);
assert.strictEqual(continuedMsgs[2].role, 'tool');
assert.strictEqual(continuedMsgs[0].content, 'run ls');

const fullReplay = mergeResponseContinuationMessages(storedHistory, storedHistory.concat(onlyToolResult));
assert.strictEqual(fullReplay.length, 3);
assert.strictEqual(fullReplay[2].role, 'tool');

const excludedFromArray = getPollingExcludedProviderIds('gpt-4', {
  excluded: [{ providerId: 'p1', modelName: 'gpt-4' }, { providerId: 'p2', modelName: 'other' }]
});
assert.strictEqual(excludedFromArray.has('p1'), true);
assert.strictEqual(excludedFromArray.has('p2'), false);

const excludedFromObject = getPollingExcludedProviderIds('gpt-4', {
  excluded: { 'gpt-4': ['old-1'], 'other': ['old-2'] }
});
assert.strictEqual(excludedFromObject.has('old-1'), true);
assert.strictEqual(excludedFromObject.has('old-2'), false);

const toolCalls = [];
collectToolCallDelta(toolCalls, [{ index: '0', id: 'call_a', function: { name: 'bash', arguments: '{"x":' } }]);
collectToolCallDelta(toolCalls, [{ index: 0, function: { arguments: '1}' } }]);
assert.strictEqual(toolCalls[0].id, 'call_a');
assert.strictEqual(toolCalls[0].function.name, 'bash');
assert.strictEqual(toolCalls[0].function.arguments, '{"x":1}');

const anthropicConverted = convertOpenAIMessagesToAnthropic([
  { role: 'system', content: 'be helpful' },
  { role: 'user', content: 'run ls' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"cmd":"ls"}' } }] },
  { role: 'tool', tool_call_id: 'call_1', content: 'ok' }
]);
assert.strictEqual(anthropicConverted.system, 'be helpful');
assert.strictEqual(anthropicConverted.messages.length, 3);
assert.strictEqual(anthropicConverted.messages[1].role, 'assistant');
assert.strictEqual(anthropicConverted.messages[1].content[0].type, 'tool_use');
assert.strictEqual(anthropicConverted.messages[1].content[0].name, 'bash');
assert.strictEqual(anthropicConverted.messages[2].role, 'user');
assert.strictEqual(anthropicConverted.messages[2].content[0].type, 'tool_result');
assert.strictEqual(anthropicConverted.messages[2].content[0].tool_use_id, 'call_1');

const anthropicTools = convertOpenAIToolsToAnthropic([
  { type: 'function', function: { name: 'bash', description: 'run', parameters: { type: 'object' } } },
  { name: 'native', input_schema: { type: 'object' } }
]);
assert.strictEqual(anthropicTools.length, 2);
assert.strictEqual(anthropicTools[0].name, 'bash');
assert.strictEqual(anthropicTools[1].name, 'native');

const anthropicOnly = {
  id: 'anth-1',
  name: 'Anthropic',
  disabled: false,
  groupId: 'default',
  apiType: 'anthropic',
  clientTags: { normal: true },
  models: [{ id: 'claude-3', visible: true }]
};
const mixedProviders = [anthropicOnly, poolProvider];
const mixedPolling = { available: { 'claude-3': ['anth-1'], 'gpt-4': ['pool-1'] }, excluded: [] };
const mixedKey = { usePolling: true, clientTag: 'normal' };
const deniedChat = getProxyModelAccessDenial('claude-3', 'claude-3', mixedProviders, mixedPolling, mixedKey, routingSettings, { providerFilter: providerSupportsOpenAIChatProtocol });
assert.strictEqual(deniedChat.code, 'all_providers_excluded');
const allowedMessages = getProxyModelAccessDenial('claude-3', 'claude-3', mixedProviders, mixedPolling, mixedKey, routingSettings, { providerFilter: providerSupportsAnthropicProtocol });
assert.strictEqual(allowedMessages, null);

const emptyPool = { available: {}, excluded: [] };
assert.strictEqual(modelHasPollingPool('gpt-4', emptyPool), false);
assert.strictEqual(modelHasPollingPool('gpt-4', pollingConfig), true);
assert.strictEqual(
  getProxyModelAccessDenial('gpt-4', 'gpt-4', providers, emptyPool, apiKeyInfo, routingSettings),
  null
);
assert.strictEqual(
  getProxyModelAccessDenial('out-1::gpt-4', 'gpt-4', providers, emptyPool, apiKeyInfo, routingSettings),
  null
);
const emptyPoolFailover = getFailoverProviders(providers, 'gpt-4', emptyPool, routingSettings, [], apiKeyInfo, {
  reservePolling: false,
  requestedModel: 'out-1::gpt-4'
});
assert.strictEqual(emptyPoolFailover[0].id, 'out-1');
assert.ok(emptyPoolFailover.some(provider => provider.id === 'pool-1'));
const pooledStill = getFailoverProviders(providers, 'gpt-4', pollingConfig, routingSettings, [], apiKeyInfo, { reservePolling: false });
assert.strictEqual(pooledStill.map(provider => provider.id).join(','), 'pool-1');

const anthropicJson = convertAnthropicJsonToOpenAI({
  type: 'message',
  model: 'claude-3',
  content: [{ type: 'tool_use', id: 'toolu_123', name: 'bash', input: { cmd: 'ls' } }],
  stop_reason: 'tool_use'
});
assert.strictEqual(anthropicJson.choices[0].message.tool_calls[0].id, 'toolu_123');
assert.strictEqual(anthropicJson.choices[0].message.tool_calls[0].function.name, 'bash');

console.log('stickyRouting.test.js passed');
