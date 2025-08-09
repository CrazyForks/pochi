import type { JSONSchema7 } from "json-schema";
import { z } from "zod";

export const ZodMcpTool = z.object({
  description: z
    .string()
    .optional()
    .describe("An optional description of the MCP tool."),
  inputSchema: z
    .object({
      jsonSchema: z.custom<JSONSchema7>().describe("Validated json schema."),
    })
    .required()
    .describe("The parameters of the MCP tool."),
});

export type McpTool = z.infer<typeof ZodMcpTool>;
