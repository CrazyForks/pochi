import { MessageMarkdown } from "@/components/message";
import type { ClientToolsType } from "@ragdoll/tools";
import { Check } from "lucide-react";
import type { ToolProps } from "../types";

export const AttemptCompletionTool: React.FC<
  ToolProps<ClientToolsType["attemptCompletion"]>
> = ({ tool: toolCall }) => {
  const { result = "", command = "" } = toolCall.args || {};

  let markdown = result;
  if (command) {
    markdown += `\n\n**${command}**`;
  }

  // Return null if there's nothing to display
  if (!result) {
    return null;
  }

  return (
    <div className="flex flex-col">
      <span className="flex items-center gap-2 font-bold text-emerald-700 text-sm dark:text-emerald-300">
        <Check className="size-4" />
        Task Completed
      </span>
      <MessageMarkdown>{markdown}</MessageMarkdown>
    </div>
  );
};
