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
        <div v-for="(msg, i) in messages" :key="i" :class="['message', msg.role, { 'error': msg.error, 'streaming': msg.streaming }]">
          <div v-if="msg.images && msg.images.length > 0" class="message-images">
            <img v-for="(img, idx) in msg.images" :key="idx" :src="img.dataUrl" :alt="img.name" class="message-image">
          </div>
          <div class="message-content" v-html="getRenderedContent(msg, i)"></div>
          <div v-if="msg.error && msg.errorDetails" class="error-details-btn" @click="showErrorDetails(msg.errorDetails)">
            <span class="details-icon">🔍</span>
            <span>查看详情</span>
          </div>
        </div>
      </div>
      
      <div class="input-area">
        <!-- 速率限制提示 -->
        <div v-if="rateLimitInfo.isLimited" class="rate-limit-warning">
          <span class="warning-icon">⚠️</span>
          <span>{{ rateLimitInfo.message }}</span>
          <span class="countdown">{{ rateLimitInfo.waitTime }}秒</span>
        </div>
        
        <div class="toolbar">
          <button @click="showParams = !showParams" class="btn-tool">参数配置</button>
          <label class="btn-tool" style="cursor: pointer;">
            📷 上传图片
            <input type="file" accept="image/*" @change="handleImageUpload" style="display: none;" ref="imageInput">
          </label>
          <label class="toggle">
            <input type="checkbox" v-model="pollingEnabled">
            <span>轮询模式</span>
          </label>
          <input v-model.number="frequency" type="number" placeholder="频率限制" class="input-freq">
        </div>
        
        <!-- 图片预览区域 -->
        <div v-if="uploadedImages.length > 0" class="image-preview-container">
          <div v-for="(img, index) in uploadedImages" :key="index" class="image-preview-item">
            <img :src="img.dataUrl" :alt="img.name" class="preview-image">
            <button @click="removeImage(index)" class="btn-remove-image">×</button>
            <span class="image-name">{{ img.name }}</span>
          </div>
        </div>
        <textarea v-model="inputText" @keydown="handleKeydown"
                  placeholder="输入消息... (Enter 发送, Shift+Enter 换行)" class="input-box"></textarea>
        <button @click="sendMessage" :disabled="!inputText.trim() || !currentModel || rateLimitInfo.isLimited" class="btn-send">
          {{ rateLimitInfo.isLimited ? `等待 ${rateLimitInfo.waitTime}s` : '发送' }}
        </button>
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
    
    <!-- 错误详情弹窗 -->
    <div v-if="showErrorModal" class="modal error-modal" @click.self="showErrorModal = false">
      <div class="modal-content error-modal-content">
        <div class="error-modal-header">
          <h3>🚨 错误详情</h3>
          <button @click="showErrorModal = false" class="btn-close">×</button>
        </div>
        <div class="error-modal-body">
          <div class="error-section">
            <h4>📋 基本信息</h4>
            <div class="error-item">
              <span class="error-label">时间:</span>
              <span class="error-value">{{ currentErrorDetails?.timestamp }}</span>
            </div>
            <div class="error-item">
              <span class="error-label">模型:</span>
              <span class="error-value">{{ currentErrorDetails?.model }}</span>
            </div>
            <div class="error-item">
              <span class="error-label">错误类型:</span>
              <span class="error-value">{{ currentErrorDetails?.errorType }}</span>
            </div>
          </div>
          
          <div class="error-section">
            <h4>⚠️ 错误信息</h4>
            <div class="error-message">{{ currentErrorDetails?.originalError }}</div>
          </div>
          
          <div class="error-section" v-if="currentErrorDetails?.requestDetails">
            <h4>📤 请求信息</h4>
            <div class="error-item">
              <span class="error-label">URL:</span>
              <span class="error-value">{{ currentErrorDetails.requestDetails.url }}</span>
            </div>
            <div class="error-item">
              <span class="error-label">方法:</span>
              <span class="error-value">{{ currentErrorDetails.requestDetails.method }}</span>
            </div>
            <div class="error-item">
              <span class="error-label">状态码:</span>
              <span class="error-value">{{ currentErrorDetails.requestDetails.status }}</span>
            </div>
          </div>
          
          <div class="error-section" v-if="currentErrorDetails?.responseDetails">
            <h4>📥 响应信息</h4>
            <div class="error-item">
              <span class="error-label">Content-Type:</span>
              <span class="error-value">{{ currentErrorDetails.responseDetails.contentType }}</span>
            </div>
            <div class="error-item" v-if="currentErrorDetails.responseDetails.responseText">
              <span class="error-label">响应内容:</span>
              <pre class="error-response">{{ currentErrorDetails.responseDetails.responseText }}</pre>
            </div>
          </div>
          
          <div class="error-section" v-if="currentErrorDetails?.stackTrace">
            <h4>🔍 堆栈跟踪</h4>
            <pre class="error-stack">{{ currentErrorDetails.stackTrace }}</pre>
          </div>
          
          <div class="error-section">
            <h4>💡 建议解决方案</h4>
            <ul class="error-suggestions">
              <li v-for="suggestion in currentErrorDetails?.suggestions" :key="suggestion">{{ suggestion }}</li>
            </ul>
          </div>
        </div>
        <div class="error-modal-footer">
          <button @click="copyErrorDetails" class="btn-copy">📋 复制详情</button>
          <button @click="showErrorModal = false" class="btn-close-modal">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 图片预览容器样式 */
