<template>
  <div class="prompt-library-container">
    <!-- 左侧提示词列表 -->
    <div class="prompts-sidebar">
      <div class="sidebar-header">
        <input v-model="searchQuery" placeholder="搜索提示词..." class="search-input">
        <div class="button-group">
          <button @click="createNewPrompt" class="btn-add">+ 新建提示词</button>
          <button @click="showGroupManager = true" class="btn-manage-groups">📁 管理分组</button>
        </div>

        <!-- 分组筛选 -->
        <div class="filter-section">
          <label>分组筛选</label>
          <SearchableSelect
            v-model="selectedGroupFilter"
            :options="groupFilterOptions"
            class="filter-select"
            placeholder="全部分组"
            search-placeholder="搜索分组..."
          />
        </div>

        <!-- 标签筛选 -->
        <div class="filter-section" v-if="allTags.length > 0">
          <label>标签筛选</label>
          <div class="tags-filter">
            <span
              v-for="tag in allTags"
              :key="tag"
              :class="['tag-chip', { active: selectedTags.includes(tag) }]"
              @click="toggleTagFilter(tag)"
            >
              {{ tag }}
            </span>
          </div>
        </div>
      </div>

      <div class="prompts-list">
        <!-- 按分组显示提示词 -->
        <div v-for="group in groupedPrompts" :key="group.id" class="prompt-group">
          <div class="group-header" @click="toggleGroupExpand(group.id)">
            <span class="group-expand-icon">{{ expandedGroups[group.id] ? '▼' : '▶' }}</span>
            <span class="group-name">{{ group.name }}</span>
            <span class="group-count">{{ group.prompts.length }}</span>
          </div>
          <div v-if="expandedGroups[group.id]" class="group-prompts">
            <div
              v-for="prompt in group.prompts"
              :key="prompt.id"
              :class="['prompt-item', { active: selectedPrompt?.id === prompt.id }]"
              @click="selectPrompt(prompt)"
            >
              <div class="prompt-item-header">
                <div class="prompt-item-name">{{ prompt.name }}</div>
                <div class="prompt-item-tags">
                  <span v-for="tag in prompt.tags" :key="tag" class="tag-mini">{{ tag }}</span>
                </div>
              </div>
              <div class="prompt-item-desc">{{ prompt.description || '无描述' }}</div>
            </div>
          </div>
        </div>

        <div v-if="filteredPrompts.length === 0" class="empty-state">
          <p>暂无提示词</p>
          <button @click="createNewPrompt" class="btn-add-empty">创建第一个提示词</button>
        </div>
      </div>
    </div>

    <!-- 右侧提示词详情 -->
    <div class="prompt-details-panel">
      <div v-if="selectedPrompt" class="details-content">
        <div class="details-header">
          <h2>{{ isEditing ? '编辑提示词' : selectedPrompt.name }}</h2>
          <div class="header-actions">
            <button v-if="!isEditing" @click="startEdit" class="btn-edit">编辑</button>
            <button v-if="isEditing" @click="savePrompt" class="btn-save">保存</button>
            <button v-if="isEditing" @click="cancelEdit" class="btn-cancel">取消</button>
            <button @click="deletePrompt" class="btn-delete-prompt">删除</button>
          </div>
        </div>

        <!-- 提示词名称 -->
        <div class="config-section">
          <label>名称</label>
          <input
            v-model="editForm.name"
            :readonly="!isEditing"
            class="input-field"
            placeholder="输入提示词名称"
          >
        </div>

        <!-- 描述 -->
        <div class="config-section">
          <label>描述</label>
          <input
            v-model="editForm.description"
            :readonly="!isEditing"
            class="input-field"
            placeholder="简短描述这个提示词的用途"
          >
        </div>

        <!-- 分组选择 -->
        <div class="config-section">
          <label>所属分组</label>
          <SearchableSelect
            v-model="editForm.groupId"
            :options="groupFilterOptionsNoAll"
            :disabled="!isEditing"
            class="input-field"
            placeholder="请选择分组"
            search-placeholder="搜索分组..."
          />
        </div>

        <!-- 标签 -->
        <div class="config-section">
          <label>标签</label>
          <div class="tags-input-container">
            <div class="tags-display">
              <span
                v-for="(tag, index) in editForm.tags"
                :key="index"
                class="tag-chip"
              >
                {{ tag }}
                <button v-if="isEditing" @click="removeTag(index)" class="tag-remove">×</button>
              </span>
            </div>
            <div v-if="isEditing" class="tag-input-group">
              <input
                v-model="newTag"
                @keyup.enter="addTag"
                class="input-field"
                placeholder="输入标签后按回车"
              >
              <button @click="addTag" class="btn-add-tag">添加</button>
            </div>
          </div>
        </div>

        <!-- 提示词内容 -->
        <div class="config-section">
          <label>提示词内容 <span class="char-count">{{ editForm.content.length }} 字符</span></label>
          <textarea
            v-model="editForm.content"
            :readonly="!isEditing"
            class="textarea-field"
            placeholder="输入系统提示词内容..."
            rows="15"
          ></textarea>
        </div>

        <!-- 元信息 -->
        <div class="meta-info">
          <div class="meta-item">
            <span class="meta-label">创建时间：</span>
            <span class="meta-value">{{ formatDate(selectedPrompt.createdAt) }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">更新时间：</span>
            <span class="meta-value">{{ formatDate(selectedPrompt.updatedAt) }}</span>
          </div>
        </div>
      </div>

      <div v-else class="empty-details">
        <p>选择一个提示词查看详情</p>
      </div>
    </div>

    <!-- 分组管理弹窗 -->
    <div v-if="showGroupManager" class="modal-overlay" @click.self="showGroupManager = false">
      <div class="modal-content">
        <div class="modal-header">
          <h3>管理分组</h3>
          <button @click="showGroupManager = false" class="btn-close">×</button>
        </div>
        <div class="modal-body">
          <div class="group-list">
            <div v-for="group in groups" :key="group.id" class="group-item">
              <input
                v-model="group.name"
                @blur="updateGroup(group)"
                class="input-field"
                :disabled="group.id === 'default'"
              >
              <input
                v-model="group.description"
                @blur="updateGroup(group)"
                class="input-field"
                placeholder="描述"
                :disabled="group.id === 'default'"
              >
              <button
                v-if="group.id !== 'default'"
                @click="deleteGroup(group.id)"
                class="btn-delete-small"
              >
                删除
              </button>
            </div>
          </div>
          <button @click="createNewGroup" class="btn-add">+ 新建分组</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios';
import SearchableSelect from '../components/SearchableSelect.vue';

export default {
  name: 'PromptLibrary',
  components: {
    SearchableSelect
  },
  data() {
    return {
      prompts: [],
      groups: [],
      allTags: [],
      selectedPrompt: null,
      selectedGroupFilter: '',
      selectedTags: [],
      searchQuery: '',
      expandedGroups: {},
      showGroupManager: false,
      isEditing: false,
      editForm: {
        name: '',
        description: '',
        content: '',
        groupId: 'default',
        tags: []
      },
      newTag: ''
    };
  },
  computed: {
    filteredPrompts() {
      let filtered = this.prompts;

      // 搜索过滤
      if (this.searchQuery) {
        const query = this.searchQuery.toLowerCase();
        filtered = filtered.filter(p =>
          p.name.toLowerCase().includes(query) ||
          p.description?.toLowerCase().includes(query) ||
          p.content.toLowerCase().includes(query)
        );
      }

      // 分组过滤
      if (this.selectedGroupFilter) {
        filtered = filtered.filter(p => p.groupId === this.selectedGroupFilter);
      }

      // 标签过滤
      if (this.selectedTags.length > 0) {
        filtered = filtered.filter(p =>
          p.tags && p.tags.some(tag => this.selectedTags.includes(tag))
        );
      }

      return filtered;
    },
    groupedPrompts() {
      const grouped = {};

      // 初始化所有分组
      this.groups.forEach(group => {
        grouped[group.id] = {
          id: group.id,
          name: group.name,
          prompts: []
        };
      });

      // 将提示词分配到对应分组
      this.filteredPrompts.forEach(prompt => {
        const groupId = prompt.groupId || 'default';
        if (grouped[groupId]) {
          grouped[groupId].prompts.push(prompt);
        }
      });

      // 只返回有提示词的分组
      return Object.values(grouped).filter(g => g.prompts.length > 0);
    },
    groupFilterOptions() {
      return [
        { label: '全部分组', value: '' },
        ...this.groups.map(group => ({
          label: group.name,
          value: group.id
        }))
      ];
    },
    groupFilterOptionsNoAll() {
      return this.groups.map(group => ({
        label: group.name,
        value: group.id
      }));
    }
  },
  async mounted() {
    await this.loadData();
    // 默认展开所有分组
    const expanded = {};
    this.groups.forEach(group => {
      expanded[group.id] = true;
    });
    this.expandedGroups = expanded;
  },
  methods: {
    async loadData() {
      try {
        const response = await axios.get('/api/prompts');
        this.prompts = response.data.prompts || [];
        this.groups = response.data.groups || [];

        // 收集所有标签
        const tagsSet = new Set();
        this.prompts.forEach(prompt => {
          if (prompt.tags && Array.isArray(prompt.tags)) {
            prompt.tags.forEach(tag => tagsSet.add(tag));
          }
        });
        this.allTags = Array.from(tagsSet);

        // 确保所有分组都在 expandedGroups 中初始化
        const expanded = { ...this.expandedGroups };
        this.groups.forEach(group => {
          if (!(group.id in expanded)) {
            expanded[group.id] = true;
          }
        });
        this.expandedGroups = expanded;
      } catch (error) {
        console.error('加载提示词失败:', error);
        alert('加载提示词失败');
      }
    },
    selectPrompt(prompt) {
      this.selectedPrompt = prompt;
      this.isEditing = false;
      this.editForm = {
        name: prompt.name,
        description: prompt.description || '',
        content: prompt.content,
        groupId: prompt.groupId || 'default',
        tags: [...(prompt.tags || [])]
      };
    },
    async createNewPrompt() {
      try {
        const response = await axios.post('/api/prompts', {
          name: '新提示词',
          description: '',
          content: '',
          groupId: 'default',
          tags: []
        });
        await this.loadData();
        this.selectPrompt(response.data);
        this.startEdit();
      } catch (error) {
        console.error('创建提示词失败:', error);
        alert('创建提示词失败');
      }
    },
    startEdit() {
      this.isEditing = true;
    },
    cancelEdit() {
      this.isEditing = false;
      if (this.selectedPrompt) {
        this.editForm = {
          name: this.selectedPrompt.name,
          description: this.selectedPrompt.description || '',
          content: this.selectedPrompt.content,
          groupId: this.selectedPrompt.groupId || 'default',
          tags: [...(this.selectedPrompt.tags || [])]
        };
      }
    },
    async savePrompt() {
      if (!this.editForm.name.trim()) {
        alert('请输入提示词名称');
        return;
      }

      try {
        await axios.put(`/api/prompts/${this.selectedPrompt.id}`, this.editForm);
        await this.loadData();
        this.isEditing = false;
        // 重新选择以更新显示
        const updated = this.prompts.find(p => p.id === this.selectedPrompt.id);
        if (updated) {
          this.selectPrompt(updated);
        }
      } catch (error) {
        console.error('保存提示词失败:', error);
        alert('保存提示词失败');
      }
    },
    async deletePrompt() {
      if (!confirm(`确定要删除提示词"${this.selectedPrompt.name}"吗？`)) {
        return;
      }

      try {
        await axios.delete(`/api/prompts/${this.selectedPrompt.id}`);
        await this.loadData();
        this.selectedPrompt = null;
        this.isEditing = false;
      } catch (error) {
        console.error('删除提示词失败:', error);
        alert('删除提示词失败');
      }
    },
    addTag() {
      const tag = this.newTag.trim();
      if (tag && !this.editForm.tags.includes(tag)) {
        this.editForm.tags.push(tag);
        this.newTag = '';
      }
    },
    removeTag(index) {
      this.editForm.tags.splice(index, 1);
    },
    toggleTagFilter(tag) {
      const index = this.selectedTags.indexOf(tag);
      if (index > -1) {
        this.selectedTags.splice(index, 1);
      } else {
        this.selectedTags.push(tag);
      }
    },
    toggleGroupExpand(groupId) {
      this.expandedGroups = {
        ...this.expandedGroups,
        [groupId]: !this.expandedGroups[groupId]
      };
    },
    async createNewGroup() {
      const name = prompt('输入新分组名称:');
      if (!name || !name.trim()) return;

      try {
        await axios.post('/api/prompt-groups', {
          name: name.trim(),
          description: ''
        });
        await this.loadData();
      } catch (error) {
        console.error('创建分组失败:', error);
        alert('创建分组失败');
      }
    },
    async updateGroup(group) {
      try {
        await axios.put(`/api/prompt-groups/${group.id}`, group);
      } catch (error) {
        console.error('更新分组失败:', error);
        alert('更新分组失败');
      }
    },
    async deleteGroup(groupId) {
      if (!confirm('确定要删除此分组吗？该分组下的提示词将移至默认分组。')) {
        return;
      }

      try {
        await axios.delete(`/api/prompt-groups/${groupId}`);
        await this.loadData();
      } catch (error) {
        console.error('删除分组失败:', error);
        alert('删除分组失败');
      }
    },
    formatDate(dateString) {
      if (!dateString) return '-';
      const date = new Date(dateString);
      return date.toLocaleString('zh-CN');
    }
  }
};
</script>

<style scoped>
.prompt-library-container {
  display: flex;
  height: calc(100vh - 120px);
  gap: 1rem;
}

.prompts-sidebar {
  width: 350px;
  background: #ffffff;
  border-radius: 12px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  border: 1px solid #e2e8f0;
}

.sidebar-header {
  margin-bottom: 1rem;
}

.search-input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  margin-bottom: 0.5rem;
  background: white;
  color: #334155;
  outline: none;
}

