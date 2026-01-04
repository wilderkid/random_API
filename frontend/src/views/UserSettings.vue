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
  defaultModel: ''
})
const saveMessage = ref('')
const selectedSetting = ref('user')
const allModels = ref([])

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

onMounted(() => {
  loadSettings()
  loadModels()
})
</script>
