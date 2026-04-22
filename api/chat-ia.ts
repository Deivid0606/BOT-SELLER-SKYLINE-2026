import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Lista de modelos en orden de preferencia
const MODELOS_GEMINI = [
  'gemini-1.0-pro',
  'gemini-1.0-pro-vision',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro'
];

// Función para probar si un modelo funciona
async function testModel(apiKey: string, model: string): Promise<boolean> {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'test' }] }],
        generationConfig: { maxOutputTokens: 5 }
      })
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Función para encontrar el primer modelo que funciona
async function findWorkingModel(apiKey: string): Promise<string | null> {
  for (const model of MODELOS_GEMINI) {
    console.log(`🔍 Probando modelo: ${model}`);
    const funciona = await testModel(apiKey, model);
    if (funciona) {
      console.log(`✅ Modelo encontrado: ${model}`);
      return model;
    }
  }
  return null;
}

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
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user_id, message, from_number } = req.body;

    console.log("📨 Chat IA request:", { user_id, message: message?.substring(0, 50), from_number });

    if (!user_id || !message) {
      return res.status(400).json({ error: 'Faltan user_id o message' });
    }

    // Obtener configuración de IA
    const { data: iaConfig, error: iaError } = await supabase
      .from('chat_ia_gemini')
      .select('*')
      .eq('user_id', user_id)
      .single();

    console.log("📦 Config IA encontrada:", !!iaConfig);

    if (iaError || !iaConfig) {
      return res.status(400).json({ 
        error: 'No hay configuración de IA. Ve a Ajustes → IA y guarda tu API Key.' 
      });
    }

    if (!iaConfig.is_active) {
      return res.status(400).json({ 
        error: 'La IA está desactivada. Actívala en Ajustes → IA.' 
      });
    }

    if (!iaConfig.api_key || iaConfig.api_key === '' || iaConfig.api_key === 'TU_API_KEY_AQUI') {
      return res.status(400).json({ 
        error: 'No hay API Key válida configurada. Agrega tu API Key de Gemini en Ajustes → IA.' 
      });
    }

    // Determinar qué modelo usar (con detección automática)
    let modelToUse = iaConfig.model;
    
    // Si el modelo guardado no funciona, buscar uno automáticamente
    const modeloFunciona = await testModel(iaConfig.api_key, modelToUse);
    
    if (!modeloFunciona) {
      console.log(`⚠️ Modelo ${modelToUse} no funciona, buscando alternativas...`);
      const workingModel = await findWorkingModel(iaConfig.api_key);
      
      if (workingModel) {
        modelToUse = workingModel;
        // Actualizar el modelo en la base de datos para futuras consultas
        await supabase
          .from('chat_ia_gemini')
          .update({ model: modelToUse, updated_at: new Date().toISOString() })
          .eq('user_id', user_id);
        console.log(`✅ Modelo actualizado a: ${modelToUse}`);
      } else {
        return res.status(400).json({ 
          error: 'No se encontró ningún modelo de Gemini disponible. Verifica tu API Key.' 
        });
      }
    }

    console.log("🤖 Usando modelo:", modelToUse);

    // Obtener historial de conversación
    const { data: history } = await supabase
      .from('received_messages')
      .select('message, message_type, from_number')
      .eq('from_number', from_number || 'chat_web')
      .order('created_at', { ascending: false })
      .limit(5);

    let conversationContext = '';
    if (history && history.length > 0) {
      conversationContext = history.reverse().map(msg => 
        `${msg.from_number === (from_number || 'chat_web') ? 'Usuario' : 'Bot'}: ${msg.message}`
      ).join('\n');
    }

    const systemInstruction = iaConfig.system_instruction || 
      'Eres un asistente de ventas para una tienda online. Responde de manera amable y profesional.';

    // Llamar a Gemini API
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${iaConfig.api_key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `${systemInstruction}

${conversationContext ? `Historial:\n${conversationContext}\n` : ''}
Usuario: ${message}
Asistente:`
          }]
        }],
        generationConfig: {
          temperature: iaConfig.temperature || 0.7,
          maxOutputTokens: iaConfig.max_tokens || 2048,
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Error Gemini API:', data);
      let errorMessage = 'Error con la API de Gemini.';
      
      if (data.error?.message) {
        errorMessage = data.error.message;
      }
      
      return res.status(500).json({ 
        error: errorMessage,
        details: data.error
      });
    }

    const botResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || 
      'Lo siento, no pude procesar tu mensaje. Por favor, intenta de nuevo.';

    console.log("✅ Respuesta generada:", botResponse.substring(0, 100));

    return res.status(200).json({ response: botResponse });

  } catch (error) {
    console.error('Error en chat-ia:', error);
    return res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
  }
}
