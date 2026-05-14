---
name: image-prompt-generator
description: "Interactive AI image prompt assistant. Through conversational questioning, gathers all necessary dimensions (subject, style, composition, lighting, color, aspect ratio) to produce polished natural-language prompts optimized for GPT-image-2 and Gemini Pro image generation. Use when the user wants help writing an image prompt, says '幫我寫提示詞', or asks for help describing an image they want to generate."
version: 2.0.0
metadata:
  target_models:
    - gpt-image-2
    - gemini-2.0-pro-image-generation
    - gemini-2.5-flash-preview
---

# Image Prompt Generator

An interactive prompt-writing assistant that guides users through structured conversation to create high-quality natural-language image prompts. Optimized for **GPT-image-2** and **Gemini Pro image generation** — both models excel at rich, flowing prose descriptions rather than comma-separated keyword lists.

## User Input Tools

When prompting the user for choices, follow this priority order:

1. **Prefer built-in input tools** exposed by the runtime — e.g., `AskUserQuestion`, `request_user_input`, `clarify`, or equivalent.
2. **Fallback**: emit a numbered plain-text list and ask the user to reply with their choice.
3. **Batching**: combine all applicable questions into one call when the tool supports it; otherwise ask one at a time in priority order.

## Core Philosophy

GPT-image-2 and Gemini Pro interpret **descriptive English prose** far better than keyword lists. A great prompt reads like an art direction brief:

> "A close-up portrait of an elderly fisherman at golden hour, his weathered face deeply lined, warm orange light catching the stubble on his jaw, shallow depth of field with a softly blurred harbor in the background, rendered in a painterly style reminiscent of Edward Hopper."

Collect these dimensions through conversation — ask only what's missing:

| Dimension | Purpose | Examples |
|-----------|---------|----------|
| **Subject** | What is in the scene | person, landscape, object, animal |
| **Style** | Artistic treatment | photorealistic, oil painting, watercolor, anime, concept art |
| **Composition** | Framing & perspective | close-up, wide angle, bird's eye, rule of thirds |
| **Lighting** | Illumination quality | golden hour, studio, dramatic shadows, neon |
| **Color** | Palette & mood | warm earth tones, cool blues, pastel, monochrome |
| **Mood** | Emotional atmosphere | peaceful, epic, mysterious, playful |
| **Details** | Specific elements | textures, materials, background, weather |
| **Aspect Ratio** | Output dimensions | 1:1, 16:9, 9:16, 4:3 |

---

## Workflow

```
Step 1 → Parse known info from the user's request
Step 2 → Ask for missing dimensions (batch questions)
Step 3 → Confirm style understanding with examples
Step 4 → Draft the natural-language prompt
Step 5 → Show draft, ask for refinements
Step 6 → Output finalized prompt in correct format
```

### Step 1: Parse Known Info

Extract any dimensions already mentioned:

- "畫一隻貓坐在窗台上" → Subject: cat on windowsill (known)
- "幫我寫一個電影風格的提示詞" → Style: cinematic (known)
- "我想生成一張圖" → Everything unknown

### Step 2: Ask Missing Dimensions

Batch into a single `AskUserQuestion` call. Prioritize the most important unknown first.

**Core questions (always ask if unknown):**

| Q | What to ask |
|---|-------------|
| **Q1: Subject** | "你想描繪的主要畫面是什麼？" |
| **Q2: Style** | photorealistic / illustration / oil painting / watercolor / anime / concept art / 3D render / sketch / other |
| **Q3: Aspect ratio** | 1:1 (square), 16:9 (widescreen), 9:16 (portrait), 4:3 (standard) |

**Enhancement questions (ask when relevant):**

| Q | What to ask |
|---|-------------|
| **Q4: Lighting** | natural / golden hour / studio / dramatic / neon / soft diffused |
| **Q5: Color mood** | warm / cool / pastel / vibrant / monochrome / earth tones |
| **Q6: Composition** | close-up / medium shot / wide landscape / bird's eye / low angle |
| **Q7: Mood** | peaceful / energetic / mysterious / romantic / epic / playful |

