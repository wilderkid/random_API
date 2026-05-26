<template>
  <div class="polling-page">
    <h2>轮询调用配置</h2>

    <div class="debug-info" v-if="showDebug">
      <h4>调试信息</h4>
      <p>提供商数量: {{ providers.length }}</p>
      <p>可用池模型数量: {{ Object.keys(availableGroups).length }}</p>
      <p>排除池项数量: {{ excludedItems.length }}</p>
      <p>禁用项数量: {{ disabledItems.length }}</p>
      <button @click="refreshConfig" class="btn-refresh">刷新配置</button>
    </div>

    <!-- 视图控制面板 -->
    <div class="view-controls">
      <div class="control-group">
        <label>显示模式:</label>
        <SearchableSelect
          v-model="viewMode"
          :options="viewModeOptions"
          class="control-select"
          placeholder="选择显示模式"
          search-placeholder="搜索显示模式..."
          @change="onViewModeChange"
        />
      </div>

      <div class="control-group">
        <label>用途标签:</label>
        <SearchableSelect
          v-model="selectedClientTag"
          :options="clientTagOptions"
          class="control-select"
          placeholder="选择用途标签"
          search-placeholder="搜索用途标签..."
          @change="updateDisplayedModels"
        />
      </div>

      <div class="control-group" v-if="viewMode === 'grouped'">
        <label>选择分组:</label>
        <SearchableSelect
          v-model="selectedGroup"
          :options="groupOptions"
          class="control-select"
          placeholder="所有分组"
          search-placeholder="搜索分组..."
          @change="updateDisplayedModels"
        />
      </div>

      <div class="control-group reset-control">
        <label>Reset model:</label>
        <SearchableSelect
          v-model="resetModelName"
          :options="resetModelOptions"
          class="control-select reset-select"
          placeholder="Select model"
          search-placeholder="Search model..."
        />
        <button
          @click="resetPollingPosition"
          class="btn-reset"
          :disabled="!resetModelName || resetInProgress"
        >
          {{ resetInProgress ? 'Resetting...' : 'Reset position' }}
        </button>
      </div>

      <div class="control-group">
        <button @click="refreshConfig" class="btn-refresh">🔄 刷新配置</button>
      </div>
    </div>

    <div class="three-column-container">
      <div class="column available-pool">
        <div class="column-header">
          <h3>可用池 ({{ Object.keys(displayedAvailableGroups).length }})</h3>
          <div class="header-actions">
            <button @click="expandAllGroups" class="btn-expand">展开全部</button>
            <button @click="collapseAllGroups" class="btn-expand">收起全部</button>
          </div>
        </div>

        <div class="column-content">
          <div v-if="Object.keys(displayedAvailableGroups).length === 0" class="empty-state">
            <p>暂无重复模型</p>
            <p>请确保当前用途标签下至少有2个提供商支持相同的模型</p>
            <button @click="refreshConfig" class="btn-refresh">刷新配置</button>
          </div>
          <div v-for="(group, modelName) in displayedAvailableGroups" :key="modelName" class="model-group">
            <div class="group-header" @click="toggleGroup(modelName)">
              <span class="group-expand-icon">{{ expandedGroups[modelName] ? '▼' : '▶' }}</span>
              <span class="group-title">
                {{ modelName }}
                <span class="group-count">({{ group.length }})</span>
                <span v-if="viewMode === 'grouped' && selectedGroup" class="group-badge">
                  {{ getGroupName(selectedGroup) }}
                </span>
                <span v-if="selectedClientTag !== 'all'" class="group-badge client-tag">
                  {{ getClientTagLabel(selectedClientTag) }}
                </span>
              </span>
              <button @click.stop="moveAllToExcluded(modelName)" class="btn-arrow" title="排除所有">→→</button>
            </div>
            <div v-if="expandedGroups[modelName]" class="group-content">
              <div v-for="(item, idx) in group" :key="item.id"
                   class="provider-item" draggable="true"
                   @dragstart="dragStart(modelName, idx)"
                   @dragover.prevent
                   @drop="drop(modelName, idx)">
                <div class="provider-info">
                  <div class="provider-name">{{ item.providerName }}</div>
                  <div class="model-id">{{ item.modelId }}</div>
                  <div class="provider-group-badge">{{ item.groupName }}</div>
                </div>
                <button @click="excludeProviderModel(item.id, modelName)" class="btn-exclude" title="排除此项">→</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="column excluded-pool">
        <div class="column-header">
          <h3>排除池 ({{ excludedItems.length }})</h3>
        </div>
        <div class="column-content">
          <div v-if="excludedItems.length === 0" class="empty-state">
            <p>暂无排除的模型</p>
          </div>
          <div v-for="item in excludedItems" :key="item.id" class="excluded-item">
            <div class="excluded-info">
              <div class="provider-name">{{ item.providerName }}</div>
              <div class="model-name">{{ item.modelName }}</div>
              <div class="provider-group-badge">{{ item.groupName }}</div>
            </div>
            <button @click="moveToAvailable(item.id, item.modelName)" class="btn-arrow">←</button>
          </div>
        </div>
      </div>

      <div class="column disabled-pool">
        <div class="column-header">
          <h3>禁用状态栏 ({{ disabledItems.length }})</h3>
        </div>
        <div class="column-content">
          <div v-if="disabledItems.length === 0" class="empty-state">
            <p>暂无禁用的提供商</p>
          </div>
          <div v-for="item in disabledItems" :key="item.id" class="disabled-item">
            <div class="disabled-info">
              <div class="provider-name">{{ item.providerName }}</div>
              <div class="model-name">{{ item.modelName }}</div>
              <div class="provider-group-badge">{{ item.groupName }}</div>
              <div class="disabled-reason">{{ item.reason }}</div>
            </div>
            <button @click="reenable(item.id)" class="btn-reenable">重新启用</button>
          </div>
        </div>
      </div>
    </div>

    <div class="debug-toggle">
      <button @click="showDebug = !showDebug" class="btn-debug">
        {{ showDebug ? '隐藏' : '显示' }}调试信息
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import SearchableSelect from '../components/SearchableSelect.vue'

