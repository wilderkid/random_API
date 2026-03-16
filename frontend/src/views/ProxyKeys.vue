<template>
  <div class="proxy-keys-container">
    <div class="proxy-keys-layout">
      <!-- 左侧密钥列表 -->
      <div class="keys-sidebar">
        <div class="sidebar-header">
          <h3>API密钥管理</h3>
          <button @click="createNewKey" class="btn-create">+ 新建密钥</button>
        </div>
        
        <div class="keys-list">
          <div v-for="key in apiKeys" :key="key.id" 
               :class="['key-item', { active: selectedKey?.id === key.id }]"
               @click="selectKey(key)">
            <div class="key-info">
              <div class="key-name">{{ key.name }}</div>
              <div class="key-preview">{{ formatKeyPreview(key.apiKey) }}</div>
              <div class="key-meta">
                <span class="key-status" :class="{ enabled: key.enabled, disabled: !key.enabled }">
                  {{ key.enabled ? '启用' : '禁用' }}
                </span>
                <span class="key-usage">{{ key.usageCount || 0 }}次使用</span>
              </div>
            </div>
            <div class="key-actions">
              <button @click.stop="duplicateKey(key)" class="btn-action" title="复制密钥">📋</button>
              <button @click.stop="deleteKey(key)" class="btn-action btn-danger" title="删除密钥">🗑️</button>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 右侧配置面板 -->
      <div class="config-panel">
        <div v-if="!selectedKey" class="no-selection">
          <div class="empty-state">
            <div class="empty-icon">🔑</div>
            <h3>选择一个API密钥</h3>
            <p>从左侧列表选择一个API密钥来查看和编辑其配置</p>
          </div>
        </div>
        
        <div v-else class="key-config">
          <div class="config-header">
            <h3>{{ selectedKey.name }}</h3>
            <div class="header-actions">
              <button @click="regenerateKey" class="btn-regenerate">🔄 重新生成</button>
              <button @click="saveKey" class="btn-save" :disabled="!hasChanges">💾 保存</button>
            </div>
          </div>
          
          <div class="config-content">
            <!-- 基本信息 -->
            <div class="config-section">
              <h4>基本信息</h4>
              <div class="form-group">
                <label>密钥名称</label>
                <input v-model="selectedKey.name" type="text" placeholder="为这个密钥起个名字">
              </div>
              <div class="form-group">
                <label>描述</label>
                <textarea v-model="selectedKey.description" placeholder="描述这个密钥的用途"></textarea>
              </div>
              <div class="form-group">
                <label>状态</label>
                <label class="toggle">
                  <input type="checkbox" v-model="selectedKey.enabled">
                  <span>启用此密钥</span>
                </label>
              </div>
              <div class="form-group">
                <label>轮询模式</label>
                <label class="toggle">
                  <input type="checkbox" v-model="selectedKey.usePolling">
                  <span>启用轮询模式（自动负载均衡）</span>
                </label>
                <small class="hint">启用后将使用轮询池中的模型，关闭后可选择特定分组的所有模型</small>
              </div>
            </div>
            
            <!-- API密钥 -->
            <div class="config-section">
              <h4>API密钥</h4>
              <div class="api-key-display">
                <input :value="selectedKey.apiKey" type="text" readonly class="key-input">
                <button @click="copyKey" class="btn-copy">📋 复制</button>
              </div>
            </div>

            <!-- 模型权限 - 轮询模式 -->
            <div v-if="selectedKey.usePolling" class="config-section">
              <h4>轮询模型权限</h4>
              <p class="section-desc">选择此密钥可以访问的轮询模型（留空表示允许所有轮询模型）</p>
              <div class="models-search">
                <input v-model="modelSearchQuery"
                       type="text"
                       placeholder="🔍 搜索模型..."
                       class="search-input-small">
                <span class="search-count">{{ searchedPollingModels.length }} / {{ availablePollingModels.length }}</span>
              </div>
              <div class="models-header">
                <button @click="selectAllPollingModels" class="btn-select-all">✓ 全选</button>
                <button @click="clearAllPollingModels" class="btn-clear-all">✗ 清空</button>
              </div>
              <div class="models-grid">
                <label v-for="model in searchedPollingModels" :key="model" class="model-checkbox">
                  <input type="checkbox"
                         :value="model"
                         v-model="selectedKey.allowedModels">
                  <span>{{ model }}</span>
                </label>
              </div>
              <div v-if="availablePollingModels.length === 0" class="empty-hint">
                暂无可用的轮询模型，请先在轮询配置中添加模型
              </div>
              <div v-else-if="searchedPollingModels.length === 0" class="empty-hint">
                没有匹配的模型
              </div>
            </div>

            <!-- 分组权限 - 非轮询模式 -->
            <div v-if="!selectedKey.usePolling" class="config-section">
              <h4>提供商分组权限</h4>
              <p class="section-desc">选择此密钥可以访问的提供商分组（留空表示允许所有分组）</p>
              <div class="models-header">
                <button @click="selectAllGroups" class="btn-select-all">✓ 全选</button>
                <button @click="clearAllGroups" class="btn-clear-all">✗ 清空</button>
              </div>
              <div class="models-grid">
                <label v-for="group in availableGroups" :key="group.id" class="model-checkbox">
                  <input type="checkbox"
                         :value="group.id"
                         v-model="selectedKey.allowedGroups">
                  <span>{{ group.name }} ({{ getGroupProviderCount(group.id) }}个提供商)</span>
                </label>
              </div>
            </div>

            <!-- 模型权限 - 非轮询模式 -->
            <div v-if="!selectedKey.usePolling" class="config-section">
              <h4>模型权限</h4>
              <p class="section-desc">选择此密钥可以访问的模型（基于已选分组）</p>
              <div class="models-search">
                <input v-model="modelSearchQuery"
                       type="text"
                       placeholder="🔍 搜索模型..."
                       class="search-input-small">
                <span class="search-count">{{ searchedAvailableModels.length }} / {{ filteredAvailableModels.length }}</span>
              </div>
              <div class="models-header">
                <button @click="selectAllModels" class="btn-select-all">✓ 全选</button>
                <button @click="clearAllModels" class="btn-clear-all">✗ 清空</button>
              </div>
              <div class="models-grid">
                <label v-for="model in searchedAvailableModels" :key="model.value" class="model-checkbox">
                  <input type="checkbox"
                         :value="model.value"
                         v-model="selectedKey.allowedModels">
                  <span>{{ model.label }}</span>
                </label>
              </div>
              <div v-if="filteredAvailableModels.length === 0" class="empty-hint">
                请先选择提供商分组
              </div>
              <div v-else-if="searchedAvailableModels.length === 0" class="empty-hint">
                没有匹配的模型
              </div>
            </div>
            
            <!-- 速率限制 -->
            <div class="config-section">
              <h4>速率限制</h4>
              <div class="rate-limit-grid">
                <div class="form-group">
                  <label>每分钟请求数</label>
                  <input v-model.number="selectedKey.rateLimit.requestsPerMinute" 
                         type="number" min="1" max="1000">
                </div>
                <div class="form-group">
                  <label>每小时请求数</label>
                  <input v-model.number="selectedKey.rateLimit.requestsPerHour" 
                         type="number" min="1" max="10000">
                </div>
              </div>
            </div>
            
            <!-- 使用统计 -->
            <div class="config-section">
              <h4>使用统计</h4>
              <div class="stats-grid">
                <div class="stat-item">
                  <div class="stat-value">{{ selectedKey.usageCount || 0 }}</div>
                  <div class="stat-label">总请求数</div>
                </div>
                <div class="stat-item">
                  <div class="stat-value">{{ formatDate(selectedKey.createdAt) }}</div>
                  <div class="stat-label">创建时间</div>
                </div>
                <div class="stat-item">
                  <div class="stat-value">{{ formatDate(selectedKey.lastUsed) || '未使用' }}</div>
                  <div class="stat-label">最后使用</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 创建密钥弹窗 -->
    <div v-if="showCreateModal" class="modal" @click.self="showCreateModal = false">
      <div class="modal-content">
        <div class="modal-header">
          <h3>创建新的API密钥</h3>
          <button @click="showCreateModal = false" class="btn-close">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>密钥名称 *</label>
            <input v-model="newKey.name" type="text" placeholder="例如：客户端A专用">
          </div>
          <div class="form-group">
            <label>描述</label>
            <textarea v-model="newKey.description" placeholder="描述这个密钥的用途"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button @click="showCreateModal = false" class="btn-cancel">取消</button>
          <button @click="confirmCreateKey" class="btn-confirm" :disabled="!newKey.name">创建</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import axios from 'axios'

