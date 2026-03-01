import type Anthropic from "@anthropic-ai/sdk";
export declare const toolDefinitions: Anthropic.Messages.Tool[];
export declare function executeTool(name: string, input: Record<string, string>): Promise<string>;
//# sourceMappingURL=index.d.ts.map