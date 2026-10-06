#!/usr/bin/env node
/**
 * Comparador de precios de tiquetes — PRUEBA. Ver README.md de esta carpeta.
 *
 *   node tools/comparador-precios/buscar.cjs --configurar      (guarda y valida la clave; no gasta búsquedas)
 *   node tools/comparador-precios/buscar.cjs --demo
 *   node tools/comparador-precios/buscar.cjs --rutas-prueba    (8 rutas, fechas calculadas desde hoy)
 *   node tools/comparador-precios/buscar.cjs --origen BOGOTA --destino CALI --ida 2026-10-20 --regreso 2026-10-22 --hora-ida 06:30 --cotizado 569395
 *   node tools/comparador-precios/buscar.cjs --origen BOGOTA --destino CALI --solo-ida   (sin --ida: fechas de la prueba de rutas)
 *   node tools/comparador-precios/buscar.cjs --lote viajes.csv
 *
 * La clave de SerpApi se lee de la variable SERPAPI_KEY o del archivo
 * tools/comparador-precios/.serpapi-key (está en .gitignore). Nunca se imprime.
 */
const fs = require('fs');
const path = require('path');
const cp = require('./comparador.cjs');

const AQUI = __dirname;

function argumentos(argv) {
  const a = { flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const nombre = k.slice(2);
    if (['demo', 'profunda', 'ayuda', 'vendedores', 'rutas-prueba', 'configurar', 'solo-ida'].includes(nombre)) a.flags[nombre] = true;
    else a[nombre] = argv[++i];
  }
  return a;
}

function claveApi() {
  if (process.env.SERPAPI_KEY) return process.env.SERPAPI_KEY.trim();
  const f = path.join(AQUI, '.serpapi-key');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : '';
}

/**
 * Rutas para probar la cobertura: las grandes rutas nacionales, dos que salen de Olaya
 * Herrera (EOH, en Medellín) para ver a Satena y Clic, una regional y una internacional.
 * No son las más frecuentes de la base: están escogidas para cubrir las aerolíneas.
 */
const RUTAS_PRUEBA = [
  ['R1', 'BOGOTA', 'MEDELLIN'], ['R2', 'BOGOTA', 'CALI'], ['R3', 'BOGOTA', 'BARRANQUILLA'], ['R4', 'BOGOTA', 'CARTAGENA'],
  ['R5', 'MEDELLIN', 'CALI'], ['R6', 'MEDELLIN', 'QUIBDO'], ['R7', 'BOGOTA', 'YOPAL'], ['R8', 'BOGOTA', 'QUITO'],
];

/** Martes a 2 semanas o más desde hoy, con regreso el jueves: fechas comunes de viaje de trabajo. */
function fechasPrueba() {
  const [y, m, d] = hoyIso().split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 14));
  while (t.getUTCDay() !== 2) t.setUTCDate(t.getUTCDate() + 1);
  const ida = t.toISOString().slice(0, 10);
  t.setUTCDate(t.getUTCDate() + 2);
  return { ida, regreso: t.toISOString().slice(0, 10) };
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

/** Estado de la cuenta en SerpApi. La consulta es gratis: no gasta búsquedas. Nunca devuelve la clave. */
async function revisarCuenta(clave) {
  let r, json;
  try {
    r = await fetch('https://serpapi.com/account.json?api_key=' + encodeURIComponent(clave));
    json = await r.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, error: 'No se pudo conectar con SerpApi (' + (e && e.message ? e.message : e) + '). Revise la conexión a internet.' };
  }
  if (r.status === 401 || json.error) {
    return { ok: false, error: 'SerpApi no reconoce esa clave. Cópiela de nuevo desde https://serpapi.com/manage-api-key (sin espacios) y repita --configurar.' };
  }
  return {
    ok: true,
    plan: json.plan_name || '—',
    quedan: typeof json.total_searches_left === 'number' ? json.total_searches_left : json.plan_searches_left,
    porMes: json.searches_per_month,
    porHora: json.account_rate_limit_per_hour,
    usadasHora: json.this_hour_searches,
  };
}

