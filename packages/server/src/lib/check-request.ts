import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { User } from "../auth";
import { usageService } from "../service/usage";
import { type AvailableModelId, AvailableModels } from "./constants";

export function checkModel(modelId: string): AvailableModelId {
  const found = AvailableModels.find((model) => model.id === modelId);
  if (!found) {
    throw new HTTPException(400, {
      message: `Invalid model '${modelId}'`,
    });
  }
  return modelId as AvailableModelId;
}

export function checkWaitlist(user: User, errorMessage = "Internal user only") {
  if (!user.email.endsWith("@tabbyml.com") && !user.isWaitlistApproved) {
    throw new HTTPException(400, { message: errorMessage });
  }
  return true;
}

export async function checkUserQuota(user: User, c: Context, modelId: string) {
  // Skip quota check for test environment
  if (process.env.NODE_ENV === "test") {
    return;
  }

  // Check quota
  const quota = await usageService.readCurrentMonthQuota(user, c.req);
  const modelCostType = AvailableModels.find(
    (model) => model.id === modelId,
  )?.costType;

  if (!modelCostType) {
    throw new HTTPException(400, { message: "Invalid model" });
  }

  if (quota.limits[modelCostType] - quota.usages[modelCostType] <= 0) {
    throw new HTTPException(400, {
      message: `You have reached the quota limit for ${modelCostType}. Please upgrade your plan or try again later.`,
    });
  }
}
