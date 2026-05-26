<template>
  <div class="user-settings-container">
    <!-- 左侧配置列表 -->
    <div class="settings-sidebar">
      <div class="sidebar-header">
        <h3>配置项目</h3>
      </div>
      
      <div class="settings-list">
        <div
          v-for="item in settingsItems"
          :key="item.id"
          :class="['settings-item', { active: selectedSetting === item.id }]"
          @click="selectSetting(item.id)"
        >
          <div class="settings-item-icon">{{ item.icon }}</div>
          <div class="settings-item-info">
            <div class="settings-item-name">{{ item.name }}</div>
            <div class="settings-item-desc">{{ item.description }}</div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 右侧配置详情 -->
    <div class="settings-details-panel">
      <div v-if="selectedSetting === 'user'" class="details-content">
        <div class="details-header">
          <h2>用户配置</h2>
        </div>
        
        <div class="settings-form">
          <section class="settings-section">
            <h3>默认模型参数</h3>
            <label>
              温度 (Temperature):
              <input v-model.number="settings.defaultParams.temperature" type="number" step="0.1" min="0" max="2" class="input-field">
            </label>
            <label>
              最大长度 (Max Tokens):
              <input v-model.number="settings.defaultParams.max_tokens" type="number" class="input-field">
            </label>
            <label>
              Top P:
              <input v-model.number="settings.defaultParams.top_p" type="number" step="0.1" min="0" max="1" class="input-field">
            </label>
          </section>
          
          <section class="settings-section">
            <h3>全局调用频率</h3>
            <label>
              请求频率限制 (次/分钟):
              <input v-model.number="settings.globalFrequency" type="number" class="input-field">
            </label>
          </section>

          <button @click="saveSettings" class="btn-save">保存设置</button>
          <div v-if="saveMessage" class="save-message">{{ saveMessage }}</div>
        </div>
      </div>

      <div v-else-if="selectedSetting === 'password'" class="details-content">
        <div class="details-header">
          <h2>密码管理</h2>
        </div>

        <div class="settings-form">
          <section class="settings-section">
            <h3>修改登录密码</h3>
            <label>
              当前密码:
              <input v-model="passwordForm.currentPassword" type="password" class="input-field" autocomplete="current-password">
            </label>
            <label>
              新密码:
              <input v-model="passwordForm.newPassword" type="password" class="input-field" autocomplete="new-password">
            </label>
            <label>
              确认新密码:
              <input v-model="passwordForm.confirmPassword" type="password" class="input-field" autocomplete="new-password">
            </label>
            <p class="hint-text">修改成功后，除当前登录外的其它登录会话将失效。</p>
          </section>

          <button @click="changePassword" class="btn-save" type="button" :disabled="passwordSaving">
            {{ passwordSaving ? '修改中...' : '修改密码' }}
          </button>
          <div v-if="passwordMessage" :class="['form-message', passwordMessageType]">{{ passwordMessage }}</div>
        </div>
      </div>
      
      <div v-else-if="selectedSetting === 'defaultModel'" class="details-content">
        <div class="details-header">
          <h2>默认模型配置</h2>
        </div>

        <div class="settings-form">
          <section class="settings-section">
            <h3>默认模型选择</h3>
            <label>
              默认模型:
              <SearchableSelect
                v-model="settings.defaultModel"
                :options="defaultModelOptions"
                class="input-field"
                placeholder="请选择默认模型"
                search-placeholder="搜索默认模型..."
              />
            </label>
            <p class="hint-text">设置后，新建对话时将自动选择此模型</p>
          </section>

          <button @click="saveSettings" class="btn-save">保存设置</button>
          <div v-if="saveMessage" class="save-message">{{ saveMessage }}</div>
        </div>
      </div>

      <div v-else-if="selectedSetting === 'defaultPrompt'" class="details-content">
        <div class="details-header">
          <h2>默认提示词配置</h2>
        </div>

        <div class="settings-form">
          <section class="settings-section">
            <h3>默认提示词选择</h3>
            <label>
              默认提示词:
              <SearchableSelect
                v-model="settings.defaultPromptId"
                :options="defaultPromptOptions"
                class="input-field"
                placeholder="无（不使用提示词）"
                search-placeholder="搜索默认提示词..."
              />
            </label>
            <p class="hint-text">设置后，聊天时将默认选择此提示词作为系统提示词</p>

            <!-- 提示词预览 -->
            <div v-if="selectedPromptPreview" class="prompt-preview-box">
              <h4>提示词预览</h4>
              <div class="prompt-preview-header">
                <strong>{{ selectedPromptPreview.name }}</strong>
                <span class="prompt-preview-desc">{{ selectedPromptPreview.description }}</span>
              </div>
              <div class="prompt-preview-content">{{ selectedPromptPreview.content }}</div>
            </div>
          </section>

          <button @click="saveSettings" class="btn-save">保存设置</button>
          <div v-if="saveMessage" class="save-message">{{ saveMessage }}</div>
        </div>
      </div>

      <div v-else-if="selectedSetting === 'defaultStyle'" class="details-content">
        <div class="details-header">
          <h2>默认主题配置</h2>
        </div>

        <div class="settings-form">
          <section class="settings-section">
            <h3>消息显示风格</h3>
            <label>
              默认主题:
              <SearchableSelect
                v-model="settings.defaultStyle"
                :options="styleOptions"
                class="input-field"
                placeholder="默认（简洁风格）"
                search-placeholder="搜索主题风格..."
              />
            </label>
            <p class="hint-text">设置后，聊天页面将自动使用此主题显示 AI 回复内容</p>

            <!-- 主题预览 -->
            <div v-if="settings.defaultStyle" class="style-preview-box">
              <h4>主题预览</h4>
              <div class="style-preview-content">
                <div class="preview-header">
                  <span class="preview-icon">{{ getStyleConfig(settings.defaultStyle)?.icon }}</span>
                  <span class="preview-name">{{ getStyleConfig(settings.defaultStyle)?.name }}</span>
                </div>
                <div class="preview-desc">{{ getStyleConfig(settings.defaultStyle)?.description }}</div>
              </div>
            </div>
          </section>

          <button @click="saveSettings" class="btn-save">保存设置</button>
          <div v-if="saveMessage" class="save-message">{{ saveMessage }}</div>
        </div>
      </div>

      <div v-else-if="selectedSetting === 'sourceLanguages'" class="details-content">
        <div class="details-header">
          <h2>源语言管理</h2>
        </div>

        <div class="settings-form">
          <section class="settings-section">
            <h3>源语言列表</h3>
            <div class="language-list">
              <div v-for="lang in sourceLanguages" :key="lang.id" class="language-item">
                <input v-model="lang.name" @blur="updateSourceLanguage(lang)" class="input-field" placeholder="语言名称">
                <input v-model="lang.code" @blur="updateSourceLanguage(lang)" class="input-field" placeholder="语言代码">
                <button @click="deleteSourceLanguage(lang.id)" class="btn-delete-small">删除</button>
              </div>
            </div>
            <button @click="addSourceLanguage" class="btn-add">+ 添加源语言</button>
          </section>
        </div>
      </div>

      <div v-else-if="selectedSetting === 'targetLanguages'" class="details-content">
        <div class="details-header">
          <h2>目标语言管理</h2>
        </div>

        <div class="settings-form">
          <section class="settings-section">
            <h3>目标语言列表</h3>
            <div class="language-list">
              <div v-for="lang in targetLanguages" :key="lang.id" class="language-item">
                <input v-model="lang.name" @blur="updateTargetLanguage(lang)" class="input-field" placeholder="语言名称">
                <input v-model="lang.code" @blur="updateTargetLanguage(lang)" class="input-field" placeholder="语言代码">
                <button @click="deleteTargetLanguage(lang.id)" class="btn-delete-small">删除</button>
              </div>
            </div>
            <button @click="addTargetLanguage" class="btn-add">+ 添加目标语言</button>
          </section>
        </div>
      </div>

      <div v-else-if="selectedSetting === 'translateDefaults'" class="details-content">
        <div class="details-header">
          <h2>翻译默认配置</h2>
        </div>

        <div class="settings-form">
          <section class="settings-section">
            <h3>默认翻译模型</h3>
            <label>
              默认模型:
              <SearchableSelect
                v-model="settings.translateDefaultModel"
                :options="defaultModelOptions"
                class="input-field"
                placeholder="请选择默认模型"
                search-placeholder="搜索翻译默认模型..."
              />
            </label>
            <p class="hint-text">设置后，翻译页面将自动选择此模型</p>
          </section>

          <section class="settings-section">
            <h3>默认翻译提示词</h3>
            <label>
              默认提示词:
              <SearchableSelect
                v-model="settings.translateDefaultPromptId"
                :options="translatePromptOptions"
                class="input-field"
                placeholder="使用默认提示词"
                search-placeholder="搜索翻译默认提示词..."
              />
            </label>
            <p class="hint-text">设置后，翻译页面将自动选择此提示词</p>
          </section>

          <section class="settings-section">
            <h3>轮询设置</h3>
            <label class="checkbox-label">
              <input
                type="checkbox"
                v-model="settings.translatePollingEnabled"
                :disabled="!isTranslateModelPollingSupported"
              >
              启用轮询
            </label>
            <p class="hint-text" v-if="!settings.translateDefaultModel">
              请先选择默认翻译模型
            </p>
            <p class="hint-text" v-else-if="!isTranslateModelPollingSupported">
              当前选择的模型不支持轮询功能
            </p>
            <p class="hint-text" v-else>
              启用后，翻译时将使用轮询机制自动选择可用的提供商
            </p>
          </section>

          <button @click="saveSettings" class="btn-save">保存设置</button>
          <div v-if="saveMessage" class="save-message">{{ saveMessage }}</div>
        </div>
      </div>

      <div v-else-if="selectedSetting === 'quickTranslations'" class="details-content">
        <div class="details-header">
          <h2>快捷转换设置</h2>
        </div>

        <div class="settings-form">
          <section class="settings-section">
            <h3>快捷转换按钮（最多5个）</h3>
            <div class="quick-translations-list">
              <div v-for="(qt, index) in settings.quickTranslations" :key="qt.id" class="quick-translation-item">
                <input v-model="qt.name" class="input-field" placeholder="按钮名称（如：中→英）">
                <SearchableSelect
                  v-model="qt.sourceLanguage"
                  :options="sourceLanguageOptions"
                  class="input-field"
                  placeholder="选择源语言"
                  search-placeholder="搜索源语言..."
                />
                <SearchableSelect
                  v-model="qt.targetLanguage"
                  :options="targetLanguageOptions"
                  class="input-field"
                  placeholder="选择目标语言"
                  search-placeholder="搜索目标语言..."
                />
                <button @click="removeQuickTranslation(index)" class="btn-delete-small">删除</button>
              </div>
            </div>
            <button
              v-if="settings.quickTranslations.length < 5"
              @click="addQuickTranslation"
              class="btn-add"
            >
              + 添加快捷转换
            </button>
            <p class="hint-text" v-else>已达到最大数量（5个）</p>
          </section>

          <button @click="saveSettings" class="btn-save">保存设置</button>
          <div v-if="saveMessage" class="save-message">{{ saveMessage }}</div>
        </div>
      </div>

      <div v-else-if="selectedSetting === 'proxy'" class="details-content">
        <div class="details-header">
          <h2>代理接口配置</h2>
        </div>
        
        <div class="settings-form">
          <section class="settings-section">
            <h3>API 密钥管理</h3>
            <div class="migration-notice">
              <p class="notice-text">🔄 密钥管理已迁移</p>
              <p class="hint-text">API 密钥配置已迁移到专门的"代理密钥"页面，支持多密钥管理和参数隔离。</p>
              <p class="hint-text">请前往左侧菜单的"代理密钥"页面进行配置。</p>
            </div>
          </section>
          
          <section class="settings-section">
            <h3>接口地址</h3>
            <p class="hint-text">在外部软件中使用以下地址：</p>
            <div class="endpoint-info">
              <div class="endpoint-item">
                <span class="endpoint-label">Base URL:</span>
                <code class="endpoint-url">{{ apiBaseUrl }}/v1</code>
                <button @click="copyToClipboard(`${apiBaseUrl}/v1`)" class="btn-copy">复制</button>
              </div>
              <div class="endpoint-item">
                <span class="endpoint-label">Chat Completions:</span>
                <code class="endpoint-url">{{ apiBaseUrl }}/v1/chat/completions</code>
                <button @click="copyToClipboard(`${apiBaseUrl}/v1/chat/completions`)" class="btn-copy">复制</button>
              </div>
              <div class="endpoint-item">
                <span class="endpoint-label">Responses:</span>
                <code class="endpoint-url">{{ apiBaseUrl }}/v1/responses</code>
                <button @click="copyToClipboard(`${apiBaseUrl}/v1/responses`)" class="btn-copy">复制</button>
              </div>
              <div class="endpoint-item">
                <span class="endpoint-label">Models:</span>
                <code class="endpoint-url">{{ apiBaseUrl }}/v1/models</code>
                <button @click="copyToClipboard(`${apiBaseUrl}/v1/models`)" class="btn-copy">复制</button>
              </div>
            </div>
          </section>
          
          <section class="settings-section">
            <h3>使用说明</h3>
            <div class="usage-info">
              <p class="hint-text">⚠️ 重要提示：</p>
              <ul class="usage-list">
                <li>外部请求必须指定具体的模型名称</li>
                <li>只有在轮询设置中配置为可用池的模型才能使用</li>
                <li>系统会自动使用轮询机制选择提供商</li>
                <li>不支持的模型会返回错误信息</li>
              </ul>
            </div>
          </section>
          
          <button @click="saveSettings" class="btn-save">保存设置</button>
          <div v-if="saveMessage" class="save-message">{{ saveMessage }}</div>
        </div>
      </div>

      <div v-else-if="selectedSetting === 'modelTypes'" class="details-content full-width">
        <div class="details-header">
          <h2>模型类型管理</h2>
          <p class="hint-text">为图像、嵌入与重排模型手动分类，系统会按类型匹配对应能力和接口</p>
        </div>

        <div class="settings-form">
          <section class="settings-section">
            <h3>模型分类</h3>
            <p class="hint-text">切换下方选项卡后，可只针对一种能力类型进行维护，未分类模型会出现在当前类型的待添加列表中。</p>

            <div class="model-type-tabs">
              <button
                v-for="tab in modelTypeTabs"
                :key="tab.key"
                :class="['model-type-tab', { active: activeModelTypeTab === tab.key }]"
                @click="selectModelTypeTab(tab.key)"
              >
                <span class="tab-title">{{ tab.icon }} {{ tab.title }}</span>
                <span class="tab-count">{{ tab.count }}</span>
              </button>
            </div>

            <div v-if="activeModelTypeTabConfig" class="type-category active-tab-panel">
              <div class="category-header">
                <div>
                  <h4>{{ activeModelTypeTabConfig.icon }} {{ activeModelTypeTabConfig.title }}</h4>
                  <p class="category-desc">{{ activeModelTypeTabConfig.description }}</p>
                </div>
                <span class="category-count">{{ activeModelTypeModels.length }}</span>
              </div>

              <div class="model-type-endpoint-card">
                <span class="endpoint-chip">推荐接口</span>
                <code class="model-type-endpoint">{{ activeModelTypeTabConfig.endpoint }}</code>
              </div>

              <div class="category-models">
                <div
                  v-for="model in activeModelTypeModels"
                  :key="model.value"
                  class="category-model-item"
                >
                  <span class="model-name">{{ model.label }}</span>
                  <button @click="removeModelType(model.value)" class="btn-remove-tiny">×</button>
                </div>
                <div v-if="!activeModelTypeModels.length" class="model-type-empty">
                  当前类型还没有已标记模型
                </div>
                <div class="add-model-section">
                  <SearchableSelect
                    v-model="activeModelTypeSelection"
                    :options="availableModelsForType"
                    placeholder="选择模型..."
                    search-placeholder="搜索模型..."
                    class="model-select-searchable"
                  />
                  <button
                    @click="addModelType(activeModelTypeTab)"
                    :disabled="!activeModelTypeSelection"
                    class="btn-add-tiny"
                  >
                    添加到当前类型
                  </button>
                </div>
              </div>
            </div>
          </section>

          <button @click="saveModelTypes" class="btn-save">保存设置</button>
          <div v-if="saveMessage" class="save-message">{{ saveMessage }}</div>
        </div>
      </div>

      <div v-else class="empty-state">
        <p>请从左侧选择一个配置项</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import axios from 'axios'
