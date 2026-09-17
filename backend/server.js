const express = require('express');
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
const { initializeDatabase, getDb, closeDatabase } = require('./db');
const {
  migrateJsonDataToSqlite,
  getApiSettingsFromDb,
  saveApiSettingsToDb,
  getUserSettingsFromDb,
  saveUserSettingsToDb,
  saveHotUserStateToDb,
  saveColdUserSettingsToDb,
  incrementProxyKeyUsageBatch,
  getPromptsFromDb,
  savePromptsToDb,
  getLanguagesFromDb,
  saveLanguagesToDb,
  getConversationsFromDb,
  getConversationByIdFromDb,
  saveConversationToDb,
  deleteConversationFromDb,
  normalizeProviderRpm
} = require('./repositories');
const {
  normalizeTokenUsage,
  buildAnthropicProxyHeaders,
  formatOpenAIModel,
  formatAnthropicModel
} = require('./proxyUtils');

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

function buildHealthPayload() {
  return {
    status: 'ok',
    service: 'equal-ask',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  };
}

function isPublicCompatPath(path) {
  return path === '/models' || path.startsWith('/models/') || path === '/v1' || path.startsWith('/v1/');
}

app.use((req, res, next) => {
  if (!isPublicCompatPath(req.path)) {
    return next();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Session-ID, Anthropic-Version, Anthropic-Beta');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

app.use(express.json({ limit: '50mb' })); // 增加请求体大小限制
app.use(express.urlencoded({ limit: '50mb', extended: true })); // 增加URL编码请求体大小限制
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    if (isPublicCompatPath(req.path)) {
      return res.status(400).json({
        error: {
          message: 'Invalid JSON in request body',
          type: 'invalid_request_error',
          code: 'invalid_json'
        }
      });
    }
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  return next(err);
});
app.use(express.static(path.join(__dirname, '../frontend/dist')));

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

// 支持Tool Calling的主流模型列表（模型名称匹配规则）
const TOOL_CALLING_SUPPORTED_MODELS = [
  /gpt-/i,           // ChatGPT系列: gpt-4, gpt-3.5-turbo等
  /claude/i,         // Claude系列
  /gemini/i,         // Gemini系列
  /glm-/i,           // GLM系列: glm-4等
  /moonshot/i,       // Kimi (Moonshot)
  /abab/i,           // MiniMax
];

// 检查模型是否支持Tool Calling
function supportsToolCalling(modelName) {
  if (!modelName) return false;
  const normalized = modelName.toLowerCase();
  return TOOL_CALLING_SUPPORTED_MODELS.some(pattern => pattern.test(normalized));
}

// 配置常量
const CONFIG = {
  CACHE_TTL: 5000, // 缓存过期时间（毫秒）
  MAX_CONVERSATION_MAPPINGS: 1000, // 最大会话映射数量
  SESSION_EXPIRATION_TIME: 24 * 60 * 60 * 1000, // 短会话过期时间（24小时）
  EXTENDED_SESSION_EXPIRATION: 7 * 24 * 60 * 60 * 1000, // 长会话过期时间（7天）
  MIN_MESSAGE_COUNT_FOR_EXTENDED: 3, // 保留更久的最小消息数
  MODEL_FAIL_THRESHOLD: 3, // 模型失败阈值
  POLLING_MAX_ROUNDS: 2, // 轮询失败后最多完整遍历供应商列表的轮数
  STREAM_TIMEOUT: 1800000, // 流式空闲超时（30分钟无数据才断开），有数据会续命
  UPSTREAM_STREAM_TIMEOUT: 0, // 0 表示不限制仍在传输的上游流
  REQUEST_TIMEOUT: 600000 // 非流式上游超时（10分钟）
};

function createEntityId() {
  return crypto.randomUUID();
}

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

// 非流式请求各自传入 timeout；流式必须显式 timeout: 0，避免默认 30s 掐断
axios.defaults.timeout = 0;

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
      keyPollingState: {}, // 存储每个提供商的Key轮询状态
      modelFailCounts: {}, // 存储每个模型在每个提供商的失败计数
      keyFailCounts: {}, // 存储每个提供商Key的失败计数
      proxyApiKey: '', // 代理接口密钥（向后兼容）
      proxyApiKeys: {}, // 多API密钥管理
      pollingMaxRounds: CONFIG.POLLING_MAX_ROUNDS, // 轮询失败后最多完整遍历供应商列表的轮数
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
    const data = getApiSettingsFromDb();
    apiSettingsCache = data;
    apiSettingsCacheTime = now;
    return data;
  } catch (error) {
    console.error('Error reading API settings from SQLite:', error);
    return {
      providers: [],
      groups: [
        { id: 'default', name: '默认分组', description: '未分组的提供商' }
      ]
    };
  }
}

async function getUserSettings() {
  if (userSettingsCache) {
    return userSettingsCache;
  }

  try {
    const data = getUserSettingsFromDb();
    applyPendingProxyKeyUsage(data);
    userSettingsCache = data;
    userSettingsCacheTime = Date.now();
    return data;
  } catch (error) {
    console.error('Error reading user settings from SQLite:', error);
    return {
      defaultParams: { temperature: 0.7, max_tokens: 2000, top_p: 1 },
      globalFrequency: 10,
      pollingConfig: { available: {}, excluded: {}, disabled: {} },
      pollingState: {},
      keyPollingState: {},
      modelFailCounts: {},
      keyFailCounts: {},
      pollingMaxRounds: CONFIG.POLLING_MAX_ROUNDS,
      proxyApiKey: '',
      proxyApiKeys: {},
      conversationProviderMap: {},
      disabledModels: {}
    };
  }
}

const pendingProxyKeyUsage = new Map();
const PROXY_KEY_USAGE_FLUSH_MS = 15000;

function applyPendingProxyKeyUsage(settings) {
  if (!settings?.proxyApiKeys) return;
  pendingProxyKeyUsage.forEach((pending, id) => {
    const key = settings.proxyApiKeys[id];
    if (!key) return;
    key.usageCount = (key.usageCount || 0) + pending.delta;
    key.lastUsed = pending.lastUsed;
  });
}

function recordProxyKeyUsage(keyId) {
  if (!keyId || keyId === 'legacy') return;

  const lastUsed = new Date().toISOString();
  const current = pendingProxyKeyUsage.get(keyId) || { delta: 0, lastUsed };
  current.delta += 1;
  current.lastUsed = lastUsed;
  pendingProxyKeyUsage.set(keyId, current);

  const cachedKey = userSettingsCache?.proxyApiKeys?.[keyId];
  if (cachedKey) {
    cachedKey.usageCount = (cachedKey.usageCount || 0) + 1;
    cachedKey.lastUsed = lastUsed;
  }
}

function flushProxyKeyUsage() {
  if (pendingProxyKeyUsage.size === 0) return;

  const entries = Array.from(pendingProxyKeyUsage.entries());
  pendingProxyKeyUsage.clear();

  try {
    incrementProxyKeyUsageBatch(entries);
  } catch (error) {
    entries.forEach(([id, pending]) => {
      const current = pendingProxyKeyUsage.get(id) || { delta: 0, lastUsed: pending.lastUsed };
      current.delta += pending.delta;
      current.lastUsed = pending.lastUsed;
      pendingProxyKeyUsage.set(id, current);
    });
    console.error('Error flushing proxy key usage:', error);
  }
}

function persistAllUserSettings(userSettings) {
  flushProxyKeyUsage();
  saveUserSettingsToDb(userSettings);
  pendingProxyKeyUsage.clear();
  // Keep the live cache object. Replacing it would drop in-flight polling/session mutations.
  userSettingsCache = userSettings;
  userSettingsCacheTime = Date.now();
  return userSettings;
}

setInterval(flushProxyKeyUsage, PROXY_KEY_USAGE_FLUSH_MS).unref();

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

const AUTH_COOKIE_NAME = 'equal_ask_session';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const loginAttempts = new Map();

function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) return cookies;
      const key = safeDecodeURIComponent(part.slice(0, separatorIndex));
      const value = safeDecodeURIComponent(part.slice(separatorIndex + 1));
      cookies[key] = value;
      return cookies;
    }, {});
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex'), iterations = 120000) {
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;

  const [algorithm, iterationsText, salt, expectedHash] = storedHash.split('$');
  if (algorithm !== 'pbkdf2' || !iterationsText || !salt || !expectedHash) {
    return false;
  }

  const iterations = Number(iterationsText);
  const actualHash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512');
  const expected = Buffer.from(expectedHash, 'hex');
  return expected.length === actualHash.length && crypto.timingSafeEqual(expected, actualHash);
}

function shouldUseSecureCookie(req) {
  if (process.env.AUTH_SECURE_COOKIE === 'true') return true;
  if (process.env.AUTH_SECURE_COOKIE === 'false') return false;
  return Boolean(req?.secure || req?.headers?.['x-forwarded-proto'] === 'https');
}

function setAuthCookie(res, token, maxAgeMs = SESSION_TTL_MS, req = null) {
  const cookieParts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`
  ];

  if (shouldUseSecureCookie(req)) {
    cookieParts.push('Secure');
  }

  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearAuthCookie(res, req = null) {
  const cookieParts = [
    `${AUTH_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0'
  ];
  if (shouldUseSecureCookie(req)) {
    cookieParts.push('Secure');
  }
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    role: row.role
  };
}

function isLoginRateLimited(ip) {
  const now = Date.now();
  const attempts = (loginAttempts.get(ip) || []).filter(timestamp => now - timestamp < LOGIN_WINDOW_MS);
  loginAttempts.set(ip, attempts);
  return attempts.length >= MAX_LOGIN_ATTEMPTS;
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const attempts = (loginAttempts.get(ip) || []).filter(timestamp => now - timestamp < LOGIN_WINDOW_MS);
  attempts.push(now);
  loginAttempts.set(ip, attempts);
}

function clearLoginFailures(ip) {
  loginAttempts.delete(ip);
}

function getSessionUser(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[AUTH_COOKIE_NAME];
  if (!token) return null;

  const db = getDb();
  const tokenHash = hashToken(token);
  const row = db.prepare(`
    SELECT
      user_sessions.id AS session_id,
      users.id,
      users.username,
      users.display_name,
      users.role,
      users.enabled,
      user_sessions.expires_at
    FROM user_sessions
    JOIN users ON users.id = user_sessions.user_id
    WHERE user_sessions.token_hash = ?
  `).get(tokenHash);

  if (!row || !row.enabled) return null;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM user_sessions WHERE id = ?').run(row.session_id);
    return null;
  }

  db.prepare('UPDATE user_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.session_id);
  return publicUser(row);
}

function requireAuth(req, res, next) {
  if (req.method === 'OPTIONS') {
    return next();
  }

  try {
    const user = getSessionUser(req);
    if (!user) {
      return res.status(401).json({ error: '未登录或登录已过期' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth check failed:', error);
    res.status(500).json({ error: '登录状态验证失败' });
  }
}

function ensureDefaultAdminUser() {
  const db = getDb();
  const existing = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (existing.count > 0) return;

  const username = process.env.ADMIN_USERNAME || 'admin';
  const envPassword = process.env.ADMIN_PASSWORD;
  const password = envPassword || crypto.randomBytes(18).toString('base64url');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (id, username, display_name, password_hash, role, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'admin', 1, ?, ?)
  `).run(crypto.randomUUID(), username, '管理员', hashPassword(password), now, now);

  console.log(`[Auth] Created admin user: ${username}`);
  if (!envPassword) {
    console.log(`[Auth] Generated initial admin password: ${password}`);
    console.log('[Auth] Set ADMIN_PASSWORD before first start if you want to choose it yourself.');
  }
}

function cleanupExpiredSessions() {
  try {
    getDb().prepare('DELETE FROM user_sessions WHERE expires_at <= ?').run(new Date().toISOString());
  } catch (error) {
    console.error('Error cleaning expired sessions:', error);
  }
}

// 读取语言数据
async function getLanguages() {
  const now = Date.now();
  if (languagesCache && (now - languagesCacheTime) < CACHE_TTL) {
    return languagesCache;
  }

  try {
    const data = getLanguagesFromDb();
    languagesCache = data;
    languagesCacheTime = now;
    return data;
  } catch (error) {
    console.error('Error reading languages from SQLite:', error);
    return {
      sourceLanguages: [],
      targetLanguages: []
    };
  }
}

// 保存语言数据
async function saveLanguages(data) {
  saveLanguagesToDb(data);
  invalidateLanguagesCache();
}

// 读取提示词库
async function getPrompts() {
  const now = Date.now();
  if (promptsCache && (now - promptsCacheTime) < CACHE_TTL) {
    return promptsCache;
  }

  try {
    const data = getPromptsFromDb();
    promptsCache = data;
    promptsCacheTime = now;
    return data;
  } catch (error) {
    console.error('Error reading prompts from SQLite:', error);
    return {
      prompts: [],
      groups: [{ id: 'default', name: '默认分组', description: '未分组的提示词' }],
      tags: []
    };
  }
}

// 保存提示词库
async function savePrompts(data) {
  savePromptsToDb(data);
  invalidatePromptsCache();
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (isLoginRateLimited(ip)) {
      return res.status(429).json({ error: '登录失败次数过多，请稍后再试' });
    }

    const { username, password } = req.body || {};
    if (!username || !password) {
      recordLoginFailure(ip);
      return res.status(400).json({ error: '请输入用户名和密码' });
    }

    const db = getDb();
    const user = db.prepare(`
      SELECT id, username, display_name, password_hash, role, enabled
      FROM users
      WHERE username = ?
    `).get(String(username).trim());

    if (!user || !user.enabled || !verifyPassword(password, user.password_hash)) {
      recordLoginFailure(ip);
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

    db.prepare(`
      INSERT INTO user_sessions (id, user_id, token_hash, expires_at, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), user.id, hashToken(token), expiresAt, now.toISOString(), now.toISOString());

    clearLoginFailures(ip);
    setAuthCookie(res, token, SESSION_TTL_MS, req);
    res.json({ user: publicUser(user) });
  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).json({ error: '登录失败' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = parseCookies(req.headers.cookie || '')[AUTH_COOKIE_NAME];
    if (token) {
      getDb().prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(hashToken(token));
    }
    clearAuthCookie(res, req);
    res.json({ success: true });
  } catch (error) {
    console.error('Logout failed:', error);
    clearAuthCookie(res, req);
    res.status(500).json({ error: '退出登录失败' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const user = getSessionUser(req);
    if (!user) {
      return res.status(401).json({ authenticated: false });
    }
    res.json({ authenticated: true, user });
  } catch (error) {
    console.error('Auth status check failed:', error);
    res.status(500).json({ error: '获取登录状态失败' });
  }
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: '请输入当前密码和新密码' });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: '新密码至少需要 8 个字符' });
    }

    const db = getDb();
    const user = db.prepare(`
      SELECT id, username, password_hash, enabled
      FROM users
      WHERE id = ?
    `).get(req.user.id);

    if (!user || !user.enabled || !verifyPassword(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: '当前密码错误' });
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(hashPassword(newPassword), now, user.id);

    const currentToken = parseCookies(req.headers.cookie || '')[AUTH_COOKIE_NAME];
    if (currentToken) {
      db.prepare('DELETE FROM user_sessions WHERE user_id = ? AND token_hash <> ?')
        .run(user.id, hashToken(currentToken));
    } else {
      db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(user.id);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Change password failed:', error);
    res.status(500).json({ error: '修改密码失败' });
  }
});

app.get('/api/health', (req, res) => {
  res.json(buildHealthPayload());
});

app.use('/api', requireAuth);

// API 路由
app.get('/api/providers', async (req, res) => {
  const data = await getApiSettings();
  res.json(data.providers);
});

app.post('/api/providers/export', async (req, res) => {
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
      const invalid = oldFormatProviders.find(provider => !provider?.id || !String(provider.baseUrl || '').trim());
      if (invalid) {
        return res.status(400).json({ error: '每个供应商都需要 id 和 baseUrl' });
      }
      const newSettings = {
        providers: oldFormatProviders,
        groups: [{ id: 'default', name: '默认分组', description: '未分组的提供商' }]
      };
      saveApiSettingsToDb(newSettings);
      invalidateApiSettingsCache();
      return res.json({ success: true, message: `成功导入 ${oldFormatProviders.length} 个提供商（旧格式）。` });
    }

    if (!Array.isArray(providers) || !Array.isArray(groups)) {
      return res.status(400).json({ error: '数据格式无效，需要 "providers" 和 "groups" 数组。' });
    }
    const invalid = providers.find(provider => !provider?.id || !String(provider.baseUrl || '').trim());
    if (invalid) {
      return res.status(400).json({ error: '每个供应商都需要 id 和 baseUrl' });
    }

    // 验证并确保默认分组存在
    let hasDefaultGroup = groups.some(g => g.id === 'default');
    if (!hasDefaultGroup) {
      groups.unshift({ id: 'default', name: '默认分组', description: '未分组的提供商' });
    }

    const newSettings = { providers, groups };
    saveApiSettingsToDb(newSettings);
    invalidateApiSettingsCache();
    res.json({ success: true, message: `成功导入 ${providers.length} 个提供商和 ${groups.length} 个分组。` });
  } catch (error) {
    console.error('Error importing data:', error);
    res.status(500).json({ error: 'Failed to import data' });
  }
});

app.post('/api/providers', async (req, res) => {
  const baseUrl = typeof req.body?.baseUrl === 'string' ? req.body.baseUrl.trim() : '';
  if (!baseUrl) {
    return res.status(400).json({ error: 'baseUrl 不能为空' });
  }
  const data = await getApiSettings();
  const newProvider = {
    ...req.body,
    id: createEntityId(),
    baseUrl,
    failCount: 0,
    disabled: false,
    groupId: req.body.groupId || 'default', // 默认分组
    apiType: req.body.apiType || 'openai', // 默认为OpenAI兼容格式
    keyPollingEnabled: req.body.keyPollingEnabled === true,
    rpm: normalizeProviderRpm(req.body.rpm),
    sortOrder: data.providers.length
  };
  data.providers.push(newProvider);
  saveApiSettingsToDb(data);
  invalidateApiSettingsCache(); // 缓存失效
  res.json(newProvider);
});

// 供应商排序（按分组）
app.put('/api/providers/reorder', async (req, res) => {
  const { groupId = 'default', orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res.status(400).json({ error: 'orderedIds 不能为空' });
  }

  const data = await getApiSettings();
  const idsSet = new Set(orderedIds);

  // 只更新指定分组内的顺序
  const groupProviders = data.providers.filter(p => (p.groupId || 'default') === groupId);
  const otherProviders = data.providers.filter(p => (p.groupId || 'default') !== groupId);

  const reordered = [];
  orderedIds.forEach((id, index) => {
    const found = groupProviders.find(p => p.id === id);
    if (found) {
      reordered.push({ ...found, sortOrder: index });
    }
  });

  const missing = groupProviders.filter(p => !idsSet.has(p.id)).map((p, index) => ({
    ...p,
    sortOrder: reordered.length + index
  }));

  data.providers = [...otherProviders, ...reordered, ...missing];
  saveApiSettingsToDb(data);
  invalidateApiSettingsCache();
  res.json({ success: true, count: groupProviders.length });
});

app.put('/api/providers/:id', async (req, res) => {
  const data = await getApiSettings();
  const index = data.providers.findIndex(p => p.id === req.params.id);
  if (index !== -1) {
    const nextBaseUrl = req.body?.baseUrl !== undefined
      ? (typeof req.body.baseUrl === 'string' ? req.body.baseUrl.trim() : '')
      : data.providers[index].baseUrl;
    if (!nextBaseUrl) {
      return res.status(400).json({ error: 'baseUrl 不能为空' });
    }
    data.providers[index] = {
      ...data.providers[index],
      ...req.body,
      id: data.providers[index].id,
      baseUrl: nextBaseUrl,
      rpm: normalizeProviderRpm(req.body.rpm ?? data.providers[index].rpm)
    };
    saveApiSettingsToDb(data);
    invalidateApiSettingsCache(); // 缓存失效
    res.json(data.providers[index]);
  } else {
    res.status(404).json({ error: 'Provider not found' });
  }
});

