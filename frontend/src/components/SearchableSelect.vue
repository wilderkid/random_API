<template>
  <div ref="rootRef" class="searchable-select" :class="[{ disabled, open: isOpen }, sizeClass]">
    <button
      type="button"
      class="searchable-select-trigger"
      :class="triggerClass"
      :disabled="disabled"
      @click="toggleDropdown"
    >
      <span class="searchable-select-value" :class="{ placeholder: !selectedOption }">
        {{ selectedOption ? getOptionLabel(selectedOption) : placeholder }}
      </span>
      <span class="searchable-select-arrow">{{ isOpen ? '▲' : '▼' }}</span>
    </button>

    <div v-if="isOpen" class="searchable-select-dropdown" :class="dropdownClass">
      <input
        v-if="searchable"
        ref="searchInputRef"
        v-model="searchQuery"
        type="text"
        class="searchable-select-search"
        :placeholder="searchPlaceholder"
        @click.stop
      >

      <div ref="optionsContainerRef" class="searchable-select-options">
        <button
          v-for="option in filteredOptions"
          :key="getOptionValue(option)"
          type="button"
          :ref="el => setOptionRef(getOptionValue(option), el)"
          class="searchable-select-option"
          :class="{ active: isSelected(option) }"
          @click="selectOption(option)"
        >
          <span class="searchable-select-option-label">{{ getOptionLabel(option) }}</span>
          <span v-if="option.description" class="searchable-select-option-description">{{ option.description }}</span>
        </button>

        <div v-if="filteredOptions.length === 0" class="searchable-select-empty">
          {{ emptyText }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  modelValue: {
    type: [String, Number, Boolean],
    default: ''
  },
  options: {
    type: Array,
    default: () => []
  },
  placeholder: {
    type: String,
    default: '请选择'
  },
  searchPlaceholder: {
    type: String,
    default: '搜索...'
  },
  emptyText: {
    type: String,
    default: '未找到匹配项'
  },
  labelField: {
    type: String,
    default: 'label'
  },
  valueField: {
    type: String,
    default: 'value'
  },
  searchable: {
    type: Boolean,
    default: true
  },
  disabled: {
    type: Boolean,
    default: false
  },
  size: {
    type: String,
    default: 'md'
  },
  triggerClass: {
    type: String,
    default: ''
  },
  dropdownClass: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['update:modelValue', 'change', 'open', 'close'])

const rootRef = ref(null)
const searchInputRef = ref(null)
const optionsContainerRef = ref(null)
const optionRefs = new Map()
const isOpen = ref(false)
const searchQuery = ref('')

const sizeClass = computed(() => `searchable-select--${props.size}`)

const selectedOption = computed(() => {
  return props.options.find(option => getOptionValue(option) === props.modelValue) || null
})

const filteredOptions = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return props.options

  return props.options.filter(option => {
    const label = String(getOptionLabel(option)).toLowerCase()
    const value = String(getOptionValue(option)).toLowerCase()
    const description = String(option.description || '').toLowerCase()
    return label.includes(query) || value.includes(query) || description.includes(query)
  })
})

function getOptionLabel(option) {
  return option?.[props.labelField] ?? option?.label ?? option?.name ?? option?.value ?? ''
}

function getOptionValue(option) {
  return option?.[props.valueField] ?? option?.value ?? option?.id ?? option?.name ?? ''
}

function isSelected(option) {
  return getOptionValue(option) === props.modelValue
}

function setOptionRef(value, el) {
  if (el) {
    optionRefs.set(value, el)
  } else {
    optionRefs.delete(value)
  }
}

function toggleDropdown() {
  if (props.disabled) return

  isOpen.value = !isOpen.value

  if (isOpen.value) {
    emit('open')
    nextTick(() => {
      if (props.searchable) {
        searchInputRef.value?.focus()
      }
      scrollToSelectedOption()
    })
  } else {
    closeDropdown()
  }
}

