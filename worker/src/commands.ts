import {
  addAthleteNote,
  ensureStoredActivityMetrics,
  getLatestDailyHealthLog,
  getLatestStoredActivity,
  getOrCreateTelegramAthlete,
  getRecentAthleteNotes,
  getStoredActivities,
  markActivityReportSent,
  processLatestActivity,
  syncRecentActivities,
  updateAthleteDefaults,
} from "./db";
import { importTelegramFitFile } from "./fit";
import { buildDailyHealthContext, buildDailyHealthSummary } from "./health";
import { askTrainingCoach, OpenAIConfigError } from "./openai";
import { buildPlanFromStoredActivity } from "./report";
import {
  answerTelegramCallback,
  deleteTelegramMessage,
  downloadTelegramFile,
  editTelegramMessage,
  getTelegramMessageId,
  sendTelegramChatAction,
  sendTelegramMessage,
  type TelegramReplyMarkup,
} from "./telegram";
import type {
  Activity,
  Athlete,
  Env,
  TelegramCallbackQuery,
  TelegramDocument,
  TelegramMessage,
} from "./types";

type ActivityGroup = {
  dateKey: string;
  label: string;
  activities: Activity[];
};

function getAppUrl(requestUrl: string) {
  const url = new URL(requestUrl);

  return `${url.protocol}//${url.host}`;
}

function getCommandParts(text: string) {
  const [commandWithBotName, ...args] = text.trim().split(/\s+/);
  const command = commandWithBotName.split("@")[0].toLowerCase();

  return {
    command,
    args,
    rawArgs: text.trim().slice(commandWithBotName.length).trim(),
  };
}

function getRedirectUri(env: Env, requestUrl: string) {
  return (
    env.STRAVA_REDIRECT_URI ??
    new URL("/api/strava/callback", requestUrl).toString()
  );
}

function buildConnectText(requestUrl: string, telegramChatId: string) {
  const appUrl = getAppUrl(requestUrl);
  const url = `${appUrl}/api/strava/auth?telegramChatId=${encodeURIComponent(
    telegramChatId,
  )}`;

  return [
    "Strava ещё не подключена.",
    "Открой ссылку, дай доступ, потом возвращайся и жми /last.",
    "",
    url,
  ].join("\n");
}

async function handleLastCommand(env: Env, chatId: string, requestUrl: string) {
  const athlete = await getOrCreateTelegramAthlete(env, chatId);

  if (!athlete.refreshToken) {
    return sendTelegramMessage({
      env,
      chatId,
      text: buildConnectText(requestUrl, chatId),
    });
  }

  const result = await processLatestActivity(env, { telegramChatId: chatId });

  if (!result) {
    return sendTelegramMessage({
      env,
      chatId,
      text: "В Strava нет активностей для разбора. Тут нечего героически анализировать.",
    });
  }

  await markActivityReportSent(env, result.activity.id);

  return sendTelegramMessage({
    env,
    chatId,
    text: result.reportText,
  });
}

async function handlePlanCommand(env: Env, chatId: string) {
  const latestActivity = await getLatestStoredActivity(env, chatId);

  if (!latestActivity) {
    return sendTelegramMessage({
      env,
      chatId,
      text: "Плана пока нет: сначала подключи Strava и вызови /last, чтобы я видел последнюю тренировку.",
    });
  }

  return sendTelegramMessage({
    env,
    chatId,
    text: buildPlanFromStoredActivity(latestActivity),
  });
}

async function handleHealthCommand(env: Env, chatId: string) {
  const latestHealth = await getLatestDailyHealthLog(env, chatId);

  return sendTelegramMessage({
    env,
    chatId,
    text: buildDailyHealthSummary(latestHealth),
  });
}

async function handleFtpCommand(
  env: Env,
  chatId: string,
  value: string | undefined,
) {
  const ftp = Number(value);

  if (!Number.isInteger(ftp) || ftp < 100 || ftp > 600) {
    return sendTelegramMessage({
      env,
      chatId,
      text: "FTP укажи нормально: например /ftp 285.",
    });
  }

  const athlete = await getOrCreateTelegramAthlete(env, chatId);
  await updateAthleteDefaults(env, { telegramChatId: chatId, ftpWatts: ftp });

  return sendTelegramMessage({
    env,
    chatId,
    text: `FTP обновил: ${ftp} W. Athlete: ${athlete.id}. Теперь отчёты будут считать зоны от него.`,
  });
}

