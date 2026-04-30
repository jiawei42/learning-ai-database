# Learning AI Database

AI 學習資料自動收集系統。每天/每週自動抓取 AI 新聞、GitHub repos，用 Gemini 分析後存入 Supabase。

## 專案結構

```
scripts/
  daily_news.py     # 每日 AI 新聞（GitHub Actions 自動執行）
  weekly_github.py  # 每週 GitHub trending repos
  daily_review.py   # 每日品質審查
  research.py       # 本地互動式研究工具（手動執行）
.claude/commands/
  research.md       # /research slash command
.github/workflows/  # GitHub Actions 設定
```

## 本地開發設定

### 環境變數（建立 `.env`，不要 commit）
```
GEMINI_API_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
GITHUB_TOKEN=...   # 可選，提高 GitHub API rate limit
```

### 安裝依賴
```bash
pip install httpx python-dotenv
```

## 使用 Claude CLI 執行研究

在 Claude Code CLI 中輸入：
```
/research playwright
/research RAG vector database
/research LLM fine-tuning
```

或直接執行腳本：
```bash
python scripts/research.py "playwright 瀏覽器自動化"
python scripts/research.py   # 互動模式
```

## Git Branching 策略

**永遠不直接 push 到 master。**

### 分支命名
| 類型 | 格式 | 範例 |
|------|------|------|
| 功能 | `feat/<description>` | `feat/add-twitter-source` |
| 修復 | `fix/<description>` | `fix/gemini-rate-limit` |
| 腳本更新 | `script/<description>` | `script/research-improvements` |
| Claude 自動 | `claude/<description>` | `claude/responsive-modern-frontend` |

### 工作流程
```bash
# 1. 從 master 建新分支
git checkout master && git pull
git checkout -b feat/my-feature

# 2. 開發、測試

# 3. Commit
git add <files>
git commit -m "描述這次改動的原因"

# 4. Push feature branch
git push -u origin feat/my-feature

# 5. 在 GitHub 開 PR → merge 到 master
```

## Gemini 模型 Fallback 順序

所有腳本使用相同 fallback chain（免費額度）：
1. `gemini-2.5-flash` — 最強
2. `gemini-2.0-flash` — 穩定備用
3. `gemini-2.0-flash-lite` — 輕量，獨立 quota
4. `gemini-1.5-flash-latest` — 保底

速率限制：12 秒/次（免費版約 5 RPM）
