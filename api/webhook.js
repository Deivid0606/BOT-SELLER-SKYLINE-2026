// api/webhook.js — webhook_v12.js
// WhatsApp Cloud API → Triggers → Gemini (con Vision para imágenes)
// Lee config de chat_ia_gemini + training_data + triggers + templates

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'mega_todo_verify';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // GET: verificación de webhook con Meta
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  // Responder rápido a Meta para evitar reintentos
  res.status(200).json({ ok: true });

  try {
    const body = req.body;
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;
    if (!messages || messages.length === 0) return;

    const phoneNumberId = value.metadata?.phone_number_id;
    if (!phoneNumberId) return console.error('No phone_number_id');

    // Resolver user_id + token desde whatsapp_config
    const { data: waCfg, error: waErr } = await supabase
      .from('whatsapp_config')
      .select('user_id, permanent_token')
      .eq('phone_number_id', phoneNumberId)
      .single();

    if (waErr || !waCfg) return console.error('whatsapp_config no encontrado', waErr);

    const userId = waCfg.user_id;
    const waToken = waCfg.permanent_token;

    for (const msg of messages) {
      await processMessage({ msg, userId, waToken, phoneNumberId, fromContact: value.contacts?.[0] });
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }
}

// ─────────────────────────────────────────────────────────────
// PROCESAR UN MENSAJE
// ─────────────────────────────────────────────────────────────
async function processMessage({ msg, userId, waToken, phoneNumberId, fromContact }) {
  const fromNumber = msg.from;
  const waMessageId = msg.id;
  const msgType = msg.type; // text | image | audio | video | document | interactive | button

  // Idempotencia: si ya procesamos este wa_message_id, salir
  const { data: existing } = await supabase
    .from('inbox_messages')
    .select('id')
    .eq('wa_message_id', waMessageId)
    .maybeSingle();
  if (existing) return console.log('Mensaje ya procesado:', waMessageId);

  // Extraer texto y media
  let textContent = '';
  let mediaId = null;
  let mediaMime = null;

  switch (msgType) {
    case 'text':
      textContent = msg.text?.body || '';
      break;
    case 'interactive':
      textContent = msg.interactive?.button_reply?.title
        || msg.interactive?.list_reply?.title
        || '';
      break;
    case 'button':
      textContent = msg.button?.text || '';
      break;
    case 'image':
      mediaId = msg.image?.id;
      mediaMime = msg.image?.mime_type || 'image/jpeg';
      textContent = msg.image?.caption || '[image]';
      break;
    case 'audio':
      mediaId = msg.audio?.id;
      mediaMime = msg.audio?.mime_type || 'audio/ogg';
      textContent = '[audio]';
      break;
    case 'video':
      mediaId = msg.video?.id;
      mediaMime = msg.video?.mime_type || 'video/mp4';
      textContent = msg.video?.caption || '[video]';
      break;
    case 'document':
      mediaId = msg.document?.id;
      mediaMime = msg.document?.mime_type;
      textContent = msg.document?.caption || msg.document?.filename || '[document]';
      break;
    default:
      textContent = `[${msgType}]`;
  }

  // Guardar mensaje entrante
  await supabase.from('inbox_messages').insert({
    user_id: userId,
    source: 'whatsapp',
    platform: 'whatsapp',
    sender_id: fromNumber,
    sender_name: fromContact?.profile?.name || fromNumber,
    message: textContent,
    message_type: msgType,
    from_number: fromNumber,
    wa_message_id: waMessageId,
    is_read: false,
    is_processed: false,
    media_url_text: mediaId,
  });

  // ─── 1. CHEQUEAR TRIGGERS (palabra clave) ───
  const trigger = await matchTrigger({ userId, fromNumber, text: textContent });
  if (trigger) {
    await sendTriggerResponse({ trigger, userId, fromNumber, waToken, phoneNumberId });
    await markProcessed(waMessageId);
    return;
  }

  // ─── 2. LLAMAR A GEMINI ───
  const aiReply = await callGemini({
    userId,
    fromNumber,
    textContent,
    mediaId,
    mediaMime,
    waToken,
  });

  if (!aiReply) {
    console.error('Gemini no devolvió respuesta');
    await markProcessed(waMessageId);
    return;
  }

  // Enviar respuesta por WhatsApp
  await sendWhatsAppText({ to: fromNumber, text: aiReply, waToken, phoneNumberId });

  // Guardar mensaje saliente
  await supabase.from('inbox_messages').insert({
    user_id: userId,
    source: 'whatsapp',
    platform: 'whatsapp',
    sender_id: 'bot',
    message: aiReply,
    message_type: 'out_text',
    from_number: fromNumber,
    is_read: true,
    is_processed: true,
  });

  // Actualizar chat_context
  await supabase.from('chat_context').upsert({
    user_id: userId,
    from_number: fromNumber,
    last_topic: textContent.slice(0, 100),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,from_number' });

  await markProcessed(waMessageId);
}

// ─────────────────────────────────────────────────────────────
// MATCHEAR TRIGGERS
// ─────────────────────────────────────────────────────────────
async function matchTrigger({ userId, fromNumber, text }) {
  if (!text) return null;
  const lower = text.toLowerCase();

  const { data: triggers } = await supabase
    .from('triggers')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true);

  if (!triggers) return null;

  for (const t of triggers) {
    const cond = (t.condition || '').toLowerCase().trim();
    if (!cond) continue;
    if (lower.includes(cond)) {
      // no_repeat: no disparar si ya se mandó este trigger antes a este número
      if (t.no_repeat) {
        const { data: prev } = await supabase
          .from('inbox_messages')
          .select('id')
          .eq('user_id', userId)
          .eq('from_number', fromNumber)
          .eq('sender_id', 'bot')
          .ilike('message', `%${t.template}%`)
          .limit(1);
        if (prev && prev.length > 0) continue;
      }
      return t;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// ENVIAR RESPUESTA DE TRIGGER (template)
// ─────────────────────────────────────────────────────────────
async function sendTriggerResponse({ trigger, userId, fromNumber, waToken, phoneNumberId }) {
  // Buscar template por nombre
  const { data: tpl } = await supabase
    .from('templates')
    .select('content, media_url, media_urls, media_type')
    .eq('user_id', userId)
    .eq('name', trigger.template)
    .eq('is_active', true)
    .maybeSingle();

  const text = tpl?.content || trigger.response || `Te paso info sobre ${trigger.name}`;

  // Mandar imagen si el template tiene media
  if (tpl?.media_url) {
    await sendWhatsAppImage({ to: fromNumber, imageUrl: tpl.media_url, caption: text, waToken, phoneNumberId });
  } else {
    await sendWhatsAppText({ to: fromNumber, text, waToken, phoneNumberId });
  }

  // Guardar saliente
  await supabase.from('inbox_messages').insert({
    user_id: userId,
    source: 'whatsapp',
    platform: 'whatsapp',
    sender_id: 'bot',
    message: text,
    message_type: tpl?.media_url ? 'out_image' : 'out_text',
    media_url: tpl?.media_url ? [tpl.media_url] : null,
    media_url_text: tpl?.media_url || null,
    from_number: fromNumber,
    is_read: true,
    is_processed: true,
  });

  // Auto-tag
  if (trigger.auto_tag) {
    await supabase.from('contact_tags').insert({
      user_id: userId,
      from_number: fromNumber,
      tag: trigger.auto_tag,
    }).then(() => {}).catch(() => {});
  }

  // Follow-up
  if (trigger.follow_up_enabled && trigger.follow_up_minutes) {
    const sendAt = new Date(Date.now() + trigger.follow_up_minutes * 60 * 1000).toISOString();
    await supabase.from('followup_queue').insert({
      user_id: userId,
      from_number: fromNumber,
      message: trigger.follow_up_message,
      send_at: sendAt,
      trigger_id: trigger.id,
      sent: false,
    }).then(() => {}).catch(() => {});
  }

  // Update chat_context
  await supabase.from('chat_context').upsert({
    user_id: userId,
    from_number: fromNumber,
    last_topic: trigger.name,
    last_trigger: trigger.id,
    current_product: trigger.template,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,from_number' });
}

// ─────────────────────────────────────────────────────────────
// LLAMAR A GEMINI (con historial + visión si hay imagen)
// ─────────────────────────────────────────────────────────────
async function callGemini({ userId, fromNumber, textContent, mediaId, mediaMime, waToken }) {
  // 1. Cargar config IA
  const { data: ai } = await supabase
    .from('chat_ia_gemini')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (!ai || !ai.api_key) {
    console.error('Sin config de Gemini activa para user', userId);
    return null;
  }

  // 2. Cargar training_data como contexto adicional
  const { data: training } = await supabase
    .from('training_data')
    .select('response')
    .eq('user_id', userId)
    .eq('is_active', true);

  const trainingText = (training || []).map(t => t.response).join('\n\n');

  // 3. Historial: últimos 10 mensajes de este chat
  const { data: history } = await supabase
    .from('inbox_messages')
    .select('sender_id, message, message_type, created_at')
    .eq('user_id', userId)
    .eq('from_number', fromNumber)
    .order('created_at', { ascending: false })
    .limit(10);

  const historyOrdered = (history || []).reverse();

  // 4. Construir contents para Gemini
  const contents = [];
  for (const h of historyOrdered) {
    const role = h.sender_id === 'bot' ? 'model' : 'user';
    if (!h.message || h.message === '[image]') continue;
    contents.push({ role, parts: [{ text: h.message }] });
  }

  // 5. Mensaje actual: si es imagen, agregar inline_data
  const currentParts = [];
  if (mediaId) {
    const imgB64 = await downloadWhatsAppMedia(mediaId, waToken);
    if (imgB64) {
      currentParts.push({
        text: textContent && textContent !== '[image]'
          ? `El cliente envió esta imagen con el texto: "${textContent}". Analizá la imagen. Si es un comprobante de pago, agradecé y pedí los datos de envío (nombre completo, ciudad, dirección, teléfono). Si es foto de un producto, identificalo y dale el precio.`
          : `El cliente envió esta imagen. Analizala. Si es un comprobante de pago bancario, agradecé y pedí los datos de envío (nombre, ciudad, dirección, teléfono). Si es foto de un producto, identificalo y respondé con precio.`
      });
      currentParts.push({
        inline_data: { mime_type: mediaMime || 'image/jpeg', data: imgB64 }
      });
    } else {
      currentParts.push({ text: textContent || '[imagen recibida]' });
    }
  } else {
    currentParts.push({ text: textContent });
  }
  contents.push({ role: 'user', parts: currentParts });

  // 6. System instruction = chat_ia_gemini.system_instruction + training_data
  const systemInstruction = [
    ai.system_instruction || '',
    trainingText ? `\n\n=== BASE DE CONOCIMIENTO ===\n${trainingText}` : '',
  ].join('');

  // 7. Llamar a Gemini API
  const model = ai.model || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${ai.api_key}`;

  const payload = {
    contents,
    systemInstruction: { role: 'system', parts: [{ text: systemInstruction }] },
    generationConfig: {
      temperature: ai.temperature ?? 0.7,
      maxOutputTokens: ai.max_tokens ?? 500,
    },
  };

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) {
      console.error('Gemini error:', JSON.stringify(j));
      return null;
    }
    const reply = j.candidates?.[0]?.content?.parts?.[0]?.text;
    return reply?.trim() || null;
  } catch (e) {
    console.error('Gemini fetch error:', e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// DESCARGAR MEDIA DE WHATSAPP → base64
// ─────────────────────────────────────────────────────────────
async function downloadWhatsAppMedia(mediaId, waToken) {
  try {
    // 1. Obtener URL del media
    const metaR = await fetch(`https://graph.facebook.com/v23.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${waToken}` },
    });
    const metaJ = await metaR.json();
    if (!metaJ.url) {
      console.error('No URL en media meta:', metaJ);
      return null;
    }

    // 2. Descargar binario
    const binR = await fetch(metaJ.url, {
      headers: { Authorization: `Bearer ${waToken}` },
    });
    const buf = await binR.arrayBuffer();
    return Buffer.from(buf).toString('base64');
  } catch (e) {
    console.error('downloadWhatsAppMedia error:', e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// ENVIAR TEXTO POR WHATSAPP
// ─────────────────────────────────────────────────────────────
async function sendWhatsAppText({ to, text, waToken, phoneNumberId }) {
  try {
    const r = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${waToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    });
    if (!r.ok) console.error('sendWhatsAppText error:', await r.text());
  } catch (e) {
    console.error('sendWhatsAppText fetch:', e);
  }
}

// ─────────────────────────────────────────────────────────────
// ENVIAR IMAGEN POR WHATSAPP
// ─────────────────────────────────────────────────────────────
async function sendWhatsAppImage({ to, imageUrl, caption, waToken, phoneNumberId }) {
  try {
    const r = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${waToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'image',
        image: { link: imageUrl, caption: caption?.slice(0, 1024) },
      }),
    });
    if (!r.ok) console.error('sendWhatsAppImage error:', await r.text());
  } catch (e) {
    console.error('sendWhatsAppImage fetch:', e);
  }
}

// ─────────────────────────────────────────────────────────────
// MARCAR MENSAJE COMO PROCESADO
// ─────────────────────────────────────────────────────────────
async function markProcessed(waMessageId) {
  await supabase
    .from('inbox_messages')
    .update({ is_processed: true })
    .eq('wa_message_id', waMessageId);
}
