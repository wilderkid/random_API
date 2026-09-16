const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { normalizeTokenUsage } = require('./proxyUtils');

const LOGS_DIR = path.join(__dirname, '../data/logs');
const ARCHIVE_DIR = path.join(__dirname, '../data/logs/archive');

// 日志级别枚举
const LogLevel = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL'
};

// 日志类型枚举
const LogType = {
  API_CALL: 'API_CALL',
  API_REQUEST: 'API_REQUEST',       // 新增：完整的API请求记录
  PROVIDER_SWITCH: 'PROVIDER_SWITCH', // 新增：提供商切换事件
  SESSION_BIND: 'SESSION_BIND',     // 新增：会话绑定事件
  TOKEN_USAGE: 'TOKEN_USAGE',       // 新增：Token使用汇总
  COST_TRACKING: 'COST_TRACKING',   // 新增：成本追踪
  SYSTEM: 'SYSTEM',
  USER_ACTION: 'USER_ACTION',
  AUTH: 'AUTH',
  DATABASE: 'DATABASE',
  PERFORMANCE: 'PERFORMANCE',
  SECURITY: 'SECURITY'
};

// 实时日志监听器
const logListeners = new Set();
let logWriteChain = Promise.resolve();

// 确保日志目录存在
async function ensureLogsDir() {
  try {
    await fs.mkdir(LOGS_DIR, { recursive: true });
    await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating logs directory:', error);
  }
}

// 生成请求追踪ID
function generateTraceId() {
  return crypto.randomBytes(16).toString('hex');
}

// 获取当前日期的日志文件名
function getLogFileName(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}.jsonl`;
}

// 获取归档文件名
function getArchiveFileName(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}.jsonl.gz`;
}

// 格式化时间戳（ISO格式）
function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

function isHttpLikeObject(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof value.pipe === 'function' && typeof value.on === 'function') return true;
  if (typeof value.setHeader === 'function' && typeof value.end === 'function') return true;
  const hasHeaders = !!value.headers;
  const hasNetworkHandle = !!(value.socket || value.connection || value.client || value._httpMessage);
  if (hasHeaders && hasNetworkHandle) return true;
  return false;
}

// 安全序列化：避免循环引用、复杂原生对象、超深层对象导致日志写入失败
function sanitizeForJson(value, seen = new WeakSet(), depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[MaxDepthExceeded]';

  const valueType = typeof value;

  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return value;
  }

  if (valueType === 'bigint') {
    return value.toString();
  }

  if (valueType === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      code: value.code || null,
      stack: value.stack || null
    };
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeForJson(item, seen, depth + 1));
  }

  if (valueType === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    if (value instanceof Date) {
      return value.toISOString();
    }

    const plain = {};
    for (const key of Object.keys(value)) {
      if (
        key === 'socket' ||
        key === 'connection' ||
        key === 'agent' ||
        key === '_httpMessage'
      ) {
        continue;
      }
      if (
        (key === 'req' || key === 'res' || key === 'request' || key === 'response') &&
        isHttpLikeObject(value[key])
      ) {
        continue;
      }
      plain[key] = sanitizeForJson(value[key], seen, depth + 1);
    }
    return plain;
  }

  return String(value);
}

// 创建日志条目对象
function createLogEntry({
  level = LogLevel.INFO,
  type,
  message,
  data = {},
  userId = null,
  traceId = null,
  metadata = {}
}) {
  return {
    timestamp: formatTimestamp(),
    level,
    type,
    message,
    userId,
    traceId: traceId || generateTraceId(),
    data: sanitizeForJson(data),
    metadata: sanitizeForJson(metadata),
    hostname: require('os').hostname(),
    pid: process.pid
  };
}

// 写入日志（JSON格式）
async function writeLog(logEntry) {
  const task = logWriteChain.then(async () => {
    await ensureLogsDir();
    const logFileName = getLogFileName();
    const logFilePath = path.join(LOGS_DIR, logFileName);

    const safeLogEntry = sanitizeForJson(logEntry);
    const logLine = JSON.stringify(safeLogEntry) + '\n';

    await fs.appendFile(logFilePath, logLine, 'utf8');
    notifyListeners(safeLogEntry);
    return safeLogEntry;
  });

  logWriteChain = task.catch(error => {
    // Keep the write queue alive after a failed append.
  });

  try {
    return await task;
  } catch (error) {
    console.error('Error writing log:', error);
  }
}

// 通知实时监听器
function notifyListeners(logEntry) {
  logListeners.forEach(listener => {
    try {
      listener(logEntry);
    } catch (error) {
      console.error('Error notifying log listener:', error);
    }
  });
}

// 添加实时日志监听器
function addLogListener(listener) {
  logListeners.add(listener);
  return () => logListeners.delete(listener);
}

// ==================== 日志记录函数 ====================

