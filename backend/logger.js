const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

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
    data,
    metadata,
    hostname: require('os').hostname(),
    pid: process.pid
  };
}

// 写入日志（JSON格式）
async function writeLog(logEntry) {
  try {
    await ensureLogsDir();
    const logFileName = getLogFileName();
    const logFilePath = path.join(LOGS_DIR, logFileName);

    const logLine = JSON.stringify(logEntry) + '\n';

    await fs.appendFile(logFilePath, logLine, 'utf8');

    // 通知实时监听器
    notifyListeners(logEntry);

    return logEntry;
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
    metadata = {}
  } = params;

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
      responseSize
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
  const logEntry = createLogEntry({
    level: result.status === 'failed' ? LogLevel.ERROR : LogLevel.INFO,
    type: LogType.API_REQUEST,
    message: `API请求: ${request.model} - ${result.status}`,
    traceId,
    data: {
      request: {
        clientIp,
        userAgent,
        apiKeyName,
        sessionId,
        isPolling,
        isNewConversation,
        model: request.model,
        stream: request.stream,
        messageCount: request.messages?.length || 0
      },
      providers: providers.map(p => ({
        attempt: p.attempt,
        providerId: p.providerId,
        providerName: p.providerName,
        status: p.status,
        statusCode: p.statusCode,
        duration: p.duration,
        error: p.error
      })),
      result: {
        status: result.status,
        successfulProvider: result.successfulProvider,
        totalAttempts: result.totalAttempts,
        totalDuration: result.totalDuration,
        tokenUsage: result.tokenUsage,
        estimatedCost: result.estimatedCost
      }
    },
    metadata
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
      filteredLogs = filteredLogs.filter(log => log.type === type);
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

// 解析新格式日志
function parseModernLogs(logEntries) {
  const stats = {
    totalApiCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    providerStats: {},
    levelStats: {},
    typeStats: {}
  };

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
      if (entry.type === LogType.API_CALL) {
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
                totalDuration: 0
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
      if (result?.tokenUsage) {
        if (!stats.tokenStats) {
          stats.tokenStats = {
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalTokens: 0
          };
        }

        stats.tokenStats.totalPromptTokens += result.tokenUsage.promptTokens || 0;
        stats.tokenStats.totalCompletionTokens += result.tokenUsage.completionTokens || 0;
        stats.tokenStats.totalTokens += result.tokenUsage.totalTokens || 0;
      }

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
  formatTimestamp
};