import contentStyleManager from '../utils/contentStyleManager.js'
import SearchableSelect from '../components/SearchableSelect.vue'

const MODEL_TYPE_TABS = [
  {
    key: 'image-generation',
    title: '文生图',
    icon: '🖼️',
    description: '仅支持文本生成图片，系统会优先走文生图能力。',
    endpoint: '/v1/images/generations',
    selectKey: 'imageGeneration'
  },
  {
    key: 'image-edit',
    title: '图生图',
    icon: '✏️',
    description: '仅支持图片编辑、局部修改或二次生成。',
    endpoint: '/v1/images/edits',
    selectKey: 'imageEdit'
  },
  {
    key: 'image',
    title: '通用图像',
    icon: '🎨',
    description: '同时支持文生图与图生图，适合综合图像模型。',
    endpoint: '自动匹配图像端点',
    selectKey: 'imageUniversal'
  },
  {
    key: 'embedding',
    title: '嵌入模型',
    icon: '🧠',
    description: '用于向量化、文档切片表示和知识库召回。',
    endpoint: '/v1/embeddings',
    selectKey: 'embedding'
  },
  {
    key: 'rerank',
    title: '重排模型',
    icon: '🏆',
    description: '用于召回结果重排序，提升检索命中质量。',
    endpoint: '第三方知识库/检索重排接口',
    selectKey: 'rerank'
  }
]

