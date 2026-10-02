/**
 * Comparador de precios de tiquetes — PRUEBA (ver docs/plan-comparador-precios.md).
 *
 * Busca, para un viaje de la plataforma (ruta, fechas, pasajeros, hora preferida),
 * los precios que publican las aerolíneas en Google Flights, a través de SerpApi
 * (engine=google_flights), y los resume por aerolínea para compararlos con el
 * costo que cotizó el área de viajes. Sin IA: es una consulta a una API y un
 * cálculo de mínimos.
 *
 * Núcleo PORTABLE: no usa nada de Node (ni require, ni fs, ni fetch). Así el mismo
 * archivo se puede pegar en un proyecto de Apps Script en la fase 2 y llamar con
 * UrlFetchApp. El ejecutable de Node es buscar.cjs.
 */

/** Ciudad del sistema (sin tildes, en mayúsculas) → aeropuerto(s) IATA. Varias separadas por coma. */
var CP_AEROPUERTOS = {
  // Medellín tiene dos aeropuertos: José María Córdova (MDE, en Rionegro) y Olaya Herrera
  // (EOH, donde operan Satena y Clic). Se buscan los dos para no perder esas aerolíneas.
  'MEDELLIN': 'MDE,EOH', 'RIONEGRO': 'MDE',
  'BOGOTA': 'BOG', 'CALI': 'CLO', 'BARRANQUILLA': 'BAQ', 'CARTAGENA': 'CTG', 'PEREIRA': 'PEI',
  'APARTADO': 'APO', 'CAREPA': 'APO', 'YOPAL': 'EYP', 'PASTO': 'PSO', 'QUIBDO': 'UIB',
  'BUCARAMANGA': 'BGA', 'CUCUTA': 'CUC', 'IBAGUE': 'IBE', 'VILLAVICENCIO': 'VVC', 'MONTERIA': 'MTR',
  'ARMENIA': 'AXM', 'LETICIA': 'LET', 'SAN ANDRES': 'ADZ', 'ARAUCA': 'AUC', 'TUMACO': 'TCO',
  'BUENAVENTURA': 'BUN', 'PUERTO INIRIDA': 'PDA', 'PUERTO CARRENO': 'PCR', 'EL BAGRE': 'EBG',
  'CAUCASIA': 'CAQ', 'COROZAL': 'CZU', 'VILLAGARZON': 'VGZ', 'SANTA MARTA': 'SMR', 'NEIVA': 'NVA',
  'MANIZALES': 'MZL', 'VALLEDUPAR': 'VUP', 'RIOHACHA': 'RCH', 'POPAYAN': 'PPN', 'FLORENCIA': 'FLA',
  'BARRANCABERMEJA': 'EJA', 'PUERTO ASIS': 'PUU', 'SAN JOSE DEL GUAVIARE': 'SJE', 'MITU': 'MVP',
  // Internacionales que aparecen en la base
  'QUITO': 'UIO', 'GUAYAQUIL': 'GYE', 'MIAMI': 'MIA', 'MEXICO CITY': 'MEX', 'CIUDAD DE MEXICO': 'MEX',
  'CANCUN': 'CUN', 'GUADALAJARA': 'GDL', 'SAN LUIS POTOSI': 'SLP', 'PUERTO VALLARTA': 'PVR',
  'SAN SALVADOR': 'SAL', 'SANTIAGO': 'SCL', 'PUNTA CANA': 'PUJ', 'SAN JUAN': 'SJU', 'CHICAGO': 'ORD',
  'MINNEAPOLIS': 'MSP', 'INDIANAPOLIS': 'IND', 'NEW YORK': 'JFK', 'NEWARK': 'EWR', 'PANAMA': 'PTY',
  'LIMA': 'LIM', 'SAO PAULO': 'GRU', 'MADRID': 'MAD', 'SAN PEDRO SULA': 'SAP', 'SAN JOSE': 'SJO'
};

