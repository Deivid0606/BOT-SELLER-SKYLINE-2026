import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const VERIFY_TOKEN = 'miTokenSeguro2026';

// ============================================
// FUNCIÓN: Obtener respuesta de IA
// ============================================
async function getAIResponse(userId, message, fromNumber) {
  try {
    const apiUrl = `${process.env.NEXT_PUBLIC_VERCEL_URL || 'https://bot-seller-skyline-2026.vercel.app'}/api/chat-ia`;
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        user_id: userId, 
        message, 
        from_number: fromNumber
      })
    });
    
    const data = await response.json();
    return data.response || null;
  } catch (error) {
    console.error('Error obteniendo respuesta IA:', error);
    return null;
  }
}

// ============================================
// FUNCIÓN: Enviar mensaje por WhatsApp
// ============================================
async function sendWhatsAppMessage(userId, to, message) {
  try {
    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, permanent_token')
      .eq('user_id', userId)
      .single();

    if (!config) return null;

    const response = await fetch(
      `https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.permanent_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to,
          type: 'text',
          text: { body: message },
        }),
      }
    );

    const result = await response.json();
    
    if (response.ok) {
      await supabase.from('received_messages').insert({
        user_id: userId,
        platform: 'whatsapp',
        from_number: to,
        message: message,
        message_type: 'out_text',
        is_processed: true,
        created_at: new Date(),
      });
    }
    
    return result;
  } catch (error) {
    console.error('Error enviando mensaje:', error);
    return null;
  }
}

// ============================================
// FUNCIÓN: Procesar disparadores por palabras clave
// ============================================
async function procesarDisparadores(userId, fromNumber, message) {
  try {
    const { data: triggers } = await supabase
      .from('triggers')
      .select('*')
      .eq('user_id', userId)
      .eq('active', true);

    if (!triggers || triggers.length === 0) return null;

    const messageLower = message.toLowerCase();
    
    for (const trigger of triggers) {
      const condition = trigger.condition?.toLowerCase();
      
      if (condition && messageLower.includes(condition)) {
        console.log(`🎯 Disparador encontrado: ${trigger.name}`);
        
        let responseText = trigger.response;
        
        if (trigger.template && trigger.template !== 'Ninguna') {
          const { data: template } = await supabase
            .from('templates')
            .select('content')
            .eq('name', trigger.template)
            .eq('user_id', userId)
            .single();
          
          if (template?.content) {
            responseText = template.content;
          }
        }
        
        if (responseText) {
          await sendWhatsAppMessage(userId, fromNumber, responseText);
        }
        
        return trigger;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error procesando disparadores:', error);
    return null;
  }
}

// ============================================
// FUNCIÓN: Descargar multimedia y subir a Supabase Storage
// ============================================
async function downloadAndUploadMedia(mediaId, token) {
  try {
    const mediaUrlResponse = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!mediaUrlResponse.ok) return null;
    
    const mediaData = await mediaUrlResponse.json();
    if (!mediaData.url) return null;
    
    const fileResponse = await fetch(mediaData.url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!fileResponse.ok) return null;
    
    const fileBuffer = await fileResponse.arrayBuffer();
    
    let mediaType = 'document';
    let fileExt = 'bin';
    const mimeType = mediaData.mime_type || 'application/octet-stream';
    
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
    
    const fileName = `incoming/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
    
    const { error: uploadError } = await supabase.storage
      .from('templates-media')
      .upload(fileName, Buffer.from(fileBuffer), { contentType: mimeType });
    
    if (uploadError) return null;
    
    const { data: { publicUrl } } = supabase.storage
      .from('templates-media')
      .getPublicUrl(fileName);
    
    return { url: publicUrl, type: mediaType };
  } catch (error) {
    console.error('Error en downloadAndUploadMedia:', error);
    return null;
  }
}

// ============================================
// FUNCIÓN: Procesar mensaje entrante
// ============================================
async function procesarMensaje(message, token, userId, fromNumber) {
  try {
    const type = message.type;
    let contenido = '';
    let mediaUrl = null;
    let mediaType = null;
    let mediaId = null;
    const now = new Date();
    
    if (type === 'text') {
      contenido = message.text.body;
    } else if (type === 'image') {
      mediaId = message.image.id;
      contenido = '[Imagen]';
    } else if (type === 'video') {
      mediaId = message.video.id;
      contenido = '[Video]';
    } else if (type === 'audio') {
      mediaId = message.audio.id;
      contenido = '[Audio]';
    } else {
      contenido = '[Mensaje no soportado]';
    }
    
    if (mediaId) {
      const mediaResult = await downloadAndUploadMedia(mediaId, token);
      if (mediaResult) {
        mediaUrl = mediaResult.url;
        mediaType = mediaResult.type;
      }
    }
    
    // Guardar mensaje con el from_number correcto
    await supabase.from('received_messages').insert({
      user_id: userId,
      platform: 'whatsapp',
      from_number: fromNumber,
      message: contenido,
      message_type: type,
      media_url: mediaUrl,
      media_type: mediaType,
      is_processed: false,
      created_at: now,
    });
    
    console.log(`📝 Mensaje guardado de ${fromNumber}: ${contenido.substring(0, 50)}`);
    
    if (type === 'text' && contenido.trim()) {
      // 1. PRIMERO: Procesar disparadores
      const triggerResult = await procesarDisparadores(userId, fromNumber, contenido);
      
      // 2. Si NO hay disparador, usar IA
      if (!triggerResult) {
        const { data: iaConfig } = await supabase
          .from('chat_ia_gemini')
          .select('is_active')
          .eq('user_id', userId)
          .single();
        
        if (iaConfig?.is_active) {
          const { data: waConfig } = await supabase
            .from('whatsapp_config')
            .select('bot_response_delay_seconds')
            .eq('user_id', userId)
            .single();
          
          const delay = waConfig?.bot_response_delay_seconds || 5; // 5 segundos para pruebas
          
          console.log(`🤖 IA activa, respondiendo en ${delay}s a ${fromNumber}`);
          
          setTimeout(async () => {
            const aiResponse = await getAIResponse(userId, contenido, fromNumber);
            if (aiResponse) {
              console.log(`💬 IA responde a ${fromNumber}: ${aiResponse.substring(0, 50)}`);
              await sendWhatsAppMessage(userId, fromNumber, aiResponse);
            }
          }, delay * 1000);
        }
      }
    }
    
  } catch (err) {
    console.error('Error procesando mensaje:', err);
  }
}

// ============================================
// HANDLER PRINCIPAL
// ============================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Token inválido');
  }

  if (req.method === 'POST') {
    try {
      const body = req.body;
      
      if (body.object === 'whatsapp_business_account') {
        // Obtener el user_id y token de la configuración
        const { data: config } = await supabase
          .from('whatsapp_config')
          .select('user_id, permanent_token')
          .limit(1)
          .single();
        
        const userId = config?.user_id;
        const token = config?.permanent_token;
        
        if (!userId) {
          console.error('❌ No se encontró user_id en whatsapp_config');
          return res.status(500).json({ error: 'Configuración no encontrada' });
        }
        
        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            const value = change.value;
            
            if (value.messages) {
              for (const message of value.messages) {
                const fromNumber = message.from;
                await procesarMensaje(message, token, userId, fromNumber);
              }
            }
          }
        }
        
        return res.status(200).send('EVENT_RECEIVED');
      }
      return res.status(404).send('Not WhatsApp event');
    } catch (error) {
      console.error('Error:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  return res.status(405).send('Method Not Allowed');
}