async function handleWeightCommand(
  env: Env,
  chatId: string,
  value: string | undefined,
) {
  const weight = Number(value);

  if (!Number.isFinite(weight) || weight < 40 || weight > 150) {
    return sendTelegramMessage({
      env,
      chatId,
      text: "Вес укажи нормально: например /weight 82.",
    });
  }

  await getOrCreateTelegramAthlete(env, chatId);
  await updateAthleteDefaults(env, { telegramChatId: chatId, weightKg: weight });

  return sendTelegramMessage({
    env,
    chatId,
    text: `Вес обновил: ${weight} кг.`,
  });
}

async function handleNoteCommand(env: Env, chatId: string, text: string) {
  if (!text) {
    return sendTelegramMessage({
      env,
      chatId,
      text: "Заметку пиши после команды: /note сон 6 часов, ноги тяжёлые.",
    });
  }

  await addAthleteNote(env, { telegramChatId: chatId, text });

  return sendTelegramMessage({
    env,
    chatId,
    text: "Заметку сохранил. Это пригодится для следующего плана.",
  });
}

async function handleGoalCommand(env: Env, chatId: string, text: string) {
  if (!text) {
    return sendTelegramMessage({
      env,
      chatId,
      text: "Цель пиши после команды: /goal финишировать HYROX без провала по бегу.",
    });
  }

  await addAthleteNote(env, {
    telegramChatId: chatId,
    text: `Цель спортсмена: ${text}`,
  });

  return sendTelegramMessage({
    env,
    chatId,
    text: "Цель сохранил. Буду держать её в контексте следующих ответов.",
  });
}

function startTypingIndicator(env: Env, chatId: string) {
  void sendTelegramChatAction({ env, chatId }).catch(() => undefined);

  const timer = setInterval(() => {
    void sendTelegramChatAction({ env, chatId }).catch(() => undefined);
  }, 4000);

  return () => clearInterval(timer);
}

async function sendThinkingMessage(env: Env, chatId: string, text = "Думаю") {
  const payload = await sendTelegramMessage({
    env,
    chatId,
    text,
  }).catch(() => null);

  return getTelegramMessageId(payload);
}

async function deleteThinkingMessage(
  env: Env,
  chatId: string,
  messageId: number | null,
) {
  if (!messageId) {
    return;
  }

  await deleteTelegramMessage({
    env,
    chatId,
    messageId,
  }).catch(() => undefined);
}

function isFitDocument(document: TelegramDocument) {
  const fileName = document.file_name?.toLowerCase() ?? "";

  return fileName.endsWith(".fit");
}

