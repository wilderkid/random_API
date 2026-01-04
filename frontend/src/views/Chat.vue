<template>
  <div class="chat-container">
    <aside class="sidebar">
      <div class="sidebar-header">
        <input v-model="searchQuery" placeholder="搜索对话..." class="search-input">
        <button @click="createNewConversation" class="btn-new">新建对话</button>
      </div>
      <div class="conversation-list">
        <div v-for="conv in filteredConversations" :key="conv.id" 
             :class="['conversation-item', { active: currentConv?.id === conv.id }]"
             @click="selectConversation(conv.id)">
          <span>{{ conv.title || '新对话' }}</span>
          <button @click.stop="deleteConversation(conv.id)" class="btn-delete">×</button>
        </div>
      </div>
    </aside>
    
    <div class="chat-main">
      <div class="chat-header">
        <select v-model="currentModel" class="model-select">
          <option v-for="m in allModels" :key="m.value" :value="m.value">
            {{ m.label }}
          </option>
        </select>
      </div>
      
      <div class="messages" ref="messagesContainer">
        <div v-for="(msg, i) in messages" :key="i" :class="['message', msg.role]">
          <div class="message-content" v-html="getRenderedContent(msg, i)"></div>
        </div>
      </div>
      
      <div class="input-area">
        <div class="toolbar">
          <button @click="showParams = !showParams" class="btn-tool">参数配置</button>
          <label class="toggle">
            <input type="checkbox" v-model="pollingEnabled">
            <span>轮询模式</span>
          </label>
          <input v-model.number="frequency" type="number" placeholder="频率限制" class="input-freq">
        </div>
        <textarea v-model="inputText" @keydown="handleKeydown"
                  placeholder="输入消息... (Enter 发送, Shift+Enter 换行)" class="input-box"></textarea>
        <button @click="sendMessage" :disabled="!inputText.trim() || !currentModel" class="btn-send">发送</button>
      </div>
    </div>
    
    <div v-if="showParams" class="modal" @click.self="showParams = false">
      <div class="modal-content">
        <h3>参数配置</h3>
        <label>温度: <input v-model.number="params.temperature" type="number" step="0.1" min="0" max="2"></label>
        <label>最大长度: <input v-model.number="params.max_tokens" type="number"></label>
        <label>Top P: <input v-model.number="params.top_p" type="number" step="0.1" min="0" max="1"></label>
        <button @click="showParams = false" class="btn-close">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import axios from 'axios'
import { marked } from 'marked'

const conversations = ref([])
const currentConv = ref(null)
const messages = ref([])
const inputText = ref('')
const searchQuery = ref('')
const currentModel = ref('')
const allModels = ref([])
const pollingEnabled = ref(false)
const frequency = ref(10)
const showParams = ref(false)
const params = ref({ temperature: 0.7, max_tokens: 2000, top_p: 1 })
const messagesContainer = ref(null)

const filteredConversations = computed(() => {
  return conversations.value.filter(c => 
    (c.title || '').toLowerCase().includes(searchQuery.value.toLowerCase())
  )
})

async function loadConversations() {
  const res = await axios.get('/api/conversations')
  conversations.value = res.data
}

async function loadProviders() {
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
  if (models.length > 0) currentModel.value = models[0].value
}

async function loadSettings() {
  const res = await axios.get('/api/settings')
  frequency.value = res.data.globalFrequency || 10
  params.value = res.data.defaultParams || { temperature: 0.7, max_tokens: 2000, top_p: 1 }
}

async function createConversation() {
  const res = await axios.post('/api/conversations', { model: currentModel.value })
  conversations.value.push(res.data)
  currentConv.value = res.data
  return res.data
}

async function createNewConversation() {
  await createConversation()
  messages.value = []
}

async function selectConversation(id) {
  const res = await axios.get(`/api/conversations/${id}`)
  currentConv.value = res.data
  messages.value = res.data.messages
  currentModel.value = res.data.model || currentModel.value
}

async function deleteConversation(id) {
  await axios.delete(`/api/conversations/${id}`)
  conversations.value = conversations.value.filter(c => c.id !== id)
  if (currentConv.value?.id === id) {
    currentConv.value = null
    messages.value = []
  }
}

async function sendMessage() {
  if (!inputText.value.trim() || !currentModel.value) return
  
  // 如果没有当前对话，自动创建一个
  if (!currentConv.value) {
    await createConversation()
  }
  
  const userMsg = { role: 'user', content: inputText.value }
  messages.value.push(userMsg)
  
  if (!currentConv.value.title) {
    currentConv.value.title = inputText.value.slice(0, 30)
  }
  
  const messageText = inputText.value
  inputText.value = ''
  scrollToBottom()
  
  const assistantMsg = { role: 'assistant', content: '', streaming: true }
  messages.value.push(assistantMsg)
  
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages.value.slice(0, -1),
        model: currentModel.value,
        params: params.value,
        polling: pollingEnabled.value
      })
    })
    
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      
      const chunk = decoder.decode(value)
      const lines = chunk.split('\n').filter(l => l.trim().startsWith('data:'))
      
      for (const line of lines) {
        const data = line.replace(/^data: /, '')
        if (data === '[DONE]') break
        try {
          const json = JSON.parse(data)
          if (json.choices?.[0]?.delta?.content) {
            assistantMsg.content += json.choices[0].delta.content
            requestRenderAndScroll()
          }
        } catch (e) {}
      }
    }
    assistantMsg.streaming = false
    assistantMsg.rendered = marked(assistantMsg.content)
  } catch (e) {
    assistantMsg.content = '错误: ' + e.message
  }
  
  currentConv.value.messages = messages.value
  currentConv.value.model = currentModel.value
  await axios.put(`/api/conversations/${currentConv.value.id}`, currentConv.value)
  
  const idx = conversations.value.findIndex(c => c.id === currentConv.value.id)
  if (idx !== -1) conversations.value[idx] = { ...currentConv.value }
}

let renderPending = false
function requestRenderAndScroll() {
  if (!renderPending) {
    renderPending = true
    requestAnimationFrame(() => {
      scrollToBottom()
      renderPending = false
    })
  }
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

function getRenderedContent(msg, index) {
  if (msg.rendered) return msg.rendered
  if (msg.streaming) return marked(msg.content)
  const rendered = marked(msg.content)
  messages.value[index].rendered = rendered
  return rendered
}

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

onMounted(() => {
  loadConversations()
  loadProviders()
  loadSettings()
})
</script>
