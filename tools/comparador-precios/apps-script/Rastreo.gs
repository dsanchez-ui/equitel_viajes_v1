/**
 * Rastreo de precios de tiquetes (#A84) — PROYECTO DE APPS SCRIPT APARTE.
 *
 * No es parte de la plataforma. Corre en un proyecto propio (instrucciones en
 * README.md de esta carpeta) para no tocar la plataforma en producción: ella no
 * tiene permiso de salir a internet (#A62) y dárselo obligaría a reautorizarla.
 *
 * Qué hace, cada 15 minutos:
 *   1. Lee la hoja «Nueva Base Solicitudes» de la base de datos. NUNCA la escribe.
 *   2. Para cada solicitud de vuelo con fecha de ida futura busca el precio en
 *      Google Flights (vía SerpApi) en dos momentos:
 *        - COTIZACION: está en PENDIENTE_APROBACION y los costos se confirmaron
 *          después del inicio del estudio. Compara lo cotizado con el mercado en
 *          el mismo momento.
 *        - COMPRA: está en APROBADO (Laura va a comprar), o pasó a RESERVADO hace
 *          menos de 6 horas. Es el precio del mercado al comprar.
 *      Una sola búsqueda por solicitud y momento.
 *   3. Escribe una fila por búsqueda en la pestaña oculta «COMPARATIVO PRECIOS» y
 *      el estado del rastreo en «COMPARATIVO ESTADO». El dashboard de costos las
 *      lee (sección restringida; Laura no la ve).
 *
 * Núcleo de la búsqueda: el archivo Nucleo.gs del proyecto es una copia exacta de
 * tools/comparador-precios/comparador.cjs (cpParametros, cpUrl, cpResumir…).
 *
 * Propiedades del script (Configuración del proyecto → Propiedades del script):
 *   SERPAPI_KEY        clave de SerpApi (obligatoria; nunca se escribe en la hoja)
 *   SPREADSHEET_ID     ID de la hoja de la base de datos (obligatorio)
 *   INICIO_ESTUDIO     AAAA-MM-DD (lo pone activarRastreo: hoy)
 *   FIN_ESTUDIO        AAAA-MM-DD (lo pone activarRastreo: inicio + 14 días); después no busca
 *   MAX_POR_EJECUCION  búsquedas por ejecución (8)
 *   MAX_BUSQUEDAS_DIA  tope diario de consultas a SerpApi (40)
 *   RESERVA_MINIMA     no busca si a la cuenta le quedan menos (15)
 *   VENDEDORES         no | cotizacion | compra | ambos (no). Cada búsqueda con
 *                      vendedores gasta 1 o 2 consultas más.
 */

var RP_HOJA_SOLICITUDES = 'Nueva Base Solicitudes';
var RP_HOJA = 'COMPARATIVO PRECIOS';
var RP_HOJA_ESTADO = 'COMPARATIVO ESTADO';
var RP_ZONA = 'America/Bogota';
var RP_FUNCION = 'rastrearPrecios';
var RP_MINUTOS = 15;
var RP_DIAS_ESTUDIO = 14;
var RP_VENTANA_COMPRA_MS = 6 * 60 * 60 * 1000;
var RP_TIEMPO_MAX_MS = 270000;

var RP_ENCABEZADOS = [
  'FECHA BUSQUEDA', 'MOMENTO', 'ID SOLICITUD', 'ESTADO', 'ORIGEN', 'DESTINO', 'AEROPUERTOS',
  'FECHA IDA', 'FECHA REGRESO', 'PASAJEROS', 'HORA PEDIDA',
  'COSTO TIQUETES COTIZADO', 'AEROLINEA REGISTRADA', 'CANAL REGISTRADO',
  'MAS BARATO', 'AEROLINEA MAS BARATA', 'SALIDA MAS BARATA',
  'MAS BARATO CERCA HORA', 'AEROLINEA CERCA HORA', 'SALIDA CERCA HORA', 'VUELO CERCA HORA',
  'MISMA AEROLINEA CERCA HORA', 'MISMA AEROLINEA DIA',
  'PRECIOS POR AEROLINEA', 'RANGO TIPICO', 'NIVEL GOOGLE', 'AVIATUR EN GOOGLE', 'VENDEDORES',
  'RESULTADO', 'DETALLE', 'SEGUNDOS', 'CONSULTAS'
];
// Se guardan como texto: Sheets convertiría '2026-10-20' o '07:00' en fecha u hora.
var RP_TEXTO = { 'ID SOLICITUD': 1, 'FECHA IDA': 1, 'FECHA REGRESO': 1, 'HORA PEDIDA': 1, 'SALIDA MAS BARATA': 1,
  'SALIDA CERCA HORA': 1, 'VUELO CERCA HORA': 1, 'RANGO TIPICO': 1 };

