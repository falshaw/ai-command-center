// Loads hud.config.json (or HUD_CONFIG=<path>), falling back to the bundled example so a fresh clone runs.
// Relative paths in the config resolve against the config file's own folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const candidates = [process.env.HUD_CONFIG, path.join(APP_DIR, "hud.config.json"), path.join(APP_DIR, "examples", "hud.config.example.json")].filter(Boolean);
const file = candidates.find((f) => fs.existsSync(f));
if (!file) throw new Error("No config found. Copy examples/hud.config.example.json to hud.config.json.");
const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const base = path.dirname(file);
const abs = (p) => (p ? path.resolve(base, p) : null);

const DEFAULTS = {
  port: 3020,
  user: "there",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  home: { label: "Home", lat: 52.52, lon: 13.4 },
  arcs: [],
  apps: [],
  services: [],
  tasksFile: null,
  standingTasks: [],
  todayFile: null,
  feeds: [],
  terminal: { cwd: os.homedir(), command: "claude" },
};

export const CONFIG = {
  ...DEFAULTS,
  ...raw,
  file,
  home: { ...DEFAULTS.home, ...(raw.home || {}) },
  terminal: { ...DEFAULTS.terminal, ...(raw.terminal || {}), cwd: abs(raw.terminal?.cwd) || DEFAULTS.terminal.cwd },
  tasksFile: abs(raw.tasksFile),
  todayFile: abs(raw.todayFile),
  feeds: (raw.feeds || []).map((f) => ({ id: String(f.id), label: String(f.label || f.id), file: abs(f.file) })),
  apps: (raw.apps || []).map((a) => ({ name: String(a.name), port: Number(a.port) || null, url: a.url || (a.port ? `http://127.0.0.1:${a.port}` : null), composeDir: abs(a.composeDir) })),
};

for (const a of CONFIG.apps) if (!/^[a-z0-9][a-z0-9_-]{0,40}$/i.test(a.name)) throw new Error(`app name "${a.name}" must be letters, digits, - or _`);
for (const f of CONFIG.feeds) if (!/^[a-z0-9_-]{1,40}$/i.test(f.id)) throw new Error(`feed id "${f.id}" must be letters, digits, - or _`);

// What the page may see: no file paths, no terminal settings.
export const PUBLIC_CONFIG = {
  user: CONFIG.user,
  timezone: CONFIG.timezone,
  home: CONFIG.home,
  arcs: CONFIG.arcs,
  standingTasks: CONFIG.standingTasks,
  feeds: CONFIG.feeds.map(({ id, label }) => ({ id, label })),
  hasTasks: !!CONFIG.tasksFile,
};
