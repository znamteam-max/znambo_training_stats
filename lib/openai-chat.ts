type AskTrainingCoachInput = {
  question: string;
  latestReportText?: string | null;
};

type OpenAIResponsePayload = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

export class OpenAIConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIConfigError";
  }
}

function getOpenAIKey() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new OpenAIConfigError("OPENAI_API_KEY is not configured.");
  }

  return apiKey;
}

function getOpenAIModel() {
  return process.env.OPENAI_MODEL ?? "gpt-5-mini";
}

function extractText(payload: OpenAIResponsePayload) {
  if (payload.output_text) {
    return payload.output_text.trim();
  }

  const chunks =
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text)
      .filter((text): text is string => Boolean(text)) ?? [];

  return chunks.join("\n").trim();
}

function buildInput(input: AskTrainingCoachInput) {
  const parts = [
    `Вопрос пользователя:\n${input.question}`,
  ];

  if (input.latestReportText) {
    parts.push(`Последний разбор тренировки:\n${input.latestReportText}`);
  }

  return parts.join("\n\n");
}

export async function askTrainingCoach(input: AskTrainingCoachInput) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${getOpenAIKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: getOpenAIModel(),
      instructions: [
        "Ты Telegram-чат тренировочного бота для велосипедиста/мультиспорта.",
        "Отвечай по-русски, конкретно и по делу.",
        "Если есть контекст последней тренировки, используй его.",
        "Не выдумывай данные Strava, которых нет в сообщении.",
        "Давай практические рекомендации: что делать сегодня/завтра, на что смотреть, какие риски.",
        "Ответ держи в пределах 1200 символов, чтобы он нормально помещался в Telegram.",
      ].join("\n"),
      input: buildInput(input),
      max_output_tokens: 700,
      store: false,
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | OpenAIResponsePayload
    | null;

  if (!response.ok) {
    const message = payload?.error?.message ?? `OpenAI request failed with ${response.status}.`;

    throw new Error(message);
  }

  const text = payload ? extractText(payload) : "";

  if (!text) {
    throw new Error("OpenAI returned an empty response.");
  }

  return text;
}