const settings = ref({
  defaultParams: { temperature: 0.7, max_tokens: 2000, top_p: 1 },
  globalFrequency: 10,
  defaultModel: '',
  defaultPromptId: '',
  defaultStyle: '',
  translateDefaultModel: '',
  translateDefaultPromptId: '',
  translatePollingEnabled: false,
  quickTranslations: [],
  pollingConfig: { available: {}, excluded: {}, disabled: {} },
  modelTypes: {} // 格式: { 'providerId::modelId': 'image-generation' | 'image-edit' | 'image' | 'embedding' | 'rerank' }
})
const saveMessage = ref('')
const passwordMessage = ref('')
const passwordMessageType = ref('success')
const passwordSaving = ref(false)
const passwordForm = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})
const selectedSetting = ref('user')
const allModels = ref([])
const allPrompts = ref([])
const translatePrompts = ref([])
const sourceLanguages = ref([])
const targetLanguages = ref([])
const editingLanguage = ref(null)
const languageForm = ref({ name: '', code: '' })
const selectedModelToAdd = ref({
  imageGeneration: '',
  imageEdit: '',
  imageUniversal: '',
  embedding: '',
  rerank: ''
})
const activeModelTypeTab = ref('image-generation')

// 动态获取API基础URL
const apiBaseUrl = computed(() => {
  // 如果是开发环境（端口5173），则指向后端端口3000
  // 如果是生产环境，则使用当前域名
  const origin = window.location.origin
  if (origin.includes(':5173')) {
    return origin.replace(':5173', ':3000')
  }
  return origin
})

