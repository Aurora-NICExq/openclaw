import { readStringField as readString } from "openclaw/plugin-sdk/string-coerce-runtime";
import { codexNativeSubagentNotifications } from "./native-subagent-notification.js";
import { isJsonObject, type CodexServerNotification } from "./protocol.js";

type Receipt = { id: string; agentPath: string; result?: string };
type Outcome = {
  paths: Set<string>;
  result?: string;
  received: boolean;
  receiptResults: Set<string | undefined>;
};

/** Correlates native receipts with immutable assignments while a parent is registered. */
export class CodexNativeSubagentDeliveryReceipts {
  private readonly seen = new Set<string>();
  private readonly pending: Receipt[] = [];
  private readonly outcomes = new Map<string, Outcome>();

  observe(notification: CodexServerNotification): string[] {
    const params = isJsonObject(notification.params) ? notification.params : undefined;
    const item = isJsonObject(params?.item) ? params.item : undefined;
    if (!item) {
      return [];
    }
    const nativeResults = codexNativeSubagentNotifications.fromNotification(notification);
    for (const agentPath of codexNativeSubagentNotifications.deliveredAgentPaths(notification)) {
      const id = `${notification.method}:${readString(item, "id") ?? JSON.stringify(item)}:${agentPath}`;
      if (this.seen.has(id)) {
        continue;
      }
      this.seen.add(id);
      let result = nativeResults.find((value) => value.agentPath === agentPath)?.result;
      if (item.type === "agent_message" && Array.isArray(item.content)) {
        const part = item.content[0];
        const text = isJsonObject(part) ? readString(part, "text") : undefined;
        result = text?.split("\nPayload:\n").slice(1).join("\nPayload:\n");
      } else if (isJsonObject(item.agentsStates)) {
        const child = item.agentsStates[agentPath];
        result = isJsonObject(child) ? readString(child, "message") : result;
      }
      this.pending.push({ id, agentPath, result: receiptResultKey(result) });
    }
    return this.match();
  }

  record(runId: string, paths: Iterable<string>, result: string): string[] {
    const outcome: Outcome = this.outcomes.get(runId) ?? {
      paths: new Set(paths),
      received: false,
      receiptResults: new Set(),
    };
    outcome.result = receiptResultKey(result);
    this.outcomes.set(runId, outcome);
    const matched = this.match();
    return outcome.received ? [...new Set([...matched, runId])] : matched;
  }

  track(runId: string, paths: Iterable<string>): string[] {
    const outcome = this.outcomes.get(runId) ?? {
      paths: new Set<string>(),
      received: false,
      receiptResults: new Set<string | undefined>(),
    };
    for (const path of paths) {
      outcome.paths.add(path);
    }
    this.outcomes.set(runId, outcome);
    const matched = this.match();
    return outcome.received ? [...new Set([...matched, runId])] : matched;
  }

  restore(
    assignments: Iterable<{ runId: string; paths: Iterable<string>; result?: string }>,
  ): string[] {
    const restored = new Map<string, Outcome>();
    for (const assignment of assignments) {
      const outcome = this.outcomes.get(assignment.runId) ?? {
        paths: new Set<string>(),
        received: false,
        receiptResults: new Set<string | undefined>(),
      };
      for (const path of assignment.paths) {
        outcome.paths.add(path);
      }
      outcome.result ??= receiptResultKey(assignment.result);
      restored.set(assignment.runId, outcome);
    }
    // Prepare the complete oldest-first snapshot before matching. In-flight
    // native turns may not have task rows yet; retain their existing observations.
    for (const [runId, outcome] of this.outcomes) {
      if (!restored.has(runId)) {
        restored.set(runId, outcome);
      }
    }
    this.outcomes.clear();
    for (const [runId, outcome] of restored) {
      this.outcomes.set(runId, outcome);
    }
    const matched = this.match();
    return [
      ...new Set([
        ...matched,
        ...[...restored].filter(([, value]) => value.received).map(([id]) => id),
      ]),
    ];
  }

  resumeAssignment(runId: string, pendingRunIds: readonly string[]): string[] {
    // The observed turn continues this assignment; its provisional receipt
    // boundary must not keep that assignment's own receipt ambiguous.
    for (const pendingRunId of pendingRunIds) {
      this.outcomes.delete(pendingRunId);
    }
    return this.track(runId, []);
  }

  addAlias(threadId: string, agentPath: string): string[] {
    for (const outcome of this.outcomes.values()) {
      if (outcome.paths.has(threadId)) {
        outcome.paths.add(agentPath);
      }
    }
    return this.match();
  }

  private match(): string[] {
    const received: string[] = [];
    for (let index = 0; index < this.pending.length;) {
      const receipt = this.pending[index]!;
      const matches = [...this.outcomes].filter(([, outcome]) =>
        outcome.paths.has(receipt.agentPath),
      );
      // Raw native receipts have no child turn ID. Prefer the oldest matching
      // result; a delayed predecessor receipt must never acknowledge its successor.
      let match: [string, Outcome] | undefined;
      for (const candidate of matches) {
        const outcome = candidate[1];
        if (
          (outcome.result !== undefined && outcome.result === receipt.result) ||
          outcome.receiptResults.has(receipt.result)
        ) {
          match = candidate;
          break;
        }
        if (outcome.result === undefined) {
          // An unresolved predecessor can still own this receipt.
          match = matches.length === 1 ? candidate : undefined;
          break;
        }
      }
      if (!match) {
        index += 1;
        continue;
      }
      // Different receipt families can repeat an identical predecessor result.
      // Without a child turn ID, preserve the successor's pending delivery.
      match[1].receiptResults.add(receipt.result);
      if (!match[1].received) {
        match[1].received = true;
        received.push(match[0]);
      }
      this.pending.splice(index, 1);
    }
    return received;
  }
}

function receiptResultKey(result: string | undefined): string | undefined {
  // Task summaries collapse whitespace; keep comparison stable across restoration.
  return result?.replace(/\s+/g, " ").trim();
}
