// api/send-whatsapp.js
// Envío saliente de WhatsApp con ruteo automático Meta ↔ WAHA
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WAHA_BASE_URL = process.env.WAHA_BASE_URL; // ej: https://waha-production-d6eb.up.railway.app
const WAHA_API_KEY = process.env.WAHA_API_KEY;

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
async function getConfig(userId) {
  const { data } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id, permanent_token, provider, waha_session')
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

// ─────────────────────────────────────────────
// META (Cloud API)
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// WAHA
// ─────────────────────────────────────────────
function wahaHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (WAHA_API_KEY) h['X-Api-Key'] = WAHA_API_KEY;
  return h;
}

// WAHA espera el chatId en formato "549XXXXXXXXXX@c.us"
function toChatId(phone) {
  const clean = String(phone).replace(/[^0-9]/g, '');
  return `${clean}@c.us`;
}

async function wahaSendText(session, to, text) {
  const r = await fetch(`${WAHA_BASE_URL}/api/sendText`, {
    method: 'POST',
    headers: wahaHeaders(),
    body: JSON.stringify({
      session,
      chatId: toChatId(to),
      text,
    }),
  });
  if (!r.ok) console.log('📤 WAHA text error:', await r.text());
  return r.ok;
}

async function wahaSendImage(session, to, mediaUrl, caption = '') {
  const r = await fetch(`${WAHA_BASE_URL}/api/sendImage`, {
    method: 'POST',
    headers: wahaHeaders(),
    body: JSON.stringify({
      session,
      chatId: toChatId(to),
      file: { url: mediaUrl },
      caption: caption || undefined,
    }),
  });
  if (!r.ok) console.log('📤 WAHA image error:', await r.text());
  return r.ok;
}

async function wahaSendVideo(session, to, mediaUrl, caption = '') {
  const r = await fetch(`${WAHA_BASE_URL}/api/sendVideo`, {
    method: 'POST',
    headers: wahaHeaders(),
    body: JSON.stringify({
      session,
      chatId: toChatId(to),
      file: { url: mediaUrl },
      caption: caption || undefined,
    }),
  });
  if (!r.ok) console.log('📤 WAHA video error:', await r.text());
  return r.ok;
}

// ─────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────
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
    if (!config) {
      return res.status(400).json({ error: 'WhatsApp no configurado para este usuario' });
    }

    const provider = config.provider || 'meta';
    console.log(`📤 Enviando vía ${provider} a ${cleanTo}`);

    // ─── RUTEO POR PROVIDER ───
    if (provider === 'waha') {
      if (!WAHA_BASE_URL) {
        return res.status(500).json({ error: 'WAHA_BASE_URL no configurado en el servidor' });
      }
      if (!config.waha_session) {
        return res.status(400).json({ error: 'Sesión WAHA no configurada para este usuario' });
      }

      const session = config.waha_session;

      // 1) Imágenes (primera con caption si hay texto)
      for (let i = 0; i < imageUrls.length; i++) {
        const cap = i === 0 && message ? message : '';
        await wahaSendImage(session, cleanTo, imageUrls[i], cap);
      }
      // 2) Texto solo si no hubo imágenes
      if (imageUrls.length === 0 && message) {
        await wahaSendText(session, cleanTo, message);
      }
      // 3) Video
      if (videoUrl) await wahaSendVideo(session, cleanTo, videoUrl, '');
      // 4) Gif (lo mandamos como imagen, igual que con Meta)
      if (gifUrl) await wahaSendImage(session, cleanTo, gifUrl, '');

    } else {
      // ─── META (default) ───
      if (!config.phone_number_id || !config.permanent_token) {
        return res.status(400).json({ error: 'Meta WhatsApp no configurado para este usuario' });
      }

      // 1) Imágenes
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
    }

    // ─── Guardar saliente en inbox_messages ───
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

    return res.status(200).json({ ok: true, provider });
  } catch (err) {
    console.error('send-whatsapp error:', err);
    return res.status(500).json({ error: err.message });
  }
}