// 计算选中的提示词预览
const sourceLanguageOptions = computed(() =>
  sourceLanguages.value.map(lang => ({ label: lang.name, value: lang.name }))
)

const targetLanguageOptions = computed(() =>
  targetLanguages.value.map(lang => ({ label: lang.name, value: lang.name }))
)

const defaultModelOptions = computed(() => [
  { label: '请选择默认模型', value: '' },
  ...allModels.value.map(model => ({ label: model.label, value: model.value }))
])

const defaultPromptOptions = computed(() => [
  { label: '无（不使用提示词）', value: '' },
  ...allPrompts.value.map(prompt => ({
    label: prompt.name,
    value: prompt.id,
    description: prompt.description || ''
  }))
])

const translatePromptOptions = computed(() => [
  { label: '使用默认提示词', value: '' },
  ...translatePrompts.value.map(prompt => ({
    label: prompt.name,
    value: prompt.id,
    description: prompt.description || ''
  }))
])

const styleOptions = computed(() => [
  { label: '默认（简洁风格）', value: '' },
  { label: 'Notion（文档风格）', value: 'notion' },
  { label: 'Konayuki（温暖风格）', value: 'konayuki' },
  { label: 'Everforest（自然绿意）', value: 'everforest' },
  { label: 'HappySimple（活泼可爱）', value: 'happysimple' }
])

