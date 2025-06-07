import { useToolCallLifeCycle } from "@/features/chat";
import type { ClientToolsType } from "@ragdoll/tools";
import { useCallback } from "react";
import { FileBadge } from "../file-badge";
import { NewProblems, NewProblemsIcon } from "../new-problems";
import { StatusIcon } from "../status-icon";
import { ExpandableToolContainer } from "../tool-container";
import type { ToolProps } from "../types";
import { UserEdits } from "../user-edits";

export const multiApplyDiffTool: React.FC<
  ToolProps<ClientToolsType["multiApplyDiff"]>
> = ({ tool, isExecuting }) => {
  const { path } = tool.args || {};

  const lifecycle = useToolCallLifeCycle().getToolCallLifeCycle(
    tool.toolName,
    tool.toolCallId,
  );
  const handleClick = useCallback(() => {
    lifecycle.preview(tool.args, tool.state);
  }, [tool, lifecycle]);

  const result =
    tool.state === "result" && !("error" in tool.result)
      ? tool.result
      : undefined;

  const title = (
    <>
      <StatusIcon isExecuting={isExecuting} tool={tool} />
      <span className="ml-2" />
      {"Applying diffs to "}
      {path && (
        <FileBadge
          className="ml-1"
          path={path}
          onClick={tool.state !== "result" ? handleClick : undefined}
        />
      )}
    </>
  );

  const detials = [];
  if (result?.newProblems) {
    detials.push(
      <NewProblems key="new-problems" newProblems={result?.newProblems} />,
    );
  }

  if (result?.userEdits) {
    detials.push(<UserEdits key="user-edits" userEdits={result?.userEdits} />);
  }

  const detail = detials.length > 0 ? <>{detials}</> : undefined;

  return (
    <ExpandableToolContainer
      title={title}
      expandableDetail={detail}
      expandableDetailIcon={result?.newProblems && <NewProblemsIcon />}
    />
  );
};
