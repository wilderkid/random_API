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

      <div v-else-if="selectedSetting === 'defaultPrompt'" class="details-content">
        <div class="details-header">
          <h2>默认提示词配置</h2>
        </div>

        <div class="settings-form">
          <section class="settings-section">
            <h3>默认提示词选择</h3>
            <label>
              默认提示词:
              <select v-model="settings.defaultPromptId" class="input-field">
                <option value="">无（不使用提示词）</option>
                <option v-for="prompt in allPrompts" :key="prompt.id" :value="prompt.id">
                  {{ prompt.name }}
                </option>
              </select>
            </label>
            <p class="hint-text">设置后，聊天时将默认选择此提示词作为系统提示词</p>

            <!-- 提示词预览 -->
            <div v-if="selectedPromptPreview" class="prompt-preview-box">
              <h4>提示词预览</h4>
              <div class="prompt-preview-header">
                <strong>{{ selectedPromptPreview.name }}</strong>
                <span class="prompt-preview-desc">{{ selectedPromptPreview.description }}</span>
              </div>
              <div class="prompt-preview-content">{{ selectedPromptPreview.content }}</div>
            </div>
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
            <h3>API 密钥管理</h3>
            <div class="migration-notice">
              <p class="notice-text">🔄 密钥管理已迁移</p>
              <p class="hint-text">API 密钥配置已迁移到专门的"代理密钥"页面，支持多密钥管理和参数隔离。</p>
              <p class="hint-text">请前往左侧菜单的"代理密钥"页面进行配置。</p>
            </div>
          </section>
          
          <section class="settings-section">
            <h3>接口地址</h3>
            <p class="hint-text">在外部软件中使用以下地址：</p>
            <div class="endpoint-info">
              <div class="endpoint-item">
                <span class="endpoint-label">Base URL:</span>
                <code class="endpoint-url">{{ apiBaseUrl }}/v1</code>
                <button @click="copyToClipboard(`${apiBaseUrl}/v1`)" class="btn-copy">复制</button>
              </div>
              <div class="endpoint-item">
                <span class="endpoint-label">Chat Completions:</span>
                <code class="endpoint-url">{{ apiBaseUrl }}/v1/chat/completions</code>
                <button @click="copyToClipboard(`${apiBaseUrl}/v1/chat/completions`)" class="btn-copy">复制</button>
              </div>
              <div class="endpoint-item">
                <span class="endpoint-label">Models:</span>
                <code class="endpoint-url">{{ apiBaseUrl }}/v1/models</code>
                <button @click="copyToClipboard(`${apiBaseUrl}/v1/models`)" class="btn-copy">复制</button>
              </div>
            </div>
          </section>
          
          <section class="settings-section">
            <h3>使用说明</h3>
            <div class="usage-info">
              <p class="hint-text">⚠️ 重要提示：</p>
              <ul class="usage-list">
                <li>外部请求必须指定具体的模型名称</li>
                <li>只有在轮询设置中配置为可用池的模型才能使用</li>
                <li>系统会自动使用轮询机制选择提供商</li>
                <li>不支持的模型会返回错误信息</li>
              </ul>
            </div>
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
import { ref, onMounted, computed } from 'vue'
import axios from 'axios'

const settings = ref({
  defaultParams: { temperature: 0.7, max_tokens: 2000, top_p: 1 },
  globalFrequency: 10,
  defaultModel: '',
  defaultPromptId: ''
})
const saveMessage = ref('')
const selectedSetting = ref('user')
const allModels = ref([])
const allPrompts = ref([])

// 动态获取API基础URL
const apiBaseUrl = computed(() => {
  // 如果是开发环境（端口5173），则指向后端端口3000
  // 如果是生产环境，则使用当前域名
  const origin = window.location.origin
  if (origin.includes(':5173')) {
    return origin.replace(':5173', ':3000')
  }
  return origin
})

// 计算选中的提示词预览
const selectedPromptPreview = computed(() => {
  if (!settings.value.defaultPromptId) return null
  return allPrompts.value.find(p => p.id === settings.value.defaultPromptId)
})

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
    id: 'defaultPrompt',
    name: '默认提示词',
    description: '聊天默认系统提示词',
    icon: '💬'
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

async function loadPrompts() {
  try {
    const res = await axios.get('/api/prompts')
    allPrompts.value = res.data.prompts || []
  } catch (error) {
    console.error('Error loading prompts:', error)
    allPrompts.value = []
  }
}

async function saveSettings() {
  await axios.put('/api/settings', settings.value)
  saveMessage.value = '设置已保存'
  setTimeout(() => saveMessage.value = '', 2000)
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
  loadPrompts()
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

/* 迁移通知样式 */
.migration-notice {
  background-color: #e3f2fd;
  border: 1px solid #90caf9;
  border-radius: 8px;
  padding: 16px;
  margin-top: 8px;
}

.notice-text {
  font-weight: 600;
  color: #1976d2;
  margin: 0 0 8px 0;
  font-size: 14px;
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

/* 使用说明样式 */
.usage-info {
  background-color: #fff3cd;
  border: 1px solid #ffeaa7;
  border-radius: 6px;
  padding: 16px;
  margin-top: 8px;
}

.usage-list {
  margin: 8px 0 0 0;
  padding-left: 20px;
}

.usage-list li {
  margin-bottom: 6px;
  color: #856404;
  font-size: 13px;
}

/* 提示词预览样式 */
.prompt-preview-box {
  margin-top: 20px;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 10px;
  border: 2px solid #e0e0e0;
}

.prompt-preview-box h4 {
  margin: 0 0 12px 0;
  color: #333;
  font-size: 14px;
  font-weight: 600;
}

.prompt-preview-header {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid #dee2e6;
}

.prompt-preview-header strong {
  color: #333;
  font-size: 14px;
}

.prompt-preview-desc {
  color: #6c757d;
  font-size: 12px;
}

.prompt-preview-content {
  color: #495057;
  font-size: 13px;
  line-height: 1.6;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
  background: white;
  padding: 12px;
  border-radius: 6px;
}
</style>