const selectedPromptPreview = computed(() => {
  if (!settings.value.defaultPromptId) return null
  return allPrompts.value.find(p => p.id === settings.value.defaultPromptId)
})

// 获取风格配置
function getStyleConfig(styleId) {
  if (!styleId) return null
  return contentStyleManager.getStyle(styleId)
}

// 检查翻译模型是否支持轮询
const isTranslateModelPollingSupported = computed(() => {
  if (!settings.value.translateDefaultModel) return false

  // 从 "providerId::modelId" 格式中提取模型名称
  const parts = settings.value.translateDefaultModel.split('::')
  if (parts.length !== 2) return false

  const modelName = parts[1]
  const pollingConfig = settings.value.pollingConfig || { available: {} }
  const availableProviders = pollingConfig.available?.[modelName] || []

  // 如果该模型在轮询配置中有可用的提供商，则支持轮询
  return Array.isArray(availableProviders) && availableProviders.length > 0
})

// 模型类型管理相关计算属性
const modelTypeTabs = computed(() => {
  return MODEL_TYPE_TABS.map(tab => ({
    ...tab,
    count: allModels.value.filter(m => settings.value.modelTypes?.[m.value] === tab.key).length
  }))
})

const modelTypeModelsMap = computed(() => {
  const grouped = {}
  MODEL_TYPE_TABS.forEach(tab => {
    grouped[tab.key] = allModels.value.filter(m => settings.value.modelTypes?.[m.value] === tab.key)
  })
  return grouped
})

const activeModelTypeTabConfig = computed(() => {
  return modelTypeTabs.value.find(tab => tab.key === activeModelTypeTab.value) || modelTypeTabs.value[0]
})

const activeModelTypeModels = computed(() => {
  return modelTypeModelsMap.value[activeModelTypeTab.value] || []
})

const availableModelsForType = computed(() => {
  return allModels.value.filter(m => !settings.value.modelTypes?.[m.value])
})

const activeModelTypeSelection = computed({
  get() {
    const selectKey = activeModelTypeTabConfig.value?.selectKey
    return selectKey ? selectedModelToAdd.value[selectKey] : ''
  },
  set(value) {
    const selectKey = activeModelTypeTabConfig.value?.selectKey
    if (selectKey) {
      selectedModelToAdd.value[selectKey] = value
    }
  }
})

function selectModelTypeTab(type) {
  activeModelTypeTab.value = type
}

function addModelType(type) {
  if (!settings.value.modelTypes) {
    settings.value.modelTypes = {}
  }

  const currentTab = MODEL_TYPE_TABS.find(tab => tab.key === type)
  const selectKey = currentTab?.selectKey
  const modelValue = selectKey ? selectedModelToAdd.value[selectKey] : ''

  if (modelValue) {
    settings.value.modelTypes[modelValue] = type
    selectedModelToAdd.value[selectKey] = ''
  }
}

function removeModelType(modelValue) {
  if (settings.value.modelTypes) {
    delete settings.value.modelTypes[modelValue]
  }
}

async function saveModelTypes() {
  try {
    const response = await axios.put('/api/settings', { modelTypes: settings.value.modelTypes })
    // 更新本地settings，确保与服务器同步
    settings.value = { ...settings.value, ...response.data }
    saveMessage.value = '模型类型配置已保存'
    setTimeout(() => saveMessage.value = '', 3000)
  } catch (error) {
    console.error('Error saving model types:', error)
    saveMessage.value = '保存失败: ' + error.message
  }
}

