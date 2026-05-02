



// api/send-template.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BAILEYS_URL = process.env.BAILEYS_SERVER_URL;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { templateId, recipients, userId } = req.body;
    // recipients = ["54911...", "54911..."]

    if (!templateId || !Array.isArray(recipients) || !userId) {
      return res.status(400).json({ error: 'Missing templateId, recipients[] or userId' });
    }

    const { data: tpl, error: tplErr } = await supabase
      .from('templates')
      .select('*')
      .eq('id', templateId)
      .eq('user_id', userId)
      .single();

    if (tplErr || !tpl) return res.status(404).json({ error: 'Template not found' });

    const media = tpl.variables?.media || {};
    const imageUrls = media.imageUrls || [];
    const videoUrl = media.videoUrl;
    const gifUrl = media.gifUrl;

    const results = { sent: 0, failed: 0, errors: [] };

    for (const raw of recipients) {
      const to = String(raw).replace(/[^0-9]/g, '');
      try {
        // Imágenes
        for (const url of imageUrls) {
          await fetch(`${BAILEYS_URL}/send-media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, mediaUrl: url, type: 'image', caption: '' }),
          });
          await sleep(500);
        }
        if (videoUrl) {
          await fetch(`${BAILEYS_URL}/send-media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, mediaUrl: videoUrl, type: 'video', caption: '' }),
          });
          await sleep(500);
        }
        if (gifUrl) {
          await fetch(`${BAILEYS_URL}/send-media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, mediaUrl: gifUrl, type: 'gif', caption: '' }),
          });
          await sleep(500);
        }
        if (tpl.content) {
          await fetch(`${BAILEYS_URL}/send-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, message: tpl.content }),
          });
        }

        await supabase.from('inbox_messages').insert({
          user_id: userId,
          source: 'outbound',
          platform: 'whatsapp',
          sender_id: to,
          from_number: to,
          message: tpl.content || '',
          message_type: imageUrls.length > 0 ? 'image' : (videoUrl ? 'video' : 'text'),
          is_read: true,
          is_processed: true,
        });

        results.sent++;
        // Anti-baneo: pausa entre destinatarios
        await sleep(2000 + Math.random() * 2000);
      } catch (e) {
        results.failed++;
        results.errors.push({ to, error: e.message });
      }
    }

    await supabase
      .from('templates')
      .update({ usage_count: (tpl.usage_count || 0) + results.sent })
      .eq('id', templateId);

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('send-template error:', err);
    return res.status(500).json({ error: err.message });
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
