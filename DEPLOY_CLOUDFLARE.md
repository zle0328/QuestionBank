# Cloudflare Pages + GitHub 自动部署

本项目是静态 Vite 站点，不需要自己的服务器。Cloudflare Pages 每次从 GitHub 拉取代码后，在 `web` 目录执行构建，并把 `web/dist` 发布到 CDN。

## GitHub 仓库

建议把整个 `D:\project\more\QuestionBank` 作为一个仓库提交，保留这三个目录：

- `web/`：题库网站源码和构建脚本。
- `code-roadmap-main/`：题目资料源。
- `JavaGuide-main/`：知识库资料源。

首次提交示例：

```powershell
cd D:\project\more\QuestionBank
git init
git add .
git commit -m "Initial question bank site"
git branch -M main
git remote add origin https://github.com/<你的账号>/<你的仓库>.git
git push -u origin main
```

`web/src/data/generated/*.json` 和 `web/public/data/generated/*.json` 不需要提交；Cloudflare 构建时会自动运行 `npm run build`，并重新生成这些 JSON。

## Cloudflare Pages 配置

在 Cloudflare Dashboard 中：

1. 进入 `Workers & Pages`。
2. 选择 `Create application` -> `Pages` -> `Connect to Git`。
3. 选择 GitHub 仓库并授权。
4. 使用下面的构建配置：

| 配置项 | 值 |
| --- | --- |
| Production branch | `main` |
| Root directory | `web` |
| Framework preset | `Vite` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variables | 通常不需要；如构建环境未识别 Node 版本，添加 `NODE_VERSION=22` |

`web/.node-version` 已固定 Node 22，和本地开发环境保持一致。

## 自动部署流程

以后修改代码或资料源后：

```powershell
git add .
git commit -m "Update question bank"
git push
```

Cloudflare Pages 会自动触发一次构建：

1. 安装 `web/package-lock.json` 中的依赖。
2. 执行 `npm run build`。
3. 扫描两个资料源目录，生成题库 JSON。
4. 输出静态站点到 `web/dist`。
5. 发布到 `*.pages.dev`，也可以绑定自定义域名。

## 注意事项

- 当前最大生成文件约 14.6MB，适合 Cloudflare Pages 静态托管。
- 后续如果爬虫导致单个 JSON 明显变大，建议按分类或文章拆分，避免首屏加载变慢。
- 上线前建议在页面或 README 中保留 JavaGuide 和 code-roadmap 的来源与版权说明。