/** Destinos de la base sin vuelos comerciales: se avisa cuál es el aeropuerto más cercano en vez de inventar uno. */
var CP_SIN_AEROPUERTO = {
  'TUNJA': 'Bogotá (BOG)',
  'BARRA DE PARISMINA': 'San José de Costa Rica (SJO)'
};

/** 'Medellín, COLOMBIA' → 'MEDELLIN'. */
function cpCiudad(texto) {
  var t = String(texto || '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return t.split(',')[0].replace(/\s+/g, ' ').trim();
}

/** Ciudad del sistema o códigos IATA ('BOG', 'MDE,EOH') → códigos para la búsqueda. Lanza error si no la conoce. */
function cpAeropuertos(texto) {
  var t = String(texto || '').trim().toUpperCase();
  if (/^[A-Z]{3}(,[A-Z]{3})*$/.test(t)) return t;
  var c = cpCiudad(texto);
  if (CP_AEROPUERTOS[c]) return CP_AEROPUERTOS[c];
  if (CP_SIN_AEROPUERTO[c]) {
    throw new Error(c + ' no tiene vuelos comerciales; el aeropuerto más cercano es ' + CP_SIN_AEROPUERTO[c] + '. Busque con ese código.');
  }
  throw new Error('No conozco el aeropuerto de "' + texto + '". Escriba el código IATA (p. ej. BOG) o agréguelo a CP_AEROPUERTOS.');
}

/** 'AAAA-MM-DD' o 'DD-MM-AAAA' → 'AAAA-MM-DD'. */
function cpFecha(texto) {
  var s = String(texto || '').trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  throw new Error('Fecha inválida: "' + texto + '" (use AAAA-MM-DD).');
}

/**
 * Parámetros de la búsqueda en SerpApi. `viaje`: { origen, destino, ida, regreso?, pasajeros? }.
 * Precios en pesos (COP), vista de Google Flights para Colombia.
 */
function cpParametros(viaje, apiKey, opciones) {
  opciones = opciones || {};
  var p = {
    engine: 'google_flights',
    departure_id: cpAeropuertos(viaje.origen),
    arrival_id: cpAeropuertos(viaje.destino),
    outbound_date: cpFecha(viaje.ida),
    type: viaje.regreso ? '1' : '2',
    adults: String(Math.max(1, parseInt(viaje.pasajeros, 10) || 1)),
    currency: 'COP',
    gl: 'co',
    hl: 'es-419',
    api_key: apiKey
  };
  if (viaje.regreso) p.return_date = cpFecha(viaje.regreso);
  if (opciones.profunda) p.deep_search = 'true';
  return p;
}

function cpUrl(params) {
  return 'https://serpapi.com/search.json?' + Object.keys(params).map(function(k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
}

/** '2026-10-05 06:40' → minutos del día (400). */
function cpMinutos(fechaHora) {
  var m = String(fechaHora || '').match(/(\d{1,2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

/**
 * Resume la respuesta de SerpApi: la opción más barata por aerolínea, la más barata en
 * general y la más barata cerca de la hora preferida (± `ventanaMin`, por defecto 120).
 * Para ida y regreso, `price` es el total del viaje redondo con el regreso más barato.
 */
function cpResumir(json, viaje, ventanaMin) {
  if (!json || json.error) {
    return { ok: false, error: (json && json.error) || 'Respuesta vacía', opciones: [], porAerolinea: [] };
  }
  var ventana = ventanaMin === undefined ? 120 : ventanaMin;
  var preferida = viaje && viaje.horaIda ? cpMinutos(viaje.horaIda) : null;
  var opciones = [].concat(json.best_flights || [], json.other_flights || []).map(function(o) {
    var tramos = o.flights || [];
    var aerolineas = [];
    tramos.forEach(function(t) { if (t.airline && aerolineas.indexOf(t.airline) === -1) aerolineas.push(t.airline); });
    var salida = tramos.length ? tramos[0].departure_airport && tramos[0].departure_airport.time : '';
    var llegada = tramos.length ? tramos[tramos.length - 1].arrival_airport && tramos[tramos.length - 1].arrival_airport.time : '';
    return {
      aerolinea: aerolineas.join(' + ') || '(sin aerolínea)',
      precio: typeof o.price === 'number' ? o.price : null,
      salida: salida || '',
      llegada: llegada || '',
      desde: tramos.length ? (tramos[0].departure_airport || {}).id || '' : '',
      hacia: tramos.length ? (tramos[tramos.length - 1].arrival_airport || {}).id || '' : '',
      vuelos: tramos.map(function(t) { return t.flight_number; }).filter(Boolean).join(' / '),
      escalas: Math.max(0, tramos.length - 1),
      duracionMin: o.total_duration || null,
      clase: tramos.length ? tramos[0].travel_class || '' : '',
      departureToken: o.departure_token || '',
      bookingToken: o.booking_token || ''
    };
  });
  var conPrecio = opciones.filter(function(o) { return o.precio !== null; });
  var porAerolinea = {};
  conPrecio.forEach(function(o) {
    var a = porAerolinea[o.aerolinea];
    if (!a) a = porAerolinea[o.aerolinea] = { aerolinea: o.aerolinea, opciones: 0, masBarata: o };
    a.opciones++;
    if (o.precio < a.masBarata.precio) a.masBarata = o;
  });
  var lista = Object.keys(porAerolinea).map(function(k) { return porAerolinea[k]; })
    .sort(function(x, y) { return x.masBarata.precio - y.masBarata.precio; });
  var masBarata = conPrecio.slice().sort(function(x, y) { return x.precio - y.precio; })[0] || null;
  var cercaHora = null;
  if (preferida !== null) {
    conPrecio.forEach(function(o) {
      var m = cpMinutos(o.salida);
      if (m !== null && Math.abs(m - preferida) <= ventana && (!cercaHora || o.precio < cercaHora.precio)) cercaHora = o;
    });
  }
  var pi = json.price_insights || {};
  return {
    ok: true,
    opciones: opciones,
    sinPrecio: opciones.length - conPrecio.length,
    porAerolinea: lista,
    masBarata: masBarata,
    cercaHora: cercaHora,
    referenciaGoogle: {
      precioMasBajo: typeof pi.lowest_price === 'number' ? pi.lowest_price : null,
      nivel: pi.price_level || '',
      rangoTipico: Array.isArray(pi.typical_price_range) ? pi.typical_price_range : null
    }
  };
}

/**
 * Quién vende una tarifa en Google Flights (la aerolínea, Aviatur u otras agencias) y a qué
 * precio. `json` es la respuesta de una búsqueda con booking_token.
 */
function cpVendedores(json) {
  return (json && json.booking_options || []).map(function(b) {
    var t = b.together || b.departing || {};
    return {
      vendedor: t.book_with || '(sin nombre)',
      esAerolinea: t.airline === true,
      precio: typeof t.price === 'number' ? t.price : null,
      tarifa: t.option_title || '',
      boletosSeparados: b.separate_tickets === true
    };
  }).filter(function(v) { return v.precio !== null; })
    .sort(function(x, y) { return x.precio - y.precio; });
}

/** Diferencia entre lo cotizado y un precio de referencia: positiva = se cotizó más caro. */
function cpDiferencia(cotizado, referencia) {
  var c = Number(cotizado), r = Number(referencia);
  if (!(c > 0) || !(r > 0)) return null;
  return { pesos: c - r, porcentaje: (c - r) / r };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CP_AEROPUERTOS: CP_AEROPUERTOS, CP_SIN_AEROPUERTO: CP_SIN_AEROPUERTO, cpCiudad: cpCiudad, cpAeropuertos: cpAeropuertos, cpFecha: cpFecha,
    cpParametros: cpParametros, cpUrl: cpUrl, cpMinutos: cpMinutos, cpResumir: cpResumir, cpVendedores: cpVendedores, cpDiferencia: cpDiferencia
  };
}
