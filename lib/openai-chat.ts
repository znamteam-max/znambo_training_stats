type AskTrainingCoachInput = {
  question: string;
  latestReportText?: string | null;
  latestHealthText?: string | null;
  latestNotesText?: string | null;
};

type OpenAIResponsePayload = {
  status?: string;
  incomplete_details?: {
    reason?: string;
  };
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
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
  return process.env.OPENAI_MODEL ?? "gpt-5.5";
}

function isGpt5Model(model: string) {
  return model.startsWith("gpt-5");
}

function extractText(payload: OpenAIResponsePayload) {
  if (payload.output_text) {
    return payload.output_text.trim();
  }

  const chunks =
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text ?? content.refusal)
      .filter((text): text is string => Boolean(text)) ?? [];

  return chunks.join("\n").trim();
}

function buildInput(input: AskTrainingCoachInput) {
  const parts = [`Вопрос пользователя:\n${input.question}`];

  if (input.latestReportText) {
    parts.push(`Последний разбор тренировки:\n${input.latestReportText}`);
  }

  if (input.latestHealthText) {
    parts.push(`Последние данные здоровья и питания:\n${input.latestHealthText}`);
  }

  if (input.latestNotesText) {
    parts.push(`Последние заметки и выбранные тренировки:\n${input.latestNotesText}`);
  }

  return parts.join("\n\n");
}

export async function askTrainingCoach(input: AskTrainingCoachInput) {
  const model = getOpenAIModel();
  const body = {
    model,
    instructions: [
      "Ты Telegram-чат тренировочного бота для велосипедиста/мультиспорта.",
      "Отвечай по-русски, конкретно и по делу.",
      "Если есть контекст последней тренировки, здоровья или питания, используй его.",
      "Не выдумывай данные Strava, Apple Health или питания, которых нет в сообщении.",
      "Если пользователь говорит, что выбранные активности являются одной тренировкой, оцени их суммарно.",
      "Для велотренировок делай акцент на avg W, NP, IF, TSS, длительность, ровность и распределение нагрузки.",
      "Давай практические рекомендации: что делать сегодня/завтра, на что смотреть, какие риски.",
      "Ответ держи в пределах 1800 символов, чтобы он нормально помещался в Telegram.",
      "В конце дай строку с реальным выводом в формате 'Итог: <конкретное действие>'. Не пиши многоточие вместо вывода.",
    ].join("\n"),
    input: buildInput(input),
    max_output_tokens: 4096,
    store: false,
    ...(isGpt5Model(model)
      ? {
          reasoning: { effort: "low" },
          text: { verbosity: "medium" },
        }
      : {}),
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${getOpenAIKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as
    | OpenAIResponsePayload
    | null;

  if (!response.ok) {
    const message =
      payload?.error?.message ?? `OpenAI request failed with ${response.status}.`;

    throw new Error(message);
  }

  const text = payload ? extractText(payload) : "";

  if (!text) {
    const status = payload?.status ?? "unknown";
    const reason = payload?.incomplete_details?.reason ?? "unknown";

    throw new Error(`OpenAI returned an empty response. status=${status}, reason=${reason}.`);
  }

  return text;
}
