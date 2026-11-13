// Cloudflare Worker + Durable Object. Holds the bot token, so nothing secret ever reaches the browser.
const QUESTIONS = [
  'Tell us about yourself and why you want to work abroad.',
  'Why this company, and how will you adapt to our culture and time zones?',
  'How do you handle cross-cultural communication in a remote team?',
  'Describe a complex challenge you managed and what you learned.',
];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };

const tg = (env, method, body) =>
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, body instanceof FormData
    ? { method: 'POST', body }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  ).then(r => r.json());

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const u = new URL(req.url), P = u.pathname.split('/').filter(Boolean);
    const room = n => env.ROOM.get(env.ROOM.idFromName(n));
    let res;
    if (P[0] === 's' && P[1]) {
      res = await room(P[1]).fetch(new Request(`https://r/${P[2] || ''}${u.search}`, req));
    } else if (P[0] === 'tg' && req.method === 'POST') {
      if (req.headers.get('x-telegram-bot-api-secret-token') !== env.SECRET) return new Response('no', { status: 403 });
      await onUpdate(await req.json(), env, room);
      res = new Response('ok');
    } else if (P[0] === 'create' && req.method === 'POST') {
      if (req.headers.get('x-key') !== env.ADMIN_KEY) res = new Response('{"error":"Wrong access key"}', { status: 403 });
      else {
        const d = await req.json();
        const id = await create(d, env, room);
        await tg(env, 'sendMessage', { chat_id: env.OWNER_CHAT_ID, text: `🆕 Session ready for ${d.name}\n${env.SITE}/?s=${id}\n\nA live panel will appear here when they join.` });
        res = Response.json({ id });
      }
    } else res = new Response('ok');
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
    return out;
  },
};

async function create(d, env, room, owner = env.OWNER_CHAT_ID) {
  const id = Math.random().toString(36).slice(2, 8);
  const c = k => String(d[k] || '').slice(0, 120);
  const s = { id, owner, name: c('name'), pos: c('pos'), company: c('company'), address: c('address'), rep: c('rep'), logo: String(d.logo || '').slice(0, 40000) };
  await room(id).fetch('https://r/init', { method: 'POST', body: JSON.stringify(s) });
  await room('_').fetch('https://r/active', { method: 'POST', body: JSON.stringify({ id }) });
  return id;
}

async function onUpdate(u, env, room) {
  const cb = u.callback_query, m = u.message;
  const chat = cb ? cb.message.chat.id : m?.chat.id;
  if (String(chat) !== env.OWNER_CHAT_ID) return;          // only the interviewer can control sessions
  const post = (id, p, b) => room(id).fetch(`https://r/${p}`, { method: 'POST', body: JSON.stringify(b) });
  const reply = text => tg(env, 'sendMessage', { chat_id: chat, text });

  if (cb) {                                                // inline-button press
    const [id, a] = cb.data.split('|');
    const cmd = a === 'rep' ? { t: 'rep' } : a === 'end' ? { t: 'end' } : { t: 'q', text: QUESTIONS[+a.slice(1)] };
    await post(id, 'cmd', cmd);
    return tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Sent ✓' });
  }
  const t = m?.text?.trim();
  if (!t) return;
  if (t.startsWith('/new')) {
    const [name, pos, company] = t.slice(4).split('|').map(s => s.trim());
    if (!name) return reply('Usage: /new Candidate Name | Position | Company');
    const id = await create({ name, pos, company }, env, room, chat);
    return reply(`Link for ${name}:\n${env.SITE}/?s=${id}\n\nWhen they join, a live panel appears here. Type any message to ask a custom question.`);
  }
  const { id } = await (await room('_').fetch('https://r/active')).json();
  if (!id) return reply('Start a session first: /new Name | Position | Company');
  await post(id, 'cmd', { t: 'q', text: t });              // plain text = custom question
}

export class Room {
  constructor(c, env) { this.c = c; this.env = env; }

  async fetch(req) {
    const url = new URL(req.url), p = url.pathname.slice(1), q = url.searchParams, e = this.env;
    if (p === 'active') {
      if (req.method === 'POST') await this.c.storage.put('a', (await req.json()).id);
      return Response.json({ id: await this.c.storage.get('a') });
    }
    if (p === 'init') {
      this.s = { ...(await req.json()), seq: 0 };
      await this.c.storage.put('s', this.s);
      return Response.json({ ok: 1 });
    }
    this.s ??= await this.c.storage.get('s');
    const s = this.s;
    if (!s) return new Response('not found', { status: 404 });
    const save = () => this.c.storage.put('s', s);

    if (p === 'info') return Response.json({ name: s.name, pos: s.pos, company: s.company, address: s.address, rep: s.rep, logo: s.logo, done: !!s.done });

    if (p === 'cmd') {
      const c = await req.json();
      s.seq++; s.cmd = c;
      if (c.t === 'q') s.cur = c.text;
      if (c.t === 'end') { s.done = 1; await tg(e, 'sendMessage', { chat_id: s.owner, text: `✅ Interview with ${s.name} ended.` }); }
      await save();
      return Response.json({ ok: 1 });
    }

    if (p === 'poll') {                                    // long-poll: held open up to 20s
      const n = +q.get('n');
      for (let i = 0; i < 40 && s.seq <= n; i++) await new Promise(r => setTimeout(r, 500));
      return Response.json({ seq: s.seq, cmd: s.seq > n ? s.cmd : null });
    }

    const type = req.headers.get('content-type') || 'image/jpeg';
    const blob = new Blob([await req.arrayBuffer()], { type });
    const f = new FormData();
    f.append('chat_id', s.owner);

    if (p === 'video') {                                   // recorded answer → Telegram
      const mp4 = type.includes('mp4');
      f.append(mp4 ? 'video' : 'document', blob, `${s.name}-Q${+q.get('q') + 1}.${mp4 ? 'mp4' : 'webm'}`);
      f.append('caption', `🎬 ${s.name} — Q${+q.get('q') + 1}: ${q.get('t')}`.slice(0, 1000));
      await tg(e, mp4 ? 'sendVideo' : 'sendDocument', f);
      return Response.json({ ok: 1 });
    }

    if (p === 'frame' && !s.done) {                        // live snapshot → one self-updating Telegram message
      const caption = `🔴 LIVE · ${s.name}\n${s.cur ? 'Asked: ' + s.cur : 'No question sent yet'}`;
      f.append('reply_markup', JSON.stringify({ inline_keyboard: [
        QUESTIONS.map((_, i) => ({ text: `Q${i + 1}`, callback_data: `${s.id}|q${i}` })),
        [{ text: '🔁 Repeat', callback_data: `${s.id}|rep` }, { text: '⏹ End', callback_data: `${s.id}|end` }],
      ] }));
      if (!s.msg) {
        f.append('photo', blob, 'f.jpg'); f.append('caption', caption);
        s.msg = (await tg(e, 'sendPhoto', f)).result?.message_id;
        await save();
      } else {
        f.append('message_id', s.msg);
        f.append('media', JSON.stringify({ type: 'photo', media: 'attach://f', caption }));
        f.append('f', blob, 'f.jpg');
        await tg(e, 'editMessageMedia', f);
      }
    }
    return Response.json({ ok: 1 });
  }
}
