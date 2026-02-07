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
        <div class="header-controls">
          <div class="model-selector" ref="modelSelectorRef">
            <div class="model-select-trigger" @click="toggleModelDropdown">
              <span class="selected-model">{{ currentModelLabel || '选择模型' }}</span>
              <span class="dropdown-arrow">{{ showModelDropdown ? '▲' : '▼' }}</span>
            </div>
            <div v-if="showModelDropdown" class="model-dropdown">
              <input
                v-model="modelSearchQuery"
                @input="onModelSearch"
                placeholder="搜索模型..."
                class="model-search-input"
                ref="modelSearchInput"
                @click.stop
              >
              <div class="model-options">
                <div
                  v-for="m in filteredModels"
                  :key="m.value"
                  :class="['model-option', { active: currentModel === m.value }]"
                  @click="selectModel(m.value)"
                >
                  {{ m.label }}
                </div>
                <div v-if="filteredModels.length === 0" class="no-models">
                  未找到匹配的模型
                </div>
              </div>
            </div>
          </div>

          <!-- 风格选择器 -->
          <div class="style-selector" ref="styleSelectorRef">
            <div class="style-select-trigger" @click="toggleStyleDropdown">
              <span class="style-icon">{{ currentStyleConfig?.icon || '📝' }}</span>
              <span class="selected-style">{{ currentStyleConfig?.name || '默认' }}</span>
              <span class="dropdown-arrow">{{ showStyleDropdown ? '▲' : '▼' }}</span>
            </div>
            <div v-if="showStyleDropdown" class="style-dropdown">
              <div class="style-options">
                <div
                  v-for="style in availableStyles"
                  :key="style.id"
                  :class="['style-option', { active: currentStyle === style.id }]"
                  @click="selectStyle(style.id)"
                  :title="style.description"
                >
                  <span class="style-option-icon">{{ style.icon }}</span>
                  <span class="style-option-name">{{ style.name }}</span>
                  <span class="style-option-desc">{{ style.description }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div class="messages" ref="messagesContainer">
        <div v-for="(msg, i) in messages" :key="i" :class="['message', msg.role, { 'error': msg.error, 'streaming': msg.streaming }]">
          <div v-if="msg.images && msg.images.length > 0" class="message-images">
            <img v-for="(img, idx) in msg.images" :key="idx"
                 :src="img.dataUrl"
                 :alt="img.name"
                 class="message-image"
                 @click="openImageViewer(img.dataUrl)"
                 title="点击查看大图">
          </div>
          <div v-if="msg.files && msg.files.length > 0" class="message-files">
            <div v-for="(file, idx) in msg.files" :key="idx" class="message-file">
              <span class="file-icon">📄</span>
              <span class="file-name">{{ file.name }}</span>
            </div>
          </div>
          <div class="message-content" :class="getMessageStyleClass(msg)" v-html="getRenderedContent(msg, i)"></div>
          <div v-if="msg.error && msg.errorDetails" class="error-details-btn" @click="showErrorDetails(msg.errorDetails)">
            <span class="details-icon">🔍</span>
            <span>查看详情</span>
          </div>
          <!-- 消息操作按钮 -->
          <div class="message-actions" v-if="!msg.streaming">
            <button class="action-btn" @click="copyMessage(msg)" title="复制消息">
              <span class="action-icon">📋</span>
              <span class="action-text">复制</span>
            </button>
            <button class="action-btn action-btn-danger" @click="deleteMessage(i)" title="删除消息">
              <span class="action-icon">🗑️</span>
              <span class="action-text">删除</span>
            </button>
            <button v-if="msg.role === 'assistant'" class="action-btn action-btn-primary" @click="regenerateResponse(i)" title="重新生成回复">
              <span class="action-icon">🔄</span>
              <span class="action-text">重新生成</span>
            </button>
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
            <input type="file" accept="image/*" @change="handleImageUpload" style="display: none;" ref="imageInput" multiple>
          </label>
          <label class="btn-tool" style="cursor: pointer;">
            📄 上传文件
            <input type="file" :accept="supportedFileTypes" @change="handleFileUpload" style="display: none;" ref="fileInput" multiple>
          </label>
          <label class="toggle" :class="{ disabled: !canEnablePolling }">
            <input type="checkbox" v-model="pollingEnabled" :disabled="!canEnablePolling" @change="onPollingToggle">
            <span>轮询模式</span>
            <span v-if="!canEnablePolling" class="polling-disabled-hint">（当前模型无重复提供商）</span>
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
        
        <!-- 文件预览区域 -->
        <div v-if="uploadedFiles.length > 0" class="file-preview-container">
          <div v-for="(file, index) in uploadedFiles" :key="index" class="file-preview-item">
            <span class="file-icon">📄</span>
            <span class="file-name">{{ file.name }}</span>
            <span class="file-size">({{ formatFileSize(file.size) }})</span>
            <button @click="removeFile(index)" class="btn-remove-file">×</button>
          </div>
        </div>
        <textarea v-model="inputText"
                  @keydown="handleKeydown"
                  @paste="handlePaste"
                  placeholder="输入消息... (Enter 发送, Shift+Enter 换行, Ctrl+V 粘贴图片)"
                  class="input-box"></textarea>
        <button @click="sendMessage" :disabled="!inputText.trim() || !currentModel || rateLimitInfo.isLimited" class="btn-send">
          {{ rateLimitInfo.isLimited ? `等待 ${rateLimitInfo.waitTime}s` : '发送' }}
        </button>
      </div>
    </div>
    
    <div v-if="showParams" class="modal" @click.self="showParams = false">
      <div class="modal-content">
        <h3>参数配置</h3>

        <!-- 文本模型参数 -->
        <div v-if="currentModelType === 'text'" class="text-params">
          <label>系统提示词:
            <select v-model="selectedPromptId" class="prompt-select">
              <option value="">无（不使用提示词）</option>
              <option v-for="prompt in prompts" :key="prompt.id" :value="prompt.id">
                {{ prompt.name }}
              </option>
            </select>
          </label>
          <div v-if="selectedPrompt" class="prompt-preview">
            <div class="prompt-preview-header">
              <strong>{{ selectedPrompt.name }}</strong>
              <span class="prompt-preview-desc">{{ selectedPrompt.description }}</span>
            </div>
            <div class="prompt-preview-content">{{ selectedPrompt.content }}</div>
          </div>
          <label>温度: <input v-model.number="params.temperature" type="number" step="0.1" min="0" max="2"></label>
          <label>最大长度: <input v-model.number="params.max_tokens" type="number"></label>
          <label>Top P: <input v-model.number="params.top_p" type="number" step="0.1" min="0" max="1"></label>
        </div>

        <!-- 生图模型参数 -->
        <div v-if="currentModelType === 'image'" class="image-params">
          <label>图片尺寸:
            <select v-model="imageParams.size">
              <option value="1024x1024">1024x1024 (方形)</option>
              <option value="1024x1792">1024x1792 (竖版)</option>
              <option value="1792x1024">1792x1024 (横版)</option>
            </select>
          </label>

          <label>图片质量:
            <select v-model="imageParams.quality">
              <option value="standard">标准</option>
              <option value="hd">高清</option>
            </select>
          </label>

          <label>图片风格:
            <select v-model="imageParams.style">
              <option value="vivid">生动</option>
              <option value="natural">自然</option>
            </select>
          </label>

          <label>生成数量:
            <input v-model.number="imageParams.n" type="number" min="1" max="4">
          </label>

          <div class="param-hint">
            <small>💡 提示：DALL-E 3 支持高清质量和风格选择</small>
          </div>
        </div>

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

    <!-- 图片查看器 -->
    <div v-if="imageViewerVisible" class="image-viewer-modal" @click.self="closeImageViewer" @wheel.prevent="handleViewerWheel">
      <div class="image-viewer-content">
        <div class="image-viewer-header">
          <div class="viewer-controls">
            <button @click="zoomOut" class="viewer-btn" title="缩小 (-)">➖</button>
            <span class="zoom-level">{{ Math.round(imageViewerScale * 100) }}%</span>
            <button @click="zoomIn" class="viewer-btn" title="放大 (+)">➕</button>
            <button @click="resetZoom" class="viewer-btn" title="重置 (0)">↺</button>
          </div>
          <button @click="closeImageViewer" class="viewer-close" title="关闭 (ESC)">✕</button>
        </div>
        <div class="image-viewer-body" @wheel.prevent="handleViewerWheel">
          <img :src="currentViewImage"
               :style="{ transform: `scale(${imageViewerScale})` }"
               class="viewer-image"
               alt="Full size image"
               draggable="false">
        </div>
        <div class="image-viewer-footer">
          <span class="viewer-hint">滚轮缩放 | ESC关闭 | +/- 缩放 | 0 重置</span>
          <a :href="currentViewImage" download="image.png" class="viewer-download">📥 下载原图</a>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 模型选择器样式 */
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex: 1;
  min-width: 0;
}

