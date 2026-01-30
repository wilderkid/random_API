const axios = require('axios');
const { ProxyAgent } = require('proxy-agent');

// 创建ProxyAgent
const proxyAgent = new ProxyAgent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 30000
});

// 配置axios
axios.defaults.httpAgent = proxyAgent;
axios.defaults.httpsAgent = proxyAgent;
axios.defaults.timeout = 10000;

console.log('=== 代理配置测试 ===\n');

// 检查环境变量
console.log('环境变量检查:');
console.log('  HTTP_PROXY:', process.env.HTTP_PROXY || '未设置');
console.log('  HTTPS_PROXY:', process.env.HTTPS_PROXY || '未设置');
console.log('  NO_PROXY:', process.env.NO_PROXY || '未设置');
console.log('  ALL_PROXY:', process.env.ALL_PROXY || '未设置');
console.log();

// 测试连接
async function testConnection() {
  console.log('测试连接...');

  try {
    console.log('\n1. 测试国内网站 (baidu.com):');
    const response1 = await axios.get('https://www.baidu.com', { timeout: 5000 });
    console.log('   ✓ 连接成功，状态码:', response1.status);
  } catch (error) {
    console.log('   ✗ 连接失败:', error.message);
  }

  try {
    console.log('\n2. 测试国际网站 (google.com):');
    const response2 = await axios.get('https://www.google.com', { timeout: 5000 });
    console.log('   ✓ 连接成功，状态码:', response2.status);
  } catch (error) {
    console.log('   ✗ 连接失败:', error.message);
  }

  try {
    console.log('\n3. 测试OpenAI API (需要VPN):');
    const response3 = await axios.get('https://api.openai.com/v1/models', {
      headers: { 'Authorization': 'Bearer test' },
      timeout: 5000,
      validateStatus: () => true // 接受所有状态码
    });
    console.log('   ✓ 连接成功，状态码:', response3.status);
    if (response3.status === 401) {
      console.log('   ℹ 状态码401表示连接成功但API密钥无效（这是正常的）');
    }
  } catch (error) {
    console.log('   ✗ 连接失败:', error.message);
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      console.log('   ℹ 可能需要VPN才能访问此网站');
    }
  }

  console.log('\n=== 测试完成 ===');
}

testConnection().catch(console.error);
