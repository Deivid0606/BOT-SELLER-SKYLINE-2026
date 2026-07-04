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

// ============================================================
// 📤 NUEVO: Enviar mensaje con botones (interactivo)
// ============================================================
async function metaSendInteractive(config, to, text, buttons, headerText = 'Opciones disponibles') {
  try {
    // WhatsApp solo permite hasta 3 botones en interactive
    const maxButtons = buttons.slice(0, 3);
    
    // Formatear botones para WhatsApp
    const formattedButtons = maxButtons.map((btn, index) => ({
      type: "reply",
      reply: {
        id: `btn_${index}_${Date.now()}`,
        title: btn.label.substring(0, 20) // WhatsApp limita a 20 caracteres
      }
    }));

    const payload = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'interactive',
      interactive: {
        type: 'button',
        header: {
          type: 'text',
          text: headerText.substring(0, 60) // Límite de 60 caracteres
        },
        body: {
          text: text.substring(0, 1024) // Límite de 1024 caracteres
        },
        action: {
          buttons: formattedButtons
        }
      }
    };

    console.log('📤 Enviando mensaje interactivo con', formattedButtons.length, 'botones');

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

    if (!r.ok) {
      const errorText = await r.text();
      console.log('📤 Meta interactive error:', errorText);
      return false;
    }

    const result = await r.json();
    console.log('✅ Mensaje interactivo enviado:', result.messages?.[0]?.id);
    return true;
  } catch (err) {
    console.error('Error en metaSendInteractive:', err);
    return false;
  }
}

