<template>
  <div class="api-settings-container" :class="currentApiStyleConfig?.cssClass || 'api-style-simple'">
    <!-- 左侧提供商列表 -->
    <div class="providers-sidebar">
      <div class="sidebar-header">
        <!-- 风格选择器 -->
        <div class="api-style-selector" ref="apiStyleSelectorRef">
          <div class="api-style-select-trigger" @click="toggleApiStyleDropdown">
            <span class="api-style-icon">{{ currentApiStyleConfig?.icon || '✨' }}</span>
            <span class="selected-api-style">{{ currentApiStyleConfig?.name || '简约风格' }}</span>
            <span class="dropdown-arrow">{{ showApiStyleDropdown ? '▲' : '▼' }}</span>
          </div>
          <div v-if="showApiStyleDropdown" class="api-style-dropdown">
            <div class="api-style-options">
              <div
                v-for="style in availableApiStyles"
                :key="style.id"
                :class="['api-style-option', { active: currentApiStyle === style.id }]"
                @click="selectApiStyle(style.id)"
                :title="style.description"
              >
                <span class="api-style-option-icon">{{ style.icon }}</span>
                <span class="api-style-option-name">{{ style.name }}</span>
              </div>
            </div>
          </div>
        </div>

        <input v-model="searchProvider" placeholder="搜索模型平台名..." class="search-input">
        <div class="button-group">
          <button @click="showAddProvider = true" class="btn-add-provider">+ 添加</button>
          <button @click="importProviders" class="btn-import">导入</button>
          <button @click="exportProviders" class="btn-export">导出</button>
        </div>
        <div class="button-group">
          <button @click="refreshAllModels" class="btn-refresh-all" :disabled="isRefreshingAll">
            {{ isRefreshingAll ? '刷新中...' : '🔄 刷新所有模型' }}
          </button>
        </div>
        <div class="button-group danger-group">
          <button @click="toggleBatchSelectMode" :class="['btn-batch-select', { active: batchSelectMode }]">
            {{ batchSelectMode ? '✓ 取消选择' : '☐ 批量选择' }}
          </button>
          <button v-if="batchSelectMode && selectedProviderIds.length > 0" @click="batchDeleteProviders" class="btn-batch-delete">
            🗑 删除选中 ({{ selectedProviderIds.length }})
          </button>
          <button @click="clearAllProviders" class="btn-clear-all">🗑 清除所有</button>
        </div>
        <div class="group-management">
          <button @click="showGroupManager = true" class="btn-manage-groups">📁 管理分组</button>
        </div>
      </div>
      
      <div class="providers-list">
        <!-- 按分组显示提供商 -->
        <div v-for="group in groupedProviders" :key="group.id" class="provider-group">
          <div class="group-header" @click="toggleGroupExpand(group.id)">
            <span class="group-expand-icon">{{ expandedGroups[group.id] ? '▼' : '▶' }}</span>
            <span class="group-name">{{ group.name }}</span>
            <span class="group-count">{{ group.providers.length }}</span>
          </div>
          <div v-if="expandedGroups[group.id]" class="group-providers">
            <div
              v-for="provider in group.providers"
              :key="provider.id"
              :class="['provider-item', {
                active: selectedProvider?.id === provider.id,
                'no-models': !provider.disabled && (!provider.models || provider.models.length === 0),
                'batch-selected': batchSelectMode && selectedProviderIds.includes(provider.id)
              }]"
              @click="batchSelectMode ? toggleProviderSelection(provider.id) : selectProvider(provider)"
            >
              <input
                v-if="batchSelectMode"
                type="checkbox"
                :checked="selectedProviderIds.includes(provider.id)"
                @click.stop="toggleProviderSelection(provider.id)"
                class="provider-checkbox"
              >
              <div class="provider-item-icon">{{ provider.name.charAt(0) }}</div>
              <div class="provider-item-info">
                <div class="provider-item-name">
                  {{ provider.name }}
                  <span class="model-count-badge" :class="{ 'zero-models': !provider.disabled && (!provider.models || provider.models.length === 0) }">
                    {{ provider.models?.length || 0 }}
                  </span>
                </div>
                <div :class="['provider-item-status', provider.disabled ? 'disabled' : 'active']">
                  {{ provider.disabled ? '已禁用' : 'ON' }}
                </div>
              </div>
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
        
        <!-- 分组选择 -->
        <div class="config-section">
          <label>所属分组</label>
          <select v-model="selectedProvider.groupId" @change="updateProviderGroup" class="input-field">
            <option v-for="group in groups" :key="group.id" :value="group.id">
              {{ group.name }}
            </option>
          </select>
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
        
        <!-- API 类型 -->
        <div class="config-section">
          <label>API 兼容格式</label>
          <select v-model="selectedProvider.apiType" @change="updateProviderApiType" class="input-field">
            <option value="openai">OpenAI 兼容格式</option>
            <option value="anthropic">Anthropic 兼容格式</option>
          </select>
          <small class="hint">OpenAI格式: /v1/chat/completions | Anthropic格式: /v1/messages</small>
        </div>
        
        <!-- API 地址 -->
        <div class="config-section">
          <label>API 地址 <span class="hint">完成: {{ getFullApiUrl(selectedProvider) }}</span></label>
          <div class="input-group">
            <input :value="selectedProvider.baseUrl" readonly class="input-field">
          </div>
        </div>

        <!-- 自动刷新设置 -->
        <div class="config-section">
          <label class="checkbox-label">
            <input type="checkbox" v-model="selectedProvider.excludeAutoRefresh" @change="updateExcludeAutoRefresh">
            <span>排除自动刷新</span>
          </label>
          <small class="hint">启用后，批量刷新所有模型时将跳过此提供商</small>
        </div>

        <!-- 模型配置 -->
        <div class="models-config">
          <div class="models-toolbar">
            <label>模型 <span class="count">{{ selectedProvider.models?.length || 0 }}</span></label>
            <input v-model="modelSearch" placeholder="搜索模型平台ID..." class="search-input-small">
            <button @click="fetchModels" class="btn-icon" title="刷新">🔄</button>
            <button @click="showAddModelModal = true" class="btn-icon" title="手动添加模型">➕</button>
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
        <label>
          API 兼容格式
          <select v-model="providerForm.apiType" class="input-field">
            <option value="openai">OpenAI 兼容格式</option>
            <option value="anthropic">Anthropic 兼容格式</option>
          </select>
          <small class="hint">OpenAI格式使用 /v1/chat/completions，Anthropic格式使用 /v1/messages</small>
        </label>
        <label>
          所属分组
          <select v-model="providerForm.groupId" class="input-field">
            <option v-for="group in groups" :key="group.id" :value="group.id">
              {{ group.name }}
            </option>
          </select>
        </label>
        <!-- 高级设置折叠面板 -->
        <div class="advanced-settings">
          <div class="advanced-toggle" @click="showAdvanced = !showAdvanced">
            <span>高级设置（自定义端点路径）</span>
            <span>{{ showAdvanced ? '▲' : '▼' }}</span>
          </div>
          <div v-show="showAdvanced" class="advanced-content">
            <small class="hint">留空则使用默认路径，路径需以 / 开头</small>
            <label>
              聊天端点路径
              <input v-model="providerForm.customEndpoints.chat" class="input-field" placeholder="例如: /api/paas/v4/chat/completions">
            </label>
            <label>
              模型列表端点路径
              <input v-model="providerForm.customEndpoints.models" class="input-field" placeholder="例如: /api/paas/v4/models">
            </label>
            <label>
              图像生成端点路径
              <input v-model="providerForm.customEndpoints.images" class="input-field" placeholder="例如: /v1/images/generations">
            </label>
          </div>
        </div>
        <div class="modal-actions">
          <button @click="saveProvider" class="btn-save">保存</button>
          <button @click="closeModal" class="btn-cancel">取消</button>
        </div>
      </div>
    </div>
    
    <!-- 手动添加模型弹窗 -->
    <div v-if="showAddModelModal" class="modal" @click.self="closeAddModelModal">
      <div class="modal-content">
        <h3>手动添加模型</h3>
        <label>
          模型ID
          <input v-model="addModelForm.modelId" class="input-field" placeholder="例如: gpt-4o-mini">
          <small class="hint">请输入完整的模型ID，如 gpt-4o-mini、claude-3-5-sonnet-20241022 等</small>
        </label>
        <label>
          <input type="checkbox" v-model="addModelForm.visible">
          在对话页面显示此模型
        </label>
        <div class="modal-actions">
          <button @click="addModelManually" class="btn-save" :disabled="!addModelForm.modelId.trim()">添加</button>
          <button @click="closeAddModelModal" class="btn-cancel">取消</button>
        </div>
      </div>
    </div>
    
    <!-- 分组管理弹窗 -->
    <div v-if="showGroupManager" class="modal" @click.self="closeGroupManager">
      <div class="modal-content modal-large">
        <h3>分组管理</h3>
        <div class="group-manager-content">
          <div class="group-list">
            <div class="group-list-header">
              <span>分组列表</span>
              <button @click="showAddGroup = true" class="btn-icon-small">➕</button>
            </div>
            <div v-for="group in groups" :key="group.id" class="group-item">
              <div class="group-item-info">
                <div class="group-item-name">{{ group.name }}</div>
                <div class="group-item-desc">{{ group.description || '无描述' }}</div>
                <div class="group-item-count">{{ getGroupProviderCount(group.id) }} 个提供商</div>
              </div>
              <div class="group-item-actions">
                <button v-if="group.id !== 'default'" @click="editGroup(group)" class="btn-icon-tiny">✎</button>
                <button v-if="group.id !== 'default'" @click="deleteGroup(group.id)" class="btn-icon-tiny">×</button>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button @click="closeGroupManager" class="btn-cancel">关闭</button>
        </div>
      </div>
    </div>
    
    <!-- 添加/编辑分组弹窗 -->
    <div v-if="showAddGroup || editingGroup" class="modal" @click.self="closeGroupModal">
      <div class="modal-content">
        <h3>{{ editingGroup ? '编辑分组' : '添加分组' }}</h3>
        <label>
          分组名称
          <input v-model="groupForm.name" class="input-field" placeholder="例如: 主力提供商">
        </label>
        <label>
          描述
          <input v-model="groupForm.description" class="input-field" placeholder="可选">
        </label>
        <div class="modal-actions">
          <button @click="saveGroup" class="btn-save">保存</button>
          <button @click="closeGroupModal" class="btn-cancel">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import axios from 'axios'