const settings = ref({ pollingConfig: { available: {}, excluded: [] } })
const providers = ref([])
const expandedGroups = ref({})
const dragData = ref(null)
const showDebug = ref(false)

// 新增：视图控制相关的响应式数据
const viewMode = ref('all') // 'all', 'grouped', 'unique'
const selectedGroup = ref('') // 选中的分组ID
const selectedClientTag = ref('all')
const groupsData = ref([]) // 存储从API获取的分组数据
const resetModelName = ref('')
const resetInProgress = ref(false)

const clientTagOptions = [
  { label: '全部用途', value: 'all' },
  { label: '普通', value: 'normal' },
  { label: 'Codex', value: 'codex' },
  { label: 'Claude Code', value: 'claude' },
  { label: 'OpenClaw', value: 'openclaw' }
]

function normalizeClientTags(tags) {
  const normalized = {
    normal: tags?.normal === true,
    codex: tags?.codex === true,
    claude: tags?.claude === true,
    openclaw: tags?.openclaw === true
  }

  if (!normalized.normal && !normalized.codex && !normalized.claude && !normalized.openclaw) {
    normalized.normal = true
  }

  return normalized
}

function providerMatchesSelectedClientTag(provider) {
  if (selectedClientTag.value === 'all') return true
  const tags = normalizeClientTags(provider?.clientTags)
  return tags[selectedClientTag.value] === true
}

