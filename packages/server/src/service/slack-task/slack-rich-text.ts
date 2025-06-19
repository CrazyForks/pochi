import type { Todo } from "@ragdoll/db";
import type { AnyBlock } from "@slack/web-api";
import slackifyMarkdown from "slackify-markdown";

const PreparingTaskBlock = {
  type: "section",
  text: {
    type: "mrkdwn",
    text: "*🟢 Preparing* remote environment for Pochi ...",
  },
};

class SlackRichTextRenderer {
  renderTaskCreated(
    prompt: string,
    githubRepository: { owner: string; repo: string },
    slackUserId: string,
  ): AnyBlock[] {
    return [
      this.renderHeaderBlock(prompt, githubRepository, slackUserId),
      PreparingTaskBlock,
    ];
  }

  renderTaskStarting(
    prompt: string,
    githubRepository: { owner: string; repo: string },
    slackUserId: string,
    taskId: string,
    todos?: Todo[],
    requestsCount?: number,
    totalTokens?: number,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [
      this.renderHeaderBlock(prompt, githubRepository, slackUserId),
      PreparingTaskBlock,
    ];

    this.renderTodoListBlock(blocks, todos);

    this.renderFooterBlock(blocks, taskId, requestsCount, totalTokens);

    return blocks;
  }

