/**
 * Shared identifiers for representing Codex native subagents as OpenClaw task
 * runtime rows.
 */
/** Task runtime namespace for Codex native subagent task rows. */
export const CODEX_NATIVE_SUBAGENT_RUNTIME = "subagent";
/** Task kind used to distinguish native Codex subagents from other subagent runtimes. */
export const CODEX_NATIVE_SUBAGENT_TASK_KIND = "codex-native";
/** Run id prefix for task rows keyed by Codex child thread ids. */
export const CODEX_NATIVE_SUBAGENT_RUN_ID_PREFIX = "codex-thread:";

/** Initial tasks keep their shipped locator; later assignments belong to a native turn. */
export function codexNativeSubagentRunId(threadId: string, turnId?: string): string {
  return `${CODEX_NATIVE_SUBAGENT_RUN_ID_PREFIX}${threadId.trim()}${turnId ? `:turn:${turnId}` : ""}`;
}

export function readCodexNativeSubagentRunId(
  runId: string | undefined,
): { threadId: string; turnId?: string } | undefined {
  if (!runId?.startsWith(CODEX_NATIVE_SUBAGENT_RUN_ID_PREFIX)) {
    return undefined;
  }
  const [threadId, turnId] = runId
    .slice(CODEX_NATIVE_SUBAGENT_RUN_ID_PREFIX.length)
    .split(":turn:");
  return threadId?.trim() ? { threadId, ...(turnId ? { turnId } : {}) } : undefined;
}