async function configurar() {
  const archivo = path.join(AQUI, '.serpapi-key');
  const guardada = claveApi();
  console.log('\nClave de SerpApi: la encuentra en https://serpapi.com/manage-api-key (inicie sesión primero).');
  console.log('Al pegarla se ven asteriscos: es normal, la clave no se muestra.\n');
  let clave = await preguntarOculto(guardada
    ? 'Pegue la clave y presione Enter (o solo Enter para revisar la que ya está guardada): '
    : 'Pegue la clave y presione Enter: ');
  if (!clave) clave = guardada;
  if (!clave) { console.error('✗ No se pegó ninguna clave.'); process.exit(1); }
  if (/\s/.test(clave)) { console.error('✗ La clave tiene espacios: cópiela de nuevo, solo las letras y números.'); process.exit(1); }
  console.log('Revisando la clave con SerpApi (no gasta búsquedas)…');
  const c = await revisarCuenta(clave);
  if (!c.ok) { console.error('✗ ' + c.error); process.exit(1); }
  fs.writeFileSync(archivo, clave + '\n', { mode: 0o600 });
  fs.chmodSync(archivo, 0o600);
  console.log(`✓ Clave válida y guardada en ${archivo} (solo la lee su usuario; no se sube al repositorio).`);
  console.log(`  Plan ${c.plan}: le quedan ${c.quedan} búsquedas este mes` + (c.porHora ? ` (máximo ${c.porHora} por hora).` : '.'));
}

/** CSV con encabezado (separador «,» o «;»): id,origen,destino,ida,regreso,pasajeros,hora_ida,cotizado */
function leerLote(archivo) {
  const lineas = fs.readFileSync(archivo, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const sep = lineas[0].includes(';') ? ';' : ',';
  const cab = lineas[0].split(sep).map((c) => c.trim().toLowerCase());
  return lineas.slice(1).map((l) => {
    const v = l.split(sep);
    const o = {};
    cab.forEach((c, i) => { o[c] = (v[i] || '').trim(); });
    return { id: o.id, origen: o.origen, destino: o.destino, ida: o.ida, regreso: o.regreso, pasajeros: o.pasajeros, horaIda: o.hora_ida, cotizado: o.cotizado };
  });
}

const pesos = (n) => (n === null || n === undefined ? '—' : '$' + Math.round(n).toLocaleString('es-CO'));
const pct = (x) => (x === null ? '' : (x > 0 ? '+' : '') + (x * 100).toFixed(1).replace('.', ',') + ' %');
const hora = (s) => (String(s).match(/\d{1,2}:\d{2}/) || [''])[0];
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const padL = (s, n) => String(s).padStart(n).slice(-n);
const hoyIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

async function consultar(viaje, clave, opts, extra) {
  if (opts.demo) return JSON.parse(fs.readFileSync(path.join(AQUI, extra && extra.booking_token ? 'ejemplo-vendedores.json' : 'ejemplo-respuesta.json'), 'utf8'));
  const url = cp.cpUrl(Object.assign(cp.cpParametros(viaje, clave, { profunda: opts.profunda }), extra || {}));
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 90000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    const json = await r.json().catch(() => ({ error: 'Respuesta no es JSON (HTTP ' + r.status + ')' }));
    if (r.status === 401) throw new Error('SerpApi rechazó la clave (HTTP 401). Revise SERPAPI_KEY.');
    if (!r.ok && !json.error) json.error = 'HTTP ' + r.status;
    return json;
  } finally {
    clearTimeout(t);
  }
}