const apiKeys = ref([])
const selectedKey = ref(null)
const showCreateModal = ref(false)
const availableModels = ref([])
const availablePollingModels = ref([]) // 轮询模型列表
const availableGroups = ref([])
const allProviders = ref([])
const originalKey = ref(null)
const modelSearchQuery = ref('') // 模型搜索关键词
const isModelListReady = ref(false)

const newKey = ref({
  name: '',
  description: ''
})

// 计算是否有变更
const hasChanges = computed(() => {
  if (!selectedKey.value || !originalKey.value) return false
  return JSON.stringify(selectedKey.value) !== JSON.stringify(originalKey.value)
})

// 非轮询模式：根据选择的分组过滤模型
const filteredAvailableModels = computed(() => {
  if (!selectedKey.value || selectedKey.value.usePolling) {
    return []
  }

  const allowedGroups = selectedKey.value.allowedGroups || []
  const providersToInclude = allProviders.value.filter(p => {
    if (p.disabled) return false
    if (allowedGroups.length === 0) return true
    return allowedGroups.includes(p.groupId || 'default')
  })

  const models = []
  providersToInclude.forEach(provider => {
    (provider.models || []).forEach(modelObj => {
      if (modelObj.visible !== false) {
        models.push({
          value: `${provider.id}::${modelObj.id}`,
          label: `${provider.name} :: ${modelObj.id}`
        })
      }
    })
  })

  return models.sort((a, b) => a.label.localeCompare(b.label))
})

