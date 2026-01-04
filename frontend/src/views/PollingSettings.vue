<template>
  <div class="polling-page">
    <h2>轮询调用配置</h2>
    
    <div class="three-column">
      <div class="column available-pool">
        <h3>可用池</h3>
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
              {{ item.providerName }}
            </div>
          </div>
        </div>
      </div>
      
      <div class="column excluded-pool">
        <h3>排除池</h3>
        <div v-for="modelName in excludedModels" :key="modelName" class="excluded-item">
          <span>{{ modelName }}</span>
          <button @click="moveToAvailable(modelName)" class="btn-arrow">←</button>
        </div>
      </div>
      
      <div class="column disabled-pool">
        <h3>禁用状态栏</h3>
        <div v-for="item in disabledItems" :key="item.id" class="disabled-item">
          <div>{{ item.providerName }} - {{ item.modelName }}</div>
          <div class="disabled-reason">{{ item.reason }}</div>
          <button @click="reenable(item.id)" class="btn-reenable">重新启用</button>
        </div>
      </div>
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

const availableGroups = computed(() => {
  const groups = {}
  for (const [modelName, providerIds] of Object.entries(settings.value.pollingConfig.available)) {
    groups[modelName] = providerIds.map(id => {
      const provider = providers.value.find(p => p.id === id)
      return { id, providerName: provider?.name || id }
    })
  }
  return groups
})

const excludedModels = computed(() => {
  return Object.keys(settings.value.pollingConfig.excluded)
})

const disabledItems = computed(() => {
  return Object.entries(settings.value.pollingConfig.disabled).map(([id, data]) => ({
    id,
    providerName: data.providerName,
    modelName: data.modelName,
    reason: `连续${data.failCount}次请求失败`
  }))
})

async function loadData() {
  const [settingsRes, providersRes] = await Promise.all([
    axios.get('/api/settings'),
    axios.get('/api/providers')
  ])
  settings.value = settingsRes.data
  providers.value = providersRes.data
  
  if (!settings.value.pollingConfig.available) {
    settings.value.pollingConfig = { available: {}, excluded: {}, disabled: {} }
    await buildPollingConfig()
  }
}

async function buildPollingConfig() {
  const modelMap = {}
  for (const provider of providers.value) {
    try {
      const res = await axios.get(`/api/providers/${provider.id}/models`)
      res.data.forEach(model => {
        const modelName = model.id.includes('/') ? model.id.split('/').pop() : model.id
        if (!modelMap[modelName]) modelMap[modelName] = []
        modelMap[modelName].push(provider.id)
      })
    } catch (e) {}
  }
  
  settings.value.pollingConfig.available = modelMap
  await saveSettings()
}

function toggleGroup(modelName) {
  expandedGroups.value[modelName] = !expandedGroups.value[modelName]
}

function moveToExcluded(modelName) {
  settings.value.pollingConfig.excluded[modelName] = settings.value.pollingConfig.available[modelName]
  delete settings.value.pollingConfig.available[modelName]
  saveSettings()
}

function moveToAvailable(modelName) {
  settings.value.pollingConfig.available[modelName] = settings.value.pollingConfig.excluded[modelName]
  delete settings.value.pollingConfig.excluded[modelName]
  saveSettings()
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

async function reenable(id) {
  delete settings.value.pollingConfig.disabled[id]
  const provider = providers.value.find(p => p.id === id)
  if (provider) {
    await axios.put(`/api/providers/${id}`, { failCount: 0, disabled: false })
  }
  await saveSettings()
  loadData()
}

async function saveSettings() {
  await axios.put('/api/settings', settings.value)
}

onMounted(loadData)
</script>
