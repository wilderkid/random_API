<template>
  <div class="api-settings-container">
    <!-- 左侧提供商列表 -->
    <div class="providers-sidebar">
      <div class="sidebar-header">
        <input v-model="searchProvider" placeholder="搜索模型平台名..." class="search-input">
        <button @click="showAddProvider = true" class="btn-add-provider">+ 添加提供商</button>
      </div>
      
      <div class="providers-list">
        <div
          v-for="provider in filteredProviders"
          :key="provider.id"
          :class="['provider-item', { active: selectedProvider?.id === provider.id }]"
          @click="selectProvider(provider)"
        >
          <div class="provider-item-icon">{{ provider.name.charAt(0) }}</div>
          <div class="provider-item-info">
            <div class="provider-item-name">{{ provider.name }}</div>
            <div :class="['provider-item-status', provider.disabled ? 'disabled' : 'active']">
              {{ provider.disabled ? '已禁用' : 'ON' }}
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 右侧提供商详情 -->
    <div class="provider-details-panel">
      <div v-if="selectedProvider" class="details-content">
        <div class="details-header">
          <h2>{{ selectedProvider.name }}</h2>
          <div class="header-actions">
            <button @click="toggleStatus" class="btn-toggle">
              {{ selectedProvider.disabled ? '启用' : '禁用' }}
            </button>
            <button @click="editProvider" class="btn-icon" title="编辑">✎</button>
            <button @click="deleteProvider" class="btn-icon" title="删除">×</button>
          </div>
        </div>
        
        <!-- API 密钥 -->
        <div class="config-section">
          <label>API 密钥</label>
          <div class="input-group">
            <input :value="showApiKey ? selectedProvider.apiKey : maskApiKey(selectedProvider.apiKey)" readonly class="input-field">
            <button @click="toggleKeyVisibility" class="btn-icon-small">{{ showApiKey ? '🙈' : '👁' }}</button>
            <button @click="testConnection" class="btn-test">检测</button>
          </div>
        </div>
        
        <!-- API 地址 -->
        <div class="config-section">
          <label>API 地址 <span class="hint">完成: {{ selectedProvider.baseUrl }}/v1/chat/completions</span></label>
          <input :value="selectedProvider.baseUrl" readonly class="input-field">
        </div>
        
        <!-- 模型配置 -->
        <div class="models-config">
          <div class="models-toolbar">
            <label>模型 <span class="count">{{ selectedProvider.models?.length || 0 }}</span></label>
            <input v-model="modelSearch" placeholder="搜索模型平台ID..." class="search-input-small">
            <button @click="fetchModels" class="btn-icon" title="刷新">🔄</button>
            <button v-if="currentAvailableModels" @click="closeModelsList" class="btn-icon" title="关闭">×</button>
          </div>
          
          <!-- 可用模型列表 -->
          <div v-if="currentAvailableModels" class="available-models-panel">
            <div v-for="group in groupedModels" :key="group.name" class="model-group">
              <div class="group-header" @click="toggleGroup(group.name)">
                <span>{{ currentExpandedGroups[group.name] ? '▼' : '▶' }}</span>
                <span>{{ group.name }}</span>
              </div>
              <div v-if="currentExpandedGroups[group.name]" class="group-models">
                <div v-for="model in group.models" :key="model.id" class="model-row">
                  <span class="model-icon">{{ getModelIcon(model.id) }}</span>
                  <span class="model-name">{{ model.id }}</span>
                  <div class="model-actions">
                    <button v-if="hasFeature(model, 'vision')" class="icon-btn" title="视觉">👁</button>
                    <button v-if="hasFeature(model, 'function')" class="icon-btn" title="函数">🔧</button>
                    <button v-if="hasFeature(model, 'web')" class="icon-btn" title="联网">🌐</button>
                    <button @click="copyModelId(model.id)" class="icon-btn" title="复制">📋</button>
                    <button @click="toggleModel(model.id)" class="btn-toggle-model" :title="isAdded(model.id) ? '移除' : '添加'">
                      {{ isAdded(model.id) ? '−' : '+' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <!-- 已添加模型 -->
          <div v-else class="added-models-container">
            <div v-for="group in addedModelsGrouped" :key="group.name" class="added-model-group">
              <div class="added-group-header">{{ group.name }}</div>
              <div class="added-models-grid">
                <div v-for="model in group.models" :key="model.id" class="added-model-card">
                  <span class="model-icon">{{ getModelIcon(model.id) }}</span>
                  <span class="model-name">{{ model.id }}</span>
                  <div class="model-actions">
                    <button @click="toggleVisibility(model.id)" class="btn-icon-tiny" :title="model.visible ? '隐藏' : '显示'">
                      {{ model.visible ? '👁' : '👁‍🗨' }}
                    </button>
                    <button @click="copyModelId(model.id)" class="btn-icon-tiny" title="复制">📋</button>
                    <button @click="removeModel(model.id)" class="btn-icon-tiny" title="删除">×</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div v-else class="empty-state">
        <p>请从左侧选择一个提供商</p>
      </div>
    </div>
    
    <!-- 添加/编辑提供商弹窗 -->
    <div v-if="showAddProvider || editingProvider" class="modal" @click.self="closeModal">
      <div class="modal-content">
        <h3>{{ editingProvider ? '编辑提供商' : '添加提供商' }}</h3>
        <label>
          名称
          <input v-model="providerForm.name" class="input-field" placeholder="例如: OpenAI">
        </label>
        <label>
          API 密钥
          <input v-model="providerForm.apiKey" type="password" class="input-field" placeholder="sk-...">
        </label>
        <label>
          基础 URL
          <input v-model="providerForm.baseUrl" class="input-field" placeholder="https://api.openai.com">
        </label>
        <div class="modal-actions">
          <button @click="saveProvider" class="btn-save">保存</button>
          <button @click="closeModal" class="btn-cancel">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'

const providers = ref([])
const selectedProvider = ref(null)
const searchProvider = ref('')
const modelSearch = ref('')
const availableModelsCache = ref({}) // 缓存每个提供商的模型列表
const expandedGroupsCache = ref({}) // 缓存每个提供商的展开状态
const showAddProvider = ref(false)
const editingProvider = ref(null)
const providerForm = ref({ name: '', baseUrl: '', apiKey: '' })
const showApiKey = ref(false)

const filteredProviders = computed(() => {
  const query = searchProvider.value.toLowerCase()
  return query ? providers.value.filter(p => p.name.toLowerCase().includes(query)) : providers.value
})

const currentAvailableModels = computed(() => {
  return selectedProvider.value ? availableModelsCache.value[selectedProvider.value.id] : null
})

const currentExpandedGroups = computed(() => {
  return selectedProvider.value ? (expandedGroupsCache.value[selectedProvider.value.id] || {}) : {}
})

const groupedModels = computed(() => {
  if (!currentAvailableModels.value) return []
  const query = modelSearch.value.toLowerCase()
  const filtered = query ? currentAvailableModels.value.filter(m => m.id.toLowerCase().includes(query)) : currentAvailableModels.value
  
  const groups = {}
  filtered.forEach(model => {
    const groupName = model.id.split(/[-/]/)[0] || 'other'
    if (!groups[groupName]) groups[groupName] = []
    groups[groupName].push(model)
  })
  
  return Object.entries(groups).map(([name, models]) => ({ name, models }))
})

const addedModelsGrouped = computed(() => {
  if (!selectedProvider.value?.models) return []
  
  const groups = {}
  selectedProvider.value.models.forEach(model => {
    const groupName = model.id.split(/[-/]/)[0] || 'other'
    if (!groups[groupName]) groups[groupName] = []
    groups[groupName].push(model)
  })
  
  return Object.entries(groups).map(([name, models]) => ({ name, models }))
})

async function loadProviders() {
  const res = await axios.get('/api/providers')
  providers.value = res.data.map(p => ({ ...p, models: p.models || [] }))
  if (providers.value.length > 0 && !selectedProvider.value) {
    selectedProvider.value = providers.value[0]
  }
}

function selectProvider(provider) {
  selectedProvider.value = provider
  modelSearch.value = ''
  showApiKey.value = false
}

async function fetchModels() {
  try {
    const res = await axios.get(`/api/providers/${selectedProvider.value.id}/models`)
    const providerId = selectedProvider.value.id
    
    // 缓存模型列表
    availableModelsCache.value[providerId] = res.data
    
    // 自动展开所有分组
    const groups = {}
    res.data.forEach(model => {
      const groupName = model.id.split(/[-/]/)[0] || 'other'
      groups[groupName] = true
    })
    expandedGroupsCache.value[providerId] = groups
  } catch (e) {
    alert('获取模型失败: ' + (e.response?.data?.error || e.message))
  }
}

function closeModelsList() {
  if (selectedProvider.value) {
    delete availableModelsCache.value[selectedProvider.value.id]
    delete expandedGroupsCache.value[selectedProvider.value.id]
  }
}

function toggleGroup(groupName) {
  if (!selectedProvider.value) return
  const providerId = selectedProvider.value.id
  if (!expandedGroupsCache.value[providerId]) {
    expandedGroupsCache.value[providerId] = {}
  }
  expandedGroupsCache.value[providerId][groupName] = !expandedGroupsCache.value[providerId][groupName]
}

function isAdded(modelId) {
  return selectedProvider.value.models?.some(m => m.id === modelId)
}

async function toggleModel(modelId) {
  const models = selectedProvider.value.models || []
  const index = models.findIndex(m => m.id === modelId)
  
  if (index >= 0) {
    models.splice(index, 1)
  } else {
    models.push({ id: modelId, visible: true })
  }
  
  selectedProvider.value.models = models
  await axios.put(`/api/providers/${selectedProvider.value.id}`, selectedProvider.value)
  await loadProviders()
}

async function removeModel(modelId) {
  selectedProvider.value.models = selectedProvider.value.models.filter(m => m.id !== modelId)
  await axios.put(`/api/providers/${selectedProvider.value.id}`, selectedProvider.value)
  await loadProviders()
}

async function toggleVisibility(modelId) {
  const model = selectedProvider.value.models.find(m => m.id === modelId)
  model.visible = !model.visible
  await axios.put(`/api/providers/${selectedProvider.value.id}`, selectedProvider.value)
}

async function toggleStatus() {
  selectedProvider.value.disabled = !selectedProvider.value.disabled
  await axios.put(`/api/providers/${selectedProvider.value.id}`, selectedProvider.value)
  await loadProviders()
}

function editProvider() {
  editingProvider.value = selectedProvider.value
  providerForm.value = {
    name: selectedProvider.value.name,
    baseUrl: selectedProvider.value.baseUrl,
    apiKey: selectedProvider.value.apiKey
  }
}

async function saveProvider() {
  if (editingProvider.value) {
    await axios.put(`/api/providers/${editingProvider.value.id}`, providerForm.value)
  } else {
    await axios.post('/api/providers', providerForm.value)
  }
  closeModal()
  await loadProviders()
  if (!editingProvider.value && providers.value.length > 0) {
    selectedProvider.value = providers.value[providers.value.length - 1]
  }
}

async function deleteProvider() {
  if (confirm('确定删除此提供商及其所有模型？')) {
    await axios.delete(`/api/providers/${selectedProvider.value.id}`)
    selectedProvider.value = null
    await loadProviders()
  }
}

async function testConnection() {
  try {
    await axios.get(`/api/providers/${selectedProvider.value.id}/test`)
    alert('连接成功！')
  } catch (e) {
    alert('连接失败: ' + (e.response?.data?.error || e.message))
  }
}

function toggleKeyVisibility() {
  showApiKey.value = !showApiKey.value
}

function copyModelId(modelId) {
  navigator.clipboard.writeText(modelId)
}

function hasFeature(model, feature) {
  return false
}

function maskApiKey(key) {
  if (!key) return ''
  if (key.length <= 12) return '••••••••'
  return key.slice(0, 8) + '••••••••' + key.slice(-4)
}

function getModelIcon(modelId) {
  const lower = modelId.toLowerCase()
  if (lower.includes('gpt') || lower.includes('o1')) return '🤖'
  if (lower.includes('claude')) return '🎭'
  if (lower.includes('gemini')) return '💎'
  if (lower.includes('bytedance') || lower.includes('doubao')) return '🔥'
  return '🔮'
}

function closeModal() {
  showAddProvider.value = false
  editingProvider.value = null
  providerForm.value = { name: '', baseUrl: '', apiKey: '' }
}

onMounted(loadProviders)
</script>
