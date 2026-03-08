<template>
  <div class="translate-container">
    <div class="translate-panel">
      <!-- 快捷转换按钮 -->
      <div class="quick-buttons" v-if="quickTranslations.length > 0">
        <button
          v-for="qt in quickTranslations"
          :key="qt.id"
          @click="applyQuickTranslation(qt)"
          class="btn-quick"
        >
          {{ qt.name }}
        </button>
      </div>

      <!-- 语言选择栏 -->
      <div class="language-selector">
        <div class="language-select-group">
          <label>源语言</label>
          <SearchableSelect
            v-model="sourceLanguage"
            :options="sourceLanguageOptions"
            class="language-select"
            placeholder="选择源语言"
            search-placeholder="搜索源语言..."
          />
        </div>

        <button @click="swapLanguages" class="btn-swap" title="交换语言">⇄</button>

        <div class="language-select-group">
          <label>目标语言</label>
          <SearchableSelect
            v-model="targetLanguage"
            :options="targetLanguageOptions"
            class="language-select"
            placeholder="选择目标语言"
            search-placeholder="搜索目标语言..."
          />
        </div>
      </div>

      <!-- 翻译区域 -->
      <div class="translate-area">
        <!-- 输入区 -->
        <div class="input-section">
          <div class="section-header">
            <span class="section-title">输入文本</span>
            <span class="char-count">{{ inputText.length }} 字符</span>
          </div>
          <textarea
            v-model="inputText"
            class="text-input"
            placeholder="请输入要翻译的文本..."
            rows="10"
          ></textarea>
        </div>

        <!-- 输出区 -->
        <div class="output-section">
          <div class="section-header">
            <span class="section-title">翻译结果</span>
            <div class="header-buttons" v-if="outputText">
              <button @click="copyOutput" class="btn-copy-small">复制</button>
              <button @click="clearTranslation" class="btn-clear-small">清除</button>
            </div>
          </div>
          <div class="text-output" v-if="outputText">{{ outputText }}</div>
          <div class="text-output-placeholder" v-else>翻译结果将显示在这里...</div>
        </div>
      </div>

      <!-- 提示词和翻译按钮 -->
      <div class="translate-controls">
        <div class="prompt-selector">
          <label>翻译提示词</label>
          <SearchableSelect
            v-model="selectedPromptId"
            :options="translatePromptOptions"
            class="prompt-select"
            placeholder="使用默认提示词"
            search-placeholder="搜索翻译提示词..."
          />
        </div>

        <button
          @click="translate"
          class="btn-translate"
          :disabled="!canTranslate || isTranslating"
        >
          {{ isTranslating ? '翻译中...' : '翻译' }}
        </button>
      </div>

      <!-- 模型选择 -->
      <div class="model-selector">
        <label>选择模型</label>
        <SearchableSelect
          v-model="selectedModel"
          :options="translateModelOptions"
          class="model-select"
          placeholder="请选择模型"
          search-placeholder="搜索模型..."
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import axios from 'axios';
import SearchableSelect from '../components/SearchableSelect.vue';

const sourceLanguage = ref('');
const targetLanguage = ref('');
const inputText = ref('');
const outputText = ref('');
const selectedPromptId = ref('');
const selectedModel = ref('');
const isTranslating = ref(false);
const translatePollingEnabled = ref(false);

const sourceLanguages = ref([]);
const targetLanguages = ref([]);
const translatePrompts = ref([]);
const allModels = ref([]);
const quickTranslations = ref([]);

// localStorage 键名
const STORAGE_KEY = 'translate_state';