const availableGroups = computed(() => {
  const groups = {}
  const excludedSet = new Set(
    (settings.value.pollingConfig.excluded || []).map(item => `${item.providerId}:${item.modelName}`)
  )

  for (const [normalizedModelName, providerIds] of Object.entries(settings.value.pollingConfig.available)) {
    const availableProviders = providerIds.filter(id => {
      return !excludedSet.has(`${id}:${normalizedModelName}`)
    })

    if (availableProviders.length > 0) {
      const filteredProviders = availableProviders
        .map(id => {
        const provider = providers.value.find(p => p.id === id)
        // 找到该提供商中对应的具体模型ID（通过规范化匹配）
        let actualModelId = normalizedModelName
        if (provider && provider.models) {
          const matchedModel = provider.models.find(m => {
            const normalized = normalizeModelName(m.id)
            return normalized === normalizedModelName
          })
          if (matchedModel) {
            actualModelId = matchedModel.id
          }
        }
        return {
          id,
          providerName: provider?.name || id,
          modelId: actualModelId,
          displayName: `${provider?.name || id} - ${actualModelId}`,
          groupName: getGroupName(provider?.groupId || 'default'),
          groupId: provider?.groupId || 'default'
        }
      })
        .filter(item => {
          const provider = providers.value.find(p => p.id === item.id)
          return providerMatchesSelectedClientTag(provider)
        })

      if (filteredProviders.length > 0) {
        groups[normalizedModelName] = filteredProviders
      }
    }
  }
  return groups
})

// 新增：根据视图模式和分组过滤显示的模型
const displayedAvailableGroups = computed(() => {
  const allGroups = availableGroups.value

  if (viewMode.value === 'grouped' && selectedGroup.value) {
    // 按分组过滤
    const filtered = {}
    for (const [modelName, providers] of Object.entries(allGroups)) {
      const filteredProviders = providers.filter(p => p.groupId === selectedGroup.value)
      if (filteredProviders.length > 0) {
        filtered[modelName] = filteredProviders
      }
    }
    return filtered
  } else if (viewMode.value === 'unique') {
    // 去重模型：每个模型只显示一个提供商
    const unique = {}
    for (const [modelName, providers] of Object.entries(allGroups)) {
      if (providers.length > 0) {
        unique[modelName] = [providers[0]] // 只取第一个提供商
      }
    }
    return unique
  }

  // 默认显示所有模型
  return allGroups
})

const excludedItems = computed(() => {
  const excluded = settings.value.pollingConfig.excluded || []
  return excluded.map(item => {
    const provider = providers.value.find(p => p.id === item.providerId)
    return {
      id: `${item.providerId}:${item.modelName}`,
      providerId: item.providerId,
      providerName: provider?.name || item.providerId,
      modelName: item.modelName,
      groupName: getGroupName(provider?.groupId || 'default')
    }
  })
})

// 新增：可用分组列表
const availableGroupsList = computed(() => {
  const groupsSet = new Set()

  // 从所有提供商中收集分组信息
  providers.value.forEach(provider => {
    if (!provider.disabled) {
      groupsSet.add(provider.groupId || 'default')
    }
  })

  // 转换为分组对象数组，使用真实的分组名称
  return Array.from(groupsSet).map(groupId => ({
    id: groupId,
    name: getGroupName(groupId)
  }))
})

const viewModeOptions = computed(() => [
  { label: '所有模型（包含重复）', value: 'all' },
  { label: '按分组显示', value: 'grouped' },
  { label: '去重模型', value: 'unique' }
])

const groupOptions = computed(() => [
  { label: '所有分组', value: '' },
  ...availableGroupsList.value.map(group => ({
    label: `${group.name} (${getGroupModelCount(group.id)}个模型)`,
    value: group.id
  }))
])

const resetModelOptions = computed(() => {
  return Object.keys(settings.value.pollingConfig?.available || {})
    .sort()
    .map(modelName => ({
      label: modelName,
      value: modelName
    }))
})

const disabledItems = computed(() => {
  const disabled = []

  // 从用户设置中获取被禁用的模型
  if (settings.value.disabledModels) {
    Object.entries(settings.value.disabledModels).forEach(([providerId, modelNames]) => {
      const provider = providers.value.find(p => p.id === providerId)
      const providerName = provider?.name || providerId

      modelNames.forEach(modelName => {
        // 获取失败次数
        const failCountKey = `${providerId}:${modelName}`
        const failCount = settings.value.modelFailCounts?.[failCountKey] || 0

        disabled.push({
          id: `${providerId}:${modelName}`,
          providerId: providerId,
          providerName: providerName,
          modelName: modelName,
          reason: `连续${failCount}次请求失败`,
          groupName: getGroupName(provider?.groupId || 'default')
        })
      })
    })
  }

  return disabled
})