// 批量删除供应商（必须在 :id 路由之前定义）
app.delete('/api/providers/batch', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请提供要删除的供应商ID列表' });
    }

    const data = await getApiSettings();
    const originalCount = data.providers.length;
    const idsSet = new Set(ids);

    data.providers = data.providers.filter(p => !idsSet.has(p.id));
    const deletedCount = originalCount - data.providers.length;

    saveApiSettingsToDb(data);
    invalidateApiSettingsCache();

    console.log(`[供应商管理] 批量删除了 ${deletedCount} 个供应商`);
    res.json({
      success: true,
      deletedCount,
      message: `成功删除 ${deletedCount} 个供应商`
    });
  } catch (error) {
    console.error('[供应商管理] 批量删除失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 清除所有供应商（必须在 :id 路由之前定义）
app.delete('/api/providers/all', async (req, res) => {
  try {
    const data = await getApiSettings();
    const deletedCount = data.providers.length;

    data.providers = [];

    saveApiSettingsToDb(data);
    invalidateApiSettingsCache();

    console.log(`[供应商管理] 清除了所有供应商，共 ${deletedCount} 个`);
    res.json({
      success: true,
      deletedCount,
      message: `成功清除所有供应商，共 ${deletedCount} 个`
    });
  } catch (error) {
    console.error('[供应商管理] 清除所有供应商失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 删除单个供应商（:id 路由必须放在具体路由之后）
app.delete('/api/providers/:id', async (req, res) => {
  const data = await getApiSettings();
  data.providers = data.providers.filter(p => p.id !== req.params.id);
  saveApiSettingsToDb(data);
  invalidateApiSettingsCache(); // 缓存失效
  res.json({ success: true });
});

async function fetchProviderModelsFromRemote(provider, timeout = 10000, keyInfo = null) {
  const apiType = provider.apiType || 'openai';
  const url = buildApiUrl(provider.baseUrl, 'models', apiType, provider.customEndpoints);
  const response = await axios.get(url, {
    headers: buildProviderAuthHeaders(provider, keyInfo),
    timeout
  });
  return extractModelsFromRemoteResponse(response.data);
}

function mergeProviderModelsWithVisibility(oldModels = [], remoteModels = []) {
  const oldModelsMap = new Map(oldModels.map(m => [m.id, m]));
  return remoteModels.map(model => {
    const previousModel = oldModelsMap.get(model.id) || {};
    return {
      id: model.id,
      visible: previousModel.visible !== undefined ? previousModel.visible : true,
      type: previousModel.type || 'text'
    };
  });
}

async function refreshSingleProviderModels(provider, options = {}) {
  const { timeout = 10000, clearOnFailure = false, keyInfo = null } = options;

  try {
    const remoteModels = await fetchProviderModelsFromRemote(provider, timeout, keyInfo);
    if (remoteModels.length === 0 && (provider.models || []).length > 0) {
      throw new Error('Remote model list is empty');
    }
    provider.models = mergeProviderModelsWithVisibility(provider.models || [], remoteModels);

    return {
      success: true,
      providerId: provider.id,
      providerName: provider.name,
      modelCount: provider.models.length
    };
  } catch (error) {
    console.error(`Error fetching models for provider ${provider.name}:`, error.message);

    if (clearOnFailure) {
      provider.models = [];
    }

    return {
      success: false,
      providerId: provider.id,
      providerName: provider.name,
      error: error.message
    };
  }
}

app.get('/api/providers/:id/models', async (req, res) => {
  const data = await getApiSettings();
  const provider = data.providers.find(p => p.id === req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  try {
    const keyInfo = selectProviderKey(provider, await getUserSettings(), { peek: true });
    const models = await fetchProviderModelsFromRemote(provider, 10000, keyInfo);
    res.json(models);
  } catch (error) {
    console.error('Error fetching models:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/providers/:id/refresh-models', async (req, res) => {
  const data = await getApiSettings();
  const provider = data.providers.find(p => p.id === req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  if (provider.disabled) {
    return res.status(400).json({ error: '该提供商已被禁用，无法刷新模型' });
  }

  const keyInfo = selectProviderKey(provider, await getUserSettings(), { peek: true });
  const result = await refreshSingleProviderModels(provider, {
    timeout: 15000,
    clearOnFailure: false,
    keyInfo
  });

  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }

  saveApiSettingsToDb(data);
  invalidateApiSettingsCache();

  res.json({
    success: true,
    providerId: provider.id,
    providerName: provider.name,
    modelCount: provider.models.length,
    models: provider.models
  });
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
  const userSettings = await getUserSettings();

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

  const refreshResults = await Promise.all(
    activeProviders.map(provider => refreshSingleProviderModels(provider, {
      timeout: 10000,
      clearOnFailure: false,
      keyInfo: selectProviderKey(provider, userSettings, { peek: true })
    }))
  );

  refreshResults.forEach(result => {
    if (result.success) {
      results.success.push({
        providerId: result.providerId,
        providerName: result.providerName,
        modelCount: result.modelCount
      });
      results.successCount++;
    } else {
      results.failed.push({
        providerId: result.providerId,
        providerName: result.providerName,
        error: result.error
      });
      results.failedCount++;
    }
  });

  // 保存更新后的配置
  saveApiSettingsToDb(data);
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
    const keyInfo = selectProviderKey(provider, await getUserSettings(), { peek: true });
    await axios.get(url, {
      headers: buildProviderAuthHeaders(provider, keyInfo),
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
    id: createEntityId(),
    name: name.trim(),
    description: description || '',
    createdAt: new Date().toISOString()
  };
  
  if (!data.groups) {
    data.groups = [];
  }
  
  data.groups.push(newGroup);
  saveApiSettingsToDb(data);
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
  
  saveApiSettingsToDb(data);
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
  saveApiSettingsToDb(data);
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
  saveApiSettingsToDb(data);
  invalidateApiSettingsCache();
  res.json(data.providers[providerIndex]);
});

app.get('/api/conversations', async (req, res) => {
  const conversations = getConversationsFromDb();
  res.json(conversations);
});

app.post('/api/conversations', async (req, res) => {
  const conversation = {
    id: createEntityId(),
    title: '',
    messages: [],
    model: req.body.model || ''
  };
  const savedConversation = saveConversationToDb(conversation);
  res.json(savedConversation || conversation);
});

app.get('/api/conversations/:id', async (req, res) => {
  const conversation = getConversationByIdFromDb(req.params.id);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  res.json(conversation);
});

app.put('/api/conversations/:id', async (req, res) => {
  const conversation = {
    ...req.body,
    id: req.params.id
  };
  const savedConversation = saveConversationToDb(conversation);
  res.json(savedConversation || conversation);
});

app.delete('/api/conversations/:id', async (req, res) => {
  deleteConversationFromDb(req.params.id);
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
      id: createEntityId(),
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
      id: createEntityId(),
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
      id: createEntityId(),
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
      id: createEntityId(),
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

const providerRpmWindow = new Map();

function getProviderRpmLimit(provider) {
  return normalizeProviderRpm(provider?.rpm);
}

function pruneProviderRpmWindow(providerId, now = Date.now()) {
  const stamps = (providerRpmWindow.get(providerId) || []).filter(t => now - t < 60000);
  providerRpmWindow.set(providerId, stamps);
  return stamps;
}


function tryConsumeProviderRpm(provider) {
  const rpm = getProviderRpmLimit(provider);
  if (rpm <= 0 || !provider?.id) return { allowed: true, waitMs: 0 };
  const now = Date.now();
  const stamps = pruneProviderRpmWindow(provider.id, now);
  if (stamps.length >= rpm) {
    return { allowed: false, waitMs: Math.max(0, stamps[0] + 60000 - now) };
  }
  stamps.push(now);
  providerRpmWindow.set(provider.id, stamps);
  return { allowed: true, waitMs: 0 };
}

function recordProviderRpmLimited(provider, errors, providerAttempts, attempt, attemptStartedAt, waitMs, action) {
  const waitSeconds = Math.max(1, Math.ceil((waitMs || 1000) / 1000));
  const errorMessage = `Provider RPM limited (${getProviderRpmLimit(provider)}/min), retry in ${waitSeconds}s`;
  console.log(`[RPM] ${action} ${provider.name}: ${errorMessage}`);
  if (Array.isArray(providerAttempts)) {
    recordProviderAttempt(providerAttempts, {
      attempt: attempt + 1,
      provider,
      status: 'rate_limited',
      statusCode: 429,
      duration: Date.now() - attemptStartedAt,
      error: errorMessage
    });
  }
  errors.push({
    provider: provider.name,
    error: errorMessage,
    status: 429,
    waitMs,
    rateLimited: true
  });
}

function skipProviderForRpm(provider, errors, providerAttempts = null, attempt = 0, attemptStartedAt = Date.now()) {
  const rpmResult = tryConsumeProviderRpm(provider);
  if (rpmResult.allowed) return false;
  recordProviderRpmLimited(provider, errors, providerAttempts, attempt, attemptStartedAt, rpmResult.waitMs, 'Skip');
  return true;
}

function isOnlyRateLimited(errors) {
  return Array.isArray(errors) && errors.length > 0 && errors.every(error => error.rateLimited);
}

function getRateLimitRetryAfterSeconds(errors) {
  const waits = (errors || []).filter(error => error.rateLimited).map(error => Number(error.waitMs) || 0);
  if (waits.length === 0) return 1;
  return Math.max(1, Math.ceil(Math.min(...waits) / 1000));
}

function sendChatRpmDelay(res, waitMs) {
  const delayTime = Math.max(1, Math.ceil(waitMs / 1000));
  return res.json({
    delayed: true,
    delayTime,
    message: `供应商达到 RPM 限制，将在 ${delayTime} 秒后重试`
  });
}

function beginChatSse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getMessagePlainText(message) {
  if (!message) return '';
  if (typeof message === 'string') return message;
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter(part => part && (typeof part === 'string' || typeof part.text === 'string' || part.type === 'text' || part.type === 'input_text' || part.type === 'output_text'))
      .map(part => typeof part === 'string' ? part : (part.text || ''))
      .join('|');
  }
  if (typeof message.text === 'string') return message.text;
  return '';
}

const TOOL_ARTIFACT_TYPES = ['tool_use', 'tool_result', 'tool_call', 'function_call', 'function_call_output', 'input_tool_call'];

function hasToolArtifacts(message) {
  if (!message) return false;
  if (message.role === 'tool' || message.role === 'function') return true;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;
  if (TOOL_ARTIFACT_TYPES.includes(message.type)) {
    return true;
  }
  if (Array.isArray(message.content)) {
    return message.content.some(part => part && TOOL_ARTIFACT_TYPES.includes(part.type));
  }
  return false;
}

function isToolCallingRequest(req) {
  const body = req.body || {};
  if (Array.isArray(body.tools) && body.tools.length > 0) return true;
  if (Array.isArray(body.functions) && body.functions.length > 0) return true;
  const toolChoice = body.tool_choice;
  if (toolChoice && toolChoice !== 'none' && toolChoice.type !== 'none') return true;

  const messageBags = [body.messages, body.input];
  return messageBags.some(messages => Array.isArray(messages) && messages.some(hasToolArtifacts));
}

function requestHasToolHistory(req, messages) {
  if (Array.isArray(messages) && messages.some(hasToolArtifacts)) return true;
  const bags = [req?.body?.messages, req?.body?.input];
  return bags.some(items => Array.isArray(items) && items.some(hasToolArtifacts));
}

function isStickyNewConversation(messages, req = null) {
  if (req?.body?.previous_response_id) return false;
  if (requestHasToolHistory(req, messages)) return false;
  if (!Array.isArray(messages) || messages.length === 0) return true;
  return messages.every(message => message.role === 'user' || message.role === 'system');
}

function getFirstUserFingerprint(messages, modelName) {
  const list = messages || [];
  const firstUser = list.find(message => {
    if (!message) return false;
    if (typeof message === 'string') return true;
    return message.role === 'user';
  }) || list[0];
  return crypto.createHash('md5').update(`${modelName}:${getMessagePlainText(firstUser)}`).digest('hex');
}

function getRequestSessionIdentifier(req, messages, modelName, stickyToolSession) {
  const sessionId = extractSessionId(req);
  if (sessionId) return sessionId;
  const previousResponseId = req?.body?.previous_response_id;
  if (typeof previousResponseId === 'string' && previousResponseId.trim()) {
    return 'resp:' + previousResponseId.trim();
  }
  if (stickyToolSession) {
    const source = Array.isArray(req?.body?.messages) && req.body.messages.length > 0
      ? req.body.messages
      : (Array.isArray(req?.body?.input) && req.body.input.length > 0 ? req.body.input : messages);
    return getFirstUserFingerprint(source, modelName);
  }
  return generateMessageFingerprint(messages, modelName);
}

const RPM_WAIT_MAX_MS = 65000;

async function waitForProviderRpm(provider) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < RPM_WAIT_MAX_MS) {
    const result = tryConsumeProviderRpm(provider);
    if (result.allowed) return { allowed: true, waitMs: 0 };
    const remaining = RPM_WAIT_MAX_MS - (Date.now() - startedAt);
    const waitMs = Math.max(50, Math.min(result.waitMs || 50, remaining));
    if (waitMs <= 0) break;
    console.log(`[RPM] Waiting ${waitMs}ms for provider ${provider.name}`);
    await sleep(waitMs);
  }

  const result = tryConsumeProviderRpm(provider);
  return result.allowed ? { allowed: true, waitMs: 0 } : { allowed: false, waitMs: result.waitMs || 0 };
}

async function resolveProviderRpm(provider, errors, providerAttempts, attempt, attemptStartedAt, { waitIfLimited = false } = {}) {
  if (waitIfLimited) {
    const result = await waitForProviderRpm(provider);
    if (result.allowed) return 'proceed';
    recordProviderRpmLimited(provider, errors, providerAttempts, attempt, attemptStartedAt, result.waitMs, 'Wait exhausted for');
    return 'exhausted';
  }

  if (skipProviderForRpm(provider, errors, providerAttempts, attempt, attemptStartedAt)) {
    return 'skip';
  }
  return 'proceed';
}

function recordMissingProviderKey(provider, errors, providerAttempts, attempt, attemptStartedAt) {
  const errorMessage = 'No available API key';
  console.log(`[错误] 提供商 ${provider.name} 没有可用密钥`);
  if (Array.isArray(providerAttempts)) {
    recordProviderAttempt(providerAttempts, {
      attempt: attempt + 1,
      provider,
      status: 'failed',
      duration: Date.now() - attemptStartedAt,
      error: errorMessage
    });
  }
  errors.push({ provider: provider.name, error: errorMessage });
}

async function prepareStickyProviderAttempt(provider, {
  errors,
  providerAttempts,
  attempt,
  attemptStartedAt,
  waitForRpm,
  boundProvider,
  boundKeyId,
  stickConversation,
  userSettings
}) {
  const usedBoundProvider = !!(boundProvider && provider.id === boundProvider.id);
  const keyOptions = {
    preferredKeyId: usedBoundProvider ? boundKeyId : null,
    stickyKey: usedBoundProvider
  };

  const peekedKey = selectProviderKey(provider, userSettings, { ...keyOptions, peek: true });
  if (!peekedKey?.key?.apiKey) {
    recordMissingProviderKey(provider, errors, providerAttempts, attempt, attemptStartedAt);
    return { rpmDecision: 'skip', keyInfo: null, stickPolicy: null, usedBoundProvider };
  }

  const rpmDecision = await resolveProviderRpm(
    provider,
    errors,
    providerAttempts,
    attempt,
    attemptStartedAt,
    { waitIfLimited: waitForRpm }
  );
  if (rpmDecision !== 'proceed') {
    return { rpmDecision, keyInfo: null, stickPolicy: null, usedBoundProvider };
  }

  const keyInfo = selectProviderKey(provider, userSettings, keyOptions);
  if (!keyInfo?.key?.apiKey) {
    recordMissingProviderKey(provider, errors, providerAttempts, attempt, attemptStartedAt);
    return { rpmDecision: 'skip', keyInfo: null, stickPolicy: null, usedBoundProvider };
  }

  return {
    rpmDecision: 'proceed',
    keyInfo,
    usedBoundProvider,
    stickPolicy: {
      enabled: stickConversation === true,
      usedBoundProvider
    }
  };
}

app.post('/api/chat', async (req, res) => {
  try {
  const { messages, model, params, polling, images, systemPrompt, translateContext } = req.body;
  const settings = await getApiSettings();
  const userSettings = await getUserSettings();

  // 处理提示词变量替换
  let processedSystemPrompt = systemPrompt;
  if (systemPrompt && translateContext) {
    processedSystemPrompt = replacePromptVariables(systemPrompt, translateContext);
  }
  if (polling) {
    const modelName = extractModelName(model);
    console.log(`Polling mode enabled for model: ${modelName}`);
    console.log(`User settings polling config:`, JSON.stringify(userSettings.pollingConfig, null, 2));

    // 获取所有可用的轮询提供商，使用与 /v1 外部接口一致的顺序轮询候选逻辑
    const pollingProviders = limitFailoverProvidersForRequest(
      getFailoverProviders(settings.providers, modelName, userSettings.pollingConfig, userSettings, [], req.apiKeyInfo, { requestedModel: model }),
      userSettings,
      req.apiKeyInfo
    );

    if (pollingProviders.length === 0) {
      console.log(`No polling providers available for model ${modelName}`);
      beginChatSse(res);
      res.write(`data: ${JSON.stringify({ error: `模型 ${modelName} 没有可用的轮询提供商或已被排除` })}\n\n`);
      res.end();
      return;
    }

    console.log(`Found ${pollingProviders.length} available providers for polling`);

    // 收集所有失败的错误信息
    const errors = [];
    let successfulProvider = null;
    let sseStarted = false;
    const providerAttempts = [];
    const pollingStartedAt = Date.now();
    let pollingTokenUsage = null;
    let pollingFirstTokenMs = null;
    let pollingKeyInfo = null;

    // 按照轮询顺序尝试每个提供商
    for (const [attempt, provider] of pollingProviders.entries()) {
      const attemptStartedAt = Date.now();
      const attemptPrepared = await prepareStickyProviderAttempt(provider, {
        errors,
        providerAttempts,
        attempt,
        attemptStartedAt,
        waitForRpm: false,
        boundProvider: null,
        boundKeyId: null,
        stickConversation: false,
        userSettings
      });
      if (attemptPrepared.rpmDecision !== 'proceed') {
        continue;
      }
      const { keyInfo } = attemptPrepared;
      pollingKeyInfo = keyInfo;
      if (!sseStarted) {
        beginChatSse(res);
        sseStarted = true;
      }
      try {
        console.log(`Trying provider ${provider.name} (ID: ${provider.id}) for model ${modelName}`);

        // 获取该提供商的具体模型ID
        const modelId = await getProviderModelId(provider, modelName, keyInfo);
        if (!modelId) {
          console.log(`Model ${modelName} not found in provider ${provider.name}`);
          errors.push({
            provider: provider.name,
            error: `模型 ${modelName} 在提供商中不存在`
          });
          recordProviderAttempt(providerAttempts, {
            attempt: attempt + 1,
            provider,
            status: 'failed',
            duration: Date.now() - attemptStartedAt,
            error: `模型 ${modelName} 在提供商中不存在`
          });
          await incrementModelFailCount(provider.id, modelName, userSettings);
          await incrementKeyFailCount(keyInfo?.key?.id, userSettings);
          continue; // 尝试下一个提供商
        }

        console.log(`Using model ID: ${modelId} from provider ${provider.name}`);

        // 识别模型类型并调用对应的处理函数
        const modelType = getModelType(provider, modelId, userSettings);
        console.log(`[ModelType] Detected model type: ${modelType} for ${modelId}`);

        if (isImageModel(modelType)) {
          // 图像模型
          const hasInputImage = images && images.length > 0;

          // 验证模型能力
          if (hasInputImage && !supportsImageToImage(modelType)) {
            errors.push({
              provider: provider.name,
              error: `模型 ${modelId} 不支持图生图功能（类型：${modelType}）`
            });
            continue;
          }

          if (!hasInputImage && !supportsTextToImage(modelType)) {
            errors.push({
              provider: provider.name,
              error: `模型 ${modelId} 不支持文生图功能（类型：${modelType}），请上传图片进行编辑`
            });
            continue;
          }

          // 提取提示词（最后一条用户消息的内容）
          const lastUserMessage = messages[messages.length - 1];
          const prompt = getMessagePlainText(lastUserMessage);

          if (!prompt) {
            errors.push({
              provider: provider.name,
              error: '生成图片需要提供提示词'
            });
            continue;
          }

          console.log(`[ImageGen] Generating image with prompt: ${prompt.substring(0, 50)}...`);
          if (hasInputImage) {
            console.log(`[ImageGen] Image-to-image mode: ${images.length} input image(s)`);
          }
          await generateImage(provider, prompt, params, res, modelId, keyInfo, images, userSettings);
        } else {
          // 文本模型，使用原有的streamChat
          const streamed = await streamChat(provider, messages, params, res, modelId, images, processedSystemPrompt, keyInfo, {
            skipRequestLog: true,
            isPolling: true
          });
          pollingTokenUsage = streamed?.tokenUsage || null;
          pollingFirstTokenMs = streamed?.firstTokenMs ?? null;
        }

        // 如果成功，重置模型失败计数并保存轮询状态
        await resetModelFailCount(provider.id, modelName, userSettings);
        await resetKeyFailCount(keyInfo?.key?.id, userSettings);

        updatePollingStateAfterSuccess(modelName, provider.id, userSettings.pollingConfig, userSettings);
        await savePollingState(userSettings);

        console.log(`Successfully used provider ${provider.name} for model ${modelName}`);
        successfulProvider = provider;
        recordProviderAttempt(providerAttempts, {
          attempt: attempt + 1,
          provider,
          status: 'success',
          duration: Date.now() - attemptStartedAt,
          firstTokenMs: pollingFirstTokenMs,
          providerModelId: modelId
        });
        break; // 成功，退出循环

      } catch (error) {
        console.error(`Provider ${provider.name} failed:`, error.message);

        // 记录错误信息
        errors.push({
          provider: provider.name,
          error: error.message || 'Unknown error'
        });
        recordProviderAttempt(providerAttempts, {
          attempt: attempt + 1,
          provider,
          status: 'failed',
          duration: Date.now() - attemptStartedAt,
          error: error.message || 'Unknown error'
        });

        // 增加模型失败计数
        await incrementModelFailCount(provider.id, modelName, userSettings);
        await incrementKeyFailCount(keyInfo?.key?.id, userSettings);
        await savePollingState(userSettings);

        if (res.writableEnded) {
          break;
        }
        console.log(`Trying next provider...`);
      }
    }

    // 如果所有提供商都失败了，返回所有错误信息
    if (!successfulProvider) {
      console.error(`All providers failed for model ${modelName}`);

      if (!sseStarted && isOnlyRateLimited(errors)) {
        return sendChatRpmDelay(res, Math.min(...errors.map(error => Number(error.waitMs) || 1000)));
      }
      if (!sseStarted) {
        beginChatSse(res);
      }

      let errorMessage = `所有提供商都失败了 (${errors.length}/${pollingProviders.length}):\n\n`;
      errors.forEach((err, index) => {
        errorMessage += `${index + 1}. ${err.provider}: ${err.error}\n`;
      });

      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
        res.end();
      }
    }

    logChatUiRequest({
      res,
      provider: successfulProvider || pollingProviders[0],
      model: modelName,
      success: !!successfulProvider,
      duration: Date.now() - pollingStartedAt,
      firstTokenMs: pollingFirstTokenMs,
      tokenUsage: pollingTokenUsage,
      errorMessage: successfulProvider ? null : errors.map(item => `${item.provider}: ${item.error}`).join('; '),
      keyInfo: pollingKeyInfo,
      stream: true,
      endpoint: '/api/chat',
      isPolling: true,
      messageCount: Array.isArray(messages) ? messages.length : 0,
      providers: providerAttempts
    });

    return;
  } else {
    const providerSeparator = typeof model === 'string' ? model.indexOf('::') : -1;
    const providerKey = providerSeparator > 0 ? model.slice(0, providerSeparator) : '';
    const modelId = providerSeparator >= 0 ? model.slice(providerSeparator + 2) : model;
    const providerId = getRequestedProviderId(model, settings.providers) || providerKey;
    console.log(`[NonPolling] Received model parameter: ${model}`);
    console.log(`[NonPolling] Extracted providerId: ${providerId}, modelId: ${modelId}`);

    const provider = settings.providers.find(p => p.id === providerId);
    if (!provider) {
      beginChatSse(res);
      res.write(`data: ${JSON.stringify({ error: 'Provider not found' })}\n\n`);
      return res.end();
    }

    try {
      const rpmErrors = [];
      const attemptPrepared = await prepareStickyProviderAttempt(provider, {
        errors: rpmErrors,
        providerAttempts: null,
        attempt: 0,
        attemptStartedAt: Date.now(),
        waitForRpm: false,
        boundProvider: null,
        boundKeyId: null,
        stickConversation: false,
        userSettings
      });
      if (attemptPrepared.rpmDecision !== 'proceed') {
        if (isOnlyRateLimited(rpmErrors)) {
          return sendChatRpmDelay(res, Math.min(...rpmErrors.map(error => Number(error.waitMs) || 1000)));
        }
        beginChatSse(res);
        res.write(`data: ${JSON.stringify({ error: rpmErrors[0]?.error || 'No available API key' })}\n\n`);
        return res.end();
      }
      const { keyInfo } = attemptPrepared;
      beginChatSse(res);
      // 识别模型类型并调用对应的处理函数
      const modelType = getModelType(provider, modelId, userSettings);
      console.log(`[ModelType] Detected model type: ${modelType} for ${modelId}`);

      if (isImageModel(modelType)) {
        // 图像模型
        const hasInputImage = images && images.length > 0;

        // 验证模型能力
        if (hasInputImage && !supportsImageToImage(modelType)) {
          res.write(`data: ${JSON.stringify({ error: `模型 ${modelId} 不支持图生图功能（类型：${modelType}）` })}\n\n`);
          return res.end();
        }

        if (!hasInputImage && !supportsTextToImage(modelType)) {
          res.write(`data: ${JSON.stringify({ error: `模型 ${modelId} 不支持文生图功能（类型：${modelType}），请上传图片进行编辑` })}\n\n`);
          return res.end();
        }

        // 提取提示词（最后一条用户消息的内容）
        const lastUserMessage = messages[messages.length - 1];
        const prompt = getMessagePlainText(lastUserMessage);

        if (!prompt) {
          res.write(`data: ${JSON.stringify({ error: '生成图片需要提供提示词' })}\n\n`);
          return res.end();
        }

        console.log(`[ImageGen] Generating image with prompt: ${prompt.substring(0, 50)}...`);
        if (hasInputImage) {
          console.log(`[ImageGen] Image-to-image mode: ${images.length} input image(s)`);
        }
        await generateImage(provider, prompt, params, res, modelId, keyInfo, images, userSettings);
      } else {
        // 文本模型，使用原有的streamChat
        await streamChat(provider, messages, params, res, modelId, images, processedSystemPrompt, keyInfo);
      }
    } catch (error) {
      console.error(`Chat error:`, error.message);
      // generateImage已经处理了响应，不需要再次写入
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      }
    }
  }
  } catch (error) {
    console.error('Chat error:', error);
    if (res.writableEnded) return;
    if (res.headersSent) {
      try {
        res.write('data: ' + JSON.stringify({ error: error.message || 'Chat failed' }) + '\n\n');
      } catch (_) {}
      return res.end();
    }
    return res.status(500).json({ error: error.message || 'Chat failed' });
  }
});

app.get('/api/settings', async (req, res) => {
  const settings = await getUserSettings();
  res.json(settings);
});

app.put('/api/settings', async (req, res) => {
  const currentSettings = await getUserSettings();
  const requestedPollingMaxRounds = req.body.pollingMaxRounds ?? req.body.pollingMaxRetries;
  const pollingMaxRounds = requestedPollingMaxRounds === undefined
    ? getPollingMaxRounds(currentSettings)
    : getPollingMaxRounds({ pollingMaxRounds: requestedPollingMaxRounds });

  const body = req.body || {};
  const updates = {};
  const coldKeys = [
    'defaultModel',
    'defaultPromptId',
    'defaultStyle',
    'defaultApiStyle',
    'translateDefaultModel',
    'translateDefaultPromptId',
    'translatePollingEnabled',
    'quickTranslations',
    'modelTypes'
  ];

  if (body.defaultParams !== undefined) {
    updates.defaultParams = {
      ...(currentSettings.defaultParams || {}),
      ...body.defaultParams
    };
  }

  if (body.pollingConfig !== undefined) {
    updates.pollingConfig = {
      ...(currentSettings.pollingConfig || {}),
      ...body.pollingConfig
    };
  }

  coldKeys.forEach((key) => {
    if (body[key] !== undefined) {
      updates[key] = body[key];
    }
  });

  if (requestedPollingMaxRounds !== undefined) {
    updates.pollingMaxRounds = pollingMaxRounds;
  }

  saveColdUserSettingsToDb(updates);
  Object.assign(currentSettings, updates);
  userSettingsCache = currentSettings;
  userSettingsCacheTime = Date.now();
  res.json(currentSettings);
});

app.post('/api/polling/reset-position', async (req, res) => {
  const modelName = String(req.body?.modelName || '').trim();

  if (!modelName) {
    return res.status(400).json({ error: 'modelName is required' });
  }

  const userSettings = await getUserSettings();
  const pollingState = userSettings.pollingState || {};

  pollingState[modelName] = {
    currentIndex: 0,
    usedInCurrentRound: [],
    lastResetAt: new Date().toISOString()
  };

  userSettings.pollingState = pollingState;
  saveHotUserStateToDb(userSettings);

  res.json({
    success: true,
    modelName,
    state: userSettings.pollingState?.[modelName] || pollingState[modelName]
  });
});

app.post('/api/polling/reenable-model', async (req, res) => {
  const providerId = String(req.body?.providerId || '').trim();
  const modelName = String(req.body?.modelName || '').trim();

  if (!providerId || !modelName) {
    return res.status(400).json({ error: 'providerId and modelName are required' });
  }

  const userSettings = await getUserSettings();
  if (userSettings.disabledModels?.[providerId]) {
    userSettings.disabledModels[providerId] = userSettings.disabledModels[providerId].filter(name => name !== modelName);
    if (userSettings.disabledModels[providerId].length === 0) {
      delete userSettings.disabledModels[providerId];
    }
  }

  const failCountKey = `${providerId}:${modelName}`;
  if (userSettings.modelFailCounts) {
    userSettings.modelFailCounts[failCountKey] = 0;
  }

  saveHotUserStateToDb(userSettings);
  res.json({ success: true, providerId, modelName });
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

  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new Error('Provider baseUrl is required');
  }
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

function extractModelsFromRemoteResponse(payload) {
  const raw = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.models) ? payload.models : []));

  return raw
    .map(model => {
      if (typeof model === 'string') return { id: model };
      if (model && typeof model === 'object' && (model.id || model.name)) {
        return { ...model, id: model.id || model.name };
      }
      return null;
    })
    .filter(Boolean);
}

function buildProviderAuthHeaders(provider, keyInfo, req = null) {
  if (getProviderChatApiType(provider) === 'anthropic') {
    return buildAnthropicProxyHeaders(provider, keyInfo, req || { headers: {} });
  }
  const apiKey = keyInfo?.key?.apiKey || provider.apiKey;
  return { Authorization: `Bearer ${apiKey}` };
}

function estimateTokenCount(text) {
  if (!text) return 0
  const normalized = String(text)
  return Math.max(1, Math.ceil(normalized.length / 4))
}

function extractTextFromMessageContent(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part
        if (part?.type === 'text') return part.text || ''
        if (part?.type === 'input_text') return part.text || ''
        if (part?.type === 'output_text') return part.text || ''
        return ''
      })
      .join('\n')
  }
  return ''
}

function estimateTokenUsageFromMessages(messages, completionText = '') {
  const promptText = (messages || [])
    .map(msg => extractTextFromMessageContent(msg.content))
    .join('\n')

  const promptTokens = estimateTokenCount(promptText)
  const completionTokens = estimateTokenCount(completionText)

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimated: true
  }
}

function convertImageUrlToAnthropic(url) {
  if (!url || typeof url !== 'string') return null;
  const dataUrl = url.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (dataUrl) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: dataUrl[1] || 'image/png', data: dataUrl[2] }
    };
  }
  return {
    type: 'image',
    source: { type: 'url', url }
  };
}

function convertContentPartToAnthropic(part) {
  if (part == null) return null;
  if (typeof part === 'string') {
    return part ? { type: 'text', text: part } : null;
  }
  if (typeof part !== 'object') return null;
  if (part.type === 'text' || part.type === 'input_text' || part.type === 'output_text') {
    return { type: 'text', text: part.text || '' };
  }
  if (part.type === 'image_url' || part.type === 'input_image' || part.type === 'image') {
    if (part.source && part.source.type) return { type: 'image', source: part.source };
    const url = part.image_url?.url || part.image_url || part.url;
    return convertImageUrlToAnthropic(url);
  }
  if (part.type === 'tool_use' || part.type === 'tool_result') return part;
  return null;
}

function normalizeAnthropicContent(content) {
  if (content == null || content === '') return [];
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) {
    const part = convertContentPartToAnthropic(content);
    return part ? [part] : [];
  }
  return content.map(convertContentPartToAnthropic).filter(Boolean);
}

function appendAnthropicMessage(messages, role, content) {
  const parts = Array.isArray(content) ? content : normalizeAnthropicContent(content);
  if (parts.length === 0) return;
  const last = messages[messages.length - 1];
  if (last && last.role === role) {
    const prev = Array.isArray(last.content) ? last.content : normalizeAnthropicContent(last.content);
    last.content = prev.concat(parts);
    return;
  }
  messages.push({ role, content: parts });
}

function convertOpenAIMessagesToAnthropic(messages) {
  const converted = [];
  const systemParts = [];

  for (const message of messages || []) {
    if (!message) continue;
    if (message.role === 'system') {
      const text = getMessagePlainText(message);
      if (text) systemParts.push(text);
      continue;
    }

    if (message.role === 'tool' || message.role === 'function') {
      appendAnthropicMessage(converted, 'user', [{
        type: 'tool_result',
        tool_use_id: message.tool_call_id || message.id,
        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '')
      }]);
      continue;
    }

    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const content = normalizeAnthropicContent(message.content);
      for (const toolCall of message.tool_calls) {
        let input = {};
        const raw = toolCall.function?.arguments ?? toolCall.arguments;
        if (typeof raw === 'string' && raw.trim()) {
          try { input = JSON.parse(raw); } catch { input = { _raw: raw }; }
        } else if (raw && typeof raw === 'object') {
          input = raw;
        }
        content.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function?.name || toolCall.name || 'tool',
          input
        });
      }
      appendAnthropicMessage(converted, 'assistant', content);
      continue;
    }

    const role = message.role === 'assistant' ? 'assistant' : 'user';
    appendAnthropicMessage(converted, role, normalizeAnthropicContent(message.content));
  }

  return {
    messages: converted,
    system: systemParts.join('\n')
  };
}

function convertOpenAIToolsToAnthropic(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => {
    if (!tool || typeof tool !== 'object') return null;
    if (typeof tool.name === 'string' && !tool.function) {
      return {
        name: tool.name,
        description: tool.description || '',
        input_schema: tool.input_schema || tool.inputSchema || { type: 'object', properties: {} }
      };
    }
    const fn = tool.function || {};
    const name = fn.name || tool.name;
    if (!name) return null;
    return {
      name,
      description: fn.description || tool.description || '',
      input_schema: fn.parameters || tool.parameters || { type: 'object', properties: {} }
    };
  }).filter(Boolean);
}

