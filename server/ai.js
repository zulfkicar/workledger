import { z } from "zod";

const explanationSchema = z.object({
  summary: z.string().min(1).max(1600),
  recommendations: z
    .array(z.object({ task_id: z.string(), explanation: z.string().max(500) }))
    .max(6),
});
export function providerStatus(env = process.env) {
  return {
    provider: env.AI_PROVIDER || "none",
    configured: Boolean(
      env.AI_API_KEY &&
      env.AI_MODEL &&
      ["openai", "deepseek", "anthropic"].includes(env.AI_PROVIDER),
    ),
    model: env.AI_MODEL || null,
  };
}

export async function explain(report, env = process.env, fetcher = fetch) {
  const status = providerStatus(env);
  if (!status.configured)
    return {
      source: "recorded_patterns",
      summary: `${report.entry_count} recorded sessions account for ${(report.total_minutes / 60).toFixed(1)} hours in this period. Review recurring categories and blocked tasks before choosing a process to automate.`,
      recommendations: [],
      model: null,
    };
  const allowed = new Set(report.tasks.map((t) => t.id));
  const prompt = `Explain these recorded work facts. Do not invent savings, causes, performance scores, or missing data. Recommend at most 6 tasks. Return JSON only: {"summary":"...","recommendations":[{"task_id":"existing ID","explanation":"..."}]}. DATA: ${JSON.stringify({ total_minutes: report.total_minutes, categories: report.categories, tasks: report.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, note: t.note })) })}`;
  const provider = env.AI_PROVIDER;
  const model = env.AI_MODEL;
  let url, headers, body;
  if (provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers = {
      "x-api-key": env.AI_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    };
    body = {
      model,
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    };
  } else if (["openai", "deepseek"].includes(provider)) {
    url =
      provider === "openai"
        ? "https://api.openai.com/v1/chat/completions"
        : "https://api.deepseek.com/chat/completions";
    headers = {
      Authorization: `Bearer ${env.AI_API_KEY}`,
      "Content-Type": "application/json",
    };
    body = {
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 1000,
    };
  } else throw new Error("Unsupported AI provider");
  const response = await fetcher(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(`AI provider returned HTTP ${response.status}`);
  const data = await response.json();
  const raw =
    provider === "anthropic"
      ? data.content
          ?.filter((x) => x.type === "text")
          .map((x) => x.text)
          .join("")
      : data.choices?.[0]?.message?.content;
  const cleaned = String(raw || "").replace(/^```(?:json)?\s*|\s*```$/g, "");
  const output = explanationSchema.parse(JSON.parse(cleaned));
  if (output.recommendations.some((r) => !allowed.has(r.task_id)))
    throw new Error("AI cited an unknown task");
  return { ...output, source: "ai_explanation", model };
}
