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
            <div class="card-label">Token使用量</div>
            <div class="card-value">{{ formatNumber(stats.tokenStats.totalTokens) }}</div>
            <div class="card-sub">
              {{ formatNumber(stats.tokenStats.totalPromptTokens) }} / {{ formatNumber(stats.tokenStats.totalCompletionTokens) }}
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
                <th>请求数</th>
                <th>成功率</th>
                <th>平均响应时间</th>
                <th>成本占比</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(provider, name) in stats.providerStats" :key="name">
                <td class="provider-name">{{ name }}</td>
                <td>{{ formatNumber(provider.total) }}</td>
                <td :class="getRateClass(provider)">{{ calculateRate(provider) }}%</td>
                <td>{{ formatDuration(provider.avgDuration) }}</td>
                <td v-if="stats.costStats">
                  {{ calculateCostShare(provider, name) }}%
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
                <th>调用次数</th>
                <th>成功率</th>
                <th>平均响应时间</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(provider, providerName) in stats.providerStats" :key="providerName">
                <tr v-for="(model, modelName) in provider.models" :key="`${providerName}-${modelName}`">
                  <td>{{ providerName }}</td>
                  <td>{{ modelName }}</td>
                  <td>{{ formatNumber(model.total) }}</td>
                  <td :class="getRateClass(model)">{{ calculateRate(model) }}%</td>
                  <td>{{ formatDuration(model.avgDuration) }}</td>
                </tr>
              </template>
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
                <th>调用次数</th>
                <th>成功率</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(provider, providerName) in stats.providerStats" :key="providerName">
                <tr v-for="(apiKey, keyName) in provider.apiKeys" :key="`${providerName}-${keyName}`">
                  <td>{{ providerName }}</td>
                  <td>{{ keyName }}</td>
                  <td>{{ formatNumber(apiKey.total) }}</td>
                  <td :class="getRateClass(apiKey)">{{ calculateRate(apiKey) }}%</td>
                </tr>
              </template>
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
const selectedTimeRange = ref('today')
const customStartDate = ref('')
const customEndDate = ref('')

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
  } catch (err) {
    error.value = err.response?.data?.error || err.message || '加载统计数据失败'
  } finally {
    loading.value = false
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
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
}

h1 {
  font-size: 28px;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 24px;
}

h2 {
  font-size: 20px;
  font-weight: 600;
  color: #333;
  margin-bottom: 16px;
}

/* 时间范围选择器 */
.time-range-selector {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 32px;
  flex-wrap: wrap;
}

.time-range-btn {
  padding: 10px 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: white;
  color: #666;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.time-range-btn:hover {
  border-color: #1890ff;
  color: #1890ff;
}

.time-range-btn.active {
  background: #1890ff;
  color: white;
  border-color: #1890ff;
}

.custom-range {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  border-left: 1px solid #e0e0e0;
}

.date-input {
  padding: 8px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  font-size: 14px;
  color: #333;
}

.apply-btn {
  padding: 8px 16px;
  background: #1890ff;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.apply-btn:hover {
  background: #0066cc;
}

.refresh-btn {
  padding: 8px 16px;
  background: #52c41a;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  background: #389e0d;
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
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
}

.stat-card {
  background: #f7f8fa;
  border-radius: 10px;
  padding: 20px;
  border: 1px solid #e5e7eb;
  transition: transform 0.2s, box-shadow 0.2s;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
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
  font-size: 28px;
  font-weight: 700;
  color: #1a1a1a;
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

.card-trend.trend-up {
  color: #52c41a;
}

.card-trend.trend-down {
  color: #f5222d;
}

/* 各个统计部分 */
.providers-section,
.models-section,
.apikeys-section,
.performance-section {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

/* 表格 */
.table-container {
  overflow-x: auto;
}

.stats-table {
  width: 100%;
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
  grid-template-columns: repeat(4, 1fr);
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
@media (max-width: 768px) {
  .stats-dashboard {
    padding: 16px;
  }

  .time-range-selector {
    flex-direction: column;
    align-items: stretch;
  }

  .cards-grid {
    grid-template-columns: 1fr;
  }

  .performance-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .stats-table th,
  .stats-table td {
    padding: 10px 12px;
    font-size: 13px;
  }
}
</style>
