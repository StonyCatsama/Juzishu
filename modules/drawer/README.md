# drawer · 抽屉

**唯一写口。** 条目存在这里，注入从这里取。

## 对外

```
list()                 → 全部条目
upsert(id, patch)      → 改一条
remove(id)             → 删一条
create(entry)          → 新建
readLinks(sdk, path)   → 从属映射
```

## 规矩

- 匹配支持 `substring` / `word` / `regex`，逻辑支持 `any` / `all` / `not_any`。
- 容量超了按 `priority` 淘汰，低的先让位。
- 从角色卡导入时，`character_book` 走同一套条目结构，不另开格式。
