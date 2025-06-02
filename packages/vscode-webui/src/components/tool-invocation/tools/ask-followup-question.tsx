import { useToolEvents } from "@/features/chat";
import type { ClientToolsType } from "@ragdoll/tools";
import type { ToolProps } from "../types";

export const AskFollowupQuestionTool: React.FC<
  ToolProps<ClientToolsType["askFollowupQuestion"]>
> = ({ tool: toolCall, isLoading }) => {
  const { emit } = useToolEvents();
  const { question, followUp } = toolCall.args || {};

  return (
    <div className="flex flex-col gap-2">
      <p className="items-center font-medium italic">{question}</p>
      {followUp &&
        followUp.length > 0 && ( // Check if followUp exists and has items
          <ol className="flex list-decimal flex-col gap-1 pl-8">
            {followUp.map((followUpText, index) => (
              <li
                key={index}
                className={`cursor-pointer text-muted-foreground ${
                  isLoading
                    ? "pointer-events-none opacity-50"
                    : "hover:text-foreground"
                }`}
              >
                <button
                  type="button"
                  className="inline-flex text-left"
                  disabled={isLoading}
                  onClick={() =>
                    !isLoading &&
                    emit("sendMessage", {
                      prompt: followUpText,
                    })
                  }
                >
                  {followUpText}
                </button>
              </li>
            ))}
          </ol>
        )}
    </div>
  );
};
