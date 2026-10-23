// 橘子树 · 时钟 | 原创实现
//
// 窗口固定，时刻随机。每档进窗口时掷一次骰子：几点醒、今天做不做。
// 只负责“什么时候该做什么”，不负责“怎么叫她”——那是 onWake 的事。

import path from "node:path";

const HHMM = /^(\d{1,2}):(\d{2})$/;

export function hhmmToMin(s) {
  const m = String(s).match(HHMM);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function minToHHMM(min) {
  const n = Math.max(0, Math.min(24 * 60, Math.round(min)));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

/** 目标时区的“现在”：日期 + 分钟数。tz 是相对北京的偏移。 */
export function nowFor(tz = 0, nowMs = Date.now()) {
  const d = new Date(nowMs + (8 + tz) * 3600 * 1000);
  return {
    date: d.toISOString().slice(0, 10),
    min: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

export function createClock({ sdk, dataDir, characters, skipChance = 0.12, onWake, onSkip, onMiss }) {
  const root = path.join(dataDir || ".", "clock");

  async function readJson(p) {
    try {
      const r = await sdk.resources.read({ kind: "local-file", path: p });
      const text = typeof r === "string" ? r : (r?.content ?? r?.text ?? "");
      return text ? JSON.parse(String(text)) : null;
    } catch {
      return null;
    }
  }

  async function writeJson(p, obj) {
    try {
      await sdk.resources.write({ kind: "local-file", path: p }, JSON.stringify(obj, null, 2));
      return true;
    } catch {
      return false;
    }
  }

  const fileOf = (id) => path.join(root, `${id}.json`);

  async function state(id) {
    return (await readJson(fileOf(id))) || { date: null, slots: {} };
  }

  async function save(id, st) {
    return writeJson(fileOf(id), st);
  }

  /**
   * 一拍。每分钟调用一次。
   * 幂等：同一档只做一次；跨天自动重置。
   */
  async function tick(nowMs = Date.now()) {
    const report = [];

    for (const c of characters) {
      if (!Array.isArray(c.slots) || !c.slots.length) continue;

      const { date, min } = nowFor(c.tz || 0, nowMs);
      let st = await state(c.id);
      let dirty = false;
      if (st.date !== date) {
        // 跨天只重置“今天做过什么”，会话路径这类常驻东西得留着
        const keep = {};
        for (const k of ["sessionPath", "urgeSessionPath", "patchSessionPath"]) {
          if (st[k]) keep[k] = st[k];
        }
        // urge 也留着：跨天该清的只是“今天几次”（那个靠 date 对不上自己归零），
        // 不能把“她上次开口”一起扔掉——扔了 gap 闸明天就形同虚设。
        if (st.urge) keep.urge = st.urge;
        st = { ...keep, date, slots: {} };
        dirty = true; // 跨天也要落一次，不然旧日期一直在
      }

      for (const slot of c.slots) {
        const at = slot.at != null ? hhmmToMin(slot.at) : hhmmToMin(slot.window?.[0]);
        if (at === null) continue;

        let rec = st.slots[slot.id];

        // 还没到点
        if (min < at) continue;
        // 今天已经做过
        if (rec?.done) continue;

        const late = min - at;
        const limit = slot.catchUpMin ?? 180;

        // 醒得太晚：不装作刚发生过，记一笔错过
        if (late > limit) {
          st.slots[slot.id] = {
            atText: minToHHMM(at),
            done: true,
            action: "missed",
            lateMin: late,
            doneAt: new Date(nowMs).toISOString(),
          };
          dirty = true;
          report.push({ id: c.id, slot: slot.id, action: "missed", lateMin: late });
          try { onMiss?.(c, slot, st.slots[slot.id]); } catch { /* 回调失败不拦 */ }
          continue;
        }

        st.slots[slot.id] = {
          atText: minToHHMM(at),
          done: true,
          action: "wake",
          lateMin: late,
          doneAt: new Date(nowMs).toISOString(),
        };
        dirty = true;
        report.push({ id: c.id, slot: slot.id, action: "wake", at: minToHHMM(at), lateMin: late });
        try { await onWake?.(c, slot, st.slots[slot.id]); } catch { /* 同上 */ }
      }

      if (dirty) {
        // onWake 里可能已经写过会话路径/心跳计数——以盘上最新的为准，只覆盖日期与档位
        const latest = await state(c.id);
        await writeJson(fileOf(c.id), { ...latest, date: st.date, slots: st.slots });
      }
    }

    return report;
  }

  return { tick, state, save, fileOf, nowFor };
}
