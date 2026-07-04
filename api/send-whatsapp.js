// api/send-whatsapp.js - SECCIÓN CORREGIDA

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

    // 👇 CONSTRUIR PAYLOAD
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
// 🚀 HANDLER PRINCIPAL - SECCIÓN CORREGIDA
// ============================================================
export default async function handler(req, res) {
  // ... código anterior ...

  try {
    const body = req.body || {};

    // 📥 LEER PARÁMETROS
    const to = body.to || body.To || body.number || body.phone;
    const userId = body.userId || body.user_id || body.userid;
    const message = body.message || body.text || '';
    const buttons = body.buttons || null;
    const mediaUrl = body.media_url || null;
    const mediaType = body.media_type || 'image';

    // 👇 LOG DETALLADO
    console.log('📥 === PAYLOAD DETALLADO ===');
    console.log('📌 to:', to);
    console.log('📌 userId:', userId);
    console.log('📌 message:', message?.substring(0, 100));
    console.log('📌 buttons:', buttons);
    console.log('📌 buttons length:', buttons?.length || 0);
    console.log('📌 mediaUrl:', mediaUrl);
    console.log('📌 mediaType:', mediaType);
    console.log('📥 === FIN PAYLOAD ===');

    // ✅ VALIDACIÓN
    if (!to || !userId) {
      console.error('❌ payload inválido');
      return res.status(400).json({ error: 'Missing to or userId' });
    }

    const cleanTo = String(to).replace(/[^0-9]/g, '');
    if (!cleanTo) return res.status(400).json({ error: 'Invalid phone number' });

    const config = await getConfig(userId);
    if (!config?.phone_number_id || !config?.permanent_token) {
      console.error('❌ WhatsApp no configurado para userId:', userId);
      return res.status(400).json({ error: 'WhatsApp no configurado' });
    }

    // ============================================================
    // 🎯 CASO 1: CON BOTONES - SIEMPRE USAR INTERACTIVO
    // ============================================================
    if (buttons && buttons.length > 0) {
      console.log(`🎯 ENVIANDO MENSAJE CON ${buttons.length} BOTONES`);
      
      // 👇 Si hay imagen, usarla en el header
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
    
    if (mediaUrl) {
      await metaSendMedia(config, cleanTo, mediaUrl, mediaType, message || '');
      if (message) {
        await metaSendText(config, cleanTo, message);
      }
    } else if (message) {
      await metaSendText(config, cleanTo, message);
    }

    // 💾 Guardar en Supabase
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

    return res.status(200).json({
      ok: true,
      sent: {
        to: cleanTo,
        hasButtons: false,
        hasImage: !!mediaUrl,
        type: mediaUrl ? 'media' : 'text'
      }
    });

  } catch (err) {
    console.error('❌ send-whatsapp error:', err);
    return res.status(500).json({ error: err.message });
  }
}
