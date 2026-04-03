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

// ─── HEALTH CHECK ───────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'Lomva DataTrack API funcionando' });
});

// ─── RECIBIR LECTURA DEL DISPOSITIVO ────────────────────
app.post('/lectura', async (req, res) => {
  const {
    patente,
    temperatura,
    humedad,
    presion_alta,
    presion_baja,
    puerta_abierta,
    latitud,
    longitud,
    senal
  } = req.body;

  // Buscar la unidad por patente
  const { data: unidad, error: errorUnidad } = await supabase
    .from('unidades')
    .select('id, cliente_id')
    .eq('patente', patente)
    .single();

  if (errorUnidad || !unidad) {
    return res.status(404).json({ error: 'Unidad no encontrada' });
  }

  // Guardar la lectura
  const { error: errorLectura } = await supabase
    .from('lecturas')
    .insert({
      unidad_id: unidad.id,
      temperatura,
      humedad,
      presion_alta,
      presion_baja,
      puerta_abierta,
      latitud,
      longitud,
      senal: senal || '4g'
    });

  if (errorLectura) {
    return res.status(500).json({ error: errorLectura.message });
  }

  // Verificar alertas
  await verificarAlertas(unidad, {
    temperatura,
    presion_alta,
    presion_baja,
    puerta_abierta,
    patente
  });

  res.json({ ok: true, mensaje: 'Lectura guardada' });
});

// ─── MOTOR DE ALERTAS Y DIAGNÓSTICO ─────────────────────
async function verificarAlertas(unidad, datos) {
  const { temperatura, presion_alta, presion_baja, puerta_abierta, patente } = datos;
  const alertas = [];

  // Temperatura fuera de rango
  if (temperatura > 8) {
    let diagnostico = 'Temperatura elevada';
    let nivel = 'warning';

    if (presion_alta < 10) {
      diagnostico = 'Posible falla de compresor — presión alta baja';
      nivel = 'critical';
    } else if (puerta_abierta) {
      diagnostico = 'Puerta abierta — pérdida de frío';
      nivel = 'warning';
    } else {
      diagnostico = 'Posible problema de aislación o gas';
      nivel = 'warning';
    }

    alertas.push({
      unidad_id: unidad.id,
      tipo: 'temperatura',
      mensaje: `Unidad ${patente} — Temp: ${temperatura}°C. ${diagnostico}`,
      nivel,
      diagnostico
    });
  }

  // Puerta abierta sin temperatura elevada
  if (puerta_abierta && temperatura <= 8) {
    alertas.push({
      unidad_id: unidad.id,
      tipo: 'puerta',
      mensaje: `Unidad ${patente} — Puerta abierta detectada`,
      nivel: 'warning',
      diagnostico: 'Verificar cie