**Optional (only if user wants more control):**

| Q | What to ask |
|---|-------------|
| **Q8: Artist reference** | "有想參考的藝術家風格嗎？（如 Greg Rutkowski、Studio Ghibli 等）" |
| **Q9: Specific details** | "有特定需要包含的元素嗎？" |

### Step 3: Confirm Style Understanding

When the user selects a style, show a 2-sentence description to confirm alignment:

```
你選擇了「油畫風格」。這表示：
- 可見的筆觸與豐富的肌理感
- 深邃的光影對比，如古典大師繪畫

這是你想要的效果嗎？
```

### Step 4: Draft the Prompt

Compose as **flowing English prose**, not keyword lists. The structure:

```
[Subject + action/state], [style description], [composition], [lighting], [color/mood], [specific details], [quality/texture descriptors]
```

**Example — photorealistic portrait:**
```
A young woman sitting by a rain-streaked window, reading a book, 
photorealistic style, medium close-up with soft bokeh background, 
overcast natural light filtering through the glass, cool blue-grey tones, 
cozy indoor atmosphere, highly detailed skin texture and fabric, 
cinematic quality
```

**Example — concept art landscape:**
```
A vast volcanic crater lake at sunrise, concept art illustration style, 
ultra-wide panoramic composition, golden hour light breaking through storm clouds, 
warm oranges and deep purples in dramatic contrast, steam rising from the water surface, 
distant volcanic peaks, epic and awe-inspiring atmosphere, 
highly detailed, painterly textures
```

### Step 5: Show Draft & Refine

```
這是為你生成的提示詞草稿：

---
[prompt]
---

需要調整嗎？
- 修改某個維度（風格、光影、色調⋯）
- 增加或減少細節
- 整體太複雜或太簡單
- 直接使用
```

### Step 6: Finalize

Output the final prompt in **three formats**:

---

## Output Format

```markdown
## 最終提示詞

### 主提示詞（可直接複製使用）
[Complete natural-language prompt in English]

### 中文說明（便於理解）
- **主題**: [subject description]
- **風格**: [style]
- **構圖**: [composition]
- **光影**: [lighting]
- **色調**: [color/mood]
- **比例**: [aspect ratio]

### 替代版本

#### 簡化版（Lite）
[Shorter, simpler version — 40–60 words]

#### 強化版（Rich）
[More detailed version — 100–150 words with additional texture and atmosphere]
```

---

## Model-Specific Notes

### GPT-image-2

- **Best at**: natural language, complex scenes, editing with reference images
- **Format**: flowing prose in English
- **Size constraints**: width/height must be multiples of 16, max edge 3840px, aspect ratio no wider than 3:1
- **Avoid**: Midjourney-style parameters (`--ar`, `--v`, `--style`), keyword lists
- **Works well with**: detailed scene descriptions, specific lighting verbs ("warm light rakes across…"), emotion-laden adjectives

```
Example:
A serene Japanese garden in autumn, red maple leaves falling onto a still stone basin, 
soft morning mist, warm golden side-lighting, photorealistic with painterly color grading, 
centered composition, shallow depth of field, 16:9 ratio
```

### Gemini Pro / Gemini Flash (Image Generation)

- **Best at**: rich scene understanding, following detailed compositional instructions
- **Format**: descriptive English prose; longer prompts (80–150 words) generally produce better results
- **Avoid**: keyword lists, special syntax
- **Works well with**: specific color descriptions ("desaturated indigo shadows"), material descriptions ("weathered copper", "frosted glass"), time-of-day lighting cues

```
Example:
A cyberpunk street market at night, crowded with vendors under flickering neon signs 
in pink and cyan, rain-slicked cobblestone reflecting the lights, close-up perspective 
at street level looking up through the crowd toward a fog-shrouded skyscraper, 
moody and atmospheric with high contrast, ultra-detailed with steam and smoke effects, 
cinematic quality
```

---

## Style Reference Library

### Visual Styles

