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
    const { user_id, message } = req.body;

    console.log("📨 Chat IA request:", { user_id, message: message?.substring(0, 50) });

    if (!user_id || !message) {
      return res.status(400).json({ error: 'Faltan user_id o message' });
    }

    // Obtener configuración de IA
    const { data: iaConfig, error: iaError } = await supabase
      .from('chat_ia_gemini')
      .select('*')
      .eq('user_id', user_id)
      .single();

    console.log("📦 API Key:", iaConfig?.api_key ? "✅ Presente" : "❌ No presente");
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

    if (!iaConfig.api_key || iaConfig.api_key === '') {
      return res.status(400).json({ 
        error: 'No hay API Key configurada. Agrega tu API Key de Gemini en Ajustes → IA.' 
      });
    }

    // Usar gemini-pro (modelo que funciona universalmente)
    const model = 'gemini-pro';
    const apiKey = iaConfig.api_key;
    
    console.log("🤖 Llamando a Gemini con modelo:", model);

    const systemInstruction = iaConfig.system_instruction || 
      'Eres un asistente de ventas para una tienda online. Responde de manera amable y profesional.';

    // Llamar a Gemini API con gemini-pro
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `${systemInstruction}\n\nUsuario: ${message}\nAsistente:`
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        }
      })
    });

    const data = await response.json();

    console.log("📡 Respuesta Gemini:", response.status);

    if (!response.ok) {
      console.error('Error Gemini:', data);
      return res.status(500).json({ 
        error: data.error?.message || 'Error con la API de Gemini' 
      });
    }

    const botResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || 
      'Lo siento, no pude procesar tu mensaje. Por favor, intenta de nuevo.';

    console.log("✅ Respuesta generada:", botResponse.substring(0, 100));

    return res.status(200).json({ response: botResponse });

  } catch (error) {
    console.error('Error en chat-ia:', error);
    return res.status(500).json({ error: 'Error interno: ' + error.message });
  }
}
