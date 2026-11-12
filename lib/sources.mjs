// Data sources. Each one returns plain data or throws; server.mjs wraps every call so a broken source shows
// "unavailable" in its panel and never takes the page down. Everything here is READ-ONLY except startApp.
import fs from "node:fs";
import { execFile } from "node:child_process";
import { CONFIG } from "./config.mjs";

const TZ = CONFIG.timezone;
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

export function localToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
}
const localDay = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
const localTime = (iso) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

// today.json: { "plan": [{ "label": "Training", "text": "Swim 30 min" }], "events": [{ "title", "location", "start": ISO, "allDay": bool }] }
export function today() {
  if (!CONFIG.todayFile) return { plan: [], events: [] };
  const t = readJson(CONFIG.todayFile);
  // An event may give "start" (ISO) or a relative "inDays" + "time" ("HH:MM", local) — handy for demo data.
  const resolve = (e) => {
    if (e.start || e.inDays == null) return e;
    const day = localToday(new Date(Date.now() + Number(e.inDays) * 864e5));
    const [hh, mm] = String(e.time || "09:00").split(":").map(Number);
    const guess = new Date(day + "T" + String(hh).padStart(2, "0") + ":" + String(mm || 0).padStart(2, "0") + ":00Z");
    const shown = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(guess));
    return { ...e, start: new Date(guess.getTime() - (shown - hh) * 3600e3).toISOString(), allDay: e.allDay || !e.time };
  };
  const from = localToday();
  const until = localToday(new Date(Date.now() + 7 * 864e5));
  const events = (t.events || []).map(resolve)
    .filter((e) => e.start && localDay(e.start) >= from && localDay(e.start) <= until)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, 20)
    .map((e) => ({ title: String(e.title || ""), location: e.location || "", day: localDay(e.start), time: e.allDay ? null : localTime(e.start) }));
  return { plan: (t.plan || []).map((p) => ({ label: String(p.label || ""), text: String(p.text || "") })), events };
}

// A markdown task list with a table like: | ID | Area | Task | Priority | Status | … under "## Active"
// (the whole file is used when there is no "## Active" heading).
export function tasks() {
  if (!CONFIG.tasksFile) return [];
  const text = fs.readFileSync(CONFIG.tasksFile, "utf8");
  const start = text.indexOf("## Active");
  const end = start >= 0 ? text.indexOf("\n## ", start + 5) : -1;
  const section = start >= 0 ? text.slice(start, end < 0 ? undefined : end) : text;
  const out = [];
  for (const line of section.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 5 || !/^[A-Z]+\d+$/.test(cells[0])) continue;
    const [id, area, task, priority, status] = cells;
    if (task.startsWith("✅") || /^done/i.test(status)) continue;
    const bold = task.match(/\*\*(.+?)\*\*/);
    let title = (bold ? bold[1] : task).replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    if (title.length > 110) title = title.slice(0, 107).trimEnd() + "…";
    out.push({ id, area, title, priority, status });
  }
  return out;
}

// A feed file is a JSON array of { "title", "sub"?, "url"?, "score"?, "firstSeen"?: ISO, "date"?: ISO }.
export function feed(id) {
  const f = CONFIG.feeds.find((x) => x.id === id);
  if (!f) throw new Error("unknown feed");
  const items = readJson(f.file);
  if (!Array.isArray(items)) throw new Error("feed file is not a JSON array");
  return items.slice(0, 50).map((i) => ({
    title: String(i.title || ""),
    sub: i.sub ? String(i.sub) : "",
    url: /^https?:\/\//i.test(i.url || "") ? i.url : null,
    score: Number.isFinite(i.score) ? i.score : null,
    firstSeen: i.firstSeen || null,
    when: i.date ? `${localDay(i.date)}${i.allDay ? "" : " " + localTime(i.date)}` : null,
  }));
}

const docker = (args, opts = {}) =>
  new Promise((resolve, reject) =>
    execFile("docker", args, { timeout: 5000, windowsHide: true, ...opts }, (err, stdout) => (err ? reject(new Error("Docker not running")) : resolve(stdout))),
  );

export async function containers() {
  const out = await docker(["ps", "-a", "--format", "{{json .}}"]);
  return out.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)).map((c) => ({
    name: c.Names,
    up: c.State === "running",
    health: /\(healthy\)/.test(c.Status) ? "healthy" : /\(unhealthy\)/.test(c.Status) ? "unhealthy" : null,
    status: c.Status,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

async function ping(url, ms = 3000) {
  if (!url) return { up: false };
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), redirect: "manual" });
    return { up: true, code: r.status };
  } catch {
    return { up: false };
  }
}

const starting = new Set();
export async function services() {
  const apps = await Promise.all(CONFIG.apps.map(async (a) => ({ name: a.name, url: a.url, canStart: !!a.composeDir, starting: starting.has(a.name), ...(await ping(a.url)) })));
  const extra = await Promise.all(CONFIG.services.map(async (s) => ({ name: String(s.name), ...(await ping(s.url)) })));
  return { apps, services: extra };
}

// The one write action: `docker compose up -d` in the configured folder of ONE app from the config.
// The name is looked up in the config, so nothing typed in the browser reaches the command line.
export function startApp(name) {
  const a = CONFIG.apps.find((x) => x.name === name);
  if (!a) throw new Error("unknown app");
  if (!a.composeDir) throw new Error("this app has no composeDir in the config");
  if (starting.has(name)) return { started: false, already: true };
  starting.add(name);
  execFile("docker", ["compose", "up", "-d"], { cwd: a.composeDir, timeout: 300000, windowsHide: true }, (err, _o, stderr) => {
    starting.delete(name);
    console.log(`[hud] start ${name}: ${err ? "FAILED " + String(stderr || err.message).trim().split("\n").pop() : "ok"}`);
  });
  return { started: true };
}
