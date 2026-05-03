import { getDb } from "@/lib/db";
import {
  getLatestStoredActivity,
  getOrCreateTelegramAthlete,
  processLatestActivity,
} from "@/lib/activity-service";
import {
  buildDailyHealthContext,
  buildDailyHealthSummary,
  getLatestDailyHealthLog,
} from "@/lib/health-service";
import { askTrainingCoach, OpenAIConfigError } from "@/lib/openai-chat";
import { buildPlanFromStoredActivity } from "@/lib/report";
import { sendMainMenu } from "@/lib/telegram-menu";
import { sendTelegramMessage } from "@/lib/telegram";

type TelegramMessage = {
  chat: {
    id: number | string;
  };
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
  const athlete = await getOrCreateTelegramAthlete(chatId);

  if (!text) {
    return sendTelegramMessage({
      chatId,
      text: "Заметку пиши после команды: /note сон 6 часов, ноги тяжёлые.",
    });
  }

  await getDb().athleteNote.create({
    data: {
      athleteId: athlete.id,
      text,
    },
  });

  return sendTelegramMessage({
    chatId,
    text: "Заметку сохранил. Это пригодится для следующего плана.",
  });
}

async function handleCoachChat(chatId: string, text: string) {
  if (!text) {
    return sendTelegramMessage({
      chatId,
      text: "Напиши вопрос после /ask или просто отправь обычное сообщение.",
    });
  }

  const latestActivity = await getLatestStoredActivity(chatId);
  const latestHealth = await getLatestDailyHealthLog(chatId);

  try {
    const answer = await askTrainingCoach({
      question: text,
      latestReportText: latestActivity?.reportText,
      latestHealthText: buildDailyHealthContext(latestHealth),
    });

    return sendTelegramMessage({
      chatId,
      text: answer,
    });
  } catch (error) {
    if (error instanceof OpenAIConfigError) {
      return sendTelegramMessage({
        chatId,
        text: "GPT-чат ещё не включён. Добавь OPENAI_API_KEY в Vercel Environment Variables и сделай redeploy.",
      });
    }

    const message = error instanceof Error ? error.message : "unknown error";

    return sendTelegramMessage({
      chatId,
      text: `GPT сейчас не ответил: ${message}`,
    });
  }
}

export async function handleTelegramMessage(
  message: TelegramMessage,
  requestUrl: string,
) {
  const text = message.text?.trim();
  const chatId = String(message.chat.id);

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
      text: "Команды: /connect, /last, /plan, /health, /ask вопрос, /ftp 285, /weight 82, /note текст. Обычный текст без команды я отправлю в GPT-чат.",
    });
  }

  return handleCoachChat(chatId, text);
}
