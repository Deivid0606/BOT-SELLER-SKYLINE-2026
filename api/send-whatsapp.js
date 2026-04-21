import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
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
    const { user_id, to, message } = req.body || {};

    if (!user_id) {
      return res.status(400).json({ error: 'Falta user_id' });
    }

    if (!to || !message) {
      return res.status(400).json({ error: 'Faltan datos: to y message son obligatorios' });
    }

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

    const metaResponse = await fetch(
      `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
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

    const metaResult = await metaResponse.json();

    if (!metaResponse.ok) {
      return res.status(metaResponse.status).json({
        error: metaResult?.error?.message || 'Error enviando mensaje a Meta',
        details: metaResult,
      });
    }

    const { error: insertError } = await supabase
      .from('received_messages')
      .insert({
        user_id,
        platform: 'whatsapp',
        from_number: to,
        message,
        message_type: 'out_text',
        media_url: null,
        is_processed: true,
      });

    if (insertError) {
      console.error('Error guardando mensaje saliente:', insertError);
    }

    return res.status(200).json({
      success: true,
      meta: metaResult,
    });
  } catch (error) {
    console.error('Error general en send-whatsapp:', error);
    return res.status(500).json({
      error: error?.message || 'Internal Server Error',
    });
  }
}
