const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const { logApiCall, logSystemEvent, readLogs, parseLogsForStats, deleteLogs, clearAllLogs } = require('./logger');

const app = express();
const PORT = 3000;

// Performance optimization: Add debug mode control
const DEBUG_MODE = process.env.NODE_ENV !== 'production';
const VERBOSE_LOGGING = process.env.VERBOSE_LOGGING === 'true';

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

// 性能优化：添加内存缓存
let apiSettingsCache = null;
let userSettingsCache = null;
let apiSettingsCacheTime = 0;
let userSettingsCacheTime = 0;
const CACHE_TTL = 5000; // 5秒缓存

// Performance optimization: Enhanced HTTP agents with better configuration
const httpAgent = new require('http').Agent({
  keepAlive: true,
  maxSockets: 100, // Increased from 50
  maxFreeSockets: 10,
  timeout: 30000,
  freeSocketTimeout: 30000, // Free socket timeout
  socketActiveTTL: 60000 // Socket active TTL
});
const httpsAgent = new require('https').Agent({
  keepAlive: true,
  maxSockets: 100, // Increased from 50
  maxFreeSockets: 10,
  timeout: 30000,
  freeSocketTimeout: 30000, // Free socket timeout
  socketActiveTTL: 60000 // Socket active TTL
});

// 配置 axios 默认设置
axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;
axios.defaults.timeout = 30000;

// 初始化数据目录
async function initDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(CONVERSATIONS_DIR, { recursive: true });
  await fs.mkdir(LOGS_DIR, { recursive: true });
  
  try {
    await fs.access(API_SETTINGS_FILE);
    // 数据迁移：为旧的提供商添加apiType字段
    const data = JSON.parse(await fs.readFile(API_SETTINGS_FILE, 'utf8'));
    let updated = false;
    if (data.providers) {
      data.providers.forEach(provider => {
        if (provider.apiType === undefined) {
          provider.apiType = 'openai';
          updated = true;
        }
      });
    }
    if (updated) {
      await fs.writeFile(API_SETTINGS_FILE, JSON.stringify(data, null, 2));
      invalidateApiSettingsCache();
      console.log('Data migration: Added apiType to existing providers.');
    }
  } catch {
    await fs.writeFile(API_SETTINGS_FILE, JSON.stringify({
      providers: [],
      groups: [
        { id: 'default', name: '默认分组', description: '未分组的提供商' }
      ]
    }, null, 2));
  }
  
  try {
    await fs.access(USER_SETTINGS_FILE);
  } catch {
    await fs.writeFile(USER_SETTINGS_FILE, JSON.stringify({
      defaultParams: { temperature: 0.7, max_tokens: 2000, top_p: 1 },
      globalFrequency: 10,
      pollingConfig: { available: {}, excluded: {}, disabled: {} },
      pollingState: {}, // 存储每个模型的轮询状态
      modelFailCounts: {}, // 存储每个模型在每个提供商的失败计数
      proxyApiKey: '', // 代理接口密钥（向后兼容）
      proxyApiKeys: {}, // 多API密钥管理
      conversationProviderMap: {} // 会话-提供商映射（用于对话连续性）
    }, null, 2));
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
      await fs.writeFile(API_SETTINGS_FILE, JSON.stringify(newSettings, null, 2));
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
    await fs.writeFile(API_SETTINGS_FILE, JSON.stringify(newSettings, null, 2));
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
  await fs.writeFile(API_SETTINGS_FILE, JSON.stringify(data, null, 2));
  invalidateApiSettingsCache(); // 缓存失效
  res.json(newProvider);
});

app.put('/api/providers/:id', async (req, res) => {
  const data = await getApiSettings();
  const index = data.providers.findIndex(p => p.id === req.params.id);
  if (index !== -1) {
    data.providers[index] = { ...data.providers[index], ...req.body };
    await fs.writeFile(API_SETTINGS_FILE, JSON.stringify(data, null, 2));
    invalidateApiSettingsCache(); // 缓存失效
    res.json(data.providers[index]);
  } else {
    res.status(404).json({ error: 'Provider not found' });
  }
});

