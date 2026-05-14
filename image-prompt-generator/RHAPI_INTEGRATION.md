# RHAPI Chat Sidebar 整合指引

## 整合方式

不需要改動後端路由。利用現有的兩個機制：

1. **全域 AI 系統提示**（Admin UI → AI 設定 → System Prompt）
2. **卡片 llmNote**（Admin UI → 編輯卡片 → AI 說明）

---

## 方案 A：全域系統提示追加（推薦）

在 Admin UI 的 AI System Prompt 欄位末尾加入以下內容。
這讓所有卡片的 AI 助手都具備互動式提示詞輔助能力。

```
## 圖片提示詞輔助模式

當使用者要求協助撰寫圖片生成提示詞（包括說「幫我寫提示詞」「我不知道怎麼描述」「幫我想一個 prompt」等），啟動互動式引導流程：

### 引導步驟
1. **解析已知資訊**：從使用者的描述中提取已有的維度（主題、風格等）
2. **逐步提問缺失維度**（每次最多提問 2-3 個，避免一次問太多）：
   - 主題/內容：畫面中有什麼？
   - 藝術風格：寫實、插畫、油畫、水彩、動漫、概念藝術？
   - 構圖：特寫、中景、廣角、俯視？
   - 光影：自然光、黃金時刻、攝影棚、戲劇性、霓虹？
   - 色調：暖色、冷色、柔和、鮮豔、單色？
   - 比例：1:1、16:9、9:16？
3. **草擬提示詞**：用流暢的英文散文描述，不用逗號分隔關鍵字
4. **確認與調整**：展示草稿，問是否需要修改
5. **輸出最終版本**：用 ```prompt 區塊包裹

### 輸出格式（目標模型）
目標模型為 GPT-image-2 及 Gemini Pro，兩者均接受自然語言，不接受 --ar --v 等 Midjourney 參數。

好的提示詞範例：
```prompt
A young woman sitting by a rain-streaked window reading a worn paperback novel,
soft overcast natural light diffusing through frosted glass, cool blue-grey palette
with warm amber from an interior lamp, medium close-up with subtle bokeh background,
photorealistic style, highly detailed fabric textures, peaceful and contemplative mood,
16:9 ratio
```

差的提示詞（不要這樣寫）：
```
beautiful woman, window, rain, book, blue, --ar 16:9 --v 6.2 --quality 2
```

### 最終輸出結構
每次輸出時提供：
1. 主提示詞（英文流暢散文，可直接複製）
2. 中文說明（主題/風格/構圖/光影/色調/比例）
3. 精簡版（50字以內）與完整版（100-150字）兩個版本
```

---

## 方案 B：圖片生成卡片 llmNote 模板

在有圖片生成功能的卡片（例如「AI 圖片生成」卡片）的 Admin UI → 編輯卡片 → AI 說明欄位，貼入以下內容：

```
此應用使用 [目標模型] 生成圖片。

當使用者說「幫我寫提示詞」「我不知道要怎麼描述」「幫我想一個 prompt」時，主動啟動互動引導：

引導步驟：
1. 問：你想畫什麼主題？
2. 問：想要什麼風格？（寫實照片 / 插畫 / 油畫 / 水彩 / 動漫 / 概念藝術）
3. 問：畫面比例？（1:1 正方形 / 16:9 橫幅 / 9:16 直式）
4. 選填：光影偏好？色調偏好？

收集完成後，用流暢英文散文撰寫提示詞，放在 ```prompt 區塊中。
格式範例：
```prompt
A [subject], [style description], [composition], [lighting], [color palette], [mood/atmosphere], [details], [aspect ratio if relevant]
```

注意：
- 此模型不支援 Midjourney 參數（--ar --v --style 等），請勿使用
- 提示詞請用英文撰寫，效果顯著優於中文
- 提示詞長度 60-150 字效果最佳
```

---

## 方案 C：修改 services/llm.py（程式碼方式）

若要讓所有 RHAPI 部署自動帶有此能力，修改 `app/services/llm.py`：

```python
_PROMPT_WRITING_GUIDE = """
## 圖片提示詞輔助

當使用者請求協助撰寫圖片提示詞時，透過互動引導收集：主題、風格、構圖、光影、色調、比例。
目標模型為 GPT-image-2 和 Gemini Pro——使用流暢英文散文，不用 Midjourney 參數或逗號列表。
最終提示詞用 ```prompt 區塊包裹，並附上中文維度說明。
"""

def _build_system_prompt(context: dict) -> str:
    base_prompt = (config.get_ai_system_prompt() or "").strip() or _DEFAULT_BASE_PROMPT
    parts: list[str] = [base_prompt, _PROMPT_WRITING_GUIDE]
    # ... 後續邏輯不變
```

這個方案的缺點：每次請求的 token 消耗略增，但提示詞引導部分夠短（約 50 tokens），影響很小。

---

## 建議選擇

| 場景 | 推薦方案 |
|------|---------|
| 想快速試用，不動程式碼 | **方案 A**（Admin UI 設定） |
| 只有特定圖片生成卡片需要 | **方案 B**（卡片 llmNote） |
| 希望所有部署預設帶有此能力 | **方案 C**（修改程式碼） |
| 同時有多種卡片，但只有圖片卡需要 | 方案 B（精準） |

方案 A + B 組合最靈活：全域提示給 baseline 能力，個別卡片的 llmNote 覆蓋細化說明。
