import http from 'http';
import net from 'net';
import { WebSocketServer } from 'ws';

// ================= 1. 核心配置区 =================
// 你的 VLESS UUID
const uuid = "c8f4aa8a-bfa0-41b8-9bd9-3f3f7776dec3"; 

// 🎯 这里就是你说的“接收专门流量的子目录”！
// 比如填 'my443path'，那么客户端 Path 就填 '/my443path'
const SUB_DIRECTORY = "program"; 

// 内部监听端口（必须用云平台分配的，千万别写死 443）
const port = process.env.PORT || 8000;
// =================================================

// 2. 正常流量处理 (伪装与健康检查)
const httpServer = http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];

    // 如果别人只访问你的域名首页，看到的是漂亮的网址导航
    if (pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        const htmlPage = `
        <!DOCTYPE html><html><head><meta charset="UTF-8"><title>极简导航</title>
        <style>body { text-align:center; font-family: Arial; background: #f4f7f6; }
        .row { display:grid; grid-template-columns:repeat(5,1fr); gap: 15px; max-width: 800px; margin: 50px auto; }
        .item { padding:15px; background: white; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
        a { text-decoration:none; color: #333; display: block; }</style>
        </head><body><h2 style="color: #2c3e50; margin-top: 40px;">网址导航</h2>
        <div class="row">
            <div class="item"><a href="https://www.google.com">Google</a></div>
            <div class="item"><a href="https://www.bing.com">Bing</a></div>
            <div class="item"><a href="https://www.github.com">GitHub</a></div>
        </div></body></html>`;
        res.end(htmlPage);
    }
    // 应付云平台探针：其他普通 HTTP 请求无脑返回 200，保证容器不被杀
    else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
    }
});

// 3. 🎯 专门接收 443 转发过来的代理流量
const webSocketServer = new WebSocketServer({ noServer: true });

// HTTP 服务拦截升级请求 (Upgrade)
httpServer.on('upgrade', (request, socket, head) => {
    const pathname = request.url.split('?')[0];
    
    // 🚦 核心分流逻辑：只有匹配上了咱们设定的“子目录”，才放行进入 VLESS 通道！
    if (pathname === `/${SUB_DIRECTORY}`) {
        webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
            webSocketServer.emit('connection', webSocket, request);
        });
    } else {
        // 如果别人用探测器乱扫你的其他子目录，直接粗暴断开，保护你的节点
        socket.destroy(); 
    }
});

// 4. VLESS 协议解析底层代码
webSocketServer.on('connection', (webSocket) => {
    webSocket.binaryType = 'arraybuffer';
    let isFirstConnect = true;

    webSocket.on('message', (messageData) => {
        const myBuffer = new Uint8Array(messageData);

        if (isFirstConnect) {
            isFirstConnect = false;
            if (myBuffer.length < 24 || myBuffer[0] !== 0) return webSocket.close();
            
            const originUuid = uuid.replace(/-/g, ""); 
            const receivedUuid = Array.from(myBuffer.slice(1, 17))
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join(''); 
            if (receivedUuid !== originUuid) return webSocket.close();
            
            const extrasLength = myBuffer[17];
            let offset = 18 + extrasLength;
            const cmd = myBuffer[offset++];
            if (cmd !== 1) return webSocket.close();
            
            const targetPort = (myBuffer[offset] << 8) | myBuffer[offset + 1];
            offset += 2;
            const addressType = myBuffer[offset++];
            let targetAddress = '';
            
            if (addressType === 1) { 
                targetAddress = myBuffer[offset] + '.' + myBuffer[offset + 1] + '.' + myBuffer[offset + 2] + '.' + myBuffer[offset + 3];
                offset += 4;
            } else if (addressType === 2) { 
                const domainLength = myBuffer[offset++];
                targetAddress = new TextDecoder().decode(myBuffer.slice(offset, offset + domainLength));
                offset += domainLength;
            } else if (addressType === 3) { 
                const parts = [];
                for (let i = 0; i < 8; i++) {
                    parts.push(((myBuffer[offset] << 8) | myBuffer[offset + 1]).toString(16));
                    offset += 2;
                }
                targetAddress = '[' + parts.join(':') + ']';
            } else {
                return webSocket.close();
            }

            const remoteSocket = net.connect(targetPort, targetAddress, () => {
                webSocket.send(new Uint8Array([myBuffer[0], 0]).buffer);
                const payload = myBuffer.slice(offset);
                if (payload.length > 0) remoteSocket.write(payload);
                
                webSocket.on('message', (chunk) => remoteSocket.write(new Uint8Array(chunk)));
                remoteSocket.on('data', (chunk) => webSocket.send(chunk));
            });

            remoteSocket.on('error', () => webSocket.close());
            remoteSocket.on('end', () => webSocket.close());
            webSocket.on('close', () => remoteSocket.destroy());
            webSocket.on('error', () => remoteSocket.destroy());
        }
    });
});

// 5. 启动服务
httpServer.listen(Number(port), '0.0.0.0', () => {
    console.log(`✅ 服务已启动，分配内部端口: ${port}，专属流量子目录: /${SUB_DIRECTORY}`);
});