async function loadData() {
  const [settingsRes, providersRes, groupsRes] = await Promise.all([
    axios.get('/api/settings'),
    axios.get('/api/providers'),
    axios.get('/api/groups')
  ])
  settings.value = settingsRes.data
  providers.value = providersRes.data
  groupsData.value = groupsRes.data || []

  if (!settings.value.pollingConfig) {
    settings.value.pollingConfig = { available: {}, excluded: [] }
  }
  if (!Array.isArray(settings.value.pollingConfig.excluded)) {
    // 兼容旧格式：将对象格式转换为数组格式
    const oldExcluded = settings.value.pollingConfig.excluded || {}
    settings.value.pollingConfig.excluded = []
    Object.entries(oldExcluded).forEach(([modelName, providerIds]) => {
      providerIds.forEach(providerId => {
        settings.value.pollingConfig.excluded.push({ providerId, modelName })
      })
    })
  }

  // 总是重新构建轮询配置以确保数据是最新的
  await buildPollingConfig()
  ensureResetModelSelection()
}

/**
 * 规范化模型名称，用于判断不同提供商的模型是否实际上是同一个模型
 * 规则：
 * 1. 忽略平台名（斜杠前的部分）
 * 2. 忽略大小写差异
 * 3. 忽略日期差异（YYYYMMDD 或 YYYY-MM-DD 格式）
 * 4. 保留模型名、版本、参数量、其他说明
 */
function normalizeModelName(modelId) {
  // 1. 转换为小写（忽略大小写）
  let normalized = modelId.toLowerCase().trim()

  // 2. 移除平台前缀（如果有斜杠）
  if (normalized.includes('/')) {
    normalized = normalized.split('/').pop()
  }

  // 3. 移除日期部分
  // 匹配 YYYYMMDD 格式（8位连续数字，前4位是年份）
  normalized = normalized.replace(/[-_]?20\d{6}[-_]?/g, '')

  // 匹配 YYYY-MM-DD 格式
  normalized = normalized.replace(/[-_]?20\d{2}-\d{2}-\d{2}[-_]?/g, '')

  // 4. 清理多余的连字符和下划线
  normalized = normalized.replace(/[-_]+/g, '-')  // 将多个连字符/下划线合并为一个
  normalized = normalized.replace(/^-+|-+$/g, '')  // 移除首尾的连字符

  return normalized
}

async function buildPollingConfig() {
  console.log('Building polling config...')
  const modelMap = {}  // 规范化名称 -> [{providerId, originalModelId}]

  for (const provider of providers.value) {
    if (provider.disabled) {
      console.log(`Skipping disabled provider: ${provider.name}`)
      continue
    }

    console.log(`Processing provider: ${provider.name}`)
    console.log(`Provider models:`, provider.models)

    // 使用提供商已添加的模型，而不是从API获取所有模型
    if (provider.models && provider.models.length > 0) {
      provider.models.forEach(model => {
        if (model.visible !== false) { // 只统计可见的模型
          const originalModelId = model.id
          const normalizedName = normalizeModelName(originalModelId)

          // 检查该模型是否被禁用（使用规范化名称检查）
          const isDisabled = settings.value.disabledModels?.[provider.id]?.includes(normalizedName)
          if (isDisabled) {
            console.log(`Skipping disabled model: ${provider.name} - ${normalizedName}`)
            return
          }

          if (!modelMap[normalizedName]) {
            modelMap[normalizedName] = []
          }

          // 避免重复添加同一个提供商
          const existingEntry = modelMap[normalizedName].find(entry => entry.providerId === provider.id)
          if (!existingEntry) {
            modelMap[normalizedName].push({
              providerId: provider.id,
              originalModelId: originalModelId
            })
          }
        }
      })
    }
  }

  console.log('All models map:', modelMap)

  // 只保留有多个提供商的模型（重复模型）
  const duplicateModels = {}
  Object.entries(modelMap).forEach(([normalizedName, entries]) => {
    if (entries.length > 1) {
      // 存储格式：规范化名称 -> 提供商ID数组
      duplicateModels[normalizedName] = entries.map(e => e.providerId)
      console.log(`Found duplicate model: ${normalizedName} with ${entries.length} providers`)
    }
  })

  console.log('Duplicate models:', duplicateModels)

  // 保留现有的排除池配置（数组格式）
  const existingExcluded = settings.value.pollingConfig.excluded || []

  // 清理排除池中不再存在的模型
  const validExcluded = existingExcluded.filter(item => {
    return duplicateModels[item.modelName]?.includes(item.providerId)
  })

  settings.value.pollingConfig.available = duplicateModels
  settings.value.pollingConfig.excluded = validExcluded

  await saveSettings()
  console.log('Polling config saved')
}

