import { GoogleGenerativeAI } from "@google/generative-ai";

export async function executeWebSearch(query: string): Promise<string> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return "Error: GOOGLE_GENERATIVE_AI_API_KEY is not set. Cannot perform web search.";
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      tools: [{ googleSearch: {} } as any],
    });

    const result = await model.generateContent(query);
    const response = result.response;
    const text = response.text();

    // Extract grounding metadata for source URLs
    const candidate = response.candidates?.[0];
    const groundingMeta = candidate?.groundingMetadata as any;
    const chunks = groundingMeta?.groundingChunks as any[] | undefined;

    const lines: string[] = [text];

    if (chunks && chunks.length > 0) {
      lines.push("", "**Sources:**");
      for (const chunk of chunks) {
        const web = chunk.web;
        if (web?.uri && web?.title) {
          lines.push(`- [${web.title}](${web.uri})`);
        } else if (web?.uri) {
          lines.push(`- ${web.uri}`);
        }
      }
    }

    return lines.join("\n");
  } catch (err: any) {
    return `Web search error: ${err.message || "Unknown error"}`;
  }
}
