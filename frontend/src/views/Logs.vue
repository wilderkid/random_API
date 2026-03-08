<template>
  <div class="logs-page">
    <h2>系统日志</h2>

    <!-- 工具栏 -->
    <div class="logs-toolbar">
      <div class="toolbar-left">
        <div class="date-range">
          <label>开始日期：</label>
          <input v-model="filters.startDate" type="date" class="input-field" @change="onDateChange">
          <label>结束日期：</label>
          <input v-model="filters.endDate" type="date" class="input-field" @change="onDateChange">
          <span class="hint">（最多查询7天）</span>
        </div>

        <div class="filters-row">
          <!-- 日志级别筛选 -->
          <div class="filter-group">
            <label>级别：</label>
            <SearchableSelect
              v-model="filters.level"
              :options="logLevelOptions"
              class="input-field select-field"
              placeholder="全部"
              search-placeholder="搜索日志级别..."
              @change="applyFilters"
            />
          </div>

          <!-- 日志类型筛选 -->
          <div class="filter-group">
            <label>类型：</label>
            <SearchableSelect
              v-model="filters.type"
              :options="logTypeOptions"
              class="input-field select-field"
              placeholder="全部"
              search-placeholder="搜索日志类型..."
              @change="applyFilters"
            />
          </div>

          <!-- 搜索框 -->
          <div class="filter-group search-group">
            <input
              v-model="filters.keyword"
              type="text"
              class="input-field search-input"
              placeholder="搜索关键词..."
              @keyup.enter="applyFilters"
            >
            <button @click="applyFilters" class="btn-search">搜索</button>
          </div>

          <!-- 实时监控开关 -->
          <div class="filter-group realtime-group">
            <label class="realtime-toggle">
              <input type="checkbox" v-model="isRealtimeEnabled" @change="toggleRealtime">
              <span>实时监控</span>
            </label>
          </div>
        </div>
      </div>

      <div class="toolbar-actions">
        <button @click="applyFilters" class="btn-action">刷新</button>
        <button @click="loadToday" class="btn-action btn-today">今日</button>
        <button @click="loadRecent7Days" class="btn-action btn-recent">最近七天</button>
        <button @click="exportLogs('json')" class="btn-action btn-export">导出JSON</button>
        <button @click="exportLogs('csv')" class="btn-action btn-export">导出CSV</button>
        <button @click="showDeleteOldLogsDialog" class="btn-action btn-delete-old">删除七天前</button>
        <button @click="showDeleteDialog" class="btn-action btn-delete" :disabled="!canDelete">清除日志</button>
      </div>
    </div>

    <!-- 统计概览 -->
    <div class="stats-overview">
      <div class="stat-card">
        <div class="stat-label">总日志数</div>
        <div class="stat-value">{{ pagination.total }}</div>
      </div>
      <div class="stat-card success">
        <div class="stat-label">INFO</div>
        <div class="stat-value">{{ stats.levelStats?.INFO || 0 }}</div>
      </div>
      <div class="stat-card warning">
        <div class="stat-label">WARN</div>
        <div class="stat-value">{{ stats.levelStats?.WARN || 0 }}</div>
      </div>
      <div class="stat-card failed">
        <div class="stat-label">ERROR</div>
        <div class="stat-value">{{ stats.levelStats?.ERROR || 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">DEBUG</div>
        <div class="stat-value">{{ stats.levelStats?.DEBUG || 0 }}</div>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading && !logs.length" class="loading">加载中...</div>
    <div v-else-if="error" class="error-message">{{ error }}</div>

    <!-- 日志列表 -->
    <div v-else class="logs-content">
      <div v-if="logs.length === 0" class="no-data">暂无日志数据</div>

      <div v-else class="logs-list">
        <div
          v-for="log in logs"
          :key="log.timestamp + log.traceId"
          class="log-entry"
          :class="getLogLevelClass(log.level)"
        >
          <div class="log-header" @click="toggleLogDetail(log)">
            <span :class="['log-badge', `level-${log.level.toLowerCase()}`]">{{ log.level }}</span>
            <span :class="['log-badge', `type-${log.type.toLowerCase()}`]">{{ log.type }}</span>
            <span class="log-time">{{ formatTime(log.timestamp) }}</span>
            <span class="log-message-short">{{ getShortMessage(log.message) }}</span>
            <span class="toggle-icon">{{ expandedLogs.has(log.traceId) ? '▼' : '▶' }}</span>
          </div>

          <!-- 日志详情 -->
          <div v-if="expandedLogs.has(log.traceId)" class="log-detail">
            <div class="detail-row">
              <span class="detail-label">时间：</span>
              <span class="detail-value">{{ log.timestamp }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">级别：</span>
              <span class="detail-value">{{ log.level }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">类型：</span>
              <span class="detail-value">{{ log.type }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">消息：</span>
              <span class="detail-value">{{ log.message }}</span>
            </div>
            <div v-if="log.userId" class="detail-row">
              <span class="detail-label">用户ID：</span>
              <span class="detail-value">{{ log.userId }}</span>
            </div>
            <div v-if="log.traceId" class="detail-row">
              <span class="detail-label">追踪ID：</span>
              <span class="detail-value trace-id">{{ log.traceId }}</span>
            </div>

            <div v-if="getErrorSummary(log)" class="error-summary-card">
              <div class="error-summary-header">错误摘要</div>
              <div class="error-summary-message">{{ getErrorSummary(log) }}</div>
              <div class="error-summary-meta">
                <span v-if="getStatusCode(log)" class="error-chip">HTTP {{ getStatusCode(log) }}</span>
                <span v-if="getErrorCode(log)" class="error-chip">{{ getErrorCode(log) }}</span>
                <span v-if="getProviderName(log)" class="error-chip">{{ getProviderName(log) }}</span>
                <span v-if="getModelName(log)" class="error-chip">{{ getModelName(log) }}</span>
              </div>
            </div>

            <div v-if="getRequestInfo(log)" class="detail-row">
              <span class="detail-label">请求：</span>
              <div class="detail-value detail-stack">
                <span v-if="getRequestInfo(log).method">方法: {{ getRequestInfo(log).method }}</span>
                <span v-if="getRequestInfo(log).url">地址: {{ getRequestInfo(log).url }}</span>
                <span v-if="getRequestInfo(log).timeout">超时: {{ getRequestInfo(log).timeout }}ms</span>
              </div>
            </div>

            <div v-if="getResponseData(log)" class="detail-row detail-row-block">
              <span class="detail-label">响应详情：</span>
              <pre class="detail-json detail-json-error">{{ formatJson(getResponseData(log)) }}</pre>
            </div>

            <div v-if="log.metadata && Object.keys(log.metadata).length > 0" class="detail-row detail-row-block">
              <span class="detail-label">元数据：</span>
              <pre class="detail-json">{{ formatJson(log.metadata) }}</pre>
            </div>

            <div v-if="log.data && Object.keys(log.data).length > 0" class="detail-row detail-row-block">
              <span class="detail-label">完整数据：</span>
              <pre class="detail-json">{{ formatJson(log.data) }}</pre>
            </div>
          </div>
        </div>
      </div>

      <!-- 分页控制 -->
      <div v-if="pagination.total > 0" class="pagination">
        <div class="pagination-left">
          <label class="page-size-label">每页显示：</label>
          <SearchableSelect
            v-model="pagination.limit"
            :options="pageSizeSelectOptions"
            class="page-size-select"
            placeholder="选择每页条数"
            search-placeholder="搜索分页条数..."
            @change="onPageSizeChange"
          />
        </div>
        <div class="pagination-controls">
          <button
            @click="goToPage(0)"
            class="btn-page"
            :disabled="pagination.offset === 0"
          >首页</button>
          <button
            @click="prevPage"
            class="btn-page"
            :disabled="pagination.offset === 0"
          >上一页</button>
          <span class="page-info">
            {{ pagination.offset + 1 }} - {{ Math.min(pagination.offset + pagination.limit, pagination.total) }}
            / {{ pagination.total }}
          </span>
          <button
            @click="nextPage"
            class="btn-page"
            :disabled="!pagination.hasMore"
          >下一页</button>
        </div>
      </div>
    </div>

    <!-- 删除确认对话框 -->
    <div v-if="deleteDialog.show" class="dialog-overlay" @click="closeDeleteDialog">
      <div class="dialog-box" @click.stop>
        <h3>确认删除日志</h3>
        <p class="dialog-message">
          确定要删除 <strong>{{ filters.startDate }}</strong> 到 <strong>{{ filters.endDate }}</strong> 的日志吗？
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

    <!-- 删除7天前日志对话框 -->
    <div v-if="deleteOldLogsDialog.show" class="dialog-overlay" @click="closeDeleteOldLogsDialog">
      <div class="dialog-box" @click.stop>
        <h3>清理旧日志</h3>
        <p class="dialog-message">
          确定要删除 <strong>{{ deleteOldLogsDialog.startDate }}</strong> 到 <strong>{{ deleteOldLogsDialog.endDate }}</strong> 的所有日志吗？
        </p>
        <p class="dialog-info">此操作将删除7天前的所有日志，仅保留最近7天的日志。</p>
        <p class="dialog-warning">此操作不可恢复！</p>
        <div class="dialog-actions">
          <button @click="closeDeleteOldLogsDialog" class="btn-cancel">取消</button>
          <button @click="confirmDeleteOldLogs" class="btn-confirm-delete" :disabled="deleteOldLogsDialog.deleting">
            {{ deleteOldLogsDialog.deleting ? '删除中...' : '确认删除' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import axios from 'axios'
import SearchableSelect from '../components/SearchableSelect.vue'

const API_BASE = window.location.origin

// 日志级别定义
const logLevels = [
  { value: 'DEBUG', label: 'DEBUG' },
  { value: 'INFO', label: 'INFO' },
  { value: 'WARN', label: 'WARN' },
  { value: 'ERROR', label: 'ERROR' },
  { value: 'CRITICAL', label: 'CRITICAL' }
]

// 日志类型定义
const logTypes = [
  { value: 'API_CALL', label: 'API调用' },
  { value: 'SYSTEM', label: '系统' },
  { value: 'USER_ACTION', label: '用户操作' },
  { value: 'AUTH', label: '认证' },
  { value: 'DATABASE', label: '数据库' },
  { value: 'PERFORMANCE', label: '性能' },
  { value: 'SECURITY', label: '安全' }
]

// 状态
const loading = ref(false)
const error = ref('')
const logs = ref([])
const stats = ref({
  totalApiCalls: 0,
  successfulCalls: 0,
  failedCalls: 0,
  providerStats: {},
  levelStats: {},
  typeStats: {}
})

// 筛选条件
const filters = ref({
  startDate: '',
  endDate: '',
  level: '',
  type: '',
  keyword: ''
})

// 分页
const pagination = ref({
  total: 0,
  limit: 10,
  offset: 0,
  hasMore: false
})

// 每页显示条目数选项
const pageSizeOptions = [10, 20, 50, 100]

// 展开的日志详情
const expandedLogs = ref(new Set())
const formattedJsonCache = new Map()
const MAX_EXPANDED_LOGS = 3

// 实时监控
const isRealtimeEnabled = ref(false)
const eventSource = ref(null)

// 对话框
const deleteDialog = ref({
  show: false,
  deleting: false
})

const deleteOldLogsDialog = ref({
  show: false,
  deleting: false,
  startDate: '',
  endDate: ''
})

// 计算属性
const logLevelOptions = computed(() => [
  { label: '全部', value: '' },
  ...logLevels.map(level => ({ label: level.label, value: level.value }))
])

const logTypeOptions = computed(() => [
  { label: '全部', value: '' },
  ...logTypes.map(type => ({ label: type.label, value: type.value }))
])

const pageSizeSelectOptions = computed(() =>
  pageSizeOptions.map(size => ({ label: `${size} 条`, value: size }))
)

const canDelete = computed(() => {
  return filters.value.startDate && filters.value.endDate
})

// 初始化日期范围
function initDateRange() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const today = `${year}-${month}-${day}`
  filters.value.startDate = today
  filters.value.endDate = today
}

// 日期变化时重置分页
function onDateChange() {
  pagination.value.offset = 0
  applyFilters()
}

// 应用筛选条件
async function applyFilters() {
  pagination.value.offset = 0
  await loadLogs()
}

// 加载今日日志
async function loadToday() {
  initDateRange()
  await applyFilters()
}

// 加载最近七天日志
async function loadRecent7Days() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const today = `${year}-${month}-${day}`

  // 计算7天前的日期
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(now.getDate() - 6)  // 今天+往前6天=共7天
  const pastYear = sevenDaysAgo.getFullYear()
  const pastMonth = String(sevenDaysAgo.getMonth() + 1).padStart(2, '0')
  const pastDay = String(sevenDaysAgo.getDate()).padStart(2, '0')
  const startDate = `${pastYear}-${pastMonth}-${pastDay}`

  filters.value.startDate = startDate
  filters.value.endDate = today
  await applyFilters()
}

// 加载日志数据
async function loadLogs() {
  if (!filters.value.startDate || !filters.value.endDate) {
    error.value = '请选择日期范围'
    return
  }

  loading.value = true
  error.value = ''

  try {
    const params = {
      startDate: filters.value.startDate,
      endDate: filters.value.endDate,
      limit: pagination.value.limit,
      offset: pagination.value.offset
    }

    if (filters.value.level) params.level = filters.value.level
    if (filters.value.type) params.type = filters.value.type
    if (filters.value.keyword) params.keyword = filters.value.keyword

    const response = await axios.get(`${API_BASE}/api/logs`, { params })

    logs.value = response.data.logs
    formattedJsonCache.clear()
    pagination.value = response.data.pagination
    pagination.value.total = response.data.pagination.total

    // 同时加载统计数据
    await loadStats()
  } catch (err) {
    error.value = err.response?.data?.error || err.message || '加载日志失败'
    console.error('Error loading logs:', err)
  } finally {
    loading.value = false
  }
}

// 加载统计数据
async function loadStats() {
  try {
    const params = {
      startDate: filters.value.startDate,
      endDate: filters.value.endDate
    }

    const response = await axios.get(`${API_BASE}/api/logs/stats`, { params })
    stats.value = response.data.stats
  } catch (err) {
    console.error('Error loading stats:', err)
  }
}

// 切换日志详情展开/收起
function toggleLogDetail(log) {
  if (expandedLogs.value.has(log.traceId)) {
    expandedLogs.value.delete(log.traceId)
  } else {
    if (expandedLogs.value.size >= MAX_EXPANDED_LOGS) {
      const firstExpanded = expandedLogs.value.values().next().value
      if (firstExpanded) {
        expandedLogs.value.delete(firstExpanded)
      }
    }
    expandedLogs.value.add(log.traceId)
  }
}

// 获取日志级别对应的样式类
function getLogLevelClass(level) {
  return `log-level-${level.toLowerCase()}`
}

// 获取短消息
function getShortMessage(message) {
  if (!message) return ''
  return message.length > 80 ? message.substring(0, 80) + '...' : message
}

function formatJson(value) {
  const cacheKey = value && typeof value === 'object' ? JSON.stringify(Object.keys(value).sort()) + ':' + (value.traceId || value.timestamp || '') + ':' + (value.id || '') : String(value)

  if (formattedJsonCache.has(cacheKey)) {
    return formattedJsonCache.get(cacheKey)
  }

  let formatted
  try {
    formatted = JSON.stringify(value, null, 2)
  } catch {
    formatted = String(value)
  }

  if (formattedJsonCache.size > 200) {
    const firstKey = formattedJsonCache.keys().next().value
    formattedJsonCache.delete(firstKey)
  }
  formattedJsonCache.set(cacheKey, formatted)
  return formatted
}

function getProviderName(log) {
  return log?.data?.provider || log?.data?.providers?.[0]?.providerName || log?.metadata?.providerName || null
}

function getModelName(log) {
  return log?.data?.model || log?.data?.request?.model || log?.metadata?.model || null
}

function getStatusCode(log) {
  return (
    log?.data?.statusCode ||
    log?.metadata?.status ||
    log?.data?.providers?.find?.(p => p.statusCode)?.statusCode ||
    null
  )
}

function getErrorCode(log) {
  return log?.data?.errorCode || log?.metadata?.errorCode || log?.metadata?.code || null
}

function getRequestInfo(log) {
  return log?.metadata?.request || null
}

function getResponseData(log) {
  return log?.metadata?.responseData || null
}

function getErrorSummary(log) {
  return (
    log?.data?.errorMessage ||
    log?.metadata?.providerMessage ||
    log?.data?.providers?.find?.(p => p.error)?.error ||
    null
  )
}

// 格式化时间
function formatTime(timestamp) {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

// 分页控制
function goToPage(offset) {
  pagination.value.offset = offset
  loadLogs()
}

function prevPage() {
  const newOffset = Math.max(0, pagination.value.offset - pagination.value.limit)
  pagination.value.offset = newOffset
  loadLogs()
}

function nextPage() {
  pagination.value.offset += pagination.value.limit
  loadLogs()
}

// 改变每页显示条目数
function changePageSize(newSize) {
  pagination.value.limit = Number(newSize)
  pagination.value.offset = 0
  loadLogs()
}

function onPageSizeChange(option) {
  const value = typeof option === 'object' && option !== null ? option.value : pagination.value.limit
  changePageSize(value)
}

// 导出日志
async function exportLogs(format) {
  try {
    const params = {
      startDate: filters.value.startDate,
      endDate: filters.value.endDate,
      format
    }

    const response = await axios.get(`${API_BASE}/api/logs/export`, {
      params,
      responseType: 'blob'
    })

    // 创建下载链接
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `logs_${filters.value.startDate}_${filters.value.endDate}.${format}`)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  } catch (err) {
    alert('导出失败: ' + (err.response?.data?.error || err.message))
  }
}

// 实时监控
function toggleRealtime() {
  if (isRealtimeEnabled.value) {
    startRealtime()
  } else {
    stopRealtime()
  }
}

function startRealtime() {
  if (eventSource.value) return

  const url = new URL(`${API_BASE}/api/logs/stream`)
  if (filters.value.level) url.searchParams.set('level', filters.value.level)
  if (filters.value.type) url.searchParams.set('type', filters.value.type)

  eventSource.value = new EventSource(url.toString())

  eventSource.value.onmessage = (event) => {
    try {
      const log = JSON.parse(event.data)
      if (log.type === 'connected') {
        console.log(log.message)
        return
      }
      // 添加新日志到列表顶部
      logs.value = [log, ...logs.value].slice(0, 100)
      formattedJsonCache.clear()
    } catch (err) {
      console.error('Error parsing SSE message:', err)
    }
  }

  eventSource.value.onerror = (err) => {
    console.error('SSE error:', err)
    stopRealtime()
  }
}

function stopRealtime() {
  if (eventSource.value) {
    eventSource.value.close()
    eventSource.value = null
  }
}

// 删除对话框
function showDeleteDialog() {
  if (!canDelete.value) {
    alert('请先选择日期范围')
    return
  }
  deleteDialog.value.show = true
}

function closeDeleteDialog() {
  if (!deleteDialog.value.deleting) {
    deleteDialog.value.show = false
  }
}

// 删除7天前日志对话框
function showDeleteOldLogsDialog() {
  const now = new Date()
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(now.getDate() - 7)

  const year = sevenDaysAgo.getFullYear()
  const month = String(sevenDaysAgo.getMonth() + 1).padStart(2, '0')
  const day = String(sevenDaysAgo.getDate()).padStart(2, '0')
  const endDate = `${year}-${month}-${day}`

  deleteOldLogsDialog.value.endDate = endDate
  deleteOldLogsDialog.value.startDate = '2024-01-01'  // 设置一个很早的起始日期
  deleteOldLogsDialog.value.show = true
}

function closeDeleteOldLogsDialog() {
  if (!deleteOldLogsDialog.value.deleting) {
    deleteOldLogsDialog.value.show = false
  }
}

async function confirmDeleteOldLogs() {
  deleteOldLogsDialog.value.deleting = true

  try {
    const response = await axios.delete(`${API_BASE}/api/logs`, {
      params: {
        startDate: deleteOldLogsDialog.value.startDate,
        endDate: deleteOldLogsDialog.value.endDate
      }
    })

    if (response.data.success) {
      alert(`成功删除 ${response.data.deletedCount} 个日志文件`)
      deleteOldLogsDialog.value.show = false
      await loadLogs()
    }
  } catch (err) {
    alert('删除日志失败: ' + (err.response?.data?.error || err.message))
  } finally {
    deleteOldLogsDialog.value.deleting = false
  }
}

async function confirmDelete() {
  deleteDialog.value.deleting = true

  try {
    const response = await axios.delete(`${API_BASE}/api/logs`, {
      params: {
        startDate: filters.value.startDate,
        endDate: filters.value.endDate
      }
    })

    if (response.data.success) {
      alert(`成功删除 ${response.data.deletedCount} 个日志文件`)
      deleteDialog.value.show = false
      await loadLogs()
    }
  } catch (err) {
    alert('删除日志失败: ' + (err.response?.data?.error || err.message))
  } finally {
    deleteDialog.value.deleting = false
  }
}

// 生命周期
onMounted(async () => {
  await initDateRange()
  await loadLogs()
})

onUnmounted(() => {
  stopRealtime()
})
</script>

<style scoped>
.logs-page {
  padding: 20px;
  max-width: 1680px;
  margin: 0 auto;
}

h2 {
  margin-bottom: 22px;
  color: #0f172a;
  font-size: 1.9rem;
  font-weight: 800;
  letter-spacing: -0.03em;
}

/* 工具栏 */
.logs-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  padding: 18px;
  background: rgba(255, 255, 255, 0.96);
  border-radius: 22px;
  border: 1px solid rgba(226, 232, 240, 0.95);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
  flex-wrap: wrap;
  gap: 15px;
}

.toolbar-left {
  flex: 1;
  min-width: 0;
}

.date-range {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.date-range label {
  font-weight: 500;
  color: #555;
  white-space: nowrap;
}

.filters-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 5px;
}

.hint {
  color: #999;
  font-size: 12px;
}

.toolbar-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.input-field {
  padding: 9px 12px;
  border: 1px solid rgba(203, 213, 225, 0.95);
  border-radius: 14px;
  font-size: 14px;
  background: rgba(255,255,255,0.92);
  transition: all 0.22s ease;
}

.select-field {
  min-width: 100px;
  cursor: pointer;
}

.search-input {
  min-width: 200px;
}

.btn-search {
  padding: 9px 16px;
  background: #0891b2;
  color: white;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 700;
  box-shadow: 0 8px 16px rgba(8, 145, 178, 0.18);
  transition: all 0.22s ease;
}

.btn-search:hover {
  background: #0e7490;
  transform: translateY(-1px);
  box-shadow: 0 10px 20px rgba(8, 145, 178, 0.24);
}

.realtime-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  user-select: none;
}

.realtime-toggle input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.realtime-toggle span {
  font-size: 14px;
  color: #555;
}

.btn-action {
  padding: 9px 16px;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 700;
  transition: background-color 0.18s ease, color 0.18s ease, opacity 0.18s ease;
  white-space: nowrap;
  background: linear-gradient(135deg, #15803d 0%, #166534 100%);
  color: white;
  min-width: 86px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 14px rgba(22, 101, 52, 0.12);
}

.btn-action:hover {
  opacity: 0.96;
}

.btn-action.btn-today {
  background: #0891b2;
}

.btn-action.btn-today:hover {
  background: #0e7490;
}

.btn-action.btn-recent {
  background: #9C27B0;
}

.btn-action.btn-recent:hover {
  background: #7B1FA2;
}

.btn-action.btn-export {
  background: #FF9800;
}

.btn-action.btn-export:hover {
  background: #F57C00;
}

.btn-action.btn-delete {
  background: #f44336;
}

.btn-action.btn-delete:hover:not(:disabled) {
  background: #d32f2f;
}

.btn-action.btn-delete-old {
  background: #D32F2F;
}

.btn-action.btn-delete-old:hover {
  background: #B71C1C;
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
  padding: 16px 18px;
  background: linear-gradient(180deg, #fff1f2 0%, #ffe4e6 100%);
  color: #b91c1c;
  border-radius: 18px;
  border: 1px solid #fecdd3;
  margin-bottom: 20px;
  box-shadow: 0 16px 30px rgba(185, 28, 28, 0.08);
}

/* 统计概览 */
.stats-overview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 16px;
  margin-bottom: 22px;
}

.stat-card {
  padding: 16px 18px;
  background: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(247,250,252,0.95) 100%);
  border-radius: 18px;
  border: 1px solid rgba(226, 232, 240, 0.95);
  border-left: 4px solid #2196F3;
  box-shadow: 0 6px 14px rgba(15, 23, 42, 0.04);
}

.stat-card.success {
  border-left-color: #4CAF50;
}

.stat-card.warning {
  border-left-color: #FF9800;
}

.stat-card.failed {
  border-left-color: #f44336;
}

.stat-label {
  font-size: 12px;
  color: #666;
  margin-bottom: 5px;
}

.stat-value {
  font-size: 24px;
  font-weight: bold;
  color: #333;
}

/* 日志列表 */
.logs-content {
  background: rgba(255, 255, 255, 0.98);
  border-radius: 24px;
  padding: 22px;
  border: 1px solid rgba(226, 232, 240, 0.95);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
}

.no-data {
  text-align: center;
  padding: 40px;
  color: #999;
}

.logs-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.log-entry {
  border: 1px solid rgba(226, 232, 240, 0.95);
  border-radius: 18px;
  overflow: hidden;
  flex-shrink: 0;
  min-height: 50px;
  background: linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(247,250,252,0.97) 100%);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.03);
}

.log-header {
  display: flex;
  align-items: center;
  padding: 13px 16px;
  background: rgba(248, 250, 252, 0.9);
  cursor: pointer;
  transition: background-color 0.18s ease;
  gap: 10px;
  flex-wrap: wrap;
}

.log-header:hover {
  background: rgba(241, 245, 249, 1);
}

.log-badge {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  white-space: nowrap;
}

.log-badge.level-debug {
  background: #E3F2FD;
  color: #1976D2;
}

.log-badge.level-info {
  background: #E8F5E9;
  color: #388E3C;
}

.log-badge.level-warn {
  background: #FFF3E0;
  color: #F57C00;
}

.log-badge.level-error {
  background: #FFEBEE;
  color: #D32F2F;
}

.log-badge.level-critical {
  background: #212121;
  color: #fff;
}

.log-badge.type-api_call {
  background: #F3E5F5;
  color: #7B1FA2;
}

.log-badge.type-system {
  background: #E0F2F1;
  color: #00796B;
}

.log-badge.type-user_action {
  background: #FFF8E1;
  color: #FFA000;
}

.log-badge.type-auth {
  background: #FFEBEE;
  color: #C62828;
}

.log-badge.type-database {
  background: #E8EAF6;
  color: #3F51B5;
}

.log-badge.type-performance {
  background: #FCE4EC;
  color: #C2185B;
}

.log-badge.type-security {
  background: #212121;
  color: #fff;
}

.log-time {
  font-family: monospace;
  font-size: 13px;
  color: #666;
  min-width: 70px;
}

.log-message-short {
  flex: 1;
  color: #333;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 200px;
}

.toggle-icon {
  color: #666;
  font-size: 12px;
}

/* 日志详情 */
.log-detail {
  padding: 12px 15px;
  background: white;
  border-top: 1px solid #e0e0e0;
}

.error-summary-card {
  margin: 10px 0 14px;
  padding: 12px;
  background: #fff5f5;
  border: 1px solid #fecaca;
  border-left: 4px solid #ef4444;
  border-radius: 8px;
}

.error-summary-header {
  font-size: 12px;
  font-weight: 700;
  color: #b91c1c;
  margin-bottom: 6px;
}

.error-summary-message {
  color: #7f1d1d;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.error-summary-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.error-chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 999px;
  background: #fee2e2;
  color: #991b1b;
  font-size: 12px;
  font-weight: 600;
}

.detail-row {
  display: flex;
  margin-bottom: 8px;
  align-items: flex-start;
}

.detail-row:last-child {
  margin-bottom: 0;
}

.detail-row-block {
  align-items: stretch;
}

.detail-label {
  font-weight: 500;
  color: #666;
  min-width: 80px;
  font-size: 13px;
  flex-shrink: 0;
}

.detail-value {
  color: #333;
  font-size: 13px;
  word-break: break-word;
}

.detail-stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.trace-id {
  font-family: monospace;
  font-size: 12px;
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 3px;
}

.detail-json {
  margin: 0;
  padding: 10px;
  background: #f5f5f5;
  border-radius: 4px;
  font-size: 12px;
  overflow-x: auto;
  max-width: 100%;
  white-space: pre-wrap;
  word-break: break-word;
}

.detail-json-error {
  background: #fff7ed;
  border: 1px solid #fed7aa;
}

/* 分页 */
.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #e0e0e0;
  flex-wrap: wrap;
}

.pagination-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.page-size-label {
  font-size: 14px;
  color: #666;
  white-space: nowrap;
}

.page-size-select {
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 14px;
  transition: border-color 0.3s;
}

.page-size-select:hover {
  border-color: #999;
}

.page-size-select:focus {
  outline: none;
  border-color: #2196F3;
}

.pagination-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.btn-page {
  padding: 8px 16px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.3s;
}

.btn-page:hover:not(:disabled) {
  background: #f5f5f5;
  border-color: #999;
}

.btn-page:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.page-info {
  font-size: 14px;
  color: #666;
  white-space: nowrap;
}

/* 对话框 */
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

.dialog-info {
  margin: 0 0 8px 0;
  color: #2196F3;
  font-size: 14px;
  font-weight: 400;
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

/* 响应式 */
@media (max-width: 768px) {
  .logs-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar-actions {
    justify-content: stretch;
  }

  .btn-action {
    flex: 1;
    min-width: 0;
  }

  .filters-row {
    flex-direction: column;
  }

  .filter-group {
    width: 100%;
  }

  .search-input,
  .select-field {
    width: 100%;
    box-sizing: border-box;
  }
}
</style>