import apiStyleManager from '../utils/apiStyleManager.js'
import '../styles/api-simple-style.css'
import '../styles/api-dark-style.css'
import '../styles/api-dashboard-style.css'

const providers = ref([])
const groups = ref([])
const selectedProvider = ref(null)
const searchProvider = ref('')
const modelSearch = ref('')
const availableModelsCache = ref({}) // 缓存每个提供商的模型列表
const expandedGroupsCache = ref({}) // 缓存每个提供商的展开状态
const expandedGroups = ref({}) // 分组展开状态
const showAddProvider = ref(false)
const editingProvider = ref(null)
const providerForm = ref({ name: '', baseUrl: '', apiKey: '', groupId: 'default', apiType: 'openai', customEndpoints: { chat: '', models: '', images: '' } })
const showAdvanced = ref(false)
const showApiKey = ref(false)
const showAddModelModal = ref(false)
const addModelForm = ref({ modelId: '', visible: true })
const showGroupManager = ref(false)
const showAddGroup = ref(false)
const editingGroup = ref(null)
const groupForm = ref({ name: '', description: '' })
const isRefreshingAll = ref(false) // 批量刷新状态
const batchSelectMode = ref(false) // 批量选择模式
const selectedProviderIds = ref([]) // 已选择的供应商ID列表

