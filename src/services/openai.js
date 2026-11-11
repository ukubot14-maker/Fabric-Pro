const { MODEL } = require("../utils/config");

async function chat(messages, { timeoutMs = 120000, json = true } = {}) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured on the server.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = {
  model: MODEL || process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  temperature: 0.2,
  max_completion_tokens: 65536,
  reasoning_effort: "low",
  messages
};

    if (json) {
  body.response_format = {
    type: "json_schema",
    json_schema: {
      name: "fabric_mod_project",
      strict: true,
      schema: {
        type: "object",
        properties: {
          overview: { type: "string" },
          compatibility: {
            type: "object",
            properties: {
              minecraft: { type: "string" },
              java: { type: "string" },
              loader: { type: "string" },
              notes: { type: "string" }
            },
            required: ["minecraft", "java", "loader", "notes"],
            additionalProperties: false
          },
          textures: {
            type: "array",
            items: {
              type: "object",
              properties: {
                filename: { type: "string" },
                path: { type: "string" },
                description: { type: "string" }
              },
              required: ["filename", "path", "description"],
              additionalProperties: false
            }
          },
          files: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                content: { type: "string" }
              },
              required: ["path", "content"],
              additionalProperties: false
            }
          }
        },
        required: ["overview", "compatibility", "files", "textures"],
        additionalProperties: false
      }
    }
  };
}

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error?.message || `Groq API returned ${response.status}`);
    }

    const choice = data.choices?.[0];
    if (choice?.finish_reason === "length") {
      throw new Error("The AI reached its 65,536-token output limit before finishing the project. Try a smaller mod request.");
    }
    const content = choice?.message?.content;

    if (!content) {
      throw new Error("Groq returned an empty response.");
    }

    return content;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("AI request timed out.");
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { chat };
