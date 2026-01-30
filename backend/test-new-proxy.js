const axios = require('axios');
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');

console.log('=== 测试新的代理配置 ===\n');

// 检查环境变量
const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || httpProxy;

console.log('环境变量:');
console.log('  HTTP_PROXY:', httpProxy || '未设置');
console.log('  HTTPS_PROXY:', httpsProxy || '未设置');
console.log();

// 配置代理
let httpAgent, httpsAgent;

if (httpProxy) {
  httpAgent = new HttpProxyAgent(httpProxy);
  console.log('✓ HTTP代理已配置');
}

if (httpsProxy) {
  httpsAgent = new HttpsProxyAgent(httpsProxy, {
    rejectUnauthorized: false
  });
  console.log('✓ HTTPS代理已配置');
}

console.log();

// 测试连接
async function testConnections() {
  const axiosInstance = axios.create({
    httpAgent: httpAgent,
    httpsAgent: httpsAgent,
    timeout: 10000
  });

  console.log('开始测试连接...\n');

  // 测试1: 国内网站（不需要代理）
  try {
    console.log('1. 测试 baidu.com (国内网站):');
    const response = await axiosInstance.get('https://www.baidu.com', { timeout: 5000 });
    console.log('   ✓ 成功! 状态码:', response.status);
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
  }

  // 测试2: 国际网站（可能需要代理）
  try {
    console.log('\n2. 测试 google.com (国际网站):');
    const response = await axiosInstance.get('https://www.google.com', { timeout: 8000 });
    console.log('   ✓ 成功! 状态码:', response.status);
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
  }

  // 测试3: OpenAI API
  try {
    console.log('\n3. 测试 OpenAI API (需要VPN):');
    const response = await axiosInstance.get('https://api.openai.com/v1/models', {
      headers: { 'Authorization': 'Bearer test' },
      timeout: 8000,
      validateStatus: () => true
    });
    console.log('   ✓ 连接成功! 状态码:', response.status);
    if (response.status === 401) {
      console.log('   ℹ 状态码401表示API密钥无效，但连接成功（这是正常的）');
    }
  } catch (error) {
    console.log('   ✗ 连接失败:', error.code || error.message);
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      console.log('   ℹ 可能需要VPN才能访问此网站');
    }
  }

  // 测试4: 获取公网IP
  try {
    console.log('\n4. 测试 ipify.org (获取公网IP):');
    const response = await axiosInstance.get('https://api.ipify.org?format=json', { timeout: 8000 });
    console.log('   ✓ 成功! 你的公网IP:', response.data.ip);
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
  }

  console.log('\n=== 测试完成 ===');
}

testConnections().catch(console.error);
