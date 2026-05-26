function normalizeTokenUsage(usage, apiType = 'openai') {
  if (!usage) return null;

  if (apiType === 'anthropic') {
    const promptTokens = usage.input_tokens || 0;
    const completionTokens = usage.output_tokens || 0;
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      raw: usage
    };
  }

  return {
    promptTokens: usage.prompt_tokens || usage.promptTokens || 0,
    completionTokens: usage.completion_tokens || usage.completionTokens || 0,
    totalTokens: usage.total_tokens || usage.totalTokens || 0,
    raw: usage
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
  return {
    id: modelName,
    object: 'model',
    created: Date.now(),
    owned_by: 'equal-ask-proxy',
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
