# Cloudflare Pages + Worker + GitHub Actions 部署

本项目 V2 仍然不需要自己的服务器：`web/` 继续由 Cloudflare Pages 托管静态 Vue 站点，新增 `api-worker/` 作为 `/api/*` 后端，Python 采集器由 GitHub Actions 定时运行并把候选内容提交给 Worker。

## 架构

- 前端：Cloudflare Pages 自动构建 `web/`，首屏仍是题库应用，不迁到 Workers Static Assets。
- 后端：Cloudflare Worker 暴露公开 API 和 admin API，D1 作为内容库。
- 采集：GitHub Actions 跑 `crawler/`，遵守 robots.txt、限速和来源配置，提交内容默认进入 `candidate`。
- 审核：公开接口只返回 `published`，候选内容需要通过 admin publish 接口发布。

Cloudflare 官方文档中，Workers 一等语言包含 JavaScript、TypeScript、Python Workers 和 Rust；Wrangler 通过 `[[d1_databases]]` 绑定 D1；Pages 的 Vite 部署使用 `npm run build` 和 `dist` 输出目录；Worker 的 GitHub Actions 部署可使用 `cloudflare/wrangler-action@v3`。

参考链接：

- [Workers Languages](https://developers.cloudflare.com/workers/languages/)
- [Wrangler Configuration: D1 databases](https://developers.cloudflare.com/workers/wrangler/configuration/#d1-databases)
- [Cloudflare Pages: deploy a Vite project](https://developers.cloudflare.com/pages/framework-guides/deploy-a-vite3-project/)
- [cloudflare/wrangler-action](https://github.com/cloudflare/wrangler-action)

## Pages 前端

Cloudflare Dashboard 设置：

| 配置项 | 值 |
| --- | --- |
| Production branch | `main` |
| Root directory | `web` |
| Framework preset | `Vite` 或 `Vue` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variables | `NODE_VERSION=22`，有 Worker 后再加 `VITE_API_BASE_URL=https://你的-worker.workers.dev` |

前端加载顺序：

1. 请求 `VITE_API_BASE_URL/api/health` 和 `/api/content`。
2. API 可用时展示 D1 中 `published` 内容。
3. API 不可用时自动回退 `web/public/data/generated/*.json`。

## Worker + D1

进入 Worker 目录：

```powershell
cd D:\project\more\QuestionBank\api-worker
npm install
```

创建 D1 数据库：

```powershell
npx wrangler d1 create question-bank-db
```

把输出的 `database_id` 填到 `api-worker/wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "question-bank-db"
database_id = "这里替换成真实 ID"
```

设置管理员 token，不要写进仓库：

```powershell
npx wrangler secret put ADMIN_TOKEN
```

本地迁移和开发：

```powershell
npm run db:migrate:local
npm run dev
```

远程首次迁移和部署需要你确认后再执行：

```powershell
npm run db:migrate:remote
npm run deploy
```

## 初始化 D1 内容

先在 `web/` 生成静态数据：

```powershell
cd D:\project\more\QuestionBank\web
npm run ingest
```

再调用 Worker admin 导入接口：

```powershell
cd D:\project\more\QuestionBank\api-worker
$env:ADMIN_API_BASE_URL="https://你的-worker.workers.dev"
$env:ADMIN_TOKEN="你的管理员 token"
npm run import:local
```

`POST /api/admin/import-local` 会把当前本地题库作为 `published` 写入 D1；重复 hash 或 canonical URL 会标记为 `duplicate`。

## Python 采集器

复制来源配置样例：

```powershell
Copy-Item crawler\sources.example.json crawler\sources.json
```

编辑 `crawler/sources.json`，只放你确认允许采集的公开站点。不要配置 Google/Baidu 搜索结果页、登录后页面或明确禁止抓取的路径。

本地 dry-run：

```powershell
cd D:\project\more\QuestionBank
python -m pip install -e .\crawler
python -m question_bank_crawler.cli --config crawler\sources.json --dry-run --limit 3
```

提交候选内容：

```powershell
$env:ADMIN_API_BASE_URL="https://你的-worker.workers.dev"
$env:ADMIN_TOKEN="你的管理员 token"
python -m question_bank_crawler.cli --config crawler\sources.json --submit
```

## GitHub Actions

已新增 `.github/workflows/crawl.yml`：

- 每周一 UTC 02:17 运行一次。
- 支持 `workflow_dispatch` 手动触发。
- 优先使用仓库里的 `crawler/sources.json`。
- 如果没有 `crawler/sources.json`，会尝试读取 GitHub secret `CRAWLER_SOURCES_JSON` 并写成临时配置文件。
- 如果两者都没有，会安全跳过。

需要在 GitHub 仓库 Settings -> Secrets and variables -> Actions 添加：

| Secret | 用途 |
| --- | --- |
| `ADMIN_API_BASE_URL` | Worker API 根地址 |
| `ADMIN_TOKEN` | Worker admin bearer token |
| `CRAWLER_SOURCES_JSON` | 可选，采集来源 JSON；不想把来源配置提交到仓库时使用 |

`CRAWLER_SOURCES_JSON` 示例：

```json
{
  "userAgent": "QuestionBankCrawler/0.1 (+https://github.com/zle0328/QuestionBank)",
  "defaultDelaySeconds": 2,
  "defaultMaxPages": 20,
  "sources": []
}
```

先用空 `sources` 跑通 workflow，再逐个加入确认允许采集的公开站点。

如果以后要把 Worker 部署也放进 GitHub Actions，再单独加 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`，并使用 Wrangler action。第一版先保持手动部署 Worker，降低误发风险。

## API 摘要

公开接口：

- `GET /api/health`
- `GET /api/content?type=question|knowledge&q=&category=&page=&pageSize=`
- `GET /api/content/:id`
- `GET /api/categories?type=question|knowledge`

管理员接口：

- `POST /api/admin/import-local`
- `POST /api/admin/crawl-jobs`
- `POST /api/admin/candidates/batch`
- `POST /api/admin/content/:id/publish`
- `POST /api/admin/content/:id/reject`

管理员接口必须带：

```text
Authorization: Bearer <ADMIN_TOKEN>
```

## 什么时候迁到 Workers Static Assets

第一阶段不需要迁。只有当你想把“前端静态资源 + API + 路由”统一成一个 Worker 部署，并且接受 Worker 部署和前端发版强绑定时，再从 Pages 迁到 Workers Static Assets。

当前推荐：Pages 继续管前端自动部署，Worker 专心管 API，GitHub Actions 专心跑采集。
