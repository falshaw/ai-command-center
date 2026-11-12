"use strict";
const TOKEN = document.querySelector('meta[name="hud-token"]').content;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? esc(u) : "#");
const ok = (res) => res && !res.error;

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { "X-HUD-Token": TOKEN, "Content-Type": "application/json", ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

let CFG = { user: "there", timezone: "UTC", home: {}, arcs: [], standingTasks: [], feeds: [], hasTasks: false };
const S = { today: null, feeds: [], fleet: null, view: "today", todayHtml: "" };

// ---------- priorities (Urgent > High = P1 > Medium = P2 > Low = P3) ----------
const PRIO = (p) => (/critical|urgent|p0/i.test(p) ? 0 : /high|p1/i.test(p) ? 1 : /medium|p2/i.test(p) ? 2 : /low|p3/i.test(p) ? 3 : 4);
const actionable = (r) => !/waiting|blocked|deferred|backlog|parked|done/i.test(r.status);
const sortByPriority = (rows) => rows.map((r, i) => [r, i]).sort((x, y) => PRIO(x[0].priority) - PRIO(y[0].priority) || x[1] - y[1]).map(([r]) => r);
const topTasks = (n) => (ok(S.today?.tasks) ? sortByPriority(S.today.tasks.data.filter((x) => actionable(x) && !CFG.standingTasks.includes(x.id))).slice(0, n) : []);

// ---------- NEW badge: anything first seen after the last time this page was open (per browser) ----------
const SEEN_KEY = "hud-last-seen";
let prevSeen = 0;
try { prevSeen = Number(localStorage.getItem(SEEN_KEY)) || 0; } catch {}
if (!prevSeen) prevSeen = Date.now() - 864e5;
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch {} };
addEventListener("pagehide", markSeen);
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && markSeen());
const isNew = (r) => r.firstSeen && Date.parse(r.firstSeen) > prevSeen;

// ---------- dates ----------
let TODAY = new Date().toISOString().slice(0, 10);
function fmtDay(day, time) {
  const tm = new Date(Date.parse(TODAY + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);
  const l = day === TODAY ? "Today" : day === tm ? "Tomorrow" : new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));
  return time ? `${l}, ${time}` : l;
}
function tick() {
  const now = new Date(), TZ = CFG.timezone;
  $("time").textContent = now.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  $("date-pill").textContent = now.toLocaleDateString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
  const h = Number(now.toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }));
  $("greeting").innerHTML = `${h < 5 ? "Late night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Welcome back"}, <b>${esc(CFG.user)}!</b>`;
}

// ---------- today: header chips + the Today list ----------
function renderToday() {
  const t = S.today;
  if (!t) return;
  TODAY = t.date;
  const li = (box, title, sub) => `<li><span class="box ${box}"></span><div><div class="t">${esc(title)}</div><div class="s">${esc(sub)}</div></div></li>`;
  let html = "";
  if (ok(t.today)) {
    html += t.today.data.plan.map((p) => li("meal", p.text, p.label)).join("");
    if (t.today.data.events.length) html += `<li class="sec">This week</li>` + t.today.data.events.map((e) => li("cal", e.title, fmtDay(e.day, e.time) + (e.location ? ` · ${e.location}` : ""))).join("");
  } else html += `<li class="err">today.json: ${esc(t.today.error)}</li>`;
  const top = topTasks(5);
  if (top.length) html += `<li class="sec">Top tasks</li>` + top.map((x) => li(PRIO(x.priority) <= 1 ? "task hi" : "task", x.title, `${x.id} · ${x.priority} · ${x.status}`)).join("");
  S.todayHtml = `<ul class="todo">${html || `<li class="empty">Nothing planned. Add a today.json (see README).</li>`}</ul>`;
  if (S.view === "today") renderList();

  const chip = (ic, label, text, cls = "", view = "") =>
    `<${view ? "button type=\"button\"" : "span"} class="chip ${cls}" ${view ? `data-view="${view}"` : ""} title="${esc(text)}"><span class="ic">${ic}</span><b>${esc(label)}</b> <span class="tt">${esc(text)}</span></${view ? "button" : "span"}>`;
  let chips = topTasks(10).filter((x) => PRIO(x.priority) <= 1).slice(0, 3).map((x) => chip(PRIO(x.priority) === 0 ? "🔥" : "⚑", x.id, x.title, `prio${PRIO(x.priority) === 0 ? " urgent" : ""}`, "tasks")).join("");
  if (ok(t.today)) {
    chips += t.today.data.plan.slice(0, 2).map((p) => chip("•", p.label, p.text)).join("");
    const nx = t.today.data.events[0];
    if (nx) chips += chip("📅", "Next", `${nx.title} · ${fmtDay(nx.day, nx.time)}`, "next");
  }
  $("summary").innerHTML = chips || `<span class="chip">Nothing planned today.</span>`;
}

