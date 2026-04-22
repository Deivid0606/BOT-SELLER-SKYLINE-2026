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
    console.log("📦 API Key presente:", !!iaConfig?.api_key);
    console.log("📦 IA Activa:", iaConfig?.is_active);

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

    console.log("🤖 Llamando a Gemini API con modelo:", iaConfig.model);

    // Llamar a Gemini API (versión simplificada para evitar errores)
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${iaConfig.model}:generateContent?key=${iaConfig.api_key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: message }]
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
