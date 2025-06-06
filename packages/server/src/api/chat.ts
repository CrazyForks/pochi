import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { zValidator } from "@hono/zod-validator";
import { Laminar, getTracer } from "@lmnr-ai/lmnr";
import {
  type Environment,
  appendDataPart,
  formatters,
  prompts,
} from "@ragdoll/common";
import type { DB } from "@ragdoll/db";
import {
  ClientTools,
  parseMcpToolSet,
  selectServerTools,
} from "@ragdoll/tools";
import {
  type CoreMessage,
  type DataStreamWriter,
  type LanguageModel,
  type UIMessage,
  appendResponseMessages,
  createDataStream,
  streamText,
} from "ai";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { stream } from "hono/streaming";
import { createResumableStreamContext } from "resumable-stream";
import { z } from "zod";
import { type User, requireAuth } from "../auth";
import {
  checkModel,
  checkUserQuota,
  checkWaitlist,
} from "../lib/check-request";
import { resolveServerTools } from "../lib/tools";
import { after, setIdleTimeout } from "../server";
import { taskService } from "../service/task";
import { usageService } from "../service/usage";
import { ZodChatRequestType } from "../types";

const streamContext = createResumableStreamContext({
  waitUntil: after,
});

export type ContextVariables = {
  model?: LanguageModel;
};

const EnableInterleavedThinking = false;

