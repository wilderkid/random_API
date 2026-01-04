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

- ✅ 多 API 提供商管理
- ✅ 统一的聊天界面
- ✅ 模型轮询调用
- ✅ 参数配置
- ✅ 对话历史管理
- ✅ 流式输出支持
- ✅ 毛玻璃 UI 设计

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

### 生产模式

1. 构建前端：
```bash
cd frontend
npm run build
```

2. 启动后端（会自动托管前端静态文件）：
```bash
cd backend
npm start
```

访问 http://localhost:3000 即可使用完整应用。

## 使用说明

### 1. 添加 API 提供商
- 进入"API 管理"页面
- 点击"添加 API"按钮
- 填写提供商名称、基础 URL 和 API Key
- 点击"获取模型列表"验证配置

### 2. 开始对话
- 在主页点击"新建对话"
- 选择要使用的模型
- 输入消息并发送

### 3. 配置轮询
- 进入"轮询配置"页面
- 将模型在可用池和排除池之间移动
- 拖拽调整提供商的调用顺序

### 4. 调整参数
- 在聊天界面点击"参数配置"按钮
- 或在"用户设置"页面设置默认参数

## 技术栈

- **后端**: Node.js + Express.js
- **前端**: Vue.js 3 + Vite
- **样式**: 原生 CSS（毛玻璃效果）
- **数据存储**: JSON 文件

## 注意事项

- API Key 仅存储在后端，前端不会直接访问
- 数据文件存储在 `data/` 目录
- 连续失败 3 次的模型会被自动禁用
- 支持所有遵循 OpenAI API 规范的第三方平台

## 开发者

项目负责人: wildkid
版本: 1.0
创建日期: 2026年1月3日