const settingsItems = ref([
  {
    id: 'user',
    name: '用户配置',
    description: '基本参数设置',
    icon: '👤'
  },
  {
    id: 'password',
    name: '密码管理',
    description: '修改登录密码',
    icon: '🔒'
  },
  {
    id: 'defaultModel',
    name: '默认模型',
    description: '新对话默认模型',
    icon: '🤖'
  },
  {
    id: 'defaultStyle',
    name: '默认主题',
    description: '消息显示风格',
    icon: '🎨'
  },
  {
    id: 'defaultPrompt',
    name: '默认提示词',
    description: '聊天默认系统提示词',
    icon: '💬'
  },
  {
    id: 'translateDefaults',
    name: '翻译默认配置',
    description: '翻译模型和提示词',
    icon: '🌍'
  },
  {
    id: 'quickTranslations',
    name: '快捷转换设置',
    description: '翻译快捷按钮',
    icon: '⚡'
  },
  {
    id: 'sourceLanguages',
    name: '源语言管理',
    description: '管理翻译源语言',
    icon: '🌐'
  },
  {
    id: 'targetLanguages',
    name: '目标语言管理',
    description: '管理翻译目标语言',
    icon: '🎯'
  },
  {
    id: 'proxy',
    name: '代理接口',
    description: 'OpenAI兼容接口设置',
    icon: '🔌'
  },
  {
    id: 'modelTypes',
    name: '模型类型管理',
    description: '配置图像、嵌入与重排模型',
    icon: '🧩'
  }
])

function selectSetting(settingId) {
  selectedSetting.value = settingId
  passwordMessage.value = ''
}

async function loadSettings() {
  const res = await axios.get('/api/settings')
  settings.value = {
    ...settings.value,
    ...res.data,
    modelTypes: res.data.modelTypes || {}
  }
}

async function loadModels() {
  try {
    const res = await axios.get('/api/providers')
    const models = []
    for (const provider of res.data) {
      if (provider.disabled) continue
      const addedModels = provider.models || []
      addedModels.forEach(m => {
        if (m.visible !== false) {
          models.push({
            value: `${provider.id}::${m.id}`,
            label: `${provider.name} - ${m.id}`
          })
        }
      })
    }
    allModels.value = models
  } catch (error) {
    console.error('Error loading models:', error)
    allModels.value = []
  }
}

async function loadPrompts() {
  try {
    const res = await axios.get('/api/prompts')
    allPrompts.value = res.data.prompts || []
    // 加载翻译提示词
    translatePrompts.value = (res.data.prompts || []).filter(p => {
      const group = (res.data.groups || []).find(g => g.id === p.groupId)
      return group && group.name.includes('翻译')
    })
  } catch (error) {
    console.error('Error loading prompts:', error)
    allPrompts.value = []
    translatePrompts.value = []
  }
}

async function loadLanguages() {
  try {
    const [sourceRes, targetRes] = await Promise.all([
      axios.get('/api/source-languages'),
      axios.get('/api/target-languages')
    ])
    sourceLanguages.value = sourceRes.data
    targetLanguages.value = targetRes.data
  } catch (error) {
    console.error('Error loading languages:', error)
  }
}

async function addSourceLanguage() {
  try {
    const res = await axios.post('/api/source-languages', {
      name: '新语言',
      code: ''
    })
    sourceLanguages.value.push(res.data)
  } catch (error) {
    console.error('Error adding source language:', error)
    alert('添加源语言失败')
  }
}

async function updateSourceLanguage(lang) {
  try {
    await axios.put(`/api/source-languages/${lang.id}`, lang)
  } catch (error) {
    console.error('Error updating source language:', error)
    alert('更新源语言失败')
  }
}

async function deleteSourceLanguage(id) {
  if (!confirm('确定要删除此源语言吗？')) return

  try {
    await axios.delete(`/api/source-languages/${id}`)
    sourceLanguages.value = sourceLanguages.value.filter(l => l.id !== id)
  } catch (error) {
    console.error('Error deleting source language:', error)
    alert('删除源语言失败')
  }
}

async function addTargetLanguage() {
  try {
    const res = await axios.post('/api/target-languages', {
      name: '新语言',
      code: ''
    })
    targetLanguages.value.push(res.data)
  } catch (error) {
    console.error('Error adding target language:', error)
    alert('添加目标语言失败')
  }
}

async function updateTargetLanguage(lang) {
  try {
    await axios.put(`/api/target-languages/${lang.id}`, lang)
  } catch (error) {
    console.error('Error updating target language:', error)
    alert('更新目标语言失败')
  }
}

async function deleteTargetLanguage(id) {
  if (!confirm('确定要删除此目标语言吗？')) return

  try {
    await axios.delete(`/api/target-languages/${id}`)
    targetLanguages.value = targetLanguages.value.filter(l => l.id !== id)
  } catch (error) {
    console.error('Error deleting target language:', error)
    alert('删除目标语言失败')
  }
}

function addQuickTranslation() {
  if (settings.value.quickTranslations.length >= 5) {
    alert('最多只能添加5个快捷转换')
    return
  }
  settings.value.quickTranslations.push({
    id: Date.now().toString(),
    name: '',
    sourceLanguage: '',
    targetLanguage: ''
  })
}

