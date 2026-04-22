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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user_id, message } = req.body;

    if (!user_id || !message) {
      return res.status(400).json({ error: 'Faltan user_id o message' });
    }

    const { data: iaConfig, error: iaError } = await supabase
      .from('chat_ia_gemini')
      .select('*')
      .eq('user_id', user_id)
      .single();

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
        error: 'No hay API Key configurada.' 
      });
    }

    const { data: trainingData } = await supabase
      .from('training_data')
      .select('intent, examples, response')
      .eq('user_id', user_id)
      .eq('is_active', true);

    let trainingContext = '';
    if (trainingData && trainingData.length > 0) {
      trainingContext = trainingData.map(item => {
        const examplesText = item.examples && item.examples.length > 0 
          ? `Frases de ejemplo: "${item.examples.join('", "')}"` 
          : '';
        return `## ${item.intent}\n${examplesText}\nRespuesta: ${item.response}`;
      }).join('\n\n');
    }

    const systemInstruction = iaConfig.system_instruction || 
      'Eres un asistente de ventas para una tienda online. Responde de manera amable y profesional.';

    const fullPrompt = `${systemInstruction}

========================================
INFORMACIÓN DE ENTRENAMIENTO:
========================================
${trainingContext || 'No hay información de entrenamiento aún. Usa tu conocimiento general.'}

========================================
INSTRUCCIONES:
========================================
1. Si el usuario pregunta algo del entrenamiento, responde usando ESA información.
2. Sé amable, profesional y útil.
3. Si no sabes algo, sugiere contactar al vendedor.`;

    const model = 'openai/gpt-3.5-turbo';

    console.log("🤖 Usando modelo:", model);
    console.log("📚 Entrenamiento:", trainingData?.length || 0, "items");

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${iaConfig.api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: fullPrompt },
          { role: 'user', content: message }
        ],
        temperature: 0.7,
        max_tokens: 2048,
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Error OpenRouter:', data);
      return res.status(500).json({ 
        error: data.error?.message || 'Error con OpenRouter' 
      });
    }

    const botResponse = data.choices?.[0]?.message?.content || 
      'Lo siento, no pude procesar tu mensaje.';

    console.log("✅ Respuesta generada");

    return res.status(200).json({ response: botResponse });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Error interno: ' + error.message });
  }
}
