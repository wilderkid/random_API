const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const {
  logApiCall,
  logApiRequest,         // 新增
  logProviderSwitch,      // 新增
  logSessionBind,         // 新增
  logSystemEvent,
  readLogs,
  searchLogs,
  parseLogsForStats,
  deleteLogs,
  clearAllLogs,
  archiveOldLogs,
  getAvailableLogDates,
  exportToCSV,
  exportToJSON,
  addLogListener,
  LogLevel,
  LogType,
  PerformanceTracker,      // 新增
  generateTraceId         // 新增
} = require('./logger');

const app = express();
const PORT = 3000;

// Performance optimization: Add debug mode control
const DEBUG_MODE = process.env.NODE_ENV !== 'production';
const VERBOSE_LOGGING = process.env.VERBOSE_LOGGING === 'true';

// 统计数据缓存（性能优化）
const statsCache = new Map();
const STATS_CACHE_TTL = 60 * 1000; // 缓存60秒
const TODAY_CACHE_TTL = 10 * 1000; // 当天数据缓存10秒（实时性更高）

function getCachedStats(key, isToday = false) {
  const cached = statsCache.get(key);
  if (!cached) return null;
  const ttl = isToday ? TODAY_CACHE_TTL : STATS_CACHE_TTL;
  if (Date.now() - cached.timestamp > ttl) {
    statsCache.delete(key);
    return null;
  }
  return cached.data;
}

function setCachedStats(key, data, isToday = false) {
  statsCache.set(key, {
    data,
    timestamp: Date.now(),
    isToday
  });
}

function clearStatsCache() {
  statsCache.clear();
}

// 定期清理过期缓存（每分钟执行一次）
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of statsCache.entries()) {
    const ttl = value.isToday ? TODAY_CACHE_TTL : STATS_CACHE_TTL;
    if (now - value.timestamp > ttl) {
      statsCache.delete(key);
    }
  }
}, 60 * 1000);

// 获取本地今天的日期（YYYY-MM-DD格式）
function getLocalToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Optimized logging functions
const log = {
  debug: DEBUG_MODE ? console.log : () => {},
  verbose: (DEBUG_MODE && VERBOSE_LOGGING) ? console.log : () => {},
  info: console.log,
  error: console.error,
  warn: console.warn
};

app.use(cors());
app.use(express.json({ limit: '50mb' })); // 增加请求体大小限制
app.use(express.urlencoded({ limit: '50mb', extended: true })); // 增加URL编码请求体大小限制
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// 添加全局CORS中间件，确保所有响应都包含CORS头
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-ID');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');

  // 处理OPTIONS预检请求
  if (req.method === 'OPTIONS') {
    console.log(`[DEBUG] Handling OPTIONS request for ${req.path}`);
    return res.status(200).end();
  }

  next();
});

const DATA_DIR = path.join(__dirname, '../data');
const API_SETTINGS_FILE = path.join(DATA_DIR, 'api_settings.json');
const USER_SETTINGS_FILE = path.join(DATA_DIR, 'user_settings.json');
const CONVERSATIONS_DIR = path.join(DATA_DIR, 'conversations');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const PROMPTS_FILE = path.join(DATA_DIR, 'prompts.json');
const LANGUAGES_FILE = path.join(DATA_DIR, 'languages.json');

// 性能优化：添加内存缓存
let apiSettingsCache = null;
let userSettingsCache = null;
let promptsCache = null;
let languagesCache = null;
let apiSettingsCacheTime = 0;
let userSettingsCacheTime = 0;
let promptsCacheTime = 0;
let languagesCacheTime = 0;
const CACHE_TTL = 5000; // 5秒缓存

// 配置常量
const CONFIG = {
  CACHE_TTL: 5000, // 缓存过期时间（毫秒）
  MAX_CONVERSATION_MAPPINGS: 1000, // 最大会话映射数量
  SESSION_EXPIRATION_TIME: 24 * 60 * 60 * 1000, // 短会话过期时间（24小时）
  EXTENDED_SESSION_EXPIRATION: 7 * 24 * 60 * 60 * 1000, // 长会话过期时间（7天）
  MIN_MESSAGE_COUNT_FOR_EXTENDED: 3, // 保留更久的最小消息数
  MODEL_FAIL_THRESHOLD: 3, // 模型失败阈值
  STREAM_TIMEOUT: 120000, // 流式响应超时（2分钟）
  REQUEST_TIMEOUT: 60000 // 普通请求超时（1分钟）
};

// Performance optimization: Enhanced HTTP agents with proxy support
// 自动检测系统代理设置和环境变量 (HTTP_PROXY, HTTPS_PROXY, NO_PROXY)
const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || httpProxy;

// 配置axios代理
if (httpProxy || httpsProxy) {
  try {
    // 解析代理URL
    const proxyUrl = new URL(httpsProxy || httpProxy);

    // 使用axios的proxy配置对象（更可靠）
    axios.defaults.proxy = {
      protocol: proxyUrl.protocol.replace(':', ''),
      host: proxyUrl.hostname,
      port: parseInt(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : 80),
      auth: proxyUrl.username && proxyUrl.password ? {
        username: proxyUrl.username,
        password: proxyUrl.password
      } : undefined
    };

    console.log('[Proxy] Proxy detected and configured:');
    console.log(`[Proxy]   Protocol: ${proxyUrl.protocol.replace(':', '')}`);
    console.log(`[Proxy]   Host: ${proxyUrl.hostname}`);
    console.log(`[Proxy]   Port: ${proxyUrl.port || (proxyUrl.protocol === 'https:' ? 443 : 80)}`);

    if (process.env.NO_PROXY || process.env.no_proxy) {
      console.log(`[Proxy]   NO_PROXY: ${process.env.NO_PROXY || process.env.no_proxy}`);
    }
  } catch (error) {
    console.warn('[Proxy] ⚠️  Failed to parse proxy URL:', error.message);
    console.warn('[Proxy] ⚠️  Proxy configuration:', httpsProxy || httpProxy);
    console.warn('[Proxy] ⚠️  Continuing without proxy. Please check your HTTP_PROXY/HTTPS_PROXY environment variables.');
  }
} else {
  console.log('[Proxy] No proxy configured, using direct connection');
}

// 配置axios默认超时
axios.defaults.timeout = 30000;

// ==================== 文件写入队列机制 ====================
// 解决并发写入导致的数据竞争问题
class FileWriteQueue {
  constructor() {
    this.queues = new Map(); // filePath -> Promise chain
  }

  async write(filePath, data) {
    // 获取或创建该文件的写入队列
    let queue = this.queues.get(filePath) || Promise.resolve();

    // 将新的写入操作加入队列
    queue = queue
      .then(() => fs.writeFile(filePath, data))
      .catch(error => {
        console.error(`[FileWriteQueue] Error writing to ${filePath}:`, error);
        throw error;
      });

    this.queues.set(filePath, queue);

    // 等待写入完成
    try {
      await queue;
    } finally {
      // 清理已完成的队列（延迟清理，避免立即删除）
      setTimeout(() => {
        if (this.queues.get(filePath) === queue) {
          this.queues.delete(filePath);
        }
      }, 100);
    }
  }
}

const fileWriteQueue = new FileWriteQueue();

// 封装的安全写入函数
async function safeWriteFile(filePath, data) {
  const jsonData = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  await fileWriteQueue.write(filePath, jsonData);
}

// 初始化数据目录
async function initDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(CONVERSATIONS_DIR, { recursive: true });
  await fs.mkdir(LOGS_DIR, { recursive: true });
  
  try {
    await fs.access(API_SETTINGS_FILE);
    // 数据迁移：为旧的提供商添加apiType字段和modelType字段
    const data = JSON.parse(await fs.readFile(API_SETTINGS_FILE, 'utf8'));
    let updated = false;
    if (data.providers) {
      data.providers.forEach(provider => {
        if (provider.apiType === undefined) {
          provider.apiType = 'openai';
          updated = true;
        }
        // 新增：添加modelType字段（默认为text）
        if (provider.modelType === undefined) {
          provider.modelType = 'text';
          updated = true;
        }
        // 新增：为每个模型添加type字段
        if (provider.models) {
          provider.models.forEach(model => {
            if (model.type === undefined) {
              model.type = 'text';
              updated = true;
            }
          });
        }
      });
    }
    if (updated) {
      await safeWriteFile(API_SETTINGS_FILE, data);
      invalidateApiSettingsCache();
      console.log('Data migration: Added apiType, modelType and model.type to existing providers.');
    }
  } catch {
    await safeWriteFile(API_SETTINGS_FILE, {
      providers: [],
      groups: [
        { id: 'default', name: '默认分组', description: '未分组的提供商' }
      ]
    });
  }

  try {
    await fs.access(USER_SETTINGS_FILE);
  } catch {
    await safeWriteFile(USER_SETTINGS_FILE, {
      defaultParams: { temperature: 0.7, max_tokens: 2000, top_p: 1 },
      globalFrequency: 10,
      defaultPromptId: '', // 默认提示词ID
      translateDefaultModel: '', // 翻译默认模型
      translateDefaultPromptId: '', // 翻译默认提示词
      translatePollingEnabled: false, // 翻译轮询开关
      quickTranslations: [ // 快捷转换按钮（最多5个）
        { id: '1', name: '中→英', sourceLanguage: '中文', targetLanguage: '英语' },
        { id: '2', name: '英→中', sourceLanguage: '英语', targetLanguage: '中文' }
      ],
      pollingConfig: { available: {}, excluded: {}, disabled: {} },
      pollingState: {}, // 存储每个模型的轮询状态
      modelFailCounts: {}, // 存储每个模型在每个提供商的失败计数
      proxyApiKey: '', // 代理接口密钥（向后兼容）
      proxyApiKeys: {}, // 多API密钥管理
      conversationProviderMap: {} // 会话-提供商映射（用于对话连续性）
    });
  }

  // 初始化提示词库文件
  try {
    await fs.access(PROMPTS_FILE);
  } catch {
    await safeWriteFile(PROMPTS_FILE, {
      prompts: [],
      groups: [
        { id: 'default', name: '默认分组', description: '未分组的提示词' },
        { id: 'translate', name: '翻译', description: '翻译相关的提示词' }
      ],
      tags: []
    });
  }

  // 初始化语言文件
  try {
    await fs.access(LANGUAGES_FILE);
  } catch {
    await safeWriteFile(LANGUAGES_FILE, {
      sourceLanguages: [
        { id: '1', name: '中文', code: 'zh' },
        { id: '2', name: '英语', code: 'en' },
        { id: '3', name: '日语', code: 'ja' },
        { id: '4', name: '韩语', code: 'ko' },
        { id: '5', name: '法语', code: 'fr' },
        { id: '6', name: '德语', code: 'de' },
        { id: '7', name: '俄语', code: 'ru' },
        { id: '8', name: '西班牙语', code: 'es' }
      ],
      targetLanguages: [
        { id: '1', name: '英语', code: 'en' },
        { id: '2', name: '中文', code: 'zh' },
        { id: '3', name: '日语', code: 'ja' },
        { id: '4', name: '韩语', code: 'ko' },
        { id: '5', name: '法语', code: 'fr' },
        { id: '6', name: '德语', code: 'de' },
        { id: '7', name: '俄语', code: 'ru' },
        { id: '8', name: '西班牙语', code: 'es' }
      ]
    });
  }
}

// 性能优化：缓存读取函数
async function getApiSettings() {
  const now = Date.now();
  if (apiSettingsCache && (now - apiSettingsCacheTime) < CACHE_TTL) {
    return apiSettingsCache;
  }
  
  try {
    const data = JSON.parse(await fs.readFile(API_SETTINGS_FILE, 'utf8'));
    // 确保数据结构包含groups字段
    if (!data.groups) {
      data.groups = [
        { id: 'default', name: '默认分组', description: '未分组的提供商' }
      ];
    }
    apiSettingsCache = data;
    apiSettingsCacheTime = now;
    return data;
  } catch (error) {
    console.error('Error reading API settings:', error);
    return {
      providers: [],
      groups: [
        { id: 'default', name: '默认分组', description: '未分组的提供商' }
      ]
    };
  }
}

async function getUserSettings() {
  const now = Date.now();
  if (userSettingsCache && (now - userSettingsCacheTime) < CACHE_TTL) {
    return userSettingsCache;
  }
  
  try {
    const data = JSON.parse(await fs.readFile(USER_SETTINGS_FILE, 'utf8'));
    userSettingsCache = data;
    userSettingsCacheTime = now;
    return data;
  } catch (error) {
    console.error('Error reading user settings:', error);
    return {
      defaultParams: { temperature: 0.7, max_tokens: 2000, top_p: 1 },
      globalFrequency: 10,
      pollingConfig: { available: {}, excluded: {}, disabled: {} },
      pollingState: {}, // 存储每个模型的轮询状态
      modelFailCounts: {}, // 存储每个模型在每个提供商的失败计数
      proxyApiKey: '', // 代理接口密钥（向后兼容）
      proxyApiKeys: {}, // 多API密钥管理
      conversationProviderMap: {} // 会话-提供商映射（用于对话连续性）
    };
  }
}

// 性能优化：缓存失效函数
function invalidateApiSettingsCache() {
  apiSettingsCache = null;
  apiSettingsCacheTime = 0;
}

function invalidateUserSettingsCache() {
  userSettingsCache = null;
  userSettingsCacheTime = 0;
}

function invalidatePromptsCache() {
  promptsCache = null;
  promptsCacheTime = 0;
}

function invalidateLanguagesCache() {
  languagesCache = null;
  languagesCacheTime = 0;
}

// 读取语言数据
async function getLanguages() {
  const now = Date.now();
  if (languagesCache && (now - languagesCacheTime) < CACHE_TTL) {
    return languagesCache;
  }

  try {
    const data = JSON.parse(await fs.readFile(LANGUAGES_FILE, 'utf8'));
    if (!data.sourceLanguages) data.sourceLanguages = [];
    if (!data.targetLanguages) data.targetLanguages = [];

    languagesCache = data;
    languagesCacheTime = now;
    return data;
  } catch (error) {
    console.error('Error reading languages:', error);
    return {
      sourceLanguages: [],
      targetLanguages: []
    };
  }
}

// 保存语言数据
async function saveLanguages(data) {
  await safeWriteFile(LANGUAGES_FILE, data);
  invalidateLanguagesCache();
}

// 读取提示词库
async function getPrompts() {
  const now = Date.now();
  if (promptsCache && (now - promptsCacheTime) < CACHE_TTL) {
    return promptsCache;
  }

  try {
    const data = JSON.parse(await fs.readFile(PROMPTS_FILE, 'utf8'));
    // 确保数据结构完整
    if (!data.prompts) data.prompts = [];
    if (!data.groups) data.groups = [{ id: 'default', name: '默认分组', description: '未分组的提示词' }];
    if (!data.tags) data.tags = [];

    promptsCache = data;
    promptsCacheTime = now;
    return data;
  } catch (error) {
    console.error('Error reading prompts:', error);
    return {
      prompts: [],
      groups: [{ id: 'default', name: '默认分组', description: '未分组的提示词' }],
      tags: []
    };
  }
}

// 保存提示词库
async function savePrompts(data) {
  await safeWriteFile(PROMPTS_FILE, data);
  invalidatePromptsCache();
}

// API 路由
app.get('/api/providers', async (req, res) => {
  const data = await getApiSettings();
  res.json(data.providers);
});

