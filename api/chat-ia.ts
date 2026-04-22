import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user_id, message, from_number } = req.body;

    if (!user_id || !message) {
      return res.status(400).json({ error: 'Faltan user_id o message' });
    }

    // Obtener configuración de IA
    const { data: iaConfig, error: iaError } = await supabase
      .from('chat_ia_gemini')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (iaError || !iaConfig || !iaConfig.is_active || !iaConfig.api_key) {
      return res.status(400).json({ error: 'IA no configurada o inactiva' });
    }

    // Obtener historial de conversación
    const { data: history } = await supabase
      .from('received_messages')
      .select('message, message_type, from_number')
      .eq('from_number', from_number)
      .order('created_at', { ascending: false })
      .limit(5);

    let conversationContext = '';
    if (history && history.length > 0) {
      conversationContext = history.reverse().map(msg => 
        `${msg.from_number === from_number ? 'Cliente' : 'Bot'}: ${msg.message}`
      ).join('\n');
    }

    const systemInstruction = iaConfig.system_instruction || 
      'Eres un asistente de ventas para una tienda online. Responde de manera amable y profesional. Ayuda a los clientes con sus consultas sobre productos, precios y envíos. Si no sabes algo, deriva al vendedor.';

    // Llamar a Gemini API
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${iaConfig.model}:generateContent?key=${iaConfig.api_key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `${systemInstruction}

Historial de conversación:
${conversationContext}

Cliente: ${message}
Bot:`
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
      console.error('Error Gemini:', data);
      return res.status(500).json({ error: 'Error con la API de Gemini' });
    }

    const botResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || 
      'Lo siento, no pude procesar tu mensaje. Por favor, intenta de nuevo.';

    return res.status(200).json({ response: botResponse });

  } catch (error) {
    console.error('Error en chat-ia:', error);
    return res.status(500).json({ error: 'Error interno' });
  }
}