.image-preview-container {
  display: flex;
  gap: 12px;
  padding: 12px;
  background-color: #f8f9fa;
  border-radius: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.image-preview-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.preview-image {
  width: 100px;
  height: 100px;
  object-fit: cover;
  border-radius: 8px;
  border: 2px solid #dee2e6;
}

.btn-remove-image {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background-color: #dc3545;
  color: white;
  border: none;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}

.btn-remove-image:hover {
  background-color: #c82333;
}

.image-name {
  font-size: 12px;
  color: #6c757d;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 消息中的图片样式 */
.message-images {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.message-image {
  max-width: 200px;
  max-height: 200px;
  border-radius: 8px;
  border: 1px solid #dee2e6;
  cursor: pointer;
  transition: transform 0.2s;
}

.message-image:hover {
  transform: scale(1.05);
}

.rate-limit-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background-color: #fff3cd;
  border: 1px solid #ffeaa7;
  border-radius: 4px;
  color: #856404;
  font-size: 14px;
  margin-bottom: 8px;
}

.warning-icon {
  font-size: 16px;
}

.countdown {
  font-weight: bold;
  color: #d63031;
}

.btn-send:disabled {
  background-color: #ddd;
  color: #999;
  cursor: not-allowed;
}

/* 错误消息样式 */
.message.error {
  border-left: 4px solid #e74c3c;
  background-color: #fdf2f2;
}

.message.error .message-content {
  color: #c0392b;
}

/* 流式消息加载动画 */
.message.assistant .message-content::after {
  content: '';
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #3498db;
  animation: pulse 1.5s infinite;
  margin-left: 4px;
}

.message.assistant:not(.streaming) .message-content::after {
  display: none;
}

@keyframes pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

/* 消息状态指示器 */
.message {
  position: relative;
}

.message::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background-color: #27ae60;
}

.message.error::before {
  background-color: #e74c3c;
}

.message.streaming::before {
  background-color: #f39c12;
  animation: pulse 1s infinite;
}

/* 错误详情按钮样式 */
.error-details-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  padding: 4px 8px;
  background-color: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: #6c757d;
  transition: all 0.2s ease;
}

.error-details-btn:hover {
  background-color: #e9ecef;
  border-color: #adb5bd;
  color: #495057;
}

.details-icon {
  font-size: 14px;
}

/* 错误弹窗样式 */
.error-modal {
  z-index: 1001;
}

.error-modal-content {
  max-width: 800px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 0;
}

.error-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #dee2e6;
  background-color: #f8f9fa;
}

.error-modal-header h3 {
  margin: 0;
  color: #dc3545;
}

.error-modal-body {
  padding: 20px;
  max-height: 60vh;
  overflow-y: auto;
}

.error-section {
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e9ecef;
}

.error-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
}

.error-section h4 {
  margin: 0 0 12px 0;
  color: #495057;
  font-size: 16px;
}

.error-item {
  display: flex;
  margin-bottom: 8px;
  align-items: flex-start;
}