function imprimir(viaje, res) {
  const titulo = `${viaje.id || 'viaje'} · ${cp.cpCiudad(viaje.origen)} → ${cp.cpCiudad(viaje.destino)} · ida ${viaje.ida}` +
    (viaje.regreso ? `, regreso ${viaje.regreso}` : ' (solo ida)') + ` · ${viaje.pasajeros || 1} pasajero(s)` +
    (Number(viaje.cotizado) > 0 ? ` · cotizado ${pesos(Number(viaje.cotizado))}` : '');
  console.log('\n' + '═'.repeat(Math.min(110, titulo.length + 2)) + '\n ' + titulo);
  if (!res.ok) { console.log('  ✗ Sin resultados: ' + res.error); return; }
  console.log('  ' + pad('Aerolínea', 22) + padL('Más barato', 13) + '  ' + pad('Salida', 7) + pad('Vuelo', 18) + pad('Escalas', 9) + 'Opciones');
  res.porAerolinea.forEach((a) => {
    const o = a.masBarata;
    console.log('  ' + pad(a.aerolinea, 22) + padL(pesos(o.precio), 13) + '  ' + pad(hora(o.salida), 7) + pad(o.vuelos, 18) +
      pad(o.escalas ? o.escalas + ' escala' + (o.escalas > 1 ? 's' : '') : 'directo', 9) + a.opciones);
  });
  if (res.sinPrecio) console.log(`  (${res.sinPrecio} opción(es) sin precio publicado)`);
  const m = res.masBarata;
  if (m) {
    const d = cp.cpDiferencia(viaje.cotizado, m.precio);
    console.log(`  → Más barato del día: ${pesos(m.precio)} (${m.aerolinea}, sale ${hora(m.salida)})` +
      (d ? `. Lo cotizado está ${pesos(Math.abs(d.pesos))} ${d.pesos >= 0 ? 'por encima' : 'por debajo'} (${pct(d.porcentaje)}).` : ''));
  }
  if (viaje.horaIda) {
    const c = res.cercaHora;
    const d = c ? cp.cpDiferencia(viaje.cotizado, c.precio) : null;
    console.log(`  → Más barato saliendo entre 2 h antes y 2 h después de las ${hora(viaje.horaIda)}: ` +
      (c ? `${pesos(c.precio)} (${c.aerolinea}, ${hora(c.salida)})` + (d ? `; diferencia con lo cotizado ${pct(d.porcentaje)}` : '') : 'ninguno con precio'));
  }
  if (res.vendedores) {
    console.log(res.vendedores.length
      ? `  → Quién vende la opción más barata: ` + res.vendedores.map((x) => `${x.vendedor}${x.esAerolinea ? ' (aerolínea)' : ''} ${pesos(x.precio)}${x.tarifa ? ' [' + x.tarifa + ']' : ''}`).join(' · ')
      : '  → Google no mostró vendedores para la opción más barata.');
    if (res.vendedores.length) {
      const av = res.vendedores.find((x) => /aviatur/i.test(x.vendedor));
      console.log('     ' + (av ? `Aviatur la vende en ${pesos(av.precio)}.` : 'Aviatur no aparece entre los vendedores de esta tarifa en Google Flights.'));
    }
  }
  const g = res.referenciaGoogle;
  if (g.rangoTipico) console.log(`  → Google considera típico para esta ruta: ${pesos(g.rangoTipico[0])} a ${pesos(g.rangoTipico[1])}${g.nivel ? ' (hoy el precio está ' + ({ low: 'bajo', typical: 'en lo típico', high: 'alto' }[g.nivel] || g.nivel) + ')' : ''}.`);
}