// ---------------------------------------------------------------- configuración

function rpConfig_() {
  var p = PropertiesService.getScriptProperties();
  var get = function(k, d) { var v = p.getProperty(k); return v === null || String(v).trim() === '' ? d : String(v).trim(); };
  var num = function(k, d) { var n = Number(get(k, d)); return isFinite(n) && n >= 0 ? n : d; };
  return {
    clave: get('SERPAPI_KEY', ''),
    hojaId: get('SPREADSHEET_ID', ''),
    inicio: get('INICIO_ESTUDIO', ''),
    fin: get('FIN_ESTUDIO', ''),
    maxPorEjecucion: num('MAX_POR_EJECUCION', 8),
    maxDia: num('MAX_BUSQUEDAS_DIA', 40),
    reserva: num('RESERVA_MINIMA', 15),
    vendedores: get('VENDEDORES', 'no').toLowerCase()
  };
}

function rpHoy_() { return Utilities.formatDate(new Date(), RP_ZONA, 'yyyy-MM-dd'); }

/** 'AAAA-MM-DD' + n días. */
function rpSumarDias_(iso, n) {
  var p = iso.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- lectura de la base

/** Celda de fecha → 'AAAA-MM-DD' en Bogotá. Acepta Date, 'AAAA-MM-DD…', 'DD-MM-AAAA' y 'DD/MM/AAAA'. */
function rpFecha_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, RP_ZONA, 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

/** Celda de hora → 'HH:MM'. Sheets puede devolver un Date (como lo lee la plataforma) o el texto. */
function rpHora_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return ('0' + v.getHours()).slice(-2) + ':' + ('0' + v.getMinutes()).slice(-2);
  }
  var m = String(v).match(/(\d{1,2}):(\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}

/** Igual que _csToNumber_ de la plataforma: tolera '$ 1.234.567' y '1.234,5'. */
function rpNumero_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var s = String(v).trim().replace(/[$\s]/g, '');
  if (!s) return 0;
  if (s.indexOf(',') > -1 && s.indexOf('.') > -1) s = s.split('.').join('').replace(',', '.');
  else if (s.indexOf(',') > -1) s = s.replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.split('.').join('');
  var n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function rpEventos_(raw) {
  if (!raw) return {};
  try { var e = JSON.parse(raw); return e && typeof e === 'object' ? e : {}; } catch (err) { return {}; }
}

/** Claves 'ID|MOMENTO' ya buscadas, y consultas hechas hoy (para el tope diario). */
function rpLeerHechas_(hoja) {
  var hechas = {};
  var consultasHoy = 0;
  if (!hoja || hoja.getLastRow() < 2) return { hechas: hechas, consultasHoy: 0 };
  var v = hoja.getRange(1, 1, hoja.getLastRow(), hoja.getLastColumn()).getValues();
  var h = {};
  v[0].forEach(function(x, i) { h[String(x).trim()] = i; });
  var hoy = rpHoy_();
  for (var r = 1; r < v.length; r++) {
    var id = String(v[r][h['ID SOLICITUD']] || '').trim();
    if (id) hechas[id + '|' + String(v[r][h['MOMENTO']] || '').trim()] = true;
    if (rpFecha_(v[r][h['FECHA BUSQUEDA']]) === hoy) consultasHoy += rpNumero_(v[r][h['CONSULTAS']]);
  }
  return { hechas: hechas, consultasHoy: consultasHoy };
}

/**
 * Solicitudes que toca buscar ahora. Prioridad: COMPRA antes que COTIZACION y,
 * dentro de cada momento, la ida más próxima primero.
 */
function rpCandidatos_(valores, hechas, cfg, ahoraMs) {
  var h = {};
  valores[0].forEach(function(x, i) { var k = String(x == null ? '' : x).trim(); if (k && h[k] === undefined) h[k] = i; });
  var celda = function(fila, nombre) { return h[nombre] === undefined ? '' : fila[h[nombre]]; };
  var hoy = rpHoy_();
  var out = [];
  for (var r = 1; r < valores.length; r++) {
    var fila = valores[r];
    var id = String(celda(fila, 'ID RESPUESTA') || '').trim();
    if (!id) continue;
    if (String(celda(fila, 'MODO_SOLICITUD') || '').trim() === 'SOLO_HOSPEDAJE') continue;
    var origen = cpCiudad(celda(fila, 'CIUDAD ORIGEN'));
    var destino = cpCiudad(celda(fila, 'CIUDAD DESTINO'));
    var ida = rpFecha_(celda(fila, 'FECHA IDA'));
    if (!origen || !destino || !ida || ida < hoy) continue;
    var estado = String(celda(fila, 'STATUS') || '').trim();
    var ev = rpEventos_(celda(fila, 'EVENTOS_JSON'));
    var base = {
      id: id,
      estado: estado,
      viaje: {
        id: id, origen: origen, destino: destino, ida: ida, regreso: rpFecha_(celda(fila, 'FECHA VUELTA')),
        pasajeros: String(Math.max(1, Math.round(rpNumero_(celda(fila, '# PERSONAS QUE VIAJAN'))) || 1)),
        horaIda: rpHora_(celda(fila, 'HORA LLEGADA VUELO IDA'))
      },
      cotizado: rpNumero_(celda(fila, 'COSTO_FINAL_TIQUETES')),
      aerolinea: String(celda(fila, 'AEROLINEA') || '').trim(),
      canal: String(celda(fila, 'CANAL DE COMPRA') || '').trim()
    };
    if (estado === 'PENDIENTE_APROBACION' && !hechas[id + '|COTIZACION'] && cfg.inicio && ev.costConfirmed &&
        rpFecha_(new Date(ev.costConfirmed)) >= cfg.inicio) {
      out.push(rpCopia_(base, 'COTIZACION'));
    }
    var reservadaHace = ev.reservationRegistered ? ahoraMs - new Date(ev.reservationRegistered).getTime() : null;
    var compra = estado === 'APROBADO' || (estado === 'RESERVADO' && reservadaHace !== null && reservadaHace >= 0 && reservadaHace <= RP_VENTANA_COMPRA_MS);
    if (compra && !hechas[id + '|COMPRA']) out.push(rpCopia_(base, 'COMPRA'));
  }
  out.sort(function(a, b) {
    if (a.momento !== b.momento) return a.momento === 'COMPRA' ? -1 : 1;
    return a.viaje.ida < b.viaje.ida ? -1 : a.viaje.ida > b.viaje.ida ? 1 : (a.id < b.id ? -1 : 1);
  });
  return out;
}

function rpCopia_(base, momento) {
  var c = JSON.parse(JSON.stringify(base));
  c.momento = momento;
  return c;
}

// ---------------------------------------------------------------- consulta a SerpApi

function rpError_(tipo, mensaje) { var e = new Error(mensaje); e.tipo = tipo; return e; }

/**
 * Mensaje de error sin direcciones ni clave: los errores de UrlFetchApp traen la URL
 * consultada, y esa URL lleva la clave de SerpApi.
 */
function rpLimpio_(texto, clave) {
  var t = String(texto == null ? '' : texto).replace(/https?:\/\/\S+/g, '[dirección]');
  if (clave) t = t.split(clave).join('***');
  return t.slice(0, 300);
}

/**
 * Una consulta. Lanza CLAVE (401), CUPO (429) o TRANSITORIO (5xx, red, respuesta
 * ilegible: se reintenta en la siguiente ejecución). Un error de la búsqueda en sí
 * (p. ej. sin resultados) vuelve en el JSON y queda escrito en la fila.
 */
function rpConsultar_(params) {
  var resp;
  try {
    resp = UrlFetchApp.fetch(cpUrl(params), { muteHttpExceptions: true });
  } catch (e) {
    throw rpError_('TRANSITORIO', 'Sin conexión con SerpApi: ' + rpLimpio_(e && e.message ? e.message : e, params.api_key));
  }
  var code = resp.getResponseCode();
  var json = null;
  try { json = JSON.parse(resp.getContentText()); } catch (e) { json = null; }
  if (code === 401) throw rpError_('CLAVE', 'SerpApi rechazó la clave (HTTP 401). Revise SERPAPI_KEY.');
  if (code === 429) throw rpError_('CUPO', (json && json.error) || 'SerpApi no tiene búsquedas disponibles (HTTP 429).');
  if (code >= 500 || !json) throw rpError_('TRANSITORIO', 'Respuesta inválida de SerpApi (HTTP ' + code + ').');
  return json;
}

/** Búsquedas que le quedan a la cuenta (la consulta es gratis). null si no se pudo saber. */
function rpQuedan_(clave) {
  try {
    var r = UrlFetchApp.fetch('https://serpapi.com/account.json?api_key=' + encodeURIComponent(clave), { muteHttpExceptions: true });
    if (r.getResponseCode() === 401) throw rpError_('CLAVE', 'SerpApi rechazó la clave (HTTP 401). Revise SERPAPI_KEY.');
    var j = JSON.parse(r.getContentText());
    if (j.error) throw rpError_('CLAVE', 'SerpApi: ' + j.error);
    return typeof j.total_searches_left === 'number' ? j.total_searches_left : j.plan_searches_left;
  } catch (e) {
    if (e.tipo) throw e;
    return null;
  }
}

/** 'Copa Airlines' y 'COPA' son la misma; 'Aeroméxico' y 'Aeromexico' también. */
function rpClaveAerolinea_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(airlines?|lineas aereas)\b/g, '').replace(/\s+/g, ' ').trim();
}

