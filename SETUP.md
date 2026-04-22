# AI 學習庫 — 部署指南

## 架構

```
前端 (Vercel) → Supabase (DB + REST API) ← GitHub Actions (排程腳本)
```

## 部署步驟

### 1. Supabase 設定

1. 登入 [supabase.com](https://supabase.com) → 建立新 Project
2. 進 **SQL Editor** → 貼入 `supabase/schema.sql` → Run
3. 記下：
   - Project URL：`https://xxxx.supabase.co`
   - anon key（Settings → API → anon public）
   - service_role key（Settings → API → service_role secret）

### 2. 本機開發

```bash
cd learning-ai-database
cp .env.example .env.local
# 填入 Supabase URL + anon key
npm install
npm run dev
# 開啟 http://localhost:3000
```

### 3. Vercel 部署

```bash
npm i -g vercel
vercel
# 依照提示選擇 project
```

在 Vercel Dashboard → Settings → Environment Variables 加入：
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 4. GitHub Secrets 設定

在 GitHub Repo → Settings → Secrets and variables → Actions → New repository secret：

| Secret 名稱 | 值 |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | service_role key |
| `GEMINI_API_KEY` | Google AI Studio key |
| `ANTHROPIC_API_KEY` | Anthropic API key |

> `GITHUB_TOKEN` 由 GitHub 自動提供，不需手動設定。

### 5. 排程說明

| Workflow | 時間 (CST) | 說明 |
|---|---|---|
| `daily_news.yml` | 每天 08:00 | 抓 10 篇 AI 新聞，Gemini Flash 摘要 |
| `weekly_github.yml` | 每週一 09:00 | GitHub trending 分析，Claude Haiku |
| `daily_review.yml` | 每天 21:00 | 隨機抽查一個分類，Gemini Flash 審查 |

也可在 Actions tab 手動觸發（`workflow_dispatch`）。

## 預估費用

全部免費：
- Supabase Free：500MB DB，50K req/月 ✓
- Vercel Free：100GB bandwidth ✓
- GitHub Actions Free：2000 min/月（每次 < 5 分鐘）✓
- API token 費用由你的 key 承擔（每月 < $1）
