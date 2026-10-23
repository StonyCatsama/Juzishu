// 橘子树 · 跨角色消息 | 原创实现
//
// 一个角色想给另一个递句话。默认不直接投——先落在这里，等人在面板上点「放行」。
// 理由：那条消息会以「某人带话」的身份进对方会话、还会触发对方回一轮，
// 不经人看一眼就发生，等于两个角色可以自己在半夜互相叫醒。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function createTalkStore({ dataDir }) {
  const file = path.join(dataDir || ".", "talk-pending.json");

  function load() {
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(j?.items) ? j : { items: [] };
    } catch {
      return { items: [] };
    }
  }

  function save(box) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(box, null, 2), "utf8");
    fs.renameSync(tmp, file);
  }

  function add({ from, to, text }) {
    const t = String(text || "").trim();
    if (!t) throw Object.assign(new Error("没写内容"), { status: 400 });
    const box = load();
    const item = {
      id: crypto.randomUUID(),
      from: String(from || ""),
      to: String(to || ""),
      text: t,
      status: "pending", // pending | sent | dropped
      createdAt: new Date().toISOString(),
      decidedAt: null,
      result: "",
    };
    box.items.push(item);
    // 只留最近 200 条
    if (box.items.length > 200) box.items = box.items.slice(-200);
    save(box);
    return item;
  }

  function list(status = "pending") {
    const box = load();
    return status === "all" ? box.items : box.items.filter((x) => x.status === status);
  }

  function mark(id, status, result = "") {
    const box = load();
    const it = box.items.find((x) => x.id === String(id || ""));
    if (!it) throw Object.assign(new Error("没有这条"), { status: 404 });
    it.status = status;
    it.result = String(result || "");
    it.decidedAt = new Date().toISOString();
    save(box);
    return it;
  }

  return { add, list, mark, file };
}
