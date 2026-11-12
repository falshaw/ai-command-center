// The Claude Code terminal: one pty session that outlives page reloads.
// FULL CONTROL OF THE PC — server.mjs only hands sockets here after the Host/Origin/token checks.
import pty from "node-pty";
import { CONFIG } from "./config.mjs";

const MAX_REPLAY = 256 * 1024; // last 256 KB re-sent to a reconnecting page
let session = null; // { proc, buffer, sockets:Set, exited }

// If the HUD itself was started from inside a Claude Code session, these markers would make the
// terminal's Claude think it is a child session (no transcripts). Drop them.
const SESSION_MARKERS = ["CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT"];
function cleanEnv() {
  const env = { ...process.env };
  for (const k of SESSION_MARKERS) delete env[k];
  return env;
}

function start(cols = 120, rows = 30) {
  // Windows: PowerShell 7 that stays open after the agent exits; elsewhere: the login shell running the agent.
  const cmd = CONFIG.terminal.command;
  const [file, args] = process.platform === "win32"
    ? ["pwsh.exe", ["-NoLogo", "-NoExit", "-Command", cmd]]
    : [process.env.SHELL || "bash", ["-lc", `${cmd}; exec ${process.env.SHELL || "bash"}`]];
  const proc = pty.spawn(file, args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd: CONFIG.terminal.cwd,
    env: cleanEnv(),
    useConpty: true,
  });
  const s = { proc, buffer: "", sockets: new Set(), exited: false };
  proc.onData((d) => {
    s.buffer += d;
    if (s.buffer.length > MAX_REPLAY) s.buffer = s.buffer.slice(-MAX_REPLAY);
    for (const ws of s.sockets) if (ws.readyState === 1) ws.send(d);
  });
  proc.onExit(() => {
    s.exited = true;
    const msg = "\r\n\x1b[90m[session ended — press New session]\x1b[0m\r\n";
    for (const ws of s.sockets) if (ws.readyState === 1) ws.send(msg);
  });
  return s;
}

export function newSession(cols, rows) {
  if (session && !session.exited) {
    try {
      session.proc.kill();
    } catch {}
  }
  const sockets = session ? session.sockets : new Set();
  session = start(cols, rows);
  session.sockets = sockets;
  for (const ws of sockets) if (ws.readyState === 1) ws.send("\x1bc"); // clear the page's screen
}

// No live session yet → wait for the page's first resize so Claude Code starts at the real width
// (starting at a guessed 120×30 left a garbled first screen).
export function attach(ws) {
  const live = session && !session.exited;
  if (live) {
    session.sockets.add(ws);
    if (session.buffer) ws.send(session.buffer);
  }
  let dims = { cols: 120, rows: 30 };

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.t === "resize") {
      dims = { cols: Math.max(20, Math.min(400, msg.cols | 0)), rows: Math.max(5, Math.min(200, msg.rows | 0)) };
      if (!session || session.exited) {
        if (!session) session = { sockets: new Set(), exited: true };
        session.sockets.add(ws);
        newSession(dims.cols, dims.rows);
      } else {
        session.sockets.add(ws);
        session.proc.resize(dims.cols, dims.rows);
      }
    } else if (!session || session.exited) {
      if (msg.t === "new") {
        if (!session) session = { sockets: new Set([ws]), exited: true };
        newSession(dims.cols, dims.rows);
      }
    } else if (msg.t === "in" && typeof msg.d === "string") session.proc.write(msg.d);
    else if (msg.t === "new") newSession(dims.cols, dims.rows);
  });
  ws.on("close", () => session && session.sockets.delete(ws));
}

export function shutdown() {
  if (session && !session.exited) {
    try {
      session.proc.kill();
    } catch {}
  }
}