.error-label {
  font-weight: 600;
  color: #6c757d;
  min-width: 100px;
  margin-right: 12px;
}

.error-value {
  color: #212529;
  word-break: break-all;
}

.error-message {
  background-color: #f8d7da;
  border: 1px solid #f5c6cb;
  border-radius: 4px;
  padding: 12px;
  color: #721c24;
  font-family: monospace;
  white-space: pre-wrap;
}

.error-response, .error-stack {
  background-color: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  padding: 12px;
  font-family: monospace;
  font-size: 12px;
  color: #495057;
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
}

.error-suggestions {
  margin: 0;
  padding-left: 20px;
}

.error-suggestions li {
  margin-bottom: 8px;
  color: #495057;
}

.error-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 20px;
  border-top: 1px solid #dee2e6;
  background-color: #f8f9fa;
}

.btn-copy, .btn-close-modal {
  padding: 8px 16px;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  background-color: #fff;
  color: #495057;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-copy:hover, .btn-close-modal:hover {
  background-color: #e9ecef;
  border-color: #adb5bd;
}

.btn-copy {
  background-color: #007bff;
  color: white;
  border-color: #007bff;
}

.btn-copy:hover {
  background-color: #0056b3;
  border-color: #0056b3;
}
</style>

<script setup>
import { ref, computed, onMounted, nextTick, shallowRef, markRaw } from 'vue'
import axios from 'axios'
import { marked } from 'marked'

// 性能优化：使用 shallowRef 减少深度响应式
const conversations = shallowRef([])
const currentConv = ref(null)
// 修复：messages 需要深度响应式以支持流式更新
const messages = ref([])
const inputText = ref('')
const searchQuery = ref('')
const currentModel = ref('')
const allModels = shallowRef([])
const pollingEnabled = ref(false)
const frequency = ref(10)
const showParams = ref(false)
const params = ref({ temperature: 0.7, max_tokens: 2000, top_p: 1 })
const messagesContainer = ref(null)
const imageInput = ref(null)
const uploadedImages = ref([])

// 速率限制状态
const rateLimitInfo = ref({
  isLimited: false,
  waitTime: 0,
  message: ''
})

// 错误详情弹窗状态
const showErrorModal = ref(false)
const currentErrorDetails = ref(null)

// 性能优化：Markdown 渲染缓存
const renderedCache = new Map()
const maxCacheSize = 1000

// 性能优化：防抖函数
function debounce(func, wait) {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

// 性能优化：优化数据结构，使用 Map 提高查找效率
const conversationMap = new Map()

// 性能优化：优化计算属性，添加缓存
let searchCache = new Map()
const filteredConversations = computed(() => {
  const query = searchQuery.value.toLowerCase().trim()
  if (!query) return conversations.value
  
  // 检查缓存
  if (searchCache.has(query)) {
    return searchCache.get(query)
  }
  
  const result = conversations.value.filter(c =>
    (c.title || '').toLowerCase().includes(query)
  )
  
  // 缓存结果，限制缓存大小
  if (searchCache.size > 50) {
    const firstKey = searchCache.keys().next().value
    searchCache.delete(firstKey)
  }
  searchCache.set(query, result)
  
  return result
})

async function loadConversations() {
  try {
    const res = await axios.get('/api/conversations')
    // 性能优化：使用 markRaw 标记静态数据
    conversations.value = markRaw(res.data)
    
    // 更新 Map 缓存
    conversationMap.clear()
    res.data.forEach(conv => {
      conversationMap.set(conv.id, conv)
    })
    
    // 清空搜索缓存
    searchCache.clear()
  } catch (error) {
    console.error('Error loading conversations:', error)
    conversations.value = []
    conversationMap.clear()
  }
}

async function loadProviders() {
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
    // 性能优化：使用 markRaw 标记静态数据
    allModels.value = markRaw(models)
    
    // 加载默认模型设置
    if (models.length > 0) {
      try {
        const settingsRes = await axios.get('/api/settings')
        const defaultModel = settingsRes.data.defaultModel
        
        // 如果设置了默认模型且该模型在可用列表中，则使用默认模型
        if (defaultModel && models.some(m => m.value === defaultModel)) {
          currentModel.value = defaultModel
        } else {
          // 否则使用第一个可用模型
          currentModel.value = models[0].value
        }
      } catch (settingsError) {
        console.error('Error loading default model settings:', settingsError)
        // 如果加载设置失败，使用第一个可用模型
        currentModel.value = models[0].value
      }
    }
  } catch (error) {
    console.error('Error loading providers:', error)
    allModels.value = []
  }
}

