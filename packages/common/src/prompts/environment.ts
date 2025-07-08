import type { TextUIPart, UIMessage } from "@ai-sdk/ui-utils";
import type { Environment, GitStatus } from "@ragdoll/db";

export function getReadEnvironmentResult(environment: Environment) {
  const sections = [
    getCurrentTime(environment.currentTime),
    getWorkspaceFiles(environment.workspace, environment.info),
    getCurrentOpenedFiles(environment.workspace),
    getVisibleTerminals(environment.workspace),
    getCurrentWorkingFile(environment.workspace),
    getGitStatus(environment.workspace.gitStatus),
    getTodos(environment.todos),
  ]
    .filter(Boolean)
    .join("\n\n");
  return sections;
}

function getCurrentTime(currentTime: string) {
  if (currentTime) {
    return `# Current Time\n${currentTime}`;
  }
  return "";
}

function getWorkspaceFiles(
  workspace: Environment["workspace"],
  info: Environment["info"],
) {
  const { files, isTruncated } = workspace;
  const filesList = files.join("\n");
  const truncatedMessage = isTruncated
    ? "\n(Note: The list of files is truncated. Use listFiles tool to explore if needed)"
    : "";
  return `# Current Working Directory (${info.cwd}) Files\n${filesList}${truncatedMessage}`;
}

function getCurrentOpenedFiles(workspace: Environment["workspace"]) {
  const openFiles = workspace.activeTabs ?? [];
  if (openFiles.length === 0) {
    return "";
  }
  return `# Active File Tabs in Editor\n${openFiles.join("\n")}`;
}

function getVisibleTerminals(workspace: Environment["workspace"]) {
  const terminals = workspace.terminals ?? [];
  if (terminals.length === 0) {
    return "";
  }
  return `# Active Terminals in Editor\n${terminals
    .map((t) => (t.isActive ? `* ${t.name} (active)` : `  ${t.name}`))
    .join("\n")}`;
}

function getCurrentWorkingFile(workspace: Environment["workspace"]) {
  const selection = workspace.activeSelection;
  if (!selection) {
    return "";
  }
  const { filepath, range, content } = selection;
  if (!content || content.trim() === "") {
    return "";
  }
  return `# Active Selection (${filepath}:${range.start.line + 1}-${range.end.line + 1})\n\n\`\`\`\n${content}\n\`\`\`\n`;
}

function getGitStatus(gitStatus: GitStatus | undefined) {
  if (!gitStatus) return "# GIT STATUS\nThis workspace is not managed by git";

  const { currentBranch, mainBranch, status, recentCommits } = gitStatus;

  let result = "# GIT STATUS\n";

  if (gitStatus.origin) {
    result += `Origin: ${gitStatus.origin}\n`;
  }
  result += `Current branch: ${currentBranch}\n`;
  result += `Main branch (you will usually use this for PRs): ${mainBranch}\n\n`;

  if (status) {
    result += `Status:\n${status}\n\n`;
  }

  if (recentCommits.length > 0) {
    result += `Recent commits:\n${recentCommits.join("\n")}`;
  }

  return result;
}

export function stripEnvironmentDetails(messages: UIMessage[]) {
  for (const message of messages) {
    message.parts = message.parts.filter((part) => {
      if (part.type !== "text") return true;
      return !part.text.startsWith(`<${EnvironmentDetailsTag}>`);
    });
  }
  return messages;
}

function getInjectMessage(
  messages: UIMessage[],
  injectInAssistantMessage: boolean,
) {
  const lastMessage = messages.at(-1);
  if (!lastMessage) return;
  if (lastMessage.role === "user") return lastMessage;
  if (lastMessage.role === "assistant") {
    if (injectInAssistantMessage) {
      return lastMessage;
    }

    return getInjectMessage(messages.slice(0, -1), injectInAssistantMessage);
  }
}

/**
 * Injects environment details into the messages.
 *
 * @param messages - The array of UI messages.
 * @param environment - The environment object containing workspace and todos.
 * @param event - The user event that triggered this task.
 * @param injectInAssistantMessage - By default, we inject the environment details in the user message. If this is true, we inject it in both the user and the assistant message.
 * @returns The updated array of UI messages with injected environment details.
 */
export function injectEnvironmentDetails(
  messages: UIMessage[],
  environment: Environment | undefined,
  injectInAssistantMessage: boolean,
) {
  if (environment === undefined) return messages;
  const messageToInject = getInjectMessage(messages, injectInAssistantMessage);
  if (!messageToInject) return messages;

  const textPart = {
    type: "text",
    text: `<${EnvironmentDetailsTag}>\n${getReadEnvironmentResult(environment)}\n</${EnvironmentDetailsTag}>`,
  } satisfies TextUIPart;

  const parts = messageToInject.parts || [];

  if (messageToInject.role === "user") {
    messageToInject.parts = [textPart, ...parts];
  }

  if (messageToInject.role === "assistant") {
    const lastStepStartIndex = parts.reduce((lastIndex, part, index) => {
      return part.type === "step-start" ? index : lastIndex;
    }, -1);

    const insertIndex =
      parts[lastStepStartIndex + 1].type === "reasoning"
        ? lastStepStartIndex + 2
        : lastStepStartIndex + 1;

    // insert textPart after stepStart
    if (lastStepStartIndex !== -1) {
      parts.splice(insertIndex, 0, textPart);
    } else {
      parts.unshift(textPart);
    }
  }

  return messages;
}

function getTodos(todos: Environment["todos"]) {
  if (todos === undefined || todos.length === 0) {
    return "# TODOs\nNo TODOs yet, if you are working on tasks that would benefit from a todo list please use the todoWrite tool to create one.";
  }

  return `# TODOs
Here's todo list for current task. If a task is marked as cancelled or completed, it no longer needs your attention, NEVER ATTEMPT TO COMPLETE IT AGAIN, this is SUPER IMPORTANT!!!.
Otherwise, please follow the todo list to complete the task.

${JSON.stringify(todos, null, 2)}`;
}

export const EnvironmentDetailsTag = "environment-details";