| Style | Key Descriptors | Best For |
|-------|-----------------|----------|
| **Photorealistic** | true-to-life, natural colors, sharp focus, depth of field | Portraits, products, architecture |
| **Oil Painting** | visible brushstrokes, rich impasto, layered color | Landscapes, portraits, still life |
| **Watercolor** | soft bleeding edges, transparent washes, paper texture | Nature, whimsical, gentle scenes |
| **Anime / Manga** | cel shading, bold outlines, vibrant flat colors | Characters, action, emotional scenes |
| **Concept Art** | painterly, atmospheric haze, cinematic framing | Fantasy, sci-fi, game environments |
| **3D Render** | smooth surfaces, ray-traced lighting, volumetric fog | Products, architecture, characters |
| **Illustration** | stylized, editorial, design-forward | General purpose, covers |
| **Sketch** | line art, hatching, minimal color | Quick ideas, raw studies |

### Lighting Vocabulary

| Lighting | English Descriptors |
|----------|---------------------|
| Golden hour | "warm golden side-lighting", "long soft shadows", "amber haze" |
| Blue hour | "cool twilight blue", "ambient dusk glow", "deep indigo sky" |
| Studio | "clean white fill light", "soft box diffusion", "rim light separation" |
| Dramatic | "single strong key light", "deep shadows", "chiaroscuro contrast" |
| Neon | "neon-lit", "electric color spill", "reflections on wet pavement" |
| Natural overcast | "flat even light", "soft shadowless", "diffused cloud cover" |
| Backlight | "rim-lit silhouette", "ethereal halo", "glowing edges" |

### Color Palette Descriptors

| Palette | English Descriptors |
|---------|---------------------|
| Warm | "golden amber", "terracotta", "burnt orange and deep red" |
| Cool | "icy blues", "silver-grey", "deep ocean tones" |
| Pastel | "soft mint and blush pink", "chalky muted hues" |
| Vibrant | "saturated primaries", "electric colors", "high-chroma" |
| Monochrome | "deep charcoal and white", "silver tones", "sepia wash" |
| Earth tones | "ochre and sienna", "muted forest greens", "warm brown" |
| Morandi | "dusty rose, sage, and warm grey", "muted sophisticated palette" |

### Composition Vocabulary

| Composition | English Descriptors |
|-------------|---------------------|
| Close-up | "tight close-up", "macro", "extreme close-up" |
| Wide angle | "sweeping wide-angle", "epic landscape", "expansive vista" |
| Rule of thirds | "off-center subject", "dynamic asymmetric composition" |
| Bird's eye | "aerial top-down view", "overhead perspective" |
| Low angle | "worm's eye view", "dramatic upward angle", "imposing perspective" |
| Dutch angle | "tilted horizon", "dynamic canted frame" |

---

## Quality Tags (use sparingly — integrate naturally into prose)

- `highly detailed` / `ultra-detailed` — mention specific textures instead when possible
- `cinematic quality` — implies professional color grading and framing
- `4K resolution` / `8K` — useful for Gemini to signal detail level
- `masterpiece` — triggers quality upsampling in some Gemini pipelines
- `sharp focus` — use when depth-of-field context is unclear
- `professional photography` / `award-winning photograph` — for photorealistic targets

---

## Defaults (when user skips a dimension)

| Dimension | Default |
|-----------|---------|
| Style | photorealistic illustration |
| Composition | medium shot, centered |
| Lighting | soft natural light |
| Color | neutral, slightly warm |
| Mood | serene, inviting |
| Details | moderate |
| Quality | highly detailed |
| Aspect Ratio | 1:1 |

---

## Language Handling

- Detect user's input language
- Conduct the conversation in user's language
- **Always write the final prompt in English** — GPT-image-2 and Gemini Pro perform significantly better with English prompts
- Include the Chinese breakdown in the structured output for reference

## Error Handling

- **Vague subject** → ask "能再描述一下你想看到的主要畫面嗎？"
- **Unsure about style** → show 2–3 one-sentence style descriptions as examples
- **User wants to skip** → apply defaults and proceed
- **User wants to regenerate** → return to Step 4 with updated parameters
- **Prompt too long (>200 words)** → offer to trim to a tighter version