async function loadSettings() {
  try {
    const res = await axios.get('/api/settings')
    frequency.value = res.data.globalFrequency || 10
    params.value = res.data.defaultParams || { temperature: 0.7, max_tokens: 2000, top_p: 1 }
  } catch (error) {
    console.error('Error loading settings:', error)
  }
}

async function createConversation() {
  const res = await axios.post('/api/conversations', { model: currentModel.value })
  conversations.value.push(res.data)
  // 更新 Map 缓存
  conversationMap.set(res.data.id, res.data)
  currentConv.value = res.data
  // 清空搜索缓存
  searchCache.clear()
  return res.data
}

async function createNewConversation() {
  await createConversation()
  messages.value = []
}

async function selectConversation(id) {
  // 性能优化：优先从缓存获取
  let conversation = conversationMap.get(id)
  if (!conversation) {
    const res = await axios.get(`/api/conversations/${id}`)
    conversation = res.data
    conversationMap.set(id, conversation)
  }
  
  currentConv.value = conversation
  messages.value = conversation.messages || []
  currentModel.value = conversation.model || currentModel.value
}

async function deleteConversation(id) {
  await axios.delete(`/api/conversations/${id}`)
  conversations.value = conversations.value.filter(c => c.id !== id)
  // 从 Map 缓存中删除
  conversationMap.delete(id)
  // 清空搜索缓存
  searchCache.clear()
  
  if (currentConv.value?.id === id) {
    currentConv.value = null
    messages.value = []
  }
}

// 延迟发送队列
let delayedSendTimer = null