// ---------- the right-hand list ----------
function renderNav() {
  const items = [["today", "☀ Today"], ...CFG.feeds.map((f) => [`feed:${f.id}`, `◇ ${f.label}`])];
  if (CFG.hasTasks) items.push(["tasks", "☐ Tasks"]);
  $("nav").innerHTML = items.map(([v, label]) => `<button class="nav${S.view === v ? " on" : ""}" data-view="${esc(v)}" type="button">${esc(label)} <span class="n" data-count="${esc(v)}"></span></button>`).join("");
}
function setCount(view, text, hasNew) {
  const el = document.querySelector(`.n[data-count="${CSS.escape(view)}"]`);
  if (el) { el.textContent = text; el.classList.toggle("hasnew", !!hasNew); }
}
function renderList() {
  for (const b of document.querySelectorAll(".nav[data-view]")) b.classList.toggle("on", b.dataset.view === S.view);
  if (S.view === "today") {
    $("list-title").textContent = "Today";
    $("list-meta").textContent = new Date().toLocaleDateString("en-GB", { timeZone: CFG.timezone, weekday: "long" });
    $("list").innerHTML = S.todayHtml || `<div class="empty">Loading…</div>`;
    return;
  }
  if (S.view === "tasks") {
    $("list-title").textContent = "Active tasks";
    $("list-meta").textContent = "by priority";
    const res = S.today?.tasks;
    if (!res) return ($("list").innerHTML = `<div class="empty">Loading…</div>`);
    if (!ok(res)) return ($("list").innerHTML = `<div class="err">${esc(res.error)}</div>`);
    const d = sortByPriority(res.data.filter(actionable));
    $("list").innerHTML = d.length ? d.map((t) => `<div class="item"><div style="flex:1;min-width:0"><div class="t">${esc(t.title)}</div><div class="s">${esc(t.area)} · ${esc(t.status)}</div></div><span class="w" style="color:${PRIO(t.priority) <= 1 ? "#ea580c" : "var(--ink3)"}">${esc(t.id)}</span></div>`).join("") : `<div class="empty">No active tasks.</div>`;
    return;
  }
  const f = S.feeds.find((x) => `feed:${x.id}` === S.view);
  $("list-title").textContent = f ? f.label : "Feed";
  $("list-meta").textContent = "";
  if (!f) return ($("list").innerHTML = `<div class="empty">Loading…</div>`);
  if (f.error) return ($("list").innerHTML = `<div class="err">${esc(f.error)}</div>`);
  if (!f.data.length) return ($("list").innerHTML = `<div class="empty">Nothing here.</div>`);
  $("list").innerHTML = f.data.map((i) => {
    const inner = `<div style="flex:1;min-width:0"><div class="t">${isNew(i) ? `<span class="new">NEW</span>` : ""}${esc(i.title)}</div>${i.sub ? `<div class="s">${esc(i.sub)}</div>` : ""}${i.score != null ? `<div class="bar"><i style="width:${Math.max(0, Math.min(100, i.score))}%"></i></div>` : ""}</div>${i.score != null ? `<span class="f">${esc(i.score)}</span>` : i.when ? `<span class="w">${esc(i.when)}</span>` : ""}`;
    return i.url ? `<a class="item" href="${safeUrl(i.url)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : `<div class="item">${inner}</div>`;
  }).join("");
}
document.body.addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (b && !b.classList.contains("sat")) { S.view = b.dataset.view; renderList(); }
});
$("nav-claude").addEventListener("click", () => term.focus());

// ---------- fleet: apps orbit the planet ----------
let appsByName = {};
const led = (cls) => `<i class="led ${cls}"></i>`;
function renderFleet() {
  const f = S.fleet;
  if (!f) return;
  const st = $("stage");
  st.querySelectorAll(".sat").forEach((n) => n.remove());
  const pill = $("fleet-pill").querySelector(".led");
  if (!ok(f.services)) { $("online").textContent = "Status unavailable"; pill.className = "led bad"; return; }
  const { apps, services } = f.services.data;
  const w = st.clientWidth, h = st.clientHeight, cx = w / 2, cy = h / 2 - 14;
  const rx = Math.min(w * 0.40, 380), ry = Math.min(h * 0.42, 230);
  apps.forEach((a, i) => {
    const ang = (i / apps.length) * Math.PI * 2 - Math.PI / 2;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sat" + (a.up ? "" : a.starting ? " down starting" : a.canStart ? " down" : " down nostart");
    b.dataset.app = a.name;
    b.title = a.up ? `Open ${a.name}` : a.canStart ? `Start ${a.name}` : `${a.name} is down (no composeDir configured)`;
    b.innerHTML = `<i></i>${esc(a.name)}`;
    b.style.left = cx + rx * Math.cos(ang) + "px";
    b.style.top = cy + ry * Math.sin(ang) + "px";
    st.appendChild(b);
  });
  const up = apps.filter((a) => a.up).length;
  $("online").textContent = apps.length ? `${up} of ${apps.length} online` : "No apps configured";
  $("fleet-count").textContent = ok(f.containers) ? `${up}/${apps.length} apps · ${f.containers.data.filter((c) => c.up).length} containers` : "Docker is not running";
  pill.className = "led " + (!ok(f.containers) ? "bad" : up === apps.length ? "ok" : "warn");
  $("ai").innerHTML = services.map((s) => `<span>${led(s.up ? "ok" : "")}${esc(s.name)}</span>`).join("");
}
async function startApp(name) {
  try { await api("/api/start", { method: "POST", body: JSON.stringify({ app: name }) }); } catch (err) { alert(`Could not start ${name}: ${err.message}`); }
  loadFleet();
  for (const ms of [8000, 20000, 40000]) setTimeout(refresh, ms);
}
$("stage").addEventListener("click", (e) => {
  const sat = e.target.closest(".sat");
  if (!sat) return;
  const a = appsByName[sat.dataset.app];
  if (a?.up && a.url) window.open(a.url, "_blank", "noopener");
  else if (a && a.canStart && !a.starting) { sat.classList.add("starting"); startApp(a.name); }
});

// ---------- loading ----------
async function loadToday() { S.today = await api("/api/today"); renderToday(); setCount("tasks", ok(S.today.tasks) ? S.today.tasks.data.filter(actionable).length : ""); if (S.view === "tasks") renderList(); }
async function loadFeeds() {
  S.feeds = (await api("/api/feeds")).feeds;
  for (const f of S.feeds) { if (f.error) { setCount(`feed:${f.id}`, "!"); continue; } const nn = f.data.filter(isNew).length; setCount(`feed:${f.id}`, nn ? `${nn} new` : f.data.length, nn > 0); }
  if (S.view.startsWith("feed:")) renderList();
}
async function loadFleet() {
  S.fleet = await api("/api/fleet");
  if (ok(S.fleet.services)) appsByName = Object.fromEntries(S.fleet.services.data.apps.map((a) => [a.name, a]));
  renderFleet();
}
async function refresh() { await Promise.allSettled([loadToday(), loadFeeds(), loadFleet()]); }
addEventListener("resize", renderFleet);

// ---------- terminal ----------
const term = new Terminal({
  cursorBlink: true, fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace', fontSize: 12.5, lineHeight: 1.15, scrollback: 5000,
  theme: { background: "#1a1458", foreground: "#ece9ff", cursor: "#ff9f43", selectionBackground: "rgba(143,182,255,0.3)",
    scrollbarSliderBackground: "rgba(255,255,255,0.12)", scrollbarSliderHoverBackground: "rgba(255,255,255,0.2)", scrollbarSliderActiveBackground: "rgba(255,159,67,0.4)" },
  overviewRuler: { width: 0 },
});
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open($("term"));
let ws = null, retry = 1000;
const sendWs = (m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));
function fitTerm() { try { fit.fit(); } catch {} sendWs({ t: "resize", cols: term.cols, rows: term.rows }); }
function setState(text, cls) { $("term-state").textContent = text; $("term-led").className = "led " + cls; }
function connect() {
  ws = new WebSocket(`ws://${location.host}/term?token=${encodeURIComponent(TOKEN)}`);
  ws.onopen = () => { retry = 1000; setState("live session", "ok"); term.reset(); fitTerm(); };
  ws.onmessage = (ev) => term.write(ev.data);
  ws.onclose = () => { setState("reconnecting", "warn"); setTimeout(connect, retry); retry = Math.min(retry * 2, 15000); };
}
term.onData((d) => sendWs({ t: "in", d }));
new ResizeObserver(fitTerm).observe($("term"));
$("term-new").addEventListener("click", () => { term.reset(); sendWs({ t: "new" }); term.focus(); });

// ---------- start ----------
for (let i = 0; i < 60; i++) {
  const s = document.createElement("i");
  s.className = "star";
  s.style.left = Math.random() * 100 + "%";
  s.style.top = Math.random() * 100 + "%";
  s.style.opacity = (0.3 + Math.random() * 0.7).toFixed(2);
  $("sky").appendChild(s);
}
(async () => {
  try { CFG = { ...CFG, ...(await api("/api/config")) }; } catch {}
  $("avatar").textContent = !CFG.user || CFG.user === "there" ? "✦" : CFG.user.trim().charAt(0).toUpperCase();
  renderNav();
  tick();
  setInterval(tick, 15000);
  mountGlobe($("globe"), { dot: "#ffffff", rim: "#a5b4fc", pin: "#ffb86b", arc: "#7fb2ff", sea: "#4c3bd0", seaOpacity: 0.25, dotSize: 0.02, zoom: 4.1, step: 1.4, home: CFG.home, arcs: CFG.arcs || [] }).catch(() => {});
  refresh();
  setInterval(refresh, 60000);
  connect();
})();