function closeDropdown() {
  if (!isOpen.value) return
  isOpen.value = false
  searchQuery.value = ''
  emit('close')
}

function selectOption(option) {
  const value = getOptionValue(option)
  emit('update:modelValue', value)
  emit('change', option)
  closeDropdown()
}

function scrollToSelectedOption() {
  if (!isOpen.value || props.modelValue === '' || props.modelValue === null || props.modelValue === undefined) return

  nextTick(() => {
    const selectedEl = optionRefs.get(props.modelValue)
    const container = optionsContainerRef.value
    if (!selectedEl || !container) return

    const containerRect = container.getBoundingClientRect()
    const optionRect = selectedEl.getBoundingClientRect()
    const offsetTop = selectedEl.offsetTop
    const targetScrollTop = offsetTop - (container.clientHeight / 2) + (selectedEl.clientHeight / 2)

    if (optionRect.top < containerRect.top || optionRect.bottom > containerRect.bottom) {
      container.scrollTop = Math.max(0, targetScrollTop)
    }
  })
}

function handleClickOutside(event) {
  if (rootRef.value && !rootRef.value.contains(event.target)) {
    closeDropdown()
  }
}

watch(searchQuery, () => {
  if (!isOpen.value) return
  nextTick(() => {
    scrollToSelectedOption()
  })
})

watch(() => props.modelValue, () => {
  if (isOpen.value) {
    nextTick(() => {
      scrollToSelectedOption()
    })
  }
})

watch(() => props.options, () => {
  if (isOpen.value) {
    nextTick(() => {
      scrollToSelectedOption()
    })
  }
}, { deep: true })

if (typeof document !== 'undefined') {
  document.addEventListener('click', handleClickOutside)
}

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('click', handleClickOutside)
  }
})
</script>

<style scoped>
.searchable-select {
  position: relative;
  width: 100%;
}

.searchable-select.disabled {
  opacity: 0.7;
}

.searchable-select-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid #dee2e6;
  background: #fff;
  color: #334155;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s ease;
}

.searchable-select-trigger:hover:not(:disabled) {
  border-color: #0891b2;
  box-shadow: 0 0 0 3px rgba(8, 145, 178, 0.08);
}

.searchable-select-trigger:disabled {
  cursor: not-allowed;
}

.searchable-select-trigger:focus-visible {
  outline: none;
  border-color: #0891b2;
  box-shadow: 0 0 0 3px rgba(8, 145, 178, 0.12);
}

.searchable-select--sm .searchable-select-trigger {
  min-height: 32px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
}

.searchable-select--md .searchable-select-trigger {
  min-height: 38px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 14px;
}

.searchable-select--lg .searchable-select-trigger {
  min-height: 42px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 14px;
}

.searchable-select-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.searchable-select-value.placeholder {
  color: #94a3b8;
}

.searchable-select-arrow {
  flex-shrink: 0;
  font-size: 10px;
  color: #64748b;
}

.searchable-select-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 1200;
  background: #fff;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  overflow: hidden;
}

.searchable-select-search {
  width: 100%;
  border: none;
  border-bottom: 1px solid #e9ecef;
  padding: 10px 12px;
  outline: none;
  font-size: 14px;
  background: #fff;
  color: #334155;
}

.searchable-select-search:focus {
  border-bottom-color: #0891b2;
}

.searchable-select-options {
  max-height: 260px;
  overflow-y: auto;
}

.searchable-select-option {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border: none;
  border-bottom: 1px solid #f1f5f9;
  background: #fff;
  color: #334155;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s ease;
}

.searchable-select-option:last-child {
  border-bottom: none;
}

.searchable-select-option:hover {
  background: #f8fafc;
}

.searchable-select-option.active {
  background: #e0f2fe;
  color: #0f766e;
  font-weight: 600;
}

.searchable-select-option-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.searchable-select-option-description {
  flex-shrink: 0;
  font-size: 12px;
  color: #64748b;
}

.searchable-select-empty {
  padding: 14px 12px;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
}
</style>