// 搜索过滤后的轮询模型
const searchedPollingModels = computed(() => {
  if (!modelSearchQuery.value.trim()) {
    return availablePollingModels.value
  }
  const query = modelSearchQuery.value.toLowerCase()
  return availablePollingModels.value.filter(model =>
    model.toLowerCase().includes(query)
  )
})

// 搜索过滤后的非轮询模型
const searchedAvailableModels = computed(() => {
  if (!modelSearchQuery.value.trim()) {
    return filteredAvailableModels.value
  }
  const query = modelSearchQuery.value.toLowerCase()
  return filteredAvailableModels.value.filter(model =>
    model.label.toLowerCase().includes(query) ||
    model.value.toLowerCase().includes(query)
  )
})

// 获取分组的提供商数量
function getGroupProviderCount(groupId) {
  return allProviders.value.filter(p => (p.groupId || 'default') === groupId).length
}

// 当可见模型列表变化时，清理掉不再可见的已选模型
watch(filteredAvailableModels, (newVisibleModels) => {
  if (!isModelListReady.value) return
  if (selectedKey.value?.allowedModels && !selectedKey.value.usePolling) {
    const visibleModelSet = new Set(newVisibleModels.map(m => m.value))
    selectedKey.value.allowedModels = selectedKey.value.allowedModels.filter(m => visibleModelSet.has(m))
  }
})

// 监听轮询模式切换
watch(() => selectedKey.value?.usePolling, (newValue) => {
  if (selectedKey.value) {
    // 切换模式时清空已选模型和搜索
    selectedKey.value.allowedModels = []
    selectedKey.value.allowedGroups = []
    modelSearchQuery.value = ''
  }
})

// 监听密钥切换
watch(selectedKey, () => {
  // 切换密钥时清空搜索
  modelSearchQuery.value = ''
})

// 加载API密钥列表
async function loadApiKeys() {
  try {
    const response = await axios.get('/api/proxy-keys')
    apiKeys.value = response.data
    if (apiKeys.value.length > 0 && !selectedKey.value) {
      selectKey(apiKeys.value[0])
    }
  } catch (error) {
    console.error('加载API密钥失败:', error)
  }
}