const chat = new Hono<{ Variables: ContextVariables }>()
  .use(requireAuth())
  .post("/stream", zValidator("json", ZodChatRequestType), async (c) => {
    setIdleTimeout(c.req.raw, 120);

    const req = await c.req.valid("json");
    const {
      environment,
      mcpToolSet,
      model: requestedModelId = "anthropic/claude-4-sonnet",
    } = req;
    c.header("X-Vercel-AI-Data-Stream", "v1");
    c.header("Content-Type", "text/plain; charset=utf-8");

    const parsedMcpTools = parseMcpToolSet(mcpToolSet);

    const user = c.get("user");

    await checkUserQuota(user, c, requestedModelId);
    const selectedModel = checkModel(requestedModelId);

    checkWaitlist(user);

    const enabledClientTools = ClientTools;

    // Prepare the tools to be used in the streamText call
    const enabledServerTools = selectServerTools(
      ["webFetch"].concat(req.tools || []),
    );

    const { id, streamId, messages, event, uid } =
      await taskService.startStreaming(user.id, req);

    const dataStream = createDataStream({
      execute: async (stream) => {
        if (req.id === undefined) {
          appendDataPart({ type: "append-id", id, uid }, stream);
        }

        const preparedMessages = await prepareMessages(
          messages,
          environment,
          user,
          event,
          stream,
        );

        const providerOptions = req.reasoning?.enabled
          ? {
              google: {
                thinkingConfig: {
                  includeThoughts: true,
                  thinkingBudget: 1024,
                },
              } satisfies GoogleGenerativeAIProviderOptions,
              anthropic: {
                thinking: { type: "enabled", budgetTokens: 10_000 },
              } satisfies AnthropicProviderOptions,
            }
          : undefined;

        const result = Laminar.withSession(`${user.id}-${id}`, () =>
          streamText({
            abortSignal: c.req.raw.signal,
            temperature: 0.75,
            toolCallStreaming: true,
            model: c.get("model") || selectedModel,
            messages: [
              ...(environment?.info
                ? [
                    {
                      role: "system",
                      content: prompts.system(environment.info),
                      providerOptions: {
                        anthropic: { cacheControl: { type: "ephemeral" } },
                      },
                    } satisfies CoreMessage,
                  ]
                : []),
              ...formatters.llm(preparedMessages),
            ],
            tools: {
              ...enabledClientTools,
              ...enabledServerTools, // Add the enabled server tools
              ...parsedMcpTools,
            },
            providerOptions,
            onFinish: async ({
              usage,
              finishReason,
              response,
              providerMetadata,
            }) => {
              if (finishReason === "length") {
                throw new Error("The response was too long.");
              }

              const finalMessages = appendResponseMessages({
                messages: preparedMessages,
                responseMessages: response.messages,
              }) as UIMessage[];
              if (providerMetadata?.anthropic) {
                const { cacheReadInputTokens } = providerMetadata.anthropic;
                if (typeof cacheReadInputTokens === "number") {
                  usage = {
                    promptTokens: cacheReadInputTokens + usage.promptTokens,
                    completionTokens: usage.completionTokens,
                    totalTokens: cacheReadInputTokens + usage.totalTokens,
                  };
                }
              }

              const isUsageValid = !Number.isNaN(usage.totalTokens);

              await taskService.finishStreaming(
                id,
                user.id,
                finalMessages,
                finishReason,
                isUsageValid ? usage.totalTokens : undefined,
              );

              if (isUsageValid) {
                await usageService.trackUsage(user, requestedModelId, usage);

                appendDataPart(
                  {
                    type: "update-usage",
                    ...usage,
                  },
                  stream,
                );
              }
            },
            headers:
              requestedModelId.includes("claude-4") && EnableInterleavedThinking
                ? {
                    "anthropic-beta": "interleaved-thinking-2025-05-14",
                  }
                : undefined,
            experimental_telemetry: {
              isEnabled: true,
              tracer: getTracer(),
              metadata: {
                "user-id": user.id,
                "user-email": user.email,
                "task-id": id,
              },
            },
            // Disallowing the model to repeat the environment details from our injection.
            // see injectEnvironmentDetails for more details.
            stopSequences: [`<${prompts.EnvironmentDetailsTag}>`],

            // Disable retries as we handle them ourselves.
            maxRetries: 0,

            // 16k tokens.
            maxTokens: 1024 * 16,
          }),
        );

        result.mergeIntoDataStream(stream, {
          sendReasoning: true,
        });
      },
      onError(error) {
        // Failed to stream the response.
        const taskError = taskService.toTaskError(error);
        taskService.failStreaming(id, user.id, taskError);

        if (taskError.kind === "APICallError") {
          console.log(
            "API call error",
            taskError.message,
            taskError.requestBodyValues,
          );
        }

        return taskError.message;
      },
    });

    const resumableStream = await streamContext.resumableStream(
      streamId,
      () => dataStream,
    );
    if (!resumableStream) {
      throw new HTTPException(500, {
        message: "Failed to create resumable stream.",
      });
    }

    return stream(c, (stream) => stream.pipe(resumableStream));
  })
  .get(
    "/stream",
    zValidator("query", z.object({ chatId: z.string() })),
    async (c) => {
      setIdleTimeout(c.req.raw, 120);

      const query = c.req.valid("query");
      const user = c.get("user");
      const id = Number.parseInt(query.chatId);
      c.header("X-Vercel-AI-Data-Stream", "v1");
      c.header("Content-Type", "text/plain; charset=utf-8");

      const streamId = await taskService.fetchLatestStreamId(id, user.id);
      if (!streamId) {
        throw new HTTPException(404, { message: "Stream not found." });
      }

      const emptyDataStream = createDataStream({
        execute: () => {},
      });

      const resumableStream = await streamContext.resumableStream(
        streamId,
        () => emptyDataStream,
      );

      if (resumableStream) {
        return stream(c, (stream) => stream.pipe(resumableStream));
      }

      const task = await taskService.get(id, user.id);
      const mostRecentMessage = task?.conversation?.messages?.at(-1);
      if (!mostRecentMessage || mostRecentMessage.role !== "assistant") {
        return stream(c, (stream) => stream.pipe(emptyDataStream));
      }

      const streamWithMessage = createDataStream({
        execute: (buffer) => {
          appendDataPart(
            {
              type: "append-message",
              message: JSON.stringify(mostRecentMessage),
            },
            buffer,
          );
        },
      });

      return stream(c, (stream) => stream.pipe(streamWithMessage));
    },
  );

async function prepareMessages(
  inputMessages: UIMessage[],
  environment: Environment | undefined,
  user: User,
  event: DB["task"]["event"],
  stream: DataStreamWriter,
): Promise<UIMessage[]> {
  let messages = await resolveServerTools(inputMessages, user, stream);
  messages = prompts.injectEnvironmentDetails(
    messages,
    environment,
    event,
    process.env.POCHI_INJECT_ENVIRONMENT_DETAILS_MODE === "assistant",
  );
  return messages;
}

export default chat;
