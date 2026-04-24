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

  // 🔍 LOG el body completo para debug
  console.log('[WEBHOOK] Body recibido:', JSON.stringify(req.body));

  try {
    // Aceptar múltiples nombres de campo (Baileys/Evolution/etc usan distintos)
    const b = req.body || {};
    const from = b.from || b.sender || b.phone || b.number || b.remoteJid || b.key?.remoteJid;
    const userId = b.userId || b.user_id || b.userIdSession || b.sessionId || b.session;
    const message = b.message || b.text || b.body || b.conversation || '';
    const messageId = b.messageId || b.id || b.key?.id;
    const mediaUrl = b.mediaUrl || b.media_url;
    const messageType = b.messageType || b.type || 'text';

    if (!from) {
      console.error('[WEBHOOK] Falta "from". Body:', JSON.stringify(b));
      return res.status(400).json({ error: 'Missing from', received: Object.keys(b) });
    }
    if (!userId) {
      console.error('[WEBHOOK] Falta "userId". Body:', JSON.stringify(b));
      return res.status(400).json({ error: 'Missing userId', received: Object.keys(b) });
    }

    const cleanFrom = String(from).replace(/[^0-9]/g, '');
    const text = String(message || '').trim();

    // 1) Guardar entrante
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
        message_type: messageType,
        wa_message_id: messageId || null,
        is_read: false,
        is_processed: false,
      })
      .select()
      .single();

    if (insertErr) console.error('[WEBHOOK] Insert error:', insertErr);

    // 2) Detectar primer mensaje
    const { count: prevCount } = await supabase
      .from('inbox_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('sender_id', cleanFrom)
      .eq('source', 'whatsapp');

    const isFirstMessage = (prevCount || 0) <= 1;

    // 3) Buscar triggers activos
    const { data: triggers } = await supabase
      .from('triggers')
      .select('*')
      .eq('user_id', userId)
      .eq('active', true);

    let matched = null;

    if (triggers && triggers.length > 0) {
      // Trigger de bienvenida
      if (isFirstMessage) {
        matched = triggers.find(t => 
          (t.type || '').toLowerCase().includes('welcome') || 
          (t.type || '').toLowerCase().includes('bienvenida')
        );
      }

      // Match por palabra clave (campo `condition` separado por comas o espacios)
      if (!matched && text) {
        const lowerText = text.toLowerCase();
        matched = triggers.find(t => {
          if (!t.condition) return false;
          const keywords = String(t.condition)
            .toLowerCase()
            .split(/[,;|\n]+/)
            .map(k => k.trim())
            .filter(Boolean);
          return keywords.some(kw => lowerText.includes(kw));
        });
      }
    }

    let replyText = null;
    let usedTriggerId = null;

    if (matched) {
      usedTriggerId = matched.id;
      console.log('[WEBHOOK] Trigger matched:', matched.name);

      // Si tiene template asociado
      if (matched.template) {
        await sendTemplateByName(matched.template, cleanFrom, userId);
      } else if (matched.response) {
        replyText = matched.response;
        await sendText(cleanFrom, replyText);
      }

      // Auto-tag
      if (matched.auto_tag && savedMsg?.id) {
        await applyAutoTag(matched.auto_tag, savedMsg.id, userId);
      }

      // Followup programado
      if (matched.follow_up_enabled && matched.follow_up_minutes && matched.follow_up_message) {
        const scheduledAt = new Date(Date.now() + matched.follow_up_minutes * 60000).toISOString();
        await supabase.from('followup_queue').insert({
          user_id: userId,
          sender_id: cleanFrom,
          message: matched.follow_up_message,
          scheduled_at: scheduledAt,
          status: 'pending',
        });
      }

      // Log
      await supabase.from('trigger_logs').insert({
        user_id: userId,
        trigger_id: matched.id,
        sender_id: cleanFrom,
        matched_text: text,
      });
    } else {
      // Sin trigger → IA
      replyText = await callGeminiAI(text, cleanFrom, userId);
      if (replyText) await sendText(cleanFrom, replyText);
    }

    // 5) Guardar saliente
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

    if (savedMsg?.id) {
      await supabase.from('inbox_messages').update({ is_processed: true }).eq('id', savedMsg.id);
    }

    return res.status(200).json({ ok: true, triggerId: usedTriggerId });
  } catch (err) {
    console.error('[WEBHOOK] Error:', err);
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
  } catch (e) { console.error('sendText:', e); }
}

async function sendTemplateByName(templateNameOrId, to, userId) {
  try {
    // Buscar por id o por nombre
    let { data: tpl } = await supabase
      .from('templates')
      .select('*')
      .eq('user_id', userId)
      .or(`id.eq.${templateNameOrId},name.eq.${templateNameOrId}`)
      .maybeSingle();

    if (!tpl) {
      console.warn('[WEBHOOK] Template not found:', templateNameOrId);
      return;
    }

    const media = tpl.variables?.media || {};
    for (const url of (media.imageUrls || [])) {
      await fetch(`${BAILEYS_URL}/send-media`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, mediaUrl: url, type: 'image' }),
      });
    }
    if (media.videoUrl) {
      await fetch(`${BAILEYS_URL}/send-media`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, mediaUrl: media.videoUrl, type: 'video' }),
      });
    }
    if (media.gifUrl) {
      await fetch(`${BAILEYS_URL}/send-media`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, mediaUrl: media.gifUrl, type: 'gif' }),
      });
    }
    if (tpl.content) await sendText(to, tpl.content);

    await supabase.from('templates')
      .update({ usage_count: (tpl.usage_count || 0) + 1 })
      .eq('id', tpl.id);
  } catch (e) { console.error('sendTemplate:', e); }
}

async function applyAutoTag(tagName, messageId, userId) {
  try {
    let { data: tag } = await supabase
      .from('tags').select('id')
      .eq('user_id', userId).eq('name', tagName).maybeSingle();

    if (!tag) {
      const { data: newTag } = await supabase
        .from('tags')
        .insert({ user_id: userId, name: tagName, color: '#3b82f6' })
        .select('id').single();
      tag = newTag;
    }

    if (tag) {
      await supabase.from('message_tags').insert({
        message_id: messageId,
        tag_id: tag.id,
      });
    }
  } catch (e) { console.error('autoTag:', e); }
}

async function callGeminiAI(text, from, userId) {
  try {
    if (!GEMINI_API_KEY) return null;
    const { data: ctx } = await supabase
      .from('chat_context').select('*').eq('user_id', userId).maybeSingle();
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
  } catch (e) { console.error('Gemini:', e); return null; }
}
