# characters · 角色包

一张卡进来，她就能跑。

## 对外

```
list()                        → 所有角色包
load(id)                      → profile + persona + worldbook
create(name)                  → 从 _template 复制一份
importST(cardJson)            → 转成内部格式
exportST(id)                  → 转回 ST V2
```

## 规矩

- 必填只有 `name`。缺描述、缺开场白只提示，不拦。
- `character_book` 转世界书条目；`description` + `personality` + `scenario` 拼人格锚。
- 私有角色目录放一个 `.private` 标记文件，导出时整目录跳过。
- schema 记号：`juzishu.character/1`。
