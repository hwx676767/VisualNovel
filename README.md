# Visual-novel — 视觉小说引擎

Vanilla HTML/CSS/JS 视觉小说，含打字机对话、章节脚本、AI 互动叙事。

## 本地运行（开发）

```powershell
npm install
copy .env.example .env    # 填入智谱 API Key
npm start
# 打开 http://localhost:8765
```

**不要**直接双击 `index.html`，否则 `/api/chat` 无法工作。

## Cloudflare Pages 部署（推荐上线）

本项目静态资源 + `functions/` API 代理，可部署到 Cloudflare Pages。API Key 保存在 Cloudflare 环境变量中，**不会**暴露给浏览器。

### 一次性部署

```powershell
npm install
npx wrangler login          # 若未登录
npm run pages:deploy
```

### 配置密钥（Dashboard 或 CLI）

在 Cloudflare Dashboard → Pages → visual-novel → Settings → Environment variables，或使用：

```powershell
npx wrangler pages secret put AI_API_KEY --project-name visual-novel
npx wrangler pages secret put SITE_ACCESS_TOKEN --project-name visual-novel
```

| 变量 | 必填 | 说明 |
|------|------|------|
| `AI_API_KEY` | 是 | 智谱 / DeepSeek 等 API 密钥 |
| `AI_BASE_URL` | 否 | 默认 `https://open.bigmodel.cn/api/paas/v4` |
| `AI_MODEL` | 否 | 默认 `glm-4-flash` |
| `SITE_ACCESS_TOKEN` | 否 | 设置后访客需先访问 `/login.html` 输入令牌 |

### 访问保护

- **简单令牌**：设置 `SITE_ACCESS_TOKEN`，分享令牌给测试者
- **Cloudflare Access**（可选）：Zero Trust → 为 `*.pages.dev` 或自定义域名配置邮箱/Google 登录，适合正式内测

### 本地模拟 Pages

```powershell
copy .dev.vars.example .dev.vars
npm run pages:dev
```

## 结构

```
index.html / main.js / style.css   # 游戏前端
functions/                         # Cloudflare Pages API 代理
server.js                          # 本地开发用 Express（部署时不用）
data/story/                        # 章节 JSON
```

## 当前进度

序章 + 第一章 + 第二章可玩。详见游戏内 PROGRESS 面板或 `data/story/progress.json`。