/** Lo más barato de la aerolínea que registró Laura: en el día y cerca de la hora pedida (±2 h). */
function rpMismaAerolinea_(opciones, aerolinea, horaIda) {
  var k = rpClaveAerolinea_(aerolinea);
  var res = { dia: null, cerca: null };
  if (!k || k === 'varias aerolineas') return res;
  var pref = horaIda ? cpMinutos(horaIda) : null;
  (opciones || []).forEach(function(o) {
    if (o.precio === null || rpClaveAerolinea_(o.aerolinea) !== k) return;
    if (!res.dia || o.precio < res.dia.precio) res.dia = o;
    var m = cpMinutos(o.salida);
    if (pref !== null && m !== null && Math.abs(m - pref) <= 120 && (!res.cerca || o.precio < res.cerca.precio)) res.cerca = o;
  });
  return res;
}

var rpHoraDe_ = function(s) { return (String(s || '').match(/\d{1,2}:\d{2}/) || [''])[0]; };

/** Busca un candidato. Devuelve la fila a escribir y cuántas consultas gastó. */
function rpBuscar_(cand, cfg) {
  var t0 = Date.now();
  var v = cand.viaje;
  var fila = {
    'FECHA BUSQUEDA': new Date(), 'MOMENTO': cand.momento, 'ID SOLICITUD': cand.id, 'ESTADO': cand.estado,
    'ORIGEN': v.origen, 'DESTINO': v.destino, 'FECHA IDA': v.ida, 'FECHA REGRESO': v.regreso || '',
    'PASAJEROS': Number(v.pasajeros), 'HORA PEDIDA': v.horaIda || '',
    'COSTO TIQUETES COTIZADO': cand.cotizado || '', 'AEROLINEA REGISTRADA': cand.aerolinea, 'CANAL REGISTRADO': cand.canal,
    'CONSULTAS': 0
  };
  var params;
  try {
    params = cpParametros(v, cfg.clave, {});
  } catch (e) {
    fila['RESULTADO'] = 'SIN_AEROPUERTO';
    fila['DETALLE'] = String(e && e.message ? e.message : e);
    return fila;
  }
  fila['AEROPUERTOS'] = params.departure_id + ' → ' + params.arrival_id;
  var json = rpConsultar_(params);
  fila['CONSULTAS'] = 1;
  var res = cpResumir(json, v);
  if (!res.ok) {
    fila['RESULTADO'] = /hasn.t returned any results/i.test(res.error) ? 'SIN_RESULTADOS' : 'ERROR';
    fila['DETALLE'] = rpLimpio_(res.error, cfg.clave);
    fila['SEGUNDOS'] = Math.round((Date.now() - t0) / 100) / 10;
    return fila;
  }
  var m = res.masBarata;
  var c = res.cercaHora;
  var misma = rpMismaAerolinea_(res.opciones, cand.aerolinea, v.horaIda);
  var porAerolinea = {};
  res.porAerolinea.forEach(function(a) { porAerolinea[a.aerolinea] = Math.round(a.masBarata.precio); });
  var g = res.referenciaGoogle;
  fila['MAS BARATO'] = m ? Math.round(m.precio) : '';
  fila['AEROLINEA MAS BARATA'] = m ? m.aerolinea : '';
  fila['SALIDA MAS BARATA'] = m ? rpHoraDe_(m.salida) : '';
  fila['MAS BARATO CERCA HORA'] = c ? Math.round(c.precio) : '';
  fila['AEROLINEA CERCA HORA'] = c ? c.aerolinea : '';
  fila['SALIDA CERCA HORA'] = c ? rpHoraDe_(c.salida) : '';
  fila['VUELO CERCA HORA'] = c ? c.vuelos : '';
  fila['MISMA AEROLINEA CERCA HORA'] = misma.cerca ? Math.round(misma.cerca.precio) : '';
  fila['MISMA AEROLINEA DIA'] = misma.dia ? Math.round(misma.dia.precio) : '';
  fila['PRECIOS POR AEROLINEA'] = JSON.stringify(porAerolinea);
  fila['RANGO TIPICO'] = g.rangoTipico ? g.rangoTipico.map(Math.round).join('-') : '';
  fila['NIVEL GOOGLE'] = g.nivel || '';
  fila['RESULTADO'] = 'OK';

  var conVendedores = cfg.vendedores === 'ambos' || cfg.vendedores === cand.momento.toLowerCase();
  if (conVendedores && m) {
    try {
      var token = m.bookingToken;
      if (!token && m.departureToken) {
        var vuelta = rpConsultar_(Object.assign({}, params, { departure_token: m.departureToken }));
        fila['CONSULTAS']++;
        var r2 = cpResumir(vuelta, {});
        token = r2.ok && r2.masBarata ? r2.masBarata.bookingToken : '';
      }
      if (token) {
        var ventas = cpVendedores(rpConsultar_(Object.assign({}, params, { booking_token: token })));
        fila['CONSULTAS']++;
        fila['VENDEDORES'] = JSON.stringify(ventas.map(function(x) { return { v: x.vendedor, p: Math.round(x.precio), a: x.esAerolinea }; }));
        var av = ventas.filter(function(x) { return /aviatur/i.test(x.vendedor); })[0];
        fila['AVIATUR EN GOOGLE'] = av ? Math.round(av.precio) : '';
      }
    } catch (e) {
      if (e.tipo === 'CLAVE' || e.tipo === 'CUPO') throw e;
      fila['DETALLE'] = 'Vendedores no disponibles: ' + rpLimpio_(e && e.message ? e.message : e, cfg.clave);
    }
  }
  fila['SEGUNDOS'] = Math.round((Date.now() - t0) / 100) / 10;
  return fila;
}