// 保存翻译状态到 localStorage
function saveTranslateState() {
  const state = {
    sourceLanguage: sourceLanguage.value,
    targetLanguage: targetLanguage.value,
    inputText: inputText.value,
    outputText: outputText.value,
    selectedPromptId: selectedPromptId.value,
    selectedModel: selectedModel.value
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function debounce(fn, delay = 300) {
  let timer = null
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

const debouncedSaveTranslateState = debounce(saveTranslateState, 300)

// 从 localStorage 恢复翻译状态
function loadTranslateState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const state = JSON.parse(saved);
      sourceLanguage.value = state.sourceLanguage || '';
      targetLanguage.value = state.targetLanguage || '';
      inputText.value = state.inputText || '';
      outputText.value = state.outputText || '';
      selectedPromptId.value = state.selectedPromptId || '';
      selectedModel.value = state.selectedModel || '';
    }
  } catch (error) {
    console.error('恢复翻译状态失败:', error);
  }
}

// 清除翻译内容
function clearTranslation() {
  inputText.value = '';
  outputText.value = '';
  localStorage.removeItem(STORAGE_KEY);
}

// 监听数据变化，自动保存（防抖，避免输入时频繁写 localStorage）
watch([sourceLanguage, targetLanguage, inputText, outputText, selectedPromptId, selectedModel], () => {
  debouncedSaveTranslateState()
});

const sourceLanguageOptions = computed(() =>
  sourceLanguages.value.map(lang => ({
    label: lang.name,
    value: lang.name
  }))
);

const targetLanguageOptions = computed(() =>
  targetLanguages.value.map(lang => ({
    label: lang.name,
    value: lang.name
  }))
);

const translatePromptOptions = computed(() => [
  { label: '使用默认提示词', value: '' },
  ...translatePrompts.value.map(prompt => ({
    label: prompt.name,
    value: prompt.id,
    description: prompt.description || ''
  }))
]);

const translateModelOptions = computed(() => [
  { label: '请选择模型', value: '' },
  ...allModels.value.map(model => ({
    label: model.label,
    value: model.value
  }))
]);

const canTranslate = computed(() => {
  return inputText.value.trim() &&
         sourceLanguage.value &&
         targetLanguage.value &&
         selectedModel.value;
});

async function loadLanguages() {
  try {
    const [sourceRes, targetRes] = await Promise.all([
      axios.get('/api/source-languages'),
      axios.get('/api/target-languages')
    ]);
    sourceLanguages.value = sourceRes.data;
    targetLanguages.value = targetRes.data;
  } catch (error) {
    console.error('加载语言失败:', error);
  }
}

async function loadPrompts() {
  try {
    const res = await axios.get('/api/prompts');
    // 加载名称包含"翻译"的分组的提示词
    translatePrompts.value = (res.data.prompts || []).filter(p => {
      // 查找该提示词所属的分组
      const group = (res.data.groups || []).find(g => g.id === p.groupId);
      // 如果分组名称包含"翻译"，则包含该提示词
      return group && group.name.includes('翻译');
    });
  } catch (error) {
    console.error('加载提示词失败:', error);
  }
}

async function loadModels() {
  try {
    const res = await axios.get('/api/providers');
    const models = [];
    for (const provider of res.data) {
      if (provider.disabled) continue;
      const addedModels = provider.models || [];
      addedModels.forEach(m => {
        if (m.visible) {
          models.push({
            value: `${provider.id}::${m.id}`,
            label: `${provider.name} - ${m.id}`
          });
        }
      });
    }
    allModels.value = models;

    // 加载默认模型和提示词
    const settingsRes = await axios.get('/api/settings');
    if (settingsRes.data.translateDefaultModel) {
      selectedModel.value = settingsRes.data.translateDefaultModel;
    } else if (settingsRes.data.defaultModel) {
      selectedModel.value = settingsRes.data.defaultModel;
    }

    if (settingsRes.data.translateDefaultPromptId) {
      selectedPromptId.value = settingsRes.data.translateDefaultPromptId;
    }

    // 加载轮询设置
    if (settingsRes.data.translatePollingEnabled !== undefined) {
      translatePollingEnabled.value = settingsRes.data.translatePollingEnabled;
    }

    // 加载快捷转换
    if (settingsRes.data.quickTranslations) {
      quickTranslations.value = settingsRes.data.quickTranslations;
    }
  } catch (error) {
    console.error('加载模型失败:', error);
  }
}

