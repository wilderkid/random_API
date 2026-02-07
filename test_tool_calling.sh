#!/bin/bash

# 测试工具调用功能
# 根据 roocode_API_details.md 文档的建议

echo "Testing Tool Calling functionality..."
echo "======================================"

# 替换为你的实际配置
BASE_URL="http://localhost:3000"
API_KEY="your-api-key-here"
MODEL="claude-sonnet-4-5-20250929"

echo ""
echo "Test 1: Simple tool calling test"
echo "---------------------------------"

curl -X POST "${BASE_URL}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{
    "model": "'"${MODEL}"'",
    "messages": [
      {"role": "user", "content": "获取北京的当前天气"}
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_current_weather",
          "description": "获取指定位置的当前天气",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {
                "type": "string",
                "description": "城市和州，例如 Beijing, China"
              },
              "unit": {
                "type": "string",
                "enum": ["celsius", "fahrenheit"],
                "description": "温度单位"
              }
            },
            "required": ["location"]
          }
        }
      }
    ],
    "tool_choice": "auto",
    "stream": false
  }' | jq .

echo ""
echo ""
echo "Test 2: Streaming tool calling test"
echo "------------------------------------"

curl -X POST "${BASE_URL}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{
    "model": "'"${MODEL}"'",
    "messages": [
      {"role": "user", "content": "读取 /etc/hosts 文件的内容"}
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "read_file",
          "description": "读取文件内容",
          "parameters": {
            "type": "object",
            "properties": {
              "path": {
                "type": "string",
                "description": "文件路径"
              }
            },
            "required": ["path"]
          }
        }
      }
    ],
    "tool_choice": "auto",
    "stream": true
  }'

echo ""
echo ""
echo "======================================"
echo "Tests completed!"
echo ""
echo "Expected results:"
echo "1. Non-streaming: Should return JSON with 'tool_calls' array"
echo "2. Streaming: Should return SSE events with tool_calls in delta"
echo ""
echo "If you see 'tool_calls' in the response, the implementation is working!"
