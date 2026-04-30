import { getDb } from "@/lib/db";
import { processLatestActivity } from "@/lib/activity-service";
import { sendTelegramMessage } from "@/lib/telegram";

export async function sendLatestReportIfNeeded(input?: {
  telegramChatId?: string;
  stravaAthleteId?: bigint;
}) {
  const result = await processLatestActivity(input);

  if (!result) {
    return { sent: false, reason: "no-activity" };
  }

  if (result.activity.reportSentAt) {
    return {
      sent: false,
      reason: "already-sent",
      activityId: result.activity.id,
    };
  }

  const chatId = result.athlete.telegramChatId ?? process.env.TELEGRAM_CHAT_ID;

  if (!chatId) {
    return {
      sent: false,
      reason: "no-telegram-chat",
      activityId: result.activity.id,
    };
  }

  await sendTelegramMessage({
    chatId,
    text: result.reportText,
  });

  await getDb().activity.update({
    where: { id: result.activity.id },
    data: { reportSentAt: new Date() },
  });

  return {
    sent: true,
    activityId: result.activity.id,
  };
}
