import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { user_id, to, message, media_url, media_type } = req.body || {};

    if (!user_id) return res.status(400).json({ error: 'Falta user_id' });
    if (!to) return res.status(400).json({ error: 'Falta el número de teléfono (to)' });
    if (!message && !media_url) return res.status(400).json({ error: 'Se requiere al menos mensaje o multimedia' });

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, permanent_token')
      .eq('user_id', user_id)
      .single();

    if (configError || !config) {
      return res.status(400).json({
        error: 'No se encontró la configuración de WhatsApp para este usuario',
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

    if (media_url && media_type) {
      console.log(`📤 Enviando multimedia: ${media_type} a ${to}`);
      
      let whatsappMediaType = media_type;
      if (media_type === 'gif') whatsappMediaType = 'image';
      else if (!['image', 'video', 'audio', 'document'].includes(media_type)) whatsappMediaType = 'document';
      
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
        console.error('Error subiendo multimedia:', mediaUploadResult);
        return res.status(mediaUploadResponse.status).json({
          error: mediaUploadResult?.error?.message || 'Error subiendo multimedia a Meta',
        });
      }

      const mediaId = mediaUploadResult.id;
      console.log(`✅ Multimedia subida, ID: ${mediaId}`);

      const sendResponse = await fetch(
        `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${permanentToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: to,
            type: whatsappMediaType,
            [whatsappMediaType]: {
              id: mediaId,
              ...(message && { caption: message }),
            },
          }),
        }
      );

      metaResult = await sendResponse.json();
      messageType = `out_${whatsappMediaType}`;

      if (!sendResponse.ok) {
        return res.status(sendResponse.status).json({
          error: metaResult?.error?.message || 'Error enviando mensaje multimedia',
        });
      }
    } else if (message && message.trim()) {
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
            text: { body: message },
          }),
        }
      );

      metaResult = await response.json();
      messageType = 'out_text';

      if (!response.ok) {
        return res.status(response.status).json({
          error: metaResult?.error?.message || 'Error enviando mensaje a Meta',
        });
      }
    }

    await supabase.from('received_messages').insert({
      user_id,
      platform: 'whatsapp',
      from_number: to,
      message: message || (media_url ? `[${media_type} enviado]` : ''),
      message_type: messageType,
      media_url: media_url || null,
      is_processed: true,
      created_at: new Date(),
    });

    console.log(`✅ Mensaje enviado a ${to}`);
    
    return res.status(200).json({
      success: true,
      message_id: metaResult?.messages?.[0]?.id,
      type: messageType,
    });
  } catch (error) {
    console.error('Error en send-whatsapp:', error);
    return res.status(500).json({ error: error?.message || 'Internal Server Error' });
  }
}
