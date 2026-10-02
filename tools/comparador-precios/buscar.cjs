#!/usr/bin/env node
/**
 * Comparador de precios de tiquetes — PRUEBA. Ver README.md de esta carpeta.
 *
 *   node tools/comparador-precios/buscar.cjs --demo
 *   node tools/comparador-precios/buscar.cjs --origen BOGOTA --destino CALI --ida 2026-10-20 --regreso 2026-10-22 --hora-ida 06:30 --cotizado 569395
 *   node tools/comparador-precios/buscar.cjs --lote viajes.csv
 *
 * La clave de SerpApi se lee de la variable SERPAPI_KEY o del archivo
 * tools/comparador-precios/.serpapi-key (está en .gitignore). Nunca se imprime ni se guarda.
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
    if (['demo', 'profunda', 'ayuda', 'vendedores'].includes(nombre)) a.flags[nombre] = true;
    else a[nombre] = argv[++i];
  }
  return a;
}

function claveApi() {
  if (process.env.SERPAPI_KEY) return process.env.SERPAPI_KEY.trim();
  const f = path.join(AQUI, '.serpapi-key');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : '';
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
  const demo = !!a.flags.demo;
  const clave = demo ? '' : claveApi();
  if (!demo && !clave) {
    console.error('Falta la clave de SerpApi: export SERPAPI_KEY=... o guárdela en tools/comparador-precios/.serpapi-key (ver README.md).\nPara ver el formato sin clave: --demo');
    process.exit(1);
  }
  let viajes;
  if (a.lote) viajes = leerLote(a.lote);
  else if (demo) viajes = [{ id: 'DEMO', origen: 'BOGOTA', destino: 'CALI', ida: '2026-10-20', regreso: '2026-10-22', pasajeros: '1', horaIda: '06:30', cotizado: '569395' }];
  else viajes = [{ id: a.id || 'consulta', origen: a.origen, destino: a.destino, ida: a.ida, regreso: a.regreso, pasajeros: a.pasajeros, horaIda: a['hora-ida'], cotizado: a.cotizado }];

  if (demo) console.log('\n*** MODO DEMO: datos INVENTADOS para mostrar el formato. No son precios reales. ***');
  const hoy = hoyIso();
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
      if (!demo) usadas++;
      res = cp.cpResumir(json, v);
      if (a.flags.vendedores && res.ok && res.masBarata) {
        // Quién vende la opción más barata: con ida y regreso hay que pedir primero el regreso.
        let token = res.masBarata.bookingToken;
        if (!token && res.masBarata.departureToken) {
          const vuelta = await consultar(v, clave, { demo, profunda: !!a.flags.profunda }, { departure_token: res.masBarata.departureToken });
          if (!demo) usadas++;
          const r2 = cp.cpResumir(vuelta, {});
          token = r2.ok && r2.masBarata ? r2.masBarata.bookingToken : '';
        }
        if (token || demo) {
          const ventas = await consultar(v, clave, { demo, profunda: !!a.flags.profunda }, { booking_token: token || 'demo' });
          if (!demo) usadas++;
          res.vendedores = cp.cpVendedores(ventas);
        } else {
          res.vendedores = [];
        }
      }
      let texto = JSON.stringify(json, null, 1);
      if (clave) texto = texto.split(clave).join('***');
      fs.writeFileSync(path.join(salida, 'crudo', (v.id || 'viaje').replace(/[^\w-]/g, '_') + '.json'), texto);
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
    try {
      const r = await fetch('https://serpapi.com/account.json?api_key=' + encodeURIComponent(clave));
      const acc = await r.json();
      if (typeof acc.plan_searches_left === 'number') {
        console.log(`Búsquedas usadas en esta ejecución: ${usadas}. Le quedan ${acc.plan_searches_left} este mes (plan ${acc.plan_name || '—'}).`);
      }
    } catch (e) { /* la cuenta es solo informativa */ }
  }
}

main().catch((e) => { console.error('✗ ' + (e && e.message ? e.message : e)); process.exit(1); });