app.delete('/api/providers/:id', async (req, res) => {
  const data = await getApiSettings();
  data.providers = data.providers.filter(p => p.id !== req.params.id);
  await fs.writeFile(API_SETTINGS_FILE, JSON.stringify(data, null, 2));
  invalidateApiSettingsCache(); // 缓存失效
  res.json({ success: true });
});

app.get('/api/providers/:id/models', async (req, res) => {
  const data = await getApiSettings();
  const provider = data.providers.find(p => p.id === req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  
  try {
    const apiType = provider.apiType || 'openai';
    const url = buildApiUrl(provider.baseUrl, 'models', apiType);
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

app.get('/api/providers/:id/test', async (req, res) => {
  const data = await getApiSettings();
  const provider = data.providers.find(p => p.id === req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  
  try {
    const apiType = provider.apiType || 'openai';
    const url = buildApiUrl(provider.baseUrl, 'models', apiType);
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
  await fs.writeFile(API_SETTINGS_FILE, JSON.stringify(data, null, 2));
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
  
  await fs.writeFile(API_SETTINGS_FILE, JSON.stringify(data, null, 2));
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
  await fs.writeFile(API_SETTINGS_FILE, JSON.stringify(data, null, 2));
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
  await fs.writeFile(API_SETTINGS_FILE, JSON.stringify(data, null, 2));
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
  await fs.writeFile(path.join(CONVERSATIONS_DIR, `${conversation.id}.json`), JSON.stringify(conversation, null, 2));
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
  await fs.writeFile(filePath, JSON.stringify(req.body, null, 2));
  res.json(req.body);
});

app.delete('/api/conversations/:id', async (req, res) => {
  await fs.unlink(path.join(CONVERSATIONS_DIR, `${req.params.id}.json`));
  res.json({ success: true });
});

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
  const { messages, model, params, polling, images } = req.body;
  const settings = await getApiSettings();
  const userSettings = await getUserSettings();
  
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
    
    // 使用新的轮询机制获取下一个提供商
    const selectedProvider = getNextPollingProvider(settings.providers, modelName, userSettings.pollingConfig, userSettings);
    
    if (!selectedProvider) {
      console.log(`No polling providers available for model ${modelName}`);
      res.write(`data: ${JSON.stringify({ error: `模型 ${modelName} 没有可用的轮询提供商或已被排除` })}\n\n`);
      res.end();
      return;
    }
    
    try {
      console.log(`Using selected provider ${selectedProvider.name} (ID: ${selectedProvider.id}) for model ${modelName}`);
      
      // 获取该提供商的具体模型ID
      const modelId = await getProviderModelId(selectedProvider, modelName);
      if (!modelId) {
        console.log(`Model ${modelName} not found in provider ${selectedProvider.name}`);
        throw new Error(`模型 ${modelName} 在提供商 ${selectedProvider.name} 中不存在`);
      }
      
      console.log(`Using model ID: ${modelId} from provider ${selectedProvider.name}`);
      
      await streamChat(selectedProvider, messages, params, res, modelId, images);
      
      // 如果成功，重置模型失败计数并保存轮询状态
      await resetModelFailCount(selectedProvider.id, modelName, userSettings);
      
      // 保存轮询状态
      await savePollingState(userSettings);
      
      console.log(`Successfully used provider ${selectedProvider.name} for model ${modelName}`);
      return;
      
    } catch (error) {
      console.error(`Provider ${selectedProvider.name} failed:`, error.message);
      console.error(`Error details:`, error);
      
      // 增加模型失败计数
      await incrementModelFailCount(selectedProvider.id, modelName, userSettings);
      
      // 保存轮询状态（即使失败也要保存，以便下次轮询到其他提供商）
      await savePollingState(userSettings);
      
      // 返回错误信息
      const errorMessage = error.message || 'Provider failed';
      res.write(`data: ${JSON.stringify({ error: `轮询失败: ${errorMessage}` })}\n\n`);
      res.end();
    }
  } else {
    const [providerId, modelId] = model.split('::');
    const provider = settings.providers.find(p => p.id === providerId);
    if (!provider) {
      res.write(`data: ${JSON.stringify({ error: 'Provider not found' })}\n\n`);
      return res.end();
    }
    
    try {
      await streamChat(provider, messages, params, res, modelId, images);
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
  await fs.writeFile(USER_SETTINGS_FILE, JSON.stringify(req.body, null, 2));
  invalidateUserSettingsCache(); // 缓存失效
  res.json(req.body);
});

function buildApiUrl(baseUrl, endpoint, apiType = 'openai') {
  log.verbose(`[DEBUG] buildApiUrl called with: baseUrl=${baseUrl}, endpoint=${endpoint}, apiType=${apiType}`);

  baseUrl = baseUrl.replace(/\/$/, '');

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

function buildChatRequestBody(modelId, messages, params, apiType = 'openai', images = null) {
  log.verbose(`[DEBUG] buildChatRequestBody: modelId=${modelId}, apiType=${apiType}, messages=${messages.length}, images=${images ? images.length : 'none'}`);

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
    // Anthropic API format
    const requestBody = {
      model: modelId,
      messages: processedMessages,
      ...params
    };

    // Anthropic API requires max_tokens parameter
    if (!requestBody.max_tokens) {
      requestBody.max_tokens = params.max_tokens || 4096;
      log.verbose(`[DEBUG] Added default max_tokens: ${requestBody.max_tokens}`);
    }

    log.verbose(`[DEBUG] Final Anthropic request body created`);
    return requestBody;
  } else {
    log.verbose(`[DEBUG] Building OpenAI compatible request body`);
    const requestBody = {
      model: modelId,
      messages: processedMessages,
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
    const extractedName = actualModelId.includes('/') ? actualModelId.split('/').pop() : actualModelId;
    console.log(`Extracted model name from polling format: ${extractedName}`);
    return extractedName;
  }
  
  // 普通格式
  const extractedName = modelId.includes('/') ? modelId.split('/').pop() : modelId;
  console.log(`Extracted model name from normal format: ${extractedName}`);
  return extractedName;
}

// ==================== 对话连续性：消息指纹识别 ====================

// 生成消息指纹（基于前几条消息的内容）
function generateMessageFingerprint(messages, modelName) {
  if (!messages || messages.length === 0) {
    return null;
  }
  
  // 只使用前3条消息（或全部如果少于3条）来生成指纹
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

// 清理过期的会话映射（超过24小时未使用）
function cleanupExpiredConversations(userSettings) {
  if (!userSettings.conversationProviderMap) {
    return 0;
  }
  
  const now = new Date();
  const expirationTime = 24 * 60 * 60 * 1000; // 24小时
  let cleanedCount = 0;
  
  for (const key in userSettings.conversationProviderMap) {
    const mapping = userSettings.conversationProviderMap[key];
    const lastUsed = new Date(mapping.lastUsed);
    const age = now - lastUsed;
    
    if (age > expirationTime) {
      delete userSettings.conversationProviderMap[key];
      cleanedCount++;
    }
  }
  
  // 限制映射表大小（最多保存1000条）
  const entries = Object.entries(userSettings.conversationProviderMap);
  if (entries.length > 1000) {
    // 按最后使用时间排序，删除最旧的
    entries.sort((a, b) => new Date(b[1].lastUsed) - new Date(a[1].lastUsed));
    const toKeep = entries.slice(0, 1000);
    userSettings.conversationProviderMap = Object.fromEntries(toKeep);
    cleanedCount += entries.length - 1000;
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

// 获取下一个轮询提供商（实现真正的轮询机制）
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
  
  // 如果当前轮次已经用完所有提供商，开始新的轮次
  if (modelState.usedInCurrentRound.length >= available.length) {
    console.log(`All providers used in current round, starting new round for ${modelName}`);
    modelState.usedInCurrentRound = [];
    modelState.currentIndex = 0;
  }
  
  // 找到下一个未使用的提供商
  let attempts = 0;
  let selectedProvider = null;
  
  while (attempts < available.length && !selectedProvider) {
    const providerId = available[modelState.currentIndex];
    
    // 检查这个提供商在当前轮次是否已经使用过
    if (!modelState.usedInCurrentRound.includes(providerId)) {
      const provider = providers.find(p => p.id === providerId);
      
      // 检查该模型在该提供商是否被禁用
      const isModelDisabled = isModelDisabledForProvider(modelName, providerId, userSettings);
      
      // 检查该提供商是否在排除池中
      const isExcluded = excludedSet.has(providerId);
      
      if (provider && !provider.disabled && !isModelDisabled && !isExcluded) {
        selectedProvider = provider;
        modelState.usedInCurrentRound.push(providerId);
        console.log(`Selected provider: ${provider.name} (ID: ${providerId}) for model ${modelName}`);
        console.log(`Used providers in current round:`, modelState.usedInCurrentRound);
      } else {
        console.log(`Provider ${providerId} not found, disabled, excluded, or model ${modelName} is disabled for this provider, skipping`);
      }
    } else {
      console.log(`Provider ${providerId} already used in current round, skipping`);
    }
    
    // 移动到下一个提供商
    modelState.currentIndex = (modelState.currentIndex + 1) % available.length;
    attempts++;
  }
  
  // 保存轮询状态
  userSettings.pollingState = pollingState;
  
  return selectedProvider;
}

// 保存轮询状态到文件
async function savePollingState(userSettings) {
  try {
    await fs.writeFile(USER_SETTINGS_FILE, JSON.stringify(userSettings, null, 2));
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
  const threshold = 3; // 失败3次后禁用
  if (userSettings.modelFailCounts[key] >= threshold) {
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
  
  const available = config.available[modelName] || [];
  console.log(`[Failover] Available provider IDs for ${modelName}:`, available);
  
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
  const failoverProviders = [];
  
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
    
    // 注意：在故障转移模式下，我们忽略 disabledModels 检查
    // 因为 disabledModels 是基于历史失败计数的，但当前请求应该尝试所有可用提供商
    
    failoverProviders.push(provider);
    console.log(`[Failover] Added provider ${provider.name} (ID: ${providerId}) to failover list`);
  }
  
  console.log(`[Failover] Total failover providers: ${failoverProviders.length}`);
  return failoverProviders;
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
    await fs.writeFile(API_SETTINGS_FILE, JSON.stringify(data, null, 2));
    invalidateApiSettingsCache(); // 缓存失效
  }
}

async function resetFailCount(providerId) {
  const data = await getApiSettings();
  const provider = data.providers.find(p => p.id === providerId);
  if (provider) {
    provider.failCount = 0;
    await fs.writeFile(API_SETTINGS_FILE, JSON.stringify(data, null, 2));
    invalidateApiSettingsCache(); // 缓存失效
  }
}

async function getProviderModelId(provider, modelName) {
  try {
    const apiType = provider.apiType || 'openai';
    const url = buildApiUrl(provider.baseUrl, 'models', apiType);
    const response = await axios.get(url, {
      headers: { 'Authorization': `Bearer ${provider.apiKey}` },
      timeout: 10000
    });
    
    const models = response.data.data || [];
    const matchedModel = models.find(model => {
      const extractedName = model.id.includes('/') ? model.id.split('/').pop() : model.id;
      return extractedName === modelName;
    });
    
    return matchedModel ? matchedModel.id : null;
  } catch (error) {
    console.error(`Failed to get models for provider ${provider.name}:`, error.message);
    return null;
  }
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

async function streamChat(provider, messages, params, res, modelId, images) {
  log.verbose(`[DEBUG] streamChat: provider=${provider.name}, modelId=${modelId}, messages=${messages.length}, apiType=${provider.apiType}`);

  const apiType = provider.apiType || 'openai';
  const url = buildApiUrl(provider.baseUrl, 'chat/completions', apiType);

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
    const requestBody = buildChatRequestBody(modelId || provider.defaultModel, processedMessages, { ...params, stream: true }, apiType, images);

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
      timeout: 60000 // Increase timeout to 60 seconds
    });

    log.verbose(`[DEBUG] streamChat: Request successful, response status: ${response.status}`);

    // Record successful API call
    await logApiCall(provider.name, modelId || provider.defaultModel, true);

    // Performance optimization: Add error handling and timeout control
    const timeout = setTimeout(() => {
      response.data.destroy();
      res.write(`data: ${JSON.stringify({ error: 'Stream timeout' })}\n\n`);
      res.end();
    }, 120000); // 2 minute timeout

    response.data.on('data', chunk => {
      try {
        res.write(chunk);
      } catch (error) {
        log.error('Error writing chunk:', error);
        clearTimeout(timeout);
        res.end();
      }
    });

    response.data.on('end', () => {
      clearTimeout(timeout);
      res.end();
    });

    response.data.on('error', (error) => {
      log.error('Stream error:', error);
      clearTimeout(timeout);
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
      await fs.writeFile(USER_SETTINGS_FILE, JSON.stringify(userSettings, null, 2));
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
    const pollingConfig = userSettings.pollingConfig || { available: {}, excluded: {} };
    
    // 获取所有在可用池中的模型（必须有至少2个提供商才是轮询模型）
    let availableModelNames = [];
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
    
    // 根据API密钥权限过滤模型
    const allowedModels = req.apiKeyInfo?.allowedModels || [];
    
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
    
    console.log(`[Models API] API Key: ${req.apiKeyInfo?.name || 'Legacy'}`);
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
    const pureModelName = modelName.includes('/') ? modelName.split('/').pop() : modelName;

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

    // Check if model is in available pool and must have at least 2 providers (consistent with frontend polling logic)
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
      const url = buildApiUrl(selectedProvider.baseUrl, 'chat/completions', apiType);

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

    sendErrorResponse(res, stream, {
      message: `All providers failed for model '${pureModelName}'. Tried ${triedProviderIds.length} providers.${stream ? ` Details: ${errorDetails}` : ''}`,
      type: 'server_error',
      code: 'all_providers_failed',
      ...(stream ? {} : { details: errors })
    }, 503);

  } catch (error) {
    log.error('[Proxy] Unexpected error:', error);
    sendErrorResponse(res, stream, {
      message: error.message,
      type: 'server_error',
      code: 'internal_error'
    });
  }
});

// ==================== 多API密钥管理接口 ====================

// 生成随机API密钥
function generateApiKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'sk-';
  for (let i = 0; i < 48; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
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
    
    await fs.writeFile(USER_SETTINGS_FILE, JSON.stringify(userSettings, null, 2));
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
    
    await fs.writeFile(USER_SETTINGS_FILE, JSON.stringify(userSettings, null, 2));
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
    
    await fs.writeFile(USER_SETTINGS_FILE, JSON.stringify(userSettings, null, 2));
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
    
    await fs.writeFile(USER_SETTINGS_FILE, JSON.stringify(userSettings, null, 2));
    invalidateUserSettingsCache();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting proxy key:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== 日志查询接口 ====================

// 获取日志统计数据
app.get('/api/logs/stats', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // 如果没有提供日期范围，默认查询当天
    const today = new Date();
    const start = startDate || today.toISOString().split('T')[0];
    const end = endDate || today.toISOString().split('T')[0];
    
    // 验证日期范围
    const startDateObj = new Date(start);
    const endDateObj = new Date(end);
    const daysDiff = Math.ceil((endDateObj - startDateObj) / (1000 * 60 * 60 * 24));
    
    if (daysDiff > 7) {
      return res.status(400).json({ error: '日期范围不能超过7天' });
    }
    
    // 读取日志内容
    const logsContent = await readLogs(start, end);
    
    // 解析日志生成统计数据
    const stats = parseLogsForStats(logsContent);
    
    res.json({
      dateRange: { start, end },
      stats
    });
  } catch (error) {
    console.error('Error getting log stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取原始日志内容
app.get('/api/logs/raw', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // 如果没有提供日期范围，默认查询当天
    const today = new Date();
    const start = startDate || today.toISOString().split('T')[0];
    const end = endDate || today.toISOString().split('T')[0];
    
    // 验证日期范围
    const startDateObj = new Date(start);
    const endDateObj = new Date(end);
    const daysDiff = Math.ceil((endDateObj - startDateObj) / (1000 * 60 * 60 * 24));
    
    if (daysDiff > 7) {
      return res.status(400).json({ error: '日期范围不能超过7天' });
    }
    
    // 读取日志内容
    const logsContent = await readLogs(start, end);
    
    res.json({
      dateRange: { start, end },
      content: logsContent
    });
  } catch (error) {
    console.error('Error getting raw logs:', error);
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