.model-selector {
  position: relative;
  min-width: 500px;
  max-width: 600px;
  flex-shrink: 0;
}

/* 风格选择器样式 */
.style-selector {
  position: relative;
  min-width: 200px;
  max-width: 280px;
  flex-shrink: 0;
}

.style-select-trigger {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 10px 14px;
  background: white;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.style-select-trigger:hover {
  border-color: #0891b2;
  box-shadow: 0 0 0 3px rgba(8, 145, 178, 0.1);
}

.style-icon {
  font-size: 16px;
  line-height: 1;
}

.selected-style {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #495057;
  font-size: 14px;
}

.style-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  min-width: 280px;
  width: max-content;
  background: white;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  max-height: 400px;
  overflow-y: auto;
}

.style-options {
  display: flex;
  flex-direction: column;
}

.style-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 12px 16px;
  cursor: pointer;
  transition: background-color 0.15s;
  border-bottom: 1px solid #f8f9fa;
}

.style-option:last-child {
  border-bottom: none;
}

.style-option:hover {
  background-color: #f8f9fa;
}

.style-option.active {
  background-color: #e0f2fe;
  color: #0891b2;
  font-weight: 500;
}

.style-option-icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
}

.style-option-name {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: #495057;
}

.style-option-desc {
  font-size: 12px;
  color: #6c757d;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

/* 适配小屏幕 */
@media (max-width: 768px) {
  .header-controls {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }

  .model-selector,
  .style-selector {
    min-width: auto;
    max-width: none;
  }

  .style-option-desc {
    display: none;
  }
}

.model-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: white;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.model-select-trigger:hover {
  border-color: #007bff;
  box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
}

.selected-model {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #495057;
  font-size: 14px;
}

.dropdown-arrow {
  margin-left: 8px;
  color: #6c757d;
  font-size: 12px;
  transition: transform 0.2s;
}

.model-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: white;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  max-height: 400px;
  display: flex;
  flex-direction: column;
}

.model-search-input {
  padding: 10px 12px;
  border: none;
  border-bottom: 1px solid #dee2e6;
  outline: none;
  font-size: 14px;
  border-radius: 6px 6px 0 0;
}

.model-search-input:focus {
  border-bottom-color: #007bff;
}

.model-options {
  overflow-y: auto;
  max-height: 350px;
}

.model-option {
  padding: 10px 16px;
  cursor: pointer;
  transition: background-color 0.15s;
  font-size: 14px;
  color: #495057;
  border-bottom: 1px solid #f8f9fa;
}

.model-option:last-child {
  border-bottom: none;
}

.model-option:hover {
  background-color: #f8f9fa;
}

.model-option.active {
  background-color: #e7f3ff;
  color: #007bff;
  font-weight: 500;
}

.no-models {
  padding: 20px;
  text-align: center;
  color: #6c757d;
  font-size: 14px;
}

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
  max-width: 150px;
  max-height: 150px;
  border-radius: 8px;
  border: 1px solid #dee2e6;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  object-fit: cover;
}

.message-image:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
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

/* 轮询开关禁用状态样式 */
.toggle.disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.toggle.disabled input {
  cursor: not-allowed;
}

