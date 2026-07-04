// api/send-whatsapp.js - VERSIÓN CORREGIDA

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
// 📤 Enviar mensaje interactivo CON imagen y botones
// ============================================================
async function metaSendInteractiveWithImage(config, to, text, buttons, imageUrl = null) {
  try {
    const maxButtons = buttons.slice(0, 3);
    
    const formattedButtons = maxButtons.map((btn, index) => ({
      type: "reply",
      reply: {
        id: btn.id || `btn_${index}_${Date.now()}`,
        title: btn.label.replace(/[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ ]/g, '').substring(0, 20)
      }
    }));

    // Construir el payload interactivo
    const interactivePayload = {
      type: "button",
      body: {
        text: text.substring(0, 1024)
      },
      action: {
        buttons: formattedButtons
      }
    };

    // 👇 Si hay imagen, agregar header con imagen
    if (imageUrl) {
      interactivePayload.header = {
        type: "image",
        image: { link: imageUrl }
      };
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'interactive',
      interactive: interactivePayload
    };

    console.log('📤 Enviando mensaje interactivo con imagen y', formattedButtons.length, 'botones');

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
      console.error('❌ Meta interactive error:', errorText);
      return false;
    }

    const result = await r.json();
    console.log('✅ Mensaje interactivo enviado:', result.messages?.[0]?.id);
    return true;
  } catch (err) {
    console.error('❌ Error en metaSendInteractiveWithImage:', err);
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
      console.error('📤 Meta text error:', await r.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('❌ Error en metaSendText:', err);
    return false;
  }
}

// ============================================================
// 🚀 HANDLER PRINCIPAL - CORREGIDO
// ============================================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};

    // 📥 LEER PARÁMETROS
    const to = body.to || body.To || body.number || body.phone;
    const userId = body.userId || body.user_id || body.userid;
    const message = body.message || body.text || '';
    const buttons = body.buttons || null;
    const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls
                    : Array.isArray(body.images) ? body.images : [];
    const videoUrl = body.videoUrl || null;
    const gifUrl = body.gifUrl || null;
    const mediaUrl = body.media_url || null;
    const mediaType = body.media_type || 'image';

    console.log('📥 Payload recibido:', {
      to,
      userId,
      messageLength: message?.length || 0,
      buttonsCount: buttons?.length || 0,
      mediaUrl: !!mediaUrl,
      imageUrls: imageUrls.length,
    });

    // ✅ VALIDACIÓN
    if (!to || !userId) {
      console.error('❌ payload inválido');
      return res.status(400).json({ error: 'Missing to or userId' });
    }

    const cleanTo = String(to).replace(/[^0-9]/g, '');
    if (!cleanTo) return res.status(400).json({ error: 'Invalid phone number' });

    const config = await getConfig(userId);
    if (!config?.phone_number_id || !config?.permanent_token) {
      return res.status(400).json({ error: 'WhatsApp no configurado' });
    }

    // 🎯 OBTENER LA PRIMERA IMAGEN (para el header)
    let firstImage = null;
    if (mediaUrl && (mediaType === 'image' || mediaType === 'image/jpeg' || mediaType === 'image/png')) {
      firstImage = mediaUrl;
    } else if (imageUrls.length > 0) {
      firstImage = imageUrls[0];
    }

    // ============================================================
    // 📤 ENVIAR MENSAJE
    // ============================================================
    let sendSuccess = true;

    // 👇 CASO 1: CON BOTONES - TODO EN UN SOLO MENSAJE
    if (buttons && buttons.length > 0) {
      console.log(`🎯 Enviando mensaje INTERACTIVO con ${buttons.length} botones`);
      
      // ✅ Enviar TODO en un solo mensaje interactivo con imagen
      const success = await metaSendInteractiveWithImage(
        config,
        cleanTo,
        message,
        buttons,
        firstImage // 👈 La imagen va dentro del mismo mensaje
      );
      
      if (!success) {
        // Fallback: enviar como texto normal
        console.log('⚠️ Falló interactivo, enviando como texto normal');
        await metaSendText(config, cleanTo, message);
        sendSuccess = false;
      } else {
        sendSuccess = true;
      }
    } 
    // 👇 CASO 2: SIN BOTONES - Enviar normal
    else {
      console.log(`📤 Enviando mensaje SIN botones`);
      
      if (mediaUrl || imageUrls.length > 0) {
        // Enviar imagen
        const imageToSend = mediaUrl || imageUrls[0];
        await metaSendMedia(config, cleanTo, imageToSend, 'image', message || '');
        // Si hay texto y no se envió como caption, enviarlo aparte
        if (message) {
          await metaSendText(config, cleanTo, message);
        }
      } else if (message) {
        await metaSendText(config, cleanTo, message);
      }
    }

    // 💾 GUARDAR EN SUPABASE
    const messageType = buttons && buttons.length > 0 ? 'out_interactive'
                      : (mediaUrl || imageUrls.length > 0) ? 'out_media'
                      : 'out_text';

    await supabase.from('received_messages').insert({
      user_id: userId,
      source: 'whatsapp',
      platform: 'whatsapp',
      sender_id: cleanTo,
      sender_name: cleanTo,
      from_number: cleanTo,
      message: message || '',
      media_url: mediaUrl || imageUrls[0] || null,
      media_url_text: mediaUrl || imageUrls[0] || null,
      message_type: messageType,
      is_read: true,
      is_processed: true,
      buttons: buttons || null, // 👈 Guardar botones en la tabla
    });

    // 📊 RESPUESTA
    return res.status(200).json({
      ok: sendSuccess,
      sent: {
        to: cleanTo,
        hasButtons: buttons && buttons.length > 0,
        buttonsCount: buttons?.length || 0,
        hasImage: !!firstImage,
      }
    });

  } catch (err) {
    console.error('❌ send-whatsapp error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ============================================================
// 📤 Enviar multimedia (helper)
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
      console.error(`📤 Meta ${t} error:`, await r.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('❌ Error en metaSendMedia:', err);
    return false;
  }
}
