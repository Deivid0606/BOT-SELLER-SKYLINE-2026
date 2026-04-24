// api/webhook.js — WhatsApp Cloud API (Meta)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GRAPH_VERSION = 'v21.0';

export default async function handler(req, res) {
  // ============ GET: Verificación de webhook (Meta handshake) ============
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('[WEBHOOK GET] mode:', mode, 'token:', token);

    const { data: cfg } = await supabase
      .from('whatsapp_config')
      .select('webhook_token')
      .eq('webhook_token', token)
      .maybeSingle();

    if (mode === 'subscribe' && cfg) {
      console.log('[WEBHOOK GET] ✅ Verificado');
      return res.status(200).send(challenge);
    }
    console.error('[WEBHOOK GET] ❌ Token inválido');
    return res.status(403).send('Forbidden');
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  console.log('[WEBHOOK POST] Body:', JSON.stringify(req.body));

  // Responder 200 INMEDIATO a Meta (sino reintenta y desactiva el webhook)
  res.status(200).json({ ok: true });

  try {
    const body = req.body || {};
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        const value = change.value || {};
        const phoneNumberId = value.metadata?.phone_number_id;
        const messages = value.messages || [];

        if (!phoneNumberId || messages.length === 0) continue;

        // Buscar el user dueño de este phone_number_id
        const { data: cfg } = await supabase
          .from('whatsapp_config')
          .select('user_id, permanent_token')
          .eq('phone_number_id', phoneNumberId)
          .maybeSingle();

        if (!cfg) {
          console.error('[WEBHOOK] No config for phone_number_id:', phoneNumberId);
          continue;
        }

        for (const msg of messages) {
          await processMessage(msg, cfg.user_id, phoneNumberId, cfg.permanent_token);
        }
      }
    }
  } catch (err) {
    console.error('[WEBHOOK] Error:', err);
  }
}

// ============ PROCESAR UN MENSAJE ============
async function processMessage(msg, userId, phoneNumberId, accessToken) {
  const from = msg.from;
  const messageId = msg.id;
  const messageType = msg.type;
  let text = '';
  let mediaRef = null;

  if (messageType === 'text') text = msg.text?.body || '';
  else if (messageType === 'button') text = msg.button?.text || '';
  else if (messageType === 'interactive') {
    text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
  } else if (['image','video','audio','document'].includes(messageType)) {
    text = msg[messageType]?.caption || `[${messageType}]`;
    mediaRef = msg[messageType]?.id || null;
  }

  // 1) Guardar entrante
  const { data: savedMsg } = await supabase
    .from('inbox_messages')
    .insert({
      user_id: userId,
      source: 'whatsapp',
      platform: 'whatsapp',
      sender_id: from,
      from_number: from,
      message: text,
      media_url_text: mediaRef,
      message_type: messageType,
      wa_message_id: messageId,
      is_read: false,
      is_processed: false,
    })
    .select().single();

  // 2) Detectar primer mensaje
  const { count: prevCount } = await supabase
    .from('inbox_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('sender_id', from).eq('source', 'whatsapp');
  const isFirst = (prevCount || 0) <= 1;

  // 3) Buscar triggers
  const { data: triggers } = await supabase
    .from('triggers').select('*')
    .eq('user_id', userId).eq('active', true);

  let matched = null;
  if (triggers?.length) {
    if (isFirst) {
      matched = triggers.find(t =>
        (t.type || '').toLowerCase().includes('welcome') ||
        (t.type || '').toLowerCase().includes('bienvenida'));
    }
    if (!matched && text) {
      const lower = text.toLowerCase();
      matched = triggers.find(t => {
        if (!t.condition) return false;
        const kws = String(t.condition).toLowerCase()
          .split(/[,;|\n]+/).map(k => k.trim()).filter(Boolean);
        return kws.some(k => lower.includes(k));
      });
    }
  }

  let replyText = null;

  if (matched) {
    console.log('[WEBHOOK] Trigger matched:', matched.name);

    if (matched.template) {
      await sendTemplateByName(matched.template, from, userId, phoneNumberId, accessToken);
    } else if (matched.response) {
      replyText = matched.response;
      await sendText(from, replyText, phoneNumberId, accessToken);
    }

    if (matched.auto_tag && savedMsg?.id) {
      await applyAutoTag(matched.auto_tag, savedMsg.id, userId);
    }

    if (matched.follow_up_enabled && matched.follow_up_minutes && matched.follow_up_message) {
      const scheduledAt = new Date(Date.now() + matched.follow_up_minutes * 60000).toISOString();
      await supabase.from('followup_queue').insert({
        user_id: userId, sender_id: from,
        message: matched.follow_up_message,
        scheduled_at: scheduledAt, status: 'pending',
      });
    }

    await supabase.from('trigger_logs').insert({
      user_id: userId, trigger_id: matched.id,
      sender_id: from, matched_text: text,
    });
  } else {
    replyText = await callGeminiAI(text, userId);
    if (replyText) await sendText(from, replyText, phoneNumberId, accessToken);
  }

  if (replyText) {
    await supabase.from('inbox_messages').insert({
      user_id: userId, source: 'outbound', platform: 'whatsapp',
      sender_id: from, from_number: from, message: replyText,
      message_type: 'text', is_read: true, is_processed: true,
    });
  }

  if (savedMsg?.id) {
    await supabase.from('inbox_messages').update({ is_processed: true }).eq('id', savedMsg.id);
  }
}

// ============ ENVÍO META GRAPH API ============
async function sendText(to, text, phoneNumberId, accessToken) {
  try {
    const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    });
    if (!r.ok) console.error('[sendText] Meta error:', r.status, await r.text());
  } catch (e) { console.error('sendText:', e); }
}

