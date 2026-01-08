// 使用Node.js内置的http模块进行测试，避免依赖axios
const http = require('http');

// 发送HTTP POST请求的辅助函数
function makeRequest(path, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(responseData);
          resolve({ status: res.statusCode, data: parsedData });
        } catch (e) {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(postData);
    req.end();
  });
}

// 测试代理API的参数处理功能
async function testProxyParams() {
  console.log('🧪 开始测试代理API参数处理功能...\n');
  
  // 测试用例1: 不传递任何参数，应该使用默认参数
  console.log('📋 测试用例1: 使用默认参数');
  try {
    const response1 = await makeRequest('/v1/chat/completions', {
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'gpt-4o-mini', // 使用实际在可用池中的模型
      stream: false
    });
    
    if (response1.status === 200) {
      console.log('✅ 默认参数测试通过');
    } else {
      console.log('❌ 默认参数测试失败:', response1.data);
    }
  } catch (error) {
    console.log('❌ 默认参数测试失败:', error.message);
  }
  
  console.log('\n📋 测试用例2: 传递部分外部参数');
  try {
    const response2 = await makeRequest('/v1/chat/completions', {
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'gpt-4o-mini',
      temperature: 0.9, // 外部参数
      stream: false
    });
    
    if (response2.status === 200) {
      console.log('✅ 部分外部参数测试通过');
    } else {
      console.log('❌ 部分外部参数测试失败:', response2.data);
    }
  } catch (error) {
    console.log('❌ 部分外部参数测试失败:', error.message);
  }
  
  console.log('\n📋 测试用例3: 传递所有外部参数');
  try {
    const response3 = await makeRequest('/v1/chat/completions', {
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'gpt-4o-mini',
      temperature: 0.5, // 外部参数
      max_tokens: 1000, // 外部参数
      top_p: 0.8, // 外部参数
      stream: false
    });
    
    if (response3.status === 200) {
      console.log('✅ 所有外部参数测试通过');
    } else {
      console.log('❌ 所有外部参数测试失败:', response3.data);
    }
  } catch (error) {
    console.log('❌ 所有外部参数测试失败:', error.message);
  }
  
  console.log('\n📋 测试用例4: 传递额外的自定义参数');
  try {
    const response4 = await makeRequest('/v1/chat/completions', {
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 500,
      top_p: 0.9,
      presence_penalty: 0.1, // 额外参数
      frequency_penalty: 0.2, // 额外参数
      stream: false
    });
    
    if (response4.status === 200) {
      console.log('✅ 额外自定义参数测试通过');
    } else {
      console.log('❌ 额外自定义参数测试失败:', response4.data);
    }
  } catch (error) {
    console.log('❌ 额外自定义参数测试失败:', error.message);
  }
  
  console.log('\n📋 测试用例5: 测试参数值为0的情况');
  try {
    const response5 = await makeRequest('/v1/chat/completions', {
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'gpt-4o-mini',
      temperature: 0, // 值为0，应该被正确处理
      top_p: 0, // 值为0，应该被正确处理
      stream: false
    });
    
    if (response5.status === 200) {
      console.log('✅ 参数值为0的测试通过');
    } else {
      console.log('❌ 参数值为0的测试失败:', response5.data);
    }
  } catch (error) {
    console.log('❌ 参数值为0的测试失败:', error.message);
  }
  
  console.log('\n🎯 参数处理功能测试完成！');
  console.log('\n💡 请检查服务器控制台输出，确认参数处理日志显示正确的优先级处理。');
  console.log('\n📝 注意：如果测试失败，可能是因为：');
  console.log('   1. 服务器未启动（请先运行 cd backend && npm start）');
  console.log('   2. 模型 gpt-4o-mini 不在可用池中（请在轮询设置中配置）');
  console.log('   3. 没有配置有效的API提供商');
}

// 运行测试
testProxyParams().catch(console.error);