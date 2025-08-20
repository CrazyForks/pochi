import type { UIMessage } from "ai";
import { z } from "zod";
import type { Todo } from "./todo-write";
import { defineClientTool } from "./types";

export type SubTask = {
  uid: string;
  clientTaskId: string;
  messages: UIMessage[];
  todos: Todo[];
};

const toolDef = {
  description:
    `Create a task that can be executed autonomously by a runner in the same environment as the current task. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries, use the Agent tool to perform the search for you.

Note: The sub-agent operates independently and does not inherit your custom instructions or rules. Keep the task description focused on the specific objective without referencing personal preferences or custom rules.

Always include a reminder in your prompt to ensure the result will be submitted through the \`attemptCompletion\` tool.
If the runner stops without submitting the result, it will return an error message.

For example, if you are searching for a keyword or file and are not confident about finding the right match in the first few tries, use this tool to perform the search.
When to use this tool:
- If you are searching for a keyword like "config" or "logger", or for questions like "which file does X?", this tool is strongly recommended.
When NOT to use this tool:
- To read a specific file or path, use the \`readFile\` or \`globFiles\` tool instead, to find the match more quickly.
- To search for a specific class definition like "class Foo", use the \`searchFiles\` or \`globFiles\` tool instead.
- To search for code within a specific file or a small set of files (2-3), use the \`readFile\` tool instead.

Usage notes:
1. Launch multiple \`newTask\` tools concurrently whenever possible to maximize performance. To do this, use a single message with multiple tool uses.
2. You will not be able to send additional messages to the runner. Nor will the runner be able to communicate with you outside of its final report. 
  Therefore, your prompt must contain a highly detailed task description for the runner to perform autonomously. You should also specify exactly what information the runner should return back through the \`attemptCompletion\` tool.
`.trim(),
  inputSchema: z.object({
    description: z.string().describe("A short description of the task."),
    prompt: z
      .string()
      .describe("The detailed prompt for the task to be performed."),
    _meta: z
      .object({
        uid: z.string().describe("A unique identifier for the task."),
      })
      .optional(),
    _transient: z
      .object({
        task: z.custom<SubTask>().describe("The inlined subtask result."),
      })
      .optional(),
  }),
  outputSchema: z.object({
    result: z
      .string()
      .describe(
        "The result of the task, submitted through the `attemptCompletion` tool.",
      ),
  }),
};

export const newTask = defineClientTool(toolDef);
