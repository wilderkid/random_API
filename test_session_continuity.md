# 会话连续性测试文档

## 功能说明

混合会话识别机制已经集成到 `/v1/chat/completions` API 中，支持以下两种方式识别对话连续性：

### 1. Session ID 方式（优先级高）
通过以下两种方式之一传递 session_id：
- **HTTP Header**: `X-Session-ID: your-session-id`
- **请求体字段**: `user: "your-session-id"`

### 2. 消息指纹方式（自动识别）
如果没有提供 session_id，系统会自动基于前3条消息内容生成 MD5 指纹来识别对话。

## 工作原理

1. **首次请求**：系统选择一个可用的提供商处理请求
2. **绑定保存**：成功后，将 `会话标识符:模型名` 与提供商ID绑定
3. **后续请求**：相同会话标识符的请求会优先使用已绑定的提供商
4. **故障转移**：如果绑定的提供商失败，自动切换到其他可用提供商
5. **自动清理**：超过24小时未使用的会话映射会被自动清理

## 测试场景

### 场景1：使用 X-Session-ID Header

```bash
# 第一次请求（会选择一个提供商并绑定）
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -H "X-Session-ID: test-session-001" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "你好，我是张三"}
    ],
    "stream": false
  }'

# 第二次请求（会使用相同的提供商）
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -H "X-Session-ID: test-session-001" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "你好，我是张三"},
      {"role": "assistant", "content": "你好张三！很高兴认识你。"},
      {"role": "user", "content": "我刚才说我叫什么？"}
    ],
    "stream": false
  }'
```

### 场景2：使用 user 字段

```bash
# 第一次请求
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gpt-4",
    "user": "user-12345",
    "messages": [
      {"role": "user", "content": "请记住，我的项目代号是 Alpha"}
    ],
    "stream": false
  }'

# 第二次请求（会使用相同的提供商）
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gpt-4",
    "user": "user-12345",
    "messages": [
      {"role": "user", "content": "请记住，我的项目代号是 Alpha"},
      {"role": "assistant", "content": "好的，我记住了，你的项目代号是 Alpha。"},
      {"role": "user", "content": "我的项目代号是什么？"}
    ],
    "stream": false
  }'
```

### 场景3：自动消息指纹识别（无 session_id）

```bash
# 第一次请求（系统会生成消息指纹）
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "今天天气怎么样？"}
    ],
    "stream": false
  }'

# 第二次请求（相同的消息历史会被识别为同一对话）
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "今天天气怎么样？"},
      {"role": "assistant", "content": "今天天气晴朗，温度适宜。"},
      {"role": "user", "content": "适合出去玩吗？"}
    ],
    "stream": false
  }'
```

### 场景4：流式响应测试

```bash
# 使用 stream: true
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -H "X-Session-ID: stream-test-001" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "请写一首关于春天的诗"}
    ],
    "stream": true
  }'
```

## 日志验证

在服务器日志中，你应该能看到类似以下的输出：

```
[Proxy] Received request for model: gpt-4, stream: false
[Session] Session ID: test-session-001
[Session] Message Fingerprint: a1b2c3d4...
[Session] Using identifier: test-session-001
[Session] Cleaned up 0 expired conversation mappings
[Proxy] Pure model name: gpt-4
[Session] Found existing provider binding: Provider-A (ID: 1234567890)
[Proxy] Found 3 providers for failover
[Proxy] Attempt 1/3: Trying provider Provider-A (ID: 1234567890)
[Proxy] Using model ID: gpt-4 from provider Provider-A
[Proxy] Request completed successfully using provider Provider-A
[Session] Saved provider binding for session
```

## 数据存储

会话映射存储在 `data/user_settings.json` 文件的 `conversationProviderMap` 字段中：

```json
{
  "conversationProviderMap": {
    "gpt-4:test-session-001": {
      "providerId": "1234567890",
      "modelName": "gpt-4",
      "lastUsed": "2026-01-09T05:54:00.000Z",
      "messageCount": 5,
      "createdAt": "2026-01-09T05:50:00.000Z"
    }
  }
}
```

## 注意事项

1. **会话过期**：超过24小时未使用的会话映射会被自动清理
2. **映射上限**：最多保存1000条会话映射，超出后会删除最旧的
3. **提供商可用性**：如果绑定的提供商不可用或被禁用，会自动选择其他提供商
4. **模型禁用**：如果模型在绑定的提供商上被禁用，会自动选择其他提供商
5. **优先级**：Session ID > 消息指纹，如果两者都提供，优先使用 Session ID

## 兼容性

- ✅ 完全兼容 OpenAI API 规范
- ✅ 支持流式和非流式响应
- ✅ 支持多模态消息（图片等）
- ✅ 向后兼容，不影响现有功能
- ✅ 可选功能，不提供 session_id 时仍可正常工作

## 故障排查

### 问题1：会话没有被识别
- 检查 session_id 是否一致
- 检查消息历史的前3条是否完全相同
- 查看服务器日志中的 `[Session]` 标记

### 问题2：提供商没有绑定
- 确认请求成功完成（状态码200）
- 检查 `data/user_settings.json` 中的 `conversationProviderMap`
- 查看日志中是否有 "Saved provider binding" 消息

### 问题3：绑定的提供商没有被使用
- 检查提供商是否被禁用
- 检查模型在该提供商是否被禁用
- 查看日志中的提供商选择过程
