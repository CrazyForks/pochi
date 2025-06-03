import type React from "react";

import type { PendingApproval } from "@/features/approval";
import { RetryApprovalButton } from "./retry-approval-button";
import {
  type AddToolResultFunctionType,
  ToolCallApprovalButton,
} from "./tool-call-approval-button";

interface ApprovalButtonProps {
  pendingApproval?: PendingApproval;
  retry: () => void;
  addToolResult?: AddToolResultFunctionType;
}

export const ApprovalButton: React.FC<ApprovalButtonProps> = ({
  pendingApproval,
  retry,
  addToolResult,
}) => {
  if (!addToolResult || !pendingApproval) return null;

  return (
    <div className="flex gap-3 [&>button]:flex-1 [&>button]:rounded-sm">
      {pendingApproval.name === "retry" ? (
        <RetryApprovalButton pendingApproval={pendingApproval} retry={retry} />
      ) : (
        <ToolCallApprovalButton
          pendingApproval={pendingApproval}
          addToolResult={addToolResult}
        />
      )}
    </div>
  );
};