function ensureResetModelSelection() {
  const options = resetModelOptions.value
  if (options.length === 0) {
    resetModelName.value = ''
    return
  }

  if (!options.some(option => option.value === resetModelName.value)) {
    resetModelName.value = options[0].value
  }
}

function toggleGroup(modelName) {
  expandedGroups.value[modelName] = !expandedGroups.value[modelName]
}

function excludeProviderModel(providerId, modelName) {
  // 将特定提供商的模型添加到排除池
  if (!settings.value.pollingConfig.excluded) {
    settings.value.pollingConfig.excluded = []
  }
  
  // 检查是否已存在
  const exists = settings.value.pollingConfig.excluded.some(
    item => item.providerId === providerId && item.modelName === modelName
  )
  
  if (!exists) {
    settings.value.pollingConfig.excluded.push({ providerId, modelName })
    saveSettings()
  }
}

function moveAllToExcluded(modelName) {
  // 将模型的所有提供商移动到排除池
  if (settings.value.pollingConfig.available[modelName]) {
    if (!settings.value.pollingConfig.excluded) {
      settings.value.pollingConfig.excluded = []
    }
    
    settings.value.pollingConfig.available[modelName].forEach(providerId => {
      const exists = settings.value.pollingConfig.excluded.some(
        item => item.providerId === providerId && item.modelName === modelName
      )
      if (!exists) {
        settings.value.pollingConfig.excluded.push({ providerId, modelName })
      }
    })
    
    saveSettings()
  }
}

function moveToAvailable(itemId, modelName) {
  // 将模型从排除池移回可用池
  const [providerId] = itemId.split(':')
  
  if (settings.value.pollingConfig.excluded) {
    const index = settings.value.pollingConfig.excluded.findIndex(
      item => item.providerId === providerId && item.modelName === modelName
    )
    if (index > -1) {
      settings.value.pollingConfig.excluded.splice(index, 1)
      saveSettings()
    }
  }
}

function dragStart(modelName, index) {
  dragData.value = { modelName, index }
}

function drop(modelName, targetIndex) {
  if (!dragData.value || dragData.value.modelName !== modelName) return
  
  const group = settings.value.pollingConfig.available[modelName]
  const [item] = group.splice(dragData.value.index, 1)
  group.splice(targetIndex, 0, item)
  dragData.value = null
  saveSettings()
}

async function reenable(itemId) {
  // itemId 格式为 "providerId:modelName"
  const [providerId, modelName] = itemId.split(':')
  
  // 从禁用模型列表中移除
  if (settings.value.disabledModels && settings.value.disabledModels[providerId]) {
    const index = settings.value.disabledModels[providerId].indexOf(modelName)
    if (index > -1) {
      settings.value.disabledModels[providerId].splice(index, 1)
      // 如果该提供商没有其他禁用模型，删除整个条目
      if (settings.value.disabledModels[providerId].length === 0) {
        delete settings.value.disabledModels[providerId]
      }
    }
  }
  
  // 重置模型失败计数
  const failCountKey = `${providerId}:${modelName}`
  if (settings.value.modelFailCounts && settings.value.modelFailCounts[failCountKey]) {
    settings.value.modelFailCounts[failCountKey] = 0
  }
  
  await saveSettings()
  
  // 重新加载数据
  await loadData()
}

async function saveSettings() {
  await axios.put('/api/settings', settings.value)
}

async function refreshConfig() {
  console.log('Refreshing polling config...')
  await buildPollingConfig()
  ensureResetModelSelection()
}

