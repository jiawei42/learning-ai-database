執行 AI 資料庫研究：輸入主題，Gemini 自動找 GitHub repos + 相關文件，分析後存入 Supabase。

**使用方式：** `/research <主題>`

範例：
- `/research playwright`
- `/research RAG vector database`
- `/research LLM fine-tuning`

---

執行步驟：

1. 確認當前目錄有 `scripts/research.py`（若不在專案根目錄，請先 `cd` 過去）
2. 執行下列指令，將 `$ARGUMENTS` 作為研究主題：
   ```
   python scripts/research.py "$ARGUMENTS"
   ```
3. 等候完成（通常 30–90 秒，視 Gemini API 速率限制）
4. 回報：找到幾個 repos、幾篇文件、成功存入 Supabase 幾筆

若 `$ARGUMENTS` 為空，以互動模式啟動（腳本會自行提示輸入）。

**環境需求（本地）：**
- `.env` 檔含 `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `pip install httpx python-dotenv`