function buildChatRequestBody(modelId, messages, params, apiType = 'openai', images = null, systemPrompt = null, tools = null, toolChoice = null) {
  log.verbose(`[DEBUG] buildChatRequestBody: modelId=${modelId}, apiType=${apiType}, messages=${messages.length}, images=${images ? images.length : 'none'}, systemPrompt=${systemPrompt ? 'yes' : 'no'}, tools=${tools ? tools.length : 'none'}`);

  // Process image message format
  let processedMessages = messages;
  if (images && images.length > 0) {
    log.verbose(`[DEBUG] Processing ${images.length} images`);
    processedMessages = [...messages];
    const lastUserMessageIndex = processedMessages.length - 1;
    if (lastUserMessageIndex >= 0 && processedMessages[lastUserMessageIndex].role === 'user') {
      const lastUserMessage = processedMessages[lastUserMessageIndex];
      const text = typeof lastUserMessage.content === 'string'
        ? lastUserMessage.content
        : getMessagePlainText(lastUserMessage);
      const content = [
        { type: 'text', text: text || '' }
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
    const converted = convertOpenAIMessagesToAnthropic(processedMessages);
    const requestBody = {
      ...params,
      model: modelId,
      messages: converted.messages
    };

    const systemText = [converted.system, systemPrompt].filter(value => value && String(value).trim()).join('\n');
    if (systemText) {
      requestBody.system = systemText.trim();
      log.verbose(`[DEBUG] Added system prompt to Anthropic request`);
    }

    // Anthropic API requires max_tokens parameter
    if (!requestBody.max_tokens) {
      requestBody.max_tokens = params.max_tokens || 4096;
      log.verbose(`[DEBUG] Added default max_tokens: ${requestBody.max_tokens}`);
    }

    // Convert OpenAI tool format to Anthropic tool format
    if (tools && tools.length > 0) {
      requestBody.tools = convertOpenAIToolsToAnthropic(tools);
      log.verbose(`[DEBUG] Converted ${tools.length} tools to Anthropic format`);

      // Handle tool_choice for Anthropic
      if (toolChoice) {
        if (toolChoice === 'auto') {
          requestBody.tool_choice = { type: 'auto' };
        } else if (toolChoice === 'none') {
          delete requestBody.tools; // Anthropic doesn't support explicit "none"
        } else if (typeof toolChoice === 'object') {
          const toolName = toolChoice.function?.name || toolChoice.name;
          if (toolName) {
            requestBody.tool_choice = { type: 'tool', name: toolName };
          }
        }
      }
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
      ...params,
      model: modelId,
      messages: finalMessages
    };

    // Add tools for OpenAI compatible APIs
    if (tools && tools.length > 0) {
      // 清理工具定义，只移除 strict 和 additionalProperties 字段
      requestBody.tools = tools.map(tool => {
        const cleanTool = JSON.parse(JSON.stringify(tool)); // 深拷贝

        // 递归移除 strict 和 additionalProperties 字段
        const removeIncompatibleFields = (obj) => {
          if (typeof obj !== 'object' || obj === null) return;

          if (Array.isArray(obj)) {
            obj.forEach(item => removeIncompatibleFields(item));
          } else {
            // 删除不兼容的字段
            delete obj.strict;
            delete obj.additionalProperties;

            // 递归处理子对象
            Object.values(obj).forEach(value => {
              if (typeof value === 'object' && value !== null) {
                removeIncompatibleFields(value);
              }
            });
          }
        };

        removeIncompatibleFields(cleanTool);
        return cleanTool;
      });

      log.verbose(`[DEBUG] Added ${tools.length} tools to request (removed strict/additionalProperties)`);

      if (toolChoice) {
        requestBody.tool_choice = toolChoice;
        log.verbose(`[DEBUG] Added tool_choice: ${JSON.stringify(toolChoice)}`);
      }
    }

    log.verbose(`[DEBUG] Final OpenAI request body created`);
    return ensureStreamUsageOption(requestBody, 'openai');
  }
}

function normalizeResponsesContent(content) {
  if (content === undefined || content === null) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return content

  const normalized = content
    .map(part => {
      if (typeof part === 'string') {
        return { type: 'text', text: part }
      }

      if (part?.type === 'text') {
        return { type: 'text', text: part.text || '' }
      }

      if (part?.type === 'input_text' || part?.type === 'output_text') {
        return { type: 'text', text: part.text || '' }
      }

      if (part?.type === 'image_url') {
        return part
      }

      if (part?.type === 'input_image') {
        const url = part.image_url?.url || part.image_url || part.url
        if (!url) return null
        return {
          type: 'image_url',
          image_url: { url }
        }
      }

      return null
    })
    .filter(Boolean)

  if (normalized.length === 0) return ''
  return normalized
}

function isResponsesInputItem(item) {
  if (!item || typeof item !== 'object') return false
  if (item.role) return true
  return item.type === 'message'
    || item.type === 'function_call'
    || item.type === 'function_call_output'
    || item.type === 'tool_call'
    || item.type === 'tool_result'
    || item.type === 'input_tool_call'
}

function convertResponsesToolCall(item) {
  const rawArgs = item.arguments ?? item.function?.arguments ?? ''
  return {
    id: item.call_id || item.id,
    type: 'function',
    function: {
      name: item.name || item.function?.name || 'tool',
      arguments: typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs || {})
    }
  }
}

function convertResponsesItemsToMessages(items) {
  const messages = []
  for (const item of items) {
    if (typeof item === 'string') {
      messages.push({ role: 'user', content: item })
      continue
    }
    if (!item || typeof item !== 'object') continue

    if (item.type === 'function_call' || item.type === 'tool_call' || item.type === 'input_tool_call') {
      const toolCall = convertResponsesToolCall(item)
      const last = messages[messages.length - 1]
      if (last && last.role === 'assistant' && Array.isArray(last.tool_calls)) {
        last.tool_calls.push(toolCall)
      } else {
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [toolCall]
        })
      }
      continue
    }

    if (item.type === 'function_call_output' || item.type === 'tool_result' || item.role === 'tool') {
      const output = item.output ?? item.content ?? ''
      messages.push({
        role: 'tool',
        tool_call_id: item.call_id || item.tool_call_id || item.id,
        content: typeof output === 'string' ? output : JSON.stringify(output)
      })
      continue
    }

    if (item.role || item.type === 'message') {
      messages.push({
        role: item.role || 'user',
        content: normalizeResponsesContent(item.content ?? item.input ?? item.text ?? '')
      })
      continue
    }

    if (item.type) {
      messages.push({ role: 'user', content: normalizeResponsesContent([item]) })
    }
  }
  return messages
}

function responsesInputToMessages(input) {
  if (input === undefined || input === null) return []

  if (typeof input === 'string') {
    return [{ role: 'user', content: input }]
  }

  if (Array.isArray(input)) {
    if (input.length === 0) return []
    if (input.some(isResponsesInputItem)) {
      return convertResponsesItemsToMessages(input)
    }
    return [{ role: 'user', content: normalizeResponsesContent(input) }]
  }

  if (typeof input === 'object') {
    if (isResponsesInputItem(input)) {
      return convertResponsesItemsToMessages([input])
    }
    if (input.type) {
      return [{ role: 'user', content: normalizeResponsesContent([input]) }]
    }
  }

  return [{ role: 'user', content: String(input) }]
}

const RESPONSES_ONLY_BODY_KEYS = new Set([
  'previous_response_id',
  'include',
  'store',
  'truncation',
  'reasoning',
  'text',
  'max_tool_calls',
  'background',
  'conversation',
  'prompt',
  'instructions',
  'input',
  'max_output_tokens',
  'service_tier'
])

function pickChatParamsFromResponsesExtras(otherParams) {
  const requestParams = {}
  for (const [key, value] of Object.entries(otherParams || {})) {
    if (RESPONSES_ONLY_BODY_KEYS.has(key)) continue
    requestParams[key] = value
  }
  return requestParams
}

function buildResponsesFromChatCompletion(completion, modelOverride = null) {
  const created = completion?.created || Math.floor(Date.now() / 1000)
  const model = completion?.model || modelOverride || 'unknown'
  const responseIdBase = completion?.id || `${created}-${Math.floor(Math.random() * 100000)}`
  const responseId = responseIdBase.startsWith('resp_') ? responseIdBase : `resp_${responseIdBase}`

  const output = []
  const choice = completion?.choices?.[0] || {}
  const message = choice.message || {}
  const textContent = extractTextFromMessageContent(message.content)

  if (textContent) {
    output.push({
      id: `msg_${responseId}`,
      type: 'message',
      role: message.role || 'assistant',
      content: [{ type: 'output_text', text: textContent }]
    })
  }

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    message.tool_calls.forEach((toolCall, index) => {
      const callId = toolCall.id || `call_${responseId}_${index}`
      output.push({
        id: callId.startsWith('fc_') ? callId : `fc_${callId}`,
        type: 'function_call',
        call_id: callId,
        name: toolCall.function?.name || toolCall.name || 'tool',
        arguments: toolCall.function?.arguments || toolCall.arguments || ''
      })
    })
  }

  const usage = completion?.usage
    ? {
        input_tokens: completion.usage.prompt_tokens ?? null,
        output_tokens: completion.usage.completion_tokens ?? null,
        total_tokens: completion.usage.total_tokens ?? null
      }
    : undefined

  return {
    id: responseId,
    object: 'response',
    created,
    model,
    status: 'completed',
    output,
    usage
  }
}

function writeSseEvent(res, payload, eventName = null) {
  if (res.writableEnded) return;
  if (eventName) res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function collectToolCallDelta(toolCalls, deltaToolCalls) {
  for (const part of deltaToolCalls || []) {
    const rawIndex = Number(part.index);
    const index = Number.isInteger(rawIndex) ? rawIndex : toolCalls.length;
    if (!toolCalls[index]) {
      toolCalls[index] = {
        id: part.id || `call_${index}`,
        type: 'function',
        function: { name: part.function?.name || part.name || 'tool', arguments: '' }
      };
    }
    if (part.id) toolCalls[index].id = part.id;
    if (part.function?.name) toolCalls[index].function.name = part.function.name;
    if (typeof part.function?.arguments === 'string') {
      toolCalls[index].function.arguments += part.function.arguments;
    }
  }
}

async function streamChatCompletionAsResponses(upstream, res, req, { requestMessages, modelId, startedAt = Date.now() }) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const created = Math.floor(Date.now() / 1000);
  const responseId = `resp_${created}_${crypto.randomBytes(4).toString('hex')}`;
  const outputItemId = `msg_${responseId}`;
  let text = '';
  const toolCalls = [];
  let usage = null;
  let finishReason = 'stop';
  let buffer = '';
  let firstTokenMs = null;
  const markFirstToken = () => {
    if (firstTokenMs != null) return;
    firstTokenMs = finiteNonNegativeMs(Date.now() - startedAt);
  };

  writeSseEvent(res, {
    type: 'response.created',
    response: {
      id: responseId,
      object: 'response',
      created,
      model: modelId,
      status: 'in_progress',
      output: []
    }
  }, 'response.created');

  const stopUpstream = () => {
    if (upstream.data && !upstream.data.destroyed) upstream.data.destroy();
    if (upstream.raw && !upstream.raw.destroyed) upstream.raw.destroy();
  };
  bindClientDisconnect(req, res, stopUpstream);

  await new Promise((resolve, reject) => {
    const consumeSseLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') return;
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      if (parsed.usage) usage = parsed.usage;
      const choice = parsed.choices?.[0];
      if (!choice) return;
      const delta = choice.delta || {};
      if (typeof delta.content === 'string' && delta.content) {
        markFirstToken();
        text += delta.content;
        writeSseEvent(res, {
          type: 'response.output_text.delta',
          item_id: outputItemId,
          delta: delta.content
        }, 'response.output_text.delta');
      }
      if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
        markFirstToken();
        collectToolCallDelta(toolCalls, delta.tool_calls);
        for (const part of delta.tool_calls) {
          if (typeof part.function?.arguments === 'string' && part.function.arguments) {
            writeSseEvent(res, {
              type: 'response.function_call_arguments.delta',
              delta: part.function.arguments,
              item_id: part.id || toolCalls[part.index]?.id
            }, 'response.function_call_arguments.delta');
          }
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    };

    upstream.data.on('data', (chunk) => {
      if (res.writableEnded) return;
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        consumeSseLine(line);
      }
    });
    upstream.data.on('end', () => {
      if (buffer.trim()) consumeSseLine(buffer);
      resolve();
    });
    upstream.data.on('error', (error) => {
      if (!res.writableEnded) {
        writeSseEvent(res, {
          type: 'error',
          error: { message: error.message || 'Upstream stream error' }
        }, 'error');
        res.end();
      }
      reject(error);
    });
  });

  const compactToolCalls = toolCalls.filter(Boolean);
  const jsonData = {
    id: `chatcmpl-${responseId}`,
    created,
    model: modelId,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: compactToolCalls.length > 0 ? (text || null) : text,
        ...(compactToolCalls.length > 0 ? { tool_calls: compactToolCalls } : {})
      },
      finish_reason: compactToolCalls.length > 0 ? 'tool_calls' : (finishReason || 'stop')
    }],
    usage
  };
  const responsePayload = buildResponsesFromChatCompletion(jsonData, modelId);
  responsePayload.id = responseId;
  const assistantMessage = completionMessageFromChat(jsonData);
  if (assistantMessage) {
    saveResponseState(responseId, [...requestMessages, assistantMessage]);
  }
  writeSseEvent(res, { type: 'response.completed', response: responsePayload }, 'response.completed');
  if (!res.writableEnded) {
    res.write('data: [DONE]\n\n');
    res.end();
  }
  return { jsonData, responsePayload, firstTokenMs };
}

function extractModelName(modelId) {
  if (!modelId || typeof modelId !== 'string') return '';
  const separator = modelId.indexOf('::');
  if (separator >= 0) {
    return normalizeModelName(modelId.slice(separator + 2));
  }
  return normalizeModelName(modelId);
}

function getProviderDisplayName(provider) {
  const name = String(provider?.name || '').trim();
  return name || provider?.id || 'unknown';
}

function getExposedProviderPrefix(provider, providers = []) {
  const name = String(provider?.name || '').trim();
  if (!name) return provider.id;
  const collisions = (providers || []).filter(item => String(item?.name || '').trim() === name);
  return collisions.length > 1 ? provider.id : name;
}

function buildExposedModelId(provider, modelId, providers = []) {
  return `${getExposedProviderPrefix(provider, providers)}::${modelId}`;
}

function chooseExposedModelIds(availableModelsWithProvider, apiKeyInfo = null) {
  if (!Array.isArray(availableModelsWithProvider) || availableModelsWithProvider.length === 0) {
    return [];
  }
  if (!isAgentClientKey(apiKeyInfo)) {
    return availableModelsWithProvider.map(item => item.id);
  }
  const counts = new Map();
  for (const item of availableModelsWithProvider) {
    counts.set(item.modelId, (counts.get(item.modelId) || 0) + 1);
  }
  return Array.from(new Set(availableModelsWithProvider.map(item => (
    counts.get(item.modelId) > 1 ? item.id : item.modelId
  ))));
}

function getRequestedProviderId(requestedModel, providers) {
  if (typeof requestedModel !== 'string') return null;
  const separator = requestedModel.indexOf('::');
  if (separator <= 0) return null;
  const providerKey = requestedModel.slice(0, separator);
  if (!providerKey) return null;
  if (!Array.isArray(providers) || providers.length === 0) return providerKey;

  const byId = providers.find(provider => provider.id === providerKey);
  if (byId) return byId.id;

  const name = providerKey.trim();
  const matches = providers.filter(provider => String(provider?.name || '').trim() === name);
  return matches.length === 1 ? matches[0].id : null;
}

function getPollingExcludedProviderIds(modelName, pollingConfig) {
  const excludedSet = new Set();
  const excluded = pollingConfig?.excluded;
  if (Array.isArray(excluded)) {
    excluded.forEach(item => {
      if (item && item.modelName === modelName && item.providerId) {
        excludedSet.add(item.providerId);
      }
    });
  } else if (excluded && typeof excluded === 'object') {
    const providerIds = excluded[modelName];
    if (Array.isArray(providerIds)) {
      providerIds.forEach(id => excludedSet.add(id));
    }
  }
  return excludedSet;
}

function providerHasVisibleModel(provider, modelName) {
  return !!provider?.models?.some(model => normalizeModelName(model.id) === modelName && model.visible !== false);
}

function providerAllowedByScope(provider, apiKeyInfo, usePolling) {
  if (!provider) return false;
  const allowedGroups = usePolling
    ? (apiKeyInfo?.allowedPollingGroups || [])
    : (apiKeyInfo?.allowedGroups || []);
  const allowedProviders = usePolling
    ? (apiKeyInfo?.allowedPollingProviders || [])
    : (apiKeyInfo?.allowedProviders || []);
  const hasGroupLimit = allowedGroups.length > 0;
  const hasProviderLimit = allowedProviders.length > 0;
  if (!hasGroupLimit && !hasProviderLimit) return true;
  const providerGroupId = provider.groupId || 'default';
  const groupMatch = hasGroupLimit && allowedGroups.includes(providerGroupId);
  const providerMatch = hasProviderLimit && allowedProviders.includes(provider.id);
  return groupMatch || providerMatch;
}

function isProviderEligibleForModel(provider, modelName, userSettings, apiKeyInfo, options = {}) {
  if (!provider || provider.disabled) return false;
  if (!providerMatchesClientTag(provider, apiKeyInfo)) return false;
  if (typeof options.providerFilter === 'function' && !options.providerFilter(provider)) return false;
  if (isModelDisabledForProvider(modelName, provider.id, userSettings)) return false;
  if (!providerHasVisibleModel(provider, modelName)) return false;
  const usePolling = options.usePolling !== undefined ? options.usePolling : shouldUsePolling(apiKeyInfo);
  return providerAllowedByScope(provider, apiKeyInfo, usePolling);
}

function getScopedPollingProviderIds(modelName, providers, pollingConfig, apiKeyInfo, userSettings = null, options = {}) {
  const availableProviderIds = pollingConfig?.available?.[modelName] || [];
  const excludedSet = getPollingExcludedProviderIds(modelName, pollingConfig);
  const providerById = new Map((providers || []).map(provider => [provider.id, provider]));
  const providerFilter = typeof options.providerFilter === 'function' ? options.providerFilter : null;

  return availableProviderIds.filter(id => {
    if (excludedSet.has(id)) return false;
    return isProviderEligibleForModel(providerById.get(id), modelName, userSettings, apiKeyInfo, {
      usePolling: true,
      providerFilter
    });
  });
}

function nonPollingModelAvailable(requestedModel, pureModelName, providers, apiKeyInfo, userSettings = null, options = {}) {
  const requestedProviderId = getRequestedProviderId(requestedModel, providers);
  return (providers || []).some(provider => {
    if (requestedProviderId && provider.id !== requestedProviderId) return false;
    return isProviderEligibleForModel(provider, pureModelName, userSettings, apiKeyInfo, {
      usePolling: false,
      providerFilter: options.providerFilter
    });
  });
}

function isModelAllowedByApiKey(requestedModel, pureModelName, apiKeyInfo, usePolling, providers = []) {
  const allowedModels = apiKeyInfo?.allowedModels || [];
  if (!Array.isArray(allowedModels) || allowedModels.length === 0) return true;
  if (allowedModels.includes(requestedModel) || allowedModels.includes(pureModelName)) return true;

  if (usePolling) {
    const normalizedAllowed = allowedModels.map(name => extractModelName(name));
    return normalizedAllowed.includes(pureModelName);
  }

  const requestedProviderId = getRequestedProviderId(requestedModel, providers);
  return allowedModels.some(allowed => {
    if (typeof allowed !== 'string') return false;
    if (extractModelName(allowed) !== pureModelName) return false;
    if (!allowed.includes('::')) return true;
    const allowedProviderId = getRequestedProviderId(allowed, providers);
    if (!requestedProviderId || !allowedProviderId) return true;
    return requestedProviderId === allowedProviderId;
  });
}

function getProxyModelAccessDenial(requestedModel, pureModelName, providers, pollingConfig, apiKeyInfo, userSettings = null, options = {}) {
  const usePolling = shouldUsePolling(apiKeyInfo);
  if (!isModelAllowedByApiKey(requestedModel, pureModelName, apiKeyInfo, usePolling, providers)) {
    const allowedModels = apiKeyInfo?.allowedModels || [];
    return {
      status: 403,
      code: 'model_not_allowed',
      type: 'permission_error',
      message: allowedModels.length > 0
        ? `Model '${requestedModel}' is not allowed for this API key. Allowed models: ${allowedModels.join(', ')}`
        : `Model '${requestedModel}' is not allowed for this API key.`
    };
  }
  if (usePolling) {
    if (getScopedPollingProviderIds(pureModelName, providers, pollingConfig, apiKeyInfo, userSettings, options).length === 0) {
      return {
        status: 400,
        code: 'all_providers_excluded',
        type: 'invalid_request_error',
        message: `Model '${pureModelName}' has no available providers within API key polling scope.`
      };
    }
  } else if (!nonPollingModelAvailable(requestedModel, pureModelName, providers, apiKeyInfo, userSettings, options)) {
    return {
      status: 400,
      code: 'model_not_available',
      type: 'invalid_request_error',
      message: `Model '${pureModelName}' is not available in the allowed provider scope.`
    };
  }
  return null;
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
        .filter(part => part.type === 'text' || part.type === 'input_text' || part.type === 'output_text')
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
        .filter(part => part.type === 'text' || part.type === 'input_text' || part.type === 'output_text')
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

  const metadataUserId = req.body?.metadata?.user_id;
  if (metadataUserId && typeof metadataUserId === 'string') {
    console.log(`[Session] Found session ID in metadata.user_id: ${metadataUserId}`);
    return metadataUserId;
  }
  
  return null;
}

// 获取或创建会话的提供商绑定
function getConversationProvider(sessionIdentifier, modelName, userSettings, providers, pollingConfig, apiKeyInfo = null) {
  if (!userSettings.conversationProviderMap) {
    userSettings.conversationProviderMap = {};
  }

  const usePolling = shouldUsePolling(apiKeyInfo);
  const key = getConversationMapKey(modelName, sessionIdentifier, apiKeyInfo);
  const mapping = userSettings.conversationProviderMap[key];
  if (!mapping) return null;

  const provider = providers.find(p => p.id === mapping.providerId);
  if (!provider) {
    console.log(`[Session] Mapped provider ${mapping.providerId} is no longer available, will select new provider`);
    return null;
  }

  if (usePolling) {
    const available = pollingConfig?.available?.[modelName] || [];
    const excludedSet = getPollingExcludedProviderIds(modelName, pollingConfig);
    if (!available.includes(mapping.providerId) || excludedSet.has(mapping.providerId)) {
      console.log(`[Session] Provider ${mapping.providerId} is no longer available in polling pool for ${modelName}, will select new provider`);
      return null;
    }
  }

  if (!isProviderEligibleForModel(provider, modelName, userSettings, apiKeyInfo, { usePolling })) {
    console.log(`[Session] Provider ${provider.name} is no longer eligible for ${modelName}, will select new provider`);
    return null;
  }

  console.log(`[Session] Using existing provider ${provider.name} for conversation ${key}`);
  return provider;
}

function getConversationMapKey(modelName, sessionIdentifier, apiKeyInfo = null) {
  const usePolling = shouldUsePolling(apiKeyInfo);
  const keyMode = usePolling ? 'polling' : 'single';
  return `${keyMode}:${modelName}:${sessionIdentifier}`;
}

function getConversationBinding(sessionIdentifier, modelName, userSettings, providers, pollingConfig, apiKeyInfo = null) {
  const provider = getConversationProvider(sessionIdentifier, modelName, userSettings, providers, pollingConfig, apiKeyInfo);
  if (!provider) return null;
  const mapping = userSettings.conversationProviderMap?.[getConversationMapKey(modelName, sessionIdentifier, apiKeyInfo)];
  return {
    provider,
    keyId: mapping?.keyId || null
  };
}

function clearConversationBinding(sessionIdentifier, modelName, userSettings, apiKeyInfo = null) {
  if (!userSettings.conversationProviderMap || !sessionIdentifier) return;
  const key = getConversationMapKey(modelName, sessionIdentifier, apiKeyInfo);
  if (userSettings.conversationProviderMap[key]) {
    console.log(`[会话] 检测到新对话，删除旧的提供商绑定`);
    delete userSettings.conversationProviderMap[key];
  }
}

function resolveConversationStickState(req, messages, modelName, userSettings, providers, pollingConfig) {
  const usePolling = shouldUsePolling(req.apiKeyInfo);
  const waitForRpm = isAgentClientKey(req.apiKeyInfo) || isToolCallingRequest(req) || !!req?.body?.previous_response_id;
  const stickConversation = waitForRpm || !usePolling;
  const sessionIdentifier = getRequestSessionIdentifier(req, messages, modelName, waitForRpm);
  const isNewConversation = waitForRpm
    ? isStickyNewConversation(messages, req)
    : (Array.isArray(messages) && messages.length === 1 && messages[0]?.role === 'user');

  let boundProvider = null;
  let boundKeyId = null;

  if (sessionIdentifier && stickConversation) {
    if (isNewConversation) {
      clearConversationBinding(sessionIdentifier, modelName, userSettings, req.apiKeyInfo);
    } else {
      const binding = getConversationBinding(sessionIdentifier, modelName, userSettings, providers, pollingConfig, req.apiKeyInfo);
      if (binding?.provider) {
        boundProvider = binding.provider;
        boundKeyId = binding.keyId || null;
      }
    }
  }

  console.log(`[会话] Tool calling: ${waitForRpm}, Stick: ${stickConversation}, New: ${isNewConversation}`);
  console.log(`[会话] 使用的标识符: ${sessionIdentifier ? sessionIdentifier.substring(0, 16) + '...' : '无'}`);
  if (boundProvider) {
    console.log(`[会话] 找到已绑定的提供商: ${boundProvider.name} (ID: ${boundProvider.id})${boundKeyId ? `, key: ${boundKeyId}` : ''}`);
  } else if (stickConversation && sessionIdentifier && !isNewConversation) {
    console.log(`[会话] 未找到已绑定的提供商，将选择新的提供商`);
  }

  return {
    waitForRpm,
    stickConversation,
    sessionIdentifier,
    isNewConversation,
    boundProvider,
    boundKeyId
  };
}

function buildStickyFailoverProviders({
  boundProvider,
  waitForRpm = false,
  providers,
  modelName,
  pollingConfig,
  userSettings,
  apiKeyInfo,
  failoverOptions
} = {}) {
  const providerFilter = failoverOptions?.providerFilter;
  const bound = boundProvider && (!providerFilter || providerFilter(boundProvider))
    ? boundProvider
    : null;
  const excludeIds = bound ? [bound.id] : [];
  const others = getFailoverProviders(
    providers,
    modelName,
    pollingConfig,
    userSettings,
    excludeIds,
    apiKeyInfo,
    {
      ...failoverOptions,
      requestedModel: failoverOptions?.requestedModel,
      reservePolling: (bound || waitForRpm) ? false : failoverOptions?.reservePolling
    }
  );
  if (isAgentClientKey(apiKeyInfo)) {
    if (bound) return [bound];
    return others.slice(0, 1);
  }
  const list = bound ? [bound, ...others] : others;
  return limitFailoverProvidersForRequest(list, userSettings, apiKeyInfo);
}

const VALID_CLIENT_TAGS = ['normal', 'codex', 'claude', 'openclaw'];
const AGENT_CLIENT_TAGS = ['codex', 'claude', 'openclaw'];

function normalizeProviderClientTags(tags) {
  const source = tags && typeof tags === 'object' ? tags : {};
  const normalized = {
    normal: source.normal === true,
    codex: source.codex === true,
    claude: source.claude === true,
    openclaw: source.openclaw === true
  };

  if (!normalized.normal && !normalized.codex && !normalized.claude && !normalized.openclaw) {
    normalized.normal = true;
  }

  return normalized;
}

function getApiKeyClientTag(apiKeyInfo = null) {
  if (!apiKeyInfo) return null;
  return VALID_CLIENT_TAGS.includes(apiKeyInfo.clientTag) ? apiKeyInfo.clientTag : 'normal';
}

function isAgentClientKey(apiKeyInfo = null) {
  return AGENT_CLIENT_TAGS.includes(getApiKeyClientTag(apiKeyInfo));
}

function shouldUsePolling(apiKeyInfo = null) {
  if (isAgentClientKey(apiKeyInfo)) return false;
  return apiKeyInfo?.usePolling !== false;
}

function providerMatchesClientTag(provider, apiKeyInfo = null) {
  const clientTag = getApiKeyClientTag(apiKeyInfo);
  if (!clientTag) return true;

  const tags = normalizeProviderClientTags(provider?.clientTags);
  return tags[clientTag] === true;
}

// 保存会话-提供商映射
const responseStateStore = new Map();
const MAX_RESPONSE_STATES = 500;

function pruneResponseStateStore(now = Date.now()) {
  for (const [id, entry] of responseStateStore) {
    if (!entry || now - entry.createdAt > CONFIG.SESSION_EXPIRATION_TIME) {
      responseStateStore.delete(id);
    }
  }
  if (responseStateStore.size <= MAX_RESPONSE_STATES) return;
  const extra = responseStateStore.size - MAX_RESPONSE_STATES;
  const keys = responseStateStore.keys();
  for (let i = 0; i < extra; i++) {
    const next = keys.next();
    if (next.done) break;
    responseStateStore.delete(next.value);
  }
}

function saveResponseState(responseId, messages) {
  if (!responseId || !Array.isArray(messages)) return;
  pruneResponseStateStore();
  responseStateStore.set(responseId, {
    messages: messages.map(message => ({ ...message })),
    createdAt: Date.now()
  });
}

function loadResponseState(responseId) {
  if (!responseId) return null;
  pruneResponseStateStore();
  return responseStateStore.get(responseId) || null;
}

function completionMessageFromChat(jsonData) {
  const message = jsonData?.choices?.[0]?.message;
  if (!message) return null;
  const converted = { role: message.role || 'assistant' };
  if (message.content !== undefined) converted.content = message.content;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    converted.tool_calls = message.tool_calls;
  }
  return converted;
}

