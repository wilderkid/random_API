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
    
    <div class="three-column">
      <div class="column available-pool">
        <h3>可用池 ({{ Object.keys(availableGroups).length }})</h3>
        <div v-if="Object.keys(availableGroups).length === 0" class="empty-state">
          <p>暂无重复模型</p>
          <p>请确保至少有2个提供商支持相同的模型</p>
          <button @click="refreshConfig" class="btn-refresh">刷新配置</button>
        </div>
        <div v-for="(group, modelName) in availableGroups" :key="modelName" class="model-group">
          <div class="group-header" @click="toggleGroup(modelName)">
            <span>{{ modelName }} ({{ group.length }})</span>
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
              </div>
              <button @click="excludeProviderModel(item.id, modelName)" class="btn-exclude" title="排除此项">→</button>
            </div>
          </div>
        </div>
      </div>
      
      <div class="column excluded-pool">
        <h3>排除池 ({{ excludedItems.length }})</h3>
        <div v-if="excludedItems.length === 0" class="empty-state">
          <p>暂无排除的模型</p>
        </div>
        <div v-for="item in excludedItems" :key="item.id" class="excluded-item">
          <div class="excluded-info">
            <div class="provider-name">{{ item.providerName }}</div>
            <div class="model-name">{{ item.modelName }}</div>
          </div>
          <button @click="moveToAvailable(item.id, item.modelName)" class="btn-arrow">←</button>
        </div>
      </div>
      
      <div class="column disabled-pool">
        <h3>禁用状态栏 ({{ disabledItems.length }})</h3>
        <div v-if="disabledItems.length === 0" class="empty-state">
          <p>暂无禁用的提供商</p>
        </div>
        <div v-for="item in disabledItems" :key="item.id" class="disabled-item">
          <div>{{ item.providerName }} - {{ item.modelName }}</div>
          <div class="disabled-reason">{{ item.reason }}</div>
          <button @click="reenable(item.id)" class="btn-reenable">重新启用</button>
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

const settings = ref({ pollingConfig: { available: {}, excluded: [] } })
const providers = ref([])
const expandedGroups = ref({})
const dragData = ref(null)
const showDebug = ref(false)

const availableGroups = computed(() => {
  const groups = {}
  const excludedSet = new Set(
    (settings.value.pollingConfig.excluded || []).map(item => `${item.providerId}:${item.modelName}`)
  )
  
  for (const [modelName, providerIds] of Object.entries(settings.value.pollingConfig.available)) {
    const availableProviders = providerIds.filter(id => {
      return !excludedSet.has(`${id}:${modelName}`)
    })
    
    if (availableProviders.length > 0) {
      groups[modelName] = availableProviders.map(id => {
        const provider = providers.value.find(p => p.id === id)
        // 找到该提供商中对应的具体模型ID
        let actualModelId = modelName
        if (provider && provider.models) {
          const matchedModel = provider.models.find(m => {
            const extractedName = m.id.includes('/') ? m.id.split('/').pop() : m.id
            return extractedName === modelName
          })
          if (matchedModel) {
            actualModelId = matchedModel.id
          }
        }
        return {
          id,
          providerName: provider?.name || id,
          modelId: actualModelId,
          displayName: `${provider?.name || id} - ${actualModelId}`
        }
      })
    }
  }
  return groups
})

const excludedItems = computed(() => {
  const excluded = settings.value.pollingConfig.excluded || []
  return excluded.map(item => {
    const provider = providers.value.find(p => p.id === item.providerId)
    return {
      id: `${item.providerId}:${item.modelName}`,
      providerId: item.providerId,
      providerName: provider?.name || item.providerId,
      modelName: item.modelName
    }
  })
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
          reason: `连续${failCount}次请求失败`
        })
      })
    })
  }
  
  return disabled
})

async function loadData() {
  const [settingsRes, providersRes] = await Promise.all([
    axios.get('/api/settings'),
    axios.get('/api/providers')
  ])
  settings.value = settingsRes.data
  providers.value = providersRes.data
  
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
}

async function buildPollingConfig() {
  console.log('Building polling config...')
  const modelMap = {}
  
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
          const modelName = model.id.includes('/') ? model.id.split('/').pop() : model.id
          
          // 检查该模型是否被禁用
          const isDisabled = settings.value.disabledModels?.[provider.id]?.includes(modelName)
          if (isDisabled) {
            console.log(`Skipping disabled model: ${provider.name} - ${modelName}`)
            return
          }
          
          if (!modelMap[modelName]) modelMap[modelName] = []
          // 避免重复添加同一个提供商
          if (!modelMap[modelName].includes(provider.id)) {
            modelMap[modelName].push(provider.id)
          }
        }
      })
    }
  }
  
  console.log('All models map:', modelMap)
  
  // 只保留有多个提供商的模型（重复模型）
  const duplicateModels = {}
  Object.entries(modelMap).forEach(([modelName, providerIds]) => {
    if (providerIds.length > 1) {
      duplicateModels[modelName] = providerIds
      console.log(`Found duplicate model: ${modelName} with providers:`, providerIds)
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

.three-column {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}

.column {
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 15px;
  background: white;
}

.column h3 {
  margin: 0 0 15px 0;
  color: #495057;
  font-size: 16px;
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

.btn-arrow, .btn-reenable, .btn-refresh, .btn-debug {
  padding: 4px 8px;
  border: 1px solid #dee2e6;
  border-radius: 3px;
  background: white;
  cursor: pointer;
  font-size: 12px;
}

.btn-arrow:hover, .btn-reenable:hover, .btn-refresh:hover, .btn-debug:hover {
  background: #e9ecef;
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
</style>