// ---------------------------------------------------------------- pestañas

function rpAbrir_(cfg) {
  if (!cfg.hojaId) throw new Error('Falta la propiedad SPREADSHEET_ID (el ID de la hoja de la base de datos).');
  var ss = SpreadsheetApp.openById(cfg.hojaId);
  var base = ss.getSheetByName(RP_HOJA_SOLICITUDES);
  if (!base) throw new Error('No se encontró la hoja «' + RP_HOJA_SOLICITUDES + '» en el archivo ' + cfg.hojaId + '.');
  return { ss: ss, base: base };
}

/** Crea las dos pestañas si faltan: ocultas y con aviso si alguien intenta editarlas. */
function rpPestanas_(ss) {
  var hoja = ss.getSheetByName(RP_HOJA);
  if (!hoja) {
    hoja = ss.insertSheet(RP_HOJA);
    hoja.protect().setDescription('La escribe el rastreo de precios (#A84). No editar.').setWarningOnly(true);
    hoja.hideSheet();
  }
  if (hoja.getLastRow() === 0) {
    hoja.getRange(1, 1, 1, RP_ENCABEZADOS.length).setValues([RP_ENCABEZADOS]).setFontWeight('bold');
    hoja.setFrozenRows(1);
  }
  var estado = ss.getSheetByName(RP_HOJA_ESTADO);
  if (!estado) {
    estado = ss.insertSheet(RP_HOJA_ESTADO);
    estado.protect().setDescription('La escribe el rastreo de precios (#A84). No editar.').setWarningOnly(true);
    estado.hideSheet();
  }
  return { hoja: hoja, estado: estado };
}