// 记录API调用（增强版，支持旧签名向后兼容）
// 旧签名: logApiCall(provider, model, success, errorMessage)
// 新签名: logApiCall({ provider, model, success, errorMessage, ... })
async function logApiCall(...args) {
  // 判断使用旧签名还是新签名
  let params;
  if (args.length === 1 && typeof args[0] === 'object') {
    // 新签名（对象参数）
    params = args[0];
  } else if (args.length >= 3) {
    // 旧签名（位置参数）
    params = {
      provider: args[0],
      model: args[1],
      success: args[2],
      errorMessage: args[3] || null
    };
  } else {
    throw new Error('logApiCall: 无效的参数格式');
  }

  const {
    provider,
    model,
    success,
    errorMessage = null,
    errorCode = null,
    userId = null,
    traceId = null,
    duration = null,
    requestSize = null,
    responseSize = null,
    tokenUsage = null,
    firstTokenMs = null,
    metadata = {}
  } = params;

  const resolvedFirstTokenMs = Number(firstTokenMs);
  const logEntry = createLogEntry({
    level: success ? LogLevel.INFO : LogLevel.ERROR,
    type: LogType.API_CALL,
    message: success ? `API调用成功: ${provider}/${model}` : `API调用失败: ${provider}/${model}`,
    userId,
    traceId,
    data: {
      provider,
      model,
      status: success ? 'SUCCESS' : 'FAILED',
      errorMessage,
      errorCode,
      duration,
      requestSize,
      responseSize,
      tokenUsage: compactTokenUsage(tokenUsage),
      ...(Number.isFinite(resolvedFirstTokenMs) && resolvedFirstTokenMs >= 0 ? { firstTokenMs: resolvedFirstTokenMs } : {})
    },
    metadata
  });

  return await writeLog(logEntry);
}

// ==================== API请求追踪（新增）====================

// 性能追踪器（轻量级，用于追踪请求耗时）
class PerformanceTracker {
  constructor(traceId) {
    this.traceId = traceId;
    this.checkpoints = new Map();
    this.startTime = Date.now();
  }

  // 记录检查点
  checkpoint(name) {
    this.checkpoints.set(name, Date.now());
  }

  // 获取从开始到某个检查点的耗时（毫秒）
  getDuration(checkpointName) {
    const checkpoint = this.checkpoints.get(checkpointName);
    if (!checkpoint) return null;
    return checkpoint - this.startTime;
  }

  // 获取两个检查点之间的耗时
  getDurationBetween(start, end) {
    const startCheckpoint = this.checkpoints.get(start);
    const endCheckpoint = this.checkpoints.get(end);
    if (!startCheckpoint || !endCheckpoint) return null;
    return endCheckpoint - startCheckpoint;
  }

  // 获取总耗时
  getTotalDuration() {
    return Date.now() - this.startTime;
  }

  // 获取所有检查点数据
  getMetrics() {
    const metrics = {
      traceId: this.traceId,
      startTime: this.startTime,
      totalDuration: this.getTotalDuration(),
      checkpoints: {}
    };

    let lastCheckpoint = this.startTime;
    for (const [name, time] of this.checkpoints) {
      metrics.checkpoints[name] = {
        time,
        durationFromStart: time - this.startTime,
        durationFromLast: time - lastCheckpoint
      };
      lastCheckpoint = time;
    }

    return metrics;
  }
}

// 记录完整的API请求（性能优先，异步非阻塞）
async function logApiRequest({
  traceId,
  clientIp,
  userAgent,
  apiKeyName,
  sessionId,
  isPolling,
  isNewConversation,
  request,
  providers,
  result,
  metadata = {}
}) {
  const providersList = Array.isArray(providers) ? providers : [];
  const requestInfo = {
    clientIp,
    userAgent,
    apiKeyName,
    sessionId,
    isPolling: !!isPolling,
    isNewConversation: !!isNewConversation,
    model: request?.model || null,
    stream: !!request?.stream,
    messageCount: request?.messageCount ?? request?.messages?.length ?? 0
  };
  const logEntry = createLogEntry({
    level: result.status === 'failed' ? LogLevel.ERROR : LogLevel.INFO,
    type: LogType.API_REQUEST,
    message: `API请求: ${requestInfo.model || 'unknown'} - ${result.status}`,
    traceId,
    data: {
      model: requestInfo.model,
      request: requestInfo,
      providers: providersList.map(p => {
        const providerEntry = {
          attempt: p.attempt,
          providerId: p.providerId,
          providerName: p.providerName,
          status: p.status,
          statusCode: p.statusCode,
          duration: p.duration,
          error: p.error
        };
        if (p.providerModelId) providerEntry.providerModelId = p.providerModelId;
        if (p.firstTokenMs !== null && p.firstTokenMs !== undefined && p.firstTokenMs !== '') {
          const providerFirstTokenMs = Number(p.firstTokenMs);
          if (Number.isFinite(providerFirstTokenMs) && providerFirstTokenMs >= 0) {
            providerEntry.firstTokenMs = providerFirstTokenMs;
          }
        }
        return providerEntry;
      }),
      result: {
        status: result.status,
        successfulProvider: result.successfulProvider,
        totalAttempts: result.totalAttempts,
        totalDuration: result.totalDuration,
        tokenUsage: compactTokenUsage(result.tokenUsage),
        estimatedCost: result.estimatedCost,
        ...(result.firstTokenMs !== null && result.firstTokenMs !== undefined && result.firstTokenMs !== '' && Number.isFinite(Number(result.firstTokenMs)) && Number(result.firstTokenMs) >= 0
          ? { firstTokenMs: Number(result.firstTokenMs) }
          : {})
      }
    },
    metadata: {
      ...metadata,
      model: metadata.model || requestInfo.model || null,
      apiKeyName: metadata.apiKeyName || apiKeyName || null,
      isPolling: metadata.isPolling ?? requestInfo.isPolling,
      stream: metadata.stream ?? requestInfo.stream,
      source: metadata.source || (metadata.endpoint === '/api/chat' ? 'ui' : 'proxy'),
      endpoint: metadata.endpoint || (metadata.source === 'ui' ? '/api/chat' : '/v1/chat/completions')
    }
  });

  // 异步写入日志，不阻塞请求处理
  setImmediate(async () => {
    try {
      await writeLog(logEntry);
    } catch (error) {
      console.error('[Logger] Error writing API request log:', error.message);
    }
  });

  return logEntry;
}

