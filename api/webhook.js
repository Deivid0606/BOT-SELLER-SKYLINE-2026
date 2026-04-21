import { createClient } from '@supabase/supabase-js';

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// TOKEN
const VERIFY_TOKEN = 'miTokenSeguro2026';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  console.log(`📨 ${req.method} ${req.url}`);

  // =========================
  // VERIFICACIÓN META
  // =========================
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verificado');
      return res.status(200).send(challenge);
    } else {
      console.log('❌ Token inválido');
      return res.status(403).send('Token inválido');
    }
  }

  // =========================
  // MENSAJES ENTRANTES
  // =========================
  if (req.method === 'POST') {
    try {
      const body = req.body;

      console.log('📩 EVENTO RECIBIDO');

      if (body.object === 'whatsapp_business_account') {
        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            const value = change.value;

            // MENSAJES
            if (value.messages) {
              for (const message of value.messages) {
                await procesarMensaje(message);
              }
            }

            // ESTADOS
            if (value.statuses) {
              for (const status of value.statuses) {
                console.log('📊 Estado:', status.status);
              }
            }
          }
        }

        return res.status(200).send('EVENT_RECEIVED');
      }

      return res.status(404).send('Not WhatsApp event');

    } catch (error) {
      console.error('❌ ERROR GENERAL:', error);
      return res.status(500).send('Error');
    }
  }

  return res.status(405).send('Method Not Allowed');
}

// =========================
// PROCESAR MENSAJE
// =========================
async function procesarMensaje(message) {
  try {
    const from = message.from;
    const type = message.type;

    let contenido = '';

    if (type === 'text') {
      contenido = message.text.body;
    } else if (type === 'image') {
      contenido = '[Imagen]';
    } else if (type === 'video') {
      contenido = '[Video]';
    } else if (type === 'audio') {
      contenido = '[Audio]';
    } else if (type === 'document') {
      contenido = `[Documento: ${message.document.filename}]`;
    } else if (type === 'location') {
      contenido = `[Ubicación enviada]`;
    } else {
      contenido = '[Mensaje no soportado]';
    }

    console.log(`💬 ${from}: ${contenido}`);

    const { error } = await supabase
      .from('received_messages')
      .insert({
        user_id: null, // o tu user si lo manejas
        platform: 'whatsapp',
        from_number: from,
        message: contenido,
        message_type: type
      });

    if (error) {
      console.error('❌ ERROR SUPABASE:', error);
    } else {
      console.log('✅ Guardado en DB');
    }

  } catch (err) {
    console.error('❌ ERROR procesando mensaje:', err);
  }
}
