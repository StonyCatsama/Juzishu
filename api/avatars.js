// 橘子树 · 头像路由 | 原创实现
//
// 两个来源：agent 目录下的 avatars/agent.png，或角色包里的 avatar.png。
// 都以 data URL 回给前端，省掉前端跨目录取图。
//
// 注意：App 沙箱读不了 agents/<id>/（node:fs 静默失败）。所以先试 fs，
// 读不到再走 sdk.resources.read 兜底——和 sessions 那边踩过的是同一个坑。

import fs from "node:fs";
import path from "node:path";

export function registerAvatarRoutes(app, { home, characterStore, sdk }) {
  app.get("/avatar/:agent", async (c) => {
    const a = String(c.req.param("agent") || "").replace(/[^a-z0-9-]/gi, "");
    if (!a) return c.json({ ok: false, err: "未知 agent" }, 400);

    const appChars = path.dirname(String(characterStore.tplRoot || ""));
    const candidates = [
      path.join(home, "agents", a, "avatars", "agent.png"),
      path.join(characterStore.userRoot || "", a, "avatar.png"),
      // 内置包（_kim 这类）的头像：既是模板，也能当预览
      appChars ? path.join(appChars, a, "avatar.png") : "",
    ].filter(Boolean);

    for (const p of candidates) {
      // 1) 直接读（自己目录里通常没问题）
      try {
        if (fs.existsSync(p)) {
          const buf = fs.readFileSync(p);
          if (buf.length) return c.json({ ok: true, dataUrl: "data:image/png;base64," + buf.toString("base64") });
        }
      } catch { /* 沙箱挡住很正常，往下走 */ }

      // 2) 兜底：走宿主 resources.read（能读到 agents/<id>）
      try {
        const r = await sdk?.resources?.read({ kind: "local-file", path: p });
        const content = r?.content;
        const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ""), "base64");
        if (buf && buf.length) return c.json({ ok: true, dataUrl: "data:image/png;base64," + buf.toString("base64") });
      } catch { /* 换下一个来源 */ }
    }
    return c.json({ ok: false, err: "没有头像" }, 404);
  });
}
