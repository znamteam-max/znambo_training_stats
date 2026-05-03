import { getDb } from "@/lib/db";
import {
  addAthleteNote,
  getRecentAthleteNotes,
  getLatestStoredActivity,
  getOrCreateTelegramAthlete,
  processLatestActivity,
} from "@/lib/activity-service";
import {
  buildDailyHealthContext,
  buildDailyHealthSummary,
  getLatestDailyHealthLog,
} from "@/lib/health-service";
import { importTelegramFitFile } from "@/lib/fit-service";
import { askTrainingCoach, OpenAIConfigError } from "@/lib/openai-chat";
import { buildPlanFromStoredActivity } from "@/lib/report";
import { sendMainMenu } from "@/lib/telegram-menu";
import {
  deleteTelegramMessage,
  downloadTelegramFile,
  getTelegramMessageId,
  sendTelegramChatAction,
  sendTelegramMessage,
} from "@/lib/telegram";

type TelegramDocument = {
  file_id: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
};

type TelegramMessage = {
  chat: {
    id: number | string;
  };
  document?: TelegramDocument;
  text?: string;
};

function getAppUrl(requestUrl: string) {
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    new URL(requestUrl).origin
  ).replace(/\/$/, "");

  if (appUrl.startsWith("http://") || appUrl.startsWith("https://")) {
    return appUrl;
  }

  return `https://${appUrl}`;
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

async function handleLastCommand(chatId: string, requestUrl: string) {
  const athlete = await getOrCreateTelegramAthlete(chatId);

  if (!athlete.refreshToken) {
    return sendTelegramMessage({
      chatId,
      text: buildConnectText(requestUrl, chatId),
    });
  }

  const result = await processLatestActivity({ telegramChatId: chatId });

  if (!result) {
    return sendTelegramMessage({
      chatId,
      text: "В Strava нет активностей для разбора. Тут нечего героически анализировать.",
    });
  }

  await getDb().activity.update({
    where: { id: result.activity.id },
    data: { reportSentAt: new Date() },
  });

  return sendTelegramMessage({
    chatId,
    text: result.reportText,
  });
}

async function handlePlanCommand(chatId: string) {
  const latestActivity = await getLatestStoredActivity(chatId);

  if (!latestActivity) {
    return sendTelegramMessage({
      chatId,
      text: "Плана пока нет: сначала подключи Strava и вызови /last, чтобы я видел последнюю тренировку.",
    });
  }

  return sendTelegramMessage({
    chatId,
    text: buildPlanFromStoredActivity(latestActivity),
  });
}

async function handleHealthCommand(chatId: string) {
  const latestHealth = await getLatestDailyHealthLog(chatId);

  return sendTelegramMessage({
    chatId,
    text: buildDailyHealthSummary(latestHealth),
  });
}

async function handleFtpCommand(chatId: string, value: string | undefined) {
  const ftp = Number(value);

  if (!Number.isInteger(ftp) || ftp < 100 || ftp > 600) {
    return sendTelegramMessage({
      chatId,
      text: "FTP укажи нормально: например /ftp 285.",
    });
  }

  await getOrCreateTelegramAthlete(chatId);
  await getDb().athlete.updateMany({
    where: { telegramChatId: chatId },
    data: { ftpWatts: ftp },
  });

  return sendTelegramMessage({
    chatId,
    text: `FTP обновил: ${ftp} W. Теперь отчёты будут считать зоны от него.`,
  });
}

async function handleWeightCommand(chatId: string, value: string | undefined) {
  const weight = Number(value);

  if (!Number.isFinite(weight) || weight < 40 || weight > 150) {
    return sendTelegramMessage({
      chatId,
      text: "Вес укажи нормально: например /weight 82.",
    });
  }

  await getOrCreateTelegramAthlete(chatId);
  await getDb().athlete.updateMany({
    where: { telegramChatId: chatId },
    data: { weightKg: weight },
  });

  return sendTelegramMessage({
    chatId,
    text: `Вес обновил: ${weight} кг.`,
  });
}

async function handleNoteCommand(chatId: string, text: string) {
  if (!text) {
    return sendTelegramMessage({
      chatId,
      text: "Заметку пиши после команды: /note сон 6 часов, ноги тяжёлые.",
    });
  }

  await addAthleteNote({ telegramChatId: chatId, text });

  return sendTelegramMessage({
    chatId,
    text: "Заметку сохранил. Это пригодится для следующего плана.",
  });
}

function startTypingIndicator(chatId: string) {
  void sendTelegramChatAction({ chatId }).catch(() => undefined);

  const timer = setInterval(() => {
    void sendTelegramChatAction({ chatId }).catch(() => undefined);
  }, 4000);

  return () => clearInterval(timer);
}

