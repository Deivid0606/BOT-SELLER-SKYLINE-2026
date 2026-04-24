// api/send-whatsapp.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BAILEYS_URL = process.env.BAILEYS_SERVER_URL;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { to, message, userId, imageUrls = [], videoUrl, gifUrl } = req.body;

    if (!to || !userId) return res.status(400).json({ error: 'Missing to or userId' });

    const cleanTo = String(to).replace(/[^0-9]/g, '');

    // Enviar todas las imágenes
    for (const url of imageUrls) {
      await fetch(`${BAILEYS_URL}/send-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: cleanTo, mediaUrl: url, type: 'image', caption: '' }),
      });
    }

    if (videoUrl) {
      await fetch(`${BAILEYS_URL}/send-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: cleanTo, mediaUrl: videoUrl, type: 'video', caption: '' }),
      });
    }

    if (gifUrl) {
      await fetch(`${BAILEYS_URL}/send-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: cleanTo, mediaUrl: gifUrl, type: 'gif', caption: '' }),
      });
    }

    if (message) {
      await fetch(`${BAILEYS_URL}/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: cleanTo, message }),
      });
    }

    // Guardar saliente
    await supabase.from('inbox_messages').insert({
      user_id: userId,
      source: 'outbound',
      platform: 'whatsapp',
      sender_id: cleanTo,
      from_number: cleanTo,
      message: message || '',
      media_url: imageUrls.length > 0 ? imageUrls : null,
      message_type: imageUrls.length > 0 ? 'image' : (videoUrl ? 'video' : (gifUrl ? 'gif' : 'text')),
      is_read: true,
      is_processed: true,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('send-whatsapp error:', err);
    return res.status(500).json({ error: err.message });
  }
}
