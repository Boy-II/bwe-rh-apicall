---
name: image-prompt-generator
description: "Interactive AI image prompt generator for GPT-image-2 and Gemini Pro image generation."
version: 2.0.0
---

# Image Prompt Generator

透過與使用者的互動對話，生成適合 **GPT-image-2** 和 **Gemini Pro 圖片生成** 的高品質自然語言提示詞。

## 核心設計

GPT-image-2 和 Gemini Pro 對**流暢的英文散文描述**效果最好，而非 Midjourney 的逗號關鍵字或 `--ar --v` 參數。

好的提示詞像一份攝影或美術指導：

> "A close-up portrait of an elderly fisherman at golden hour, warm amber light catching the deep lines on his weathered face, shallow depth of field with a softly blurred harbor behind him, painted in the style of Edward Hopper, cinematic quality"

## 引導維度

| 維度 | 說明 | 範例 |
|------|------|------|
| 主題 | 畫面主要內容 | 人物、風景、建築 |
| 風格 | 藝術表現方式 | 寫實、油畫、動漫、概念藝術 |
| 構圖 | 取景角度 | 特寫、廣角、俯視 |
| 光影 | 光源與氛圍 | 黃金時刻、攝影棚、霓虹 |
| 色調 | 配色情感 | 暖色、冷色、柔和 |
| 比例 | 輸出尺寸 | 1:1、16:9、9:16 |

## 使用流程

1. 描述你想畫的內容（可以很簡短）
2. AI 透過 2-3 個問題補充缺失的維度
3. AI 草擬英文自然語言提示詞
4. 確認或調整細節
5. 輸出：主提示詞 + 中文說明 + 精簡版與完整版

## 整合到 RHAPI

此工具設計為 RHAPI chat sidebar 的輔助功能。整合方式見 [`RHAPI_INTEGRATION.md`](./RHAPI_INTEGRATION.md)，提供三種方案（Admin UI 設定 / 卡片 llmNote / 程式碼修改）。

## 目標模型說明

### GPT-image-2
- 接受自然語言，不接受 `--ar --v --style` 等參數
- 尺寸：寬高須為 16 的倍數，最大邊 3840px，比例不超過 3:1
- 長度建議：60-120 字

### Gemini Pro image generation
- 自然語言，理解力強，細節描述效果佳
- 長一點的提示詞（80-150 字）通常效果更好
- 色彩、材質、光影的具體描述有明顯幫助

## 檔案結構

```
image-prompt-generator/
├── SKILL.md              # 主要技能定義（Claude Code 格式）
├── README.md             # 本檔案
└── RHAPI_INTEGRATION.md  # RHAPI chat sidebar 整合指引
```

## 版本歷史

- v2.0.0 (2026-05-14)：移除 Stable Diffusion 格式，專注 GPT-image-2 + Gemini Pro 自然語言提示詞；新增 RHAPI 整合指引
- v1.0.0 (2026-05-14)：初始版本（通用格式）
