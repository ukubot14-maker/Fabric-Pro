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
      model: MODEL,
      temperature: 0.2,
      messages
    };

    if (json) {
      body.response_format = { type: "json_object" };
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

    const content = data.choices?.[0]?.message?.content;

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