// 加载可用模型列表
async function loadAvailableModels() {
  try {
    const userSettings = await axios.get('/api/settings')
    const pollingConfig = userSettings.data.pollingConfig || { available: {} }

    // 轮询模型列表（规范化后的模型名）
    availablePollingModels.value = Object.keys(pollingConfig.available || {}).sort()

    // 所有模型列表（从提供商中获取）
    const allModelsSet = new Set()
    allProviders.value.forEach(provider => {
      if (!provider.disabled && provider.models) {
        provider.models.forEach(model => {
          if (model.visible !== false) {
            allModelsSet.add(model.id)
          }
        })
      }
    })
    availableModels.value = Array.from(allModelsSet).sort()
    isModelListReady.value = true
  } catch (error) {
    console.error('加载可用模型失败:', error)
  }
}

// 加载可用分组列表
async function loadAvailableGroups() {
  try {
    const response = await axios.get('/api/groups')
    availableGroups.value = response.data
  } catch (error) {
    console.error('加载分组失败:', error)
  }
}

async function loadAllProviders() {
  try {
    const res = await axios.get('/api/providers');
    allProviders.value = res.data.map(p => ({
      ...p,
      models: p.models || [],
      groupId: p.groupId || 'default'
    }));
  } catch (error) {
    console.error('加载提供商失败:', error);
  }
}

// 选择密钥
function selectKey(key) {
  // 确保新选择的密钥有必要的字段
  const keyWithDefaults = {
    ...key,
    allowedGroups: key.allowedGroups || [],
    usePolling: key.usePolling !== undefined ? key.usePolling : true // 默认启用轮询
  }
  selectedKey.value = JSON.parse(JSON.stringify(keyWithDefaults))
  originalKey.value = JSON.parse(JSON.stringify(keyWithDefaults))
}

// 格式化密钥预览
function formatKeyPreview(apiKey) {
  if (!apiKey) return ''
  return `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`
}

// 格式化日期
function formatDate(dateString) {
  if (!dateString) return ''
  return new Date(dateString).toLocaleString('zh-CN')
}

// 创建新密钥
function createNewKey() {
  newKey.value = { name: '', description: '' }
  showCreateModal.value = true
}

// 确认创建密钥
async function confirmCreateKey() {
  if (!newKey.value.name) return
  
  try {
    const response = await axios.post('/api/proxy-keys', newKey.value)
    apiKeys.value.push(response.data)
    selectKey(response.data)
    showCreateModal.value = false
    newKey.value = { name: '', description: '' }
  } catch (error) {
    console.error('创建密钥失败:', error)
    alert('创建密钥失败: ' + (error.response?.data?.error || error.message))
  }
}

// 保存密钥
async function saveKey() {
  if (!selectedKey.value) return
  
  try {
    const response = await axios.put(`/api/proxy-keys/${selectedKey.value.id}`, selectedKey.value)
    
    // 更新列表中的密钥
    const index = apiKeys.value.findIndex(k => k.id === selectedKey.value.id)
    if (index !== -1) {
      apiKeys.value[index] = response.data
    }
    
    // 更新选中的密钥和原始数据
    selectedKey.value = JSON.parse(JSON.stringify(response.data))
    originalKey.value = JSON.parse(JSON.stringify(response.data))
    
    alert('保存成功')
  } catch (error) {
    console.error('保存密钥失败:', error)
    alert('保存失败: ' + (error.response?.data?.error || error.message))
  }
}

// 重新生成密钥
async function regenerateKey() {
  if (!selectedKey.value) return
  
  if (!confirm('确定要重新生成密钥吗？旧密钥将立即失效！')) return
  
  try {
    const response = await axios.post(`/api/proxy-keys/${selectedKey.value.id}/regenerate`)
    selectedKey.value.apiKey = response.data.apiKey
    originalKey.value.apiKey = response.data.apiKey
    
    // 更新列表
    const index = apiKeys.value.findIndex(k => k.id === selectedKey.value.id)
    if (index !== -1) {
      apiKeys.value[index].apiKey = response.data.apiKey
    }
    
    alert('密钥已重新生成')
  } catch (error) {
    console.error('重新生成密钥失败:', error)
    alert('重新生成失败: ' + (error.response?.data?.error || error.message))
  }
}

// 复制密钥
async function copyKey() {
  if (!selectedKey.value?.apiKey) return
  
  try {
    await navigator.clipboard.writeText(selectedKey.value.apiKey)
    alert('密钥已复制到剪贴板')
  } catch (error) {
    console.error('复制失败:', error)
    alert('复制失败，请手动复制')
  }
}

