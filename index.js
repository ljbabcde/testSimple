import http from 'http';
import net from 'net';
import { WebSocketServer } from 'ws';

// 1. 环境变量与配置

const uuid = process.env.UID || "cac4d96c-abf4-4";
const webSocketPath = "myprogram";

const port = process.env.PORT || 3000;

// 2. 网页与 HTTP 路由
const httpServer = http.createServer((req, res) => {
    // 路由 1：展示网址导航伪装页
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        const htmlPage = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>极简导航</title>
            <style>
                body { text-align:center; font-family: Arial, sans-serif; background: #f4f7f6; }
                .row { display:grid; grid-template-columns:repeat(5,1fr); gap: 15px; max-width: 800px; margin: 50px auto; }
                .item { padding:15px; background: white; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); transition: 0.3s; }
                .item:hover { transform: translateY(-3px); box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
                a { text-decoration:none; color: #333; display: block; }
            </style>
        </head>
        <body>
        <h2 style="color: #2c3e50; margin-top: 40px;">网址导航</h2>
        <div class="row">
            <div class="item"><a href="https://www.google.com">Google</a></div>
            <div class="item"><a href="https://www.bing.com">Bing</a></div>
            <div class="item"><a href="https://www.yahoo.com">Yahoo</a></div>
            <div class="item"><a href="https://www.github.com">GitHub</a></div>
            <div class="item"><a href="https://www.docker.com">Docker</a></div>

            <div class="item"><a href="https://www.chatgpt.com">ChatGPT</a></div>
            <div class="item"><a href="https://www.amazon.com/">Amazon</a></div>
            <div class="item"><a href="https://www.youtube.com">YouTube</a></div>
            <div class="item"><a href="https://www.whatsapp.com">WhatsApp</a></div>
            <div class="item"><a href="https://www.facebook.com">FaceBook</a></div>

            <div class="item"><a href="https://www.msn.com">Msn</a></div>
            <div class="item"><a href="https://www.iplocation.net">IpLocation</a></div>
            <div class="item"><a href="https://www.quora.com/">Quora</a></div>
            <div class="item"><a href="https://www.jetwriter.ai">JetWriter</a></div>
            <div class="item"><a href="https://www.unsplash.com">Unsplash</a></div>
        </div>
        </body>
        </html>`;
        res.end(htmlPage);
    }
    // 其他不认识的路径一律返回 404
    else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// 3. VLESS协议解析
const webSocketServer = new WebSocketServer({ noServer: true });
// 拦截升级请求，只处理正确的路径
httpServer.on('upgrade', (request, socket, head) => {
    if (request.url === `/${webSocketPath}`) {
        webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
            webSocketServer.emit('connection', webSocket, request);
        });
    } else {
        socket.destroy(); // 路径不对直接拉黑断开
    }
});

// 4. VLESS 协议解析底层代码
webSocketServer.on('connection', (webSocket) => {

    webSocket.binaryType = 'arraybuffer';  // 加这一行
    let isFirstConnect = true;

    webSocket.on('message', (messageData) => {
        // 因为设置了 arraybuffer，这里收到的是 ArrayBuffer，需要用 Uint8Array 包装才能读取字节
        const myBuffer = new Uint8Array(messageData);

        if (isFirstConnect) {
            isFirstConnect = false;
            //1.版本
            if (myBuffer.length < 24 || myBuffer[0] !== 0) {
                webSocket.close();
                return;
            }
            //2.uuid
            const originUuid = uuid.replace(/-/g, ""); // 你的标准UUID字符串
            const receivedUuid = Array.from(myBuffer.slice(1, 17))
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join(''); // 解析出来的UUID字符串
            if (receivedUuid !== originUuid) {
                webSocket.close();
                return;
            }
            //3.附加信息
            const extrasLength = myBuffer[17];
            let offset = 18 + extrasLength;
            //4.cmd
            const cmd = myBuffer[offset++];
            if (cmd !== 1) {
                webSocket.close();
                return;
            }
            //5.端口 (手动通过位运算读取 16 位大端整数)
            const targetPort = (myBuffer[offset] << 8) | myBuffer[offset + 1];
            offset += 2;
            //6.地址类型
            const addressType = myBuffer[offset++];
            //7.地址
            let targetAddress = '';
            // 截取目标地址
            if (addressType === 1) { // IPv4
                targetAddress = myBuffer[offset] + '.' + myBuffer[offset + 1] + '.' + myBuffer[offset + 2] + '.' + myBuffer[offset + 3];
                offset += 4;
            } else if (addressType === 2) { // 域名
                const domainLength = myBuffer[offset++];
                // Uint8Array 使用 slice 而不是 subarray
                targetAddress = new TextDecoder().decode(myBuffer.slice(offset, offset + domainLength));
                offset += domainLength;
            } else if (addressType === 3) { // IPv6
                const parts = [];
                for (let i = 0; i < 8; i++) {
                    parts.push(((myBuffer[offset] << 8) | myBuffer[offset + 1]).toString(16));
                    offset += 2;
                }
                targetAddress = '[' + parts.join(':') + ']';
            } else {
                webSocket.close();
                return;
            }

            // 建立与真实目标网站的底层连接
            const remoteSocket = net.connect(targetPort, targetAddress, () => {
                // 告诉客户端(Clash/V2ray)管道通了
                webSocket.send(new Uint8Array([myBuffer[0], 0]).buffer);

                // 把第一次接收到的剩下的真实内容发给目标网站
                const payload = myBuffer.slice(offset);
                if (payload.length > 0) {
                    remoteSocket.write(payload);
                }

                // 无脑双向数据透传 (代理的灵魂)
                // 注意：因为 binaryType 是 arraybuffer，chunk 是 ArrayBuffer，写入 TCP 需要转成 Uint8Array
                webSocket.on('message', (chunk) => remoteSocket.write(new Uint8Array(chunk)));
                remoteSocket.on('data', (chunk) => webSocket.send(chunk));
            });

            // 错误处理... (沿用你的逻辑)
            remoteSocket.on('error', () => webSocket.close());
            remoteSocket.on('end', () => webSocket.close());
            webSocket.on('close', () => remoteSocket.destroy());
            webSocket.on('error', () => remoteSocket.destroy());
        } else {
            // 如果不是第一次连接，无脑透传的备用逻辑（如果在上面的闭包外接收到数据）
            // net.Socket 写入时需要 Uint8Array
            // 注：通常逻辑在上面的闭包内完成了，这里为了严谨加一个处理
        }
    });
});

// 4. 启动服务
httpServer.listen(Number(port), '0.0.0.0', () => {});
