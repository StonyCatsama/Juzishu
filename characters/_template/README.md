# 角色包 · 怎么填

五步。填完就能跑。

## 1. 改名

把 `_template/` 整个复制成 `characters/<你的角色>/`。

## 2. 填 `profile.json`

- `name` 必填，其余可空。
- `timezone` 按角色所在地写，比如 `Asia/Shanghai`、`Asia/Tokyo`。
- `oday.slots` 的三档窗口可以改，也可以删掉某一档。
- `wake.enabled` 默认关。想让角色自己醒，再打开。

## 3. 写 `persona.md`

她是谁、怎么说话、不做什么。600 字以内。这份每轮都注入，写多了会挤掉别的东西。

## 4. 放世界书

`worldbook.json` 里加条目。`trigger` 是关键词，`priority` 越大越优先保留。

也可以直接把 SillyTavern 角色卡（V2/V3）导进来：`character_book` 会转成这里，`description` + `personality` + `scenario` 会拼成 `persona.md`。

## 5. 写信的模板

`letters/` 下三份，是“她写信时看的说明”，不是信本身。写清楚写什么、不写什么就行。三档默认 07:00 / 12:00 / 18:00，可以在 `profile.json` 的 `letters.slots` 里改。

## 完成

面板里应该能看到这张卡、能改状态、能看到三档窗口。看不到就是没认到——先看 `profile.json` 的 `schema` 有没有被改坏。
