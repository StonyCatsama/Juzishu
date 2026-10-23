// 橘子树 · 位置与地图路由 | 原创实现
//
// 三件事：地图标点（zones）、底图、她现在在哪（实况 → 当天信的位置链）。
// 地图是给她看着玩的，坐标由用户在页面上点出来存进 zones.json。
//
// 2026-10-23：底图可换。用户上传的图存 app-data/juzishu/maps/<槽>.png，
// /mapimg 先看这里，没有再回落到 App 自带的 assets（发布包里没有私人地图）。

import path from "node:path";
import fs from "node:fs";

const MAPS = ["map-big", "floor-1", "floor-2"];
const MAP_LABEL = { "map-big": "区域图", "floor-1": "一楼", "floor-2": "二楼" };

export function registerPlaceRoutes(app, { appDir, dataDir, characters, tzOf, seal, resolvePlace, nowFor, lettersDir }) {
  const zonesFile = path.join(dataDir, "zones.json");
  const mapsDir = path.join(dataDir, "maps");
  const customOf = (name) => path.join(mapsDir, `${name}.png`);

  app.get("/zones", (c) => {
    try {
      return c.json({ ok: true, zones: JSON.parse(fs.readFileSync(zonesFile, "utf8")) });
    } catch {
      return c.json({ ok: true, zones: {} });
    }
  });

  app.post("/zones", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const zones = body && typeof body.zones === "object" && body.zones ? body.zones : {};
      fs.mkdirSync(path.dirname(zonesFile), { recursive: true });
      fs.writeFileSync(zonesFile, JSON.stringify(zones, null, 2), "utf8");
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, 500);
    }
  });

  /** 三个槽位：自带的有没有、自己传的有没有。 */
  app.get("/maps", (c) => {
    const slots = {};
    for (const m of MAPS) {
      slots[m] = {
        label: MAP_LABEL[m],
        custom: fs.existsSync(customOf(m)),
        builtin: fs.existsSync(path.join(appDir, "assets", `${m}.png`)),
      };
    }
    return c.json({ ok: true, slots });
  });

  app.post("/maps/:name", async (c) => {
    let name = "";
    try { name = String(c.req.param("name") || ""); } catch { name = ""; }
    if (!MAPS.includes(name)) return c.json({ ok: false, err: "未知槽位" }, 400);
    const body = await c.req.json().catch(() => ({}));
    const m = String(body?.dataUrl || "").match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
    if (!m) return c.json({ ok: false, err: "只收 png / jpg / webp" }, 400);
    const buf = Buffer.from(m[2], "base64");
    if (!buf.length) return c.json({ ok: false, err: "空图" }, 400);
    if (buf.length > 16 * 1024 * 1024) return c.json({ ok: false, err: "图太大了（超过 16MB）" }, 413);
    try {
      fs.mkdirSync(mapsDir, { recursive: true });
      fs.writeFileSync(customOf(name), buf);
      return c.json({ ok: true, size: buf.length });
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, 500);
    }
  });

  app.post("/maps/:name/clear", async (c) => {
    let name = "";
    try { name = String(c.req.param("name") || ""); } catch { name = ""; }
    if (!MAPS.includes(name)) return c.json({ ok: false, err: "未知槽位" }, 400);
    try {
      if (fs.existsSync(customOf(name))) fs.rmSync(customOf(name), { force: true });
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, 500);
    }
  });

  app.get("/mapimg/:name", (c) => {
    let name = "";
    try { name = String(c.req.param("name") || "").replace(/[^a-z0-9-]/g, ""); } catch { name = ""; }
    if (!MAPS.includes(name)) return c.json({ ok: false, err: "未知底图" }, 400);
    const candidates = [customOf(name), path.join(appDir, "assets", `${name}.png`)];
    for (const p of candidates) {
      try {
        const buf = fs.readFileSync(p);
        if (buf && buf.length) return c.json({ ok: true, dataUrl: "data:image/png;base64," + buf.toString("base64") });
      } catch { /* 换下一个 */ }
    }
    return c.json({ ok: false, err: "没有底图" }, 404);
  });

  /** 她现在在哪：实况（四小时内）优先，否则落当天信里的位置链。 */
  app.get("/location", async (c) => {
    const out = {};
    for (const id of characters) {
      const { date, min } = nowFor(tzOf(id));
      const st = await seal.read(id);
      let here = null;
      let live = false;
      if (st?.place?.name) {
        const ms = Date.parse(String(st.place.since || ""));
        const ageH = Number.isFinite(ms) ? (Date.now() - ms) / 36e5 : null;
        if (ageH === null || ageH <= 4) { here = { place: st.place.name, state: null }; live = true; }
      }

      const dir = lettersDir[id];
      if (dir) {
        try {
          const seg = await resolvePlace(dir, date, min);
          if (!here && seg) here = seg;
        } catch { /* 当天还没信：位置就只剩实况 */ }
      }

      out[id] = {
        date,
        nowMin: min,
        nowText: `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`,
        live,
        here,
      };
    }
    return c.json({ ok: true, characters: out });
  });
}
