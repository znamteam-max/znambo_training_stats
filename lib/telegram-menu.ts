import type { Activity } from "@/generated/prisma/client";
import {
  addAthleteNote,
  buildStoredActivityLine,
  ensureStoredActivityMetrics,
  getStoredActivities,
  syncRecentActivities,
} from "@/lib/activity-service";
import {
  answerTelegramCallback,
  editTelegramMessage,
  sendTelegramMessage,
  type TelegramReplyMarkup,
} from "@/lib/telegram";

type TelegramCallbackQuery = {
  id: string;
  data?: string;
  message?: {
    message_id: number;
    chat: {
      id: number | string;
    };
  };
};

type ActivityGroup = {
  dateKey: string;
  label: string;
  activities: Activity[];
};

const trainingTimezone = process.env.TRAINING_TIMEZONE ?? "Europe/Moscow";

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function formatDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: trainingTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function formatDateLabel(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: trainingTimezone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: trainingTimezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function encodeSelection(selected: Set<number>) {
  return [...selected].sort((left, right) => left - right).join(".") || "-";
}

function decodeSelection(value: string | undefined) {
  if (!value || value === "-") {
    return new Set<number>();
  }

  return new Set(
    value
      .split(".")
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 0),
  );
}

function getMainMenuMarkup() {
  return {
    inline_keyboard: [
      [{ text: "Календарь тренировок", callback_data: "m:train" }],
      [{ text: "2 последние тренировки", callback_data: "m:last2" }],
      [
        { text: "Последняя", callback_data: "m:last" },
        { text: "План", callback_data: "m:plan" },
      ],
      [
        { text: "Health", callback_data: "m:health" },
        { text: "GPT-вопрос", callback_data: "m:gpt" },
      ],
    ],
  } satisfies TelegramReplyMarkup;
}

function getBackToMenuMarkup() {
  return {
    inline_keyboard: [[{ text: "Назад в меню", callback_data: "m:root" }]],
  } satisfies TelegramReplyMarkup;
}

function groupActivitiesByDate(activities: Activity[]) {
  const groups = new Map<string, ActivityGroup>();

  for (const activity of activities) {
    const dateKey = formatDateKey(activity.startDate);
    const existing = groups.get(dateKey);

    if (existing) {
      existing.activities.push(activity);
    } else {
      groups.set(dateKey, {
        dateKey,
        label: formatDateLabel(activity.startDate),
        activities: [activity],
      });
    }
  }

  return [...groups.values()];
}

async function getCalendarGroups(chatId: string) {
  await syncRecentActivities({ telegramChatId: chatId, perPage: 30 });
  const activities = await getStoredActivities({ telegramChatId: chatId, take: 60 });

  return groupActivitiesByDate(activities);
}

function buildCalendarMarkup(groups: ActivityGroup[]) {
  const dateButtons = groups.map((group) => ({
    text: `${group.label} (${group.activities.length})`,
    callback_data: `tr:d:${group.dateKey}`,
  }));

  return {
    inline_keyboard: [
      ...chunk(dateButtons, 2),
      [{ text: "Назад в меню", callback_data: "m:root" }],
    ],
  } satisfies TelegramReplyMarkup;
}

function buildActivitySelectionMarkup(input: {
  dateKey: string;
  activities: Activity[];
  selected: Set<number>;
}) {
  const selectedValue = encodeSelection(input.selected);
  const activityButtons = input.activities.map((activity, index) => {
    const marker = input.selected.has(index) ? "✓" : "□";
    const label = `${marker} ${formatTime(activity.startDate)} ${truncate(
      activity.name ?? activity.type,
      28,
    )}`;

    return [
      {
        text: label,
        callback_data: `tr:t:${input.dateKey}:${selectedValue}:${index}`,
      },
    ];
  });

  return {
    inline_keyboard: [
      ...activityButtons,
      [
        { text: "Готово", callback_data: `tr:done:${input.dateKey}:${selectedValue}` },
        { text: "Сброс", callback_data: `tr:d:${input.dateKey}` },
      ],
      [
        { text: "Календарь", callback_data: "m:train" },
        { text: "Меню", callback_data: "m:root" },
      ],
    ],
  } satisfies TelegramReplyMarkup;
}

