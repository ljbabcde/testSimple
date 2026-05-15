import http from 'http';
import net from 'net';
import { WebSocketServer } from 'ws';

// 1. 环境变量与配置
const uuid = process.env.UID || "cac4d96c-abf4-4ccd-8143-87a65d216e32";
const webSocketPath = "myprogram";
const port = process.env.PORT || 3000;

// 2. 网页与 HTTP 路由
const httpServer = http.createServer((req, res) => {
    // 关键修复：切割 URL，忽略 ? 后面的参数，确保加上参数也能访问伪装页
    const pathname = req.url.split('?')[0];

    // 路由 1：展示网址导航伪装页
    if (pathname === '/') {
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
    // 关键修复：同样给 WebSocket 路径做切割，防止参数干扰连通性
    const pathname = request.url.split('?')[0];
    
    if (pathname === `/${webSocketPath}`) {
        webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
            webSocketServer.emit('connection', webSocket, request);
        });
    } else {
        socket.destroy(); // 路径不对直接拉黑断开
    }
});

webSocketServer.on('connection', (webSocket) => {
    webSocket.binaryType = 'arraybuffer';
    let isFirstConnect = true;

    webSocket.on('message', (messageData) => {
        const myBuffer = new Uint8Array(messageData);

        if (isFirstConnect) {
            isFirstConnect = false;
            //1.版本
            if (myBuffer.length < 24 || myBuffer[0] !== 0) {
                webSocket.close();
                return;
            }
            //2.uuid
            const originUuid = uuid.replace(/-/g, ""); 
            const receivedUuid = Array.from(myBuffer.slice(1, 17))
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join(''); 
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
            //5.端口
            const targetPort = (myBuffer[offset] << 8) | myBuffer[offset + 1];
            offset += 2;
            //6.地址类型
            const addressType = myBuffer[offset++];
            //7.地址
            let targetAddress = '';
            if (addressType === 1) { // IPv4
                targetAddress = myBuffer[offset] + '.' + myBuffer[offset + 1] + '.' + myBuffer[offset + 2] + '.' + myBuffer[offset + 3];
                offset += 4;
            } else if (addressType === 2) { // 域名
                const domainLength = myBuffer[offset++];
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
                // 告诉客户端(Clash/v2ray)管道通了
                webSocket.send(new Uint8Array([myBuffer[0], 0]).buffer);

                // 把第一次接收到的剩下的真实内容发给目标网站
                const payload = myBuffer.slice(offset);
                if (payload.length > 0) {
                    remoteSocket.write(payload);
                }

                // 无脑双向数据透传 (代理的灵魂)
                webSocket.on('message', (chunk) => {
                    remoteSocket.write(new Uint8Array(chunk));
                });
                remoteSocket.on('data', (chunk) => {
                    webSocket.send(chunk);
                });
            });

            remoteSocket.on('error', () => webSocket.close());
            remoteSocket.on('end', () => webSocket.close());
            webSocket.on('close', () => remoteSocket.destroy());
            webSocket.on('error', () => remoteSocket.destroy());
        }
    });
});

// 4. 启动服务
httpServer.listen(Number(port), '0.0.0.0', () => {
    console.log(`服务已启动，监听端口: ${port}`);
});