async function sendMessage() {
  if (!inputText.value.trim() || !currentModel.value) return
  
  // 如果没有当前对话，自动创建一个
  if (!currentConv.value) {
    await createConversation()
  }
  
  // 构建用户消息，包含文本和图片
  const userMsg = {
    role: 'user',
    content: inputText.value
  }
  
  // 如果有上传的图片，添加到消息中
  if (uploadedImages.value.length > 0) {
    userMsg.images = uploadedImages.value.map(img => ({
      name: img.name,
      dataUrl: img.dataUrl
    }))
  }
  
  messages.value.push(userMsg)
  
  if (!currentConv.value.title) {
    currentConv.value.title = inputText.value.slice(0, 30)
  }
  
  const messageText = inputText.value
  inputText.value = ''
  
  // 清空已上传的图片
  const sentImages = [...uploadedImages.value]
  uploadedImages.value = []
  
  throttledScrollToBottom()
  
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
        polling: pollingEnabled.value,
        images: sentImages.length > 0 ? sentImages : undefined
      })
    })
    
    // 检查HTTP状态码
    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`
      
      try {
        const errorData = JSON.parse(errorText)
        if (errorData.error) {
          errorMessage = errorData.error
        }
      } catch (e) {
        // 如果不是JSON，使用原始错误文本
        if (errorText) {
          errorMessage = errorText
        }
      }
      
      throw new Error(errorMessage)
    }
    
    // 检查是否需要延迟
    if (response.headers.get('content-type')?.includes('application/json')) {
      const data = await response.json()
      if (data.delayed) {
        // 显示延迟提示
        rateLimitInfo.value.isLimited = true
        rateLimitInfo.value.waitTime = data.delayTime
        rateLimitInfo.value.message = data.message
        
        // 更新助手消息显示延迟信息
        assistantMsg.content = `⏳ ${data.message}`
        assistantMsg.streaming = false
        
        // 开始倒计时
        const startCountdown = () => {
          if (delayedSendTimer) clearInterval(delayedSendTimer)
          
          delayedSendTimer = setInterval(() => {
            rateLimitInfo.value.waitTime--
            assistantMsg.content = `⏳ 模型调用频率限制，还需等待 ${rateLimitInfo.value.waitTime} 秒...`
            
            if (rateLimitInfo.value.waitTime <= 0) {
              clearInterval(delayedSendTimer)
              rateLimitInfo.value.isLimited = false
              rateLimitInfo.value.message = ''
              
              // 重新发送请求
              executeDelayedRequest(assistantMsg)
            }
          }, 1000)
        }
        
        startCountdown()
        return
      }
    }
    
    // 处理流式响应
    await processStreamResponse(response, assistantMsg)
    
  } catch (e) {
    console.error('Chat error:', e)
    
    // 创建详细错误信息
    const errorDetails = createErrorDetails(e, currentModel.value)
    
    // 详细的错误信息显示
    let errorMessage = '发送消息失败'
    
    if (e.name === 'TypeError' && e.message.includes('fetch')) {
      errorMessage = '网络连接失败，请检查网络连接'
    } else if (e.name === 'SyntaxError' && e.message.includes('JSON')) {
      errorMessage = 'JSON数据格式错误，可能是服务器响应异常'
    } else if (e.message.includes('HTTP 401')) {
      errorMessage = '认证失败，请检查API密钥配置'
    } else if (e.message.includes('HTTP 403')) {
      errorMessage = '访问被拒绝，请检查API权限'
    } else if (e.message.includes('HTTP 429')) {
      errorMessage = 'API调用频率过高，请稍后再试'
    } else if (e.message.includes('HTTP 500')) {
      errorMessage = '服务器内部错误（HTTP 500），请稍后再试'
    } else if (e.message.includes('HTTP 502') || e.message.includes('HTTP 503')) {
      errorMessage = '服务暂时不可用，请稍后再试'
    } else if (e.message.includes('timeout')) {
      errorMessage = '请求超时，请稍后再试'
    } else if (e.message.includes('Expected double-quoted property name')) {
      errorMessage = 'JSON格式错误：属性名需要双引号，可能是服务器返回了无效数据'
    } else if (e.message) {
      errorMessage = e.message
    }
    
    assistantMsg.content = `❌ ${errorMessage}`
    assistantMsg.streaming = false
    assistantMsg.error = true
    assistantMsg.errorDetails = errorDetails
    
    // 强制触发响应式更新，确保错误消息显示
    messages.value = [...messages.value]
    nextTick(() => {
      throttledScrollToBottom()
    })
  }
  
  // 保存对话
  await saveConversation()
}

// 延迟请求执行函数
async function executeDelayedRequest(assistantMsg) {
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
    
    // 检查HTTP状态码
    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`
      
      try {
        const errorData = JSON.parse(errorText)
        if (errorData.error) {
          errorMessage = errorData.error
        }
      } catch (e) {
        // 如果不是JSON，使用原始错误文本
        if (errorText) {
          errorMessage = errorText
        }
      }
      
      throw new Error(errorMessage)
    }
    
    // 重置助手消息，清除倒计时信息
    assistantMsg.content = ''
    assistantMsg.streaming = true
    assistantMsg.rendered = undefined // 清除之前的渲染缓存
    assistantMsg.error = false // 清除错误状态
    
    // 处理流式响应
    await processStreamResponse(response, assistantMsg)
    
  } catch (e) {
    console.error('Delayed chat error:', e)
    
    // 创建详细错误信息
    const errorDetails = createErrorDetails(e, currentModel.value)
    
    // 详细的错误信息显示
    let errorMessage = '延迟请求失败'
    
    if (e.name === 'TypeError' && e.message.includes('fetch')) {
      errorMessage = '网络连接失败，请检查网络连接'
    } else if (e.name === 'SyntaxError' && e.message.includes('JSON')) {
      errorMessage = 'JSON数据格式错误，可能是服务器响应异常'
    } else if (e.message.includes('HTTP 401')) {
      errorMessage = '认证失败，请检查API密钥配置'
    } else if (e.message.includes('HTTP 403')) {
      errorMessage = '访问被拒绝，请检查API权限'
    } else if (e.message.includes('HTTP 429')) {
      errorMessage = 'API调用频率过高，请稍后再试'
    } else if (e.message.includes('HTTP 500')) {
      errorMessage = '服务器内部错误（HTTP 500），请稍后再试'
    } else if (e.message.includes('HTTP 502') || e.message.includes('HTTP 503')) {
      errorMessage = '服务暂时不可用，请稍后再试'
    } else if (e.message.includes('timeout')) {
      errorMessage = '请求超时，请稍后再试'
    } else if (e.message.includes('Expected double-quoted property name')) {
      errorMessage = 'JSON格式错误：属性名需要双引号，可能是服务器返回了无效数据'
    } else if (e.message) {
      errorMessage = e.message
    }
    
    assistantMsg.content = `❌ ${errorMessage}`
    assistantMsg.streaming = false
    assistantMsg.error = true
    assistantMsg.errorDetails = errorDetails
    
    // 强制触发响应式更新，确保错误消息显示
    messages.value = [...messages.value]
    nextTick(() => {
      throttledScrollToBottom()
    })
  }
  
  // 保存对话
  await saveConversation()
}

