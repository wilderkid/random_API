export function formatNumber(num) {
  if (num === undefined || num === null || Number.isNaN(Number(num))) return '0'
  return Number(num).toLocaleString()
}

export function formatCompact(num) {
  const value = Number(num) || 0
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(2).replace(/\.00$/, '')}M`
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2).replace(/\.00$/, '')}K`
  }
  return String(Math.round(value))
}

export function formatDuration(ms) {
  if (ms === undefined || ms === null || ms === '' || !Number.isFinite(Number(ms)) || Number(ms) < 0) return '-'
  const value = Number(ms)
  if (value < 1000) return `${Math.round(value)}ms`
  if (value < 60000) return `${(value / 1000).toFixed(2)}s`
  const minutes = Math.floor(value / 60000)
  const seconds = Math.round((value % 60000) / 1000)
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

export function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function pickTokenUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return { prompt: 0, completion: 0, total: 0, cached: 0, cacheWrite: 0 }
  }
  const prompt = Number(usage.promptTokens ?? usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0
  const completion = Number(usage.completionTokens ?? usage.completion_tokens ?? usage.output_tokens ?? 0) || 0
  const cached = Number(usage.cachedTokens ?? usage.cached_tokens ?? usage.cache_read_input_tokens ?? 0) || 0
  const cacheWrite = Number(usage.cacheWriteTokens ?? usage.cache_creation_input_tokens ?? 0) || 0
  const total = Number(usage.totalTokens ?? usage.total_tokens ?? 0) || (prompt + completion)
  return { prompt, completion, total, cached, cacheWrite }
}

function parseModelFromLogMessage(message) {
  const matched = String(message || '').match(/^API[^:]*:\s*(.+)$/)
  if (!matched || !matched[1]) return ''
  return matched[1].trim().replace(/\s+-\s+(success|failed)\s*$/i, '')
}

export function extractLogModel(log) {
  return log?.data?.request?.model
    || log?.data?.model
    || log?.metadata?.model
    || parseModelFromLogMessage(log?.message)
    || '-'
}

export function extractLogApiKey(log) {
  return log?.data?.request?.apiKeyName
    || log?.metadata?.apiKeyName
    || '-'
}

export function extractLogPolling(log) {
  if (log?.data?.request?.isPolling === true || log?.metadata?.isPolling === true) return true
  return false
}

export const USAGE_COLORS = ['#39845b', '#fd9891', '#4c8dad', '#e0b25c', '#7a6ccf', '#3aa8a0', '#d9784a', '#6b8f7a']
