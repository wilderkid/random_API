<template>
  <div class="stats-dashboard">
    <h1>API中转服务统计仪表盘</h1>

    <!-- 时间范围选择器 -->
    <div class="time-range-selector">
      <button
        v-for="range in timeRanges"
        :key="range.value"
        :class="['time-range-btn', { active: selectedTimeRange === range.value }]"
        @click="selectTimeRange(range.value)"
      >
        {{ range.label }}
      </button>
      <div class="custom-range">
        <input
          v-model="customStartDate"
          type="date"
          class="date-input"
          @change="loadStats"
        >
        <span>至</span>
        <input
          v-model="customEndDate"
          type="date"
          class="date-input"
          @change="loadStats"
        >
        <button @click="loadStats" class="apply-btn">应用</button>
      </div>
      <button
        @click="refreshStats"
        :class="['refresh-btn', { loading: refreshing }]"
        :disabled="refreshing"
      >
        {{ refreshing ? '刷新中...' : '刷新' }}
      </button>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="loading">加载统计数据中...</div>
    <div v-else-if="error" class="error-message">{{ error }}</div>

    <!-- 统计概览 -->
    <div v-else class="stats-content">
      <!-- 概览卡片 -->
      <div class="overview-section">
        <h2>概览统计</h2>
        <div class="cards-grid">
          <div class="stat-card" :class="{ success: stats.totalApiCalls > 0 }">
            <div class="card-label">总请求数</div>
            <div class="card-value">{{ formatNumber(stats.totalApiCalls) }}</div>
            <div class="card-trend" :class="getTrendClass()">
              {{ getTrendIcon() }} {{ getTrendPercent() }}
            </div>
          </div>
          <div class="stat-card" :class="{ success: stats.successfulCalls > 0 }">
            <div class="card-label">成功数</div>
            <div class="card-value">{{ formatNumber(stats.successfulCalls) }}</div>
            <div class="card-rate">
              成功率: {{ successRate }}%
            </div>
          </div>
          <div class="stat-card warning">
            <div class="card-label">失败数</div>
            <div class="card-value">{{ formatNumber(stats.failedCalls) }}</div>
          </div>
          <div class="stat-card info">
            <div class="card-label">平均响应时间</div>
            <div class="card-value">{{ avgDuration }}s</div>
          </div>
          <div class="stat-card" v-if="stats.tokenStats">
            <div class="card-label">总 Token 量</div>
            <div class="card-value">{{ formatNumber(stats.tokenStats.totalTokens) }}</div>
            <div class="card-sub">
              Prompt: {{ formatNumber(stats.tokenStats.totalPromptTokens) }} / Completion: {{ formatNumber(stats.tokenStats.totalCompletionTokens) }}
            </div>
          </div>
          <div class="stat-card" v-if="stats.costStats">
            <div class="card-label">总成本</div>
            <div class="card-value">{{ formatCurrency(stats.costStats.totalCost, stats.costStats.currency) }}</div>
          </div>
        </div>
      </div>

      <!-- 提供商统计 -->
      <div class="providers-section">
        <h2>提供商统计</h2>
        <div class="table-container">
          <table class="stats-table">
            <thead>
              <tr>
                <th>提供商</th>
                <th>尝试数</th>
                <th>成功率</th>
                <th>平均响应时间</th>
                <th v-if="stats.costStats">成本占比</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="provider in providerRows" :key="provider.name">
                <td class="provider-name">{{ provider.name }}</td>
                <td>{{ formatNumber(provider.total) }}</td>
                <td :class="getRateClass(provider)">{{ calculateRate(provider) }}%</td>
                <td>{{ formatDuration(provider.avgDuration) }}</td>
                <td v-if="stats.costStats">
                  {{ calculateCostShare(provider, provider.name) }}%
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 模型轮询分布 -->
      <div class="distribution-section">
        <div class="section-heading">
          <h2>模型轮询分布</h2>
          <div class="distribution-controls">
            <select v-model="selectedDistributionModel" class="model-select">
              <option value="all">全部模型</option>
              <option
                v-for="modelName in distributionModelOptions"
                :key="modelName"
                :value="modelName"
              >
                {{ modelName }}
              </option>
            </select>
            <label class="checkbox-control">
              <input v-model="showOnlyMultiProvider" type="checkbox">
              <span>只看多 Provider</span>
            </label>
          </div>
        </div>
        <div class="table-container">
          <table class="stats-table distribution-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>Provider 数</th>
                <th>成功调用</th>
                <th>失败尝试</th>
                <th>均衡度</th>
                <th>成功 Provider 分布</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="filteredDistributionRows.length === 0">
                <td colspan="6" class="empty-cell">暂无可展示的模型分布数据</td>
              </tr>
              <tr v-for="row in filteredDistributionRows" :key="row.modelName">
                <td class="model-name-cell">{{ row.modelName }}</td>
                <td>{{ row.providerCount }}</td>
                <td>{{ formatNumber(row.totalSuccess) }}</td>
                <td>{{ formatNumber(row.totalFailed) }}</td>
                <td>
                  <span :class="['balance-badge', getBalanceClass(row)]">
                    {{ getBalanceText(row) }}
                  </span>
                </td>
                <td>
                  <div class="provider-distribution-list">
                    <div
                      v-for="provider in row.providers"
                      :key="`${row.modelName}-${provider.providerName}`"
                      class="provider-distribution-item"
                    >
                      <div class="provider-distribution-meta">
                        <span class="provider-name-inline">{{ provider.providerName }}</span>
                        <span>{{ formatNumber(provider.success) }} 成功 / {{ formatNumber(provider.failed) }} 失败 / {{ provider.share }}%</span>
                      </div>
                      <div class="distribution-bar">
                        <span :style="{ width: `${provider.share}%` }"></span>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 最近调用顺序 -->
      <div class="recent-section">
        <div class="section-heading">
          <h2>最近调用顺序</h2>
          <div class="section-hint">最多显示最近 50 条 API 请求</div>
        </div>
        <div class="table-container">
          <table class="stats-table recent-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>模型</th>
                <th>最终 Provider</th>
                <th>API 密钥</th>
                <th>轮询</th>
                <th>尝试</th>
                <th>尝试链路</th>
                <th>耗时</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="recentCalls.length === 0">
                <td colspan="9" class="empty-cell">暂无最近调用数据</td>
              </tr>
              <tr v-for="call in recentCalls" :key="call.id">
                <td>{{ call.time }}</td>
                <td class="model-name-cell">{{ call.model }}</td>
                <td class="provider-name">{{ call.providerName }}</td>
                <td>{{ call.apiKeyName }}</td>
                <td>{{ call.isPolling ? '是' : '否' }}</td>
                <td>{{ call.totalAttempts }}</td>
                <td>
                  <div class="attempt-chain">
                    <span
                      v-for="attempt in call.attempts"
                      :key="`${call.id}-${attempt.attempt}-${attempt.providerName}`"
                      :class="['attempt-chip', attempt.status]"
                      :title="attempt.error || ''"
                    >
                      {{ attempt.attempt }}. {{ attempt.providerName }}
                    </span>
                  </div>
                </td>
                <td>{{ formatDuration(call.duration) }}</td>
                <td>
                  <span :class="['status-badge', call.status]">
                    {{ call.status === 'success' ? '成功' : '失败' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 模型统计 -->
      <div class="models-section">
        <h2>模型使用统计</h2>
        <div class="table-container">
          <table class="stats-table">
            <thead>
              <tr>
                <th>提供商</th>
                <th>模型</th>
                <th>尝试次数</th>
                <th>成功率</th>
                <th>平均响应时间</th>
                <th>Prompt Tokens</th>
                <th>Completion Tokens</th>
                <th>Total Tokens</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="model in modelRows" :key="`${model.providerName}-${model.modelName}`">
                <td>{{ model.providerName }}</td>
                <td>{{ model.modelName }}</td>
                <td>{{ formatNumber(model.total) }}</td>
                <td :class="getRateClass(model)">{{ calculateRate(model) }}%</td>
                <td>{{ formatDuration(model.avgDuration) }}</td>
                <td>{{ formatNumber(model.totalPromptTokens) }}</td>
                <td>{{ formatNumber(model.totalCompletionTokens) }}</td>
                <td class="token-total-cell">{{ formatNumber(model.totalTokens) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- API密钥统计 -->
      <div class="apikeys-section">
        <h2>API密钥使用统计</h2>
        <div class="table-container">
          <table class="stats-table">
            <thead>
              <tr>
                <th>提供商</th>
                <th>API密钥</th>
                <th>尝试次数</th>
                <th>成功率</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="apiKey in apiKeyRows" :key="`${apiKey.providerName}-${apiKey.keyName}`">
                <td>{{ apiKey.providerName }}</td>
                <td>{{ apiKey.keyName }}</td>
                <td>{{ formatNumber(apiKey.total) }}</td>
                <td :class="getRateClass(apiKey)">{{ calculateRate(apiKey) }}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 性能统计 -->
      <div class="performance-section" v-if="stats.performanceStats">
        <h2>性能统计</h2>
        <div class="performance-grid">
          <div class="perf-card">
            <div class="perf-label">总耗时</div>
            <div class="perf-value">{{ formatDuration(stats.performanceStats.totalDuration) }}</div>
          </div>
          <div class="perf-card">
            <div class="perf-label">平均耗时</div>
            <div class="perf-value">{{ formatDuration(stats.performanceStats.avgDuration) }}</div>
          </div>
          <div class="perf-card">
            <div class="perf-label">最小耗时</div>
            <div class="perf-value">{{ formatDuration(stats.performanceStats.minDuration) }}</div>
          </div>
          <div class="perf-card">
            <div class="perf-label">最大耗时</div>
            <div class="perf-value">{{ formatDuration(stats.performanceStats.maxDuration) }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'

const API_BASE = window.location.origin

// 时间范围选项
const timeRanges = [
  { value: 'today', label: '今日' },
  { value: 'yesterday', label: '昨天' },
  { value: '7days', label: '最近7天' },
  { value: 'custom', label: '自定义' }
]

// 状态
const loading = ref(false)
const refreshing = ref(false)
const error = ref('')
const stats = ref({
  totalApiCalls: 0,
  successfulCalls: 0,
  failedCalls: 0,
  providerStats: {},
  levelStats: {},
  typeStats: {}
})
const recentCalls = ref([])
const selectedTimeRange = ref('today')
const customStartDate = ref('')
const customEndDate = ref('')
const selectedDistributionModel = ref('all')
const showOnlyMultiProvider = ref(false)

const providerRows = computed(() =>
  Object.entries(stats.value.providerStats || {}).map(([name, provider]) => ({
    name,
    ...provider
  }))
)

const modelRows = computed(() => {
  const rows = []
  Object.entries(stats.value.providerStats || {}).forEach(([providerName, provider]) => {
    Object.entries(provider.models || {}).forEach(([modelName, model]) => {
      rows.push({
        providerName,
        modelName,
        ...model
      })
    })
  })
  return rows
})

const apiKeyRows = computed(() => {
  const rows = []
  Object.entries(stats.value.providerStats || {}).forEach(([providerName, provider]) => {
    Object.entries(provider.apiKeys || {}).forEach(([keyName, apiKey]) => {
      rows.push({
        providerName,
        keyName,
        ...apiKey
      })
    })
  })
  return rows
})

const modelDistributionRows = computed(() => {
  const grouped = new Map()

  for (const row of modelRows.value) {
    if (!grouped.has(row.modelName)) {
      grouped.set(row.modelName, {
        modelName: row.modelName,
        totalSuccess: 0,
        totalFailed: 0,
        totalAttempts: 0,
        providers: []
      })
    }

    const group = grouped.get(row.modelName)
    const total = Number(row.total || 0)
    const success = Number(row.success || 0)
    const failed = Number(row.failed || 0)
    group.totalAttempts += total
    group.totalSuccess += success
    group.totalFailed += failed
    group.providers.push({
      providerName: row.providerName,
      total,
      success,
      failed,
      avgDuration: row.avgDuration || 0,
      share: 0
    })
  }

  return Array.from(grouped.values())
    .map(group => {
      const providers = group.providers
        .map(provider => ({
          ...provider,
          share: group.totalSuccess > 0 ? Number(((provider.success / group.totalSuccess) * 100).toFixed(1)) : 0
        }))
        .sort((a, b) => b.success - a.success || b.total - a.total || a.providerName.localeCompare(b.providerName))
      const counts = providers.map(provider => provider.success)
      const max = counts.length ? Math.max(...counts) : 0
      const min = counts.length ? Math.min(...counts) : 0

      return {
        ...group,
        providers,
        providerCount: providers.length,
        maxProviderCalls: max,
        minProviderCalls: min,
        spread: max - min
      }
    })
    .sort((a, b) => b.totalSuccess - a.totalSuccess || b.totalAttempts - a.totalAttempts || a.modelName.localeCompare(b.modelName))
})

const distributionModelOptions = computed(() =>
  modelDistributionRows.value.map(row => row.modelName)
)

const filteredDistributionRows = computed(() =>
  modelDistributionRows.value.filter(row => {
    if (selectedDistributionModel.value !== 'all' && row.modelName !== selectedDistributionModel.value) {
      return false
    }

    if (showOnlyMultiProvider.value && row.providerCount < 2) {
      return false
    }

    return true
  })
)

// 计算属性
const successRate = computed(() => {
  if (stats.value.totalApiCalls === 0) return 0
  return ((stats.value.successfulCalls / stats.value.totalApiCalls) * 100).toFixed(2)
})

const avgDuration = computed(() => {
  if (!stats.value.performanceStats?.avgDuration) return 0
  return (stats.value.performanceStats.avgDuration / 1000).toFixed(2)
})

// 获取日期范围
function getDateRange(range) {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const today = `${year}-${month}-${day}`

  switch (range) {
    case 'today':
      return { start: today, end: today }
    case 'yesterday':
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)
      const yYear = yesterday.getFullYear()
      const yMonth = String(yesterday.getMonth() + 1).padStart(2, '0')
      const yDay = String(yesterday.getDate()).padStart(2, '0')
      return { start: `${yYear}-${yMonth}-${yDay}`, end: `${yYear}-${yMonth}-${yDay}` }
    case '7days':
      const sevenDaysAgo = new Date(now)
      sevenDaysAgo.setDate(now.getDate() - 6)
      const sYear = sevenDaysAgo.getFullYear()
      const sMonth = String(sevenDaysAgo.getMonth() + 1).padStart(2, '0')
      const sDay = String(sevenDaysAgo.getDate()).padStart(2, '0')
      return { start: `${sYear}-${sMonth}-${sDay}`, end: today }
    default:
      return { start: customStartDate.value, end: customEndDate.value }
  }
}

// 选择时间范围
function selectTimeRange(range) {
  selectedTimeRange.value = range
  loadStats()
}

// 加载统计数据
async function loadStats() {
  const { start, end } = getDateRange(selectedTimeRange.value)

  if (!start || !end) {
    error.value = '请选择日期范围'
    return
  }

  loading.value = true
  error.value = ''

  try {
    const response = await axios.get(`${API_BASE}/api/logs/stats`, {
      params: { startDate: start, endDate: end }
    })

    stats.value = response.data.stats
    await loadRecentCalls(start, end)
  } catch (err) {
    error.value = err.response?.data?.error || err.message || '加载统计数据失败'
  } finally {
    loading.value = false
  }
}

async function loadRecentCalls(start, end) {
  try {
    const response = await axios.get(`${API_BASE}/api/logs`, {
      params: {
        startDate: start,
        endDate: end,
        type: 'API_REQUEST',
        limit: 50,
        offset: 0
      }
    })

    recentCalls.value = (response.data.logs || []).map(mapRecentCall)
  } catch (err) {
    recentCalls.value = []
    console.error('Error loading recent API requests:', err)
  }
}

// 刷新统计数据（强制重新加载）
async function refreshStats() {
  const { start, end } = getDateRange(selectedTimeRange.value)

  if (!start || !end) {
    error.value = '请选择日期范围'
    return
  }

  refreshing.value = true
  error.value = ''

  try {
    await axios.post(`${API_BASE}/api/logs/stats/refresh`, {
      startDate: start,
      endDate: end
    })

    // 刷新成功后重新加载
    await loadStats()
  } catch (err) {
    error.value = err.response?.data?.error || err.message || '刷新统计数据失败'
  } finally {
    refreshing.value = false
  }
}

// 格式化数字
function formatNumber(num) {
  if (num === undefined || num === null) return '0'
  return num.toLocaleString()
}

// 格式化货币
function formatCurrency(amount, currency) {
  if (amount === undefined || amount === null) return '$0.00'
  return `${currency} ${amount.toFixed(2)}`
}

// 格式化时长（毫秒转秒）
function formatDuration(ms) {
  if (ms === undefined || ms === null || ms === 0) return '-'
  const seconds = ms / 1000
  return seconds < 1 ? `${ms.toFixed(0)}ms` : `${seconds.toFixed(2)}s`
}

// 计算成功率
function calculateRate(item) {
  if (item.total === 0) return 0
  return ((item.success / item.total) * 100).toFixed(2)
}

// 计算成本占比
function calculateCostShare(provider, providerName) {
  if (!stats.value.costStats || stats.value.costStats.totalCost === 0) return 0
  const providerTotalCost = (provider.avgDuration || 0) * provider.total
  return ((providerTotalCost / stats.value.costStats.totalCost) * 100).toFixed(2)
}

// 获取成功率样式类
function getRateClass(item) {
  const rate = parseFloat(calculateRate(item))
  if (rate >= 99) return 'rate-excellent'
  if (rate >= 95) return 'rate-good'
  if (rate >= 90) return 'rate-medium'
  return 'rate-poor'
}

function getBalanceClass(row) {
  if (row.totalSuccess === 0) return 'skewed'
  if (row.providerCount <= 1) return 'single'
  if (row.spread <= 1) return 'balanced'
  if (row.spread <= Math.max(2, Math.ceil(row.totalSuccess * 0.15))) return 'watch'
  return 'skewed'
}

function getBalanceText(row) {
  if (row.totalSuccess === 0) return '无成功'
  if (row.providerCount <= 1) return '单 Provider'
  if (row.spread <= 1) return '均衡'
  return `差 ${formatNumber(row.spread)} 次`
}

function mapRecentCall(log) {
  const request = log.data?.request || {}
  const result = log.data?.result || {}
  const providers = Array.isArray(log.data?.providers) ? log.data.providers : []
  const attempts = providers
    .map(provider => ({
      attempt: provider.attempt || 0,
      providerName: provider.providerName || '-',
      status: provider.status === 'success' ? 'success' : 'failed',
      statusCode: provider.statusCode || null,
      error: provider.error || ''
    }))
    .sort((a, b) => a.attempt - b.attempt)
  const successProvider =
    providers.find(provider => provider.providerId === result.successfulProvider) ||
    providers.find(provider => provider.status === 'success') ||
    providers[0]

  return {
    id: `${log.timestamp}-${log.traceId}`,
    time: formatDateTime(log.timestamp),
    model: request.model || '-',
    providerName: successProvider?.providerName || attempts[0]?.providerName || '-',
    apiKeyName: request.apiKeyName || '-',
    isPolling: Boolean(request.isPolling),
    totalAttempts: result.totalAttempts || attempts.length || 0,
    attempts,
    duration: result.totalDuration || successProvider?.duration || 0,
    status: result.status === 'success' ? 'success' : 'failed'
  }
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

// 获取趋势样式类（模拟）
function getTrendClass() {
  return 'trend-up'
}

function getTrendIcon() {
  return '↗'
}

function getTrendPercent() {
  return '0%'
}

// 初始化
onMounted(() => {
  loadStats()
})
</script>

<style scoped>
.stats-dashboard {
  padding: clamp(16px, 2vw, 24px);
  max-width: min(100%, 1680px);
  margin: 0 auto;
}

h1 {
  font-size: 2.15rem;
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1.05;
  color: #0f172a;
  margin-bottom: 24px;
  text-wrap: balance;
}

h2 {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #0f172a;
  margin-bottom: 16px;
}

/* 时间范围选择器 */
.time-range-selector {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 32px;
  flex-wrap: wrap;
  padding: 16px 18px;
  border-radius: 22px;
  background: rgba(255,255,255,0.96);
  border: 1px solid rgba(226, 232, 240, 0.92);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
}

.time-range-btn {
  padding: 10px 18px;
  border: 1px solid rgba(203, 213, 225, 0.9);
  border-radius: 999px;
  background: rgba(255,255,255,0.9);
  color: #64748b;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.22s ease;
}

.time-range-btn:hover {
  border-color: #0891b2;
  color: #0f172a;
  transform: translateY(-1px);
}

.time-range-btn.active {
  background: #0891b2;
  color: white;
  border-color: transparent;
  box-shadow: 0 12px 24px rgba(8, 145, 178, 0.2);
}

.custom-range {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  border-left: 1px solid #e0e0e0;
  flex-wrap: wrap;
}

.date-input {
  padding: 8px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 10px;
  font-size: 14px;
  color: #333;
  min-width: 150px;
}

.apply-btn {
  padding: 8px 16px;
  background: #0891b2;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.apply-btn:hover {
  background: #0e7490;
}

.refresh-btn {
  padding: 9px 16px;
  background: #0891b2;
  color: white;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 700;
  transition: background-color 0.18s ease, opacity 0.18s ease;
  box-shadow: 0 6px 14px rgba(8, 145, 178, 0.14);
}

.refresh-btn:hover:not(:disabled) {
  opacity: 0.96;
}

.refresh-btn:disabled {
  background: #d9d9d9;
  cursor: not-allowed;
}

.refresh-btn.loading {
  opacity: 0.7;
}

/* 加载和错误 */
.loading {
  text-align: center;
  padding: 60px 20px;
  color: #999;
  font-size: 16px;
}

.error-message {
  padding: 20px;
  background: #fff2f0;
  color: #f5222d;
  border-radius: 8px;
  margin-bottom: 20px;
  font-size: 15px;
}

/* 统计内容 */
.stats-content {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

/* 概览卡片 */
.overview-section {
  background: rgba(255, 255, 255, 0.98);
  border-radius: 26px;
  padding: 26px;
  border: 1px solid rgba(226, 232, 240, 0.95);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 20px;
}

.stat-card {
  background: linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(246,249,252,0.95) 100%);
  border-radius: 22px;
  padding: 22px;
  border: 1px solid rgba(226, 232, 240, 0.95);
  transition: border-color 0.18s ease, background-color 0.18s ease;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.7), 0 6px 14px rgba(15, 23, 42, 0.04);
}

.stat-card:hover {
  border-color: rgba(203, 213, 225, 1);
  background: linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(246,249,252,0.97) 100%);
}

.stat-card.success {
  background: #e8f5e9;
  border-color: #c3e6cb;
}

.stat-card.warning {
  background: #fff3e0;
  border-color: #ffe0b2;
}

.stat-card.info {
  background: #e3f2fd;
  border-color: #bbdefb;
}

.card-label {
  font-size: 13px;
  color: #666;
  margin-bottom: 8px;
}

.card-value {
  font-size: 30px;
  font-weight: 800;
  letter-spacing: -0.04em;
  color: #0f172a;
  margin-bottom: 4px;
}

.card-rate {
  font-size: 13px;
  color: #52c41a;
  font-weight: 500;
}

.card-sub {
  font-size: 13px;
  color: #999;
  margin-top: 4px;
}

.card-trend {
  font-size: 13px;
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.token-total-cell {
  font-weight: 700;
  color: #1677ff;
}

.card-trend.trend-up {
  color: #52c41a;
}

.card-trend.trend-down {
  color: #f5222d;
}

/* 各个统计部分 */
.providers-section,
.distribution-section,
.recent-section,
.models-section,
.apikeys-section,
.performance-section {
  background: rgba(255, 255, 255, 0.99);
  border-radius: 26px;
  padding: 24px;
  border: 1px solid rgba(226, 232, 240, 0.95);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.04);
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.section-heading h2 {
  margin-bottom: 0;
}

.distribution-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.model-select {
  min-width: 220px;
  height: 38px;
  padding: 0 12px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #fff;
  color: #0f172a;
  font-size: 14px;
}

.checkbox-control {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #475569;
  font-size: 14px;
  white-space: nowrap;
}

.section-hint {
  color: #64748b;
  font-size: 13px;
}

/* 表格 */
.table-container {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.stats-table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
}

.stats-table th {
  text-align: left;
  padding: 12px 16px;
  background: #f7f8fa;
  color: #666;
  font-weight: 600;
  font-size: 14px;
  border-bottom: 2px solid #e5e7eb;
}

.stats-table td {
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  font-size: 14px;
  color: #333;
}

.stats-table tbody tr:hover {
  background: #f7f8fa;
}

.provider-name {
  font-weight: 600;
  color: #1a1a1a;
}

.model-name-cell {
  font-weight: 700;
  color: #0f172a;
  word-break: break-all;
}

.distribution-table {
  min-width: 860px;
}

.recent-table {
  min-width: 1120px;
}

.distribution-table th:last-child,
.distribution-table td:last-child {
  min-width: 360px;
}

.empty-cell {
  text-align: center;
  color: #64748b;
  padding: 28px 16px;
}

.balance-badge {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.balance-badge.balanced {
  background: #dcfce7;
  color: #166534;
}

.balance-badge.watch {
  background: #fef3c7;
  color: #92400e;
}

.balance-badge.skewed {
  background: #fee2e2;
  color: #991b1b;
}

.balance-badge.single {
  background: #e2e8f0;
  color: #334155;
}

.provider-distribution-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.provider-distribution-item {
  min-width: 0;
}

.provider-distribution-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 5px;
  color: #475569;
  font-size: 13px;
}

.provider-name-inline {
  color: #0f172a;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.distribution-bar {
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: #e2e8f0;
}

.distribution-bar span {
  display: block;
  height: 100%;
  min-width: 3px;
  border-radius: inherit;
  background: #0891b2;
}

.attempt-chain {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 240px;
}

.attempt-chip {
  display: inline-flex;
  align-items: center;
  max-width: 220px;
  min-height: 24px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attempt-chip.success {
  background: #dcfce7;
  color: #166534;
}

.attempt-chip.failed {
  background: #fee2e2;
  color: #991b1b;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.status-badge.success {
  background: #dcfce7;
  color: #166534;
}

.status-badge.failed {
  background: #fee2e2;
  color: #991b1b;
}

/* 成功率样式 */
.rate-excellent {
  color: #52c41a;
  font-weight: 600;
}

.rate-good {
  color: #52c41a;
}

.rate-medium {
  color: #faad14;
  font-weight: 500;
}

.rate-poor {
  color: #f5222d;
  font-weight: 600;
}

/* 性能网格 */
.performance-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
}

.perf-card {
  background: #f7f8fa;
  border-radius: 10px;
  padding: 20px;
  border: 1px solid #e5e7eb;
  text-align: center;
}

.perf-label {
  font-size: 13px;
  color: #666;
  margin-bottom: 8px;
}

.perf-value {
  font-size: 24px;
  font-weight: 700;
  color: #1890ff;
}

/* 响应式 */
@media (min-width: 1600px) {
  .stats-dashboard {
    max-width: 1880px;
  }

  .cards-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .performance-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (min-width: 1920px) {
  .stats-dashboard {
    max-width: 2100px;
    padding-inline: clamp(24px, 2.8vw, 40px);
  }

  .cards-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  .card-value {
    font-size: 34px;
  }
}

@media (max-width: 1024px) {
  .time-range-selector {
    align-items: stretch;
  }

  .custom-range {
    width: 100%;
    padding: 12px 0 0;
    border-left: none;
    border-top: 1px solid #e0e0e0;
  }

  .refresh-btn {
    margin-left: auto;
  }

  .performance-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .stats-dashboard {
    padding: 16px;
  }

  h1 {
    font-size: 1.7rem;
    margin-bottom: 20px;
  }

  h2 {
    font-size: 1.1rem;
  }

  .time-range-selector {
    flex-direction: column;
    align-items: stretch;
    padding: 14px;
    border-radius: 18px;
  }

  .time-range-btn,
  .refresh-btn,
  .apply-btn {
    min-height: 42px;
  }

  .custom-range {
    gap: 10px;
  }

  .date-input,
  .apply-btn,
  .refresh-btn {
    width: 100%;
  }

  .overview-section,
  .providers-section,
  .distribution-section,
  .recent-section,
  .models-section,
  .apikeys-section,
  .performance-section {
    padding: 18px;
    border-radius: 20px;
  }

  .cards-grid {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .stat-card {
    padding: 18px;
    border-radius: 18px;
  }

  .card-value {
    font-size: 26px;
  }

  .performance-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .stats-table {
    min-width: 640px;
  }

  .distribution-table {
    min-width: 820px;
  }

  .recent-table {
    min-width: 1040px;
  }

  .stats-table th,
  .stats-table td {
    padding: 10px 12px;
    font-size: 13px;
  }
}

@media (max-width: 480px) {
  .stats-dashboard {
    padding: 12px;
  }

  h1 {
    font-size: 1.45rem;
  }

  .time-range-selector,
  .overview-section,
  .providers-section,
  .distribution-section,
  .recent-section,
  .models-section,
  .apikeys-section,
  .performance-section {
    padding: 14px;
    border-radius: 16px;
  }

  .custom-range {
    flex-direction: column;
    align-items: stretch;
    padding-top: 10px;
  }

  .model-select,
  .distribution-controls {
    width: 100%;
  }

  .performance-grid {
    grid-template-columns: 1fr;
  }

  .perf-card {
    padding: 16px;
  }

  .card-sub {
    line-height: 1.5;
  }
}
</style>