async function handleFitDocument(
  env: Env,
  chatId: string,
  document: TelegramDocument,
) {
  if (!isFitDocument(document)) {
    return sendTelegramMessage({
      env,
      chatId,
      text: "Файл вижу, но пока умею читать только .fit. Пришли тренировку именно FIT-файлом.",
    });
  }

  if (document.file_size && document.file_size > 25 * 1024 * 1024) {
    return sendTelegramMessage({
      env,
      chatId,
      text: "FIT-файл слишком большой для быстрой обработки в боте. Лучше отправь файл до 25 МБ.",
    });
  }

  const stopTyping = startTypingIndicator(env, chatId);
  const thinkingMessageId = await sendThinkingMessage(env, chatId, "Разбираю FIT");

  try {
    const fileName = document.file_name ?? "activity.fit";
    const fileBuffer = await downloadTelegramFile(env, document.file_id);
    const result = await importTelegramFitFile({
      env,
      telegramChatId: chatId,
      fileName,
      fileBuffer,
    });
    const powerNote =
      result.metrics.averagePowerWatts === null
        ? "Внутри FIT не нашёл поток мощности, поэтому ватт-анализ ограничен."
        : "Ватт-данные из FIT прочитаны и сохранены.";
    const decoderNote =
      result.decoderErrors.length > 0
        ? `Предупреждения декодера: ${result.decoderErrors.join("; ")}`
        : null;

    return await sendTelegramMessage({
      env,
      chatId,
      text: [
        `FIT-файл прочитан: ${fileName}`,
        powerNote,
        "",
        result.reportText,
        "",
        "Файл сохранил в контекст. Теперь можешь написать обычным сообщением: сравни эти FIT-файлы, объедини как одну тренировку или оцени мощность.",
        ...(decoderNote ? ["", decoderNote] : []),
      ].join("\n"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    return await sendTelegramMessage({
      env,
      chatId,
      text: `Не смог разобрать FIT-файл: ${message}`,
    });
  } finally {
    stopTyping();
    await deleteThinkingMessage(env, chatId, thinkingMessageId);
  }
}

function truncateForMemory(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1)}…`;
}

function buildCurrentDateContext(env: Env, nowDate: Date) {
  return [
    `Дата сегодня: ${formatDateKey(env, nowDate)}.`,
    `Время сейчас: ${formatTime(env, nowDate)}.`,
    `Часовой пояс: ${env.TRAINING_TIMEZONE ?? "Europe/Moscow"}.`,
  ].join("\n");
}

function buildAthleteProfileContext(athlete: Athlete) {
  return [
    `Telegram chat id: ${athlete.telegramChatId ?? "n/a"}.`,
    `Strava athlete id: ${athlete.stravaAthleteId?.toString() ?? "n/a"}.`,
    `FTP: ${athlete.ftpWatts} W.`,
    `Вес: ${athlete.weightKg === null ? "n/a" : `${athlete.weightKg} кг`}.`,
  ].join("\n");
}

function buildActivitiesContext(
  env: Env,
  activities: Activity[],
  emptyText: string,
) {
  if (activities.length === 0) {
    return emptyText;
  }

  return activities
    .map((activity, index) => {
      return `${index + 1}. ${formatDateKey(env, activity.startDate)} ${formatTime(
        env,
        activity.startDate,
      )} · ${buildStoredActivityLine(activity)}`;
    })
    .join("\n");
}

function buildConversationMemoryNote(input: {
  env: Env;
  question: string;
  answer: string;
}) {
  const nowDate = new Date();

  return [
    `Диалог ${formatDateKey(input.env, nowDate)} ${formatTime(input.env, nowDate)}`,
    `Пользователь: ${truncateForMemory(input.question, 700)}`,
    `Ответ бота: ${truncateForMemory(input.answer, 900)}`,
  ].join("\n");
}

async function handleCoachChat(env: Env, chatId: string, text: string) {
  if (!text) {
    return sendTelegramMessage({
      env,
      chatId,
      text: "Напиши вопрос после /ask или просто отправь обычное сообщение.",
    });
  }

  const stopTyping = startTypingIndicator(env, chatId);
  const thinkingMessageId = await sendThinkingMessage(env, chatId);

  try {
    const athlete = await getOrCreateTelegramAthlete(env, chatId);
    const nowDate = new Date();

    await syncRecentActivities(env, { telegramChatId: chatId, perPage: 10 }).catch(
      () => undefined,
    );
    await processLatestActivity(env, { telegramChatId: chatId }).catch(
      () => undefined,
    );

    const recentActivities = await getStoredActivities(env, {
      telegramChatId: chatId,
      take: 8,
    });
    const todayKey = formatDateKey(env, nowDate);
    const todayActivities = recentActivities.filter((activity) => {
      return formatDateKey(env, activity.startDate) === todayKey;
    });
    const latestActivity = await getLatestStoredActivity(env, chatId);
    const latestHealth = await getLatestDailyHealthLog(env, chatId);
    const notes = await getRecentAthleteNotes(env, {
      telegramChatId: chatId,
      take: 8,
    });
    const conversationNotes = notes.filter((note) =>
      note.text.startsWith("Диалог "),
    );
    const contextNotes = notes.filter(
      (note) => !note.text.startsWith("Диалог "),
    );
    const answer = await askTrainingCoach({
      env,
      question: text,
      currentDateText: buildCurrentDateContext(env, nowDate),
      athleteProfileText: buildAthleteProfileContext(athlete),
      todayActivitiesText: buildActivitiesContext(
        env,
        todayActivities,
        "После свежей синхронизации Strava тренировок за сегодня в базе нет.",
      ),
      recentActivitiesText: buildActivitiesContext(
        env,
        recentActivities,
        "Последних тренировок в базе нет.",
      ),
      latestReportText: latestActivity?.reportText,
      latestHealthText: buildDailyHealthContext(latestHealth),
      latestNotesText: contextNotes.map((note) => note.text).join("\n\n"),
      conversationMemoryText: conversationNotes
        .map((note) => note.text)
        .join("\n\n"),
    });

    await addAthleteNote(env, {
      telegramChatId: chatId,
      text: buildConversationMemoryNote({ env, question: text, answer }),
    }).catch(() => undefined);

    return await sendTelegramMessage({
      env,
      chatId,
      text: answer,
    });
  } catch (error) {
    if (error instanceof OpenAIConfigError) {
      return await sendTelegramMessage({
        env,
        chatId,
        text: "GPT-чат ещё не включён. Добавь OPENAI_API_KEY в Cloudflare Worker Secrets и сделай redeploy.",
      });
    }

    const message = error instanceof Error ? error.message : "unknown error";

    return await sendTelegramMessage({
      env,
      chatId,
      text: `GPT сейчас не ответил: ${message}`,
    });
  } finally {
    stopTyping();
    await deleteThinkingMessage(env, chatId, thinkingMessageId);
  }
}

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}

function truncate(text: string, maxLength: number) {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function formatDateKey(env: Env, date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.TRAINING_TIMEZONE ?? "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return `${parts.find((part) => part.type === "year")?.value}-${
    parts.find((part) => part.type === "month")?.value
  }-${parts.find((part) => part.type === "day")?.value}`;
}

function formatDateLabel(env: Env, date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: env.TRAINING_TIMEZONE ?? "Europe/Moscow",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function formatTime(env: Env, date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: env.TRAINING_TIMEZONE ?? "Europe/Moscow",
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

function groupActivitiesByDate(env: Env, activities: Activity[]) {
  const groups = new Map<string, ActivityGroup>();

  for (const activity of activities) {
    const dateKey = formatDateKey(env, activity.startDate);
    const existing = groups.get(dateKey);

    if (existing) {
      existing.activities.push(activity);
    } else {
      groups.set(dateKey, {
        dateKey,
        label: formatDateLabel(env, activity.startDate),
        activities: [activity],
      });
    }
  }

  return [...groups.values()];
}

async function getCalendarGroups(env: Env, chatId: string) {
  await syncRecentActivities(env, { telegramChatId: chatId, perPage: 30 });
  const activities = await getStoredActivities(env, {
    telegramChatId: chatId,
    take: 60,
  });

  return groupActivitiesByDate(env, activities);
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
  env: Env;
  dateKey: string;
  activities: Activity[];
  selected: Set<number>;
}) {
  const selectedValue = encodeSelection(input.selected);
  const activityButtons = input.activities.map((activity, index) => {
    const marker = input.selected.has(index) ? "✓" : "□";
    const label = `${marker} ${formatTime(input.env, activity.startDate)} ${truncate(
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

function getActivityTitle(activity: Activity) {
  return activity.name ?? activity.type;
}

function buildStoredActivityLine(activity: Activity) {
  const durationSeconds =
    activity.movingTimeSeconds ?? activity.elapsedTimeSeconds ?? 0;
  const minutes = Math.round(durationSeconds / 60);
  const distance = activity.distanceMeters
    ? `${(activity.distanceMeters / 1000).toFixed(1)} км`
    : "n/a";
  const power =
    activity.averagePowerWatts === null
      ? "avg W n/a"
      : `avg ${activity.averagePowerWatts.toFixed(0)} W`;
  const normalizedPower =
    activity.normalizedPowerWatts === null
      ? "NP n/a"
      : `NP ${activity.normalizedPowerWatts.toFixed(0)} W`;
  const intensity =
    activity.intensityFactor === null
      ? "IF n/a"
      : `IF ${activity.intensityFactor.toFixed(2)}`;
  const tss =
    activity.trainingStressScore === null
      ? "TSS n/a"
      : `TSS ${activity.trainingStressScore.toFixed(0)}`;
  const heartRate =
    activity.averageHeartRate === null
      ? "HR n/a"
      : `HR ${activity.averageHeartRate.toFixed(0)}${
          activity.maxHeartRate ? `/${activity.maxHeartRate}` : ""
        }`;

  return `${getActivityTitle(
    activity,
  )} · ${minutes}м · ${distance} · ${power} · ${normalizedPower} · ${intensity} · ${tss} · ${heartRate}`;
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

async function enrichSelectedActivities(
  env: Env,
  chatId: string,
  activities: Activity[],
) {
  const enriched: Activity[] = [];

  for (const activity of activities) {
    const updated = await ensureStoredActivityMetrics(env, {
      telegramChatId: chatId,
      activityId: activity.id,
    }).catch(() => null);

    enriched.push(updated ?? activity);
  }

  return enriched;
}

async function editMenu(input: {
  env: Env;
  chatId: string;
  messageId: number;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
}) {
  return editTelegramMessage(input);
}

async function renderCalendar(env: Env, chatId: string, messageId: number) {
  try {
    const groups = await getCalendarGroups(env, chatId);

    if (groups.length === 0) {
      return editMenu({
        env,
        chatId,
        messageId,
        text: "Пока нет сохранённых тренировок. Сначала подключи Strava через /connect.",
        replyMarkup: getBackToMenuMarkup(),
      });
    }

    return editMenu({
      env,
      chatId,
      messageId,
      text: "Календарь тренировок\n\nВыбери дату. В скобках показано количество тренировок за день.",
      replyMarkup: buildCalendarMarkup(groups),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    return editMenu({
      env,
      chatId,
      messageId,
      text: `Не смог открыть календарь: ${message}`,
      replyMarkup: getBackToMenuMarkup(),
    });
  }
}

async function renderDate(input: {
  env: Env;
  chatId: string;
  messageId: number;
  dateKey: string;
  selected?: Set<number>;
}) {
  const activities = await getStoredActivities(input.env, {
    telegramChatId: input.chatId,
    take: 80,
  });
  const dayActivities = activities.filter((activity) => {
    return formatDateKey(input.env, activity.startDate) === input.dateKey;
  });

  if (dayActivities.length === 0) {
    return renderCalendar(input.env, input.chatId, input.messageId);
  }

  return editMenu({
    env: input.env,
    chatId: input.chatId,
    messageId: input.messageId,
    text: [
      `Тренировки за ${input.dateKey}`,
      "",
      "Нажимай на тренировки, чтобы отметить несколько сразу. Потом нажми «Готово».",
    ].join("\n"),
    replyMarkup: buildActivitySelectionMarkup({
      env: input.env,
      dateKey: input.dateKey,
      activities: dayActivities,
      selected: input.selected ?? new Set(),
    }),
  });
}

async function renderLastTwo(env: Env, chatId: string, messageId: number) {
  try {
    await syncRecentActivities(env, { telegramChatId: chatId, perPage: 10 });
    const activities = await getStoredActivities(env, {
      telegramChatId: chatId,
      take: 2,
    });

    if (activities.length === 0) {
      return editMenu({
        env,
        chatId,
        messageId,
        text: "Пока нет тренировок. Сначала подключи Strava через /connect.",
        replyMarkup: getBackToMenuMarkup(),
      });
    }

    const enrichedActivities = await enrichSelectedActivities(
      env,
      chatId,
      activities,
    );
    const summary = buildSelectionSummary(enrichedActivities);

    await addAthleteNote(env, {
      telegramChatId: chatId,
      text: buildSelectionNote({
        title: "Выбранные последние тренировки для разбора:",
        summary,
        activities: enrichedActivities,
      }),
    });

    return editMenu({
      env,
      chatId,
      messageId,
      text: summary,
      replyMarkup: getBackToMenuMarkup(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    return editMenu({
      env,
      chatId,
      messageId,
      text: `Не смог выбрать последние тренировки: ${message}`,
      replyMarkup: getBackToMenuMarkup(),
    });
  }
}

export function sendMainMenu(env: Env, chatId: string) {
  return sendTelegramMessage({
    env,
    chatId,
    text: "Меню бота\n\nВыбери действие кнопкой ниже.",
    replyMarkup: getMainMenuMarkup(),
  });
}

export async function handleTelegramCallback(
  env: Env,
  query: TelegramCallbackQuery,
) {
  await answerTelegramCallback({ env, callbackQueryId: query.id });

  if (!query.message) {
    return;
  }

  const chatId = String(query.message.chat.id);
  const messageId = query.message.message_id;
  const data = query.data ?? "";

  if (data === "m:root") {
    return editMenu({
      env,
      chatId,
      messageId,
      text: "Меню бота\n\nВыбери действие кнопкой ниже.",
      replyMarkup: getMainMenuMarkup(),
    });
  }

  if (data === "m:train") return renderCalendar(env, chatId, messageId);
  if (data === "m:last2") return renderLastTwo(env, chatId, messageId);

  if (data === "m:last") {
    return editMenu({
      env,
      chatId,
      messageId,
      text: "Нажми /last, чтобы получить подробный разбор последней тренировки.",
      replyMarkup: getBackToMenuMarkup(),
    });
  }

  if (data === "m:plan") {
    return editMenu({
      env,
      chatId,
      messageId,
      text: "Нажми /plan, чтобы получить план по последней сохранённой тренировке.",
      replyMarkup: getBackToMenuMarkup(),
    });
  }

  if (data === "m:health") {
    return editMenu({
      env,
      chatId,
      messageId,
      text: "Нажми /health или /today, чтобы посмотреть последнюю Health-сводку.",
      replyMarkup: getBackToMenuMarkup(),
    });
  }

  if (data === "m:gpt") {
    return editMenu({
      env,
      chatId,
      messageId,
      text: "Напиши обычное сообщение без slash-команды, и я отправлю его в GPT с контекстом тренировок и здоровья.",
      replyMarkup: getBackToMenuMarkup(),
    });
  }

  const parts = data.split(":");

  if (parts[0] !== "tr") return;

  if (parts[1] === "d" && parts[2]) {
    return renderDate({ env, chatId, messageId, dateKey: parts[2] });
  }

  if (parts[1] === "t" && parts[2] && parts[3] && parts[4]) {
    const selected = decodeSelection(parts[3]);
    const index = Number(parts[4]);

    if (selected.has(index)) selected.delete(index);
    else selected.add(index);

    return renderDate({
      env,
      chatId,
      messageId,
      dateKey: parts[2],
      selected,
    });
  }

  if (parts[1] === "done" && parts[2] && parts[3]) {
    const selected = decodeSelection(parts[3]);

    if (selected.size === 0) {
      return renderDate({ env, chatId, messageId, dateKey: parts[2] });
    }

    const activities = await getStoredActivities(env, {
      telegramChatId: chatId,
      take: 80,
    });
    const dayActivities = activities.filter((activity) => {
      return formatDateKey(env, activity.startDate) === parts[2];
    });
    const selectedActivities = [...selected]
      .sort((left, right) => left - right)
      .map((index) => dayActivities[index])
      .filter((activity): activity is Activity => Boolean(activity));
    const enrichedActivities = await enrichSelectedActivities(
      env,
      chatId,
      selectedActivities,
    );
    const summary = buildSelectionSummary(enrichedActivities);

    await addAthleteNote(env, {
      telegramChatId: chatId,
      text: buildSelectionNote({
        title: "Выбранные тренировки для разбора:",
        summary,
        activities: enrichedActivities,
      }),
    });

    return editMenu({
      env,
      chatId,
      messageId,
      text: summary,
      replyMarkup: getBackToMenuMarkup(),
    });
  }
}

export async function handleTelegramMessage(
  env: Env,
  message: TelegramMessage,
  requestUrl: string,
) {
  const chatId = String(message.chat.id);
  const text = message.text?.trim();

  if (message.document) {
    return handleFitDocument(env, chatId, message.document);
  }

  if (!text) {
    return;
  }

  const { command, args, rawArgs } = getCommandParts(text);

  if (command === "/start" || command === "/connect") {
    await getOrCreateTelegramAthlete(env, chatId);

    return sendTelegramMessage({
      env,
      chatId,
      text: buildConnectText(requestUrl, chatId),
    });
  }

  if (command === "/menu") return sendMainMenu(env, chatId);
  if (command === "/last") return handleLastCommand(env, chatId, requestUrl);
  if (command === "/plan") return handlePlanCommand(env, chatId);
  if (command === "/health" || command === "/today") {
    return handleHealthCommand(env, chatId);
  }
  if (command === "/ftp") return handleFtpCommand(env, chatId, args[0]);
  if (command === "/weight") return handleWeightCommand(env, chatId, args[0]);
  if (command === "/note") return handleNoteCommand(env, chatId, rawArgs);
  if (command === "/goal") return handleGoalCommand(env, chatId, rawArgs);
  if (command === "/ask") return handleCoachChat(env, chatId, rawArgs);

  if (command.startsWith("/")) {
    return sendTelegramMessage({
      env,
      chatId,
      text: "Команды: /connect, /last, /plan, /health, /ask вопрос, /ftp 285, /weight 82, /goal цель, /note текст. Обычный текст без команды я отправлю в GPT-чат. FIT-файл можно просто прикрепить сообщением.",
    });
  }

  return handleCoachChat(env, chatId, text);
}

export { getRedirectUri };