// ============================================================
// 📤 Enviar mensaje de texto (existente)
// ============================================================
async function metaSendText(config, to, text) {
  try {
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
    if (!r.ok) {
      console.log('📤 Meta text error:', await r.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('Error en metaSendText:', err);
    return false;
  }
}

// ============================================================
// 📤 Enviar multimedia (existente)
// ============================================================
async function metaSendMedia(config, to, mediaUrl, type = 'image', caption = '') {
  try {
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
    if (!r.ok) {
      console.log(`📤 Meta ${t} error:`, await r.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('Error en metaSendMedia:', err);
    return false;
  }
}

// ============================================================
// 📤 Enviar mensaje con botones y multimedia (nuevo)
// ============================================================
async function sendWithButtonsAndMedia(config, to, text, buttons, mediaUrls = [], mediaType = 'image') {
  let success = true;

  // 1. Si hay multimedia, enviarla primero
  for (const url of mediaUrls) {
    const ok = await metaSendMedia(config, to, url, mediaType, text || '');
    if (!ok) success = false;
  }

  // 2. Si hay botones, enviarlos en un mensaje interactivo
  if (buttons && buttons.length > 0) {
    // Si ya enviamos multimedia, el texto va en el mensaje interactivo sin multimedia
    const messageText = mediaUrls.length > 0 ? 'Selecciona una opción:' : text;
    const headerText = mediaUrls.length > 0 ? 'Continuar con:' : 'Opciones disponibles:';
    
    const ok = await metaSendInteractive(config, to, messageText, buttons, headerText);
    if (!ok) success = false;
  } else {
    // Si no hay botones, enviar solo texto (si no se envió multimedia)
    if (mediaUrls.length === 0 && text) {
      const ok = await metaSendText(config, to, text);
      if (!ok) success = false;
    }
  }

  return success;
}

// ============================================================
// 🚀 HANDLER PRINCIPAL (MODIFICADO)
// ============================================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};

    // ============================================================
    // 📥 LEER TODOS LOS PARÁMETROS (INCLUYENDO BOTONES)
    // ============================================================
    const to = body.to || body.To || body.number || body.phone;
    const userId = body.userId || body.userid || body.user_id;
    const message = body.message || body.text || '';
    const buttons = body.buttons || null; // 👈 NUEVO: botones
    const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls
                    : Array.isArray(body.images) ? body.images : [];
    const videoUrl = body.videoUrl || null;
    const gifUrl = body.gifUrl || null;
    const mediaUrl = body.media_url || null;
    const mediaType = body.media_type || 'image';

    // Log para debugging
    console.log('📥 Payload recibido:', {
      to,
      userId,
      messageLength: message?.length || 0,
      buttonsCount: buttons?.length || 0,
      imageUrls: imageUrls.length,
      videoUrl: !!videoUrl,
      gifUrl: !!gifUrl,
      mediaUrl: !!mediaUrl,
    });

    // ============================================================
    // ✅ VALIDACIÓN
    // ============================================================
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

    // ============================================================
    // 🎯 COLECCIONAR TODOS LOS MEDIA
    // ============================================================
    let allMedia = [];
    let finalMediaType = 'image';

    // Agregar imágenes
    for (const url of imageUrls) {
      if (url) {
        allMedia.push(url);
        finalMediaType = 'image';
      }
    }

    // Agregar media_url (desde payload)
    if (mediaUrl) {
      allMedia.push(mediaUrl);
      finalMediaType = mediaType || 'image';
    }

    // Agregar video
    if (videoUrl) {
      allMedia.push(videoUrl);
      finalMediaType = 'video';
    }

    // Agregar GIF
    if (gifUrl) {
      allMedia.push(gifUrl);
      finalMediaType = 'image';
    }

    // ============================================================
    // 📤 ENVIAR MENSAJE
    // ============================================================
    let sendSuccess = true;

    // 👇 CASO 1: CON BOTONES
    if (buttons && buttons.length > 0) {
      console.log(`🎯 Enviando mensaje con ${buttons.length} botones y ${allMedia.length} archivos multimedia`);
      
      // Si hay multimedia, enviarla primero
      for (const url of allMedia) {
        const ok = await metaSendMedia(config, cleanTo, url, finalMediaType, message || '');
        if (!ok) sendSuccess = false;
      }

      // Luego enviar el mensaje interactivo con botones
      const interactiveText = allMedia.length > 0 ? 'Selecciona una opción:' : message;
      const headerText = allMedia.length > 0 ? 'Continuar:' : 'Opciones:';
      
      const ok = await metaSendInteractive(config, cleanTo, interactiveText, buttons, headerText);
      if (!ok) sendSuccess = false;
    } 
    // 👇 CASO 2: SIN BOTONES
    else {
      console.log(`📤 Enviando mensaje SIN botones (${allMedia.length} archivos multimedia)`);
      
      if (allMedia.length > 0) {
        // Enviar multimedia
        for (const url of allMedia) {
          const ok = await metaSendMedia(config, cleanTo, url, finalMediaType, message || '');
          if (!ok) sendSuccess = false;
        }
        // Si hay texto y no se envió como caption, enviarlo aparte
        if (message && allMedia.length > 0) {
          const ok = await metaSendText(config, cleanTo, message);
          if (!ok) sendSuccess = false;
        }
      } else if (message) {
        // Solo texto
        const ok = await metaSendText(config, cleanTo, message);
        if (!ok) sendSuccess = false;
      }
    }

    // ============================================================
    // 💾 GUARDAR EN SUPABASE
    // ============================================================
    const messageType = buttons && buttons.length > 0 ? 'out_interactive'
                      : allMedia.length > 0 ? 'out_media'
                      : 'out_text';

    const mediaUrls = allMedia.length > 0 ? allMedia : null;

    await supabase.from('inbox_messages').insert({
      user_id: userId,
      source: 'whatsapp',
      platform: 'whatsapp',
      sender_id: cleanTo,
      sender_name: cleanTo,
      from_number: cleanTo,
      message: message || '',
      media_url: mediaUrls,
      media_url_text: mediaUrls?.[0] || null,
      message_type: messageType,
      is_read: true,
      is_processed: true,
      // 👇 Guardar botones en un campo JSON (si existe)
      metadata: buttons ? { buttons } : null,
    });

    // ============================================================
    // 📊 RESPUESTA
    // ============================================================
    return res.status(200).json({ 
      ok: sendSuccess,
      sent: {
        to: cleanTo,
        hasButtons: buttons && buttons.length > 0,
        buttonsCount: buttons?.length || 0,
        hasMedia: allMedia.length > 0,
        mediaCount: allMedia.length,
      }
    });

  } catch (err) {
    console.error('❌ send-whatsapp error:', err);
    return res.status(500).json({ error: err.message });
  }
}
