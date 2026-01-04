const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
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
      pollingState: {} // 存储每个模型的轮询状态
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
      pollingState: {} // 存储每个模型的轮询状态
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
  const { messages, model, params, polling } = req.body;
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
      
      await streamChat(selectedProvider, messages, params, res, modelId);
      
      // 如果成功，重置失败计数并保存轮询状态
      if (selectedProvider.failCount > 0) {
        await resetFailCount(selectedProvider.id);
      }
      
      // 保存轮询状态
      await savePollingState(userSettings);
      
      console.log(`Successfully used provider ${selectedProvider.name} for model ${modelName}`);
      return;
      
    } catch (error) {
      console.error(`Provider ${selectedProvider.name} failed:`, error.message);
      console.error(`Error details:`, error);
      
      // 增加失败计数
      await incrementFailCount(selectedProvider.id);
      
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
      await streamChat(provider, messages, params, res, modelId);
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
      
      if (provider && !provider.disabled) {
        selectedProvider = provider;
        modelState.usedInCurrentRound.push(providerId);
        console.log(`Selected provider: ${provider.name} (ID: ${providerId}) for model ${modelName}`);
        console.log(`Used providers in current round:`, modelState.usedInCurrentRound);
      } else {
        console.log(`Provider ${providerId} not found or disabled, skipping`);
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

async function streamChat(provider, messages, params, res, modelId) {
  const url = buildApiUrl(provider.baseUrl, 'chat/completions');
  
  try {
    const response = await axios.post(url, {
      model: modelId || provider.defaultModel,
      messages,
      stream: true,
      ...params
    }, {
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json'
      },
      responseType: 'stream',
      timeout: 60000 // 增加超时时间到60秒
    });
    
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
    throw error;
  }
}

initDataDir().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
