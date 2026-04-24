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
    const body = req.body || {};

    // ✅ Aceptar to/To/number y userId/userid/user_id (frontend a veces manda en otra forma)
    const to = body.to || body.To || body.number || body.phone;
    const userId = body.userId || body.userid || body.user_id;
    const message = body.message || body.text || '';
    const imageUrls = body.imageUrls || body.images || [];
    const videoUrl = body.videoUrl || null;
    const gifUrl = body.gifUrl || null;

    if (!to || !userId) {
      console.log('❌ send-whatsapp payload inválido:', JSON.stringify(body).slice(0, 300));
      return res.status(400).json({ error: 'Missing to or userId', received: { to, userId } });
    }

    const cleanTo = String(to).replace(/[^0-9]/g, '');
    if (!cleanTo) return res.status(400).json({ error: 'Invalid phone number' });

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
      sender_name: cleanTo,
      from_number: cleanTo,
      message: message || '',
      media_url_text: imageUrls.length > 0 ? imageUrls[0] : (videoUrl || gifUrl || null),
      message_type: imageUrls.length > 0 ? 'out_image' : (videoUrl ? 'out_video' : (gifUrl ? 'out_gif' : 'out_text')),
      is_read: true,
      is_processed: true,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('send-whatsapp error:', err);
    return res.status(500).json({ error: err.message });
  }
}