// 风格选择相关
const currentApiStyle = ref(apiStyleManager.getCurrentStyle())
const showApiStyleDropdown = ref(false)
const apiStyleSelectorRef = ref(null)

const filteredProviders = computed(() => {
  const query = searchProvider.value.toLowerCase()
  return query ? providers.value.filter(p => p.name.toLowerCase().includes(query)) : providers.value
})

const groupedProviders = computed(() => {
  const filtered = filteredProviders.value
  const grouped = {}
  
  // 初始化所有分组
  groups.value.forEach(group => {
    grouped[group.id] = {
      id: group.id,
      name: group.name,
      description: group.description,
      providers: []
    }
  })
  
  // 将提供商分配到对应分组
  filtered.forEach(provider => {
    const groupId = provider.groupId || 'default'
    if (grouped[groupId]) {
      grouped[groupId].providers.push(provider)
    } else {
      // 如果分组不存在，放到默认分组
      if (grouped['default']) {
        grouped['default'].providers.push(provider)
      }
    }
  })
  
  // 转换为数组并过滤掉空分组
  return Object.values(grouped).filter(group => group.providers.length > 0)
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

// 风格相关计算属性
const currentApiStyleConfig = computed(() => {
  return apiStyleManager.getStyle(currentApiStyle.value)
})

const availableApiStyles = computed(() => {
  return apiStyleManager.getAvailableStyles()
})

async function loadProviders() {
  const res = await axios.get('/api/providers')
  providers.value = res.data.map(p => ({
    ...p,
    models: p.models || [],
    groupId: p.groupId || 'default',
    apiType: p.apiType || 'openai' // 默认为OpenAI兼容格式
  }))
  if (providers.value.length > 0 && !selectedProvider.value) {
    selectedProvider.value = providers.value[0]
  }
}

async function loadGroups() {
  try {
    const res = await axios.get('/api/groups')
    groups.value = res.data
    // 初始化所有分组为展开状态
    groups.value.forEach(group => {
      expandedGroups.value[group.id] = true
    })
  } catch (error) {
    console.error('Failed to load groups:', error)
  }
}

function toggleGroupExpand(groupId) {
  expandedGroups.value[groupId] = !expandedGroups.value[groupId]
}

function getGroupProviderCount(groupId) {
  return providers.value.filter(p => (p.groupId || 'default') === groupId).length
}

async function updateProviderGroup() {
  try {
    await axios.put(`/api/providers/${selectedProvider.value.id}/group`, {
      groupId: selectedProvider.value.groupId
    })
    await loadProviders()
  } catch (error) {
    alert('更新分组失败: ' + (error.response?.data?.error || error.message))
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

// 刷新所有提供商的模型
async function refreshAllModels() {
  if (isRefreshingAll.value) return

  const activeProviders = providers.value.filter(p => !p.disabled && !p.excludeAutoRefresh)
  const excludedProviders = providers.value.filter(p => !p.disabled && p.excludeAutoRefresh)

  if (activeProviders.length === 0) {
    alert('没有可用的提供商')
    return
  }

  let confirmMessage = `确定要刷新所有 ${activeProviders.length} 个提供商的模型吗？\n\n这将自动获取最新的模型列表并覆盖现有配置。\n已禁用的提供商将被跳过。`

  if (excludedProviders.length > 0) {
    confirmMessage += `\n\n已排除自动刷新的提供商 (${excludedProviders.length} 个):\n`
    excludedProviders.forEach(p => {
      confirmMessage += `  • ${p.name}\n`
    })
  }

  if (!confirm(confirmMessage)) {
    return
  }

  isRefreshingAll.value = true

  try {
    const res = await axios.post('/api/providers/refresh-all-models')
    const { success, failed, skipped, successCount, failedCount, skippedCount, total } = res.data

    // 刷新提供商列表
    await loadProviders()

    // 构建结果消息
    let message = `刷新完成！\n\n`
    message += `总计: ${total} 个提供商\n`
    message += `成功: ${successCount} 个\n`
    message += `失败: ${failedCount} 个\n`

    if (skippedCount > 0) {
      message += `跳过: ${skippedCount} 个\n`
    }

    message += `\n`

    if (success.length > 0) {
      message += `成功的提供商:\n`
      success.forEach(item => {
        message += `  ✓ ${item.providerName}: ${item.modelCount} 个模型\n`
      })
    }

    if (failed.length > 0) {
      message += `\n失败的提供商:\n`
      failed.forEach(item => {
        message += `  ✗ ${item.providerName}: ${item.error}\n`
      })
    }

    if (skipped && skipped.length > 0) {
      message += `\n跳过的提供商:\n`
      skipped.forEach(item => {
        message += `  ⊘ ${item.providerName}: ${item.reason}\n`
      })
    }

    alert(message)
  } catch (error) {
    alert('批量刷新失败: ' + (error.response?.data?.error || error.message))
  } finally {
    isRefreshingAll.value = false
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

async function updateExcludeAutoRefresh() {
  await axios.put(`/api/providers/${selectedProvider.value.id}`, selectedProvider.value)
  await loadProviders()
}

function editProvider() {
  editingProvider.value = selectedProvider.value
  const ce = selectedProvider.value.customEndpoints || {}
  providerForm.value = {
    name: selectedProvider.value.name,
    baseUrl: selectedProvider.value.baseUrl,
    apiKey: selectedProvider.value.apiKey,
    groupId: selectedProvider.value.groupId || 'default',
    apiType: selectedProvider.value.apiType || 'openai',
    customEndpoints: { chat: ce.chat || '', models: ce.models || '', images: ce.images || '' }
  }
  showAdvanced.value = !!(ce.chat || ce.models || ce.images)
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

// 切换批量选择模式
function toggleBatchSelectMode() {
  batchSelectMode.value = !batchSelectMode.value
  if (!batchSelectMode.value) {
    selectedProviderIds.value = []
  }
}

// 切换供应商选择状态
function toggleProviderSelection(providerId) {
  const index = selectedProviderIds.value.indexOf(providerId)
  if (index >= 0) {
    selectedProviderIds.value.splice(index, 1)
  } else {
    selectedProviderIds.value.push(providerId)
  }
}

// 批量删除供应商
async function batchDeleteProviders() {
  const count = selectedProviderIds.value.length
  if (count === 0) {
    alert('请先选择要删除的供应商')
    return
  }

  if (!confirm(`确定要删除选中的 ${count} 个供应商吗？\n\n此操作不可恢复！`)) {
    return
  }

  try {
    const res = await axios.delete('/api/providers/batch', {
      data: { ids: selectedProviderIds.value }
    })

    alert(res.data.message || `成功删除 ${res.data.deletedCount} 个供应商`)

    // 清空选择并退出批量选择模式
    selectedProviderIds.value = []
    batchSelectMode.value = false
    selectedProvider.value = null

    await loadProviders()
  } catch (error) {
    alert('批量删除失败: ' + (error.response?.data?.error || error.message))
  }
}

// 清除所有供应商
async function clearAllProviders() {
  const count = providers.value.length
  if (count === 0) {
    alert('没有供应商可以清除')
    return
  }

  if (!confirm(`⚠️ 危险操作！\n\n确定要清除所有 ${count} 个供应商吗？\n\n此操作将删除所有供应商及其模型配置，不可恢复！`)) {
    return
  }

  // 二次确认
  if (!confirm(`再次确认：真的要删除所有 ${count} 个供应商吗？`)) {
    return
  }

  try {
    const res = await axios.delete('/api/providers/all')

    alert(res.data.message || `成功清除所有供应商，共 ${res.data.deletedCount} 个`)

    // 清空选择状态
    selectedProviderIds.value = []
    batchSelectMode.value = false
    selectedProvider.value = null

    await loadProviders()
  } catch (error) {
    alert('清除所有供应商失败: ' + (error.response?.data?.error || error.message))
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
  providerForm.value = { name: '', baseUrl: '', apiKey: '', groupId: 'default', apiType: 'openai', customEndpoints: { chat: '', models: '', images: '' } }
  showAdvanced.value = false
}

function closeAddModelModal() {
  showAddModelModal.value = false
  addModelForm.value = { modelId: '', visible: true }
}

async function addModelManually() {
  if (!addModelForm.value.modelId.trim()) {
    alert('请输入模型ID')
    return
  }
  
  const modelId = addModelForm.value.modelId.trim()
  
  // 检查模型是否已存在
  if (selectedProvider.value.models?.some(m => m.id === modelId)) {
    alert('该模型已存在')
    return
  }
  
  // 添加模型到提供商
  const models = selectedProvider.value.models || []
  models.push({
    id: modelId,
    visible: addModelForm.value.visible
  })
  
  selectedProvider.value.models = models
  
  try {
    await axios.put(`/api/providers/${selectedProvider.value.id}`, selectedProvider.value)
    await loadProviders()
    closeAddModelModal()
    alert('模型添加成功！')
  } catch (error) {
    alert('添加模型失败: ' + (error.response?.data?.error || error.message))
  }
}

async function exportProviders() {
  try {
    const response = await axios.get('/api/providers/export', {
      responseType: 'blob',
    });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.setAttribute('download', `equal-ask-providers-${date}.json`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    alert('导出失败: ' + (error.response?.data?.error || error.message));
  }
}

function importProviders() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = JSON.parse(event.target.result);
        
        // 兼容旧格式（一个只包含提供商的数组）和新格式（一个包含providers和groups的对象）
        const providerCount = Array.isArray(content) ? content.length : (content.providers || []).length;
        const groupCount = Array.isArray(content) ? 0 : (content.groups || []).length;

        if (confirm(`确定要导入 ${providerCount} 个提供商和 ${groupCount} 个分组吗？这将覆盖所有现有配置。`)) {
          await axios.post('/api/providers/import', content);
          alert('导入成功！');
          await loadGroups();
          await loadProviders();
        }
      } catch (error) {
        alert('导入失败，请检查文件格式是否正确: ' + error.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// 分组管理函数
function closeGroupManager() {
  showGroupManager.value = false
}

function closeGroupModal() {
  showAddGroup.value = false
  editingGroup.value = null
  groupForm.value = { name: '', description: '' }
}

function editGroup(group) {
  editingGroup.value = group
  groupForm.value = {
    name: group.name,
    description: group.description || ''
  }
}

async function saveGroup() {
  if (!groupForm.value.name.trim()) {
    alert('分组名称不能为空')
    return
  }
  
  try {
    if (editingGroup.value) {
      await axios.put(`/api/groups/${editingGroup.value.id}`, groupForm.value)
    } else {
      await axios.post('/api/groups', groupForm.value)
    }
    await loadGroups()
    closeGroupModal()
  } catch (error) {
    alert('保存分组失败: ' + (error.response?.data?.error || error.message))
  }
}

async function deleteGroup(groupId) {
  if (confirm('确定删除此分组？该分组下的提供商将移至默认分组。')) {
    try {
      await axios.delete(`/api/groups/${groupId}`)
      await loadGroups()
      await loadProviders()
    } catch (error) {
      alert('删除分组失败: ' + (error.response?.data?.error || error.message))
    }
  }
}

async function updateProviderApiType() {
  try {
    await axios.put(`/api/providers/${selectedProvider.value.id}`, selectedProvider.value)
    await loadProviders()
  } catch (error) {
    alert('更新API类型失败: ' + (error.response?.data?.error || error.message))
  }
}

// 风格切换函数
function toggleApiStyleDropdown() {
  showApiStyleDropdown.value = !showApiStyleDropdown.value
}

function selectApiStyle(styleId) {
  currentApiStyle.value = styleId
  apiStyleManager.setCurrentStyle(styleId)
  showApiStyleDropdown.value = false
  // 保存到用户设置
  saveApiStyleToSettings(styleId)
}

// 保存风格到用户设置
async function saveApiStyleToSettings(styleId) {
  try {
    await axios.put('/api/settings', { defaultApiStyle: styleId })
  } catch (error) {
    console.error('Error saving API style:', error)
  }
}

// 点击外部关闭下拉菜单
function handleClickOutside(event) {
  if (apiStyleSelectorRef.value && !apiStyleSelectorRef.value.contains(event.target)) {
    showApiStyleDropdown.value = false
  }
}

function getFullApiUrl(provider) {
  if (!provider) return ''
  const baseUrl = provider.baseUrl.replace(/\/$/, '')

  // 优先使用自定义端点
  if (provider.customEndpoints?.chat) {
    return `${baseUrl}${provider.customEndpoints.chat}`
  }

  const apiType = provider.apiType || 'openai'

  if (/\/v\d+$/.test(baseUrl)) {
    if (apiType === 'anthropic') {
      return `${baseUrl}/messages`
    }
    return `${baseUrl}/chat/completions`
  }

  if (apiType === 'anthropic') {
    return `${baseUrl}/v1/messages`
  } else {
    return `${baseUrl}/v1/chat/completions`
  }
}

onMounted(async () => {
  // 加载风格配置
  try {
    const res = await axios.get('/api/settings')
    const defaultApiStyle = res.data.defaultApiStyle
    if (defaultApiStyle) {
      currentApiStyle.value = defaultApiStyle
      apiStyleManager.setCurrentStyle(defaultApiStyle)
    }
  } catch (error) {
    console.error('Error loading API style:', error)
  }

  await loadGroups()
  await loadProviders()

  // 添加点击外部关闭下拉菜单的监听器
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
/* ==================== 批量操作相关样式 ==================== */
.danger-group {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #ffc9c9;
}

.btn-batch-select {
  background: #f8f9fa;
  color: #495057;
  border: 1px solid #dee2e6;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.btn-batch-select:hover {
  background: #e9ecef;
}

.btn-batch-select.active {
  background: #e3f2fd;
  color: #1976d2;
  border-color: #90caf9;
}

.btn-batch-delete {
  background: #ff6b6b;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.btn-batch-delete:hover {
  background: #ff5252;
}

.btn-clear-all {
  background: #dc3545;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.btn-clear-all:hover {
  background: #c82333;
}

.provider-checkbox {
  margin-right: 8px;
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #1976d2;
}

.provider-item.batch-selected {
  background: #e3f2fd !important;
  border-color: #90caf9 !important;
}

.advanced-settings {
  margin-top: 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  overflow: hidden;
}

.advanced-toggle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  background: #f5f5f5;
  font-size: 13px;
  color: #555;
  user-select: none;
}

.advanced-toggle:hover {
  background: #ebebeb;
}

.advanced-content {
  padding: 12px;
  border-top: 1px solid #e0e0e0;
}

.advanced-content .hint {
  display: block;
  margin-bottom: 8px;
}

.advanced-content label {
  display: block;
  margin-top: 8px;
}

/* ==================== API 风格选择器样式 ==================== */
.api-style-selector {
  position: relative;
  margin-bottom: 12px;
}

.api-style-select-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.api-style-select-trigger:hover {
  background: #e9ecef;
  border-color: #adb5bd;
}

.api-style-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.selected-api-style {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: #495057;
}

.dropdown-arrow {
  font-size: 10px;
  color: #6c757d;
  transition: transform 0.2s;
}

.api-style-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: white;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  max-height: 300px;
  overflow-y: auto;
}

.api-style-options {
  display: flex;
  flex-direction: column;
}

.api-style-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.2s;
  border-bottom: 1px solid #f1f3f5;
}

.api-style-option:last-child {
  border-bottom: none;
}

.api-style-option:hover {
  background: #f8f9fa;
}

.api-style-option.active {
  background: #e7f5ff;
  color: #007bff;
}

.api-style-option-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.api-style-option-name {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
}

.api-style-option-desc {
  font-size: 12px;
  color: #6c757d;
  margin-left: auto;
  max-width: 150px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.api-settings-container {
  display: flex;
  height: 100vh;
  background: #f8f9fa;
}

.providers-sidebar {
  width: 320px;
  background: white;
  border-right: 1px solid #dee2e6;
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 20px;
  border-bottom: 1px solid #dee2e6;
}

.group-management {
  margin-top: 12px;
}

.btn-manage-groups {
  width: 100%;
  padding: 8px 12px;
  background: #6c757d;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  text-align: center;
}

.btn-manage-groups:hover {
  background: #5a6268;
}

.search-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  margin-bottom: 12px;
}

.button-group {
  display: flex;
  gap: 8px;
}

.btn-add-provider, .btn-import, .btn-export {
  flex: 1;
  padding: 8px 12px;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  text-align: center;
}

.btn-add-provider {
  background: #007bff;
}
.btn-add-provider:hover {
  background: #0056b3;
}

.btn-import {
  background: #28a745;
}
.btn-import:hover {
  background: #1e7e34;
}

.btn-export {
  background: #ffc107;
  color: #212529;
}
.btn-export:hover {
  background: #e0a800;
}

.btn-refresh-all {
  width: 100%;
  padding: 8px 12px;
  background: #17a2b8;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  text-align: center;
  font-weight: 500;
  transition: background 0.2s;
}

.btn-refresh-all:hover:not(:disabled) {
  background: #138496;
}

.btn-refresh-all:disabled {
  background: #6c757d;
  cursor: not-allowed;
  opacity: 0.6;
}

.providers-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.provider-group {
  margin-bottom: 12px;
}

.group-header {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: #e9ecef;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  color: #495057;
  margin-bottom: 4px;
  transition: background 0.2s;
}

.group-header:hover {
  background: #dee2e6;
}

.group-expand-icon {
  margin-right: 8px;
  font-size: 12px;
}

.group-name {
  flex: 1;
}

.group-count {
  background: #6c757d;
  color: white;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
}

.group-providers {
  padding-left: 8px;
}

.provider-item {
  display: flex;
  align-items: center;
  padding: 12px;
  margin-bottom: 8px;
  background: #f8f9fa;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.provider-item:hover {
  background: #e9ecef;
}

.provider-item.active {
  background: #007bff;
  color: white;
}

.provider-item.no-models {
  border: 2px solid #dc3545;
  background: #fff5f5;
}

.provider-item.no-models:hover {
  background: #ffe5e5;
}

.provider-item.no-models.active {
  background: #dc3545;
  color: white;
  border-color: #dc3545;
}

.provider-item-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #6c757d;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  margin-right: 12px;
}

.provider-item.active .provider-item-icon {
  background: rgba(255, 255, 255, 0.2);
}

.provider-item-info {
  flex: 1;
}

.provider-item-name {
  font-weight: 500;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-count-badge {
  display: inline-block;
  background: #28a745;
  color: white;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  min-width: 20px;
  text-align: center;
}

.model-count-badge.zero-models {
  background: #dc3545;
}

.provider-item.active .model-count-badge {
  background: rgba(255, 255, 255, 0.3);
}

.provider-item.active .model-count-badge.zero-models {
  background: rgba(220, 53, 69, 0.8);
}

.provider-item-status {
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 3px;
}

.provider-item-status.active {
  background: #28a745;
  color: white;
}

.provider-item-status.disabled {
  background: #dc3545;
  color: white;
}

.provider-item.active .provider-item-status {
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

.provider-details-panel {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}

.details-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
}

.details-header h2 {
  margin: 0;
  color: #495057;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.btn-toggle {
  padding: 6px 12px;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-toggle:hover {
  background: #e9ecef;
}

.btn-icon {
  padding: 6px 8px;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  font-size: 14px;
}

.btn-icon:hover {
  background: #e9ecef;
}

.config-section {
  margin-bottom: 24px;
}

.config-section label {
  display: block;
  font-weight: 500;
  margin-bottom: 8px;
  color: #495057;
}

.checkbox-label {
  display: flex !important;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-weight: 500;
}

.checkbox-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  margin: 0;
}

.checkbox-label span {
  user-select: none;
}

.hint {
  font-size: 12px;
  color: #6c757d;
  font-weight: normal;
}

.input-group {
  display: flex;
  gap: 8px;
}

.input-field {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  background: #f8f9fa;
}

.btn-icon-small, .btn-test {
  padding: 8px 12px;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  background: white;
  cursor: pointer;
}

.btn-test {
  background: #28a745;
  color: white;
  border-color: #28a745;
}

.btn-test:hover {
  background: #1e7e34;
}

.models-config {
  background: white;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 20px;
}

.models-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.models-toolbar label {
  font-weight: 500;
  color: #495057;
  margin: 0;
}

.count {
  background: #007bff;
  color: white;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 12px;
}

.search-input-small {
  padding: 6px 10px;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  flex: 1;
  min-width: 200px;
}

.available-models-panel {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid #dee2e6;
  border-radius: 4px;
}

.model-group {
  border-bottom: 1px solid #e9ecef;
}

.model-group:last-child {
  border-bottom: none;
}

.group-header {
  padding: 12px 16px;
  background: #f8f9fa;
  cursor: pointer;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
}

.group-header:hover {
  background: #e9ecef;
}

.group-models {
  padding: 8px 0;
}

.model-row {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  gap: 12px;
}

.model-row:hover {
  background: #f8f9fa;
}

.model-icon {
  font-size: 16px;
}

.model-name {
  flex: 1;
  font-family: monospace;
  font-size: 13px;
}

.model-actions {
  display: flex;
  gap: 4px;
}

.icon-btn, .btn-toggle-model {
  padding: 4px 6px;
  border: 1px solid #dee2e6;
  border-radius: 3px;
  background: white;
  cursor: pointer;
  font-size: 12px;
}

.btn-toggle-model {
  background: #007bff;
  color: white;
  border-color: #007bff;
  font-weight: bold;
}

.added-models-container {
  max-height: 400px;
  overflow-y: auto;
}

.added-model-group {
  margin-bottom: 20px;
}

.added-group-header {
  font-weight: 500;
  color: #495057;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid #dee2e6;
}

.added-models-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 8px;
}

.added-model-card {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  gap: 8px;
}

.added-model-card .model-name {
  flex: 1;
  font-family: monospace;
  font-size: 12px;
}

.btn-icon-tiny {
  padding: 2px 4px;
  border: 1px solid #dee2e6;
  border-radius: 2px;
  background: white;
  cursor: pointer;
  font-size: 10px;
}

.empty-state {
  text-align: center;
  color: #6c757d;
  padding: 60px 20px;
}

.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  padding: 24px;
  border-radius: 8px;
  width: 90%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-large {
  max-width: 700px;
}

.group-manager-content {
  margin: 20px 0;
}

.group-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-weight: 500;
  color: #495057;
}

.group-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  margin-bottom: 8px;
}

.group-item-info {
  flex: 1;
}

.group-item-name {
  font-weight: 500;
  color: #495057;
  margin-bottom: 4px;
}

.group-item-desc {
  font-size: 12px;
  color: #6c757d;
  margin-bottom: 4px;
}

.group-item-count {
  font-size: 12px;
  color: #007bff;
}

.group-item-actions {
  display: flex;
  gap: 4px;
}

.modal-content h3 {
  margin: 0 0 20px 0;
  color: #495057;
}

.modal-content label {
  display: block;
  margin-bottom: 16px;
  font-weight: 500;
  color: #495057;
}

.modal-content .input-field {
  width: 100%;
  margin-top: 4px;
  background: white;
}

.modal-content small.hint {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #6c757d;
}

.modal-content input[type="checkbox"] {
  margin-right: 8px;
}

.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 24px;
}

.btn-save, .btn-cancel {
  padding: 8px 16px;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  cursor: pointer;
}

.btn-save {
  background: #007bff;
  color: white;
  border-color: #007bff;
}

.btn-save:hover:not(:disabled) {
  background: #0056b3;
}

.btn-save:disabled {
  background: #6c757d;
  cursor: not-allowed;
}

.btn-cancel {
  background: white;
}

.btn-cancel:hover {
  background: #e9ecef;
}
</style>
