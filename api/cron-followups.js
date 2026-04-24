// api/cron-followups.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BAILEYS_URL = process.env.BAILEYS_SERVER_URL;
const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req, res) {
  // Validar que viene de pg_cron / cron-job
  const auth = req.headers['authorization'] || req.query.secret;
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}` && auth !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date().toISOString();

    // 1) Procesar followup_queue (mensajes programados)
    const { data: pending } = await supabase
      .from('followup_queue')
      .select('*')
      .lte('scheduled_at', now)
      .eq('status', 'pending')
      .limit(50);

    let processed = 0;

    for (const item of pending || []) {
      try {
        // Verificar que el usuario NO haya respondido después de programar
        const { data: laterMsg } = await supabase
          .from('inbox_messages')
          .select('id')
          .eq('user_id', item.user_id)
          .eq('sender_id', item.sender_id)
          .eq('source', 'whatsapp')
          .gt('created_at', item.created_at)
          .limit(1);

        if (laterMsg && laterMsg.length > 0) {
          // Cancelar: el usuario ya respondió
          await supabase.from('followup_queue').update({ status: 'cancelled' }).eq('id', item.id);
          continue;
        }

        // Enviar el seguimiento
        if (item.template_id) {
          await sendTemplate(item.template_id, item.sender_id, item.user_id);
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

    // 2) Detectar contactos sin respuesta hace >24h y programar remarketing
    // (solo si tenés una tabla de campañas activas; opcional)

    return res.status(200).json({ ok: true, processed });
  } catch (err) {
    console.error('cron-followups error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function sendTemplate(templateId, to, userId) {
  const { data: tpl } = await supabase
    .from('templates').select('*').eq('id', templateId).single();
  if (!tpl) return;

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
  if (tpl.content) {
    await fetch(`${BAILEYS_URL}/send-message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, message: tpl.content }),
    });
  }
}