// 处理流式响应
async function processStreamResponse(response, assistantMsg) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      
      const chunk = decoder.decode(value)
      const lines = chunk.split('\n').filter(l => l.trim().startsWith('data:'))
      
      for (const line of lines) {
        const data = line.replace(/^data: /, '').trim()
        if (data === '[DONE]' || data === '') continue
        
        try {
          const json = JSON.parse(data)
          if (json.error) {
            throw new Error(json.error)
          }
          if (json.choices?.[0]?.delta?.content) {
            // 直接更新消息内容，确保实时显示
            assistantMsg.content += json.choices[0].delta.content
            // 强制触发响应式更新
            messages.value = [...messages.value]
            // 滚动到底部
            nextTick(() => {
              throttledScrollToBottom()
            })
          }
        } catch (e) {
          // 更详细的JSON解析错误处理
          if (e.name === 'SyntaxError' && e.message.includes('JSON')) {
            console.warn('JSON解析错误，跳过此数据块:', data.substring(0, 100) + '...')
            console.warn('完整错误:', e.message)
            // 不抛出错误，继续处理下一个数据块
            continue
          } else if (e.message !== 'Unexpected end of JSON input') {
            console.error('Parse error:', e)
            throw e // 重新抛出非JSON解析的其他错误
          }
        }
      }
    }
    
    assistantMsg.streaming = false
    assistantMsg.error = false
    
    // 最终渲染时使用缓存
    const cacheKey = `${assistantMsg.role}-${assistantMsg.content}`
    if (!renderedCache.has(cacheKey)) {
      assistantMsg.rendered = marked(assistantMsg.content)
      renderedCache.set(cacheKey, assistantMsg.rendered)
    } else {
      assistantMsg.rendered = renderedCache.get(cacheKey)
    }
    
  } catch (e) {
    console.error('Stream processing error:', e)
    
    // 创建详细错误信息
    const errorDetails = createErrorDetails(e, currentModel.value)
    
    // 如果流式处理出错，显示错误信息
    let errorMessage = '接收响应时出错'
    
    if (e.name === 'SyntaxError' && e.message.includes('JSON')) {
      errorMessage = 'JSON数据格式错误，可能是服务器响应异常'
    } else if (e.message.includes('network')) {
      errorMessage = '网络连接中断'
    } else if (e.message.includes('timeout')) {
      errorMessage = '响应超时'
    } else if (e.message.includes('Expected double-quoted property name')) {
      errorMessage = 'JSON格式错误：属性名需要双引号，可能是服务器返回了无效数据'
    } else if (e.message) {
      errorMessage = e.message
    }
    
    assistantMsg.content += `\n\n❌ ${errorMessage}`
    assistantMsg.streaming = false
    assistantMsg.error = true
    assistantMsg.errorDetails = errorDetails
    
    // 强制触发响应式更新，确保错误消息显示
    messages.value = [...messages.value]
    nextTick(() => {
      throttledScrollToBottom()
    })
  }
}

// 保存对话
async function saveConversation() {
  currentConv.value.messages = messages.value
  currentConv.value.model = currentModel.value
  await axios.put(`/api/conversations/${currentConv.value.id}`, currentConv.value)
  
  // 性能优化：使用 Map 更新，避免数组查找
  conversationMap.set(currentConv.value.id, currentConv.value)
  const idx = conversations.value.findIndex(c => c.id === currentConv.value.id)
  if (idx !== -1) conversations.value[idx] = { ...currentConv.value }
  
  // 清空搜索缓存，因为对话内容可能影响搜索结果
  searchCache.clear()
}

