import {
  collectCustomRules,
  collectWorkflows,
  copyThirdPartyRules,
  detectThirdPartyRules,
  getSystemInfo,
  getWorkspaceRulesFileUri,
} from "@/lib/env";
import { getWorkspaceFolder, isBinaryFile, isFileExists } from "@/lib/fs";

import { getLogger } from "@/lib/logger";
// biome-ignore lint/style/useImportType: needed for dependency injection
import { PostHog } from "@/lib/posthog";
// biome-ignore lint/style/useImportType: needed for dependency injection
import { TaskRunnerManager } from "@/lib/task-runner-manager";
// biome-ignore lint/style/useImportType: needed for dependency injection
import { TokenStorage } from "@/lib/token-storage";
import { applyDiff, previewApplyDiff } from "@/tools/apply-diff";
import { executeCommand } from "@/tools/execute-command";
import { globFiles } from "@/tools/glob-files";
import { listFiles as listFilesTool } from "@/tools/list-files";
import {
  multiApplyDiff,
  previewMultiApplyDiff,
} from "@/tools/multi-apply-diff";
import { readFile } from "@/tools/read-file";
import { searchFiles } from "@/tools/search-files";
import { todoWrite } from "@/tools/todo-write";
import { previewWriteToFile, writeToFile } from "@/tools/write-to-file";
import {
  ThreadAbortSignal,
  type ThreadAbortSignalSerialization,
} from "@quilted/threads";
import {
  ThreadSignal,
  type ThreadSignalSerialization,
} from "@quilted/threads/signals";
import {
  GitStatusReader,
  ignoreWalk,
  listWorkspaceFiles,
} from "@ragdoll/common/node";
import type { Environment } from "@ragdoll/db";
import {
  type PreviewToolFunctionType,
  ServerToolApproved,
  ServerTools,
  type ToolFunctionType,
} from "@ragdoll/tools";
import type {
  CaptureEvent,
  McpStatus,
  ResourceURI,
  SessionState,
  TaskRunnerState,
  VSCodeHostApi,
} from "@ragdoll/vscode-webui-bridge";
import type { Tool } from "ai";
import * as runExclusive from "run-exclusive";
import { injectable, singleton } from "tsyringe";
import * as vscode from "vscode";
// biome-ignore lint/style/useImportType: needed for dependency injection
import { type FileSelection, TabState } from "../editor/tab-state";
// biome-ignore lint/style/useImportType: needed for dependency injection
import { McpHub } from "../mcp/mcp-hub";
import { isExecutable } from "../mcp/types";

const logger = getLogger("VSCodeHostImpl");

