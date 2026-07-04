// api/send-whatsapp.js - VERSIÓN DEFINITIVA CON BOTONES (CORREGIDA)

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
// 📤 Enviar multimedia (helper) - MOVIDO ARRIBA
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

// ============================================================
// 📤 Enviar mensaje interactivo CON imagen en HEADER
// ============================================================
async function metaSendInteractiveWithImage(config, to, text, buttons, imageUrl) {
  try {
    if (!imageUrl) {
      console.log('⚠️ No hay imagen, usando sin imagen');
      return await metaSendInteractive(config, to, text, buttons);
    }

    const maxButtons = buttons.slice(0, 3);
    
    const formattedButtons = maxButtons.map((btn, index) => ({
      type: "reply",
      reply: {
        id: btn.id || `btn_${index}_${Date.now()}`,
        title: btn.label.replace(/[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ ]/g, '').substring(0, 20)
      }
    }));

    const payload = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'interactive',
      interactive: {
        type: 'button',
        header: {
          type: 'image',
          image: { 
            link: imageUrl
          }
        },
        body: {
          text: text.substring(0, 1024)
        },
        action: {
          buttons: formattedButtons
        }
      }
    };

    console.log('📤 Enviando INTERACTIVO con imagen en header');
    console.log('📌 Payload:', JSON.stringify(payload, null, 2));

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

    const responseText = await r.text();
    
    if (!r.ok) {
      console.error('❌ Meta interactive ERROR:', responseText);
      return false;
    }

    console.log('✅ Mensaje interactivo con imagen ENVIADO');
    return true;
  } catch (err) {
    console.error('❌ Error en metaSendInteractiveWithImage:', err);
    return false;
  }
}

// ============================================================
// 📤 Enviar mensaje interactivo SIN imagen
// ============================================================
async function metaSendInteractive(config, to, text, buttons) {
  try {
    const maxButtons = buttons.slice(0, 3);
    
    const formattedButtons = maxButtons.map((btn, index) => ({
      type: "reply",
      reply: {
        id: btn.id || `btn_${index}_${Date.now()}`,
        title: btn.label.replace(/[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ ]/g, '').substring(0, 20)
      }
    }));

    const payload = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: text.substring(0, 1024)
        },
        action: {
          buttons: formattedButtons
        }
      }
    };

    console.log('📤 Enviando INTERACTIVO sin imagen');
    console.log('📌 Payload:', JSON.stringify(payload, null, 2));

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

    const responseText = await r.text();
    
    if (!r.ok) {
      console.error('❌ Meta interactive ERROR:', responseText);
      return false;
    }

    console.log('✅ Mensaje interactivo ENVIADO');
    return true;
  } catch (err) {
    console.error('❌ Error en metaSendInteractive:', err);
    return false;
  }
}

// ============================================================
// 📤 Enviar mensaje de texto normal (fallback)
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
// 🚀 HANDLER PRINCIPAL
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
    const mediaUrl = body.media_url || null;
    const mediaType = body.media_type || 'image';

    console.log('📥 Payload recibido:', {
      to,
      userId,
      messageLength: message?.length || 0,
      buttonsCount: buttons?.length || 0,
      mediaUrl: !!mediaUrl,
    });

    // ✅ VALIDACIÓN
    if (!to || !userId) {
      console.error('❌ Faltan to o userId');
      return res.status(400).json({ error: 'Missing to or userId' });
    }

    const cleanTo = String(to).replace(/[^0-9]/g, '');
    if (!cleanTo) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    const config = await getConfig(userId);
    if (!config?.phone_number_id || !config?.permanent_token) {
      console.error('❌ WhatsApp no configurado para userId:', userId);
      return res.status(400).json({ error: 'WhatsApp no configurado' });
    }

    // ============================================================
    // 🎯 CASO 1: CON BOTONES
    // ============================================================
    if (buttons && buttons.length > 0) {
      console.log(`🎯 Enviando ${buttons.length} botones`);
      
      const imageUrl = mediaUrl && (mediaType === 'image' || mediaType.includes('image')) 
        ? mediaUrl 
        : null;
      
      let success = false;
      
      if (imageUrl) {
        console.log('📸 Enviando mensaje INTERACTIVO CON IMAGEN');
        success = await metaSendInteractiveWithImage(
          config,
          cleanTo,
          message,
          buttons,
          imageUrl
        );
      } else {
        console.log('📤 Enviando mensaje INTERACTIVO SIN IMAGEN');
        success = await metaSendInteractive(config, cleanTo, message, buttons);
      }
      
      // ⚠️ FALLBACK: Si falla el interactivo, usar opciones numeradas
      if (!success) {
        console.log('⚠️ Fallback: enviando como texto con opciones numeradas');
        const fallbackText = message + '\n\n📌 RESPONDE CON EL NÚMERO DE TU OPCIÓN:\n\n' +
          buttons.map((b, i) => `${i+1}️⃣ ${b.label.replace(/[^\w\s]/g, '').trim()}`).join('\n') +
          '\n\n📲 Escribí 1, 2 o 3 😊';
        await metaSendText(config, cleanTo, fallbackText);
      }

      return res.status(200).json({
        ok: success,
        sent: {
          to: cleanTo,
          hasButtons: true,
          buttonsCount: buttons.length,
          hasImage: !!imageUrl,
          type: imageUrl ? 'interactive_with_image' : 'interactive',
        }
      });
    }

    // ============================================================
    // 🎯 CASO 2: SIN BOTONES
    // ============================================================
    console.log('📤 Enviando mensaje SIN botones');
    
    if (mediaUrl) {
      await metaSendMedia(config, cleanTo, mediaUrl, mediaType, message || '');
      if (message) {
        await metaSendText(config, cleanTo, message);
      }
    } else if (message) {
      await metaSendText(config, cleanTo, message);
    }

    return res.status(200).json({
      ok: true,
      sent: {
        to: cleanTo,
        hasButtons: false,
        hasImage: !!mediaUrl,
      }
    });

  } catch (err) {
    console.error('❌ send-whatsapp error:', err);
    return res.status(500).json({ error: err.message });
  }
}