function buildSelectionSummary(activities: Activity[]) {
  const durationSecondsByActivity = activities.map((activity) => {
    return activity.movingTimeSeconds ?? activity.elapsedTimeSeconds ?? 0;
  });
  const totalDurationSeconds = durationSecondsByActivity.reduce(
    (sum, seconds) => sum + seconds,
    0,
  );
  const totalDurationMinutes = activities.reduce((sum, activity) => {
    const seconds = activity.movingTimeSeconds ?? activity.elapsedTimeSeconds ?? 0;

    return sum + Math.round(seconds / 60);
  }, 0);
  const totalDistanceKm = activities.reduce(
    (sum, activity) => sum + (activity.distanceMeters ?? 0) / 1000,
    0,
  );
  const tssValues = activities
    .map((activity) => activity.trainingStressScore)
    .filter((value): value is number => value !== null);
  const totalTss = tssValues.reduce((sum, value) => sum + value, 0);
  const weightedAveragePower = getWeightedAverageMetric(
    activities,
    durationSecondsByActivity,
    "averagePowerWatts",
  );
  const weightedNormalizedPower = getWeightedAverageMetric(
    activities,
    durationSecondsByActivity,
    "normalizedPowerWatts",
  );
  const weightedIntensityFactor = getWeightedAverageMetric(
    activities,
    durationSecondsByActivity,
    "intensityFactor",
  );
  const powerSummary =
    weightedAveragePower === null &&
    weightedNormalizedPower === null &&
    weightedIntensityFactor === null &&
    tssValues.length === 0
      ? null
      : [
          weightedAveragePower === null
            ? "avg W n/a"
            : `avg ${weightedAveragePower.toFixed(0)} W`,
          weightedNormalizedPower === null
            ? "NP n/a"
            : `NP ср. ${weightedNormalizedPower.toFixed(0)} W`,
          weightedIntensityFactor === null
            ? "IF n/a"
            : `IF ср. ${weightedIntensityFactor.toFixed(2)}`,
          tssValues.length > 0 ? `TSS ${totalTss.toFixed(0)}` : "TSS n/a",
        ].join(", ");
  const lines = activities.map((activity, index) => {
    return `${index + 1}. ${buildStoredActivityLine(activity)}`;
  });

  return [
    `Выбрано тренировок: ${activities.length}`,
    "",
    ...lines,
    "",
    `Итого: ${totalDurationMinutes}м, ${totalDistanceKm.toFixed(1)} км${
      tssValues.length > 0 ? `, TSS ${totalTss.toFixed(0)}` : ""
    }.`,
    ...(powerSummary
      ? [
          `Мощность по выбранному блоку: ${powerSummary}. Длительность для расчёта: ${Math.round(
            totalDurationSeconds / 60,
          )}м.`,
        ]
      : []),
    "",
    "Теперь можно написать обычным сообщением, что именно разобрать: например, сравни эти две тренировки или оцени нагрузку за день.",
  ].join("\n");
}

function getWeightedAverageMetric(
  activities: Activity[],
  durationSecondsByActivity: number[],
  field: "averagePowerWatts" | "normalizedPowerWatts" | "intensityFactor",
) {
  let weightedSum = 0;
  let weightSum = 0;

  activities.forEach((activity, index) => {
    const value = activity[field];
    const seconds = durationSecondsByActivity[index] ?? 0;

    if (value !== null && seconds > 0) {
      weightedSum += value * seconds;
      weightSum += seconds;
    }
  });

  return weightSum === 0 ? null : weightedSum / weightSum;
}

function buildSelectionNote(input: {
  title: string;
  summary: string;
  activities: Activity[];
}) {
  const detailedReports = input.activities
    .map((activity, index) => {
      if (!activity.reportText) {
        return null;
      }

      return `Подробный отчёт ${index + 1}:\n${activity.reportText}`;
    })
    .filter((report): report is string => Boolean(report));

  return [input.title, input.summary, ...detailedReports].join("\n\n");
}

async function enrichSelectedActivities(chatId: string, activities: Activity[]) {
  const enriched: Activity[] = [];

  for (const activity of activities) {
    const updated = await ensureStoredActivityMetrics({
      telegramChatId: chatId,
      activityId: activity.id,
    }).catch(() => null);

    enriched.push(updated ?? activity);
  }

  return enriched;
}

async function editMenu(input: {
  chatId: string;
  messageId: number;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
}) {
  return editTelegramMessage({
    chatId: input.chatId,
    messageId: input.messageId,
    text: input.text,
    replyMarkup: input.replyMarkup,
  });
}

