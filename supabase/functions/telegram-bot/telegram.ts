// Telegram Bot API calls the bot needs: reply, register the webhook, fetch a sent file.

const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const API = `https://api.telegram.org/bot${TOKEN}`;
export const MAX_FILE_BYTES = 20 * 1024 * 1024; // the Bot API won't hand over bigger files
const MAX_MESSAGE_CHARS = 4000;                 // Telegram's limit is 4096

export const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The webhook's secret: derived from the bot token, so there is no second secret to keep
export async function webhookSecret() {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pj-webhook:${TOKEN}`));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function reply(chatId: number | string, replyTo: number, html: string) {
  const text = html.length > MAX_MESSAGE_CHARS ? `${html.slice(0, MAX_MESSAGE_CHARS)}\n…` : html;
  const res = await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } }),
  });
  if (!res.ok) console.error('Telegram sendMessage failed:', res.status, (await res.text()).slice(0, 300));
}

export async function setWebhook(url: string) {
  const res = await fetch(`${API}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, secret_token: await webhookSecret(), allowed_updates: ['message'] }),
  });
  return res.json();
}

export async function downloadFile(fileId: string): Promise<Uint8Array> {
  const info = await (await fetch(`${API}/getFile?file_id=${encodeURIComponent(fileId)}`)).json();
  if (!info.ok) throw new Error(`Telegram getFile: ${info.description}`);
  const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${info.result.file_path}`);
  if (!res.ok) throw new Error(`Telegram file download ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
