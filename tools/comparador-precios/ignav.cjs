#!/usr/bin/env node
/**
 * Prueba de Ignav (#A95): ¿permite comparar con la misma tarifa del manual COM-P-02?
 * Tutorial: README-ignav.md de esta carpeta.
 *
 *   node tools/comparador-precios/ignav.cjs --configurar     (guarda y valida la clave; no gasta consultas)
 *   node tools/comparador-precios/ignav.cjs --demo           (formato con datos inventados; no se conecta)
 *   node tools/comparador-precios/ignav.cjs --prueba         (5 rutas × 3 búsquedas + 4 opciones de compra ≈ 19 consultas)
 *   node tools/comparador-precios/ignav.cjs --origen BOG --destino MDE [--ida 2026-10-27] [--pasajeros 2]
 *
 * Cada ruta se busca tres veces, solo vuelos directos y en pesos (mercado CO):
 *   1. sin filtro de equipaje (lo que hoy da Google Flights),
 *   2. con al menos una maleta de mano incluida (min_carry_on_bags),
 *   3. con al menos una maleta de bodega incluida (min_checked_bags).
 * Si el precio del MISMO vuelo sube al pedir maleta, Ignav devuelve la tarifa que la
 * incluye (Avianca Classic, LATAM Light o Full): eso permitiría comparar por tarifa,
 * también con bodega. Además pide las opciones de compra de algunos vuelos, donde
 * Ignav trae el nombre de la tarifa de la aerolínea (fare_name).
 *
 * Solo consulta precios: Ignav no vende ni reserva. La clave se lee de IGNAV_API_KEY o
 * del archivo tools/comparador-precios/.ignav-key (está en .gitignore). Nunca se imprime.
 * No envía datos personales: solo ruta, fecha y número de pasajeros.
 */
const fs = require('fs');
const path = require('path');

const AQUI = __dirname;
const API = 'https://ignav.com/api';
const ARCHIVO_CLAVE = path.join(AQUI, '.ignav-key');
const MERCADO = 'CO'; // precios en pesos colombianos

const RUTAS_PRUEBA = [['BOG', 'MDE'], ['BOG', 'CLO'], ['BOG', 'CTG'], ['BOG', 'BAQ'], ['MDE', 'CTG']];
const NIVELES = [
  { clave: 'sin', titulo: 'Sin filtro', filtro: {} },
  { clave: 'mano', titulo: 'Con maleta de mano', filtro: { min_carry_on_bags: 1 } },
  { clave: 'bodega', titulo: 'Con bodega', filtro: { min_checked_bags: 1 } },
];

function argumentos(argv) {
  const a = { flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const nombre = k.slice(2);
    if (['configurar', 'demo', 'prueba', 'ayuda'].includes(nombre)) a.flags[nombre] = true;
    else a[nombre] = argv[++i];
  }
  return a;
}

function leerClave() {
  if (process.env.IGNAV_API_KEY) return process.env.IGNAV_API_KEY.trim();
  return fs.existsSync(ARCHIVO_CLAVE) ? fs.readFileSync(ARCHIVO_CLAVE, 'utf8').trim() : '';
}

function limpio(texto, clave) {
  let t = String(texto == null ? '' : texto);
  if (clave) t = t.split(clave).join('***');
  return t.slice(0, 500);
}

/** Pide un texto sin mostrarlo en pantalla (se ve un * por carácter). */
function preguntarOculto(texto) {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let oculto = false;
    rl._writeToOutput = (s) => { rl.output.write(oculto && !/[\r\n]/.test(s) ? '*'.repeat(s.length) : s); };
    rl.question(texto, (v) => { rl.close(); resolve(String(v || '').trim()); });
    oculto = true;
  });
}

function hoyIso() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Martes a 2 semanas o más desde hoy: una fecha común de viaje de trabajo. */
function fechaPrueba() {
  const [y, m, d] = hoyIso().split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 14));
  while (t.getUTCDay() !== 2) t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

