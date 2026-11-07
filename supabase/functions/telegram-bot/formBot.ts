// The form bot's Telegram client (ExcelFormAgent) — its own module so form.ts and orderChat.ts share it
import { telegramBot } from './telegram.ts';

export const formBot = telegramBot(Deno.env.get('TELEGRAM_FORM_BOT_TOKEN') ?? '');
