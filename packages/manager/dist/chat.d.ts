export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}
export declare function handleChat(messages: ChatMessage[], onToken: (token: string) => void, onDone: () => void, onError: (message: string) => void, onTool?: (name: string, input: Record<string, string>, result: string) => void): Promise<void>;
//# sourceMappingURL=chat.d.ts.map