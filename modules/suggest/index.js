// 橘子树 · 抽屉代办 | 原创实现
//
// 她想把一条设定收进抽屉，先提议，不直接写库。
// 提议落在 dataDir/drawer-suggestions.json，等拿铁在面板上点“收下”才真的进抽屉。
// 理由：抽屉是长期设定的源头，一条写歪了会一直影响她，得有人过一眼。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function createSuggestionStore({ dataDir }) {
  const file = path.join(dataDir || ".", "drawer-suggestions.json");

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

  /** 她提一条。同一个人、同名、同正文的重复提议不再收。 */
  function add({ agentId, name, trigger, body, why }) {
    const nm = String(name || "").trim();
    const bd = String(body || "").trim();
    if (!nm || !bd) throw Object.assign(new Error("要有名字和正文"), { status: 400 });
    const box = load();
    const dup = box.items.find((x) => x.status === "pending" && x.agentId === String(agentId) && x.name === nm && x.body === bd);
    if (dup) return { id: dup.id, duplicate: true };

    const item = {
      id: crypto.randomUUID(),
      agentId: String(agentId || ""),
      name: nm,
      trigger: (Array.isArray(trigger) ? trigger : String(trigger || "").split(/[,，、\s]+/)).map((s) => String(s).trim()).filter(Boolean),
      body: bd,
      why: String(why || ""),
      status: "pending", // pending | accepted | rejected
      createdAt: new Date().toISOString(),
      decidedAt: null,
    };
    box.items.push(item);
    // 只留最近 200 条，别把文件撑大
    if (box.items.length > 200) box.items = box.items.slice(-200);
    save(box);
    return { id: item.id, duplicate: false };
  }

  function list(status = "pending") {
    const box = load();
    return status === "all" ? box.items : box.items.filter((x) => x.status === status);
  }

  function mark(id, status) {
    const box = load();
    const it = box.items.find((x) => x.id === String(id || ""));
    if (!it) throw Object.assign(new Error("没有这条提议"), { status: 404 });
    it.status = status;
    it.decidedAt = new Date().toISOString();
    save(box);
    return it;
  }

  return { add, list, mark, file };
}
