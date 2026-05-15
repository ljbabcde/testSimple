const http = require('http');
const {spawn} = require('child_process');
const WebSocket = require('ws');

const PORT = process.env.PORT || 1000;

// 1. 创建 HTTP 服务
const server = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Shell控制台</title>
            <style>
                body {
                    background: #1e1e1e;
                    font-family: Arial;
                    margin: 0;
                    padding: 25px 0 25px 0;
                }
        
                #main {
                    width: 95%;
                    height: 85vh;
                    background: #000;
                    color: #4af626;
                    margin: 0 auto;
                    padding: 15px 1%;
                    border: 1px solid #444;
                    border-bottom: none;
                    border-radius: 10px 10px 0 0;
                    white-space: pre-wrap;
                    overflow-y: auto;
                    box-sizing: border-box;
        
                }
                /* 自定义滚动条 */
                #main::-webkit-scrollbar { width: 8px; }
                #main::-webkit-scrollbar-track { background: transparent; }
                #main::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }
                #main::-webkit-scrollbar-thumb:hover { background: #777; }
        
                #bottom {
                    width: 95%;
                    height: auto;
                    background: #111;
                    color: #4af626;
                    margin: 0 auto;
                    padding: 15px 1%;
                    border: 1px solid #444;
                    border-radius: 0 0 10px 10px;
                    box-sizing: border-box;
                    overflow: hidden;
                }
        
        
                #text {
                    float: left;
                    width: 93%;
                    height: 30px;
                    background: transparent;
                    color: #4af626;
                    margin-right: 2%;
                    padding: 0;
                    border: 0;
                    outline: none;
                    line-height: 30px;
                }
                #button {
                    float: left;
                    width: 5%;
                    height: 30px;
                    background: #555;
                    color: #4af626;
                    margin: 0;
                    padding: 0;
                    border: 0;
                    border-radius: 5px;
                    cursor: pointer;
                }
                #button:active {
                    background: #333;
                    transform: scale(0.95); /* 按钮稍微缩小一点，产生下压感 */
                }
            </style>
        </head>
        <body>
        
        <div class="container">
            <div id="main"></div>
            <div id="bottom">
                <input id="text" type="text" placeholder="输入命令并按回车..." autofocus autocomplete="off">
                <button id="button">执行</button>
            </div>
        </div>
            <script>
                const webSocket = new WebSocket('wss://' + location.host);

                const consoleContent = document.getElementById('main');
                const cmdContent = document.getElementById('text');
                let historyCmd = [], cmdCount = -1;

                webSocket.onmessage = (e) => {
                    consoleContent.textContent += e.data;
                    consoleContent.scrollTop = consoleContent.scrollHeight;
                };

                function send() {
                    if (!cmdContent.value) return;
                    historyCmd.push(cmdContent.value); 
                    cmdCount = historyCmd.length;
                    webSocket.send(cmdContent.value + '\\n'); 
                    cmdContent.value = '';
                }

                document.getElementById('button').onclick = send;
                cmdContent.onkeydown = (e) => {
                    if (e.key === 'Enter') send();                   
                    if (e.key === 'ArrowUp' && cmdContent > 0) {
                        cmdContent.value = historyCmd[--cmdCount];   
                    } 
                    if (e.key === 'ArrowDown') {
                        cmdContent.value = ++cmdCount < historyCmd.length ? historyCmd[cmdCount] : "";
                    }
                };
            </script>
        </body>
        </html>
    `);
});

// 2. WebSocket 处理
const webSocketServer = new WebSocket.Server({server});
webSocketServer.on('connection', (webSocket) => {
    const shell = spawn('bash', ['-i'], {shell: true, env: process.env});

    shell.stdout.on('data', d => webSocket.send(d.toString()));
    shell.stderr.on('data', d => webSocket.send(d.toString()));

    webSocket.on('message', msg => {
        if (shell.stdin.writable) shell.stdin.write(msg);
    });

    webSocket.on('close', () => shell.kill());
});


server.listen(PORT, '0.0.0.0', () => console.log('在' + PORT + '端口启动'));