.search-input:focus {
  border-color: #0891b2;
}

.search-input::placeholder {
  color: #94a3b8;
}

.button-group {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.btn-add, .btn-manage-groups {
  flex: 1;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 500;
}

.btn-add {
  background: #0891b2;
  color: white;
}

.btn-add:hover {
  background: #0e7490;
}

.btn-manage-groups {
  background: #f1f5f9;
  color: #334155;
}

.btn-manage-groups:hover {
  background: #e2e8f0;
}

.filter-section {
  margin-bottom: 1rem;
}

.filter-section label {
  display: block;
  font-size: 12px;
  color: #64748b;
  margin-bottom: 0.25rem;
  font-weight: 500;
}

.filter-select {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  background: white;
  color: #334155;
  outline: none;
}

.filter-select:focus {
  border-color: #0891b2;
}

.tags-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.tag-chip {
  padding: 0.25rem 0.75rem;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  color: #334155;
}

.tag-chip.active {
  background: #0891b2;
  color: white;
  border-color: #0891b2;
}

.tag-chip:hover {
  background: #e2e8f0;
  border-color: #cbd5e1;
}

.tag-chip.active:hover {
  background: #0e7490;
  border-color: #0e7490;
}

.prompts-list {
  flex: 1;
  overflow-y: auto;
}

.prompt-group {
  margin-bottom: 1rem;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: #f8fafc;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.group-header:hover {
  background: #f1f5f9;
}

.group-expand-icon {
  font-size: 12px;
  color: #64748b;
}

.group-name {
  flex: 1;
  font-weight: 600;
  color: #334155;
  font-size: 14px;
}

.group-count {
  background: #0891b2;
  color: white;
  padding: 0.125rem 0.5rem;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.group-prompts {
  margin-top: 0.5rem;
}

.prompt-item {
  padding: 0.75rem;
  margin: 0.25rem 0;
  background: white;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid #e2e8f0;
}

.prompt-item:hover {
  border-color: #0891b2;
  background: #f8fafc;
}

.prompt-item.active {
  border-color: #0891b2;
  background: #ecfeff;
}

.prompt-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.25rem;
}

.prompt-item-name {
  font-weight: 600;
  color: #334155;
  font-size: 14px;
}

.prompt-item-tags {
  display: flex;
  gap: 0.25rem;
}

.tag-mini {
  padding: 0.125rem 0.5rem;
  background: #f1f5f9;
  border-radius: 6px;
  font-size: 10px;
  color: #64748b;
}

.prompt-item-desc {
  font-size: 12px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-state {
  text-align: center;
  padding: 2rem 1rem;
  color: #94a3b8;
}

.btn-add-empty {
  margin-top: 0.5rem;
  padding: 0.5rem 1rem;
  background: #0891b2;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
}

.btn-add-empty:hover {
  background: #0e7490;
}

.prompt-details-panel {
  flex: 1;
  background: #ffffff;
  border-radius: 12px;
  padding: 1.5rem;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
}

.details-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e2e8f0;
}

.details-header h2 {
  font-size: 1.5rem;
  color: #334155;
  margin: 0;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-edit, .btn-save, .btn-cancel, .btn-delete-prompt {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
  font-weight: 500;
}

.btn-edit {
  background: #0891b2;
  color: white;
}

.btn-edit:hover {
  background: #0e7490;
}

.btn-save {
  background: #10b981;
  color: white;
}

.btn-save:hover {
  background: #059669;
}

.btn-cancel {
  background: #f1f5f9;
  color: #334155;
}

.btn-cancel:hover {
  background: #e2e8f0;
}

.btn-delete-prompt {
  background: #ef4444;
  color: white;
}

.btn-delete-prompt:hover {
  background: #dc2626;
}

.config-section {
  margin-bottom: 1.5rem;
}

.config-section label {
  display: block;
  font-weight: 600;
  color: #334155;
  margin-bottom: 0.5rem;
  font-size: 14px;
}

.char-count {
  float: right;
  font-weight: normal;
  color: #94a3b8;
  font-size: 12px;
}

.input-field, .textarea-field {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  transition: all 0.2s;
  font-family: inherit;
  background: white;
  color: #334155;
}

.input-field:focus, .textarea-field:focus {
  outline: none;
  border-color: #0891b2;
}

.input-field:read-only, .textarea-field:read-only {
  background: #f8fafc;
  cursor: not-allowed;
  color: #64748b;
}

.textarea-field {
  resize: vertical;
  min-height: 200px;
}

.tags-input-container {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 0.75rem;
  background: white;
}

.tags-display {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.tag-chip {
  padding: 0.25rem 0.75rem;
  background: #0891b2;
  color: white;
  border-radius: 6px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.tag-remove {
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  line-height: 1;
}

.tag-remove:hover {
  opacity: 0.8;
}

.tag-input-group {
  display: flex;
  gap: 0.5rem;
}

.tag-input-group .input-field {
  flex: 1;
}

.btn-add-tag {
  padding: 0.5rem 1rem;
  background: #0891b2;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
}

.btn-add-tag:hover {
  background: #0e7490;
}

.meta-info {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid #e2e8f0;
}

.meta-item {
  margin-bottom: 0.5rem;
  font-size: 13px;
}

.meta-label {
  color: #64748b;
}

.meta-value {
  color: #334155;
}

.empty-details {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #94a3b8;
  font-size: 16px;
}

.modal-overlay {
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

.modal-content {
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e2e8f0;
}

.modal-header h3 {
  margin: 0;
  font-size: 1.25rem;
  color: #334155;
  font-weight: 600;
}

.btn-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #94a3b8;
  padding: 0;
  line-height: 1;
}

.btn-close:hover {
  color: #64748b;
}

.group-list {
  margin-bottom: 1rem;
}

.group-item {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  align-items: center;
}

.group-item .input-field {
  flex: 1;
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
</style>

