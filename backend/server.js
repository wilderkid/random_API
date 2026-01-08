const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { logApiCall, logSystemEvent, readLogs, parseLogsForStats, deleteLogs, clearAllLogs } = require('./logger');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // 增加请求体大小限制
app.use(express.urlencoded({ limit: '50mb', extended: true })); // 增加URL编码请求体大小限制
app.use(express.static(path.join(__dirname, '../frontend/dist')));

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

// 性能优化：创建 HTTP 连接池
const httpAgent = new require('http').Agent({
  keepAlive: true,
  maxSockets: 50,
  timeout: 30000
});
const httpsAgent = new require('https').Agent({
  keepAlive: true,
  maxSockets: 50,
  timeout: 30000
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
  } catch {
    await fs.writeFile(API_SETTINGS_FILE, JSON.stringify({ providers: [] }, null, 2));
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
      proxyApiKeys: {} // 多API密钥管理
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
    apiSettingsCache = data;
    apiSettingsCacheTime = now;
    return data;
  } catch (error) {
    console.error('Error reading API settings:', error);
    return { providers: [] };
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
      proxyApiKeys: {} // 多API密钥管理
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

app.post('/api/providers', async (req, res) => {
  const data = await getApiSettings();
  const newProvider = { id: Date.now().toString(), ...req.body, failCount: 0, disabled: false };
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
    const url = buildApiUrl(provider.baseUrl, 'models');
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
    const url = buildApiUrl(provider.baseUrl, 'models');
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

function buildApiUrl(baseUrl, endpoint) {
  baseUrl = baseUrl.replace(/\/$/, '');
  if (/\/v\d+$/.test(baseUrl)) {
    return `${baseUrl}/${endpoint}`;
  }
  return `${baseUrl}/v1/${endpoint}`;
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

function getPollingProviders(providers, modelName, config) {
  console.log(`Getting polling providers for model: ${modelName}`);
  console.log(`Available config:`, config.available);
  console.log(`Excluded config:`, config.excluded);
  
  // 检查模型是否在排除池中
  if (config.excluded && config.excluded[modelName]) {
    console.log(`Model ${modelName} is in excluded pool, skipping polling`);
    return [];
  }
  
  const available = config.available[modelName] || [];
  console.log(`Available provider IDs for ${modelName}:`, available);
  
  const pollingProviders = available
    .map(id => {
      const provider = providers.find(p => p.id === id);
      if (!provider) {
        console.log(`Provider with ID ${id} not found`);
      } else {
        console.log(`Found provider: ${provider.name} (ID: ${id}, disabled: ${provider.disabled})`);
      }
      return provider;
    })
    .filter(p => p && !p.disabled);
    
  console.log(`Final polling providers count: ${pollingProviders.length}`);
  pollingProviders.forEach(p => console.log(`- ${p.name} (ID: ${p.id})`));
  
  return pollingProviders;
}

// 获取下一个轮询提供商（实现真正的轮询机制）
function getNextPollingProvider(providers, modelName, config, userSettings) {
  console.log(`Getting next polling provider for model: ${modelName}`);
  
  // 检查模型是否在排除池中
  if (config.excluded && config.excluded[modelName]) {
    console.log(`Model ${modelName} is in excluded pool, skipping polling`);
    return null;
  }
  
  const available = config.available[modelName] || [];
  console.log(`Available provider IDs for ${modelName}:`, available);
  
  if (available.length === 0) {
    console.log(`No available providers for model ${modelName}`);
    return null;
  }
  
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
      
      if (provider && !provider.disabled && !isModelDisabled) {
        selectedProvider = provider;
        modelState.usedInCurrentRound.push(providerId);
        console.log(`Selected provider: ${provider.name} (ID: ${providerId}) for model ${modelName}`);
        console.log(`Used providers in current round:`, modelState.usedInCurrentRound);
      } else {
        console.log(`Provider ${providerId} not found, disabled, or model ${modelName} is disabled for this provider, skipping`);
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
function getFailoverProviders(providers, modelName, config, userSettings, excludeProviderIds = []) {
  console.log(`[Failover] Getting failover providers for model: ${modelName}`);
  console.log(`[Failover] Excluding providers: ${excludeProviderIds.join(', ')}`);
  
  // 检查模型是否在排除池中
  if (config.excluded && config.excluded[modelName]) {
    console.log(`[Failover] Model ${modelName} is in excluded pool`);
    return [];
  }
  
  const available = config.available[modelName] || [];
  console.log(`[Failover] Available provider IDs for ${modelName}:`, available);
  
  if (available.length === 0) {
    console.log(`[Failover] No available providers for model ${modelName}`);
    return [];
  }
  
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
    
    // 跳过已排除的提供商
    if (excludeProviderIds.includes(providerId)) {
      console.log(`[Failover] Provider ${providerId} already tried, skipping`);
      continue;
    }
    
    const provider = providers.find(p => p.id === providerId);
    if (!provider) {
      console.log(`[Failover] Provider ${providerId} not found`);
      continue;
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
    const url = buildApiUrl(provider.baseUrl, 'models');
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

async function streamChat(provider, messages, params, res, modelId, images) {
  const url = buildApiUrl(provider.baseUrl, 'chat/completions');
  
  // 如果有图片，需要处理消息格式
  let processedMessages = messages;
  if (images && images.length > 0) {
    // 找到最后一条用户消息并添加图片
    processedMessages = [...messages];
    const lastUserMessageIndex = processedMessages.length - 1;
    if (lastUserMessageIndex >= 0 && processedMessages[lastUserMessageIndex].role === 'user') {
      const content = [
        { type: 'text', text: processedMessages[lastUserMessageIndex].content }
      ];
      
      // 添加图片内容
      images.forEach((image, index) => {
        // 检查dataUrl格式
        if (!image.dataUrl || !image.dataUrl.includes('base64,')) {
          console.error(`Invalid dataUrl format for image ${index + 1}`);
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
    const requestBody = {
      model: modelId || provider.defaultModel,
      messages: processedMessages,
      stream: true,
      ...params
    };
    
    const response = await axios.post(url, requestBody, {
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json'
      },
      responseType: 'stream',
      timeout: 60000 // 增加超时时间到60秒
    });
    
    // 记录成功的API调用
    await logApiCall(provider.name, modelId || provider.defaultModel, true);
    
    // 性能优化：添加错误处理和超时控制
    const timeout = setTimeout(() => {
      response.data.destroy();
      res.write(`data: ${JSON.stringify({ error: 'Stream timeout' })}\n\n`);
      res.end();
    }, 120000); // 2分钟超时
    
    response.data.on('data', chunk => {
      try {
        res.write(chunk);
      } catch (error) {
        console.error('Error writing chunk:', error);
        clearTimeout(timeout);
        res.end();
      }
    });
    
    response.data.on('end', () => {
      clearTimeout(timeout);
      res.end();
    });
    
    response.data.on('error', (error) => {
      console.error('Stream error:', error);
      clearTimeout(timeout);
      res.write(`data: ${JSON.stringify({ error: 'Stream error: ' + error.message })}\n\n`);
      res.end();
    });
    
  } catch (error) {
    console.error('StreamChat error:', error.message);
    // 记录失败的API调用
    await logApiCall(provider.name, modelId || provider.defaultModel, false, error.message);
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
    
    for (const modelName of Object.keys(availableModels)) {
      const providers = availableModels[modelName] || [];
      // 只有拥有至少2个提供商的模型才能被外部使用（与前台逻辑一致）
      if (providers.length >= 2 && !pollingConfig.excluded?.[modelName]) {
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
    
    console.log(`[Proxy] Received request for model: ${model}, stream: ${stream}`);
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: {
          message: 'messages is required and must be an array',
          type: 'invalid_request_error',
          code: 'invalid_messages'
        }
      });
    }
    
    const settings = await getApiSettings();
    const userSettings = await getUserSettings();
    const pollingConfig = userSettings.pollingConfig || { available: {}, excluded: {} };
    
    // 确定要使用的模型名称
    let modelName = model;
    
    if (!modelName) {
      return res.status(400).json({
        error: {
          message: 'model is required. Please specify a model in the request.',
          type: 'invalid_request_error',
          code: 'model_required'
        }
      });
    }
    
    // 提取纯模型名称（去掉可能的前缀）
    const pureModelName = modelName.includes('/') ? modelName.split('/').pop() : modelName;
    
    console.log(`[Proxy] Pure model name: ${pureModelName}`);
    
    // 检查模型权限 - 如果密钥配置了允许的模型列表，则进行权限检查
    const allowedModels = req.apiKeyInfo?.allowedModels || [];
    if (allowedModels.length > 0 && !allowedModels.includes(pureModelName)) {
      return res.status(403).json({
        error: {
          message: `Model '${pureModelName}' is not allowed for this API key. Allowed models: ${allowedModels.join(', ')}`,
          type: 'permission_error',
          code: 'model_not_allowed'
        }
      });
    }
    
    // 检查模型是否在可用池中，且必须有至少2个提供商（与前台轮询逻辑一致）
    const availableProviderIds = pollingConfig.available?.[pureModelName] || [];
    if (availableProviderIds.length < 2) {
      return res.status(400).json({
        error: {
          message: `Model '${pureModelName}' requires at least 2 providers for polling. Current providers: ${availableProviderIds.length}. Please configure more providers in polling settings.`,
          type: 'invalid_request_error',
          code: 'insufficient_providers'
        }
      });
    }
    
    // 检查模型是否被排除
    if (pollingConfig.excluded?.[pureModelName]) {
      return res.status(400).json({
        error: {
          message: `Model '${pureModelName}' is in the excluded pool.`,
          type: 'invalid_request_error',
          code: 'model_excluded'
        }
      });
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
    
    // ==================== 自动故障转移逻辑 ====================
    const errors = []; // 收集所有失败的错误信息
    const triedProviderIds = []; // 记录已尝试的提供商ID
    
    // 获取所有可用于故障转移的提供商
    const failoverProviders = getFailoverProviders(settings.providers, pureModelName, pollingConfig, userSettings, []);
    
    if (failoverProviders.length === 0) {
      console.log(`[Proxy] No available providers for model ${pureModelName}`);
      return res.status(503).json({
        error: {
          message: `No available providers for model '${pureModelName}'`,
          type: 'server_error',
          code: 'no_providers_available'
        }
      });
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
      
      const url = buildApiUrl(selectedProvider.baseUrl, 'chat/completions');
      
      if (stream) {
        // ==================== 流式响应（带故障转移） ====================
        try {
          const response = await axios.post(url, {
            model: providerModelId,
            messages: messages,
            stream: true,
            ...params
          }, {
            headers: {
              'Authorization': `Bearer ${selectedProvider.apiKey}`,
              'Content-Type': 'application/json'
            },
            responseType: 'stream',
            timeout: 120000
          });
          
          // 流式请求成功建立连接
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('Access-Control-Allow-Origin', '*');
          
          response.data.on('data', chunk => {
            try {
              res.write(chunk);
            } catch (error) {
              console.error('[Proxy] Error writing chunk:', error);
            }
          });
          
          response.data.on('end', async () => {
            await logApiCall(selectedProvider.name, pureModelName, true);
            await resetModelFailCount(selectedProvider.id, pureModelName, userSettings);
            updatePollingStateAfterSuccess(pureModelName, selectedProvider.id, pollingConfig, userSettings);
            await savePollingState(userSettings);
            console.log(`[Proxy] Stream completed successfully using provider ${selectedProvider.name}`);
            res.end();
          });
          
          response.data.on('error', async (error) => {
            console.error('[Proxy] Stream error:', error);
            await logApiCall(selectedProvider.name, pureModelName, false, error.message);
            await incrementModelFailCount(selectedProvider.id, pureModelName, userSettings);
            await savePollingState(userSettings);
            res.write(`data: ${JSON.stringify({ error: { message: error.message } })}\n\n`);
            res.end();
          });
          
          // 流式请求成功启动，退出循环
          return;
          
        } catch (error) {
          console.error(`[Proxy] Provider ${selectedProvider.name} failed:`, error.message);
          await logApiCall(selectedProvider.name, pureModelName, false, error.message);
          errors.push({
            provider: selectedProvider.name,
            error: error.message
          });
          await incrementModelFailCount(selectedProvider.id, pureModelName, userSettings);
          // 继续尝试下一个提供商
        }
        
      } else {
        // ==================== 非流式响应（带故障转移） ====================
        try {
          const response = await axios.post(url, {
            model: providerModelId,
            messages: messages,
            stream: false,
            ...params
          }, {
            headers: {
              'Authorization': `Bearer ${selectedProvider.apiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 120000
          });
          
          // 成功！重置失败计数并返回响应
          await logApiCall(selectedProvider.name, pureModelName, true);
          await resetModelFailCount(selectedProvider.id, pureModelName, userSettings);
          updatePollingStateAfterSuccess(pureModelName, selectedProvider.id, pollingConfig, userSettings);
          await savePollingState(userSettings);
          
          console.log(`[Proxy] Request completed successfully using provider ${selectedProvider.name}`);
          return res.json(response.data);
          
        } catch (error) {
          console.error(`[Proxy] Provider ${selectedProvider.name} failed:`, error.message);
          await logApiCall(selectedProvider.name, pureModelName, false, error.response?.data?.error?.message || error.message);
          errors.push({
            provider: selectedProvider.name,
            error: error.response?.data?.error?.message || error.message,
            status: error.response?.status
          });
          await incrementModelFailCount(selectedProvider.id, pureModelName, userSettings);
          // 继续尝试下一个提供商
        }
      }
    }
    
    // 所有提供商都失败了
    await savePollingState(userSettings);
    
    console.log(`[Proxy] All ${triedProviderIds.length} providers failed for model ${pureModelName}`);
    
    // 构建详细的错误信息
    const errorDetails = errors.map(e => `${e.provider}: ${e.error}`).join('; ');
    
    if (stream) {
      // 流式响应：如果还没有发送过响应头
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
      res.write(`data: ${JSON.stringify({
        error: {
          message: `All providers failed for model '${pureModelName}'. Tried ${triedProviderIds.length} providers. Details: ${errorDetails}`,
          type: 'server_error',
          code: 'all_providers_failed'
        }
      })}\n\n`);
      res.end();
    } else {
      // 非流式响应
      res.status(503).json({
        error: {
          message: `All providers failed for model '${pureModelName}'. Tried ${triedProviderIds.length} providers.`,
          type: 'server_error',
          code: 'all_providers_failed',
          details: errors
        }
      });
    }
    
  } catch (error) {
    console.error('[Proxy] Unexpected error:', error);
    res.status(500).json({
      error: {
        message: error.message,
        type: 'server_error',
        code: 'internal_error'
      }
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
