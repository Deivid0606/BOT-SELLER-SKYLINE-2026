// api/send-template.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BAILEYS_URL = process.env.BAILEYS_SERVER_URL;

// Mapeo de templateId a producto
const TEMPLATE_PRODUCT_MAP = {
  // Reemplaza estos IDs con los IDs reales de tus templates en Supabase
  "template_destapa_id": "Destapa Cañerías Tornado",
  "template_raqueta_id": "Raqueta Eléctrica para Insectos",
  "template_veneno_id": "Veneno de Abeja",
  "template_plantillas_id": "PLANTILLAS ORTOPIEX 5D®",
  "template_peladora_id": "Peladora Automática",
};

const PRODUCT_PRICES = {
  "Destapa Cañerías Tornado": 159900,
  "Raqueta Eléctrica para Insectos": 89000,
  "Veneno de Abeja": 129900,
  "PLANTILLAS ORTOPIEX 5D®": 149900,
  "Peladora Automática": 179900,
  "Máquina para hacer Pororo": 249900,
  "Tabla de Picar de Mármol": 169900,
  "Afilador de Cuchillos": 99900,
  "Vital Honey VIP": 199900,
  "Perfume Asad": 159900,
  "Kit Antivibración x4 Patitas Antideslizantes": 119900,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { templateId, recipients, userId } = req.body;

    if (!templateId || !Array.isArray(recipients) || !userId) {
      return res.status(400).json({ error: 'Missing templateId, recipients[] or userId' });
    }

    const { data: tpl, error: tplErr } = await supabase
      .from('templates')
      .select('*')
      .eq('id', templateId)
      .eq('user_id', userId)
      .single();

    if (tplErr || !tpl) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Determinar el producto
    let productName = TEMPLATE_PRODUCT_MAP[templateId];
    if (!productName) {
      // Intentar extraer del contenido
      const content = tpl.content || '';
      if (content.toLowerCase().includes('destapa') || content.toLowerCase().includes('cañeria')) {
        productName = 'Destapa Cañerías Tornado';
      } else if (content.toLowerCase().includes('raqueta')) {
        productName = 'Raqueta Eléctrica para Insectos';
      } else if (content.toLowerCase().includes('veneno') || content.toLowerCase().includes('abeja')) {
        productName = 'Veneno de Abeja';
      } else if (content.toLowerCase().includes('plantilla')) {
        productName = 'PLANTILLAS ORTOPIEX 5D®';
      } else if (content.toLowerCase().includes('pelador')) {
        productName = 'Peladora Automática';
      } else {
        productName = '';
      }
    }

    const productPrice = PRODUCT_PRICES[productName] || 0;

    const media = tpl.variables?.media || {};
    const imageUrls = media.imageUrls || [];
    const videoUrl = media.videoUrl;
    const gifUrl = media.gifUrl;

    const results = { sent: 0, failed: 0, errors: [] };

    for (const raw of recipients) {
      const to = String(raw).replace(/[^0-9]/g, '');
      try {
        // Enviar imágenes
        for (const url of imageUrls) {
          await fetch(`${BAILEYS_URL}/send-media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, mediaUrl: url, type: 'image', caption: '' }),
          });
          await sleep(500);
        }
        
        if (videoUrl) {
          await fetch(`${BAILEYS_URL}/send-media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, mediaUrl: videoUrl, type: 'video', caption: '' }),
          });
          await sleep(500);
        }
        
        if (gifUrl) {
          await fetch(`${BAILEYS_URL}/send-media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, mediaUrl: gifUrl, type: 'gif', caption: '' }),
          });
          await sleep(500);
        }
        
        // Enviar mensaje de texto
        if (tpl.content) {
          await fetch(`${BAILEYS_URL}/send-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, message: tpl.content }),
          });
        }

        // Guardar mensaje saliente
        await supabase.from('inbox_messages').insert({
          user_id: userId,
          source: 'outbound',
          platform: 'whatsapp',
          sender_id: to,
          from_number: to,
          message: tpl.content || '',
          message_type: imageUrls.length > 0 ? 'image' : (videoUrl ? 'video' : 'text'),
          is_read: true,
          is_processed: true,
        });

        // 🔥 CRÍTICO: Guardar contexto para que el bot recuerde qué producto envió
        if (productName) {
          const { data: existingContext } = await supabase
            .from('user_contexts')
            .select('id')
            .eq('user_id', userId)
            .eq('from_number', to)
            .maybeSingle();

          const contextData = {
            user_id: userId,
            from_number: to,
            step: 'awaiting_quantity',
            product: productName,
            quantity: 0,
            city: '',
            customer_name: '',
            phone: '',
            address: '',
            total_amount: 0,
            last_template_sent: productName,
            last_template_price: productPrice,
            last_template_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          if (existingContext) {
            await supabase
              .from('user_contexts')
              .update(contextData)
              .eq('id', existingContext.id);
          } else {
            await supabase
              .from('user_contexts')
              .insert(contextData);
          }

          console.log(`✅ Contexto guardado para ${to}: product=${productName}, step=awaiting_quantity`);
        }

        results.sent++;
        await sleep(2000 + Math.random() * 2000);
        
      } catch (e) {
        results.failed++;
        results.errors.push({ to, error: e.message });
      }
    }

    await supabase
      .from('templates')
      .update({ usage_count: (tpl.usage_count || 0) + results.sent })
      .eq('id', templateId);

    return res.status(200).json({ ok: true, ...results });
    
  } catch (err) {
    console.error('send-template error:', err);
    return res.status(500).json({ error: err.message });
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
