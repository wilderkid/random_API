# 会话结构化总结（Gemini Relay 生图卡住问题）

## 1. 主要请求与意图
- 主要问题：Gemini relay 生图响应在前端不显示图片，界面持续停留在“正在生成图片”。
- 目标：基于用户提供的 SSE 原始文本，定位前端“卡住”的根因，并总结已做的修复与下一步分析方向。

## 2. 关键技术概念
- 前端：Vue 3、SSE 流式解析、Markdown 渲染（`marked`）、内容净化（`DOMPurify`）。
- 后端：Node/Express、SSE 代理转发、图片生成接口与流式处理。
- 数据形态：`data:image/*;base64,...` 数据 URL、Markdown 图片语法 `![alt](url)`、SSE 终止标记 `data: [DONE]`。
- UI 状态：流式响应 `streaming` 状态、图片消息 `messageType: 'image-response'`。

## 3. 读取/修改的文件与代码位置
- 前端逻辑：[`frontend/src/views/Chat.vue`](frontend/src/views/Chat.vue:3212)
  - SSE 流解析、图片检测、Markdown 图片提取、渲染与 DOMPurify 配置。
  - 关键逻辑位置：
    - DOMPurify 放行 data:image：[`frontend/src/views/Chat.vue`](frontend/src/views/Chat.vue:2267)
    - 流式增量解析与图片检测：[`frontend/src/views/Chat.vue`](frontend/src/views/Chat.vue:3212)
    - `normalizeDataImageUrls`：[`frontend/src/views/Chat.vue`](frontend/src/views/Chat.vue:4007)
    - `filterLargeImages` 绕过 data URL 尺寸检测：[`frontend/src/views/Chat.vue`](frontend/src/views/Chat.vue:4111)
- 后端逻辑：[`backend/server.js`](backend/server.js:4157)
  - 上游流结束时补发 `[DONE]`：[`backend/server.js`](backend/server.js:4157)

## 4. 已做的代码变更与片段（精确变更）
### 4.1 前端：归一化 data:image 并绕过尺寸检测
- 目的：解决 data URL 在流式拼接中出现换行/空格导致 DOMPurify 拦截、以及 data URL 图片尺寸无法可靠加载导致过滤失败。
- 关键新增逻辑：
  - 在流结束后规范化内容：
    ```js
    assistantMsg.content = normalizeDataImageUrls(assistantMsg.content)
    ```
    位置：[`frontend/src/views/Chat.vue`](frontend/src/views/Chat.vue:3291)
  - 新增归一化函数：
    ```js
    function normalizeDataImageUrls(content) {
      if (!content || !content.includes('data:image')) return content
      return content.replace(
        /data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+/gi,
        (match) => match.replace(/\s+/g, '')
      )
    }
    ```
    位置：[`frontend/src/views/Chat.vue`](frontend/src/views/Chat.vue:4007)
  - data URL 绕过尺寸检测：
    ```js
    if (img.url && img.url.startsWith('data:image/')) {
      return { ...img, url: normalizeDataImageUrls(img.url), isLarge: true }
    }
    ```
    位置：[`frontend/src/views/Chat.vue`](frontend/src/views/Chat.vue:4113)

### 4.2 后端：流结束补发 `[DONE]`
- 目的：避免上游不发送 `[DONE]` 导致前端一直 `streaming`。
- 关键逻辑：
  ```js
  let sawDone = false;
  upstreamResponse.data.on('data', (chunk) => {
    if (chunk && chunk.toString('utf8').includes('[DONE]')) {
      sawDone = true;
    }
  });
  upstreamResponse.data.on('end', () => {
    if (!sawDone) {
      res.write('data: [DONE]\n\n');
    }
    res.end();
  });
  ```
  位置：[`backend/server.js`](backend/server.js:4157)

## 5. 报错与修复记录
- 无法本地运行 `curl`：需要用户在本机 PowerShell 执行。
- PowerShell `curl` 实为 `Invoke-WebRequest`，最初报错：
  - `Invoke-WebRequest : 无法绑定参数“Headers”`（header 类型不匹配）。
- 解决方案：改用 `Invoke-WebRequest -UseBasicParsing -OutFile`，再 `Get-Content -Raw` 获取 SSE 原文。

## 6. 问题定位过程（已验证与推断）
1. 已确认 DOMPurify 允许 data URL：`ALLOWED_URI_REGEXP` 已放行 `data:image/*;base64,`，位置见 [`frontend/src/views/Chat.vue`](frontend/src/views/Chat.vue:2267)。
2. 用户提供的 SSE 中含 Markdown 图片：`![image](data:image/jpeg;base64,...)`。
3. SSE 末尾包含 `data: [DONE]` 且 `finish_reason: "stop"`，说明上游已完成。
4. 已新增：
   - `normalizeDataImageUrls` 去除 base64 中换行/空白。
   - data URL 绕过尺寸检测，避免 `filterLargeImages` 误判。
   - 后端补发 `[DONE]` 兜底。
5. 仍然症状：前端 UI 依旧显示“正在生成图片”，说明剩余问题可能在前端流式结束后的状态处理或渲染逻辑上。

## 7. 用户消息（按时间顺序，非工具输出）
1. “## Conversation Summary …”（用户要求生成结构化总结，含所有细节和直引）
2. “控制台输出： … 而前台页面依旧显示，正在生成图片，现在的问题是根本不知道问题出在哪”
3. “请重启后端并在浏览器重试生图，然后粘贴浏览器 Network 中该请求的 Response（原始 SSE 文本）”
4. “我提供模型名与请求参数：modelId=1767581306384::gemini-3-pro-image-1k-9-16，size=1024x1024，quality=standard，其它默认；请用 curl 复现。”
5. “PS … Invoke-WebRequest error …”
6. “这个命令根本无法执行，因为换行的问题”
7. “PS … Get-Content .\sse.txt -Raw … data: … data: [DONE]”

## 8. 仍待完成事项（Pending）
- 核查前端在收到 `[DONE]` 后是否确实将 `assistantMsg.streaming = false` 并触发渲染更新，是否存在被覆盖的状态提示或渲染缓存问题。
- 进一步审查 Markdown 图片提取后，`messageType` / `generatedImages` 是否与 UI 渲染分支一致（例如生成容器是否被隐藏或被流式状态遮挡）。

## 9. 当前工作状态
- 已完成 data URL 归一化、后端 `[DONE]` 兜底、data URL 绕过尺寸检测。用户提供了完整 SSE 文本，包含 `data:image` Markdown 与 `[DONE]`。
- 仍出现“正在生成图片”停滞现象，当前正在分析前端流式结束后的状态与渲染路径。

## 10. 可选下一步（含直接引用）
- 建议重点检查流结束后 UI 状态切换与渲染分支，特别是：
  - `assistantMsg.streaming` 是否在遇到大体积 data URL 时被异常覆盖；
  - Markdown 图片提取后 `messageType='image-response'` 是否触发正确的渲染容器；
  - `renderedCache` 是否导致显示依旧停留在状态文本。
- 引用（用户）：
  - “而前台页面依旧显示，正在生成图片，现在的问题是根本不知道问题出在哪”
  - “PS … Get-Content .\sse.txt -Raw … data: … data: [DONE]”

---

## 参考链接
- 前端关键文件：[`frontend/src/views/Chat.vue`](frontend/src/views/Chat.vue:3212)
- 后端关键文件：[`backend/server.js`](backend/server.js:4157)