function rpEscribirFila_(hoja, fila) {
  var enc = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(function(x) { return String(x).trim(); });
  hoja.appendRow(enc.map(function(k) {
    var v = fila[k];
    if (v === undefined || v === null) return '';
    // Texto literal: fechas y horas como texto, y nada que Sheets lea como fórmula.
    if (typeof v === 'string' && v && (RP_TEXTO[k] || /^[=+\-@]/.test(v))) return "'" + v;
    return v;
  }));
}

function rpEscribirEstado_(estado, datos) {
  var filas = [
    ['ULTIMA EJECUCION', new Date()],
    ['ESTADO', datos.estado],
    ['DETALLE', datos.detalle || ''],
    ['INICIO ESTUDIO', datos.inicio || ''],
    ['FIN ESTUDIO', datos.fin || ''],
    ['BUSQUEDAS EN ESTA EJECUCION', datos.buscadas || 0],
    ['CONSULTAS HOY', datos.consultasHoy || 0],
    ['PENDIENTES', datos.pendientes || 0],
    ['QUEDAN EN SERPAPI', datos.quedan === null || datos.quedan === undefined ? '' : datos.quedan],
    ['VENDEDORES', datos.vendedores || 'no'],
    ['CADA (MINUTOS)', RP_MINUTOS]
  ];
  estado.clearContents();
  estado.getRange(1, 1, filas.length, 2).setValues(filas);
}

