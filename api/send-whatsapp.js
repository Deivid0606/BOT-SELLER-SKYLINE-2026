// api/send-whatsapp.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getConfig(userId) {
  const { data, error } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id, permanent_token')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('❌ Error getConfig:', error);
    return null;
  }

  return data;
}

async function metaSendText(config, to, text) {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: {
      body: text,
      preview_url: false,
    },
  };

  const r = await fetch(
    `https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(config.permanent_token).trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  const responseText = await r.text();

  if (!r.ok) {
    console.error('❌ Meta text error:', responseText);
    return {
      ok: false,
      status: r.status,
      error: responseText,
    };
  }

  console.log('✅ Meta text enviado:', responseText);

  return {
    ok: true,
    status: r.status,
    data: responseText,
  };
}

async function metaSendMedia(config, to, mediaUrl, type = 'image', caption = '') {
  const t = type === 'video' ? 'video' : 'image';

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: t,
    [t]: caption
      ? { link: mediaUrl, caption }
      : { link: mediaUrl },
  };

  const r = await fetch(
    `https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(config.permanent_token).trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  const responseText = await r.text();

  if (!r.ok) {
    console.error(`❌ Meta ${t} error:`, responseText);
    return {
      ok: false,
      status: r.status,
      error: responseText,
    };
  }

  console.log(`✅ Meta ${t} enviado:`, responseText);

  return {
    ok: true,
    status: r.status,
    data: responseText,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed',
    });
  }

  try {
    const body = req.body || {};

    const to = body.to || body.To || body.number || body.phone;
    const userId = body.userId || body.userid || body.user_id;
    const message = body.message || body.text || '';

    const imageUrls = Array.isArray(body.imageUrls)
      ? body.imageUrls
      : Array.isArray(body.images)
        ? body.images
        : [];

    const videoUrl = body.videoUrl || null;
    const gifUrl = body.gifUrl || null;

    if (!to || !userId) {
      console.error('❌ Payload inválido:', JSON.stringify(body).slice(0, 500));

      return res.status(400).json({
        ok: false,
        error: 'Missing to or userId',
        received: { to, userId },
      });
    }

    const cleanTo = String(to).replace(/[^0-9]/g, '');

    if (!cleanTo) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid phone number',
      });
    }

    if (!message && imageUrls.length === 0 && !videoUrl && !gifUrl) {
      return res.status(400).json({
        ok: false,
        error: 'No message or media to send',
      });
    }

    const config = await getConfig(userId);

    if (!config?.phone_number_id || !config?.permanent_token) {
      return res.status(400).json({
        ok: false,
        error: 'WhatsApp no configurado para este usuario',
      });
    }

    console.log('📤 Enviando WhatsApp:', {
      to: cleanTo,
      userId,
      hasMessage: Boolean(message),
      images: imageUrls.length,
      hasVideo: Boolean(videoUrl),
      hasGif: Boolean(gifUrl),
    });

    const sendResults = [];

    for (let i = 0; i < imageUrls.length; i++) {
      const caption = i === 0 && message ? message : '';
      const result = await metaSendMedia(config, cleanTo, imageUrls[i], 'image', caption);

      sendResults.push({
        type: 'image',
        url: imageUrls[i],
        ...result,
      });

      if (!result.ok) {
        return res.status(502).json({
          ok: false,
          error: 'Meta no envió la imagen',
          details: result,
        });
      }
    }

    if (imageUrls.length === 0 && message) {
      const result = await metaSendText(config, cleanTo, message);

      sendResults.push({
        type: 'text',
        ...result,
      });

      if (!result.ok) {
        return res.status(502).json({
          ok: false,
          error: 'Meta no envió el mensaje',
          details: result,
        });
      }
    }

    if (videoUrl) {
      const result = await metaSendMedia(config, cleanTo, videoUrl, 'video', '');

      sendResults.push({
        type: 'video',
        url: videoUrl,
        ...result,
      });

      if (!result.ok) {
        return res.status(502).json({
          ok: false,
          error: 'Meta no envió el video',
          details: result,
        });
      }
    }

    if (gifUrl) {
      const result = await metaSendMedia(config, cleanTo, gifUrl, 'image', '');

      sendResults.push({
        type: 'gif',
        url: gifUrl,
        ...result,
      });

      if (!result.ok) {
        return res.status(502).json({
          ok: false,
          error: 'Meta no envió el gif',
          details: result,
        });
      }
    }

    const allMedia = [
      ...imageUrls,
      ...(videoUrl ? [videoUrl] : []),
      ...(gifUrl ? [gifUrl] : []),
    ];

    const { error: insertError } = await supabase.from('inbox_messages').insert({
      user_id: userId,
      source: 'whatsapp',
      platform: 'whatsapp',
      sender_id: cleanTo,
      sender_name: cleanTo,
      from_number: cleanTo,
      message: message || '',
      media_url: allMedia.length > 0 ? allMedia : null,
      media_url_text: allMedia[0] || null,
      message_type: imageUrls.length > 0
        ? 'out_image'
        : videoUrl
          ? 'out_video'
          : gifUrl
            ? 'out_gif'
            : 'out_text',
      is_read: true,
      is_processed: true,
    });

    if (insertError) {
      console.error('❌ Error guardando saliente:', insertError);

      return res.status(500).json({
        ok: false,
        error: 'Mensaje enviado, pero no se pudo guardar en Supabase',
        details: insertError.message,
      });
    }

    return res.status(200).json({
      ok: true,
      sent: true,
      to: cleanTo,
      results: sendResults,
    });
  } catch (err) {
    console.error('❌ send-whatsapp error:', err);

    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
}
