import { createClient } from '@supabase/supabase-js';

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// TOKEN de verificación
const VERIFY_TOKEN = 'miTokenSeguro2026';

// ============================================
// FUNCIÓN: Descargar multimedia y subir a Supabase Storage
// ============================================
async function downloadAndUploadMedia(mediaId, phoneNumberId, token, userId) {
  try {
    console.log(`📥 Descargando media ID: ${mediaId}`);
    
    // 1. Obtener URL del media de Meta
    const mediaUrlResponse = await fetch(
      `https://graph.facebook.com/v22.0/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    
    if (!mediaUrlResponse.ok) {
      console.error("Error obteniendo URL del media:", await mediaUrlResponse.text());
      return null;
    }
    
    const mediaData = await mediaUrlResponse.json();
    
    if (!mediaData.url) {
      console.error("No se obtuvo URL del media:", mediaData);
      return null;
    }
    
    console.log(`📎 URL del media: ${mediaData.url}`);
    
    // 2. Descargar el archivo
    const fileResponse = await fetch(mediaData.url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!fileResponse.ok) {
      console.error("Error descargando archivo:", await fileResponse.text());
      return null;
    }
    
    const fileBuffer = await fileResponse.arrayBuffer();
    
    // 3. Detectar tipo de archivo
    let fileExt = 'bin';
    let mediaType = 'document';
    let mimeType = mediaData.mime_type || 'application/octet-stream';
    
    if (mimeType.includes('image')) {
      mediaType = 'image';
      fileExt = mimeType.split('/')[1] || 'jpg';
    } else if (mimeType.includes('video')) {
      mediaType = 'video';
      fileExt = mimeType.split('/')[1] || 'mp4';
    } else if (mimeType.includes('audio')) {
      mediaType = 'audio';
      fileExt = mimeType.split('/')[1] || 'mp3';
    }
    
    // 4. Generar nombre de archivo único
    const fileName = `${userId || 'unknown'}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `incoming/${fileName}`;
    
    // 5. Subir a Supabase Storage
    const { error: uploadError, data: uploadData } = await supabase.storage
      .from('templates-media')
      .upload(filePath, Buffer.from(fileBuffer), {
        contentType: mimeType,
        cacheControl: '3600',
      });
    
    if (uploadError) {
      console.error("Error subiendo a Storage:", uploadError);
      return null;
    }
    
    // 6. Obtener URL pública
    const { data: { publicUrl } } = supabase.storage
      .from('templates-media')
      .getPublicUrl(filePath);
    
    console.log(`✅ Multimedia guardada: ${publicUrl} (tipo: ${mediaType})`);
    
    return { url: publicUrl, type: mediaType, mimeType };
    
  } catch (error) {
    console.error("Error en downloadAndUploadMedia:", error);
    return null;
  }
}

// ============================================
// FUNCIÓN: Procesar mensaje entrante
// ============================================
async function procesarMensaje(message, phoneNumberId, token) {
  try {
    const from = message.from;
    const type = message.type;
    const timestamp = message.timestamp;
    
    let contenido = '';
    let mediaUrl = null;
    let mediaType = null;
    let mediaId = null;
    
    // Extraer media ID según el tipo
    if (type === 'text') {
      contenido = message.text.body;
    } 
    else if (type === 'image') {
      mediaId = message.image.id;
      contenido = '[Imagen]';
    } 
    else if (type === 'video') {
      mediaId = message.video.id;
      contenido = '[Video]';
    } 
    else if (type === 'audio') {
      mediaId = message.audio.id;
      contenido = '[Audio]';
    } 
    else if (type === 'document') {
      mediaId = message.document.id;
      contenido = `[Documento: ${message.document.filename || 'archivo'}]`;
    } 
    else if (type === 'location') {
      contenido = `[Ubicación: ${message.location.latitude}, ${message.location.longitude}]`;
    } 
    else if (type === 'sticker') {
      contenido = '[Sticker]';
    } 
    else if (type === 'reaction') {
      contenido = `[Reacción: ${message.reaction.emoji}]`;
    }
    else {
      contenido = '[Mensaje no soportado]';
    }
    
    console.log(`💬 Mensaje de ${from}: ${contenido.substring(0, 100)}`);
    
    // Si tiene multimedia, descargar y subir a Storage
    if (mediaId) {
      console.log(`📥 Procesando multimedia ID: ${mediaId}`);
      const mediaResult = await downloadAndUploadMedia(mediaId, phoneNumberId, token, null);
      if (mediaResult) {
        mediaUrl = mediaResult.url;
        mediaType = mediaResult.type;
        console.log(`✅ Multimedia guardada: ${mediaUrl} (${mediaType})`);
      } else {
        console.log(`⚠️ No se pudo procesar la multimedia ID: ${mediaId}`);
      }
    }
    
    // Guardar en Supabase
    const { data, error } = await supabase
      .from('received_messages')
      .insert({
        user_id: null,
        platform: 'whatsapp',
        from_number: from,
        message: contenido,
        message_type: type,
        media_url: mediaUrl,
        media_type: mediaType,
        is_processed: false,
        created_at: new Date(timestamp ? timestamp * 1000 : new Date())
      })
      .select();
    
    if (error) {
      console.error('❌ Error guardando en Supabase:', error);
    } else {
      console.log('✅ Mensaje guardado en DB con ID:', data?.[0]?.id);
    }
    
    return { success: true, mediaUrl, mediaType };
    
  } catch (err) {
    console.error('❌ Error procesando mensaje:', err);
    return { success: false, error: err.message };
  }
}

// ============================================
// FUNCIÓN: Procesar estado de mensaje
// ============================================
async function procesarEstado(status) {
  try {
    console.log(`📊 Estado actualizado: ${status.status} - ID: ${status.id}`);
    // Aquí puedes actualizar el estado en tu tabla de mensajes enviados si la tienes
  } catch (err) {
    console.error('Error procesando estado:', err);
  }
}

// ============================================
// HANDLER PRINCIPAL
// ============================================
export default async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  console.log(`📨 ${req.method} ${req.url}`);

  // ============================================
  // VERIFICACIÓN GET (Handshake con Meta)
  // ============================================
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log(`🔑 Verificando - Mode: ${mode}, Token: ${token}`);

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verificado exitosamente!');
      return res.status(200).send(challenge);
    } else {
      console.log('❌ Token inválido o modo incorrecto');
      return res.status(403).send('Token de verificación inválido');
    }
  }

  // ============================================
  // RECEPCIÓN DE MENSAJES POST
  // ============================================
  if (req.method === 'POST') {
    try {
      const body = req.body;
      console.log('📩 Webhook POST recibido');

      if (body.object === 'whatsapp_business_account') {
        const entries = body.entry || [];
        
        // Obtener phone_number_id y token de la configuración
        // Nota: Esto es un ejemplo, deberías obtenerlo según tu lógica de negocio
        let phoneNumberId = null;
        let permanentToken = null;
        
        // Intentar obtener la configuración de Supabase
        try {
          const { data: config } = await supabase
            .from('whatsapp_config')
            .select('phone_number_id, permanent_token')
            .limit(1)
            .single();
          
          if (config) {
            phoneNumberId = config.phone_number_id;
            permanentToken = config.permanent_token;
          }
        } catch (err) {
          console.log('No se pudo obtener configuración de Supabase:', err.message);
        }
        
        for (const entry of entries) {
          const changes = entry.changes || [];
          
          for (const change of changes) {
            const value = change.value;
            
            // Procesar mensajes entrantes
            if (value.messages && value.messages.length > 0) {
              for (const message of value.messages) {
                await procesarMensaje(message, phoneNumberId, permanentToken);
              }
            }
            
            // Procesar estados de mensajes (entregado, leído)
            if (value.statuses && value.statuses.length > 0) {
              for (const status of value.statuses) {
                await procesarEstado(status);
              }
            }
          }
        }
        
        return res.status(200).send('EVENT_RECEIVED');
      } else {
        console.log('⚠️ Evento no es de WhatsApp Business');
        return res.status(404).send('Not a WhatsApp event');
      }
    } catch (error) {
      console.error('❌ Error procesando webhook:', error);
      return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
  }

  return res.status(405).send('Method Not Allowed');
}
