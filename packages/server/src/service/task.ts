import { isAbortError } from "@ai-sdk/provider-utils";
import type { Environment, TaskError, UserEvent } from "@ragdoll/common";
import type { Todo } from "@ragdoll/common";
import { fromUIMessages, toUIMessage, toUIMessages } from "@ragdoll/common";
import { formatters } from "@ragdoll/common";
import type { DBMessage } from "@ragdoll/common";
import { parseTitle } from "@ragdoll/common/message-utils";
import type { DB } from "@ragdoll/db";
import { isUserInputTool } from "@ragdoll/tools";
import {
  APICallError,
  type FinishReason,
  InvalidToolArgumentsError,
  type Message,
  NoSuchToolError,
  type UIMessage,
  appendClientMessage,
  generateId,
} from "ai";
import { HTTPException } from "hono/http-exception";
import { sql } from "kysely";
import Sqids from "sqids";
import type { z } from "zod";
import { db } from "../db";
import { applyEventFilter } from "../lib/event-filter";
import { publishTaskEvent } from "../server";
import type { ZodChatRequestType } from "../types";
import { slackService } from "./slack";

const titleSelect =
  sql<string>`(conversation #>> '{messages, 0, parts, 0, text}')::text`.as(
    "title",
  );

const { uidEncode, uidDecode } = (() => {
  const alphabet =
    "RBgHuE5stw6UbcCoZJiamLkyYnqV1xSO8efMhzXK3vI9F27WPrd0jA4lGTNpQD";
  const coder = new Sqids({ minLength: 8, alphabet });
  return {
    uidEncode: (id: number) => coder.encode([id]),
    uidDecode: (id: string) => coder.decode(id)[0],
  };
})();

class StreamingTask {
  constructor(
    readonly streamId: string,
    readonly userId: string,
    readonly taskId: number,
  ) {}

  get key() {
    return StreamingTask.key(this.userId, this.taskId);
  }

  static key(userId: string, taskId: number) {
    return `${userId}:${taskId}`;
  }
}

class TaskService {
  private streamingTasks = new Map<string, StreamingTask>();