function mergeResponseContinuationMessages(storedMessages, incomingMessages) {
  const stored = Array.isArray(storedMessages) ? storedMessages : [];
  const incoming = Array.isArray(incomingMessages) ? incomingMessages : [];
  if (stored.length === 0) return incoming;
  if (incoming.length === 0) return stored.slice();

  const storedFirstUser = stored.find(message => message.role === 'user');
  const incomingFirstUser = incoming.find(message => message.role === 'user');
  if (storedFirstUser && incomingFirstUser &&
      getMessagePlainText(storedFirstUser) === getMessagePlainText(incomingFirstUser) &&
      incoming.length >= stored.length) {
    return incoming;
  }
  return stored.concat(incoming);
}

function mergeResponseContinuation(previousResponseId, incomingMessages) {
  const stored = loadResponseState(previousResponseId);
  return mergeResponseContinuationMessages(stored?.messages, incomingMessages);
}

function saveConversationProvider(sessionIdentifier, modelName, providerId, userSettings, apiKeyInfo = null, extra = {}) {
  if (!userSettings.conversationProviderMap) {
    userSettings.conversationProviderMap = {};
  }
  
  const key = getConversationMapKey(modelName, sessionIdentifier, apiKeyInfo);
  const keyMode = shouldUsePolling(apiKeyInfo) ? 'polling' : 'single';
  const existing = userSettings.conversationProviderMap[key];
  userSettings.conversationProviderMap[key] = {
    providerId: providerId,
    modelName: modelName,
    mode: keyMode,
    keyId: extra.keyId || existing?.keyId || null,
    lastUsed: new Date().toISOString(),
    messageCount: (existing?.messageCount || 0) + 1,
    createdAt: existing?.createdAt || new Date().toISOString()
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


// 获取下一个轮询提供商（实现随机但不重复的轮询机制）

function normalizeProviderKeysForRuntime(provider) {
  const rawKeys = Array.isArray(provider.apiKeys) ? provider.apiKeys : [];
  if (rawKeys.length > 0) {
    return rawKeys.map((key, index) => ({
      id: key.id || `${provider.id}-key-${index + 1}`,
      name: key.name || `Key ${index + 1}`,
      apiKey: key.apiKey || key.api_key || '',
      enabled: key.enabled !== false,
      weight: Number.isFinite(Number(key.weight)) ? Number(key.weight) : 1,
      priority: Number.isFinite(Number(key.priority)) ? Number(key.priority) : 0,
      createdAt: key.createdAt || key.created_at || null
    }));
  }

  if (provider.apiKey) {
    return [{
      id: `${provider.id}-key-1`,
      name: '默认 Key',
      apiKey: provider.apiKey,
      enabled: true,
      weight: 1,
      priority: 0,
      createdAt: provider.createdAt || provider.created_at || null
    }];
  }

  return [];
}

function selectProviderKey(provider, userSettings, options = {}) {
  const allKeys = normalizeProviderKeysForRuntime(provider).filter(key => key.apiKey);
  if (allKeys.length === 0) {
    return { key: null, keys: [] };
  }

  const keyFailCounts = userSettings.keyFailCounts || {};
  userSettings.keyFailCounts = keyFailCounts;

  const enabledKeys = allKeys.filter(key => key.enabled !== false);
  const validKeys = enabledKeys.filter(key => (keyFailCounts[key.id] || 0) < CONFIG.MODEL_FAIL_THRESHOLD);

  if (validKeys.length === 0) {
    return { key: null, keys: enabledKeys };
  }

  const preferredKeyId = options.preferredKeyId;
  if (preferredKeyId) {
    const preferredKey = validKeys.find(key => key.id === preferredKeyId);
    if (preferredKey) {
      return { key: preferredKey, keys: validKeys, mode: 'sticky' };
    }
  }

  const stickyKey = options.stickyKey === true;
  if (provider.keyPollingEnabled && !stickyKey) {
    const keyPollingState = userSettings.keyPollingState || {};
    const providerState = keyPollingState[provider.id] || { currentIndex: 0, lastReservedKeyId: null, lastReservedAt: null };

    const sequence = [];
    validKeys.forEach((key) => {
      const weight = Number(key.weight);
      const slots = Number.isFinite(weight) && weight > 0 ? Math.min(100, Math.floor(weight)) : 0;
      for (let i = 0; i < slots; i++) {
        sequence.push(key);
      }
    });
    const pollingKeys = sequence.length > 0 ? sequence : validKeys;
    const rawIndex = Number(providerState.currentIndex);
    const startIndex = Number.isFinite(rawIndex) ? rawIndex : 0;
    const selectedIndex = ((startIndex % pollingKeys.length) + pollingKeys.length) % pollingKeys.length;
    const selectedKey = pollingKeys[selectedIndex];

    if (!options.peek) {
      if (!keyPollingState[provider.id]) {
        keyPollingState[provider.id] = providerState;
      }
      userSettings.keyPollingState = keyPollingState;
      providerState.currentIndex = (selectedIndex + 1) % pollingKeys.length;
      providerState.lastReservedKeyId = selectedKey.id;
      providerState.lastReservedAt = new Date().toISOString();
    }

    return { key: selectedKey, keys: validKeys, mode: 'weighted_round_robin' };
  }

  const selectedKey = [...validKeys].sort((a, b) => {
    const priorityDiff = (a.priority || 0) - (b.priority || 0);
    if (priorityDiff !== 0) return priorityDiff;
    const weightDiff = (b.weight || 0) - (a.weight || 0);
    if (weightDiff !== 0) return weightDiff;
    return String(a.id).localeCompare(String(b.id));
  })[0];

  return { key: selectedKey, keys: validKeys, mode: 'priority' };
}

function incrementKeyFailCount(keyId, userSettings) {
  if (!keyId) return;
  if (!userSettings.keyFailCounts) {
    userSettings.keyFailCounts = {};
  }
  userSettings.keyFailCounts[keyId] = (userSettings.keyFailCounts[keyId] || 0) + 1;
  console.log(`Key ${keyId} fail count: ${userSettings.keyFailCounts[keyId]}`);
}

function resetKeyFailCount(keyId, userSettings) {
  if (!keyId || !userSettings.keyFailCounts) return;
  if (userSettings.keyFailCounts[keyId]) {
    userSettings.keyFailCounts[keyId] = 0;
    console.log(`Reset key fail count for ${keyId}`);
  }
}

// 保存轮询状态到文件
async function savePollingState(userSettings) {
  try {
    saveHotUserStateToDb(userSettings);
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
  
}

function getPollingMaxRounds(userSettings) {
  const rounds = Number(userSettings?.pollingMaxRounds ?? userSettings?.pollingMaxRetries);
  if (!Number.isFinite(rounds)) {
    return CONFIG.POLLING_MAX_ROUNDS;
  }
  return Math.max(1, Math.min(20, Math.floor(rounds)));
}

function limitFailoverProvidersForRequest(failoverProviders, userSettings, apiKeyInfo = null) {
  if (!Array.isArray(failoverProviders) || failoverProviders.length === 0) {
    return [];
  }

  const usePolling = shouldUsePolling(apiKeyInfo);
  if (!usePolling) {
    return failoverProviders;
  }

  const rounds = getPollingMaxRounds(userSettings);
  if (rounds === 1) {
    return failoverProviders;
  }
  return Array.from({ length: rounds }, () => failoverProviders).flat();
}

function isModelDisabledForProvider(modelName, providerId, userSettings) {
  return !!userSettings?.disabledModels?.[providerId]?.includes(modelName);
}

// 获取所有可用于故障转移的提供商列表（不使用 usedInCurrentRound 机制）
function getFailoverProviders(providers, modelName, config, userSettings, excludeProviderIds = [], apiKeyInfo = null, options = {}) {
  const usePolling = shouldUsePolling(apiKeyInfo);
  const providerFilter = typeof options.providerFilter === 'function' ? options.providerFilter : null;
  const reservePolling = options.reservePolling !== false;
  const requestedProviderId = getRequestedProviderId(options.requestedModel, providers);
  const excludeSet = new Set(excludeProviderIds || []);
  let candidateProviders = [];

  console.log(`[Failover] Getting failover providers for model: ${modelName}`);
  if (excludeSet.size > 0) {
    console.log(`[Failover] Excluding providers: ${Array.from(excludeSet).join(', ')}`);
  }

  if (usePolling) {
    const available = config?.available?.[modelName] || [];
    const pollingState = userSettings.pollingState || {};
    if (!pollingState[modelName]) {
      pollingState[modelName] = {
        currentIndex: 0,
        usedInCurrentRound: []
      };
    }
    userSettings.pollingState = pollingState;

    const startIndex = pollingState[modelName].currentIndex || 0;
    const excludedSet = getPollingExcludedProviderIds(modelName, config);
    const providerById = new Map((providers || []).map(provider => [provider.id, provider]));

    for (let i = 0; i < available.length; i++) {
      const providerId = available[(startIndex + i) % available.length];
      if (excludeSet.has(providerId) || excludedSet.has(providerId)) continue;
      const provider = providerById.get(providerId);
      if (!isProviderEligibleForModel(provider, modelName, userSettings, apiKeyInfo, {
        usePolling: true,
        providerFilter
      })) continue;
      candidateProviders.push(provider);
    }
  } else {
    for (const provider of providers || []) {
      if (excludeSet.has(provider.id)) continue;
      if (!isProviderEligibleForModel(provider, modelName, userSettings, apiKeyInfo, {
        usePolling: false,
        providerFilter
      })) continue;
      candidateProviders.push(provider);
    }
    if (requestedProviderId) {
      candidateProviders.sort((a, b) => Number(b.id === requestedProviderId) - Number(a.id === requestedProviderId));
    }
    if (isAgentClientKey(apiKeyInfo) && candidateProviders.length > 1) {
      const requested = requestedProviderId
        ? candidateProviders.find(provider => provider.id === requestedProviderId)
        : null;
      candidateProviders = requested ? [requested] : candidateProviders.slice(0, 1);
    }
  }

  if (usePolling && reservePolling && candidateProviders.length > 0) {
    const selectedProviderId = candidateProviders[0].id;
    const available = config?.available?.[modelName] || [];
    const selectedIndex = available.indexOf(selectedProviderId);
    if (selectedIndex !== -1) {
      const pollingState = userSettings.pollingState || {};
      if (!pollingState[modelName]) {
        pollingState[modelName] = {
          currentIndex: 0,
          usedInCurrentRound: []
        };
      }
      pollingState[modelName].currentIndex = (selectedIndex + 1) % available.length;
      pollingState[modelName].lastReservedProviderId = selectedProviderId;
      pollingState[modelName].lastReservedAt = new Date().toISOString();
      userSettings.pollingState = pollingState;
      console.log(`[Failover] Reserved provider ${selectedProviderId} for ${modelName}; nextIndex=${pollingState[modelName].currentIndex}`);
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
    saveApiSettingsToDb(data);
    invalidateApiSettingsCache(); // 缓存失效
  }
}

async function resetFailCount(providerId) {
  const data = await getApiSettings();
  const provider = data.providers.find(p => p.id === providerId);
  if (provider) {
    provider.failCount = 0;
    saveApiSettingsToDb(data);
    invalidateApiSettingsCache(); // 缓存失效
  }
}

async function getProviderModelId(provider, modelName, keyInfo = null) {
  try {
    // 首先尝试从provider.models中查找（避免额外的API调用）
    if (provider.models && provider.models.length > 0) {
      // 先尝试精确匹配（不使用normalizeModelName）
      let matchedModel = provider.models.find(model => {
        const normalized = normalizeModelName(model.id);
        return normalized === modelName;
      });

      // 如果精确匹配失败，再尝试规范化匹配
      if (!matchedModel) {
        const normalizedModelName = normalizeModelName(modelName);
        matchedModel = provider.models.find(model => {
          const normalized = normalizeModelName(model.id);
          return normalized === normalizedModelName;
        });
      }

      if (matchedModel) {
        console.log(`Found model ${matchedModel.id} in provider's model list (requested: ${modelName})`);
        return matchedModel.id;
      }
    }

    // 如果在provider.models中找不到，尝试从API获取
    const apiType = provider.apiType || 'openai';
    const url = buildApiUrl(provider.baseUrl, 'models', apiType, provider.customEndpoints);
    const response = await axios.get(url, {
      headers: buildProviderAuthHeaders(provider, keyInfo),
      timeout: 10000
    });

    const models = extractModelsFromRemoteResponse(response.data);

    // 先尝试精确匹配
    let matchedModel = models.find(model => {
      const normalized = normalizeModelName(model.id);
      return normalized === modelName;
    });

    // 如果精确匹配失败，再尝试规范化匹配
    if (!matchedModel) {
      const normalizedModelName = normalizeModelName(modelName);
      matchedModel = models.find(model => {
        const normalized = normalizeModelName(model.id);
        return normalized === normalizedModelName;
      });
    }

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
  if (!modelId || typeof modelId !== 'string') return '';
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
  handleSuccess(selectedProvider, pureModelName, userSettings, pollingConfig, sessionIdentifier, keyInfo = null, apiKeyInfo = null, stickPolicy = null) {
    const usePolling = shouldUsePolling(apiKeyInfo);
    const stickConversation = stickPolicy?.enabled === true || !usePolling;
    const usedBoundProvider = stickPolicy?.usedBoundProvider === true;

    if (usePolling && !usedBoundProvider) {
      updatePollingStateAfterSuccess(pureModelName, selectedProvider.id, pollingConfig, userSettings);
    }

    if (sessionIdentifier && stickConversation) {
      saveConversationProvider(sessionIdentifier, pureModelName, selectedProvider.id, userSettings, apiKeyInfo, {
        keyId: keyInfo?.key?.id || null
      });
    }

    this.addTask(async () => {
      try {
        // Run these operations in parallel
        await Promise.all([
          resetModelFailCount(selectedProvider.id, pureModelName, userSettings),
          resetKeyFailCount(keyInfo?.key?.id, userSettings)
        ]);

        // Save polling state (async)
        await savePollingState(userSettings);
      } catch (error) {
        log.error('Background success handling error:', error);
      }
    });
  }

  // Handle failure logging
  handleFailure(selectedProvider, pureModelName, userSettings, errorMessage, keyInfo = null) {
    this.addTask(async () => {
      try {
        await Promise.all([
          incrementModelFailCount(selectedProvider.id, pureModelName, userSettings),
          incrementKeyFailCount(keyInfo?.key?.id, userSettings)
        ]);
        await savePollingState(userSettings);
      } catch (error) {
        log.error('Background failure handling error:', error.message);
      }
    });
  }
}

// Performance optimization: Structured error parser
function parseErrorResponse(error) {
  const details = {
    message: error?.message || 'Unknown error',
    code: error?.code || null,
    status: error?.response?.status || null,
    statusText: error?.response?.statusText || null,
    providerMessage: null,
    responseData: null,
    request: {
      method: error?.config?.method?.toUpperCase?.() || null,
      url: error?.config?.url || null,
      timeout: error?.config?.timeout || null
    }
  }

  try {
    const data = error?.response?.data
    if (data === undefined || data === null) {
      return details
    }

    if (Buffer.isBuffer(data)) {
      details.responseData = data.toString('utf8')
    } else if (typeof data === 'object') {
      details.responseData = data
    } else {
      const text = String(data)
      try {
        details.responseData = JSON.parse(text)
      } catch {
        details.responseData = text
      }
    }

    if (typeof details.responseData === 'object' && details.responseData !== null) {
      details.providerMessage =
        details.responseData?.error?.message ||
        details.responseData?.message ||
        details.responseData?.error ||
        null
    } else if (typeof details.responseData === 'string') {
      details.providerMessage = details.responseData
    }

    if (details.providerMessage) {
      details.message = details.providerMessage
    }
  } catch {
    // keep fallback details.message
  }

  return details
}

function formatErrorForLog(errorDetails) {
  if (!errorDetails) return 'Unknown error'

  const parts = []
  if (errorDetails.status) {
    parts.push(`HTTP ${errorDetails.status}${errorDetails.statusText ? ` ${errorDetails.statusText}` : ''}`)
  }
  if (errorDetails.code) {
    parts.push(`Code: ${errorDetails.code}`)
  }
  if (errorDetails.message) {
    parts.push(errorDetails.message)
  }

  return parts.join(' | ') || 'Unknown error'
}

function formatProviderAttemptError(error) {
  if (!error) return null;
  if (typeof error === 'string') return error;
  if (error.status || error.statusText || error.code || error.message) {
    return formatErrorForLog(error);
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function mergeCapturedTokenUsage(current, incoming) {
  const next = normalizeTokenUsage(incoming);
  if (!next) return current;
  if (!current) return next;
  const promptTokens = next.promptTokens || current.promptTokens || 0;
  const completionTokens = next.completionTokens || current.completionTokens || 0;
  const cachedTokens = next.cachedTokens || current.cachedTokens || 0;
  const cacheWriteTokens = next.cacheWriteTokens || current.cacheWriteTokens || 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    cachedTokens,
    cacheWriteTokens
  };
}

function captureTokenUsageFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.usage) return normalizeTokenUsage(payload.usage);
  if (payload.message && payload.message.usage) return normalizeTokenUsage(payload.message.usage);
  if (payload.response && payload.response.usage) return normalizeTokenUsage(payload.response.usage);
  return null;
}

function collectSseUsageAndText(chunk, state = { tokenUsage: null, text: '' }) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const payload = JSON.parse(data);
      const captured = captureTokenUsageFromPayload(payload);
      if (captured) state.tokenUsage = mergeCapturedTokenUsage(state.tokenUsage, captured);
      const delta = payload.choices && payload.choices[0] && payload.choices[0].delta;
      if (delta && typeof delta.content === 'string' && delta.content) {
        state.text += delta.content;
      }
      if (payload.type === 'content_block_delta' && payload.delta && typeof payload.delta.text === 'string' && payload.delta.text) {
        state.text += payload.delta.text;
      }
      if (payload.type === 'response.output_text.delta') {
        if (typeof payload.delta === 'string' && payload.delta) state.text += payload.delta;
        else if (payload.delta && typeof payload.delta.text === 'string' && payload.delta.text) state.text += payload.delta.text;
      }
    } catch {
      // ignore incomplete JSON in this chunk
    }
  }
  return state;
}

function ensureStreamUsageOption(requestBody, apiType = 'openai') {
  if (!requestBody || typeof requestBody !== 'object') return requestBody;
  if (requestBody.stream !== true) return requestBody;
  if (apiType === 'anthropic') return requestBody;
  const existing = requestBody.stream_options;
  if (existing && existing.include_usage === false) return requestBody;
  requestBody.stream_options = { ...(existing || {}), include_usage: true };
  return requestBody;
}

function logChatUiRequest({
  res,
  provider,
  model,
  success,
  duration,
  firstTokenMs = null,
  tokenUsage = null,
  errorMessage = null,
  keyInfo = null,
  stream = true,
  endpoint = '/api/chat',
  isPolling = false,
  messageCount = 0,
  providers = null
}) {
  const req = res && res.req;
  const resolvedFirstTokenMs = finiteNonNegativeMs(firstTokenMs);
  const providerEntry = {
    attempt: 1,
    providerId: provider && provider.id,
    providerName: provider && provider.name,
    status: success ? 'success' : 'failed',
    duration
  };
  if (resolvedFirstTokenMs != null) providerEntry.firstTokenMs = resolvedFirstTokenMs;
  if (errorMessage) providerEntry.error = errorMessage;
  const providerList = Array.isArray(providers) && providers.length > 0 ? providers : [providerEntry];

  setImmediate(() => {
    logApiRequest({
      traceId: generateTraceId(),
      clientIp: req?.ip || req?.socket?.remoteAddress || null,
      userAgent: req?.headers?.['user-agent'] || null,
      apiKeyName: keyInfo?.key?.name || 'Chat UI',
      sessionId: null,
      isPolling: !!isPolling,
      isNewConversation: false,
      request: { model, stream, messageCount },
      providers: providerList,
      result: {
        status: success ? 'success' : 'failed',
        successfulProvider: success ? (provider && provider.id) : null,
        totalAttempts: providerList.length,
        totalDuration: duration,
        tokenUsage: tokenUsage || null,
        estimatedCost: null,
        ...(resolvedFirstTokenMs != null ? { firstTokenMs: resolvedFirstTokenMs } : {})
      },
      metadata: {
        endpoint,
        isStreaming: !!stream,
        source: 'ui',
        apiKeyId: keyInfo?.key?.id || null,
        apiKeyName: keyInfo?.key?.name || 'Chat UI',
        model,
        isPolling: !!isPolling
      }
    });
  });
}

function finiteNonNegativeMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = Number(value);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

function sseChunkIncludesDone(chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
  return /(^|\n)data:\s*\[DONE\]\s*(?:\n|$)/.test(text);
}

function bindClientDisconnect(req, res, onDisconnect) {
  let stopped = false;
  const notify = (reason) => {
    if (stopped) return;
    stopped = true;
    try {
      onDisconnect(reason);
    } catch (error) {
      console.error('[Stream] disconnect handler failed:', error.message);
    }
  };
  if (req) {
    req.on('aborted', () => notify('aborted'));
  }
  if (res) {
    res.on('close', () => {
      if (!res.writableEnded) notify('close');
    });
  }
  return () => { stopped = true; };
}

function createIdleWatchdog(ms, onTimeout) {
  if (!ms || ms <= 0) {
    return { hit() {}, clear() {} };
  }
  let timer = setTimeout(onTimeout, ms);
  return {
    hit() {
      clearTimeout(timer);
      timer = setTimeout(onTimeout, ms);
    },
    clear() {
      clearTimeout(timer);
    }
  };
}

function forwardSseToClient(source, res, { ensureDone = true } = {}) {
  let sawDone = false;
  let finished = false;
  source.on('data', (chunk) => {
    if (!sawDone && sseChunkIncludesDone(chunk)) sawDone = true;
  });
  source.pipe(res, { end: false });
  const finish = () => {
    if (finished || res.writableEnded) return;
    finished = true;
    if (ensureDone && !sawDone) {
      try { res.write('data: [DONE]\n\n'); } catch (_) {}
    }
    if (!res.writableEnded) res.end();
  };
  source.on('end', finish);
  source.on('close', finish);
  source.on('error', (error) => {
    console.log('[SSE] upstream error:', error.message);
    finish();
  });
  return { finish };
}

function ssePayloadLooksLikeFirstToken(payload) {
  if (!payload || typeof payload !== 'object') return false;

  const choice = payload.choices && payload.choices[0];
  const delta = choice && choice.delta;
  if (delta && typeof delta === 'object') {
    if (typeof delta.content === 'string' && delta.content.length > 0) return true;
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) return true;
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) return true;
  }

  const type = payload.type;
  if (type === 'content_block_start' || type === 'content_block_delta') return true;
  if (type === 'response.output_text.delta' || type === 'response.function_call_arguments.delta') return true;

  return false;
}

function chunkHasFirstToken(chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      if (ssePayloadLooksLikeFirstToken(JSON.parse(data))) return true;
    } catch {
      // ignore incomplete JSON in this chunk
    }
  }
  return false;
}

function createFirstTokenProbe(startedAt = Date.now()) {
  let buffer = '';
  let firstTokenMs = null;
  let settled = false;
  let resolveReady = null;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  const settle = (value) => {
    if (settled) return;
    settled = true;
    firstTokenMs = finiteNonNegativeMs(value);
    resolveReady(firstTokenMs);
  };

  const observeLine = (line) => {
    if (settled) return;
    const trimmed = String(line || '').trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      if (ssePayloadLooksLikeFirstToken(JSON.parse(data))) {
        settle(Date.now() - startedAt);
      }
    } catch {
      // ignore incomplete JSON
    }
  };

  const observe = (chunk) => {
    if (settled) return;
    buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      observeLine(line);
      if (settled) return;
    }
  };

  const mark = () => {
    settle(Date.now() - startedAt);
  };

  const finish = () => {
    if (settled) return;
    if (buffer.trim()) observeLine(buffer);
    settle(null);
  };

  return {
    observe,
    mark,
    finish,
    get firstTokenMs() {
      return firstTokenMs;
    },
    ready
  };
}

