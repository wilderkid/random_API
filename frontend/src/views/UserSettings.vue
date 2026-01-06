<template>
  <div class="user-settings-container">
    <!-- 左侧配置列表 -->
    <div class="settings-sidebar">
      <div class="sidebar-header">
        <h3>配置项目</h3>
      </div>
      
      <div class="settings-list">
        <div
          v-for="item in settingsItems"
          :key="item.id"
          :class="['settings-item', { active: selectedSetting === item.id }]"
          @click="selectSetting(item.id)"
        >
          <div class="settings-item-icon">{{ item.icon }}</div>
          <div class="settings-item-info">
            <div class="settings-item-name">{{ item.name }}</div>
            <div class="settings-item-desc">{{ item.description }}</div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 右侧配置详情 -->
    <div class="settings-details-panel">
      <div v-if="selectedSetting === 'user'" class="details-content">
        <div class="details-header">
          <h2>用户配置</h2>
        </div>
        
        <div class="settings-form">
          <section class="settings-section">
            <h3>默认模型参数</h3>
            <label>
              温度 (Temperature):
              <input v-model.number="settings.defaultParams.temperature" type="number" step="0.1" min="0" max="2" class="input-field">
            </label>
            <label>
              最大长度 (Max Tokens):
              <input v-model.number="settings.defaultParams.max_tokens" type="number" class="input-field">
            </label>
            <label>
              Top P:
              <input v-model.number="settings.defaultParams.top_p" type="number" step="0.1" min="0" max="1" class="input-field">
            </label>
          </section>
          
          <section class="settings-section">
            <h3>全局调用频率</h3>
            <label>
              请求频率限制 (次/分钟):
              <input v-model.number="settings.globalFrequency" type="number" class="input-field">
            </label>
          </section>
          
          <button @click="saveSettings" class="btn-save">保存设置</button>
          <div v-if="saveMessage" class="save-message">{{ saveMessage }}</div>
        </div>
      </div>
      
      <div v-else-if="selectedSetting === 'defaultModel'" class="details-content">
        <div class="details-header">
          <h2>默认模型配置</h2>
        </div>
        
        <div class="settings-form">
          <section class="settings-section">
            <h3>默认模型选择</h3>
            <label>
              默认模型:
              <select v-model="settings.defaultModel" class="input-field">
                <option value="">请选择默认模型</option>
                <option v-for="model in allModels" :key="model.value" :value="model.value">
                  {{ model.label }}
                </option>
              </select>
            </label>
            <p class="hint-text">设置后，新建对话时将自动选择此模型</p>
          </section>
          
          <button @click="saveSettings" class="btn-save">保存设置</button>
          <div v-if="saveMessage" class="save-message">{{ saveMessage }}</div>
        </div>
      </div>
      
      <div v-else-if="selectedSetting === 'proxy'" class="details-content">
        <div class="details-header">
          <h2>代理接口配置</h2>
        </div>
        
        <div class="settings-form">
          <section class="settings-section">
            <h3>API 代理密钥</h3>
            <p class="hint-text">设置一个密钥用于外部软件（如 Cursor、VS Code 等）访问本服务的 OpenAI 兼容接口</p>
            <label>
              代理 API Key:
              <div class="input-with-button">
                <input
                  v-model="settings.proxyApiKey"
                  :type="showProxyKey ? 'text' : 'password'"
                  class="input-field"
                  placeholder="输入代理密钥（留空表示无需认证）"
                >
                <button @click="showProxyKey = !showProxyKey" class="btn-toggle-visibility">
                  {{ showProxyKey ? '🙈' : '👁️' }}
                </button>
                <button @click="generateProxyKey" class="btn-generate">生成随机密钥</button>
              </div>
            </label>
          </section>
          
          <section class="settings-section">
            <h3>接口地址</h3>
            <p class="hint-text">在外部软件中使用以下地址：</p>
            <div class="endpoint-info">
              <div class="endpoint-item">
                <span class="endpoint-label">Base URL:</span>
                <code class="endpoint-url">http://localhost:3000/v1</code>
                <button @click="copyToClipboard('http://localhost:3000/v1')" class="btn-copy">复制</button>
              </div>
              <div class="endpoint-item">
                <span class="endpoint-label">Chat Completions:</span>
                <code class="endpoint-url">http://localhost:3000/v1/chat/completions</code>
                <button @click="copyToClipboard('http://localhost:3000/v1/chat/completions')" class="btn-copy">复制</button>
              </div>
              <div class="endpoint-item">
                <span class="endpoint-label">Models:</span>
                <code class="endpoint-url">http://localhost:3000/v1/models</code>
                <button @click="copyToClipboard('http://localhost:3000/v1/models')" class="btn-copy">复制</button>
              </div>
            </div>
          </section>
          
          <section class="settings-section">
            <h3>默认轮询模型</h3>
            <p class="hint-text">外部请求未指定模型时使用的默认模型（需要在轮询设置中配置可用池）</p>
            <label>
              默认模型名称:
              <input
                v-model="settings.proxyDefaultModel"
                type="text"
                class="input-field"
                placeholder="例如: gpt-4o-mini"
              >
            </label>
          </section>
          
          <button @click="saveSettings" class="btn-save">保存设置</button>
          <div v-if="saveMessage" class="save-message">{{ saveMessage }}</div>
        </div>
      </div>
      
      <div v-else class="empty-state">
        <p>请从左侧选择一个配置项</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'

