const fs = require('fs').promises;
const path = require('path');

const LOGS_DIR = path.join(__dirname, '../data/logs');

// 确保日志目录存在
async function ensureLogsDir() {
  try {
    await fs.mkdir(LOGS_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating logs directory:', error);
  }
}

// 获取当前日期的日志文件名
function getLogFileName(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}.log`;
}

// 格式化时间戳
function formatTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
}

// 写入日志
async function writeLog(logEntry) {
  try {
    await ensureLogsDir();
    const logFileName = getLogFileName();
    const logFilePath = path.join(LOGS_DIR, logFileName);
    
    const timestamp = formatTimestamp();
    const logLine = `${timestamp} | ${logEntry}\n`;
    
    await fs.appendFile(logFilePath, logLine, 'utf8');
  } catch (error) {
    console.error('Error writing log:', error);
  }
}

// 记录API调用
async function logApiCall(provider, model, success, errorMessage = null) {
  const status = success ? 'SUCCESS' : 'FAILED';
  const error = errorMessage ? ` | Error: ${errorMessage}` : '';
  const logEntry = `API_CALL | Provider: ${provider} | Model: ${model} | Status: ${status}${error}`;
  await writeLog(logEntry);
}

// 记录系统事件
async function logSystemEvent(event, details = '') {
  const logEntry = `SYSTEM | Event: ${event} | ${details}`;
  await writeLog(logEntry);
}

// 读取日志文件
async function readLogs(startDate, endDate) {
  try {
    await ensureLogsDir();
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // 验证日期范围（最多7天）
    const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if (daysDiff > 7) {
      throw new Error('日期范围不能超过7天');
    }
    
    const logFiles = [];
    const currentDate = new Date(start);
    
    while (currentDate <= end) {
      logFiles.push(getLogFileName(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    const logsContent = [];
    
    for (const logFile of logFiles) {
      const logFilePath = path.join(LOGS_DIR, logFile);
      try {
        const content = await fs.readFile(logFilePath, 'utf8');
        logsContent.push(content);
      } catch (error) {
        // 文件不存在，跳过
        if (error.code !== 'ENOENT') {
          console.error(`Error reading log file ${logFile}:`, error);
        }
      }
    }
    
    return logsContent.join('');
  } catch (error) {
    console.error('Error reading logs:', error);
    throw error;
  }
}

// 解析日志内容，生成统计数据
function parseLogsForStats(logsContent) {
  const lines = logsContent.split('\n').filter(line => line.trim());
  
  const stats = {
    totalApiCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    providerStats: {}, // { providerName: { total, success, failed, models: { modelName: { total, success, failed, errors: [] } } } }
  };
  
  for (const line of lines) {
    if (line.includes('API_CALL')) {
      stats.totalApiCalls++;
      
      // 解析日志行
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
        
        // 初始化供应商统计
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
        
        // 初始化模型统计
        if (!stats.providerStats[provider].models[model]) {
          stats.providerStats[provider].models[model] = {
            total: 0,
            success: 0,
            failed: 0,
            errors: [] // 存储错误详情
          };
        }
        
        stats.providerStats[provider].models[model].total++;
        if (isSuccess) {
          stats.providerStats[provider].models[model].success++;
        } else {
          stats.providerStats[provider].models[model].failed++;
          // 记录错误详情
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
        // 文件不存在，跳过
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
    const logFiles = files.filter(file => file.endsWith('.log'));
    
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

module.exports = {
  logApiCall,
  logSystemEvent,
  readLogs,
  parseLogsForStats,
  ensureLogsDir,
  deleteLogs,
  clearAllLogs
};
