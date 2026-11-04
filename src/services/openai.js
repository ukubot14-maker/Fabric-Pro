
const { MODEL } = require("../utils/config");

async function chat(messages, { timeoutMs = 120000, json = true } = {}) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not configured.");
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
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error?.message || `Groq returned ${response.status}`
      );
    }

    return data.choices?.[0]?.message?.content || "";
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