async function resetPollingPosition() {
  if (!resetModelName.value || resetInProgress.value) return

  resetInProgress.value = true
  try {
    await axios.post('/api/polling/reset-position', {
      modelName: resetModelName.value
    })
    alert(`已重置 ${resetModelName.value} 的轮询位置`)
  } catch (error) {
    console.error('重置轮询位置失败:', error)
    alert('重置失败: ' + (error.response?.data?.error || error.message))
  } finally {
    resetInProgress.value = false
  }
}

// 新增：视图模式相关方法
function onViewModeChange() {
  // 当视图模式改变时，重置分组选择
  if (viewMode.value !== 'grouped') {
    selectedGroup.value = ''
  }
}

function updateDisplayedModels() {
  // 这个方法在模板中被调用，但实际逻辑在 displayedAvailableGroups 计算属性中处理
  // 这里可以添加额外的逻辑，比如重置展开状态
  expandedGroups.value = {}
}

function expandAllGroups() {
  const groups = displayedAvailableGroups.value
  Object.keys(groups).forEach(modelName => {
    expandedGroups.value[modelName] = true
  })
}

function collapseAllGroups() {
  expandedGroups.value = {}
}

function getGroupModelCount(groupId) {
  let count = 0
  Object.values(availableGroups.value).forEach(providers => {
    providers.forEach(provider => {
      if (provider.groupId === groupId) {
        count++
      }
    })
  })
  return count
}

function getGroupName(groupId) {
  if (groupId === 'default') {
    return '默认分组'
  }

  // 从 groupsData 中查找分组名称
  const group = groupsData.value.find(g => g.id === groupId)
  return group ? group.name : groupId
}

function getClientTagLabel(tag) {
  return clientTagOptions.find(option => option.value === tag)?.label || tag
}

onMounted(loadData)
</script>

<style scoped>
.polling-page {
  padding: 20px;
}

.debug-info {
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  padding: 15px;
  margin-bottom: 20px;
}

.debug-info h4 {
  margin: 0 0 10px 0;
  color: #495057;
}

.debug-info p {
  margin: 5px 0;
  color: #6c757d;
}

/* 新增：视图控制面板样式 */
.view-controls {
  display: flex;
  gap: 20px;
  align-items: center;
  margin-bottom: 20px;
  padding: 15px;
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 8px;
}

.control-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.control-group label {
  font-weight: 500;
  color: #495057;
  white-space: nowrap;
}

.control-select {
  padding: 6px 12px;
  border: 1px solid #ced4da;
  border-radius: 4px;
  background: white;
  font-size: 14px;
  min-width: 150px;
}

.control-select:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
}

.reset-control {
  flex-wrap: nowrap;
}

.reset-select {
  min-width: 220px;
}

/* 新增：三列容器样式 */
.three-column-container {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
  max-height: 70vh;
  overflow: hidden;
}

.three-column {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}

.column {
  border: 1px solid #dee2e6;
  border-radius: 8px;
  background: white;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.column-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px;
  background: #f8f9fa;
  border-bottom: 1px solid #dee2e6;
  flex-shrink: 0;
}

.column-header h3 {
  margin: 0;
  color: #495057;
  font-size: 16px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.btn-expand {
  padding: 4px 8px;
  border: 1px solid #dee2e6;
  border-radius: 3px;
  background: white;
  cursor: pointer;
  font-size: 12px;
  color: #6c757d;
}

.btn-expand:hover {
  background: #e9ecef;
  color: #495057;
}

.column-content {
  flex: 1;
  overflow-y: auto;
  padding: 15px;
  max-height: calc(70vh - 80px);
}

.empty-state {
  text-align: center;
  color: #6c757d;
  padding: 20px;
}

.empty-state p {
  margin: 5px 0;
}

.model-group {
  margin-bottom: 10px;
  border: 1px solid #e9ecef;
  border-radius: 4px;
}

.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f8f9fa;
  cursor: pointer;
  border-radius: 4px 4px 0 0;
}

.group-header:hover {
  background: #e9ecef;
}

.group-expand-icon {
  margin-right: 8px;
  font-size: 12px;
  color: #6c757d;
}

.group-title {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  color: #495057;
}