function recordProviderAttempt(providerAttempts, {
  attempt,
  provider,
  status,
  statusCode = null,
  duration = null,
  error = null,
  firstTokenMs = null,
  providerModelId = null
}) {
  if (!Array.isArray(providerAttempts)) return null;
  const entry = {
    attempt,
    providerId: provider?.id || null,
    providerName: provider?.name || 'unknown',
    status,
    statusCode,
    duration
  };
  if (providerModelId) entry.providerModelId = providerModelId;

  const resolvedFirstTokenMs = finiteNonNegativeMs(firstTokenMs);
  if (resolvedFirstTokenMs != null) {
    entry.firstTokenMs = resolvedFirstTokenMs;
  }

  const formattedError = formatProviderAttemptError(error);
  if (formattedError) {
    entry.error = formattedError;
  }

  providerAttempts.push(entry);
  return entry;
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

function sendFailoverExhaustedResponse(res, stream, { errors, modelName, triedCount }) {
  if (isOnlyRateLimited(errors)) {
    const retryAfter = getRateLimitRetryAfterSeconds(errors);
    if (!res.headersSent) {
      res.setHeader('Retry-After', String(retryAfter));
    }
    return sendErrorResponse(res, stream, {
      message: `All providers for model '${modelName}' are rate-limited. Retry after ${retryAfter}s`,
      type: 'rate_limit_error',
      code: 'rate_limit_exceeded',
      ...(stream ? {} : { details: errors })
    }, 429);
  }

  const errorDetails = (errors || []).map(e => `${e.provider}: ${e.error}`).join('; ');
  return sendErrorResponse(res, stream, {
    message: `All providers failed for model '${modelName}'. Tried ${triedCount} providers.${stream ? ` Details: ${errorDetails}` : ''}`,
    type: 'server_error',
    code: 'all_providers_failed',
    ...(stream ? {} : { details: errors })
  }, 503);
}

function sendAnthropicFailoverExhausted(res, { errors, message }) {
  if (isOnlyRateLimited(errors)) {
    const retryAfter = getRateLimitRetryAfterSeconds(errors);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      type: 'error',
      error: {
        type: 'rate_limit_error',
        message: `${message} Rate limited. Retry after ${retryAfter}s`
      },
      details: errors
    });
  }

  return res.status(503).json({
    type: 'error',
    error: {
      type: 'api_error',
      message
    },
    details: errors
  });
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

    const delta = {
      role: message.role || 'assistant',
      content
    };

    // 重要：转发 tool_calls 字段，否则工具调用会失败
    if (message.tool_calls) {
      delta.tool_calls = message.tool_calls;
    }

    // 也转发 function_call（旧版本兼容）
    if (message.function_call) {
      delta.function_call = message.function_call;
    }

    return {
      index: choice.index !== undefined ? choice.index : index,
      delta,
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

// Anthropic to OpenAI format converter for streaming responses
function convertAnthropicStreamToOpenAI(apiType) {
  const { Transform } = require('stream');

  if (apiType !== 'anthropic') {
    // 如果不是Anthropic类型，直接透传
    return new Transform({
      transform(chunk, encoding, callback) {
        callback(null, chunk);
      }
    });
  }

  // Anthropic格式转换器
  let buffer = '';
  let toolCallIndex = 0;
  let currentToolCall = null;
  let eventCount = 0;
  let outputCount = 0;

  console.log('[Converter] Anthropic-to-OpenAI converter initialized');

  return new Transform({
    transform(chunk, encoding, callback) {
      try {
        const chunkStr = chunk.toString();
        buffer += chunkStr;

        // 按行处理SSE数据
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留最后一个不完整的行

        for (const line of lines) {
          if (!line.trim() || line.startsWith(':')) {
            // 空行或注释行，直接转发
            this.push(line + '\n');
            continue;
          }

          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            if (data === '[DONE]') {
              console.log('[Converter] Received [DONE] signal');
              emittedDone = true;
              this.push('data: [DONE]\n\n');
              continue;
            }

            try {
              const event = JSON.parse(data);
              eventCount++;

              // 检测是OpenAI格式还是Anthropic格式
              if (event.choices) {
                // OpenAI 格式，但需要检查是否包含 XML 工具调用
                const delta = event.choices[0]?.delta;
                const content = delta?.content;

                if (content && typeof content === 'string') {
                  // 检测 XML 工具调用标签
                  const xmlToolPattern = /<([a-z_]+)>[\s\S]*?<\/\1>/;
                  const hasXmlTools = xmlToolPattern.test(content);

                  if (hasXmlTools) {
                    console.log(`[Converter] Event #${eventCount}: OpenAI format with XML tools detected, converting`);

                    // 解析 XML 工具调用
                    const toolCalls = parseXmlToolCalls(content);

                    if (toolCalls && toolCalls.length > 0) {
                      // 创建包含 tool_calls 的新事件
                      const convertedEvent = {
                        ...event,
                        choices: [{
                          ...event.choices[0],
                          delta: {
                            tool_calls: toolCalls
                          },
                          finish_reason: 'tool_calls'
                        }]
                      };

                      outputCount++;
                      console.log(`[Converter] Converted ${toolCalls.length} XML tools to tool_calls format`);
                      this.push(`data: ${JSON.stringify(convertedEvent)}\n\n`);
                    } else {
                      // 没有识别到工具，移除 XML 标签后透传
                      const cleanContent = removeXmlToolCalls(content);
                      if (cleanContent) {
                        const cleanedEvent = {
                          ...event,
                          choices: [{
                            ...event.choices[0],
                            delta: {
                              content: cleanContent
                            }
                          }]
                        };
                        this.push(`data: ${JSON.stringify(cleanedEvent)}\n\n`);
                      }
                    }
                  } else {
                    console.log(`[Converter] Event #${eventCount}: OpenAI format, passing through`);
                    this.push(line + '\n\n');
                  }
                } else {
                  console.log(`[Converter] Event #${eventCount}: OpenAI format, passing through`);
                  this.push(line + '\n\n');
                }
              } else if (event.type) {
                // Anthropic格式，需要转换
                console.log(`[Converter] Event #${eventCount}: Anthropic type=${event.type}`);

                const openaiChunk = convertAnthropicEventToOpenAI(event, toolCallIndex, currentToolCall);

                if (openaiChunk) {
                  outputCount++;
                  console.log(`[Converter] Output #${outputCount}: Generated OpenAI chunk for event type ${event.type}`);

                  // 更新工具调用状态
                  if (event.type === 'content_block_start' &&
                      event.content_block?.type === 'tool_use') {
                    currentToolCall = {
                      id: event.content_block.id,
                      name: event.content_block.name,
                      arguments: ''
                    };
                    toolCallIndex++;
                  } else if (event.type === 'content_block_delta' &&
                             event.delta?.type === 'input_json_delta') {
                    if (currentToolCall) {
                      currentToolCall.arguments += event.delta.partial_json;
                    }
                  } else if (event.type === 'content_block_stop') {
                    currentToolCall = null;
                  }

                  this.push(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                } else {
                  console.log(`[Converter] Event type ${event.type} returned null, skipping`);
                }
              } else {
                // 未知格式，直接透传
                console.log(`[Converter] Event #${eventCount}: Unknown format, passing through`);
                this.push(line + '\n\n');
              }
            } catch (e) {
              // JSON解析失败，可能是格式问题，直接转发
              console.log('[Converter] Failed to parse event as JSON:', e.message);
              console.log('[Converter] Raw data:', data.substring(0, 200));
              this.push(line + '\n\n');
            }
          } else {
            // 非data行，直接转发
            this.push(line + '\n');
          }
        }

        callback();
      } catch (error) {
        console.error('[Converter] Error in transform:', error);
        callback(error);
      }
    },

    flush(callback) {
      console.log(`[Converter] Flush called. Total events: ${eventCount}, Total outputs: ${outputCount}`);
      const leftover = buffer.trim();
      buffer = '';
      if (leftover) {
        if (leftover.startsWith('data: ')) {
          const data = leftover.slice(6);
          if (data === '[DONE]') {
            emittedDone = true;
            this.push('data: [DONE]\n\n');
          } else {
            try {
              const event = JSON.parse(data);
              if (event.choices) {
                this.push(`data: ${JSON.stringify(event)}\n\n`);
              } else if (event.type) {
                const openaiChunk = convertAnthropicEventToOpenAI(event, toolCallIndex, currentToolCall);
                if (openaiChunk) {
                  this.push(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                }
              } else {
                this.push(`${leftover}\n\n`);
              }
            } catch {
              this.push(`${leftover}\n\n`);
            }
          }
        } else {
          this.push(leftover);
        }
      }
      if (!emittedDone) {
        emittedDone = true;
        this.push('data: [DONE]\n\n');
      }
      callback();
    }
  });
}

// Parse XML tool calls and convert to OpenAI tool_calls format
function parseXmlToolCalls(content) {
  const toolCalls = [];

  // Match XML tool tags like <tool_name>...</tool_name>
  const toolPattern = /<([a-z_][a-z0-9_]*?)>([\s\S]*?)<\/\1>/g;
  let match;
  let toolIndex = 0;

  while ((match = toolPattern.exec(content)) !== null) {
    const toolName = match[1];
    const toolContent = match[2];

    // Skip common non-tool tags
    if (['thinking', 'answer', 'response'].includes(toolName)) {
      continue;
    }

    // Parse parameters from nested XML tags
    const params = {};
    const paramPattern = /<([a-z_][a-z0-9_]*?)>([\s\S]*?)<\/\1>/g;
    let paramMatch;

    while ((paramMatch = paramPattern.exec(toolContent)) !== null) {
      const paramName = paramMatch[1];
      const paramValue = paramMatch[2].trim();
      params[paramName] = paramValue;
    }

    // If no nested tags, use the content as a single parameter
    if (Object.keys(params).length === 0 && toolContent.trim()) {
      params.content = toolContent.trim();
    }

    toolCalls.push({
      id: `call_xml_${Date.now()}_${toolIndex}`,
      type: 'function',
      function: {
        name: toolName,
        arguments: JSON.stringify(params)
      }
    });

    toolIndex++;
  }

  return toolCalls.length > 0 ? toolCalls : null;
}

// Remove XML tool calls from content
function removeXmlToolCalls(content) {
  // Remove tool XML tags but keep thinking tags
  return content.replace(/<(?!thinking|\/thinking)([a-z_][a-z0-9_]*?)>[\s\S]*?<\/\1>/g, '').trim();
}

// Convert single Anthropic event to OpenAI format
function convertAnthropicEventToOpenAI(anthropicEvent, toolCallIndex, currentToolCall) {
  const timestamp = Math.floor(Date.now() / 1000);

  // 基础OpenAI chunk结构
  const baseChunk = {
    id: `chatcmpl-${timestamp}`,
    object: 'chat.completion.chunk',
    created: timestamp,
    model: anthropicEvent.model || 'claude',
    choices: [{
      index: 0,
      delta: {},
      finish_reason: null
    }]
  };

  switch (anthropicEvent.type) {
    case 'message_start':
      baseChunk.choices[0].delta = { role: 'assistant', content: '' };
      if (anthropicEvent.message && anthropicEvent.message.usage) {
        baseChunk.usage = {
          prompt_tokens: anthropicEvent.message.usage.input_tokens || 0,
          completion_tokens: anthropicEvent.message.usage.output_tokens || 0,
          total_tokens: (anthropicEvent.message.usage.input_tokens || 0) + (anthropicEvent.message.usage.output_tokens || 0)
        };
      }
      return baseChunk;

    case 'content_block_start':
      if (anthropicEvent.content_block?.type === 'text') {
        baseChunk.choices[0].delta = { content: '' };
        return baseChunk;
      } else if (anthropicEvent.content_block?.type === 'tool_use') {
        // 开始工具调用
        baseChunk.choices[0].delta = {
          tool_calls: [{
            index: toolCallIndex,
            id: anthropicEvent.content_block.id || `call_${toolCallIndex}`,
            type: 'function',
            function: {
              name: anthropicEvent.content_block.name,
              arguments: ''
            }
          }]
        };
        return baseChunk;
      }
      break;

    case 'content_block_delta':
      if (anthropicEvent.delta?.type === 'text_delta') {
        baseChunk.choices[0].delta = { content: anthropicEvent.delta.text };
        return baseChunk;
      } else if (anthropicEvent.delta?.type === 'input_json_delta') {
        // 工具调用参数增量
        baseChunk.choices[0].delta = {
          tool_calls: [{
            index: toolCallIndex - 1,
            function: {
              arguments: anthropicEvent.delta.partial_json
            }
          }]
        };
        return baseChunk;
      }
      break;

    case 'content_block_stop':
      // 内容块结束，不需要特殊处理
      return null;

    case 'message_delta':
      if (anthropicEvent.delta?.stop_reason) {
        baseChunk.choices[0].finish_reason = anthropicEvent.delta.stop_reason === 'end_turn' ? 'stop' :
                                             anthropicEvent.delta.stop_reason === 'tool_use' ? 'tool_calls' :
                                             anthropicEvent.delta.stop_reason;
      }
      if (anthropicEvent.usage) {
        baseChunk.usage = {
          prompt_tokens: anthropicEvent.usage.input_tokens || 0,
          completion_tokens: anthropicEvent.usage.output_tokens || 0,
          total_tokens: (anthropicEvent.usage.input_tokens || 0) + (anthropicEvent.usage.output_tokens || 0)
        };
      }
      if (anthropicEvent.delta?.stop_reason || anthropicEvent.usage) {
        return baseChunk;
      }
      break;

    case 'message_stop':
      return null;

    case 'error':
      console.error('[DEBUG] Anthropic API error:', anthropicEvent.error);
      return null;
  }

  return null;
}

// Convert non-streaming Anthropic JSON response to OpenAI format
function convertAnthropicJsonToOpenAI(anthropicResponse) {
  // Check if this is an Anthropic response
  if (!anthropicResponse.type || anthropicResponse.type !== 'message') {
    // Not an Anthropic response, return as-is
    return anthropicResponse;
  }

  console.log('[DEBUG] Converting Anthropic JSON response to OpenAI format');

  const timestamp = Math.floor(Date.now() / 1000);
  const openaiResponse = {
    id: `chatcmpl-${timestamp}`,
    object: 'chat.completion',
    created: timestamp,
    model: anthropicResponse.model || 'claude',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: null
      },
      finish_reason: null
    }],
    usage: anthropicResponse.usage ? {
      prompt_tokens: anthropicResponse.usage.input_tokens || 0,
      completion_tokens: anthropicResponse.usage.output_tokens || 0,
      total_tokens: (anthropicResponse.usage.input_tokens || 0) + (anthropicResponse.usage.output_tokens || 0)
    } : undefined
  };

  // Process content blocks
  let textContent = '';
  const toolCalls = [];

  if (anthropicResponse.content && Array.isArray(anthropicResponse.content)) {
    for (const block of anthropicResponse.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id || `call_${toolCalls.length}`,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input)
          }
        });
      }
    }
  }

  // Set message content and tool_calls
  if (toolCalls.length > 0) {
    openaiResponse.choices[0].message.content = textContent || null;
    openaiResponse.choices[0].message.tool_calls = toolCalls;
    openaiResponse.choices[0].finish_reason = 'tool_calls';
  } else {
    openaiResponse.choices[0].message.content = textContent;
    openaiResponse.choices[0].finish_reason = anthropicResponse.stop_reason === 'end_turn' ? 'stop' :
                                               anthropicResponse.stop_reason || 'stop';
  }

  return openaiResponse;
}