const settings = ref({
  defaultParams: { temperature: 0.7, max_tokens: 2000, top_p: 1 },
  globalFrequency: 10,
  defaultModel: '',
  proxyApiKey: '',
  proxyDefaultModel: ''
})
const saveMessage = ref('')
const selectedSetting = ref('user')
const allModels = ref([])
const showProxyKey = ref(false)

const settingsItems = ref([
  {
    id: 'user',
    name: '用户配置',
    description: '基本参数设置',
    icon: '👤'
  },
  {
    id: 'defaultModel',
    name: '默认模型',
    description: '新对话默认模型',
    icon: '🤖'
  },
  {
    id: 'proxy',
    name: '代理接口',
    description: 'OpenAI兼容接口设置',
    icon: '🔌'
  }
])

function selectSetting(settingId) {
  selectedSetting.value = settingId
}

async function loadSettings() {
  const res = await axios.get('/api/settings')
  settings.value = { ...settings.value, ...res.data }
}

async function loadModels() {
  try {
    const res = await axios.get('/api/providers')
    const models = []
    for (const provider of res.data) {
      if (provider.disabled) continue
      const addedModels = provider.models || []
      addedModels.forEach(m => {
        if (m.visible) {
          models.push({
            value: `${provider.id}::${m.id}`,
            label: `${provider.name} - ${m.id}`
          })
        }
      })
    }
    allModels.value = models
  } catch (error) {
    console.error('Error loading models:', error)
    allModels.value = []
  }
}

async function saveSettings() {
  await axios.put('/api/settings', settings.value)
  saveMessage.value = '设置已保存'
  setTimeout(() => saveMessage.value = '', 2000)
}

// 生成随机代理密钥
function generateProxyKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let key = 'sk-'
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  settings.value.proxyApiKey = key
}

// 复制到剪贴板
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    saveMessage.value = '已复制到剪贴板'
    setTimeout(() => saveMessage.value = '', 2000)
  }).catch(err => {
    console.error('复制失败:', err)
  })
}

onMounted(() => {
  loadSettings()
  loadModels()
})
</script>

<style scoped>
.user-settings-container {
  display: flex;
  height: 100%;
  background-color: #f5f5f5;
}

.settings-sidebar {
  width: 280px;
  background-color: #fff;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 20px;
  border-bottom: 1px solid #e0e0e0;
}

.sidebar-header h3 {
  margin: 0;
  font-size: 18px;
  color: #333;
}

.settings-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.settings-item {
  display: flex;
  align-items: center;
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
  margin-bottom: 8px;
}

.settings-item:hover {
  background-color: #f0f0f0;
}

.settings-item.active {
  background-color: #e3f2fd;
}

.settings-item-icon {
  font-size: 24px;
  margin-right: 12px;
}

.settings-item-info {
  flex: 1;
}

.settings-item-name {
  font-size: 14px;
  font-weight: 500;
  color: #333;
}

.settings-item-desc {
  font-size: 12px;
  color: #666;
  margin-top: 2px;
}

.settings-details-panel {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.details-content {
  max-width: 800px;
  margin: 0 auto;
}

.details-header h2 {
  margin: 0 0 20px 0;
  font-size: 24px;
  color: #333;
}

.settings-form {
  background-color: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.settings-section {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid #e0e0e0;
}

.settings-section:last-of-type {
  border-bottom: none;
  margin-bottom: 16px;
}

.settings-section h3 {
  margin: 0 0 12px 0;
  font-size: 16px;
  color: #333;
}

.settings-section label {
  display: block;
  margin-bottom: 12px;
  font-size: 14px;
  color: #555;
}

.input-field {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  margin-top: 6px;
  box-sizing: border-box;
}

.input-field:focus {
  outline: none;
  border-color: #1976d2;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.2);
}

.hint-text {
  font-size: 12px;
  color: #888;
  margin: 8px 0;
}

.btn-save {
  background-color: #1976d2;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.btn-save:hover {
  background-color: #1565c0;
}

.save-message {
  margin-top: 12px;
  color: #4caf50;
  font-size: 14px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #888;
}

/* 代理设置相关样式 */
.input-with-button {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.input-with-button .input-field {
  flex: 1;
  margin-top: 0;
}

.btn-toggle-visibility,
.btn-generate {
  padding: 10px 16px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background-color: #f5f5f5;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.btn-toggle-visibility:hover,
.btn-generate:hover {
  background-color: #e0e0e0;
}

.btn-generate {
  background-color: #e3f2fd;
  border-color: #90caf9;
  color: #1976d2;
}

.btn-generate:hover {
  background-color: #bbdefb;
}

.endpoint-info {
  background-color: #f8f9fa;
  border-radius: 8px;
  padding: 16px;
  margin-top: 12px;
}

.endpoint-item {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 8px;
}

.endpoint-item:last-child {
  margin-bottom: 0;
}

.endpoint-label {
  font-weight: 500;
  color: #555;
  min-width: 140px;
}

.endpoint-url {
  background-color: #fff;
  border: 1px solid #e0e0e0;
  padding: 6px 12px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 13px;
  color: #333;
  flex: 1;
  word-break: break-all;
}

.btn-copy {
  padding: 6px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background-color: #fff;
  cursor: pointer;
  font-size: 12px;
  color: #666;
  transition: all 0.2s;
}

.btn-copy:hover {
  background-color: #f0f0f0;
  border-color: #ccc;
}
</style>