function removeQuickTranslation(index) {
  settings.value.quickTranslations.splice(index, 1)
}

async function saveSettings() {
  await axios.put('/api/settings', settings.value)
  saveMessage.value = '设置已保存'
  setTimeout(() => saveMessage.value = '', 2000)
}

async function changePassword() {
  passwordMessage.value = ''

  if (!passwordForm.value.currentPassword || !passwordForm.value.newPassword) {
    passwordMessageType.value = 'error'
    passwordMessage.value = '请输入当前密码和新密码'
    return
  }

  if (passwordForm.value.newPassword.length < 8) {
    passwordMessageType.value = 'error'
    passwordMessage.value = '新密码至少需要 8 个字符'
    return
  }

  if (passwordForm.value.newPassword !== passwordForm.value.confirmPassword) {
    passwordMessageType.value = 'error'
    passwordMessage.value = '两次输入的新密码不一致'
    return
  }

  passwordSaving.value = true
  try {
    await axios.post('/api/auth/change-password', {
      currentPassword: passwordForm.value.currentPassword,
      newPassword: passwordForm.value.newPassword
    })

    passwordForm.value = {
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    }
    passwordMessageType.value = 'success'
    passwordMessage.value = '密码已修改'
    setTimeout(() => passwordMessage.value = '', 3000)
  } catch (error) {
    passwordMessageType.value = 'error'
    passwordMessage.value = error.response?.data?.error || '修改密码失败'
  } finally {
    passwordSaving.value = false
  }
}

// 复制到剪贴板
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    saveMessage.value = '已复制到剪贴板'
    setTimeout(() => saveMessage.value = '', 2000)
  }).catch(err => {
    console.error('复制失败:', err)
  })
}

onMounted(async () => {
  await loadSettings()
  await loadModels()
  loadPrompts()
  loadLanguages()
})
</script>

<style scoped>
.user-settings-container {
  display: flex;
  height: 100%;
  background-color: #f5f5f5;
}

.settings-sidebar {
  width: 280px;
  background-color: #fff;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 20px;
  border-bottom: 1px solid #e0e0e0;
}

.sidebar-header h3 {
  margin: 0;
  font-size: 18px;
  color: #333;
}

.settings-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.settings-item {
  display: flex;
  align-items: center;
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
  margin-bottom: 8px;
}

.settings-item:hover {
  background-color: #f0f0f0;
}

.settings-item.active {
  background-color: #e3f2fd;
}

.settings-item-icon {
  font-size: 24px;
  margin-right: 12px;
}

.settings-item-info {
  flex: 1;
}

.settings-item-name {
  font-size: 14px;
  font-weight: 500;
  color: #333;
}

.settings-item-desc {
  font-size: 12px;
  color: #666;
  margin-top: 2px;
}