// 复制密钥（从列表）
async function duplicateKey(key) {
  try {
    await navigator.clipboard.writeText(key.apiKey)
    alert('密钥已复制到剪贴板')
  } catch (error) {
    console.error('复制失败:', error)
    alert('复制失败，请手动复制')
  }
}

// 全选轮询模型
function selectAllPollingModels() {
  if (!selectedKey.value) return
  // 全选搜索结果中的模型
  const modelsToAdd = searchedPollingModels.value.filter(m => !selectedKey.value.allowedModels.includes(m))
  selectedKey.value.allowedModels = [...selectedKey.value.allowedModels, ...modelsToAdd]
}

// 清空轮询模型
function clearAllPollingModels() {
  if (!selectedKey.value) return
  // 清空搜索结果中的模型
  const searchedSet = new Set(searchedPollingModels.value)
  selectedKey.value.allowedModels = selectedKey.value.allowedModels.filter(m => !searchedSet.has(m))
}

// 全选分组
function selectAllGroups() {
  if (!selectedKey.value) return
  selectedKey.value.allowedGroups = availableGroups.value.map(g => g.id)
}

// 清空分组
function clearAllGroups() {
  if (!selectedKey.value) return
  selectedKey.value.allowedGroups = []
}

// 全选模型（非轮询模式）
function selectAllModels() {
  if (!selectedKey.value) return
  // 全选搜索结果中的模型
  const modelsToAdd = searchedAvailableModels.value
    .map(m => m.value)
    .filter(value => !selectedKey.value.allowedModels.includes(value))
  selectedKey.value.allowedModels = [...selectedKey.value.allowedModels, ...modelsToAdd]
}

// 清空模型（非轮询模式）
function clearAllModels() {
  if (!selectedKey.value) return
  // 清空搜索结果中的模型
  const searchedSet = new Set(searchedAvailableModels.value.map(m => m.value))
  selectedKey.value.allowedModels = selectedKey.value.allowedModels.filter(m => !searchedSet.has(m))
}

// 删除密钥
async function deleteKey(key) {
  if (!confirm(`确定要删除密钥 "${key.name}" 吗？此操作不可撤销！`)) return
  
  try {
    await axios.delete(`/api/proxy-keys/${key.id}`)
    apiKeys.value = apiKeys.value.filter(k => k.id !== key.id)
    
    if (selectedKey.value?.id === key.id) {
      selectedKey.value = null
      originalKey.value = null
      if (apiKeys.value.length > 0) {
        selectKey(apiKeys.value[0])
      }
    }
    
    alert('密钥已删除')
  } catch (error) {
    console.error('删除密钥失败:', error)
    alert('删除失败: ' + (error.response?.data?.error || error.message))
  }
}

onMounted(async () => {
  await loadAllProviders()
  await loadAvailableModels()
  loadApiKeys()
  loadAvailableGroups()
})
</script>

<style scoped>
.proxy-keys-container {
  height: 100vh;
  background-color: #f5f5f5;
}

.proxy-keys-layout {
  display: flex;
  height: 100%;
}

/* 左侧密钥列表 */
.keys-sidebar {
  width: 350px;
  background-color: white;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 20px;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sidebar-header h3 {
  margin: 0;
  color: #333;
}

.btn-create {
  background-color: #007bff;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn-create:hover {
  background-color: #0056b3;
}

.keys-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.key-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px;
  margin-bottom: 8px;
  background-color: #f8f9fa;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.key-item:hover {
  background-color: #e9ecef;
}

.key-item.active {
  background-color: #e3f2fd;
  border: 1px solid #2196f3;
}

.key-info {
  flex: 1;
}

.key-name {
  font-weight: 600;
  color: #333;
  margin-bottom: 4px;
}

.key-preview {
  font-family: monospace;
  font-size: 12px;
  color: #666;
  margin-bottom: 6px;
}

.key-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
}

.key-status {
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 500;
}

.key-status.enabled {
  background-color: #d4edda;
  color: #155724;
}

.key-status.disabled {
  background-color: #f8d7da;
  color: #721c24;
}

