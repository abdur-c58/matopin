export const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

type ChatResponse = {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
  error?: { message?: string };
};

function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("OpenAI returned an unexpected response.");
  }
}

function reasoningEfforts(model: string, think: boolean): (string | null)[] {
  if (/^gpt-5\.\d/.test(model)) return [think ? "low" : "none", null];
  if (/^(gpt-5|o\d)/.test(model)) return [think ? "low" : "minimal", null];
  return [null];
}

async function request(key: string, model: string, system: string, user: string, schema: object, effort: string | null, timeoutMs: number) {
  return fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema } },
      ...(effort ? { reasoning_effort: effort } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function generateJson(key: string, model: string, system: string, user: string, schema: object, timeoutMs = 45_000, think = false): Promise<unknown> {
  for (const effort of reasoningEfforts(model, think)) {
    let res: Response;
    try {
      res = await request(key, model, system, user, schema, effort, timeoutMs);
    } catch {
      throw new Error("Could not reach OpenAI. Check your connection.");
    }
    const data = (await res.json().catch(() => ({}))) as ChatResponse;
    if (!res.ok) {
      const message = data.error?.message || `OpenAI ${res.status}`;
      if (effort && res.status === 400 && /reasoning/i.test(message)) continue;
      throw new Error(res.status === 429 ? `OpenAI rate limit or quota reached. ${message}` : message);
    }
    const choice = data.choices?.[0];
    if (choice?.message?.refusal) throw new Error(choice.message.refusal);
    const text = choice?.message?.content?.trim();
    if (!text) throw new Error(choice?.finish_reason === "length" ? "OpenAI ran out of tokens. Try fewer rows." : "OpenAI returned an empty response.");
    return parseModelJson(text);
  }
  throw new Error("OpenAI request failed.");
}
