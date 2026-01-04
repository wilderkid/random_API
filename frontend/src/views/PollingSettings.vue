<template>
  <div class="polling-page">
    <h2>轮询调用配置</h2>
    
    <div class="debug-info" v-if="showDebug">
      <h4>调试信息</h4>
      <p>提供商数量: {{ providers.length }}</p>
      <p>可用池模型数量: {{ Object.keys(availableGroups).length }}</p>
      <p>排除池模型数量: {{ excludedModels.length }}</p>
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
            <button @click.stop="moveToExcluded(modelName)" class="btn-arrow">→</button>
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
            </div>
          </div>
        </div>
      </div>
      
      <div class="column excluded-pool">
        <h3>排除池 ({{ excludedModels.length }})</h3>
        <div v-if="excludedModels.length === 0" class="empty-state">
          <p>暂无排除的模型</p>
        </div>
        <div v-for="modelName in excludedModels" :key="modelName" class="excluded-item">
          <span>{{ modelName }}</span>
          <button @click="moveToAvailable(modelName)" class="btn-arrow">←</button>
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

const settings = ref({ pollingConfig: { available: {}, excluded: {}, disabled: {} } })
const providers = ref([])
const expandedGroups = ref({})
const dragData = ref(null)
const showDebug = ref(false)

const availableGroups = computed(() => {
  const groups = {}
  for (const [modelName, providerIds] of Object.entries(settings.value.pollingConfig.available)) {
    groups[modelName] = providerIds.map(id => {
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
  return groups
})

const excludedModels = computed(() => {
  return Object.keys(settings.value.pollingConfig.excluded)
})

const disabledItems = computed(() => {
  const disabled = []
  
  // 从providers中找出被禁用的提供商
  providers.value.forEach(provider => {
    if (provider.disabled && provider.failCount >= 3) {
      // 获取该提供商的所有模型
      if (provider.models && provider.models.length > 0) {
        provider.models.forEach(model => {
          const modelName = model.id.includes('/') ? model.id.split('/').pop() : model.id
          disabled.push({
            id: provider.id,
            providerName: provider.name,
            modelName: modelName,
            reason: `连续${provider.failCount}次请求失败`
          })
        })
      } else {
        // 如果没有模型信息，显示提供商本身
        disabled.push({
          id: provider.id,
          providerName: provider.name,
          modelName: '所有模型',
          reason: `连续${provider.failCount}次请求失败`
        })
      }
    }
  })
  
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
    settings.value.pollingConfig = { available: {}, excluded: {}, disabled: {} }
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
  
  // 保留现有的排除池配置
  const existingExcluded = settings.value.pollingConfig.excluded || {}
  
  settings.value.pollingConfig.available = duplicateModels
  settings.value.pollingConfig.excluded = existingExcluded
  
  await saveSettings()
  console.log('Polling config saved')
}

function toggleGroup(modelName) {
  expandedGroups.value[modelName] = !expandedGroups.value[modelName]
}

function moveToExcluded(modelName) {
  // 将模型从可用池移动到排除池
  if (settings.value.pollingConfig.available[modelName]) {
    settings.value.pollingConfig.excluded[modelName] = [...settings.value.pollingConfig.available[modelName]]
    delete settings.value.pollingConfig.available[modelName]
    saveSettings()
  }
}

function moveToAvailable(modelName) {
  // 将模型从排除池移回可用池
  if (settings.value.pollingConfig.excluded[modelName]) {
    settings.value.pollingConfig.available[modelName] = [...settings.value.pollingConfig.excluded[modelName]]
    delete settings.value.pollingConfig.excluded[modelName]
    saveSettings()
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

async function reenable(providerId) {
  // 从禁用状态栏中移除
  delete settings.value.pollingConfig.disabled[providerId]
  
  // 重置提供商的失败计数和禁用状态
  const provider = providers.value.find(p => p.id === providerId)
  if (provider) {
    await axios.put(`/api/providers/${providerId}`, {
      ...provider,
      failCount: 0,
      disabled: false
    })
  }
  
  await saveSettings()
  
  // 重新构建轮询配置，将重新启用的模型加回可用池
  await buildPollingConfig()
  
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

.provider-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
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

.excluded-item, .disabled-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  margin: 5px 0;
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 4px;
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