// ---------------------------------------------------------------- ejecución

/** Disparador cada 15 minutos (lo instala activarRastreo). */
function rastrearPrecios() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { estado: 'OCUPADO' };
  try {
    return rpEjecutar_(Date.now());
  } finally {
    lock.releaseLock();
  }
}

function rpEjecutar_(ahoraMs) {
  var cfg = rpConfig_();
  var t0 = Date.now();
  var abierto = rpAbrir_(cfg);
  var tabs = rpPestanas_(abierto.ss);
  var info = { inicio: cfg.inicio, fin: cfg.fin, vendedores: cfg.vendedores, buscadas: 0, pendientes: 0, quedan: null };
  var terminar = function(estado, detalle) {
    info.estado = estado;
    info.detalle = detalle;
    rpEscribirEstado_(tabs.estado, info);
    console.log('rastrearPrecios: ' + estado + (detalle ? ' — ' + detalle : '') + ' · buscadas ' + info.buscadas + ', pendientes ' + info.pendientes);
    return info;
  };
  if (!cfg.clave) return terminar('SIN CONFIGURAR', 'Falta la propiedad SERPAPI_KEY.');
  if (!cfg.inicio) return terminar('SIN CONFIGURAR', 'Falta INICIO_ESTUDIO: ejecute activarRastreo().');
  if (cfg.fin && rpHoy_() > cfg.fin) return terminar('TERMINADO', 'El estudio terminó el ' + cfg.fin + '. Para seguir, cambie FIN_ESTUDIO.');

  var leidas = rpLeerHechas_(tabs.hoja);
  info.consultasHoy = leidas.consultasHoy;
  var valores = abierto.base.getRange(1, 1, abierto.base.getLastRow(), abierto.base.getLastColumn()).getValues();
  var candidatos = rpCandidatos_(valores, leidas.hechas, cfg, ahoraMs);
  info.pendientes = candidatos.length;
  if (!candidatos.length) return terminar('ACTIVO', 'Sin solicitudes nuevas para buscar.');

  try {
    info.quedan = rpQuedan_(cfg.clave);
  } catch (e) {
    return terminar('CLAVE INVALIDA', e.message);
  }

  var gastadas = 0;
  for (var i = 0; i < candidatos.length; i++) {
    if (info.buscadas >= cfg.maxPorEjecucion || Date.now() - t0 > RP_TIEMPO_MAX_MS) break;
    if (info.consultasHoy >= cfg.maxDia) return terminar('TOPE DIARIO', 'Se alcanzó el tope de ' + cfg.maxDia + ' consultas de hoy; sigue mañana.');
    if (info.quedan !== null && info.quedan - gastadas <= cfg.reserva) {
      return terminar('SIN CUPO', 'A la cuenta de SerpApi le quedan ' + (info.quedan - gastadas) + ' búsquedas (reserva mínima ' + cfg.reserva + ').');
    }
    var fila;
    try {
      fila = rpBuscar_(candidatos[i], cfg);
    } catch (e) {
      if (e.tipo === 'CLAVE') return terminar('CLAVE INVALIDA', e.message);
      if (e.tipo === 'CUPO') return terminar('SIN CUPO', e.message);
      // Transitorio: no se escribe nada y se reintenta en la siguiente ejecución.
      console.warn('rastrearPrecios: ' + candidatos[i].id + ' ' + candidatos[i].momento + ': ' + e.message);
      continue;
    }
    rpEscribirFila_(tabs.hoja, fila);
    info.buscadas++;
    info.pendientes--;
    gastadas += fila['CONSULTAS'] || 0;
    info.consultasHoy += fila['CONSULTAS'] || 0;
  }
  return terminar('ACTIVO', info.pendientes ? 'Quedan ' + info.pendientes + ' por buscar en la siguiente ejecución.' : '');
}

