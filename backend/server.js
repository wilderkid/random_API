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
      pollingConfig: { available: {}, excluded: {}, disabled: {} }
    }, null, 2));
  }
}

// API 路由
app.get('/api/providers', async (req, res) => {
  const data = JSON.parse(await fs.readFile(API_SETTINGS_FILE, 'utf8'));
  res.json(data.providers);
});

app.post('/api/providers', async (req, res) => {
  const data = JSON.parse(await fs.readFile(API_SETTINGS_FILE, 'utf8'));
  const newProvider = { id: Date.now().toString(), ...req.body, failCount: 0, disabled: false };
  data.providers.push(newProvider);
  await fs.writeFile(API_SETTINGS_FILE, JSON.stringify(data, null, 2));
  res.json(newProvider);
});

app.put('/api/providers/:id', async (req, res) => {
  const data = JSON.parse(await fs.readFile(API_SETTINGS_FILE, 'utf8'));
  const index = data.providers.findIndex(p => p.id === req.params.id);
  if (index !== -1) {
    data.providers[index] = { ...data.providers[index], ...req.body };
    await fs.writeFile(API_SETTINGS_FILE, JSON.stringify(data, null, 2));
    res.json(data.providers[index]);
  } else {
    res.status(404).json({ error: 'Provider not found' });
  }
});

app.delete('/api/providers/:id', async (req, res) => {
  const data = JSON.parse(await fs.readFile(API_SETTINGS_FILE, 'utf8'));
  data.providers = data.providers.filter(p => p.id !== req.params.id);
  await fs.writeFile(API_SETTINGS_FILE, JSON.stringify(data, null, 2));
  res.json({ success: true });
});

app.get('/api/providers/:id/models', async (req, res) => {
  const data = JSON.parse(await fs.readFile(API_SETTINGS_FILE, 'utf8'));
  const provider = data.providers.find(p => p.id === req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  
  try {
    const url = buildApiUrl(provider.baseUrl, 'models');
    const response = await axios.get(url, { headers: { 'Authorization': `Bearer ${provider.apiKey}` } });
    res.json(response.data.data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/providers/:id/test', async (req, res) => {
  const data = JSON.parse(await fs.readFile(API_SETTINGS_FILE, 'utf8'));
  const provider = data.providers.find(p => p.id === req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  
  try {
    const url = buildApiUrl(provider.baseUrl, 'models');
    await axios.get(url, { headers: { 'Authorization': `Bearer ${provider.apiKey}` }, timeout: 5000 });
    res.json({ success: true });
  } catch (error) {
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

app.post('/api/chat', async (req, res) => {
  const { messages, model, params, polling } = req.body;
  const settings = JSON.parse(await fs.readFile(API_SETTINGS_FILE, 'utf8'));
  const userSettings = JSON.parse(await fs.readFile(USER_SETTINGS_FILE, 'utf8'));
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  if (polling) {
    const modelName = extractModelName(model);
    const providers = getPollingProviders(settings.providers, modelName, userSettings.pollingConfig);
    
    for (const provider of providers) {
      try {
        await streamChat(provider, messages, params, res);
        return;
      } catch (error) {
        await incrementFailCount(provider.id);
        continue;
      }
    }
    res.write(`data: ${JSON.stringify({ error: 'All providers failed' })}\n\n`);
    res.end();
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
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
});

app.get('/api/settings', async (req, res) => {
  const content = await fs.readFile(USER_SETTINGS_FILE, 'utf8');
  res.json(JSON.parse(content));
});

app.put('/api/settings', async (req, res) => {
  await fs.writeFile(USER_SETTINGS_FILE, JSON.stringify(req.body, null, 2));
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
  return modelId.includes('/') ? modelId.split('/').pop() : modelId;
}

function getPollingProviders(providers, modelName, config) {
  const available = config.available[modelName] || [];
  return available
    .map(id => providers.find(p => p.id === id))
    .filter(p => p && !p.disabled);
}

async function incrementFailCount(providerId) {
  const data = JSON.parse(await fs.readFile(API_SETTINGS_FILE, 'utf8'));
  const provider = data.providers.find(p => p.id === providerId);
  if (provider) {
    provider.failCount = (provider.failCount || 0) + 1;
    if (provider.failCount >= 3) provider.disabled = true;
    await fs.writeFile(API_SETTINGS_FILE, JSON.stringify(data, null, 2));
  }
}

async function streamChat(provider, messages, params, res, modelId) {
  const url = buildApiUrl(provider.baseUrl, 'chat/completions');
  const response = await axios.post(url, {
    model: modelId || provider.defaultModel,
    messages,
    stream: true,
    ...params
  }, {
    headers: { 'Authorization': `Bearer ${provider.apiKey}` },
    responseType: 'stream'
  });
  
  response.data.on('data', chunk => {
    res.write(chunk);
  });
  
  response.data.on('end', () => {
    res.end();
  });
}

initDataDir().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