function applyQuickTranslation(qt) {
  sourceLanguage.value = qt.sourceLanguage;
  targetLanguage.value = qt.targetLanguage;
}

function swapLanguages() {
  const temp = sourceLanguage.value;
  sourceLanguage.value = targetLanguage.value;
  targetLanguage.value = temp;
}

async function translate() {
  if (!canTranslate.value || isTranslating.value) return;

  isTranslating.value = true;
  outputText.value = '';

  try {
    // 获取选中的提示词
    let systemPrompt = '';
    if (selectedPromptId.value) {
      const prompt = translatePrompts.value.find(p => p.id === selectedPromptId.value);
      if (prompt) {
        systemPrompt = prompt.content;
      }
    } else {
      // 默认提示词
      systemPrompt = '将{{输入文本}}从{{源文本}}翻译成{{目标文本}}，只返回翻译结果，不要添加任何解释。';
    }

    // 构建翻译上下文
    const translateContext = {
      inputText: inputText.value,
      sourceLanguage: sourceLanguage.value,
      targetLanguage: targetLanguage.value
    };

    // 构建消息
    const messages = [
      {
        role: 'user',
        content: inputText.value
      }
    ];

    // 发送翻译请求
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        model: selectedModel.value,
        params: { temperature: 0.3, max_tokens: 4000, top_p: 1 },
        polling: translatePollingEnabled.value,
        systemPrompt,
        translateContext
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // 处理流式响应
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              throw new Error(parsed.error);
            }

            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) {
              outputText.value += content;
            }
          } catch (e) {
            console.error('解析响应失败:', e);
          }
        }
      }
    }
  } catch (error) {
    console.error('翻译失败:', error);
    alert('翻译失败: ' + error.message);
  } finally {
    isTranslating.value = false;
  }
}

function copyOutput() {
  navigator.clipboard.writeText(outputText.value).then(() => {
    alert('已复制到剪贴板');
  }).catch(err => {
    console.error('复制失败:', err);
  });
}

onMounted(() => {
  loadTranslateState();
  loadLanguages();
  loadPrompts();
  loadModels();
});
</script>

<style scoped>
.translate-container {
  display: flex;
  width: 100%;
  min-height: calc(100vh - 100px);
  padding: 0;
}

.translate-panel {
  width: 100%;
  min-height: 100%;
  background: rgba(255, 255, 255, 0.96);
  border-radius: 22px;
  padding: 1.5rem;
  border: 1px solid rgba(226, 232, 240, 0.95);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06);
}

.language-selector {
  display: flex;
  align-items: flex-end;
  gap: 1rem;
  margin-bottom: 2rem;
}

.language-select-group {
  flex: 1;
}

.language-select-group label {
  display: block;
  font-size: 14.5px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 0.5rem;
}

.language-select {
  width: 100%;
}

.btn-swap {
  padding: 0.82rem 0.95rem;
  background: #ffffff;
  border: 1px solid rgba(203, 213, 225, 0.95);
  border-radius: 16px;
  cursor: pointer;
  font-size: 20px;
  color: #475569;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
  box-shadow: 0 6px 14px rgba(15, 23, 42, 0.05);
}

.btn-swap:hover {
  color: #0f172a;
  transform: translateY(-1px);
  box-shadow: 0 8px 18px rgba(8, 145, 178, 0.08);
}

.translate-area {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  margin-bottom: 1.75rem;
  min-height: 420px;
}

.input-section, .output-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0.9rem;
  border-radius: 18px;
  background: rgba(255,255,255,0.96);
  border: 1px solid rgba(226, 232, 240, 0.92);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.04);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.header-buttons {
  display: flex;
  gap: 0.5rem;
}

.section-title {
  font-size: 14.5px;
  font-weight: 600;
  color: #334155;
}