/** Una llamada a Ignav. Solo las respuestas exitosas (HTTP 200) se cobran. */
async function llamar(ruta, clave, cuerpo) {
  let r, json;
  try {
    r = await fetch(API + ruta, {
      method: 'POST',
      headers: { 'X-Api-Key': clave, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(90000),
    });
    json = await r.json().catch(() => null);
  } catch (e) {
    throw new Error('No se pudo conectar con Ignav (' + limpio(e && e.message ? e.message : e, clave) + '). Revise la conexión a internet.');
  }
  if (!r.ok) {
    const er = (json && json.error) || {};
    const err = new Error(limpio(`HTTP ${r.status}${er.code ? ' ' + er.code : ''}${er.message ? ': ' + er.message : ''}`, clave));
    err.status = r.status;
    err.code = er.code;
    throw err;
  }
  return json;
}

function explicarError(e) {
  if (e.status === 401) return 'Ignav no reconoce la clave. Cópiela de nuevo del panel (ignav.com/dashboard) y repita --configurar.';
  if (e.status === 402) return 'Ignav pide registrar un medio de pago: se acabaron las 1.000 consultas gratis. ' + e.message;
  if (e.status === 429) return 'Se alcanzó el tope de gasto mensual de la cuenta. ' + e.message;
  if (e.status === 400) return 'Ignav rechazó la consulta (revise códigos de aeropuerto y fecha): ' + e.message;
  return e.message;
}

async function configurar() {
  const guardada = leerClave();
  console.log('\nClave de Ignav: la encuentra en ignav.com/dashboard después de verificar el correo (ver README-ignav.md, paso 2).');
  console.log('Al pegarla se ven asteriscos: es normal, la clave no se muestra.\n');
  let clave = await preguntarOculto(guardada
    ? 'Pegue la clave y presione Enter (o solo Enter para revisar la que ya está guardada): '
    : 'Pegue la clave y presione Enter: ');
  if (!clave) clave = guardada;
  if (!clave) { console.error('✗ No se pegó ninguna clave.'); process.exit(1); }
  if (/\s/.test(clave)) { console.error('✗ La clave tiene espacios: cópiela de nuevo.'); process.exit(1); }
  // Una consulta incompleta a propósito: si la clave sirve, Ignav responde «faltan datos»
  // (HTTP 400), y las respuestas con error no se cobran.
  console.log('Revisando la clave con Ignav (consulta incompleta a propósito: no se cobra)…');
  try {
    await llamar('/fares/one-way', clave, {});
    console.log('  (Ignav respondió una búsqueda vacía; la clave sirve.)');
  } catch (e) {
    if (e.status === 401 || (e.status !== 400 && e.status !== 402)) { console.error('✗ ' + explicarError(e)); process.exit(1); }
    if (e.status === 402) console.log('⚠ ' + explicarError(e));
  }
  fs.writeFileSync(ARCHIVO_CLAVE, clave + '\n', { mode: 0o600 });
  fs.chmodSync(ARCHIVO_CLAVE, 0o600);
  console.log(`✓ Clave válida y guardada en ${ARCHIVO_CLAVE} (solo la lee su usuario; no se sube al repositorio).`);
}

/** Itinerarios directos de una búsqueda, con lo que importa para comparar. */
function itinerarios(json) {
  return ((json && json.itineraries) || []).map((it) => {
    const segs = (it.outbound && it.outbound.segments) || [];
    const g0 = segs[0] || {};
    const bags = it.bags || {};
    return {
      vuelo: segs.map((s) => `${s.marketing_carrier_code || '?'} ${s.flight_number || '?'}`).join(' + '),
      aerolinea: (it.outbound && it.outbound.carrier) || g0.operating_carrier_name || '',
      sale: String(g0.departure_time_local || '').slice(11, 16),
      escalas: Math.max(0, segs.length - 1),
      precio: it.price ? Number(it.price.amount) : NaN,
      moneda: it.price ? it.price.currency : '',
      verificado: it.price ? it.price.status : '',
      mano: bags.carry_on === undefined ? '?' : bags.carry_on,
      bodega: bags.checked === undefined ? '?' : bags.checked,
      ignav_id: it.ignav_id || '',
    };
  });
}

function plata(n, moneda) {
  if (!isFinite(n)) return '—';
  return moneda === 'COP' ? '$' + Math.round(n).toLocaleString('es-CO') : n.toLocaleString('es-CO') + ' ' + moneda;
}

/** Tabla: cada vuelo con su precio y equipaje en las tres búsquedas. */
function imprimirRuta(titulo, porNivel) {
  console.log(`\n=== ${titulo}`);
  const vuelos = new Map();
  NIVELES.forEach((n) => (porNivel[n.clave] || []).forEach((v) => {
    const k = v.vuelo + '|' + v.sale;
    if (!vuelos.has(k)) vuelos.set(k, { vuelo: v.vuelo, sale: v.sale, aerolinea: v.aerolinea });
    vuelos.get(k)[n.clave] = v;
  }));
  if (!vuelos.size) { console.log('  Sin vuelos directos para esa ruta y fecha.'); return []; }
  const celda = (v) => (v ? `${plata(v.precio, v.moneda)} (mano ${v.mano}, bodega ${v.bodega})` : '— no aparece');
  console.log('  ' + 'Vuelo'.padEnd(11) + 'Sale   ' + NIVELES.map((n) => n.titulo.padEnd(30)).join(''));
  const filas = [...vuelos.values()].sort((a, b) => (a.sale < b.sale ? -1 : 1));
  filas.forEach((f) => console.log('  ' + f.vuelo.padEnd(11) + f.sale.padEnd(7) + NIVELES.map((n) => celda(f[n.clave]).padEnd(30)).join('')));
  const sube = filas.filter((f) => f.sin && f.bodega && f.bodega.precio > f.sin.precio + 1000).length;
  const igual = filas.filter((f) => f.sin && f.bodega && Math.abs(f.bodega.precio - f.sin.precio) <= 1000).length;
  const desaparece = filas.filter((f) => f.sin && !f.bodega).length;
  console.log(`  Con bodega: el precio sube en ${sube} vuelo(s), queda igual en ${igual} y el vuelo desaparece en ${desaparece}.`);
  return filas;
}

function imprimirOpciones(titulo, json) {
  console.log(`\n--- Opciones de compra: ${titulo}`);
  const opciones = (json && json.booking_options) || [];
  if (!opciones.length) { console.log('  Ignav no devolvió opciones de compra para este vuelo.'); return []; }
  const links = [];
  opciones.forEach((o) => (o.links || []).forEach((l) => links.push(l)));
  links.sort((a, b) => ((a.price && a.price.amount) || 0) - ((b.price && b.price.amount) || 0)).forEach((l) => {
    console.log(`  ${String(l.provider_name || '').padEnd(22)} ${String(l.provider_type || '').padEnd(12)} tarifa: ${String(l.fare_name || '(sin nombre)').padEnd(18)} ` +
      plata(l.price && Number(l.price.amount), l.price && l.price.currency));
  });
  const conNombre = links.filter((l) => l.fare_name).map((l) => l.fare_name);
  console.log(`  Nombres de tarifa vistos: ${conNombre.length ? [...new Set(conNombre)].join(', ') : 'ninguno'}`);
  return links;
}

function csv(v) {
  let t = String(v == null ? '' : v);
  if (/^[=+\-@]/.test(t)) t = "'" + t;
  return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}

async function principal() {
  const a = argumentos(process.argv.slice(2));
  if (a.flags.ayuda || process.argv.length <= 2) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n/, ''));
    return;
  }
  if (a.flags.configurar) return configurar();

  if (a.flags.demo) {
    const ej = JSON.parse(fs.readFileSync(path.join(AQUI, 'ejemplo-ignav.json'), 'utf8'));
    console.log('DEMO con datos inventados (ejemplo-ignav.json): no se conecta a Ignav.');
    imprimirRuta('BOG → MDE · 2026-10-27 · 1 pasajero (mercado CO, solo directos)',
      { sin: itinerarios(ej.sin), mano: itinerarios(ej.mano), bodega: itinerarios(ej.bodega) });
    imprimirOpciones('AV 9368 06:00', ej.opciones_av);
    return;
  }

  const clave = leerClave();
  if (!clave) {
    console.error('Falta la clave de Ignav. Guárdela con:\n  node tools/comparador-precios/ignav.cjs --configurar\nPara ver el formato sin clave: --demo');
    process.exit(1);
  }
  const ida = a.ida || fechaPrueba();
  const pasajeros = Math.max(1, Math.min(5, Number(a.pasajeros) || 1));
  const rutas = a.flags.prueba ? RUTAS_PRUEBA : [[String(a.origen || '').toUpperCase(), String(a.destino || '').toUpperCase()]];
  for (const [o, d] of rutas) {
    if (!/^[A-Z]{3}$/.test(o) || !/^[A-Z]{3}$/.test(d)) { console.error('✗ Use códigos IATA de 3 letras: --origen BOG --destino MDE'); process.exit(1); }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ida) || ida < hoyIso()) { console.error('✗ La fecha de ida debe ser AAAA-MM-DD y futura.'); process.exit(1); }
  const maximo = rutas.length * NIVELES.length + (a.flags.prueba ? 4 : 2);
  console.log(`Gastará hasta ${maximo} consultas de Ignav (las primeras 1.000 son gratis; después, USD 2 por cada 1.000).`);

  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1_');
  const salida = path.resolve(a.salida || 'resultados-comparador', 'ignav_' + stamp);
  fs.mkdirSync(path.join(salida, 'crudo'), { recursive: true });
  const guardar = (nombre, json) => fs.writeFileSync(path.join(salida, 'crudo', nombre + '.json'), JSON.stringify(json, null, 1));
  const lineas = ['ruta;ida;pasajeros;vuelo;aerolinea;sale;' + NIVELES.map((n) => `${n.clave}_precio;${n.clave}_mano;${n.clave}_bodega`).join(';')];
  const candidatosOpciones = [];

  for (const [o, d] of rutas) {
    const porNivel = {};
    for (const n of NIVELES) {
      const cuerpo = Object.assign({ origin: o, destination: d, departure_date: ida, adults: pasajeros, cabin_class: 'economy', max_stops: 0, market: MERCADO }, n.filtro);
      try {
        const json = await llamar('/fares/one-way', clave, cuerpo);
        guardar(`${o}-${d}-${n.clave}`, json);
        porNivel[n.clave] = itinerarios(json);
      } catch (e) {
        console.error(`  ✗ ${o}→${d} (${n.titulo}): ${explicarError(e)}`);
        if (e.status === 401 || e.status === 402 || e.status === 429) process.exit(1);
        porNivel[n.clave] = [];
      }
    }
    const filas = imprimirRuta(`${o} → ${d} · ${ida} · ${pasajeros} pasajero(s) (mercado CO, solo directos)`, porNivel);
    filas.forEach((f) => lineas.push([`${o}-${d}`, ida, pasajeros, f.vuelo, f.aerolinea, f.sale]
      .concat(...NIVELES.map((n) => (f[n.clave] ? [f[n.clave].precio, f[n.clave].mano, f[n.clave].bodega] : ['', '', ''])))
      .map(csv).join(';')));
    // Opciones de compra: el primer vuelo de Avianca y el primero de LATAM de la primera ruta.
    if (!candidatosOpciones.length) {
      ['AV', 'LA'].forEach((cod) => {
        const f = filas.find((x) => x.vuelo.startsWith(cod + ' ') && x.sin);
        if (f) {
          candidatosOpciones.push({ titulo: `${f.vuelo} ${f.sale} (sin filtro)`, id: f.sin.ignav_id });
          if (a.flags.prueba && f.bodega) candidatosOpciones.push({ titulo: `${f.vuelo} ${f.sale} (con bodega)`, id: f.bodega.ignav_id });
        }
      });
    }
  }

  for (const c of candidatosOpciones) {
    if (!c.id) continue;
    try {
      const json = await llamar('/fares/booking-links', clave, { ignav_id: c.id });
      guardar('opciones-' + c.titulo.replace(/[^\w]+/g, '_'), json);
      imprimirOpciones(c.titulo, json);
    } catch (e) {
      console.error(`  ✗ Opciones de compra ${c.titulo}: ${explicarError(e)}`);
    }
  }
  fs.writeFileSync(path.join(salida, 'resumen.csv'), '﻿' + lineas.join('\r\n'));
  console.log(`\nResultados en ${salida} (resumen.csv para Excel y las respuestas completas en crudo/).`);
}

principal().catch((e) => { console.error('✗ ' + (e && e.message ? e.message : e)); process.exit(1); });
