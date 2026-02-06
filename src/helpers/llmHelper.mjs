import { request } from "undici";
import logger from "../logger.mjs";
import { llmConfig } from "../config.mjs";

const PROVIDERS = {
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    formatRequest: (messages, systemPrompt) => ({
      model: llmConfig.model || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      max_tokens: llmConfig.maxTokens,
      temperature: llmConfig.temperature,
    }),
    formatHeaders: (apiKey) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    }),
    extractResponse: (data) => data.choices?.[0]?.message?.content || null,
  },

  claude: {
    url: "https://api.anthropic.com/v1/messages",
    formatRequest: (messages, systemPrompt) => ({
      model: llmConfig.model || "claude-sonnet-4-5",
      system: systemPrompt,
      messages: messages,
      max_tokens: llmConfig.maxTokens || 1024,
    }),
    formatHeaders: (apiKey) => ({
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    }),
    extractResponse: (data) => {
      const content = data.content?.[0];
      return content?.type === "text" ? content.text : null;
    },
  },

  gemini: {
    url: (model) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-2.0-flash"}:generateContent`,
    formatRequest: (messages, systemPrompt) => ({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        maxOutputTokens: llmConfig.maxTokens,
        temperature: llmConfig.temperature,
      },
    }),
    formatHeaders: () => ({
      "Content-Type": "application/json",
    }),
    extractResponse: (data) =>
      data.candidates?.[0]?.content?.parts?.[0]?.text || null,
  },
};

export async function generateResponse(messages, contactName = null) {
  const provider = llmConfig.provider?.toLowerCase();
  const config = PROVIDERS[provider];

  if (!config) {
    logger.error({ provider }, "Unknown LLM provider");
    return null;
  }

  if (!llmConfig.apiKey) {
    logger.error("LLM API key not configured");
    return null;
  }

  let systemPrompt = llmConfig.systemPrompt || "You are a helpful assistant.";
  if (contactName) {
    systemPrompt += `\n\nYou are chatting with: ${contactName}`;
  }

  try {
    const url =
      typeof config.url === "function" ? config.url(llmConfig.model) : config.url;
    const finalUrl =
      provider === "gemini" ? `${url}?key=${llmConfig.apiKey}` : url;

    const body = config.formatRequest(messages, systemPrompt);
    const headers = config.formatHeaders(llmConfig.apiKey);

    logger.debug({ provider, messageCount: messages.length }, "Calling LLM API");

    const response = await request(finalUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.body.json();

    if (response.statusCode !== 200) {
      logger.error(
        { provider, status: response.statusCode, error: data },
        "LLM API error"
      );
      return null;
    }

    const text = config.extractResponse(data);
    logger.debug({ provider, responseLength: text?.length }, "LLM response received");

    return text;
  } catch (error) {
    logger.error({ error: error.message, provider }, "LLM request failed");
    return null;
  }
}

export function isLLMConfigured() {
  return !!(llmConfig.enabled && llmConfig.apiKey && llmConfig.provider);
}

export function getLLMInfo() {
  return {
    enabled: llmConfig.enabled,
    provider: llmConfig.provider,
    model: llmConfig.model,
    configured: isLLMConfigured(),
  };
}
