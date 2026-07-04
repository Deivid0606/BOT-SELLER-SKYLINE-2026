// api/cron-followups.js - CORREGIDO

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BAILEYS_URL = process.env.BAILEYS_SERVER_URL;
const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || req.query.secret;
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}` && auth !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date().toISOString();

    const { data: pending } = await supabase
      .from('followup_queue')
      .select('*')
      .lte('scheduled_at', now)
      .eq('status', 'pending')
      .limit(50);

    let processed = 0;

    for (const item of pending || []) {
      try {
        const { data: laterMsg } = await supabase
          .from('inbox_messages')
          .select('id')
          .eq('user_id', item.user_id)
          .eq('sender_id', item.sender_id)
          .eq('source', 'whatsapp')
          .gt('created_at', item.created_at)
          .limit(1);

        if (laterMsg && laterMsg.length > 0) {
          await supabase.from('followup_queue').update({ status: 'cancelled' }).eq('id', item.id);
          continue;
        }

        if (item.template_id) {
          // ✅ USAR LA NUEVA FUNCIÓN CON BOTONES
          await sendTemplateWithButtons(item.template_id, item.sender_id, item.user_id);
        } else if (item.message) {
          await fetch(`${BAILEYS_URL}/send-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: item.sender_id, message: item.message }),
          });
        }

        await supabase.from('followup_queue').update({
          status: 'sent',
          sent_at: new Date().toISOString(),
        }).eq('id', item.id);

        await supabase.from('remarketing_logs').insert({
          user_id: item.user_id,
          sender_id: item.sender_id,
          template_id: item.template_id,
          sent_at: new Date().toISOString(),
        });

        processed++;
      } catch (e) {
        console.error('Followup error:', e);
        await supabase.from('followup_queue').update({
          status: 'failed',
          error: e.message,
        }).eq('id', item.id);
      }
    }

    return res.status(200).json({ ok: true, processed });
  } catch (err) {
    console.error('cron-followups error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ============================================================
// 📤 NUEVA FUNCIÓN: Enviar plantilla CON BOTONES
// ============================================================
async function sendTemplateWithButtons(templateId, to, userId) {
  const { data: tpl } = await supabase
    .from('templates')
    .select('*')
    .eq('id', templateId)
    .single();
  
  if (!tpl) return;

  // 👇 OBTENER BOTONES DE LA PLANTILLA
  const buttons = tpl.variables?.buttons || null;
  const media = tpl.variables?.media || {};
  
  // 1️⃣ Obtener la primera imagen (para el header del mensaje interactivo)
  let firstImage = null;
  if (media.imageUrls && media.imageUrls.length > 0) {
    firstImage = media.imageUrls[0];
  }

  // 2️⃣ Construir el payload para la API send-whatsapp
  const payload = {
    to: to,
    userId: userId,
    message: tpl.content || '',
    media_url: firstImage || null,
    media_type: firstImage ? 'image' : null,
    buttons: buttons || null, // 👈 ENVIAR BOTONES
  };

  console.log('📤 Enviando plantilla con botones desde cron:', {
    templateId,
    to,
    hasButtons: !!buttons,
    buttonsCount: buttons?.length || 0,
    hasImage: !!firstImage,
  });

  // 3️⃣ Enviar a la API de WhatsApp (la misma que usa InboxPage)
  const response = await fetch(
    `${process.env.VERCEL_URL || 'https://bot-seller-skyline-2026.vercel.app'}/api/send-whatsapp`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Error enviando plantilla con botones:', errorText);
    throw new Error(`Error sending template: ${response.status}`);
  }

  console.log('✅ Plantilla con botones enviada desde cron');
}

// ============================================================
// ⚠️ FUNCIÓN ANTIGUA (se mantiene por compatibilidad, pero ya no se usa)
// ============================================================
async function sendTemplate(templateId, to, userId) {
  // Esta función se mantiene para no romper código existente
  // Pero ahora usamos sendTemplateWithButtons
  return sendTemplateWithButtons(templateId, to, userId);
}
