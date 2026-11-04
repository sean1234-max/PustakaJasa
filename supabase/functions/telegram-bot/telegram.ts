// Telegram Bot API calls the bots need: reply, register the webhook, fetch a sent file, send a file
// back, check group membership. One per bot token (the review bot and the form bot).

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // the Bot API won't hand over bigger files
const MAX_MESSAGE_CHARS = 4000;                 // Telegram's limit is 4096
const MEMBER_STATUSES = ['creator', 'administrator', 'member', 'restricted'];

export const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function telegramBot(token: string) {
  const api = `https://api.telegram.org/bot${token}`;

  // The webhook's secret: derived from the bot token, so there is no second secret to keep
  async function webhookSecret() {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pj-webhook:${token}`));
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function reply(chatId: number | string, replyTo: number, html: string) {
    const text = html.length > MAX_MESSAGE_CHARS ? `${html.slice(0, MAX_MESSAGE_CHARS)}\n…` : html;
    const res = await fetch(`${api}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } }),
    });
    if (!res.ok) console.error('Telegram sendMessage failed:', res.status, (await res.text()).slice(0, 300));
  }

  async function sendDocument(chatId: number | string, replyTo: number, bytes: Uint8Array, fileName: string, captionHtml: string) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('document', new Blob([bytes]), fileName);
    form.append('caption', captionHtml.slice(0, 1000)); // Telegram's caption limit is 1024
    form.append('parse_mode', 'HTML');
    form.append('reply_parameters', JSON.stringify({ message_id: replyTo, allow_sending_without_reply: true }));
    const res = await fetch(`${api}/sendDocument`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Telegram sendDocument ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  async function setWebhook(url: string) {
    const res = await fetch(`${api}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, secret_token: await webhookSecret(), allowed_updates: ['message'] }),
    });
    return res.json();
  }

  async function downloadFile(fileId: string): Promise<Uint8Array> {
    const info = await (await fetch(`${api}/getFile?file_id=${encodeURIComponent(fileId)}`)).json();
    if (!info.ok) throw new Error(`Telegram getFile: ${info.description}`);
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${info.result.file_path}`);
    if (!res.ok) throw new Error(`Telegram file download ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  // Is this person in one of these groups? (the bot must be in the group to see it)
  async function inAnyGroup(userId: number, chatIds: string[]) {
    for (const chatId of chatIds) {
      const res = await (await fetch(`${api}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${userId}`)).json();
      if (res.ok && MEMBER_STATUSES.includes(res.result?.status)) return true;
    }
    return false;
  }

  return { webhookSecret, reply, sendDocument, setWebhook, downloadFile, inAnyGroup };
}