// 性能优化：优化滚动函数，减少不必要的滚动
let lastScrollHeight = 0
let isScrolling = false

function scrollToBottom() {
  if (messagesContainer.value && !isScrolling) {
    const container = messagesContainer.value
    const currentScrollHeight = container.scrollHeight
    
    // 只有当内容高度发生变化时才滚动
    if (currentScrollHeight !== lastScrollHeight) {
      isScrolling = true
      requestAnimationFrame(() => {
        container.scrollTop = currentScrollHeight
        lastScrollHeight = currentScrollHeight
        isScrolling = false
      })
    }
  }
}

// 性能优化：节流滚动函数
const throttledScrollToBottom = (() => {
  let scrollTimer = null
  return () => {
    if (!scrollTimer) {
      scrollTimer = setTimeout(() => {
        scrollToBottom()
        scrollTimer = null
      }, 16) // 约60fps
    }
  }
})()

// 性能优化：优化 Markdown 渲染缓存
function getRenderedContent(msg, index) {
  if (msg.rendered) return msg.rendered
  
  // 为流式消息实时渲染，但不缓存
  if (msg.streaming) return marked(msg.content)
  
  // 生成缓存键
  const cacheKey = `${msg.role}-${msg.content}`
  
  // 检查缓存
  if (renderedCache.has(cacheKey)) {
    const rendered = renderedCache.get(cacheKey)
    // 修复：直接修改对象属性而不是数组索引
    msg.rendered = rendered
    return rendered
  }
  
  // 渲染并缓存
  const rendered = marked(msg.content)
  
  // 缓存大小控制
  if (renderedCache.size >= maxCacheSize) {
    const firstKey = renderedCache.keys().next().value
    renderedCache.delete(firstKey)
  }
  
  renderedCache.set(cacheKey, rendered)
  // 修复：直接修改对象属性而不是数组索引
  msg.rendered = rendered
  return rendered
}

// 创建详细错误信息
function createErrorDetails(error, model) {
  const timestamp = new Date().toLocaleString('zh-CN')
  const errorType = error.name || 'UnknownError'
  
  const details = {
    timestamp,
    model,
    errorType,
    originalError: error.message || '未知错误',
    suggestions: []
  }
  
  // 根据错误类型添加建议
  if (error.name === 'TypeError' && error.message.includes('fetch')) {
    details.suggestions = [
      '检查网络连接是否正常',
      '确认服务器是否正在运行',
      '检查防火墙设置',
      '尝试刷新页面重新连接'
    ]
  } else if (error.name === 'SyntaxError' && error.message.includes('JSON')) {
    details.suggestions = [
      '服务器返回了无效的JSON数据',
      '检查API接口是否正常',
      '查看服务器日志获取更多信息',
      '联系技术支持'
    ]
  } else if (error.message.includes('HTTP 401')) {
    details.suggestions = [
      '检查API密钥是否正确配置',
      '确认API密钥是否已过期',
      '检查认证信息是否完整',
      '重新配置API设置'
    ]
  } else if (error.message.includes('HTTP 403')) {
    details.suggestions = [
      '检查API权限设置',
      '确认账户是否有足够权限',
      '检查IP白名单设置',
      '联系服务提供商确认权限'
    ]
  } else if (error.message.includes('HTTP 429')) {
    details.suggestions = [
      '降低请求频率',
      '等待一段时间后重试',
      '检查速率限制设置',
      '考虑升级API套餐'
    ]
  } else if (error.message.includes('HTTP 500')) {
    details.suggestions = [
      '服务器内部错误，请稍后重试',
      '检查服务器状态',
      '查看服务器日志',
      '联系技术支持'
    ]
  } else {
    details.suggestions = [
      '尝试刷新页面',
      '检查网络连接',
      '稍后重试',
      '联系技术支持'
    ]
  }
  
  // 添加请求详情（如果有）
  if (error.response) {
    details.requestDetails = {
      url: error.config?.url || '/api/chat',
      method: error.config?.method?.toUpperCase() || 'POST',
      status: error.response.status
    }
    
    details.responseDetails = {
      contentType: error.response.headers?.['content-type'] || '未知',
      responseText: typeof error.response.data === 'string'
        ? error.response.data.substring(0, 500)
        : JSON.stringify(error.response.data, null, 2).substring(0, 500)
    }
  }
  
  // 添加堆栈跟踪（开发环境）
  if (error.stack && process.env.NODE_ENV === 'development') {
    details.stackTrace = error.stack
  }
  
  return details
}