.polling-disabled-hint {
  font-size: 12px;
  color: #6c757d;
  margin-left: 8px;
}

/* 文件预览容器样式 */
.file-preview-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background-color: #f8f9fa;
  border-radius: 8px;
  margin-bottom: 12px;
}

.file-preview-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background-color: white;
  border: 1px solid #dee2e6;
  border-radius: 6px;
}

.file-preview-item .file-icon {
  font-size: 20px;
}

.file-preview-item .file-name {
  flex: 1;
  font-size: 14px;
  color: #495057;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-preview-item .file-size {
  font-size: 12px;
  color: #6c757d;
}

.btn-remove-file {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background-color: #dc3545;
  color: white;
  border: none;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}

.btn-remove-file:hover {
  background-color: #c82333;
}

/* 消息中的文件样式 */
.message-files {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}

.message-file {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background-color: #e9ecef;
  border-radius: 4px;
  font-size: 13px;
}

.message-file .file-icon {
  font-size: 16px;
}

.message-file .file-name {
  color: #495057;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 提示词选择样式 */
.prompt-select {
  width: 100%;
  padding: 8px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 14px;
  margin-top: 5px;
}

.prompt-preview {
  margin-top: 15px;
  padding: 15px;
  background: #f8f9fa;
  border-radius: 10px;
  border: 2px solid #e0e0e0;
}

.prompt-preview-header {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid #dee2e6;
}

.prompt-preview-header strong {
  color: #333;
  font-size: 14px;
}

.prompt-preview-desc {
  color: #6c757d;
  font-size: 12px;
}

.prompt-preview-content {
  color: #495057;
  font-size: 13px;
  line-height: 1.6;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
}

/* ==================== 生图模型样式 ==================== */

/* 生图参数配置 */
.image-params {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.image-params label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 14px;
  color: #495057;
}

.image-params select,
.image-params input {
  padding: 8px 12px;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  font-size: 14px;
  background: white;
  transition: border-color 0.2s;
}

.image-params select:focus,
.image-params input:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
}

.param-hint {
  padding: 8px 12px;
  background: #e7f3ff;
  border-left: 3px solid #007bff;
  border-radius: 4px;
  margin-top: 8px;
}

.param-hint small {
  color: #0056b3;
  font-size: 12px;
}

/* 文本参数配置 */
.text-params {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 生图加载状态 */
.message.assistant.streaming .message-content:has(.generated-images-container) {
  position: relative;
}

.message.assistant.streaming .message-content:has(.generated-images-container)::before {
  content: "🎨 正在生成图片，请稍候...";
  display: block;
  padding: 20px;
  text-align: center;
  color: #6c757d;
  font-style: italic;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

/* 消息操作按钮样式 */
.message-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #e9ecef;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.message:hover .message-actions {
  opacity: 1;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background-color: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: #6c757d;
  transition: all 0.2s ease;
}

.action-btn:hover {
  background-color: #e9ecef;
  border-color: #adb5bd;
  color: #495057;
}

.action-btn-danger:hover {
  background-color: #f8d7da;
  border-color: #f5c6cb;
  color: #721c24;
}

.action-btn-primary:hover {
  background-color: #cce5ff;
  border-color: #b8daff;
  color: #004085;
}

.action-icon {
  font-size: 14px;
  line-height: 1;
}

.action-text {
  font-size: 12px;
}

/* 适配小屏幕 */
@media (max-width: 768px) {
  .message-actions {
    opacity: 1;
  }

  .action-text {
    display: none;
  }

  .action-btn {
    padding: 6px 8px;
  }
}
</style>

<!-- 非 scoped 样式，用于 v-html 动态生成的内容 -->
<style>
/* ==================== 消息内容中的图片通用样式 ==================== */

/* 为消息内容中的所有图片添加缩略图样式（排除生成图片） */
.message-content img:not(.generated-image-preview) {
  max-width: 200px;
  max-height: 200px;
  border-radius: 8px;
  border: 2px solid #dee2e6;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  object-fit: cover;
  margin: 8px 4px;
  display: inline-block;
}

.message-content img:not(.generated-image-preview):hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  border-color: #007bff;
}

/* ==================== 生成图片容器样式（非scoped，用于v-html） ==================== */

/* 图片文本内容（进度信息、提示词等） */
.image-text-content {
  margin-bottom: 12px;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 8px;
  border-left: 3px solid #0891b2;
  font-size: 13px;
  color: #495057;
  line-height: 1.6;
  max-height: 200px;
  overflow-y: auto;
}

.image-text-content p {
  margin: 0 0 8px 0;
}

.image-text-content p:last-child {
  margin-bottom: 0;
}

.generated-images-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 300px));
  gap: 16px;
  margin: 12px 0;
}

.generated-image-item {
  border: 1px solid #dee2e6;
  border-radius: 8px;
  overflow: hidden;
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transition: box-shadow 0.2s;
  max-width: 300px;
}

.generated-image-item:hover {
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

/* 图片预览包装器 */
.image-preview-wrapper {
  position: relative;
  cursor: pointer;
  overflow: hidden;
  border-radius: 8px 8px 0 0;
  max-height: 250px;
}

/* 生成的图片预览 - 缩略图样式 */
.generated-image-preview {
  width: 100%;
  height: auto;
  max-width: 100%;
  max-height: 250px;
  object-fit: cover;
  display: block;
  transition: transform 0.3s ease;
  border: none;
  margin: 0;
  border-radius: 0;
}

/* 悬停遮罩层 */
.image-preview-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.image-preview-wrapper:hover .image-preview-overlay {
  opacity: 1;
}

.image-preview-wrapper:hover .generated-image-preview {
  transform: scale(1.05);
}

.preview-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.preview-text {
  color: #fff;
  font-size: 14px;
}

/* 图片操作按钮区域 */
.image-actions {
  padding: 10px;
  display: flex;
  gap: 8px;
  justify-content: center;
  background: #f8f9fa;
}

.btn-view {
  padding: 6px 12px;
  background: #28a745;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.2s;
}

.btn-view:hover {
  background: #218838;
}

.btn-download {
  padding: 6px 12px;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  text-decoration: none;
  font-size: 13px;
  transition: background 0.2s;
  display: inline-block;
}

.btn-download:hover {
  background: #0056b3;
}

/* 修订后的提示词 */
.revised-prompt {
  padding: 8px 10px;
  margin: 0;
  font-size: 11px;
  color: #6c757d;
  background: #f8f9fa;
  border-top: 1px solid #dee2e6;
  line-height: 1.4;
  max-height: 60px;
  overflow-y: auto;
}

/* 图片元数据 */
.image-metadata {
  padding: 8px 10px;
  background: #f8f9fa;
  border-top: 1px solid #dee2e6;
  font-size: 11px;
  color: #6c757d;
}

/* ==================== 图片查看器样式（非scoped） ==================== */

.image-viewer-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.92);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: viewerFadeIn 0.2s ease;
}

