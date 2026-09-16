<template>
  <div class="donut-wrap">
    <svg :viewBox="`0 0 ${size} ${size}`" class="donut-svg" role="img">
      <circle
        class="donut-track"
        :cx="center"
        :cy="center"
        :r="radius"
        fill="none"
        :stroke-width="stroke"
      />
      <circle
        v-for="slice in slices"
        :key="slice.label"
        class="donut-slice"
        :cx="center"
        :cy="center"
        :r="radius"
        fill="none"
        :stroke="slice.color"
        :stroke-width="stroke"
        :stroke-dasharray="slice.dash"
        :stroke-dashoffset="slice.offset"
        :transform="`rotate(-90 ${center} ${center})`"
      >
        <title>{{ slice.label }} {{ slice.value }}</title>
      </circle>
      <text :x="center" :y="center - 6" text-anchor="middle" class="donut-center-value">{{ centerValue }}</text>
      <text :x="center" :y="center + 14" text-anchor="middle" class="donut-center-label">{{ centerLabel }}</text>
    </svg>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  segments: { type: Array, default: () => [] },
  size: { type: Number, default: 168 },
  stroke: { type: Number, default: 22 },
  centerLabel: { type: String, default: '请求' },
  centerValue: { type: String, default: '0' }
})

const center = computed(() => props.size / 2)
const radius = computed(() => (props.size - props.stroke) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)

const slices = computed(() => {
  const total = props.segments.reduce((sum, item) => sum + Number(item.value || 0), 0)
  if (!total) return []
  let cursor = 0
  return props.segments
    .filter(item => Number(item.value || 0) > 0)
    .map(item => {
      const value = Number(item.value || 0)
      const length = (value / total) * circumference.value
      const slice = {
        label: item.label,
        value,
        color: item.color,
        dash: `${length} ${circumference.value - length}`,
        offset: -cursor
      }
      cursor += length
      return slice
    })
})
</script>

<style scoped>
.donut-wrap {
  width: min(100%, 180px);
  margin: 0 auto;
}

.donut-svg {
  width: 100%;
  height: auto;
  display: block;
}

.donut-track {
  stroke: var(--bg-soft);
}

.donut-slice {
  stroke-linecap: butt;
}

.donut-center-value {
  font-size: 18px;
  font-weight: 800;
  fill: var(--ink);
}

.donut-center-label {
  font-size: 11px;
  fill: var(--muted);
}
</style>
