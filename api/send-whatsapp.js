// api/send-whatsapp.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getConfig(userId) {
  const { data } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id, permanent_token')
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

async function metaSendText(config, to, text) {
  const r = await fetch(
    `https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.permanent_token.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text, preview_url: false },
      }),
    }
  );
  if (!r.ok) console.log('📤 Meta text error:', await r.text());
  return r.ok;
}

async function metaSendMedia(config, to, mediaUrl, type = 'image', caption = '') {
  const t = type === 'video' ? 'video' : 'image';
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: t,
    [t]: caption ? { link: mediaUrl, caption } : { link: mediaUrl },
  };
  const r = await fetch(
    `https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.permanent_token.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );
  if (!r.ok) console.log(`📤 Meta ${t} error:`, await r.text());
  return r.ok;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};

    const to = body.to || body.To || body.number || body.phone;
    const userId = body.userId || body.userid || body.user_id;
    const message = body.message || body.text || '';
    const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls
                    : Array.isArray(body.images) ? body.images : [];
    const videoUrl = body.videoUrl || null;
    const gifUrl = body.gifUrl || null;

    if (!to || !userId) {
      console.log('❌ payload inválido:', JSON.stringify(body).slice(0, 300));
      return res.status(400).json({ error: 'Missing to or userId', received: { to, userId } });
    }

    const cleanTo = String(to).replace(/[^0-9]/g, '');
    if (!cleanTo) return res.status(400).json({ error: 'Invalid phone number' });

    const config = await getConfig(userId);
    if (!config?.phone_number_id || !config?.permanent_token) {
      return res.status(400).json({ error: 'WhatsApp no configurado para este usuario' });
    }

    // 1) Imágenes (primera con caption si hay texto)
    for (let i = 0; i < imageUrls.length; i++) {
      const cap = i === 0 && message ? message : '';
      await metaSendMedia(config, cleanTo, imageUrls[i], 'image', cap);
    }

    // 2) Texto solo si no hubo imágenes
    if (imageUrls.length === 0 && message) {
      await metaSendText(config, cleanTo, message);
    }

    // 3) Video
    if (videoUrl) await metaSendMedia(config, cleanTo, videoUrl, 'video', '');

    // 4) Gif
    if (gifUrl) await metaSendMedia(config, cleanTo, gifUrl, 'image', '');

    // Guardar saliente (media_url es ARRAY, media_url_text es TEXT)
    const allMedia = [...imageUrls, ...(videoUrl ? [videoUrl] : []), ...(gifUrl ? [gifUrl] : [])];
    await supabase.from('inbox_messages').insert({
      user_id: userId,
      source: 'whatsapp',
      platform: 'whatsapp',
      sender_id: cleanTo,
      sender_name: cleanTo,
      from_number: cleanTo,
      message: message || '',
      media_url: allMedia.length > 0 ? allMedia : null,
      media_url_text: allMedia[0] || null,
      message_type: imageUrls.length > 0 ? 'out_image'
                   : videoUrl ? 'out_video'
                   : gifUrl ? 'out_gif'
                   : 'out_text',
      is_read: true,
      is_processed: true,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('send-whatsapp error:', err);
    return res.status(500).json({ error: err.message });
  }
}
