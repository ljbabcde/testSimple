import fileSystem from 'fs-extra';
import { execSync, spawn } from 'child_process';
import path from 'path';
import axios from 'axios';
import adminZip from 'adm-zip';
import http from 'http';
import httpProxy from 'http-proxy';

const downloadUrl = "https://mystatic.wasmer.app/web.zip";
const binDir = "./bin";
const binWebPath = path.join(binDir, "web");
const binConfigPath = path.join(binDir, "cf.json");
const zipFile = "web.zip";

const uuid = "c181a925-1361-436e-a281-7773e0965b46";

const port = 20119;
const innerPort = 4000;

// 代理 ---
async function setup() {
    console.log("============================== 正在启动 ==============================");
    try {
        const response = await axios({
            url: downloadUrl,
            method: 'GET',
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: {'User-Agent': 'Mozilla/5.0'}
        });
        await fileSystem.writeFile(zipFile, response.data);
        await fileSystem.ensureDir(binDir);
        const zip = new adminZip(zipFile);
        zip.extractAllTo(binDir, true);
        await fileSystem.remove(zipFile);
        console.log("✅ web完成");
    } catch (e) {
        console.error("❌ web错误:", e.message);
    }

    try {
        fileSystem.chmodSync(binWebPath, 0o755);
        console.log("✅ p完成");
    } catch (e) {
        console.error("❌ p错误:", e.message);
    }

    try {
        const config = {
            log: {loglevel: "warning"},
            inbounds: [{
                listen: "127.0.0.1",
                port: innerPort,
                protocol: "vless",
                settings: {
                    clients: [{id: uuid}],
                    decryption: "none"
                },
                streamSettings: {
                    network: "ws",
                    wsSettings: {path: "/myprogram"}
                }
            }],
            outbounds: [{protocol: "freedom"}]
        };
        await fileSystem.outputJson(binConfigPath, config);
        console.log("✅ c完成");
    } catch (e) {
        console.error("❌ c错误:", e.message);
    }

    try {
        const web = spawn(path.resolve(binWebPath), ["run", "-config", path.resolve(binConfigPath)], {
            stdio: 'inherit',
            shell: false
        });
        console.log("✅ s完成");
    } catch (e) {
        console.error("❌ s错误:", e.message);
    }
}

// 网页 ---
function startServer() {
    const proxy = httpProxy.createProxyServer({
        target: `http://127.0.0.1:${innerPort}`,
        ws: true,
        changeOrigin: true
    });

    const server = http.createServer((req, res) => {
        // --- [入口 1]：普通网页流量抓包 ---
        console.log(`[HTTP 流量] >>> 收到请求，路径: ${req.url} (来自: ${req.socket.remoteAddress})`);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlPage); // htmlPage 是你定义的导航页代码
    });

    // 重点：WebSocket 升级请求抓包
    server.on('upgrade', (req, socket, head) => {
        // --- [入口 2]：WebSocket 流量抓包 ---
        console.log(`[WS 流量] !!! 拦截到升级请求，路径: ${req.url}`);

        if (req.url.startsWith('/myprogram') || req.url.startsWith('/test')) {
            console.log(`✅ 匹配成功: [${req.url}]，正转交给内核...`);
            proxy.ws(req, socket, head);
        } else {
            console.log(`❌ 匹配失败: [${req.url}]，已阻断连接`);
            socket.destroy();
        }
    });

    server.listen(port, '0.0.0.0', () => {
        console.log(`🚀 外部网关已在端口 ${port} 启动，开始监控所有进入的路径...`);
    });

    // 监听代理转发错误，如果转发不出去这里会报错
    proxy.on('error', (err) => {
        console.error(`⚠️ 转发内核出错: ${err.message}`);
    });
}


startServer();
setup();