async function sendMedia(to, mediaUrl, type, phoneNumberId, accessToken, caption = null) {
  try {
    const payload = {
      messaging_product: 'whatsapp',
      to, type,
      [type]: { link: mediaUrl, ...(caption && type !== 'audio' ? { caption } : {}) },
    };
    const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) console.error('[sendMedia] Meta error:', r.status, await r.text());
  } catch (e) { console.error('sendMedia:', e); }
}

async function sendTemplateByName(templateNameOrId, to, userId, phoneNumberId, accessToken) {
  try {
    const { data: tpl } = await supabase
      .from('templates').select('*').eq('user_id', userId)
      .or(`id.eq.${templateNameOrId},name.eq.${templateNameOrId}`)
      .maybeSingle();
    if (!tpl) { console.warn('Template not found:', templateNameOrId); return; }

    const media = tpl.variables?.media || {};
    for (const url of (media.imageUrls || [])) {
      await sendMedia(to, url, 'image', phoneNumberId, accessToken);
    }
    if (media.videoUrl) await sendMedia(to, media.videoUrl, 'video', phoneNumberId, accessToken);
    if (media.gifUrl)   await sendMedia(to, media.gifUrl, 'video', phoneNumberId, accessToken);
    if (tpl.content)    await sendText(to, tpl.content, phoneNumberId, accessToken);

    await supabase.from('templates')
      .update({ usage_count: (tpl.usage_count || 0) + 1 })
      .eq('id', tpl.id);
  } catch (e) { console.error('sendTemplate:', e); }
}

async function applyAutoTag(tagName, messageId, userId) {
  try {
    let { data: tag } = await supabase.from('tags').select('id')
      .eq('user_id', userId).eq('name', tagName).maybeSingle();
    if (!tag) {
      const { data: newTag } = await supabase.from('tags')
        .insert({ user_id: userId, name: tagName, color: '#3b82f6' })
        .select('id').single();
      tag = newTag;
    }
    if (tag) await supabase.from('message_tags').insert({ message_id: messageId, tag_id: tag.id });
  } catch (e) { console.error('autoTag:', e); }
}

async function callGeminiAI(text, userId) {
  try {
    if (!GEMINI_API_KEY) return null;
    const { data: ctx } = await supabase.from('chat_context').select('*')
      .eq('user_id', userId).maybeSingle();
    const systemPrompt = ctx?.system_prompt || 'Sos un asistente útil de WhatsApp. Respondé breve y amable.';
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: `${systemPrompt}\n\nUsuario: ${text}` }] }] }),
      });
    const data = await r.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (e) { console.error('Gemini:', e); return null; }
}