// 记录提供商切换事件
async function logProviderSwitch({
  traceId,
  fromProvider,
  toProvider,
  reason,
  metadata = {}
}) {
  const logEntry = createLogEntry({
    level: LogLevel.INFO,
    type: LogType.PROVIDER_SWITCH,
    message: `提供商切换: ${fromProvider} -> ${toProvider} (${reason})`,
    traceId,
    data: {
      fromProvider,
      toProvider,
      reason
    },
    metadata
  });

  // 异步写入，不阻塞
  setImmediate(async () => {
    try {
      await writeLog(logEntry);
    } catch (error) {
      console.error('[Logger] Error writing provider switch log:', error.message);
    }
  });

  return logEntry;
}

// 记录会话绑定事件
async function logSessionBind({
  traceId,
  sessionId,
  model,
  providerId,
  providerName,
  metadata = {}
}) {
  const logEntry = createLogEntry({
    level: LogLevel.INFO,
    type: LogType.SESSION_BIND,
    message: `会话绑定: ${sessionId} -> ${providerName}`,
    traceId,
    data: {
      sessionId,
      model,
      providerId,
      providerName
    },
    metadata
  });

  // 异步写入，不阻塞
  setImmediate(async () => {
    try {
      await writeLog(logEntry);
    } catch (error) {
      console.error('[Logger] Error writing session bind log:', error.message);
    }
  });

  return logEntry;
}

// 记录系统事件（增强版，支持旧签名向后兼容）
// 旧签名: logSystemEvent(event, details)
// 新签名: logSystemEvent({ event, details, level, ... })
async function logSystemEvent(...args) {
  // 判断使用旧签名还是新签名
  let params;
  if (args.length === 1 && typeof args[0] === 'object') {
    // 新签名（对象参数）
    params = args[0];
  } else if (args.length >= 1) {
    // 旧签名（位置参数）
    params = {
      event: args[0],
      details: args[1] || null
    };
  } else {
    throw new Error('logSystemEvent: 无效的参数格式');
  }

  const {
    event,
    details = null,
    level = LogLevel.INFO,
    userId = null,
    traceId = null,
    metadata = {}
  } = params;

  const logEntry = createLogEntry({
    level,
    type: LogType.SYSTEM,
    message: `系统事件: ${event}`,
    userId,
    traceId,
    data: {
      event,
      details
    },
    metadata
  });

  return await writeLog(logEntry);
}

// 记录用户操作
async function logUserAction({
  action,
  userId,
  details = null,
  traceId = null,
  metadata = {}
}) {
  const logEntry = createLogEntry({
    level: LogLevel.INFO,
    type: LogType.USER_ACTION,
    message: `用户操作: ${action}`,
    userId,
    traceId,
    data: {
      action,
      details
    },
    metadata
  });

  return await writeLog(logEntry);
}

// 记录认证事件
async function logAuthEvent({
  event,
  userId = null,
  success = true,
  errorMessage = null,
  ip = null,
  userAgent = null,
  traceId = null,
  metadata = {}
}) {
  const logEntry = createLogEntry({
    level: success ? LogLevel.INFO : LogLevel.WARN,
    type: LogType.AUTH,
    message: `认证事件: ${event} - ${success ? '成功' : '失败'}`,
    userId,
    traceId,
    data: {
      event,
      success,
      errorMessage,
      ip,
      userAgent
    },
    metadata
  });

  return await writeLog(logEntry);
}

// 记录数据库操作
async function logDatabaseEvent({
  operation,
  table,
  success = true,
  errorMessage = null,
  duration = null,
  userId = null,
  traceId = null,
  metadata = {}
}) {
  const logEntry = createLogEntry({
    level: success ? LogLevel.DEBUG : LogLevel.ERROR,
    type: LogType.DATABASE,
    message: `数据库操作: ${operation} on ${table}`,
    userId,
    traceId,
    data: {
      operation,
      table,
      success,
      errorMessage,
      duration
    },
    metadata
  });

  return await writeLog(logEntry);
}

// 记录性能指标
async function logPerformance({
  metric,
  value,
  unit = 'ms',
  threshold = null,
  userId = null,
  traceId = null,
  metadata = {}
}) {
  const level = threshold && value > threshold ? LogLevel.WARN : LogLevel.DEBUG;

  const logEntry = createLogEntry({
    level,
    type: LogType.PERFORMANCE,
    message: `性能指标: ${metric} = ${value}${unit}`,
    userId,
    traceId,
    data: {
      metric,
      value,
      unit,
      threshold
    },
    metadata
  });

  return await writeLog(logEntry);
}