  renderTaskRunning(
    prompt: string,
    githubRepository: { owner: string; repo: string },
    slackUserId: string,
    taskId: string,
    todos?: Todo[],
    requestsCount?: number,
    totalTokens?: number,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [
      this.renderHeaderBlock(prompt, githubRepository, slackUserId),
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*🟡 Running*",
        },
      },
    ];

    this.renderTodoListBlock(blocks, todos);

    this.renderFooterBlock(blocks, taskId, requestsCount, totalTokens);

    return blocks;
  }

  renderTaskAskFollowUpQuestion(
    prompt: string,
    githubRepository: { owner: string; repo: string },
    slackUserId: string,
    taskId: string,
    waitingReason: string,
    followUpSuggestions?: string[],
    todos?: Todo[],
    requestsCount?: number,
    totalTokens?: number,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [
      this.renderHeaderBlock(prompt, githubRepository, slackUserId),
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*🤔️ I need some help to proceed*\n\n${slackifyMarkdown(waitingReason)}`,
        },
      },
    ];

    this.renderFollowUpSuggestionsBlock(blocks, followUpSuggestions);

    this.renderTodoListBlock(blocks, todos);

    this.renderFooterBlock(blocks, taskId, requestsCount, totalTokens);

    return blocks;
  }

  renderTaskComplete(
    prompt: string,
    githubRepository: { owner: string; repo: string },
    slackUserId: string,
    taskId: string,
    result: string,
    todos?: Todo[],
    requestsCount?: number,
    totalTokens?: number,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [
      this.renderHeaderBlock(prompt, githubRepository, slackUserId),
    ];

    this.renderTodoListBlock(blocks, todos);

    // Truncate result if too long to avoid Slack character limit
    const maxLength = 2900;
    let displayResult = result;

    if (result.length > maxLength) {
      displayResult = `${result.substring(0, maxLength)}...`;
    }

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `✅ ${slackifyMarkdown(displayResult)}`,
      },
    });

    this.renderFooterBlock(blocks, taskId, requestsCount, totalTokens);

    return blocks;
  }

  renderTaskFailed(
    prompt: string,
    githubRepository: { owner: string; repo: string },
    slackUserId: string,
    taskId: string,
    errorMessage: string,
    todos?: Todo[],
    requestsCount?: number,
    totalTokens?: number,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [
      this.renderHeaderBlock(prompt, githubRepository, slackUserId),
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*❌ Something wrong happened, retrying ...*\n\n${errorMessage}`,
        },
      },
    ];

    this.renderTodoListBlock(blocks, todos);

    this.renderFooterBlock(blocks, taskId, requestsCount, totalTokens);

    return blocks;
  }

  renderWaitlistApprovalRequired(): AnyBlock[] {
    return [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🐈 Reservation now!",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Oops! You need to be a Pochi member to use this command.*",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "I can see you're trying to get some AI teammate help – that's exactly what I do! 🐱\n\n*Here's what you're missing out on:*\n• AI writes code for you based on simple descriptions\n• Automatic bug fixes and feature implementations  \n• Seamless GitHub integration\n• Real-time progress updates (just like you tried to use!)",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "⚡ *Quick start:* Sign up takes less than 2 minutes, then come back and try that command again!",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "🚀 Get Started Now",
              emoji: true,
            },
            style: "primary",
            url: "https://app.getpochi.com",
            action_id: "get_started_button",
          },
        ],
      },
    ];
  }

  renderGitHubConnectionRequired(): AnyBlock[] {
    return [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🔗 GitHub Not Connected",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "🔗 *Almost there!*\n\nYou're a Pochi member, but we need access to your GitHub repositories to help you code.",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "🛡️ *Why connect GitHub?*\n• Pochi reads your code to understand context\n• Makes intelligent suggestions based on your codebase\n• Can directly create pull requests with fixes\n• Keeps your code secure with read-only access by default",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "⚡ *Takes 30 seconds:* Connect GitHub, then come back and try your command again!",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "🔗 Connect GitHub",
              emoji: true,
            },
            style: "primary",
            url: "https://app.getpochi.com/integrations",
            action_id: "connect_github_button",
          },
        ],
      },
    ];
  }

  renderWaitlistPendingApproval(): AnyBlock[] {
    return [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "⏳ Waiting for Approval",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Thanks for signing up! You're on the waitlist and pending approval.*",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "I can see you're eager to start coding with AI assistance – that's awesome! 🚀\n\n*What happens next:*\n• Our team will review your application shortly\n• You'll get notified once approved\n• Then you can use all Pochi features including this command!\n• Average approval time: 24-48 hours",
        },
      },

      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*DM us with 'get fast approve' for quick approval!*",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "💡 _Tip: Active community members often get approved faster!_",
          },
        ],
      },
    ];
  }

  private renderHeaderBlock(
    prompt: string,
    githubRepository: { owner: string; repo: string },
    slackUserId: string,
  ): AnyBlock {
    return {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:books: <https://github.com/${githubRepository.owner}/${githubRepository.repo}|${githubRepository.owner}/${githubRepository.repo}> <@${slackUserId}>: ${prompt}`,
      },
    };
  }

  private renderFooterBlock(
    dst: AnyBlock[],
    taskId: string,
    requestsCount?: number,
    totalTokens?: number,
  ) {
    const statsTexts: string[] = [];

    if (requestsCount !== undefined && requestsCount > 0) {
      statsTexts.push(`📊 ${requestsCount} rounds`);
    }

    if (totalTokens !== undefined && totalTokens > 0) {
      const formattedTokens =
        totalTokens >= 1000
          ? `${(totalTokens / 1000).toFixed(1)}k`
          : totalTokens.toLocaleString();
      statsTexts.push(`🔢 ${formattedTokens} tokens`);
    }

    if (statsTexts.length > 0) {
      dst.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: statsTexts.join("  "),
          },
        ],
      });
    }

    dst.push({
      type: "actions",
      elements: [
        {
          type: "button" as const,
          text: {
            type: "plain_text" as const,
            text: "📄 See details",
          },
          url: `https://app.getpochi.com/tasks/${taskId}`,
          style: "primary" as const,
          action_id: "view_task_button",
        },
      ],
    });
  }

  private renderTodoListBlock(dst: AnyBlock[], todos?: Todo[]) {
    if (!todos || todos.length === 0) {
      return;
    }

    const isAllDone = todos.every(
      (todo) => todo.status === "completed" || todo.status === "cancelled",
    );

    let headerText = isAllDone ? "🎉 All done!" : "📝 Todo list";
    const inProgressTodo = todos.find((todo) => todo.status === "in-progress");
    if (inProgressTodo) {
      headerText = `📝 ${inProgressTodo.content}`;
    }

    const todoText = todos
      .filter(
        (todo) => todo.status !== "cancelled" && todo.status !== "in-progress",
      )
      .map((todo) => {
        if (todo.status === "completed") {
          return `• ~${todo.content}~`;
        }
        return `• ${todo.content}`;
      })
      .join("\n");

    dst.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${headerText}\n${todoText}`,
      },
    });
  }

  private renderFollowUpSuggestionsBlock(
    dst: AnyBlock[],
    suggestions?: string[],
  ) {
    if (!suggestions || suggestions.length === 0) {
      return;
    }

    const suggestionText = suggestions
      .map((suggestion, index) => `${index + 1}. ${suggestion}`)
      .join("\n");

    dst.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*💡 Suggested answers:*\n${suggestionText}`,
      },
    });
  }

  /**
   * Parse header to extract repository and user information
   */
  parseHeaderInfo(headerBlock: AnyBlock): {
    githubRepository?: { owner: string; repo: string };
    slackUserId?: string;
    prompt?: string;
  } {
    if (
      headerBlock.type !== "section" ||
      !("text" in headerBlock) ||
      !headerBlock.text ||
      headerBlock.text.type !== "mrkdwn" ||
      typeof headerBlock.text.text !== "string"
    ) {
      return {};
    }

    const text = headerBlock.text.text;

    // Extract slack user ID
    const userMatch = text.match(/<@([^>]+)>/);
    const slackUserId = userMatch?.[1];

    // Extract prompt
    const promptMatch = text.match(/about "([^"]+)"/);
    const prompt = promptMatch?.[1];

    // Looking for pattern like: |@owner/repo>
    const repoMatch = text.match(/\|@([^/]+)\/([^>]+)>/);
    const githubRepository = repoMatch
      ? {
          owner: repoMatch[1],
          repo: repoMatch[2],
        }
      : undefined;

    return {
      githubRepository,
      slackUserId,
      prompt,
    };
  }
}

export const slackRichTextRenderer = new SlackRichTextRenderer();
