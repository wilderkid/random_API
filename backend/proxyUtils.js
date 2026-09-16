function normalizeTokenUsage(usage, apiType = 'openai') {
  if (!usage || typeof usage !== 'object') return null;

  const promptTokens = Number(
    usage.promptTokens ?? usage.prompt_tokens ?? usage.input_tokens ?? 0
  ) || 0;
  const completionTokens = Number(
    usage.completionTokens ?? usage.completion_tokens ?? usage.output_tokens ?? 0
  ) || 0;
  const cachedTokens = Number(
    usage.cachedTokens ??
    usage.cached_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    usage.cache_read_input_tokens ??
    0
  ) || 0;
  const cacheWriteTokens = Number(
    usage.cacheWriteTokens ??
    usage.cache_creation_input_tokens ??
    0
  ) || 0;
  let totalTokens = Number(usage.totalTokens ?? usage.total_tokens ?? 0) || 0;
  if (!totalTokens) totalTokens = promptTokens + completionTokens;
  if (apiType === 'anthropic' && !totalTokens) {
    totalTokens = promptTokens + completionTokens;
  }
  if (!promptTokens && !completionTokens && !totalTokens && !cachedTokens && !cacheWriteTokens) {
    return null;
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens,
    cacheWriteTokens
  };
}

function buildAnthropicProxyHeaders(provider, keyInfo, req) {
  const apiKey = keyInfo?.key?.apiKey || provider.apiKey;
  const headers = {
    'x-api-key': apiKey,
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'anthropic-version': req.headers['anthropic-version'] || '2023-06-01'
  };

  if (req.headers['anthropic-beta']) {
    headers['anthropic-beta'] = req.headers['anthropic-beta'];
  }

  return headers;
}

function formatOpenAIModel(modelName) {
  const prefixIndex = typeof modelName === 'string' ? modelName.indexOf('::') : -1;
  const ownedBy = prefixIndex > 0 ? modelName.slice(0, prefixIndex) : 'equal-ask-proxy';
  return {
    id: modelName,
    object: 'model',
    created: Date.now(),
    owned_by: ownedBy,
    permission: [],
    root: modelName,
    parent: null
  };
}

function formatAnthropicModel(modelName) {
  return {
    type: 'model',
    id: modelName,
    display_name: modelName,
    created_at: null
  };
}

module.exports = {
  normalizeTokenUsage,
  buildAnthropicProxyHeaders,
  formatOpenAIModel,
  formatAnthropicModel
};
