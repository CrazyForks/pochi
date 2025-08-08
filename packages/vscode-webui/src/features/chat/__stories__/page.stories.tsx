import type { Meta, StoryObj } from "@storybook/react";

import { ChatPage } from "../page";

const meta = {
  title: "Chat/Page",
  component: ChatPage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ChatPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const auth = {
  user: {
    id: "1",
    name: "Test User",
    email: "test@example.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  session: {
    token: "test-token",
    id: "",
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: "",
    expiresAt: new Date(),
  },
};

export const Default: Story = {
  args: {
    auth,
    uid: "default",
  },
};