async function renderCalendar(chatId: string, messageId: number) {
  try {
    const groups = await getCalendarGroups(chatId);

    if (groups.length === 0) {
      return editMenu({
        chatId,
        messageId,
        text: "Пока нет сохранённых тренировок. Сначала подключи Strava через /connect.",
        replyMarkup: getBackToMenuMarkup(),
      });
    }

    return editMenu({
      chatId,
      messageId,
      text: "Календарь тренировок\n\nВыбери дату. В скобках показано количество тренировок за день.",
      replyMarkup: buildCalendarMarkup(groups),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    return editMenu({
      chatId,
      messageId,
      text: `Не смог открыть календарь: ${message}`,
      replyMarkup: getBackToMenuMarkup(),
    });
  }
}

async function renderDate(input: {
  chatId: string;
  messageId: number;
  dateKey: string;
  selected?: Set<number>;
}) {
  const activities = await getStoredActivities({
    telegramChatId: input.chatId,
    take: 80,
  });
  const dayActivities = activities.filter((activity) => {
    return formatDateKey(activity.startDate) === input.dateKey;
  });

  if (dayActivities.length === 0) {
    return renderCalendar(input.chatId, input.messageId);
  }

  return editMenu({
    chatId: input.chatId,
    messageId: input.messageId,
    text: [
      `Тренировки за ${input.dateKey}`,
      "",
      "Нажимай на тренировки, чтобы отметить несколько сразу. Потом нажми «Готово».",
    ].join("\n"),
    replyMarkup: buildActivitySelectionMarkup({
      dateKey: input.dateKey,
      activities: dayActivities,
      selected: input.selected ?? new Set(),
    }),
  });
}

async function renderLastTwo(chatId: string, messageId: number) {
  try {
    await syncRecentActivities({ telegramChatId: chatId, perPage: 10 });
    const activities = await getStoredActivities({ telegramChatId: chatId, take: 2 });

    if (activities.length === 0) {
      return editMenu({
        chatId,
        messageId,
        text: "Пока нет тренировок. Сначала подключи Strava через /connect.",
        replyMarkup: getBackToMenuMarkup(),
      });
    }

    const enrichedActivities = await enrichSelectedActivities(chatId, activities);
    const summary = buildSelectionSummary(enrichedActivities);

    await addAthleteNote({
      telegramChatId: chatId,
      text: buildSelectionNote({
        title: "Выбранные последние тренировки для разбора:",
        summary,
        activities: enrichedActivities,
      }),
    });

    return editMenu({
      chatId,
      messageId,
      text: summary,
      replyMarkup: getBackToMenuMarkup(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    return editMenu({
      chatId,
      messageId,
      text: `Не смог выбрать последние тренировки: ${message}`,
      replyMarkup: getBackToMenuMarkup(),
    });
  }
}

export function sendMainMenu(chatId: string) {
  return sendTelegramMessage({
    chatId,
    text: "Меню бота\n\nВыбери действие кнопкой ниже.",
    replyMarkup: getMainMenuMarkup(),
  });
}

export async function handleTelegramCallback(query: TelegramCallbackQuery) {
  await answerTelegramCallback({ callbackQueryId: query.id });

  if (!query.message) {
    return;
  }

  const chatId = String(query.message.chat.id);
  const messageId = query.message.message_id;
  const data = query.data ?? "";

  if (data === "m:root") {
    return editMenu({
      chatId,
      messageId,
      text: "Меню бота\n\nВыбери действие кнопкой ниже.",
      replyMarkup: getMainMenuMarkup(),
    });
  }

  if (data === "m:train") {
    return renderCalendar(chatId, messageId);
  }

  if (data === "m:last2") {
    return renderLastTwo(chatId, messageId);
  }

  if (data === "m:last") {
    return editMenu({
      chatId,
      messageId,
      text: "Нажми /last, чтобы получить подробный разбор последней тренировки.",
      replyMarkup: getBackToMenuMarkup(),
    });
  }

  if (data === "m:plan") {
    return editMenu({
      chatId,
      messageId,
      text: "Нажми /plan, чтобы получить план по последней сохранённой тренировке.",
      replyMarkup: getBackToMenuMarkup(),
    });
  }

  if (data === "m:health") {
    return editMenu({
      chatId,
      messageId,
      text: "Нажми /health или /today, чтобы посмотреть последнюю Health-сводку.",
      replyMarkup: getBackToMenuMarkup(),
    });
  }

  if (data === "m:gpt") {
    return editMenu({
      chatId,
      messageId,
      text: "Напиши обычное сообщение без slash-команды, и я отправлю его в GPT с контекстом тренировок и здоровья.",
      replyMarkup: getBackToMenuMarkup(),
    });
  }

  const parts = data.split(":");

  if (parts[0] !== "tr") {
    return;
  }

  if (parts[1] === "d" && parts[2]) {
    return renderDate({
      chatId,
      messageId,
      dateKey: parts[2],
    });
  }

  if (parts[1] === "t" && parts[2] && parts[3] && parts[4]) {
    const selected = decodeSelection(parts[3]);
    const index = Number(parts[4]);

    if (selected.has(index)) {
      selected.delete(index);
    } else {
      selected.add(index);
    }

    return renderDate({
      chatId,
      messageId,
      dateKey: parts[2],
      selected,
    });
  }

  if (parts[1] === "done" && parts[2] && parts[3]) {
    const selected = decodeSelection(parts[3]);

    if (selected.size === 0) {
      return renderDate({
        chatId,
        messageId,
        dateKey: parts[2],
      });
    }

    const activities = await getStoredActivities({
      telegramChatId: chatId,
      take: 80,
    });
    const dayActivities = activities.filter((activity) => {
      return formatDateKey(activity.startDate) === parts[2];
    });
    const selectedActivities = [...selected]
      .sort((left, right) => left - right)
      .map((index) => dayActivities[index])
      .filter((activity): activity is Activity => Boolean(activity));
    const enrichedActivities = await enrichSelectedActivities(
      chatId,
      selectedActivities,
    );
    const summary = buildSelectionSummary(enrichedActivities);

    await addAthleteNote({
      telegramChatId: chatId,
      text: buildSelectionNote({
        title: "Выбранные тренировки для разбора:",
        summary,
        activities: enrichedActivities,
      }),
    });

    return editMenu({
      chatId,
      messageId,
      text: summary,
      replyMarkup: getBackToMenuMarkup(),
    });
  }
}