.key-usage {
  color: #666;
}

.key-actions {
  display: flex;
  gap: 4px;
}

.btn-action {
  width: 32px;
  height: 32px;
  border: none;
  background-color: transparent;
  cursor: pointer;
  border-radius: 4px;
  font-size: 14px;
  transition: background-color 0.2s;
}

.btn-action:hover {
  background-color: #e9ecef;
}

.btn-action.btn-danger:hover {
  background-color: #f8d7da;
}

/* 右侧配置面板 */
.config-panel {
  flex: 1;
  background-color: white;
  overflow-y: auto;
}

.no-selection {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-state {
  text-align: center;
  color: #666;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.key-config {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.config-header {
  padding: 20px;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #f8f9fa;
}

.config-header h3 {
  margin: 0;
  color: #333;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.btn-regenerate, .btn-save {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn-regenerate {
  background-color: #ffc107;
  color: #212529;
}

.btn-regenerate:hover {
  background-color: #e0a800;
}

.btn-save {
  background-color: #28a745;
  color: white;
}

.btn-save:hover:not(:disabled) {
  background-color: #218838;
}

.btn-save:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
}

.config-content {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}

.config-section {
  margin-bottom: 32px;
  padding-bottom: 24px;
  border-bottom: 1px solid #e9ecef;
}

.config-section:last-child {
  border-bottom: none;
}

.config-section h4 {
  margin: 0 0 16px 0;
  color: #333;
  font-size: 18px;
}

.section-desc {
  margin: 0 0 16px 0;
  color: #666;
  font-size: 14px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  color: #333;
}

.form-group input, .form-group textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.form-group input:focus, .form-group textarea:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
}

.form-group small {
  display: block;
  margin-top: 4px;
  color: #666;
  font-size: 12px;
}

.toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.toggle input[type="checkbox"] {
  width: auto;
}

.api-key-display {
  display: flex;
  gap: 12px;
  align-items: center;
}

.key-input {
  flex: 1;
  font-family: monospace;
  background-color: #f8f9fa;
}

.btn-copy {
  padding: 8px 16px;
  background-color: #6c757d;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn-copy:hover {
  background-color: #5a6268;
}

.params-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.models-search {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.search-input-small {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.search-input-small:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
}

.search-count {
  font-size: 13px;
  color: #666;
  white-space: nowrap;
}

.models-header {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.btn-select-all, .btn-clear-all {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.btn-select-all {
  background-color: #28a745;
  color: white;
}

.btn-select-all:hover {
  background-color: #218838;
}

.btn-clear-all {
  background-color: #dc3545;
  color: white;
}

.btn-clear-all:hover {
  background-color: #c82333;
}

.models-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  max-height: 200px;
  overflow-y: auto;
  padding: 12px;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
}

.empty-hint {
  padding: 20px;
  text-align: center;
  color: #999;
  font-size: 14px;
  background-color: #f8f9fa;
  border-radius: 4px;
}

.hint {
  display: block;
  margin-top: 4px;
  color: #666;
  font-size: 12px;
}

.model-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px;
}

.model-checkbox input[type="checkbox"] {
  width: auto;
}

.rate-limit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
}

.stat-item {
  text-align: center;
  padding: 16px;
  background-color: #f8f9fa;
  border-radius: 8px;
}

.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: #333;
  margin-bottom: 4px;
}

.stat-label {
  font-size: 12px;
  color: #666;
  text-transform: uppercase;
}

/* 弹窗样式 */
.modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background-color: white;
  border-radius: 8px;
  width: 90%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  padding: 20px;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h3 {
  margin: 0;
  color: #333;
}

.btn-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #666;
}

.btn-close:hover {
  color: #333;
}

.modal-body {
  padding: 20px;
}

.modal-footer {
  padding: 20px;
  border-top: 1px solid #e0e0e0;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn-cancel, .btn-confirm {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn-cancel {
  background-color: #6c757d;
  color: white;
}

.btn-cancel:hover {
  background-color: #5a6268;
}

.btn-confirm {
  background-color: #007bff;
  color: white;
}

.btn-confirm:hover:not(:disabled) {
  background-color: #0056b3;
}

.btn-confirm:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
}
</style>