# Random_API - AI 模型管理平台

一个用于统一管理和调用多个第三方 AI 大模型 API 的 Web 应用。

## 项目结构

```
equal_ask/
├── backend/              # 后端服务
│   ├── package.json
│   └── server.js
├── frontend/             # 前端应用
│   ├── src/
│   │   ├── views/       # 页面组件
│   │   ├── App.vue
│   │   ├── main.js
│   │   └── style.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── data/                 # 数据存储目录（自动创建）
│   ├── api_settings.json
│   ├── user_settings.json
│   ├── conversations/
│   └── logs/
└── document/            # 项目文档
```

## 功能特性

### 核心功能
- ✅ 多 API 提供商管理
- ✅ 统一的聊天界面
- ✅ 模型轮询调用
- ✅ 参数配置
- ✅ 对话历史管理
- ✅ 流式输出支持
- ✅ 毛玻璃 UI 设计

### 高级功能
- ✅ **多模态支持** - 支持文本、图像等多模态输入
- ✅ **会话连续性** - 智能识别对话上下文，保持模型一致性
- ✅ **代理密钥管理** - 创建和管理独立的API密钥，支持分组和权限控制
- ✅ **翻译功能** - 集成翻译界面，支持多语言翻译
- ✅ **提示词库** - 创建和管理自定义提示词，支持分组和标签
- ✅ **轮询配置** - 灵活配置模型调用顺序和排除规则
- ✅ **统计仪表盘** - 详细的API调用统计和成本分析
- ✅ **系统日志** - 完整的日志记录和分析功能
- ✅ **多种UI风格** - 可切换的界面风格系统
- ✅ **实时监控** - 实时查看API调用状态和性能

## 安装依赖

### 后端
```bash
cd backend
npm install
```

### 前端
```bash
cd frontend
npm install
```

## 启动服务

### 开发模式

1. 启动后端服务：
```bash
cd backend
npm start
```
后端将运行在 http://localhost:3000

2. 启动前端开发服务器：
```bash
cd frontend
npm run dev
```
前端将运行在 http://localhost:5173

### 生产模式（一键启动）

1. **构建应用**（首次运行或前端代码变更后需要执行）：
```bash
cd backend
npm run build
```
这个命令会自动完成前端依赖安装和静态文件构建。

2. **启动服务**：
```bash
cd backend
npm start
```
服务启动后，直接访问 http://localhost:3000 即可使用完整应用，无需再单独启动前端。

## 使用说明

### 1. API 提供商管理
- 进入"API 管理"页面
- 点击"添加 API"按钮
- 填写提供商名称、基础 URL 和 API Key
- 点击"获取模型列表"验证配置
- 支持多个API提供商同时管理

### 2. 聊天对话
- 在主页点击"新建对话"
- 选择要使用的模型
- 输入消息并发送
- 支持多模态输入（文本、图片）
- 支持流式输出，实时查看响应

### 3. 代理密钥管理
- 进入"代理密钥"页面
- 创建新的代理密钥，供外部应用使用
- 配置密钥的权限和默认参数
- 支持轮询模式和分组选择
- 复制密钥供外部应用调用

### 4. 翻译功能
- 进入"翻译"页面
- 选择源语言和目标语言
- 输入要翻译的文本
- 选择翻译模型和提示词
- 一键复制翻译结果

### 5. 提示词库
- 进入"提示词库"页面
- 创建和管理自定义提示词
- 使用分组和标签组织提示词
- 在聊天中快速应用预设提示词

### 6. 轮询配置
- 进入"轮询配置"页面
- 将模型在可用池和排除池之间移动
- 拖拽调整提供商的调用顺序
- 支持按分组显示和管理模型
- 配置故障转移机制

### 7. 统计分析
- 进入"统计"页面
- 查看详细的API调用统计
- 分析各提供商的调用成功率
- 监控Token使用量和成本
- 导出统计报告

### 8. 日志管理
- 进入"日志"页面
- 查看系统运行日志
- 按日期、级别、类型筛选日志
- 导出日志文件供分析
- 实时监控系统状态

### 9. 参数配置
- 在聊天界面点击"参数配置"按钮
- 或在"用户设置"页面设置默认参数
- 支持温度、最大长度等参数调整
- 可为不同模型设置专用参数

## 技术栈

- **后端**: Node.js + Express.js + Axios
- **前端**: Vue.js 3 + Vite + Vue Router
- **样式**: 原生 CSS（毛玻璃效果）
- **数据存储**: JSON 文件
- **日志系统**: 自定义日志管理模块

## API 调用说明

### 基础调用格式

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "你好"}
    ]
  }'
```

### 会话连续性支持

通过 `X-Session-ID` header 或请求体中的 `user` 字段传递会话标识：

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: your-session-id" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "你好"},
      {"role": "assistant", "content": "你好！有什么可以帮你的？"},
      {"role": "user", "content": "介绍一下自己"}
    ]
  }'
```

### 翻译 API

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "system", "content": "你是一个专业的翻译助手"},
      {"role": "user", "content": "将以下文本翻译成中文：Hello World"}
    ]
  }'
```

## 注意事项

- API Key 仅存储在后端，前端不会直接访问
- 数据文件存储在 `data/` 目录
- 连续失败 3 次的模型会被自动禁用
- 支持所有遵循 OpenAI API 规范的第三方平台
- 会话绑定有效期24小时，自动清理过期映射
- 日志文件默认保留7天，可手动清理

## 页面导航

| 页面 | 路由 | 功能 |
|------|------|------|
| 聊天 | `/` | 主对话界面 |
| 翻译 | `/translate` | 多语言翻译 |
| API 管理 | `/settings/apis` | 管理API提供商 |
| 轮询配置 | `/settings/polling` | 配置模型调用策略 |
| 代理密钥 | `/settings/proxy-keys` | 管理API密钥 |
| 用户设置 | `/settings/defaults` | 设置默认参数 |
| 提示词库 | `/prompts` | 管理提示词 |
| 日志 | `/logs` | 查看系统日志 |
| 统计 | `/stats` | API调用统计 |

## 开发者

项目负责人: wildkid
版本: 1.1
创建日期: 2026年1月3日
更新日期: 2026年2月6日
