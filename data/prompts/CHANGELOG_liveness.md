# 2026-09-06 · 活人感 & 在场状态

## 改了什么

### data/prompts/（主要工作）
- **director.json** — rules 17 → 31，分六组。新增：物理状态 3 条、活人感 9 条、声线 5 条。措辞压缩过，实测 rules 块 ~1,100 token。
- **acting_examples.json** — globalCraft 5 → 12；新增 `contrastPairs`（6 组 ✗/✓）。
- **NPC投喂培训模板.md** — 追加第 10 节，说明新字段和写法。

### ai.js（必要，配合 prompt）
- `resolvePresent()`：读 `scene.present`，缺省时推断
- 角色表只发在场角色；`Personality:` → `Long-term tendency (NOT a script)`
- `allowedExpressions` 按拍裁剪表情列表
- 注入 `## Who is here right now` 和 `## Bad → good` 两块
- 语料 / 示例去重
- 兜底台词不再复读玩家

### data/story/（仅相机问题）
- `chapter01_highway.json`：`ch1_interactive_tension`、`ch1_shadow` 两句旁白改写；五个 interactive 拍加 `present`；对峙相关三拍加 `allowedExpressions`
- `prologue.json`：两个 interactive 拍加 `present`（相机描写未动）

## 实测 prompt 大小（token ≈ chars/4）

| 场景 | 改前 | 改后 |
|---|---|---|
| ch1_interactive_standoff（6 人在场） | 4,492 | 4,454 |
| ch1_interactive_after_shot（3 人） | 4,474 | 4,043 |
| prologue_decision（3 人） | 4,464 | 4,038 |

三人场景 −10%，六人场景持平——同时多带了 14 条规则、6 组对照、在场状态。原来 2,500 token 的"全部 13 张角色表"是最大的浪费。

## 没动的
- 节奏 / 章节结构（Ch2 医院压缩、创伤后立刻推主线）——按要求留到之后
- `ch2_*` / `ch3_*` 的 interactive 拍没手写 `present`，走推断。有战斗或受伤的拍建议补上
- `characters.json` 未改
- 采样参数（temperature 0.85 / json_object）未改

## 回滚
`git diff` 即可；或者对照本文件逐项还原。