// 显示错误详情弹窗
function showErrorDetails(errorDetails) {
  currentErrorDetails.value = errorDetails
  showErrorModal.value = true
}

// 复制错误详情
function copyErrorDetails() {
  if (!currentErrorDetails.value) return
  
  const details = currentErrorDetails.value
  const text = `
错误详情报告
================

时间: ${details.timestamp}
模型: ${details.model}
错误类型: ${details.errorType}

错误信息:
${details.originalError}

${details.requestDetails ? `
请求信息:
- URL: ${details.requestDetails.url}
- 方法: ${details.requestDetails.method}
- 状态码: ${details.requestDetails.status}
` : ''}

${details.responseDetails ? `
响应信息:
- Content-Type: ${details.responseDetails.contentType}
- 响应内容: ${details.responseDetails.responseText}
` : ''}

${details.stackTrace ? `
堆栈跟踪:
${details.stackTrace}
` : ''}

建议解决方案:
${details.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}
`.trim()
  
  navigator.clipboard.writeText(text).then(() => {
    // 可以添加复制成功的提示
    console.log('错误详情已复制到剪贴板')
  }).catch(err => {
    console.error('复制失败:', err)
  })
}

// 处理图片上传
function handleImageUpload(event) {
  const files = event.target.files
  if (!files || files.length === 0) return
  
  Array.from(files).forEach(file => {
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件')
      return
    }
    
    // 检查文件大小，限制为5MB
    const maxSize = 5 * 1024 * 1024 // 5MB
    if (file.size > maxSize) {
      alert(`图片文件过大，请选择小于5MB的图片。当前文件大小：${(file.size / 1024 / 1024).toFixed(2)}MB`)
      return
    }
    
    const reader = new FileReader()
    reader.onload = (e) => {
      // 压缩图片
      compressImage(e.target.result, file.name, (compressedDataUrl) => {
        uploadedImages.value.push({
          name: file.name,
          dataUrl: compressedDataUrl,
          file: file
        })
      })
    }
    reader.readAsDataURL(file)
  })
  
  // 清空input，允许重复选择同一文件
  event.target.value = ''
}

// 图片压缩函数
function compressImage(dataUrl, fileName, callback) {
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    
    // 计算压缩后的尺寸，最大宽度或高度为512px（进一步减小）
    const maxSize = 512
    let { width, height } = img
    
    if (width > height) {
      if (width > maxSize) {
        height = (height * maxSize) / width
        width = maxSize
      }
    } else {
      if (height > maxSize) {
        width = (width * maxSize) / height
        height = maxSize
      }
    }
    
    canvas.width = width
    canvas.height = height
    
    // 绘制压缩后的图片
    ctx.drawImage(img, 0, 0, width, height)
    
    // 多级压缩策略
    let quality = 0.7
    let compressedDataUrl = canvas.toDataURL('image/jpeg', quality)
    let compressedSize = compressedDataUrl.length * 0.75 // 估算字节大小
    
    // 如果图片还是太大，继续降低质量
    while (compressedSize > 1 * 1024 * 1024 && quality > 0.1) { // 限制在1MB以内
      quality -= 0.1
      compressedDataUrl = canvas.toDataURL('image/jpeg', quality)
      compressedSize = compressedDataUrl.length * 0.75
    }
    
    console.log(`图片压缩完成: ${fileName}, 原始尺寸: ${img.width}x${img.height}, 压缩后尺寸: ${width}x${height}, 质量: ${quality}, 估算大小: ${(compressedSize / 1024 / 1024).toFixed(2)}MB`)
    
    callback(compressedDataUrl)
  }
  img.src = dataUrl
}

// 删除图片
function removeImage(index) {
  uploadedImages.value.splice(index, 1)
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