  async startStreaming(
    userId: string,
    request: z.infer<typeof ZodChatRequestType>,
  ) {
    const streamId = generateId();
    const { id, conversation, event } = await this.prepareTask(userId, request);
    const streamingTask = new StreamingTask(streamId, userId, id);
    this.streamingTasks.set(streamingTask.key, streamingTask);

    const messages = appendClientMessage({
      messages: toUIMessages(conversation?.messages || []),
      message: toUIMessage(request.message),
    }) as UIMessage[];

    const messagesToSave = formatters.storage(messages);

    await db
      .updateTable("task")
      .set({
        status: "streaming",
        conversation: {
          messages: fromUIMessages(messagesToSave),
        },
        environment: request.environment,
        streamIds: sql<
          string[]
        >`COALESCE("streamIds", '{}') || ARRAY[${streamId}]`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where("taskId", "=", id)
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow();

    publishTaskEvent(userId, {
      type: "task:status-changed",
      data: {
        taskId: id,
        status: "streaming",
      },
    });

    return {
      id,
      streamId,
      event,
      messages,
    };
  }

  async finishStreaming(
    taskId: number,
    userId: string,
    messages: UIMessage[],
    finishReason: FinishReason,
    totalTokens: number | undefined,
    notify: boolean,
  ) {
    const status = getTaskStatus(messages, finishReason);
    const messagesToSave = formatters.storage(messages);
    await db
      .updateTable("task")
      .set({
        status,
        conversation: {
          messages: fromUIMessages(messagesToSave),
        },
        totalTokens,
        updatedAt: sql`CURRENT_TIMESTAMP`,
        // Clear error on successful completion
        error: null,
      })
      .where("taskId", "=", taskId)
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow();

    publishTaskEvent(userId, {
      type: "task:status-changed",
      data: {
        taskId,
        status: status,
      },
    });

    this.streamingTasks.delete(StreamingTask.key(userId, taskId));

    if (notify) {
      this.sendTaskCompletionNotification(userId, taskId, status);
    }
  }

  async failStreaming(taskId: number, userId: string, error: TaskError) {
    await db
      .updateTable("task")
      .set({
        status: "failed",
        updatedAt: sql`CURRENT_TIMESTAMP`,
        error,
      })
      .where("taskId", "=", taskId)
      .where("userId", "=", userId)
      .execute();

    publishTaskEvent(userId, {
      type: "task:status-changed",
      data: {
        taskId,
        status: "failed",
      },
    });

    this.streamingTasks.delete(StreamingTask.key(userId, taskId));
  }

  private async sendTaskCompletionNotification(
    userId: string,
    taskId: number,
    status: DB["task"]["status"]["__select__"],
  ) {
    if (status === "pending-tool") {
      return;
    }

    try {
      const slackIntegration = await slackService.getIntegration(userId);
      if (slackIntegration) {
        const { webClient, slackUserId } = slackIntegration;
        // Open a conversation with the user
        const openConversation = await webClient.conversations.open({
          users: slackUserId,
        });

        if (openConversation.ok && openConversation.channel?.id) {
          const channelId = openConversation.channel.id;
          await webClient.chat.postMessage({
            channel: channelId,
            text: `Task ${taskId} finished with status: ${status}`,
          });
        } else {
          console.error(
            `Failed to open conversation with user ${slackUserId}: ${openConversation.error}`,
          );
        }
      } else {
        console.warn(`Slack client not found for user ${userId}`);
      }
    } catch (error) {
      console.error(
        `Error sending Slack notification for task ${taskId}:`,
        error,
      );
    }
  }

  private async prepareTask(
    userId: string,
    request: z.infer<typeof ZodChatRequestType>,
  ) {
    const { id: chatId, event, environment } = request;
    let taskId = chatId ? Number.parseInt(chatId) : undefined;
    if (taskId === undefined) {
      taskId = await this.create(userId, event);
    }

    const data = await db
      .selectFrom("task")
      .select(["conversation", "event", "environment", "status"])
      .where("taskId", "=", taskId)
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow();

    this.verifyEnvironment(environment, data.environment);

    if (data.status === "streaming") {
      throw new HTTPException(409, {
        message: "Task is already streaming",
      });
    }

    return {
      ...data,
      environment: undefined,
      status: undefined,
      id: taskId,
    };
  }

  private async create(userId: string, event: UserEvent | null = null) {
    return await this.createTaskImpl(userId, {
      event,
    });
  }

  async createWithUserMessage(
    userId: string,
    prompt: string,
    event?: UserEvent,
  ): Promise<number> {
    const message: DBMessage = {
      id: generateId(),
      createdAt: new Date().toISOString(),
      role: "user",
      parts: [
        {
          type: "text",
          text: prompt,
        },
      ],
    };

    return await this.createTaskImpl(userId, {
      event: event || null,
      conversation: {
        messages: [message],
      },
      status: "pending-model",
    });
  }

  private async createTaskImpl(
    userId: string,
    taskData: Partial<{
      event: UserEvent | null;
      conversation: { messages: DBMessage[] } | null;
      status: DB["task"]["status"]["__insert__"];
    }>,
  ): Promise<number> {
    const { taskId } = await db.transaction().execute(async (trx) => {
      const { nextTaskId } = await trx
        .insertInto("taskSequence")
        .values({ userId })
        .onConflict((oc) =>
          oc.column("userId").doUpdateSet({
            nextTaskId: sql`\"taskSequence\".\"nextTaskId\" + 1`,
          }),
        )
        .returning("nextTaskId")
        .executeTakeFirstOrThrow();

      return await trx
        .insertInto("task")
        .values({
          userId,
          taskId: nextTaskId,
          ...taskData,
        })
        .returning("taskId")
        .executeTakeFirstOrThrow();
    });
    return taskId;
  }

  private verifyEnvironment(
    environment: Environment | undefined,
    expectedEnvironment: Environment | null,
  ) {
    if (expectedEnvironment === null) return;
    if (environment === undefined) {
      return;
    }

    if (environment.info.os !== expectedEnvironment.info.os) {
      throw new HTTPException(400, {
        message: "Environment OS mismatch",
      });
    }

    if (environment.info.cwd !== expectedEnvironment.info.cwd) {
      throw new HTTPException(400, {
        message: "Environment CWD mismatch",
      });
    }
  }

  async list(
    userId: string,
    page: number,
    limit: number,
    cwd?: string,
    eventFilter?: Record<string, unknown>,
  ) {
    const offset = (page - 1) * limit;

    let totalCountQuery = db
      .selectFrom("task")
      .where("userId", "=", userId)
      .select(db.fn.count("id").as("count"));

    if (cwd) {
      totalCountQuery = totalCountQuery.where(
        sql`environment->'info'->'cwd'`,
        "@>",
        `"${cwd}"`,
      );
    }

    totalCountQuery = applyEventFilter(totalCountQuery, eventFilter);

    const totalCountResult = await totalCountQuery.executeTakeFirst();
    const totalCount = Number(totalCountResult?.count ?? 0);
    const totalPages = Math.ceil(totalCount / limit);

    let query = db
      .selectFrom("task")
      .where("userId", "=", userId)
      .select([
        "id",
        "taskId",
        "createdAt",
        "updatedAt",
        "status",
        "totalTokens",
        "event",
        titleSelect,
        gitSelect,
      ])
      .orderBy("taskId", "desc")
      .limit(limit)
      .offset(offset);

    if (cwd) {
      query = query.where(sql`environment->'info'->'cwd'`, "@>", `"${cwd}"`);
    }

    query = applyEventFilter(query, eventFilter);

    const items = await query.execute();
    const data = items.map((task) => ({
      ...task,
      uid: uidEncode(task.id), // Map id to uid
      id: task.taskId, // Map taskId to id
      title: parseTitle(task.title),
      totalTokens: task.totalTokens || undefined,
      taskId: undefined,
      // Ensure all selected fields are correctly mapped if names differ
    }));

    return {
      data,
      pagination: {
        totalCount,
        limit,
        currentPage: page,
        totalPages,
      },
    };
  }

  async get(id: number | string, userId: string) {
    let taskQuery = db
      .selectFrom("task")
      .where("userId", "=", userId)
      .select([
        "id",
        "taskId",
        "createdAt",
        "updatedAt",
        "conversation",
        "totalTokens",
        "event",
        "status",
        "error",
        "isPublicShared",
        titleSelect,
        gitSelect,
        sql<Todo[] | null>`environment->'todos'`.as("todos"),
      ]);

    if (typeof id === "string") {
      taskQuery = taskQuery.where("id", "=", uidDecode(id));
    } else {
      taskQuery = taskQuery.where("taskId", "=", id);
    }

    const task = await taskQuery.executeTakeFirst();

    if (!task) {
      return null; // Return null if task not found, let the API layer handle 404
    }

    return {
      ...task,
      uid: uidEncode(task.id), // Map id to uid
      id: task.taskId, // Map taskId to id
      taskId: undefined,
      totalTokens: task.totalTokens || undefined,
      todos: task.todos || undefined,
      title: parseTitle(task.title),
    };
  }

  async getPublic(uid: string) {
    const taskQuery = db
      .selectFrom("task")
      .innerJoin("user", "task.userId", "user.id")
      .where("task.id", "=", uidDecode(uid))
      .where("task.isPublicShared", "=", true)
      .select([
        "task.createdAt",
        "task.updatedAt",
        "task.conversation",
        "task.totalTokens",
        "task.status",
        "user.name as userName",
        "user.image as userImage",
        titleSelect,
        gitSelect,
        sql<Todo[] | null>`task.environment->'todos'`.as("todos"),
      ]);

    const task = await taskQuery.executeTakeFirst();

    if (!task) {
      return null;
    }

    return {
      ...task,
      user: {
        name: task.userName,
        image: task.userImage,
      },
      userName: undefined,
      userImage: undefined,
      uid,
      totalTokens: task.totalTokens || undefined,
      todos: task.todos || undefined,
      title: parseTitle(task.title),
    };
  }

  async updateIsPublicShared(
    taskId: number,
    userId: string,
    isPublicShared: boolean,
  ): Promise<boolean> {
    const result = await db
      .updateTable("task")
      .set({
        isPublicShared,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where("taskId", "=", taskId)
      .where("userId", "=", userId)
      .executeTakeFirst();

    return result.numUpdatedRows > 0;
  }

  async delete(taskId: number, userId: string): Promise<boolean> {
    const task = await db
      .selectFrom("task")
      .where("taskId", "=", taskId)
      .where("userId", "=", userId)
      .select("taskId") // Select minimal data for existence check
      .executeTakeFirst();

    if (!task) {
      return false; // Task not found
    }

    const result = await db
      .deleteFrom("task")
      .where("taskId", "=", taskId)
      .where("userId", "=", userId)
      .executeTakeFirst(); // Use executeTakeFirst for delete to get affected rows count

    return result.numDeletedRows > 0; // Return true if deletion was successful
  }

  async fetchLatestStreamId(
    taskId: number,
    userId: string,
  ): Promise<string | null> {
    const result = await db
      .selectFrom("task")
      .select(
        sql<string>`("streamIds")[array_upper("streamIds", 1)]`.as(
          "latestStreamId",
        ),
      )
      .where("taskId", "=", taskId)
      .where("userId", "=", userId)
      .executeTakeFirst();

    return result?.latestStreamId ?? null;
  }

  async gracefulShutdown() {
    const streamingTasksToFail = Array.from(this.streamingTasks.values());
    const numTasksToFail = streamingTasksToFail.length;
    console.info(
      `Process exiting, cleaning up ${numTasksToFail} streaming tasks`,
    );
    if (numTasksToFail === 0) return;
    this.streamingTasks.clear();

    const promises = [];
    for (const task of streamingTasksToFail) {
      promises.push(
        this.failStreaming(task.taskId, task.userId, {
          kind: "AbortError",
          message: "Server is shutting down, task was aborted",
        }),
      );
    }

    await Promise.all(promises);
  }

  toTaskError(error: unknown): TaskError {
    if (APICallError.isInstance(error)) {
      return {
        kind: "APICallError",
        message: error.message,
        requestBodyValues: error.requestBodyValues,
      };
    }

    const internalError = (message: string): TaskError => {
      return {
        kind: "InternalError",
        message,
      };
    };

    if (InvalidToolArgumentsError.isInstance(error)) {
      return internalError(
        `Invalid arguments provided to tool "${error.toolName}". Please try again.`,
      );
    }

    if (NoSuchToolError.isInstance(error)) {
      return internalError(`${error.toolName} is not a valid tool.`);
    }

    if (isAbortError(error)) {
      return {
        kind: "AbortError",
        message: error.message,
      };
    }

    if (!(error instanceof Error)) {
      console.error("Unknown error", error);
      return internalError("Something went wrong. Please try again.");
    }

    return internalError(error.message);
  }
}

export const taskService = new TaskService();

export function getTaskStatus(
  messages: Message[],
  finishReason: FinishReason,
): DB["task"]["status"]["__select__"] {
  const lastMessage = messages[messages.length - 1];

  if (finishReason === "tool-calls") {
    if (hasAttemptCompletion(lastMessage)) {
      return "completed";
    }
    if (hasUserInputTool(lastMessage)) {
      return "pending-input";
    }
    return "pending-tool";
  }

  if (finishReason === "stop") {
    return "pending-input";
  }

  return "failed";
}

function hasAttemptCompletion(message: Message): boolean {
  if (message.role !== "assistant") {
    return false;
  }

  return !!message.parts?.some(
    (part) =>
      part.type === "tool-invocation" &&
      part.toolInvocation.toolName === "attemptCompletion",
  );
}

function hasUserInputTool(message: Message): boolean {
  if (message.role !== "assistant") {
    return false;
  }

  return !!message.parts?.some(
    (part) =>
      part.type === "tool-invocation" &&
      isUserInputTool(part.toolInvocation.toolName),
  );
}

// Build git object with origin and branch from environment
const gitSelect = sql<{ origin: string; branch: string } | null>`
  CASE 
    WHEN environment #>> '{workspace,gitStatus,origin}' IS NULL THEN NULL
    ELSE json_build_object(
      'origin', environment #>> '{workspace,gitStatus,origin}',
      'branch', environment #>> '{workspace,gitStatus,currentBranch}'
    )
  END
`.as("git");
