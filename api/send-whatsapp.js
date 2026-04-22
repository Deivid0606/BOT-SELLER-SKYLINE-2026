import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { user_id, to, message, media_url, media_type } = req.body || {};

    if (!user_id) {
      return res.status(400).json({ error: 'Falta user_id' });
    }

    if (!to) {
      return res.status(400).json({ error: 'Falta el número de teléfono (to)' });
    }

    if (!message && !media_url) {
      return res.status(400).json({ error: 'Se requiere al menos mensaje o multimedia' });
    }

    // Obtener configuración de WhatsApp
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, permanent_token')
      .eq('user_id', user_id)
      .single();

    if (configError || !config) {
      return res.status(400).json({
        error: 'No se encontró la configuración de WhatsApp para este usuario',
        details: configError?.message || null,
      });
    }

    const phoneNumberId = config.phone_number_id;
    const permanentToken = config.permanent_token;

    if (!phoneNumberId || !permanentToken) {
      return res.status(400).json({
        error: 'Faltan phone_number_id o permanent_token en la configuración',
      });
    }

    let metaResult;
    let messageType = 'text';
    let messageBody = {};

    // ============================================
    // CASO 1: Enviar multimedia (imagen, video, audio)
    // ============================================
    if (media_url && media_type) {
      console.log(`📤 Enviando multimedia: ${media_type} a ${to}`);
      
      // Mapear tipo de multimedia para WhatsApp
      let whatsappMediaType = media_type;
      if (media_type === 'image') whatsappMediaType = 'image';
      else if (media_type === 'video') whatsappMediaType = 'video';
      else if (media_type === 'audio') whatsappMediaType = 'audio';
      else if (media_type === 'gif') whatsappMediaType = 'image';
      else whatsappMediaType = 'document';
      
      // PASO 1: Subir multimedia a Meta
      const mediaUploadResponse = await fetch(
        `https://graph.facebook.com/v22.0/${phoneNumberId}/media`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${permanentToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            type: whatsappMediaType,
            file: media_url,
          }),
        }
      );

      const mediaUploadResult = await mediaUploadResponse.json();

      if (!mediaUploadResponse.ok) {
        console.error('Error subiendo multimedia a Meta:', mediaUploadResult);
        return res.status(mediaUploadResponse.status).json({
          error: mediaUploadResult?.error?.message || 'Error subiendo multimedia a Meta',
          details: mediaUploadResult,
        });
      }

      const mediaId = mediaUploadResult.id;
      console.log(`✅ Multimedia subida a Meta, ID: ${mediaId}`);

      // PASO 2: Enviar mensaje con el media_id
      const messageBodyObj = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: whatsappMediaType,
        [whatsappMediaType]: {
          id: mediaId,
          ...(message && { caption: message }),
        },
      };

      const sendResponse = await fetch(
        `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${permanentToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(messageBodyObj),
        }
      );

      metaResult = await sendResponse.json();
      messageType = `out_${whatsappMediaType}`;

      if (!sendResponse.ok) {
        return res.status(sendResponse.status).json({
          error: metaResult?.error?.message || 'Error enviando mensaje multimedia',
          details: metaResult,
        });
      }
    }
    // ============================================
    // CASO 2: Enviar solo texto
    // ============================================
    else if (message && message.trim()) {
      console.log(`📤 Enviando texto a ${to}: ${message.substring(0, 50)}...`);
      
      const response = await fetch(
        `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${permanentToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: {
              body: message,
            },
          }),
        }
      );

      metaResult = await response.json();
      messageType = 'out_text';

      if (!response.ok) {
        return res.status(response.status).json({
          error: metaResult?.error?.message || 'Error enviando mensaje a Meta',
          details: metaResult,
        });
      }
    } else {
      return res.status(400).json({ error: 'No hay mensaje ni multimedia para enviar' });
    }

    // Guardar mensaje en la base de datos
    const { error: insertError } = await supabase
      .from('received_messages')
      .insert({
        user_id,
        platform: 'whatsapp',
        from_number: to,
        message: message || (media_url ? `[${media_type} enviado]` : ''),
        message_type: messageType,
        media_url: media_url || null,
        is_processed: true,
      });

    if (insertError) {
      console.error('Error guardando mensaje saliente:', insertError);
    }

    console.log(`✅ Mensaje enviado correctamente a ${to}`);
    
    return res.status(200).json({
      success: true,
      message_id: metaResult?.messages?.[0]?.id,
      type: messageType,
      meta: metaResult,
    });
  } catch (error) {
    console.error('Error general en send-whatsapp:', error);
    return res.status(500).json({
      error: error?.message || 'Internal Server Error',
    });
  }
}
