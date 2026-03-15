const fs = require('fs').promises;
const path = require('path');
const { getDb } = require('./db');

const DATA_DIR = path.join(__dirname, '../data');
const API_SETTINGS_FILE = path.join(DATA_DIR, 'api_settings.json');
const USER_SETTINGS_FILE = path.join(DATA_DIR, 'user_settings.json');
const PROMPTS_FILE = path.join(DATA_DIR, 'prompts.json');
const LANGUAGES_FILE = path.join(DATA_DIR, 'languages.json');
const CONVERSATIONS_DIR = path.join(DATA_DIR, 'conversations');

const DEFAULT_PROVIDER_GROUP = { id: 'default', name: '默认分组', description: '未分组的提供商' };
const DEFAULT_PROMPT_GROUP = { id: 'default', name: '默认分组', description: '未分组的提示词' };
const DEFAULT_TRANSLATE_GROUP = { id: 'translate', name: '翻译', description: '翻译相关的提示词' };

const DEFAULT_USER_SETTINGS = {
  defaultParams: { temperature: 0.7, max_tokens: 2000, top_p: 1 },
  globalFrequency: 10,
  defaultModel: '',
  defaultPromptId: '',
  defaultStyle: '',
  defaultApiStyle: '',
  translateDefaultModel: '',
  translateDefaultPromptId: '',
  translatePollingEnabled: false,
  quickTranslations: [
    { id: '1', name: '中→英', sourceLanguage: '中文', targetLanguage: '英语' },
    { id: '2', name: '英→中', sourceLanguage: '英语', targetLanguage: '中文' }
  ],
  pollingConfig: { available: {}, excluded: {}, disabled: {} },
  pollingState: {},
  keyPollingState: {},
  modelFailCounts: {},
  keyFailCounts: {},
  proxyApiKey: '',
  proxyApiKeys: {},
  conversationProviderMap: {}
};

const DEFAULT_LANGUAGES = {
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
};

function nowIso() {
  return new Date().toISOString();
}

