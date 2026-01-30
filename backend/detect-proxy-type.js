const net = require('net');

console.log('=== 检测代理类型 ===\n');

// 测试是否是HTTP代理
function testHttpProxy() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 10809 }, () => {
      console.log('1. 测试HTTP代理协议...');

      // 发送HTTP CONNECT请求
      socket.write('CONNECT www.google.com:443 HTTP/1.1\r\nHost: www.google.com:443\r\n\r\n');

      let data = '';
      socket.on('data', (chunk) => {
        data += chunk.toString();
        if (data.includes('\r\n\r\n')) {
          if (data.includes('HTTP/1.1 200') || data.includes('HTTP/1.0 200')) {
            console.log('   ✓ 这是一个HTTP代理');
            console.log('   响应:', data.split('\r\n')[0]);
            socket.end();
            resolve('http');
          } else {
            console.log('   ✗ HTTP代理握手失败');
            console.log('   响应:', data);
            socket.end();
            resolve('unknown');
          }
        }
      });

      socket.setTimeout(3000, () => {
        console.log('   ✗ HTTP代理测试超时');
        socket.destroy();
        resolve('timeout');
      });
    });

    socket.on('error', (err) => {
      console.log('   ✗ 连接失败:', err.message);
      resolve('error');
    });
  });
}

// 测试是否是SOCKS5代理
function testSocks5Proxy() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 10809 }, () => {
      console.log('\n2. 测试SOCKS5代理协议...');

      // 发送SOCKS5握手请求
      // 格式: [版本(0x05), 认证方法数量(0x01), 无认证(0x00)]
      const handshake = Buffer.from([0x05, 0x01, 0x00]);
      socket.write(handshake);

      socket.once('data', (data) => {
        // SOCKS5服务器应该返回 [0x05, 0x00] 表示接受无认证
        if (data.length >= 2 && data[0] === 0x05) {
          console.log('   ✓ 这是一个SOCKS5代理');
          console.log('   响应:', Array.from(data).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
          socket.end();
          resolve('socks5');
        } else {
          console.log('   ✗ SOCKS5握手失败');
          console.log('   响应:', Array.from(data).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
          socket.end();
          resolve('unknown');
        }
      });

      socket.setTimeout(3000, () => {
        console.log('   ✗ SOCKS5代理测试超时');
        socket.destroy();
        resolve('timeout');
      });
    });

    socket.on('error', (err) => {
      console.log('   ✗ 连接失败:', err.message);
      resolve('error');
    });
  });
}

async function main() {
  const httpResult = await testHttpProxy();
  const socks5Result = await testSocks5Proxy();

  console.log('\n=== 检测结果 ===');
  console.log('HTTP代理:', httpResult);
  console.log('SOCKS5代理:', socks5Result);

  if (socks5Result === 'socks5') {
    console.log('\n建议: 你的代理是SOCKS5类型，需要使用socks-proxy-agent');
    console.log('环境变量应该设置为: socks5://127.0.0.1:10809');
  } else if (httpResult === 'http') {
    console.log('\n建议: 你的代理是HTTP类型，当前配置应该可以工作');
  }
}

main().catch(console.error);