function filaCsv(viaje, res) {
  const m = res.ok ? res.masBarata : null;
  const c = res.ok ? res.cercaHora : null;
  const dm = m ? cp.cpDiferencia(viaje.cotizado, m.precio) : null;
  const dc = c ? cp.cpDiferencia(viaje.cotizado, c.precio) : null;
  const porA = res.ok ? res.porAerolinea.map((a) => `${a.aerolinea} ${Math.round(a.masBarata.precio)}`).join(' | ') : '';
  return [viaje.id || '', cp.cpCiudad(viaje.origen), cp.cpCiudad(viaje.destino), viaje.ida, viaje.regreso || '', viaje.pasajeros || 1,
    viaje.horaIda || '', Number(viaje.cotizado) || '', m ? Math.round(m.precio) : '', m ? m.aerolinea : '', m ? hora(m.salida) : '',
    dm ? Math.round(dm.pesos) : '', dm ? (dm.porcentaje * 100).toFixed(1).replace('.', ',') : '',
    c ? Math.round(c.precio) : '', c ? c.aerolinea : '', dc ? (dc.porcentaje * 100).toFixed(1).replace('.', ',') : '',
    porA, res.vendedores ? res.vendedores.map((x) => `${x.vendedor} ${Math.round(x.precio)}`).join(' | ') : '', res.ok ? '' : res.error]
    .map((v) => { const s = String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';');
}

async function main() {
  const a = argumentos(process.argv.slice(2));
  if (a.flags.ayuda) {
    console.log(fs.readFileSync(path.join(AQUI, 'README.md'), 'utf8'));
    return;
  }
  if (a.flags.configurar) return configurar();
  const demo = !!a.flags.demo;
  const clave = demo ? '' : claveApi();
  if (!demo && !clave) {
    console.error('Falta la clave de SerpApi. Guárdela con:\n  node tools/comparador-precios/buscar.cjs --configurar\nPara ver el formato sin clave: --demo');
    process.exit(1);
  }
  let viajes;
  if (a.lote) viajes = leerLote(a.lote);
  else if (a.flags['rutas-prueba']) {
    const f = fechasPrueba();
    viajes = RUTAS_PRUEBA.map(([id, origen, destino]) => ({ id, origen, destino, ida: f.ida, regreso: f.regreso, pasajeros: a.pasajeros || '1', horaIda: '07:00', cotizado: '' }));
    console.log(`\nRutas de prueba: ${viajes.length} rutas, ida el martes ${f.ida} y regreso el jueves ${f.regreso}, 1 pasajero, hora pedida 07:00.`);
  }
  else if (demo) viajes = [{ id: 'DEMO', origen: 'BOGOTA', destino: 'CALI', ida: '2026-10-20', regreso: '2026-10-22', pasajeros: '1', horaIda: '06:30', cotizado: '569395' }];
  else {
    // Sin --ida se usan las fechas de la prueba de rutas, para copiar los comandos del README tal cual.
    const f = fechasPrueba();
    const sinFecha = !a.ida;
    const regreso = a.flags['solo-ida'] ? '' : (a.regreso || (sinFecha ? f.regreso : ''));
    viajes = [{ id: a.id || 'consulta', origen: a.origen, destino: a.destino, ida: a.ida || f.ida, regreso, pasajeros: a.pasajeros,
      horaIda: a['hora-ida'] || (sinFecha ? '07:00' : ''), cotizado: a.cotizado }];
    if (sinFecha && !demo) console.log(`\nSin --ida: uso las fechas de la prueba de rutas (ida ${f.ida}${regreso ? ', regreso ' + regreso : ', solo ida'}, hora pedida ${viajes[0].horaIda}).`);
  }

  if (demo) console.log('\n*** MODO DEMO: datos INVENTADOS para mostrar el formato. No son precios reales. ***');
  const hoy = hoyIso();
  if (!demo) {
    // Cuántas búsquedas puede gastar esta ejecución, antes de gastar alguna.
    const porViaje = (v) => (a.flags.vendedores ? (v.regreso ? 3 : 2) : 1);
    let maximo = 0;
    viajes.forEach((v) => { try { if (v.ida && cp.cpFecha(v.ida) >= hoy) maximo += porViaje(v); } catch (e) { /* se reporta en el viaje */ } });
    const c = await revisarCuenta(clave);
    if (!c.ok) { console.error('✗ ' + c.error); process.exit(1); }
    console.log(`Esta ejecución gastará hasta ${maximo} búsqueda(s); le quedan ${c.quedan} este mes.`);
    if (typeof c.quedan === 'number' && c.quedan < maximo) {
      console.error(`✗ No alcanzan las búsquedas del mes (${c.quedan}). Pruebe con menos viajes o sin --vendedores.`);
      process.exit(1);
    }
    if (c.porHora && typeof c.usadasHora === 'number' && c.usadasHora + maximo > c.porHora) {
      console.error(`✗ SerpApi permite ${c.porHora} búsquedas por hora y ya van ${c.usadasHora}. Espere un rato o use menos viajes.`);
      process.exit(1);
    }
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1_');
  const salida = path.resolve(a.salida || 'resultados-comparador', (demo ? 'demo_' : '') + stamp);
  fs.mkdirSync(path.join(salida, 'crudo'), { recursive: true });
  const csv = ['id;origen;destino;ida;regreso;pasajeros;hora_ida;cotizado;mas_barato;aerolinea_mas_barata;salida_mas_barata;' +
    'diferencia_pesos;diferencia_pct;mas_barato_cerca_hora;aerolinea_cerca_hora;diferencia_cerca_hora_pct;por_aerolinea;vendedores;error'];
  let usadas = 0;
  for (const v of viajes) {
    let res;
    try {
      if (!v.origen || !v.destino || !v.ida) throw new Error('Faltan origen, destino o fecha de ida.');
      if (!demo && cp.cpFecha(v.ida) < hoy) throw new Error('La fecha de ida ya pasó: Google Flights solo tiene precios futuros.');
      const json = await consultar(v, clave, { demo, profunda: !!a.flags.profunda });
      const extras = {};
      if (!demo) usadas++;
      res = cp.cpResumir(json, v);
      if (a.flags.vendedores && res.ok && res.masBarata) {
        // Quién vende la opción más barata: con ida y regreso hay que pedir primero el regreso.
        let token = res.masBarata.bookingToken;
        if (!token && res.masBarata.departureToken) {
          const vuelta = await consultar(v, clave, { demo, profunda: !!a.flags.profunda }, { departure_token: res.masBarata.departureToken });
          extras.regreso = vuelta;
          if (!demo) usadas++;
          const r2 = cp.cpResumir(vuelta, {});
          token = r2.ok && r2.masBarata ? r2.masBarata.bookingToken : '';
        }
        if (token || demo) {
          const ventas = await consultar(v, clave, { demo, profunda: !!a.flags.profunda }, { booking_token: token || 'demo' });
          extras.vendedores = ventas;
          if (!demo) usadas++;
          res.vendedores = cp.cpVendedores(ventas);
        } else {
          res.vendedores = [];
        }
      }
      // Respuestas completas (la búsqueda, y con --vendedores también el regreso y los vendedores), sin la clave.
      const base = path.join(salida, 'crudo', (v.id || 'viaje').replace(/[^\w-]/g, '_'));
      const guardar = (archivo, obj) => {
        let texto = JSON.stringify(obj, null, 1);
        if (clave) texto = texto.split(clave).join('***');
        fs.writeFileSync(archivo, texto);
      };
      guardar(base + '.json', json);
      Object.keys(extras).forEach((k) => guardar(base + '-' + k + '.json', extras[k]));
    } catch (e) {
      if (/rechazó la clave/.test(e.message)) { console.error('✗ ' + e.message); process.exit(1); }
      res = { ok: false, error: e.message, porAerolinea: [] };
    }
    imprimir(v, res);
    csv.push(filaCsv(v, res));
    if (!demo && viajes.length > 1) await new Promise((r) => setTimeout(r, 1000));
  }
  fs.writeFileSync(path.join(salida, 'resumen.csv'), '﻿' + csv.join('\r\n'));
  console.log(`\nResultados: ${path.join(salida, 'resumen.csv')} (abre en Excel) y las respuestas completas en ${path.join(salida, 'crudo')}.`);
  if (!demo) {
    const c = await revisarCuenta(clave);
    console.log(`Búsquedas usadas en esta ejecución: ${usadas}.` + (c.ok ? ` Le quedan ${c.quedan} este mes (plan ${c.plan}).` : ''));
  }
}

main().catch((e) => { console.error('✗ ' + (e && e.message ? e.message : e)); process.exit(1); });
