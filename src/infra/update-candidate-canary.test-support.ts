import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { isRecord } from "@openclaw/normalization-core/record-coerce";
import { vi } from "vitest";
import type { SpawnResult } from "../process/exec.js";

export class FakeChild extends EventEmitter {
  pid: number;
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
}

export function mockCanaryChildProcesses(
  original: typeof import("node:child_process"),
  spawn: typeof original.spawn,
) {
  return {
    ...original,
    spawn: new Proxy(original.spawn, {
      apply(target, thisArg, args) {
        const argv: unknown = args[1];
        if (
          Array.isArray(argv) &&
          typeof argv[0] === "string" &&
          /[/\\]dist[/\\](?:index|infra[/\\]update-migrated-finalize\.worker)\.js$/.test(argv[0])
        ) {
          return Reflect.apply(spawn, thisArg, args);
        }
        return Reflect.apply(target, thisArg, args);
      },
    }),
  };
}

export function mockCanarySnapshotCommands(
  original: typeof import("../process/exec.js"),
  snapshot: typeof original.runUtf8CommandWithTimeout,
) {
  return {
    ...original,
    runUtf8CommandWithTimeout: (...args: Parameters<typeof original.runUtf8CommandWithTimeout>) => {
      if (args[0].some((arg) => /[/\\]update-candidate-state\.worker\.[cm]?[jt]s$/.test(arg))) {
        return snapshot(...args);
      }
      return original.runUtf8CommandWithTimeout(...args);
    },
  };
}

export function createCanarySnapshotResult(input: string, databasePath?: string): SpawnResult {
  const request: unknown = JSON.parse(input);
  return {
    code: 0,
    stdout: JSON.stringify(
      isRecord(request) && request.mode === "inventory"
        ? {
            databases: databasePath ? [[databasePath, { spellings: [databasePath] }]] : [],
            pluginBytes: 0,
            pluginPlan: "plugin-copy-plan.json",
          }
        : { versions: [], pluginPaths: {} },
    ),
    stderr: "",
    signal: null,
    killed: false,
    cleanup: "normal",
    termination: "exit",
  };
}

type CanaryCommandFixture = {
  pluginInventory: unknown;
  pluginErrors: boolean;
  runtimeContract: unknown;
  runtimeError: boolean;
  lintReport: { ok: boolean; checksRun: number; findings: unknown[]; warnings: unknown[] };
};

export function completeCanaryCommand(
  child: FakeChild,
  args: string[],
  readFixture: () => CanaryCommandFixture,
) {
  queueMicrotask(() => {
    const { pluginInventory, pluginErrors, runtimeContract, runtimeError, lintReport } =
      readFixture();
    if (args.includes("plugins")) {
      child.stdout.write(
        JSON.stringify(
          pluginInventory ?? {
            plugins: [],
            diagnostics: pluginErrors ? [{ level: "error", message: "incompatible plugin" }] : [],
          },
        ),
      );
    }
    if (args.includes("--check")) {
      child.stdout.write(JSON.stringify(runtimeContract));
    }
    if (args.includes("--lint")) {
      child.stdout.write(JSON.stringify(lintReport));
    }
    child.emit(
      "close",
      (runtimeError && args.includes("--check")) || (!lintReport.ok && args.includes("--lint"))
        ? 1
        : 0,
    );
  });
}

export function stubHealthyGateway() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ status: "started", ready: true })),
  );
}