async function sendThinkingMessage(chatId: string, text = "Думаю") {
  const payload = await sendTelegramMessage({
    chatId,
    text,
  }).catch(() => null);

  return getTelegramMessageId(payload);
}

async function deleteThinkingMessage(chatId: string, messageId: number | null) {
  if (!messageId) {
    return;
  }

  await deleteTelegramMessage({
    chatId,
    messageId,
  }).catch(() => undefined);
}

function isFitDocument(document: TelegramDocument) {
  const fileName = document.file_name?.toLowerCase() ?? "";

  return fileName.endsWith(".fit");
}

async function handleFitDocument(chatId: string, document: TelegramDocument) {
  if (!isFitDocument(document)) {
    return sendTelegramMessage({
      chatId,
      text: "Файл вижу, но пока умею читать только .fit. Пришли тренировку именно FIT-файлом.",
    });
  }

  if (document.file_size && document.file_size > 25 * 1024 * 1024) {
    return sendTelegramMessage({
      chatId,
      text: "FIT-файл слишком большой для быстрой обработки в боте. Лучше отправь файл до 25 МБ.",
    });
  }

  const stopTyping = startTypingIndicator(chatId);
  const thinkingMessageId = await sendThinkingMessage(chatId, "Разбираю FIT");

  try {
    const fileName = document.file_name ?? "activity.fit";
    const fileBuffer = await downloadTelegramFile(document.file_id);
    const result = await importTelegramFitFile({
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
      chatId,
      text: `Не смог разобрать FIT-файл: ${message}`,
    });
  } finally {
    stopTyping();
    await deleteThinkingMessage(chatId, thinkingMessageId);
  }
}

async function handleCoachChat(chatId: string, text: string) {
  if (!text) {
    return sendTelegramMessage({
      chatId,
      text: "Напиши вопрос после /ask или просто отправь обычное сообщение.",
    });
  }

  const stopTyping = startTypingIndicator(chatId);
  const thinkingMessageId = await sendThinkingMessage(chatId);

  try {
    const latestActivity = await getLatestStoredActivity(chatId);
    const latestHealth = await getLatestDailyHealthLog(chatId);
    const notes = await getRecentAthleteNotes({
      telegramChatId: chatId,
      take: 3,
    });
    const answer = await askTrainingCoach({
      question: text,
      latestReportText: latestActivity?.reportText,
      latestHealthText: buildDailyHealthContext(latestHealth),
      latestNotesText: notes.map((note) => note.text).join("\n\n"),
    });

    return await sendTelegramMessage({
      chatId,
      text: answer,
    });
  } catch (error) {
    if (error instanceof OpenAIConfigError) {
      return await sendTelegramMessage({
        chatId,
        text: "GPT-чат ещё не включён. Добавь OPENAI_API_KEY в Vercel Environment Variables и сделай redeploy.",
      });
    }

    const message = error instanceof Error ? error.message : "unknown error";

    return await sendTelegramMessage({
      chatId,
      text: `GPT сейчас не ответил: ${message}`,
    });
  } finally {
    stopTyping();
    await deleteThinkingMessage(chatId, thinkingMessageId);
  }
}

export async function handleTelegramMessage(
  message: TelegramMessage,
  requestUrl: string,
) {
  const chatId = String(message.chat.id);
  const text = message.text?.trim();

  if (message.document) {
    return handleFitDocument(chatId, message.document);
  }

  if (!text) {
    return;
  }

  const { command, args, rawArgs } = getCommandParts(text);

  if (command === "/start" || command === "/connect") {
    await getOrCreateTelegramAthlete(chatId);

    return sendTelegramMessage({
      chatId,
      text: buildConnectText(requestUrl, chatId),
    });
  }

  if (command === "/menu") {
    return sendMainMenu(chatId);
  }

  if (command === "/last") {
    return handleLastCommand(chatId, requestUrl);
  }

  if (command === "/plan") {
    return handlePlanCommand(chatId);
  }

  if (command === "/health" || command === "/today") {
    return handleHealthCommand(chatId);
  }

  if (command === "/ftp") {
    return handleFtpCommand(chatId, args[0]);
  }

  if (command === "/weight") {
    return handleWeightCommand(chatId, args[0]);
  }

  if (command === "/note") {
    return handleNoteCommand(chatId, rawArgs);
  }

  if (command === "/ask") {
    return handleCoachChat(chatId, rawArgs);
  }

  if (command.startsWith("/")) {
    return sendTelegramMessage({
      chatId,
      text: "Команды: /connect, /last, /plan, /health, /ask вопрос, /ftp 285, /weight 82, /note текст. Обычный текст без команды я отправлю в GPT-чат. FIT-файл можно просто прикрепить сообщением.",
    });
  }

  return handleCoachChat(chatId, text);
}
