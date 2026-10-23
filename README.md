# 橘子树

一个常驻的角色生活系统。角色有自己的状态、自己的日子、自己的信。

不是聊天壳，也不是面板。它会做四件事：

- 每轮对话末尾，把人格、世界书、时间、状态装进上下文
- 到点叫她写信
- 记住她此刻在哪、什么心情、身上挂着什么事
- 把每一条改动的来龙去脉留在事件流里

## 装

发布包是 `dist/`（`node scripts/export-release.mjs` 生成）。**装它，别装工作目录。**

1. 把 `dist/` 整个放进 `~/.hanako/apps/juzishu/`
2. 重启 Hana
3. 设置 → 应用 → 找到「橘子树」，逐条授权
4. 打开卡片

**权限是默认拒绝的**，不授权就是空壳。最少要开：

| 权限 | 干什么 |
|---|---|
| `app/resources.read` `app/resources.write` | 读写信、状态、世界书 |
| `app/tools.expose-to-model` | 让角色能用 `state_write` / `state_read` |
| `app/hooks.provider-before-request` | 每轮注入 |
| `app/session.start-turn` | 到点叫醒她写信 |
| `app/sessions.read` `app/sessions.manage` | 读当天会话、往主会话投递 |

**先停旧插件。** 旧的世界书/状态插件如果还开着，会和本 App 双注入、抢同名工具（`state_write`）。

## 第一次打开

会自动生成一个示例角色「小橘」——便利店夜班店员，人格、世界书、三封信的写法都是完整的。

信默认落在 `~/.hanako/app-data/juzishu/letters/example/`，三档默认 07:00 / 12:00 / 18:00。

## 建角色

封签页 → 底部那张虚线卡「+ 添加角色」。

两条路：

- **新建**：填 id（英文、数字、`-`、`_`）和名字，从模板复制一份
- **导入 ST 卡**：粘贴 SillyTavern 卡 JSON，或选文件。V2、V3、无 spec 的卡都认

建完包会同时：

- 建一个同 id 的 agent
- 往 `config.characters` 写一项（信目录、提示词目录、三档时间都算好）

**要重启 Hana 才会跑时钟和注入**——角色表是启动时读的。

删角色时配置里那一项也会一起清掉，时钟不会再给一个不存在的角色派信。

## 改配置

右上角 **⚙**。

能改每个角色的 id、名字、信从哪读、三档时间、主会话。主会话只填 id（`sess_xxx`），路径由后端去会话列表换。改完保存，重开 Hana 生效。

配置文件在 `~/.hanako/app-data/juzishu/config.json`，不进发布包。

注入预算、心跳闸门、回望白名单、工程会话锚，都在同一份配置的 `defaults` 里。字段示例见 `config.example.json`。

## 三档时间

信默认在 **07:00 / 12:00 / 18:00** 写。窗口固定，到点触发，当天只一次。

晚超过三小时才醒的（比如宿主关了一上午），记一笔 `missed`，不装作刚发生过。

第四档「收尾」按需要自己加（`slots` 里写 `{ "id": "night", "at": "23:50" }`），提示词文件是 `letters/night.md`。

## 自发心跳

默认**关着**。想让她自己开口，把 `defaults.wake.enabled` 改成 `true`。

开了以后按六道闸放行：总开关、当天次数、静默时段、他上次说话多久、她上次开口多久、追了几次没回。心情「重」时允许多追一次。

沉默超过 12 / 24 / 48 小时，机制会替她落一档心情，**最高只到「中」**——「重」是她自己的判断，不归代码。

## 抽屉（世界书）

条目三种策略：

- **注入**：命中就进上下文
- **拦截**：命中时，priority 比它低的条目都不进（它自己也不进）
- **停用**：永不注入

优先级 100 / 75 / 50 / 25 四档，超预算先丢低的。人格锚这类没有触发词的条目恒注入。

## 目录

```
dist/               发布包（只带白名单里的东西）
├─ index.js         装配：钩子、工具、路由
├─ modules/         一个模块一个抽屉
│   ├─ seal/        封签：状态
│   ├─ drawer/      抽屉：世界书
│   ├─ letter/      信：读、写、事件流
│   ├─ inject/      装填：每轮注入
│   ├─ clock/       时钟：三档
│   ├─ urge/        心跳：该不该开口
│   ├─ digest/      当日会话：只捞人话
│   ├─ suggest/     代办：她要进抽屉的提议
│   ├─ characters/  角色包
│   └─ config/      配置
├─ api/             路由，一个面一个文件
├─ ui/              面板
└─ characters/      角色包模板（_template、_example）
```

本机数据全在 `~/.hanako/app-data/juzishu`：

```
config.json           配置
worldbook.db          抽屉条目 + 父子关系
state/<id>.json       状态
clock/<id>.json       三档进度 + 心跳计数
sessions/<id>.json    谁在哪个会话说过话
drawer-suggestions.json 代办
letters/<id>/         信（没显式配 lettersDir 时的默认位置）
```

## 自检

开发目录里可以单独跑：

```
node scripts/selftest-all.mjs
node scripts/check-inject.mjs <agentId>
node scripts/export-release.mjs
```

这些**不进发布包**（会夹带本机测试数据）。

## 隐私

- `characters/` 下只有 `_template` 和 `_example` 会进发布包
- `data/`、`config.json`、`scripts/private-words.txt` 永远不带
- 导出时按 `scripts/private-words.txt` 逐字扫描，命中就中止，不出包
- 根 `assets/` 只带图标；地图底图属于个人内容，不进包（没底图时邮戳页显示“底图未装入”）
