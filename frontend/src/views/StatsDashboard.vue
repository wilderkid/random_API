<template>
  <div class="stats-page">
    <header class="page-head">
      <div>
        <h1>使用统计</h1>
        <p>模型、供应商、Token 和延迟</p>
      </div>
      <div class="head-actions">
        <div class="range-pills">
          <button
            v-for="range in timeRanges"
            :key="range.value"
            type="button"
            :class="['pill', { active: selectedTimeRange === range.value }]"
            @click="selectTimeRange(range.value)"
          >
            {{ range.label }}
          </button>
        </div>
        <div class="custom-range" v-if="selectedTimeRange === 'custom'">
          <input v-model="customStartDate" type="date" @change="loadStats">
          <span>至</span>
          <input v-model="customEndDate" type="date" @change="loadStats">
        </div>
        <button type="button" class="icon-btn" :disabled="refreshing" @click="refreshStats">
          <PhArrowClockwise :size="16" weight="bold" />
          {{ refreshing ? '刷新中' : '刷新' }}
        </button>
      </div>
    </header>

    <div v-if="loading" class="state-msg">加载统计数据中...</div>
    <div v-else-if="error" class="state-msg error">{{ error }}</div>

    <div v-else class="stats-body">
      <section class="overview-grid">
        <article class="metric-card">
          <div class="metric-icon mint">
            <PhChartBar :size="18" weight="bold" />
          </div>
          <div>
            <div class="metric-label">总请求数</div>
            <div class="metric-value">{{ formatNumber(stats.totalApiCalls) }}</div>
            <div class="metric-sub">成功 {{ formatNumber(stats.successfulCalls) }} / 失败 {{ formatNumber(stats.failedCalls) }}</div>
          </div>
        </article>
        <article class="metric-card">
          <div class="metric-icon peach">
            <PhStack :size="18" weight="bold" />
          </div>
          <div>
            <div class="metric-label">总 Token</div>
            <div class="metric-value">{{ formatCompact(tokenTotals.total) }}</div>
            <div class="metric-sub">输入 {{ formatCompact(tokenTotals.prompt) }} / 输出 {{ formatCompact(tokenTotals.completion) }}</div>
          </div>
        </article>
        <article class="metric-card">
          <div class="metric-icon mint">
            <PhClock :size="18" weight="bold" />
          </div>
          <div>
            <div class="metric-label">平均耗时</div>
            <div class="metric-value">{{ formatDuration(stats.performanceStats?.avgDuration) }}</div>
            <div class="metric-sub">最小 {{ formatDuration(stats.performanceStats?.minDuration) }}</div>
          </div>
        </article>
        <article class="metric-card">
          <div class="metric-icon peach">
            <PhLightning :size="18" weight="bold" />
          </div>
          <div>
            <div class="metric-label">平均首字</div>
            <div class="metric-value">{{ formatDuration(stats.performanceStats?.avgFirstTokenMs) }}</div>
            <div class="metric-sub">样本 {{ formatNumber(stats.performanceStats?.firstTokenCount || 0) }}</div>
          </div>
        </article>
      </section>

      <section class="split-grid">
        <article class="panel">
          <div class="panel-head">
            <h2>模型分布</h2>
            <span>{{ modelSegments.length }} 个模型</span>
          </div>
          <div class="panel-body">
            <DonutChart
              :segments="modelSegments"
              :center-value="formatCompact(stats.totalApiCalls)"
              center-label="请求"
            />
            <div class="table-scroll">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>请求</th>
                    <th>Token</th>
                    <th>占比</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="modelRows.length === 0">
                    <td colspan="4" class="empty">暂无模型数据</td>
                  </tr>
                  <tr v-for="row in modelRows" :key="row.name">
                    <td>
                      <span class="swatch" :style="{ background: row.color }"></span>
                      {{ row.name }}
                    </td>
                    <td>{{ formatNumber(row.total) }}</td>
                    <td>{{ formatCompact(row.totalTokens) }}</td>
                    <td>{{ row.share }}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-head">
            <h2>供应商分布</h2>
            <span>{{ providerRows.length }} 个供应商</span>
          </div>
          <div class="panel-body">
            <DonutChart
              :segments="providerSegments"
              :center-value="formatCompact(providerRequestTotal)"
              center-label="成功"
            />
            <div class="table-scroll">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>供应商</th>
                    <th>请求</th>
                    <th>Token</th>
                    <th>成功率</th>
                    <th>首字</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="providerRows.length === 0">
                    <td colspan="5" class="empty">暂无供应商数据</td>
                  </tr>
                  <tr v-for="row in providerRows" :key="row.name">
                    <td>
                      <span class="swatch" :style="{ background: row.color }"></span>
                      {{ row.name }}
                    </td>
                    <td>{{ formatNumber(row.success || row.total) }}</td>
                    <td>{{ formatCompact(row.totalTokens) }}</td>
                    <td>{{ rateText(row) }}</td>
                    <td>{{ formatDuration(row.avgFirstTokenMs) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </article>
      </section>

      <section class="split-grid">
        <article class="panel">
          <div class="panel-head">
            <h2>端点分布</h2>
          </div>
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>端点</th>
                  <th>请求</th>
                  <th>Token</th>
                  <th>成功率</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="endpointRows.length === 0">
                  <td colspan="4" class="empty">暂无端点数据</td>
                </tr>
                <tr v-for="row in endpointRows" :key="row.name">
                  <td>{{ row.name }}</td>
                  <td>{{ formatNumber(row.total) }}</td>
                  <td>{{ formatCompact(row.totalTokens) }}</td>
                  <td>{{ rateText(row) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="panel">
          <div class="panel-head">
            <h2>Token 趋势</h2>
          </div>
          <div v-if="timelinePoints.length === 0" class="empty-block">暂无趋势数据</div>
          <svg v-else class="trend-svg" viewBox="0 0 640 220" preserveAspectRatio="none">
            <polyline class="trend-line input" :points="promptLine" fill="none" />
            <polyline class="trend-line output" :points="completionLine" fill="none" />
            <line v-for="tick in 4" :key="tick" class="trend-grid" x1="36" :x2="628" :y1="20 + tick * 40" :y2="20 + tick * 40" />
          </svg>
          <div class="trend-legend">
            <span><i class="dot mint"></i>输入</span>
            <span><i class="dot peach"></i>输出</span>
          </div>
        </article>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>最近调用</h2>
          <span>最多 50 条</span>
        </div>
        <div class="table-scroll">
          <table class="data-table recent-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>模型</th>
                <th>供应商</th>
                <th>密钥</th>
                <th>Token</th>
                <th>首字</th>
                <th>耗时</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="recentCalls.length === 0">
                <td colspan="8" class="empty">暂无最近调用</td>
              </tr>
              <tr v-for="call in recentCalls" :key="call.id">
                <td>{{ call.time }}</td>
                <td>{{ call.model }}</td>
                <td>{{ call.providerName }}</td>
                <td>{{ call.apiKeyName }}</td>
                <td class="token-cell">
                  <span class="in">{{ formatNumber(call.promptTokens) }}</span>
                  <span class="out">{{ formatNumber(call.completionTokens) }}</span>
                </td>
                <td>{{ formatDuration(call.firstTokenMs) }}</td>
                <td>{{ formatDuration(call.duration) }}</td>
                <td><span :class="['status-pill', call.status]">{{ call.status === 'success' ? '成功' : '失败' }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { PhArrowClockwise, PhChartBar, PhClock, PhLightning, PhStack } from '@phosphor-icons/vue'
import DonutChart from '../components/DonutChart.vue'
import { USAGE_COLORS, formatCompact, formatDateTime, formatDuration, formatNumber, pickTokenUsage } from '../utils/usageFormat.js'

const API_BASE = window.location.origin
const timeRanges = [
  { value: 'today', label: '今日' },
  { value: 'yesterday', label: '昨天' },
  { value: '7days', label: '最近7天' },
  { value: 'custom', label: '自定义' }
]

const loading = ref(false)
const refreshing = ref(false)
const error = ref('')
const stats = ref({
  totalApiCalls: 0,
  successfulCalls: 0,
  failedCalls: 0,
  providerStats: {},
  modelStats: {},
  endpointStats: {},
  timeline: {},
  tokenStats: {},
  performanceStats: {}
})
const recentCalls = ref([])
const selectedTimeRange = ref('today')
const customStartDate = ref('')
const customEndDate = ref('')

const tokenTotals = computed(() => ({
  prompt: Number(stats.value.tokenStats?.totalPromptTokens || 0),
  completion: Number(stats.value.tokenStats?.totalCompletionTokens || 0),
  total: Number(stats.value.tokenStats?.totalTokens || 0)
}))

const modelRows = computed(() => {
  const entries = Object.entries(stats.value.modelStats || {})
  const total = entries.reduce((sum, [, item]) => sum + Number(item.total || 0), 0) || 1
  return entries
    .map(([name, item], index) => ({
      name,
      ...item,
      color: USAGE_COLORS[index % USAGE_COLORS.length],
      share: ((Number(item.total || 0) / total) * 100).toFixed(1)
    }))
    .sort((a, b) => Number(b.total || 0) - Number(a.total || 0))
})

const modelSegments = computed(() =>
  modelRows.value.map(row => ({ label: row.name, value: row.total, color: row.color }))
)

const providerRows = computed(() => {
  const entries = Object.entries(stats.value.providerStats || {})
  return entries
    .map(([name, item], index) => ({
      name,
      ...item,
      color: USAGE_COLORS[index % USAGE_COLORS.length]
    }))
    .sort((a, b) => Number(b.success || b.total || 0) - Number(a.success || a.total || 0))
})

const providerSegments = computed(() =>
  providerRows.value.map(row => ({
    label: row.name,
    value: Number(row.success || 0) || Number(row.total || 0),
    color: row.color
  }))
)

const providerRequestTotal = computed(() =>
  providerSegments.value.reduce((sum, item) => sum + Number(item.value || 0), 0)
)

const endpointRows = computed(() =>
  Object.entries(stats.value.endpointStats || {})
    .map(([name, item]) => ({ name, ...item }))
    .sort((a, b) => Number(b.total || 0) - Number(a.total || 0))
)

const timelinePoints = computed(() =>
  Object.entries(stats.value.timeline || {})
    .map(([label, item]) => ({ label, ...item }))
    .sort((a, b) => a.label.localeCompare(b.label))
)

const promptLine = computed(() => buildTrendLine(timelinePoints.value, 'totalPromptTokens'))
const completionLine = computed(() => buildTrendLine(timelinePoints.value, 'totalCompletionTokens'))

function buildTrendLine(points, key) {
  if (!points.length) return ''
  const max = Math.max(...points.map(item => Number(item[key] || 0)), 1)
  return points.map((item, index) => {
    const x = 36 + (index * (592 / Math.max(points.length - 1, 1)))
    const y = 180 - (Number(item[key] || 0) / max) * 150
    return `${x},${y}`
  }).join(' ')
}

function rateText(item) {
  const total = Number(item.total || 0)
  if (!total) return '-'
  return `${((Number(item.success || 0) / total) * 100).toFixed(1)}%`
}

function getDateRange(range) {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  const stamp = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const today = stamp(now)
  if (range === 'today') return { start: today, end: today }
  if (range === 'yesterday') {
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    const value = stamp(yesterday)
    return { start: value, end: value }
  }
  if (range === '7days') {
    const start = new Date(now)
    start.setDate(now.getDate() - 6)
    return { start: stamp(start), end: today }
  }
  return { start: customStartDate.value, end: customEndDate.value }
}

function selectTimeRange(range) {
  selectedTimeRange.value = range
  loadStats()
}

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
    stats.value = response.data.stats || {}
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
        type: 'API_REQUEST,API_CALL',
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

async function refreshStats() {
  const { start, end } = getDateRange(selectedTimeRange.value)
  if (!start || !end) return
  refreshing.value = true
  try {
    await axios.post(`${API_BASE}/api/logs/stats/refresh`, { startDate: start, endDate: end })
    await loadStats()
  } catch (err) {
    error.value = err.response?.data?.error || err.message || '刷新统计数据失败'
  } finally {
    refreshing.value = false
  }
}

function mapRecentCall(log) {
  const request = log.data?.request || {}
  const result = log.data?.result || {}
  const providers = Array.isArray(log.data?.providers) ? log.data.providers : []
  const successProvider =
    providers.find(item => item.providerId === result.successfulProvider) ||
    providers.find(item => item.status === 'success') ||
    providers[0]
  const tokens = pickTokenUsage(result.tokenUsage || log.data?.tokenUsage)
  const success = result.status ? result.status === 'success' : log.data?.status === 'SUCCESS'
  return {
    id: `${log.timestamp}-${log.traceId || Math.random()}`,
    time: formatDateTime(log.timestamp),
    model: request.model || log.data?.model || '-',
    providerName: successProvider?.providerName || log.data?.provider || '-',
    apiKeyName: request.apiKeyName || log.metadata?.apiKeyName || '-',
    promptTokens: tokens.prompt,
    completionTokens: tokens.completion,
    firstTokenMs: result.firstTokenMs ?? successProvider?.firstTokenMs ?? log.data?.firstTokenMs ?? null,
    duration: result.totalDuration ?? successProvider?.duration ?? log.data?.duration ?? null,
    status: success ? 'success' : 'failed'
  }
}

onMounted(loadStats)
</script>

<style scoped>
.stats-page {
  padding: clamp(16px, 2vw, 24px);
  max-width: min(100%, 1680px);
  margin: 0 auto;
}

.page-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-end;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

h1 {
  font-size: 1.85rem;
  font-weight: 800;
  color: var(--ink);
  letter-spacing: 0;
}

.page-head p {
  color: var(--muted);
  margin-top: 4px;
  font-size: 0.92rem;
}

.head-actions,
.range-pills,
.custom-range {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pill,
.icon-btn {
  min-height: 34px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink-soft);
  padding: 0 14px;
  font-weight: 700;
  cursor: pointer;
}

.pill.active,
.icon-btn {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.custom-range input {
  min-height: 34px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0 10px;
  background: var(--surface);
}

.overview-grid,
.split-grid {
  display: grid;
  gap: 16px;
  margin-bottom: 16px;
}

.overview-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.split-grid {
  grid-template-columns: 1fr 1fr;
}

.metric-card,
.panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: var(--shadow-soft);
}

.metric-card {
  display: flex;
  gap: 12px;
  padding: 16px 18px;
  align-items: flex-start;
}

.metric-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  color: white;
  flex: none;
}

.metric-icon.mint { background: var(--accent); }
.metric-icon.peach { background: var(--pink); }

.metric-label,
.panel-head span,
.metric-sub {
  color: var(--muted);
  font-size: 12px;
}

.metric-value {
  font-size: 1.6rem;
  font-weight: 800;
  color: var(--ink);
  letter-spacing: 0;
}

.panel {
  padding: 16px;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 12px;
}

h2 {
  font-size: 1.05rem;
  color: var(--ink);
}

.panel-body {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 16px;
  align-items: center;
}

.table-scroll {
  overflow: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 420px;
}

.data-table th,
.data-table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
  white-space: nowrap;
}

.data-table th {
  color: var(--muted);
  font-weight: 700;
}

.swatch {
  width: 8px;
  height: 8px;
  border-radius: 99px;
  display: inline-block;
  margin-right: 6px;
}

.empty,
.empty-block,
.state-msg {
  text-align: center;
  color: var(--muted);
  padding: 24px 8px;
}

.state-msg.error { color: var(--bad); }

.trend-svg {
  width: 100%;
  height: 220px;
  background: var(--bg-soft);
  border-radius: 12px;
}

.trend-line.input { stroke: var(--accent); stroke-width: 2.5; }
.trend-line.output { stroke: var(--pink); stroke-width: 2.5; }
.trend-grid { stroke: rgba(36, 85, 60, 0.08); }

.trend-legend {
  display: flex;
  gap: 16px;
  margin-top: 10px;
  color: var(--muted);
  font-size: 12px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 99px;
  display: inline-block;
  margin-right: 6px;
}
.dot.mint { background: var(--accent); }
.dot.peach { background: var(--pink); }

.token-cell {
  display: flex;
  gap: 8px;
}

.token-cell .in { color: var(--accent); }
.token-cell .out { color: var(--pink-strong); }

.status-pill {
  display: inline-flex;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.status-pill.success {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.status-pill.failed {
  background: var(--pink-soft);
  color: var(--pink-strong);
}

.recent-table { min-width: 860px; }

@media (max-width: 1100px) {
  .overview-grid,
  .split-grid,
  .panel-body {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .overview-grid { grid-template-columns: 1fr; }
  h1 { font-size: 1.45rem; }
}
</style>
