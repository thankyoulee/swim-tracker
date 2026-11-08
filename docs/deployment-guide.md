# 部署指引

## 本地运行
在工程根目录启动静态服务器（ES Modules 与 Service Worker 需要 HTTP）：`python -m http.server 8000`，访问 `http://localhost:8000`。

## Cloudflare
1. 创建 D1 数据库并执行 `api/schema.sql`。
2. 将 Worker 入口设为 `api/worker.js`，绑定 D1 数据库变量 `DB`。
3. 经 HTTPS 发布静态文件，并在页面 `<head>` 添加 `<meta name="swimtracker-api-url" content="https://your-worker.example.workers.dev">` 配置 API 地址；也可在控制台调用 `import("./js/modules/cloud-sync.js").then(({ configureSyncEndpoint }) => configureSyncEndpoint("https://your-worker.example.workers.dev"))`。
4. 每次记录先写入 IndexedDB；云端不可用时会留在本地同步队列，网络恢复或应用重新打开时重试。
5. D1 更新使用 `If-Match` 版本检查。遇到 `409` 时队列会保留该记录，不会覆盖服务端版本；需先人工比较两端记录后再处理。
6. API 当前提供 CORS 和字段校验，但未内置身份认证或限流。公网部署前必须配置身份认证、限制允许来源并增加限流。
