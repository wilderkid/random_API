<template>
  <div class="logs-page">
    <h2>系统日志</h2>
    
    <div class="logs-toolbar">
      <div class="date-range">
        <label>开始日期：</label>
        <input v-model="startDate" type="date" class="input-field" @change="loadLogs">
        <label>结束日期：</label>
        <input v-model="endDate" type="date" class="input-field" @change="loadLogs">
        <span class="hint">（最多查询7天）</span>
      </div>
      <div class="toolbar-actions">
        <button @click="loadLogs" class="btn-action">刷新</button>
        <button @click="loadToday" class="btn-action btn-today">今日</button>
        <button @click="showDeleteDialog" class="btn-action btn-delete" :disabled="!startDate || !endDate">清除日志</button>
      </div>
    </div>
    
    <div v-if="loading" class="loading">加载中...</div>
    
    <div v-else-if="error" class="error-message">{{ error }}</div>
    
    <div v-else class="logs-content">
      <!-- 统计概览 -->
      <div class="stats-overview">
        <div class="stat-card">
          <div class="stat-label">总调用次数</div>
          <div class="stat-value">{{ stats.totalApiCalls }}</div>
        </div>
        <div class="stat-card success">
          <div class="stat-label">成功次数</div>
          <div class="stat-value">{{ stats.successfulCalls }}</div>
        </div>
        <div class="stat-card failed">
          <div class="stat-label">失败次数</div>
          <div class="stat-value">{{ stats.failedCalls }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">成功率</div>
          <div class="stat-value">{{ successRate }}%</div>
        </div>
      </div>
      
      <!-- 供应商统计 -->
      <div class="provider-stats">
        <h3>供应商调用统计</h3>
        <div v-if="Object.keys(stats.providerStats).length === 0" class="no-data">
          暂无数据
        </div>
        <div v-else class="provider-list">
          <div 
            v-for="(providerData, providerName) in stats.providerStats" 
            :key="providerName"
            class="provider-item"
          >
            <div class="provider-header" @click="toggleProvider(providerName)">
              <span class="toggle-icon">{{ expandedProviders[providerName] ? '▼' : '▶' }}</span>
              <span class="provider-name">{{ providerName }}</span>
              <div class="provider-summary">
                <span class="total">总计: {{ providerData.total }}</span>
                <span class="success">成功: {{ providerData.success }}</span>
                <span class="failed" v-if="providerData.failed > 0">失败: {{ providerData.failed }}</span>
              </div>
            </div>
            
            <!-- 模型详情 -->
            <div v-if="expandedProviders[providerName]" class="model-details">
              <div 
                v-for="(modelData, modelName) in providerData.models" 
                :key="modelName"
                class="model-item"
              >
                <span class="model-name">{{ modelName }}</span>
                <div class="model-stats">
                  <span class="total">总计: {{ modelData.total }}</span>
                  <span class="success">成功: {{ modelData.success }}</span>
                  <span class="failed" v-if="modelData.failed > 0">失败: {{ modelData.failed }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 失败统计 -->
      <div v-if="stats.failedCalls > 0" class="failure-stats">
        <h3>失败详情</h3>
        <div class="failure-list">
          <div
            v-for="(providerData, providerName) in failedProviders"
            :key="providerName"
            class="failure-provider"
          >
            <div class="failure-provider-header" @click="toggleFailureProvider(providerName)">
              <span class="toggle-icon">{{ expandedFailures[providerName] ? '▼' : '▶' }}</span>
              <span class="provider-name">{{ providerName }}</span>
              <span class="failed-count">失败: {{ providerData.failed }}</span>
            </div>
            <div v-if="expandedFailures[providerName]" class="failure-models">
              <template v-for="(modelData, modelName) in providerData.models">
                <div v-if="modelData.failed > 0" :key="modelName" class="failure-model-section">
                  <div class="failure-model-header" @click="toggleFailureModel(providerName, modelName)">
                    <span class="toggle-icon-small">{{ expandedFailureModels[`${providerName}-${modelName}`] ? '▼' : '▶' }}</span>
                    <span class="model-name">{{ modelName }}</span>
                    <span class="failed-count">{{ modelData.failed }} 次</span>
                  </div>
                  
                  <!-- 错误详情列表 -->
                  <div v-if="expandedFailureModels[`${providerName}-${modelName}`] && modelData.errors && modelData.errors.length > 0" class="error-details">
                    <div v-for="(error, index) in modelData.errors" :key="index" class="error-item">
                      <div class="error-timestamp">{{ error.timestamp }}</div>
                      <div class="error-message">{{ error.message || '未知错误' }}</div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 删除确认对话框 -->
    <div v-if="deleteDialog.show" class="dialog-overlay" @click="closeDeleteDialog">
      <div class="dialog-box" @click.stop>
        <h3>确认删除日志</h3>
        <p class="dialog-message">
          确定要删除 <strong>{{ startDate }}</strong> 到 <strong>{{ endDate }}</strong> 的日志吗？
        </p>
        <p class="dialog-warning">此操作不可恢复！</p>
        <div class="dialog-actions">
          <button @click="closeDeleteDialog" class="btn-cancel">取消</button>
          <button @click="confirmDelete" class="btn-confirm-delete" :disabled="deleteDialog.deleting">
            {{ deleteDialog.deleting ? '删除中...' : '确认删除' }}
          </button>
        </div>
      </div>
    </div>
    
    <!-- 清空所有日志确认对话框 -->
    <div v-if="clearAllDialog.show" class="dialog-overlay" @click="closeClearAllDialog">
      <div class="dialog-box" @click.stop>
        <h3>确认清空所有日志</h3>
        <p class="dialog-message">
          确定要清空<strong>所有日志文件</strong>吗？
        </p>
        <p class="dialog-warning">此操作将删除所有历史日志，不可恢复！</p>
        <div class="dialog-actions">
          <button @click="closeClearAllDialog" class="btn-cancel">取消</button>
          <button @click="confirmClearAll" class="btn-confirm-delete" :disabled="clearAllDialog.deleting">
            {{ clearAllDialog.deleting ? '删除中...' : '确认清空' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'

// 使用相对路径，自动适配当前域名和端口
const API_BASE = window.location.origin

const startDate = ref('')
const endDate = ref('')
const loading = ref(false)
const error = ref('')
const stats = ref({
  totalApiCalls: 0,
  successfulCalls: 0,
  failedCalls: 0,
  providerStats: {}
})

const expandedProviders = ref({})
const expandedFailures = ref({})
const expandedFailureModels = ref({})

const deleteDialog = ref({
  show: false,
  deleting: false
})

const clearAllDialog = ref({
  show: false,
  deleting: false
})

// 计算成功率
const successRate = computed(() => {
  if (stats.value.totalApiCalls === 0) return 0
  return ((stats.value.successfulCalls / stats.value.totalApiCalls) * 100).toFixed(1)
})

// 获取有失败记录的供应商
const failedProviders = computed(() => {
  const failed = {}
  for (const [providerName, providerData] of Object.entries(stats.value.providerStats)) {
    if (providerData.failed > 0) {
      failed[providerName] = providerData
    }
  }
  return failed
})

// 切换供应商展开/收起
function toggleProvider(providerName) {
  expandedProviders.value[providerName] = !expandedProviders.value[providerName]
}

// 切换失败供应商展开/收起
function toggleFailureProvider(providerName) {
  expandedFailures.value[providerName] = !expandedFailures.value[providerName]
}

// 切换失败模型展开/收起
function toggleFailureModel(providerName, modelName) {
  const key = `${providerName}-${modelName}`
  expandedFailureModels.value[key] = !expandedFailureModels.value[key]
}

// 加载今日日志
function loadToday() {
  const today = new Date().toISOString().split('T')[0]
  startDate.value = today
  endDate.value = today
  loadLogs()
}

// 加载日志
async function loadLogs() {
  loading.value = true
  error.value = ''
  
  try {
    const params = {}
    if (startDate.value) params.startDate = startDate.value
    if (endDate.value) params.endDate = endDate.value
    
    const response = await axios.get(`${API_BASE}/api/logs/stats`, { params })
    stats.value = response.data.stats
    
    // 默认展开所有供应商
    expandedProviders.value = {}
    for (const providerName of Object.keys(stats.value.providerStats)) {
      expandedProviders.value[providerName] = true
    }
    
    // 默认展开所有失败供应商
    expandedFailures.value = {}
    for (const providerName of Object.keys(failedProviders.value)) {
      expandedFailures.value[providerName] = true
    }
    
    // 默认不展开失败模型的错误详情
    expandedFailureModels.value = {}
  } catch (err) {
    error.value = err.response?.data?.error || err.message || '加载日志失败'
    console.error('Error loading logs:', err)
  } finally {
    loading.value = false
  }
}

// 显示删除对话框
function showDeleteDialog() {
  if (!startDate.value || !endDate.value) {
    alert('请先选择日期范围')
    return
  }
  deleteDialog.value.show = true
}

// 关闭删除对话框
function closeDeleteDialog() {
  if (!deleteDialog.value.deleting) {
    deleteDialog.value.show = false
  }
}

// 确认删除日志
async function confirmDelete() {
  deleteDialog.value.deleting = true
  
  try {
    const response = await axios.delete(`${API_BASE}/api/logs`, {
      params: {
        startDate: startDate.value,
        endDate: endDate.value
      }
    })
    
    if (response.data.success) {
      alert(`成功删除 ${response.data.deletedCount} 个日志文件`)
      deleteDialog.value.show = false
      // 重新加载日志
      await loadLogs()
    }
  } catch (err) {
    alert('删除日志失败: ' + (err.response?.data?.error || err.message))
  } finally {
    deleteDialog.value.deleting = false
  }
}

// 显示清空所有日志对话框
function showClearAllDialog() {
  clearAllDialog.value.show = true
}

// 关闭清空所有日志对话框
function closeClearAllDialog() {
  if (!clearAllDialog.value.deleting) {
    clearAllDialog.value.show = false
  }
}

// 确认清空所有日志
async function confirmClearAll() {
  clearAllDialog.value.deleting = true
  
  try {
    const response = await axios.delete(`${API_BASE}/api/logs/all`)
    
    if (response.data.success) {
      alert(`成功清空 ${response.data.deletedCount} 个日志文件`)
      clearAllDialog.value.show = false
      // 重新加载日志
      await loadLogs()
    }
  } catch (err) {
    alert('清空日志失败: ' + (err.response?.data?.error || err.message))
  } finally {
    clearAllDialog.value.deleting = false
  }
}

onMounted(() => {
  loadToday()
})
</script>

<style scoped>
.logs-page {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

h2 {
  margin-bottom: 20px;
  color: #333;
}

h3 {
  margin: 20px 0 10px 0;
  color: #555;
  font-size: 18px;
}

.logs-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding: 15px;
  background: #f5f5f5;
  border-radius: 8px;
  flex-wrap: wrap;
  gap: 15px;
}

.date-range {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.date-range label {
  font-weight: 500;
  color: #555;
}

.hint {
  color: #999;
  font-size: 12px;
  margin-left: 10px;
}

.toolbar-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.input-field {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.btn-action {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.3s;
  white-space: nowrap;
  background: #4CAF50;
  color: white;
  min-width: 80px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.btn-action:hover {
  background: #45a049;
}

.btn-action.btn-today {
  background: #2196F3;
}

.btn-action.btn-today:hover {
  background: #0b7dda;
}

.btn-action.btn-delete {
  background: #f44336;
}

.btn-action.btn-delete:hover:not(:disabled) {
  background: #d32f2f;
}

.btn-action:disabled {
  background: #ccc;
  cursor: not-allowed;
  opacity: 0.6;
}

.loading {
  text-align: center;
  padding: 40px;
  color: #666;
  font-size: 16px;
}

.error-message {
  padding: 15px;
  background: #ffebee;
  color: #c62828;
  border-radius: 4px;
  margin-bottom: 20px;
}

.logs-content {
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

/* 统计概览 */
.stats-overview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
  margin-bottom: 30px;
}

.stat-card {
  padding: 20px;
  background: #f8f9fa;
  border-radius: 8px;
  border-left: 4px solid #2196F3;
}

.stat-card.success {
  border-left-color: #4CAF50;
}

.stat-card.failed {
  border-left-color: #f44336;
}

.stat-label {
  font-size: 14px;
  color: #666;
  margin-bottom: 8px;
}

.stat-value {
  font-size: 28px;
  font-weight: bold;
  color: #333;
}

/* 供应商统计 */
.provider-stats {
  margin-bottom: 30px;
}

.no-data {
  text-align: center;
  padding: 40px;
  color: #999;
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.provider-item {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  overflow: hidden;
}

.provider-header {
  display: flex;
  align-items: center;
  padding: 15px;
  background: #fafafa;
  cursor: pointer;
  transition: background-color 0.2s;
  flex-wrap: wrap;
  gap: 10px;
}

.provider-header:hover {
  background: #f0f0f0;
}

.toggle-icon {
  margin-right: 10px;
  color: #666;
  font-size: 12px;
}

.provider-name {
  font-weight: 600;
  color: #333;
  flex: 1;
}

.provider-summary {
  display: flex;
  gap: 15px;
  font-size: 14px;
  flex-wrap: wrap;
}

.provider-summary .total {
  color: #666;
}

.provider-summary .success {
  color: #4CAF50;
  font-weight: 500;
}

.provider-summary .failed {
  color: #f44336;
  font-weight: 500;
}

.model-details {
  padding: 10px 15px 15px 45px;
  background: white;
}

.model-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  border-bottom: 1px solid #f0f0f0;
  flex-wrap: wrap;
  gap: 10px;
}

.model-item:last-child {
  border-bottom: none;
}

.model-name {
  color: #555;
  font-family: monospace;
}

.model-stats {
  display: flex;
  gap: 15px;
  font-size: 13px;
  flex-wrap: wrap;
}

.model-stats .total {
  color: #666;
}

.model-stats .success {
  color: #4CAF50;
}

.model-stats .failed {
  color: #f44336;
}

/* 失败统计 */
.failure-stats {
  margin-top: 30px;
  padding-top: 30px;
  border-top: 2px solid #f0f0f0;
}

.failure-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.failure-provider {
  border: 1px solid #ffcdd2;
  border-radius: 6px;
  background: #ffebee;
  overflow: hidden;
}

.failure-provider-header {
  display: flex;
  align-items: center;
  padding: 12px 15px;
  background: #ffcdd2;
  cursor: pointer;
  transition: background-color 0.2s;
  flex-wrap: wrap;
  gap: 10px;
}

.failure-provider-header:hover {
  background: #ef9a9a;
}

.failure-provider-header .toggle-icon {
  margin-right: 10px;
  color: #c62828;
  font-size: 12px;
}

.failure-provider-header .provider-name {
  font-weight: 600;
  color: #c62828;
  flex: 1;
}

.failed-count {
  color: #c62828;
  font-weight: 500;
}

.failure-models {
  padding: 10px 15px 15px 15px;
}

.failure-model-section {
  margin-bottom: 10px;
  background: white;
  border-radius: 4px;
  overflow: hidden;
}

.failure-model-section:last-child {
  margin-bottom: 0;
}

.failure-model-header {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  cursor: pointer;
  transition: background-color 0.2s;
  border-bottom: 1px solid #f0f0f0;
  flex-wrap: wrap;
  gap: 8px;
}

.failure-model-header:hover {
  background: #f5f5f5;
}

.toggle-icon-small {
  margin-right: 8px;
  color: #999;
  font-size: 10px;
}

.failure-model-header .model-name {
  color: #666;
  font-family: monospace;
  flex: 1;
}

.failure-model-header .failed-count {
  color: #f44336;
  font-size: 13px;
}

.error-details {
  padding: 10px 12px;
  background: #fafafa;
}

.error-item {
  padding: 8px 10px;
  margin-bottom: 8px;
  background: white;
  border-left: 3px solid #f44336;
  border-radius: 3px;
}

.error-item:last-child {
  margin-bottom: 0;
}

.error-timestamp {
  font-size: 11px;
  color: #999;
  margin-bottom: 4px;
  font-family: monospace;
}

.error-message {
  font-size: 13px;
  color: #d32f2f;
  word-break: break-word;
  line-height: 1.4;
}

/* 对话框样式 */
.dialog-overlay {
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

.dialog-box {
  background: white;
  border-radius: 8px;
  padding: 24px;
  max-width: 500px;
  width: 90%;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.dialog-box h3 {
  margin: 0 0 16px 0;
  color: #333;
  font-size: 20px;
}

.dialog-message {
  margin: 0 0 12px 0;
  color: #666;
  font-size: 15px;
  line-height: 1.5;
}

.dialog-warning {
  margin: 0 0 20px 0;
  color: #f44336;
  font-size: 14px;
  font-weight: 500;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.btn-cancel {
  padding: 8px 20px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  color: #666;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.3s;
}

.btn-cancel:hover {
  background: #f5f5f5;
  border-color: #999;
}

.btn-confirm-delete {
  padding: 8px 20px;
  border: none;
  border-radius: 4px;
  background: #f44336;
  color: white;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.3s;
}

.btn-confirm-delete:hover:not(:disabled) {
  background: #d32f2f;
}

.btn-confirm-delete:disabled {
  background: #ccc;
  cursor: not-allowed;
}
</style>