.group-count {
  font-size: 12px;
  color: #6c757d;
  font-weight: normal;
}

.group-badge {
  background: #007bff;
  color: white;
  padding: 2px 6px;
  border-radius: 12px;
  font-size: 10px;
  font-weight: normal;
}

.group-badge.client-tag {
  background: #6f42c1;
}

.provider-group-badge {
  background: #28a745;
  color: white;
  padding: 1px 4px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: normal;
}

.group-content {
  padding: 8px;
}

.provider-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  margin: 2px 0;
  background: #fff;
  border: 1px solid #dee2e6;
  border-radius: 3px;
  cursor: move;
}

.provider-item:hover {
  background: #f8f9fa;
}

.provider-item:hover .btn-exclude {
  opacity: 1;
}

.provider-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.provider-name {
  font-weight: 500;
  color: #495057;
}

.model-id {
  font-size: 11px;
  color: #6c757d;
  font-family: monospace;
}

.btn-exclude {
  padding: 2px 6px;
  border: 1px solid #dee2e6;
  border-radius: 3px;
  background: white;
  cursor: pointer;
  font-size: 11px;
  opacity: 0;
  transition: opacity 0.2s;
}

.btn-exclude:hover {
  background: #ffc107;
  border-color: #ffc107;
  color: white;
}

.excluded-item, .disabled-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  margin: 5px 0;
  background: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 4px;
}

.excluded-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.excluded-info .provider-name {
  font-weight: 500;
  color: #495057;
  font-size: 13px;
}

.excluded-info .model-name {
  font-size: 11px;
  color: #6c757d;
  font-family: monospace;
}

.disabled-item {
  flex-direction: column;
  align-items: flex-start;
}

.disabled-reason {
  font-size: 12px;
  color: #6c757d;
  margin: 4px 0;
}

.btn-arrow, .btn-reenable, .btn-refresh, .btn-debug, .btn-reset {
  padding: 4px 8px;
  border: 1px solid #dee2e6;
  border-radius: 3px;
  background: white;
  cursor: pointer;
  font-size: 12px;
}

.btn-arrow:hover, .btn-reenable:hover, .btn-refresh:hover, .btn-debug:hover, .btn-reset:hover:not(:disabled) {
  background: #e9ecef;
}

.btn-reset:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-reenable {
  background: #007bff;
  color: white;
  border-color: #007bff;
  margin-top: 8px;
  align-self: flex-end;
}

.btn-reenable:hover {
  background: #0056b3;
  border-color: #0056b3;
}

.btn-refresh {
  background: #28a745;
  color: white;
  border-color: #28a745;
}

.btn-refresh:hover {
  background: #1e7e34;
  border-color: #1e7e34;
}

.debug-toggle {
  text-align: center;
  margin-top: 20px;
}

.btn-debug {
  background: #6c757d;
  color: white;
  border-color: #6c757d;
  padding: 8px 16px;
}

.btn-debug:hover {
  background: #545b62;
  border-color: #545b62;
}

/* 新增：响应式设计和滚动优化 */
@media (max-width: 1200px) {
  .three-column-container {
    grid-template-columns: 1fr 1fr;
    gap: 15px;
  }

  .view-controls {
    flex-wrap: wrap;
    gap: 15px;
  }
}

@media (max-width: 768px) {
  .three-column-container {
    grid-template-columns: 1fr;
    gap: 10px;
    max-height: 60vh;
  }

  .view-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .control-group {
    justify-content: space-between;
  }

  .control-select {
    min-width: auto;
    flex: 1;
  }
}

/* 滚动条样式优化 */
.column-content::-webkit-scrollbar {
  width: 6px;
}

.column-content::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

.column-content::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

.column-content::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}

/* 防止内容溢出 */
.polling-page {
  padding: 20px;
  max-width: 100%;
  overflow-x: hidden;
}

.model-group {
  margin-bottom: 10px;
  border: 1px solid #e9ecef;
  border-radius: 4px;
  overflow: hidden;
}

.provider-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  margin: 2px 0;
  background: #fff;
  border: 1px solid #dee2e6;
  border-radius: 3px;
  cursor: move;
  word-break: break-word;
}

.provider-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
</style>
