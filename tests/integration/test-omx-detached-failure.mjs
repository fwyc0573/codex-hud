import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);

function resolveOmxIndex() {
  const candidates = [];
  if (process.env.OMX_INDEX) candidates.push(process.env.OMX_INDEX);
  if (process.env.OMX_ROOT) candidates.push(join(process.env.OMX_ROOT, "dist/cli/index.js"));
  try {
    candidates.push(require.resolve("oh-my-codex/dist/cli/index.js"));
  } catch {
    // The optional oh-my-codex fixture is not installed in every environment.
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const OMX_INDEX = resolveOmxIndex();
const SKIP_REASON = OMX_INDEX
  ? undefined
  : "oh-my-codex is not installed; set OMX_ROOT or OMX_INDEX to run this historical fixture";

function runTmux(args, env) {
  return spawnSync("tmux", ["-f", "/dev/null", ...args], {
    env,
    encoding: "utf-8",
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function exerciseDetachedFailure({ codexCommand, waitMs, outputPattern, messagePattern }) {
  const root = await mkdtemp("/tmp/omx-detached-failure-");
  const env = {
    ...process.env,
    HOME: join(root, "home"),
    OMX_ROOT: join(root, "omx"),
    TMUX_TMPDIR: join(root, "tmux"),
    OMX_AUTO_UPDATE: "0",
    OMX_NOTIFY_FALLBACK: "0",
    OMX_HOOK_DERIVED_SIGNALS: "0",
    TERM: "xterm-256color",
    COLUMNS: "120",
    LINES: "40",
  };
  await mkdir(env.HOME, { recursive: true });
  await mkdir(env.TMUX_TMPDIR, { recursive: true });
  const sessionName = `omx-rca-${process.pid}-${Date.now()}`;
  const { buildDetachedSessionBootstrapSteps } = await import(OMX_INDEX);
  const steps = buildDetachedSessionBootstrapSteps(
    sessionName,
    root,
    codexCommand,
    "'/bin/true'",
    undefined,
    undefined,
    undefined,
    false,
  );
  const newSession = steps.find((step) => step.name === "new-session");
  assert.ok(newSession, "detached bootstrap must include new-session");
  const launch = runTmux(newSession.args, env);
  assert.equal(launch.status, 0, launch.stderr || launch.stdout);

  await sleep(waitMs);
  const pane = runTmux(["list-panes", "-t", sessionName, "-F", "#{pane_id}"], env);
  assert.equal(pane.status, 0, pane.stderr || pane.stdout);
  const paneId = pane.stdout.trim().split("\n")[0];
  assert.match(paneId, /^%/);
  const captured = runTmux(["capture-pane", "-p", "-t", paneId], env);
  assert.match(captured.stdout, outputPattern);

  // This is the race observed in production: the detached pty receives EOF
  // before the parent has attached. The old one-shot read exits the leader
  // pane here and tmux destroys the otherwise valid session.
  const eof = runTmux(["send-keys", "-t", paneId, "C-d"], env);
  assert.equal(eof.status, 0, eof.stderr || eof.stdout);
  await sleep(300);

  const alive = runTmux(["has-session", "-t", sessionName], env);
  assert.equal(alive.status, 0, "failed detached session disappeared before attach");

  // Attach through a real pseudo-terminal, then acknowledge the diagnostic.
  const attach = spawn(
    "script",
    ["-qfec", `tmux -f /dev/null attach-session -t ${sessionName}`, join(root, "attach.log")],
    { env, stdio: "ignore" },
  );
  await new Promise((resolve) => attach.once("exit", resolve));
  assert.equal(attach.exitCode, 0, "tmux attach failed after the Codex error");
  const attachLog = await readFile(join(root, "attach.log"), "utf-8");
  assert.match(attachLog, outputPattern);
  assert.match(attachLog, messagePattern);
  assert.doesNotMatch(attachLog, /failed to attach detached tmux session|open terminal failed/);
}

test("detached Codex failure survives a pre-attach EOF and remains attachable", { skip: SKIP_REASON }, () =>
  exerciseDetachedFailure({
    codexCommand: "'/bin/sh' '-c' 'sleep 0.2; printf [server-exited] >&2; exit 42'",
    waitMs: 700,
    outputPattern: /server-exited/,
    messagePattern: /codex exited with code 42/,
  }),
);

test("zero exit after the bootstrap timing boundary remains attachable", { skip: SKIP_REASON }, () =>
  exerciseDetachedFailure({
    codexCommand: "'/bin/sh' '-c' 'sleep 3.2; printf [clean-exit] >&2; exit 0'",
    waitMs: 3600,
    outputPattern: /clean-exit/,
    messagePattern: /codex exited with code 0 before the detached tmux session was attached/,
  }),
);

test("signal exit before attach remains attachable", { skip: SKIP_REASON }, () =>
  exerciseDetachedFailure({
    codexCommand: "'/bin/sh' '-c' 'printf [signal-exit] >&2; kill -TERM $$'",
    waitMs: 700,
    outputPattern: /signal-exit/,
    messagePattern: /codex exited with code 143/,
  }),
);
