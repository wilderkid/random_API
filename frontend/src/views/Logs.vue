<template>
  <div class="logs-page">
    <header class="page-head">
      <div>
        <h1>调用日志</h1>
        <p>按调用查看模型、供应商、Token 和延迟</p>
      </div>
      <div class="tab-switch">
        <button type="button" :class="['tab', { active: viewMode === 'usage' }]" @click="setViewMode('usage')">调用记录</button>
        <button type="button" :class="['tab', { active: viewMode === 'system' }]" @click="setViewMode('system')">系统日志</button>
      </div>
    </header>

    <section class="toolbar">
      <div class="toolbar-row">
        <input v-model="filters.startDate" type="date" @change="onDateChange">
        <span>至</span>
        <input v-model="filters.endDate" type="date" @change="onDateChange">
        <input
          v-model="filters.keyword"
          class="search-input"
          type="text"
          placeholder="搜索模型 / 供应商 / 密钥"
          @keyup.enter="applyFilters"
        >
        <template v-if="viewMode === 'system'">
          <SearchableSelect
            v-model="filters.level"
            :options="logLevelOptions"
            placeholder="全部级别"
            search-placeholder="搜索级别..."
            @change="applyFilters"
          />
          <SearchableSelect
            v-model="filters.type"
            :options="logTypeOptions"
            placeholder="全部类型"
            search-placeholder="搜索类型..."
            @change="applyFilters"
          />
        </template>
        <label class="realtime">
          <input type="checkbox" v-model="isRealtimeEnabled" @change="toggleRealtime">
          实时
        </label>
      </div>
      <div class="toolbar-row">
        <button type="button" class="btn" @click="applyFilters">刷新</button>
        <button type="button" class="btn" @click="loadToday">今日</button>
        <button type="button" class="btn" @click="loadRecent7Days">最近七天</button>
        <button type="button" class="btn ghost" @click="exportLogs('json')">导出 JSON</button>
        <button type="button" class="btn ghost" @click="exportLogs('csv')">导出 CSV</button>
        <button type="button" class="btn danger" @click="showDeleteOldLogsDialog">删除七天前</button>
        <button type="button" class="btn danger" :disabled="!canDelete" @click="showDeleteDialog">清除日志</button>
      </div>
    </section>

    <section class="summary-row">
      <div class="summary-chip">记录 {{ pagination.total }}</div>
      <div class="summary-chip">成功 {{ usageSummary.success }}</div>
      <div class="summary-chip">失败 {{ usageSummary.failed }}</div>
      <div class="summary-chip">Token {{ formatCompact(usageSummary.tokens) }}</div>
    </section>

    <div v-if="loading && !logs.length" class="state-msg">加载中...</div>
    <div v-else-if="error" class="state-msg error">{{ error }}</div>

    <section v-else-if="viewMode === 'usage'" class="panel">
      <div class="table-scroll">
        <table class="call-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>API 密钥</th>
              <th>模型</th>
              <th>供应商</th>
              <th>类型</th>
              <th>Token</th>
              <th>延迟</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="usageRows.length === 0">
              <td colspan="8" class="empty">暂无调用记录</td>
            </tr>
            <template v-for="row in usageRows" :key="row.id">
              <tr class="call-row" @click="toggleLogDetail(row.raw)">
                <td>{{ row.time }}</td>
                <td>{{ row.apiKeyName }}</td>
                <td class="strong">{{ row.model }}</td>
                <td><span class="provider-chip">{{ row.providerName }}</span></td>
                <td>
                  <span :class="['type-chip', row.stream ? 'stream' : 'json']">{{ row.stream ? '流式' : '非流式' }}</span>
                </td>
                <td>
                  <div class="token-stack">
                    <span class="in">入 {{ formatNumber(row.promptTokens) }}</span>
                    <span class="out">出 {{ formatNumber(row.completionTokens) }}</span>
                    <span class="total">共 {{ formatNumber(row.totalTokens) }}</span>
                  </div>
                </td>
                <td>
                  <div class="latency">
                    <div class="latency-bar">
                      <span class="first" :style="{ width: row.firstPct + '%' }"></span>
                      <span class="rest" :style="{ width: row.restPct + '%' }"></span>
                    </div>
                    <div class="latency-text">
                      <span>首字 {{ formatDuration(row.firstTokenMs) }}</span>
                      <span>总耗时 {{ formatDuration(row.duration) }}</span>
                    </div>
                  </div>
                </td>
                <td><span :class="['status-pill', row.status]">{{ row.status === 'success' ? '成功' : '失败' }}</span></td>
              </tr>
              <tr v-if="expandedLogs.has(row.raw.traceId || row.id)" class="detail-row">
                <td colspan="8">
                  <div class="detail-grid">
                    <div><strong>IP</strong>{{ row.ip }}</div>
                    <div><strong>尝试</strong>{{ row.attempts }}</div>
                    <div><strong>链路</strong>{{ row.chain }}</div>
                    <div v-if="row.error"><strong>错误</strong>{{ row.error }}</div>
                  </div>
                  <pre class="detail-json">{{ formatJson(row.raw.data || {}) }}</pre>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else class="panel">
      <div v-if="logs.length === 0" class="empty">暂无日志数据</div>
      <div v-else class="sys-list">
        <div v-for="log in logs" :key="log.timestamp + log.traceId" class="sys-item" @click="toggleLogDetail(log)">
          <div class="sys-head">
            <span :class="['log-badge', `level-${(log.level || '').toLowerCase()}`]">{{ log.level }}</span>
            <span class="log-badge type">{{ log.type }}</span>
            <span class="sys-time">{{ formatTime(log.timestamp) }}</span>
            <span class="sys-msg">{{ getShortMessage(log.message) }}</span>
          </div>
          <pre v-if="expandedLogs.has(log.traceId)" class="detail-json">{{ formatJson(log) }}</pre>
        </div>
      </div>
    </section>

    <div v-if="pagination.total > 0" class="pagination">
      <SearchableSelect
        v-model="pagination.limit"
        :options="pageSizeSelectOptions"
        placeholder="每页条数"
        search-placeholder="搜索分页条数..."
        @change="onPageSizeChange"
      />
      <div class="pager">
        <button type="button" class="btn ghost" :disabled="pagination.offset === 0" @click="goToPage(0)">首页</button>
        <button type="button" class="btn ghost" :disabled="pagination.offset === 0" @click="prevPage">上一页</button>
        <span>{{ pagination.offset + 1 }} - {{ Math.min(pagination.offset + pagination.limit, pagination.total) }} / {{ pagination.total }}</span>
        <button type="button" class="btn ghost" :disabled="!pagination.hasMore" @click="nextPage">下一页</button>
      </div>
    </div>

    <div v-if="deleteDialog.show" class="dialog-overlay" @click="closeDeleteDialog">
      <div class="dialog-box" @click.stop>
        <h3>确认删除日志</h3>
        <p>确定要删除 {{ filters.startDate }} 到 {{ filters.endDate }} 的日志吗？此操作不可恢复。</p>
        <div class="dialog-actions">
          <button type="button" class="btn ghost" @click="closeDeleteDialog">取消</button>
          <button type="button" class="btn danger" :disabled="deleteDialog.deleting" @click="confirmDelete">
            {{ deleteDialog.deleting ? '删除中...' : '确认删除' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="deleteOldLogsDialog.show" class="dialog-overlay" @click="closeDeleteOldLogsDialog">
      <div class="dialog-box" @click.stop>
        <h3>清理旧日志</h3>
        <p>将删除 7 天前的所有日志，仅保留最近 7 天。</p>
        <div class="dialog-actions">
          <button type="button" class="btn ghost" @click="closeDeleteOldLogsDialog">取消</button>
          <button type="button" class="btn danger" :disabled="deleteOldLogsDialog.deleting" @click="confirmDeleteOldLogs">
            {{ deleteOldLogsDialog.deleting ? '删除中...' : '确认删除' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import axios from 'axios'
import SearchableSelect from '../components/SearchableSelect.vue'
import { formatCompact, formatDateTime, formatDuration, formatNumber, pickTokenUsage } from '../utils/usageFormat.js'

const API_BASE = window.location.origin
const logLevels = [
  { value: 'DEBUG', label: 'DEBUG' },
  { value: 'INFO', label: 'INFO' },
  { value: 'WARN', label: 'WARN' },
  { value: 'ERROR', label: 'ERROR' },
  { value: 'CRITICAL', label: 'CRITICAL' }
]
const logTypes = [
  { value: 'API_CALL', label: 'API调用' },
  { value: 'API_REQUEST', label: 'API请求' },
  { value: 'PROVIDER_SWITCH', label: '提供商切换' },
  { value: 'SESSION_BIND', label: '会话绑定' },
  { value: 'SYSTEM', label: '系统' },
  { value: 'AUTH', label: '认证' },
  { value: 'PERFORMANCE', label: '性能' }
]

const loading = ref(false)
const error = ref('')
const logs = ref([])
const viewMode = ref('usage')
const filters = ref({
  startDate: '',
  endDate: '',
  level: '',
  type: '',
  keyword: ''
})
const pagination = ref({
  total: 0,
  limit: 20,
  offset: 0,
  hasMore: false
})
const expandedLogs = ref(new Set())
const formattedJsonCache = new Map()
const MAX_EXPANDED_LOGS = 3
const isRealtimeEnabled = ref(false)
const eventSource = ref(null)
const deleteDialog = ref({ show: false, deleting: false })
const deleteOldLogsDialog = ref({ show: false, deleting: false, startDate: '', endDate: '' })
const stats = ref({ tokenStats: {}, successfulCalls: 0, failedCalls: 0 })

const logLevelOptions = computed(() => [{ value: '', label: '全部级别' }, ...logLevels])
const logTypeOptions = computed(() => [{ value: '', label: '全部类型' }, ...logTypes])
const pageSizeSelectOptions = computed(() => [10, 20, 50, 100].map(value => ({ value, label: String(value) })))
const canDelete = computed(() => Boolean(filters.value.startDate && filters.value.endDate))

const usageRows = computed(() => logs.value.map(mapUsageRow))
const usageSummary = computed(() => {
  const rows = usageRows.value
  return {
    success: rows.filter(row => row.status === 'success').length,
    failed: rows.filter(row => row.status !== 'success').length,
    tokens: rows.reduce((sum, row) => sum + Number(row.totalTokens || 0), 0)
  }
})

function setViewMode(mode) {
  viewMode.value = mode
  pagination.value.offset = 0
  if (mode === 'usage') filters.value.type = ''
  applyFilters()
}

function todayStamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

async function initDateRange() {
  filters.value.endDate = todayStamp()
  filters.value.startDate = todayStamp()
}

function onDateChange() {
  pagination.value.offset = 0
  applyFilters()
}

function applyFilters() {
  pagination.value.offset = 0
  loadLogs()
}

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
    if (viewMode.value === 'usage') {
      params.type = 'API_REQUEST,API_CALL'
    } else {
      if (filters.value.level) params.level = filters.value.level
      if (filters.value.type) params.type = filters.value.type
    }
    if (filters.value.keyword) params.keyword = filters.value.keyword
    const response = await axios.get(`${API_BASE}/api/logs`, { params })
    logs.value = response.data.logs || []
    formattedJsonCache.clear()
    pagination.value = response.data.pagination
    await loadStats()
  } catch (err) {
    error.value = err.response?.data?.error || err.message || '加载日志失败'
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  try {
    const response = await axios.get(`${API_BASE}/api/logs/stats`, {
      params: { startDate: filters.value.startDate, endDate: filters.value.endDate }
    })
    stats.value = response.data.stats || {}
  } catch (err) {
    console.error('Error loading stats:', err)
  }
}

function mapUsageRow(log) {
  const request = log.data?.request || {}
  const result = log.data?.result || {}
  const providers = Array.isArray(log.data?.providers) ? log.data.providers : []
  const successProvider =
    providers.find(item => item.providerId === result.successfulProvider) ||
    providers.find(item => item.status === 'success') ||
    providers[0]
  const tokens = pickTokenUsage(result.tokenUsage || log.data?.tokenUsage)
  const success = result.status ? result.status === 'success' : log.data?.status === 'SUCCESS'
  const duration = result.totalDuration ?? successProvider?.duration ?? log.data?.duration ?? null
  const firstTokenMs = result.firstTokenMs ?? successProvider?.firstTokenMs ?? log.data?.firstTokenMs ?? null
  const firstPct = duration ? Math.min(100, Math.round((Number(firstTokenMs || 0) / duration) * 100)) : 0
  return {
    id: `${log.timestamp}-${log.traceId || Math.random()}`,
    raw: log,
    time: formatDateTime(log.timestamp),
    apiKeyName: request.apiKeyName || log.metadata?.apiKeyName || '-',
    model: request.model || log.data?.model || '-',
    providerName: successProvider?.providerName || log.data?.provider || '-',
    stream: request.stream === true || log.metadata?.isStreaming === true,
    promptTokens: tokens.prompt,
    completionTokens: tokens.completion,
    totalTokens: tokens.total,
    firstTokenMs,
    duration,
    firstPct,
    restPct: Math.max(0, 100 - firstPct),
    status: success ? 'success' : 'failed',
    ip: request.clientIp || log.data?.request?.clientIp || '-',
    attempts: result.totalAttempts || providers.length || 1,
    chain: providers.map(item => item.providerName).filter(Boolean).join(' -> ') || (log.data?.provider || '-'),
    error: log.data?.errorMessage || providers.find(item => item.error)?.error || ''
  }
}

function toggleLogDetail(log) {
  const key = log.traceId || `${log.timestamp}`
  if (expandedLogs.value.has(key)) {
    expandedLogs.value.delete(key)
    return
  }
  if (expandedLogs.value.size >= MAX_EXPANDED_LOGS) {
    const firstExpanded = expandedLogs.value.values().next().value
    if (firstExpanded) expandedLogs.value.delete(firstExpanded)
  }
  expandedLogs.value.add(key)
}

function getShortMessage(message) {
  if (!message) return ''
  return message.length > 80 ? message.substring(0, 80) + '...' : message
}

function formatJson(value) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatTime(timestamp) {
  const date = new Date(timestamp)
  const pad = value => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function goToPage(offset) {
  pagination.value.offset = offset
  loadLogs()
}

function prevPage() {
  pagination.value.offset = Math.max(0, pagination.value.offset - pagination.value.limit)
  loadLogs()
}

function nextPage() {
  pagination.value.offset += pagination.value.limit
  loadLogs()
}

function onPageSizeChange(option) {
  const value = typeof option === 'object' && option !== null ? option.value : pagination.value.limit
  pagination.value.limit = Number(value)
  pagination.value.offset = 0
  loadLogs()
}

async function loadToday() {
  filters.value.startDate = todayStamp()
  filters.value.endDate = todayStamp()
  applyFilters()
}

async function loadRecent7Days() {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - 6)
  filters.value.startDate = todayStamp(start)
  filters.value.endDate = todayStamp(end)
  applyFilters()
}

async function exportLogs(format) {
  try {
    const params = {
      startDate: filters.value.startDate,
      endDate: filters.value.endDate,
      format
    }
    if (viewMode.value === 'usage') params.type = 'API_REQUEST,API_CALL'
    const response = await axios.get(`${API_BASE}/api/logs/export`, { params, responseType: 'blob' })
    const url = window.URL.createObjectURL(response.data)
    const link = document.createElement('a')
    link.href = url
    link.download = `logs-${filters.value.startDate}-${filters.value.endDate}.${format}`
    link.click()
    window.URL.revokeObjectURL(url)
  } catch (err) {
    error.value = err.response?.data?.error || err.message || '导出失败'
  }
}

function toggleRealtime() {
  if (isRealtimeEnabled.value) startRealtime()
  else stopRealtime()
}

function startRealtime() {
  stopRealtime()
  const url = new URL(`${API_BASE}/api/logs/stream`)
  eventSource.value = new EventSource(url)
  eventSource.value.onmessage = event => {
    try {
      const log = JSON.parse(event.data)
      if (viewMode.value === 'usage' && !['API_REQUEST', 'API_CALL'].includes(log.type)) return
      logs.value = [log, ...logs.value].slice(0, pagination.value.limit)
    } catch {}
  }
}

function stopRealtime() {
  if (eventSource.value) {
    eventSource.value.close()
    eventSource.value = null
  }
}

function showDeleteDialog() {
  deleteDialog.value.show = true
}

function closeDeleteDialog() {
  if (!deleteDialog.value.deleting) deleteDialog.value.show = false
}

async function confirmDelete() {
  deleteDialog.value.deleting = true
  try {
    await axios.delete(`${API_BASE}/api/logs`, {
      params: { startDate: filters.value.startDate, endDate: filters.value.endDate }
    })
    deleteDialog.value.show = false
    await loadLogs()
  } catch (err) {
    error.value = err.response?.data?.error || err.message || '删除失败'
  } finally {
    deleteDialog.value.deleting = false
  }
}

function showDeleteOldLogsDialog() {
  const end = new Date()
  end.setDate(end.getDate() - 7)
  deleteOldLogsDialog.value.endDate = todayStamp(end)
  deleteOldLogsDialog.value.startDate = '2024-01-01'
  deleteOldLogsDialog.value.show = true
}

function closeDeleteOldLogsDialog() {
  if (!deleteOldLogsDialog.value.deleting) deleteOldLogsDialog.value.show = false
}

async function confirmDeleteOldLogs() {
  deleteOldLogsDialog.value.deleting = true
  try {
    await axios.delete(`${API_BASE}/api/logs`, {
      params: {
        startDate: deleteOldLogsDialog.value.startDate,
        endDate: deleteOldLogsDialog.value.endDate
      }
    })
    deleteOldLogsDialog.value.show = false
    await loadLogs()
  } catch (err) {
    error.value = err.response?.data?.error || err.message || '删除失败'
  } finally {
    deleteOldLogsDialog.value.deleting = false
  }
}

onMounted(async () => {
  await initDateRange()
  await loadLogs()
})

onUnmounted(stopRealtime)
</script>

<style scoped>
.logs-page {
  padding: clamp(16px, 2vw, 24px);
  max-width: min(100%, 1680px);
  margin: 0 auto;
}

.page-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-end;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

h1 {
  font-size: 1.85rem;
  font-weight: 800;
  color: var(--ink);
}

.page-head p,
.empty,
.state-msg {
  color: var(--muted);
}

.tab-switch,
.toolbar-row,
.summary-row,
.pagination,
.pager,
.dialog-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.tab,
.btn {
  min-height: 34px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink-soft);
  padding: 0 14px;
  font-weight: 700;
  cursor: pointer;
}

.tab.active,
.btn {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

.btn.ghost {
  background: var(--surface);
  color: var(--ink-soft);
}

.btn.danger {
  background: var(--pink);
  border-color: var(--pink);
  color: white;
}

.toolbar,
.panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 14px;
  box-shadow: var(--shadow-soft);
  margin-bottom: 14px;
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

input[type="date"],
.search-input {
  min-height: 34px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0 10px;
  background: white;
}

.search-input { min-width: 220px; }

.summary-chip,
.provider-chip,
.type-chip,
.status-pill,
.log-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.summary-chip,
.provider-chip {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.type-chip.stream {
  background: var(--pink-soft);
  color: var(--pink-strong);
}

.type-chip.json,
.status-pill.success {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.status-pill.failed {
  background: var(--pink-soft);
  color: var(--pink-strong);
}

.table-scroll { overflow: auto; }

.call-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 1080px;
}

.call-table th,
.call-table td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
  vertical-align: top;
}

.call-table th { color: var(--muted); }

.call-row { cursor: pointer; }
.call-row:hover { background: var(--bg-soft); }
.strong { font-weight: 700; color: var(--ink); }

.token-stack,
.latency-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-variant-numeric: tabular-nums;
}

.token-stack .in { color: var(--accent); }
.token-stack .out { color: var(--pink-strong); }
.token-stack .total { color: var(--ink-soft); }

.latency-bar {
  width: 120px;
  height: 8px;
  border-radius: 99px;
  background: var(--bg-soft);
  display: flex;
  overflow: hidden;
  margin-bottom: 4px;
}

.latency-bar .first { background: var(--accent); height: 100%; }
.latency-bar .rest { background: var(--pink); height: 100%; }
.latency-text { color: var(--muted); font-size: 12px; }

.detail-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}

.detail-json {
  background: var(--bg-soft);
  border-radius: 10px;
  padding: 10px;
  overflow: auto;
  max-height: 240px;
  font-size: 12px;
}

.sys-item {
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
}

.sys-head { display: flex; gap: 8px; align-items: center; }
.log-badge.level-error, .log-badge.level-critical { background: var(--pink-soft); color: var(--pink-strong); }
.log-badge.level-info { background: var(--accent-soft); color: var(--accent-strong); }
.sys-time { color: var(--muted); font-size: 12px; }

.pagination { justify-content: space-between; margin-top: 12px; }

.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(36, 85, 60, 0.18);
  display: grid;
  place-items: center;
}

.dialog-box {
  width: min(92vw, 420px);
  background: white;
  border-radius: 16px;
  padding: 18px;
}

.realtime { color: var(--ink-soft); font-size: 13px; display: flex; gap: 6px; align-items: center; }

@media (max-width: 800px) {
  .detail-grid { grid-template-columns: 1fr 1fr; }
  h1 { font-size: 1.45rem; }
}
</style>