@keyframes viewerFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.image-viewer-content {
  display: flex;
  flex-direction: column;
  max-width: 95vw;
  max-height: 95vh;
  background: #1a1a1a;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.image-viewer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #2a2a2a;
  border-bottom: 1px solid #3a3a3a;
}

.viewer-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.viewer-btn {
  padding: 8px 14px;
  background: #3a3a3a;
  border: none;
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
}

.viewer-btn:hover {
  background: #4a4a4a;
}

.zoom-level {
  color: #aaa;
  font-size: 14px;
  min-width: 60px;
  text-align: center;
  padding: 0 8px;
}

.viewer-close {
  width: 36px;
  height: 36px;
  background: #dc3545;
  border: none;
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, transform 0.2s;
}

.viewer-close:hover {
  background: #c82333;
  transform: scale(1.1);
}

.image-viewer-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 20px;
  min-height: 400px;
  min-width: 500px;
  max-height: calc(95vh - 130px);
  background: #111;
}

.viewer-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transition: transform 0.2s ease;
  border-radius: 4px;
  user-select: none;
}

.image-viewer-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #2a2a2a;
  border-top: 1px solid #3a3a3a;
}

.viewer-hint {
  color: #888;
  font-size: 12px;
}

.viewer-download {
  padding: 10px 20px;
  background: #007bff;
  color: #fff;
  text-decoration: none;
  border-radius: 6px;
  font-size: 14px;
  transition: background 0.2s;
}

.viewer-download:hover {
  background: #0056b3;
  color: #fff;
}
</style>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, shallowRef, markRaw } from 'vue'
import axios from 'axios'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import contentStyleManager from '../utils/contentStyleManager.js'
import '../styles/notion-style.css'
import '../styles/konayuki-style.css'
import '../styles/everforest-style.css'
import '../styles/happysimple-style.css'

// 性能优化：使用 shallowRef 减少深度响应式
const conversations = shallowRef([])
const currentConv = ref(null)
// 修复：messages 需要深度响应式以支持流式更新
const messages = ref([])
const inputText = ref('')
const searchQuery = ref('')
const currentModel = ref('')
const allModels = shallowRef([])
const showModelDropdown = ref(false)
const modelSearchQuery = ref('')
const modelSelectorRef = ref(null)
const modelSearchInput = ref(null)
const pollingEnabled = ref(false)
const userSettings = ref({})
const frequency = ref(10)
const showParams = ref(false)
const params = ref({ temperature: 0.7, max_tokens: 2000, top_p: 1 })
const messagesContainer = ref(null)
const imageInput = ref(null)
const fileInput = ref(null)
const uploadedImages = ref([])
const uploadedFiles = ref([])
// 存储提供商列表，用于计算重复模型
const providers = ref([])

// 提示词相关
const prompts = ref([])
const selectedPromptId = ref('')

// 风格选择器相关
const showStyleDropdown = ref(false)
const styleSelectorRef = ref(null)
// 从风格管理器获取初始风格，确保状态同步
const currentStyle = ref(contentStyleManager.getCurrentStyle())

// 支持的文件类型
const supportedFileTypes = '.txt,.md,.json,.js,.ts,.jsx,.tsx,.vue,.py,.java,.c,.cpp,.h,.hpp,.cs,.go,.rs,.rb,.php,.html,.css,.scss,.less,.xml,.yaml,.yml,.toml,.ini,.conf,.sh,.bat,.ps1,.sql,.csv,.log'

// 速率限制状态
const rateLimitInfo = ref({
  isLimited: false,
  waitTime: 0,
  message: ''
})

// 错误详情弹窗状态
const showErrorModal = ref(false)
const currentErrorDetails = ref(null)

// 生图参数配置
const imageParams = ref({
  size: '1024x1024',
  quality: 'standard',
  style: 'vivid',
  n: 1
})

// 图片查看器状态
const imageViewerVisible = ref(false)
const currentViewImage = ref(null)
const imageViewerScale = ref(1)

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

// 计算当前选中的提示词
const selectedPrompt = computed(() => {
  if (!selectedPromptId.value) return null
  return prompts.value.find(p => p.id === selectedPromptId.value)
})

// 计算过滤后的模型列表
const filteredModels = computed(() => {
  const query = modelSearchQuery.value.toLowerCase().trim()
  if (!query) return allModels.value

  return allModels.value.filter(m =>
    m.label.toLowerCase().includes(query) ||
    m.value.toLowerCase().includes(query)
  )
})

// 计算当前模型的显示标签
const currentModelLabel = computed(() => {
  if (!currentModel.value) return ''
  const model = allModels.value.find(m => m.value === currentModel.value)
  return model ? model.label : currentModel.value
})

// 风格相关计算属性
const currentStyleConfig = computed(() => {
  // 基于当前选择的风格ID获取配置
  return contentStyleManager.getStyle(currentStyle.value)
})

const availableStyles = computed(() => {
  return contentStyleManager.getAvailableStyles()
})

