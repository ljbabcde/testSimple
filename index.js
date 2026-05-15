const fileSystem  = require('fs-extra');
const { execSync, spawn } = require('child_process');
const path = require('path');
const axios = require('axios');
const adminZip = require('adm-zip');

// --- 参数 ---
const downloadUrl = "https://mystatic.wasmer.app/web.zip";
const binDir = "./bin";
const binWebPath = path.join(binDir, "web");
const binConfigPath = path.join(binDir, "cf.json");
const zipFile = "web.zip";
const uuid = "c8f4aa8a-bfa0-41b8-9bd9-3f3f7776dec3";
const keyPrivate = "AGfnITCbYg6JrHhralXY6BJl884fehP_Vysx9jtyvlI";
const keyPublic = "7WCbxFcx0EMMC6Baeezp70ZlC1p4mpHQ94aNPSaGXRM";

const port = process.env.PORT || 443;

async function setup() {
    console.log("============================== 正在启动 ==============================");
    try {
        if (!fileSystem.existsSync(binWebPath)) {
            const res = await axios({
                url: downloadUrl,
                method: 'GET',
                responseType: 'arraybuffer'
            });

            await fileSystem .ensureDir(binDir);
            await fileSystem .writeFile(zipFile, res.data);

            new adminZip(zipFile).extractAllTo(binDir, true);

            await fileSystem .remove(zipFile);
        }
        console.log("✅ w完成");
    } catch (e) {
        return console.error("❌ w失败:", e.message);
    }

    try {
        fileSystem .chmodSync(binWebPath, 0o755);
        console.log("✅ p完成");
    } catch (e) {
        return console.error("❌ p失败:", e.message);
    }

    try {
        const config = {
            log: {loglevel: "warning"},
            inbounds: [{
                listen: "0.0.0.0",
                port: port,
                protocol: "vless",
                settings: {
                    clients: [{id: uuid, flow: "xtls-rprx-vision"}],
                    decryption: "none"
                },
                streamSettings: {
                    network: "tcp",
                    security: "reality",
                    realitySettings: {
                        show: false,
                        dest: "www.bing.com:443",        // 修复：填写真实的 域名:端口
                        xver: 0,
                        privateKey: keyPrivate,
                        shortIds: ["0123456789abcdef"],
                        serverNames: ["www.bing.com"]    // 修复：纯域名，不要带 ://
                    }
                }
            }],
            outbounds: [{protocol: "freedom"}]
        };
        await fileSystem .outputJson(binConfigPath, config, {spaces: 2});
        console.log("✅ c完成");
    } catch (e) {
        return console.error("❌ c失败:", e.message);
    }

    try {
        const web = spawn(path.resolve(binWebPath), ["run", "-config", path.resolve(binConfigPath)], {
            stdio: 'ignore',
            shell: true
        });
        console.log("✅ s完成");

        web.on('exit', () => {
            setup();
        });
    } catch (e) {
        return console.error("❌ s失败:", e.message);
    }
}

// 执行初始化
setup();
//
setInterval(() => {}, 1000 * 60 * 60);
