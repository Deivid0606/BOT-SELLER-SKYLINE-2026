import { createClient } from '@supabase/supabase-js';

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// TOKEN - Debe coincidir con tu webhook_token en Supabase
const VERIFY_TOKEN = 'miTokenSeguro2026';

export default async function handler(req, res) {
  // Habilitar CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  console.log(`📨 Método: ${req.method} - URL: ${req.url}`);

  // ============================================
  // VERIFICACIÓN GET (Handshake con Meta)
  // ============================================
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log(`🔑 Verificando - Mode: ${mode}, Token recibido: ${token}`);
    console.log(`🔑 Token esperado: ${VERIFY_TOKEN}`);

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verificado exitosamente!');
      res.status(200).send(challenge);
    } else {
      console.log('❌ Token inválido o modo incorrecto');
      res.status(403).send('Token de verificación inválido');
    }
    return;
  }

  // ============================================
  // RECEPCIÓN DE MENSAJES POST
  // ============================================
  if (req.method === 'POST') {
    try {
      const body = req.body;
      console.log('📩 Webhook recibido:', JSON.stringify(body, null, 2));

      if (body.object === 'whatsapp_business_account') {
        const entries = body.entry || [];

        for (const entry of entries) {
          const changes = entry.changes || [];

          for (const change of changes) {
            const value = change.value;

            if (value.messages && value.messages.length > 0) {
              for (const message of value.messages) {
                await procesarMensaje(message, value);
              }
            }

            if (value.statuses && value.statuses.length > 0) {
              for (const status of value.statuses) {
                await procesarEstado(status);
              }
            }
          }
        }

        res.status(200).send('EVENT_RECEIVED');
      } else {
        res.status(404).send('Not a WhatsApp event');
      }
    } catch (error) {
      console.error('❌ Error procesando webhook:', error);
      res.status(500).send('Internal Server Error');
    }
    return;
  }

  res.status(405).send('Method Not Allowed');
}

async function procesarMensaje(message, value) {
  console.log(`💬 Procesando mensaje:`, message);

  const from = message.from;
  const timestamp = message.timestamp;
  const type = message.type;

  let contenido = '';
  let mediaUrl = null;
  let mediaType = null;

  if (type === 'text') {
    contenido = message.text.body;
  } else if (type === 'image') {
    contenido = '[Imagen]';
    mediaUrl = message.image.id;
    mediaType = 'image';
  } else if (type === 'video') {
    contenido = '[Video]';
    mediaUrl = message.video.id;
    mediaType = 'video';
  } else if (type === 'audio') {
    contenido = '[Audio]';
    mediaUrl = message.audio.id;
    mediaType = 'audio';
  } else if (type === 'document') {
    contenido = `[Documento: ${message.document.filename}]`;
    mediaUrl = message.document.id;
    mediaType = 'document';
  } else if (type === 'location') {
    contenido = `[Ubicación: ${message.location.latitude}, ${message.location.longitude}]`;
  } else if (type === 'interactive') {
    contenido = `[Interactivo: ${message.interactive.type}]`;
  }

  const { error } = await supabase
    .from('received_messages')
    .insert({
      phone_number: from,
      message: contenido,
      type: type,
      media_url: mediaUrl,
      media_type: mediaType,
      timestamp: new Date(timestamp * 1000),
      raw_data: message,
      is_read: false,
      created_at: new Date()
    });

  if (error) {
    console.error('❌ Error guardando mensaje:', error);
  } else {
    console.log(`✅ Mensaje guardado de ${from}`);
  }
}

async function procesarEstado(status) {
  console.log(`📊 Estado actualizado: ${status.status} - ID: ${status.id}`);
}
