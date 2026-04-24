// api/webhook.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BAILEYS_URL = process.env.BAILEYS_SERVER_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { from, message, messageId, userId, mediaUrl, messageType } = req.body;

    if (!from || !userId) {
      return res.status(400).json({ error: 'Missing from or userId' });
    }

    const cleanFrom = String(from).replace(/[^0-9]/g, '');
    const text = (message || '').trim();

    // 1) GUARDAR mensaje entrante
    const { data: savedMsg, error: insertErr } = await supabase
      .from('inbox_messages')
      .insert({
        user_id: userId,
        source: 'whatsapp',
        platform: 'whatsapp',
        sender_id: cleanFrom,
        from_number: cleanFrom,
        message: text,
        media_url_text: mediaUrl || null,
        message_type: messageType || 'text',
        wa_message_id: messageId || null,
        is_read: false,
        is_processed: false,
      })
      .select()
      .single();

    if (insertErr) console.error('Insert error:', insertErr);

    // 2) DETECTAR si es primer mensaje (para trigger de bienvenida)
    const { count: prevCount } = await supabase
      .from('inbox_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('sender_id', cleanFrom)
      .eq('source', 'whatsapp');

    const isFirstMessage = (prevCount || 0) <= 1;

    // 3) BUSCAR triggers activos del usuario
    const { data: triggers } = await supabase
      .from('triggers')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);

    let matchedTrigger = null;

    if (triggers && triggers.length > 0) {
      // Prioridad 1: trigger de bienvenida si es primer mensaje
      if (isFirstMessage) {
        matchedTrigger = triggers.find(t => t.trigger_type === 'welcome' || t.trigger_type === 'bienvenida');
      }

      // Prioridad 2: match por palabra clave
      if (!matchedTrigger && text) {
        const lowerText = text.toLowerCase();
        matchedTrigger = triggers.find(t => {
          const keywords = t.keywords || t.secondary?.keywords || [];
          if (!Array.isArray(keywords) || keywords.length === 0) return false;
          return keywords.some(kw => lowerText.includes(String(kw).toLowerCase()));
        });
      }
    }

    // 4) EJECUTAR trigger (si matchea) o IA
    let replyText = null;
    let usedTriggerId = null;

    if (matchedTrigger) {
      usedTriggerId = matchedTrigger.id;

      // Si tiene template_id → enviamos plantilla con medios
      if (matchedTrigger.template_id) {
        await sendTemplate(matchedTrigger.template_id, cleanFrom, userId);
      } else if (matchedTrigger.response_text || matchedTrigger.message) {
        replyText = matchedTrigger.response_text || matchedTrigger.message;
        await sendText(cleanFrom, replyText);
      }

      // Aplicar auto_tag
      if (matchedTrigger.auto_tag && savedMsg?.id) {
        await applyAutoTag(matchedTrigger.auto_tag, savedMsg.id, userId);
      }

      // Log del trigger
      await supabase.from('trigger_logs').insert({
        user_id: userId,
        trigger_id: matchedTrigger.id,
        sender_id: cleanFrom,
        matched_text: text,
        executed_at: new Date().toISOString(),
      });
    } else {
      // No hay trigger → llamar IA
      replyText = await callGeminiAI(text, cleanFrom, userId);
      if (replyText) await sendText(cleanFrom, replyText);
    }

    // 5) Guardar respuesta saliente
    if (replyText) {
      await supabase.from('inbox_messages').insert({
        user_id: userId,
        source: 'outbound',
        platform: 'whatsapp',
        sender_id: cleanFrom,
        from_number: cleanFrom,
        message: replyText,
        message_type: 'text',
        is_read: true,
        is_processed: true,
      });
    }

    // 6) Marcar entrante como procesado
    if (savedMsg?.id) {
      await supabase.from('inbox_messages').update({ is_processed: true }).eq('id', savedMsg.id);
    }

    return res.status(200).json({ ok: true, triggerId: usedTriggerId });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ============== HELPERS ==============

async function sendText(to, text) {
  try {
    await fetch(`${BAILEYS_URL}/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, message: text }),
    });
  } catch (e) {
    console.error('sendText error:', e);
  }
}

async function sendTemplate(templateId, to, userId) {
  try {
    const { data: tpl } = await supabase
      .from('templates')
      .select('*')
      .eq('id', templateId)
      .eq('user_id', userId)
      .single();

    if (!tpl) return;

    const media = tpl.variables?.media || {};
    const imageUrls = media.imageUrls || [];
    const videoUrl = media.videoUrl;
    const gifUrl = media.gifUrl;

    // Enviar imágenes
    for (const url of imageUrls) {
      await fetch(`${BAILEYS_URL}/send-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, mediaUrl: url, type: 'image', caption: '' }),
      });
    }

    // Enviar video
    if (videoUrl) {
      await fetch(`${BAILEYS_URL}/send-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, mediaUrl: videoUrl, type: 'video', caption: '' }),
      });
    }

    // Enviar GIF
    if (gifUrl) {
      await fetch(`${BAILEYS_URL}/send-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, mediaUrl: gifUrl, type: 'gif', caption: '' }),
      });
    }

    // Enviar texto al final
    if (tpl.content) {
      await sendText(to, tpl.content);
    }

    // Incrementar usage
    await supabase
      .from('templates')
      .update({ usage_count: (tpl.usage_count || 0) + 1 })
      .eq('id', templateId);
  } catch (e) {
    console.error('sendTemplate error:', e);
  }
}

async function applyAutoTag(tagName, messageId, userId) {
  try {
    // Buscar o crear tag
    let { data: tag } = await supabase
      .from('tags')
      .select('id')
      .eq('user_id', userId)
      .eq('name', tagName)
      .maybeSingle();

    if (!tag) {
      const { data: newTag } = await supabase
        .from('tags')
        .insert({ user_id: userId, name: tagName, color: '#3b82f6' })
        .select('id')
        .single();
      tag = newTag;
    }

    if (tag) {
      await supabase.from('message_tags').insert({
        message_id: messageId,
        tag_id: tag.id,
        assigned_at: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.error('applyAutoTag error:', e);
  }
}

async function callGeminiAI(text, from, userId) {
  try {
    if (!GEMINI_API_KEY) return null;

    // Cargar contexto/prompt del usuario
    const { data: ctx } = await supabase
      .from('chat_context')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    const systemPrompt = ctx?.system_prompt || 'Sos un asistente útil de WhatsApp. Respondé breve y amable.';

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\nUsuario: ${text}` }] }],
        }),
      }
    );

    const data = await r.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (e) {
    console.error('Gemini error:', e);
    return null;
  }
}