.settings-details-panel {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.details-content {
  max-width: 800px;
  margin: 0 auto;
}

.details-content.full-width {
  max-width: none !important;
  margin: 0 !important;
  width: 100%;
}

.details-content.full-width .settings-form {
  max-width: none;
  width: 100%;
}

.details-header h2 {
  margin: 0 0 20px 0;
  font-size: 24px;
  color: #333;
}

.settings-form {
  background-color: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.settings-section {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid #e0e0e0;
}

.settings-section:last-of-type {
  border-bottom: none;
  margin-bottom: 16px;
}

.settings-section h3 {
  margin: 0 0 12px 0;
  font-size: 16px;
  color: #333;
}

.settings-section label {
  display: block;
  margin-bottom: 12px;
  font-size: 14px;
  color: #555;
}

.input-field {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  margin-top: 6px;
  box-sizing: border-box;
}

.input-field:focus {
  outline: none;
  border-color: #1976d2;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.2);
}

.hint-text {
  font-size: 12px;
  color: #888;
  margin: 8px 0;
}

.btn-save {
  background-color: #1976d2;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.btn-save:hover {
  background-color: #1565c0;
}

.save-message {
  margin-top: 12px;
  color: #4caf50;
  font-size: 14px;
}

.form-message {
  margin-top: 12px;
  font-size: 14px;
}

.form-message.success {
  color: #4caf50;
}

.form-message.error {
  color: #d32f2f;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #888;
}

/* 迁移通知样式 */
.migration-notice {
  background-color: #e3f2fd;
  border: 1px solid #90caf9;
  border-radius: 8px;
  padding: 16px;
  margin-top: 8px;
}

.notice-text {
  font-weight: 600;
  color: #1976d2;
  margin: 0 0 8px 0;
  font-size: 14px;
}

.endpoint-info {
  background-color: #f8f9fa;
  border-radius: 8px;
  padding: 16px;
  margin-top: 12px;
}

.endpoint-item {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 8px;
}

.endpoint-item:last-child {
  margin-bottom: 0;
}

.endpoint-label {
  font-weight: 500;
  color: #555;
  min-width: 140px;
}

.endpoint-url {
  background-color: #fff;
  border: 1px solid #e0e0e0;
  padding: 6px 12px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 13px;
  color: #333;
  flex: 1;
  word-break: break-all;
}

.btn-copy {
  padding: 6px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background-color: #fff;
  cursor: pointer;
  font-size: 12px;
  color: #666;
  transition: all 0.2s;
}

.btn-copy:hover {
  background-color: #f0f0f0;
  border-color: #ccc;
}

/* 使用说明样式 */
.usage-info {
  background-color: #fff3cd;
  border: 1px solid #ffeaa7;
  border-radius: 6px;
  padding: 16px;
  margin-top: 8px;
}

.usage-list {
  margin: 8px 0 0 0;
  padding-left: 20px;
}

.usage-list li {
  margin-bottom: 6px;
  color: #856404;
  font-size: 13px;
}

/* 提示词预览样式 */
.prompt-preview-box {
  margin-top: 20px;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 10px;
  border: 2px solid #e0e0e0;
}

.style-preview-box {
  margin-top: 20px;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 10px;
  border: 2px solid #e0e0e0;
}

.style-preview-content {
  color: #495057;
  font-size: 13px;
  line-height: 1.6;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
  background: white;
  padding: 12px;
  border-radius: 6px;
}

.preview-header {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid #dee2e6;
}

.preview-icon {
  font-size: 24px;
  line-height: 1;
}

.preview-name {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.preview-desc {
  color: #6c757d;
  font-size: 12px;
}

.prompt-preview-box h4 {
  margin: 0 0 12px 0;
  color: #333;
  font-size: 14px;
  font-weight: 600;
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
  background: white;
  padding: 12px;
  border-radius: 6px;
}

/* 语言列表样式 */
.language-list {
  margin-bottom: 1rem;
}

.language-item {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  align-items: center;
}

.language-item .input-field {
  flex: 1;
}

.btn-add {
  padding: 0.5rem 1rem;
  background: #0891b2;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
}

.btn-add:hover {
  background: #0e7490;
}

.btn-delete-small {
  padding: 0.5rem 0.75rem;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
}

.btn-delete-small:hover {
  background: #dc2626;
}

/* 快捷转换列表样式 */
.quick-translations-list {
  margin-bottom: 1rem;
}

.quick-translation-item {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  align-items: center;
}

.quick-translation-item .input-field {
  flex: 1;
}

/* 复选框标签样式 */
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  color: #333;
}

.checkbox-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.checkbox-label input[type="checkbox"]:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* 模型类型管理样式 */
.model-type-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
  margin-bottom: 16px;
}

.model-type-tab {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid #d0d7de;
  border-radius: 999px;
  background: #f8fafc;
  color: #334155;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 13px;
  font-weight: 600;
}

.model-type-tab:hover {
  background: #eef6ff;
  border-color: #93c5fd;
}

.model-type-tab.active {
  background: #1976d2;
  color: #fff;
  border-color: #1976d2;
  box-shadow: 0 6px 16px rgba(25, 118, 210, 0.2);
}

.tab-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.tab-count {
  min-width: 22px;
  height: 22px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  background: rgba(255, 255, 255, 0.22);
  font-size: 12px;
}

.type-category {
  background: white;
  border: 1px solid #dee2e6;
  border-radius: 12px;
  padding: 20px;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.type-category:hover {
  box-shadow: 0 4px 8px rgba(0,0,0,0.08);
}

.active-tab-panel {
  width: 100%;
}

.category-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 10px;
}

.category-header h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.category-count {
  background: #6c757d;
  color: white;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.category-desc {
  font-size: 13px;
  color: #6c757d;
  margin: 6px 0 0;
  line-height: 1.5;
}

.model-type-endpoint-card {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
  padding: 12px 14px;
  background: #f8fbff;
  border: 1px solid #dbeafe;
  border-radius: 10px;
}

.endpoint-chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: #dbeafe;
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 600;
}

.model-type-endpoint {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  color: #1e293b;
}

.category-models {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.category-model-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 6px;
  transition: all 0.2s;
}

.category-model-item:hover {
  background: #e9ecef;
}

.model-name {
  font-size: 13px;
  font-family: 'Consolas', 'Monaco', monospace;
  color: #495057;
  font-weight: 500;
}

.btn-remove-tiny {
  padding: 4px 10px;
  background: #dc3545;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  transition: all 0.2s;
}

.btn-remove-tiny:hover {
  background: #c82333;
  transform: scale(1.05);
}

.model-type-empty {
  padding: 14px;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  background: #f8fafc;
  color: #64748b;
  font-size: 13px;
  text-align: center;
}

.add-model-section {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 2px dashed #dee2e6;
  align-items: start;
}

.model-select-searchable {
  width: 100%;
  min-width: 0;
}

.btn-add-tiny {
  padding: 8px 16px;
  background: #28a745;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
  white-space: nowrap;
}

.btn-add-tiny:hover:not(:disabled) {
  background: #218838;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(40, 167, 69, 0.3);
}

.btn-add-tiny:disabled {
  background: #6c757d;
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