// Performance optimization: Simplified streaming response handler
async function handleStreamingResponse(response, res, stream, selectedProvider, pureModelName, userSettings, pollingConfig, sessionIdentifier, apiType, requestMessages = [], skipConverter = false, keyInfo = null, apiKeyInfo = null, stickPolicy = null, firstTokenStartedAt = Date.now()) {
  const originalContentType = response.headers['content-type'];
  let tokenUsage = null;
  const firstTokenProbe = createFirstTokenProbe(firstTokenStartedAt);
  let settleStream = null;
  const streamFinished = new Promise((resolve) => {
    settleStream = resolve;
  });
  const markStreamFinished = () => {
    firstTokenProbe.finish();
    if (settleStream) {
      const done = settleStream;
      settleStream = null;
      done();
    }
  };

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
  } else {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }

  let terminal = false;
  let successRecorded = false;

  const recordSuccess = () => {
    if (successRecorded) return;
    successRecorded = true;
    backgroundProcessor.handleSuccess(selectedProvider, pureModelName, userSettings, pollingConfig, sessionIdentifier, keyInfo, apiKeyInfo, stickPolicy);
  };

  const recordFailure = (errorMessage) => {
    if (terminal) return;
    terminal = true;
    backgroundProcessor.handleFailure(selectedProvider, pureModelName, userSettings, errorMessage, keyInfo);
    if (res.writableEnded) return;
    if (stream) {
      res.write(`data: ${JSON.stringify({ error: { message: errorMessage } })}\n\n`);
      res.end();
    } else if (!res.headersSent) {
      res.status(500).json({ error: { message: errorMessage } });
    } else {
      res.end();
    }
  };

  const isClaudeModel = /claude/i.test(pureModelName);
  const shouldConvert = !skipConverter && isClaudeModel && apiType === 'openai';

  if (skipConverter) {
    console.log(`[DEBUG] 透传模式已启用，跳过格式转换器`);
  } else if (shouldConvert) {
    console.log(`[DEBUG] Detected Claude model with OpenAI apiType, will apply Anthropic-to-OpenAI converter`);
  }

  const looksLikeSse = (originalContentType && originalContentType.includes('text/event-stream'))
    || (stream && !(originalContentType && originalContentType.includes('application/json')));

  if (looksLikeSse) {
    console.log(`[DEBUG] Forwarding SSE stream (apiType=${apiType}, shouldConvert=${shouldConvert})`);

    let dataReceived = false;
    let sseEventCount = 0;
    let hasToolCalls = false;
    let streamedText = '';
    const usageCollector = { tokenUsage: null, text: '' };

    // Bind as soon as upstream accepted the stream. Waiting until 'end' would let a
    // mid-stream error leave tool-calling sessions unbound and switch providers.
    recordSuccess();

    response.data.on('data', (chunk) => {
      firstTokenProbe.observe(chunk);
      collectSseUsageAndText(chunk, usageCollector);
      tokenUsage = usageCollector.tokenUsage;
      streamedText = usageCollector.text;
      const chunkStr = chunk.toString();
      if (!dataReceived) {
        console.log('[DEBUG] First SSE chunk received');
        dataReceived = true;
      }

      const lines = chunkStr.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:') || trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]') continue;
        sseEventCount++;
        try {
          const data = JSON.parse(trimmed.slice(trimmed.indexOf(':') + 1).trim());
          const delta = data.choices?.[0]?.delta;
          const finishReason = data.choices?.[0]?.finish_reason;
          if (delta?.tool_calls) hasToolCalls = true;
          if (sseEventCount <= 3 || delta?.tool_calls || finishReason) {
            console.log('[SSE] event #' + sseEventCount);
            if (delta?.content) {
              console.log('  content: "' + delta.content.substring(0, 100) + (delta.content.length > 100 ? '...' : '') + '"');
            }
            if (delta?.tool_calls) {
              console.log('  tool_calls: ' + JSON.stringify(delta.tool_calls));
            }
            if (finishReason) {
              console.log('  finish_reason: ' + finishReason);
            }
          }
        } catch (e) {
          // ignore parse errors on individual SSE events
        }
      }
    });

    response.data.on('end', () => {
      console.log('[DEBUG] SSE stream ended normally');
      console.log(`[SSE调试] 总事件数: ${sseEventCount}, 包含工具调用: ${hasToolCalls}`);
      if (!tokenUsage) {
        tokenUsage = estimateTokenUsageFromMessages(requestMessages, streamedText);
      }
      markStreamFinished();
    });

    if (shouldConvert) {
      const converter = convertAnthropicStreamToOpenAI('anthropic');
      response.data.pipe(converter);
      forwardSseToClient(converter, res, { ensureDone: true });
    } else {
      forwardSseToClient(response.data, res, { ensureDone: true });
    }
  } else {
    let chunks = [];

    response.data.on('data', chunk => {
      if (terminal) return;
      chunks.push(chunk);
    });

    response.data.on('end', async () => {
      if (terminal || successRecorded) {
        markStreamFinished();
        return;
      }

      try {
        const fullData = Buffer.concat(chunks).toString('utf8');
        let jsonData = JSON.parse(fullData);

        if (shouldConvert) {
          console.log('[DEBUG] Converting non-streaming Anthropic response to OpenAI format');
          jsonData = convertAnthropicJsonToOpenAI(jsonData);
        }

        if (stream) {
          const sseChunk = buildStreamingChunkFromCompletion(jsonData);
          const payload = sseChunk || jsonData;
          const sseData = `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
          res.end(sseData, 'utf8');
        } else {
          res.json(jsonData);
        }

        const capturedUsage = captureTokenUsageFromPayload(jsonData);
        if (capturedUsage) tokenUsage = mergeCapturedTokenUsage(tokenUsage, capturedUsage);
        firstTokenProbe.mark();
        recordSuccess();
        terminal = true;
        markStreamFinished();
      } catch (parseError) {
        markStreamFinished();
        log.error('Error parsing response:', parseError);
        recordFailure('Invalid response format');
      }
    });
  }

  response.data.on('error', (error) => {
    markStreamFinished();
    console.log('[DEBUG] SSE stream error:', error.message);
    if (successRecorded || terminal) {
      log.error('Stream error after success:', error.message);
      if (!res.writableEnded) {
        try { res.write('data: [DONE]\n\n'); } catch (_) {}
        res.end();
      }
      return;
    }
    log.error('Stream error:', error.message);
    recordFailure(error.message);
  });

  bindClientDisconnect(res.req, res, () => {
    if (response.data && !response.data.destroyed) {
      response.data.destroy();
    }
  });

  const firstTokenMs = await firstTokenProbe.ready;
  await streamFinished;
  return { tokenUsage, firstTokenMs };
}

// ==================== 图像生成模型支持 ====================

/**
 * 识别模型类型（文本、图像、嵌入、重排）
 * @param {Object} provider - 提供商对象
 * @param {string} modelId - 模型ID
 * @param {Object} userSettings - 用户设置（包含modelTypes配置）
 * @returns {string} - 'text', 'image', 'image-generation', 'image-edit', 'embedding', 'rerank'
 */
function getModelType(provider, modelId, userSettings = null) {
  // 1. 优先从用户设置的modelTypes读取（最高优先级）
  if (userSettings?.modelTypes) {
    const fullModelId = `${provider.id}::${modelId}`;
    const userConfiguredType = userSettings.modelTypes[fullModelId];
    if (userConfiguredType) {
      log.debug(`[ModelType] Found type from user settings: ${userConfiguredType} for ${fullModelId}`);
      return userConfiguredType;
    }
  }

  // 2. 从provider配置读取
  const model = provider.models?.find(m => m.id === modelId);
  if (model?.type) {
    log.debug(`[ModelType] Found type from config: ${model.type} for model ${modelId}`);
    return model.type;
  }

  // 3. 从模型ID推断（作为备选）
  const modelIdLower = modelId.toLowerCase();

  const embeddingKeywords = [
    'embedding', 'embeddings', 'embed', 'bge-m3', 'text-embedding', 'm3e'
  ];
  const rerankKeywords = [
    'rerank', 're-rank', 'bge-reranker', 'jina-reranker', 'ranker'
  ];
  const imageKeywords = [
    'dall-e', 'dalle',
    'stable-diffusion', 'midjourney', 'imagen',
    'sd-', 'sdxl',
    'nano', 'banana',
    'imagine', 'image-edit', 'img-edit',
    'flux', 'playground',
    'gpt-image'
  ];

  if (embeddingKeywords.some(kw => modelIdLower.includes(kw))) {
    log.debug(`[ModelType] Inferred as embedding model from ID: ${modelId}`);
    return 'embedding';
  }

  if (rerankKeywords.some(kw => modelIdLower.includes(kw))) {
    log.debug(`[ModelType] Inferred as rerank model from ID: ${modelId}`);
    return 'rerank';
  }

  if (imageKeywords.some(kw => modelIdLower.includes(kw))) {
    log.debug(`[ModelType] Inferred as image model from ID: ${modelId}`);
    return 'image';
  }

  log.debug(`[ModelType] Defaulting to text model for: ${modelId}`);
  return 'text';
}

/**
 * 判断模型是否支持图像生成
 * @param {string} modelType - 模型类型
 * @returns {boolean}
 */
function isImageModel(modelType) {
  return ['image', 'image-generation', 'image-edit'].includes(modelType);
}

/**
 * 判断模型是否为嵌入模型
 * @param {string} modelType - 模型类型
 * @returns {boolean}
 */
function isEmbeddingModel(modelType) {
  return modelType === 'embedding';
}

/**
 * 判断模型是否为重排模型
 * @param {string} modelType - 模型类型
 * @returns {boolean}
 */
function isRerankModel(modelType) {
  return modelType === 'rerank';
}

/**
 * 判断模型是否支持文生图
 * @param {string} modelType - 模型类型
 * @returns {boolean}
 */
function supportsTextToImage(modelType) {
  return ['image', 'image-generation'].includes(modelType);
}

/**
 * 判断模型是否支持图生图
 * @param {string} modelType - 模型类型
 * @returns {boolean}
 */
function supportsImageToImage(modelType) {
  return ['image', 'image-edit'].includes(modelType);
}

/**
 * 构建图像生成API的URL
 * @param {string} baseUrl - 基础URL
 * @param {string} apiType - API类型
 * @param {Object} customEndpoints - 自定义端点配置
 * @param {string} modelType - 模型类型
 * @param {boolean} hasInputImage - 是否有输入图片
 * @param {string} modelId - 模型ID（用于判断是否需要使用chat端点）
 * @returns {string} - 完整的API URL
 */
function buildImageApiUrl(baseUrl, apiType, customEndpoints = null, modelType = 'image', hasInputImage = false, modelId = '') {
  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new Error('Provider baseUrl is required');
  }
  baseUrl = baseUrl.replace(/\/$/, '');

  // 优先使用自定义端点
  if (customEndpoints && customEndpoints.images) {
    return `${baseUrl}${customEndpoints.images}`;
  }

  // 如果有输入图片（图生图），使用edits端点
  if (hasInputImage) {
    return `${baseUrl}/v1/images/edits`;
  }

  // 文生图：统一使用chat completions端点
  return `${baseUrl}/v1/chat/completions`;
}

/**
 * 构建图像生成请求体（JSON格式，用于文生图）
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
      n: params.n || 1
    };

    // 只在明确提供时才添加size参数
    if (params.size) {
      requestBody.size = params.size;
    }

    // 添加可选参数
    if (params.quality) {
      requestBody.quality = params.quality;
    }
    if (params.style) {
      requestBody.style = params.style;
    }
    if (params.response_format) {
      requestBody.response_format = params.response_format;
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
 * @param {boolean} isChatFormat - 是否是chat completions格式
 * @returns {Object} - 标准化的图像数据
 */
function parseImageResponse(data, apiType, isChatFormat = false) {
  // 兼容部分供应商返回的SSE字符串响应（data: {...}\n\n）
  if (typeof data === 'string') {
    const lines = data.split('\n').filter(line => line.trim().startsWith('data:'))
    let combinedContent = ''
    let inlinePayload = null

    for (const line of lines) {
      const raw = line.replace(/^data:\s*/i, '').trim()
      if (!raw || raw === '[DONE]') continue

      // 尝试直接从raw里提取base64 data:image
      const rawDataUrlMatch = raw.match(/data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+/)
      if (rawDataUrlMatch) {
        return {
          images: [{
            url: rawDataUrlMatch[0],
            revisedPrompt: null
          }],
          metadata: {}
        }
      }

      try {
        const payload = JSON.parse(raw)
        const deltaContent = payload?.choices?.[0]?.delta?.content || payload?.choices?.[0]?.message?.content || ''
        if (deltaContent) combinedContent += deltaContent

        const parts = payload?.candidates?.[0]?.content?.parts || []
        const inlinePart = parts.find(part => part?.inline_data || part?.inlineData)
        if (inlinePart) inlinePayload = payload
      } catch (e) {
        // 忽略非JSON片段
      }
    }

    if (inlinePayload) {
      data = inlinePayload
    } else if (combinedContent) {
      data = {
        choices: [
          {
            message: {
              content: combinedContent
            }
          }
        ]
      }
    }
  }

  // 处理chat completions格式（grok-imagine、gemini 等）
  if (isChatFormat) {
    const content = data?.choices?.[0]?.delta?.content || data?.choices?.[0]?.message?.content || '';

    // 尝试从markdown格式中提取图片URL: ![image](url)
    const imageUrlMatch = content.match(/!\[.*?\]\((https?:\/\/[^\)]+)\)/);

    if (imageUrlMatch) {
      return {
        images: [{
          url: imageUrlMatch[1],
          revisedPrompt: null
        }],
        metadata: {
          created: data.created
        }
      };
    }

    // 尝试从内容中提取 base64 data:image
    const dataUrlMatch = content.match(/data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+/);
    if (dataUrlMatch) {
      return {
        images: [{
          url: dataUrlMatch[0],
          revisedPrompt: null
        }],
        metadata: {
          created: data.created
        }
      };
    }

    // 如果content直接是URL
    if (content.startsWith('http://') || content.startsWith('https://')) {
      return {
        images: [{
          url: content,
          revisedPrompt: null
        }],
        metadata: {
          created: data.created
        }
      };
    }

    // 兜底：如果content包含疑似base64图片数据但缺少data:image前缀
    const base64CandidateMatch = content.match(/[A-Za-z0-9+/=]{800,}/)
    if (base64CandidateMatch) {
      const base64Candidate = base64CandidateMatch[0]
      let mimeType = 'image/jpeg'
      if (base64Candidate.startsWith('iVBORw0')) {
        mimeType = 'image/png'
      } else if (base64Candidate.startsWith('R0lGOD')) {
        mimeType = 'image/gif'
      } else if (base64Candidate.startsWith('UklGR')) {
        mimeType = 'image/webp'
      }

      return {
        images: [{
          url: `data:${mimeType};base64,${base64Candidate}`,
          revisedPrompt: null
        }],
        metadata: {
          created: data.created
        }
      };
    }

    // Gemini 风格：candidates[0].content.parts[].inline_data / inlineData
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const inlinePart = parts.find(part => part?.inline_data || part?.inlineData);
    if (inlinePart) {
      const inlineData = inlinePart.inline_data || inlinePart.inlineData;
      const mimeType = inlineData.mime_type || inlineData.mimeType || 'image/png';
      const base64Data = inlineData.data || inlineData.bytes || inlineData.b64 || '';
      const url = base64Data.startsWith('data:')
        ? base64Data
        : (base64Data ? `data:${mimeType};base64,${base64Data}` : null);

      if (url) {
        return {
          images: [{
            url,
            revisedPrompt: null
          }],
          metadata: {
            created: data.created
          }
        };
      }
    }

    // 其他可能的字段：images[]/image/base64
    if (Array.isArray(data?.images) && data.images.length > 0) {
      return {
        images: data.images.map(img => {
          if (typeof img === 'string') {
            return { url: img, revisedPrompt: null };
          }
          const base64 = img.b64_json || img.base64 || img.data;
          const mimeType = img.mime_type || img.mimeType || 'image/png';
          const url = img.url || (base64 ? `data:${mimeType};base64,${base64}` : null);
          return { url, revisedPrompt: img.revised_prompt || img.revisedPrompt || null };
        }).filter(img => !!img.url),
        metadata: {
          created: data.created
        }
      };
    }
  }

  if (apiType === 'openai' && data.data) {
    return {
      images: data.data.map(img => ({
        url: img.url || (img.b64_json ? `data:image/png;base64,${img.b64_json}` : null),
        revisedPrompt: img.revised_prompt
      })).filter(img => !!img.url),
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
 * @param {Object|null} keyInfo - key selection result
 * @param {Array|null} images - 输入图片数组（用于图生图）
 * @param {Object|null} userSettings - 用户设置
 */
async function generateImage(provider, prompt, params, res, modelId, keyInfo = null, images = null, userSettings = null) {
  const startedAt = Date.now();
  log.info(`[ImageGen] Starting image generation with provider: ${provider.name}, model: ${modelId}`);
  log.verbose(`[ImageGen] Prompt: ${prompt.substring(0, 100)}...`);
  log.verbose(`[ImageGen] Params:`, params);

  const hasInputImage = images && images.length > 0;
  if (hasInputImage) {
    log.info(`[ImageGen] Image-to-image mode: ${images.length} input image(s) provided`);
  } else {
    log.info(`[ImageGen] Text-to-image mode`);
  }

  // 获取模型类型
  const modelType = getModelType(provider, modelId, userSettings);
  log.info(`[ImageGen] Model type: ${modelType}`);

  const apiType = provider.apiType || 'openai';
  const url = buildImageApiUrl(provider.baseUrl, apiType, provider.customEndpoints, modelType, hasInputImage, modelId);
  log.info(`[ImageGen] Using endpoint: ${url}`);

  try {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }

    // 发送开始生成的消息
    res.write(`data: ${JSON.stringify({
      type: 'status',
      message: hasInputImage ? '正在编辑图片，请稍候...' : '正在生成图片，请稍候...'
    })}\n\n`);

    let response;

    // 文生图使用chat completions格式，图生图使用FormData
    const useChatEndpoint = !hasInputImage;

    // 根据是否有输入图片选择请求格式
    if (hasInputImage) {
      // 图生图：使用 FormData (multipart/form-data)
      const FormData = require('form-data');
      const formData = new FormData();

      // 添加模型
      formData.append('model', modelId);

      // 添加提示词
      formData.append('prompt', prompt);

      // 添加图片（将 base64 转换为 Buffer）
      const imageDataUrl = images[0].dataUrl;
      const base64Data = imageDataUrl.split(',')[1];
      if (!base64Data) {
        throw new Error('Invalid image data format');
      }
      const imageBuffer = Buffer.from(base64Data, 'base64');

      // 根据 dataUrl 判断图片格式
      const mimeType = imageDataUrl.split(';')[0].split(':')[1] || 'image/png';
      const extension = mimeType.split('/')[1] || 'png';

      formData.append('image', imageBuffer, {
        filename: images[0].name || `image.${extension}`,
        contentType: mimeType
      });

      // 添加其他参数
      if (params.n) formData.append('n', params.n.toString());
      if (params.size) formData.append('size', params.size);
      if (params.quality) formData.append('quality', params.quality);
      if (params.response_format) formData.append('response_format', params.response_format);

      log.info(`[ImageGen] Using FormData for image-to-image (edits endpoint)`);

      // 增加详细的请求日志
      const formDataHeaders = {
        ...buildProviderAuthHeaders(provider, keyInfo),
        ...formData.getHeaders()
      };
      log.info('[ImageGen-Debug] Preparing to send FormData request.');
      log.verbose('[ImageGen-Debug] Request URL:', url);
      log.verbose('[ImageGen-Debug] Request Headers:', formDataHeaders);
      log.verbose('[ImageGen-Debug] Axios Proxy Config:', axios.defaults.proxy);
      log.verbose('[ImageGen-Debug] Note: Request body is multipart/form-data, not logging full content.');

      // 调用API
      response = await axios.post(url, formData, {
        headers: formDataHeaders,
        timeout: CONFIG.STREAM_TIMEOUT
      });
    } else {
      // 文生图：使用chat completions格式，并且强制开启流式响应
      const requestBody = {
        model: modelId,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        ...params,
        stream: true
      };

      log.info(`[ImageGen] Using chat completions format for text-to-image (streaming).`);
      
      const jsonHeaders = {
        ...buildProviderAuthHeaders(provider, keyInfo),
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      };
      log.info('[ImageGen-Debug] Preparing to send JSON stream request.');
      log.verbose('[ImageGen-Debug] Request URL:', url);
      log.verbose('[ImageGen-Debug] Request Headers:', jsonHeaders);
      log.verbose('[ImageGen-Debug] Request Body:', JSON.stringify(requestBody, null, 2));
      log.verbose('[ImageGen-Debug] Axios Proxy Config:', axios.defaults.proxy);

      const upstreamResponse = await axios.post(url, requestBody, {
        headers: jsonHeaders,
        responseType: 'stream',
        timeout: CONFIG.UPSTREAM_STREAM_TIMEOUT
      });

      // 直接将上游的流转发给客户端
      log.info('[ImageGen] Piping upstream stream to client.');
      let sawDone = false;
      upstreamResponse.data.on('data', (chunk) => {
        try {
          if (chunk && chunk.toString('utf8').includes('[DONE]')) {
            sawDone = true;
          }
        } catch (err) {
          log.debug('[ImageGen] Failed to scan chunk for [DONE]:', err.message);
        }
      });
      upstreamResponse.data.pipe(res, { end: false });

      // 监听流的结束和错误，确保连接正确关闭
      upstreamResponse.data.on('end', () => {
        log.info('[ImageGen] Upstream stream ended.');
        if (!sawDone && !res.writableEnded) {
          res.write('data: [DONE]\n\n');
        }
        if (!res.writableEnded) res.end();
      });

      upstreamResponse.data.on('error', (error) => {
        log.error('[ImageGen] Error in upstream stream:', error.message);
        if (!res.writableEnded) res.end();
      });

      bindClientDisconnect(res.req, res, () => {
        if (upstreamResponse.data && !upstreamResponse.data.destroyed) {
          upstreamResponse.data.destroy();
        }
      });

      // 因为我们正在手动处理流，所以在这里返回，防止后续代码执行
      return;
    }

    // 这部分代码现在只对非 useChatEndpoint 的情况执行
    log.info(`[ImageGen] Image generation successful, status: ${response.status}`);
    log.info(`[ImageGen] Response data:`, JSON.stringify(response.data));

    // 解析响应
    const imageData = parseImageResponse(response.data, apiType, false); // useChatEndpoint is false here
    log.info(`[ImageGen] Generated ${imageData.images.length} image(s)`);

    // 记录成功的API调用
    await logApiCall({
      provider: provider.name,
      model: modelId,
      success: true,
      duration: Date.now() - startedAt,
      firstTokenMs: Date.now() - startedAt,
      metadata: {
        apiKeyName: keyInfo?.key?.name || null,
        apiKeyId: keyInfo?.key?.id || null
      }
    });

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
    const errorDetails = parseErrorResponse(error)
    const errorMessage = formatErrorForLog(errorDetails)
    log.verbose(`[ImageGen] Parsed error details:`, errorDetails)

    // 记录失败的API调用
    await logApiCall({
      provider: provider.name,
      model: modelId,
      success: false,
      duration: Date.now() - startedAt,
      errorMessage,
      errorCode: errorDetails.code,
      metadata: {
        status: errorDetails.status,
        statusText: errorDetails.statusText,
        request: errorDetails.request,
        responseData: errorDetails.responseData,
        providerMessage: errorDetails.providerMessage,
        errorType: 'image_generation_error',
        apiKeyName: keyInfo?.key?.name || null,
        apiKeyId: keyInfo?.key?.id || null
      }
    })

    const wrapped = new Error(errorMessage);
    wrapped.details = errorDetails;
    throw wrapped;
  }
}

async function streamChat(provider, messages, params, res, modelId, images, systemPrompt, keyInfo = null, options = {}) {
  const apiType = getProviderChatApiType(provider);
  const url = buildApiUrl(provider.baseUrl, 'chat/completions', apiType, provider.customEndpoints);
  const startedAt = Date.now();
  const resolvedModel = modelId || provider.defaultModel;
  let logged = false;
  const skipRequestLog = options.skipRequestLog === true;
  const isPolling = options.isPolling === true;

  const logResult = (success, extras = {}) => {
    if (logged || skipRequestLog) return;
    logged = true;
    logChatUiRequest({
      res,
      provider,
      model: resolvedModel,
      success,
      duration: Date.now() - startedAt,
      firstTokenMs: extras.firstTokenMs,
      tokenUsage: extras.tokenUsage || null,
      errorMessage: extras.errorMessage || null,
      keyInfo,
      stream: true,
      endpoint: '/api/chat',
      isPolling,
      messageCount: Array.isArray(messages) ? messages.length : 0
    });
  };

  try {
    const requestBody = ensureStreamUsageOption(
      buildChatRequestBody(resolvedModel, messages, { ...params, stream: true }, apiType, images, systemPrompt, null, null),
      apiType
    );
    const headers = {
      ...buildProviderAuthHeaders(provider, keyInfo),
      'Content-Type': 'application/json'
    };

    const response = await axios.post(url, requestBody, {
      headers,
      responseType: 'stream',
      timeout: CONFIG.UPSTREAM_STREAM_TIMEOUT
    });

    const firstTokenProbe = createFirstTokenProbe(startedAt);
    const usageCollector = { tokenUsage: null, text: '' };
    let streamClosed = false;
    let streamSource = response.data;
    if (apiType === 'anthropic') {
      const converter = convertAnthropicStreamToOpenAI('anthropic');
      response.data.pipe(converter);
      streamSource = converter;
      response.data.on('error', (error) => {
        if (!converter.destroyed) converter.destroy(error);
      });
    }

    const cleanupStream = () => {
      if (streamClosed) return;
      streamClosed = true;
      response.data.removeAllListeners('data');
      response.data.removeAllListeners('end');
      response.data.removeAllListeners('error');
      if (streamSource !== response.data) {
        streamSource.removeAllListeners('data');
        streamSource.removeAllListeners('end');
        streamSource.removeAllListeners('error');
        if (!streamSource.destroyed) streamSource.destroy();
      }
      if (!response.data.destroyed) response.data.destroy();
    };

    await new Promise((resolve) => {
      let settled = false;
      let sawDone = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        watchdog.clear();
        resolve();
      };
      const finishClient = (payload) => {
        if (res.writableEnded) return;
        try {
          if (payload) res.write('data: ' + JSON.stringify(payload) + '\n\n');
          if (!sawDone) res.write('data: [DONE]\n\n');
        } catch (_) {}
        if (!res.writableEnded) res.end();
      };

      const watchdog = createIdleWatchdog(CONFIG.STREAM_TIMEOUT, () => {
        cleanupStream();
        finishClient({ error: 'Stream idle timeout' });
        settle();
      });

      streamSource.on('data', chunk => {
        watchdog.hit();
        firstTokenProbe.observe(chunk);
        collectSseUsageAndText(chunk, usageCollector);
        if (sseChunkIncludesDone(chunk)) sawDone = true;
        try {
          res.write(chunk);
        } catch (error) {
          log.error('Error writing chunk:', error);
          cleanupStream();
          if (!res.writableEnded) res.end();
          settle();
        }
      });

      streamSource.on('end', () => {
        cleanupStream();
        finishClient();
        settle();
      });

      streamSource.on('error', (error) => {
        log.error('Stream error:', error);
        cleanupStream();
        finishClient({ error: 'Stream error: ' + error.message });
        settle();
      });

      bindClientDisconnect(res.req, res, () => {
        cleanupStream();
        settle();
      });
    });

    firstTokenProbe.finish();
    let tokenUsage = usageCollector.tokenUsage;
    if (!tokenUsage) {
      tokenUsage = estimateTokenUsageFromMessages(messages, usageCollector.text);
    }
    logResult(true, {
      firstTokenMs: firstTokenProbe.firstTokenMs,
      tokenUsage
    });
    return {
      tokenUsage,
      firstTokenMs: firstTokenProbe.firstTokenMs,
      duration: Date.now() - startedAt,
      modelId: resolvedModel
    };
  } catch (error) {
    const errorDetails = parseErrorResponse(error);
    const errorMessage = formatErrorForLog(errorDetails);
    logResult(false, { errorMessage });
    throw error;
  }
}

// ==================== OpenAI API 兼容代理接口 ====================

// 验证代理 API Key 中间件 - 支持多密钥认证
async function verifyProxyApiKey(req, res, next) {
  const userSettings = await getUserSettings();
  const proxyKeys = userSettings.proxyApiKeys || {};
  const legacyKey = userSettings.proxyApiKey;
  
  // 从请求头获取 API Key，兼容 OpenAI 的 Bearer 和 Anthropic 的 x-api-key
  const authHeader = req.headers.authorization;
  const xApiKey = req.headers['x-api-key'];
  let providedKey = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.substring(7);
    req.proxyAuthType = 'bearer';
  } else if (Array.isArray(xApiKey) && xApiKey[0]?.trim()) {
    providedKey = xApiKey[0].trim();
    req.proxyAuthType = 'x-api-key';
  } else if (typeof xApiKey === 'string' && xApiKey.trim()) {
    providedKey = xApiKey.trim();
    req.proxyAuthType = 'x-api-key';
  }

  if (!providedKey) {
    return res.status(401).json({
      error: {
        message: 'Missing or invalid API key. Expected Authorization: Bearer <api_key> or x-api-key: <api_key>',
        type: 'invalid_request_error',
        code: 'invalid_api_key'
      }
    });
  }
  
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
      clientTag: 'normal',
      rateLimit: { requestsPerMinute: 60, requestsPerHour: 1000 }
    };
  }
  
  // 如果没有找到有效密钥
  if (!validKey) {
    // 默认不开放代理接口；如确实需要无密钥访问，可显式设置 ALLOW_OPEN_PROXY=true
    if (process.env.ALLOW_OPEN_PROXY === 'true' && Object.keys(proxyKeys).length === 0 && (!legacyKey || legacyKey.trim() === '')) {
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
      recordProxyKeyUsage(validKey.id);
    } catch (error) {
      console.error('Error updating key usage stats:', error);
    }
  }
  
  next();
}

function shouldReturnAnthropicModelFormat(req) {
  return (
    req.headers['anthropic-version'] ||
    req.headers['anthropic-beta'] ||
    getApiKeyClientTag(req.apiKeyInfo) === 'claude'
  );
}

function providerSupportsAnthropicProtocol(provider) {
  const chatEndpoint = String(provider?.customEndpoints?.chat || '').toLowerCase();

  return (
    (provider?.apiType || 'openai') === 'anthropic' ||
    chatEndpoint.includes('/messages')
  );
}

function providerSupportsOpenAIChatProtocol(provider) {
  return !providerSupportsAnthropicProtocol(provider);
}

function getProviderChatApiType(provider) {
  return providerSupportsAnthropicProtocol(provider) ? 'anthropic' : (provider?.apiType || 'openai');
}

app.get('/v1/health', verifyProxyApiKey, (req, res) => {
  res.json(buildHealthPayload());
});

async function getVisibleProxyModelIds(apiKeyInfo = null, options = {}) {
  const userSettings = await getUserSettings();
  const settings = await getApiSettings();
  const pollingConfig = userSettings.pollingConfig || { available: {}, excluded: {} };
  const providerFilter = typeof options.providerFilter === 'function' ? options.providerFilter : null;

  let availableModelNames = [];
  let availableModelsWithProvider = [];
  const usePolling = shouldUsePolling(apiKeyInfo);

  if (usePolling) {
    const availableModels = pollingConfig.available || {};
    for (const modelName of Object.keys(availableModels)) {
      if (getScopedPollingProviderIds(modelName, settings.providers, pollingConfig, apiKeyInfo, userSettings, options).length >= 1) {
        availableModelNames.push(modelName);
      }
    }
    availableModelNames = Array.from(new Set(availableModelNames));
  } else {
    (settings.providers || []).forEach(provider => {
      (provider.models || []).forEach(model => {
        if (model.visible === false) return;
        const normalizedName = normalizeModelName(model.id);
        if (!isProviderEligibleForModel(provider, normalizedName, userSettings, apiKeyInfo, {
          usePolling: false,
          providerFilter
        })) return;
        availableModelsWithProvider.push({
          id: buildExposedModelId(provider, model.id, settings.providers),
          providerId: provider.id,
          modelId: model.id,
          normalizedName
        });
      });
    });
    availableModelNames = chooseExposedModelIds(availableModelsWithProvider, apiKeyInfo);
  }

  const allowedModels = apiKeyInfo?.allowedModels || [];
  let filteredModels = availableModelNames;

  if (allowedModels.length > 0) {
    if (usePolling) {
      filteredModels = availableModelNames.filter(modelName =>
        isModelAllowedByApiKey(modelName, extractModelName(modelName), apiKeyInfo, true, settings.providers)
      );
    } else {
      filteredModels = chooseExposedModelIds(
        availableModelsWithProvider.filter(modelInfo =>
          isModelAllowedByApiKey(modelInfo.id, modelInfo.normalizedName, apiKeyInfo, false, settings.providers)
        ),
        apiKeyInfo
      );
    }
  }

  return {
    models: filteredModels,
    usePolling,
    allowedModels
  };
}

// OpenAI 兼容 - 获取模型列表（根据API密钥权限过滤）
async function handleModelsList(req, res) {
  try {
    const apiKeyInfo = req.apiKeyInfo;
    const useAnthropicFormat = shouldReturnAnthropicModelFormat(req);
    const { models: filteredModels, usePolling, allowedModels } = await getVisibleProxyModelIds(
      apiKeyInfo,
      useAnthropicFormat ? { providerFilter: providerSupportsAnthropicProtocol } : {}
    );
    const models = filteredModels.map(modelName =>
      useAnthropicFormat ? formatAnthropicModel(modelName) : formatOpenAIModel(modelName)
    );

    console.log(`[Models API] API Key: ${apiKeyInfo?.name || 'Legacy'}`);
    console.log(`[Models API] Auth Type: ${req.proxyAuthType || 'unknown'}, Client Tag: ${getApiKeyClientTag(apiKeyInfo) || 'none'}, Format: ${useAnthropicFormat ? 'anthropic' : 'openai'}`);
    console.log(`[Models API] Use Polling: ${usePolling}`);
    console.log(`[Models API] Allowed models: ${allowedModels.length > 0 ? allowedModels.join(', ') : 'All models'}`);
    console.log(`[Models API] Returned models: ${filteredModels.join(', ')}`);

    if (useAnthropicFormat && filteredModels.length === 0) {
      const { models: unfilteredModels } = await getVisibleProxyModelIds(apiKeyInfo, {});
      if (unfilteredModels.length > 0) {
        console.warn(`[Models API] Anthropic-compatible model list is empty, but ${unfilteredModels.length} non-Anthropic visible model(s) exist. Check provider client tags/apiType/custom messages endpoint.`);
      }
    }

    if (useAnthropicFormat) {
      return res.json({
        data: models,
        first_id: models[0]?.id || null,
        last_id: models[models.length - 1]?.id || null,
        has_more: false
      });
    }

    res.json({ object: 'list', data: models });
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
}

app.get('/v1/models', verifyProxyApiKey, handleModelsList);
app.get('/models', verifyProxyApiKey, handleModelsList);

async function handleModelDetail(req, res) {
  try {
    const useAnthropicFormat = shouldReturnAnthropicModelFormat(req);
    const { models } = await getVisibleProxyModelIds(
      req.apiKeyInfo,
      useAnthropicFormat ? { providerFilter: providerSupportsAnthropicProtocol } : {}
    );
    const requestedModel = req.params.modelId;
    const settings = await getApiSettings();
    const matchedModel = models.find(modelName => {
      if (modelName === requestedModel) return true;
      if (extractModelName(modelName) !== extractModelName(requestedModel)) return false;
      const listedProvider = getRequestedProviderId(modelName, settings.providers);
      const requestedProvider = getRequestedProviderId(requestedModel, settings.providers);
      if (listedProvider && requestedProvider) return listedProvider === requestedProvider;
      return !String(requestedModel).includes('::') && !String(modelName).includes('::');
    });

    if (!matchedModel) {
      return res.status(404).json({
        error: {
          message: `Model '${requestedModel}' not found or not allowed`,
          type: 'invalid_request_error',
          code: 'model_not_found'
        }
      });
    }

    return res.json(useAnthropicFormat ? formatAnthropicModel(matchedModel) : formatOpenAIModel(matchedModel));
  } catch (error) {
    console.error('Error getting model:', error);
    res.status(500).json({
      error: {
        message: error.message,
        type: 'server_error',
        code: 'internal_error'
      }
    });
  }
}

app.get('/v1/models/:modelId', verifyProxyApiKey, handleModelDetail);
app.get('/models/:modelId', verifyProxyApiKey, handleModelDetail);
app.get('/v1/models/*', verifyProxyApiKey, (req, res) => {
  req.params.modelId = req.params[0] || req.params.modelId;
  return handleModelDetail(req, res);
});
app.get('/models/*', verifyProxyApiKey, (req, res) => {
  req.params.modelId = req.params[0] || req.params.modelId;
  return handleModelDetail(req, res);
});

// Anthropic 兼容 - Messages（透传到 Anthropic 协议 Provider）
app.post('/v1/messages', verifyProxyApiKey, async (req, res) => {
  const traceId = generateTraceId();
  const perfTracker = new PerformanceTracker(traceId);
  perfTracker.checkpoint('request_start');

  const clientIp = req.ip || req.connection.remoteAddress ||
                   req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                   'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  const apiKeyName = req.apiKeyInfo?.name || 'unknown';

  try {
    const { model, messages, stream = false } = req.body || {};
    let sessionIdentifier = null;
    let isNewConversation = false;
    let waitForRpm = false;
    let stickConversation = false;
    let boundProvider = null;
    let boundKeyId = null;

    if (!model) {
      return res.status(400).json({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'model is required' }
      });
    }

    if (!Array.isArray(messages)) {
      return res.status(400).json({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'messages is required and must be an array' }
      });
    }

    const settings = await getApiSettings();
    const userSettings = await getUserSettings();
    const pollingConfig = userSettings.pollingConfig || { available: {}, excluded: {} };
    const pureModelName = extractModelName(model);
    const usePolling = shouldUsePolling(req.apiKeyInfo);
    const accessDenial = getProxyModelAccessDenial(model, pureModelName, settings.providers, pollingConfig, req.apiKeyInfo, userSettings, { providerFilter: providerSupportsAnthropicProtocol });
    if (accessDenial) {
      return res.status(accessDenial.status).json({
        type: 'error',
        error: {
          type: accessDenial.type,
          message: accessDenial.message
        }
      });
    }

    const providerAttempts = [];
    const errors = [];
    const triedProviderIds = [];
    cleanupExpiredConversations(userSettings);
    ({
      waitForRpm,
      stickConversation,
      sessionIdentifier,
      isNewConversation,
      boundProvider,
      boundKeyId
    } = resolveConversationStickState(req, messages, pureModelName, userSettings, settings.providers, pollingConfig));

    if (boundProvider) {
      setImmediate(() => {
        logSessionBind({
          traceId,
          sessionId: sessionIdentifier,
          model: pureModelName,
          providerId: boundProvider.id,
          providerName: boundProvider.name
        });
      });
    }

    const failoverProviders = buildStickyFailoverProviders({
      boundProvider,
      providers: settings.providers,
      modelName: pureModelName,
      pollingConfig,
      userSettings,
      apiKeyInfo: req.apiKeyInfo,
      waitForRpm,
      failoverOptions: { providerFilter: providerSupportsAnthropicProtocol, requestedModel: model }
    });

    if (failoverProviders.length === 0) {
      return res.status(503).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: `No available Anthropic protocol providers for model '${pureModelName}'`
        }
      });
    }

    for (let attempt = 0; attempt < failoverProviders.length; attempt++) {
      const selectedProvider = failoverProviders[attempt];
      const attemptStartedAt = Date.now();
      triedProviderIds.push(selectedProvider.id);

      const attemptPrepared = await prepareStickyProviderAttempt(selectedProvider, {
        errors,
        providerAttempts,
        attempt,
        attemptStartedAt,
        waitForRpm,
        boundProvider,
        boundKeyId,
        stickConversation,
        userSettings
      });
      if (attemptPrepared.rpmDecision === 'skip') {
        continue;
      }
      if (attemptPrepared.rpmDecision === 'exhausted') {
        return sendAnthropicFailoverExhausted(res, {
          errors,
          message: `Provider RPM limited for model '${pureModelName}'.`
        });
      }

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

      const { keyInfo, stickPolicy } = attemptPrepared;
      const providerModelId = await getProviderModelId(selectedProvider, pureModelName, keyInfo);
      if (!providerModelId) {
        const errorMessage = 'Model not found in provider';
        recordProviderAttempt(providerAttempts, {
          attempt: attempt + 1,
          provider: selectedProvider,
          status: 'failed',
          duration: Date.now() - attemptStartedAt,
          error: errorMessage
        });
        errors.push({ provider: selectedProvider.name, error: errorMessage });
        await incrementModelFailCount(selectedProvider.id, pureModelName, userSettings);
        await incrementKeyFailCount(keyInfo?.key?.id, userSettings);
        continue;
      }

      const url = buildApiUrl(selectedProvider.baseUrl, 'chat/completions', 'anthropic', selectedProvider.customEndpoints);
      const requestBody = {
        ...req.body,
        model: providerModelId
      };

      try {
        if (stream) {
          const response = await axios.post(url, requestBody, {
            headers: buildAnthropicProxyHeaders(selectedProvider, keyInfo, req),
            responseType: 'stream',
            timeout: CONFIG.UPSTREAM_STREAM_TIMEOUT,
            validateStatus: () => true
          });

          if (response.status < 200 || response.status >= 300) {
            let errorData = '';
            response.data.on('data', chunk => {
              errorData += chunk.toString();
            });
            await new Promise(resolve => response.data.on('end', resolve));
            const err = new Error(`HTTP ${response.status}: ${errorData}`);
            err.response = { status: response.status, statusText: response.statusText, data: errorData };
            throw err;
          }

          backgroundProcessor.handleSuccess(selectedProvider, pureModelName, userSettings, pollingConfig, sessionIdentifier, keyInfo, req.apiKeyInfo, stickPolicy);
          perfTracker.checkpoint('request_complete');
          const firstTokenProbe = createFirstTokenProbe(attemptStartedAt);
          let tokenUsage = null;
          let settleStream = null;
          const streamFinished = new Promise((resolve) => { settleStream = resolve; });
          const markStreamFinished = () => {
            firstTokenProbe.finish();
            if (settleStream) {
              const done = settleStream;
              settleStream = null;
              done();
            }
          };

          res.status(response.status);
          res.setHeader('Content-Type', response.headers['content-type'] || 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          bindClientDisconnect(req, res, () => {
            if (response.data && !response.data.destroyed) response.data.destroy();
          });
          response.data.on('data', (chunk) => {
            firstTokenProbe.observe(chunk);
            const lines = String(chunk).split(/\r?\n/);
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const payload = trimmed.slice(5).trim();
              if (!payload || payload === '[DONE]') continue;
              try {
                const capturedUsage = captureTokenUsageFromPayload(JSON.parse(payload));
                if (capturedUsage) tokenUsage = mergeCapturedTokenUsage(tokenUsage, capturedUsage);
              } catch {}
            }
          });
          response.data.on('end', () => markStreamFinished());
          response.data.on('error', (streamError) => {
            markStreamFinished();
            console.log(`[Anthropic Messages] Upstream stream error: ${streamError.message}`);
            if (!res.writableEnded) res.end();
          });
          response.data.pipe(res);
          const firstTokenMs = await firstTokenProbe.ready;
          await streamFinished;
          const attemptDuration = Date.now() - attemptStartedAt;
          recordProviderAttempt(providerAttempts, {
            attempt: attempt + 1,
            provider: selectedProvider,
            status: 'success',
            statusCode: response.status,
            duration: attemptDuration,
            firstTokenMs
          });

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
              providers: providerAttempts,
              result: {
                status: 'success',
                successfulProvider: selectedProvider.id,
                totalAttempts: providerAttempts.length,
                totalDuration: perfTracker.getTotalDuration(),
                tokenUsage,
                estimatedCost: null,
                firstTokenMs
              },
              metadata: { endpoint: 'messages', protocol: 'anthropic', failoverOccurred: attempt > 0 }
            });
          });
          return;
        }

        const response = await axios.post(url, requestBody, {
          headers: buildAnthropicProxyHeaders(selectedProvider, keyInfo, req),
          timeout: CONFIG.STREAM_TIMEOUT,
          validateStatus: () => true
        });

        if (response.status < 200 || response.status >= 300) {
          const err = new Error(`HTTP ${response.status}`);
          err.response = response;
          throw err;
        }

        backgroundProcessor.handleSuccess(selectedProvider, pureModelName, userSettings, pollingConfig, sessionIdentifier, keyInfo, req.apiKeyInfo, stickPolicy);
        perfTracker.checkpoint('request_complete');
        const attemptDuration = Date.now() - attemptStartedAt;
        recordProviderAttempt(providerAttempts, {
          attempt: attempt + 1,
          provider: selectedProvider,
          status: 'success',
          statusCode: response.status,
          duration: attemptDuration,
          firstTokenMs: attemptDuration
        });

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
            providers: providerAttempts,
            result: {
              status: 'success',
              successfulProvider: selectedProvider.id,
              totalAttempts: providerAttempts.length,
              totalDuration: perfTracker.getTotalDuration(),
              tokenUsage: normalizeTokenUsage(response.data?.usage, 'anthropic'),
              estimatedCost: null,
              firstTokenMs: attemptDuration
            },
            metadata: { endpoint: 'messages', protocol: 'anthropic', failoverOccurred: attempt > 0 }
          });
        });

        return res.status(response.status).json(response.data);
      } catch (error) {
        if (res.headersSent) {
          if (!res.writableEnded) res.end();
          return;
        }
        const errorDetails = parseErrorResponse(error);
        const errorMessage = formatErrorForLog(errorDetails);
        backgroundProcessor.handleFailure(selectedProvider, pureModelName, userSettings, errorMessage, keyInfo);
        recordProviderAttempt(providerAttempts, {
          attempt: attempt + 1,
          provider: selectedProvider,
          status: 'failed',
          statusCode: errorDetails.status,
          duration: Date.now() - attemptStartedAt,
          error: errorMessage
        });
        errors.push({
          provider: selectedProvider.name,
          error: errorMessage,
          status: errorDetails.status
        });
      }
    }

    backgroundProcessor.addTask(async () => {
      await savePollingState(userSettings);
    });

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
        providers: providerAttempts,
        result: {
          status: 'failed',
          successfulProvider: null,
          totalAttempts: providerAttempts.length,
          totalDuration: perfTracker.getTotalDuration(),
          tokenUsage: null,
          estimatedCost: null
        },
        metadata: { endpoint: 'messages', protocol: 'anthropic', failoverOccurred: triedProviderIds.length > 1 }
      });
    });

    return sendAnthropicFailoverExhausted(res, {
      errors,
      message: `All Anthropic providers failed for model '${pureModelName}'. Tried ${triedProviderIds.length} providers.`
    });
  } catch (error) {
    console.error('[Anthropic Messages] Unexpected error:', error);
    return res.status(500).json({
      type: 'error',
      error: {
        type: 'api_error',
        message: error.message
      }
    });
  }
});

// Anthropic 兼容 - Token 计数（不消耗轮询位置）
app.post('/v1/messages/count_tokens', verifyProxyApiKey, async (req, res) => {
  const traceId = generateTraceId();
  const perfTracker = new PerformanceTracker(traceId);
  perfTracker.checkpoint('request_start');

  const clientIp = req.ip || req.connection.remoteAddress ||
                   req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                   'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  const apiKeyName = req.apiKeyInfo?.name || 'unknown';

  try {
    const { model } = req.body || {};
    if (!model) {
      return res.status(400).json({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'model is required' }
      });
    }

    const settings = await getApiSettings();
    const userSettings = await getUserSettings();
    const pollingConfig = userSettings.pollingConfig || { available: {}, excluded: {} };
    const pureModelName = extractModelName(model);
    const usePolling = shouldUsePolling(req.apiKeyInfo);
    const accessDenial = getProxyModelAccessDenial(model, pureModelName, settings.providers, pollingConfig, req.apiKeyInfo, userSettings, { providerFilter: providerSupportsAnthropicProtocol });
    if (accessDenial) {
      return res.status(accessDenial.status).json({
        type: 'error',
        error: {
          type: accessDenial.type,
          message: accessDenial.message
        }
      });
    }

    const providerAttempts = [];
    const errors = [];
    const failoverProviders = limitFailoverProvidersForRequest(getFailoverProviders(
      settings.providers,
      pureModelName,
      pollingConfig,
      userSettings,
      [],
      req.apiKeyInfo,
      { providerFilter: providerSupportsAnthropicProtocol, reservePolling: false, requestedModel: model }
    ), userSettings, req.apiKeyInfo);

    if (failoverProviders.length === 0) {
      return res.status(503).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: `No available Anthropic protocol providers for model '${pureModelName}'`
        }
      });
    }

    for (let attempt = 0; attempt < failoverProviders.length; attempt++) {
      const selectedProvider = failoverProviders[attempt];
      const attemptStartedAt = Date.now();
      const attemptPrepared = await prepareStickyProviderAttempt(selectedProvider, {
        errors,
        providerAttempts,
        attempt,
        attemptStartedAt,
        waitForRpm: false,
        boundProvider: null,
        boundKeyId: null,
        stickConversation: false,
        userSettings
      });
      if (attemptPrepared.rpmDecision !== 'proceed') {
        continue;
      }
      const { keyInfo } = attemptPrepared;
      const providerModelId = await getProviderModelId(selectedProvider, pureModelName, keyInfo);

      if (!providerModelId) {
        const errorMessage = 'Model not found in provider';
        recordProviderAttempt(providerAttempts, {
          attempt: attempt + 1,
          provider: selectedProvider,
          status: 'failed',
          duration: Date.now() - attemptStartedAt,
          error: errorMessage
        });
        errors.push({ provider: selectedProvider.name, error: errorMessage });
        continue;
      }

      try {
        const url = buildApiUrl(selectedProvider.baseUrl, 'messages/count_tokens', 'anthropic', selectedProvider.customEndpoints);
        const response = await axios.post(url, {
          ...req.body,
          model: providerModelId
        }, {
          headers: buildAnthropicProxyHeaders(selectedProvider, keyInfo, req),
          timeout: CONFIG.REQUEST_TIMEOUT,
          validateStatus: () => true
        });

        if (response.status < 200 || response.status >= 300) {
          const err = new Error(`HTTP ${response.status}`);
          err.response = response;
          throw err;
        }

        perfTracker.checkpoint('request_complete');
        recordProviderAttempt(providerAttempts, {
          attempt: attempt + 1,
          provider: selectedProvider,
          status: 'success',
          statusCode: response.status,
          duration: Date.now() - attemptStartedAt
        });

        setImmediate(() => {
          logApiRequest({
            traceId,
            clientIp,
            userAgent,
            apiKeyName,
            sessionId: null,
            isPolling: usePolling,
            isNewConversation: false,
            request: { model: pureModelName, stream: false, messages: req.body?.messages || [] },
            providers: providerAttempts,
            result: {
              status: 'success',
              successfulProvider: selectedProvider.id,
              totalAttempts: providerAttempts.length,
              totalDuration: perfTracker.getTotalDuration(),
              tokenUsage: null,
              estimatedCost: null
            },
            metadata: { endpoint: 'messages/count_tokens', protocol: 'anthropic', pollingReserved: false, failoverOccurred: attempt > 0 }
          });
        });

        return res.status(response.status).json(response.data);
      } catch (error) {
        const errorDetails = parseErrorResponse(error);
        const errorMessage = formatErrorForLog(errorDetails);
        recordProviderAttempt(providerAttempts, {
          attempt: attempt + 1,
          provider: selectedProvider,
          status: 'failed',
          statusCode: errorDetails.status,
          duration: Date.now() - attemptStartedAt,
          error: errorMessage
        });
        errors.push({
          provider: selectedProvider.name,
          error: errorMessage,
          status: errorDetails.status
        });
      }
    }

    perfTracker.checkpoint('all_providers_failed');
    setImmediate(() => {
      logApiRequest({
        traceId,
        clientIp,
        userAgent,
        apiKeyName,
        sessionId: null,
        isPolling: usePolling,
        isNewConversation: false,
        request: { model: pureModelName, stream: false, messages: req.body?.messages || [] },
        providers: providerAttempts,
        result: {
          status: 'failed',
          successfulProvider: null,
          totalAttempts: providerAttempts.length,
          totalDuration: perfTracker.getTotalDuration(),
          tokenUsage: null,
          estimatedCost: null
        },
        metadata: { endpoint: 'messages/count_tokens', protocol: 'anthropic', pollingReserved: false, failoverOccurred: providerAttempts.length > 1 }
      });
    });

    return sendAnthropicFailoverExhausted(res, {
      errors,
      message: `All Anthropic token count providers failed for model '${pureModelName}'.`
    });
  } catch (error) {
    console.error('[Anthropic Count Tokens] Unexpected error:', error);
    return res.status(500).json({
      type: 'error',
      error: {
        type: 'api_error',
        message: error.message
      }
    });
  }
});

// OpenAI 兼容 - Responses（支持自动故障转移）
app.post('/v1/responses', verifyProxyApiKey, async (req, res) => {
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
    const {
      input,
      messages,
      model,
      stream = false,
      temperature,
      max_output_tokens,
      top_p,
      tools,
      tool_choice,
      instructions,
      system,
      ...otherParams
    } = req.body;
    let sessionIdentifier = null;
    let isNewConversation = false;
    let waitForRpm = false;
    let stickConversation = false;
    let boundProvider = null;
    let boundKeyId = null;

    // ==================== 打印客户端请求参数（便于调试） ====================
    console.log(`\n========== 新的 Responses 请求 ==========`);
    console.log(`[请求] 模型: ${model}`);
    console.log(`[请求] 流式: ${stream}`);
    console.log(`[请求] 输入类型: ${messages ? 'messages' : 'input'}`);
    console.log(`[请求] temperature: ${temperature !== undefined ? temperature : '未设置'}`);
    console.log(`[请求] max_output_tokens: ${max_output_tokens !== undefined ? max_output_tokens : '未设置'}`);
    console.log(`[请求] top_p: ${top_p !== undefined ? top_p : '未设置'}`);
    console.log(`[请求] tool_choice: ${tool_choice !== undefined ? JSON.stringify(tool_choice) : '未设置'}`);

    const otherParamKeys = Object.keys(otherParams);
    if (otherParamKeys.length > 0) {
      console.log(`[请求] 其他参数:`);
      otherParamKeys.forEach(key => {
        const value = otherParams[key];
        console.log(`  - ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
      });
    }

    if (tools && tools.length > 0) {
      console.log(`[请求] 工具列表:`);
      tools.forEach((tool, index) => {
        console.log(`  - 工具 ${index + 1}: ${tool.function?.name || tool.name || '未知'}`);
      });
    }
    console.log(`======================================\n`);

    let requestMessages = Array.isArray(messages)
      ? messages
      : responsesInputToMessages(input);

    const previousResponseId = typeof req.body?.previous_response_id === 'string'
      ? req.body.previous_response_id.trim()
      : '';
    if (previousResponseId) {
      requestMessages = mergeResponseContinuation(previousResponseId, requestMessages);
    }

    if (!requestMessages || !Array.isArray(requestMessages) || requestMessages.length === 0) {
      console.log(`[错误] input/messages 参数无效`);
      return sendErrorResponse(res, stream, {
        message: 'input or messages is required and must be a valid array',
        type: 'invalid_request_error',
        code: 'invalid_input'
      }, 400);
    }

    const settings = await getApiSettings();
    const userSettings = await getUserSettings();
    console.log(`[配置] 已加载 ${settings.providers.length} 个提供商`);
    const pollingConfig = userSettings.pollingConfig || { available: {}, excluded: {} };

    // ==================== 会话识别机制（混合模式） ====================
    cleanupExpiredConversations(userSettings);

    let modelName = model;
    if (!modelName) {
      console.log(`[错误] 未指定模型`);
      return sendErrorResponse(res, stream, {
        message: 'model is required. Please specify a model in the request.',
        type: 'invalid_request_error',
        code: 'model_required'
      }, 400);
    }

    const pureModelName = extractModelName(modelName);
    console.log(`[模型] 标准化模型名称: ${pureModelName}`);

    const usePolling = shouldUsePolling(req.apiKeyInfo);

    const accessDenial = getProxyModelAccessDenial(modelName, pureModelName, settings.providers, pollingConfig, req.apiKeyInfo, userSettings);
    if (accessDenial) {
      return sendErrorResponse(res, stream, {
        message: accessDenial.message,
        type: accessDenial.type,
        code: accessDenial.code
      }, accessDenial.status);
    }
    console.log(`[轮询] 轮询模式: ${usePolling ? '启用' : '禁用'}`);

    console.log(`[透传] Responses 请求将转换为 chat/completions 请求体`);

    ({
      waitForRpm,
      stickConversation,
      sessionIdentifier,
      isNewConversation,
      boundProvider,
      boundKeyId
    } = resolveConversationStickState(req, requestMessages, pureModelName, userSettings, settings.providers, pollingConfig));

    if (boundProvider) {
      setImmediate(() => {
        logSessionBind({
          traceId,
          sessionId: sessionIdentifier,
          model: pureModelName,
          providerId: boundProvider.id,
          providerName: boundProvider.name
        });
      });
    }

    const errors = [];
    const triedProviderIds = [];
    const providerAttempts = [];

    const failoverProviders = buildStickyFailoverProviders({
      boundProvider,
      providers: settings.providers,
      modelName: pureModelName,
      pollingConfig,
      userSettings,
      apiKeyInfo: req.apiKeyInfo,
      waitForRpm,
      failoverOptions: { requestedModel: modelName }
    });

    if (failoverProviders.length === 0) {
      console.log(`[错误] 模型 ${pureModelName} 没有可用的提供商`);
      return sendErrorResponse(res, stream, {
        message: `No available providers for model '${pureModelName}'`,
        type: 'server_error',
        code: 'no_providers_available'
      }, 503);
    }

    console.log(`[故障转移] 找到 ${failoverProviders.length} 个可用提供商`);

    const systemPrompt = typeof system === 'string' ? system : (typeof instructions === 'string' ? instructions : null);

    const requestParams = pickChatParamsFromResponsesExtras(otherParams);

    if (max_output_tokens !== undefined) {
      requestParams.max_tokens = max_output_tokens;
    }
    if (temperature !== undefined) {
      requestParams.temperature = temperature;
    }
    if (top_p !== undefined) {
      requestParams.top_p = top_p;
    }

    for (let attempt = 0; attempt < failoverProviders.length; attempt++) {
      const currentProvider = failoverProviders[attempt];
      const attemptStartedAt = Date.now();
      triedProviderIds.push(currentProvider.id);

      const attemptPrepared = await prepareStickyProviderAttempt(currentProvider, {
        errors,
        providerAttempts,
        attempt,
        attemptStartedAt,
        waitForRpm,
        boundProvider,
        boundKeyId,
        stickConversation,
        userSettings
      });
      if (attemptPrepared.rpmDecision === 'skip') {
        continue;
      }
      if (attemptPrepared.rpmDecision === 'exhausted') {
        return sendFailoverExhaustedResponse(res, stream, {
          errors,
          modelName: pureModelName,
          triedCount: triedProviderIds.length
        });
      }

      if (attempt > 0) {
        const prevProvider = failoverProviders[attempt - 1];
        console.log(`[故障转移] 切换提供商: ${prevProvider.name} -> ${currentProvider.name}`);
        setImmediate(() => {
          logProviderSwitch({
            traceId,
            fromProvider: prevProvider.name,
            toProvider: currentProvider.name,
            reason: `Previous provider failed: ${errors[errors.length - 1]?.error || 'Unknown error'}`
          });
        });
      }

      console.log(`[请求] 尝试 ${attempt + 1}/${failoverProviders.length}: 使用提供商 ${currentProvider.name} (ID: ${currentProvider.id})`);

      const { keyInfo, stickPolicy } = attemptPrepared;
      const providerModelId = await getProviderModelId(currentProvider, pureModelName, keyInfo);
      if (!providerModelId) {
        console.log(`[错误] 模型 ${pureModelName} 在提供商 ${currentProvider.name} 中未找到，尝试下一个...`);
        recordProviderAttempt(providerAttempts, {
          attempt: attempt + 1,
          provider: currentProvider,
          status: 'failed',
          duration: Date.now() - attemptStartedAt,
          error: 'Model not found in provider'
        });
        errors.push({
          provider: currentProvider.name,
          error: `Model not found in provider`
        });
        await incrementModelFailCount(currentProvider.id, pureModelName, userSettings);
        await incrementKeyFailCount(keyInfo?.key?.id, userSettings);
        continue;
      }

      console.log(`[请求] 使用模型ID: ${providerModelId}`);

      const apiType = getProviderChatApiType(currentProvider);
      console.log(`[请求] API 类型: ${apiType}`);
      const url = buildApiUrl(currentProvider.baseUrl, 'chat/completions', apiType, currentProvider.customEndpoints);
      console.log(`[请求] 目标URL: ${url}`);

      try {
        const headers = {
          ...buildProviderAuthHeaders(currentProvider, keyInfo, req),
          'Content-Type': 'application/json'
        };

        if (stream) {
          const requestBody = buildChatRequestBody(
            providerModelId,
            requestMessages,
            { ...requestParams, stream: true },
            apiType,
            null,
            systemPrompt,
            tools || null,
            tool_choice || null
          );
          console.log(`[流式] 发送 Responses 转换请求...`);
          const response = await axios.post(url, requestBody, {
            headers,
            responseType: 'stream',
            timeout: CONFIG.UPSTREAM_STREAM_TIMEOUT,
            validateStatus: () => true
          });
          if (response.status < 200 || response.status >= 300) {
            let errorData = '';
            response.data.on('data', chunk => { errorData += chunk.toString(); });
            await new Promise(resolve => response.data.on('end', resolve));
            const err = new Error(`HTTP ${response.status}: ${errorData}`);
            err.response = { status: response.status, data: errorData };
            throw err;
          }

          backgroundProcessor.handleSuccess(currentProvider, pureModelName, userSettings, pollingConfig, sessionIdentifier, keyInfo, req.apiKeyInfo, stickPolicy);
          let streamSource = response;
          if (apiType === 'anthropic') {
            const converter = convertAnthropicStreamToOpenAI('anthropic');
            response.data.pipe(converter);
            streamSource = { data: converter, raw: response.data };
          }
          const streamed = await streamChatCompletionAsResponses(streamSource, res, req, {
            requestMessages,
            modelId: providerModelId,
            startedAt: attemptStartedAt
          });
          if (stickConversation && streamed.responsePayload?.id) {
            saveConversationProvider(`resp:${streamed.responsePayload.id}`, pureModelName, currentProvider.id, userSettings, req.apiKeyInfo, {
              keyId: keyInfo?.key?.id || null
            });
          }
          perfTracker.checkpoint('request_complete');
          recordProviderAttempt(providerAttempts, {
            attempt: attempt + 1,
            provider: currentProvider,
            status: 'success',
            statusCode: response.status,
            duration: Date.now() - attemptStartedAt,
            firstTokenMs: streamed.firstTokenMs
          });
          setImmediate(() => {
            logApiRequest({
              traceId,
              clientIp,
              userAgent,
              apiKeyName,
              sessionId: sessionIdentifier,
              isPolling: usePolling,
              isNewConversation,
              request: { model: pureModelName, stream: true, messages: requestMessages },
              providers: providerAttempts,
              result: {
                status: 'success',
                successfulProvider: currentProvider.id,
                totalAttempts: providerAttempts.length,
                totalDuration: perfTracker.getTotalDuration(),
                tokenUsage: streamed.jsonData?.usage || null,
                estimatedCost: null,
                firstTokenMs: streamed.firstTokenMs
              },
              metadata: { failoverOccurred: attempt > 0, isStreaming: true }
            });
          });
          return;
        }

        const requestBody = buildChatRequestBody(
          providerModelId,
          requestMessages,
          { ...requestParams, stream: false },
          apiType,
          null,
          systemPrompt,
          tools || null,
          tool_choice || null
        );

        console.log(`[非流式] 发送 Responses 转换请求...`);

        const response = await axios.post(url, requestBody, {
          headers,
          timeout: CONFIG.STREAM_TIMEOUT
        });

        console.log(`[非流式] 请求成功，状态码: ${response.status}`);

        let jsonData = response.data;
        if (apiType === 'anthropic') {
          console.log('[DEBUG] Converting Anthropic response to OpenAI format for Responses');
          jsonData = convertAnthropicJsonToOpenAI(jsonData);
        }

        const responsePayload = buildResponsesFromChatCompletion(jsonData, providerModelId);
        const assistantMessage = completionMessageFromChat(jsonData);
        if (responsePayload?.id && assistantMessage) {
          saveResponseState(responsePayload.id, [...requestMessages, assistantMessage]);
        }

        backgroundProcessor.handleSuccess(currentProvider, pureModelName, userSettings, pollingConfig, sessionIdentifier, keyInfo, req.apiKeyInfo, stickPolicy);
        if (stickConversation && responsePayload?.id) {
          saveConversationProvider(`resp:${responsePayload.id}`, pureModelName, currentProvider.id, userSettings, req.apiKeyInfo, {
            keyId: keyInfo?.key?.id || null
          });
        }

        perfTracker.checkpoint('request_complete');
        const attemptDuration = Date.now() - attemptStartedAt;
        recordProviderAttempt(providerAttempts, {
          attempt: attempt + 1,
          provider: currentProvider,
          status: 'success',
          statusCode: response.status,
          duration: attemptDuration,
          firstTokenMs: attemptDuration
        });
        setImmediate(() => {
          logApiRequest({
            traceId,
            clientIp,
            userAgent,
            apiKeyName,
            sessionId: sessionIdentifier,
            isPolling: usePolling,
            isNewConversation,
            request: { model: pureModelName, stream, messages: requestMessages },
            providers: providerAttempts,
            result: {
              status: 'success',
              successfulProvider: currentProvider.id,
              totalAttempts: providerAttempts.length,
              totalDuration: perfTracker.getTotalDuration(),
              tokenUsage: jsonData?.usage || null,
              estimatedCost: null,
              firstTokenMs: attemptDuration
            },
            metadata: { failoverOccurred: attempt > 0, isStreaming: stream }
          });
        });

        return res.status(200).json(responsePayload);

      } catch (error) {
        console.log(`[错误] 提供商 ${currentProvider.name} 请求失败: ${error.message}`);

        if (res.headersSent) {
          if (!res.writableEnded) res.end();
          return;
        }

        const errorDetails = parseErrorResponse(error);
        const errorMessage = formatErrorForLog(errorDetails);

        backgroundProcessor.handleFailure(currentProvider, pureModelName, userSettings, errorMessage, keyInfo);
        recordProviderAttempt(providerAttempts, {
          attempt: attempt + 1,
          provider: currentProvider,
          status: 'failed',
          statusCode: errorDetails.status,
          duration: Date.now() - attemptStartedAt,
          error: errorMessage
        });

        errors.push({
          provider: currentProvider.name,
          error: errorMessage,
          status: error.response?.status
        });
      }
    }

    backgroundProcessor.addTask(async () => {
      await savePollingState(userSettings);
    });

    console.log(`[错误] 所有 ${triedProviderIds.length} 个提供商都失败了，模型: ${pureModelName}`);

    const errorDetails = errors.map(e => `${e.provider}: ${e.error}`).join('; ');
    console.log(`[错误] 详细错误: ${errorDetails}`);

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
        request: { model: pureModelName, stream, messages: requestMessages },
        providers: providerAttempts,
        result: {
          status: 'failed',
          successfulProvider: null,
          totalAttempts: providerAttempts.length,
          totalDuration: perfTracker.getTotalDuration(),
          tokenUsage: null,
          estimatedCost: null
        },
        metadata: { failoverOccurred: triedProviderIds.length > 1 }
      });
    });

    sendFailoverExhaustedResponse(res, stream, {
      errors,
      modelName: pureModelName,
      triedCount: triedProviderIds.length
    });

  } catch (error) {
    console.log(`[错误] 发生意外错误: ${error.message}`);

    perfTracker.checkpoint('error');
    setImmediate(() => {
      logApiRequest({
        traceId,
        clientIp,
        userAgent,
        apiKeyName,
        sessionId: null,
        isPolling: false,
        isNewConversation: false,
        request: { model: req.body?.model || 'unknown', stream: req.body?.stream === true, messages: [] },
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

    sendErrorResponse(res, req.body?.stream === true, {
      message: error.message,
      type: 'server_error',
      code: 'internal_error'
    });
  }
});

// OpenAI 兼容 - Embeddings（支持自动故障转移）
app.post('/v1/embeddings', verifyProxyApiKey, async (req, res) => {
  const traceId = generateTraceId();
  const perfTracker = new PerformanceTracker(traceId);
  perfTracker.checkpoint('request_start');

  const clientIp = req.ip || req.connection.remoteAddress ||
                   req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                   'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  const apiKeyName = req.apiKeyInfo?.name || 'unknown';

  try {
    const { input, model, ...otherParams } = req.body;

    console.log(`\n========== 新的 Embeddings 请求 ==========`);
    console.log(`[请求] 模型: ${model}`);
    console.log(`[请求] input类型: ${Array.isArray(input) ? 'array' : typeof input}`);

    const otherParamKeys = Object.keys(otherParams);
    if (otherParamKeys.length > 0) {
      console.log(`[请求] 其他参数:`);
      otherParamKeys.forEach(key => {
        const value = otherParams[key];
        console.log(`  - ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
      });
    }
    console.log(`========================================\n`);

    if (input === undefined || input === null || (Array.isArray(input) && input.length === 0)) {
      console.log(`[错误] input 参数无效`);
      return sendErrorResponse(res, false, {
        message: 'input is required and must not be empty',
        type: 'invalid_request_error',
        code: 'invalid_input'
      }, 400);
    }

    if (!model) {
      console.log(`[错误] 未指定模型`);
      return sendErrorResponse(res, false, {
        message: 'model is required. Please specify a model in the request.',
        type: 'invalid_request_error',
        code: 'model_required'
      }, 400);
    }

    const settings = await getApiSettings();
    const userSettings = await getUserSettings();
    console.log(`[配置] 已加载 ${settings.providers.length} 个提供商`);
    const pollingConfig = userSettings.pollingConfig || { available: {}, excluded: {} };

    const modelName = model;
    const pureModelName = extractModelName(modelName);
    console.log(`[模型] 标准化模型名称: ${pureModelName}`);

    const usePolling = shouldUsePolling(req.apiKeyInfo);
    const accessDenial = getProxyModelAccessDenial(modelName, pureModelName, settings.providers, pollingConfig, req.apiKeyInfo, userSettings, { providerFilter: providerSupportsOpenAIChatProtocol });
    if (accessDenial) {
      return sendErrorResponse(res, false, {
        message: accessDenial.message,
        type: accessDenial.type,
        code: accessDenial.code
      }, accessDenial.status);
    }
    console.log(`[轮询] 轮询模式: ${usePolling ? '启用' : '禁用'}`);

    const errors = [];
    const triedProviderIds = [];
    const providerAttempts = [];
    const failoverProviders = limitFailoverProvidersForRequest(
      getFailoverProviders(settings.providers, pureModelName, pollingConfig, userSettings, [], req.apiKeyInfo, { requestedModel: modelName, providerFilter: providerSupportsOpenAIChatProtocol }),
      userSettings,
      req.apiKeyInfo
    );

    if (failoverProviders.length === 0) {
      console.log(`[错误] 模型 ${pureModelName} 没有可用的提供商`);
      return sendErrorResponse(res, false, {
        message: `No available providers for model '${pureModelName}'`,
        type: 'server_error',
        code: 'no_providers_available'
      }, 503);
    }

    console.log(`[故障转移] 找到 ${failoverProviders.length} 个可用提供商`);

    for (let attempt = 0; attempt < failoverProviders.length; attempt++) {
      const selectedProvider = failoverProviders[attempt];
      const attemptStartedAt = Date.now();
      triedProviderIds.push(selectedProvider.id);

      const attemptPrepared = await prepareStickyProviderAttempt(selectedProvider, {
        errors,
        providerAttempts,
        attempt,
        attemptStartedAt,
        waitForRpm: false,
        boundProvider: null,
        boundKeyId: null,
        stickConversation: false,
        userSettings
      });
      if (attemptPrepared.rpmDecision !== 'proceed') {
        continue;
      }

      if (attempt > 0) {
        const prevProvider = failoverProviders[attempt - 1];
        console.log(`[故障转移] 切换提供商: ${prevProvider.name} -> ${selectedProvider.name}`);
        setImmediate(() => {
          logProviderSwitch({
            traceId,
            fromProvider: prevProvider.name,
            toProvider: selectedProvider.name,
            reason: `Previous provider failed: ${errors[errors.length - 1]?.error || 'Unknown error'}`
          });
        });
      }

      console.log(`[请求] 尝试 ${attempt + 1}/${failoverProviders.length}: 使用提供商 ${selectedProvider.name} (ID: ${selectedProvider.id})`);

      const { keyInfo } = attemptPrepared;
      const providerModelId = await getProviderModelId(selectedProvider, pureModelName, keyInfo);
      if (!providerModelId) {
        console.log(`[错误] 模型 ${pureModelName} 在提供商 ${selectedProvider.name} 中未找到，尝试下一个...`);
        recordProviderAttempt(providerAttempts, {
          attempt: attempt + 1,
          provider: selectedProvider,
          status: 'failed',
          duration: Date.now() - attemptStartedAt,
          error: 'Model not found in provider'
        });
        errors.push({
          provider: selectedProvider.name,
          error: 'Model not found in provider'
        });
        await incrementModelFailCount(selectedProvider.id, pureModelName, userSettings);
        await incrementKeyFailCount(keyInfo?.key?.id, userSettings);
        continue;
      }

      console.log(`[请求] 使用模型ID: ${providerModelId}`);

      const apiType = selectedProvider.apiType || 'openai';
      const url = buildApiUrl(selectedProvider.baseUrl, 'embeddings', apiType, selectedProvider.customEndpoints);
      console.log(`[请求] API 类型: ${apiType}`);
      console.log(`[请求] 目标URL: ${url}`);

      try {
        const requestBody = {
          ...req.body,
          model: providerModelId
        };

        const headers = {
          ...buildProviderAuthHeaders(selectedProvider, keyInfo, req),
          'Content-Type': 'application/json'
        };

        console.log(`[透传] 请求体参数:`);
        console.log(`  - model: ${requestBody.model}`);
        console.log(`  - input类型: ${Array.isArray(requestBody.input) ? 'array' : typeof requestBody.input}`);
        console.log(`  - encoding_format: ${requestBody.encoding_format !== undefined ? requestBody.encoding_format : '未设置'}`);
        console.log(`  - dimensions: ${requestBody.dimensions !== undefined ? requestBody.dimensions : '未设置'}`);

        const response = await axios.post(url, requestBody, {
          headers,
          timeout: CONFIG.REQUEST_TIMEOUT
        });

        console.log(`[非流式] Embeddings 请求成功，状态码: ${response.status}`);

        backgroundProcessor.handleSuccess(selectedProvider, pureModelName, userSettings, pollingConfig, null, keyInfo, req.apiKeyInfo);

        perfTracker.checkpoint('request_complete');
        recordProviderAttempt(providerAttempts, {
          attempt: attempt + 1,
          provider: selectedProvider,
          status: 'success',
          statusCode: response.status,
          duration: Date.now() - attemptStartedAt
        });
        setImmediate(() => {
          logApiRequest({
            traceId,
            clientIp,
            userAgent,
            apiKeyName,
            sessionId: null,
            isPolling: usePolling,
            isNewConversation: false,
            request: { model: pureModelName, inputType: Array.isArray(input) ? 'array' : typeof input },
            providers: providerAttempts,
            result: {
              status: 'success',
              successfulProvider: selectedProvider.id,
              totalAttempts: providerAttempts.length,
              totalDuration: perfTracker.getTotalDuration(),
              tokenUsage: response.data?.usage || null,
              estimatedCost: null
            },
            metadata: { failoverOccurred: attempt > 0, endpoint: 'embeddings' }
          });
        });

        return res.status(200).json(response.data);
      } catch (error) {
        console.log(`[错误] 提供商 ${selectedProvider.name} Embeddings 请求失败: ${error.message}`);

        const errorDetails = parseErrorResponse(error);
        const errorMessage = formatErrorForLog(errorDetails);

        backgroundProcessor.handleFailure(selectedProvider, pureModelName, userSettings, errorMessage, keyInfo);
        recordProviderAttempt(providerAttempts, {
          attempt: attempt + 1,
          provider: selectedProvider,
          status: 'failed',
          statusCode: errorDetails.status,
          duration: Date.now() - attemptStartedAt,
          error: errorMessage
        });

        errors.push({
          provider: selectedProvider.name,
          error: errorMessage,
          status: error.response?.status
        });
      }
    }

    backgroundProcessor.addTask(async () => {
      await savePollingState(userSettings);
    });

    const errorDetails = errors.map(e => `${e.provider}: ${e.error}`).join('; ');
    console.log(`[错误] 所有 ${triedProviderIds.length} 个提供商都失败了，模型: ${pureModelName}`);
    console.log(`[错误] 详细错误: ${errorDetails}`);

    perfTracker.checkpoint('all_providers_failed');
    setImmediate(() => {
      logApiRequest({
        traceId,
        clientIp,
        userAgent,
        apiKeyName,
        sessionId: null,
        isPolling: usePolling,
        isNewConversation: false,
        request: { model: pureModelName, inputType: Array.isArray(input) ? 'array' : typeof input },
        providers: providerAttempts,
        result: {
          status: 'failed',
          successfulProvider: null,
          totalAttempts: providerAttempts.length,
          totalDuration: perfTracker.getTotalDuration(),
          tokenUsage: null,
          estimatedCost: null
        },
        metadata: { failoverOccurred: triedProviderIds.length > 1, endpoint: 'embeddings' }
      });
    });

    return sendFailoverExhaustedResponse(res, false, {
      errors,
      modelName: pureModelName,
      triedCount: triedProviderIds.length
    });
  } catch (error) {
    console.log(`[错误] Embeddings 路由发生意外错误: ${error.message}`);

    perfTracker.checkpoint('error');
    setImmediate(() => {
      logApiRequest({
        traceId,
        clientIp,
        userAgent,
        apiKeyName,
        sessionId: null,
        isPolling: false,
        isNewConversation: false,
        request: { model: req.body?.model || 'unknown', inputType: Array.isArray(req.body?.input) ? 'array' : typeof req.body?.input },
        providers: [],
        result: {
          status: 'failed',
          successfulProvider: null,
          totalAttempts: 0,
          totalDuration: perfTracker.getTotalDuration(),
          tokenUsage: null,
          estimatedCost: null
        },
        metadata: { errorType: 'internal_error', errorMessage: error.message, endpoint: 'embeddings' }
      });
    });

    return sendErrorResponse(res, false, {
      message: error.message,
      type: 'server_error',
      code: 'internal_error'
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
    const { messages, model, stream = false, temperature, max_tokens, top_p, tools, tool_choice, ...otherParams } = req.body;
    let sessionIdentifier = null;
    let isNewConversation = false;
    let waitForRpm = false;
    let stickConversation = false;
    let boundProvider = null;
    let boundKeyId = null;

    // ==================== 打印客户端请求参数（便于调试） ====================
    console.log(`\n========== 新的 Chat Completion 请求 ==========`);
    console.log(`[请求] 模型: ${model}`);
    console.log(`[请求] 流式: ${stream}`);
    console.log(`[请求] 消息数量: ${messages ? messages.length : '未定义'}`);
    console.log(`[请求] 工具数量: ${tools ? tools.length : '无'}`);
    console.log(`[请求] temperature: ${temperature !== undefined ? temperature : '未设置'}`);
    console.log(`[请求] max_tokens: ${max_tokens !== undefined ? max_tokens : '未设置'}`);
    console.log(`[请求] top_p: ${top_p !== undefined ? top_p : '未设置'}`);
    console.log(`[请求] tool_choice: ${tool_choice !== undefined ? JSON.stringify(tool_choice) : '未设置'}`);

    // 打印其他参数
    const otherParamKeys = Object.keys(otherParams);
    if (otherParamKeys.length > 0) {
      console.log(`[请求] 其他参数:`);
      otherParamKeys.forEach(key => {
        const value = otherParams[key];
        console.log(`  - ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
      });
    }

    // 打印工具详情
    if (tools && tools.length > 0) {
      console.log(`[请求] 工具列表:`);
      tools.forEach((tool, index) => {
        console.log(`  - 工具 ${index + 1}: ${tool.function?.name || '未知'}`);
      });
    }
    console.log(`================================================\n`);

    if (!messages || !Array.isArray(messages)) {
      console.log(`[错误] messages 参数无效`);
      return sendErrorResponse(res, stream, {
        message: 'messages is required and must be an array',
        type: 'invalid_request_error',
        code: 'invalid_messages'
      }, 400);
    }

    const settings = await getApiSettings();
    const userSettings = await getUserSettings();
    console.log(`[配置] 已加载 ${settings.providers.length} 个提供商`);
    const pollingConfig = userSettings.pollingConfig || { available: {}, excluded: {} };
    
    // ==================== 会话识别机制（混合模式） ====================
    // 定期清理过期的会话映射
    cleanupExpiredConversations(userSettings);
    
    // 确定要使用的模型名称
    let modelName = model;

    if (!modelName) {
      console.log(`[错误] 未指定模型`);
      return sendErrorResponse(res, stream, {
        message: 'model is required. Please specify a model in the request.',
        type: 'invalid_request_error',
        code: 'model_required'
      }, 400);
    }

    // Extract pure model name (remove possible prefix)
    const pureModelName = extractModelName(modelName);
    console.log(`[模型] 标准化模型名称: ${pureModelName}`);

    // 判断是否使用轮询模式
    const usePolling = shouldUsePolling(req.apiKeyInfo);

    const accessDenial = getProxyModelAccessDenial(modelName, pureModelName, settings.providers, pollingConfig, req.apiKeyInfo, userSettings, { providerFilter: providerSupportsOpenAIChatProtocol });
    if (accessDenial) {
      return sendErrorResponse(res, stream, {
        message: accessDenial.message,
        type: accessDenial.type,
        code: accessDenial.code
      }, accessDenial.status);
    }
    console.log(`[轮询] 轮询模式: ${usePolling ? '启用' : '禁用'}`);
    
    // ==================== 透传模式：直接使用客户端请求体 ====================
    // 不再做参数覆盖或删除，所有参数原封不动透传给供应商
    console.log(`[透传] 透传模式已启用 - 所有客户端参数将直接转发给供应商`);
    if (tools && tools.length > 0) {
      console.log(`[透传] ${tools.length} 个工具将被透传给供应商`);
    }

    // ==================== 会话绑定机制：优先使用已绑定的提供商 ====================
    ({
      waitForRpm,
      stickConversation,
      sessionIdentifier,
      isNewConversation,
      boundProvider,
      boundKeyId
    } = resolveConversationStickState(req, messages, pureModelName, userSettings, settings.providers, pollingConfig));

    if (boundProvider) {
      setImmediate(() => {
        logSessionBind({
          traceId,
          sessionId: sessionIdentifier,
          model: pureModelName,
          providerId: boundProvider.id,
          providerName: boundProvider.name
        });
      });
    }
    
    // ==================== 自动故障转移逻辑 ====================
    const errors = []; // 收集所有失败的错误信息
    const triedProviderIds = []; // 记录已尝试的提供商ID
    const providerAttempts = [];
    
    const failoverProviders = buildStickyFailoverProviders({
      boundProvider,
      providers: settings.providers,
      modelName: pureModelName,
      pollingConfig,
      userSettings,
      apiKeyInfo: req.apiKeyInfo,
      waitForRpm,
      failoverOptions: { requestedModel: modelName, providerFilter: providerSupportsOpenAIChatProtocol }
    });
    
    if (failoverProviders.length === 0) {
      console.log(`[错误] 模型 ${pureModelName} 没有可用的提供商`);
      return sendErrorResponse(res, stream, {
        message: `No available providers for model '${pureModelName}'`,
        type: 'server_error',
        code: 'no_providers_available'
      }, 503);
    }

    console.log(`[故障转移] 找到 ${failoverProviders.length} 个可用提供商`);

    for (let attempt = 0; attempt < failoverProviders.length; attempt++) {
      const selectedProvider = failoverProviders[attempt];
      const attemptStartedAt = Date.now();

      triedProviderIds.push(selectedProvider.id);

      const attemptPrepared = await prepareStickyProviderAttempt(selectedProvider, {
        errors,
        providerAttempts,
        attempt,
        attemptStartedAt,
        waitForRpm,
        boundProvider,
        boundKeyId,
        stickConversation,
        userSettings
      });
      if (attemptPrepared.rpmDecision === 'skip') {
        continue;
      }
      if (attemptPrepared.rpmDecision === 'exhausted') {
        return sendFailoverExhaustedResponse(res, stream, {
          errors,
          modelName: pureModelName,
          triedCount: triedProviderIds.length
        });
      }

      // 记录提供商切换（非首次尝试时）
      if (attempt > 0) {
        const prevProvider = failoverProviders[attempt - 1];
        console.log(`[故障转移] 切换提供商: ${prevProvider.name} -> ${selectedProvider.name}`);
        setImmediate(() => {
          logProviderSwitch({
            traceId,
            fromProvider: prevProvider.name,
            toProvider: selectedProvider.name,
            reason: `Previous provider failed: ${errors[errors.length - 1]?.error || 'Unknown error'}`
          });
        });
      }

      console.log(`[请求] 尝试 ${attempt + 1}/${failoverProviders.length}: 使用提供商 ${selectedProvider.name} (ID: ${selectedProvider.id})`);

      const { keyInfo, stickPolicy } = attemptPrepared;

      // 获取该提供商的具体模型ID
      const providerModelId = await getProviderModelId(selectedProvider, pureModelName, keyInfo);
      if (!providerModelId) {
        console.log(`[错误] 模型 ${pureModelName} 在提供商 ${selectedProvider.name} 中未找到，尝试下一个...`);
        recordProviderAttempt(providerAttempts, {
          attempt: attempt + 1,
          provider: selectedProvider,
          status: 'failed',
          duration: Date.now() - attemptStartedAt,
          error: 'Model not found in provider'
        });
        errors.push({
          provider: selectedProvider.name,
          error: `Model not found in provider`
        });
        await incrementModelFailCount(selectedProvider.id, pureModelName, userSettings);
        await incrementKeyFailCount(keyInfo?.key?.id, userSettings);
        continue;
      }

      console.log(`[请求] 使用模型ID: ${providerModelId}`);

      const apiType = selectedProvider.apiType || 'openai';
      console.log(`[请求] API 类型: ${apiType}`);
      const url = buildApiUrl(selectedProvider.baseUrl, 'chat/completions', apiType, selectedProvider.customEndpoints);
      console.log(`[请求] 目标URL: ${url}`);

      if (stream) {
        // ==================== 流式响应（带故障转移） ====================
        console.log(`[流式] 开始流式请求...`);
        try {
          // 透传模式：直接使用客户端请求体，只替换 model 和 stream
          const requestBody = ensureStreamUsageOption({
            ...req.body,
            model: providerModelId,
            stream: true
          }, apiType);

          const headers = {
            ...buildProviderAuthHeaders(selectedProvider, keyInfo, req),
            'Content-Type': 'application/json'
          };

          // 打印透传的请求体详情
          console.log(`[透传] 请求体参数:`);
          console.log(`  - model: ${requestBody.model}`);
          console.log(`  - stream: ${requestBody.stream}`);
          console.log(`  - messages: ${requestBody.messages?.length || 0} 条`);
          console.log(`  - temperature: ${requestBody.temperature !== undefined ? requestBody.temperature : '未设置'}`);
          console.log(`  - max_tokens: ${requestBody.max_tokens !== undefined ? requestBody.max_tokens : '未设置'}`);
          console.log(`  - top_p: ${requestBody.top_p !== undefined ? requestBody.top_p : '未设置'}`);
          console.log(`  - tools: ${requestBody.tools ? requestBody.tools.length + ' 个' : '无'}`);
          console.log(`  - tool_choice: ${requestBody.tool_choice !== undefined ? JSON.stringify(requestBody.tool_choice) : '未设置'}`);
          console.log(`  - parallel_tool_calls: ${requestBody.parallel_tool_calls !== undefined ? requestBody.parallel_tool_calls : '未设置'}`);
          console.log(`  - stream_options: ${requestBody.stream_options !== undefined ? JSON.stringify(requestBody.stream_options) : '未设置'}`);

          // 打印工具详情
          if (requestBody.tools && requestBody.tools.length > 0) {
            console.log(`[透传] 工具详情:`);
            requestBody.tools.forEach((tool, index) => {
              const fn = tool.function || {};
              console.log(`  - 工具 ${index + 1}: ${fn.name || '未知'}`);
              if (fn.parameters) {
                console.log(`    strict: ${fn.parameters.strict !== undefined ? fn.parameters.strict : '未设置'}`);
                console.log(`    additionalProperties: ${fn.parameters.additionalProperties !== undefined ? fn.parameters.additionalProperties : '未设置'}`);
              }
            });
          }

          console.log(`[流式] 发送请求...`);

          const response = await axios.post(url, requestBody, {
            headers,
            responseType: 'stream',
            timeout: CONFIG.UPSTREAM_STREAM_TIMEOUT,
            validateStatus: function (status) {
              // 接受所有状态码，让我们自己处理错误
              return true;
            }
          });

          console.log(`[流式] 收到响应，状态码: ${response.status}`);

          // 检查响应状态
          if (response.status < 200 || response.status >= 300) {
            console.log(`[错误] 非200状态码: ${response.status}`);

            // 读取错误响应
            let errorData = '';
            response.data.on('data', chunk => {
              errorData += chunk.toString();
            });

            await new Promise((resolve) => {
              response.data.on('end', () => {
                console.log(`[错误] 响应内容: ${errorData}`);
                resolve();
              });
            });

            throw new Error(`HTTP ${response.status}: ${errorData}`);
          }

          console.log(`[流式] 请求成功，开始处理流式响应...`);

          // Use simplified streaming response handler
          // 透传模式：跳过格式转换器，直接透传数据
          const streamResult = await handleStreamingResponse(response, res, stream, selectedProvider, pureModelName, userSettings, pollingConfig, sessionIdentifier, apiType, messages, true, keyInfo, req.apiKeyInfo, stickPolicy, attemptStartedAt);
          const attemptDuration = Date.now() - attemptStartedAt;

          // Stream request successfully initiated, exit loop
          console.log(`[流式] 流式响应处理完成`);

          // 记录API请求日志（非阻塞）
          perfTracker.checkpoint('request_complete');
          recordProviderAttempt(providerAttempts, {
            attempt: attempt + 1,
            provider: selectedProvider,
            status: 'success',
            statusCode: response.status,
            duration: attemptDuration,
            firstTokenMs: streamResult?.firstTokenMs,
            providerModelId
          });
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
              providers: providerAttempts,
              result: {
                status: 'success',
                successfulProvider: selectedProvider.id,
                totalAttempts: providerAttempts.length,
                totalDuration: perfTracker.getTotalDuration(),
                tokenUsage: streamResult?.tokenUsage || null,
                estimatedCost: null,
                firstTokenMs: streamResult?.firstTokenMs
              },
              metadata: {
                endpoint: '/v1/chat/completions',
                source: 'proxy',
                failoverOccurred: attempt > 0,
                isStreaming: true,
                providerModelId
              }
            });
          });

          return;

        } catch (error) {
          console.log(`[错误] 提供商 ${selectedProvider.name} 请求失败: ${error.message}`);
          if (error.response) {
            console.log(`[错误] 响应状态码: ${error.response.status}`);
          }

          if (res.headersSent) {
            if (!res.writableEnded) res.end();
            return;
          }

          // Use efficient error parser
          const errorDetails = parseErrorResponse(error);
          const errorMessage = formatErrorForLog(errorDetails);

          // Handle failure in background (non-blocking)
          backgroundProcessor.handleFailure(selectedProvider, pureModelName, userSettings, errorMessage, keyInfo);
          recordProviderAttempt(providerAttempts, {
            attempt: attempt + 1,
            provider: selectedProvider,
            status: 'failed',
            statusCode: errorDetails.status,
            duration: Date.now() - attemptStartedAt,
            error: errorMessage
          });

          errors.push({
            provider: selectedProvider.name,
            error: errorMessage,
            status: error.response?.status
          });
          // Continue trying next provider
        }

      } else {
        // ==================== 非流式响应（带故障转移） ====================
        console.log(`[非流式] 开始非流式请求...`);
        try {
          // 透传模式：直接使用客户端请求体，只替换 model 和 stream
          const requestBody = {
            ...req.body,
            model: providerModelId,
            stream: false
          };

          const headers = {
            ...buildProviderAuthHeaders(selectedProvider, keyInfo, req),
            'Content-Type': 'application/json'
          };

          // 打印透传的请求体详情
          console.log(`[透传] 请求体参数:`);
          console.log(`  - model: ${requestBody.model}`);
          console.log(`  - stream: ${requestBody.stream}`);
          console.log(`  - messages: ${requestBody.messages?.length || 0} 条`);
          console.log(`  - temperature: ${requestBody.temperature !== undefined ? requestBody.temperature : '未设置'}`);
          console.log(`  - max_tokens: ${requestBody.max_tokens !== undefined ? requestBody.max_tokens : '未设置'}`);
          console.log(`  - top_p: ${requestBody.top_p !== undefined ? requestBody.top_p : '未设置'}`);
          console.log(`  - tools: ${requestBody.tools ? requestBody.tools.length + ' 个' : '无'}`);
          console.log(`  - tool_choice: ${requestBody.tool_choice !== undefined ? JSON.stringify(requestBody.tool_choice) : '未设置'}`);
          console.log(`  - parallel_tool_calls: ${requestBody.parallel_tool_calls !== undefined ? requestBody.parallel_tool_calls : '未设置'}`);

          // 打印工具详情
          if (requestBody.tools && requestBody.tools.length > 0) {
            console.log(`[透传] 工具详情:`);
            requestBody.tools.forEach((tool, index) => {
              const fn = tool.function || {};
              console.log(`  - 工具 ${index + 1}: ${fn.name || '未知'}`);
              if (fn.parameters) {
                console.log(`    strict: ${fn.parameters.strict !== undefined ? fn.parameters.strict : '未设置'}`);
                console.log(`    additionalProperties: ${fn.parameters.additionalProperties !== undefined ? fn.parameters.additionalProperties : '未设置'}`);
              }
            });
          }

         console.log(`[非流式] 发送请求...`);

         const response = await axios.post(url, requestBody, {
           headers,
            timeout: CONFIG.STREAM_TIMEOUT
         });

          console.log(`[非流式] 请求成功，状态码: ${response.status}`);

          // Handle success in background (non-blocking)
          backgroundProcessor.handleSuccess(selectedProvider, pureModelName, userSettings, pollingConfig, sessionIdentifier, keyInfo, req.apiKeyInfo, stickPolicy);

          console.log(`[非流式] 使用提供商 ${selectedProvider.name} 完成请求`);

          // 记录API请求日志（非阻塞）
          perfTracker.checkpoint('request_complete');
          const attemptDuration = Date.now() - attemptStartedAt;
          recordProviderAttempt(providerAttempts, {
            attempt: attempt + 1,
            provider: selectedProvider,
            status: 'success',
            statusCode: response.status,
            duration: attemptDuration,
            firstTokenMs: attemptDuration,
            providerModelId
          });
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
              providers: providerAttempts,
              result: {
                status: 'success',
                successfulProvider: selectedProvider.id,
                totalAttempts: providerAttempts.length,
                totalDuration: perfTracker.getTotalDuration(),
                tokenUsage: response.data?.usage || null,
                firstTokenMs: attemptDuration,
                estimatedCost: null,  // TODO: 添加成本计算
              },
              metadata: {
                endpoint: '/v1/chat/completions',
                source: 'proxy',
                failoverOccurred: attempt > 0,
                providerModelId
              }
            });
          });

          return res.status(200).json(response.data);

        } catch (error) {
          console.log(`[错误] 提供商 ${selectedProvider.name} 非流式请求失败: ${error.message}`);

          // Use efficient error parser
          const errorDetails = parseErrorResponse(error);
          const errorMessage = formatErrorForLog(errorDetails);

          // Handle failure in background (non-blocking)
          backgroundProcessor.handleFailure(selectedProvider, pureModelName, userSettings, errorMessage, keyInfo);
          recordProviderAttempt(providerAttempts, {
            attempt: attempt + 1,
            provider: selectedProvider,
            status: 'failed',
            statusCode: errorDetails.status,
            duration: Date.now() - attemptStartedAt,
            error: errorMessage
          });

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

    console.log(`[错误] 所有 ${triedProviderIds.length} 个提供商都失败了，模型: ${pureModelName}`);

    // Build detailed error information
    const errorDetails = errors.map(e => `${e.provider}: ${e.error}`).join('; ');
    console.log(`[错误] 详细错误: ${errorDetails}`);

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
        providers: providerAttempts,
        result: {
          status: 'failed',
          successfulProvider: null,
          totalAttempts: providerAttempts.length,
          totalDuration: perfTracker.getTotalDuration(),
          tokenUsage: null,
          estimatedCost: null
        },
        metadata: { failoverOccurred: triedProviderIds.length > 1 }
      });
    });

    sendFailoverExhaustedResponse(res, stream, {
      errors,
      modelName: pureModelName,
      triedCount: triedProviderIds.length
    });

  } catch (error) {
    console.log(`[错误] 发生意外错误: ${error.message}`);

    // 记录异常错误日志（非阻塞）
    perfTracker.checkpoint('error');
    setImmediate(() => {
      logApiRequest({
        traceId,
        clientIp,
        userAgent,
        apiKeyName,
        sessionId: null,
        isPolling: shouldUsePolling(req.apiKeyInfo),
        isNewConversation: false,
        request: { model: req.body?.model || 'unknown', stream: req.body?.stream === true, messages: req.body?.messages || [] },
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

    sendErrorResponse(res, req.body?.stream === true, {
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
      ...proxyKeys[id],
      allowedProviders: proxyKeys[id].allowedProviders || []
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
    const { name, description, clientTag } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: '密钥名称不能为空' });
    }
    
    const userSettings = await getUserSettings();
    if (!userSettings.proxyApiKeys) {
      userSettings.proxyApiKeys = {};
    }
    
    const keyId = createEntityId();
    const apiKey = generateApiKey();
    const resolvedClientTag = VALID_CLIENT_TAGS.includes(clientTag) ? clientTag : 'normal';
    
    const newKey = {
      name: name.trim(),
      description: description || '',
      apiKey: apiKey,
      enabled: true,
      createdAt: new Date().toISOString(),
      lastUsed: null,
      usageCount: 0,
      // 透传模式下不再需要默认参数，所有参数由客户端提供
      allowedModels: [],
      allowedGroups: [], // 新增：允许的分组
      allowedProviders: [],
      allowedPollingGroups: [],
      allowedPollingProviders: [],
      usePolling: !AGENT_CLIENT_TAGS.includes(resolvedClientTag),
      clientTag: resolvedClientTag,
      rateLimit: {
        requestsPerMinute: 60,
        requestsPerHour: 1000
      }
    };
    
    userSettings.proxyApiKeys[keyId] = newKey;
    
    persistAllUserSettings(userSettings);
    
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
    
    const allowedUpdates = {};
    if (updates.name !== undefined) {
      const name = String(updates.name || '').trim();
      if (!name) {
        return res.status(400).json({ error: '密钥名称不能为空' });
      }
      allowedUpdates.name = name;
    }
    if (updates.description !== undefined) {
      allowedUpdates.description = String(updates.description || '');
    }
    if (updates.enabled !== undefined) {
      allowedUpdates.enabled = updates.enabled !== false && updates.enabled !== 'false';
    }
    if (updates.clientTag !== undefined) {
      allowedUpdates.clientTag = VALID_CLIENT_TAGS.includes(updates.clientTag) ? updates.clientTag : 'normal';
    }
    const nextTag = allowedUpdates.clientTag ?? userSettings.proxyApiKeys[keyId].clientTag;
    if (AGENT_CLIENT_TAGS.includes(nextTag)) {
      allowedUpdates.usePolling = false;
    } else if (updates.usePolling !== undefined) {
      allowedUpdates.usePolling = updates.usePolling !== false && updates.usePolling !== 'false';
    }
    ['allowedModels', 'allowedGroups', 'allowedProviders', 'allowedPollingGroups', 'allowedPollingProviders'].forEach((field) => {
      if (updates[field] === undefined) return;
      allowedUpdates[field] = Array.isArray(updates[field])
        ? updates[field].filter(value => typeof value === 'string' && value.trim())
        : [];
    });

    Object.assign(userSettings.proxyApiKeys[keyId], allowedUpdates);
    
    persistAllUserSettings(userSettings);
    
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
    
    persistAllUserSettings(userSettings);
    
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
    
    persistAllUserSettings(userSettings);
    
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

    if (type) {
      const types = String(type).split(',').map(item => item.trim()).filter(Boolean);
      const invalidType = types.find(item => !validTypes.includes(item));
      if (invalidType) {
        return res.status(400).json({ error: `无效的日志类型，可选值: ${validTypes.join(', ')}` });
      }
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
    const { level, type } = req.query;

    // 验证级别和类型
    const validLevels = Object.values(LogLevel);
    const validTypes = Object.values(LogType);

    if (level && !validLevels.includes(level)) {
      return res.status(400).json({ error: `无效的日志级别，可选值: ${validLevels.join(', ')}` });
    }

    if (type) {
      const types = String(type).split(',').map(item => item.trim()).filter(Boolean);
      const invalidType = types.find(item => !validTypes.includes(item));
      if (invalidType) {
        return res.status(400).json({ error: `无效的日志类型，可选值: ${validTypes.join(', ')}` });
      }
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 添加日志监听器
    const removeListener = addLogListener((logEntry) => {
      // 根据过滤条件决定是否发送
      if (level && logEntry.level !== level) return;
      if (type) {
        const types = String(type).split(',').map(item => item.trim()).filter(Boolean);
        if (types.length && !types.includes(logEntry.type)) return;
      }

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
    if (res.headersSent) {
      try {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      } catch (_) {}
      return res.end();
    }
    return res.status(500).json({ error: error.message });
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

// 处理 SPA 路由
app.get('*', (req, res) => {
  if (isPublicCompatPath(req.path)) {
    return res.status(404).json({
      error: {
        message: `Unknown path ${req.path}`,
        type: 'invalid_request_error',
        code: 'not_found'
      }
    });
  }
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

initDataDir().then(async () => {
  initializeDatabase();
  try {
    const migrationResult = await migrateJsonDataToSqlite();
    if (migrationResult?.migrated) {
      console.log('[SQLite] JSON 数据已迁移到 SQLite');
    } else {
      console.log('[SQLite] 跳过迁移:', migrationResult?.reason || 'unknown');
    }
  } catch (error) {
    console.error('[SQLite] 数据迁移失败:', error);
  }

  ensureDefaultAdminUser();
  cleanupExpiredSessions();
  setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

  const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`OpenAI compatible API available at http://localhost:${PORT}/v1`);
  });
  server.timeout = 0;
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 0;
}).catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

function shutdown() {
  try {
    if (userSettingsCache) {
      saveHotUserStateToDb(userSettingsCache);
    }
    flushProxyKeyUsage();
    closeDatabase();
  } catch (error) {
    console.error('Error flushing state on shutdown:', error);
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
