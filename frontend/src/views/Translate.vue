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
          <select v-model="sourceLanguage" class="language-select">
            <option value="">选择源语言</option>
            <option v-for="lang in sourceLanguages" :key="lang.id" :value="lang.name">
              {{ lang.name }}
            </option>
          </select>
        </div>

        <button @click="swapLanguages" class="btn-swap" title="交换语言">⇄</button>

        <div class="language-select-group">
          <label>目标语言</label>
          <select v-model="targetLanguage" class="language-select">
            <option value="">选择目标语言</option>
            <option v-for="lang in targetLanguages" :key="lang.id" :value="lang.name">
              {{ lang.name }}
            </option>
          </select>
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
          <select v-model="selectedPromptId" class="prompt-select">
            <option value="">使用默认提示词</option>
            <option v-for="prompt in translatePrompts" :key="prompt.id" :value="prompt.id">
              {{ prompt.name }}
            </option>
          </select>
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
        <select v-model="selectedModel" class="model-select">
          <option value="">请选择模型</option>
          <option v-for="model in allModels" :key="model.value" :value="model.value">
            {{ model.label }}
          </option>
        </select>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import axios from 'axios';

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

// 监听数据变化，自动保存
watch([sourceLanguage, targetLanguage, inputText, outputText, selectedPromptId, selectedModel], () => {
  saveTranslateState();
});

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

  // 同时交换输入和输出文本
  const tempText = inputText.value;
  inputText.value = outputText.value;
  outputText.value = tempText;
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
  justify-content: center;
  padding: 2rem;
}

.translate-panel {
  width: 100%;
  max-width: 1200px;
  background: #ffffff;
  border-radius: 12px;
  padding: 2rem;
  border: 1px solid #e2e8f0;
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
  font-size: 14px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 0.5rem;
}

.language-select {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  background: white;
  color: #334155;
  outline: none;
}

.language-select:focus {
  border-color: #0891b2;
}

.btn-swap {
  padding: 0.75rem 1rem;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  font-size: 20px;
  color: #64748b;
  transition: all 0.2s;
}

.btn-swap:hover {
  background: #e2e8f0;
  color: #0891b2;
}

.translate-area {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  margin-bottom: 1.5rem;
}

.input-section, .output-section {
  display: flex;
  flex-direction: column;
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
  font-size: 14px;
  font-weight: 600;
  color: #334155;
}

.char-count {
  font-size: 12px;
  color: #94a3b8;
}

.text-input {
  width: 100%;
  padding: 1rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  min-height: 242px;
  background: white;
  color: #334155;
  outline: none;
  box-sizing: border-box;
}

.text-input:focus {
  border-color: #0891b2;
}

.text-output {
  width: 100%;
  padding: 1rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  min-height: 242px;
  background: #f8fafc;
  color: #334155;
  white-space: pre-wrap;
  word-wrap: break-word;
  box-sizing: border-box;
  overflow-y: auto;
  resize: vertical;
}

.text-output-placeholder {
  width: 100%;
  padding: 1rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  min-height: 242px;
  background: #f8fafc;
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
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
}

.prompt-selector {
  flex: 1;
}

.prompt-selector label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 0.5rem;
}

.prompt-select {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  background: white;
  color: #334155;
  outline: none;
}

.prompt-select:focus {
  border-color: #0891b2;
}

.btn-translate {
  padding: 0.75rem 2rem;
  background: #0891b2;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  font-weight: 600;
  transition: all 0.2s;
}

.btn-translate:hover:not(:disabled) {
  background: #0e7490;
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
  font-size: 14px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 0.5rem;
}

.model-select {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  background: white;
  color: #334155;
  outline: none;
}

.model-select:focus {
  border-color: #0891b2;
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
  font-size: 14px;
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
  .translate-area {
    grid-template-columns: 1fr;
  }

  .language-selector {
    flex-direction: column;
    align-items: stretch;
  }

  .btn-swap {
    transform: rotate(90deg);
  }
}
</style>
