import type Anthropic from "@anthropic-ai/sdk";
import { executeWebSearch } from "./web-search.js";
import { executeBrowseUrl } from "./web-browse.js";

export const toolDefinitions: Anthropic.Messages.Tool[] = [
  {
    name: "web_search",
    description:
      "Search the web for current information. Use this when the user asks about recent events, latest versions, current status of services, or anything that requires up-to-date information beyond your training data.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "The search query to look up on the web",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "browse_url",
    description:
      "Open a specific URL and retrieve its content. Use this when the user provides a URL to read, summarize, or extract information from a specific web page.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "The URL to open and read",
        },
      },
      required: ["url"],
    },
  },
];

export async function executeTool(
  name: string,
  input: Record<string, string>,
): Promise<string> {
  switch (name) {
    case "web_search":
      return executeWebSearch(input.query);
    case "browse_url":
      return executeBrowseUrl(input.url);
    default:
      return `Unknown tool: ${name}`;
  }
}