// 计算当前模型是否可以启用轮询
const canEnablePolling = computed(() => {
  // 基本检查：需要有当前模型
  if (!currentModel.value) {
    console.log('轮询检查 - 未选择模型，禁用轮询')
    return false
  }
  
  // 提取模型名称
  const modelName = extractModelName(currentModel.value)
  
  if (!modelName) {
    console.log('轮询检查 - 无法提取模型名称，禁用轮询')
    return false
  }
  
  // 从 providers 数据中实时计算该模型有多少个提供商支持
  const providersWithModel = providers.value.filter(provider => {
    // 跳过禁用的提供商
    if (provider.disabled) return false
    
    // 检查提供商是否有该模型
    if (!provider.models || provider.models.length === 0) return false
    
    return provider.models.some(m => {
      if (m.visible === false) return false // 跳过不可见的模型
      const extractedName = m.id.includes('/') ? m.id.split('/').pop() : m.id
      return extractedName === modelName
    })
  })
  
  // 检查是否在可用池中且未被排除
  const pollingConfig = userSettings.value?.pollingConfig || { available: {}, excluded: {} }
  const availablePool = pollingConfig.available || {}
  const excludedPool = pollingConfig.excluded || {}
  
  // 检查是否在排除池中
  const isExcluded = !!excludedPool[modelName]
  
  // 检查是否在可用池中（如果可用池有配置的话）
  const isInAvailablePool = modelName in availablePool
  const availableProviderCount = availablePool[modelName]?.length || 0
  
  // 轮询的核心条件：
  // 1. 模型在可用池中配置了至少2个提供商，或者
  // 2. 实际有至少2个提供商支持该模型（当可用池未配置时）
  // 3. 模型不能在排除池中
  const hasMultipleProvidersInPool = isInAvailablePool && availableProviderCount >= 2
  const hasMultipleProvidersActual = providersWithModel.length >= 2
  
  // 如果可用池有配置，优先使用可用池的判断；否则使用实际提供商数量
  const hasMultipleProviders = isInAvailablePool ? hasMultipleProvidersInPool : hasMultipleProvidersActual
  const notExcluded = !isExcluded
  
  const canEnable = hasMultipleProviders && notExcluded
  
  console.log(`轮询检查 - 模型: ${modelName}`)
  console.log(`  - 实际支持该模型的提供商: ${providersWithModel.map(p => p.name).join(', ')} (${providersWithModel.length}个)`)
  console.log(`  - 是否在可用池中: ${isInAvailablePool}`)
  console.log(`  - 可用池中的提供商数量: ${availableProviderCount}`)
  console.log(`  - 是否有多个提供商: ${hasMultipleProviders}`)
  console.log(`  - 是否被排除: ${isExcluded}`)
  console.log(`  - 可启用轮询: ${canEnable}`)
  
  return canEnable
})

// 提取模型名称的辅助函数
function extractModelName(modelId) {
  if (!modelId) return ''
  
  // 如果是轮询模式的格式 (providerId::modelId)，提取modelId部分
  if (modelId.includes('::')) {
    const [, actualModelId] = modelId.split('::')
    return actualModelId.includes('/') ? actualModelId.split('/').pop() : actualModelId
  }
  
  // 普通格式
  return modelId.includes('/') ? modelId.split('/').pop() : modelId
}

// 检测模型类型（文本或图像生成）
function getModelTypeFromValue(modelValue) {
  if (!modelValue) return 'text'

  // 从提供商配置中读取
  const provider = providers.value.find(p => modelValue.startsWith(p.id))
  if (provider) {
    const modelId = modelValue.split('::')[1]
    const modelConfig = provider.models?.find(m => m.id === modelId)
    if (modelConfig?.type) {
      return modelConfig.type
    }
  }

  // 从模型ID推断
  const imageKeywords = ['dall-e', 'dalle', 'stable-diffusion', 'midjourney', 'imagen', 'sd-', 'sdxl']
  if (imageKeywords.some(kw => modelValue.toLowerCase().includes(kw))) {
    return 'image'
  }

  return 'text'
}

// 计算当前模型类型
const currentModelType = computed(() => {
  return getModelTypeFromValue(currentModel.value)
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
    // 保存提供商列表，用于计算重复模型
    providers.value = res.data
    
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
    providers.value = []
    allModels.value = []
  }
}

async function loadSettings() {
  try {
    const res = await axios.get('/api/settings')
    frequency.value = res.data.globalFrequency || 10
    params.value = res.data.defaultParams || { temperature: 0.7, max_tokens: 2000, top_p: 1 }
    userSettings.value = res.data

    // 设置默认提示词
    if (res.data.defaultPromptId) {
      selectedPromptId.value = res.data.defaultPromptId
    }

    // 设置默认风格（支持两种字段名：defaultStyle 或 defaultContentStyle）
    const defaultStyle = res.data.defaultStyle || res.data.defaultContentStyle
    if (defaultStyle) {
      currentStyle.value = defaultStyle
      contentStyleManager.setCurrentStyle(defaultStyle)
    }
  } catch (error) {
    console.error('Error loading settings:', error)
  }
}

async function loadPrompts() {
  try {
    const res = await axios.get('/api/prompts')
    prompts.value = res.data.prompts || []
  } catch (error) {
    console.error('Error loading prompts:', error)
  }
}

// 模型选择器相关方法
function toggleModelDropdown() {
  showModelDropdown.value = !showModelDropdown.value
  if (showModelDropdown.value) {
    nextTick(() => {
      modelSearchInput.value?.focus()
    })
  } else {
    modelSearchQuery.value = ''
  }
}

function selectModel(value) {
  currentModel.value = value
  showModelDropdown.value = false
  modelSearchQuery.value = ''
  onModelChange()
}

function onModelSearch() {
  // 搜索时自动触发过滤，由计算属性 filteredModels 处理
}

// 风格选择器相关方法
function toggleStyleDropdown() {
  showStyleDropdown.value = !showStyleDropdown.value
}

function selectStyle(styleId) {
  currentStyle.value = styleId
  contentStyleManager.setCurrentStyle(styleId)
  showStyleDropdown.value = false
  // 清除渲染缓存，确保使用新风格重新渲染
  renderedCache.clear()
  // 重新渲染所有消息
  messages.value = [...messages.value]
  nextTick(() => {
    throttledScrollToBottom()
  })
}