// ---------------------------------------------------------------- funciones para el editor

/**
 * Revisa la configuración sin gastar búsquedas: la hoja, la clave y qué solicitudes
 * buscaría ahora. Ejecútela antes de activarRastreo (la primera vez pide permisos).
 */
function probarConfiguracion() {
  var cfg = rpConfig_();
  var lineas = [];
  if (!cfg.clave) throw new Error('Falta la propiedad SERPAPI_KEY.');
  var abierto = rpAbrir_(cfg);
  lineas.push('✓ Hoja: «' + abierto.ss.getName() + '», ' + (abierto.base.getLastRow() - 1) + ' filas en «' + RP_HOJA_SOLICITUDES + '».');
  var quedan = rpQuedan_(cfg.clave);
  lineas.push('✓ Clave de SerpApi válida. Quedan ' + (quedan === null ? '¿?' : quedan) + ' búsquedas este mes.');
  var hoja = abierto.ss.getSheetByName(RP_HOJA);
  var hechas = rpLeerHechas_(hoja).hechas;
  var valores = abierto.base.getRange(1, 1, abierto.base.getLastRow(), abierto.base.getLastColumn()).getValues();
  var c = rpCandidatos_(valores, hechas, { inicio: cfg.inicio || rpHoy_() }, Date.now());
  lineas.push('Buscaría ahora ' + c.length + ' solicitud(es):');
  c.slice(0, 20).forEach(function(x) {
    lineas.push('  ' + x.id + ' ' + x.momento + ' · ' + x.viaje.origen + ' → ' + x.viaje.destino + ' · ida ' + x.viaje.ida +
      (x.viaje.regreso ? ', regreso ' + x.viaje.regreso : '') + ' · ' + x.viaje.pasajeros + ' pasajero(s)');
  });
  lineas.push(cfg.inicio ? 'Estudio: ' + cfg.inicio + ' a ' + (cfg.fin || '(sin fin)') + '.' : 'El estudio aún no está activo: ejecute activarRastreo().');
  console.log(lineas.join('\n'));
  return lineas.join('\n');
}

/** Fija las fechas del estudio (si faltan), crea las pestañas, instala el disparador y hace la primera pasada. */
function activarRastreo() {
  var p = PropertiesService.getScriptProperties();
  var cfg = rpConfig_();
  if (!cfg.clave) throw new Error('Falta la propiedad SERPAPI_KEY.');
  var abierto = rpAbrir_(cfg);
  if (!cfg.inicio) p.setProperty('INICIO_ESTUDIO', rpHoy_());
  if (!cfg.fin) p.setProperty('FIN_ESTUDIO', rpSumarDias_(p.getProperty('INICIO_ESTUDIO'), RP_DIAS_ESTUDIO));
  rpPestanas_(abierto.ss);
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === RP_FUNCION) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(RP_FUNCION).timeBased().everyMinutes(RP_MINUTOS).create();
  var r = rastrearPrecios();
  var msg = 'Rastreo activo cada ' + RP_MINUTOS + ' minutos, del ' + p.getProperty('INICIO_ESTUDIO') + ' al ' + p.getProperty('FIN_ESTUDIO') +
    '. Primera pasada: ' + (r.buscadas || 0) + ' búsqueda(s), estado ' + r.estado + (r.detalle ? ' (' + r.detalle + ')' : '') + '.';
  console.log(msg);
  return msg;
}

/** Quita el disparador. Las pestañas y lo buscado se conservan. */
function desactivarRastreo() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === RP_FUNCION) { ScriptApp.deleteTrigger(t); n++; }
  });
  var msg = 'Rastreo desactivado (' + n + ' disparador eliminado). Lo buscado sigue en la pestaña «' + RP_HOJA + '».';
  console.log(msg);
  return msg;
}