// 记录安全事件
async function logSecurityEvent({
  event,
  severity = 'medium', // low, medium, high, critical
  userId = null,
  ip = null,
  details = null,
  traceId = null,
  metadata = {}
}) {
  const severityLevelMap = {
    low: LogLevel.INFO,
    medium: LogLevel.WARN,
    high: LogLevel.ERROR,
    critical: LogLevel.CRITICAL
  };

  const logEntry = createLogEntry({
    level: severityLevelMap[severity] || LogLevel.WARN,
    type: LogType.SECURITY,
    message: `安全事件: ${event}`,
    userId,
    traceId,
    data: {
      event,
      severity,
      ip,
      details
    },
    metadata
  });

  return await writeLog(logEntry);
}

// 通用日志记录函数
async function log({
  level = LogLevel.INFO,
  type = LogType.SYSTEM,
  message,
  data = {},
  userId = null,
  traceId = null,
  metadata = {}
}) {
  const logEntry = createLogEntry({
    level,
    type,
    message,
    userId,
    traceId,
    data,
    metadata
  });

  return await writeLog(logEntry);
}

// ==================== 日志查询函数 ====================

// 读取并解析日志文件
async function readLogs(startDate, endDate) {
  try {
    await ensureLogsDir();

    const start = new Date(startDate);
    const end = new Date(endDate);

    const logFiles = [];
    const currentDate = new Date(start);

    while (currentDate <= end) {
      logFiles.push(getLogFileName(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const logEntries = [];

    for (const logFile of logFiles) {
      const logFilePath = path.join(LOGS_DIR, logFile);
      try {
        const content = await fs.readFile(logFilePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            logEntries.push(entry);
          } catch (parseError) {
            console.error(`Error parsing log line: ${parseError.message}`);
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error(`Error reading log file ${logFile}:`, error);
        }
      }
    }

    // 按时间戳排序（最新的在前）
    logEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return logEntries;
  } catch (error) {
    console.error('Error reading logs:', error);
    throw error;
  }
}

// 搜索日志（支持多条件过滤）
async function searchLogs({
  startDate,
  endDate,
  level = null,
  type = null,
  userId = null,
  traceId = null,
  keyword = null,
  limit = 100,
  offset = 0
}) {
  try {
    const allLogs = await readLogs(startDate, endDate);

    let filteredLogs = allLogs;

    // 按级别过滤
    if (level) {
      filteredLogs = filteredLogs.filter(log => log.level === level);
    }

    // 按类型过滤
    if (type) {
      const types = String(type).split(',').map(item => item.trim()).filter(Boolean);
      if (types.length === 1) {
        filteredLogs = filteredLogs.filter(log => log.type === types[0]);
      } else if (types.length > 1) {
        const typeSet = new Set(types);
        filteredLogs = filteredLogs.filter(log => typeSet.has(log.type));
      }
    }

    // 按用户ID过滤
    if (userId) {
      filteredLogs = filteredLogs.filter(log => log.userId === userId);
    }

    // 按追踪ID过滤
    if (traceId) {
      filteredLogs = filteredLogs.filter(log => log.traceId === traceId);
    }

    // 按关键词搜索（消息或数据中包含关键词）
    if (keyword) {
      const keywordLower = keyword.toLowerCase();
      filteredLogs = filteredLogs.filter(log => {
        const messageMatch = log.message && log.message.toLowerCase().includes(keywordLower);
        const dataMatch = JSON.stringify(log.data).toLowerCase().includes(keywordLower);
        return messageMatch || dataMatch;
      });
    }

    // 分页
    const total = filteredLogs.length;
    const paginatedLogs = filteredLogs.slice(offset, offset + limit);

    return {
      logs: paginatedLogs,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    };
  } catch (error) {
    console.error('Error searching logs:', error);
    throw error;
  }
}

// 获取日志统计（兼容旧版，增强版）
function parseLogsForStats(logsContent) {
  // 如果传入的是字符串（旧格式），尝试解析
  if (typeof logsContent === 'string') {
    return parseLegacyLogs(logsContent);
  }

  // 如果传入的是日志数组（新格式）
  if (Array.isArray(logsContent)) {
    return parseModernLogs(logsContent);
  }

  return {
    totalApiCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    providerStats: {}
  };
}

// 解析旧格式日志（兼容性）
function parseLegacyLogs(logsContent) {
  const lines = logsContent.split('\n').filter(line => line.trim());

  const stats = {
    totalApiCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    providerStats: {},
    levelStats: {},
    typeStats: {}
  };

  for (const line of lines) {
    if (line.includes('API_CALL')) {
      stats.totalApiCalls++;

      const timestampMatch = line.match(/^([^|]+)\|/);
      const providerMatch = line.match(/Provider: ([^|]+)/);
      const modelMatch = line.match(/Model: ([^|]+)/);
      const statusMatch = line.match(/Status: (\w+)/);
      const errorMatch = line.match(/Error: (.+)$/);

      if (providerMatch && modelMatch && statusMatch) {
        const timestamp = timestampMatch ? timestampMatch[1].trim() : '';
        const provider = providerMatch[1].trim();
        const model = modelMatch[1].trim();
        const status = statusMatch[1].trim();
        const errorMessage = errorMatch ? errorMatch[1].trim() : '';

        const isSuccess = status === 'SUCCESS';

        if (isSuccess) {
          stats.successfulCalls++;
        } else {
          stats.failedCalls++;
        }

        if (!stats.providerStats[provider]) {
          stats.providerStats[provider] = {
            total: 0,
            success: 0,
            failed: 0,
            models: {}
          };
        }

        stats.providerStats[provider].total++;
        if (isSuccess) {
          stats.providerStats[provider].success++;
        } else {
          stats.providerStats[provider].failed++;
        }

        if (!stats.providerStats[provider].models[model]) {
          stats.providerStats[provider].models[model] = {
            total: 0,
            success: 0,
            failed: 0,
            errors: []
          };
        }

        stats.providerStats[provider].models[model].total++;
        if (isSuccess) {
          stats.providerStats[provider].models[model].success++;
        } else {
          stats.providerStats[provider].models[model].failed++;
          stats.providerStats[provider].models[model].errors.push({
            timestamp,
            message: errorMessage
          });
        }
      }
    }
  }

  return stats;
}

function compactTokenUsage(usage) {
  return normalizeTokenUsage(usage);
}

function extractRequestModel(entry) {
  const data = entry && entry.data ? entry.data : {};
  const metadata = entry && entry.metadata ? entry.metadata : {};
  if (data.request && data.request.model) return data.request.model;
  if (data.model) return data.model;
  if (metadata.model) return metadata.model;
  const message = String((entry && entry.message) || '');
  const matched = message.match(/^API[^:]*:\s*(.+)$/);
  if (matched && matched[1]) {
    let value = matched[1].trim();
    value = value.replace(/\s+-\s+(success|failed)\s*$/i, '');
    const slash = value.indexOf('/');
    return slash >= 0 ? value.slice(slash + 1) : value;
  }
  return null;
}

function extractRequestEndpoint(entry) {
  const metadata = entry && entry.metadata ? entry.metadata : {};
  if (metadata.endpoint) {
    const endpoint = String(metadata.endpoint);
    return endpoint.startsWith('/') ? endpoint : '/v1/' + endpoint;
  }
  if (metadata.isStreaming !== undefined || (entry.data && entry.data.request)) {
    return '/v1/chat/completions';
  }
  return 'internal';
}

function timelineKey(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  return year + '-' + month + '-' + day + ' ' + hour + ':00';
}

function ensureCounterBucket(target, key, extra) {
  if (!target[key]) {
    target[key] = Object.assign({
      total: 0,
      success: 0,
      failed: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCachedTokens: 0,
      totalCacheWriteTokens: 0,
      avgDuration: 0,
      totalDuration: 0
    }, extra || {});
  }
  return target[key];
}

function addTokenAmounts(target, usage) {
  if (!target || !usage) return;
  target.totalPromptTokens = (target.totalPromptTokens || 0) + (usage.promptTokens || 0);
  target.totalCompletionTokens = (target.totalCompletionTokens || 0) + (usage.completionTokens || 0);
  target.totalTokens = (target.totalTokens || 0) + (usage.totalTokens || 0);
  target.totalCachedTokens = (target.totalCachedTokens || 0) + (usage.cachedTokens || 0);
  target.totalCacheWriteTokens = (target.totalCacheWriteTokens || 0) + (usage.cacheWriteTokens || 0);
}

function addTimelinePoint(stats, timestamp, details) {
  const key = timelineKey(timestamp);
  if (!key) return;
  if (!stats.timeline) stats.timeline = {};
  const bucket = ensureCounterBucket(stats.timeline, key);
  bucket.total += 1;
  if (details && details.success) bucket.success += 1;
  if (details && details.failed) bucket.failed += 1;
  if (details && details.duration) {
    bucket.totalDuration += details.duration;
    bucket.avgDuration = bucket.totalDuration / bucket.total;
  }
  addTokenAmounts(bucket, details && details.usage);
}

function isThinDuplicateApiCall(entry, hasApiRequests) {
  if (!hasApiRequests) return false;
  if (entry.traceId) return false;
  const duration = entry.data && entry.data.duration;
  if (Number(duration) > 0) return false;
  if (entry.data && entry.data.tokenUsage) return false;
  return true;
}

function addFirstTokenStats(target, ms) {
  if (!target) return;
  if (ms === null || ms === undefined || ms === '') return;
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return;
  if (!target.firstTokenCount) {
    target.firstTokenCount = 0;
    target.totalFirstTokenMs = 0;
    target.avgFirstTokenMs = 0;
    target.minFirstTokenMs = value;
    target.maxFirstTokenMs = value;
  }
  target.firstTokenCount += 1;
  target.totalFirstTokenMs += value;
  target.avgFirstTokenMs = target.totalFirstTokenMs / target.firstTokenCount;
  target.minFirstTokenMs = Math.min(target.minFirstTokenMs, value);
  target.maxFirstTokenMs = Math.max(target.maxFirstTokenMs, value);
}

function resolveAttemptFirstTokenMs(provider, result) {
  if (provider && provider.firstTokenMs !== null && provider.firstTokenMs !== undefined && provider.firstTokenMs !== '') {
    const direct = Number(provider.firstTokenMs);
    if (Number.isFinite(direct) && direct >= 0) return direct;
  }
  if (!provider || provider.status !== 'success') return null;
  const successId = result && result.successfulProvider;
  if (successId && successId !== provider.providerId && successId !== provider.providerName) {
    return null;
  }
  if (result && result.firstTokenMs !== null && result.firstTokenMs !== undefined && result.firstTokenMs !== '') {
    const fallback = Number(result.firstTokenMs);
    if (Number.isFinite(fallback) && fallback >= 0) return fallback;
  }
  return null;
}

// 解析新格式日志
function parseModernLogs(logEntries) {
  const stats = {
    totalApiCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    providerStats: {},
    modelStats: {},
    endpointStats: {},
    timeline: {},
    tokenStats: {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCachedTokens: 0,
      totalCacheWriteTokens: 0
    },
    levelStats: {},
    typeStats: {}
  };
  const hasApiRequests = logEntries.some(item => item && item.type === LogType.API_REQUEST);

  // 初始化级别统计
  Object.values(LogLevel).forEach(level => {
    stats.levelStats[level] = 0;
  });

  // 初始化类型统计
  Object.values(LogType).forEach(type => {
    stats.typeStats[type] = 0;
  });

  for (const entry of logEntries) {
    try {
      // 统计级别
      if (entry.level && stats.levelStats[entry.level] !== undefined) {
        stats.levelStats[entry.level]++;
      }

      // 统计类型
      if (entry.type && stats.typeStats[entry.type] !== undefined) {
        stats.typeStats[entry.type]++;
      }

      // API调用统计
      if (entry.type === LogType.API_CALL && !isThinDuplicateApiCall(entry, hasApiRequests)) {
        stats.totalApiCalls++;

        const { provider, model, status } = entry.data || {};
        const isSuccess = status === 'SUCCESS';

        if (isSuccess) {
          stats.successfulCalls++;
        } else {
          stats.failedCalls++;
        }

        if (provider) {
          if (!stats.providerStats[provider]) {
            stats.providerStats[provider] = {
              total: 0,
              success: 0,
              failed: 0,
              models: {}
            };
          }

          stats.providerStats[provider].total++;
          if (isSuccess) {
            stats.providerStats[provider].success++;
          } else {
            stats.providerStats[provider].failed++;
          }

          if (model) {
            if (!stats.providerStats[provider].models[model]) {
              stats.providerStats[provider].models[model] = {
                total: 0,
                success: 0,
                failed: 0,
                errors: []
              };
            }

            stats.providerStats[provider].models[model].total++;
            if (isSuccess) {
              stats.providerStats[provider].models[model].success++;
            } else {
              stats.providerStats[provider].models[model].failed++;
              if (entry.data.errorMessage) {
                stats.providerStats[provider].models[model].errors.push({
                  timestamp: entry.timestamp,
                  message: entry.data.errorMessage,
                  errorCode: entry.data.errorCode,
                  traceId: entry.traceId,
                  userId: entry.userId
                });
              }
            }
          }
        }

        const callModel = extractRequestModel(entry);
        const callProvider = (entry.data || {}).provider;
        const callUsage = compactTokenUsage((entry.data || {}).tokenUsage);
        const callSuccess = (entry.data || {}).status === 'SUCCESS';
        if (callModel) {
          const modelBucket = ensureCounterBucket(stats.modelStats, callModel);
          modelBucket.total += 1;
          if (callSuccess) modelBucket.success += 1;
          else modelBucket.failed += 1;
          addTokenAmounts(modelBucket, callUsage);
        }
        if (callProvider) {
          addTokenAmounts(stats.providerStats[callProvider], callUsage);
        }
        const callEndpoint = extractRequestEndpoint(entry);
        const endpointBucket = ensureCounterBucket(stats.endpointStats, callEndpoint);
        endpointBucket.total += 1;
        if (callSuccess) endpointBucket.success += 1;
        else endpointBucket.failed += 1;
        addTokenAmounts(endpointBucket, callUsage);
        addTimelinePoint(stats, entry.timestamp, {
          success: callSuccess,
          failed: !callSuccess,
          usage: callUsage,
          duration: (entry.data || {}).duration || 0
        });
        const callDuration = Number((entry.data || {}).duration) || 0;
        addTokenAmounts(stats.tokenStats, callUsage);
        if (callDuration > 0) {
          if (!stats.performanceStats) {
            stats.performanceStats = {
              totalDuration: 0,
              avgDuration: 0,
              minDuration: Infinity,
              maxDuration: 0
            };
          }
          stats.performanceStats.totalDuration += callDuration;
          stats.performanceStats.avgDuration = stats.performanceStats.totalDuration / stats.totalApiCalls;
          stats.performanceStats.minDuration = Math.min(stats.performanceStats.minDuration, callDuration);
          stats.performanceStats.maxDuration = Math.max(stats.performanceStats.maxDuration, callDuration);
        }
        if (callSuccess) {
          if (!stats.performanceStats) {
            stats.performanceStats = {
              totalDuration: 0,
              avgDuration: 0,
              minDuration: Infinity,
              maxDuration: 0
            };
          }
          addFirstTokenStats(stats.performanceStats, (entry.data || {}).firstTokenMs);
          if (callModel) addFirstTokenStats(stats.modelStats[callModel], (entry.data || {}).firstTokenMs);
          if (callProvider) addFirstTokenStats(stats.providerStats[callProvider], (entry.data || {}).firstTokenMs);
        }
      }

    // API请求统计（新增强版）
    if (entry.type === LogType.API_REQUEST) {
      const { request, providers, result } = entry.data || {};

      // 基础统计
      stats.totalApiCalls++;
      if (result?.status === 'success') {
        stats.successfulCalls++;
      } else {
        stats.failedCalls++;
      }

      // 提供商统计
      if (providers && Array.isArray(providers)) {
        for (const provider of providers) {
          const providerName = provider.providerName;
          if (!providerName) continue;

          // 确保提供商对象存在
          if (!stats.providerStats[providerName]) {
            stats.providerStats[providerName] = {
              total: 0,
              success: 0,
              failed: 0,
              avgDuration: 0,
              totalDuration: 0,
              models: {},
              apiKeys: {}
            };
          }

          stats.providerStats[providerName].total++;
          if (provider.status === 'success') {
            stats.providerStats[providerName].success++;
          } else {
            stats.providerStats[providerName].failed++;
          }

          // 性能统计
          if (provider.duration) {
            stats.providerStats[providerName].totalDuration += provider.duration;
            stats.providerStats[providerName].avgDuration =
              stats.providerStats[providerName].totalDuration /
              stats.providerStats[providerName].total;
          }

          if (provider.status === 'success') {
            addFirstTokenStats(stats.providerStats[providerName], resolveAttemptFirstTokenMs(provider, result));
          }

          // 模型统计
          if (request?.model) {
            const modelName = request.model;

            // 确保 models 对象存在
            if (!stats.providerStats[providerName].models) {
              stats.providerStats[providerName].models = {};
            }

            if (!stats.providerStats[providerName].models[modelName]) {
              stats.providerStats[providerName].models[modelName] = {
                total: 0,
                success: 0,
                failed: 0,
                avgDuration: 0,
                totalDuration: 0,
                totalPromptTokens: 0,
                totalCompletionTokens: 0,
                totalTokens: 0
              };
            }

            stats.providerStats[providerName].models[modelName].total++;
            if (provider.status === 'success') {
              stats.providerStats[providerName].models[modelName].success++;
            } else {
              stats.providerStats[providerName].models[modelName].failed++;
            }

            if (provider.duration) {
              stats.providerStats[providerName].models[modelName].totalDuration += provider.duration;
              stats.providerStats[providerName].models[modelName].avgDuration =
                stats.providerStats[providerName].models[modelName].totalDuration /
                stats.providerStats[providerName].models[modelName].total;
            }

            if (provider.status === 'success') {
              addFirstTokenStats(
                stats.providerStats[providerName].models[modelName],
                resolveAttemptFirstTokenMs(provider, result)
              );
            }

            if (provider.status === 'success') {
              const usage = compactTokenUsage(result && result.tokenUsage);
              addTokenAmounts(stats.providerStats[providerName], usage);
              addTokenAmounts(stats.providerStats[providerName].models[modelName], usage);
            }
          }

          // API密钥统计
          if (request?.apiKeyName) {
            const apiKeyName = request.apiKeyName;

            // 确保 apiKeys 对象存在
            if (!stats.providerStats[providerName].apiKeys) {
              stats.providerStats[providerName].apiKeys = {};
            }

            if (!stats.providerStats[providerName].apiKeys[apiKeyName]) {
              stats.providerStats[providerName].apiKeys[apiKeyName] = {
                total: 0,
                success: 0,
                failed: 0
              };
            }

            stats.providerStats[providerName].apiKeys[apiKeyName].total++;
            if (provider.status === 'success') {
              stats.providerStats[providerName].apiKeys[apiKeyName].success++;
            } else {
              stats.providerStats[providerName].apiKeys[apiKeyName].failed++;
            }
          }
        }
      }

      // Token使用统计
      const requestUsage = compactTokenUsage(result && result.tokenUsage);
      addTokenAmounts(stats.tokenStats, requestUsage);

      const requestModel = extractRequestModel(entry);
      const requestSuccess = result && result.status === 'success';
      if (requestModel) {
        const modelBucket = ensureCounterBucket(stats.modelStats, requestModel);
        modelBucket.total += 1;
        if (requestSuccess) modelBucket.success += 1;
        else modelBucket.failed += 1;
        if (result && result.totalDuration) {
          modelBucket.totalDuration += result.totalDuration;
          modelBucket.avgDuration = modelBucket.totalDuration / modelBucket.total;
        }
        if (requestSuccess) addFirstTokenStats(modelBucket, result && result.firstTokenMs);
        addTokenAmounts(modelBucket, requestUsage);
      }

      const requestEndpoint = extractRequestEndpoint(entry);
      const endpointBucket = ensureCounterBucket(stats.endpointStats, requestEndpoint);
      endpointBucket.total += 1;
      if (requestSuccess) endpointBucket.success += 1;
      else endpointBucket.failed += 1;
      addTokenAmounts(endpointBucket, requestUsage);

      addTimelinePoint(stats, entry.timestamp, {
        success: requestSuccess,
        failed: !requestSuccess,
        usage: requestUsage,
        duration: (result && result.totalDuration) || 0
      });

      // 性能统计
      if (result?.totalDuration) {
        if (!stats.performanceStats) {
          stats.performanceStats = {
            totalDuration: 0,
            avgDuration: 0,
            minDuration: Infinity,
            maxDuration: 0
          };
        }

        stats.performanceStats.totalDuration += result.totalDuration;
        stats.performanceStats.avgDuration = stats.performanceStats.totalDuration / stats.totalApiCalls;
        stats.performanceStats.minDuration = Math.min(
          stats.performanceStats.minDuration,
          result.totalDuration
        );
        stats.performanceStats.maxDuration = Math.max(
          stats.performanceStats.maxDuration,
          result.totalDuration
        );
      }

      if (result?.status === 'success') {
        if (!stats.performanceStats) {
          stats.performanceStats = {
            totalDuration: 0,
            avgDuration: 0,
            minDuration: Infinity,
            maxDuration: 0
          };
        }
        addFirstTokenStats(stats.performanceStats, result.firstTokenMs);
      }

      // 成本统计
      if (result?.estimatedCost?.amount) {
        if (!stats.costStats) {
          stats.costStats = {
            totalCost: 0,
            currency: 'USD'
          };
        }

        stats.costStats.totalCost += result.estimatedCost.amount;
        stats.costStats.currency = result.estimatedCost.currency || 'USD';
      }
    }
  } catch (err) {
    // 忽略无法解析的日志条目，继续处理下一个
    console.error('[Logger] Error parsing log entry:', err.message);
    console.error('[Logger] Log entry:', JSON.stringify(entry).substring(0, 200));
  }
}

return stats;
}

// ==================== 日志管理函数 ====================

// 删除日志文件
async function deleteLogs(startDate, endDate) {
  try {
    await ensureLogsDir();

    const start = new Date(startDate);
    const end = new Date(endDate);

    const logFiles = [];
    const currentDate = new Date(start);

    while (currentDate <= end) {
      logFiles.push(getLogFileName(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    let deletedCount = 0;
    const errors = [];

    for (const logFile of logFiles) {
      const logFilePath = path.join(LOGS_DIR, logFile);
      try {
        await fs.unlink(logFilePath);
        deletedCount++;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          errors.push({ file: logFile, error: error.message });
        }
      }
    }

    return { deletedCount, errors };
  } catch (error) {
    console.error('Error deleting logs:', error);
    throw error;
  }
}

// 清空所有日志
async function clearAllLogs() {
  try {
    await ensureLogsDir();

    const files = await fs.readdir(LOGS_DIR);
    const logFiles = files.filter(file => file.endsWith('.jsonl') || file.endsWith('.log'));

    let deletedCount = 0;
    const errors = [];

    for (const logFile of logFiles) {
      const logFilePath = path.join(LOGS_DIR, logFile);
      try {
        await fs.unlink(logFilePath);
        deletedCount++;
      } catch (error) {
        errors.push({ file: logFile, error: error.message });
      }
    }

    return { deletedCount, errors };
  } catch (error) {
    console.error('Error clearing all logs:', error);
    throw error;
  }
}

// 归档旧日志（超过30天）
async function archiveOldLogs(daysToKeep = 30) {
  try {
    await ensureLogsDir();

    const files = await fs.readdir(LOGS_DIR);
    const logFiles = files.filter(file => file.endsWith('.jsonl'));

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    let archivedCount = 0;
    const errors = [];

    for (const logFile of logFiles) {
      // 从文件名提取日期
      const dateMatch = logFile.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (!dateMatch) continue;

      const fileDate = new Date(dateMatch[1]);

      if (fileDate < cutoffDate) {
        const sourcePath = path.join(LOGS_DIR, logFile);
        const destPath = path.join(ARCHIVE_DIR, logFile);

        try {
          await fs.rename(sourcePath, destPath);
          archivedCount++;
        } catch (error) {
          errors.push({ file: logFile, error: error.message });
        }
      }
    }

    return { archivedCount, errors };
  } catch (error) {
    console.error('Error archiving logs:', error);
    throw error;
  }
}

// 获取可用的日志日期列表
async function getAvailableLogDates() {
  try {
    await ensureLogsDir();

    const files = await fs.readdir(LOGS_DIR);
    const logFiles = files.filter(file => file.endsWith('.jsonl'));

    const dates = [];
    for (const logFile of logFiles) {
      const dateMatch = logFile.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (dateMatch) {
        dates.push(dateMatch[1]);
      }
    }

    return dates.sort().reverse();
  } catch (error) {
    console.error('Error getting available log dates:', error);
    return [];
  }
}

// 导出日志为CSV格式
function exportToCSV(logEntries) {
  if (!logEntries || logEntries.length === 0) {
    return '';
  }

  // CSV头部
  const headers = ['Timestamp', 'Level', 'Type', 'Message', 'User ID', 'Trace ID', 'Data'];

  // CSV行
  const rows = logEntries.map(entry => {
    return [
      entry.timestamp,
      entry.level,
      entry.type,
      `"${(entry.message || '').replace(/"/g, '""')}"`,
      entry.userId || '',
      entry.traceId || '',
      `"${JSON.stringify(entry.data || {}).replace(/"/g, '""')}"`
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

// 导出日志为JSON格式
function exportToJSON(logEntries) {
  return JSON.stringify(logEntries, null, 2);
}

module.exports = {
  // 枚举
  LogLevel,
  LogType,

  // 日志记录函数
  logApiCall,
  logApiRequest,        // 新增
  logProviderSwitch,    // 新增
  logSessionBind,       // 新增
  logSystemEvent,
  logUserAction,
  logAuthEvent,
  logDatabaseEvent,
  logPerformance,
  logSecurityEvent,
  log,

  // 类
  PerformanceTracker,   // 新增

  // 日志查询函数
  readLogs,
  searchLogs,
  parseLogsForStats,
  parseModernLogs,
  getAvailableLogDates,

  // 日志管理函数
  ensureLogsDir,
  deleteLogs,
  clearAllLogs,
  archiveOldLogs,

  // 导出函数
  exportToCSV,
  exportToJSON,

  // 实时日志
  addLogListener,

  // 工具函数
  generateTraceId,
  formatTimestamp,
  sanitizeForJson,
  extractRequestModel,
  isHttpLikeObject
};
