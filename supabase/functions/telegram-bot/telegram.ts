// Telegram Bot API calls the bots need: reply, register the webhook, fetch a sent file, send a file
// back, check group membership. One per bot token (the review bot and the form bot).

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // the Bot API won't hand over bigger files
const MAX_MESSAGE_CHARS = 4000;                 // Telegram's limit is 4096
const MEMBER_STATUSES = ['creator', 'administrator', 'member', 'restricted'];

export const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// `onMigrate(oldId, newId)`: a group became a supergroup (its id changed, Sean 2026-11-09: Keith's group) —
// a message to the old id is sent to the new one, and the caller saves the new id.
export function telegramBot(token: string, opts: { onMigrate?: (oldId: number, newId: number) => Promise<void> } = {}) {
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

  // A message with buttons under it (rows of [label, callback data ≤ 64 bytes]); returns its message_id
  async function ask(chatId: number | string, replyTo: number | null, html: string, buttons: [string, string][][] = []): Promise<number | null> {
    const text = html.length > MAX_MESSAGE_CHARS ? `${html.slice(0, MAX_MESSAGE_CHARS)}\n…` : html;
    const send = (to: number | string) => fetch(`${api}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: to, text, parse_mode: 'HTML', disable_web_page_preview: true,
        ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
        ...(buttons.length ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map(([label, data]) => ({ text: label, callback_data: data }))) } } : {}),
      }),
    });
    let res = await send(chatId);
    let body = await res.json().catch(() => null);
    const moved = body?.parameters?.migrate_to_chat_id;
    if (!body?.ok && moved) {
      if (opts.onMigrate) await opts.onMigrate(Number(chatId), Number(moved)).catch((err) => console.error('saving the new group id failed:', err));
      res = await send(moved);
      body = await res.json().catch(() => null);
    }
    if (!res.ok || !body?.ok) { console.error('Telegram sendMessage failed:', res.status, JSON.stringify(body).slice(0, 300)); return null; }
    return body.result.message_id as number;
  }

  // A tapped button: stop its spinner (with a short note), and take the buttons off that message
  async function answerButton(callbackId: string, note = '') {
    await fetch(`${api}/answerCallbackQuery`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId, text: note.slice(0, 190) }),
    }).catch(() => {});
  }
  // A message's text changed in place (its buttons go)
  async function editText(chatId: number | string, messageId: number, html: string) {
    await fetch(`${api}/editMessageText`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: html.slice(0, MAX_MESSAGE_CHARS), parse_mode: 'HTML', disable_web_page_preview: true }),
    }).catch(() => {});
  }
  async function dropButtons(chatId: number | string, messageId: number) {
    await fetch(`${api}/editMessageReplyMarkup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }),
    }).catch(() => {});
  }

  // -> the sent message's id and its file's id (to be sent back to the bot later)
  async function sendDocument(chatId: number | string, replyTo: number, bytes: Uint8Array, fileName: string, captionHtml: string): Promise<{ messageId: number; fileId: string } | null> {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('document', new Blob([bytes]), fileName);
    form.append('caption', captionHtml.slice(0, 1000)); // Telegram's caption limit is 1024
    form.append('parse_mode', 'HTML');
    form.append('reply_parameters', JSON.stringify({ message_id: replyTo, allow_sending_without_reply: true }));
    const res = await fetch(`${api}/sendDocument`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Telegram sendDocument ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const sent = (await res.json().catch(() => null))?.result;
    return sent ? { messageId: sent.message_id, fileId: sent.document?.file_id ?? '' } : null;
  }

  // Telegram keeps a webhook's old settings when its URL is the same ("Webhook is already set") — buttons never
  // arrived (Sean, 2026-11-10) — so the old one is removed first and set again with today's settings
  async function setWebhook(url: string) {
    await fetch(`${api}/deleteWebhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ drop_pending_updates: false }) }).catch(() => {});
    const res = await fetch(`${api}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // buttons (callback_query): the form bot's order Submit / answers (Sean, 2026-11-07)
      body: JSON.stringify({ url, secret_token: await webhookSecret(), allowed_updates: ['message', 'callback_query'] }),
    });
    const set = await res.json();
    // what Telegram has now — `allowed_updates` must list callback_query for the buttons
    const info = await (await fetch(`${api}/getWebhookInfo`)).json().catch(() => null);
    return { ...set, allowed_updates: info?.result?.allowed_updates ?? null, last_error: info?.result?.last_error_message ?? null };
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

  // The group's admins (people only, not bots)
  async function adminIds(chatId: number | string): Promise<number[]> {
    const res = await (await fetch(`${api}/getChatAdministrators?chat_id=${encodeURIComponent(chatId)}`)).json();
    return res.ok ? (res.result as { user: { id: number; is_bot: boolean } }[]).filter((m) => !m.user.is_bot).map((m) => m.user.id) : [];
  }

  return { webhookSecret, reply, ask, answerButton, editText, dropButtons, sendDocument, setWebhook, downloadFile, inAnyGroup, adminIds };
}
