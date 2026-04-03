require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

app.get('/', (req, res) => {
  res.json({ status: 'Lomva DataTrack API funcionando' });
});

app.post('/lectura', async (req, res) => {
  const { patente, temperatura, humedad, presion_alta, presion_baja, puerta_abierta, latitud, longitud, senal } = req.body;

  const { data: unidad, error: errorUnidad } = await supabase
    .from('unidades')
    .select('id, cliente_id')
    .eq('patente', patente)
    .single();

  if (errorUnidad || !unidad) {
    return res.status(404).json({ error: 'Unidad no encontrada' });
  }

  const { error: errorLectura } = await supabase
    .from('lecturas')
    .insert({ unidad_id: unidad.id, temperatura, humedad, presion_alta, presion_baja, puerta_abierta, latitud, longitud, senal: senal || '4g' });

  if (errorLectura) {
    return res.status(500).json({ error: errorLectura.message });
  }

  await verificarAlertas(unidad, { temperatura, presion_alta, presion_baja, puerta_abierta, patente });

  res.json({ ok: true, mensaje: 'Lectura guardada' });
});

async function verificarAlertas(unidad, datos) {
  const { temperatura, presion_alta, presion_baja, puerta_abierta, patente } = datos;
  const alertas = [];

  if (temperatura > 8) {
    let diagnostico = 'Temperatura elevada';
    let nivel = 'warning';

    if (presion_alta < 10) {
      diagnostico = 'Posible falla de compresor - presion alta baja';
      nivel = 'critical';
    } else if (puerta_abierta) {
      diagnostico = 'Puerta abierta - perdida de frio';
      nivel = 'warning';
    } else {
      diagnostico = 'Posible problema de aislacion o gas';
      nivel = 'warning';
    }

    alertas.push({ unidad_id: unidad.id, tipo: 'temperatura', mensaje: 'Unidad ' + patente + ' - Temp: ' + temperatura + 'C. ' + diagnostico, nivel, diagnostico });
  }

  if (puerta_abierta && temperatura <= 8) {
    alertas.push({ unidad_id: unidad.id, tipo: 'puerta', mensaje: 'Unidad ' + patente + ' - Puerta abierta detectada', nivel: 'warning', diagnostico: 'Verificar cierre de puerta' });
  }

  if (presion_alta > 30) {
    alertas.push({ unidad_id: unidad.id, tipo: 'presion', mensaje: 'Unidad ' + patente + ' - Presion alta: ' + presion_alta + ' bar. Riesgo de sobrecarga', nivel: 'critical', diagnostico: 'Apagar equipo y llamar tecnico urgente' });
  }

  for (const alerta of alertas) {
    const { data: alertaGuardada } = await supabase
      .from('alertas')
      .insert({ unidad_id: alerta.unidad_id, tipo: alerta.tipo, mensaje: alerta.mensaje, nivel: alerta.nivel })
      .select()
      .single();

    await enviarWhatsApp(alerta.mensaje, alerta.nivel);

    if (alerta.nivel === 'critical' && alertaGuardada) {
      await crearOrdenTrabajo(alertaGuardada.id, unidad.id, alerta.diagnostico);
    }
  }
}

async function enviarWhatsApp(mensaje, nivel) {
  try {
    if (!process.env.TWILIO_ACCOUNT_SID) return;
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const emoji = nivel === 'critical' ? '[CRITICO]' : '[ALERTA]';
    await twilio.messages.create({
      from: 'whatsapp:' + process.env.TWILIO_WHATSAPP_FROM,
      to: 'whatsapp:' + process.env.ALERTA_WHATSAPP_TO,
      body: emoji + ' LOMVA DATATRACK\n' + mensaje
    });
  } catch (err) {
    console.error('Error WhatsApp:', err.message);
  }
}

async function crearOrdenTrabajo(alertaId, unidadId, diagnostico) {
  await supabase.from('ordenes_trabajo').insert({ alerta_id: alertaId, unidad_id: unidadId, diagnostico, estado: 'pendiente' });
}

app.get('/unidad/:patente/lecturas', async (req, res) => {
  const { data, error } = await supabase
    .from('lecturas')
    .select('*, unidades!inner(patente)')
    .eq('unidades.patente', req.params.patente)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/alertas', async (req, res) => {
  const { data, error } = await supabase
    .from('alertas')
    .select('*, unidades(patente)')
    .eq('resuelta', false)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/ordenes', async (req, res) => {
  const { data, error } = await supabase
    .from('ordenes_trabajo')
    .select('*, unidades(patente)')
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Lomva DataTrack API corriendo en puerto ' + PORT);
});