.char-count {
  font-size: 12.5px;
  color: #94a3b8;
}

.text-input {
  width: 100%;
  padding: 0.95rem 1rem;
  border: 1px solid rgba(203, 213, 225, 0.9);
  border-radius: 16px;
  font-size: 14.5px;
  font-family: inherit;
  resize: vertical;
  min-height: 420px;
  background: #ffffff;
  color: #334155;
  outline: none;
  box-sizing: border-box;
  flex: 1;
  line-height: 1.7;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.text-input:focus {
  border-color: #0891b2;
  box-shadow: 0 0 0 3px rgba(8, 145, 178, 0.1);
}

.text-output {
  width: 100%;
  padding: 1rem 1.05rem;
  border: 1px solid rgba(203, 213, 225, 0.9);
  border-radius: 16px;
  font-size: 14.5px;
  min-height: 420px;
  background: #f8fafc;
  color: #334155;
  white-space: pre-wrap;
  word-wrap: break-word;
  box-sizing: border-box;
  overflow-y: auto;
  resize: vertical;
  flex: 1;
  line-height: 1.7;
}

.text-output-placeholder {
  width: 100%;
  padding: 1rem;
  border: 1px solid rgba(203, 213, 225, 0.9);
  border-radius: 16px;
  font-size: 14.5px;
  min-height: 420px;
  background: #f8fafc;
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  flex: 1;
}

.btn-copy-small {
  padding: 0.25rem 0.75rem;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: #64748b;
  transition: all 0.2s;
}

.btn-copy-small:hover {
  background: #e2e8f0;
  color: #0891b2;
}

.btn-clear-small {
  padding: 0.25rem 0.75rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: #dc2626;
  transition: all 0.2s;
}

.btn-clear-small:hover {
  background: #fee2e2;
  border-color: #fca5a5;
  color: #b91c1c;
}

.translate-controls {
  display: flex;
  gap: 1rem;
  align-items: flex-end;
  margin-bottom: 1rem;
  padding: 0.85rem;
  border-radius: 18px;
  background: rgba(255,255,255,0.94);
  border: 1px solid rgba(226, 232, 240, 0.88);
}

.prompt-selector {
  flex: 1;
}

.prompt-selector label {
  display: block;
  font-size: 14.5px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 0.5rem;
}

.prompt-select {
  width: 100%;
}

.btn-translate {
  padding: 0.82rem 2rem;
  background: #0891b2;
  color: white;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
  transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease, background-color 0.18s ease;
  box-shadow: 0 8px 18px rgba(8, 145, 178, 0.18);
}

.btn-translate:hover:not(:disabled) {
  background: #0e7490;
  transform: translateY(-1px);
  box-shadow: 0 10px 22px rgba(8, 145, 178, 0.22);
}

.btn-translate:disabled {
  background: #cbd5e1;
  cursor: not-allowed;
}

.model-selector {
  margin-bottom: 1rem;
}

.model-selector label {
  display: block;
  font-size: 14.5px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 0.5rem;
}

.model-select {
  width: 100%;
}

/* 快捷转换按钮样式 */
.quick-buttons {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.btn-quick {
  padding: 0.5rem 1rem;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14.5px;
  color: #334155;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-quick:hover {
  background: #e2e8f0;
  border-color: #0891b2;
  color: #0891b2;
}

@media (max-width: 768px) {
  .translate-container {
    min-height: auto;
  }

  .translate-panel {
    padding: 1rem;
  }

  .translate-area {
    grid-template-columns: 1fr;
    min-height: auto;
  }

  .language-selector {
    flex-direction: row;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .language-select-group {
    flex: 0 1 calc(50% - 2rem);
    min-width: 0;
  }

  .btn-swap {
    flex: 0 0 52px;
    width: 52px;
    height: 52px;
    padding: 0;
    transform: none;
    align-self: flex-end;
  }

  .text-input,
  .text-output,
  .text-output-placeholder {
    min-height: 240px;
  }
}
</style>
