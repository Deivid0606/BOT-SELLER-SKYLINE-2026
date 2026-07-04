// api/send-whatsapp.js - CORRECCIÓN FINAL

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
// 📤 Enviar mensaje interactivo CON imagen en el header
// ============================================================
async function metaSendInteractiveWithImage(config, to, text, buttons, imageUrl) {
  try {
    const maxButtons = buttons.slice(0, 3);
    
    const formattedButtons = maxButtons.map((btn, index) => ({
      type: "reply",
      reply: {
        id: btn.id || `btn_${index}_${Date.now()}`,
        title: btn.label.replace(/[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ ]/g, '').substring(0, 20)
      }
    }));

    // 👇 CONSTRUIR PAYLOAD CON IMAGEN EN HEADER
    const payload = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'interactive',
      interactive: {
        type: 'button',
        header: {
          type: 'image',
          image: { link: imageUrl }  // 👈 IMAGEN EN EL HEADER
        },
        body: {
          text: text.substring(0, 1024)
        },
        action: {
          buttons: formattedButtons
        }
      }
    };

    console.log('📤 Enviando INTERACTIVO con imagen en header:', JSON.stringify(payload, null, 2));

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

    console.log('📤 Enviando INTERACTIVO sin imagen:', JSON.stringify(payload, null, 2));

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const to = body.to || body.To || body.number || body.phone;
    const userId = body.userId || body.user_id || body.userid;
    const message = body.message || body.text || '';
    const buttons = body.buttons || null;
    const mediaUrl = body.media_url || null;
    const mediaType = body.media_type || 'image';

    if (!to || !userId) {
      return res.status(400).json({ error: 'Missing to or userId' });
    }

    const cleanTo = String(to).replace(/[^0-9]/g, '');
    if (!cleanTo) return res.status(400).json({ error: 'Invalid phone number' });

    const config = await getConfig(userId);
    if (!config?.phone_number_id || !config?.permanent_token) {
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
        // ✅ CON IMAGEN: Enviar TODO en un solo mensaje interactivo
        console.log('📸 Enviando mensaje interactivo CON imagen en header');
        success = await metaSendInteractiveWithImage(
          config,
          cleanTo,
          message,
          buttons,
          imageUrl
        );
        
        // Si falla, intentar enviar imagen y botones por separado
        if (!success) {
          console.log('⚠️ Falló interactivo con imagen, intentando separado...');
          await metaSendMedia(config, cleanTo, imageUrl, 'image', message);
          success = await metaSendInteractive(config, cleanTo, 'Selecciona una opción:', buttons);
        }
      } else {
        // ✅ SIN IMAGEN: Enviar solo interactivo (como funcionó en la prueba)
        console.log('📤 Enviando mensaje interactivo SIN imagen');
        success = await metaSendInteractive(config, cleanTo, message, buttons);
      }
      
      // Fallback final: opciones numeradas
      if (!success) {
        console.log('⚠️ Fallback a opciones numeradas');
        const fallbackText = message + '\n\nRESPONDE CON EL NÚMERO:\n' +
          buttons.map((b, i) => `${i+1}️⃣ ${b.label.replace(/[^\w\s]/g, '').trim()}`).join('\n') +
          '\n\n📲 Escribí el número de tu opción 😊';
        await metaSendText(config, cleanTo, fallbackText);
      }

      return res.status(200).json({
        ok: success,
        sent: {
          to: cleanTo,
          hasButtons: true,
          buttonsCount: buttons.length,
          hasImage: !!imageUrl,
        }
      });
    }

    // ============================================================
    // 🎯 CASO 2: SIN BOTONES
    // ============================================================
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
