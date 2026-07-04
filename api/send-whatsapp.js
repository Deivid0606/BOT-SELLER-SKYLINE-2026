// api/send-whatsapp.js - VERSIÓN COMPLETA Y CORREGIDA

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================================
// 🔍 OBTENER CONFIGURACIÓN DE WHATSAPP
// ============================================================
async function getConfig(userId) {
  console.log('🔍 Buscando config para userId:', userId);
  
  try {
    const { data, error } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, permanent_token')
      .eq('user_id', userId)
      .maybeSingle();
    
    if (error) {
      console.error('❌ Error en getConfig:', error);
      return null;
    }
    
    console.log('📌 Config encontrada:', data ? 'SÍ' : 'NO');
    return data;
  } catch (err) {
    console.error('❌ Error en getConfig:', err);
    return null;
  }
}

// ============================================================
// 📤 Enviar mensaje interactivo (CON o SIN imagen)
// ============================================================
async function metaSendInteractive(config, to, text, buttons, imageUrl = null) {
  try {
    // WhatsApp solo permite hasta 3 botones
    const maxButtons = buttons.slice(0, 3);
    
    const formattedButtons = maxButtons.map((btn, index) => ({
      type: "reply",
      reply: {
        id: btn.id || `btn_${index}_${Date.now()}`,
        title: btn.label.replace(/[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ ]/g, '').substring(0, 20)
      }
    }));

    // Construir payload interactivo
    const interactivePayload = {
      type: "button",
      body: {
        text: text.substring(0, 1024)
      },
      action: {
        buttons: formattedButtons
      }
    };

    // Si hay imagen, agregar header con imagen
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

    console.log('📤 Enviando mensaje INTERACTIVO:');
    console.log('  - Has Image:', !!imageUrl);
    console.log('  - Buttons:', formattedButtons.length);
    console.log('  - Text length:', text.length);
    console.log('  - Payload:', JSON.stringify(payload, null, 2));

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

    console.log('✅ Mensaje interactivo ENVIADO:', responseText);
    return true;
  } catch (err) {
    console.error('❌ Error en metaSendInteractive:', err);
    return false;
  }
}

// ============================================================
// 📤 Enviar mensaje de texto normal
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
    console.log('✅ Mensaje de texto ENVIADO');
    return true;
  } catch (err) {
    console.error('❌ Error en metaSendText:', err);
    return false;
  }
}

// ============================================================
// 📤 Enviar multimedia
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
    
    console.log(`📤 Enviando ${t} a ${to}`);
    
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
    console.log(`✅ ${t} ENVIADO`);
    return true;
  } catch (err) {
    console.error('❌ Error en metaSendMedia:', err);
    return false;
  }
}

