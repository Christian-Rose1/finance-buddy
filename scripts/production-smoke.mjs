import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const nextBin = join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const host = "127.0.0.1";
const firstPort = 43170;
const portAttempts = 20;
const buildTimeoutMs = 5 * 60 * 1000;
const startupTimeoutMs = 30 * 1000;
const requestTimeoutMs = 5 * 1000;
const stopTimeoutMs = 5 * 1000;

const inheritedRuntimeEnv = {};
for (const key of ["HOME", "PATH", "TMPDIR", "TMP", "TEMP"]) {
  if (process.env[key]) inheritedRuntimeEnv[key] = process.env[key];
}
const syntheticEnv = {
  ...inheritedRuntimeEnv,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  // Keep Next from applying any project dotenv values to this synthetic run.
  __NEXT_PROCESSED_ENV: "true",
  NEXT_PUBLIC_SUPABASE_URL: "https://finance-buddy-smoke.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon-key-for-production-smoke",
  STRATEGY_RUN_SIGNING_SECRET: "production-smoke-only-0123456789abcdef",
};

const activeChildren = new Set();
const stopPromises = new WeakMap();
let receivedSignal = null;

function childExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function runNext(args, stdio) {
  if (receivedSignal) {
    throw new Error(`Production smoke interrupted by ${receivedSignal}.`);
  }
  const child = spawn(process.execPath, [nextBin, ...args], {
    cwd: projectRoot,
    env: syntheticEnv,
    stdio,
  });
  activeChildren.add(child);
  child.once("close", () => activeChildren.delete(child));
  return child;
}

function waitForChild(child, timeoutMs, label) {
  if (childExited(child)) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }

  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code, signal) => {
      cleanup();
      resolve({ code, signal });
    };

    child.once("error", onError);
    child.once("exit", onExit);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });
}

function waitForExitWithin(child, timeoutMs) {
  if (childExited(child)) return Promise.resolve(true);

  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

function stopChild(child) {
  const existing = stopPromises.get(child);
  if (existing) return existing;

  const stopping = (async () => {
    if (childExited(child)) return;
    child.kill("SIGTERM");
    if (await waitForExitWithin(child, stopTimeoutMs)) return;
    if (!childExited(child)) child.kill("SIGKILL");
    assert.equal(
      await waitForExitWithin(child, stopTimeoutMs),
      true,
      "Child process did not stop after SIGKILL."
    );
  })();
  stopPromises.set(child, stopping);
  return stopping;
}

async function stopAllChildren() {
  await Promise.all([...activeChildren].map((child) => stopChild(child)));
}

const signalNumbers = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };
const signalHandlers = new Map();
for (const [signal, number] of Object.entries(signalNumbers)) {
  const handler = () => {
    if (receivedSignal) {
      for (const child of activeChildren) child.kill("SIGKILL");
      return;
    }
    receivedSignal = signal;
    process.exitCode = 128 + number;
    void stopAllChildren().catch(() => {});
  };
  signalHandlers.set(signal, handler);
  process.on(signal, handler);
}

function removeSignalHandlers() {
  for (const [signal, handler] of signalHandlers) {
    process.off(signal, handler);
  }
}

async function buildProductionBundle() {
  await rm(join(projectRoot, ".next"), { recursive: true, force: true });
  const child = runNext(["build"], "inherit");
  let result;
  try {
    result = await waitForChild(child, buildTimeoutMs, "Production build");
  } catch (error) {
    await stopChild(child);
    throw error;
  }
  assert.equal(result.signal, null, "Production build ended from a signal.");
  assert.equal(result.code, 0, "Production build failed.");
  await access(join(projectRoot, ".next", "BUILD_ID"));
}

function canBindPort(port) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolve(false);
      } else {
        reject(error);
      }
    });
    server.listen(port, host, () => {
      server.close((error) => (error ? reject(error) : resolve(true)));
    });
  });
}

async function availablePort() {
  for (let offset = 0; offset < portAttempts; offset += 1) {
    const port = firstPort + offset;
    if (await canBindPort(port)) return port;
  }
  throw new Error(
    `No available production-smoke port in ${firstPort}-${firstPort + portAttempts - 1}.`
  );
}

async function waitForHome(baseUrl, child) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastStatus = null;

  while (Date.now() < deadline) {
    if (childExited(child)) {
      throw new Error(
        `Production server exited before becoming ready (code=${child.exitCode}, signal=${child.signalCode}).`
      );
    }

    try {
      const remainingMs = deadline - Date.now();
      const response = await fetch(baseUrl, {
        redirect: "error",
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(requestTimeoutMs, remainingMs))
        ),
      });
      lastStatus = response.status;
      if (response.status === 200) return response;
      await response.body?.cancel();
    } catch {
      // Connection failures are expected while Next initializes.
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(250, remainingMs))
      );
    }
  }

  throw new Error(
    `Production server did not return HTTP 200 within ${startupTimeoutMs}ms` +
      (lastStatus === null ? "." : ` (last status ${lastStatus}).`)
  );
}

async function runSmokeChecks() {
  const port = await availablePort();
  const baseUrl = `http://${host}:${port}`;
  const server = runNext(
    ["start", "--hostname", host, "--port", String(port)],
    ["ignore", "pipe", "pipe"]
  );

  try {
    server.stdout.resume();
    server.stderr.resume();

    const homeResponse = await waitForHome(baseUrl, server);
    assert.match(
      homeResponse.headers.get("content-type") ?? "",
      /^text\/html(?:;|$)/i
    );
    const home = await homeResponse.text();
    assert.match(home, /Finance Buddy/);
    assert.match(home, /Illustrative sample/);

    const fixtureResponse = await fetch(
      `${baseUrl}/api/receipts/benefits-test`,
      {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: "this is deliberately not valid JSON",
        signal: AbortSignal.timeout(requestTimeoutMs),
      }
    );
    assert.equal(fixtureResponse.status, 404);
    assert.match(
      fixtureResponse.headers.get("content-type") ?? "",
      /^application\/json(?:;|$)/i
    );
    assert.deepEqual(await fixtureResponse.json(), {
      ok: false,
      error: "Not found.",
    });

    console.log(
      "Production smoke passed: GET / returned HTML 200; fixture POST returned safe 404."
    );
  } finally {
    await stopChild(server);
  }
}

try {
  await buildProductionBundle();
  await runSmokeChecks();
} catch (error) {
  if (!receivedSignal) throw error;
} finally {
  await stopAllChildren();
  removeSignalHandlers();
}
