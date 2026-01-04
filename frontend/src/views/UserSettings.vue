<template>
  <div class="settings-page">
    <h2>用户设置</h2>
    
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
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'

const settings = ref({
  defaultParams: { temperature: 0.7, max_tokens: 2000, top_p: 1 },
  globalFrequency: 10
})
const saveMessage = ref('')

async function loadSettings() {
  const res = await axios.get('/api/settings')
  settings.value = res.data
}

async function saveSettings() {
  await axios.put('/api/settings', settings.value)
  saveMessage.value = '设置已保存'
  setTimeout(() => saveMessage.value = '', 2000)
}

onMounted(loadSettings)
</script>
