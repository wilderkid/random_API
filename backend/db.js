const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'app.db');

let dbInstance = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function createConnection() {
  ensureDataDir();

  const db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -32000');

  return db;
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      value_type TEXT NOT NULL DEFAULT 'json',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS provider_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      group_id TEXT DEFAULT 'default',
      api_type TEXT DEFAULT 'openai',
      model_type TEXT DEFAULT 'text',
      sort_order INTEGER DEFAULT 0,
      disabled INTEGER DEFAULT 0,
      fail_count INTEGER DEFAULT 0,
      exclude_auto_refresh INTEGER DEFAULT 0,
      custom_endpoints_chat TEXT DEFAULT '',
      custom_endpoints_models TEXT DEFAULT '',
      custom_endpoints_images TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES provider_groups(id) ON DELETE SET DEFAULT
    );

    CREATE INDEX IF NOT EXISTS idx_providers_group_id ON providers(group_id);
    CREATE INDEX IF NOT EXISTS idx_providers_disabled ON providers(disabled);

    CREATE TABLE IF NOT EXISTS provider_keys (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      weight INTEGER DEFAULT 1,
      priority INTEGER DEFAULT 0,
      fail_count INTEGER DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_provider_keys_provider_id ON provider_keys(provider_id);
    CREATE INDEX IF NOT EXISTS idx_provider_keys_enabled ON provider_keys(enabled);

    CREATE TABLE IF NOT EXISTS provider_models (
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      visible INTEGER DEFAULT 1,
      type TEXT DEFAULT 'text',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider_id, model_id),
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_provider_models_provider_id ON provider_models(provider_id);
    CREATE INDEX IF NOT EXISTS idx_provider_models_visible ON provider_models(visible);

    CREATE TABLE IF NOT EXISTS prompt_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      group_id TEXT DEFAULT 'default',
      description TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY (group_id) REFERENCES prompt_groups(id) ON DELETE SET DEFAULT
    );

    CREATE INDEX IF NOT EXISTS idx_prompts_group_id ON prompts(group_id);

    CREATE TABLE IF NOT EXISTS prompt_tags (
      prompt_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (prompt_id, tag),
      FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_prompt_tags_tag ON prompt_tags(tag);

    CREATE TABLE IF NOT EXISTS languages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT DEFAULT '',
      language_type TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_languages_type ON languages(language_type);

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT DEFAULT '',
      model TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      message_index INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      error INTEGER DEFAULT 0,
      streaming INTEGER DEFAULT 0,
      message_type TEXT DEFAULT '',
      rendered TEXT,
      text_content TEXT,
      metadata_json TEXT,
      error_details_json TEXT,
      generated_images_json TEXT,
      images_json TEXT,
      files_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      UNIQUE (conversation_id, message_index)
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id ON conversation_messages(conversation_id);

    CREATE TABLE IF NOT EXISTS proxy_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      api_key TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT,
      last_used TEXT,
      usage_count INTEGER DEFAULT 0,
      allowed_models_json TEXT DEFAULT '[]',
      allowed_groups_json TEXT DEFAULT '[]',
      allowed_providers_json TEXT DEFAULT '[]',
      allowed_polling_groups_json TEXT DEFAULT '[]',
      allowed_polling_providers_json TEXT DEFAULT '[]',
      use_polling INTEGER DEFAULT 1,
      rate_limit_json TEXT DEFAULT '{"requestsPerMinute":60,"requestsPerHour":1000}',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT DEFAULT '',
      password_hash TEXT DEFAULT '',
      role TEXT NOT NULL DEFAULT 'viewer',
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_permissions (
      user_id TEXT NOT NULL,
      permission_key TEXT NOT NULL,
      permission_value TEXT DEFAULT '1',
      PRIMARY KEY (user_id, permission_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
  `);
}

function ensureProvidersSortOrderColumn(db) {
  try {
    db.prepare('SELECT sort_order FROM providers LIMIT 1').get();
  } catch (error) {
    db.prepare('ALTER TABLE providers ADD COLUMN sort_order INTEGER DEFAULT 0').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_providers_sort_order ON providers(sort_order)').run();
  }
}

function ensureProxyKeysUsePollingColumn(db) {
  try {
    db.prepare('SELECT use_polling FROM proxy_keys LIMIT 1').get();
  } catch (error) {
    db.prepare('ALTER TABLE proxy_keys ADD COLUMN use_polling INTEGER DEFAULT 1').run();
  }
}

function ensureProxyKeysAllowedPollingColumns(db) {
  try {
    db.prepare('SELECT allowed_polling_groups_json FROM proxy_keys LIMIT 1').get();
  } catch (error) {
    db.prepare('ALTER TABLE proxy_keys ADD COLUMN allowed_polling_groups_json TEXT DEFAULT "[]"').run();
  }

  try {
    db.prepare('SELECT allowed_polling_providers_json FROM proxy_keys LIMIT 1').get();
  } catch (error) {
    db.prepare('ALTER TABLE proxy_keys ADD COLUMN allowed_polling_providers_json TEXT DEFAULT "[]"').run();
  }
}

function ensureProxyKeysAllowedProvidersColumn(db) {
  try {
    db.prepare('SELECT allowed_providers_json FROM proxy_keys LIMIT 1').get();
  } catch (error) {
    db.prepare('ALTER TABLE proxy_keys ADD COLUMN allowed_providers_json TEXT DEFAULT "[]"').run();
  }
}

function initializeDatabase() {
  if (dbInstance) {
    return dbInstance;
  }

  const db = createConnection();
  createSchema(db);
  ensureProvidersSortOrderColumn(db);
  ensureProxyKeysUsePollingColumn(db);
  ensureProxyKeysAllowedPollingColumns(db);
  ensureProxyKeysAllowedProvidersColumn(db);

  dbInstance = db;
  return dbInstance;
}

function getDb() {
  return initializeDatabase();
}

function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = {
  DB_FILE,
  getDb,
  initializeDatabase,
  closeDatabase
};
