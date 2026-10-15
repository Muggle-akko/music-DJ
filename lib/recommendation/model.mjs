export function createModel({
  provider,
  deepseekKey,
  deepseekBase,
  deepseekModel,
  openaiKey,
  openaiModel,
  fetchImpl = fetch,
}) {
  if (provider === "local" || (!deepseekKey && !openaiKey)) return null;
  return async (system, payload, { signal } = {}) => {
    let url, body, key;
    if (provider === "deepseek") {
      url = `${deepseekBase}/chat/completions`;
      key = deepseekKey;
      body = {
        model: deepseekModel,
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(payload) },
        ],
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        temperature: 0.2,
        max_tokens: 2600,
        stream: false,
      };
    } else {
      url = "https://api.openai.com/v1/responses";
      key = openaiKey;
      body = {
        model: openaiModel,
        instructions: system,
        input: JSON.stringify(payload),
        text: { format: { type: "json_object" } },
        max_output_tokens: 2600,
      };
    }
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`模型服务失败 (${response.status})`);
    const text =
      provider === "deepseek"
        ? data.choices?.[0]?.message?.content
        : data.output_text ||
          data.output
            ?.flatMap((o) => o.content || [])
            .filter((c) => c.type === "output_text")
            .map((c) => c.text)
            .join("");
    try {
      return JSON.parse(text);
    } catch {
      throw Object.assign(new Error("invalid_model_json"), {
        repairable: true,
      });
    }
  };
}
