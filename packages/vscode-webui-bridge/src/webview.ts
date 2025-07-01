import type { ThreadAbortSignalSerialization } from "@quilted/threads";
import type { ThreadSignalSerialization } from "@quilted/threads/signals";
import type { Environment } from "@ragdoll/db";
import type { TaskRunnerState } from "@ragdoll/runner";
import type {
  CaptureEvent,
  McpStatus,
  NewTaskParams,
  ResourceURI,
  SessionState,
  TaskIdParams,
  TaskRunnerOptions,
  WorkspaceState,
} from "./index"; // Adjusted to import from index.ts

export interface VSCodeHostApi {
  readResourceURI(): Promise<ResourceURI>;

  readToken(): Promise<ThreadSignalSerialization<string | undefined>>;

  getSessionState<K extends keyof SessionState>(
    keys?: K[],
  ): Promise<Pick<SessionState, K>>;
  setSessionState(state: Partial<SessionState>): Promise<void>;

  getWorkspaceState<K extends keyof WorkspaceState>(
    key: K,
    defaultValue?: WorkspaceState[K],
  ): Promise<WorkspaceState[K]>;

  setWorkspaceState<K extends keyof WorkspaceState>(
    key: K,
    value: WorkspaceState[K],
  ): Promise<void>;

  readEnvironment(): Promise<Environment>;

  previewToolCall(
    toolName: string,
    args: unknown,
    options: {
      toolCallId: string;
      state: "partial-call" | "call" | "result";
      abortSignal?: ThreadAbortSignalSerialization;
    },
  ): Promise<
    | {
        error: string;
      }
    | undefined
  >;

  /**
   * Execute a tool call.
   * @param toolName The name of the tool to execute.
   * @param args The arguments to pass to the tool.
   * @param options Options for the tool call.
   * @return A promise that resolves to the result of the tool call.
   *         The result can be any type, depending on the tool's implementation.
   *         for "executeCommand" tool, the result is {@link ExecuteCommandResult}.
   */
  executeToolCall(
    toolName: string,
    args: unknown,
    options: {
      toolCallId: string;
      abortSignal: ThreadAbortSignalSerialization;
    },
  ): Promise<unknown>;

  listFilesInWorkspace(): Promise<
    {
      filepath: string;
      isDir: boolean;
    }[]
  >;

  /**
   * List all workflows from .pochirules/workflows directory
   * Returns an array of objects containing the name and content of each workflow.
   */
  listWorkflowsInWorkspace(): Promise<
    { id: string; path: string; content: string }[]
  >;

  /**
   * Get active tabs with real-time updates via ThreadSignal
   * Each tab is represented by an object with:
   * - filepath: Path to the file
   *   - For files within workspace: Returns path relative to workspace root (e.g., "src/index.ts")
   *   - For files outside workspace: Returns the absolute file path unchanged (e.g., "/Users/name/project/file.ts")
   * - isDir: Boolean indicating if the item is a directory
   *
   */
  readActiveTabs(): Promise<
    ThreadSignalSerialization<Array<{ filepath: string; isDir: boolean }>>
  >;

  readActiveSelection(): Promise<
    ThreadSignalSerialization<
      Environment["workspace"]["activeSelection"] | undefined
    >
  >;

  /**
   * Opens a file at the specified file path.
   *
   * @param filePath - The path to the file to be opened.
   * @param options - Optional parameters for opening the file.
   * @param options.start - The starting line number (1-based) to open the file at.
   * @param options.end - The ending line number (1-based) to open the file at.
   * @param options.preserveFocus - If true, the file will be opened without changing focus. Only applicable for text files.
   */
  openFile(
    filePath: string,
    options?: { start?: number; end?: number; preserveFocus?: boolean },
  ): void;

  readCurrentWorkspace(): Promise<string | undefined>;

  readMinionId(): Promise<string | undefined>;

  /**
   * @param event - The event name.
   * @param properties - The event properties.
   */
  capture(e: CaptureEvent): Promise<void>;

  closeCurrentWorkspace(): void;

  /**
   * Get all configured MCP server connection status and tools.
   * Use {@link executeToolCall} to execute the tool.
   */
  readMcpStatus(): Promise<ThreadSignalSerialization<McpStatus>>;

  /**
   * get external rules like cursor rules.
   * @returns Array of external rule file paths
   */
  fetchThirdPartyRules(): Promise<{
    rulePaths: string[];
    workspaceRuleExists: boolean;
    copyRules: () => Promise<void>;
  }>;

  /**
   * Opens the specified URI in the user's default web browser or external application.
   * @param uri - The URI to open in an external application.
   */
  openExternal(uri: string): Promise<void>;

  /**
   * Start running a task in the background.
   */
  runTask(
    uid: string,
    options?: TaskRunnerOptions,
  ): Promise<{ result: ThreadSignalSerialization<TaskRunnerState> }>;

  /**
   * Reads the current task runners.
   */
  readTaskRunners(): Promise<
    ThreadSignalSerialization<Record<string, TaskRunnerState>>
  >;

  /**
   * Saves a checkpoint with the given message.
   * @param message - The message to save as a checkpoint.
   * @returns A promise that resolves to a commit hash representing the saved checkpoint.
   */
  saveCheckpoint(message: string): Promise<string>;

  /**
   * Restores the checkpoint to the latest commit or a specific commit hash.
   * @param commitHash - The commit hash to restore to. If not provided, restores to the latest checkpoint.
   */
  restoreCheckpoint(commitHash?: string): Promise<void>;

  readExtensionVersion(): Promise<string>;
}

export interface WebviewHostApi {
  /**
   * @param params - Existing task id or new task params.
   */
  openTask(params: TaskIdParams | NewTaskParams): void;

  openTaskList(): void;

  openSettings(): void;

  onAuthChanged(): void;

  isFocused(): Promise<boolean>;
}