async function safeReadJson(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

function serialize(value) {
  return JSON.stringify(value ?? null);
}

function deserialize(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeProviderKeys(provider) {
  if (!provider) return [];

  const rawKeys = Array.isArray(provider.apiKeys) ? provider.apiKeys : [];
  if (rawKeys.length > 0) {
    return rawKeys.map((key, index) => ({
      id: key.id || `${provider.id}-key-${index + 1}`,
      name: key.name || `Key ${index + 1}`,
      apiKey: key.apiKey || key.api_key || '',
      enabled: key.enabled !== false,
      weight: Number.isFinite(key.weight) ? key.weight : 1,
      priority: Number.isFinite(key.priority) ? key.priority : 0,
      failCount: key.failCount || 0,
      lastUsedAt: key.lastUsedAt || key.last_used_at || null,
      createdAt: key.createdAt || key.created_at || provider.createdAt || provider.created_at || nowIso()
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
      failCount: 0,
      lastUsedAt: null,
      createdAt: provider.createdAt || provider.created_at || nowIso()
    }];
  }

  return [];
}

function setMeta(db, key, value) {
  db.prepare(`
    INSERT INTO meta (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(key, String(value));
}

function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row?.value;
}

function setSetting(db, key, value, valueType = 'json') {
  db.prepare(`
    INSERT INTO settings (key, value, value_type, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      value_type = excluded.value_type,
      updated_at = CURRENT_TIMESTAMP
  `).run(key, serialize(value), valueType);
}

function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? deserialize(row.value, fallback) : fallback;
}

function buildUserSettingsFromDb(db) {
  const settings = {
    ...DEFAULT_USER_SETTINGS,
    defaultParams: getSetting(db, 'defaultParams', DEFAULT_USER_SETTINGS.defaultParams),
    globalFrequency: getSetting(db, 'globalFrequency', DEFAULT_USER_SETTINGS.globalFrequency),
    defaultModel: getSetting(db, 'defaultModel', DEFAULT_USER_SETTINGS.defaultModel),
    defaultPromptId: getSetting(db, 'defaultPromptId', DEFAULT_USER_SETTINGS.defaultPromptId),
    defaultStyle: getSetting(db, 'defaultStyle', DEFAULT_USER_SETTINGS.defaultStyle),
    defaultApiStyle: getSetting(db, 'defaultApiStyle', DEFAULT_USER_SETTINGS.defaultApiStyle),
    translateDefaultModel: getSetting(db, 'translateDefaultModel', DEFAULT_USER_SETTINGS.translateDefaultModel),
    translateDefaultPromptId: getSetting(db, 'translateDefaultPromptId', DEFAULT_USER_SETTINGS.translateDefaultPromptId),
    translatePollingEnabled: getSetting(db, 'translatePollingEnabled', DEFAULT_USER_SETTINGS.translatePollingEnabled),
    quickTranslations: getSetting(db, 'quickTranslations', DEFAULT_USER_SETTINGS.quickTranslations),
    pollingConfig: getSetting(db, 'pollingConfig', DEFAULT_USER_SETTINGS.pollingConfig),
    pollingState: getSetting(db, 'pollingState', DEFAULT_USER_SETTINGS.pollingState),
    keyPollingState: getSetting(db, 'keyPollingState', DEFAULT_USER_SETTINGS.keyPollingState),
    modelFailCounts: getSetting(db, 'modelFailCounts', DEFAULT_USER_SETTINGS.modelFailCounts),
    keyFailCounts: getSetting(db, 'keyFailCounts', DEFAULT_USER_SETTINGS.keyFailCounts),
    proxyApiKey: getSetting(db, 'proxyApiKey', DEFAULT_USER_SETTINGS.proxyApiKey),
    conversationProviderMap: getSetting(db, 'conversationProviderMap', DEFAULT_USER_SETTINGS.conversationProviderMap)
  };

  const proxyKeyRows = db.prepare('SELECT * FROM proxy_keys ORDER BY created_at ASC, id ASC').all();
  settings.proxyApiKeys = Object.fromEntries(
    proxyKeyRows.map(row => [row.id, {
      name: row.name,
      description: row.description || '',
      apiKey: row.api_key,
      enabled: !!row.enabled,
      createdAt: row.created_at,
      lastUsed: row.last_used,
      usageCount: row.usage_count || 0,
      allowedModels: deserialize(row.allowed_models_json, []),
      allowedGroups: deserialize(row.allowed_groups_json, []),
      rateLimit: deserialize(row.rate_limit_json, { requestsPerMinute: 60, requestsPerHour: 1000 })
    }])
  );

  return settings;
}

function upsertProviderGroups(db, groups) {
  const stmt = db.prepare(`
    INSERT INTO provider_groups (id, name, description, created_at, updated_at)
    VALUES (@id, @name, @description, @created_at, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const group of groups) {
    stmt.run({
      id: group.id,
      name: group.name,
      description: group.description || '',
      created_at: group.createdAt || group.created_at || nowIso()
    });
  }
}

function replaceProviders(db, providers) {
  const insertProvider = db.prepare(`
    INSERT INTO providers (
      id, name, base_url, api_key, group_id, api_type, model_type,
      disabled, fail_count, exclude_auto_refresh,
      custom_endpoints_chat, custom_endpoints_models, custom_endpoints_images,
      created_at, updated_at
    ) VALUES (
      @id, @name, @base_url, @api_key, @group_id, @api_type, @model_type,
      @disabled, @fail_count, @exclude_auto_refresh,
      @custom_endpoints_chat, @custom_endpoints_models, @custom_endpoints_images,
      @created_at, CURRENT_TIMESTAMP
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      base_url = excluded.base_url,
      api_key = excluded.api_key,
      group_id = excluded.group_id,
      api_type = excluded.api_type,
      model_type = excluded.model_type,
      disabled = excluded.disabled,
      fail_count = excluded.fail_count,
      exclude_auto_refresh = excluded.exclude_auto_refresh,
      custom_endpoints_chat = excluded.custom_endpoints_chat,
      custom_endpoints_models = excluded.custom_endpoints_models,
      custom_endpoints_images = excluded.custom_endpoints_images,
      updated_at = CURRENT_TIMESTAMP
  `);

  const insertProviderKey = db.prepare(`
    INSERT INTO provider_keys (
      id, provider_id, name, api_key, enabled, weight, priority, fail_count, last_used_at, created_at, updated_at
    ) VALUES (
      @id, @provider_id, @name, @api_key, @enabled, @weight, @priority, @fail_count, @last_used_at, @created_at, CURRENT_TIMESTAMP
    )
  `);

  const deleteModels = db.prepare('DELETE FROM provider_models WHERE provider_id = ?');
  const insertModel = db.prepare(`
    INSERT INTO provider_models (provider_id, model_id, visible, type, sort_order, created_at, updated_at)
    VALUES (@provider_id, @model_id, @visible, @type, @sort_order, @created_at, CURRENT_TIMESTAMP)
  `);

  db.prepare('DELETE FROM provider_keys').run();
  db.prepare('DELETE FROM providers').run();

  providers.forEach((provider, providerIndex) => {
    const normalizedKeys = normalizeProviderKeys(provider);
    const primaryApiKey = provider.apiKey || normalizedKeys.find(key => key.apiKey)?.apiKey || '';

    insertProvider.run({
      id: provider.id,
      name: provider.name,
      base_url: provider.baseUrl,
      api_key: primaryApiKey,
      group_id: provider.groupId || 'default',
      api_type: provider.apiType || 'openai',
      model_type: provider.modelType || 'text',
      disabled: provider.disabled ? 1 : 0,
      fail_count: provider.failCount || 0,
      exclude_auto_refresh: provider.excludeAutoRefresh ? 1 : 0,
      custom_endpoints_chat: provider.customEndpoints?.chat || '',
      custom_endpoints_models: provider.customEndpoints?.models || '',
      custom_endpoints_images: provider.customEndpoints?.images || '',
      created_at: provider.createdAt || provider.created_at || nowIso()
    });

    normalizedKeys.forEach(key => {
      insertProviderKey.run({
        id: key.id,
        provider_id: provider.id,
        name: key.name,
        api_key: key.apiKey,
        enabled: key.enabled ? 1 : 0,
        weight: Number.isFinite(key.weight) ? key.weight : 1,
        priority: Number.isFinite(key.priority) ? key.priority : 0,
        fail_count: key.failCount || 0,
        last_used_at: key.lastUsedAt || null,
        created_at: key.createdAt || provider.createdAt || provider.created_at || nowIso()
      });
    });

    deleteModels.run(provider.id);

    const uniqueModels = [];
    const seenModelIds = new Set();
    (provider.models || []).forEach(model => {
      if (!model?.id || seenModelIds.has(model.id)) {
        return;
      }
      seenModelIds.add(model.id);
      uniqueModels.push(model);
    });

    uniqueModels.forEach((model, modelIndex) => {
      insertModel.run({
        provider_id: provider.id,
        model_id: model.id,
        visible: model.visible === false ? 0 : 1,
        type: model.type || 'text',
        sort_order: modelIndex,
        created_at: model.createdAt || model.created_at || nowIso()
      });
    });
  });
}

function buildApiSettingsFromDb(db) {
  const groups = db.prepare(`
    SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt
    FROM provider_groups
    ORDER BY CASE WHEN id = 'default' THEN 0 ELSE 1 END, name ASC
  `).all();

  const providerRows = db.prepare(`
    SELECT * FROM providers
    ORDER BY name ASC, id ASC
  `).all();

  const modelRows = db.prepare(`
    SELECT provider_id, model_id, visible, type, sort_order, created_at, updated_at
    FROM provider_models
    ORDER BY provider_id ASC, sort_order ASC, model_id ASC
  `).all();

  const keyRows = db.prepare(`
    SELECT id, provider_id, name, api_key, enabled, weight, priority, fail_count, last_used_at, created_at, updated_at
    FROM provider_keys
    ORDER BY provider_id ASC, priority DESC, weight DESC, created_at ASC, id ASC
  `).all();

  const modelsByProvider = new Map();
  for (const row of modelRows) {
    if (!modelsByProvider.has(row.provider_id)) {
      modelsByProvider.set(row.provider_id, []);
    }
    modelsByProvider.get(row.provider_id).push({
      id: row.model_id,
      visible: !!row.visible,
      type: row.type || 'text',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }

  const keysByProvider = new Map();
  for (const row of keyRows) {
    if (!keysByProvider.has(row.provider_id)) {
      keysByProvider.set(row.provider_id, []);
    }
    keysByProvider.get(row.provider_id).push({
      id: row.id,
      name: row.name,
      apiKey: row.api_key,
      enabled: !!row.enabled,
      weight: row.weight || 1,
      priority: row.priority || 0,
      failCount: row.fail_count || 0,
      lastUsedAt: row.last_used_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }

  const providers = providerRows.map(row => {
    const apiKeys = keysByProvider.get(row.id) || [];
    const fallbackKeys = apiKeys.length > 0
      ? apiKeys
      : (row.api_key ? [{
        id: `${row.id}-key-1`,
        name: '默认 Key',
        apiKey: row.api_key,
        enabled: true,
        weight: 1,
        priority: 0,
        failCount: 0,
        lastUsedAt: null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }] : []);

    return {
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      apiKey: row.api_key,
      apiKeys: fallbackKeys,
      groupId: row.group_id || 'default',
      apiType: row.api_type || 'openai',
      modelType: row.model_type || 'text',
      disabled: !!row.disabled,
      failCount: row.fail_count || 0,
      excludeAutoRefresh: !!row.exclude_auto_refresh,
      customEndpoints: {
        chat: row.custom_endpoints_chat || '',
        models: row.custom_endpoints_models || '',
        images: row.custom_endpoints_images || ''
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      models: modelsByProvider.get(row.id) || []
    };
  });

  return {
    groups: groups.length > 0 ? groups : [DEFAULT_PROVIDER_GROUP],
    providers
  };
}

function upsertPromptGroups(db, groups) {
  const stmt = db.prepare(`
    INSERT INTO prompt_groups (id, name, description, created_at, updated_at)
    VALUES (@id, @name, @description, @created_at, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const group of groups) {
    stmt.run({
      id: group.id,
      name: group.name,
      description: group.description || '',
      created_at: group.createdAt || group.created_at || nowIso()
    });
  }
}

function replacePrompts(db, promptsData) {
  const groups = promptsData.groups?.length ? promptsData.groups : [DEFAULT_PROMPT_GROUP, DEFAULT_TRANSLATE_GROUP];
  upsertPromptGroups(db, groups);

  db.prepare('DELETE FROM prompt_tags').run();
  db.prepare('DELETE FROM prompts').run();

  const insertPrompt = db.prepare(`
    INSERT INTO prompts (id, name, content, group_id, description, created_at, updated_at)
    VALUES (@id, @name, @content, @group_id, @description, @created_at, @updated_at)
  `);

  const insertTag = db.prepare(`
    INSERT INTO prompt_tags (prompt_id, tag)
    VALUES (?, ?)
  `);

  (promptsData.prompts || []).forEach(prompt => {
    insertPrompt.run({
      id: prompt.id,
      name: prompt.name,
      content: prompt.content || '',
      group_id: prompt.groupId || 'default',
      description: prompt.description || '',
      created_at: prompt.createdAt || prompt.created_at || nowIso(),
      updated_at: prompt.updatedAt || prompt.updated_at || nowIso()
    });

    (prompt.tags || []).forEach(tag => {
      insertTag.run(prompt.id, tag);
    });
  });
}

function buildPromptsFromDb(db) {
  const groups = db.prepare(`
    SELECT id, name, description
    FROM prompt_groups
    ORDER BY CASE WHEN id = 'default' THEN 0 WHEN id = 'translate' THEN 1 ELSE 2 END, name ASC
  `).all();

  const prompts = db.prepare(`
    SELECT id, name, content, group_id, description, created_at, updated_at
    FROM prompts
    ORDER BY updated_at DESC, name ASC
  `).all();

  const tagRows = db.prepare(`
    SELECT prompt_id, tag
    FROM prompt_tags
    ORDER BY prompt_id ASC, tag ASC
  `).all();

  const tagsByPrompt = new Map();
  for (const row of tagRows) {
    if (!tagsByPrompt.has(row.prompt_id)) {
      tagsByPrompt.set(row.prompt_id, []);
    }
    tagsByPrompt.get(row.prompt_id).push(row.tag);
  }

  const formattedPrompts = prompts.map(prompt => ({
    id: prompt.id,
    name: prompt.name,
    content: prompt.content || '',
    groupId: prompt.group_id || 'default',
    description: prompt.description || '',
    createdAt: prompt.created_at,
    updatedAt: prompt.updated_at,
    tags: tagsByPrompt.get(prompt.id) || []
  }));

  const allTags = Array.from(new Set(tagRows.map(row => row.tag)));

  return {
    prompts: formattedPrompts,
    groups: groups.length > 0 ? groups : [DEFAULT_PROMPT_GROUP],
    tags: allTags
  };
}

function replaceLanguages(db, languagesData) {
  db.prepare('DELETE FROM languages').run();

  const insertLanguage = db.prepare(`
    INSERT INTO languages (id, name, code, language_type, created_at, updated_at)
    VALUES (@id, @name, @code, @language_type, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);

  (languagesData.sourceLanguages || []).forEach(lang => {
    insertLanguage.run({
      id: `source:${lang.id}`,
      name: lang.name,
      code: lang.code || '',
      language_type: 'source'
    });
  });

  (languagesData.targetLanguages || []).forEach(lang => {
    insertLanguage.run({
      id: `target:${lang.id}`,
      name: lang.name,
      code: lang.code || '',
      language_type: 'target'
    });
  });
}

function buildLanguagesFromDb(db) {
  const rows = db.prepare(`
    SELECT id, name, code, language_type
    FROM languages
    ORDER BY language_type ASC, name ASC
  `).all();

  const sourceLanguages = [];
  const targetLanguages = [];

  for (const row of rows) {
    const item = {
      id: row.id.replace(/^source:|^target:/, ''),
      name: row.name,
      code: row.code || ''
    };

    if (row.language_type === 'source') {
      sourceLanguages.push(item);
    } else if (row.language_type === 'target') {
      targetLanguages.push(item);
    }
  }

  return { sourceLanguages, targetLanguages };
}

function replaceConversations(db, conversations) {
  db.prepare('DELETE FROM conversation_messages').run();
  db.prepare('DELETE FROM conversations').run();

  const insertConversation = db.prepare(`
    INSERT INTO conversations (id, title, model, created_at, updated_at)
    VALUES (@id, @title, @model, @created_at, @updated_at)
  `);

  const insertMessage = db.prepare(`
    INSERT INTO conversation_messages (
      conversation_id, message_index, role, content, error, streaming,
      message_type, rendered, text_content, metadata_json, error_details_json,
      generated_images_json, images_json, files_json, created_at, updated_at
    ) VALUES (
      @conversation_id, @message_index, @role, @content, @error, @streaming,
      @message_type, @rendered, @text_content, @metadata_json, @error_details_json,
      @generated_images_json, @images_json, @files_json, @created_at, @updated_at
    )
  `);

  conversations.forEach(conversation => {
    insertConversation.run({
      id: conversation.id,
      title: conversation.title || '',
      model: conversation.model || '',
      created_at: conversation.createdAt || conversation.created_at || nowIso(),
      updated_at: conversation.updatedAt || conversation.updated_at || nowIso()
    });

    (conversation.messages || []).forEach((msg, index) => {
      insertMessage.run({
        conversation_id: conversation.id,
        message_index: index,
        role: msg.role,
        content: msg.content || '',
        error: msg.error ? 1 : 0,
        streaming: msg.streaming ? 1 : 0,
        message_type: msg.messageType || '',
        rendered: msg.rendered || '',
        text_content: msg.textContent || '',
        metadata_json: serialize(msg.metadata || null),
        error_details_json: serialize(msg.errorDetails || null),
        generated_images_json: serialize(msg.generatedImages || null),
        images_json: serialize(msg.images || null),
        files_json: serialize(msg.files || null),
        created_at: msg.createdAt || msg.created_at || nowIso(),
        updated_at: msg.updatedAt || msg.updated_at || nowIso()
      });
    });
  });
}

function buildConversationsFromDb(db) {
  const conversations = db.prepare(`
    SELECT id, title, model, created_at, updated_at
    FROM conversations
    ORDER BY updated_at DESC, id DESC
  `).all();

  const messages = db.prepare(`
    SELECT *
    FROM conversation_messages
    ORDER BY conversation_id ASC, message_index ASC
  `).all();

  const messageMap = new Map();
  for (const row of messages) {
    if (!messageMap.has(row.conversation_id)) {
      messageMap.set(row.conversation_id, []);
    }
    messageMap.get(row.conversation_id).push({
      role: row.role,
      content: row.content,
      error: !!row.error,
      streaming: !!row.streaming,
      messageType: row.message_type || undefined,
      rendered: row.rendered || undefined,
      textContent: row.text_content || undefined,
      metadata: deserialize(row.metadata_json, null),
      errorDetails: deserialize(row.error_details_json, null),
      generatedImages: deserialize(row.generated_images_json, null),
      images: deserialize(row.images_json, null),
      files: deserialize(row.files_json, null),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }

  return conversations.map(conversation => ({
    id: conversation.id,
    title: conversation.title || '',
    model: conversation.model || '',
    messages: messageMap.get(conversation.id) || [],
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at
  }));
}

async function readConversationFiles() {
  try {
    const files = await fs.readdir(CONVERSATIONS_DIR);
    const conversations = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = await fs.readFile(path.join(CONVERSATIONS_DIR, file), 'utf8');
        conversations.push(JSON.parse(content));
      } catch {
        // ignore broken conversation file
      }
    }

    return conversations;
  } catch {
    return [];
  }
}

function migrateJsonDataToSqlite() {
  const db = getDb();
  const migrated = getMeta(db, 'json_migrated_to_sqlite');
  if (migrated === '1') {
    return { migrated: false, reason: 'already_migrated' };
  }

  const transaction = db.transaction((payload) => {
    upsertProviderGroups(db, payload.apiSettings.groups?.length ? payload.apiSettings.groups : [DEFAULT_PROVIDER_GROUP]);
    replaceProviders(db, payload.apiSettings.providers || []);

    Object.entries(payload.userSettings).forEach(([key, value]) => {
      if (key === 'proxyApiKeys') return;
      setSetting(db, key, value, typeof value === 'string' ? 'string' : 'json');
    });

    db.prepare('DELETE FROM proxy_keys').run();
    const insertProxyKey = db.prepare(`
      INSERT INTO proxy_keys (
        id, name, description, api_key, enabled, created_at, last_used,
        usage_count, allowed_models_json, allowed_groups_json, rate_limit_json, updated_at
      ) VALUES (
        @id, @name, @description, @api_key, @enabled, @created_at, @last_used,
        @usage_count, @allowed_models_json, @allowed_groups_json, @rate_limit_json, CURRENT_TIMESTAMP
      )
    `);

    Object.entries(payload.userSettings.proxyApiKeys || {}).forEach(([id, key]) => {
      insertProxyKey.run({
        id,
        name: key.name,
        description: key.description || '',
        api_key: key.apiKey,
        enabled: key.enabled === false ? 0 : 1,
        created_at: key.createdAt || nowIso(),
        last_used: key.lastUsed || null,
        usage_count: key.usageCount || 0,
        allowed_models_json: serialize(key.allowedModels || []),
        allowed_groups_json: serialize(key.allowedGroups || []),
        rate_limit_json: serialize(key.rateLimit || { requestsPerMinute: 60, requestsPerHour: 1000 })
      });
    });

    replacePrompts(db, payload.promptsData);
    replaceLanguages(db, payload.languagesData);
    replaceConversations(db, payload.conversations);

    setMeta(db, 'json_migrated_to_sqlite', '1');
  });

  return Promise.all([
    safeReadJson(API_SETTINGS_FILE, { providers: [], groups: [DEFAULT_PROVIDER_GROUP] }),
    safeReadJson(USER_SETTINGS_FILE, DEFAULT_USER_SETTINGS),
    safeReadJson(PROMPTS_FILE, { prompts: [], groups: [DEFAULT_PROMPT_GROUP, DEFAULT_TRANSLATE_GROUP], tags: [] }),
    safeReadJson(LANGUAGES_FILE, DEFAULT_LANGUAGES),
    readConversationFiles()
  ]).then(([apiSettings, userSettings, promptsData, languagesData, conversations]) => {
    transaction({ apiSettings, userSettings, promptsData, languagesData, conversations });
    return { migrated: true };
  });
}

function getApiSettingsFromDb() {
  return buildApiSettingsFromDb(getDb());
}

function saveApiSettingsToDb(data) {
  const db = getDb();
  const tx = db.transaction(() => {
    upsertProviderGroups(db, data.groups?.length ? data.groups : [DEFAULT_PROVIDER_GROUP]);
    replaceProviders(db, data.providers || []);
  });
  tx();
  return getApiSettingsFromDb();
}

function getUserSettingsFromDb() {
  return buildUserSettingsFromDb(getDb());
}

function saveUserSettingsToDb(settings) {
  const db = getDb();
  const tx = db.transaction(() => {
    Object.entries(settings).forEach(([key, value]) => {
      if (key === 'proxyApiKeys') return;
      setSetting(db, key, value, typeof value === 'string' ? 'string' : 'json');
    });

    db.prepare('DELETE FROM proxy_keys').run();
    const insertProxyKey = db.prepare(`
      INSERT INTO proxy_keys (
        id, name, description, api_key, enabled, created_at, last_used,
        usage_count, allowed_models_json, allowed_groups_json, rate_limit_json, updated_at
      ) VALUES (
        @id, @name, @description, @api_key, @enabled, @created_at, @last_used,
        @usage_count, @allowed_models_json, @allowed_groups_json, @rate_limit_json, CURRENT_TIMESTAMP
      )
    `);

    Object.entries(settings.proxyApiKeys || {}).forEach(([id, key]) => {
      insertProxyKey.run({
        id,
        name: key.name,
        description: key.description || '',
        api_key: key.apiKey,
        enabled: key.enabled === false ? 0 : 1,
        created_at: key.createdAt || nowIso(),
        last_used: key.lastUsed || null,
        usage_count: key.usageCount || 0,
        allowed_models_json: serialize(key.allowedModels || []),
        allowed_groups_json: serialize(key.allowedGroups || []),
        rate_limit_json: serialize(key.rateLimit || { requestsPerMinute: 60, requestsPerHour: 1000 })
      });
    });
  });
  tx();
  return getUserSettingsFromDb();
}

function getPromptsFromDb() {
  return buildPromptsFromDb(getDb());
}

function savePromptsToDb(data) {
  const db = getDb();
  const tx = db.transaction(() => {
    replacePrompts(db, data);
  });
  tx();
  return getPromptsFromDb();
}

function getLanguagesFromDb() {
  return buildLanguagesFromDb(getDb());
}

function saveLanguagesToDb(data) {
  const db = getDb();
  const tx = db.transaction(() => {
    replaceLanguages(db, data);
  });
  tx();
  return getLanguagesFromDb();
}

function getConversationsFromDb() {
  return buildConversationsFromDb(getDb());
}

function getConversationByIdFromDb(id) {
  return getConversationsFromDb().find(conversation => conversation.id === id) || null;
}

function saveConversationToDb(conversation) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM conversation_messages WHERE conversation_id = ?').run(conversation.id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(conversation.id);
    replaceConversations(db, [conversation]);
  });
  tx();
  return getConversationByIdFromDb(conversation.id);
}

function deleteConversationFromDb(id) {
  const db = getDb();
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

module.exports = {
  migrateJsonDataToSqlite,
  getApiSettingsFromDb,
  saveApiSettingsToDb,
  getUserSettingsFromDb,
  saveUserSettingsToDb,
  getPromptsFromDb,
  savePromptsToDb,
  getLanguagesFromDb,
  saveLanguagesToDb,
  getConversationsFromDb,
  getConversationByIdFromDb,
  saveConversationToDb,
  deleteConversationFromDb,
  DEFAULT_USER_SETTINGS,
  DEFAULT_LANGUAGES,
  DEFAULT_PROVIDER_GROUP,
  DEFAULT_PROMPT_GROUP,
  DEFAULT_TRANSLATE_GROUP
};