app.get('/api/providers/export', async (req, res) => {
  try {
    const data = await getApiSettings();
    const dataToExport = {
      groups: data.groups || [],
      providers: data.providers || []
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=equal-ask-providers-and-groups.json');
    res.send(JSON.stringify(dataToExport, null, 2));
  } catch (error) {
    console.error('Error exporting data:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

app.post('/api/providers/import', async (req, res) => {
  try {
    const { providers, groups } = req.body;

    // 兼容旧格式（只导入提供商）
    if (Array.isArray(req.body)) {
      const oldFormatProviders = req.body;
      const newSettings = {
        providers: oldFormatProviders,
        groups: [{ id: 'default', name: '默认分组', description: '未分组的提供商' }]
      };
      await safeWriteFile(API_SETTINGS_FILE, newSettings);
      invalidateApiSettingsCache();
      return res.json({ success: true, message: `成功导入 ${oldFormatProviders.length} 个提供商（旧格式）。` });
    }

    if (!Array.isArray(providers) || !Array.isArray(groups)) {
      return res.status(400).json({ error: '数据格式无效，需要 "providers" 和 "groups" 数组。' });
    }

    // 验证并确保默认分组存在
    let hasDefaultGroup = groups.some(g => g.id === 'default');
    if (!hasDefaultGroup) {
      groups.unshift({ id: 'default', name: '默认分组', description: '未分组的提供商' });
    }

    const newSettings = { providers, groups };
    await safeWriteFile(API_SETTINGS_FILE, newSettings);
    invalidateApiSettingsCache();
    res.json({ success: true, message: `成功导入 ${providers.length} 个提供商和 ${groups.length} 个分组。` });
  } catch (error) {
    console.error('Error importing data:', error);
    res.status(500).json({ error: 'Failed to import data' });
  }
});

app.post('/api/providers', async (req, res) => {
  const data = await getApiSettings();
  const newProvider = {
    id: Date.now().toString(),
    ...req.body,
    failCount: 0,
    disabled: false,
    groupId: req.body.groupId || 'default', // 默认分组
    apiType: req.body.apiType || 'openai' // 默认为OpenAI兼容格式
  };
  data.providers.push(newProvider);
  await safeWriteFile(API_SETTINGS_FILE, data);
  invalidateApiSettingsCache(); // 缓存失效
  res.json(newProvider);
});

app.put('/api/providers/:id', async (req, res) => {
  const data = await getApiSettings();
  const index = data.providers.findIndex(p => p.id === req.params.id);
  if (index !== -1) {
    data.providers[index] = { ...data.providers[index], ...req.body };
    await safeWriteFile(API_SETTINGS_FILE, data);
    invalidateApiSettingsCache(); // 缓存失效
    res.json(data.providers[index]);
  } else {
    res.status(404).json({ error: 'Provider not found' });
  }
});

app.delete('/api/providers/:id', async (req, res) => {
  const data = await getApiSettings();
  data.providers = data.providers.filter(p => p.id !== req.params.id);
  await safeWriteFile(API_SETTINGS_FILE, data);
  invalidateApiSettingsCache(); // 缓存失效
  res.json({ success: true });
});

app.get('/api/providers/:id/models', async (req, res) => {
  const data = await getApiSettings();
  const provider = data.providers.find(p => p.id === req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  try {
    const apiType = provider.apiType || 'openai';
    const url = buildApiUrl(provider.baseUrl, 'models', apiType, provider.customEndpoints);
    const response = await axios.get(url, {
      headers: { 'Authorization': `Bearer ${provider.apiKey}` },
      timeout: 10000 // 增加超时时间
    });
    res.json(response.data.data || []);
  } catch (error) {
    console.error('Error fetching models:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 批量刷新所有提供商的模型
app.post('/api/providers/refresh-all-models', async (req, res) => {
  const data = await getApiSettings();
  const results = {
    success: [],
    failed: [],
    skipped: [],
    total: 0,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0
  };

  // 过滤掉已禁用的提供商和排除自动刷新的提供商
  const activeProviders = data.providers.filter(p => !p.disabled && !p.excludeAutoRefresh);
  const skippedProviders = data.providers.filter(p => !p.disabled && p.excludeAutoRefresh);

  results.total = activeProviders.length;
  results.skippedCount = skippedProviders.length;

  // 记录被跳过的提供商
  skippedProviders.forEach(provider => {
    results.skipped.push({
      providerId: provider.id,
      providerName: provider.name,
      reason: '已排除自动刷新'
    });
  });

  // 并发获取所有提供商的模型
  const promises = activeProviders.map(async (provider) => {
    try {
      const apiType = provider.apiType || 'openai';
      const url = buildApiUrl(provider.baseUrl, 'models', apiType, provider.customEndpoints);
      const response = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${provider.apiKey}` },
        timeout: 10000
      });

      const models = response.data.data || [];

      // 更新提供商的模型列表，保留visible属性
      const oldModels = provider.models || [];
      const oldModelsMap = new Map(oldModels.map(m => [m.id, m.visible]));

      // 将获取到的模型转换为系统格式，保留之前的可见性设置
      provider.models = models.map(model => ({
        id: model.id,
        visible: oldModelsMap.has(model.id) ? oldModelsMap.get(model.id) : true
      }));

      results.success.push({
        providerId: provider.id,
        providerName: provider.name,
        modelCount: provider.models.length
      });
      results.successCount++;
    } catch (error) {
      console.error(`Error fetching models for provider ${provider.name}:`, error.message);

      // 刷新失败时清空该提供商的模型列表
      provider.models = [];

      results.failed.push({
        providerId: provider.id,
        providerName: provider.name,
        error: error.message
      });
      results.failedCount++;
    }
  });

  await Promise.all(promises);

  // 保存更新后的配置
  await safeWriteFile(API_SETTINGS_FILE, data);
  invalidateApiSettingsCache();

  res.json(results);
});

app.get('/api/providers/:id/test', async (req, res) => {
  const data = await getApiSettings();
  const provider = data.providers.find(p => p.id === req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  
  try {
    const apiType = provider.apiType || 'openai';
    const url = buildApiUrl(provider.baseUrl, 'models', apiType, provider.customEndpoints);
    await axios.get(url, {
      headers: { 'Authorization': `Bearer ${provider.apiKey}` },
      timeout: 8000 // 增加超时时间
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Error testing connection:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==================== 分组管理接口 ====================

// 获取所有分组
app.get('/api/groups', async (req, res) => {
  const data = await getApiSettings();
  res.json(data.groups || []);
});

// 创建新分组
app.post('/api/groups', async (req, res) => {
  const data = await getApiSettings();
  const { name, description } = req.body;
  
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: '分组名称不能为空' });
  }
  
  const newGroup = {
    id: Date.now().toString(),
    name: name.trim(),
    description: description || '',
    createdAt: new Date().toISOString()
  };
  
  if (!data.groups) {
    data.groups = [];
  }
  
  data.groups.push(newGroup);
  await safeWriteFile(API_SETTINGS_FILE, data);
  invalidateApiSettingsCache();
  res.json(newGroup);
});

// 更新分组
app.put('/api/groups/:id', async (req, res) => {
  const data = await getApiSettings();
  const groupId = req.params.id;
  
  // 不允许修改默认分组的ID
  if (groupId === 'default') {
    return res.status(400).json({ error: '不能修改默认分组的ID' });
  }
  
  const index = data.groups.findIndex(g => g.id === groupId);
  if (index === -1) {
    return res.status(404).json({ error: '分组不存在' });
  }
  
  const { name, description } = req.body;
  if (name !== undefined) {
    data.groups[index].name = name.trim();
  }
  if (description !== undefined) {
    data.groups[index].description = description;
  }
  
  await safeWriteFile(API_SETTINGS_FILE, data);
  invalidateApiSettingsCache();
  res.json(data.groups[index]);
});

// 删除分组
app.delete('/api/groups/:id', async (req, res) => {
  const data = await getApiSettings();
  const groupId = req.params.id;
  
  // 不允许删除默认分组
  if (groupId === 'default') {
    return res.status(400).json({ error: '不能删除默认分组' });
  }
  
  const groupIndex = data.groups.findIndex(g => g.id === groupId);
  if (groupIndex === -1) {
    return res.status(404).json({ error: '分组不存在' });
  }
  
  // 将该分组下的所有提供商移到默认分组
  data.providers.forEach(provider => {
    if (provider.groupId === groupId) {
      provider.groupId = 'default';
    }
  });
  
  data.groups.splice(groupIndex, 1);
  await safeWriteFile(API_SETTINGS_FILE, data);
  invalidateApiSettingsCache();
  res.json({ success: true, message: '分组已删除，提供商已移至默认分组' });
});

// 移动提供商到指定分组
app.put('/api/providers/:id/group', async (req, res) => {
  const data = await getApiSettings();
  const providerId = req.params.id;
  const { groupId } = req.body;
  
  if (!groupId) {
    return res.status(400).json({ error: '分组ID不能为空' });
  }
  
  // 检查分组是否存在
  const groupExists = data.groups.some(g => g.id === groupId);
  if (!groupExists) {
    return res.status(404).json({ error: '目标分组不存在' });
  }
  
  const providerIndex = data.providers.findIndex(p => p.id === providerId);
  if (providerIndex === -1) {
    return res.status(404).json({ error: '提供商不存在' });
  }
  
  data.providers[providerIndex].groupId = groupId;
  await safeWriteFile(API_SETTINGS_FILE, data);
  invalidateApiSettingsCache();
  res.json(data.providers[providerIndex]);
});

app.get('/api/conversations', async (req, res) => {
  const files = await fs.readdir(CONVERSATIONS_DIR);
  const conversations = await Promise.all(files.map(async file => {
    const content = await fs.readFile(path.join(CONVERSATIONS_DIR, file), 'utf8');
    return JSON.parse(content);
  }));
  res.json(conversations);
});

app.post('/api/conversations', async (req, res) => {
  const conversation = { id: Date.now().toString(), title: '', messages: [], model: req.body.model || '' };
  await safeWriteFile(path.join(CONVERSATIONS_DIR, `${conversation.id}.json`), conversation);
  res.json(conversation);
});

app.get('/api/conversations/:id', async (req, res) => {
  try {
    const content = await fs.readFile(path.join(CONVERSATIONS_DIR, `${req.params.id}.json`), 'utf8');
    res.json(JSON.parse(content));
  } catch {
    res.status(404).json({ error: 'Conversation not found' });
  }
});

app.put('/api/conversations/:id', async (req, res) => {
  const filePath = path.join(CONVERSATIONS_DIR, `${req.params.id}.json`);
  await safeWriteFile(filePath, req.body);
  res.json(req.body);
});

app.delete('/api/conversations/:id', async (req, res) => {
  await fs.unlink(path.join(CONVERSATIONS_DIR, `${req.params.id}.json`));
  res.json({ success: true });
});

// ==================== 提示词库管理 API ====================

// 获取所有提示词
app.get('/api/prompts', async (req, res) => {
  try {
    const data = await getPrompts();
    res.json(data);
  } catch (error) {
    console.error('Error getting prompts:', error);
    res.status(500).json({ error: '获取提示词失败' });
  }
});

// 创建新提示词
app.post('/api/prompts', async (req, res) => {
  try {
    const data = await getPrompts();
    const newPrompt = {
      id: Date.now().toString(),
      name: req.body.name || '新提示词',
      content: req.body.content || '',
      groupId: req.body.groupId || 'default',
      tags: req.body.tags || [],
      description: req.body.description || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    data.prompts.push(newPrompt);
    await savePrompts(data);
    res.json(newPrompt);
  } catch (error) {
    console.error('Error creating prompt:', error);
    res.status(500).json({ error: '创建提示词失败' });
  }
});

// 更新提示词
app.put('/api/prompts/:id', async (req, res) => {
  try {
    const data = await getPrompts();
    const promptIndex = data.prompts.findIndex(p => p.id === req.params.id);

    if (promptIndex === -1) {
      return res.status(404).json({ error: '提示词不存在' });
    }

    data.prompts[promptIndex] = {
      ...data.prompts[promptIndex],
      ...req.body,
      id: req.params.id, // 保持ID不变
      updatedAt: new Date().toISOString()
    };

    await savePrompts(data);
    res.json(data.prompts[promptIndex]);
  } catch (error) {
    console.error('Error updating prompt:', error);
    res.status(500).json({ error: '更新提示词失败' });
  }
});

// 删除提示词
app.delete('/api/prompts/:id', async (req, res) => {
  try {
    const data = await getPrompts();
    const promptIndex = data.prompts.findIndex(p => p.id === req.params.id);

    if (promptIndex === -1) {
      return res.status(404).json({ error: '提示词不存在' });
    }

    data.prompts.splice(promptIndex, 1);
    await savePrompts(data);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting prompt:', error);
    res.status(500).json({ error: '删除提示词失败' });
  }
});

// 获取所有提示词分组
app.get('/api/prompt-groups', async (req, res) => {
  try {
    const data = await getPrompts();
    res.json(data.groups || []);
  } catch (error) {
    console.error('Error getting prompt groups:', error);
    res.status(500).json({ error: '获取分组失败' });
  }
});

// 创建新分组
app.post('/api/prompt-groups', async (req, res) => {
  try {
    const data = await getPrompts();
    const newGroup = {
      id: Date.now().toString(),
      name: req.body.name || '新分组',
      description: req.body.description || ''
    };

    data.groups.push(newGroup);
    await savePrompts(data);
    res.json(newGroup);
  } catch (error) {
    console.error('Error creating prompt group:', error);
    res.status(500).json({ error: '创建分组失败' });
  }
});

// 更新分组
app.put('/api/prompt-groups/:id', async (req, res) => {
  try {
    const data = await getPrompts();
    const groupIndex = data.groups.findIndex(g => g.id === req.params.id);

    if (groupIndex === -1) {
      return res.status(404).json({ error: '分组不存在' });
    }

    // 不允许修改默认分组的ID
    if (data.groups[groupIndex].id === 'default' && req.body.id && req.body.id !== 'default') {
      return res.status(400).json({ error: '不能修改默认分组的ID' });
    }

    data.groups[groupIndex] = {
      ...data.groups[groupIndex],
      ...req.body,
      id: req.params.id // 保持ID不变
    };

    await savePrompts(data);
    res.json(data.groups[groupIndex]);
  } catch (error) {
    console.error('Error updating prompt group:', error);
    res.status(500).json({ error: '更新分组失败' });
  }
});

// 删除分组
app.delete('/api/prompt-groups/:id', async (req, res) => {
  try {
    const data = await getPrompts();

    // 不允许删除默认分组
    if (req.params.id === 'default') {
      return res.status(400).json({ error: '不能删除默认分组' });
    }

    const groupIndex = data.groups.findIndex(g => g.id === req.params.id);

    if (groupIndex === -1) {
      return res.status(404).json({ error: '分组不存在' });
    }

    // 将该分组下的所有提示词移到默认分组
    data.prompts.forEach(prompt => {
      if (prompt.groupId === req.params.id) {
        prompt.groupId = 'default';
      }
    });

    data.groups.splice(groupIndex, 1);
    await savePrompts(data);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting prompt group:', error);
    res.status(500).json({ error: '删除分组失败' });
  }
});

// 获取所有标签
app.get('/api/prompt-tags', async (req, res) => {
  try {
    const data = await getPrompts();
    // 从所有提示词中收集唯一的标签
    const tagsSet = new Set();
    data.prompts.forEach(prompt => {
      if (prompt.tags && Array.isArray(prompt.tags)) {
        prompt.tags.forEach(tag => tagsSet.add(tag));
      }
    });
    res.json(Array.from(tagsSet));
  } catch (error) {
    console.error('Error getting prompt tags:', error);
    res.status(500).json({ error: '获取标签失败' });
  }
});

// ==================== 提示词库管理 API 结束 ====================

// ==================== 语言管理 API ====================

// 获取所有语言
app.get('/api/languages', async (req, res) => {
  try {
    const data = await getLanguages();
    res.json(data);
  } catch (error) {
    console.error('Error getting languages:', error);
    res.status(500).json({ error: '获取语言失败' });
  }
});

// 获取源语言列表
app.get('/api/source-languages', async (req, res) => {
  try {
    const data = await getLanguages();
    res.json(data.sourceLanguages || []);
  } catch (error) {
    console.error('Error getting source languages:', error);
    res.status(500).json({ error: '获取源语言失败' });
  }
});

// 添加源语言
app.post('/api/source-languages', async (req, res) => {
  try {
    const data = await getLanguages();
    const newLanguage = {
      id: Date.now().toString(),
      name: req.body.name || '新语言',
      code: req.body.code || ''
    };

    data.sourceLanguages.push(newLanguage);
    await saveLanguages(data);
    res.json(newLanguage);
  } catch (error) {
    console.error('Error creating source language:', error);
    res.status(500).json({ error: '创建源语言失败' });
  }
});

// 更新源语言
app.put('/api/source-languages/:id', async (req, res) => {
  try {
    const data = await getLanguages();
    const langIndex = data.sourceLanguages.findIndex(l => l.id === req.params.id);

    if (langIndex === -1) {
      return res.status(404).json({ error: '语言不存在' });
    }

    data.sourceLanguages[langIndex] = {
      ...data.sourceLanguages[langIndex],
      ...req.body,
      id: req.params.id
    };

    await saveLanguages(data);
    res.json(data.sourceLanguages[langIndex]);
  } catch (error) {
    console.error('Error updating source language:', error);
    res.status(500).json({ error: '更新源语言失败' });
  }
});

// 删除源语言
app.delete('/api/source-languages/:id', async (req, res) => {
  try {
    const data = await getLanguages();
    const langIndex = data.sourceLanguages.findIndex(l => l.id === req.params.id);

    if (langIndex === -1) {
      return res.status(404).json({ error: '语言不存在' });
    }

    data.sourceLanguages.splice(langIndex, 1);
    await saveLanguages(data);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting source language:', error);
    res.status(500).json({ error: '删除源语言失败' });
  }
});

// 获取目标语言列表
app.get('/api/target-languages', async (req, res) => {
  try {
    const data = await getLanguages();
    res.json(data.targetLanguages || []);
  } catch (error) {
    console.error('Error getting target languages:', error);
    res.status(500).json({ error: '获取目标语言失败' });
  }
});

// 添加目标语言
app.post('/api/target-languages', async (req, res) => {
  try {
    const data = await getLanguages();
    const newLanguage = {
      id: Date.now().toString(),
      name: req.body.name || '新语言',
      code: req.body.code || ''
    };

    data.targetLanguages.push(newLanguage);
    await saveLanguages(data);
    res.json(newLanguage);
  } catch (error) {
    console.error('Error creating target language:', error);
    res.status(500).json({ error: '创建目标语言失败' });
  }
});

// 更新目标语言
app.put('/api/target-languages/:id', async (req, res) => {
  try {
    const data = await getLanguages();
    const langIndex = data.targetLanguages.findIndex(l => l.id === req.params.id);

    if (langIndex === -1) {
      return res.status(404).json({ error: '语言不存在' });
    }

    data.targetLanguages[langIndex] = {
      ...data.targetLanguages[langIndex],
      ...req.body,
      id: req.params.id
    };

    await saveLanguages(data);
    res.json(data.targetLanguages[langIndex]);
  } catch (error) {
    console.error('Error updating target language:', error);
    res.status(500).json({ error: '更新目标语言失败' });
  }
});

// 删除目标语言
app.delete('/api/target-languages/:id', async (req, res) => {
  try {
    const data = await getLanguages();
    const langIndex = data.targetLanguages.findIndex(l => l.id === req.params.id);

    if (langIndex === -1) {
      return res.status(404).json({ error: '语言不存在' });
    }

    data.targetLanguages.splice(langIndex, 1);
    await saveLanguages(data);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting target language:', error);
    res.status(500).json({ error: '删除目标语言失败' });
  }
});

// ==================== 语言管理 API 结束 ====================

// 速率限制存储 - 按模型分别统计
const rateLimitMap = new Map(); // key: model, value: { requests: [timestamps], queue: [] }

// 清理过期的请求记录
function cleanupExpiredRequests(modelRequests, now) {
  const oneMinuteAgo = now - 60000;
  modelRequests.requests = modelRequests.requests.filter(timestamp => timestamp > oneMinuteAgo);
}

// 计算延迟时间
function calculateDelay(modelRequests, maxRequestsPerMinute, now) {
  if (modelRequests.requests.length < maxRequestsPerMinute) {
    return 0;
  }
  
  // 找到最早的请求时间
  const oldestRequest = Math.min(...modelRequests.requests);
  const nextAvailableTime = oldestRequest + 60000; // 一分钟后
  return Math.max(0, nextAvailableTime - now);
}

app.post('/api/chat', async (req, res) => {
  const { messages, model, params, polling, images, systemPrompt, translateContext } = req.body;
  const settings = await getApiSettings();
  const userSettings = await getUserSettings();

  // 处理提示词变量替换
  let processedSystemPrompt = systemPrompt;
  if (systemPrompt && translateContext) {
    processedSystemPrompt = replacePromptVariables(systemPrompt, translateContext);
  }
  
  // 获取每分钟最大请求次数
  const maxRequestsPerMinute = userSettings.globalFrequency || 10;
  const now = Date.now();
  
  // 初始化模型的请求记录
  if (!rateLimitMap.has(model)) {
    rateLimitMap.set(model, { requests: [], queue: [] });
  }
  
  const modelRequests = rateLimitMap.get(model);
  
  // 清理过期请求
  cleanupExpiredRequests(modelRequests, now);
  
  // 计算需要延迟的时间
  const delayTime = calculateDelay(modelRequests, maxRequestsPerMinute, now);
  
  if (delayTime > 0) {
    // 需要延迟执行
    res.setHeader('Content-Type', 'application/json');
    return res.json({
      delayed: true,
      delayTime: Math.ceil(delayTime / 1000),
      message: `模型 ${model} 调用频率限制，将在 ${Math.ceil(delayTime / 1000)} 秒后执行`
    });
  }
  
  // 记录请求时间
  modelRequests.requests.push(now);
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (polling) {
    const modelName = extractModelName(model);
    console.log(`Polling mode enabled for model: ${modelName}`);
    console.log(`User settings polling config:`, JSON.stringify(userSettings.pollingConfig, null, 2));

    // 获取所有可用的轮询提供商
    const pollingProviders = getPollingProviders(settings.providers, modelName, userSettings.pollingConfig);

    if (pollingProviders.length === 0) {
      console.log(`No polling providers available for model ${modelName}`);
      res.write(`data: ${JSON.stringify({ error: `模型 ${modelName} 没有可用的轮询提供商或已被排除` })}\n\n`);
      res.end();
      return;
    }

    console.log(`Found ${pollingProviders.length} available providers for polling`);

    // 收集所有失败的错误信息
    const errors = [];
    let successfulProvider = null;

    // 按照轮询顺序尝试每个提供商
    for (const provider of pollingProviders) {
      try {
        console.log(`Trying provider ${provider.name} (ID: ${provider.id}) for model ${modelName}`);

        // 获取该提供商的具体模型ID
        const modelId = await getProviderModelId(provider, modelName);
        if (!modelId) {
          console.log(`Model ${modelName} not found in provider ${provider.name}`);
          errors.push({
            provider: provider.name,
            error: `模型 ${modelName} 在提供商中不存在`
          });
          await incrementModelFailCount(provider.id, modelName, userSettings);
          continue; // 尝试下一个提供商
        }

        console.log(`Using model ID: ${modelId} from provider ${provider.name}`);

        // 识别模型类型并调用对应的处理函数
        const modelType = getModelType(provider, modelId);
        console.log(`[ModelType] Detected model type: ${modelType} for ${modelId}`);

        if (modelType === 'image') {
          // 提取提示词（最后一条用户消息的内容）
          const lastUserMessage = messages[messages.length - 1];
          const prompt = lastUserMessage?.content || '';

          if (!prompt) {
            errors.push({
              provider: provider.name,
              error: '生成图片需要提供提示词'
            });
            continue;
          }

          console.log(`[ImageGen] Generating image with prompt: ${prompt.substring(0, 50)}...`);
          await generateImage(provider, prompt, params, res, modelId);
        } else {
          // 文本模型，使用原有的streamChat
          await streamChat(provider, messages, params, res, modelId, images, processedSystemPrompt);
        }

        // 如果成功，重置模型失败计数并保存轮询状态
        await resetModelFailCount(provider.id, modelName, userSettings);

        // 标记该提供商在当前轮次已使用
        const pollingState = userSettings.pollingState || {};
        if (!pollingState[modelName]) {
          pollingState[modelName] = {
            currentIndex: 0,
            usedInCurrentRound: []
          };
        }
        if (!pollingState[modelName].usedInCurrentRound.includes(provider.id)) {
          pollingState[modelName].usedInCurrentRound.push(provider.id);
        }
        userSettings.pollingState = pollingState;

        await savePollingState(userSettings);

        console.log(`Successfully used provider ${provider.name} for model ${modelName}`);
        successfulProvider = provider;
        break; // 成功，退出循环

      } catch (error) {
        console.error(`Provider ${provider.name} failed:`, error.message);

        // 记录错误信息
        errors.push({
          provider: provider.name,
          error: error.message || 'Unknown error'
        });

        // 增加模型失败计数
        await incrementModelFailCount(provider.id, modelName, userSettings);
        await savePollingState(userSettings);

        // 继续尝试下一个提供商
        console.log(`Trying next provider...`);
      }
    }

    // 如果所有提供商都失败了，返回所有错误信息
    if (!successfulProvider) {
      console.error(`All providers failed for model ${modelName}`);

      let errorMessage = `所有提供商都失败了 (${errors.length}/${pollingProviders.length}):\n\n`;
      errors.forEach((err, index) => {
        errorMessage += `${index + 1}. ${err.provider}: ${err.error}\n`;
      });

      res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
      res.end();
    }

    return;
  } else {
    const [providerId, modelId] = model.split('::');
    const provider = settings.providers.find(p => p.id === providerId);
    if (!provider) {
      res.write(`data: ${JSON.stringify({ error: 'Provider not found' })}\n\n`);
      return res.end();
    }

    try {
      // 识别模型类型并调用对应的处理函数
      const modelType = getModelType(provider, modelId);
      console.log(`[ModelType] Detected model type: ${modelType} for ${modelId}`);

      if (modelType === 'image') {
        // 提取提示词（最后一条用户消息的内容）
        const lastUserMessage = messages[messages.length - 1];
        const prompt = lastUserMessage?.content || '';

        if (!prompt) {
          res.write(`data: ${JSON.stringify({ error: '生成图片需要提供提示词' })}\n\n`);
          return res.end();
        }

        console.log(`[ImageGen] Generating image with prompt: ${prompt.substring(0, 50)}...`);
        await generateImage(provider, prompt, params, res, modelId);
      } else {
        // 文本模型，使用原有的streamChat
        await streamChat(provider, messages, params, res, modelId, images, processedSystemPrompt);
      }
    } catch (error) {
      console.error(`Chat error:`, error.message);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
});

app.get('/api/settings', async (req, res) => {
  const settings = await getUserSettings();
  res.json(settings);
});

app.put('/api/settings', async (req, res) => {
  await safeWriteFile(USER_SETTINGS_FILE, req.body);
  invalidateUserSettingsCache(); // 缓存失效
  res.json(req.body);
});

// 提示词变量替换函数
function replacePromptVariables(prompt, context) {
  if (!prompt || !context) return prompt;

  let result = prompt;

  // 替换输入文本变量
  if (context.inputText) {
    result = result.replace(/\{\{输入文本\}\}/g, context.inputText);
    result = result.replace(/\{\{input text\}\}/gi, context.inputText);
  }

  // 替换源语言变量
  if (context.sourceLanguage) {
    result = result.replace(/\{\{源文本\}\}/g, context.sourceLanguage);
    result = result.replace(/\{\{source language\}\}/gi, context.sourceLanguage);
  }

  // 替换目标语言变量
  if (context.targetLanguage) {
    result = result.replace(/\{\{目标文本\}\}/g, context.targetLanguage);
    result = result.replace(/\{\{target language\}\}/gi, context.targetLanguage);
  }

  return result;
}

function buildApiUrl(baseUrl, endpoint, apiType = 'openai', customEndpoints = null) {
  log.verbose(`[DEBUG] buildApiUrl called with: baseUrl=${baseUrl}, endpoint=${endpoint}, apiType=${apiType}, customEndpoints=${JSON.stringify(customEndpoints)}`);

  baseUrl = baseUrl.replace(/\/$/, '');

  // Priority: use custom endpoints if provided
  if (customEndpoints) {
    if (endpoint === 'chat/completions' && customEndpoints.chat) {
      const finalUrl = `${baseUrl}${customEndpoints.chat}`;
      log.verbose(`[DEBUG] Using custom chat endpoint, final URL: ${finalUrl}`);
      return finalUrl;
    }
    if (endpoint === 'models' && customEndpoints.models) {
      const finalUrl = `${baseUrl}${customEndpoints.models}`;
      log.verbose(`[DEBUG] Using custom models endpoint, final URL: ${finalUrl}`);
      return finalUrl;
    }
  }

  // If baseUrl already contains version, directly append endpoint
  if (/\/v\d+$/.test(baseUrl)) {
    const finalUrl = `${baseUrl}/${endpoint}`;
    log.verbose(`[DEBUG] BaseURL contains version, final URL: ${finalUrl}`);
    return finalUrl;
  }

  // Build different URLs based on API type
  if (apiType === 'anthropic') {
    // Anthropic compatible format
    if (endpoint === 'chat/completions') {
      const finalUrl = `${baseUrl}/v1/messages`;
      log.verbose(`[DEBUG] Anthropic chat endpoint, final URL: ${finalUrl}`);
      return finalUrl;
    } else if (endpoint === 'models') {
      const finalUrl = `${baseUrl}/v1/models`;
      log.verbose(`[DEBUG] Anthropic models endpoint, final URL: ${finalUrl}`);
      return finalUrl;
    }
    const finalUrl = `${baseUrl}/v1/${endpoint}`;
    log.verbose(`[DEBUG] Anthropic other endpoint, final URL: ${finalUrl}`);
    return finalUrl;
  } else {
    // OpenAI compatible format (default)
    const finalUrl = `${baseUrl}/v1/${endpoint}`;
    log.verbose(`[DEBUG] OpenAI compatible endpoint, final URL: ${finalUrl}`);
    return finalUrl;
  }
}

function buildChatRequestBody(modelId, messages, params, apiType = 'openai', images = null, systemPrompt = null) {
  log.verbose(`[DEBUG] buildChatRequestBody: modelId=${modelId}, apiType=${apiType}, messages=${messages.length}, images=${images ? images.length : 'none'}, systemPrompt=${systemPrompt ? 'yes' : 'no'}`);

  // Process image message format
  let processedMessages = messages;
  if (images && images.length > 0) {
    log.verbose(`[DEBUG] Processing ${images.length} images`);
    processedMessages = [...messages];
    const lastUserMessageIndex = processedMessages.length - 1;
    if (lastUserMessageIndex >= 0 && processedMessages[lastUserMessageIndex].role === 'user') {
      const content = [
        { type: 'text', text: processedMessages[lastUserMessageIndex].content }
      ];

      images.forEach((image, index) => {
        if (!image.dataUrl || !image.dataUrl.includes('base64,')) {
          log.error(`[DEBUG] Invalid dataUrl format for image ${index + 1}`);
          return;
        }

        content.push({
          type: 'image_url',
          image_url: {
            url: image.dataUrl
          }
        });
      });

      processedMessages[lastUserMessageIndex] = {
        ...processedMessages[lastUserMessageIndex],
        content: content
      };
    }
  }

  if (apiType === 'anthropic') {
    log.verbose(`[DEBUG] Building Anthropic API request body`);
    // Anthropic API format - system prompt is a separate field
    const requestBody = {
      model: modelId,
      messages: processedMessages,
      ...params
    };

    // Add system prompt if provided
    if (systemPrompt && systemPrompt.trim()) {
      requestBody.system = systemPrompt.trim();
      log.verbose(`[DEBUG] Added system prompt to Anthropic request`);
    }

    // Anthropic API requires max_tokens parameter
    if (!requestBody.max_tokens) {
      requestBody.max_tokens = params.max_tokens || 4096;
      log.verbose(`[DEBUG] Added default max_tokens: ${requestBody.max_tokens}`);
    }

    log.verbose(`[DEBUG] Final Anthropic request body created`);
    return requestBody;
  } else {
    log.verbose(`[DEBUG] Building OpenAI compatible request body`);

    // For OpenAI, add system prompt as first message
    let finalMessages = processedMessages;
    if (systemPrompt && systemPrompt.trim()) {
      finalMessages = [
        { role: 'system', content: systemPrompt.trim() },
        ...processedMessages
      ];
      log.verbose(`[DEBUG] Added system prompt as first message`);
    }

    const requestBody = {
      model: modelId,
      messages: finalMessages,
      ...params
    };
    log.verbose(`[DEBUG] Final OpenAI request body created`);
    return requestBody;
  }
}

function extractModelName(modelId) {
  console.log(`Extracting model name from: ${modelId}`);

  // 如果是轮询模式的格式 (providerId::modelId)，提取modelId部分
  if (modelId.includes('::')) {
    const [, actualModelId] = modelId.split('::');
    const normalized = normalizeModelName(actualModelId);
    console.log(`Extracted and normalized model name from polling format: ${normalized}`);
    return normalized;
  }

  // 普通格式，使用规范化
  const normalized = normalizeModelName(modelId);
  console.log(`Extracted and normalized model name from normal format: ${normalized}`);
  return normalized;
}

// ==================== 对话连续性：消息指纹识别 ====================

// 生成消息指纹（基于前几条消息的内容）
function generateMessageFingerprint(messages, modelName) {
  if (!messages || messages.length === 0) {
    return null;
  }

  // 如果只有一条消息，这很可能是新对话，添加时间戳确保唯一性
  // 这样即使用户清除对话后发送相同的问题，也会被识别为新对话
  if (messages.length === 1) {
    const timestamp = Date.now();
    const contentParts = [];

    const msg = messages[0];
    if (typeof msg.content === 'string') {
      contentParts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      contentParts.push(msg.content
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('|'));
    }

    const contentString = contentParts.join('||');
    // 加入时间戳确保每次新对话都有唯一指纹
    const hash = crypto.createHash('md5').update(`${modelName}:${contentString}:${timestamp}`).digest('hex');

    console.log(`[Fingerprint] Generated NEW conversation fingerprint with timestamp: ${hash.substring(0, 8)}...`);
    return hash;
  }

  // 对于多条消息的对话，使用前3条消息生成指纹（保持会话连续性）
  const messagesToHash = messages.slice(0, Math.min(3, messages.length));

  // 提取消息内容
  const contentParts = messagesToHash.map(msg => {
    if (typeof msg.content === 'string') {
      return msg.content;
    } else if (Array.isArray(msg.content)) {
      // 处理多模态消息（只提取文本部分）
      return msg.content
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('|');
    }
    return '';
  });

  const contentString = contentParts.join('||');
  const hash = crypto.createHash('md5').update(`${modelName}:${contentString}`).digest('hex');

  console.log(`[Fingerprint] Generated fingerprint for ${messagesToHash.length} messages: ${hash.substring(0, 8)}...`);
  return hash;
}

// 提取会话标识（优先使用user字段或X-Session-ID header）
function extractSessionId(req) {
  // 1. 尝试从自定义header获取
  const headerSessionId = req.headers['x-session-id'];
  if (headerSessionId) {
    console.log(`[Session] Found session ID in header: ${headerSessionId}`);
    return headerSessionId;
  }
  
  // 2. 尝试从请求体的user字段获取
  const userField = req.body?.user;
  if (userField && typeof userField === 'string') {
    console.log(`[Session] Found session ID in user field: ${userField}`);
    return userField;
  }
  
  return null;
}

// 获取或创建会话的提供商绑定
function getConversationProvider(sessionIdentifier, modelName, userSettings, providers, pollingConfig) {
  if (!userSettings.conversationProviderMap) {
    userSettings.conversationProviderMap = {};
  }
  
  const key = `${modelName}:${sessionIdentifier}`;
  const mapping = userSettings.conversationProviderMap[key];
  
  if (mapping) {
    // 检查映射的提供商是否仍然可用
    const provider = providers.find(p => p.id === mapping.providerId);
    if (provider && !provider.disabled) {
      // 检查该模型在该提供商是否被禁用
      const isModelDisabled = isModelDisabledForProvider(modelName, mapping.providerId, userSettings);
      if (!isModelDisabled) {
        // 更新最后使用时间和消息计数
        mapping.lastUsed = new Date().toISOString();
        mapping.messageCount = (mapping.messageCount || 0) + 1;
        console.log(`[Session] Using existing provider ${provider.name} for conversation ${key}`);
        return provider;
      } else {
        console.log(`[Session] Model ${modelName} is disabled for provider ${mapping.providerId}, will select new provider`);
      }
    } else {
      console.log(`[Session] Mapped provider ${mapping.providerId} is no longer available, will select new provider`);
    }
  }
  
  return null;
}

// 保存会话-提供商映射
function saveConversationProvider(sessionIdentifier, modelName, providerId, userSettings) {
  if (!userSettings.conversationProviderMap) {
    userSettings.conversationProviderMap = {};
  }
  
  const key = `${modelName}:${sessionIdentifier}`;
  userSettings.conversationProviderMap[key] = {
    providerId: providerId,
    modelName: modelName,
    lastUsed: new Date().toISOString(),
    messageCount: 1,
    createdAt: userSettings.conversationProviderMap[key]?.createdAt || new Date().toISOString()
  };
  
  console.log(`[Session] Saved provider ${providerId} for conversation ${key}`);
}

// 清理过期的会话映射（优化策略：按消息数量和时间综合判断）
function cleanupExpiredConversations(userSettings) {
  if (!userSettings.conversationProviderMap) {
    return 0;
  }

  const now = new Date();
  let cleanedCount = 0;

  for (const key in userSettings.conversationProviderMap) {
    const mapping = userSettings.conversationProviderMap[key];
    const lastUsed = new Date(mapping.lastUsed);
    const age = now - lastUsed;
    const messageCount = mapping.messageCount || 0;

    // 根据消息数量决定过期时间
    // 消息数量>=3的会话保留7天，否则保留24小时
    const effectiveExpirationTime = messageCount >= CONFIG.MIN_MESSAGE_COUNT_FOR_EXTENDED
      ? CONFIG.EXTENDED_SESSION_EXPIRATION
      : CONFIG.SESSION_EXPIRATION_TIME;

    if (age > effectiveExpirationTime) {
      delete userSettings.conversationProviderMap[key];
      cleanedCount++;
    }
  }

  // 限制映射表大小
  const entries = Object.entries(userSettings.conversationProviderMap);
  if (entries.length > CONFIG.MAX_CONVERSATION_MAPPINGS) {
    // 按优先级排序：消息数量多的优先保留，其次是最近使用的
    entries.sort((a, b) => {
      const aMessageCount = a[1].messageCount || 0;
      const bMessageCount = b[1].messageCount || 0;

      // 首先按消息数量排序
      if (aMessageCount !== bMessageCount) {
        return bMessageCount - aMessageCount;
      }

      // 消息数量相同时，按最后使用时间排序
      return new Date(b[1].lastUsed) - new Date(a[1].lastUsed);
    });

    const toKeep = entries.slice(0, CONFIG.MAX_CONVERSATION_MAPPINGS);
    userSettings.conversationProviderMap = Object.fromEntries(toKeep);
    cleanedCount += entries.length - CONFIG.MAX_CONVERSATION_MAPPINGS;
  }

  if (cleanedCount > 0) {
    console.log(`[Session] Cleaned up ${cleanedCount} expired conversation mappings`);
  }

  return cleanedCount;
}

function getPollingProviders(providers, modelName, config) {
  console.log(`Getting polling providers for model: ${modelName}`);
  console.log(`Available config:`, config.available);
  console.log(`Excluded config:`, config.excluded);
  
  const available = config.available[modelName] || [];
  console.log(`Available provider IDs for ${modelName}:`, available);
  
  // 构建排除集合（新格式：数组）
  const excludedSet = new Set();
  if (Array.isArray(config.excluded)) {
    config.excluded.forEach(item => {
      if (item.modelName === modelName) {
        excludedSet.add(item.providerId);
      }
    });
  }
  
  console.log(`Excluded provider IDs for ${modelName}:`, Array.from(excludedSet));
  
  const pollingProviders = available
    .map(id => {
      const provider = providers.find(p => p.id === id);
      if (!provider) {
        console.log(`Provider with ID ${id} not found`);
      } else if (excludedSet.has(id)) {
        console.log(`Provider ${provider.name} (ID: ${id}) is excluded for model ${modelName}`);
      } else {
        console.log(`Found provider: ${provider.name} (ID: ${id}, disabled: ${provider.disabled})`);
      }
      return provider;
    })
    .filter(p => p && !p.disabled && !excludedSet.has(p.id));
    
  console.log(`Final polling providers count: ${pollingProviders.length}`);
  pollingProviders.forEach(p => console.log(`- ${p.name} (ID: ${p.id})`));
  
  return pollingProviders;
}

// 获取下一个轮询提供商（实现随机但不重复的轮询机制）
function getNextPollingProvider(providers, modelName, config, userSettings) {
  console.log(`Getting next polling provider for model: ${modelName}`);

  const available = config.available[modelName] || [];
  console.log(`Available provider IDs for ${modelName}:`, available);

  if (available.length === 0) {
    console.log(`No available providers for model ${modelName}`);
    return null;
  }

  // 构建排除集合（新格式：数组）
  const excludedSet = new Set();
  if (Array.isArray(config.excluded)) {
    config.excluded.forEach(item => {
      if (item.modelName === modelName) {
        excludedSet.add(item.providerId);
      }
    });
  }

  console.log(`Excluded provider IDs for ${modelName}:`, Array.from(excludedSet));

  // 获取或初始化轮询状态
  const pollingState = userSettings.pollingState || {};
  if (!pollingState[modelName]) {
    pollingState[modelName] = {
      currentIndex: 0,
      usedInCurrentRound: []
    };
  }

  const modelState = pollingState[modelName];

  // 确保 usedInCurrentRound 是数组格式（兼容性处理）
  if (!Array.isArray(modelState.usedInCurrentRound)) {
    modelState.usedInCurrentRound = [];
  }

  console.log(`Current polling state for ${modelName}:`, modelState);

  // 获取所有可用且未被排除的提供商ID
  const validProviderIds = available.filter(id => {
    const provider = providers.find(p => p.id === id);
    const isModelDisabled = isModelDisabledForProvider(modelName, id, userSettings);
    const isExcluded = excludedSet.has(id);
    return provider && !provider.disabled && !isModelDisabled && !isExcluded;
  });

  console.log(`Valid provider IDs for ${modelName}:`, validProviderIds);

  // 如果当前轮次已经用完所有有效提供商，开始新的轮次
  if (modelState.usedInCurrentRound.length >= validProviderIds.length) {
    console.log(`All providers used in current round, starting new round for ${modelName}`);
    modelState.usedInCurrentRound = [];
  }

  // 找到本轮次还未使用的提供商
  const unusedProviderIds = validProviderIds.filter(id => !modelState.usedInCurrentRound.includes(id));

  if (unusedProviderIds.length === 0) {
    console.log(`No unused providers available for ${modelName}`);
    return null;
  }

  // 从未使用的提供商中随机选择一个
  const randomIndex = Math.floor(Math.random() * unusedProviderIds.length);
  const selectedProviderId = unusedProviderIds[randomIndex];
  const selectedProvider = providers.find(p => p.id === selectedProviderId);

  if (selectedProvider) {
    modelState.usedInCurrentRound.push(selectedProviderId);
    console.log(`Randomly selected provider: ${selectedProvider.name} (ID: ${selectedProviderId}) for model ${modelName}`);
    console.log(`Used providers in current round (${modelState.usedInCurrentRound.length}/${validProviderIds.length}):`, modelState.usedInCurrentRound);
  }

  // 保存轮询状态
  userSettings.pollingState = pollingState;

  return selectedProvider;
}

// 保存轮询状态到文件
async function savePollingState(userSettings) {
  try {
    await safeWriteFile(USER_SETTINGS_FILE, userSettings);
    invalidateUserSettingsCache(); // 缓存失效
    console.log('Polling state saved successfully');
  } catch (error) {
    console.error('Error saving polling state:', error);
  }
}

// 增加模型失败计数
function incrementModelFailCount(providerId, modelName, userSettings) {
  if (!userSettings.modelFailCounts) {
    userSettings.modelFailCounts = {};
  }
  
  const key = `${providerId}:${modelName}`;
  if (!userSettings.modelFailCounts[key]) {
    userSettings.modelFailCounts[key] = 0;
  }
  
  userSettings.modelFailCounts[key]++;
  console.log(`Model ${modelName} on provider ${providerId} fail count: ${userSettings.modelFailCounts[key]}`);
  
  // 如果失败次数达到阈值，禁用该模型在该提供商上的使用
  if (userSettings.modelFailCounts[key] >= CONFIG.MODEL_FAIL_THRESHOLD) {
    if (!userSettings.disabledModels) {
      userSettings.disabledModels = {};
    }
    if (!userSettings.disabledModels[providerId]) {
      userSettings.disabledModels[providerId] = [];
    }
    if (!userSettings.disabledModels[providerId].includes(modelName)) {
      userSettings.disabledModels[providerId].push(modelName);
      console.log(`Model ${modelName} disabled for provider ${providerId} due to repeated failures`);
    }
  }
}

// 重置模型失败计数
function resetModelFailCount(providerId, modelName, userSettings) {
  if (!userSettings.modelFailCounts) {
    return;
  }
  
  const key = `${providerId}:${modelName}`;
  if (userSettings.modelFailCounts[key]) {
    userSettings.modelFailCounts[key] = 0;
    console.log(`Reset fail count for model ${modelName} on provider ${providerId}`);
  }
  
  // 如果该模型在该提供商被禁用，重新启用
  if (userSettings.disabledModels && userSettings.disabledModels[providerId]) {
    const index = userSettings.disabledModels[providerId].indexOf(modelName);
    if (index > -1) {
      userSettings.disabledModels[providerId].splice(index, 1);
      console.log(`Re-enabled model ${modelName} for provider ${providerId}`);
    }
  }
}

// 检查模型在特定提供商是否被禁用
function isModelDisabledForProvider(modelName, providerId, userSettings) {
  if (!userSettings.disabledModels || !userSettings.disabledModels[providerId]) {
    return false;
  }
  return userSettings.disabledModels[providerId].includes(modelName);
}

// 获取所有可用于故障转移的提供商列表（不使用 usedInCurrentRound 机制）
function getFailoverProviders(providers, modelName, config, userSettings, excludeProviderIds = [], apiKeyInfo = null) {
  console.log(`[Failover] Getting failover providers for model: ${modelName}`);
  console.log(`[Failover] Excluding providers: ${excludeProviderIds.join(', ')}`);

  // 判断是否使用轮询模式
  const usePolling = apiKeyInfo?.usePolling !== false; // 默认为true

  let candidateProviders = [];

  if (usePolling) {
    // 轮询模式：从轮询池中获取提供商
    const available = config.available[modelName] || [];
    console.log(`[Failover] Polling mode - Available provider IDs for ${modelName}:`, available);

    if (available.length === 0) {
      console.log(`[Failover] No available providers for model ${modelName}`);
      return [];
    }

    // 构建排除集合（新格式：数组）
    const excludedFromPool = new Set();
    if (Array.isArray(config.excluded)) {
      config.excluded.forEach(item => {
        if (item.modelName === modelName) {
          excludedFromPool.add(item.providerId);
        }
      });
    }

    console.log(`[Failover] Providers excluded from pool for ${modelName}:`, Array.from(excludedFromPool));

    // 获取轮询状态，确定起始位置
    const pollingState = userSettings.pollingState || {};
    if (!pollingState[modelName]) {
      pollingState[modelName] = {
        currentIndex: 0,
        usedInCurrentRound: []
      };
    }
    userSettings.pollingState = pollingState;

    const modelState = pollingState[modelName];
    const startIndex = modelState.currentIndex || 0;

    // 收集所有可用的提供商，按轮询顺序排列
    for (let i = 0; i < available.length; i++) {
      const index = (startIndex + i) % available.length;
      const providerId = available[index];

      // 跳过已排除的提供商（从故障转移列表中排除）
      if (excludeProviderIds.includes(providerId)) {
        console.log(`[Failover] Provider ${providerId} already tried, skipping`);
        continue;
      }

      // 跳过在排除池中的提供商
      if (excludedFromPool.has(providerId)) {
        console.log(`[Failover] Provider ${providerId} is in excluded pool for model ${modelName}, skipping`);
        continue;
      }

      const provider = providers.find(p => p.id === providerId);
      if (!provider) {
        console.log(`[Failover] Provider ${providerId} not found`);
        continue;
      }

      // 根据API密钥的分组权限进行过滤
      if (apiKeyInfo && apiKeyInfo.allowedGroups && apiKeyInfo.allowedGroups.length > 0) {
        const providerGroupId = provider.groupId || 'default';
        if (!apiKeyInfo.allowedGroups.includes(providerGroupId)) {
          console.log(`[Failover] Provider ${provider.name} (group: ${providerGroupId}) is not in allowed groups, skipping`);
          continue;
        }
      }

      if (provider.disabled) {
        console.log(`[Failover] Provider ${provider.name} is disabled globally`);
        continue;
      }

      candidateProviders.push(provider);
    }
  } else {
    // 非轮询模式：从所有提供商中查找支持该模型的提供商
    console.log(`[Failover] Non-polling mode - Searching all providers for model ${modelName}`);

    const allowedGroups = apiKeyInfo?.allowedGroups || [];

    for (const provider of providers) {
      // 跳过已排除的提供商
      if (excludeProviderIds.includes(provider.id)) {
        console.log(`[Failover] Provider ${provider.id} already tried, skipping`);
        continue;
      }

      if (provider.disabled) {
        console.log(`[Failover] Provider ${provider.name} is disabled globally`);
        continue;
      }

      // 根据API密钥的分组权限进行过滤
      if (allowedGroups.length > 0) {
        const providerGroupId = provider.groupId || 'default';
        if (!allowedGroups.includes(providerGroupId)) {
          console.log(`[Failover] Provider ${provider.name} (group: ${providerGroupId}) is not in allowed groups, skipping`);
          continue;
        }
      }

      // 检查提供商是否支持该模型（使用规范化匹配）
      const hasModel = provider.models?.some(m => {
        const normalized = normalizeModelName(m.id);
        return normalized === modelName && m.visible !== false;
      });

      if (hasModel) {
        console.log(`[Failover] Provider ${provider.name} supports model ${modelName}`);
        candidateProviders.push(provider);
      }
    }
  }

  console.log(`[Failover] Found ${candidateProviders.length} candidate providers`);
  return candidateProviders;
}

// 更新轮询状态（在故障转移成功后调用）
function updatePollingStateAfterSuccess(modelName, successfulProviderId, config, userSettings) {
  const available = config.available[modelName] || [];
  const successIndex = available.indexOf(successfulProviderId);
  
  if (successIndex !== -1) {
    const pollingState = userSettings.pollingState || {};
    if (!pollingState[modelName]) {
      pollingState[modelName] = { currentIndex: 0, usedInCurrentRound: [] };
    }
    
    // 设置下一个轮询位置为成功提供商的下一个
    pollingState[modelName].currentIndex = (successIndex + 1) % available.length;
    
    // 标记成功的提供商为已使用
    if (!Array.isArray(pollingState[modelName].usedInCurrentRound)) {
      pollingState[modelName].usedInCurrentRound = [];
    }
    if (!pollingState[modelName].usedInCurrentRound.includes(successfulProviderId)) {
      pollingState[modelName].usedInCurrentRound.push(successfulProviderId);
    }
    
    // 如果所有提供商都已使用，重置
    if (pollingState[modelName].usedInCurrentRound.length >= available.length) {
      pollingState[modelName].usedInCurrentRound = [];
    }
    
    userSettings.pollingState = pollingState;
    console.log(`[Failover] Updated polling state for ${modelName}: nextIndex=${pollingState[modelName].currentIndex}`);
  }
}

async function incrementFailCount(providerId) {
  const data = await getApiSettings();
  const provider = data.providers.find(p => p.id === providerId);
  if (provider) {
    provider.failCount = (provider.failCount || 0) + 1;
    if (provider.failCount >= 3) {
      provider.disabled = true;
      console.log(`Provider ${provider.name} disabled after 3 failures`);
    }
    await safeWriteFile(API_SETTINGS_FILE, data);
    invalidateApiSettingsCache(); // 缓存失效
  }
}

async function resetFailCount(providerId) {
  const data = await getApiSettings();
  const provider = data.providers.find(p => p.id === providerId);
  if (provider) {
    provider.failCount = 0;
    await safeWriteFile(API_SETTINGS_FILE, data);
    invalidateApiSettingsCache(); // 缓存失效
  }
}

async function getProviderModelId(provider, modelName) {
  try {
    // 首先尝试从provider.models中查找（避免额外的API调用）
    if (provider.models && provider.models.length > 0) {
      const matchedModel = provider.models.find(model => {
        const normalized = normalizeModelName(model.id);
        return normalized === modelName;
      });

      if (matchedModel) {
        console.log(`Found model ${matchedModel.id} in provider's model list (normalized: ${modelName})`);
        return matchedModel.id;
      }
    }

    // 如果在provider.models中找不到，尝试从API获取
    const apiType = provider.apiType || 'openai';
    const url = buildApiUrl(provider.baseUrl, 'models', apiType, provider.customEndpoints);
    const response = await axios.get(url, {
      headers: { 'Authorization': `Bearer ${provider.apiKey}` },
      timeout: 10000
    });

    const models = response.data.data || [];
    const matchedModel = models.find(model => {
      const normalized = normalizeModelName(model.id);
      return normalized === modelName;
    });

    return matchedModel ? matchedModel.id : null;
  } catch (error) {
    console.error(`Failed to get models for provider ${provider.name}:`, error.message);
    return null;
  }
}

/**
 * 规范化模型名称，用于判断不同提供商的模型是否实际上是同一个模型
 * 规则：
 * 1. 忽略平台名（斜杠前的部分）
 * 2. 忽略大小写差异
 * 3. 忽略日期差异（YYYYMMDD 或 YYYY-MM-DD 格式）
 * 4. 保留模型名、版本、参数量、其他说明
 */
function normalizeModelName(modelId) {
  // 1. 转换为小写（忽略大小写）
  let normalized = modelId.toLowerCase().trim();

  // 2. 移除平台前缀（如果有斜杠）
  if (normalized.includes('/')) {
    normalized = normalized.split('/').pop();
  }

  // 3. 移除日期部分
  // 匹配 YYYYMMDD 格式（8位连续数字，前4位是年份）
  normalized = normalized.replace(/[-_]?20\d{6}[-_]?/g, '');

  // 匹配 YYYY-MM-DD 格式
  normalized = normalized.replace(/[-_]?20\d{2}-\d{2}-\d{2}[-_]?/g, '');

  // 4. 清理多余的连字符和下划线
  normalized = normalized.replace(/[-_]+/g, '-');  // 将多个连字符/下划线合并为一个
  normalized = normalized.replace(/^-+|-+$/g, '');  // 移除首尾的连字符

  return normalized;
}

// Performance optimization: Background task processor
class BackgroundTaskProcessor {
  constructor() {
    this.taskQueue = [];
    this.processing = false;
  }

  // Add task to queue for background processing
  addTask(taskFn) {
    this.taskQueue.push(taskFn);
    if (!this.processing) {
      setImmediate(() => this.processTasks());
    }
  }

  // Process all queued tasks
  async processTasks() {
    if (this.processing) return;
    this.processing = true;

    while (this.taskQueue.length > 0) {
      const tasks = this.taskQueue.splice(0, 5); // Process up to 5 tasks at once
      try {
        await Promise.allSettled(tasks.map(task => task()));
      } catch (error) {
        log.error('Background task processing error:', error);
      }
    }

    this.processing = false;
  }

  // Handle success logging and state updates
  handleSuccess(selectedProvider, pureModelName, userSettings, pollingConfig, sessionIdentifier) {
    this.addTask(async () => {
      try {
        // Run these operations in parallel
        await Promise.all([
          logApiCall(selectedProvider.name, pureModelName, true),
          resetModelFailCount(selectedProvider.id, pureModelName, userSettings)
        ]);

        // Update polling state (synchronous)
        updatePollingStateAfterSuccess(pureModelName, selectedProvider.id, pollingConfig, userSettings);

        // Save conversation provider if needed
        if (sessionIdentifier) {
          saveConversationProvider(sessionIdentifier, pureModelName, selectedProvider.id, userSettings);
        }

        // Save polling state (async)
        await savePollingState(userSettings);
      } catch (error) {
        log.error('Background success handling error:', error);
      }
    });
  }

  // Handle failure logging
  handleFailure(selectedProvider, pureModelName, userSettings, errorMessage) {
    this.addTask(async () => {
      try {
        await Promise.all([
          logApiCall(selectedProvider.name, pureModelName, false, errorMessage),
          incrementModelFailCount(selectedProvider.id, pureModelName, userSettings)
        ]);
        await savePollingState(userSettings);
      } catch (error) {
        log.error('Background failure handling error:', error.message);
      }
    });
  }
}

// Performance optimization: Efficient error parser
function parseErrorResponse(error) {
  if (!error.response?.data) {
    return error.message;
  }

  try {
    let errorData = '';
    const data = error.response.data;

    if (Buffer.isBuffer(data)) {
      errorData = data.toString('utf8');
    } else if (typeof data === 'object') {
      return data.error?.message || JSON.stringify(data);
    } else {
      errorData = String(data);
    }

    // Try to parse as JSON
    try {
      const parsed = JSON.parse(errorData);
      return parsed.error?.message || parsed.message || errorData;
    } catch {
      return errorData;
    }
  } catch {
    return error.message;
  }
}

// Performance optimization: Unified error response handler
function sendErrorResponse(res, stream, error, statusCode = 500) {
  if (stream) {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }
    res.write(`data: ${JSON.stringify({ error })}\n\n`);
    res.end();
  } else {
    res.status(statusCode).json({ error });
  }
}

// Global background task processor instance
const backgroundProcessor = new BackgroundTaskProcessor();

function buildStreamingChunkFromCompletion(completion) {
  if (!completion || !Array.isArray(completion.choices) || completion.choices.length === 0) {
    return null;
  }

  const created = completion.created || Math.floor(Date.now() / 1000);
  const model = completion.model || 'unknown';
  const id = completion.id || `chatcmpl-${created}-${Math.floor(Math.random() * 100000)}`;

  const choices = completion.choices.map((choice, index) => {
    const message = choice.message || {};
    const content = typeof message.content === 'string' ? message.content : '';

    return {
      index: choice.index !== undefined ? choice.index : index,
      delta: {
        role: message.role || 'assistant',
        content
      },
      finish_reason: choice.finish_reason || null
    };
  });

  const chunk = {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices
  };

  if (completion.usage) {
    chunk.usage = completion.usage;
  }

  return chunk;
}

// Performance optimization: Simplified streaming response handler
async function handleStreamingResponse(response, res, stream, selectedProvider, pureModelName, userSettings, pollingConfig, sessionIdentifier) {
  const originalContentType = response.headers['content-type'];

  // Set appropriate response headers based on client request
  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
  } else {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }

  let responseCompleted = false;

  // Handle different response types efficiently
  if (originalContentType && originalContentType.includes('text/event-stream')) {
    // Direct SSE forwarding
    response.data.pipe(res);

    // Handle success in background
    response.data.on('end', () => {
      if (!responseCompleted) {
        responseCompleted = true;
        backgroundProcessor.handleSuccess(selectedProvider, pureModelName, userSettings, pollingConfig, sessionIdentifier);
      }
    });
  } else {
    // Handle JSON response
    let chunks = [];

    response.data.on('data', chunk => {
      if (responseCompleted) return;
      chunks.push(chunk);
    });

    response.data.on('end', async () => {
      if (responseCompleted) return;
      responseCompleted = true;

      try {
        const fullData = Buffer.concat(chunks).toString('utf8');
        const jsonData = JSON.parse(fullData);

        if (stream) {
          // Convert a non-stream JSON completion to a single SSE chunk
          const sseChunk = buildStreamingChunkFromCompletion(jsonData);
          const payload = sseChunk || jsonData;
          const sseData = `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
          res.end(sseData, 'utf8');
        } else {
          // Return JSON directly
          res.json(jsonData);
        }

        // Handle success in background (non-blocking)
        backgroundProcessor.handleSuccess(selectedProvider, pureModelName, userSettings, pollingConfig, sessionIdentifier);

      } catch (parseError) {
        log.error('Error parsing response:', parseError);
        if (stream) {
          res.write(`data: ${JSON.stringify({ error: { message: 'Invalid response format' } })}\n\n`);
          res.end();
        } else {
          res.status(500).json({ error: 'Invalid response format' });
        }
      }
    });
  }

  response.data.on('error', (error) => {
    if (!responseCompleted) {
      responseCompleted = true;
      log.error('Stream error:', error.message);

      // Handle failure in background
      backgroundProcessor.handleFailure(selectedProvider, pureModelName, userSettings, error.message);

      if (stream) {
        res.write(`data: ${JSON.stringify({ error: { message: error.message } })}\n\n`);
      } else {
        res.status(500).json({ error: { message: error.message } });
      }
      res.end();
    }
  });
}

// ==================== 图像生成模型支持 ====================

/**
 * 识别模型类型（文本或图像生成）
 * @param {Object} provider - 提供商对象
 * @param {string} modelId - 模型ID
 * @returns {string} - 'text' 或 'image'
 */
function getModelType(provider, modelId) {
  // 1. 从provider配置读取
  const model = provider.models?.find(m => m.id === modelId);
  if (model?.type) {
    log.debug(`[ModelType] Found type from config: ${model.type} for model ${modelId}`);
    return model.type;
  }

  // 2. 从模型ID推断
  const imageKeywords = ['dall-e', 'dalle', 'stable-diffusion', 'midjourney', 'imagen', 'sd-', 'sdxl'];
  const isImageModel = imageKeywords.some(kw => modelId.toLowerCase().includes(kw));

  if (isImageModel) {
    log.debug(`[ModelType] Inferred as image model from ID: ${modelId}`);
    return 'image';
  }

  log.debug(`[ModelType] Defaulting to text model for: ${modelId}`);
  return 'text';
}

/**
 * 构建图像生成API的URL
 * @param {string} baseUrl - 基础URL
 * @param {string} apiType - API类型
 * @returns {string} - 完整的API URL
 */
function buildImageApiUrl(baseUrl, apiType, customEndpoints = null) {
  baseUrl = baseUrl.replace(/\/$/, '');

  if (customEndpoints && customEndpoints.images) {
    return `${baseUrl}${customEndpoints.images}`;
  }

  if (apiType === 'openai') {
    return `${baseUrl}/v1/images/generations`;
  }

  // 其他API类型可以在这里扩展
  // 默认使用OpenAI格式
  return `${baseUrl}/v1/images/generations`;
}

/**
 * 构建图像生成请求体
 * @param {string} modelId - 模型ID
 * @param {string} prompt - 提示词
 * @param {Object} params - 参数
 * @param {string} apiType - API类型
 * @returns {Object} - 请求体
 */
function buildImageRequestBody(modelId, prompt, params, apiType) {
  if (apiType === 'openai') {
    const requestBody = {
      model: modelId,
      prompt: prompt,
      n: params.n || 1,
      size: params.size || '1024x1024'
    };

    // 只有DALL-E 3支持quality和style参数
    if (modelId.toLowerCase().includes('dall-e-3')) {
      if (params.quality) {
        requestBody.quality = params.quality;
      }
      if (params.style) {
        requestBody.style = params.style;
      }
    }

    return requestBody;
  }

  // 其他API格式
  return {
    model: modelId,
    prompt: prompt,
    ...params
  };
}

/**
 * 解析图像生成响应
 * @param {Object} data - API响应数据
 * @param {string} apiType - API类型
 * @returns {Object} - 标准化的图像数据
 */
function parseImageResponse(data, apiType) {
  if (apiType === 'openai') {
    return {
      images: data.data.map(img => ({
        url: img.url || img.b64_json,
        revisedPrompt: img.revised_prompt
      })),
      metadata: {
        created: data.created
      }
    };
  }

  // 其他API格式
  return {
    images: data.images || [],
    metadata: {}
  };
}

/**
 * 生成图像（非流式）
 * @param {Object} provider - 提供商对象
 * @param {string} prompt - 提示词
 * @param {Object} params - 参数
 * @param {Object} res - 响应对象
 * @param {string} modelId - 模型ID
 */
async function generateImage(provider, prompt, params, res, modelId) {
  log.info(`[ImageGen] Starting image generation with provider: ${provider.name}, model: ${modelId}`);
  log.verbose(`[ImageGen] Prompt: ${prompt.substring(0, 100)}...`);
  log.verbose(`[ImageGen] Params:`, params);

  const apiType = provider.apiType || 'openai';
  const url = buildImageApiUrl(provider.baseUrl, apiType, provider.customEndpoints);

  try {
    // 构建请求体
    const requestBody = buildImageRequestBody(modelId, prompt, params, apiType);
    log.verbose(`[ImageGen] Request body:`, requestBody);

    // 设置响应头（SSE格式）
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 发送开始生成的消息
    res.write(`data: ${JSON.stringify({
      type: 'status',
      message: '正在生成图片，请稍候...'
    })}\n\n`);

    // 调用API（非流式，等待完整响应）
    const response = await axios.post(url, requestBody, {
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: CONFIG.STREAM_TIMEOUT // 使用配置的超时时间（120秒）
    });

    log.info(`[ImageGen] Image generation successful, status: ${response.status}`);

    // 解析响应
    const imageData = parseImageResponse(response.data, apiType);
    log.verbose(`[ImageGen] Generated ${imageData.images.length} image(s)`);

    // 记录成功的API调用
    await logApiCall(provider.name, modelId, true);

    // 发送图片数据（模拟SSE流式响应）
    res.write(`data: ${JSON.stringify({
      type: 'image',
      images: imageData.images,
      metadata: {
        model: modelId,
        provider: provider.name,
        timestamp: new Date().toISOString(),
        parameters: {
          size: params.size || '1024x1024',
          quality: params.quality || 'standard',
          n: params.n || 1
        },
        ...imageData.metadata
      }
    })}\n\n`);

    // 发送完成标记
    res.write(`data: [DONE]\n\n`);
    res.end();

    log.info(`[ImageGen] Response sent successfully`);

  } catch (error) {
    log.error(`[ImageGen] Error generating image:`, error.message);

    // 使用高效的错误解析器
    const errorMessage = parseErrorResponse(error);
    log.verbose(`[ImageGen] Parsed error message:`, errorMessage);

    // 记录失败的API调用
    await logApiCall(provider.name, modelId, false, errorMessage);

    // 发送错误消息
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }

    res.write(`data: ${JSON.stringify({
      error: {
        message: errorMessage,
        type: 'image_generation_error'
      }
    })}\n\n`);
    res.end();

    throw error;
  }
}

async function streamChat(provider, messages, params, res, modelId, images, systemPrompt) {
  log.verbose(`[DEBUG] streamChat: provider=${provider.name}, modelId=${modelId}, messages=${messages.length}, apiType=${provider.apiType}, systemPrompt=${systemPrompt ? 'yes' : 'no'}`);

  const apiType = provider.apiType || 'openai';
  const url = buildApiUrl(provider.baseUrl, 'chat/completions', apiType, provider.customEndpoints);

  // Process image messages if needed
  let processedMessages = messages;
  if (images && images.length > 0) {
    // Find last user message and add images
    processedMessages = [...messages];
    const lastUserMessageIndex = processedMessages.length - 1;
    if (lastUserMessageIndex >= 0 && processedMessages[lastUserMessageIndex].role === 'user') {
      const content = [
        { type: 'text', text: processedMessages[lastUserMessageIndex].content }
      ];

      // Add image content
      images.forEach((image, index) => {
        // Check dataUrl format
        if (!image.dataUrl || !image.dataUrl.includes('base64,')) {
          log.error(`Invalid dataUrl format for image ${index + 1}`);
          return;
        }

        content.push({
          type: 'image_url',
          image_url: {
            url: image.dataUrl
          }
        });
      });

      processedMessages[lastUserMessageIndex] = {
        ...processedMessages[lastUserMessageIndex],
        content: content
      };
    }
  }
  try {
    log.verbose(`[DEBUG] streamChat: Building request body...`);
    const requestBody = buildChatRequestBody(modelId || provider.defaultModel, processedMessages, { ...params, stream: true }, apiType, images, systemPrompt);

    const headers = {
      'Authorization': `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
      ...(apiType === 'anthropic' && {
        'anthropic-version': '2023-06-01'
      })
    };

    log.verbose(`[DEBUG] streamChat: Making POST request to: ${url}`);

    const response = await axios.post(url, requestBody, {
      headers,
      responseType: 'stream',
      timeout: CONFIG.REQUEST_TIMEOUT
    });

    log.verbose(`[DEBUG] streamChat: Request successful, response status: ${response.status}`);

    // Record successful API call
    await logApiCall(provider.name, modelId || provider.defaultModel, true);

    // Performance optimization: Add error handling and timeout control
    let streamClosed = false;

    const cleanupStream = () => {
      if (streamClosed) return;
      streamClosed = true;

      // 移除所有事件监听器，防止内存泄漏
      response.data.removeAllListeners('data');
      response.data.removeAllListeners('end');
      response.data.removeAllListeners('error');

      // 销毁流
      if (!response.data.destroyed) {
        response.data.destroy();
      }
    };

    const timeout = setTimeout(() => {
      cleanupStream();
      if (!res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: 'Stream timeout' })}\n\n`);
      }
      res.end();
    }, CONFIG.STREAM_TIMEOUT);

    response.data.on('data', chunk => {
      try {
        res.write(chunk);
      } catch (error) {
        log.error('Error writing chunk:', error);
        clearTimeout(timeout);
        cleanupStream();
        res.end();
      }
    });

    response.data.on('end', () => {
      clearTimeout(timeout);
      cleanupStream();
      res.end();
    });

    response.data.on('error', (error) => {
      log.error('Stream error:', error);
      clearTimeout(timeout);
      cleanupStream();
      res.write(`data: ${JSON.stringify({ error: 'Stream error: ' + error.message })}\n\n`);
      res.end();
    });
  } catch (error) {
    log.error(`[DEBUG] streamChat error occurred:`, error.message);

    // Use efficient error parser
    const errorMessage = parseErrorResponse(error);
    log.verbose(`[DEBUG] Parsed error message:`, errorMessage);

    // Record failed API call
    await logApiCall(provider.name, modelId || provider.defaultModel, false, errorMessage);
    throw error;
  }
}

// ==================== OpenAI API 兼容代理接口 ====================

// 验证代理 API Key 中间件 - 支持多密钥认证
async function verifyProxyApiKey(req, res, next) {
  const userSettings = await getUserSettings();
  const proxyKeys = userSettings.proxyApiKeys || {};
  const legacyKey = userSettings.proxyApiKey;
  
  // 从请求头获取 API Key
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: {
        message: 'Missing or invalid Authorization header. Expected: Bearer <api_key>',
        type: 'invalid_request_error',
        code: 'invalid_api_key'
      }
    });
  }
  
  const providedKey = authHeader.substring(7); // 去掉 'Bearer ' 前缀
  
  // 检查多密钥系统
  let validKey = null;
  for (const keyId in proxyKeys) {
    const keyData = proxyKeys[keyId];
    if (keyData.apiKey === providedKey && keyData.enabled) {
      validKey = { id: keyId, ...keyData };
      break;
    }
  }
  
  // 如果多密钥系统中没有找到，检查旧的单一密钥（向后兼容）
  if (!validKey && legacyKey && legacyKey.trim() !== '' && providedKey === legacyKey) {
    validKey = {
      id: 'legacy',
      name: 'Legacy Key',
      apiKey: legacyKey,
      enabled: true,
      params: userSettings.defaultParams || { temperature: 0.7, max_tokens: 2000, top_p: 1 },
      allowedModels: [], // 空数组表示允许所有模型
      rateLimit: { requestsPerMinute: 60, requestsPerHour: 1000 }
    };
  }
  
  // 如果没有找到有效密钥
  if (!validKey) {
    // 如果既没有配置多密钥也没有配置旧密钥，允许所有请求
    if (Object.keys(proxyKeys).length === 0 && (!legacyKey || legacyKey.trim() === '')) {
      return next();
    }
    
    return res.status(401).json({
      error: {
        message: 'Invalid API key provided',
        type: 'invalid_request_error',
        code: 'invalid_api_key'
      }
    });
  }
  
  // 将密钥信息附加到请求对象
  req.apiKeyInfo = validKey;
  
  // 更新使用统计
  if (validKey.id !== 'legacy') {
    try {
      userSettings.proxyApiKeys[validKey.id].usageCount = (userSettings.proxyApiKeys[validKey.id].usageCount || 0) + 1;
      userSettings.proxyApiKeys[validKey.id].lastUsed = new Date().toISOString();
      await safeWriteFile(USER_SETTINGS_FILE, userSettings);
      invalidateUserSettingsCache();
    } catch (error) {
      console.error('Error updating key usage stats:', error);
    }
  }
  
  next();
}

// OpenAI 兼容 - 获取模型列表（根据API密钥权限过滤）
app.get('/v1/models', verifyProxyApiKey, async (req, res) => {
  try {
    const userSettings = await getUserSettings();
    const settings = await getApiSettings();
    const pollingConfig = userSettings.pollingConfig || { available: {}, excluded: {} };
    const apiKeyInfo = req.apiKeyInfo;

    let availableModelNames = [];

    // 判断是否使用轮询模式
    const usePolling = apiKeyInfo?.usePolling !== false; // 默认为true

    if (usePolling) {
      // 轮询模式：返回轮询池中的模型
      const availableModels = pollingConfig.available || {};

      // 构建排除集合（新格式：数组）
      const excludedModels = new Map(); // modelName -> Set of excluded providerIds
      if (Array.isArray(pollingConfig.excluded)) {
        pollingConfig.excluded.forEach(item => {
          if (!excludedModels.has(item.modelName)) {
            excludedModels.set(item.modelName, new Set());
          }
          excludedModels.get(item.modelName).add(item.providerId);
        });
      }

      for (const modelName of Object.keys(availableModels)) {
        const allProviders = availableModels[modelName] || [];

        // 过滤掉被排除的提供商
        const excludedSet = excludedModels.get(modelName) || new Set();
        const availableProviders = allProviders.filter(id => !excludedSet.has(id));

        // 只有拥有至少2个可用提供商的模型才能被外部使用
        if (availableProviders.length >= 2) {
          availableModelNames.push(modelName);
        }
      }
    } else {
      // 非轮询模式：返回指定分组的所有模型
      const allowedGroups = apiKeyInfo?.allowedGroups || [];
      const allModelsSet = new Set();

      // 如果没有指定分组，返回所有分组的模型
      const providersToInclude = settings.providers.filter(p => {
        if (p.disabled) return false;
        if (allowedGroups.length === 0) return true; // 没有限制，包含所有
        return allowedGroups.includes(p.groupId || 'default');
      });

      providersToInclude.forEach(provider => {
        if (provider.models) {
          provider.models.forEach(model => {
            if (model.visible !== false) {
              allModelsSet.add(model.id);
            }
          });
        }
      });

      availableModelNames = Array.from(allModelsSet);
    }

    // 根据API密钥权限过滤模型
    const allowedModels = apiKeyInfo?.allowedModels || [];

    // 如果密钥配置了允许的模型列表，则只返回允许的模型
    // 如果没有配置（空数组），则返回所有可用的模型
    let filteredModels = availableModelNames;
    if (allowedModels.length > 0) {
      filteredModels = availableModelNames.filter(modelName =>
        allowedModels.includes(modelName)
      );
    }

    const models = filteredModels.map(modelName => ({
      id: modelName,
      object: 'model',
      created: Date.now(),
      owned_by: 'equal-ask-proxy',
      permission: [],
      root: modelName,
      parent: null
    }));

    console.log(`[Models API] API Key: ${apiKeyInfo?.name || 'Legacy'}`);
    console.log(`[Models API] Use Polling: ${usePolling}`);
    console.log(`[Models API] Allowed models: ${allowedModels.length > 0 ? allowedModels.join(', ') : 'All models'}`);
    console.log(`[Models API] Returned models: ${filteredModels.join(', ')}`);

    res.json({
      object: 'list',
      data: models
    });
  } catch (error) {
    console.error('Error getting models:', error);
    res.status(500).json({
      error: {
        message: error.message,
        type: 'server_error',
        code: 'internal_error'
      }
    });
  }
});

// OpenAI 兼容 - Chat Completions（支持自动故障转移）
app.post('/v1/chat/completions', verifyProxyApiKey, async (req, res) => {
  // ==================== 日志追踪初始化 ====================
  const traceId = generateTraceId();
  const perfTracker = new PerformanceTracker(traceId);
  perfTracker.checkpoint('request_start');

  // 提取客户端信息
  const clientIp = req.ip || req.connection.remoteAddress ||
                   req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                   'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  const apiKeyName = req.apiKeyInfo?.name || 'unknown';

  try {
    const { messages, model, stream = false, temperature, max_tokens, top_p, ...otherParams } = req.body;

    log.debug(`[DEBUG] New chat completion request: model=${model}, stream=${stream}, messages=${messages ? messages.length : 'undefined'}`);
    log.verbose(`[DEBUG] Request parameters:`, JSON.stringify({ temperature, max_tokens, top_p, ...otherParams }, null, 2));

    if (!messages || !Array.isArray(messages)) {
      log.debug(`[DEBUG] Invalid messages parameter`);
      return sendErrorResponse(res, stream, {
        message: 'messages is required and must be an array',
        type: 'invalid_request_error',
        code: 'invalid_messages'
      }, 400);
    }

    log.verbose(`[DEBUG] Loading settings...`);
    const settings = await getApiSettings();
    const userSettings = await getUserSettings();
    log.verbose(`[DEBUG] Found ${settings.providers.length} providers`);
    const pollingConfig = userSettings.pollingConfig || { available: {}, excluded: {} };
    
    // ==================== 会话识别机制（混合模式） ====================
    // 1. 提取session_id（优先级：X-Session-ID header > user字段）
    const sessionId = extractSessionId(req);
    
    // 2. 生成消息指纹（基于前几条消息内容）
    const messageFingerprint = generateMessageFingerprint(messages, model);
    
    // 3. 确定会话标识符（优先使用session_id，否则使用消息指纹）
    const sessionIdentifier = sessionId || messageFingerprint;
    
    console.log(`[Session] Session ID: ${sessionId || 'none'}`);
    console.log(`[Session] Message Fingerprint: ${messageFingerprint ? messageFingerprint.substring(0, 8) + '...' : 'none'}`);
    console.log(`[Session] Using identifier: ${sessionIdentifier ? sessionIdentifier.substring(0, 16) + '...' : 'none'}`);
    
    // 定期清理过期的会话映射
    cleanupExpiredConversations(userSettings);
    
    // 确定要使用的模型名称
    let modelName = model;

    log.verbose(`[DEBUG] Model name determination: original=${model}, final=${modelName}`);

    if (!modelName) {
      log.debug(`[DEBUG] No model specified, returning error`);
      return sendErrorResponse(res, stream, {
        message: 'model is required. Please specify a model in the request.',
        type: 'invalid_request_error',
        code: 'model_required'
      }, 400);
    }

    // Extract pure model name (remove possible prefix)
    const pureModelName = normalizeModelName(modelName);

    log.verbose(`[DEBUG] Pure model name: ${pureModelName}`);

    // Check model permissions - if key configured allowed model list, perform permission check
    const allowedModels = req.apiKeyInfo?.allowedModels || [];
    log.verbose(`[DEBUG] API key allowed models:`, allowedModels);
    if (allowedModels.length > 0 && !allowedModels.includes(pureModelName)) {
      log.debug(`[DEBUG] Model not allowed for this API key`);
      return sendErrorResponse(res, stream, {
        message: `Model '${pureModelName}' is not allowed for this API key. Allowed models: ${allowedModels.join(', ')}`,
        type: 'permission_error',
        code: 'model_not_allowed'
      }, 403);
    }

    // 判断是否使用轮询模式
    const usePolling = req.apiKeyInfo?.usePolling !== false; // 默认为true

    if (usePolling) {
      // 轮询模式：检查模型是否在轮询池中
      const availableProviderIds = pollingConfig.available?.[pureModelName] || [];
      log.verbose(`[DEBUG] Available provider IDs for model ${pureModelName}:`, availableProviderIds);
      if (availableProviderIds.length < 2) {
        log.debug(`[DEBUG] Insufficient providers for model ${pureModelName}: ${availableProviderIds.length}`);
        return sendErrorResponse(res, stream, {
          message: `Model '${pureModelName}' requires at least 2 providers for polling. Current providers: ${availableProviderIds.length}. Please configure more providers in polling settings.`,
          type: 'invalid_request_error',
          code: 'insufficient_providers'
        }, 400);
      }

      // 检查模型是否所有提供商都被排除
      const excludedSet = new Set();
      if (Array.isArray(pollingConfig.excluded)) {
        pollingConfig.excluded.forEach(item => {
          if (item.modelName === pureModelName) {
            excludedSet.add(item.providerId);
          }
        });
      }
      log.verbose(`[DEBUG] Excluded provider IDs for model ${pureModelName}:`, Array.from(excludedSet));

      // Calculate actual available provider count (excluding excluded ones)
      const actualAvailableProviders = availableProviderIds.filter(id => !excludedSet.has(id));
      log.verbose(`[DEBUG] Actual available providers after exclusions:`, actualAvailableProviders);

      if (actualAvailableProviders.length === 0) {
        return sendErrorResponse(res, stream, {
          message: `Model '${pureModelName}' has no available providers (all providers are excluded).`,
          type: 'invalid_request_error',
          code: 'all_providers_excluded'
        }, 400);
      }
    } else {
      // 非轮询模式：检查模型是否在允许的分组中
      const allowedGroups = req.apiKeyInfo?.allowedGroups || [];
      const modelExists = settings.providers.some(provider => {
        if (provider.disabled) return false;
        if (allowedGroups.length > 0 && !allowedGroups.includes(provider.groupId || 'default')) return false;
        return provider.models?.some(m => normalizeModelName(m.id) === pureModelName && m.visible !== false);
      });

      if (!modelExists) {
        return sendErrorResponse(res, stream, {
          message: `Model '${pureModelName}' is not available in the allowed provider groups.`,
          type: 'invalid_request_error',
          code: 'model_not_available'
        }, 400);
      }
    }
    
    // 构建请求参数 - 参数隔离机制
    const keyParams = req.apiKeyInfo?.params || {};
    const params = {
      temperature: temperature !== undefined ? temperature :
                  (keyParams.temperature !== undefined ? keyParams.temperature :
                  (userSettings.defaultParams?.temperature ?? 0.7)),
      max_tokens: max_tokens !== undefined ? max_tokens :
                 (keyParams.max_tokens !== undefined ? keyParams.max_tokens :
                 (userSettings.defaultParams?.max_tokens ?? 2000)),
      top_p: top_p !== undefined ? top_p :
            (keyParams.top_p !== undefined ? keyParams.top_p :
            (userSettings.defaultParams?.top_p ?? 1)),
      ...otherParams
    };
    
    // 删除不需要传递的参数
    delete params.model;
    delete params.messages;
    delete params.stream;
    
    console.log(`[Proxy] Request parameters - temperature: ${params.temperature}, max_tokens: ${params.max_tokens}, top_p: ${params.top_p}`);
    
    // ==================== 会话绑定机制：优先使用已绑定的提供商 ====================
    let selectedProvider = null;
    const isNewConversation = messages.length === 1 && messages[0].role === 'user';

    // 如果是新对话，则必须忽略之前的绑定，以避免历史记录污染
    if (isNewConversation && sessionIdentifier) {
        const key = `${pureModelName}:${sessionIdentifier}`;
        if (userSettings.conversationProviderMap && userSettings.conversationProviderMap[key]) {
            console.log(`[Session] New conversation detected. Deleting old provider binding for key: ${key}`);
            delete userSettings.conversationProviderMap[key];
        }
    }

    // 如果有会话标识符且不是新对话，则尝试获取绑定的提供商
    if (sessionIdentifier && !isNewConversation) {
      selectedProvider = getConversationProvider(
        sessionIdentifier,
        pureModelName,
        userSettings,
        settings.providers,
        pollingConfig
      );

      if (selectedProvider) {
        console.log(`[Session] Found existing provider binding: ${selectedProvider.name} (ID: ${selectedProvider.id})`);
        // 异步记录会话绑定（非阻塞）
        setImmediate(() => {
          logSessionBind({
            traceId,
            sessionId: sessionIdentifier,
            model: pureModelName,
            providerId: selectedProvider.id,
            providerName: selectedProvider.name
          });
        });
      } else {
        console.log(`[Session] No existing provider binding found, will select new provider`);
      }
    }
    
    // ==================== 自动故障转移逻辑 ====================
    const errors = []; // 收集所有失败的错误信息
    const triedProviderIds = []; // 记录已尝试的提供商ID
    
    // 如果有已绑定的提供商，优先尝试它
    let failoverProviders = [];
    if (selectedProvider) {
      // 将已绑定的提供商放在第一位
      failoverProviders = [selectedProvider];
      // 获取其他可用的提供商作为备选
      const otherProviders = getFailoverProviders(
        settings.providers,
        pureModelName,
        pollingConfig,
        userSettings,
        [selectedProvider.id],
        req.apiKeyInfo
      );
      failoverProviders = failoverProviders.concat(otherProviders);
    } else {
      // 没有绑定的提供商，获取所有可用的提供商
      failoverProviders = getFailoverProviders(settings.providers, pureModelName, pollingConfig, userSettings, [], req.apiKeyInfo);
    }
    
    if (failoverProviders.length === 0) {
      log.error(`[Proxy] No available providers for model ${pureModelName}`);
      return sendErrorResponse(res, stream, {
        message: `No available providers for model '${pureModelName}'`,
        type: 'server_error',
        code: 'no_providers_available'
      }, 503);
    }
    
    console.log(`[Proxy] Found ${failoverProviders.length} providers for failover`);
    
    for (let attempt = 0; attempt < failoverProviders.length; attempt++) {
      const selectedProvider = failoverProviders[attempt];

      triedProviderIds.push(selectedProvider.id);

      // 记录提供商切换（非首次尝试时）
      if (attempt > 0) {
        const prevProvider = failoverProviders[attempt - 1];
        setImmediate(() => {
          logProviderSwitch({
            traceId,
            fromProvider: prevProvider.name,
            toProvider: selectedProvider.name,
            reason: `Previous provider failed: ${errors[errors.length - 1]?.error || 'Unknown error'}`
          });
        });
      }

      console.log(`[Proxy] Attempt ${attempt + 1}/${failoverProviders.length}: Trying provider ${selectedProvider.name} (ID: ${selectedProvider.id})`);
      
      // 获取该提供商的具体模型ID
      const providerModelId = await getProviderModelId(selectedProvider, pureModelName);
      if (!providerModelId) {
        console.log(`[Proxy] Model ${pureModelName} not found in provider ${selectedProvider.name}, trying next...`);
        errors.push({
          provider: selectedProvider.name,
          error: `Model not found in provider`
        });
        await incrementModelFailCount(selectedProvider.id, pureModelName, userSettings);
        continue;
      }
      
      console.log(`[Proxy] Using model ID: ${providerModelId} from provider ${selectedProvider.name}`);

      const apiType = selectedProvider.apiType || 'openai';
      console.log(`[DEBUG] Provider API type: ${apiType}`);
      const url = buildApiUrl(selectedProvider.baseUrl, 'chat/completions', apiType, selectedProvider.customEndpoints);

      if (stream) {
        // ==================== 流式响应（带故障转移） ====================
        console.log(`[DEBUG] Starting streaming request to: ${url}`);
        try {
          const requestBody = buildChatRequestBody(providerModelId, messages, params, apiType, null);
          requestBody.stream = true;

          const headers = {
            'Authorization': `Bearer ${selectedProvider.apiKey}`,
            'Content-Type': 'application/json',
            ...(apiType === 'anthropic' && {
              'anthropic-version': '2023-06-01'
            })
          };

          console.log(`[DEBUG] Request headers:`, JSON.stringify(headers, null, 2));
          console.log(`[DEBUG] Making streaming POST request...`);

          const response = await axios.post(url, requestBody, {
            headers,
            responseType: 'stream',
            timeout: 120000
          });

          log.verbose(`[DEBUG] Stream request successful, response status: ${response.status}`);

          // Use simplified streaming response handler
          await handleStreamingResponse(response, res, stream, selectedProvider, pureModelName, userSettings, pollingConfig, sessionIdentifier);

          // Stream request successfully initiated, exit loop
          log.verbose(`[DEBUG] Stream request initiated successfully, exiting provider loop`);

          // 记录API请求日志（非阻塞）
          perfTracker.checkpoint('request_complete');
          setImmediate(() => {
            logApiRequest({
              traceId,
              clientIp,
              userAgent,
              apiKeyName,
              sessionId: sessionIdentifier,
              isPolling: usePolling,
              isNewConversation,
              request: { model: pureModelName, stream: true, messages },
              providers: [{
                attempt: attempt + 1,
                providerId: selectedProvider.id,
                providerName: selectedProvider.name,
                status: 'success',
                statusCode: response.status,
                duration: perfTracker.getDuration('request_complete')
              }],
              result: {
                status: 'success',
                successfulProvider: selectedProvider.id,
                totalAttempts: 1,
                totalDuration: perfTracker.getTotalDuration(),
                tokenUsage: null,  // 流式响应无法立即获取token使用量
                estimatedCost: null
              },
              metadata: { failoverOccurred: attempt > 0, isStreaming: true }
            });
          });

          return;

        } catch (error) {
          log.error(`[DEBUG] Provider ${selectedProvider.name} failed with error:`, error.message);

          // Use efficient error parser
          const errorMessage = parseErrorResponse(error);

          // Handle failure in background (non-blocking)
          backgroundProcessor.handleFailure(selectedProvider, pureModelName, userSettings, errorMessage);

          errors.push({
            provider: selectedProvider.name,
            error: errorMessage,
            status: error.response?.status
          });
          // Continue trying next provider
        }
        
      } else {
        // ==================== 非流式响应（带故障转移） ====================
        console.log(`[DEBUG] Starting non-streaming request to: ${url}`);
        try {
          const requestBody = buildChatRequestBody(providerModelId, messages, params, apiType, null);
          requestBody.stream = false;

          const headers = {
            'Authorization': `Bearer ${selectedProvider.apiKey}`,
            'Content-Type': 'application/json',
            ...(apiType === 'anthropic' && {
              'anthropic-version': '2023-06-01'
            })
          };

          console.log(`[DEBUG] Non-streaming request headers:`, JSON.stringify(headers, null, 2));
          console.log(`[DEBUG] Making non-streaming POST request...`);

          const response = await axios.post(url, requestBody, {
            headers,
            timeout: 120000
          });

          log.verbose(`[DEBUG] Non-streaming request successful, response status: ${response.status}`);

          // Handle success in background (non-blocking)
          backgroundProcessor.handleSuccess(selectedProvider, pureModelName, userSettings, pollingConfig, sessionIdentifier);

          log.verbose(`[DEBUG] Non-streaming request completed successfully using provider ${selectedProvider.name}`);

          // 记录API请求日志（非阻塞）
          perfTracker.checkpoint('request_complete');
          setImmediate(() => {
            logApiRequest({
              traceId,
              clientIp,
              userAgent,
              apiKeyName,
              sessionId: sessionIdentifier,
              isPolling: usePolling,
              isNewConversation,
              request: { model: pureModelName, stream, messages },
              providers: [{
                attempt: attempt + 1,
                providerId: selectedProvider.id,
                providerName: selectedProvider.name,
                status: 'success',
                statusCode: response.status,
                duration: perfTracker.getDuration('request_complete')
              }],
              result: {
                status: 'success',
                successfulProvider: selectedProvider.id,
                totalAttempts: 1,
                totalDuration: perfTracker.getTotalDuration(),
                tokenUsage: response.data?.usage || null,
                estimatedCost: null  // TODO: 添加成本计算
              },
              metadata: { failoverOccurred: attempt > 0 }
            });
          });

          return res.status(200).json(response.data);

        } catch (error) {
          log.error(`[DEBUG] Non-streaming provider ${selectedProvider.name} failed with error:`, error.message);

          // Use efficient error parser
          const errorMessage = parseErrorResponse(error);

          // Handle failure in background (non-blocking)
          backgroundProcessor.handleFailure(selectedProvider, pureModelName, userSettings, errorMessage);

          errors.push({
            provider: selectedProvider.name,
            error: errorMessage,
            status: error.response?.status
          });
          // Continue trying next provider
        }
      }
    }
    
    // All providers failed
    backgroundProcessor.addTask(async () => {
      await savePollingState(userSettings);
    });

    log.error(`[Proxy] All ${triedProviderIds.length} providers failed for model ${pureModelName}`);

    // Build detailed error information
    const errorDetails = errors.map(e => `${e.provider}: ${e.error}`).join('; ');

    // 记录API请求日志（非阻塞）
    perfTracker.checkpoint('all_providers_failed');
    setImmediate(() => {
      logApiRequest({
        traceId,
        clientIp,
        userAgent,
        apiKeyName,
        sessionId: sessionIdentifier,
        isPolling: usePolling,
        isNewConversation,
        request: { model: pureModelName, stream, messages },
        providers: errors.map((e, idx) => ({
          attempt: idx + 1,
          providerId: `provider_${idx}`,
          providerName: e.provider,
          status: 'failed',
          statusCode: e.status,
          error: e.error
        })),
        result: {
          status: 'failed',
          successfulProvider: null,
          totalAttempts: triedProviderIds.length,
          totalDuration: perfTracker.getTotalDuration(),
          tokenUsage: null,
          estimatedCost: null
        },
        metadata: { failoverOccurred: triedProviderIds.length > 1 }
      });
    });

    sendErrorResponse(res, stream, {
      message: `All providers failed for model '${pureModelName}'. Tried ${triedProviderIds.length} providers.${stream ? ` Details: ${errorDetails}` : ''}`,
      type: 'server_error',
      code: 'all_providers_failed',
      ...(stream ? {} : { details: errors })
    }, 503);

  } catch (error) {
    log.error('[Proxy] Unexpected error:', error);

    // 记录异常错误日志（非阻塞）
    perfTracker.checkpoint('error');
    setImmediate(() => {
      logApiRequest({
        traceId,
        clientIp,
        userAgent,
        apiKeyName,
        sessionId: sessionIdentifier,
        isPolling: usePolling,
        isNewConversation,
        request: { model: pureModelName, stream, messages },
        providers: [],
        result: {
          status: 'failed',
          successfulProvider: null,
          totalAttempts: 0,
          totalDuration: perfTracker.getTotalDuration(),
          tokenUsage: null,
          estimatedCost: null
        },
        metadata: { errorType: 'internal_error', errorMessage: error.message }
      });
    });

    sendErrorResponse(res, stream, {
      message: error.message,
      type: 'server_error',
      code: 'internal_error'
    });
  }
});

// ==================== 多API密钥管理接口 ====================

// 生成随机API密钥
// 生成随机API密钥（使用密码学安全的随机数生成器）
function generateApiKey() {
  // 使用crypto.randomBytes生成密码学安全的随机数
  const bytes = crypto.randomBytes(36); // 36字节 = 48个base62字符
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'sk-';

  for (let i = 0; i < 48; i++) {
    // 使用随机字节作为索引
    const randomIndex = bytes[i % bytes.length] % chars.length;
    result += chars.charAt(randomIndex);
  }

  return result;
}

// 获取所有API密钥
app.get('/api/proxy-keys', async (req, res) => {
  try {
    const userSettings = await getUserSettings();
    const proxyKeys = userSettings.proxyApiKeys || {};
    
    // 转换为数组格式
    const keys = Object.keys(proxyKeys).map(id => ({
      id,
      ...proxyKeys[id]
    }));
    
    res.json(keys);
  } catch (error) {
    console.error('Error getting proxy keys:', error);
    res.status(500).json({ error: error.message });
  }
});

// 创建新的API密钥
app.post('/api/proxy-keys', async (req, res) => {
  try {
    const { name, description } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: '密钥名称不能为空' });
    }
    
    const userSettings = await getUserSettings();
    if (!userSettings.proxyApiKeys) {
      userSettings.proxyApiKeys = {};
    }
    
    const keyId = Date.now().toString();
    const apiKey = generateApiKey();
    
    const newKey = {
      name: name.trim(),
      description: description || '',
      apiKey: apiKey,
      enabled: true,
      createdAt: new Date().toISOString(),
      lastUsed: null,
      usageCount: 0,
      params: {
        temperature: 0.7,
        max_tokens: 2000,
        top_p: 1
      },
      allowedModels: [],
      allowedGroups: [], // 新增：允许的分组
      rateLimit: {
        requestsPerMinute: 60,
        requestsPerHour: 1000
      }
    };
    
    userSettings.proxyApiKeys[keyId] = newKey;
    
    await safeWriteFile(USER_SETTINGS_FILE, userSettings);
    invalidateUserSettingsCache();
    
    res.json({ id: keyId, ...newKey });
  } catch (error) {
    console.error('Error creating proxy key:', error);
    res.status(500).json({ error: error.message });
  }
});

// 更新API密钥
app.put('/api/proxy-keys/:id', async (req, res) => {
  try {
    const keyId = req.params.id;
    const updates = req.body;
    
    const userSettings = await getUserSettings();
    if (!userSettings.proxyApiKeys || !userSettings.proxyApiKeys[keyId]) {
      return res.status(404).json({ error: '密钥不存在' });
    }
    
    // 更新密钥信息（不允许更新apiKey和id）
    const { id, apiKey, ...allowedUpdates } = updates;
    userSettings.proxyApiKeys[keyId] = {
      ...userSettings.proxyApiKeys[keyId],
      ...allowedUpdates
    };
    
    await safeWriteFile(USER_SETTINGS_FILE, userSettings);
    invalidateUserSettingsCache();
    
    res.json({ id: keyId, ...userSettings.proxyApiKeys[keyId] });
  } catch (error) {
    console.error('Error updating proxy key:', error);
    res.status(500).json({ error: error.message });
  }
});

// 重新生成API密钥
app.post('/api/proxy-keys/:id/regenerate', async (req, res) => {
  try {
    const keyId = req.params.id;
    
    const userSettings = await getUserSettings();
    if (!userSettings.proxyApiKeys || !userSettings.proxyApiKeys[keyId]) {
      return res.status(404).json({ error: '密钥不存在' });
    }
    
    const newApiKey = generateApiKey();
    userSettings.proxyApiKeys[keyId].apiKey = newApiKey;
    
    await safeWriteFile(USER_SETTINGS_FILE, userSettings);
    invalidateUserSettingsCache();
    
    res.json({ apiKey: newApiKey });
  } catch (error) {
    console.error('Error regenerating proxy key:', error);
    res.status(500).json({ error: error.message });
  }
});

// 删除API密钥
app.delete('/api/proxy-keys/:id', async (req, res) => {
  try {
    const keyId = req.params.id;
    
    const userSettings = await getUserSettings();
    if (!userSettings.proxyApiKeys || !userSettings.proxyApiKeys[keyId]) {
      return res.status(404).json({ error: '密钥不存在' });
    }
    
    delete userSettings.proxyApiKeys[keyId];
    
    await safeWriteFile(USER_SETTINGS_FILE, userSettings);
    invalidateUserSettingsCache();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting proxy key:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== 日志查询接口 ====================

// 获取日志统计数据（增强版）
app.get('/api/logs/stats', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // 如果没有提供日期范围，默认查询当天（使用本地时间）
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const localToday = `${year}-${month}-${day}`;
    const start = startDate || localToday;
    const end = endDate || localToday;

    // 验证日期范围
    const startDateObj = new Date(start);
    const endDateObj = new Date(end);
    const daysDiff = Math.ceil((endDateObj - startDateObj) / (1000 * 60 * 60 * 24));

    if (daysDiff > 7) {
      return res.status(400).json({ error: '日期范围不能超过7天' });
    }

    // 判断是否是当天数据
    const isToday = start === end && start === getLocalToday();

    // 检查缓存
    const cacheKey = `stats:${start}:${end}`;
    const cachedStats = getCachedStats(cacheKey, isToday);
    if (cachedStats) {
      return res.json({
        dateRange: { start, end },
        stats: cachedStats,
        fromCache: true
      });
    }

    // 读取并解析日志
    const logEntries = await readLogs(start, end);

    // 解析日志生成统计数据
    const stats = parseLogsForStats(logEntries);

    // 存入缓存（当天数据缓存时间更短）
    setCachedStats(cacheKey, stats, isToday);

    res.json({
      dateRange: { start, end },
      stats,
      fromCache: false
    });
  } catch (error) {
    console.error('Error getting log stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// 刷新统计数据缓存（强制重新加载）
app.post('/api/logs/stats/refresh', async (req, res) => {
  try {
    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: '请提供日期范围' });
    }

    // 清除该日期范围的缓存
    const cacheKey = `stats:${startDate}:${endDate}`;
    statsCache.delete(cacheKey);

    // 重新读取并解析日志
    const logEntries = await readLogs(startDate, endDate);
    const stats = parseLogsForStats(logEntries);

    // 重新存入缓存
    const isToday = startDate === endDate && startDate === getLocalToday();
    setCachedStats(cacheKey, stats, isToday);

    res.json({
      dateRange: { start: startDate, end: endDate },
      stats,
      fromCache: false,
      refreshed: true
    });
  } catch (error) {
    console.error('Error refreshing log stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取可用的日志日期列表
app.get('/api/logs/available', async (req, res) => {
  try {
    const dates = await getAvailableLogDates();
    res.json({ dates });
  } catch (error) {
    console.error('Error getting available log dates:', error);
    res.status(500).json({ error: error.message });
  }
});

// 搜索日志（支持多条件过滤和分页）
app.get('/api/logs', async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      level,
      type,
      userId,
      traceId,
      keyword,
      limit = 100,
      offset = 0
    } = req.query;

    // 如果没有提供日期范围，默认查询当天（使用本地时间）
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const localToday = `${year}-${month}-${day}`;
    const start = startDate || localToday;
    const end = endDate || localToday;

    // 验证日期范围
    const startDateObj = new Date(start);
    const endDateObj = new Date(end);
    const daysDiff = Math.ceil((endDateObj - startDateObj) / (1000 * 60 * 60 * 24));

    if (daysDiff > 7) {
      return res.status(400).json({ error: '日期范围不能超过7天' });
    }

    // 验证限制参数
    const parsedLimit = parseInt(limit);
    const parsedOffset = parseInt(offset);

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      return res.status(400).json({ error: 'limit必须在1到1000之间' });
    }

    if (isNaN(parsedOffset) || parsedOffset < 0) {
      return res.status(400).json({ error: 'offset必须大于等于0' });
    }

    // 验证级别和类型
    const validLevels = Object.values(LogLevel);
    const validTypes = Object.values(LogType);

    if (level && !validLevels.includes(level)) {
      return res.status(400).json({ error: `无效的日志级别，可选值: ${validLevels.join(', ')}` });
    }

    if (type && !validTypes.includes(type)) {
      return res.status(400).json({ error: `无效的日志类型，可选值: ${validTypes.join(', ')}` });
    }

    // 搜索日志
    const result = await searchLogs({
      startDate: start,
      endDate: end,
      level,
      type,
      userId,
      traceId,
      keyword,
      limit: parsedLimit,
      offset: parsedOffset
    });

    res.json({
      dateRange: { start, end },
      logs: result.logs,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('Error searching logs:', error);
    res.status(500).json({ error: error.message });
  }
});

// 导出日志
app.get('/api/logs/export', async (req, res) => {
  try {
    const { startDate, endDate, format = 'json' } = req.query;

    // 验证导出格式
    if (!['json', 'csv'].includes(format)) {
      return res.status(400).json({ error: '无效的导出格式，可选值: json, csv' });
    }

    // 如果没有提供日期范围，默认查询当天（使用本地时间）
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const localToday = `${year}-${month}-${day}`;
    const start = startDate || localToday;
    const end = endDate || localToday;

    // 验证日期范围
    const startDateObj = new Date(start);
    const endDateObj = new Date(end);
    const daysDiff = Math.ceil((endDateObj - startDateObj) / (1000 * 60 * 60 * 24));

    if (daysDiff > 30) {
      return res.status(400).json({ error: '导出的日期范围不能超过30天' });
    }

    // 读取日志
    const logEntries = await readLogs(start, end);

    // 根据格式导出
    let exportData;
    let contentType;
    let filename;

    if (format === 'csv') {
      exportData = exportToCSV(logEntries);
      contentType = 'text/csv; charset=utf-8';
      filename = `logs_${start}_${end}.csv`;
    } else {
      exportData = exportToJSON(logEntries);
      contentType = 'application/json; charset=utf-8';
      filename = `logs_${start}_${end}.json`;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(exportData);
  } catch (error) {
    console.error('Error exporting logs:', error);
    res.status(500).json({ error: error.message });
  }
});

// 实时日志流（Server-Sent Events）
app.get('/api/logs/stream', async (req, res) => {
  try {
    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const { level, type } = req.query;

    // 验证级别和类型
    const validLevels = Object.values(LogLevel);
    const validTypes = Object.values(LogType);

    if (level && !validLevels.includes(level)) {
      return res.status(400).json({ error: `无效的日志级别，可选值: ${validLevels.join(', ')}` });
    }

    if (type && !validTypes.includes(type)) {
      return res.status(400).json({ error: `无效的日志类型，可选值: ${validTypes.join(', ')}` });
    }

    // 添加日志监听器
    const removeListener = addLogListener((logEntry) => {
      // 根据过滤条件决定是否发送
      if (level && logEntry.level !== level) return;
      if (type && logEntry.type !== type) return;

      res.write(`data: ${JSON.stringify(logEntry)}\n\n`);
    });

    // 发送初始连接消息
    res.write(`data: ${JSON.stringify({ type: 'connected', message: '实时日志流已连接' })}\n\n`);

    // 客户端断开连接时移除监听器
    req.on('close', () => {
      removeListener();
    });

    req.on('end', () => {
      removeListener();
    });
  } catch (error) {
    console.error('Error setting up log stream:', error);
    res.status(500).json({ error: error.message });
  }
});

// 归档旧日志
app.post('/api/logs/archive', async (req, res) => {
  try {
    const { daysToKeep = 30 } = req.body;

    // 验证参数
    if (daysToKeep < 1 || daysToKeep > 365) {
      return res.status(400).json({ error: 'daysToKeep必须在1到365之间' });
    }

    const result = await archiveOldLogs(daysToKeep);

    res.json({
      success: true,
      archivedCount: result.archivedCount,
      errors: result.errors
    });
  } catch (error) {
    console.error('Error archiving logs:', error);
    res.status(500).json({ error: error.message });
  }
});

// 删除指定日期范围的日志
app.delete('/api/logs', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: '必须提供开始日期和结束日期' });
    }

    const result = await deleteLogs(startDate, endDate);

    res.json({
      success: true,
      deletedCount: result.deletedCount,
      errors: result.errors
    });
  } catch (error) {
    console.error('Error deleting logs:', error);
    res.status(500).json({ error: error.message });
  }
});

// 清空所有日志
app.delete('/api/logs/all', async (req, res) => {
  try {
    const result = await clearAllLogs();

    res.json({
      success: true,
      deletedCount: result.deletedCount,
      errors: result.errors
    });
  } catch (error) {
    console.error('Error clearing all logs:', error);
    res.status(500).json({ error: error.message });
  }
});

// 添加 CORS 预检请求支持
app.options('/v1/*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(204).end();
});

// 处理 SPA 路由
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

initDataDir().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`OpenAI compatible API available at http://localhost:${PORT}/v1`);
  });
});