function getMessageStyleClass(msg) {
  // 只为 assistant 消息应用风格
  if (msg.role === 'assistant') {
    const styleClass = contentStyleManager.getStyleClass(currentStyle.value)
    return styleClass || ''
  }
  return ''
}

// 点击外部关闭下拉框
function handleClickOutside(event) {
  if (modelSelectorRef.value && !modelSelectorRef.value.contains(event.target)) {
    showModelDropdown.value = false
    modelSearchQuery.value = ''
  }
  if (styleSelectorRef.value && !styleSelectorRef.value.contains(event.target)) {
    showStyleDropdown.value = false
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
// 发送锁，防止并发发送
let isSending = ref(false)

async function sendMessage() {
  if (!inputText.value.trim() || !currentModel.value || isSending.value) return

  // 设置发送锁
  isSending.value = true

  try {
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

    // 如果有上传的文件，添加到消息中，并将文件内容添加到消息文本
    if (uploadedFiles.value.length > 0) {
      userMsg.files = uploadedFiles.value.map(f => ({
        name: f.name,
        size: f.size
      }))

      // 构建包含文件内容的完整消息
      let fullContent = userMsg.content
      uploadedFiles.value.forEach(f => {
        fullContent += `\n\n---\n📄 文件: ${f.name}\n\`\`\`\n${f.content}\n\`\`\`\n---`
      })
      userMsg.content = fullContent
    }

    messages.value.push(userMsg)

    if (!currentConv.value.title) {
      currentConv.value.title = inputText.value.slice(0, 30)
    }

    const messageText = inputText.value
    inputText.value = ''

    // 清空已上传的图片和文件
    const sentImages = [...uploadedImages.value]
    uploadedImages.value = []
    uploadedFiles.value = []

    throttledScrollToBottom()

    const assistantMsg = { role: 'assistant', content: '', streaming: true }
    messages.value.push(assistantMsg)

    // 根据模型类型选择参数
    const requestParams = currentModelType.value === 'image' ? imageParams.value : params.value

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages.value.slice(0, -1),
        model: currentModel.value,
        params: requestParams,
        polling: pollingEnabled.value,
        images: sentImages.length > 0 ? sentImages : undefined,
        systemPrompt: selectedPrompt.value ? selectedPrompt.value.content : undefined
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

    const assistantMsg = messages.value[messages.value.length - 1]
    if (assistantMsg && assistantMsg.role === 'assistant') {
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
  } finally {
    // 释放发送锁
    isSending.value = false
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
  } finally {
    // 释放发送锁
    isSending.value = false
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
            throw new Error(json.error.message || json.error)
          }

          // 处理生图响应
          if (json.type === 'image') {
            assistantMsg.messageType = 'image-response'
            assistantMsg.generatedImages = json.images
            assistantMsg.metadata = json.metadata
            assistantMsg.content = '已为您生成图片'
            assistantMsg.streaming = false
            // 强制触发响应式更新
            messages.value = [...messages.value]
            nextTick(() => {
              throttledScrollToBottom()
            })
          }
          // 处理状态消息（生图进度提示）
          else if (json.type === 'status') {
            assistantMsg.content = json.message
            messages.value = [...messages.value]
          }
          // 处理文本响应
          else if (json.choices?.[0]?.delta?.content) {
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

    // 检测消息内容是否包含 Markdown 图片格式（用于处理上游 API 返回的图片）
    const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
    const imageMatches = [...assistantMsg.content.matchAll(markdownImageRegex)]

    if (imageMatches.length > 0) {
      // 提取图片 URL，转换为图片响应格式
      const extractedImages = imageMatches.map(match => ({
        url: match[2],
        alt: match[1] || 'Generated Image'
      }))

      // 过滤出大尺寸图片（512x512 以上），小图标不会被当作生成图片处理
      const largeImages = await filterLargeImages(extractedImages)
      console.log(`[ImageDetect] 检测到 ${extractedImages.length} 张图片，其中 ${largeImages.length} 张为大尺寸图片`)

      if (largeImages.length > 0) {
        // 提取非图片部分的文本（提示词、进度信息等）
        let textContent = assistantMsg.content.replace(markdownImageRegex, '').trim()
        // 清理多余的空行
        textContent = textContent.replace(/\n{3,}/g, '\n\n').trim()

        // 设置为图片响应类型
        assistantMsg.messageType = 'image-response'
        assistantMsg.generatedImages = largeImages
        assistantMsg.textContent = textContent // 保存文本内容用于显示
      }
      // 如果没有大尺寸图片，保持普通消息格式，小图片会以 inline 方式显示
    }

    // 最终渲染时使用缓存
    const cacheKey = `${assistantMsg.role}-${assistantMsg.content}`
    if (!renderedCache.has(cacheKey)) {
      assistantMsg.rendered = marked(assistantMsg.content)
      renderedCache.set(cacheKey, assistantMsg.rendered)
    } else {
      assistantMsg.rendered = renderedCache.get(cacheKey)
    }

    // 强制触发响应式更新，确保消息操作按钮显示
    messages.value = [...messages.value]
    
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
  // 生图响应特殊渲染
  if (msg.messageType === 'image-response' && msg.generatedImages) {
    let html = ''

    // 如果有文本内容，使用正常的 Markdown 渲染（不压缩）
    if (msg.textContent) {
      html += contentStyleManager.processContent(msg.textContent, marked, DOMPurify.sanitize, currentStyle.value)
    }

    // 只对图片部分使用特殊的 grid 布局
    html += '<div class="generated-images-container">'

    msg.generatedImages.forEach((img, idx) => {
      // 使用data属性存储图片URL，通过事件委托处理点击
      html += `
        <div class="generated-image-item">
          <div class="image-preview-wrapper" data-image-url="${DOMPurify.sanitize(img.url)}" style="cursor: pointer;">
            <img src="${img.url}" alt="${img.alt || 'Generated Image ' + (idx + 1)}"
                 class="generated-image-preview" loading="lazy">
            <div class="image-preview-overlay">
              <span class="preview-icon">🔍</span>
              <span class="preview-text">点击查看大图</span>
            </div>
          </div>
          <div class="image-actions">
            <button class="btn-view" data-image-url="${DOMPurify.sanitize(img.url)}">👁️ 查看</button>
            <a href="${img.url}" download="image-${idx + 1}.png"
               class="btn-download">📥 下载</a>
          </div>
          ${img.revisedPrompt ?
            `<p class="revised-prompt">提示词: ${DOMPurify.sanitize(img.revisedPrompt)}</p>` : ''}
        </div>
      `
    })

    html += '</div>'

    // 添加元数据显示
    if (msg.metadata) {
      html += `<div class="image-metadata">
        <small>模型: ${msg.metadata.model || '未知'} |
        尺寸: ${msg.metadata.parameters?.size || '未知'} |
        质量: ${msg.metadata.parameters?.quality || '标准'}</small>
      </div>`
    }

    return html
  }

  if (msg.rendered && !msg.streaming) return msg.rendered

  // 为流式消息实时渲染，但不缓存
  if (msg.streaming) {
    // 使用风格管理器处理内容
    return contentStyleManager.processContent(msg.content, marked, DOMPurify.sanitize, currentStyle.value)
  }

  // 生成缓存键（包含风格ID）
  const cacheKey = `${msg.role}-${msg.content}-${currentStyle.value}`

  // 检查缓存
  if (renderedCache.has(cacheKey)) {
    const rendered = renderedCache.get(cacheKey)
    msg.rendered = rendered
    return rendered
  }

  // 使用风格管理器处理内容
  const rendered = contentStyleManager.processContent(msg.content, marked, DOMPurify.sanitize, currentStyle.value)

  // 缓存大小控制
  if (renderedCache.size >= maxCacheSize) {
    const firstKey = renderedCache.keys().next().value
    renderedCache.delete(firstKey)
  }

  renderedCache.set(cacheKey, rendered)
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

// 复制消息内容
function copyMessage(msg) {
  const text = msg.content || ''
  navigator.clipboard.writeText(text).then(() => {
    console.log('消息已复制到剪贴板')
  }).catch(err => {
    console.error('复制失败:', err)
    alert('复制失败，请手动选择文本复制')
  })
}

// 删除消息
async function deleteMessage(index) {
  if (index < 0 || index >= messages.value.length) return

  const msg = messages.value[index]
  const confirmText = msg.role === 'user' ? '确定要删除这条用户消息吗？' : '确定要删除这条AI回复吗？'

  if (!confirm(confirmText)) return

  // 如果删除的是用户消息，同时删除其后面的AI回复（如果有的话）
  if (msg.role === 'user' && index + 1 < messages.value.length && messages.value[index + 1].role === 'assistant') {
    messages.value.splice(index, 2) // 删除用户消息和AI回复
  } else {
    messages.value.splice(index, 1) // 只删除当前消息
  }

  // 保存对话
  await saveConversation()
}

// 重新生成AI回复
async function regenerateResponse(index) {
  if (index < 0 || index >= messages.value.length) return

  const msg = messages.value[index]
  if (msg.role !== 'assistant') return

  // 检查是否正在发送
  if (isSending.value) {
    alert('当前有消息正在发送，请稍后再试')
    return
  }

  // 设置发送锁
  isSending.value = true

  try {
    // 如果没有当前对话，无法重新生成
    if (!currentConv.value) {
      alert('没有找到当前对话')
      return
    }

    // 删除当前AI回复
    messages.value.splice(index, 1)

    // 获取之前的消息历史（用于重新生成）
    const historyMessages = messages.value.slice(0, index)

    // 如果历史消息为空或最后一条不是用户消息，无法重新生成
    if (historyMessages.length === 0) {
      alert('没有找到可用的历史消息')
      isSending.value = false
      return
    }

    throttledScrollToBottom()

    // 创建新的助手消息
    const assistantMsg = { role: 'assistant', content: '', streaming: true }
    messages.value.push(assistantMsg)

    // 根据模型类型选择参数
    const requestParams = currentModelType.value === 'image' ? imageParams.value : params.value

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: historyMessages,
        model: currentModel.value,
        params: requestParams,
        polling: pollingEnabled.value,
        systemPrompt: selectedPrompt.value ? selectedPrompt.value.content : undefined
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
        if (errorText) {
          errorMessage = errorText
        }
      }

      throw new Error(errorMessage)
    }

    // 处理流式响应
    await processStreamResponse(response, assistantMsg)

  } catch (e) {
    console.error('Regenerate error:', e)

    // 创建详细错误信息
    const errorDetails = createErrorDetails(e, currentModel.value)

    let errorMessage = '重新生成失败'
    if (e.message) {
      errorMessage = e.message
    }

    const assistantMsg = messages.value[messages.value.length - 1]
    if (assistantMsg && assistantMsg.role === 'assistant') {
      assistantMsg.content = `❌ ${errorMessage}`
      assistantMsg.streaming = false
      assistantMsg.error = true
      assistantMsg.errorDetails = errorDetails

      messages.value = [...messages.value]
      nextTick(() => {
        throttledScrollToBottom()
      })
    }
  } finally {
    // 释放发送锁
    isSending.value = false
  }

  // 保存对话
  await saveConversation()
}

// 图片查看器相关函数
function openImageViewer(imageUrl) {
  currentViewImage.value = imageUrl
  imageViewerVisible.value = true
  imageViewerScale.value = 1
  // 禁止body滚动
  document.body.style.overflow = 'hidden'
  // 添加键盘事件监听
  document.addEventListener('keydown', handleViewerKeydown)
}

function closeImageViewer() {
  imageViewerVisible.value = false
  currentViewImage.value = null
  imageViewerScale.value = 1
  // 恢复body滚动
  document.body.style.overflow = ''
  // 移除键盘事件监听
  document.removeEventListener('keydown', handleViewerKeydown)
}

// 处理图片查看器键盘事件
function handleViewerKeydown(e) {
  if (!imageViewerVisible.value) return

  switch (e.key) {
    case 'Escape':
      closeImageViewer()
      break
    case '+':
    case '=':
      zoomIn()
      break
    case '-':
      zoomOut()
      break
    case '0':
      resetZoom()
      break
  }
}

// 处理鼠标滚轮缩放
function handleViewerWheel(e) {
  if (!imageViewerVisible.value) return

  e.preventDefault()
  if (e.deltaY < 0) {
    zoomIn()
  } else {
    zoomOut()
  }
}

function zoomIn() {
  if (imageViewerScale.value < 3) {
    imageViewerScale.value += 0.25
  }
}

function zoomOut() {
  if (imageViewerScale.value > 0.25) {
    imageViewerScale.value -= 0.25
  }
}

function resetZoom() {
  imageViewerScale.value = 1
}

// 处理生成图片的点击事件（事件委托）
function handleGeneratedImageClick(event) {
  // 检查是否点击了图片元素
  const imgElement = event.target.closest('img')
  if (imgElement && imgElement.src) {
    // 确保图片在消息内容中
    const messageContent = imgElement.closest('.message-content')
    if (messageContent) {
      openImageViewer(imgElement.src)
      return
    }
  }

  // 兼容旧的 data-image-url 方式
  const target = event.target.closest('[data-image-url]')
  if (target) {
    const imageUrl = target.getAttribute('data-image-url')
    if (imageUrl) {
      openImageViewer(imageUrl)
    }
  }
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

// 检测图片尺寸的辅助函数
function getImageSize(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      // 如果加载失败，返回 0x0，不会被当作生成图片
      resolve({ width: 0, height: 0 })
    }
    img.src = url
  })
}

// 检测并过滤大尺寸图片（只有 512x512 以上的才被视为生成图片）
async function filterLargeImages(images) {
  const MIN_SIZE = 512
  const results = await Promise.all(
    images.map(async (img) => {
      const size = await getImageSize(img.url)
      return {
        ...img,
        isLarge: size.width >= MIN_SIZE && size.height >= MIN_SIZE
      }
    })
  )
  return results.filter(img => img.isLarge)
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

// 处理文件上传
function handleFileUpload(event) {
  const files = event.target.files
  if (!files || files.length === 0) return
  
  Array.from(files).forEach(file => {
    // 检查文件大小，限制为1MB
    const maxSize = 1 * 1024 * 1024 // 1MB
    if (file.size > maxSize) {
      alert(`文件过大，请选择小于1MB的文件。当前文件大小：${formatFileSize(file.size)}`)
      return
    }
    
    // 检查文件类型是否为文本类型
    const ext = '.' + file.name.split('.').pop().toLowerCase()
    if (!supportedFileTypes.includes(ext)) {
      alert(`不支持的文件类型: ${ext}\n支持的类型: ${supportedFileTypes}`)
      return
    }
    
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target.result
      
      // 检查内容是否为有效的文本
      if (typeof content !== 'string') {
        alert('无法读取文件内容，请确保文件为文本格式')
        return
      }
      
      uploadedFiles.value.push({
        name: file.name,
        size: file.size,
        content: content
      })
      
      console.log(`文件上传成功: ${file.name}, 大小: ${formatFileSize(file.size)}`)
    }
    
    reader.onerror = () => {
      alert(`读取文件失败: ${file.name}`)
    }
    
    reader.readAsText(file)
  })
  
  // 清空input，允许重复选择同一文件
  event.target.value = ''
}

// 删除文件
function removeFile(index) {
  uploadedFiles.value.splice(index, 1)
}

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 轮询开关切换处理
function onPollingToggle() {
  if (!canEnablePolling.value && pollingEnabled.value) {
    // 如果当前模型不支持轮询但用户尝试启用，强制关闭并提示
    pollingEnabled.value = false
    alert('当前模型在可用池中没有重复的提供商，无法启用轮询模式')
  }
}

// 监听模型变化，自动关闭不支持轮询的模型的轮询开关
function onModelChange() {
  if (!canEnablePolling.value && pollingEnabled.value) {
    pollingEnabled.value = false
    console.log('模型切换后自动关闭轮询模式，因为当前模型不支持轮询')
  }
}

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

// 处理粘贴事件
function handlePaste(event) {
  const clipboardData = event.clipboardData || window.clipboardData
  if (!clipboardData) return

  const items = clipboardData.items
  if (!items) return

  let hasImage = false

  for (let i = 0; i < items.length; i++) {
    const item = items[i]

    if (item.type.indexOf('image') !== -1) {
      hasImage = true
      event.preventDefault()

      const file = item.getAsFile()
      if (!file) continue

      const maxSize = 5 * 1024 * 1024
      if (file.size > maxSize) {
        alert(`图片文件过大，请选择小于5MB的图片。当前文件大小：${(file.size / 1024 / 1024).toFixed(2)}MB`)
        continue
      }

      const fileName = file.name || `pasted-image-${Date.now()}.png`

      const reader = new FileReader()
      reader.onload = (e) => {
        compressImage(e.target.result, fileName, (compressedDataUrl) => {
          uploadedImages.value.push({
            name: fileName,
            dataUrl: compressedDataUrl,
            file: file
          })
        })
      }

      reader.onerror = () => {
        alert(`读取图片失败: ${fileName}`)
      }

      reader.readAsDataURL(file)
    }
  }
}

onMounted(() => {
  loadConversations()
  loadProviders()
  loadSettings()
  loadPrompts()

  // 添加点击外部关闭下拉框的事件监听
  document.addEventListener('click', handleClickOutside)

  // 添加消息容器的点击事件监听（用于处理生成图片的点击）
  if (messagesContainer.value) {
    messagesContainer.value.addEventListener('click', handleGeneratedImageClick)
  }

  // 注册全局图片查看器函数（保留以防其他地方使用）
  window.openImageViewer = openImageViewer
})

onUnmounted(() => {
  // 清理事件监听器
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleViewerKeydown)

  // 清理消息容器的点击事件监听
  if (messagesContainer.value) {
    messagesContainer.value.removeEventListener('click', handleGeneratedImageClick)
  }

  // 清理全局函数
  delete window.openImageViewer

  // 恢复body滚动
  document.body.style.overflow = ''
})
</script>