@injectable()
@singleton()
export class VSCodeHostImpl implements VSCodeHostApi, vscode.Disposable {
  private toolCallGroup = runExclusive.createGroupRef();
  private sessionState: SessionState = {};
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly tokenStorage: TokenStorage,
    private readonly tabState: TabState,
    private readonly posthog: PostHog,
    private readonly mcpHub: McpHub,
    private readonly taskRunnerManager: TaskRunnerManager,
  ) {}

  listWorkflowsInWorkspace = (): Promise<
    { id: string; path: string; content: string }[]
  > => {
    return collectWorkflows();
  };

  readResourceURI = (): Promise<ResourceURI> => {
    throw new Error("Method not implemented.");
  };

  readToken = async (): Promise<
    ThreadSignalSerialization<string | undefined>
  > => {
    return ThreadSignal.serialize(this.tokenStorage.token, {
      writable: true,
    });
  };

  getSessionState = async <K extends keyof SessionState>(
    keys?: K[] | undefined,
  ): Promise<Pick<SessionState, K>> => {
    if (!keys || keys.length === 0) {
      return { ...this.sessionState };
    }

    return keys.reduce<Pick<SessionState, K>>(
      (filtered, key) => {
        if (Object.prototype.hasOwnProperty.call(this.sessionState, key)) {
          filtered[key] = this.sessionState[key];
        }
        return filtered;
      },
      {} as Pick<SessionState, K>,
    );
  };

  setSessionState = async (state: Partial<SessionState>): Promise<void> => {
    Object.assign(this.sessionState, state);
  };

  readEnvironment = async (): Promise<Environment> => {
    const workspaceFolders = vscode.workspace.workspaceFolders;

    const { files, isTruncated } = workspaceFolders?.length
      ? await listWorkspaceFiles({
          cwd: workspaceFolders[0].uri.fsPath,
          recursive: true,
          maxItems: 500,
        })
      : { files: [], isTruncated: false };

    const customRules = await collectCustomRules();

    const systemInfo = getSystemInfo();

    const gitStatusReader = new GitStatusReader({
      cwd: getWorkspaceFolder().uri.fsPath,
    });
    const gitStatus = await gitStatusReader.readGitStatus();

    const environment: Environment = {
      currentTime: new Date().toString(),
      workspace: {
        files,
        isTruncated,
        gitStatus,
        activeTabs: this.tabState.activeTabs.value.map((tab) => tab.filepath),
        activeSelection: this.tabState.activeSelection.value,
      },
      info: {
        ...systemInfo,
        customRules,
      },
    };

    return environment;
  };

  readActiveTabs = async (): Promise<
    ThreadSignalSerialization<Array<{ filepath: string; isDir: boolean }>>
  > => {
    return ThreadSignal.serialize(this.tabState.activeTabs);
  };

  readActiveSelection = async (): Promise<
    ThreadSignalSerialization<FileSelection | undefined>
  > => {
    return ThreadSignal.serialize(this.tabState.activeSelection);
  };

  readCurrentWorkspace = async (): Promise<string | undefined> => {
    return vscode.workspace.workspaceFolders?.[0].uri.fsPath;
  };

  listFilesInWorkspace = async (): Promise<
    {
      filepath: string;
      isDir: boolean;
    }[]
  > => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length || !workspaceFolders[0]) {
      return [];
    }

    const results = await ignoreWalk({
      dir: workspaceFolders[0].uri.fsPath,
      recursive: true,
    });
    return results.map((item) => ({
      filepath: vscode.workspace.asRelativePath(item.filepath),
      isDir: item.isDir,
    }));
  };

  executeToolCall = runExclusive.build(
    this.toolCallGroup,
    async (
      toolName: string,
      args: unknown,
      options: {
        toolCallId: string;
        abortSignal: ThreadAbortSignalSerialization;
      },
    ) => {
      if (toolName in ServerTools) {
        return ServerToolApproved;
      }

      let tool: ToolFunctionType<Tool> | undefined;

      if (toolName in ToolMap) {
        tool = ToolMap[toolName];
      } else if (toolName in this.mcpHub.status.value.toolset) {
        const mcpTool = this.mcpHub.status.value.toolset[toolName];
        if (isExecutable(mcpTool)) {
          tool = (args, options) => {
            return mcpTool.execute(args, options);
          };
        }
      }

      if (!tool) {
        return {
          error: `Tool ${toolName} not found.`,
        };
      }

      const abortSignal = new ThreadAbortSignal(options.abortSignal);
      const toolCallStart = Date.now();
      const result = await safeCall(
        tool(args, {
          abortSignal,
          messages: [],
          toolCallId: options.toolCallId,
        }),
      );

      this.capture({
        event: "executeToolCall",
        properties: {
          toolName,
          durationMs: Date.now() - toolCallStart,
          status: abortSignal.aborted
            ? "aborted"
            : result.error
              ? "error"
              : "success",
        },
      });

      return result;
    },
  );

  previewToolCall = runExclusive.build(
    this.toolCallGroup,
    async (
      toolName: string,
      args: unknown,
      options: {
        toolCallId: string;
        state: "partial-call" | "call" | "result";
        abortSignal?: ThreadAbortSignalSerialization;
      },
    ) => {
      const tool = ToolPreviewMap[toolName];
      if (!tool) {
        return;
      }

      if (options.state === "call") {
        logger.debug(
          `previewToolCall(call): ${toolName}(${options.toolCallId})`,
        );
      }

      const abortSignal = options.abortSignal
        ? new ThreadAbortSignal(options.abortSignal)
        : undefined;

      return await safeCall<undefined>(
        // biome-ignore lint/suspicious/noExplicitAny: external call without type information
        tool(args as any, {
          ...options,
          abortSignal,
        }),
      );
    },
  );

  openFile = async (
    filePath: string,
    options?: { start?: number; end?: number; preserveFocus?: boolean },
  ) => {
    const current = vscode.workspace.workspaceFolders?.[0].uri;
    if (!current) {
      throw new Error("No workspace folder found.");
    }
    const fileUri = vscode.Uri.joinPath(current, filePath);
    try {
      const stat = await vscode.workspace.fs.stat(fileUri);
      if (stat.type === vscode.FileType.Directory) {
        // reveal and expand it
        await vscode.commands.executeCommand("revealInExplorer", fileUri);
        await vscode.commands.executeCommand("list.expand");
        return;
      }
    } catch (error) {
      logger.error(`Failed to reveal folder in explorer: ${error}`);
    }

    const isBinary = await isBinaryFile(fileUri);
    if (isBinary) {
      await vscode.commands.executeCommand("vscode.open", fileUri);
    } else {
      const start = options?.start ?? 1;
      const end = options?.end ?? start;
      vscode.window.showTextDocument(fileUri, {
        selection: new vscode.Range(start - 1, 0, end - 1, 0),
        preserveFocus: options?.preserveFocus,
      });
    }
  };

  capture = async ({ event, properties }: CaptureEvent) => {
    this.posthog.capture(event, properties);
  };

  closeCurrentWorkspace = async () => {
    await vscode.commands.executeCommand("workbench.action.closeWindow");
  };

  readMcpStatus = async (): Promise<ThreadSignalSerialization<McpStatus>> => {
    return ThreadSignal.serialize(this.mcpHub.status);
  };

  fetchThirdPartyRules = async () => {
    const rulePaths = await detectThirdPartyRules();
    const workspaceRuleExists = await isFileExists(getWorkspaceRulesFileUri());
    const copyRules = async () => {
      await copyThirdPartyRules();
      await vscode.commands.executeCommand("ragdoll.editWorkspaceRules");
    };
    return { rulePaths, workspaceRuleExists, copyRules };
  };

  async openExternal(uri: string): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.parse(uri));
  }

  runTask = async (uid: string) => {
    this.taskRunnerManager.runTask(uid);
  };

  readTaskRunners = async (): Promise<
    ThreadSignalSerialization<Record<string, TaskRunnerState>>
  > => {
    return ThreadSignal.serialize(this.taskRunnerManager.status);
  };

  dispose() {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}

function safeCall<T>(x: Promise<T>) {
  return x.catch((e) => {
    return {
      error: e.message as string,
    };
  });
}

const ToolMap: Record<
  string,
  // biome-ignore lint/suspicious/noExplicitAny: external call without type information
  ToolFunctionType<any>
> = {
  readFile,
  executeCommand,
  searchFiles,
  listFiles: listFilesTool,
  globFiles,
  writeToFile,
  applyDiff,
  todoWrite,
  multiApplyDiff,
};

const ToolPreviewMap: Record<
  string,
  // biome-ignore lint/suspicious/noExplicitAny: external call without type information
  PreviewToolFunctionType<any>
> = {
  writeToFile: previewWriteToFile,
  applyDiff: previewApplyDiff,
  multiApplyDiff: previewMultiApplyDiff,
};
