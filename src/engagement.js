import { getPoll, putPoll, getPost, putPost, getJson, putJson, ticketAppendUser, putUser } from './kv.js';
import { entityKey, commitJson } from './storage.js';
import { tgApi, sendToUser } from './bot-api.js';
import { text as tr, enabled } from './config.js';
import { membershipGate, sendMembershipLock } from './gate.js';
import { rewardWrites } from './crm.js';

export function renderPollText(poll) {
  const votes = poll.opts.reduce((a, o) => a + (o.n || 0), 0), total = poll.participants ?? votes;
  return `📊 ${poll.q}\n\n${poll.opts.map(o => { const pct = votes ? Math.round((o.n || 0) * 100 / votes) : 0; return `${o.label}\n${'█'.repeat(Math.round(pct / 10))}${'░'.repeat(10 - Math.round(pct / 10))} ${pct}% (${o.n || 0})`; }).join('\n\n')}\n\n🗳 ${total}${poll.mode === 'quiz' ? ' · Quiz' : ''}${poll.closesAt ? '\n⏳ ' + new Date(poll.closesAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : ''}`;
}
export function pollKeyboard(poll) {
  return { inline_keyboard: [...poll.opts.map((o, i) => [{ text: o.label, callback_data: `poll:${poll.id}:${i}` }]), [{ text: '🔄', callback_data: `poll:${poll.id}:r` }]] };
}
export const sendPollToChat = (token, chatId, poll) => sendToUser(token, chatId, renderPollText(poll), { reply_markup: pollKeyboard(poll) });
export function reactMarkup(post, settings) {
  const rows = post.buttons || [];
  // Callback reactions (counts in label so meaning survives without color/emoji-only).
  const reactions = post.reactions !== false ? [[{ text: `👍 ${post.likes || 0} پسند`, callback_data: `react:${post.id}:l` }, { text: `👎 ${post.dislikes || 0}`, callback_data: `react:${post.id}:d` }]] : [];
  const username = settings?.botUsername || post.botUsername;
  if (post.feedback && username) reactions.push([{ text: '💬 نظر / Feedback', url: `https://t.me/${username}?start=fb_${post.id}` }]);
  return { inline_keyboard: [...rows, ...reactions] };
}
// Native Telegram reaction (setMessageReaction). Best-effort: never throws,
// old clients and non-reactable messages just ignore it. Bots can't use paid
// reactions; service messages can't be reacted to.
export async function nativeReact(token, chatId, messageId, emoji = '🔥') {
  try {
    if (!token || !chatId || !messageId) return;
    await tgApi(token, 'setMessageReaction', {
      chat_id: chatId, message_id: messageId,
      reaction: [{ type: 'emoji', emoji }],
    });
  } catch { /* best-effort only */ }
}
export async function engagementCallback(env, token, user, settings, lang, cb) {
  const data = String(cb.data || ''), [cmd, pid, act] = data.split(':');
  if (!['poll', 'react'].includes(cmd) || !enabled(settings, 'broadcast')) return false;
  const answer = (message, alert = false) => tgApi(token, 'answerCallbackQuery', { callback_query_id: cb.id, text: message, show_alert: alert });
  const chatId = cb.message?.chat.id, messageId = cb.message?.message_id;
  const poll = cmd === 'poll' ? await getPoll(env, pid) : await getPost(env, pid);
  if (!poll) { await answer(tr('این پست دیگر در دسترس نیست.', 'This post is unavailable.', lang), true); return true; }
  const gate = await membershipGate(env, token, user, settings, poll.membersOnly ? (poll.requiredChats || []) : []);
  if (!gate.ok) { await sendMembershipLock(token, chatId, gate, lang, user.id); await answer(tr('عضویت لازم است.', 'Membership required.', lang), true); return true; }
  const voteKey = entityKey('vote', `${cmd}:${pid}:${user.id}`);
  let previous = await getJson(env, voteKey);
  if (previous === null && poll.voters?.[user.id] !== undefined) previous = poll.voters[user.id];
  if (cmd === 'poll') {
    if (poll.closesAt && poll.closesAt <= Date.now() && act !== 'r') { await answer(tr('مهلت رأی دادن تمام شده است.', 'Voting has closed.', lang), true); return true; }
    if (act !== 'r') {
      const choice = Number(act);
      if (!Number.isInteger(choice) || choice < 0 || choice >= poll.opts.length) { await answer(''); return true; }
      if (poll.mode === 'quiz' && previous !== null) { await answer(tr('پاسخ مسابقه قابل تغییر نیست.', 'Quiz answers cannot be changed.', lang)); return true; }
      if (poll.mode === 'multiple') {
        const prev = Array.isArray(previous) ? previous : [];
        if (prev.includes(choice)) { poll.opts[choice].n = Math.max(0, poll.opts[choice].n - 1); previous = prev.filter(i => i !== choice); }
        else { poll.opts[choice].n++; previous = [...prev, choice]; }
        poll.participants = Math.max(0, (poll.participants || 0) + (!prev.length && previous.length ? 1 : prev.length && !previous.length ? -1 : 0));
      } else {
        if (previous === choice) { await answer(tr('قبلاً این گزینه را انتخاب کرده‌اید.', 'You already chose this option.', lang)); return true; }
        if (previous !== null && poll.opts[previous]) poll.opts[previous].n = Math.max(0, poll.opts[previous].n - 1);
        if (previous === null) poll.participants = (poll.participants || 0) + 1;
        poll.opts[choice].n++; previous = choice;
      }
      const writes = [[voteKey, previous], ['poll:' + poll.id, poll]];
      if (poll.mode === 'quiz' && choice === poll.correctIndex && enabled(settings, 'crm') && settings.loyalty.enabled) writes.push(...await rewardWrites(env, user.id, poll.rewardPoints ?? 1, `quiz:${pid}:${user.id}`, 'quiz'));
      await commitJson(env, writes);
      if (poll.mode === 'quiz') {
        const correct = choice === poll.correctIndex;
        await answer(correct ? tr('✅ پاسخ صحیح!', '✅ Correct!', lang) : tr('پاسخ نادرست بود.', 'Incorrect answer.', lang), true);
      } else await answer(tr('✅ رأی ثبت شد.', '✅ Vote recorded.', lang));
    } else await answer(tr('نتایج به‌روز شد.', 'Results refreshed.', lang));
    if (chatId && messageId) await tgApi(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text: renderPollText(poll), reply_markup: pollKeyboard(poll) });
  } else {
    if (poll.reactions === false || !['l', 'd'].includes(act)) { await answer(''); return true; }
    if (previous === 'l') poll.likes = Math.max(0, (poll.likes || 0) - 1);
    if (previous === 'd') poll.dislikes = Math.max(0, (poll.dislikes || 0) - 1);
    const value = previous === act ? null : act;
    if (value === 'l') poll.likes = (poll.likes || 0) + 1;
    if (value === 'd') poll.dislikes = (poll.dislikes || 0) + 1;
    // Remove a migrated legacy vote only after its new record was committed.
    if (poll.voters) delete poll.voters[user.id];
    await commitJson(env, [[voteKey, value], ['post:' + poll.id, poll]]);
    await answer(tr('✅ ثبت شد.', '✅ Recorded.', lang));
    if (chatId && messageId) await tgApi(token, 'editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: reactMarkup(poll, settings) });
  }
  return true;
}