// ============================================================
// 🚀 HANDLER PRINCIPAL
// ============================================================
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};

    // 📥 LEER PARÁMETROS
    const to = body.to || body.To || body.number || body.phone;
    const userId = body.userId || body.user_id || body.userid || body.userID;
    const message = body.message || body.text || '';
    const buttons = body.buttons || null;
    const mediaUrl = body.media_url || null;
    const mediaType = body.media_type || 'image';

    // 👇 LOG DETALLADO
    console.log('🔍 === PAYLOAD RECIBIDO ===');
    console.log('📌 to:', to);
    console.log('📌 userId:', userId);
    console.log('📌 message:', message?.substring(0, 100));
    console.log('📌 buttons:', buttons);
    console.log('📌 buttons length:', buttons?.length || 0);
    console.log('📌 mediaUrl:', mediaUrl);
    console.log('📌 mediaType:', mediaType);
    console.log('🔍 === FIN ===');

    // ✅ VALIDACIÓN
    if (!to) {
      console.error('❌ Falta "to"');
      return res.status(400).json({ error: 'Missing "to" field' });
    }

    if (!userId) {
      console.error('❌ Falta "userId"');
      return res.status(400).json({ 
        error: 'Missing userId',
        received: Object.keys(body)
      });
    }

    const cleanTo = String(to).replace(/[^0-9]/g, '');
    if (!cleanTo) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    // 👇 OBTENER CONFIGURACIÓN DE WHATSAPP
    console.log('🔍 Buscando config para userId:', userId);
    
    const config = await getConfig(userId);
    
    if (!config) {
      console.error('❌ No hay configuración de WhatsApp para userId:', userId);
      return res.status(400).json({ 
        error: 'WhatsApp no configurado para este usuario',
        userId: userId,
        solution: 'Ve a la configuración y conecta tu WhatsApp'
      });
    }

    if (!config.phone_number_id || !config.permanent_token) {
      console.error('❌ Configuración incompleta:', {
        phone_number_id: !!config.phone_number_id,
        permanent_token: !!config.permanent_token
      });
      return res.status(400).json({ 
        error: 'WhatsApp configurado incompletamente',
        missing: {
          phone_number_id: !config.phone_number_id,
          permanent_token: !config.permanent_token
        }
      });
    }

    console.log('✅ Configuración de WhatsApp encontrada');

    // ============================================================
    // 🎯 CASO 1: CON BOTONES - USAR INTERACTIVO
    // ============================================================
    if (buttons && buttons.length > 0) {
      console.log(`🎯 ENVIANDO MENSAJE CON ${buttons.length} BOTONES`);
      
      const imageUrl = mediaUrl && (mediaType === 'image' || mediaType.includes('image')) 
        ? mediaUrl 
        : null;
      
      console.log(`📸 ${imageUrl ? 'CON imagen' : 'SIN imagen'}`);
      
      // ✅ Enviar mensaje interactivo (con o sin imagen)
      const success = await metaSendInteractive(
        config,
        cleanTo,
        message,
        buttons,
        imageUrl
      );
      
      if (!success) {
        console.error('❌ Falló el envío interactivo');
        // Fallback: enviar como texto normal
        console.log('⚠️ Fallback: enviando como texto normal');
        await metaSendText(config, cleanTo, message);
      }
      
      // 💾 Guardar en Supabase
      try {
        await supabase.from('received_messages').insert({
          user_id: userId,
          source: 'whatsapp',
          platform: 'whatsapp',
          sender_id: cleanTo,
          sender_name: cleanTo,
          from_number: cleanTo,
          message: message || '',
          media_url: imageUrl || null,
          media_url_text: imageUrl || null,
          message_type: 'out_interactive',
          is_read: true,
          is_processed: true,
          buttons: buttons,
        });
        console.log('✅ Mensaje guardado en DB');
      } catch (dbError) {
        console.error('⚠️ Error guardando en DB:', dbError);
      }

      return res.status(200).json({
        ok: success,
        sent: {
          to: cleanTo,
          hasButtons: true,
          buttonsCount: buttons.length,
          hasImage: !!imageUrl,
          type: 'interactive'
        }
      });
    }

    // ============================================================
    // 🎯 CASO 2: SIN BOTONES - Enviar normal
    // ============================================================
    console.log('📤 Enviando mensaje SIN botones');
    
    let sendOk = true;
    
    if (mediaUrl) {
      const ok = await metaSendMedia(config, cleanTo, mediaUrl, mediaType, message || '');
      if (!ok) sendOk = false;
      if (message) {
        const ok2 = await metaSendText(config, cleanTo, message);
        if (!ok2) sendOk = false;
      }
    } else if (message) {
      const ok = await metaSendText(config, cleanTo, message);
      if (!ok) sendOk = false;
    }

    // 💾 Guardar en Supabase
    try {
      await supabase.from('received_messages').insert({
        user_id: userId,
        source: 'whatsapp',
        platform: 'whatsapp',
        sender_id: cleanTo,
        sender_name: cleanTo,
        from_number: cleanTo,
        message: message || '',
        media_url: mediaUrl || null,
        media_url_text: mediaUrl || null,
        message_type: mediaUrl ? 'out_media' : 'out_text',
        is_read: true,
        is_processed: true,
      });
      console.log('✅ Mensaje guardado en DB');
    } catch (dbError) {
      console.error('⚠️ Error guardando en DB:', dbError);
    }

    return res.status(200).json({
      ok: sendOk,
      sent: {
        to: cleanTo,
        hasButtons: false,
        hasImage: !!mediaUrl,
        type: mediaUrl ? 'media' : 'text'
      }
    });

  } catch (err) {
    console.error('❌ Error general en send-whatsapp:', err);
    console.error('❌ Stack:', err.stack);
    return res.status(500).json({ 
      error: 'Error interno del servidor',
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
}
