
/**
 * @AuthorizationRequired
 * @oauthScopes https://www.googleapis.com/auth/spreadsheets, https://www.googleapis.com/auth/drive, https://www.googleapis.com/auth/script.external_request, https://www.googleapis.com/auth/userinfo.email, https://www.googleapis.com/auth/script.container.ui, https://www.googleapis.com/auth/script.send_mail
 */

// --- CONFIGURATION & CONSTANTS ---
// Helper to read secrets from ScriptProperties (set via GAS editor: File > Project settings > Script properties)
function getConfig_(key, defaultVal) {
  var val = PropertiesService.getScriptProperties().getProperty(key);
  return val !== null ? val : (defaultVal || '');
}

// Public URLs (not secrets, but configurable)
const WEB_APP_URL = getConfig_('WEB_APP_URL', 'https://script.google.com/macros/s/AKfycbymPQQO0C8Xf089bjAVIciWNbsr9DmS50odghFp7t_nh5ZqHGFe7HisbaFF-TqMPxPwwQ/exec');
const PLATFORM_URL = getConfig_('PLATFORM_URL', 'https://sistematiquetesequitel-302740316698.us-west1.run.app');
const EMAIL_LOGO_URL = getConfig_('EMAIL_LOGO_URL', 'https://drive.google.com/thumbnail?id=1hA1i-1mG4DbBmzG1pFWafoDrCWwijRjq&sz=w1000');

// Secrets (MUST be set in ScriptProperties for production)
const GEMINI_API_KEY = getConfig_('GEMINI_API_KEY', '');

// TIMEOUT PARA BLOQUEOS (CONCURRENCIA)
const LOCK_WAIT_MS = 30000;

// Máximo de correos de recordatorio por ejecución de trigger (protege cuota diaria)
const MAX_REMINDER_EMAILS_PER_RUN = 100;

const SHEET_NAME_REQUESTS = 'Nueva Base Solicitudes';
const SHEET_NAME_MASTERS = 'MAESTROS';
const SHEET_NAME_RELATIONS = 'CDS vs UDEN';
const SHEET_NAME_INTEGRANTES = 'INTEGRANTES';
const SHEET_NAME_CITIES = 'CIUDADES DEL MUNDO';

// =====================================================================
// PHASE B FEATURE FLAG: read user data from USUARIOS instead of INTEGRANTES
// =====================================================================
// To switch the runtime to USUARIOS:
//   Script Properties → set USE_USUARIOS_SHEET = 'true'
// To revert to INTEGRANTES:
//   Script Properties → set to 'false' (or delete the property)
// No redeploy required — Apps Script re-reads constants on each web app
// invocation. The switch is instantaneous and atomic.
// =====================================================================
const USE_USUARIOS_SHEET = getConfig_('USE_USUARIOS_SHEET', 'false') === 'true';

// DRIVE & EMAIL CONFIG (set in ScriptProperties for production)
const ROOT_DRIVE_FOLDER_ID = getConfig_('ROOT_DRIVE_FOLDER_ID', '1uaett_yH1qZcS-rVr_sUh73mODvX02im');
const ADMIN_EMAIL = getConfig_('ADMIN_EMAIL', 'apcompras@equitel.com.co');
const CEO_EMAIL = getConfig_('CEO_EMAIL', 'misaza@equitel.com.co');
const DIRECTOR_EMAIL = getConfig_('DIRECTOR_EMAIL', 'yprieto@equitel.com.co');

// --- SECURITY: HTML escaping to prevent XSS in email templates ---
function escapeHtml_(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Marcador único en OBSERVACIONES para indicar que la solicitud padre está
// esperando que el usuario responda si desea continuar o anular (tras una
// consulta iniciada por el admin después de denegar un cambio). Mientras el
// marcador esté presente, los recordatorios de la padre se pausan. El
// marcador se oculta del campo `comments` del mapper para no aparecer en
// correos ni en la UI.
const USER_CONSULT_MARKER = '[[CONSULTA_USUARIO_PENDIENTE]]';

// HEADERS - ACTUALIZADOS
const HEADERS_REQUESTS = [
  "FECHA SOLICITUD", "EMPRESA", "CIUDAD ORIGEN", "CIUDAD DESTINO", "# ORDEN TRABAJO", 
  "# PERSONAS QUE VIAJAN", "CORREO ENCUESTADO", 
  "CÉDULA PERSONA 1", "NOMBRE PERSONA 1", "CÉDULA PERSONA 2", "NOMBRE PERSONA 2", 
  "CÉDULA PERSONA 3", "NOMBRE PERSONA 3", "CÉDULA PERSONA 4", "NOMBRE PERSONA 4", 
  "CÉDULA PERSONA 5", "NOMBRE PERSONA 5", 
  "CENTRO DE COSTOS", "VARIOS CENTROS COSTOS", "NOMBRE CENTRO DE COSTOS (AUTOMÁTICO)", 
  "UNIDAD DE NEGOCIO", "SEDE", "REQUIERE HOSPEDAJE", "NOMBRE HOTEL", "# NOCHES (AUTOMÁTICO)", 
  "FECHA IDA", "FECHA VUELTA", "HORA LLEGADA VUELO IDA", "HORA LLEGADA VUELO VUELTA", 
  "ID RESPUESTA", // Index 29
  "APROBADO POR ÁREA?", "COSTO COTIZADO PARA VIAJE", "FECHA DE COMPRA DE TIQUETE", 
  "PERSONA QUE TRAMITA EL TIQUETE /HOTEL", "STATUS", "TIPO DE COMPRA DE TKT", 
  "FECHA DEL VUELO", "No RESERVA", "PROVEEDOR", "SERVICIO SOLICITADO", 
  "FECHA DE FACTURA", "# DE FACTURA", "TIPO DE TKT", "Q TKT", "DIAS DE ANTELACION TKT", 
  "VALOR PAGADO A AEROLINEA Y/O HOTEL", "VALOR PAGADO A AVIATUR Y/O IVA", 
  "TOTAL FACTURA", "PRESUPUESTO", "TARJETA DE CREDITO CON LA QUE SE HIZO LA COMPRA", 
  "OBSERVACIONES", "QUIÉN APRUEBA? (AUTOMÁTICO)", "APROBADO POR ÁREA? (AUTOMÁTICO)", 
  "FECHA/HORA (AUTOMÁTICO)", "CORREO DE QUIEN APRUEBA (AUTOMÁTICO)", "FECHASIMPLE_SOLICITUD",
  "OPCIONES (JSON)", "SELECCION (JSON)", "SOPORTES (JSON)", "CORREOS PASAJEROS (JSON)",
  "ID SOLICITUD PADRE", "TIPO DE SOLICITUD", "TEXTO_CAMBIO", "FLAG_CAMBIO_REALIZADO",
  "ES INTERNACIONAL", "VIOLACION POLITICA",
  "APROBADO CDS", "APROBADO CEO",
  "SELECCION_TEXTO", "COSTO_FINAL_TIQUETES", "COSTO_FINAL_HOTEL",
  "ES_CAMBIO_CON_COSTO", "FECHA_SOLICITUD_PADRE", // Nuevos headers para trazabilidad de cambios
  "EVENTOS_JSON", // Métricas: timestamps de cada evento del ciclo
  "MODO_SOLICITUD" // 'VIAJE' (default) o 'SOLO_HOSPEDAJE' — determina flujo visual (emails, modales, form)
];

// =====================================================================
// RUNTIME HEADER LOOKUP — soporta cualquier orden de columnas en la hoja
// =====================================================================
// HEADERS_REQUESTS sigue siendo la "schema canónica" (qué columnas DEBEN existir).
// Pero las posiciones reales en la hoja se leen runtime via H(name).
// Esto permite que el admin reorganice columnas sin romper el código.
// El cache se invalida por ejecución (cada doPost/doGet empieza limpio).
// =====================================================================
var _REQ_HEADERS_CACHE = null;

function _getReqHeaders_(sheet) {
  if (_REQ_HEADERS_CACHE) return _REQ_HEADERS_CACHE;
  if (!sheet) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
    if (!sheet) {
      // Fallback al schema canónico si no se puede leer la hoja
      var fallback = {};
      HEADERS_REQUESTS.forEach(function(h, i) { fallback[h] = i; });
      return fallback;
    }
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return {};
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  headers.forEach(function(h, i) {
    var name = String(h || '').trim();
    if (name) map[name] = i;
  });
  _REQ_HEADERS_CACHE = map;
  return map;
}

/**
 * Retorna el índice 0-based de la columna con el header dado, leyendo
 * de la hoja real (no del array canónico). Retorna -1 si no existe.
 * Equivalente a H(name) pero respeta reorganizaciones.
 */
function H(name) {
  var headers = _getReqHeaders_();
  return headers[name] !== undefined ? headers[name] : -1;
}

/** Limpia el cache de headers (útil después de migraciones de hoja) */
function _clearReqHeadersCache_() { _REQ_HEADERS_CACHE = null; }

// --- SETUP FUNCTION ---
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  let sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME_REQUESTS);
    sheet.getRange(1, 1, 1, HEADERS_REQUESTS.length).setValues([HEADERS_REQUESTS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS_REQUESTS.length).setFontWeight("bold").setBackground("#D71920").setFontColor("white");
  } else {
    // SAFETY: nunca sobreescribe headers existentes (podrían estar reorganizados).
    // Solo APPEND headers canónicos faltantes al final de la última columna usada.
    // Esto preserva cualquier reorganización hecha vía nbs_* workflow y también
    // preserva columnas extras agregadas manualmente por el admin.
    const lastCol = sheet.getLastColumn();
    const currentHeaders = lastCol > 0
      ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h){ return String(h || '').trim(); })
      : [];
    const present = {};
    currentHeaders.forEach(function(h){ if (h) present[h] = true; });
    const missing = HEADERS_REQUESTS.filter(function(h){ return !present[h]; });
    if (missing.length > 0) {
      // Append missing headers después de la última columna actual
      const startCol = lastCol + 1;
      sheet.getRange(1, startCol, 1, missing.length).setValues([missing])
        .setFontWeight('bold').setBackground('#D71920').setFontColor('white');
    }
  }

  let relSheet = ss.getSheetByName(SHEET_NAME_RELATIONS);
  if (!relSheet) {
    relSheet = ss.insertSheet(SHEET_NAME_RELATIONS);
    relSheet.appendRow(["CENTRO COSTOS", "Descripcion del CC", "UNIDAD DE NEGOCIO"]);
  }

  let intSheet = ss.getSheetByName(SHEET_NAME_INTEGRANTES);
  if (!intSheet) {
    intSheet = ss.insertSheet(SHEET_NAME_INTEGRANTES);
    intSheet.appendRow([
        "Cedula Numero", "Apellidos y Nombres", "correo", "Empresa", "NDC", 
        "Centro de Costo", "Unidad", "sede", "cargo", "jefe Unidad", 
        "aprobador", "correo aprobador"
    ]);
  }
  
  return "Database Setup Complete.";
}

/**
 * Handle GET requests (Email Links)
 */
function doGet(e) {
  // Return JSON status if no parameters (prevents frontend crash on default GET)
  if (!e.parameter || Object.keys(e.parameter).length === 0) {
      return ContentService.createTextOutput(JSON.stringify({
          success: true,
          message: "Equitel API Active. Use POST for operations."
      })).setMimeType(ContentService.MimeType.JSON);
  }

  const action = e.parameter.action;

  // 1. Handle Approval/Rejection by Approver (Returns HTML)
  if (action === 'approve') {
    return processApprovalFromEmail(e);
  }

  // 2. Handle Option Selection by Requester (Returns HTML)
  if (action === 'select') {
    return processOptionSelection(e);
  }

  // 3. Handle Modification Decision by Admin (Returns HTML)
  if (action === 'study_decision') {
    return processStudyDecision(e);
  }

  // 3b. Handle User Consultation Response (Returns HTML)
  // Triggered when the user clicks CONTINUAR or ANULAR in the consultation
  // email that the analyst sends after denying a change request.
  if (action === 'user_consult') {
    return processUserConsultResponse(e);
  }

  // 4. API Action via GET (Returns JSON)
  if (action) {
    const result = dispatch(action, e.parameter);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Fallback for unknown actions (Returns JSON)
  return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: "Acción desconocida o método incorrecto. Use POST para la API."
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handle POST requests (App API)
 */
function doPost(e) {
  try {
    if (!e.postData || !e.postData.contents) {
       throw new Error("Empty Request Body");
    }

    const data = JSON.parse(e.postData.contents);
    const result = dispatch(data.action, data.payload);
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ 
      success: false, 
      error: "Invalid Request: " + error.toString() 
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Main API Dispatcher
 */
function dispatch(action, payload) {
  const isWriteAction = ['createRequest', 'updateRequest', 'uploadSupportFile', 'uploadOptionImage', 'closeRequest', 'requestModification', 'updateAdminPin', 'registerReservation', 'amendReservation', 'deleteDriveFile', 'anularSolicitud', 'cancelOwnRequest', 'generateReport', 'createReportTemplate', 'processChangeDecision'].includes(action);
  const lock = LockService.getScriptLock();

  let currentUserEmail = '';
  if (payload && payload.userEmail) {
    currentUserEmail = String(payload.userEmail).trim().toLowerCase();
  } else {
    currentUserEmail = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  }

  try {
    // SECURITY TIER 1: Actions exempt from session validation (login flow + pre-login checks)
    const sessionExemptActions = ['getCurrentUser', 'requestUserPin', 'verifyUserPin', 'validateSession', 'logout', 'verifyAdminPin', 'checkIsAnalyst'];

    // SECURITY TIER 2: For all other actions, the user must have a valid session token
    if (!sessionExemptActions.includes(action)) {
      const token = payload && payload.sessionToken;
      if (!token || !validateUserSession_(currentUserEmail, token)) {
        return { success: false, error: 'Sesión expirada o inválida. Por favor inicia sesión nuevamente.', code: 'SESSION_EXPIRED' };
      }
      // Defense in depth: also confirm email is in INTEGRANTES (or analyst whitelist)
      if (!validateUserEmail_(currentUserEmail)) {
        return { success: false, error: 'Usuario no autorizado. Su correo no está registrado en el sistema.' };
      }
    }

    // SECURITY: Admin-only actions require analyst role
    const adminOnlyActions = ['updateAdminPin', 'anularSolicitud', 'generateReport', 'createReportTemplate', 'closeRequest', 'deleteDriveFile', 'uploadOptionImage', 'registerReservation', 'amendReservation', 'getMetrics', 'processChangeDecision'];
    if (adminOnlyActions.includes(action) && !isUserAnalyst(currentUserEmail)) {
      return { success: false, error: 'Esta acción requiere permisos de administrador.' };
    }

    // LOCKING STRATEGY: Block execution until lock is acquired to prevent race conditions.
    if (isWriteAction) {
      const hasLock = lock.tryLock(LOCK_WAIT_MS);
      if (!hasLock) {
        return {
          success: false,
          error: 'El sistema está ocupado procesando otra solicitud (Alta concurrencia). Por favor intente de nuevo en unos segundos.'
        };
      }
    }

    let result;
    switch (action) {
      case 'getCurrentUser': result = currentUserEmail; break;
      case 'getCostCenterData': result = getCostCenterData(); break;
      case 'getIntegrantesData': result = getIntegrantesData(); break;
      case 'getCitiesList': result = getCitiesList(); break;
      case 'getCreditCards': result = getCreditCards(); break;
      case 'getSites': result = getSites(); break;
      case 'getCoApproverRules': result = getCoApproverRules_(); break;
      case 'getExecutiveEmails': result = getExecutiveEmails(); break;
      case 'getMetrics': result = getMetrics(payload.filters || {}); break;
      // SECURITY: Server-side analyst check
      case 'checkIsAnalyst': result = isUserAnalyst(currentUserEmail); break;
      case 'getMyRequests': result = getRequestsByEmail(currentUserEmail); break;
      case 'getAllRequests': 
        if(!isUserAnalyst(currentUserEmail)) {
           result = getRequestsByEmail(currentUserEmail);
        } else {
           result = getAllRequests();
        }
        break;
      case 'createRequest': {
        // Normalize: strip internal fields (sessionToken, userEmail) that the frontend
        // sends at the payload root so they don't leak into createNewRequest as data fields.
        var reqData = payload.data || payload;
        var cleanData = {};
        Object.keys(reqData).forEach(function(k) {
          if (k !== 'sessionToken' && k !== 'userEmail' && k !== 'action') cleanData[k] = reqData[k];
        });
        result = createNewRequest(cleanData, payload.emailHtml);
        break;
      }
      case 'updateRequest': result = updateRequestStatus(payload.id, payload.status, payload.payload); break;
      case 'uploadSupportFile': result = uploadSupportFile(payload.requestId, payload.fileData, payload.fileName, payload.mimeType, payload.correctionNote); break;
      
      // NEW: UPLOAD OPTION IMAGE (UPDATED v2.7)
      case 'uploadOptionImage': result = uploadOptionImage(payload.requestId, payload.fileData, payload.fileName, payload.type, payload.optionLetter, payload.direction); break;

      case 'closeRequest': 
        updateRequestStatus(payload.requestId, 'PROCESADO');
        try { generateSupportReport(payload.requestId); } catch(e) { console.error('Auto-report failed: ' + e); }
        result = true;
        break;
      case 'enhanceChangeText': result = enhanceTextWithGemini(payload.currentRequest, payload.userDraft); break;
      
      // REFACTORED MODIFICATION LOGIC
      case 'requestModification': result = requestModification(payload.requestId, payload.modifiedRequest, payload.changeReason, payload.emailHtml); break;
      case 'processChangeDecision': result = processChangeDecision(payload); break;
      
      // PIN FEATURES
      case 'verifyAdminPin': result = verifyAdminPin(payload.pin, payload.email); break;
      case 'updateAdminPin': result = updateAdminPin(payload.newPin); break;

      // USER PIN AUTHENTICATION + SESSIONS
      case 'requestUserPin': result = requestUserPin(payload.email, payload.forceRegenerate === true); break;
      case 'verifyUserPin': result = verifyUserPin(payload.email, payload.pin); break;
      case 'validateSession': result = validateSession(payload.email, payload.token); break;
      case 'logout': result = logout(payload.email, payload.token); break;

      // NEW: RESERVATION LOGIC
      case 'registerReservation': result = registerReservation(payload.requestId, payload.reservationNumber, payload.files, payload.creditCard, payload.purchaseDate); break;
      case 'amendReservation': result = amendReservation(payload); break;

      // NEW: DRIVE DELETION
      case 'deleteDriveFile': result = deleteDriveFile(payload.fileId); break;

      case 'anularSolicitud': result = anularSolicitud(payload.requestId, payload.reason); break;
      case 'cancelOwnRequest': result = cancelOwnRequest(payload.requestId, payload.reason, currentUserEmail); break;

      // REPORT GENERATION (v2.6)
      case 'generateReport': result = generateSupportReport(payload.requestId); break;
      case 'createReportTemplate': result = createReportTemplate(); break;

      default: return { success: false, error: 'Acción desconocida: ' + action };
    }
    
    if (isWriteAction) {
      SpreadsheetApp.flush();
    }

    return { success: true, data: result };

  } catch (e) {
    console.error("Error in dispatch: " + e.toString());
    return { success: false, error: e.toString() };
  } finally {
    if (isWriteAction) lock.releaseLock();
  }
}

// --- SECURITY: Validate email exists in the active user sheet ---
// Branches between INTEGRANTES (legacy) and USUARIOS (Phase B) based on
// the USE_USUARIOS_SHEET flag.
function validateUserEmail_(email) {
  if (!email) return false;
  // Analysts are always valid (they are in the whitelist)
  if (isUserAnalyst(email)) return true;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = USE_USUARIOS_SHEET ? SHEET_NAME_USUARIOS : SHEET_NAME_INTEGRANTES;
  const emailColName = USE_USUARIOS_SHEET ? 'Correo' : 'correo';
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return false;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const emailIdx = headers.indexOf(emailColName);
  if (emailIdx < 0) return false;

  const data = sheet.getRange(2, emailIdx + 1, lastRow - 1, 1).getValues();
  const target = email.toLowerCase().trim();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === target) return true;
  }
  return false;
}

// --- SECURITY: PIN hashing + rate limiting ---
function hashPin_(pin) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pin + 'equitel_viajes_salt_v1');
  return digest.map(function(b) { return ('0' + ((b & 0xFF).toString(16))).slice(-2); }).join('');
}

function isPinRateLimited_() {
  var props = PropertiesService.getScriptProperties();
  var lockoutUntil = props.getProperty('PIN_LOCKOUT_UNTIL');
  if (lockoutUntil && new Date().getTime() < Number(lockoutUntil)) {
    return true;
  }
  return false;
}

function recordFailedPinAttempt_() {
  var props = PropertiesService.getScriptProperties();
  var attempts = Number(props.getProperty('PIN_FAILED_ATTEMPTS') || '0') + 1;
  props.setProperty('PIN_FAILED_ATTEMPTS', String(attempts));
  if (attempts >= 5) {
    // Lock for 15 minutes
    var lockoutUntil = new Date().getTime() + (15 * 60 * 1000);
    props.setProperty('PIN_LOCKOUT_UNTIL', String(lockoutUntil));
    props.setProperty('PIN_FAILED_ATTEMPTS', '0');
  }
}

function verifyAdminPin(inputPin, email) {
  if (isPinRateLimited_()) {
    throw new Error('Demasiados intentos fallidos. Intente de nuevo en 15 minutos.');
  }

  var props = PropertiesService.getScriptProperties();
  var storedHash = props.getProperty('ADMIN_PIN_HASH');

  // If no hash exists, check for legacy plaintext PIN and migrate it
  if (!storedHash) {
    var legacyPin = props.getProperty('ADMIN_PIN');
    if (legacyPin) {
      // Auto-migrate to hashed storage
      storedHash = hashPin_(legacyPin);
      props.setProperty('ADMIN_PIN_HASH', storedHash);
      props.deleteProperty('ADMIN_PIN');
    } else {
      throw new Error('PIN de administrador no configurado. Ejecute configurarPinInicial() desde el editor de Apps Script.');
    }
  }

  var inputHash = hashPin_(String(inputPin));
  if (inputHash !== storedHash) {
    recordFailedPinAttempt_();
    return { success: false };
  }

  // PIN matches. Now require an email to issue a session token.
  // Backward compat: if no email provided, return legacy `true` so old clients still work.
  props.deleteProperty('PIN_FAILED_ATTEMPTS');
  props.deleteProperty('PIN_LOCKOUT_UNTIL');

  if (!email) return true;

  var normalized = String(email).toLowerCase().trim();
  if (!isUserAnalyst(normalized)) {
    throw new Error('El correo proporcionado no tiene permisos de administrador.');
  }
  var session = createSession_(normalized, 'ANALYST');
  return {
    success: true,
    token: session.token,
    expiresAt: session.expiresAt,
    role: 'ANALYST'
  };
}

function updateAdminPin(newPin) {
  if (!newPin || String(newPin).length !== 8 || !/^\d{8}$/.test(String(newPin))) {
    throw new Error("El PIN debe ser exactamente 8 dígitos numéricos.");
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_PIN_HASH', hashPin_(String(newPin)));
  props.deleteProperty('ADMIN_PIN'); // Remove legacy plaintext if exists
  return true;
}

/**
 * ADMIN UTILITY: Run from GAS editor to see all configured properties and which ones need setup.
 * Select this function in the editor dropdown and click ▶ Run, then check Execution Log.
 */
function verPropiedadesDelScript() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var expected = [
    { key: 'GEMINI_API_KEY', desc: 'API key de Google Gemini (para mejora de texto con IA)', required: false },
    { key: 'ANALYST_EMAILS', desc: 'JSON array de correos admin, ej: ["apcompras@equitel.com.co"]', required: true },
    { key: 'ADMIN_PIN_HASH', desc: 'Hash del PIN admin (se genera automáticamente)', required: true },
    { key: 'REPORT_TEMPLATE_ID', desc: 'ID del template de reportes (se genera con createReportTemplate)', required: false },
    { key: 'WEB_APP_URL', desc: 'URL del web app de GAS (tiene default)', required: false },
    { key: 'PLATFORM_URL', desc: 'URL del frontend en Cloud Run (tiene default)', required: false },
    { key: 'ROOT_DRIVE_FOLDER_ID', desc: 'ID de la carpeta raíz en Drive (tiene default)', required: false },
    { key: 'ADMIN_EMAIL', desc: 'Correo del admin principal (default: apcompras@equitel.com.co)', required: false },
    { key: 'CEO_EMAIL', desc: 'Correo del CEO (default: misaza@equitel.com.co)', required: false },
    { key: 'DIRECTOR_EMAIL', desc: 'Correo del director CDS (default: yprieto@equitel.com.co)', required: false }
  ];

  console.log('========================================');
  console.log('  PROPIEDADES DEL SCRIPT - DIAGNÓSTICO');
  console.log('========================================\n');

  console.log('--- PROPIEDADES CONFIGURADAS ---');
  var configuredKeys = Object.keys(props);
  if (configuredKeys.length === 0) {
    console.log('  (ninguna)');
  } else {
    configuredKeys.forEach(function(key) {
      var val = props[key];
      // Ocultar valores sensibles
      var display = (key.indexOf('PIN') > -1 || key.indexOf('KEY') > -1 || key.indexOf('HASH') > -1)
        ? val.substring(0, 8) + '...' : val;
      console.log('  ✅ ' + key + ' = ' + display);
    });
  }

  console.log('\n--- PROPIEDADES PENDIENTES ---');
  var pending = expected.filter(function(e) { return !props[e.key]; });
  if (pending.length === 0) {
    console.log('  ¡Todas las propiedades están configuradas!');
  } else {
    pending.forEach(function(e) {
      var tag = e.required ? '⚠️  REQUERIDA' : 'ℹ️  OPCIONAL';
      console.log('  ' + tag + ': ' + e.key + ' — ' + e.desc);
    });
  }

  console.log('\n========================================');
  return 'Revise el Log de Ejecución para ver el resultado.';
}

/**
 * ONE-TIME SETUP: Set initial admin PIN via ScriptProperties.
 * Usage in GAS editor: Set script property INITIAL_ADMIN_PIN to your 8-digit PIN, then run this function.
 */
function configurarPinInicial() {
  var pin = PropertiesService.getScriptProperties().getProperty('INITIAL_ADMIN_PIN');
  if (!pin) return 'Error: Primero configure la propiedad INITIAL_ADMIN_PIN en Configuración del proyecto > Propiedades del script.';
  updateAdminPin(pin);
  PropertiesService.getScriptProperties().deleteProperty('INITIAL_ADMIN_PIN');
  return 'PIN configurado exitosamente. La propiedad temporal INITIAL_ADMIN_PIN ha sido eliminada.';
}

// =====================================================================
// USER PIN AUTHENTICATION + SESSION TOKENS
// =====================================================================

var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashEmail_(email) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(email).toLowerCase().trim());
  return digest.map(function(b) { return ('0' + ((b & 0xFF).toString(16))).slice(-2); }).join('');
}

function generateRandomPin_() {
  var pin = '';
  for (var i = 0; i < 8; i++) {
    pin += Math.floor(Math.random() * 10);
  }
  return pin;
}

function generateSessionToken_() {
  // 2 UUIDs concatenated (no dashes) → 64 hex chars, 244 bits of entropy
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function maskEmail_(email) {
  var parts = String(email).split('@');
  if (parts.length !== 2) return email;
  var name = parts[0];
  var domain = parts[1];
  if (name.length <= 2) return name[0] + '***@' + domain;
  return name.substring(0, 2) + '****@' + domain;
}

// --- Per-user PIN rate limiting ---
function isUserPinRateLimited_(email) {
  var props = PropertiesService.getScriptProperties();
  var key = 'USER_PIN_LOCKOUT_' + hashEmail_(email);
  var lockoutUntil = props.getProperty(key);
  if (lockoutUntil && new Date().getTime() < Number(lockoutUntil)) return true;
  return false;
}

function recordFailedUserPinAttempt_(email) {
  var props = PropertiesService.getScriptProperties();
  var hashKey = hashEmail_(email);
  var failKey = 'USER_PIN_FAILS_' + hashKey;
  var lockKey = 'USER_PIN_LOCKOUT_' + hashKey;
  var attempts = Number(props.getProperty(failKey) || '0') + 1;
  props.setProperty(failKey, String(attempts));
  if (attempts >= 5) {
    var lockoutUntil = new Date().getTime() + (15 * 60 * 1000);
    props.setProperty(lockKey, String(lockoutUntil));
    props.setProperty(failKey, '0');
  }
}

function clearFailedUserPinAttempts_(email) {
  var props = PropertiesService.getScriptProperties();
  var hashKey = hashEmail_(email);
  props.deleteProperty('USER_PIN_FAILS_' + hashKey);
  props.deleteProperty('USER_PIN_LOCKOUT_' + hashKey);
}

// --- PIN hash read/write — works against INTEGRANTES or USUARIOS ---
// Branches via USE_USUARIOS_SHEET flag. Both sheets have a "PIN" column,
// but the email column has different casing ("correo" vs "Correo").

function _findIntegranteRowByEmail_(sheet, email) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  // Try both casings so the helper works for either sheet
  var emailIdx = headers.indexOf("correo");
  if (emailIdx < 0) emailIdx = headers.indexOf("Correo");
  if (emailIdx < 0) return -1;
  var data = sheet.getRange(2, emailIdx + 1, lastRow - 1, 1).getValues();
  var target = String(email).toLowerCase().trim();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === target) return i + 2; // 1-indexed row
  }
  return -1;
}

function _getPinColumnIndex_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idx = headers.indexOf("PIN");
  return idx >= 0 ? idx + 1 : -1;
}

function _getActiveUserSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = USE_USUARIOS_SHEET ? SHEET_NAME_USUARIOS : SHEET_NAME_INTEGRANTES;
  return ss.getSheetByName(name);
}

function getUserPinHash_(email) {
  var sheet = _getActiveUserSheet_();
  if (!sheet) return '';
  var row = _findIntegranteRowByEmail_(sheet, email);
  if (row < 0) return '';
  var pinCol = _getPinColumnIndex_(sheet);
  if (pinCol < 0) return '';
  return String(sheet.getRange(row, pinCol).getValue() || '').trim();
}

function setUserPinHash_(email, hash) {
  var sheet = _getActiveUserSheet_();
  if (!sheet) throw new Error('Hoja de usuarios no encontrada (' + (USE_USUARIOS_SHEET ? SHEET_NAME_USUARIOS : SHEET_NAME_INTEGRANTES) + ').');
  var row = _findIntegranteRowByEmail_(sheet, email);
  if (row < 0) throw new Error('Correo no encontrado en la hoja de usuarios.');
  var pinCol = _getPinColumnIndex_(sheet);
  if (pinCol < 0) throw new Error('Columna PIN no encontrada en la hoja de usuarios.');
  sheet.getRange(row, pinCol).setValue(hash);
  SpreadsheetApp.flush();
}

// --- Session management ---
// IMPORTANT: Sessions are keyed by TOKEN, not by email. This allows multiple
// concurrent sessions per user (different tabs, devices, browsers) without one
// invalidating another. The session record stores the email so we can verify
// that the token actually belongs to the user making the request.
function createSession_(email, role) {
  var token = generateSessionToken_();
  var expiresAt = new Date().getTime() + SESSION_TTL_MS;
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SESSION_' + token, JSON.stringify({
    token: token,
    expiresAt: expiresAt,
    email: String(email).toLowerCase().trim(),
    role: role
  }));
  return { token: token, expiresAt: expiresAt, role: role };
}

function validateUserSession_(email, token) {
  if (!email || !token) return null;
  var props = PropertiesService.getScriptProperties();
  var key = 'SESSION_' + token;
  var raw = props.getProperty(key);
  if (!raw) return null;
  try {
    var session = JSON.parse(raw);
    // The token must belong to the email making the request (defense in depth)
    if (String(session.email).toLowerCase().trim() !== String(email).toLowerCase().trim()) return null;
    if (new Date().getTime() > Number(session.expiresAt)) {
      props.deleteProperty(key); // lazy cleanup
      return null;
    }
    return session;
  } catch (e) {
    return null;
  }
}

function destroySession_(token) {
  if (!token) return;
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('SESSION_' + token);
}

/**
 * Manual cleanup utility: removes all expired sessions from ScriptProperties.
 * Run from GAS editor periodically (e.g. monthly).
 */
function cleanupExpiredSessions() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var now = new Date().getTime();
  var removed = 0;
  Object.keys(all).forEach(function(key) {
    if (key.indexOf('SESSION_') !== 0) return;
    try {
      var s = JSON.parse(all[key]);
      if (now > Number(s.expiresAt)) {
        props.deleteProperty(key);
        removed++;
      }
    } catch (e) {
      props.deleteProperty(key); // corrupt → remove
      removed++;
    }
  });
  console.log('Sesiones expiradas eliminadas: ' + removed);
  return removed;
}

// --- Public PIN endpoints ---

/**
 * Two modes:
 * - forceRegenerate=false (default): if user already has a PIN, do NOT regenerate or email — just
 *   confirm that the user must enter their existing PIN. If they don't have one, generate the
 *   first PIN and email it.
 * - forceRegenerate=true: always generate a new PIN, hash it, store it, and email it (used by
 *   the explicit "Reenviar PIN" button). The previous PIN becomes invalid.
 *
 * The plain PIN is NEVER persisted server-side; only its hash lives in INTEGRANTES col M.
 */
function requestUserPin(email, forceRegenerate) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    throw new Error('Correo inválido.');
  }
  var normalized = String(email).toLowerCase().trim();

  // 1. Verify the user exists in INTEGRANTES
  if (!validateUserEmail_(normalized)) {
    throw new Error('Tu correo no está registrado en el sistema. Contacta al área de viajes.');
  }

  // 2. Detect if it's the first time (no hash yet)
  var existingHash = getUserPinHash_(normalized);
  var hasPin = !!existingHash;

  // 3. If user already has a PIN and we're not forcing regeneration, just acknowledge —
  //    no email, no hash overwrite. Frontend will show the "enter your existing PIN" UI.
  if (hasPin && !forceRegenerate) {
    return {
      sent: false,
      hasExistingPin: true,
      isFirstTime: false,
      maskedEmail: maskEmail_(normalized)
    };
  }

  // 4. Generate a new PIN, hash, store
  var plainPin = generateRandomPin_();
  var hash = hashPin_(plainPin);
  setUserPinHash_(normalized, hash);

  // 5. Send email with the plain PIN
  var isFirstTime = !hasPin; // truly first time vs. forced regeneration of an existing PIN
  var html = HtmlTemplates.userPinDelivery(normalized, plainPin, isFirstTime);
  var subject = 'Tu PIN de acceso - Portal de Viajes Equitel';
  sendEmailRich(normalized, subject, html, null);

  return {
    sent: true,
    hasExistingPin: false,
    isFirstTime: isFirstTime,
    maskedEmail: maskEmail_(normalized)
  };
}

function verifyUserPin(email, inputPin) {
  if (!email || !inputPin) throw new Error('Correo y PIN son requeridos.');
  var normalized = String(email).toLowerCase().trim();

  if (isUserPinRateLimited_(normalized)) {
    throw new Error('Demasiados intentos fallidos. Intenta de nuevo en 15 minutos.');
  }

  var storedHash = getUserPinHash_(normalized);
  if (!storedHash) {
    throw new Error('No tienes un PIN configurado. Solicita primero el envío de tu PIN.');
  }

  var inputHash = hashPin_(String(inputPin));
  if (inputHash !== storedHash) {
    recordFailedUserPinAttempt_(normalized);
    return { success: false };
  }

  // Success: clear failures, determine role, create session
  clearFailedUserPinAttempts_(normalized);
  var role = isUserAnalyst(normalized) ? 'ANALYST' : 'REQUESTER';
  var session = createSession_(normalized, role);
  return {
    success: true,
    token: session.token,
    expiresAt: session.expiresAt,
    role: role
  };
}

function validateSession(email, token) {
  var session = validateUserSession_(email, token);
  if (!session) return { valid: false };
  return { valid: true, role: session.role, expiresAt: session.expiresAt };
}

function logout(email, token) {
  // Only destroy if the token actually belongs to this email (prevents arbitrary logout)
  var session = validateUserSession_(email, token);
  if (session) destroySession_(token);
  return true;
}

function enhanceTextWithGemini(currentRequest, userDraft) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('test')) return userDraft;
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const context = `
    ID Solicitud: ${currentRequest.requestId}
    Solicitante: ${currentRequest.requesterEmail}
    Empresa: ${currentRequest.company}
    Ruta Original: ${currentRequest.origin} -> ${currentRequest.destination}
    Fecha Ida Original: ${currentRequest.departureDate}
    Fecha Regreso Original: ${currentRequest.returnDate || 'N/A'}
  `;

  const prompt = `
    Actúa como un asistente administrativo experto en gestión de viajes corporativos.
    Tu tarea es redactar una JUSTIFICACIÓN FORMAL Y CLARA para un cambio en una solicitud de viaje.
    
    CONTEXTO DE LA SOLICITUD ORIGINAL:
    ${context}

    EL USUARIO DICE (BORRADOR):
    "${userDraft}"

    INSTRUCCIONES:
    1. Redacta un párrafo breve (máximo 3 oraciones) que explique el motivo del cambio de manera profesional.
    2. Usa un tono formal y persuasivo dirigido al aprobador financiero.
    3. Si el usuario menciona cambios de fecha, ruta o pasajeros, inclúyelos explícitamente en la redacción para dar claridad.
    4. Devuelve SOLAMENTE el texto final de la justificación.
  `;

  try {
    const payload = {
      contents: [{
        parts: [{ text: prompt }]
      }]
    };
    const response = UrlFetchApp.fetch(url, { 
      method: 'post', 
      contentType: 'application/json', 
      payload: JSON.stringify(payload) 
    });
    const json = JSON.parse(response.getContentText());
    return json.candidates?.[0]?.content?.parts?.[0]?.text || userDraft;
  } catch (e) { 
    return userDraft; 
  }
}

// --- NEW MODIFICATION ARCHITECTURE ---

function requestModification(originalRequestId, modifiedRequestData, changeReason, emailHtml) {
   validateRequestInput_(modifiedRequestData);
   const ss = SpreadsheetApp.getActiveSpreadsheet();
   const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
   if (!sheet) throw new Error("Base de datos no encontrada");

   const idIdx = H("ID RESPUESTA");
   const statusIdx = H("STATUS");
   const obsIdx = H("OBSERVACIONES");
   const dateIdx = H("FECHA SOLICITUD");

   const lastRow = sheet.getLastRow();
   const ids = sheet.getRange(2, idIdx + 1, lastRow - 1, 1).getValues().flat();
   const rowIndex = ids.map(String).indexOf(String(originalRequestId));
   if (rowIndex === -1) throw new Error("ID de solicitud original no encontrado");
   const rowNumber = rowIndex + 2;

   // GET PARENT DETAILS FOR METADATA
   const parentStatus = sheet.getRange(rowNumber, statusIdx + 1).getValue();
   const parentDateVal = sheet.getRange(rowNumber, dateIdx + 1).getValue();
   
   // Logic for Extra Cost Warning
   const parentWasReserved = (parentStatus === 'RESERVADO');
   
   // Logic for Date Tracking
   const parentTimestamp = parentDateVal instanceof Date ? parentDateVal.toISOString() : String(parentDateVal);

   // 1. Create the NEW Request (Child)
   const childRequestPayload = {
       ...modifiedRequestData,
       relatedRequestId: originalRequestId,
       requestType: 'MODIFICACION',
       changeReason: changeReason,
       status: 'PENDIENTE_ANALISIS_CAMBIO', // Initial status for modifications
       hasChangeFlag: true,
       // Inject calculated backend flags
       parentWasReserved: parentWasReserved,
       parentTimestamp: parentTimestamp
   };

   // Call createNewRequest internal logic to insert the new row
   const childRequestId = createNewRequest(childRequestPayload, emailHtml);

   // 2. DO NOT INVALIDATE PARENT YET (As per business rule)
   // sheet.getRange(rowNumber, statusIdx + 1).setValue('ANULADO'); // REMOVED
   
   // Append note to observations of parent so admins know there is a pending change
   const currentObs = sheet.getRange(rowNumber, obsIdx + 1).getValue();
   const newObs = (currentObs ? currentObs + "\n" : "") + `[SISTEMA]: Se ha solicitado cambio con ID ${childRequestId}. Esta solicitud permanecerá activa hasta que el cambio sea aprobado.`;
   sheet.getRange(rowNumber, obsIdx + 1).setValue(newObs);

   return childRequestId;
}

/**
 * Lógica compartida de decisión sobre una solicitud de cambio.
 * Llamada tanto por el flujo de correo (processStudyDecision) como por
 * el endpoint de la app (processChangeDecision).
 *
 * @param {string} childRequestId ID de la solicitud de cambio (hija)
 * @param {string} decision 'study' | 'reject'
 * @param {string} [reason] Motivo (requerido para 'reject' desde la app)
 * @returns {{childId:string, req:Object}} Info de la hija procesada
 */
function _applyChangeDecision_(childRequestId, decision, reason) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
  const idIdx = H("ID RESPUESTA");
  const statusIdx = H("STATUS");
  const obsIdx = H("OBSERVACIONES");
  const requesterEmailIdx = H("CORREO ENCUESTADO");

  const lastRow = sheet.getLastRow();
  const ids = sheet.getRange(2, idIdx + 1, lastRow - 1, 1).getValues().flat();
  const rowIndex = ids.map(String).indexOf(String(childRequestId));
  if (rowIndex === -1) throw new Error("Solicitud no encontrada");
  const rowNumber = rowIndex + 2;

  const rowData = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  const req = mapRowToRequest(rowData);
  const requesterEmail = req.requesterEmail || sheet.getRange(rowNumber, requesterEmailIdx + 1).getValue();

  // Guardado: solo aplicar si la hija está en PENDIENTE_ANALISIS_CAMBIO
  if (req.status !== 'PENDIENTE_ANALISIS_CAMBIO') {
    throw new Error("Esta solicitud ya no está pendiente de decisión (estado: " + req.status + ")");
  }

  const ccList = getCCList(req);
  const baseSubject = getStandardSubject(req);

  if (decision === 'study') {
    sheet.getRange(rowNumber, statusIdx + 1).setValue('PENDIENTE_OPCIONES');
    SpreadsheetApp.flush();
    sendEmailRich(
      requesterEmail,
      baseSubject + " [CAMBIO EN ESTUDIO]",
      HtmlTemplates.modificationResult(req, 'study'),
      ccList
    );
  } else if (decision === 'reject') {
    sheet.getRange(rowNumber, statusIdx + 1).setValue('DENEGADO');
    // Guardar el motivo en observaciones (si viene)
    if (reason) {
      const currentObs = sheet.getRange(rowNumber, obsIdx + 1).getValue();
      const note = `[CAMBIO DENEGADO]: ${reason}`;
      sheet.getRange(rowNumber, obsIdx + 1).setValue((currentObs ? currentObs + "\n" : "") + note);
    }
    SpreadsheetApp.flush();
    // Inyecta el motivo temporalmente para el template
    const reqForEmail = Object.assign({}, req, { denialReason: reason || '' });
    sendEmailRich(
      requesterEmail,
      baseSubject + " [CAMBIO RECHAZADO]",
      HtmlTemplates.modificationResult(reqForEmail, 'reject'),
      ccList
    );
  } else {
    throw new Error("Decisión inválida: " + decision);
  }

  return { childId: childRequestId, req: req };
}

function processStudyDecision(e) {
  const id = e.parameter.id;
  const decision = e.parameter.decision; // 'study' or 'reject'
  const confirm = e.parameter.confirm;

  const decisionLabel = decision === 'study' ? 'PASAR A ESTUDIO' : 'RECHAZAR CAMBIO';
  const decisionColor = decision === 'study' ? '#059669' : '#D71920';

  if (confirm !== 'true') {
      const url = `${WEB_APP_URL}?action=study_decision&id=${id}&decision=${decision}&confirm=true`;
      return renderConfirmationPage(
          `Confirmar Decisión`,
          `¿Está seguro de <strong>${decisionLabel}</strong> para la solicitud <strong>${id}</strong>?`,
          `SÍ, ${decisionLabel}`,
          url,
          decisionColor
      );
  }

  const lock = LockService.getScriptLock();
  if (lock.tryLock(LOCK_WAIT_MS)) {
     try {
        _applyChangeDecision_(id, decision, null);
        return renderMessagePage("Acción Completada", decision === 'study' ? 'Solicitud pasada a estudio (pend. opciones).' : 'Solicitud de cambio rechazada.', decisionColor);
     } catch(err) {
        return renderMessagePage("Error", escapeHtml_(err.toString()), '#D71920');
     } finally {
       lock.releaseLock();
     }
  } else {
      return renderMessagePage("Sistema Ocupado", "El sistema está ocupado. Intente nuevamente.", '#D71920');
  }
}

/**
 * Endpoint usado por el dashboard del admin para gestionar solicitudes de
 * cambio sin tener que buscar el correo original.
 *
 * Acciones soportadas:
 *   - 'study': pasa la hija a PENDIENTE_OPCIONES (igual que el correo)
 *   - 'deny': deniega la hija (requiere motivo). Luego decide qué hacer con
 *     la solicitud original según `parentAction`:
 *       - 'keep': la original queda activa y sus recordatorios se reanudan
 *       - 'anulate': la original se anula (reusa anularSolicitud)
 *       - 'consult': marca la original con USER_CONSULT_MARKER en observaciones
 *                    y envía un correo al solicitante con botones CONTINUAR/ANULAR.
 *                    Los recordatorios de la padre quedan pausados mientras el
 *                    marcador esté presente, y sólo se limpia cuando el usuario
 *                    responde (o el admin lo hace manualmente).
 *
 * @param {Object} payload { childRequestId, decision, reason?, parentAction? }
 */
function processChangeDecision(payload) {
  if (!payload || !payload.childRequestId || !payload.decision) {
    throw new Error("Payload inválido: falta childRequestId o decision");
  }
  const childRequestId = String(payload.childRequestId);
  const decision = payload.decision; // 'study' | 'deny'
  const reason = payload.reason || '';
  const parentAction = payload.parentAction || 'keep'; // solo aplica en 'deny'

  if (decision === 'study') {
    _applyChangeDecision_(childRequestId, 'study', null);
    return { childId: childRequestId, action: 'study' };
  }

  if (decision === 'deny') {
    if (!reason || !reason.trim()) {
      throw new Error("Debe indicar un motivo para denegar la solicitud de cambio.");
    }
    const result = _applyChangeDecision_(childRequestId, 'reject', reason.trim());
    const parentId = result.req && result.req.relatedRequestId;

    if (parentId && parentAction === 'anulate') {
      try {
        const parentReason = `Anulada a raíz de la denegación del cambio ${childRequestId}. ${reason.trim()}`;
        anularSolicitud(parentId, parentReason);
      } catch (err) {
        console.error("Error anulando solicitud padre: " + err);
        throw new Error("Cambio denegado, pero falló la anulación de la solicitud original: " + err);
      }
    } else if (parentId && parentAction === 'consult') {
      try {
        _startUserConsultOnParent_(parentId, childRequestId, reason.trim());
      } catch (err) {
        console.error("Error iniciando consulta al usuario sobre la solicitud padre: " + err);
        throw new Error("Cambio denegado, pero falló la consulta al usuario sobre la solicitud original: " + err);
      }
    }
    // 'keep' no requiere acción extra sobre la padre

    return { childId: childRequestId, action: 'deny', parentAction: parentAction, parentId: parentId || null };
  }

  throw new Error("Decisión desconocida: " + decision);
}

/**
 * Inicia una consulta al usuario sobre la solicitud padre: marca la fila
 * con USER_CONSULT_MARKER en OBSERVACIONES y envía un correo threaded
 * (mismo asunto) al solicitante con botones CONTINUAR / ANULAR.
 *
 * Idempotente: si el marcador ya existe, no lo duplica y tampoco reenvía
 * el correo (para evitar spam si se llama por error).
 *
 * @param {string} parentRequestId ID de la solicitud padre
 * @param {string} childRequestId ID del cambio denegado que motivó la consulta
 * @param {string} denialReason Motivo de la denegación (va en el correo)
 */
function _startUserConsultOnParent_(parentRequestId, childRequestId, denialReason) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
  if (!sheet) throw new Error("Hoja de solicitudes no encontrada");

  const idIdx = H("ID RESPUESTA");
  const obsIdx = H("OBSERVACIONES");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error("Hoja vacía");

  const ids = sheet.getRange(2, idIdx + 1, lastRow - 1, 1).getValues().flat();
  const rowIndex = ids.map(String).indexOf(String(parentRequestId));
  if (rowIndex === -1) throw new Error("Solicitud padre " + parentRequestId + " no encontrada");
  const rowNumber = rowIndex + 2;

  const currentObs = String(sheet.getRange(rowNumber, obsIdx + 1).getValue() || '');
  if (currentObs.indexOf(USER_CONSULT_MARKER) !== -1) {
    console.log("Consulta al usuario ya estaba activa sobre " + parentRequestId + ". No se reenvía correo.");
    return;
  }

  // Append marcador + nota legible
  const note = `[CONSULTA AL USUARIO]: El cambio ${childRequestId} fue denegado ("${denialReason}"). Se consultó al solicitante si desea continuar o anular. ${USER_CONSULT_MARKER}`;
  sheet.getRange(rowNumber, obsIdx + 1).setValue((currentObs ? currentObs + "\n" : "") + note);
  SpreadsheetApp.flush();

  // Mapear la fila completa para construir el correo
  const rowData = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  const parentReq = mapRowToRequest(rowData);
  sendUserConsultEmail_(parentReq, childRequestId, denialReason);
}

/**
 * Envía al solicitante el correo de consulta (threaded con el hilo original
 * gracias a `getStandardSubject`). Incluye dos botones con links al web
 * app: CONTINUAR (reanuda la solicitud) y ANULAR (la cancela).
 */
function sendUserConsultEmail_(parentReq, childRequestId, denialReason) {
  const subject = getStandardSubject(parentReq); // Mismo asunto = mismo hilo
  const continueLink = `${WEB_APP_URL}?action=user_consult&id=${encodeURIComponent(parentReq.requestId)}&decision=continue`;
  const cancelLink = `${WEB_APP_URL}?action=user_consult&id=${encodeURIComponent(parentReq.requestId)}&decision=anulate`;
  const isHotelOnly = parentReq.requestMode === 'HOTEL_ONLY';

  const content = `
    <div style="background-color:#fffbeb; border:1px solid #fde68a; color:#92400e; padding:14px 16px; border-radius:6px; font-size:13px; margin-bottom:18px; line-height:1.55;">
      <strong style="display:block; font-size:14px; margin-bottom:4px;">Su solicitud de cambio ${escapeHtml_(childRequestId)} no fue aprobada</strong>
      El área de viajes no pudo proceder con el cambio solicitado.
    </div>
    <p style="color:#111827; font-size:14px; margin-bottom:10px;">
      <strong>Motivo indicado:</strong>
    </p>
    <div style="background-color:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:10px 12px; border-radius:6px; font-size:13px; font-style:italic; margin-bottom:20px;">
      "${escapeHtml_(denialReason)}"
    </div>
    <p style="color:#111827; font-size:14px; margin-bottom:8px;">
      Su solicitud original <strong>${escapeHtml_(parentReq.requestId)}</strong> sigue activa. Necesitamos que nos indique cómo continuar:
    </p>
    <div style="background-color:#f3f4f6; border:1px solid #e5e7eb; padding:14px 16px; border-radius:6px; font-size:13px; color:#374151; margin-bottom:22px;">
      <p style="margin:0 0 6px 0;"><strong>✅ Continuar</strong> — si todavía necesita ${isHotelOnly ? 'el hospedaje' : 'el viaje'} tal como lo pidió originalmente. El proceso se reanudará y recibirá los recordatorios habituales.</p>
      <p style="margin:0;"><strong>🚫 Anular</strong> — si ya no necesita ${isHotelOnly ? 'el hospedaje' : 'el viaje'}. La solicitud original quedará cancelada.</p>
    </div>
    <div style="text-align:center; margin:24px 0 10px;">
      <a href="${continueLink}" style="background-color:#059669; color:white; padding:12px 24px; text-decoration:none; border-radius:6px; font-weight:bold; font-size:14px; display:inline-block; margin-right:10px;">CONTINUAR CON LA SOLICITUD</a>
      <a href="${cancelLink}" style="background-color:#dc2626; color:white; padding:12px 24px; text-decoration:none; border-radius:6px; font-weight:bold; font-size:14px; display:inline-block; margin-top:10px;">ANULAR SOLICITUD</a>
    </div>
    <p style="font-size:11px; color:#9ca3af; text-align:center; margin-top:16px;">Si no responde, el área de viajes le enviará un recordatorio más adelante.</p>
    <hr style="border:0; border-top:1px solid #e5e7eb; margin:28px 0;">
    ${HtmlTemplates._getFullSummary(parentReq)}
  `;

  const html = HtmlTemplates.layout(parentReq.requestId, content, '#f59e0b', '¿DESEA CONTINUAR O ANULAR?');

  try {
    MailApp.sendEmail({
      to: parentReq.requesterEmail,
      subject: subject,
      htmlBody: html
    });
  } catch (e) {
    console.error("Error enviando correo de consulta al usuario para " + parentReq.requestId + ": " + e);
    throw e;
  }
}

/**
 * Handler GET para action=user_consult. El usuario llega aquí desde los
 * botones del correo de consulta. Acepta decision=continue | anulate.
 *
 *   - continue: limpia el marcador de la solicitud padre; los recordatorios
 *     se reanudan automáticamente en el próximo tick.
 *   - anulate: llama a anularSolicitud() sobre la padre (que ya envía el
 *     correo de anulación al usuario). El marcador queda en observaciones
 *     junto con la nota de anulación — no hace falta limpiarlo porque el
 *     estado ANULADO ya excluye a la solicitud de todos los recordatorios.
 */
function processUserConsultResponse(e) {
  const id = e.parameter.id;
  const decision = e.parameter.decision; // 'continue' | 'anulate'
  const confirm = e.parameter.confirm;

  if (!id || !decision) {
    return renderMessagePage("Error", "Parámetros inválidos.", '#D71920');
  }

  const decisionLabel = decision === 'continue' ? 'CONTINUAR CON LA SOLICITUD' : 'ANULAR LA SOLICITUD';
  const decisionColor = decision === 'continue' ? '#059669' : '#dc2626';

  if (confirm !== 'true') {
    const url = `${WEB_APP_URL}?action=user_consult&id=${encodeURIComponent(id)}&decision=${encodeURIComponent(decision)}&confirm=true`;
    return renderConfirmationPage(
      `Confirmar Decisión`,
      `¿Está seguro de <strong>${decisionLabel}</strong> para la solicitud <strong>${escapeHtml_(id)}</strong>?`,
      `SÍ, ${decisionLabel}`,
      url,
      decisionColor
    );
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return renderMessagePage("Sistema Ocupado", "El sistema está ocupado. Intente nuevamente.", '#D71920');
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
    const idIdx = H("ID RESPUESTA");
    const obsIdx = H("OBSERVACIONES");
    const statusIdx = H("STATUS");

    const lastRow = sheet.getLastRow();
    const ids = sheet.getRange(2, idIdx + 1, lastRow - 1, 1).getValues().flat();
    const rowIndex = ids.map(String).indexOf(String(id));
    if (rowIndex === -1) {
      return renderMessagePage("No encontrada", "La solicitud no existe.", '#D71920');
    }
    const rowNumber = rowIndex + 2;

    const currentObs = String(sheet.getRange(rowNumber, obsIdx + 1).getValue() || '');
    if (currentObs.indexOf(USER_CONSULT_MARKER) === -1) {
      return renderMessagePage(
        "Ya procesada",
        "Esta consulta ya fue respondida previamente. Gracias.",
        '#6b7280'
      );
    }

    const currentStatus = String(sheet.getRange(rowNumber, statusIdx + 1).getValue() || '');
    if (currentStatus === 'ANULADO' || currentStatus === 'PROCESADO') {
      return renderMessagePage(
        "Ya procesada",
        "Esta solicitud ya no está activa (estado: " + escapeHtml_(currentStatus) + ").",
        '#6b7280'
      );
    }

    if (decision === 'continue') {
      // Limpiar marcador y agregar nota de continuación
      const cleaned = currentObs.replace(USER_CONSULT_MARKER, '').replace(/\s+$/g, '');
      const note = `[CONTINUAR]: El solicitante confirmó que desea continuar con esta solicitud tras la consulta del área de viajes.`;
      sheet.getRange(rowNumber, obsIdx + 1).setValue(cleaned + "\n" + note);
      SpreadsheetApp.flush();

      // Notificar al admin del equipo que el usuario desea continuar
      try {
        const rowData = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
        const req = mapRowToRequest(rowData);
        const adminSubject = getStandardSubject(req) + " [CONTINÚA TRAS CONSULTA]";
        const adminBody = HtmlTemplates.layout(
          req.requestId,
          `<p style="font-size:14px;">El solicitante <strong>${escapeHtml_(req.requesterEmail)}</strong> confirmó que <strong>desea continuar</strong> con la solicitud tras la consulta enviada desde el área de viajes. El proceso se reanuda con normalidad.</p>${HtmlTemplates._getFullSummary(req)}`,
          '#059669',
          'EL USUARIO DESEA CONTINUAR'
        );
        sendEmailRich(ADMIN_EMAIL, adminSubject, adminBody, null);
      } catch (err) {
        console.error("Error notificando al admin tras continue: " + err);
      }

      return renderMessagePage(
        "Gracias",
        "Su solicitud continuará su proceso normal. Recibirá las notificaciones correspondientes.",
        '#059669'
      );
    }

    if (decision === 'anulate') {
      // Usa anularSolicitud que ya envía el correo al usuario
      anularSolicitud(id, "Anulada por decisión del solicitante tras consulta del área de viajes.");
      return renderMessagePage(
        "Solicitud Anulada",
        "Su solicitud ha sido anulada. Gracias por confirmar.",
        '#dc2626'
      );
    }

    return renderMessagePage("Error", "Decisión desconocida.", '#D71920');
  } catch (err) {
    console.error("Error en processUserConsultResponse: " + err);
    return renderMessagePage("Error", escapeHtml_(String(err)), '#D71920');
  } finally {
    lock.releaseLock();
  }
}

// --- CORE FUNCTIONS ---

function processOptionSelection(e) {
    // This function is now mostly for fallback or if someone clicks a legacy link.
    // In the new flow, the selection is done via Text Description inside the App.
    // However, if we wanted to support buttons, we could.
    // But the requirement says "No seleccionar de un botón... escribir su selección".
    // So we just direct them to the app.
    return renderConfirmationPage(
        `Ir a la Plataforma`,
        `Para seleccionar su opción, por favor ingrese a la aplicación y describa su elección.`,
        `INGRESAR AHORA`,
        PLATFORM_URL,
        '#111827'
    );
}

function processApprovalFromEmail(e) {
  const id = e.parameter.id;
  const decision = e.parameter.decision; // 'approved' or 'denied'
  const role = e.parameter.role || 'NORMAL'; // 'NORMAL', 'CEO', 'CDS'
  const confirm = e.parameter.confirm;
  const actor = e.parameter.actor; // NEW: Specific email of the person acting

  const decisionLabel = decision === 'approved' ? 'APROBAR' : 'DENEGAR';
  const decisionColor = decision === 'approved' ? '#059669' : '#D71920';

  if (confirm !== 'true') {
      if (decision === 'denied') {
          return renderDenialReasonPage(id, role, actor, decisionColor);
      }
      const url = `${WEB_APP_URL}?action=approve&id=${id}&decision=${decision}&role=${role}&confirm=true&actor=${encodeURIComponent(actor || '')}`;
      return renderConfirmationPage(
          `Confirmar Decisión`,
          `¿Está seguro de <strong>${decisionLabel}</strong> la solicitud <strong>${id}</strong>?`,
          `SÍ, ${decisionLabel}`,
          url,
          decisionColor
      );
  }

  const lock = LockService.getScriptLock();
  if (lock.tryLock(LOCK_WAIT_MS)) { 
      try {
          const ss = SpreadsheetApp.getActiveSpreadsheet();
          const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
          const lastRow = sheet.getLastRow();
          const idIdx = H("ID RESPUESTA");
          const statusIdx = H("STATUS");
          const internationalIdx = H("ES INTERNACIONAL");
          
          const ids = sheet.getRange(2, idIdx + 1, lastRow - 1, 1).getValues().flat();
          const rowIndex = ids.map(String).indexOf(String(id));

          if (rowIndex === -1) throw new Error(`Solicitud ${id} no encontrada.`);
          const rowNumber = rowIndex + 2;

          const currentStatus = sheet.getRange(rowNumber, statusIdx + 1).getValue();
          const isInternational = sheet.getRange(rowNumber, internationalIdx + 1).getValue() === "SI";
          const costIdx = H("COSTO COTIZADO PARA VIAJE");
          const totalCost = Number(sheet.getRange(rowNumber, costIdx + 1).getValue()) || 0;

          // Determine if High Cost Logic applies (National > 1.2M)
          // If it's International, it already requires CEO/CDS.
          // If it's National but > 1.2M, it ALSO requires CEO/CDS.
          const requiresExecutiveApproval = isInternational || totalCost > 1200000;

          // If already fully processed, stop status update but allow logging if it's a late approval
          const isAdvancedStatus = ['APROBADO', 'RESERVADO', 'PROCESADO', 'ANULADO', 'DENEGADO'].includes(currentStatus);

          // 0. PREPARE LOGGING DATA (TRACEABILITY)
          const now = new Date();
          const timestamp = `${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()} ${now.getHours()}:${now.getMinutes()}`;
          const isApproved = decision === 'approved';
          const decisionPrefix = isApproved ? "Sí" : "No";
          
          let approverEmail = "";
          if (role === 'CEO') approverEmail = CEO_EMAIL;
          else if (role === 'CDS') approverEmail = DIRECTOR_EMAIL;
          else {
              // Use expected approver from sheet; only use actor if it matches to prevent impersonation
              const expectedApprover = String(sheet.getRange(rowNumber, H("CORREO DE QUIEN APRUEBA (AUTOMÁTICO)") + 1).getValue()).toLowerCase().trim();
              if (actor && String(actor).toLowerCase().trim() === expectedApprover) {
                approverEmail = actor;
              } else {
                approverEmail = expectedApprover || actor || 'desconocido';
              }
          }
          
          // Log format: Decision_Email_Timestamp (or just Decision_Email for Area since Time is separate)
          const logStringFull = `${decisionPrefix}_${approverEmail}_${timestamp}`;
          const logStringArea = `${decisionPrefix}_${approverEmail}`;

          // 1. LOG TO SPECIFIC COLUMNS (WITH OVERWRITE PROTECTION)
          let alreadyDecided = false;
          let previousDecisionDate = "";

          if (role === 'CEO') {
              const currentVal = sheet.getRange(rowNumber, H("APROBADO CEO") + 1).getValue();
              if (currentVal && String(currentVal).trim() !== "") {
                  alreadyDecided = true;
                  // Extract date from "Sí_email_date time"
                  const parts = String(currentVal).split('_');
                  if (parts.length >= 3) previousDecisionDate = parts[2];
              } else {
                  sheet.getRange(rowNumber, H("APROBADO CEO") + 1).setValue(logStringFull);
              }
          } else if (role === 'CDS') {
              const currentVal = sheet.getRange(rowNumber, H("APROBADO CDS") + 1).getValue();
              if (currentVal && String(currentVal).trim() !== "") {
                  alreadyDecided = true;
                  const parts = String(currentVal).split('_');
                  if (parts.length >= 3) previousDecisionDate = parts[2];
              } else {
                  sheet.getRange(rowNumber, H("APROBADO CDS") + 1).setValue(logStringFull);
              }
          } else {
              // Normal Approver
              const currentVal = sheet.getRange(rowNumber, H("APROBADO POR ÁREA? (AUTOMÁTICO)") + 1).getValue();
              
              // Check if THIS specific actor already approved (or if anyone approved and we want to block)
              // Requirement: "si alguno de los dos aprueba, pues ya el proceso avanza"
              // If A approves, currentVal = "Sí_A". If B clicks, currentVal is "Sí_A".
              // We should treat this as "already decided" for the REQUEST, not necessarily for the PERSON.
              // But for traceability, if B clicks, we might want to know.
              // However, the logic below "if (alreadyDecided) return..." stops the flow.
              // So if A approved, B gets "Decision Previa Detectada". This is consistent with "First one wins".
              
              if (currentVal && String(currentVal).trim() !== "") {
                  alreadyDecided = true;
                  previousDecisionDate = sheet.getRange(rowNumber, H("FECHA/HORA (AUTOMÁTICO)") + 1).getValue();
              } else {
                  sheet.getRange(rowNumber, H("APROBADO POR ÁREA? (AUTOMÁTICO)") + 1).setValue(logStringArea);
                  sheet.getRange(rowNumber, H("FECHA/HORA (AUTOMÁTICO)") + 1).setValue(timestamp);
                  sheet.getRange(rowNumber, H("APROBADO POR ÁREA?") + 1).setValue(decisionPrefix);
              }
          }
          
          if (alreadyDecided) {
               return renderMessagePage(
                  'Decisión Previa Detectada',
                  `Usted ya había registrado una decisión para esta solicitud anteriormente (Fecha: ${escapeHtml_(previousDecisionDate) || 'Desconocida'}).<br/>No se han realizado cambios.`,
                  '#374151'
              );
          }

          // METRICS: registrar evento de aprobación (solo si es approval, no denial)
          if (isApproved) {
              _recordEvent_(id, 'approval', { role: role, email: approverEmail });
          }

          SpreadsheetApp.flush(); // Ensure log is written before potential denial return

          // CHECK IF ALREADY ADVANCED - IF SO, STOP HERE
          if (isAdvancedStatus) {
              return renderMessagePage(
                  'Decisión Registrada', 
                  `Su decisión ha sido registrada en el sistema.<br/><br/><strong>Nota:</strong> Esta solicitud ya había avanzado previamente y se encuentra en estado: <span style="color:blue">${escapeHtml_(currentStatus)}</span>. El flujo no se ha modificado.`,
                  '#374151'
              );
          }

          // 2. REJECTION: Any rejection kills the request instantly (ONLY IF NOT ADVANCED)
          if (!isApproved) {
              // Save denial reason to observations if provided
              const denialReason = e.parameter.reason ? decodeURIComponent(e.parameter.reason) : '';
              if (denialReason) {
                  const obsIdx = H("OBSERVACIONES");
                  const currentObs = sheet.getRange(rowNumber, obsIdx + 1).getValue();
                  const denialNote = `[DENEGACIÓN - ${approverEmail}]: ${denialReason}`;
                  sheet.getRange(rowNumber, obsIdx + 1).setValue((currentObs ? currentObs + "\n" : "") + denialNote);
              }

              updateRequestStatus(id, 'DENEGADO', { denialReason: denialReason }); // Update global status

              return renderMessagePage(
                  'Decisión Registrada',
                  `Ha <strong>DENEGADO</strong> la solicitud. El proceso se ha detenido.${denialReason ? '<br/><br/><strong>Motivo:</strong> ' + escapeHtml_(denialReason) : ''}`,
                  '#D71920'
              );
          }

          // 3. APPROVAL: CHECK COMPLETION
          // We need to re-read or track state variables
          // Re-read current row data to check other columns
          const rowValues = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];

          // Check CEO & CDS columns
          const cdsVal = rowValues[H("APROBADO CDS")];
          const ceoVal = rowValues[H("APROBADO CEO")];
          // For area, we check the (AUTOMÁTICO) column we just wrote to or legacy
          const areaVal = rowValues[H("APROBADO POR ÁREA? (AUTOMÁTICO)")];

          const cdsApproved = String(cdsVal).startsWith("Sí");
          const ceoApproved = String(ceoVal).startsWith("Sí");
          const areaApproved = String(areaVal).startsWith("Sí");

          // Detect special cases: requester is CEO/CDS, or the assigned area approver
          // happens to be CEO/CDS (so a single click on the deduped email implicitly
          // covers both the area and the executive role).
          const requesterEmailRaw = rowValues[H("CORREO ENCUESTADO")];
          const requesterLowerHere = String(requesterEmailRaw || '').toLowerCase().trim();
          const ceoLowerHere = String(CEO_EMAIL).toLowerCase().trim();
          const cdsLowerHere = String(DIRECTOR_EMAIL).toLowerCase().trim();
          const requesterIsCeo = requesterLowerHere === ceoLowerHere;
          const requesterIsCds = requesterLowerHere === cdsLowerHere;

          const assignedAreaApproversRaw = rowValues[H("CORREO DE QUIEN APRUEBA (AUTOMÁTICO)")];
          const assignedAreaApprovers = String(assignedAreaApproversRaw || '').toLowerCase()
              .split(',').map(function(e) { return e.trim(); }).filter(function(e) { return e; });
          const ceoIsAreaApprover = assignedAreaApprovers.indexOf(ceoLowerHere) !== -1;
          const cdsIsAreaApprover = assignedAreaApprovers.indexOf(cdsLowerHere) !== -1;

          let isFullyApproved = false;

          if (requesterIsCeo) {
              // CEO requested → his single approval (sent with role CEO) is enough
              if (ceoApproved) isFullyApproved = true;
              // LEGACY FALLBACK: in-flight requests created BEFORE the dedup change may
              // have area + CDS marked already (because the old flow sent the CEO three
              // separate emails). Honor that combination so they don't stall after deploy.
              // Cannot trigger for new requests because the new flow only sends 1 email
              // to CEO with role CEO, so the area and CDS columns stay empty.
              else if (areaApproved && cdsApproved) isFullyApproved = true;
          } else if (requesterIsCds) {
              // CDS requested → his single approval (sent with role CDS) is enough
              if (cdsApproved) isFullyApproved = true;
              // LEGACY FALLBACK: same reasoning as the CEO branch above.
              else if (areaApproved && ceoApproved) isFullyApproved = true;
          } else if (requiresExecutiveApproval) {
              // Standard executive flow: area + (CEO or CDS).
              // If the assigned area approver IS the CEO/CDS, the deduped email
              // was sent only with executive role (CEO or CDS), so the area column
              // never gets marked. Treat the executive approval as implicitly
              // satisfying the area requirement in that case.
              const effectiveAreaApproved = areaApproved
                  || (ceoIsAreaApprover && ceoApproved)
                  || (cdsIsAreaApprover && cdsApproved);
              if (effectiveAreaApproved && (cdsApproved || ceoApproved)) {
                  isFullyApproved = true;
              }
          } else {
              // National + low cost: just the area approver
              if (areaApproved) {
                  isFullyApproved = true;
              }
          }

          if (isFullyApproved) {
              // METRICS: registrar evento de "todas las aprobaciones completas"
              _recordEvent_(id, 'fullyApproved');
              // This triggers the final status update, which also calculates Q TKT etc.
              updateRequestStatus(id, 'APROBADO', {});
              return renderMessagePage(
                  'Aprobación Completa',
                  `Su aprobación ha sido registrada. La solicitud ha completado todo el flujo de aprobaciones.`,
                  '#059669'
              );
          } else {
              return renderMessagePage(
                  'Aprobación Parcial', 
                  `Su aprobación ha sido registrada (${role}). La solicitud espera por el resto de aprobadores para finalizar.`,
                  '#059669'
              );
          }

      } catch (e) {
          return renderMessagePage('Error', 'Error al procesar: ' + escapeHtml_(e.toString()), '#D71920');
      } finally {
          lock.releaseLock();
      }
  }
  return renderMessagePage("Sistema Ocupado", "Intente nuevamente.", '#D71920');
}

// --- NEW RESERVATION FUNCTION ---

function registerReservation(requestId, reservationNumber, files, creditCard, purchaseDate) {
    // Backward compatibility: if old clients still pass (fileData, fileName, creditCard) positionally,
    // wrap into a single-element files array.
    if (typeof files === 'string') {
        // Legacy signature: registerReservation(requestId, reservationNumber, fileDataString, fileName, creditCard)
        // The 3rd arg is fileData, the 4th is fileName, the 5th (passed via arguments) is creditCard.
        var legacyFileData = files;
        var legacyFileName = creditCard; // shifted
        var legacyCreditCard = arguments[4];
        files = [{ fileData: legacyFileData, fileName: legacyFileName }];
        creditCard = legacyCreditCard;
    }

    if (!Array.isArray(files) || files.length === 0) {
        throw new Error('Debe adjuntar al menos un archivo de confirmación.');
    }
    if (files.length > 10) {
        throw new Error('Máximo 10 archivos por reserva.');
    }
    files.forEach(function(f) {
        if (!f || !f.fileData || !f.fileName) throw new Error('Archivo inválido en la lista.');
        validateFileUpload_(f.fileData, f.fileName, 'application/pdf');
    });
    if (reservationNumber && String(reservationNumber).length > 100) throw new Error('Número de reserva demasiado largo.');

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);

    // Find Row
    const idIdx = H("ID RESPUESTA");
    const resNoIdx = H("No RESERVA");
    const statusIdx = H("STATUS");
    const creditCardIdx = H("TARJETA DE CREDITO CON LA QUE SE HIZO LA COMPRA");
    const departureDateIdx = H("FECHA IDA");
    const parentIdIdx = H("ID SOLICITUD PADRE");

    const ids = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat();
    const rowIndex = ids.map(String).indexOf(String(requestId));
    if (rowIndex === -1) throw new Error("Solicitud no encontrada");
    const rowNumber = rowIndex + 2;

    // Check if this is a modification (has parent) — solo para etiquetar el nombre,
    // ya NO se anida la carpeta dentro del padre. Toda solicitud (original o
    // modificación) vive al nivel raíz para que el analista navegue Drive plano.
    const parentId = String(sheet.getRange(rowNumber, parentIdIdx + 1).getValue()).trim();
    const isModification = parentId && parentId !== '' && parentId !== 'undefined';

    // 1. Handle File Upload — toda carpeta vive en root, sea original o modificación
    const root = DriveApp.getFolderById(ROOT_DRIVE_FOLDER_ID);
    let folder;
    const allFolders = root.getFolders();
    while (allFolders.hasNext()) {
        const f = allFolders.next();
        if (f.getName().indexOf(requestId) === 0) {
            folder = f;
            break;
        }
    }
    if (!folder) {
        folder = root.createFolder(requestId);
    }

    // Upload all reservation files into the folder
    const uploadedFiles = files.map(function(f, idx) {
        var safeName = String(f.fileName).replace(/[\/\\:*?"<>|]/g, '_').substring(0, 200);
        var lower = safeName.toLowerCase();
        var mime = lower.endsWith('.pdf') ? MimeType.PDF
                 : (lower.endsWith('.png') ? MimeType.PNG
                 : (lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? MimeType.JPEG
                 : MimeType.PDF));
        var blob = Utilities.newBlob(Utilities.base64Decode(f.fileData), mime, safeName);
        // Name files with the PNR + index for traceability
        var label = files.length > 1 ? `Reserva_${reservationNumber}_${idx + 1}_${requestId}` : `Reserva_${reservationNumber}_${requestId}`;
        blob.setName(label);
        var driveFile = folder.createFile(blob);
        driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        return {
            id: driveFile.getId(),
            name: label,
            originalName: safeName,
            url: `https://drive.google.com/file/d/${driveFile.getId()}/view?usp=sharing`,
            mimeType: mime
        };
    });

    // Keep first file as the "primary" reservation reference (for backward-compat with templates)
    const file = { getId: function() { return uploadedFiles[0].id; } };
    const fileUrl = uploadedFiles[0].url;

    // 2. Build descriptive folder name
    const MONTH_NAMES_ES = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

    let tcShort = '';
    if (creditCard) {
        const match = String(creditCard).match(/TC[- ]?(\d+)/i);
        tcShort = match ? `TC ${match[1]}` : String(creditCard).split(' ')[0];
    }

    const depDate = sheet.getRange(rowNumber, departureDateIdx + 1).getValue();
    let monthYear = '';
    if (depDate instanceof Date) {
        monthYear = `${MONTH_NAMES_ES[depDate.getMonth()]} ${String(depDate.getFullYear()).slice(-2)}`;
    } else {
        const d = new Date(depDate);
        if (!isNaN(d.getTime())) {
            monthYear = `${MONTH_NAMES_ES[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
        }
    }

    // Naming: original = "${requestId} - PNR - TC - MES"
    //         modificación = "${requestId} - CAMBIO DE ${parentId} - PNR - TC - MES"
    // Ya NO se anida ni se taggea el padre con [CAMBIADA] — todo plano en root.
    let newFolderName = requestId;
    if (isModification) newFolderName += ` - CAMBIO DE ${parentId}`;
    if (reservationNumber) newFolderName += ` - ${reservationNumber}`;
    if (tcShort) newFolderName += ` - ${tcShort}`;
    if (monthYear) newFolderName += ` - ${monthYear}`;
    folder.setName(newFolderName);

    // 3. Update Sheets
    sheet.getRange(rowNumber, resNoIdx + 1).setValue(reservationNumber);
    sheet.getRange(rowNumber, statusIdx + 1).setValue('RESERVADO');
    if (creditCard && creditCardIdx > -1) {
        sheet.getRange(rowNumber, creditCardIdx + 1).setValue(creditCard);
    }

    // Fecha de compra del tiquete (nueva, viene del frontend; default: hoy)
    var purchaseDateIdx = H("FECHA DE COMPRA DE TIQUETE");
    if (purchaseDateIdx > -1) {
        var dateValue = purchaseDate || Utilities.formatDate(new Date(), "America/Bogota", "dd/MM/yyyy");
        sheet.getRange(rowNumber, purchaseDateIdx + 1).setValue(dateValue);
    }

    // 4. Update JSON Support Data — push ALL uploaded files
    const supportIdx = H("SOPORTES (JSON)");
    const jsonStr = sheet.getRange(rowNumber, supportIdx + 1).getValue();
    let supportData = jsonStr ? JSON.parse(jsonStr) : { folderId: folder.getId(), folderUrl: folder.getUrl(), files: [] };

    var nowIso = new Date().toISOString();
    uploadedFiles.forEach(function(uf, idx) {
        supportData.files.push({
            id: uf.id,
            name: files.length > 1 ? `Reserva ${reservationNumber} (${idx + 1}/${files.length})` : `Reserva ${reservationNumber}`,
            url: uf.url,
            mimeType: uf.mimeType,
            date: nowIso,
            isReservation: true
        });
    });
    sheet.getRange(rowNumber, supportIdx + 1).setValue(JSON.stringify(supportData));

    // 5. Send Email — pass ALL reservation file URLs to the template
    const fullReq = mapRowToRequest(sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0]);
    fullReq.reservationNumber = reservationNumber;
    fullReq.reservationUrl = fileUrl; // primary (first file) for backward-compat
    fullReq.reservationFiles = uploadedFiles.map(function(uf) {
        return { name: uf.originalName, url: uf.url };
    });

    const html = HtmlTemplates.reservationConfirmed(fullReq);
    const subject = getStandardSubject(fullReq);

    try {
        MailApp.sendEmail({
            to: fullReq.requesterEmail,
            cc: getCCList(fullReq),
            subject: subject,
            htmlBody: html
        });
    } catch(e) { console.error("Error sending reservation email: " + e); }

    // METRICS: registrar evento de reserva completada
    _recordEvent_(requestId, 'reservationRegistered');

    return true;
}

/**
 * Get sites (sedes) from MISC sheet column D.
 * Header "SEDES" is in row 2, data starts at row 3.
 */
/**
 * Amend an existing reservation: update PNR, credit card, purchase date,
 * delete specified files from Drive + SOPORTES JSON, upload new files,
 * rename the Drive folder, and send a correction email to the user.
 *
 * @param {Object} payload { requestId, reservationNumber, creditCard,
 *   purchaseDate, fileIdsToDelete: string[], newFiles: [{fileData, fileName}],
 *   correctionNote?: string }
 */
function amendReservation(payload) {
    if (!payload || !payload.requestId) throw new Error('requestId requerido.');
    var requestId = String(payload.requestId);
    var newPnr = String(payload.reservationNumber || '').trim();
    var newCard = String(payload.creditCard || '').trim();
    var newPurchaseDate = payload.purchaseDate || '';
    var fileIdsToDelete = payload.fileIdsToDelete || [];
    var newFilesData = payload.newFiles || [];
    var correctionNote = payload.correctionNote || '';

    if (!newPnr) throw new Error('Número de reserva requerido.');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
    var idIdx = H("ID RESPUESTA");
    var resNoIdx = H("No RESERVA");
    var creditCardIdx = H("TARJETA DE CREDITO CON LA QUE SE HIZO LA COMPRA");
    var purchaseDateIdx = H("FECHA DE COMPRA DE TIQUETE");
    var supportIdx = H("SOPORTES (JSON)");
    var parentIdIdx = H("ID SOLICITUD PADRE");
    var departureDateIdx = H("FECHA IDA");

    var ids = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat();
    var rowIndex = ids.map(String).indexOf(requestId);
    if (rowIndex === -1) throw new Error("Solicitud no encontrada");
    var rowNumber = rowIndex + 2;

    // 1. Update PNR, card, purchase date
    sheet.getRange(rowNumber, resNoIdx + 1).setValue(newPnr);
    if (creditCardIdx > -1) sheet.getRange(rowNumber, creditCardIdx + 1).setValue(newCard);
    if (purchaseDateIdx > -1 && newPurchaseDate) {
        sheet.getRange(rowNumber, purchaseDateIdx + 1).setValue(newPurchaseDate);
    }

    // 2. Load current support data
    var jsonStr = sheet.getRange(rowNumber, supportIdx + 1).getValue();
    var supportData = jsonStr ? JSON.parse(jsonStr) : { folderId: null, folderUrl: null, files: [] };

    // 3. Delete files from Drive + remove from JSON
    var deleteSet = {};
    fileIdsToDelete.forEach(function(id) { deleteSet[id] = true; });

    if (fileIdsToDelete.length > 0) {
        supportData.files = supportData.files.filter(function(f) {
            if (deleteSet[f.id]) {
                try { DriveApp.getFileById(f.id).setTrashed(true); } catch (e) {
                    console.error("Error borrando archivo " + f.id + ": " + e);
                }
                return false; // remove from array
            }
            return true; // keep
        });
    }

    // 3b. Rename surviving reservation files to reflect new PNR
    supportData.files.forEach(function(f) {
        if (f.isReservation) {
            try {
                var driveFile = DriveApp.getFileById(f.id);
                var newLabel = 'Reserva_' + newPnr + '_' + requestId;
                driveFile.setName(newLabel);
                f.name = newLabel; // update JSON too
            } catch (e) {
                console.error("Error renombrando archivo " + f.id + ": " + e);
            }
        }
    });

    // 4. Upload new files
    var root = DriveApp.getFolderById(ROOT_DRIVE_FOLDER_ID);
    var folder;
    if (supportData.folderId) {
        try { folder = DriveApp.getFolderById(supportData.folderId); } catch (e) {}
    }
    if (!folder) {
        var allFolders = root.getFolders();
        while (allFolders.hasNext()) {
            var f = allFolders.next();
            if (f.getName().indexOf(requestId) === 0) { folder = f; break; }
        }
    }
    if (!folder) folder = root.createFolder(requestId);

    var uploadedFiles = [];
    if (newFilesData.length > 0) {
        newFilesData.forEach(function(nf) {
            if (!nf || !nf.fileData || !nf.fileName) return;
            validateFileUpload_(nf.fileData, nf.fileName, 'application/pdf');
            var safeName = String(nf.fileName).replace(/[\/\\:*?"<>|]/g, '_').substring(0, 200);
            var lower = safeName.toLowerCase();
            var mime = lower.endsWith('.pdf') ? MimeType.PDF
                     : (lower.endsWith('.png') ? MimeType.PNG
                     : (lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? MimeType.JPEG
                     : MimeType.PDF));
            var blob = Utilities.newBlob(Utilities.base64Decode(nf.fileData), mime, safeName);
            var label = 'Reserva_' + newPnr + '_' + requestId;
            blob.setName(label);
            var driveFile = folder.createFile(blob);
            driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            var fileEntry = {
                id: driveFile.getId(),
                name: label,
                url: 'https://drive.google.com/file/d/' + driveFile.getId() + '/view?usp=sharing',
                mimeType: mime,
                date: new Date().toISOString(),
                isReservation: true
            };
            supportData.files.push(fileEntry);
            uploadedFiles.push({ name: safeName, url: fileEntry.url });
        });
    }

    // Update support data and folder ID
    supportData.folderId = folder.getId();
    supportData.folderUrl = folder.getUrl();
    sheet.getRange(rowNumber, supportIdx + 1).setValue(JSON.stringify(supportData));

    // 5. Rename folder to reflect new PNR / card
    var MONTH_NAMES_ES = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
    var tcShort = '';
    if (newCard) {
        var match = String(newCard).match(/TC[- ]?(\d+)/i);
        tcShort = match ? 'TC ' + match[1] : String(newCard).split(' ')[0];
    }
    var depDate = sheet.getRange(rowNumber, departureDateIdx + 1).getValue();
    var monthYear = '';
    if (depDate instanceof Date) {
        monthYear = MONTH_NAMES_ES[depDate.getMonth()] + ' ' + String(depDate.getFullYear()).slice(-2);
    }
    var parentId = String(sheet.getRange(rowNumber, parentIdIdx + 1).getValue() || '').trim();
    var isModification = parentId && parentId !== '' && parentId !== 'undefined';

    var newFolderName = requestId;
    if (isModification) newFolderName += ' - CAMBIO DE ' + parentId;
    if (newPnr) newFolderName += ' - ' + newPnr;
    if (tcShort) newFolderName += ' - ' + tcShort;
    if (monthYear) newFolderName += ' - ' + monthYear;
    folder.setName(newFolderName);

    SpreadsheetApp.flush();

    // 6. Send correction email to user
    try {
        var rowData = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
        var req = mapRowToRequest(rowData);
        req.reservationNumber = newPnr;
        var isHotelOnly = req.requestMode === 'HOTEL_ONLY';

        // Build list of remaining reservation files for the email
        var remainingResFiles = supportData.files.filter(function(f) { return f.isReservation; });

        var filesHtml = '';
        if (remainingResFiles.length > 0) {
            var itemsHtml = remainingResFiles.map(function(f, i) {
                return '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff; border:1px solid #dbeafe; border-radius:6px; margin-bottom:8px; border-collapse:separate;"><tr>'
                    + '<td style="padding:12px 14px; font-size:13px; color:#1e3a8a; word-break:break-word;">📄 ' + escapeHtml_(f.name || ('Archivo ' + (i+1))) + '</td>'
                    + '<td width="110" style="padding:12px 14px 12px 6px; text-align:right;"><a href="' + escapeHtml_(f.url) + '" style="background-color:#2563eb; color:#ffffff; padding:8px 16px; text-decoration:none; border-radius:4px; font-size:12px; font-weight:bold; display:inline-block;">Descargar</a></td>'
                    + '</tr></table>';
            }).join('');
            filesHtml = '<div style="background-color:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:15px; margin-bottom:20px;">'
                + '<div style="font-size:11px; color:#6b7280; text-transform:uppercase; font-weight:bold; margin-bottom:10px;">📎 Archivos de Reserva (' + remainingResFiles.length + ')</div>'
                + itemsHtml + '</div>';
        }

        var content = '<p style="color:#111827; font-size:14px; margin-bottom:12px;">El área de viajes ha <strong>corregido la reserva</strong> para su solicitud <strong>' + escapeHtml_(requestId) + '</strong>.</p>';

        content += '<div style="background-color:#eff6ff; border:1px solid #dbeafe; padding:20px; border-radius:8px; text-align:center; margin-bottom:20px;">'
            + '<div style="font-size:12px; color:#60a5fa; margin-bottom:5px; text-transform:uppercase; font-weight:bold;">' + (isHotelOnly ? 'NÚMERO DE CONFIRMACIÓN' : 'NÚMERO DE RESERVA (PNR)') + '</div>'
            + '<div style="font-size:24px; font-weight:bold; color:#1e3a8a; letter-spacing:2px;">' + escapeHtml_(newPnr) + '</div>'
            + '</div>';

        if (correctionNote) {
            content += '<div style="background-color:#fffbeb; border:1px solid #fde68a; color:#92400e; padding:12px 14px; border-radius:6px; font-size:13px; margin-bottom:16px;"><strong>Nota de corrección:</strong> ' + escapeHtml_(correctionNote) + '</div>';
        }

        content += filesHtml;
        content += '<hr style="border:0; border-top:1px solid #e5e7eb; margin:24px 0;">' + HtmlTemplates._getFullSummary(req);

        var html = HtmlTemplates.layout(requestId, content, '#f59e0b', isHotelOnly ? 'CORRECCIÓN DE RESERVA' : 'CORRECCIÓN DE TIQUETE');
        var subject = getStandardSubject(req); // same thread
        sendEmailRich(req.requesterEmail, subject, html, getCCList(req));
    } catch (e) {
        console.error("Error enviando correo de corrección de reserva: " + e);
    }

    return true;
}

function getSites() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('MISC');
    if (!sheet) return [];

    const lastRow = sheet.getLastRow();
    if (lastRow < 3) return [];

    const data = sheet.getRange(3, 4, lastRow - 2, 1).getValues();
    const sites = data
        .map(row => String(row[0] || '').trim())
        .filter(v => v !== '');
    // Sort alphabetically (defensive, in case sheet ordering changes)
    sites.sort((a, b) => a.localeCompare(b, 'es'));
    return sites;
}

/**
 * Get credit card options from MISC sheet (v2.5)
 */
function getCreditCards() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('MISC');
    if (!sheet) return [];
    
    const lastRow = sheet.getLastRow();
    if (lastRow < 3) return []; // Header row is row 2 (TARJETA | EMPRESA), data starts at row 3
    
    const data = sheet.getRange(3, 1, lastRow - 2, 2).getValues();
    return data
        .filter(row => row[0] && String(row[0]).trim() !== '')
        .map(row => ({
            value: String(row[0]).trim(),
            label: `${String(row[0]).trim()} (${String(row[1]).trim()})`
        }));
}

// --- EMAIL HELPERS & TEMPLATES ---

function getStandardSubject(data) {
    const id = data.requestId || data.id;
    const isHotelOnly = data.requestMode === 'HOTEL_ONLY';
    const tipo = isHotelOnly ? 'Solicitud de Hospedaje' : 'Solicitud de Viaje';
    let subject = `${tipo} ${id} - ${data.requesterEmail} - ${data.company} ${data.site}`;
    if (data.isInternational) subject += " [INTERNACIONAL]";
    return subject;
}

function sendEmailRich(to, subject, htmlBody, cc) {
    try {
        const filterEmails = (str) => (str || "").split(',').map(e=>e.trim()).filter(e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).join(',');
        
        const ccAddress = (cc === undefined) ? ADMIN_EMAIL : cc;
        let validTo = filterEmails(to);
        let validCc = filterEmails(ccAddress);
        
        // If TO is empty but CC exists, move CC to TO to prevent MailApp crash
        if (!validTo && validCc) {
            validTo = validCc;
            validCc = '';
        }
        
        if (!validTo) {
            console.error("No valid recipients for email: " + subject);
            return;
        }

        const options = {
            to: validTo,
            subject: subject,
            htmlBody: htmlBody,
            body: "Este correo contiene elementos ricos en HTML. Por favor use un cliente compatible.\n\n" + (htmlBody ? htmlBody.replace(/<[^>]+>/g, ' ') : '')
        };
        
        if (validCc) {
            options.cc = validCc;
        }
        
        MailApp.sendEmail(options);
    } catch(e) {
        console.error("Error sending email to " + to + ": " + e);
    }
}

const HtmlTemplates = {
    // SHARED: Renders the gallery of analyst-uploaded options (flights/hotels)
    // so approvers have visibility of the alternatives the requester chose from.
    _renderOptionsGallery: function(request) {
        const options = (request && request.analystOptions) || [];
        if (!options.length) return '';

        const flightOptions = options.filter(o => o.type === 'FLIGHT');
        const hotelOptions = options.filter(o => o.type === 'HOTEL');

        const renderImages = (opts) => opts.map(opt => {
            const directionTag = opt.direction
                ? `<span style="background-color: ${opt.direction === 'VUELTA' ? '#10B981' : '#FBBF24'}; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 10px; vertical-align: middle;">${escapeHtml_(opt.direction)}</span>`
                : '';
            return `
            <div style="margin-bottom: 15px; border: 1px solid #ddd; padding: 10px; border-radius: 4px;">
                <div style="font-weight:bold; color:#D71920; margin-bottom:5px;">Opción ${escapeHtml_(opt.id)} ${directionTag}</div>
                <img src="${escapeHtml_(opt.url)}" alt="${escapeHtml_(opt.name || '')}" style="max-width: 100%; height: auto; display: block; border-radius: 4px;" />
            </div>`;
        }).join('');

        let html = `
        <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 15px; margin-bottom: 25px;">
            <div style="font-size: 12px; color: #92400e; text-transform: uppercase; font-weight: bold; margin-bottom: 10px;">
                🔎 Opciones disponibles para esta solicitud
            </div>
            <div style="font-size: 12px; color: #4b5563; margin-bottom: 15px;">
                A continuación se muestran todas las opciones que el área de compras puso a disposición del solicitante. Esto le permite verificar que el criterio de selección haya sido razonable (costo, horario, conveniencia).
            </div>
        `;

        if (flightOptions.length > 0) {
            html += `<h4 style="color: #374151; border-bottom: 2px solid #D71920; padding-bottom: 5px; margin-top:10px;">✈️ Opciones de Vuelo (${flightOptions.length})</h4>`;
            html += renderImages(flightOptions);
        }
        if (hotelOptions.length > 0) {
            html += `<h4 style="color: #374151; border-bottom: 2px solid #1e40af; padding-bottom: 5px; margin-top:20px;">🏨 Opciones de Hotel (${hotelOptions.length})</h4>`;
            html += renderImages(hotelOptions);
        }

        html += `</div>`;
        return html;
    },

    // USER PIN DELIVERY: sends the plain PIN to the user with clear instructions.
    userPinDelivery: function(email, pin, isFirstTime) {
        var platformUrl = (function() {
            try { return PropertiesService.getScriptProperties().getProperty('PLATFORM_URL') || ''; }
            catch(e) { return ''; }
        })();
        var statusMessage = isFirstTime
            ? 'Este es tu <strong>PIN inicial</strong> para acceder al portal. Guárdalo en un lugar seguro: lo necesitarás cada vez que inicies sesión en un navegador o dispositivo nuevo.'
            : 'Tu PIN ha sido <strong>regenerado</strong>. El PIN anterior ya no es válido. Usa este nuevo PIN para ingresar al portal.';
        var goButton = platformUrl
            ? '<div style="text-align:center; margin: 25px 0 10px;"><a href="' + escapeHtml_(platformUrl) + '" style="background-color:#D71920; color:#ffffff; padding:12px 30px; text-decoration:none; border-radius:6px; font-weight:bold; font-size:14px; display:inline-block;">Ir a la plataforma →</a></div>'
            : '';

        return '' +
        '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb;">' +
            '<div style="background-color: #D71920; color: white; padding: 20px; text-align: center;">' +
                '<h2 style="margin: 0; font-size: 18px; letter-spacing: 1px;">PORTAL DE VIAJES EQUITEL</h2>' +
                '<div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">Acceso seguro a tu cuenta</div>' +
            '</div>' +
            '<div style="padding: 25px;">' +
                '<p style="color: #111827; font-size: 14px; line-height: 1.6; margin: 0 0 15px;">Hola,</p>' +
                '<p style="color: #374151; font-size: 14px; line-height: 1.6; margin: 0 0 15px;">' +
                    'Te compartimos por este medio tu <strong>PIN de acceso</strong> al Portal de Viajes Equitel. ' +
                    'Esto es para mejorar la seguridad de tu cuenta y de tu información.' +
                '</p>' +
                '<p style="color: #374151; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">' + statusMessage + '</p>' +

                '<div style="background-color: #fef2f2; border: 2px solid #D71920; border-radius: 8px; padding: 20px; margin: 20px 0;">' +
                    '<div style="font-size: 11px; color: #991b1b; text-transform: uppercase; font-weight: bold; margin-bottom: 8px;">Tu correo registrado</div>' +
                    '<div style="font-size: 15px; color: #111827; font-weight: 600; margin-bottom: 18px; word-break: break-all;">' + escapeHtml_(email) + '</div>' +
                    '<div style="font-size: 11px; color: #991b1b; text-transform: uppercase; font-weight: bold; margin-bottom: 8px;">Tu PIN de acceso</div>' +
                    '<div style="font-family: \'Courier New\', monospace; font-size: 32px; color: #D71920; font-weight: bold; letter-spacing: 6px; text-align: center; padding: 12px; background-color: #ffffff; border-radius: 6px; border: 1px dashed #fca5a5;">' + escapeHtml_(pin) + '</div>' +
                '</div>' +

                '<div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 15px; margin: 20px 0; font-size: 12px; color: #78350f; line-height: 1.5;">' +
                    '<strong>¿Cómo lo uso?</strong><br/>' +
                    '1. Ingresa al Portal de Viajes con tu correo corporativo.<br/>' +
                    '2. Cuando se te solicite, introduce este PIN de 8 dígitos.<br/>' +
                    '3. Una vez verificado, no se te pedirá de nuevo durante 30 días en este navegador.' +
                '</div>' +

                goButton +

                '<div style="border-top: 1px solid #e5e7eb; margin-top: 25px; padding-top: 15px;">' +
                    '<p style="color: #6b7280; font-size: 11px; line-height: 1.5; margin: 0;">' +
                        'Si <strong>no solicitaste este correo</strong>, ignóralo o repórtalo al área de viajes (apcompras@equitel.com.co). ' +
                        'Por seguridad, nunca compartas tu PIN con nadie.' +
                    '</p>' +
                '</div>' +
            '</div>' +
            '<div style="background-color: #111827; color: #9ca3af; padding: 12px; text-align: center; font-size: 10px;">' +
                'Portal de Viajes Equitel · Mensaje automático, no responder.' +
            '</div>' +
        '</div>';
    },

    // SHARED: Generates the full Route, Dates, Passengers and Details block.
    // Replicates the "Initial Email" visual structure for consistency.
    _getFullSummary: function(data) {
        let ccDisplay = '';
        if (data.costCenter === 'VARIOS' && data.variousCostCenters) {
            ccDisplay = `VARIOS: ${escapeHtml_(data.variousCostCenters)}`;
        } else {
            ccDisplay = `${escapeHtml_(data.costCenter)}${data.costCenterName ? ' - ' + escapeHtml_(data.costCenterName) : ''}`;
        }

        const approverDisplay = data.approverName
            ? `${escapeHtml_(data.approverName)} <span style="font-weight:normal; font-size:12px; color:#6b7280;">(${escapeHtml_(data.approverEmail)})</span>`
            : (escapeHtml_(data.approverEmail) || 'Por Definir');

        const headerColor = '#D71920';
        const internationalBadge = data.isInternational
            ? `<span style="background-color: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; text-transform: uppercase; margin-left: 5px;">Internacional 🌍</span>`
            : '';

        const passengerList = (data.passengers || []).map(p =>
            `<li style="margin-bottom: 4px;">${escapeHtml_(p.name)} <span style="color:#6b7280; font-size:12px;">(${escapeHtml_(p.idNumber)})</span></li>`
        ).join('');

        const isHotelOnlyEmail = data.requestMode === 'HOTEL_ONLY';

        return `
        <!-- ROUTE / LOCATION -->
        ${isHotelOnlyEmail ? `
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 20px; text-align: center;">
          <div style="font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">🏨 CIUDAD DEL HOSPEDAJE ${internationalBadge}</div>
          <div style="font-size: 18px; font-weight: bold; color: #111827;">${escapeHtml_(data.destination)}</div>
        </div>
        ` : `
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 20px; text-align: center;">
          <table width="100%">
            <tr>
              <td width="45%" align="left">
                <div style="font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">ORIGEN</div>
                <div style="font-size: 18px; font-weight: bold; color: #111827;">${escapeHtml_(data.origin)}</div>
              </td>
              <td width="10%" align="center"><span style="color: #d1d5db; font-size: 20px;">&#10142;</span></td>
              <td width="45%" align="right">
                <div style="font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">DESTINO ${internationalBadge}</div>
                <div style="font-size: 18px; font-weight: bold; color: #111827;">${escapeHtml_(data.destination)}</div>
              </td>
            </tr>
          </table>
        </div>
        `}

        <!-- DATES -->
        <div style="display: table; width: 100%; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 20px; border-collapse: separate; border-spacing: 0;">
          <div style="display: table-cell; width: 50%; padding: 15px; text-align: center; vertical-align: top; border-right: 1px solid #e5e7eb;">
            <div style="font-size: 10px; color: #9ca3af; text-transform: uppercase; margin-bottom: 5px;">${isHotelOnlyEmail ? 'CHECK-IN' : 'FECHA IDA'}</div>
            <div style="font-weight: bold; color: ${headerColor}; font-size: 14px;">📅 ${data.departureDate}</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">${(!isHotelOnlyEmail && data.departureTimePreference) ? '('+data.departureTimePreference+')' : ''}</div>
          </div>
          <div style="display: table-cell; width: 50%; padding: 15px; text-align: center; vertical-align: top;">
            <div style="font-size: 10px; color: #9ca3af; text-transform: uppercase; margin-bottom: 5px;">${isHotelOnlyEmail ? 'CHECK-OUT' : 'FECHA REGRESO'}</div>
            <div style="font-weight: bold; color: ${headerColor}; font-size: 14px;">📅 ${data.returnDate || 'N/A'}</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">${(!isHotelOnlyEmail && data.returnTimePreference) ? '('+data.returnTimePreference+')' : ''}</div>
          </div>
        </div>

        <!-- OBSERVATIONS (NOW PROMINENT) -->
        ${data.comments ? `
        <div style="background-color: #fefce8; border: 1px solid #fef08a; border-radius: 6px; padding: 15px; margin-bottom: 25px; border-left: 4px solid #eab308;">
          <div style="font-size: 11px; font-weight: bold; color: #b45309; text-transform: uppercase; margin-bottom: 5px; letter-spacing: 0.5px;">${isHotelOnlyEmail ? 'MOTIVO / OBSERVACIONES' : 'MOTIVO DEL VIAJE / OBSERVACIONES'}</div>
          <div style="font-size: 14px; color: #713f12; font-style: italic; line-height: 1.5;">"${escapeHtml_(data.comments)}"</div>
        </div>` : ''}

        <!-- DETAILS -->
        <div style="margin-top: 25px;">
            <div style="font-size: 14px; font-weight: bold; color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 15px;">Detalles del Caso</div>
            <table width="100%" cellpadding="6" cellspacing="0" border="0" style="font-size: 13px;">
                <tr><td width="35%" style="color: #6b7280;">Empresa / Sede:</td><td style="font-weight: 600; color: #111827;">${escapeHtml_(data.company)} - ${escapeHtml_(data.site)}</td></tr>
                <tr><td style="color: #6b7280;">Unidad de Negocio:</td><td style="font-weight: 600; color: #111827;">${escapeHtml_(data.businessUnit)}</td></tr>
                <tr><td style="color: #6b7280;">Centro de Costos:</td><td style="font-weight: 600; color: #111827;">${ccDisplay}</td></tr>
                ${data.workOrder ? `<tr><td style="color: #6b7280;">Orden de Trabajo:</td><td style="font-weight: 600; color: #111827;">${escapeHtml_(data.workOrder)}</td></tr>` : ''}
                <tr><td style="color: #6b7280;">Solicitante:</td><td><a href="mailto:${escapeHtml_(data.requesterEmail)}" style="color: #0056b3;">${escapeHtml_(data.requesterEmail)}</a></td></tr>
                <tr><td style="color: #6b7280;">Aprobador:</td><td style="font-weight: 600; color: #111827;">${approverDisplay}</td></tr>
                <tr><td style="color: #6b7280;">Hospedaje:</td><td style="font-weight: 600; color: #0056b3;">${data.requiresHotel ? `Sí (${data.nights} Noches)` : 'No'}</td></tr>
                ${data.requiresHotel ? `<tr><td style="color: #6b7280;">Hotel Sugerido:</td><td style="font-weight: 600; color: #111827;">${escapeHtml_(data.hotelName) || 'N/A'}</td></tr>` : ''}
            </table>
        </div>

        <!-- PASSENGERS -->
        <div style="background-color: #eff6ff; border: 1px solid #dbeafe; border-radius: 6px; padding: 15px; margin-top: 15px;">
          <div style="font-size: 11px; font-weight: bold; color: #1e40af; text-transform: uppercase; margin-bottom: 5px;">PASAJERO(S):</div>
          <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #1e3a8a;">
            ${passengerList}
          </ul>
        </div>
        `;
    },

    layout: function(title, content, headerColor, mainTitle) {
        const color = headerColor || '#D71920';
        const titleText = mainTitle || 'GESTIÓN DE VIAJES';
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: Helvetica, Arial, sans-serif;">
            <table width="100%" style="background-color: #f4f4f4;">
                <tr>
                    <td align="center" style="padding: 20px 0;">
                        <table width="600" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                            <tr>
                                <td style="background-color: ${color}; padding: 30px 20px; text-align: center;">
                                    <h1 style="color: #ffffff; margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 1px;">${titleText}</h1>
                                    <p style="color: #ffffff; margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">ID: ${title}</p>
                                </td>
                            </tr>
                            <tr><td style="padding: 30px 40px; color: #333333; line-height: 1.6;">${content}</td></tr>
                            <tr>
                                <td style="text-align: center; font-size: 11px; color: #9ca3af; padding-bottom: 20px;">
                                    &copy; ${new Date().getFullYear()} Organización Equitel. Gestión de Viajes Corporativos.
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>`;
    },
    
    // ADMIN REMINDERS SUMMARY (v1.9)
    adminReminderSummary: function(pendingOptionsRows, pendingCostRows, approvedRows, pendingChangesRows) {
        pendingChangesRows = pendingChangesRows || [];
        let content = `<p style="color: #4b5563; margin-bottom: 20px;">Este es un recordatorio automático de las solicitudes que requieren su acción inmediata.</p>`;

        const renderTable = (title, items, color) => {
            if (items.length === 0) return '';
            let html = `
                <div style="margin-bottom: 30px;">
                    <h3 style="color: ${color}; border-bottom: 2px solid ${color}; padding-bottom: 5px; margin-bottom: 15px;">${title} (${items.length})</h3>
                    <table width="100%" cellpadding="8" cellspacing="0" style="font-size: 13px; border: 1px solid #e5e7eb; border-collapse: collapse;">
                        <thead>
                            <tr style="background-color: #f9fafb;">
                                <th align="left" style="border-bottom: 1px solid #e5e7eb;">ID</th>
                                <th align="left" style="border-bottom: 1px solid #e5e7eb;">Solicitante</th>
                                <th align="left" style="border-bottom: 1px solid #e5e7eb;">Ruta</th>
                                <th align="right" style="border-bottom: 1px solid #e5e7eb;">Fecha</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            items.forEach(item => {
                html += `
                    <tr>
                        <td style="border-bottom: 1px solid #f3f4f6;"><strong>${escapeHtml_(item.requestId)}</strong></td>
                        <td style="border-bottom: 1px solid #f3f4f6;">${escapeHtml_(item.requesterEmail)}</td>
                        <td style="border-bottom: 1px solid #f3f4f6;">${item.requestMode === 'HOTEL_ONLY' ? '🏨 ' + escapeHtml_(item.destination) : escapeHtml_(item.origin) + ' ➝ ' + escapeHtml_(item.destination)}</td>
                        <td align="right" style="border-bottom: 1px solid #f3f4f6;">${item.departureDate}</td>
                    </tr>
                `;
            });

            html += `</tbody></table></div>`;
            return html;
        };

        // Sección especial para solicitudes de cambio: muestra también la solicitud padre
        // y una nota explícita indicando que debe gestionarse desde el dashboard.
        const renderChangesSection = (items) => {
            if (items.length === 0) return '';
            let html = `
                <div style="margin-bottom: 30px;">
                    <h3 style="color: #f59e0b; border-bottom: 2px solid #f59e0b; padding-bottom: 5px; margin-bottom: 10px;">🔄 SOLICITUDES DE CAMBIO PENDIENTES DE REVISIÓN (${items.length})</h3>
                    <div style="background-color: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 10px 12px; margin-bottom: 14px; border-radius: 6px; font-size: 12px;">
                        Estas solicitudes están esperando que usted las <strong>pase a estudio</strong> o las <strong>deniegue</strong>. Para hacerlo rápido, ingrese al <strong>Panel de Administración</strong> y haga clic en el botón <strong>Revisar Cambio</strong> de cada una (también puede usar los botones del correo original de la solicitud).
                    </div>
                    <table width="100%" cellpadding="8" cellspacing="0" style="font-size: 13px; border: 1px solid #e5e7eb; border-collapse: collapse;">
                        <thead>
                            <tr style="background-color: #f9fafb;">
                                <th align="left" style="border-bottom: 1px solid #e5e7eb;">ID Cambio</th>
                                <th align="left" style="border-bottom: 1px solid #e5e7eb;">Reemplaza</th>
                                <th align="left" style="border-bottom: 1px solid #e5e7eb;">Solicitante</th>
                                <th align="left" style="border-bottom: 1px solid #e5e7eb;">Ruta</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            items.forEach(item => {
                html += `
                    <tr>
                        <td style="border-bottom: 1px solid #f3f4f6;"><strong>${escapeHtml_(item.requestId)}</strong></td>
                        <td style="border-bottom: 1px solid #f3f4f6;">${escapeHtml_(item.relatedRequestId || '—')}</td>
                        <td style="border-bottom: 1px solid #f3f4f6;">${escapeHtml_(item.requesterEmail)}</td>
                        <td style="border-bottom: 1px solid #f3f4f6;">${item.requestMode === 'HOTEL_ONLY' ? '🏨 ' + escapeHtml_(item.destination) : escapeHtml_(item.origin) + ' ➝ ' + escapeHtml_(item.destination)}</td>
                    </tr>
                `;
            });
            html += `</tbody></table></div>`;
            return html;
        };

        content += renderChangesSection(pendingChangesRows);
        content += renderTable('📥 SOLICITUDES PENDIENTES DE COTIZAR', pendingOptionsRows, '#D71920');
        content += renderTable('💰 PENDIENTES DE CONFIRMAR COSTOS', pendingCostRows, '#7c3aed'); // Violet for cost confirmation
        content += renderTable('✅ SOLICITUDES APROBADAS (POR RESERVAR)', approvedRows, '#059669');

        content += `
            <div style="text-align: center; margin-top: 30px;">
                <a href="${PLATFORM_URL}" style="background-color: #111827; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-size: 14px; font-weight: bold; display: inline-block;">IR AL PANEL DE ADMINISTRACIÓN</a>
            </div>
        `;

        return this.layout('RESUMEN DE PENDIENTES', content, '#374151', 'RECORDATORIO ADMINISTRATIVO');
    },

    // FALLBACK NEW REQUEST (Used if frontend HTML not passed for some reason)
    newRequest: function(data, requestId, link) {
        const content = `<p>Solicitud recibida. ID: ${requestId}</p>`;
        return this.layout(`${requestId}`, content);
    },

    // OPTIONS AVAILABLE EMAIL (Updated with Full Summary)
    optionsAvailable: function(request, options, link) {
        // Separate Flight and Hotel options
        const flightOptions = options.filter(o => o.type === 'FLIGHT');
        const hotelOptions = options.filter(o => o.type === 'HOTEL');

        const renderImages = (opts) => opts.map(opt => {
            const directionTag = opt.direction ? 
                `<span style="background-color: ${opt.direction === 'VUELTA' ? '#10B981' : '#FBBF24'}; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 10px; vertical-align: middle;">${opt.direction}</span>` 
                : '';
            
            return `
            <div style="margin-bottom: 15px; border: 1px solid #ddd; padding: 10px; border-radius: 4px;">
                <div style="font-weight:bold; color:#D71920; margin-bottom:5px;">Opción ${opt.id} ${directionTag}</div>
                <img src="${opt.url}" alt="${opt.name}" style="max-width: 100%; height: auto; display: block; border-radius: 4px;" />
            </div>
            `;
        }).join('');

        const isHotelOnlyOpt = request.requestMode === 'HOTEL_ONLY';
        let content = `<p style="margin-bottom: 16px; color: #4b5563;">Se han cargado las opciones de ${isHotelOnlyOpt ? 'hospedaje' : 'viaje'} para su solicitud <strong>${request.requestId}</strong>. Por favor revise las imágenes a continuación e ingrese al aplicativo para confirmar su elección.</p>`;

        // BANNER: instrucción explícita de indicar categoría
        content += `
            <div style="background-color: #fef3c7; border: 1px solid #fde68a; color: #92400e; padding: 14px 16px; margin-bottom: 22px; border-radius: 6px; font-size: 13px; line-height: 1.55;">
                <strong>⚠️ Importante al describir su selección:</strong><br/>
                Indique <strong>siempre la categoría</strong> que desea elegir (no solo la letra de la opción). Sin esto, el área de viajes no podrá tramitar su reserva.
                <ul style="margin: 8px 0 0 18px; padding: 0;">
                    ${!isHotelOnlyOpt ? '<li><strong>Vuelo:</strong> categoría tarifaria — ej. Económica, Economy Plus, Premium, Business.</li>' : ''}
                    <li><strong>Hotel:</strong> tipo de habitación — ej. Estándar, Superior, Suite.</li>
                </ul>
                <div style="margin-top: 8px; font-style: italic;">Ejemplo: "${isHotelOnlyOpt
                    ? 'Opción A hotel habitación Estándar.'
                    : 'Opción A vuelo de ida en categoría Económica' + (request.returnDate ? ', Opción C vuelo de vuelta en Economy Plus' : '') + (request.requiresHotel ? ', Opción B hotel habitación Estándar' : '') + '.'
                }"</div>
            </div>
        `;

        if (flightOptions.length > 0) {
            content += `<h3 style="color: #374151; border-bottom: 2px solid #D71920; padding-bottom: 5px; margin-top:20px;">✈️ Opciones de Vuelo</h3>`;
            content += renderImages(flightOptions);
        }

        if (hotelOptions.length > 0) {
            content += `<h3 style="color: #374151; border-bottom: 2px solid #1e40af; padding-bottom: 5px; margin-top:30px;">🏨 Opciones de Hotel</h3>`;
            content += renderImages(hotelOptions);
        }

        content += `
            <div style="text-align: center; margin-top: 30px;">
                <a href="${link}" style="background-color: #D71920; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-size: 14px; font-weight: bold;">INGRESAR Y SELECCIONAR</a>
            </div>
            
            <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 30px 0;">
            ${this._getFullSummary(request)}
        `;
        return this.layout(`${request.requestId}`, content, undefined, isHotelOnlyOpt ? 'GESTIÓN DE HOSPEDAJE' : undefined);
    },

    // NEW: NOTIFICATION FOR ADMIN WHEN USER SELECTS OPTION (Updated with Full Summary)
    userSelectionNotification: function(request) {
        const content = `
            <p style="color: #4b5563; margin-bottom: 20px;">
                El usuario <strong>${escapeHtml_(request.requesterEmail)}</strong> ha realizado su selección para la solicitud <strong>${escapeHtml_(request.requestId)}</strong>.
            </p>

            <div style="background-color: #f3f4f6; border-left: 4px solid #D71920; padding: 15px; margin-bottom: 25px; border-radius: 4px;">
                <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight:bold; margin-bottom: 5px;">SELECCIÓN DEL USUARIO</div>
                <div style="font-size: 14px; color: #111827; font-style: italic;">"${escapeHtml_(request.selectionDetails)}"</div>
            </div>

            <p style="margin-bottom: 20px;">Por favor ingrese a la plataforma para registrar los costos finales y solicitar la aprobación financiera.</p>

            <div style="text-align: center; margin-top: 30px;">
                <a href="${PLATFORM_URL}" style="background-color: #D71920; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-size: 14px; font-weight: bold;">INGRESAR A LA PLATAFORMA</a>
            </div>

            <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 30px 0;">
            ${this._getFullSummary(request)}
        `;
        return this.layout(`${request.requestId}`, content, '#111827', 'SELECCIÓN REALIZADA');
    },

    // APPROVAL REQUEST EMAIL (Updated with Full Summary & Banners)
    approvalRequest: function(request, selectedOption, approveLink, rejectLink) {
        const isHotelOnlyAppr = request.requestMode === 'HOTEL_ONLY';
        let alertHtml = '';
        
        // RECOMMENDATION BANNERS
        alertHtml += `
            <div style="background-color: #fef3c7; border: 1px solid #fde68a; color: #92400e; padding: 12px; margin-bottom: 10px; border-radius: 6px; font-size: 13px;">
                <strong>⚠️ Recomendación:</strong> Por favor aprobar el itinerario máximo 2 horas posterior a la recepción de este correo ya que las tarifas son dinámicas y pueden variar.
            </div>
            <div style="background-color: #fef3c7; border: 1px solid #fde68a; color: #92400e; padding: 12px; margin-bottom: 20px; border-radius: 6px; font-size: 13px;">
                <strong>⚠️ Horario de Aprobación:</strong> Por favor aprobar en el horario laboral L-V de 7am a 5pm y sabados de 8am -12m, posterior a ese horario quedará para el día hábil siguiente, lo que puede afectar los costos cotizados.
            </div>
        `;

        // HIGH COST BANNER
        const totalCost = Number(request.totalCost) || 0;
        if (totalCost > 1200000) {
            alertHtml += `<div style="background-color: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 15px; margin-bottom: 20px; border-radius: 6px;"><strong>⚠️ APROBACIÓN EXTRAORDINARIA:</strong> El costo total de esta solicitud ($${totalCost.toLocaleString()}) excede el tope establecido ($1,200,000), por lo que requiere aprobación adicional de Gerencia General, Gerencia de Cadena de Suministro y Aprobador de Área.</div>`;
        }
        
        // INTERNATIONAL BANNER
        if (request.isInternational) {
            alertHtml += `<div style="background-color: #eff6ff; border: 1px solid #93c5fd; color: #1e3a8a; padding: 15px; margin-bottom: 20px; border-radius: 6px;"><strong>🌍 ${isHotelOnlyAppr ? 'HOSPEDAJE INTERNACIONAL' : 'VIAJE INTERNACIONAL'}:</strong> Esta solicitud requiere aprobación de Gerencia General, Gerencia de Cadena de Suministro y Aprobador de Área.</div>`;
        }
        
        // POLICY VIOLATION BANNER
        if (request.policyViolation && request.departureDate) {
            const parseHelper = (dStr) => {
                const parts = String(dStr).split('-');
                if (parts.length === 3) return new Date(Number(parts[2]), Number(parts[1])-1, Number(parts[0]));
                const parsed = new Date(dStr);
                return isNaN(parsed.getTime()) ? new Date() : parsed;
            };
            const d1 = request.timestamp ? parseHelper(request.timestamp) : new Date();
            const d2 = parseHelper(request.departureDate);
            d1.setHours(0,0,0,0);
            d2.setHours(0,0,0,0);
            let diffDays = Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24));
            if (isNaN(diffDays) || diffDays < 0) diffDays = request.daysInAdvance || 0;
            
            const required = request.isInternational ? 30 : 8;
            
            alertHtml += `<div style="background-color: #fff1f2; border: 1px solid #fecaca; color: #be123c; padding: 10px; border-radius: 4px; margin-bottom: 15px; font-size: 12px; text-align: center;">
         <strong style="display:block; margin-bottom:4px;">⚠️ SOLICITUD FUERA DE POLÍTICA DE ANTICIPACIÓN</strong>
         Esta solicitud se hizo <strong>${diffDays} días</strong> antes ${isHotelOnlyAppr ? 'del check-in' : 'del vuelo'}. <br/>
         Por ser ${request.isInternational ? 'internacional' : 'nacional'}, debería haberse hecho con al menos <strong>${required} días</strong> de anticipación.
       </div>`;
        }

        // LINKED REQUEST / EXTRA COST BANNER
        if (request.relatedRequestId && request.parentTimestamp) {
            // Days since parent
            const parseDate = (dStr) => {
                const parts = String(dStr).split('-');
                if (parts.length === 3) return new Date(Number(parts[2]), Number(parts[1])-1, Number(parts[0]));
                return new Date(dStr);
            };
            const createdDate = parseDate(request.parentTimestamp);
            const now = new Date();
            let diffDays = 0;
            if (!isNaN(createdDate.getTime())) {
                const diffTime = Math.abs(now.getTime() - createdDate.getTime());
                diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            }

            alertHtml += `<div style="background-color: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; padding: 12px; border-radius: 4px; margin-bottom: 10px; font-size: 12px;"><strong>ℹ️ SOLICITUD VINCULADA:</strong> Esta solicitud reemplaza a la solicitud <strong>${request.relatedRequestId}</strong>, creada hace <strong>${diffDays} días</strong>.</div>`;
        }

        if (request.parentWasReserved) {
            alertHtml += `<div style="background-color: #fee2e2; border: 1px solid #fecaca; color: #991b1b; padding: 12px; border-radius: 4px; margin-bottom: 20px; font-size: 13px; border-left: 4px solid #ef4444;"><strong style="display:block; margin-bottom:4px; font-size:14px;">⚠️ CAMBIO CON COSTO EXTRA</strong>La solicitud original ya tenía ${isHotelOnlyAppr ? 'reserva de hotel' : 'tiquetes comprados'} (Etapa: RESERVADO).<br/>Este cambio generará penalidades o costos adicionales que se están aprobando.</div>`;
        }

        const content = `
            <p style="color: #4b5563; margin-bottom: 20px;">El usuario <strong>${escapeHtml_(request.requesterEmail)}</strong> requiere aprobación para ${isHotelOnlyAppr ? 'el hospedaje' : 'el viaje'} <strong>${escapeHtml_(request.requestId)}</strong>.</p>
            
            ${alertHtml}

            <!-- USER SELECTION TEXT -->
            <div style="background-color: #f3f4f6; border-left: 4px solid #374151; padding: 15px; margin-bottom: 25px; border-radius: 4px;">
                <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight:bold; margin-bottom: 5px;">ELECCIÓN DEL USUARIO</div>
                <div style="font-size: 14px; color: #111827; font-style: italic;">"${escapeHtml_(request.selectionDetails)}"</div>
            </div>

            ${this._renderOptionsGallery(request)}

            <!-- FINAL COSTS TABLE -->
            <div style="background-color: #ffffff; border: 1px solid #e5e7eb; padding: 0; border-radius: 8px; margin-bottom: 25px; overflow: hidden;">
                <div style="background-color: #111827; color: white; padding: 10px 15px; font-size: 13px; font-weight: bold; text-transform: uppercase;">
                    Resumen de Costos (Aprobados por Analista)
                </div>
                <table width="100%" cellpadding="10" cellspacing="0">
                    ${request.requestMode !== 'HOTEL_ONLY' ? `<tr>
                        <td style="border-bottom: 1px solid #e5e7eb; color: #6b7280;">Valor Tiquetes:</td>
                        <td style="border-bottom: 1px solid #e5e7eb; font-weight: bold; text-align: right;">$${Number(request.finalCostTickets || 0).toLocaleString()}</td>
                    </tr>` : ''}
                    <tr>
                        <td style="border-bottom: 1px solid #e5e7eb; color: #6b7280;">Valor Hotel:</td>
                        <td style="border-bottom: 1px solid #e5e7eb; font-weight: bold; text-align: right;">$${Number(request.finalCostHotel || 0).toLocaleString()}</td>
                    </tr>
                    <tr style="background-color: #f9fafb;">
                        <td style="color: #111827; font-weight: bold;">TOTAL:</td>
                        <td style="color: #D71920; font-weight: bold; font-size: 16px; text-align: right;">$${Number(request.totalCost || 0).toLocaleString()}</td>
                    </tr>
                </table>
            </div>

            <table width="100%" cellpadding="0" cellspacing="0"><tr>
                <td align="center"><a href="${approveLink}" style="background-color: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; margin-right: 10px; display: inline-block;">APROBAR</a></td>
                <td align="center"><a href="${rejectLink}" style="background-color: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">DENEGAR</a></td>
            </tr></table>

            <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 30px 0;">
            ${this._getFullSummary(request)}
            `;
        return this.layout(`${request.requestId}`, content, '#1f2937', 'APROBACIÓN REQUERIDA');
    },

    // DECISION NOTIFICATION EMAIL (Updated with Full Summary)
    decisionNotification: function(request, status) {
        const isApproved = status === 'APROBADO';
        const color = isApproved ? '#059669' : '#dc2626';
        const title = isApproved ? 'SOLICITUD APROBADA' : 'SOLICITUD DENEGADA';
        const icon = isApproved ? '✅' : '❌';

        let denialReasonBlock = '';
        if (!isApproved && request.denialReason) {
            denialReasonBlock = `
            <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #dc2626; border-radius: 6px; padding: 15px; margin: 20px 0; text-align: left;">
                <div style="font-size: 11px; font-weight: bold; color: #991b1b; text-transform: uppercase; margin-bottom: 6px;">Motivo de la Denegación</div>
                <div style="font-size: 13px; color: #374151; font-style: italic; line-height: 1.5;">"${escapeHtml_(request.denialReason)}"</div>
            </div>`;
        }

        const content = `
            <div style="text-align: center; margin-bottom: 25px;">
                <div style="font-size: 40px; margin-bottom: 10px;">${icon}</div>
                <div style="font-size: 16px; color: #374151;">Su solicitud de ${request.requestMode === 'HOTEL_ONLY' ? 'hospedaje' : 'viaje'} <strong>${request.requestId}</strong> ha sido <strong style="color: ${color};">${status}</strong>.</div>
            </div>
            ${denialReasonBlock}
            ${isApproved ? `<div style="text-align: center; margin-bottom: 30px;"><a href="${PLATFORM_URL}" style="background-color: #111827; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; font-size: 12px;">Ingresar a la Plataforma</a></div>` : ''}

            <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 30px 0;">
            ${this._getFullSummary(request)}
        `;
        return this.layout(`${request.requestId}`, content, color, title);
    },
    
    // NEW TEMPLATE FOR RESERVATION CONFIRMATION (Updated with Full Summary)
    reservationConfirmed: function(request) {
        const isHotelOnly = request.requestMode === 'HOTEL_ONLY';
        const reservationFiles = (request.reservationFiles && request.reservationFiles.length > 0)
            ? request.reservationFiles
            : (request.reservationUrl ? [{ name: 'Confirmación de Reserva', url: request.reservationUrl }] : []);

        let filesBlock = '';
        if (reservationFiles.length > 0) {
            const itemsHtml = reservationFiles.map(function(f, i) {
                const safeName = escapeHtml_(f.name) || ('Archivo ' + (i + 1));
                const safeUrl = escapeHtml_(f.url);
                return `
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff; border:1px solid #dbeafe; border-radius:6px; margin-bottom:8px; border-collapse:separate;">
                      <tr>
                        <td style="padding:12px 14px; font-size:13px; color:#1e3a8a; word-break:break-word; vertical-align:middle;">📄 ${safeName}</td>
                        <td width="110" style="padding:12px 14px 12px 6px; text-align:right; white-space:nowrap; vertical-align:middle;">
                          <a href="${safeUrl}" style="background-color:#2563eb; color:#ffffff; padding:8px 16px; text-decoration:none; border-radius:4px; font-size:12px; font-weight:bold; display:inline-block;">Descargar</a>
                        </td>
                      </tr>
                    </table>
                `;
            }).join('');

            filesBlock = `
                <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 15px; margin-bottom: 25px;">
                    <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight: bold; margin-bottom: 10px;">
                        📎 Archivos de la Reserva (${reservationFiles.length})
                    </div>
                    ${itemsHtml}
                </div>
            `;
        }

        const content = `
            <div style="text-align: center; margin-bottom: 25px;">
                <div style="font-size: 40px; margin-bottom: 10px;">${isHotelOnly ? '🏨' : '✈️'}</div>
                <div style="font-size: 16px; color: #374151;">${isHotelOnly
                    ? 'La reserva de hotel para su solicitud <strong>' + request.requestId + '</strong> ha sido realizada.'
                    : 'Los tiquetes para su viaje <strong>' + request.requestId + '</strong> han sido comprados.'
                }</div>
            </div>

            <div style="background-color: #eff6ff; border: 1px solid #dbeafe; padding: 20px; border-radius: 8px; text-align: center; margin-bottom: 25px;">
                <div style="font-size: 12px; color: #60a5fa; margin-bottom: 5px; text-transform: uppercase; font-weight: bold;">${isHotelOnly ? 'NÚMERO DE CONFIRMACIÓN' : 'NÚMERO DE RESERVA (PNR)'}</div>
                <div style="font-size: 24px; font-weight: bold; color: #1e3a8a; letter-spacing: 2px;">${escapeHtml_(request.reservationNumber) || 'N/A'}</div>
            </div>

            ${filesBlock}

            <p style="text-align: center; color: #4b5563; margin-bottom: 25px;">
                También puede acceder a todos los archivos desde la plataforma.
            </p>

            <div style="text-align: center;">
                <a href="${PLATFORM_URL}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">VER EN LA APP</a>
            </div>

            <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 30px 0;">
            ${this._getFullSummary(request)}
        `;
        return this.layout(`${request.requestId}`, content, '#2563eb', isHotelOnly ? 'HOTEL RESERVADO' : 'TIQUETES COMPRADOS');
    },

    modificationResult: function(request, decision) {
        const isStudy = decision === 'study';
        const title = isStudy ? 'CAMBIO EN ESTUDIO' : 'CAMBIO RECHAZADO';
        const color = isStudy ? '#059669' : '#dc2626';
        const parentId = request.relatedRequestId || '';

        let content = '';
        if (isStudy) {
            content += `
                <p style="font-size:15px; color:#111827; margin-bottom:10px;">
                    Su solicitud de cambio <strong>${escapeHtml_(request.requestId)}</strong>
                    ${parentId ? '(que reemplaza a <strong>' + escapeHtml_(parentId) + '</strong>) ' : ''}ha sido <strong>aceptada para gestión</strong>.
                </p>
                <p style="font-size:13px; color:#4b5563; margin-bottom:16px;">
                    A partir de ahora, esta nueva solicitud seguirá el flujo normal: el equipo de viajes cargará opciones, usted seleccionará la que prefiera y se solicitará la aprobación correspondiente. Recibirá los correos del proceso como en cualquier solicitud.
                </p>
                ${parentId ? '<div style="background-color:#fffbeb; border:1px solid #fde68a; color:#92400e; padding:10px 12px; border-radius:6px; font-size:12px; margin-bottom:10px;">La solicitud original <strong>' + escapeHtml_(parentId) + '</strong> quedará activa hasta que el área de viajes decida qué hacer con ella (normalmente queda reemplazada por este cambio).</div>' : ''}
                <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 24px 0;">
                ${this._getFullSummary(request)}
            `;
        } else {
            const reason = request.denialReason || '';
            content += `
                <p style="font-size:15px; color:#111827; margin-bottom:10px;">
                    Su solicitud de cambio <strong>${escapeHtml_(request.requestId)}</strong>
                    ${parentId ? '(que pretendía reemplazar a <strong>' + escapeHtml_(parentId) + '</strong>) ' : ''}<strong>no fue aprobada</strong>.
                </p>
                ${reason ? '<div style="background-color:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:12px 14px; border-radius:6px; font-size:13px; margin-bottom:14px;"><strong>Motivo:</strong> ' + escapeHtml_(reason) + '</div>' : ''}
                <p style="font-size:13px; color:#4b5563; margin-bottom:8px;">
                    Si su solicitud original <strong>${escapeHtml_(parentId || 'anterior')}</strong> sigue activa, el proceso continuará sobre ella con normalidad. Si tiene dudas, responda a este correo o contacte al área de viajes.
                </p>
            `;
        }

        return this.layout(`${request.requestId}`, content, color, title);
    }
};

// --- RENDER HELPERS ---

function renderConfirmationPage(title, message, actionText, actionUrl, color) {
    const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
    <style>body{font-family:sans-serif;background:#f3f4f6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:white;padding:30px;border-radius:8px;box-shadow:0 4px 6px rgba(0,0,0,0.1);text-align:center;max-width:400px}.btn{background:${color};color:white;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block;margin-top:20px;border:none;cursor:pointer;font-size:16px}</style>
    <script>function go(){document.getElementById('c').style.display='none';document.getElementById('l').style.display='block';window.top.location.href="${actionUrl}";}</script>
    </head><body>
    <div id="c" class="card"><h1>${title}</h1><p>${message}</p><button onclick="go()" class="btn">${actionText}</button></div>
    <div id="l" class="card" style="display:none"><h1>Procesando...</h1><p>Por favor espere.</p></div>
    </body></html>`;
    return HtmlService.createHtmlOutput(html).setTitle(title).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function renderDenialReasonPage(id, role, actor, color) {
    const safeId = escapeHtml_(id);
    const safeRole = escapeHtml_(role);
    const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Denegar Solicitud</title>
    <style>
      body{font-family:sans-serif;background:#f3f4f6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px}
      .card{background:white;padding:30px;border-radius:8px;box-shadow:0 4px 6px rgba(0,0,0,0.1);text-align:center;max-width:440px;width:100%}
      h1{color:${color};font-size:20px;margin-bottom:8px}
      .id-badge{font-family:monospace;font-size:14px;background:#fee2e2;color:#991b1b;padding:4px 12px;border-radius:4px;display:inline-block;margin-bottom:16px}
      p{color:#374151;font-size:14px;line-height:1.5}
      textarea{width:100%;min-height:80px;border:1px solid #d1d5db;border-radius:6px;padding:10px;font-family:sans-serif;font-size:13px;resize:vertical;box-sizing:border-box;margin-top:8px}
      textarea:focus{outline:none;border-color:${color};box-shadow:0 0 0 2px rgba(215,25,32,0.15)}
      label{display:block;text-align:left;font-size:12px;font-weight:bold;color:#6b7280;text-transform:uppercase;margin-top:16px}
      .hint{text-align:left;font-size:11px;color:#9ca3af;margin-top:4px}
      .btn{background:${color};color:white;padding:12px 24px;border:none;border-radius:4px;cursor:pointer;font-size:15px;font-weight:bold;margin-top:20px;width:100%}
      .btn:hover{opacity:0.9}
      .loading{display:none}
    </style>
    <script>
      function submitDenial(){
        var reason = document.getElementById('reason').value.trim();
        var encodedReason = encodeURIComponent(reason);
        var url = '${WEB_APP_URL}?action=approve&id=${encodeURIComponent(id)}&decision=denied&role=${encodeURIComponent(role)}&confirm=true&actor=${encodeURIComponent(actor || '')}' + (reason ? '&reason=' + encodedReason : '');
        document.getElementById('form-card').style.display='none';
        document.getElementById('loading-card').style.display='block';
        window.top.location.href = url;
      }
    </script>
    </head><body>
    <div id="form-card" class="card">
      <h1>Denegar Solicitud</h1>
      <div class="id-badge">${safeId}</div>
      <p>¿Está seguro de <strong>DENEGAR</strong> esta solicitud?</p>
      <label for="reason">Motivo de la denegación (opcional)</label>
      <textarea id="reason" placeholder="Ej: No se justifica el viaje en estas fechas, presupuesto insuficiente..."></textarea>
      <div class="hint">Si desea, indique brevemente la razón. Quedará registrada y se notificará al solicitante.</div>
      <button onclick="submitDenial()" class="btn">SÍ, DENEGAR</button>
    </div>
    <div id="loading-card" class="card loading"><h1>Procesando...</h1><p>Por favor espere.</p></div>
    </body></html>`;
    return HtmlService.createHtmlOutput(html).setTitle('Denegar Solicitud').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function renderMessagePage(title, message, color) {
    const safeTitle = escapeHtml_(title);
    // Note: message contains intentional HTML (br, strong, span) from server-side callers.
    // User input within messages must be escaped at the interpolation site, not here.
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeTitle}</title><style>body{font-family:sans-serif;background:#f3f4f6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:white;padding:40px;border-radius:8px;text-align:center}</style></head><body><div class="card"><h1 style="color:${color}">${safeTitle}</h1><p>${message}</p></div></body></html>`;
    return HtmlService.createHtmlOutput(html).setTitle(safeTitle).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

// --- DATA ACCESS ---

function getRequestsByEmail(email) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const emailIdx = H("CORREO ENCUESTADO");
  const idIdx = H("ID RESPUESTA");
  const targetEmail = String(email).toLowerCase().trim();
  
  const uniqueRequests = new Map();
  
  data.forEach(row => {
      const id = String(row[idIdx]).trim();
      // Skip empty rows (no ID)
      if (!id) return;
      
      const rowEmail = String(row[emailIdx]).toLowerCase().trim();
      if (rowEmail === targetEmail) {
          // Deduplicate: Keep the first occurrence found
          if (!uniqueRequests.has(id)) {
              uniqueRequests.set(id, row);
          }
      }
  });
  
  return Array.from(uniqueRequests.values()).map(mapRowToRequest).reverse();
}

function getAllRequests() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const idIdx = H("ID RESPUESTA");
  
  const uniqueRequests = new Map();
  
  data.forEach(row => {
      const id = String(row[idIdx]).trim();
      // Skip empty rows (no ID)
      if (!id) return;
      
      // Deduplicate: Keep the first occurrence found
      if (!uniqueRequests.has(id)) {
          uniqueRequests.set(id, row);
      }
  });
  
  return Array.from(uniqueRequests.values()).map(mapRowToRequest).reverse();
}

function getCitiesList() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_CITIES);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  // Column A: COUNTRY, Column B: CITY
  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  return data.map(row => ({ 
    country: String(row[0]).trim().toUpperCase(), 
    city: String(row[1]).trim().toUpperCase() 
  })).filter(i => i.city);
}

function getCostCenterData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_RELATIONS);
  if (!sheet) return [];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  return data.map(row => ({ code: String(row[0]).trim(), name: String(row[1]), businessUnit: String(row[2]) })).filter(i => i.code);
}

function getCoApproverRules_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("REGLAS_COAPROBADOR");
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  return data.filter(row => String(row[1]).trim() && String(row[3]).trim()).map(row => ({
      principalEmail: String(row[1]).toLowerCase().trim(),
      coApproverName: String(row[2]).trim(),
      coApproverEmail: String(row[3]).toLowerCase().trim(),
      condition: String(row[4]).trim().toUpperCase()
  }));
}

/**
 * Returns the executive emails (CEO and Director CDS) so the frontend can
 * detect when the requester or area approver matches one of them and adjust
 * the approval-chain preview / detail view accordingly. These addresses are
 * already public (they appear in approval emails sent to area approvers), so
 * exposing them does not leak any secret.
 */
function getExecutiveEmails() {
  return {
    ceoEmail: String(CEO_EMAIL).toLowerCase().trim(),
    directorEmail: String(DIRECTOR_EMAIL).toLowerCase().trim()
  };
}

function getIntegrantesData() {
  if (USE_USUARIOS_SHEET) {
    return _getIntegrantesDataFromUsuarios_();
  }
  return _getIntegrantesDataFromIntegrantes_();
}

/**
 * Phase B: lee USUARIOS y devuelve la misma shape que el frontend espera.
 * Las columnas H/I (correos/nombres aprobadores auto) ya vienen resueltas
 * desde la migración o desde el sidebar al guardar.
 */
function _getIntegrantesDataFromUsuarios_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_USUARIOS);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // Cols: A=Cedula B=Nombre C=Correo D=Empresa E=Sede F=CC
  //       G=Cedulas Aprobadores H=Correos Aprobadores I=Nombres Aprobadores
  const data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  return data
    .filter(function(r) { return r[0] && r[2]; })
    .map(function(r) {
      return {
        idNumber: String(r[0]).trim(),
        name: String(r[1]).trim(),
        email: String(r[2]).toLowerCase().trim(),
        approverName: String(r[8] || '').trim(),
        approverEmail: String(r[7] || '').toLowerCase().trim()
      };
    });
}

/**
 * Legacy: lee INTEGRANTES (sección verde + sección roja). Sin tocar.
 */
function _getIntegrantesDataFromIntegrantes_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_INTEGRANTES);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];

  const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = data[0];

  // --- MAPPING CONFIGURATION ---
  // Left Section (Green)
  const idxId1 = headers.indexOf("Cedula Numero");
  const idxName1 = headers.indexOf("Apellidos y Nombres");
  const idxEmail1 = headers.indexOf("correo");
  const idxAppName1 = headers.indexOf("aprobador");
  const idxAppEmail1 = headers.indexOf("correo aprobador");

  // Right Section (Red)
  const idxName2 = headers.indexOf("nombre");
  const idxEmail2 = headers.indexOf("Correo corporativo");
  const idxAppName2 = headers.indexOf("NOMBRE EN LISTA");
  const idxAppEmail2 = headers.indexOf("CORREO"); // Uppercase in CSV

  const integrantes = [];

  for (let i = 1; i < data.length; i++) {
      const row = data[i];

      // 1. Process Left Section
      if (idxName1 > -1 && idxEmail1 > -1) {
          const name = String(row[idxName1]).trim();
          const email = String(row[idxEmail1]).toLowerCase().trim();
          if (name && email) {
              integrantes.push({
                  idNumber: idxId1 > -1 ? String(row[idxId1]).trim() : '',
                  name: name,
                  email: email,
                  approverName: idxAppName1 > -1 ? String(row[idxAppName1]).trim() : '',
                  approverEmail: idxAppEmail1 > -1 ? String(row[idxAppEmail1]).toLowerCase().trim() : ''
              });
          }
      }

      // 2. Process Right Section
      if (idxName2 > -1 && idxEmail2 > -1) {
          const name = String(row[idxName2]).trim();
          const email = String(row[idxEmail2]).toLowerCase().trim();
          if (name && email) {
              const exists = integrantes.some(u => u.email === email);
              if (!exists) {
                  integrantes.push({
                      idNumber: '',
                      name: name,
                      email: email,
                      approverName: idxAppName2 > -1 ? String(row[idxAppName2]).trim() : '',
                      approverEmail: idxAppEmail2 > -1 ? String(row[idxAppEmail2]).toLowerCase().trim() : ''
                  });
              }
          }
      }
  }

  return integrantes;
}

// --- SECURITY: Server-side input validation ---
function validateRequestInput_(data) {
  var errors = [];
  if (!data.requesterEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.requesterEmail)) errors.push('Correo del solicitante inválido.');
  if (!data.company || String(data.company).length > 100) errors.push('Empresa inválida.');
  // Origin es vacío para solicitudes HOTEL_ONLY — solo validar si NO es hotel-only
  if (data.requestMode !== 'HOTEL_ONLY') {
    if (!data.origin || String(data.origin).length > 200) errors.push('Ciudad origen inválida.');
  }
  if (!data.destination || String(data.destination).length > 200) errors.push('Ciudad destino inválida.');
  if (!data.departureDate) errors.push('Fecha de ida requerida.');
  if (!data.passengers || !Array.isArray(data.passengers) || data.passengers.length === 0 || data.passengers.length > 5) {
    errors.push('Debe haber entre 1 y 5 pasajeros.');
  } else {
    data.passengers.forEach(function(p, i) {
      if (!p.name || String(p.name).length > 200) errors.push('Nombre del pasajero ' + (i+1) + ' inválido.');
      if (!p.idNumber || String(p.idNumber).length > 50) errors.push('Cédula del pasajero ' + (i+1) + ' inválida.');
    });
  }
  if (data.comments && String(data.comments).length > 2000) errors.push('Observaciones demasiado largas (máx 2000 caracteres).');
  if (data.workOrder && String(data.workOrder).length > 100) errors.push('Orden de trabajo demasiado larga.');
  if (data.hotelName && String(data.hotelName).length > 200) errors.push('Nombre de hotel demasiado largo.');
  if (data.changeReason && String(data.changeReason).length > 2000) errors.push('Motivo del cambio demasiado largo.');
  if (errors.length > 0) throw new Error('Validación: ' + errors.join(' '));
}

function createNewRequest(data, emailHtml) {
  validateRequestInput_(data);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
  const idColIndex = H("ID RESPUESTA") + 1; 
  
  // Calculate ID
  const lastRow = sheet.getLastRow();
  let nextIdNum = 1;
  // Note: If lastRow is huge due to dropdowns, we might scan it all. 
  // However, for ID calculation we only care about existing IDs.
  if (lastRow > 1) {
    const existingIds = sheet.getRange(2, idColIndex, lastRow - 1, 1).getValues().flat();
    // Robust ID parsing: Extract first numeric sequence found in the string
    const numericIds = existingIds.map(val => {
        const str = String(val);
        const match = str.match(/(\d+)/);
        return match ? parseInt(match[0], 10) : NaN;
    }).filter(val => !isNaN(val));
    
    if (numericIds.length > 0) nextIdNum = Math.max(...numericIds) + 1;
  }
  const id = `SOL-${nextIdNum.toString().padStart(6, '0')}`; 

  // --- RESOLVE COST CENTER NAME ---
  let costCenterName = '';
  if (data.costCenter === 'VARIOS' && data.variousCostCenters) {
      costCenterName = data.variousCostCenters;
  } else {
      const costCenters = getCostCenterData();
      const ccObj = costCenters.find(c => c.code === data.costCenter);
      costCenterName = ccObj ? ccObj.name : '';
  }

  // --- RESOLVE APPROVER ---
  let approverEmail = ADMIN_EMAIL;
  let approverName = 'Por Definir';

  if (data.passengers && data.passengers.length > 0) {
     const integrantes = getIntegrantesData();
     const integrant = integrantes.find(i => i.idNumber === data.passengers[0].idNumber);
     if (integrant && integrant.approverEmail) {
         approverEmail = integrant.approverEmail;
         approverName = integrant.approverName;
     }
  }

  // --- CO-APPROVER RULES (e.g. international flights) ---
  if (data.isInternational && approverEmail && approverEmail !== ADMIN_EMAIL) {
      const coRules = getCoApproverRules_();
      const matches = coRules.filter(r => r.principalEmail === approverEmail.toLowerCase() && r.condition === 'INTERNACIONAL');
      matches.forEach(rule => {
          approverEmail += ',' + rule.coApproverEmail;
          approverName += ', ' + rule.coApproverName;
      });
  }

  let nights = data.nights || 0;
  if (data.requiresHotel && !nights && data.departureDate && data.returnDate) {
      const parseDate = (dStr) => {
          const parts = String(dStr).split('-');
          if (parts.length === 3) return new Date(Number(parts[2]), Number(parts[1])-1, Number(parts[0]));
          return new Date(dStr);
      };
      const d1 = parseDate(data.departureDate);
      const d2 = parseDate(data.returnDate);
      if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
          nights = Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
      }
  }

  // Solo trackea columnas que escribiremos (skip extras en el sheet).
  // Esto preserva validaciones, formatos y datos en columnas no canónicas.
  const writes = {}; // { 0-based-col-idx: value }
  const set = (header, val) => { const i = H(header); if(i>-1) writes[i] = val; };

  set("FECHA SOLICITUD", new Date());
  set("EMPRESA", data.company);
  set("CIUDAD ORIGEN", data.origin);
  set("CIUDAD DESTINO", data.destination);
  set("# ORDEN TRABAJO", data.workOrder || '');
  set("# PERSONAS QUE VIAJAN", data.passengers ? data.passengers.length : 1);
  set("CORREO ENCUESTADO", String(data.requesterEmail).toLowerCase().trim());
  
  const p = data.passengers || [];
  for(let i=0; i<5; i++) {
    set(`CÉDULA PERSONA ${i+1}`, p[i] ? p[i].idNumber : '');
    set(`NOMBRE PERSONA ${i+1}`, p[i] ? p[i].name : '');
  }

  set("CENTRO DE COSTOS", data.costCenter);
  set("VARIOS CENTROS COSTOS", data.variousCostCenters || '');
  set("NOMBRE CENTRO DE COSTOS (AUTOMÁTICO)", costCenterName);
  set("UNIDAD DE NEGOCIO", data.businessUnit);
  set("SEDE", data.site);
  set("REQUIERE HOSPEDAJE", data.requiresHotel ? 'Sí' : 'No');
  // FORCE UPPERCASE HOTEL NAME
  set("NOMBRE HOTEL", (data.hotelName || '').toUpperCase());
  set("# NOCHES (AUTOMÁTICO)", nights);
  set("FECHA IDA", data.departureDate);
  set("FECHA VUELTA", data.returnDate || '');
  set("HORA LLEGADA VUELO IDA", data.departureTimePreference || '');
  set("HORA LLEGADA VUELO VUELTA", data.returnTimePreference || '');
  set("ID RESPUESTA", id);
  set("STATUS", data.status || 'PENDIENTE_OPCIONES');
  set("OBSERVACIONES", data.comments || '');
  
  set("QUIÉN APRUEBA? (AUTOMÁTICO)", approverName);
  set("CORREO DE QUIEN APRUEBA (AUTOMÁTICO)", approverEmail);
  
  set("CORREOS PASAJEROS (JSON)", JSON.stringify(data.passengers.map(p => p.email).filter(e=>e)));

  // NEW LINKED REQUEST FIELDS
  set("ID SOLICITUD PADRE", data.relatedRequestId || '');
  set("TIPO DE SOLICITUD", data.requestType || 'ORIGINAL');
  set("TEXTO_CAMBIO", data.changeReason || '');
  if (data.hasChangeFlag) set("FLAG_CAMBIO_REALIZADO", "CAMBIO GENERADO");

  // METADATA COLUMNS
  if (data.parentWasReserved) set("ES_CAMBIO_CON_COSTO", "SI");
  if (data.parentTimestamp) set("FECHA_SOLICITUD_PADRE", data.parentTimestamp);

  // NEW INTERNATIONAL & POLICY FIELDS
  set("ES INTERNACIONAL", data.isInternational ? "SI" : "NO");
  set("VIOLACION POLITICA", data.policyViolation ? "SI" : "NO");

  // MODO DE SOLICITUD: VIAJE (default) o SOLO_HOSPEDAJE
  set("MODO_SOLICITUD", data.requestMode === 'HOTEL_ONLY' ? 'SOLO_HOSPEDAJE' : 'VIAJE');

  // --- AUTOMATED STATISTICS FIELDS (CREATION) ---
  set("TIPO DE TKT", data.isInternational ? "INTERNACIONAL" : "NACIONAL");

  if (data.departureDate) {
      const today = new Date(); today.setHours(0,0,0,0);
      const depParts = String(data.departureDate).split('-'); 
      if (depParts.length === 3) {
          // Format is DD-MM-YYYY, so depParts[2] is YYYY, depParts[1] is MM, depParts[0] is DD
          const dep = new Date(Number(depParts[2]), Number(depParts[1])-1, Number(depParts[0]));
          const diffTime = dep.getTime() - today.getTime();
          const daysDiff = Math.ceil(diffTime / (1000 * 3600 * 24));
          set("DIAS DE ANTELACION TKT", daysDiff);
      }
  }

  let flightDates = data.departureDate;
  if (data.returnDate) flightDates += " - " + data.returnDate;
  set("FECHA DEL VUELO", flightDates);

  // --- LOGIC CHANGE: Find first empty row in ID column instead of appendRow ---
  // This prevents skipping empty rows caused by pre-filled dropdowns/validation in other columns
  const maxRows = sheet.getMaxRows();
  let targetRow = -1;

  // Scan ID column for the first empty cell
  // We scan from row 2 (index 0 of values)
  if (maxRows > 1) {
      const idValues = sheet.getRange(2, idColIndex, maxRows - 1, 1).getValues().flat();
      const firstEmptyIdx = idValues.findIndex(val => val === "" || val == null);
      if (firstEmptyIdx !== -1) {
          targetRow = firstEmptyIdx + 2; // +2 for header and 0-based index
      }
  }

  if (targetRow === -1) {
     // No empty slot found in current range or sheet is empty/full
     // Append at the end (insert row if needed to be safe)
     targetRow = maxRows + 1;
     sheet.insertRowAfter(maxRows);
  }
  
  // Write ONLY the columns we know about. Extra columns in the sheet
  // (added by admin manually) are NOT touched — preserves their data,
  // validations, and formats. Optimización: agrupa columnas contiguas en
  // batches setValues para minimizar llamadas API. Para sheet canónica
  // (sin extras) → 1 solo batch (misma velocidad que código original).
  var indices = Object.keys(writes).map(Number).sort(function(a, b) { return a - b; });
  if (indices.length > 0) {
    var runStart = indices[0];
    var runValues = [writes[runStart]];
    for (var k = 1; k < indices.length; k++) {
      if (indices[k] === indices[k - 1] + 1) {
        // Continuación del run actual
        runValues.push(writes[indices[k]]);
      } else {
        // Gap detectado → flush run actual y empieza uno nuevo
        sheet.getRange(targetRow, runStart + 1, 1, runValues.length).setValues([runValues]);
        runStart = indices[k];
        runValues = [writes[runStart]];
      }
    }
    // Flush último run
    sheet.getRange(targetRow, runStart + 1, 1, runValues.length).setValues([runValues]);
  }
  // --------------------------------------------------------------------------

  // METRICS: registrar evento de creación
  _recordEvent_(id, 'created');

  data.approverEmail = approverEmail;
  data.approverName = approverName;

  if (emailHtml) {
      sendRequestEmailWithHtml(data, id, emailHtml);
  } else {
      sendNewRequestNotification(data, id);
  }
  
  return id;
}

/**
 * Helper: Get or create a Drive folder for a request.
 * Modificaciones y originales viven al MISMO nivel raíz. El nombre de la
 * carpeta de una modificación tiene el prefix "CAMBIO DE ${parentId}" que
 * deja clara la relación visualmente, pero no se anida físicamente. Esto
 * facilita la navegación del analista en Drive (todo en el root, sin subfolders).
 */
function getOrCreateRequestFolder_(requestId, rowNumber, sheet) {
    const root = DriveApp.getFolderById(ROOT_DRIVE_FOLDER_ID);
    const allFolders = root.getFolders();
    while (allFolders.hasNext()) {
        const f = allFolders.next();
        if (f.getName().indexOf(requestId) === 0) {
            return f;
        }
    }
    return root.createFolder(requestId);
}

// NEW FUNCTION: Upload Option Image (v2.7)
// --- SECURITY: File upload constants ---
var ALLOWED_UPLOAD_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
var MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

function validateFileUpload_(fileData, fileName, mimeType) {
  if (!fileData) throw new Error('Datos del archivo vacíos.');
  if (!fileName || String(fileName).length > 255) throw new Error('Nombre de archivo inválido.');
  var decoded = Utilities.base64Decode(fileData);
  if (decoded.length > MAX_FILE_SIZE_BYTES) throw new Error('Archivo demasiado grande (máximo 10MB).');
  if (mimeType && ALLOWED_UPLOAD_TYPES.indexOf(mimeType) === -1 && mimeType !== MimeType.PNG) {
    // Allow generic PNG from option images even if not in list
    console.warn('Tipo de archivo no estándar: ' + mimeType);
  }
  // Sanitize filename
  return String(fileName).replace(/[\/\\:*?"<>|]/g, '_').substring(0, 200);
}

function uploadOptionImage(requestId, fileData, fileName, type, optionLetter, direction) {
    validateFileUpload_(fileData, fileName, 'image/png');
    if (!/^[A-Z]$/.test(optionLetter)) throw new Error('Letra de opción inválida.');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
    const idIdx = H("ID RESPUESTA");
    const ids = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat();
    const rowIndex = ids.map(String).indexOf(String(requestId));
    if (rowIndex === -1) throw new Error("Solicitud no encontrada");
    const rowNumber = rowIndex + 2;

    // Get or Create Folder (nested inside parent folder if modification)
    const folder = getOrCreateRequestFolder_(requestId, rowNumber, sheet);
    
    // Ensure folder is accessible (optional based on org policy, but needed for public links if not using service account bridging)
    // folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const blob = Utilities.newBlob(Utilities.base64Decode(fileData), MimeType.PNG, fileName); // Assume PNG or detect
    const newName = `Opcion_${optionLetter}_${type}_${requestId}`;
    blob.setName(newName);
    
    const file = folder.createFile(blob);
    // Make file viewable to anyone with link so it can be embedded in emails/app across domains
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const publicUrl = `https://drive.google.com/thumbnail?id=${file.getId()}&sz=w1000`; // CHANGED FROM uc?export=view for reliability
    // Or use file.getThumbnailLink() if size is an issue, but view link is better for quality

    return {
        id: optionLetter,
        type: type,
        direction: direction || null,
        url: publicUrl,
        driveId: file.getId(),
        name: newName
    };
}

function deleteDriveFile(fileId) {
  if (!fileId) return false;
  try {
    const file = DriveApp.getFileById(fileId);
    file.setTrashed(true); // Safer than permanent delete for corporate environments
    return true;
  } catch (e) {
    console.error("Error deleting file: " + e.toString());
    return false;
  }
}

function updateRequestStatus(id, status, payload) {
   const ss = SpreadsheetApp.getActiveSpreadsheet();
   const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
   const idIdx = H("ID RESPUESTA");
   const statusIdx = H("STATUS");
   const ids = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat();
   const rowIndex = ids.map(String).indexOf(String(id));
   if (rowIndex === -1) throw new Error("ID no encontrado");
   const rowNumber = rowIndex + 2;

   sheet.getRange(rowNumber, statusIdx + 1).setValue(status);
   
   // --- STATISTICS ---
   if (status === 'APROBADO') {
       // sheet.getRange(rowNumber, H("APROBADO POR ÁREA?") + 1).setValue("SÍ"); // REMOVED TO PRESERVE DETAILED LOGS
       const paxCountStr = sheet.getRange(rowNumber, H("# PERSONAS QUE VIAJAN") + 1).getValue();
       const paxCount = parseInt(paxCountStr) || 1;
       const retDate = sheet.getRange(rowNumber, H("FECHA VUELTA") + 1).getValue();
       const hasReturn = retDate && String(retDate).trim() !== '';
       const legs = hasReturn ? 2 : 1;
       sheet.getRange(rowNumber, H("Q TKT") + 1).setValue(paxCount * legs);

       // CANCEL PARENT: When a modification is approved, the original request is cancelled
       const parentIdIdx = H("ID SOLICITUD PADRE");
       const parentId = sheet.getRange(rowNumber, parentIdIdx + 1).getValue();

       if (parentId && String(parentId).trim() !== '') {
           const allIds = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat();
           const parentRowIdx = allIds.map(String).indexOf(String(parentId));

           if (parentRowIdx !== -1) {
               const parentRowNum = parentRowIdx + 2;
               sheet.getRange(parentRowNum, statusIdx + 1).setValue('ANULADO');

               const obsIdx = H("OBSERVACIONES");
               const pObs = sheet.getRange(parentRowNum, obsIdx + 1).getValue();
               const cancelNote = `[SISTEMA]: Anulada automáticamente por aprobación del cambio ${id}.`;
               sheet.getRange(parentRowNum, obsIdx + 1).setValue((pObs ? pObs + "\n" : "") + cancelNote);
           }
       }

   } else if (status === 'DENEGADO') {
       // sheet.getRange(rowNumber, H("APROBADO POR ÁREA?") + 1).setValue("NO"); // REMOVED TO PRESERVE DETAILED LOGS
   }

   // --- HANDLING NEW COLUMNS ---
   if (payload) {
       if (payload.analystOptions) {
           const optIdx = H("OPCIONES (JSON)");
           sheet.getRange(rowNumber, optIdx + 1).setValue(JSON.stringify(payload.analystOptions));
       }
       if (payload.selectionDetails) {
           const selIdx = H("SELECCION_TEXTO");
           sheet.getRange(rowNumber, selIdx + 1).setValue(payload.selectionDetails);
       }
       if (payload.finalCostTickets !== undefined) {
           sheet.getRange(rowNumber, H("COSTO_FINAL_TIQUETES") + 1).setValue(payload.finalCostTickets);
       }
       if (payload.finalCostHotel !== undefined) {
           sheet.getRange(rowNumber, H("COSTO_FINAL_HOTEL") + 1).setValue(payload.finalCostHotel);
       }
       if (payload.totalCost !== undefined) {
           // We have a COSTO COTIZADO column, can use that or TOTAL FACTURA? 
           // Let's use COSTO COTIZADO PARA VIAJE as the estimated approved cost
           sheet.getRange(rowNumber, H("COSTO COTIZADO PARA VIAJE") + 1).setValue(payload.totalCost);
       }
   }

   // EMAILS + METRICS
   if (status === 'PENDIENTE_SELECCION') {
      _recordEvent_(id, 'optionsUploaded'); // métricas: analista cargó opciones
      const fullReq = mapRowToRequest(sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0]);
      sendOptionsToRequester(fullReq.requesterEmail, fullReq, payload.analystOptions);
   }

   // NEW: NOTIFY ADMIN WHEN USER MAKES SELECTION
   if (status === 'PENDIENTE_CONFIRMACION_COSTO') {
      _recordEvent_(id, 'selectionMade'); // métricas: usuario describió su selección
      const fullReq = mapRowToRequest(sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0]);
      // The payload contains the new selection details, ensure it's in the object for the email
      if (payload && payload.selectionDetails) {
         fullReq.selectionDetails = payload.selectionDetails;
      }
      sendSelectionNotificationToAdmin(fullReq);
   }

   if (status === 'PENDIENTE_APROBACION') {
      _recordEvent_(id, 'costConfirmed'); // métricas: analista confirmó costos
      // This is now triggered AFTER Admin inputs costs
      const fullReq = mapRowToRequest(sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0]);
      sendApprovalRequestEmail(fullReq);
   }

   if (status === 'APROBADO' || status === 'DENEGADO') {
      const fullReq = mapRowToRequest(sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0]);
      if (status === 'DENEGADO' && payload && payload.denialReason) {
          fullReq.denialReason = payload.denialReason;
      }
      sendDecisionNotification(fullReq, status);
   }
   
   return true;
}

function uploadSupportFile(requestId, fileData, fileName, mimeType, correctionNote) {
  var sanitizedName = validateFileUpload_(fileData, fileName, mimeType);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
  const idIdx = H("ID RESPUESTA");
  const ids = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat();
  const rowIndex = ids.map(String).indexOf(String(requestId));
  if (rowIndex === -1) throw new Error("Solicitud no encontrada");
  const rowNumber = rowIndex + 2;
  const supportIdx = H("SOPORTES (JSON)");

  const jsonStr = sheet.getRange(rowNumber, supportIdx + 1).getValue();
  let supportData = jsonStr ? JSON.parse(jsonStr) : { folderId: null, folderUrl: null, files: [] };

  let folder;
  if (supportData.folderId) { try { folder = DriveApp.getFolderById(supportData.folderId); } catch(e) {} }
  if (!folder) {
     folder = getOrCreateRequestFolder_(requestId, rowNumber, sheet);
     supportData.folderId = folder.getId();
     supportData.folderUrl = folder.getUrl();
  }

  const blob = Utilities.newBlob(Utilities.base64Decode(fileData), mimeType, fileName);
  const file = folder.createFile(blob);
  var fileEntry = { id: file.getId(), name: file.getName(), url: file.getUrl(), mimeType: mimeType, date: new Date().toISOString() };
  if (correctionNote) fileEntry.isCorrection = true;
  supportData.files.push(fileEntry);

  sheet.getRange(rowNumber, supportIdx + 1).setValue(JSON.stringify(supportData));

  // Si es corrección de reserva, notificar al usuario por correo
  if (correctionNote) {
    try {
      var rowData = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
      var req = mapRowToRequest(rowData);
      var isHotelOnly = req.requestMode === 'HOTEL_ONLY';
      var fileUrl = 'https://drive.google.com/file/d/' + file.getId() + '/view?usp=sharing';
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      var content = '<p style="color:#111827; font-size:14px; margin-bottom:12px;">El área de viajes ha cargado un <strong>documento corregido</strong> para su solicitud <strong>' + escapeHtml_(requestId) + '</strong>.</p>';
      if (correctionNote) {
        content += '<div style="background-color:#fffbeb; border:1px solid #fde68a; color:#92400e; padding:12px 14px; border-radius:6px; font-size:13px; margin-bottom:16px;"><strong>Nota:</strong> ' + escapeHtml_(correctionNote) + '</div>';
      }
      content += '<div style="text-align:center; margin:20px 0;"><a href="' + escapeHtml_(fileUrl) + '" style="background-color:#2563eb; color:white; padding:10px 20px; text-decoration:none; border-radius:4px; font-weight:bold; font-size:13px; display:inline-block;">Descargar Archivo Corregido</a></div>';
      content += '<hr style="border:0; border-top:1px solid #e5e7eb; margin:24px 0;">' + HtmlTemplates._getFullSummary(req);

      var html = HtmlTemplates.layout(requestId, content, '#f59e0b', isHotelOnly ? 'CORRECCIÓN DE RESERVA' : 'CORRECCIÓN DE TIQUETE');
      var subject = getStandardSubject(req); // same thread
      sendEmailRich(req.requesterEmail, subject, html, getCCList(req));
    } catch (e) {
      console.error("Error enviando correo de corrección: " + e);
    }
  }

  return supportData;
}

function sendRequestEmailWithHtml(data, requestId, htmlTemplate) {
    const isModification = data.requestType === 'MODIFICACION';
    let baseHtml = htmlTemplate.replace("{{REQUEST_ID}}", requestId);

    if (isModification) {
        // --- 1. EMAIL FOR ADMIN (WITH BUTTONS) ---
        let adminActions = `
           <div style="background-color:#fffbeb; border:1px solid #fde68a; color:#92400e; padding:10px 12px; border-radius:6px; font-size:12px; margin-bottom:14px; text-align:left;">
               Puede pasarla a estudio o denegarla con los botones de abajo, o desde el <strong>Panel de Administración</strong> (botón "Revisar Cambio" en la fila de la solicitud). Mientras tanto, los recordatorios de la solicitud original <strong>${escapeHtml_(data.relatedRequestId || '')}</strong> quedan pausados.
           </div>
           <div style="margin-bottom: 15px;">
               <a href="${WEB_APP_URL}?action=study_decision&id=${requestId}&decision=study" style="background-color: #059669; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold; margin-right: 10px; display: inline-block;">PASAR A ESTUDIO</a>
               <a href="${WEB_APP_URL}?action=study_decision&id=${requestId}&decision=reject" style="background-color: #dc2626; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block; margin-right: 10px;">RECHAZAR CAMBIO</a>
           </div>
           <div>
               <a href="${PLATFORM_URL}" style="background-color: #1f2937; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; font-size: 12px; display: inline-block;">VER EN LA APP</a>
           </div>
        `;
        const adminHtml = baseHtml.replace("{{ACTION_BUTTONS}}", adminActions);

        // Subject for Admin
        const adminSubject = getStandardSubject({ ...data, requestId }) + " [MODIFICACIÓN REQUERIDA]";

        try {
            // Send to Admin ONLY (No CC to user to avoid leaking buttons)
            sendEmailRich(ADMIN_EMAIL, adminSubject, adminHtml, null);
        } catch (e) { console.error("Error sending admin mod email: " + e); }


        // --- 2. EMAIL FOR USER (INFORMATIVE ONLY) ---
        let userActions = `
            <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; padding: 15px; border-radius: 6px; text-align: left; color: #1e3a8a;">
                <p style="margin: 0 0 6px 0; font-weight: bold; font-size: 14px;">Solicitud de cambio enviada</p>
                <p style="margin: 0; font-size: 13px; line-height: 1.55;">
                    El área de viajes evaluará el cambio solicitado. Mientras tanto, <strong>los recordatorios de su solicitud original ${escapeHtml_(data.relatedRequestId || '')} quedan pausados</strong> para evitarle confusión. Recibirá un correo cuando el cambio sea aceptado o rechazado, y a partir de ahí el proceso continuará normalmente sobre esta nueva solicitud.
                </p>
            </div>
        `;
        const userHtml = baseHtml.replace("{{ACTION_BUTTONS}}", userActions);

        // Subject for User
        const userSubject = getStandardSubject({ ...data, requestId }) + " [SOLICITUD ENVIADA]";
        const ccList = getCCList(data);

        try {
            sendEmailRich(data.requesterEmail, userSubject, userHtml, ccList);
        } catch (e) { console.error("Error sending user mod email: " + e); }

    } else {
        // --- STANDARD FLOW (NEW REQUEST) ---
        // Both Admin and User get the same email (Admin uses it to enter, User uses it as receipt)
        // Since "Ingresar a la Plataforma" button is harmless for users (they just see their dashboard), we keep it simple.
        let actionsHtml = `
            <a href="${PLATFORM_URL}" style="background-color: #111827; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">INGRESAR A LA PLATAFORMA</a>
        `;

        const finalHtml = baseHtml.replace("{{ACTION_BUTTONS}}", actionsHtml);
        const subject = getStandardSubject({ ...data, requestId });

        // Self-approver / executive: omit requester from CC. They'll receive the
        // approval email later (and the options/decision emails) — no need to spam
        // them with the initial creation notification too. Other passengers stay in CC.
        const requesterLower = String(data.requesterEmail || '').toLowerCase().trim();
        const approverEmailsLower = String(data.approverEmail || '').toLowerCase()
            .split(',').map(function(e) { return e.trim(); }).filter(function(e) { return e; });
        const requesterIsApprover = approverEmailsLower.indexOf(requesterLower) !== -1;
        const requesterIsExecutive = requesterLower === CEO_EMAIL.toLowerCase()
                                  || requesterLower === DIRECTOR_EMAIL.toLowerCase();

        let ccEmails;
        if (requesterIsApprover || requesterIsExecutive) {
            // getCCList already excludes the requester from the passenger list
            ccEmails = getCCList(data);
        } else {
            ccEmails = [data.requesterEmail, getCCList(data)].filter(function(e) { return e; }).join(',');
        }

        try {
            sendEmailRich(ADMIN_EMAIL, subject, finalHtml, ccEmails);
        } catch (e) { console.error("Error sending standard email: " + e); }
    }
}

function getCCList(request) {
    const requester = request.requesterEmail;
    const pEmails = (request.passengers || []).map(p => p.email).filter(e => e && e.toLowerCase() !== requester.toLowerCase());
    return pEmails.join(',');
}

function sendNewRequestNotification(data, requestId) {
    const subject = getStandardSubject({ ...data, requestId });
    try { MailApp.sendEmail({ to: ADMIN_EMAIL, subject: subject, body: "Nueva Solicitud: " + requestId }); } catch (e) {}
}

function sendOptionsToRequester(to, req, opts) {
   const link = PLATFORM_URL;
   const html = HtmlTemplates.optionsAvailable(req, opts, link);
   try { sendEmailRich(to, getStandardSubject(req), html, getCCList(req)); } catch(e) {
       console.error("Error sending options to requester: " + e);
   }
}

// NEW FUNCTION
function sendSelectionNotificationToAdmin(req) {
    const html = HtmlTemplates.userSelectionNotification(req);
    try { 
        sendEmailRich(ADMIN_EMAIL, "Selección Realizada - Solicitud " + req.requestId, html, null);
    } catch(e) { console.error("Error sending admin selection notification: " + e); }
}

function sendDecisionNotification(req, status) {
  const html = HtmlTemplates.decisionNotification(req, status);
  try { sendEmailRich(req.requesterEmail, getStandardSubject(req), html, ADMIN_EMAIL + ',' + getCCList(req)); } catch(e){
      console.error("Error sending decision notification: " + e);
  }
}

function sendApprovalRequestEmail(req) {
    const requesterLower = String(req.requesterEmail || '').toLowerCase().trim();
    const ceoLower = String(CEO_EMAIL).toLowerCase().trim();
    const cdsLower = String(DIRECTOR_EMAIL).toLowerCase().trim();
    const requesterIsCeo = requesterLower === ceoLower;
    const requesterIsCds = requesterLower === cdsLower;

    const totalCost = Number(req.totalCost) || 0;
    const requiresExecutiveApproval = req.isInternational || totalCost > 1200000;
    const subject = getStandardSubject(req) + " - APROBACIÓN REQUERIDA";

    const sendOne = function(email, role) {
        const approveLink = `${WEB_APP_URL}?action=approve&id=${req.requestId}&decision=approved&role=${role}&actor=${encodeURIComponent(email || '')}`;
        const rejectLink = `${WEB_APP_URL}?action=approve&id=${req.requestId}&decision=denied&role=${role}&actor=${encodeURIComponent(email || '')}`;
        const html = HtmlTemplates.approvalRequest(req, req.selectedOption, approveLink, rejectLink);
        sendEmailRich(email, subject, html, null);
    };

    // CASE 1: requester IS the CEO → only CEO needs to approve. Skip everyone else.
    if (requesterIsCeo) {
        sendOne(CEO_EMAIL, 'CEO');
        return;
    }
    // CASE 2: requester IS the CDS → only CDS needs to approve. Skip everyone else.
    if (requesterIsCds) {
        sendOne(DIRECTOR_EMAIL, 'CDS');
        return;
    }

    // CASE 3: standard flow with deduplication.
    // Build a plan: email_lower → { email, role } so each address only gets ONE email.
    // Priority of role assignment: executive (CEO/CDS) outranks NORMAL — if a person is
    // BOTH the area approver AND CEO/CDS, send them a single email with the executive
    // role. The completion check (processApprovalFromEmail) recognizes that the executive
    // approval implicitly satisfies the area requirement when the area approver IS that
    // executive (effectiveAreaApproved logic).
    const planned = new Map();

    if (requiresExecutiveApproval) {
        planned.set(ceoLower, { email: CEO_EMAIL, role: 'CEO' });
        planned.set(cdsLower, { email: DIRECTOR_EMAIL, role: 'CDS' });
    }

    const approverEmails = String(req.approverEmail || '').split(',').map(function(e) { return e.trim(); }).filter(function(e) { return e; });
    approverEmails.forEach(function(email) {
        const lower = email.toLowerCase();
        if (!planned.has(lower)) {
            planned.set(lower, { email: email, role: 'NORMAL' });
        }
    });

    planned.forEach(function(entry) {
        sendOne(entry.email, entry.role);
    });
}

// --- SECURITY: Analyst whitelist (replaces insecure string-matching) ---
function isUserAnalyst(email) {
  const whitelist = getAnalystWhitelist_();
  return whitelist.includes(String(email).toLowerCase().trim());
}

function getAnalystWhitelist_() {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty('ANALYST_EMAILS');
  if (cached) {
    try {
      return JSON.parse(cached).map(function(e) { return e.toLowerCase().trim(); });
    } catch(err) { /* fall through to default */ }
  }
  // Default: only the configured admin email
  return [ADMIN_EMAIL.toLowerCase().trim()];
}

/**
 * One-time setup: call from GAS editor to configure analyst emails.
 * Example: setAnalystWhitelist(['apcompras@equitel.com.co', 'analista@equitel.com.co'])
 */
function setAnalystWhitelist(emails) {
  if (!Array.isArray(emails) || emails.length === 0) throw new Error('Debe proporcionar un array de correos.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('ANALYST_EMAILS', JSON.stringify(emails.map(function(e) { return e.toLowerCase().trim(); })));
  return true;
}

/**
 * Computes the "effective" approval status for each role (Area, CEO, CDS) of a request,
 * applying the same rules as sendApprovalRequestEmail + processApprovalFromEmail.
 * Returns one of: 'APPROVED' | 'DENIED' | 'PENDING' | 'NA' for each role,
 * plus a human-readable reason when the role is NA, so the UI can explain WHY.
 */
function computeEffectiveApprovalStatus_(requesterEmail, approverEmail, isInternational, totalCost, areaVal, ceoVal, cdsVal) {
  const startsWithSi = function(v) { return String(v || '').startsWith('Sí'); };
  const startsWithNo = function(v) { return String(v || '').startsWith('No'); };

  const areaApproved = startsWithSi(areaVal);
  const areaDenied = startsWithNo(areaVal);
  const ceoApproved = startsWithSi(ceoVal);
  const ceoDenied = startsWithNo(ceoVal);
  const cdsApproved = startsWithSi(cdsVal);
  const cdsDenied = startsWithNo(cdsVal);

  const requesterLower = String(requesterEmail || '').toLowerCase().trim();
  const ceoLower = String(CEO_EMAIL).toLowerCase().trim();
  const cdsLower = String(DIRECTOR_EMAIL).toLowerCase().trim();
  const requesterIsCeo = requesterLower === ceoLower;
  const requesterIsCds = requesterLower === cdsLower;

  const assignedAreaApprovers = String(approverEmail || '').toLowerCase()
      .split(',').map(function(e) { return e.trim(); }).filter(function(e) { return e; });
  const ceoIsAreaApprover = assignedAreaApprovers.indexOf(ceoLower) !== -1;
  const cdsIsAreaApprover = assignedAreaApprovers.indexOf(cdsLower) !== -1;

  const requiresExecutive = isInternational || (Number(totalCost) || 0) > 1200000;

  var area = 'PENDING', areaReason = '';
  var ceo = 'PENDING', ceoReason = '';
  var cds = 'PENDING', cdsReason = '';

  if (requesterIsCeo) {
    // CEO is the requester → only CEO needs to approve. Everything else is N/A.
    area = 'NA'; areaReason = 'El solicitante es el CEO; su sola aprobación cubre el rol de área.';
    cds = 'NA'; cdsReason = 'Cuando el CEO solicita, no requiere aprobación adicional del Director CDS.';
    if (ceoApproved) ceo = 'APPROVED';
    else if (ceoDenied) ceo = 'DENIED';
    else ceo = 'PENDING';
  } else if (requesterIsCds) {
    // CDS is the requester → only CDS needs to approve.
    area = 'NA'; areaReason = 'El solicitante es el Director CDS; su sola aprobación cubre el rol de área.';
    ceo = 'NA'; ceoReason = 'Cuando el Director CDS solicita, no requiere aprobación adicional del CEO.';
    if (cdsApproved) cds = 'APPROVED';
    else if (cdsDenied) cds = 'DENIED';
    else cds = 'PENDING';
  } else {
    // Standard case
    // AREA: direct approval, OR implicit when the area approver IS the CEO/CDS who already clicked
    if (areaApproved || (ceoIsAreaApprover && ceoApproved) || (cdsIsAreaApprover && cdsApproved)) {
      area = 'APPROVED';
    } else if (areaDenied || (ceoIsAreaApprover && ceoDenied) || (cdsIsAreaApprover && cdsDenied)) {
      area = 'DENIED';
    } else {
      area = 'PENDING';
    }

    if (requiresExecutive) {
      if (ceoApproved) ceo = 'APPROVED';
      else if (ceoDenied) ceo = 'DENIED';
      else ceo = 'PENDING';

      if (cdsApproved) cds = 'APPROVED';
      else if (cdsDenied) cds = 'DENIED';
      else cds = 'PENDING';
    } else {
      ceo = 'NA'; ceoReason = 'Solicitud nacional y bajo $1.200.000 — no requiere aprobación ejecutiva.';
      cds = 'NA'; cdsReason = 'Solicitud nacional y bajo $1.200.000 — no requiere aprobación ejecutiva.';
    }
  }

  return {
    area: area, areaReason: areaReason,
    ceo: ceo, ceoReason: ceoReason,
    cds: cds, cdsReason: cdsReason,
    requesterIsCeo: requesterIsCeo,
    requesterIsCds: requesterIsCds,
    ceoIsAreaApprover: ceoIsAreaApprover,
    cdsIsAreaApprover: cdsIsAreaApprover,
    requiresExecutive: requiresExecutive
  };
}

function mapRowToRequest(row) {
  const get = (h) => { const i = H(h); return (i>-1 && i<row.length) ? row[i] : ''; };
  const safeDate = (v) => { if(!v)return ''; if(v instanceof Date) return v.toISOString().split('T')[0]; return String(v).split('T')[0]; };
  const safeTime = (v) => {
      if (!v) return '';
      if (v instanceof Date) {
          const h = v.getHours().toString().padStart(2, '0');
          const m = v.getMinutes().toString().padStart(2, '0');
          return `${h}:${m}`;
      }
      return String(v);
  };
  const getTimestampStr = (v) => {
      if (!v) return '';
      if (v instanceof Date) return `${v.getDate()}/${v.getMonth()+1}/${v.getFullYear()} ${v.getHours()}:${v.getMinutes()}`;
      return String(v);
  };
  
  let passengers = [];
  let pEmails = [];
  try { pEmails = JSON.parse(get("CORREOS PASAJEROS (JSON)") || '[]'); } catch(e){}
  
  for(let i=1; i<=5; i++) {
     const name = get(`NOMBRE PERSONA ${i}`);
     const id = get(`CÉDULA PERSONA ${i}`);
     if(name) passengers.push({ name: String(name), idNumber: String(id), email: pEmails[i-1] || '' });
  }

  let analystOptions = [], selectedOption = null, supportData = undefined;
  try { analystOptions = JSON.parse(get("OPCIONES (JSON)") || '[]'); } catch(e){}
  try { selectedOption = JSON.parse(get("SELECCION (JSON)") || 'null'); } catch(e){}
  try { supportData = JSON.parse(get("SOPORTES (JSON)") || 'null'); } catch(e){}

  const areaVal = String(get("APROBADO POR ÁREA? (AUTOMÁTICO)"));
  const areaTimeVal = getTimestampStr(get("FECHA/HORA (AUTOMÁTICO)"));
  const approvalStatusArea = areaVal && areaTimeVal ? `${areaVal}_${areaTimeVal}` : areaVal;

  const result = {
    requestId: String(get("ID RESPUESTA")),
    relatedRequestId: String(get("ID SOLICITUD PADRE")),
    requestType: String(get("TIPO DE SOLICITUD")),
    timestamp: String(get("FECHA SOLICITUD")),
    company: String(get("EMPRESA")),
    origin: String(get("CIUDAD ORIGEN")),
    destination: String(get("CIUDAD DESTINO")),
    requesterEmail: String(get("CORREO ENCUESTADO")),
    status: String(get("STATUS")),
    departureDate: safeDate(get("FECHA IDA")),
    returnDate: safeDate(get("FECHA VUELTA")),
    passengers,
    costCenter: String(get("CENTRO DE COSTOS")),
    costCenterName: String(get("NOMBRE CENTRO DE COSTOS (AUTOMÁTICO)")),
    variousCostCenters: String(get("VARIOS CENTROS COSTOS")),
    workOrder: String(get("# ORDEN TRABAJO")),
    businessUnit: String(get("UNIDAD DE NEGOCIO")),
    site: String(get("SEDE")),
    requiresHotel: get("REQUIERE HOSPEDAJE") === 'Sí',
    hotelName: String(get("NOMBRE HOTEL")),
    nights: Number(get("# NOCHES (AUTOMÁTICO)")) || 0,
    approverName: String(get("QUIÉN APRUEBA? (AUTOMÁTICO)")),
    approverEmail: String(get("CORREO DE QUIEN APRUEBA (AUTOMÁTICO)")),
    analystOptions, selectedOption, supportData,
    departureTimePreference: safeTime(get("HORA LLEGADA VUELO IDA")),
    returnTimePreference: safeTime(get("HORA LLEGADA VUELO VUELTA")),
    // Oculta el marcador interno de consulta para que no aparezca en correos/UI.
    comments: String(get("OBSERVACIONES")).split(USER_CONSULT_MARKER).join('').replace(/\n{3,}/g, '\n\n'),
    changeReason: String(get("TEXTO_CAMBIO")),
    hasChangeFlag: get("FLAG_CAMBIO_REALIZADO") === "CAMBIO GENERADO",
    isInternational: get("ES INTERNACIONAL") === "SI",
    policyViolation: get("VIOLACION POLITICA") === "SI",
    approvalStatusCDS: String(get("APROBADO CDS")),
    approvalStatusCEO: String(get("APROBADO CEO")),
    approvalStatusArea: approvalStatusArea,

    // NEW FIELDS MAPPING
    selectionDetails: String(get("SELECCION_TEXTO")),
    finalCostTickets: Number(get("COSTO_FINAL_TIQUETES")) || 0,
    finalCostHotel: Number(get("COSTO_FINAL_HOTEL")) || 0,
    totalCost: Number(get("COSTO COTIZADO PARA VIAJE")) || 0,
    daysInAdvance: Number(get("DIAS DE ANTELACION TKT")) || 0,

    // RESERVATION MAPPING (Requires flushing or reading new value)
    reservationNumber: String(get("No RESERVA")),
    // For Reservation URL, we don't have a direct column, but we can try to extract it from supportData if marked
    reservationUrl: supportData?.files?.find(f => f.isReservation)?.url,

    parentWasReserved: get("ES_CAMBIO_CON_COSTO") === "SI",
    parentTimestamp: String(get("FECHA_SOLICITUD_PADRE")),

    // CREDIT CARD (v2.5+)
    creditCard: String(get("TARJETA DE CREDITO CON LA QUE SE HIZO LA COMPRA")),

    // Request mode: 'HOTEL_ONLY' when MODO_SOLICITUD='SOLO_HOSPEDAJE', default 'FLIGHT'
    requestMode: get("MODO_SOLICITUD") === 'SOLO_HOSPEDAJE' ? 'HOTEL_ONLY' : 'FLIGHT'
  };

  // Compute and attach the EFFECTIVE approval status (mirrors the rules in
  // sendApprovalRequestEmail and processApprovalFromEmail). This lets the
  // frontend show consistent UI even in the special cases where the deduped
  // approval flow leaves some columns blank.
  const requesterEmailRaw = String(get("CORREO ENCUESTADO"));
  const approverEmailRaw = String(get("CORREO DE QUIEN APRUEBA (AUTOMÁTICO)"));
  const eff = computeEffectiveApprovalStatus_(
      requesterEmailRaw,
      approverEmailRaw,
      result.isInternational,
      result.totalCost,
      get("APROBADO POR ÁREA? (AUTOMÁTICO)"),
      get("APROBADO CEO"),
      get("APROBADO CDS")
  );
  result.effectiveApprovalArea = eff.area;
  result.effectiveApprovalAreaReason = eff.areaReason;
  result.effectiveApprovalCeo = eff.ceo;
  result.effectiveApprovalCeoReason = eff.ceoReason;
  result.effectiveApprovalCds = eff.cds;
  result.effectiveApprovalCdsReason = eff.cdsReason;
  result.requesterIsCeo = eff.requesterIsCeo;
  result.requesterIsCds = eff.requesterIsCds;
  result.ceoIsAreaApprover = eff.ceoIsAreaApprover;
  result.cdsIsAreaApprover = eff.cdsIsAreaApprover;
  result.requiresExecutiveApproval = eff.requiresExecutive;

  return result;
}

// --- CRON JOBS / TRIGGERS ---

/**
 * Función para ser ejecutada por un Trigger de Tiempo (ej. cada 2 horas).
 * Revisa solicitudes PENDIENTE_APROBACION y envía recordatorios solo a quienes faltan.
 */
/**
 * Devuelve un Set con los IDs de solicitudes cuyos recordatorios deben
 * pausarse. Una solicitud queda en pausa si:
 *   1. Tiene al menos una solicitud de cambio (hija) en estado NO terminal
 *      — el usuario ya señaló que no la quiere más y está esperando la
 *      decisión del admin sobre el cambio.
 *   2. Tiene el marcador USER_CONSULT_MARKER en OBSERVACIONES — el admin
 *      consultó al usuario si desea continuar o anular, y se está esperando
 *      esa respuesta.
 *
 * Estados terminales de hija (no cuentan): DENEGADO, ANULADO.
 *
 * @param {Array<Array>} data Filas de la hoja (sin headers)
 * @returns {Set<string>} Set de IDs de solicitudes pausadas
 */
function _computePausedParentIds_(data) {
  const parents = new Set();
  const idCol = H("ID RESPUESTA");
  const parentIdCol = H("ID SOLICITUD PADRE");
  const statusCol = H("STATUS");
  const obsCol = H("OBSERVACIONES");
  if (idCol < 0 || parentIdCol < 0 || statusCol < 0 || obsCol < 0) return parents;

  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    // (1) Hija activa → pausa al padre
    const parentId = String(r[parentIdCol] || '').trim();
    if (parentId) {
      const status = String(r[statusCol] || '').trim();
      if (status !== 'DENEGADO' && status !== 'ANULADO') {
        parents.add(parentId);
      }
    }
    // (2) Marcador de consulta al usuario en observaciones → pausa a sí misma
    const obs = String(r[obsCol] || '');
    if (obs.indexOf(USER_CONSULT_MARKER) !== -1) {
      const ownId = String(r[idCol] || '').trim();
      if (ownId) parents.add(ownId);
    }
  }
  return parents;
}

function sendPendingApprovalReminders() {
  if (!isWorkingHour()) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
  const data = sheet.getDataRange().getValues();
  // Asumimos fila 1 headers, datos desde fila 2

  // Indices
  const statusIdx = H("STATUS");
  const areaApproveIdx = H("APROBADO POR ÁREA?");
  const cdsApproveIdx = H("APROBADO CDS");
  const ceoApproveIdx = H("APROBADO CEO");

  // Calcula qué padres están pausadas por una solicitud de cambio activa
  const pausedParentIds = _computePausedParentIds_(data.slice(1));

  // Contadores para log
  let remindersSent = 0;
  const today = Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM-dd");

  // Empezar desde fila 2 (índice 1)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = row[statusIdx];

    if (status === 'PENDIENTE_APROBACION') {
      const request = mapRowToRequest(row); // Reutilizamos el mapper existente

      // SKIP IF FLIGHT DATE PASSED (v2.1)
      if (request.departureDate && request.departureDate < today) {
          continue;
      }

      // SKIP si esta solicitud tiene una solicitud de cambio activa
      if (pausedParentIds.has(String(request.requestId))) {
          continue;
      }
      let recipients = [];

      const isAreaApproved = String(row[areaApproveIdx]).startsWith("Sí");
      const totalCost = Number(request.totalCost) || 0;
      const requiresExecutiveApproval = request.isInternational || totalCost > 1200000;
      
      if (requiresExecutiveApproval) {
         const isCdsApproved = String(row[cdsApproveIdx]).startsWith("Sí");
         const isCeoApproved = String(row[ceoApproveIdx]).startsWith("Sí");

         // Lógica Ejecutiva: Solo notificar a quien falte
         if (!isAreaApproved && request.approverEmail) {
             const emails = request.approverEmail.split(',').map(e => e.trim()).filter(e => e);
             emails.forEach(e => recipients.push({email: e, role: 'NORMAL'}));
         }
         if (!isCdsApproved) recipients.push({email: DIRECTOR_EMAIL, role: 'CDS'});
         if (!isCeoApproved) recipients.push({email: CEO_EMAIL, role: 'CEO'});

      } else {
         // Lógica Nacional
         if (!isAreaApproved && request.approverEmail) {
             const emails = request.approverEmail.split(',').map(e => e.trim()).filter(e => e);
             emails.forEach(e => recipients.push({email: e, role: 'NORMAL'}));
         }
      }

      // Enviar correos a los identificados
      if (recipients.length > 0) {
         recipients.forEach(target => {
             if (remindersSent >= MAX_REMINDER_EMAILS_PER_RUN) return;
             sendReminderEmail(request, target.email, target.role);
             remindersSent++;
         });
      }
      if (remindersSent >= MAX_REMINDER_EMAILS_PER_RUN) break;
    }
  }
  console.log(`Ejecución de recordatorios finalizada. Correos enviados: ${remindersSent}` + (remindersSent >= MAX_REMINDER_EMAILS_PER_RUN ? ' (CAP alcanzado)' : ''));
}

function sendReminderEmail(req, toEmail, role) {
    // Generamos los links igual que en el flujo normal
    const approveLink = `${WEB_APP_URL}?action=approve&id=${req.requestId}&decision=approved&role=${role}&actor=${encodeURIComponent(toEmail || '')}`;
    const rejectLink = `${WEB_APP_URL}?action=approve&id=${req.requestId}&decision=denied&role=${role}&actor=${encodeURIComponent(toEmail || '')}`;

    // Reutilizamos la plantilla de aprobación
    let htmlBody = HtmlTemplates.approvalRequest(req, req.selectedOption, approveLink, rejectLink);
    
    // INYECTAR AVISO DE RECORDATORIO
    // Buscamos el inicio del body y agregamos un banner rojo/naranja
    const reminderBanner = `
      <div style="background-color: #fff7ed; border: 1px solid #fed7aa; color: #c2410c; padding: 10px; text-align: center; font-weight: bold; font-size: 14px; margin-bottom: 15px; border-radius: 4px;">
         ⏰ RECORDATORIO: Esta solicitud requiere su atención
      </div>
    `;
    
    // Insertamos el banner antes del primer párrafo
    htmlBody = htmlBody.replace('<p style="color: #4b5563;', reminderBanner + '<p style="color: #4b5563;');

    const subject = getStandardSubject(req) + " - APROBACIÓN REQUERIDA"; // Mismo asunto exacto para threading

    try {
        MailApp.sendEmail({
            to: toEmail,
            subject: subject,
            htmlBody: htmlBody
        });
    } catch (e) {
        console.error(`Error enviando recordatorio a ${toEmail} para ${req.requestId}: ${e}`);
    }
}

/**
 * RECORDATORIO A USUARIOS PENDIENTES DE SELECCIÓN.
 *
 * Recorre solicitudes en estado PENDIENTE_SELECCION y le envía un recordatorio
 * al solicitante para que ingrese al portal y describa su elección de opción.
 *
 * Diseñado para ser ejecutado por un Trigger de Tiempo (sugerido cada 2 horas,
 * mismo intervalo que sendPendingApprovalReminders). El usuario crea el trigger
 * manualmente desde el editor GAS:
 *   Triggers → + Add Trigger → función `sendPendingSelectionReminders`,
 *   event source = Time-driven, type = Hours timer, every 2 hours.
 *
 * Respeta:
 * - Horario laboral (isWorkingHour) — no spamea fuera de horario
 * - Fecha de vuelo pasada — skipea solicitudes ya vencidas (abandonadas)
 * - Mismo asunto que el correo de cargue de opciones → queda en el mismo hilo
 *   en Gmail, el usuario ve toda la cadena junta (incluyendo las imágenes
 *   originales). El cuerpo es liviano: solo banner + link al portal, sin
 *   re-enviar las opciones (las puede ver en el correo anterior del hilo).
 */
function sendPendingSelectionReminders() {
  if (!isWorkingHour()) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const statusIdx = H("STATUS");

  // Calcula qué padres están pausadas por una solicitud de cambio activa
  const pausedParentIds = _computePausedParentIds_(data);

  const today = Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM-dd");
  let remindersSent = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (row[statusIdx] !== 'PENDIENTE_SELECCION') continue;

    const request = mapRowToRequest(row);
    if (!request.requesterEmail) continue;

    // Skip si la fecha de vuelo ya pasó (solicitud abandonada)
    if (request.departureDate && request.departureDate < today) continue;

    // Skip si tiene una solicitud de cambio activa
    if (pausedParentIds.has(String(request.requestId))) continue;

    sendUserSelectionReminderEmail_(request);
    remindersSent++;
    if (remindersSent >= MAX_REMINDER_EMAILS_PER_RUN) break;
  }

  console.log('Recordatorios de selección enviados: ' + remindersSent + (remindersSent >= MAX_REMINDER_EMAILS_PER_RUN ? ' (CAP alcanzado)' : ''));
}

function sendUserSelectionReminderEmail_(req) {
  const subject = getStandardSubject(req); // Mismo asunto = mismo hilo en Gmail
  const isHotelOnlyRem = req.requestMode === 'HOTEL_ONLY';

  const banner = `
    <div style="background-color: #fff7ed; border: 1px solid #fed7aa; color: #c2410c; padding: 12px 14px; text-align: left; font-weight: bold; font-size: 14px; margin-bottom: 18px; border-radius: 6px;">
      ⏰ RECORDATORIO: Tienes opciones de ${isHotelOnlyRem ? 'hospedaje' : 'viaje'} pendientes de seleccionar
    </div>
  `;

  const body = `
    <p style="margin-bottom: 14px; color: #4b5563; font-size: 13px; line-height: 1.55;">
      Hola, este es un recordatorio amistoso para tu solicitud de ${isHotelOnlyRem ? 'hospedaje' : 'viaje'}
      <strong>${escapeHtml_(req.requestId)}</strong> con destino
      <strong>${escapeHtml_(req.destination)}</strong>.
    </p>
    <p style="margin-bottom: 14px; color: #4b5563; font-size: 13px; line-height: 1.55;">
      El área de viajes ya cargó las opciones. Por favor ingresa al portal y
      describe cuál opción de ${isHotelOnlyRem ? 'hotel' : ('vuelo' + (req.requiresHotel ? ' y hotel' : ''))} deseas
      tomar (recuerda <strong>indicar siempre la categoría</strong>: ${isHotelOnlyRem ? 'tipo de habitación — Estándar, Superior, Suite' : 'Económica, Premium, Business' + (req.requiresHotel ? ', tipo de habitación' : '')}, etc.).
    </p>
    <div style="background-color: #fef3c7; border: 1px solid #fde68a; color: #92400e; padding: 10px 12px; margin-bottom: 18px; border-radius: 6px; font-size: 12px;">
      <strong>Tip:</strong> Las opciones (con sus imágenes) están en el correo
      anterior de este mismo hilo. Solo necesitas ir al portal y escribir tu
      elección.
    </div>
    <div style="text-align: center; margin: 24px 0 8px;">
      <a href="${PLATFORM_URL}" style="background-color: #D71920; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px; display: inline-block;">INGRESAR Y SELECCIONAR</a>
    </div>
  `;

  const html = HtmlTemplates.layout(req.requestId, banner + body, '#c2410c', 'RECORDATORIO DE SELECCIÓN');

  try {
    MailApp.sendEmail({
      to: req.requesterEmail,
      subject: subject,
      htmlBody: html
    });
  } catch (e) {
    console.error(`Error enviando recordatorio de selección a ${req.requesterEmail} para ${req.requestId}: ${e}`);
  }
}

/**
 * PERIODIC TASK: Send reminders to Admin for pending actions (v1.9)
 * Should be triggered every 2 hours manually via Triggers.
 */
/**
 * RECORDATORIO DE CONSULTA AL USUARIO.
 *
 * Recorre solicitudes que tengan el marcador USER_CONSULT_MARKER en
 * OBSERVACIONES y reenvía el correo de consulta (CONTINUAR/ANULAR) al
 * solicitante. Útil cuando el usuario no respondió al primer correo.
 *
 * Diseñado para ejecutarse por Trigger de Tiempo (cada 2 horas).
 *   Triggers → + Add Trigger → función `sendPendingConsultReminders`,
 *   event source = Time-driven, type = Hours timer, every 2 hours.
 *
 * Respeta horario laboral y no reenvía si la solicitud ya fue anulada/procesada.
 */
function sendPendingConsultReminders() {
  if (!isWorkingHour()) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var idCol = H("ID RESPUESTA");
  var statusCol = H("STATUS");
  var obsCol = H("OBSERVACIONES");
  var parentIdCol = H("ID SOLICITUD PADRE");

  var remindersSent = 0;

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var obs = String(row[obsCol] || '');
    if (obs.indexOf(USER_CONSULT_MARKER) === -1) continue;

    var status = String(row[statusCol] || '').trim();
    if (status === 'ANULADO' || status === 'PROCESADO') continue;

    var requestId = String(row[idCol] || '').trim();
    if (!requestId) continue;

    var req = mapRowToRequest(row);
    if (!req.requesterEmail) continue;

    // Rebuild the consult email (same as original, threaded by subject)
    var subject = getStandardSubject(req);
    var continueLink = WEB_APP_URL + '?action=user_consult&id=' + encodeURIComponent(requestId) + '&decision=continue';
    var cancelLink = WEB_APP_URL + '?action=user_consult&id=' + encodeURIComponent(requestId) + '&decision=anulate';
    var isHotelOnly = req.requestMode === 'HOTEL_ONLY';

    var content = '<div style="background-color:#fff7ed; border:1px solid #fed7aa; color:#c2410c; padding:12px 14px; text-align:center; font-weight:bold; font-size:14px; margin-bottom:15px; border-radius:4px;">⏰ RECORDATORIO: Necesitamos su respuesta</div>';
    content += '<p style="color:#111827; font-size:14px; margin-bottom:12px;">Le recordamos que el área de viajes le consultó si desea <strong>continuar</strong> o <strong>anular</strong> su solicitud <strong>' + escapeHtml_(requestId) + '</strong>.</p>';
    content += '<div style="text-align:center; margin:20px 0;">';
    content += '<a href="' + continueLink + '" style="background-color:#059669; color:white; padding:12px 24px; text-decoration:none; border-radius:6px; font-weight:bold; font-size:14px; display:inline-block; margin-right:10px;">CONTINUAR</a>';
    content += '<a href="' + cancelLink + '" style="background-color:#dc2626; color:white; padding:12px 24px; text-decoration:none; border-radius:6px; font-weight:bold; font-size:14px; display:inline-block; margin-top:10px;">ANULAR</a>';
    content += '</div>';

    var html = HtmlTemplates.layout(requestId, content, '#c2410c', isHotelOnly ? 'RECORDATORIO - HOSPEDAJE' : 'RECORDATORIO - VIAJE');

    try {
      MailApp.sendEmail({ to: req.requesterEmail, subject: subject, htmlBody: html });
      remindersSent++;
    } catch (e) {
      console.error('Error enviando recordatorio de consulta a ' + req.requesterEmail + ': ' + e);
    }
    if (remindersSent >= MAX_REMINDER_EMAILS_PER_RUN) break;
  }

  console.log('Recordatorios de consulta enviados: ' + remindersSent + (remindersSent >= MAX_REMINDER_EMAILS_PER_RUN ? ' (CAP alcanzado)' : ''));
}

function processAdminReminders() {
    if (!isWorkingHour()) return;
    
    console.log("Starting Admin Reminders process...");
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
    if (!sheet) return;

    const dataRows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    const requests = dataRows.map(mapRowToRequest);

    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

    // Calcula qué padres están pausadas por una solicitud de cambio activa
    const pausedParentIds = _computePausedParentIds_(dataRows);
    const isPaused = (r) => pausedParentIds.has(String(r.requestId));

    // Filter by status AND ensure the flight hasn't happened yet (not abandoned)
    // AND skip originals paused by an active change request
    const pendingOptions = requests.filter(r => r.status === 'PENDIENTE_OPCIONES' && r.departureDate >= today && !isPaused(r));
    const pendingCost = requests.filter(r => r.status === 'PENDIENTE_CONFIRMACION_COSTO' && r.departureDate >= today && !isPaused(r));
    const approved = requests.filter(r => (r.status === 'APROBADO' || r.status === 'RESERVADO_PARCIAL') && r.departureDate >= today && !isPaused(r));
    // Solicitudes de cambio esperando que el analista las pase a estudio o las deniegue
    const pendingChanges = requests.filter(r => r.status === 'PENDIENTE_ANALISIS_CAMBIO' && r.departureDate >= today);

    if (pendingOptions.length === 0 && pendingCost.length === 0 && approved.length === 0 && pendingChanges.length === 0) {
        console.log("No pending tasks for admin. Skipping email.");
        return;
    }

    const html = HtmlTemplates.adminReminderSummary(pendingOptions, pendingCost, approved, pendingChanges);
    const totalCount = pendingOptions.length + pendingCost.length + approved.length + pendingChanges.length;
    const subject = `⚠️ RECORDATORIO: ${totalCount} Solicitudes Pendientes de Acción`;

    try {
        sendEmailRich(ADMIN_EMAIL, subject, html, null);
        console.log("Admin reminder email sent successfully.");
    } catch (e) {
        console.error("Error sending admin reminders: " + e.toString());
    }
}

/**
 * Helper to check if current time is within Equitel working hours (Bogota GMT-5) (v2.2)
 * Mon-Fri: 7:00 - 17:00
 * Sat: 8:00 - 12:00
 */
function isWorkingHour() {
    const now = new Date();
    const timeZone = "America/Bogota";
    const dayOfWeek = parseInt(Utilities.formatDate(now, timeZone, "u")); // 1=Mon, 7=Sun
    const hour = parseInt(Utilities.formatDate(now, timeZone, "H")); // 0-23

    let working = false;
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        if (hour >= 7 && hour < 17) working = true;
    } else if (dayOfWeek === 6) {
        if (hour >= 8 && hour < 12) working = true;
    }

    if (!working) {
        console.log("Outside working hours. Operation skipped.");
    }
    return working;
}

// --- REPORT GENERATION (v2.6) ---

/**
 * Creates a Google Doc template for reports. Run ONCE via setup.
 * Stores the template ID in Script Properties.
 */
function createReportTemplate() {
    const doc = DocumentApp.create('PLANTILLA_REPORTE_SOLICITUD_VIAJE');
    const body = doc.getBody();
    
    // Clear default content
    body.clear();
    
    // --- HEADER ---
    body.appendParagraph('SOPORTE DE SOLICITUD DE VIAJE')
        .setHeading(DocumentApp.ParagraphHeading.HEADING1)
        .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
        .setAttributes({[DocumentApp.Attribute.FONT_SIZE]: 16, [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#D71920'});
    
    body.appendParagraph('Sistema de Tiquetes Equitel')
        .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
        .setAttributes({[DocumentApp.Attribute.FONT_SIZE]: 10, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#6b7280', [DocumentApp.Attribute.ITALIC]: true});
    
    body.appendHorizontalRule();
    
    // --- IDENTIFICATION ---
    body.appendParagraph('IDENTIFICACIÓN')
        .setHeading(DocumentApp.ParagraphHeading.HEADING2)
        .setAttributes({[DocumentApp.Attribute.FONT_SIZE]: 12, [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#111827'});
    
    const idTable = body.appendTable([
        ['ID Solicitud', '{{SOLICITUD_ID}}'],
        ['Estado', '{{ESTADO}}'],
        ['Fecha Solicitud', '{{FECHA_SOLICITUD}}'],
        ['Tipo', '{{TIPO_SOLICITUD}}'],
        ['Solicitud Vinculada', '{{SOLICITUD_PADRE}}'],
        ['Solicitante', '{{SOLICITANTE}}']
    ]);
    formatTable(idTable);
    
    // --- TRIP INFO ---
    body.appendParagraph('INFORMACIÓN DEL VIAJE')
        .setHeading(DocumentApp.ParagraphHeading.HEADING2)
        .setAttributes({[DocumentApp.Attribute.FONT_SIZE]: 12, [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#111827'});
    
    const tripTable = body.appendTable([
        ['Origen', '{{ORIGEN}}'],
        ['Destino', '{{DESTINO}}'],
        ['Fecha Ida', '{{FECHA_IDA}}'],
        ['Hora Preferida (Ida)', '{{HORA_IDA}}'],
        ['Fecha Regreso', '{{FECHA_VUELTA}}'],
        ['Hora Preferida (Vuelta)', '{{HORA_VUELTA}}'],
        ['Internacional', '{{ES_INTERNACIONAL}}'],
        ['Violación de Política', '{{VIOLACION_POLITICA}}']
    ]);
    formatTable(tripTable);
    
    // --- CORPORATE ---
    body.appendParagraph('INFORMACIÓN CORPORATIVA')
        .setHeading(DocumentApp.ParagraphHeading.HEADING2)
        .setAttributes({[DocumentApp.Attribute.FONT_SIZE]: 12, [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#111827'});
    
    const corpTable = body.appendTable([
        ['Empresa', '{{EMPRESA}}'],
        ['Sede', '{{SEDE}}'],
        ['Unidad de Negocio', '{{UNIDAD_NEGOCIO}}'],
        ['Centro de Costos', '{{CENTRO_COSTOS}}'],
        ['Nombre Centro de Costos', '{{NOMBRE_CC}}'],
        ['Orden de Trabajo', '{{ORDEN_TRABAJO}}']
    ]);
    formatTable(corpTable);
    
    // --- PASSENGERS ---
    body.appendParagraph('PASAJEROS')
        .setHeading(DocumentApp.ParagraphHeading.HEADING2)
        .setAttributes({[DocumentApp.Attribute.FONT_SIZE]: 12, [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#111827'});
    
    body.appendParagraph('{{PASAJEROS_DETALLE}}')
        .setAttributes({[DocumentApp.Attribute.FONT_SIZE]: 10});
    
    // --- HOTEL ---
    body.appendParagraph('HOSPEDAJE')
        .setHeading(DocumentApp.ParagraphHeading.HEADING2)
        .setAttributes({[DocumentApp.Attribute.FONT_SIZE]: 12, [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#111827'});
    
    const hotelTable = body.appendTable([
        ['Requiere Hospedaje', '{{REQUIERE_HOTEL}}'],
        ['Hotel Sugerido', '{{HOTEL_NOMBRE}}'],
        ['Noches', '{{NOCHES}}']
    ]);
    formatTable(hotelTable);
    
    // --- SELECTION & COSTS ---
    body.appendParagraph('SELECCIÓN Y COSTOS')
        .setHeading(DocumentApp.ParagraphHeading.HEADING2)
        .setAttributes({[DocumentApp.Attribute.FONT_SIZE]: 12, [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#111827'});
    
    const costTable = body.appendTable([
        ['Selección del Usuario', '{{SELECCION_TEXTO}}'],
        ['Costo Tiquetes', '{{COSTO_TIQUETES}}'],
        ['Costo Hotel', '{{COSTO_HOTEL}}'],
        ['Costo Total', '{{COSTO_TOTAL}}']
    ]);
    formatTable(costTable);
    
    // --- RESERVATION & CREDIT CARD ---
    body.appendParagraph('RESERVA Y MEDIO DE PAGO')
        .setHeading(DocumentApp.ParagraphHeading.HEADING2)
        .setAttributes({[DocumentApp.Attribute.FONT_SIZE]: 12, [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#111827'});
    
    const resTable = body.appendTable([
        ['Número de Reserva (PNR)', '{{NUMERO_RESERVA}}'],
        ['Tarjeta de Crédito', '{{TARJETA_CREDITO}}']
    ]);
    formatTable(resTable);
    
    // --- APPROVALS ---
    body.appendParagraph('ESTADO DE APROBACIONES')
        .setHeading(DocumentApp.ParagraphHeading.HEADING2)
        .setAttributes({[DocumentApp.Attribute.FONT_SIZE]: 12, [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#111827'});
    
    const appTable = body.appendTable([
        ['Aprobador de Área', '{{APROBADOR_AREA}}'],
        ['Estado Aprobación Área', '{{ESTADO_AREA}}'],
        ['Estado Aprobación CDS', '{{ESTADO_CDS}}'],
        ['Estado Aprobación CEO', '{{ESTADO_CEO}}']
    ]);
    formatTable(appTable);
    
    // --- OBSERVATIONS ---
    body.appendParagraph('OBSERVACIONES')
        .setHeading(DocumentApp.ParagraphHeading.HEADING2)
        .setAttributes({[DocumentApp.Attribute.FONT_SIZE]: 12, [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#111827'});
    
    body.appendParagraph('{{OBSERVACIONES}}')
        .setAttributes({[DocumentApp.Attribute.FONT_SIZE]: 10, [DocumentApp.Attribute.ITALIC]: true});
    
    // --- LINK ---
    body.appendHorizontalRule();
    body.appendParagraph('ENLACE A CARPETA DE SOPORTES')
        .setHeading(DocumentApp.ParagraphHeading.HEADING2)
        .setAttributes({[DocumentApp.Attribute.FONT_SIZE]: 12, [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#111827'});
    
    body.appendParagraph('{{LINK_CARPETA}}')
        .setAttributes({[DocumentApp.Attribute.FONT_SIZE]: 10, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#2563eb'});
    
    // --- FOOTER ---
    body.appendHorizontalRule();
    body.appendParagraph('Documento generado automáticamente por el Sistema de Tiquetes Equitel.')
        .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
        .setAttributes({[DocumentApp.Attribute.FONT_SIZE]: 8, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#9ca3af', [DocumentApp.Attribute.ITALIC]: true});
    body.appendParagraph('Fecha de generación: {{FECHA_GENERACION}}')
        .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
        .setAttributes({[DocumentApp.Attribute.FONT_SIZE]: 8, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#9ca3af'});
    
    doc.saveAndClose();
    
    // Move template to root folder and save ID
    const file = DriveApp.getFileById(doc.getId());
    DriveApp.getFolderById(ROOT_DRIVE_FOLDER_ID).addFile(file);
    
    // Store template ID in Script Properties
    PropertiesService.getScriptProperties().setProperty('REPORT_TEMPLATE_ID', doc.getId());
    
    console.log('Report template created: ' + doc.getId());
    return doc.getId();
}

/** Helper: format table styling */
function formatTable(table) {
    table.setBorderColor('#e5e7eb');
    for (let r = 0; r < table.getNumRows(); r++) {
        const row = table.getRow(r);
        // Label cell (left)
        row.getCell(0)
            .setWidth(180)
            .setBackgroundColor('#f9fafb')
            .editAsText()
            .setFontSize(9)
            .setBold(true)
            .setForegroundColor('#374151');
        // Value cell (right)
        row.getCell(1)
            .editAsText()
            .setFontSize(10)
            .setBold(false)
            .setForegroundColor('#111827');
    }
}

/**
 * Generates a PDF support report for a request and saves it to the Drive folder.
 * Returns the URL of the generated PDF.
 */
function generateSupportReport(requestId) {
    // 0. Check if report already exists (cache) — avoids regenerating every click
    const rootForCache = DriveApp.getFolderById(ROOT_DRIVE_FOLDER_ID);
    const foldersForCache = rootForCache.getFolders();
    while (foldersForCache.hasNext()) {
      const f = foldersForCache.next();
      if (f.getName().indexOf(requestId) === 0) {
        const existing = f.getFilesByName('Soporte_' + requestId + '.pdf');
        if (existing.hasNext()) {
          const cached = existing.next();
          return 'https://drive.google.com/file/d/' + cached.getId() + '/view?usp=sharing';
        }
        break;
      }
    }

    // 1. Get template ID
    const templateId = PropertiesService.getScriptProperties().getProperty('REPORT_TEMPLATE_ID');
    if (!templateId) throw new Error('Plantilla de reporte no configurada. Ejecute createReportTemplate() primero.');

    // 2. Get request data
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
    const idIdx = H("ID RESPUESTA");
    const ids = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat();
    const rowIndex = ids.map(String).indexOf(String(requestId));
    if (rowIndex === -1) throw new Error("Solicitud no encontrada: " + requestId);
    const rowNumber = rowIndex + 2;
    
    const row = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
    const req = mapRowToRequest(row);
    
    // 3. Copy template
    const template = DriveApp.getFileById(templateId);
    const copy = template.makeCopy(`Reporte_${requestId}_TEMP`);
    const doc = DocumentApp.openById(copy.getId());
    const body = doc.getBody();
    
    // 4. Format helpers
    const formatApproval = (s) => {
        if (!s) return 'N/A';
        if (String(s).startsWith('Sí')) return '✅ APROBADO';
        if (String(s).startsWith('No')) return '❌ DENEGADO';
        return '⏳ PENDIENTE';
    };
    
    const formatCurrency = (v) => {
        const num = Number(v) || 0;
        return '$' + num.toLocaleString('es-CO');
    };
    
    const formatDateDisplay = (d) => {
        if (!d) return 'N/A';
        const parts = String(d).split('-');
        if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
        return String(d);
    };
    
    // 5. Build passengers detail text
    let passengersText = '';
    req.passengers.forEach((p, i) => {
        passengersText += `${i+1}. ${p.name} — CC: ${p.idNumber}`;
        if (p.email) passengersText += ` — ${p.email}`;
        passengersText += '\n';
    });
    if (!passengersText) passengersText = 'Sin pasajeros registrados';
    
    // 6. Get folder URL
    let folderUrl = 'No disponible';
    if (req.supportData && req.supportData.folderUrl) {
        folderUrl = req.supportData.folderUrl;
    } else {
        // Try to find folder in Drive
        const root = DriveApp.getFolderById(ROOT_DRIVE_FOLDER_ID);
        const allFolders = root.getFolders();
        while (allFolders.hasNext()) {
            const f = allFolders.next();
            if (f.getName().indexOf(requestId) === 0) {
                folderUrl = f.getUrl();
                break;
            }
        }
    }
    
    // 7. Replace ALL placeholders
    const isHotelOnlyReport = req.requestMode === 'HOTEL_ONLY';
    body.replaceText('\\{\\{SOLICITUD_ID\\}\\}', requestId);
    body.replaceText('\\{\\{ESTADO\\}\\}', req.status || 'N/A');
    body.replaceText('\\{\\{FECHA_SOLICITUD\\}\\}', String(req.timestamp || 'N/A'));
    body.replaceText('\\{\\{TIPO_SOLICITUD\\}\\}', isHotelOnlyReport ? 'SOLO HOSPEDAJE' : (req.requestType || 'ORIGINAL'));
    body.replaceText('\\{\\{SOLICITUD_PADRE\\}\\}', req.relatedRequestId || 'N/A');
    body.replaceText('\\{\\{SOLICITANTE\\}\\}', req.requesterEmail || 'N/A');

    body.replaceText('\\{\\{ORIGEN\\}\\}', isHotelOnlyReport ? 'N/A (Solo Hospedaje)' : (req.origin || 'N/A'));
    body.replaceText('\\{\\{DESTINO\\}\\}', (isHotelOnlyReport ? '🏨 ' : '') + (req.destination || 'N/A'));
    body.replaceText('\\{\\{FECHA_IDA\\}\\}', formatDateDisplay(req.departureDate));
    body.replaceText('\\{\\{HORA_IDA\\}\\}', req.departureTimePreference || 'N/A');
    body.replaceText('\\{\\{FECHA_VUELTA\\}\\}', req.returnDate ? formatDateDisplay(req.returnDate) : 'Solo Ida');
    body.replaceText('\\{\\{HORA_VUELTA\\}\\}', req.returnTimePreference || 'N/A');
    body.replaceText('\\{\\{ES_INTERNACIONAL\\}\\}', req.isInternational ? 'Sí' : 'No');
    body.replaceText('\\{\\{VIOLACION_POLITICA\\}\\}', req.policyViolation ? '⚠️ SÍ' : 'No');
    
    body.replaceText('\\{\\{EMPRESA\\}\\}', req.company || 'N/A');
    body.replaceText('\\{\\{SEDE\\}\\}', req.site || 'N/A');
    body.replaceText('\\{\\{UNIDAD_NEGOCIO\\}\\}', req.businessUnit || 'N/A');
    body.replaceText('\\{\\{CENTRO_COSTOS\\}\\}', req.costCenter || 'N/A');
    body.replaceText('\\{\\{NOMBRE_CC\\}\\}', req.costCenterName || req.variousCostCenters || 'N/A');
    body.replaceText('\\{\\{ORDEN_TRABAJO\\}\\}', req.workOrder || 'N/A');
    
    body.replaceText('\\{\\{PASAJEROS_DETALLE\\}\\}', passengersText);
    
    body.replaceText('\\{\\{REQUIERE_HOTEL\\}\\}', req.requiresHotel ? 'Sí' : 'No');
    body.replaceText('\\{\\{HOTEL_NOMBRE\\}\\}', req.hotelName || 'N/A');
    body.replaceText('\\{\\{NOCHES\\}\\}', String(req.nights || 0));
    
    body.replaceText('\\{\\{SELECCION_TEXTO\\}\\}', req.selectionDetails || 'N/A');
    body.replaceText('\\{\\{COSTO_TIQUETES\\}\\}', formatCurrency(req.finalCostTickets));
    body.replaceText('\\{\\{COSTO_HOTEL\\}\\}', formatCurrency(req.finalCostHotel));
    body.replaceText('\\{\\{COSTO_TOTAL\\}\\}', formatCurrency(req.totalCost));
    
    body.replaceText('\\{\\{NUMERO_RESERVA\\}\\}', req.reservationNumber || 'N/A');
    body.replaceText('\\{\\{TARJETA_CREDITO\\}\\}', req.creditCard || 'N/A');
    
    body.replaceText('\\{\\{APROBADOR_AREA\\}\\}', req.approverName || 'N/A');
    body.replaceText('\\{\\{ESTADO_AREA\\}\\}', formatApproval(req.approvalStatusArea));
    body.replaceText('\\{\\{ESTADO_CDS\\}\\}', req.isInternational ? formatApproval(req.approvalStatusCDS) : 'N/A (Nacional)');
    body.replaceText('\\{\\{ESTADO_CEO\\}\\}', req.isInternational ? formatApproval(req.approvalStatusCEO) : 'N/A (Nacional)');
    
    body.replaceText('\\{\\{OBSERVACIONES\\}\\}', req.comments || 'Sin observaciones');
    body.replaceText('\\{\\{LINK_CARPETA\\}\\}', folderUrl);
    
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
    body.replaceText('\\{\\{FECHA_GENERACION\\}\\}', now);
    
    doc.saveAndClose();
    
    // 8. Export as PDF
    const pdfBlob = DriveApp.getFileById(copy.getId()).getAs('application/pdf');
    pdfBlob.setName(`Soporte_${requestId}.pdf`);
    
    // 9. Save to request folder
    const root = DriveApp.getFolderById(ROOT_DRIVE_FOLDER_ID);
    let folder;
    const allFolders = root.getFolders();
    while (allFolders.hasNext()) {
        const f = allFolders.next();
        if (f.getName().indexOf(requestId) === 0) {
            folder = f;
            break;
        }
    }
    if (!folder) {
        folder = root.createFolder(requestId);
    }
    
    // Remove old report if exists
    const existingFiles = folder.getFilesByName(`Soporte_${requestId}.pdf`);
    while (existingFiles.hasNext()) {
        existingFiles.next().setTrashed(true);
    }
    
    const pdfFile = folder.createFile(pdfBlob);
    pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    // 10. Cleanup: delete temp doc
    DriveApp.getFileById(copy.getId()).setTrashed(true);
    
    const pdfUrl = `https://drive.google.com/file/d/${pdfFile.getId()}/view?usp=sharing`;
    console.log('Report generated: ' + pdfUrl);
    return pdfUrl;
}

/**
 * MANUAL CANCELLATION (v2.4)
 * Updates status to ANULADO and records the reason in observations.
 */
/**
 * User self-cancellation: the requester cancels their own request.
 * Security: validates that currentUserEmail matches the requester on the row.
 * Notifies admin (not the user, since the user is the one cancelling).
 */
function cancelOwnRequest(requestId, reason, currentUserEmail) {
  if (!requestId || !reason || !reason.trim()) throw new Error('ID y motivo son requeridos.');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
  var idIdx = H("ID RESPUESTA");
  var statusIdx = H("STATUS");
  var obsIdx = H("OBSERVACIONES");
  var emailIdx = H("CORREO ENCUESTADO");

  var ids = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat();
  var rowIndex = ids.map(String).indexOf(String(requestId));
  if (rowIndex === -1) throw new Error("Solicitud no encontrada.");
  var rowNumber = rowIndex + 2;

  // Security: verify the caller IS the requester
  var rowEmail = String(sheet.getRange(rowNumber, emailIdx + 1).getValue()).toLowerCase().trim();
  if (rowEmail !== String(currentUserEmail).toLowerCase().trim()) {
    throw new Error("No puede anular una solicitud que no le pertenece.");
  }

  // Cannot cancel terminal states
  var currentStatus = String(sheet.getRange(rowNumber, statusIdx + 1).getValue());
  if (['ANULADO', 'PROCESADO', 'DENEGADO'].indexOf(currentStatus) !== -1) {
    throw new Error("Esta solicitud ya está en estado " + currentStatus + " y no se puede anular.");
  }

  // Apply cancellation
  sheet.getRange(rowNumber, statusIdx + 1).setValue('ANULADO');
  var currentObs = sheet.getRange(rowNumber, obsIdx + 1).getValue();
  var note = '[ANULACIÓN POR USUARIO]: ' + reason.trim();
  sheet.getRange(rowNumber, obsIdx + 1).setValue((currentObs ? currentObs + "\n" : "") + note);

  // Notify ADMIN (not user — user already knows, they initiated it)
  try {
    var rowData = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
    var req = mapRowToRequest(rowData);
    var isHotelOnly = req.requestMode === 'HOTEL_ONLY';
    var content = '<p style="color:#111827; font-size:14px; margin-bottom:12px;">El usuario <strong>' + escapeHtml_(currentUserEmail) + '</strong> ha anulado su propia solicitud <strong>' + escapeHtml_(requestId) + '</strong>.</p>';
    content += '<div style="background-color:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:12px 14px; border-radius:6px; font-size:13px; margin-bottom:16px;"><strong>Motivo:</strong> ' + escapeHtml_(reason.trim()) + '</div>';
    content += '<hr style="border:0; border-top:1px solid #e5e7eb; margin:20px 0;">' + HtmlTemplates._getFullSummary(req);
    var html = HtmlTemplates.layout(requestId, content, '#D71920', isHotelOnly ? 'HOSPEDAJE ANULADO POR USUARIO' : 'VIAJE ANULADO POR USUARIO');
    sendEmailRich(ADMIN_EMAIL, getStandardSubject(req) + ' [ANULADA POR USUARIO]', html, null);
  } catch (e) {
    console.error("Error notificando admin sobre auto-anulación: " + e);
  }

  return true;
}

function anularSolicitud(requestId, reason) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
  const idIdx = H("ID RESPUESTA");
  const statusIdx = H("STATUS");
  const obsIdx = H("OBSERVACIONES");
  const emailIdx = H("CORREO ENCUESTADO");
  
  const ids = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat();
  const rowIndex = ids.map(String).indexOf(String(requestId));
  
  if (rowIndex === -1) throw new Error("ID no encontrado");
  const rowNumber = rowIndex + 2;
  
  // Update Status
  sheet.getRange(rowNumber, statusIdx + 1).setValue('ANULADO');
  
  // Append Reason to Observations
  const currentObs = sheet.getRange(rowNumber, obsIdx + 1).getValue();
  const newNote = `[ANULACIÓN MANUAL]: ${reason}`;
  sheet.getRange(rowNumber, obsIdx + 1).setValue((currentObs ? currentObs + "\n" : "") + newNote);
  
  // Send notification to user
  const userEmail = sheet.getRange(rowNumber, emailIdx + 1).getValue();
  
  try {
    const subject = `🚫 Solicitud de Viaje ${requestId} - ANULADA`;
    const html = `
      <div style="font-family: Arial, sans-serif; color: #374151;">
        <h2 style="color: #D71920;">Solicitud Anulada</h2>
        <p>Le informamos que su solicitud de viaje <strong>${escapeHtml_(requestId)}</strong> ha sido anulada por el administrador.</p>
        <p><strong>Motivo:</strong> ${escapeHtml_(reason)}</p>
        <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="font-size: 12px; color: #6b7280;">Este es un mensaje automático del Sistema de Tiquetes Equitel.</p>
      </div>
    `;
    sendEmailRich(userEmail, subject, html, null);
  } catch (e) {
    console.error("Error enviando email de anulación: " + e);
  }

  return true;
}

// =====================================================================
// PLAN 2 - FASE A: USUARIOS SHEET MANAGEMENT (parallel, opt-in)
// =====================================================================
// Hoja paralela `USUARIOS` que reemplazará a INTEGRANTES en Fase B.
// El backend de producción sigue leyendo INTEGRANTES — esta Fase A solo
// instala el menú, las funciones de creación/migración y el sidebar.
// Cero impacto en el flujo actual mientras se valida.
// =====================================================================

const SHEET_NAME_USUARIOS = 'USUARIOS';
const HEADERS_USUARIOS = [
  'Cedula', 'Nombre', 'Correo', 'Empresa', 'Sede', 'Centro de Costo',
  'Cedulas Aprobadores', 'Correos Aprobadores (auto)', 'Nombres Aprobadores (auto)',
  'PIN'
];

// Maestro RH (Recursos Humanos) — Sheet externo con la lista completa de
// empleados. Se usa durante la migración para "rellenar" aprobadores que no
// existen en INTEGRANTES (huérfanos) creando filas stub en USUARIOS.
// Default apunta al sheet de prueba del clon; sobreescribir en producción
// vía Script Property HR_MAESTRO_ID.
const HR_MAESTRO_ID = getConfig_('HR_MAESTRO_ID', '1C0PQvx3Ueo5i7k2diWeMAAmnzX_SgKwXrgsLOo0lfMs');
const HR_MAESTRO_SHEET = getConfig_('HR_MAESTRO_SHEET', 'Hoja 1');

/**
 * Menú "Equitel Viajes" en la barra superior del sheet.
 *
 * GATED: solo se muestra cuando USE_USUARIOS_SHEET === 'true'. Esto asegura
 * que en producción (donde el switch está apagado), el analista no ve nada nuevo
 * en la barra de menús y no puede activar accidentalmente funciones de
 * Plan 2 que aún no deben estar disponibles.
 *
 * Setup inicial (cuando se decide activar Plan 2 en producción):
 *   1. Abrir el editor de Apps Script
 *   2. Seleccionar `crearHojaUsuarios` en el dropdown → ▶ Run
 *   3. Seleccionar `migrarIntegrantesAUsuarios` → ▶ Run (verifica USUARIOS)
 *   4. Script Properties → agregar USE_USUARIOS_SHEET = 'true'
 *   5. Recargar el sheet → menú aparece + backend ya lee de USUARIOS
 *
 * Rollback: cambiar la propiedad a 'false' (o borrarla) + recargar sheet.
 * El único modo de cambiar el switch es manualmente desde el editor GAS.
 */
function onOpen() {
  // El menú siempre se muestra. Cada función individual valida permisos
  // cuando se ejecuta (donde Session.getActiveUser() funciona de forma
  // fiable, a diferencia de onOpen que es un simple trigger).
  // En producción, el menú es inofensivo: el sidebar y las funciones de
  // migración validan USE_USUARIOS_SHEET o isSetupAdmin antes de actuar.
  var modoLabel = USE_USUARIOS_SHEET
    ? 'Modo activo: ⚡ USUARIOS'
    : 'Modo activo: 📋 INTEGRANTES (legacy)';
  SpreadsheetApp.getUi()
    .createMenu('Equitel Viajes')
    .addItem('Gestionar Usuarios (Sidebar)', 'abrirSidebarUsuarios')
    .addItem('Reorganizar Base Principal (Sidebar)', 'abrirSidebarReorg')
    .addSeparator()
    .addItem(modoLabel, 'mostrarModoActivo')
    .addSeparator()
    .addItem('1. Crear hoja USUARIOS', 'crearHojaUsuarios')
    .addItem('2. Migrar desde INTEGRANTES', 'migrarIntegrantesAUsuarios')
    .addItem('3. Sincronizar con Maestro RH', 'sincronizarConMaestroRH')
    .addItem('4. Recargar resoluciones (cols H, I)', 'recargarResolucionesUsuarios')
    .addToUi();
}

/**
 * Muestra qué hoja está leyendo el backend en este momento. Útil para
 * confirmar que el switch de Fase B está activo.
 */
function mostrarModoActivo() {
  const ui = SpreadsheetApp.getUi();
  if (USE_USUARIOS_SHEET) {
    ui.alert(
      'Modo activo: USUARIOS',
      'El backend está leyendo de la hoja USUARIOS (Fase B activa).\n\n' +
      'Para revertir a INTEGRANTES:\n' +
      '  Configuración del proyecto → Propiedades del script\n' +
      '  Cambiar USE_USUARIOS_SHEET a "false" (o eliminar la propiedad)\n' +
      '  Recargar el sheet — el cambio es inmediato, sin redespliegue.',
      ui.ButtonSet.OK
    );
  } else {
    ui.alert(
      'Modo activo: INTEGRANTES (legacy)',
      'El backend está leyendo de la hoja INTEGRANTES (modo por defecto).\n\n' +
      'Para activar Fase B (leer de USUARIOS):\n' +
      '  Configuración del proyecto → Propiedades del script\n' +
      '  Agregar USE_USUARIOS_SHEET = "true"\n' +
      '  Recargar el sheet — el cambio es inmediato, sin redespliegue.\n\n' +
      'Antes de activar, asegúrate de haber corrido la migración (paso 2 del menú).',
      ui.ButtonSet.OK
    );
  }
}

/**
 * Recorre el Maestro RH y crea filas stub en USUARIOS para los empleados
 * que aún no existen. NO toca filas existentes (preserva ediciones manuales).
 * Útil para mantener USUARIOS sincronizada cuando RH agrega nuevas personas.
 */
function sincronizarConMaestroRH() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const usuarios = ss.getSheetByName(SHEET_NAME_USUARIOS);
  if (!usuarios) {
    ui.alert('Primero crea la hoja USUARIOS.');
    return;
  }

  const hrResult = _readMaestroRH_();
  if (hrResult.error) {
    ui.alert('Error leyendo Maestro RH:\n\n' + hrResult.error);
    return;
  }
  const hrLookup = hrResult.lookup;
  const hrSize = Object.keys(hrLookup).length;

  // Snapshot de lo que ya existe en USUARIOS
  const lastRow = usuarios.getLastRow();
  const existingCedulas = {};
  const existingEmails = {};
  if (lastRow >= 2) {
    const existing = usuarios.getRange(2, 1, lastRow - 1, 3).getValues();
    existing.forEach(function(r) {
      const c = String(r[0] || '').trim();
      const e = String(r[2] || '').toLowerCase().trim();
      if (c) existingCedulas[c] = true;
      if (e) existingEmails[e] = true;
    });
  }

  // Detectar empleados del Maestro RH que no están en USUARIOS
  const toCreate = [];
  Object.keys(hrLookup).forEach(function(email) {
    const entry = hrLookup[email];
    if (!entry.cedula) return;
    if (existingCedulas[entry.cedula]) return;
    if (existingEmails[email]) return;
    toCreate.push({
      cedula: entry.cedula,
      nombre: entry.nombre || email,
      correo: email
    });
  });

  if (toCreate.length === 0) {
    ui.alert(
      'Todo sincronizado.\n\n' +
      'Maestro RH: ' + hrSize + ' empleados\n' +
      'No hay usuarios nuevos que agregar.'
    );
    return;
  }

  const resp = ui.alert(
    'Sincronizar con Maestro RH',
    'Se crearán ' + toCreate.length + ' usuarios nuevos como STUBS:\n' +
    '  • Solo cédula + nombre + correo\n' +
    '  • Sin empresa, sede, centro de costo ni aprobador\n' +
    '  • Sin PIN\n\n' +
    'Tendrás que asignarles aprobador desde el sidebar después.\n\n' +
    '¿Continuar?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  let nextRow = (lastRow >= 2 ? lastRow : 1) + 1;
  toCreate.forEach(function(u) {
    _writeUsuarioRow_(usuarios, nextRow, {
      cedula: u.cedula,
      nombre: u.nombre,
      correo: u.correo,
      empresa: '',
      sede: '',
      centroCosto: '',
      cedulasAprobadores: ''
    }, {});
    nextRow++;
  });
  SpreadsheetApp.flush();

  ui.alert(
    'Sincronización completa.\n\n' +
    '• Stubs creados: ' + toCreate.length + '\n' +
    '• Total empleados en Maestro RH: ' + hrSize + '\n\n' +
    'Asígnales aprobador desde el sidebar cuando puedas.'
  );
}

function abrirSidebarUsuarios() {
  // Permitido siempre que el sheet USUARIOS exista. El sidebar es de
  // preparación (Fase A) — no requiere que el switch de backend esté activo.
  // Cualquier editor del sheet puede abrir el sidebar para gestionar la
  // tabla USUARIOS sin afectar el flujo de producción.
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEET_NAME_USUARIOS)) {
    SpreadsheetApp.getUi().alert(
      'La hoja USUARIOS aún no existe.\n\n' +
      'Ejecuta primero: crearHojaUsuarios() desde el editor de Apps Script.'
    );
    return;
  }
  const html = HtmlService.createHtmlOutputFromFile('AdminSidebar')
    .setTitle('Gestión de Usuarios');
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * One-time: crea la hoja USUARIOS con headers, formato y notas.
 * Idempotente: si ya existe, avisa y no toca nada.
 */
function crearHojaUsuarios() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SHEET_NAME_USUARIOS)) {
    ui.alert('La hoja USUARIOS ya existe. Si quieres recrearla, elimínala manualmente primero.');
    return;
  }
  const sheet = ss.insertSheet(SHEET_NAME_USUARIOS);
  sheet.getRange(1, 1, 1, HEADERS_USUARIOS.length).setValues([HEADERS_USUARIOS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS_USUARIOS.length)
    .setFontWeight('bold')
    .setBackground('#1f2937')
    .setFontColor('white');

  // Anchos de columna razonables
  sheet.setColumnWidth(1, 110);  // Cedula
  sheet.setColumnWidth(2, 220);  // Nombre
  sheet.setColumnWidth(3, 240);  // Correo
  sheet.setColumnWidth(4, 110);  // Empresa
  sheet.setColumnWidth(5, 140);  // Sede
  sheet.setColumnWidth(6, 130);  // CC
  sheet.setColumnWidth(7, 200);  // Cedulas Aprobadores
  sheet.setColumnWidth(8, 280);  // Correos Aprobadores (auto)
  sheet.setColumnWidth(9, 280);  // Nombres Aprobadores (auto)
  sheet.setColumnWidth(10, 100); // PIN

  sheet.getRange(1, 7).setNote('Cédulas separadas por coma. Cada una debe existir en la columna A.');
  sheet.getRange(1, 8).setNote('Resuelto al guardar/migrar desde la columna G. Si editas G manualmente, usa "3. Recargar resoluciones" del menú.');
  sheet.getRange(1, 9).setNote('Resuelto al guardar/migrar desde la columna G. Si editas G manualmente, usa "3. Recargar resoluciones" del menú.');
  sheet.getRange(1, 10).setNote('Hash SHA-256 del PIN del usuario. NO editar manualmente.');

  ui.alert(
    'Hoja USUARIOS creada.\n\n' +
    'Próximos pasos:\n' +
    '1. Equitel Viajes → "2. Migrar desde INTEGRANTES" para poblarla.\n' +
    '2. Equitel Viajes → "Gestionar Usuarios (Sidebar)" para administrar.'
  );
}

/**
 * Migración completa: lee INTEGRANTES (sección verde) + Maestro RH externo,
 * y puebla USUARIOS resolviendo todas las referencias de aprobadores a
 * cédulas. Si un aprobador no existe como usuario propio en INTEGRANTES,
 * lo crea como "stub" usando datos del Maestro RH.
 *
 * Flujo:
 *   1. Parse INTEGRANTES → array de usuarios con sus correos de aprobadores
 *   2. Identifica huérfanos (correos de aprobadores no existentes en INTEGRANTES)
 *   3. Abre Maestro RH y crea filas stub para los huérfanos encontrados
 *   4. Resuelve todos los correos de aprobadores → cédulas con el mapa completo
 *   5. Escribe USUARIOS preservando los hashes de PIN
 */
function migrarIntegrantesAUsuarios() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const usuarios = ss.getSheetByName(SHEET_NAME_USUARIOS);
  if (!usuarios) {
    ui.alert('Primero ejecuta "1. Crear hoja USUARIOS".');
    return;
  }
  if (usuarios.getLastRow() > 1) {
    const resp = ui.alert(
      'USUARIOS ya tiene datos',
      '¿Quieres BORRAR el contenido actual y volver a migrar?',
      ui.ButtonSet.YES_NO
    );
    if (resp !== ui.Button.YES) return;
    usuarios.getRange(2, 1, usuarios.getLastRow() - 1, usuarios.getLastColumn()).clearContent();
    SpreadsheetApp.flush();
  }

  const intSheet = ss.getSheetByName(SHEET_NAME_INTEGRANTES);
  if (!intSheet) {
    ui.alert('No se encontró la hoja INTEGRANTES.');
    return;
  }
  const lastRow = intSheet.getLastRow();
  if (lastRow < 2) {
    ui.alert('INTEGRANTES está vacía.');
    return;
  }

  const data = intSheet.getRange(1, 1, lastRow, intSheet.getLastColumn()).getValues();
  const headers = data[0];
  const idxCedula = headers.indexOf('Cedula Numero');
  const idxNombre = headers.indexOf('Apellidos y Nombres');
  const idxCorreo = headers.indexOf('correo');
  const idxEmpresa = headers.indexOf('Empresa');
  const idxSede = headers.indexOf('sede');
  const idxCC = headers.indexOf('Centro de Costo');
  const idxAprobCorreo = headers.indexOf('correo aprobador');
  const idxPin = headers.indexOf('PIN');

  if (idxCedula < 0 || idxNombre < 0 || idxCorreo < 0) {
    ui.alert('No se encontraron las columnas básicas (Cedula Numero, Apellidos y Nombres, correo) en INTEGRANTES.');
    return;
  }

  // ============= PASO 1: Parse INTEGRANTES =============
  const parsedRows = []; // { cedula, nombre, correo, empresa, sede, cc, pinHash, aprobCorreos: [emails] }
  let migratedPins = 0;

  for (let i = 1; i < data.length; i++) {
    const cedula = String(data[i][idxCedula] || '').trim();
    const nombre = String(data[i][idxNombre] || '').trim();
    const correo = String(data[i][idxCorreo] || '').toLowerCase().trim();
    if (!cedula || !nombre || !correo) continue;

    const aprobCorreos = idxAprobCorreo > -1
      ? String(data[i][idxAprobCorreo] || '').toLowerCase()
          .split(',').map(function(e) { return e.trim(); }).filter(function(e) { return e; })
      : [];

    parsedRows.push({
      cedula: cedula,
      nombre: nombre,
      correo: correo,
      empresa: _mapEmpresaCode_(idxEmpresa > -1 ? String(data[i][idxEmpresa] || '').trim() : ''),
      sede: idxSede > -1 ? String(data[i][idxSede] || '').trim() : '',
      centroCosto: idxCC > -1 ? String(data[i][idxCC] || '').trim() : '',
      pinHash: idxPin > -1 ? String(data[i][idxPin] || '').trim() : '',
      aprobCorreos: aprobCorreos
    });
    if (parsedRows[parsedRows.length - 1].pinHash) migratedPins++;
  }

  // Lookup inicial correo → cedula desde lo que ya tenemos
  const emailToCedula = {};
  parsedRows.forEach(function(r) { emailToCedula[r.correo] = r.cedula; });

  // ============= PASO 2: Identificar correos huérfanos =============
  const allApprovers = {};
  parsedRows.forEach(function(r) {
    r.aprobCorreos.forEach(function(em) { allApprovers[em] = true; });
  });
  const orphanEmails = Object.keys(allApprovers).filter(function(em) {
    return !emailToCedula[em];
  });

  // ============= PASO 3: Rellenar huérfanos desde Maestro RH =============
  const stubRows = [];
  const stillOrphan = [];
  let hrLookupSize = 0;
  let hrError = '';

  if (orphanEmails.length > 0) {
    const hrResult = _readMaestroRH_();
    hrError = hrResult.error || '';
    const hrLookup = hrResult.lookup;
    hrLookupSize = Object.keys(hrLookup).length;

    orphanEmails.forEach(function(em) {
      const hrEntry = hrLookup[em];
      if (hrEntry && hrEntry.cedula) {
        // Stub: solo cedula+nombre+correo, sin empresa/sede/cc/aprobadores/pin.
        // El admin puede completarlo después desde el sidebar si lo necesita.
        stubRows.push({
          cedula: hrEntry.cedula,
          nombre: hrEntry.nombre || em,
          correo: em,
          empresa: '',
          sede: '',
          centroCosto: '',
          pinHash: '',
          aprobCorreos: []
        });
        emailToCedula[em] = hrEntry.cedula;
      } else {
        stillOrphan.push(em);
      }
    });
  }

  // ============= PASO 4: Resolver aprobadores → cédulas con mapa completo =============
  const allRows = parsedRows.concat(stubRows);
  const unresolvedRefs = []; // referencias específicas que aún no se pueden resolver

  allRows.forEach(function(r) {
    const cedulas = [];
    r.aprobCorreos.forEach(function(em) {
      const ced = emailToCedula[em];
      if (ced) {
        cedulas.push(ced);
      } else {
        unresolvedRefs.push({ usuario: r.correo, aprobadorCorreo: em });
      }
    });
    r.cedulasAprobadores = cedulas.join(', ');
  });

  // Lookup cedula → {nombre, correo} para resolver cols H/I al escribir
  const cedulaLookup = {};
  allRows.forEach(function(r) {
    if (r.cedula) {
      cedulaLookup[r.cedula] = { nombre: r.nombre, correo: r.correo };
    }
  });

  // ============= PASO 5: Escribir USUARIOS =============
  allRows.forEach(function(r, idx) {
    _writeUsuarioRow_(usuarios, idx + 2, r, cedulaLookup);
  });
  SpreadsheetApp.flush();

  // ============= REPORTE =============
  let msg = 'Migración completa.\n\n';
  msg += '• Filas desde INTEGRANTES: ' + parsedRows.length + '\n';
  msg += '• PINs preservados: ' + migratedPins + '\n';
  msg += '• Stubs creados desde Maestro RH: ' + stubRows.length + '\n';
  msg += '• Aprobadores aún no resueltos: ' + stillOrphan.length + '\n';
  msg += '• Total filas en USUARIOS: ' + allRows.length + '\n';

  if (hrError) {
    msg += '\n⚠️ Maestro RH: ' + hrError + '\n';
  } else if (orphanEmails.length > 0) {
    msg += '\nMaestro RH leído OK (' + hrLookupSize + ' empleados).\n';
  }

  if (stillOrphan.length > 0) {
    msg += '\nCorreos de aprobadores no encontrados en ningún lado:\n';
    stillOrphan.slice(0, 10).forEach(function(em) { msg += '  - ' + em + '\n'; });
    if (stillOrphan.length > 10) msg += '  ... y ' + (stillOrphan.length - 10) + ' más.\n';
    msg += '\nEstos usuarios tendrán aprobador vacío. Créalos desde el sidebar o agrégalos al Maestro RH y vuelve a migrar.';
    console.log('=== APROBADORES SIN RESOLVER ===');
    stillOrphan.forEach(function(em) { console.log(em); });
  }

  console.log('=== REFERENCIAS NO RESUELTAS POR USUARIO ===');
  unresolvedRefs.forEach(function(o) { console.log(o.usuario + ' → ' + o.aprobadorCorreo); });

  ui.alert(msg);
}

/**
 * Lee el Maestro RH (Spreadsheet externo) y retorna un lookup
 * { correo → {cedula, nombre} }. Si falla, retorna lookup vacío y un mensaje
 * de error en `error`.
 */
function _readMaestroRH_() {
  const id = HR_MAESTRO_ID;
  if (!id) {
    return { lookup: {}, error: 'HR_MAESTRO_ID no configurado.' };
  }
  try {
    const file = SpreadsheetApp.openById(id);
    const sheet = file.getSheetByName(HR_MAESTRO_SHEET) || file.getSheets()[0];
    if (!sheet) {
      return { lookup: {}, error: 'No se encontró pestaña "' + HR_MAESTRO_SHEET + '" en el Maestro RH.' };
    }
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { lookup: {}, error: 'Maestro RH vacío.' };
    }
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    // Match tolerante (lowercase + trim)
    const idxCedula = _findHeaderIndex_(headers, ['cc', 'cedula', 'cédula', 'cedula numero', 'numero documento']);
    const idxNombre = _findHeaderIndex_(headers, ['nombre', 'nombres', 'apellidos y nombres', 'nombre completo']);
    const idxCorreo = _findHeaderIndex_(headers, ['correo corporativo', 'correo', 'email', 'e-mail']);

    if (idxCedula < 0 || idxCorreo < 0) {
      return {
        lookup: {},
        error: 'Maestro RH: no se encontraron columnas de cédula o correo. Headers detectados: ' + headers.slice(0, 8).join(', ') + '...'
      };
    }

    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    const lookup = {};
    for (let i = 0; i < data.length; i++) {
      const correo = String(data[i][idxCorreo] || '').toLowerCase().trim();
      const cedula = String(data[i][idxCedula] || '').trim();
      const nombre = idxNombre >= 0 ? String(data[i][idxNombre] || '').trim() : '';
      if (correo && cedula) {
        lookup[correo] = { cedula: cedula, nombre: nombre };
      }
    }
    return { lookup: lookup, error: '' };
  } catch (e) {
    return {
      lookup: {},
      error: 'No se pudo abrir el Maestro RH (id=' + id + '): ' + e.message
    };
  }
}

function _findHeaderIndex_(headers, candidates) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').toLowerCase().trim();
    if (!h) continue;
    for (let j = 0; j < candidates.length; j++) {
      if (h === candidates[j]) return i;
    }
  }
  return -1;
}

/**
 * Escribe (o sobreescribe) una fila en USUARIOS.
 * Las columnas H (correos aprobadores) e I (nombres aprobadores) se escriben
 * como VALORES resueltos, no como fórmulas — locale-independent y robusto.
 *
 * Si `lookup` no se provee, se construye en caliente leyendo USUARIOS.
 * Si `lookup` se provee (caso migración masiva), evita N reads del sheet.
 */
function _writeUsuarioRow_(sheet, rowNumber, data, lookup) {
  const cedulasStr = String(data.cedulasAprobadores || '').trim();
  const resolved = _resolveAprobadores_(sheet, cedulasStr, lookup);

  sheet.getRange(rowNumber, 1, 1, 9).setValues([[
    String(data.cedula || '').trim(),
    String(data.nombre || '').trim(),
    String(data.correo || '').toLowerCase().trim(),
    String(data.empresa || '').trim(),
    String(data.sede || '').trim(),
    String(data.centroCosto || '').trim(),
    cedulasStr,
    resolved.correos,
    resolved.nombres
  ]]);
  if (data.pinHash !== undefined && data.pinHash !== null && data.pinHash !== '') {
    sheet.getRange(rowNumber, 10).setValue(data.pinHash);
  }
}

/**
 * Resuelve "1234, 5678" → { correos: "a@x.com, b@y.com", nombres: "Juan, Pedro" }
 * usando un lookup pre-construido `cedula → {nombre, correo}` o leyendo el
 * sheet en vivo si no se provee.
 */
function _resolveAprobadores_(sheet, cedulasStr, lookup) {
  if (!cedulasStr) return { correos: '', nombres: '' };
  if (!lookup) lookup = _buildCedulaLookup_(sheet);

  const cedulas = cedulasStr.split(',').map(function(c) { return c.trim(); }).filter(function(c) { return c; });
  const correos = [];
  const nombres = [];
  cedulas.forEach(function(ced) {
    const entry = lookup[ced];
    if (entry) {
      correos.push(entry.correo || '');
      nombres.push(entry.nombre || '');
    } else {
      correos.push('(no resuelto)');
      nombres.push('(no resuelto)');
    }
  });
  return { correos: correos.join(', '), nombres: nombres.join(', ') };
}

/**
 * Construye un mapa { cedula → {nombre, correo} } leyendo toda la hoja
 * USUARIOS. Costoso (1 read), úsalo una sola vez en operaciones masivas.
 */
function _buildCedulaLookup_(sheet) {
  const lookup = {};
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return lookup;
  const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  for (let i = 0; i < data.length; i++) {
    const ced = String(data[i][0] || '').trim();
    if (!ced) continue;
    lookup[ced] = {
      nombre: String(data[i][1] || '').trim(),
      correo: String(data[i][2] || '').toLowerCase().trim()
    };
  }
  return lookup;
}

/**
 * Recorre USUARIOS y reescribe las columnas H e I de cada fila resolviendo
 * sus aprobadores con el snapshot actual de la hoja. Útil cuando se editó
 * col G manualmente, o cuando se agregaron nuevos usuarios que ahora pueden
 * resolver referencias antes huérfanas.
 */
function recargarResolucionesUsuarios() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_USUARIOS);
  if (!sheet) {
    ui.alert('No existe la hoja USUARIOS.');
    return;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    ui.alert('USUARIOS está vacía.');
    return;
  }
  const lookup = _buildCedulaLookup_(sheet);
  const cedulasCol = sheet.getRange(2, 7, lastRow - 1, 1).getValues();
  const newH = [];
  const newI = [];
  let resolvedCount = 0;
  let unresolvedCount = 0;
  cedulasCol.forEach(function(row) {
    const cedulasStr = String(row[0] || '').trim();
    const r = _resolveAprobadores_(sheet, cedulasStr, lookup);
    newH.push([r.correos]);
    newI.push([r.nombres]);
    if (cedulasStr) {
      if (r.correos.indexOf('(no resuelto)') > -1) unresolvedCount++;
      else resolvedCount++;
    }
  });
  sheet.getRange(2, 8, newH.length, 1).setValues(newH);
  sheet.getRange(2, 9, newI.length, 1).setValues(newI);
  SpreadsheetApp.flush();
  ui.alert(
    'Resoluciones recargadas.\n\n' +
    '• Filas con aprobadores resueltos: ' + resolvedCount + '\n' +
    '• Filas con al menos un aprobador no resuelto: ' + unresolvedCount
  );
}

function _findUsuarioRowByCedula_(sheet, cedula) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const target = String(cedula).trim();
  if (!target) return -1;
  const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === target) return i + 2;
  }
  return -1;
}

// --- Sidebar API (llamada desde AdminSidebar.html via google.script.run) ---

function usuarios_listAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_USUARIOS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const lastRow = sheet.getLastRow();
  // Lee 10 columnas (incluye PIN en col 10) para detectar si hay hash
  const data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  return data.filter(function(r) { return r[0]; }).map(function(r) {
    return {
      cedula: String(r[0]).trim(),
      nombre: String(r[1]).trim(),
      correo: String(r[2]).toLowerCase().trim(),
      empresa: String(r[3]).trim(),
      sede: String(r[4]).trim(),
      centroCosto: String(r[5]).trim(),
      cedulasAprobadores: String(r[6]).trim(),
      correosAprobadores: String(r[7]).trim(),
      nombresAprobadores: String(r[8]).trim(),
      // Solo expone si hay PIN (boolean) — NUNCA el hash al frontend
      hasPin: !!String(r[9] || '').trim()
    };
  });
}

/**
 * Borra el hash de PIN de un usuario. Después de esto, el usuario tendrá
 * que volver a pedir su PIN desde el flujo normal del frontend (login).
 */
function usuarios_clearPin(cedula) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_USUARIOS);
  if (!sheet) throw new Error('Hoja USUARIOS no encontrada.');
  const row = _findUsuarioRowByCedula_(sheet, cedula);
  if (row < 0) throw new Error('Usuario no encontrado.');
  sheet.getRange(row, 10).clearContent();
  SpreadsheetApp.flush();
  return { success: true };
}

/**
 * Lee el Maestro RH (Spreadsheet externo) y retorna el catálogo de empleados
 * con cédula+nombre+correo, usado para autocompletar el form de "nuevo usuario"
 * en el sidebar. Reemplaza la antigua sección roja de INTEGRANTES.
 *
 * Si el Maestro RH no se puede leer, intenta como fallback la sección roja
 * de INTEGRANTES (compatibilidad temporal con setups donde aún no se ha
 * configurado HR_MAESTRO_ID).
 */
function usuarios_getCatalogoOrg() {
  const hrResult = _readMaestroRH_();
  if (!hrResult.error && hrResult.lookup) {
    const out = [];
    Object.keys(hrResult.lookup).forEach(function(email) {
      const entry = hrResult.lookup[email];
      out.push({
        cedula: entry.cedula || '',
        nombre: entry.nombre || '',
        correo: email
      });
    });
    return out.filter(function(x) { return x.nombre && x.correo; });
  }

  // Fallback: leer la sección roja antigua de INTEGRANTES
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_INTEGRANTES);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idxNombre = headers.indexOf('nombre');
  const idxCorreo = headers.indexOf('Correo corporativo');
  if (idxNombre < 0 || idxCorreo < 0) return [];
  const lastRow = sheet.getLastRow();
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  return data.map(function(r) {
    return {
      cedula: '',
      nombre: String(r[idxNombre] || '').trim(),
      correo: String(r[idxCorreo] || '').toLowerCase().trim()
    };
  }).filter(function(x) { return x.nombre && x.correo; });
}

function usuarios_getSedes() {
  try { return getSites() || []; } catch (e) { return []; }
}

function usuarios_getEmpresas() {
  return ['Cumandes', 'Equitel', 'Ingenergía', 'LAP'];
}

/**
 * Traduce códigos abreviados de empresa (usados en INTEGRANTES) a nombres
 * completos (usados en USUARIOS y en el frontend). Si el valor ya es un
 * nombre completo o no se reconoce, se devuelve tal cual.
 */
function _mapEmpresaCode_(raw) {
  if (!raw) return '';
  var lookup = { 'CU': 'Cumandes', 'ET': 'Equitel', 'IG': 'Ingenergía', 'LI': 'LAP' };
  var upper = raw.toUpperCase().trim();
  return lookup[upper] || raw;
}

function usuarios_create(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_USUARIOS);
  if (!sheet) throw new Error('Hoja USUARIOS no encontrada. Crea la hoja primero.');

  const cedula = String(data.cedula || '').trim();
  if (!cedula) throw new Error('Cédula es requerida.');
  if (!data.nombre || !String(data.nombre).trim()) throw new Error('Nombre es requerido.');
  const correo = String(data.correo || '').toLowerCase().trim();
  if (!correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error('Correo inválido.');

  if (_findUsuarioRowByCedula_(sheet, cedula) > 0) {
    throw new Error('Ya existe un usuario con esa cédula.');
  }

  const newRow = sheet.getLastRow() + 1;
  _writeUsuarioRow_(sheet, newRow, {
    cedula: cedula,
    nombre: data.nombre,
    correo: correo,
    empresa: data.empresa,
    sede: data.sede,
    centroCosto: data.centroCosto,
    cedulasAprobadores: data.cedulasAprobadores
  });
  SpreadsheetApp.flush();
  return { success: true, cedula: cedula };
}

function usuarios_update(originalCedula, data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_USUARIOS);
  if (!sheet) throw new Error('Hoja USUARIOS no encontrada.');

  const row = _findUsuarioRowByCedula_(sheet, originalCedula);
  if (row < 0) throw new Error('Usuario no encontrado.');

  const newCedula = String(data.cedula || '').trim();
  if (!newCedula) throw new Error('Cédula es requerida.');
  if (newCedula !== String(originalCedula).trim()) {
    const existing = _findUsuarioRowByCedula_(sheet, newCedula);
    if (existing > 0 && existing !== row) {
      throw new Error('Otra fila ya tiene esa cédula.');
    }
  }

  const correo = String(data.correo || '').toLowerCase().trim();
  if (!correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error('Correo inválido.');

  // Preservar el hash de PIN existente
  const existingPin = String(sheet.getRange(row, 10).getValue() || '').trim();

  _writeUsuarioRow_(sheet, row, {
    cedula: newCedula,
    nombre: data.nombre,
    correo: correo,
    empresa: data.empresa,
    sede: data.sede,
    centroCosto: data.centroCosto,
    cedulasAprobadores: data.cedulasAprobadores,
    pinHash: existingPin
  });
  SpreadsheetApp.flush();
  return { success: true };
}

function usuarios_delete(cedula) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_USUARIOS);
  if (!sheet) throw new Error('Hoja USUARIOS no encontrada.');
  const row = _findUsuarioRowByCedula_(sheet, cedula);
  if (row < 0) throw new Error('Usuario no encontrado.');
  sheet.deleteRow(row);
  SpreadsheetApp.flush();
  return { success: true };
}

/**
 * Borra una fila específica de USUARIOS por su rowNumber físico.
 * Necesario para casos de cédulas duplicadas donde _findUsuarioRowByCedula_
 * siempre retorna la primera. LockService evita condiciones de carrera
 * (otro sidebar o script podría estar escribiendo).
 *
 * @param {number} rowNumber Fila 1-indexed (con headers en fila 1).
 * @param {string} [expectedCedula] Opcional: si se provee, valida que la
 *   cédula actual en esa fila coincide antes de borrar. Previene borrar
 *   la fila equivocada si el sheet fue modificado entre load y delete.
 */
function usuarios_deleteByRow(rowNumber, expectedCedula) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    throw new Error('Sistema ocupado. Intente de nuevo en unos segundos.');
  }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME_USUARIOS);
    if (!sheet) throw new Error('Hoja USUARIOS no encontrada.');
    var row = Number(rowNumber);
    if (!row || row < 2 || row > sheet.getLastRow()) {
      throw new Error('Número de fila inválido: ' + rowNumber);
    }
    if (expectedCedula !== undefined && expectedCedula !== null) {
      var actualCedula = String(sheet.getRange(row, 1).getValue() || '').trim();
      if (actualCedula !== String(expectedCedula).trim()) {
        throw new Error('La fila ' + row + ' contiene "' + actualCedula + '", no "' + expectedCedula + '". El sheet cambió — recarga e intenta de nuevo.');
      }
    }
    sheet.deleteRow(row);
    SpreadsheetApp.flush();
    return { success: true, deletedRow: row };
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// DETECTOR DE DUPLICADOS
// =====================================================================

/**
 * Encuentra filas de USUARIOS duplicadas por cédula, correo o nombre.
 * Para cada grupo retorna todas las filas con la clave repetida, incluyendo
 * rowNumber físico en el sheet (útil para feedback visual). Permite al admin
 * comparar y decidir cuál conservar.
 *
 * Estrategia: comparación case-insensitive + trim para detectar variantes
 * (ej: "JUAN PEREZ" y "juan perez" como el mismo nombre).
 *
 * @returns {{ byCedula: Array, byCorreo: Array, byNombre: Array }}
 */
function usuarios_findDuplicates() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_USUARIOS);
  if (!sheet || sheet.getLastRow() < 2) {
    return { byCedula: [], byCorreo: [], byNombre: [] };
  }

  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();

  // Normaliza y captura rowNumber
  var rows = [];
  data.forEach(function(r, i) {
    var cedula = String(r[0] || '').trim();
    var nombre = String(r[1] || '').trim();
    var correo = String(r[2] || '').toLowerCase().trim();
    // Solo considera filas con al menos un campo (saltar filas totalmente vacías)
    if (!cedula && !nombre && !correo) return;
    rows.push({
      rowNumber: i + 2, // 1-indexed en sheet
      cedula: cedula,
      nombre: nombre,
      correo: correo,
      empresa: String(r[3] || '').trim(),
      sede: String(r[4] || '').trim(),
      centroCosto: String(r[5] || '').trim(),
      cedulasAprobadores: String(r[6] || '').trim(),
      nombresAprobadores: String(r[8] || '').trim(),
      hasPin: !!String(r[9] || '').trim()
    });
  });

  function groupBy(keyFn) {
    var groups = {};
    rows.forEach(function(r) {
      var k = keyFn(r);
      if (!k) return;
      if (!groups[k]) groups[k] = [];
      groups[k].push(r);
    });
    return Object.keys(groups)
      .filter(function(k) { return groups[k].length > 1; })
      .sort()
      .map(function(k) { return { key: k, users: groups[k] }; });
  }

  return {
    byCedula: groupBy(function(r) { return r.cedula; }),
    byCorreo: groupBy(function(r) { return r.correo; }),
    byNombre: groupBy(function(r) { return r.nombre.toLowerCase(); })
  };
}


// =====================================================================
// REEMPLAZO MASIVO DE APROBADOR
// =====================================================================

/**
 * Encuentra todos los usuarios cuya col G (cédulas aprobadores) contiene
 * la cédula dada. Útil para vista previa antes de un reemplazo masivo.
 */
function usuarios_findUsersWithApprover(cedulaAprobador) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_USUARIOS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const target = String(cedulaAprobador).trim();
  if (!target) return [];

  const lastRow = sheet.getLastRow();
  const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const result = [];
  data.forEach(function(r, i) {
    const cedulasAprob = String(r[6] || '').split(',').map(function(c) { return c.trim(); });
    if (cedulasAprob.indexOf(target) !== -1) {
      result.push({
        rowNumber: i + 2,
        cedula: String(r[0]).trim(),
        nombre: String(r[1]).trim(),
        correo: String(r[2]).toLowerCase().trim(),
        cedulasAprobadores: String(r[6]).trim()
      });
    }
  });
  return result;
}

/**
 * Reemplaza la cédula de un aprobador por otra en TODOS los usuarios que la
 * tengan en col G. Re-resuelve cols H/I para los afectados. Atómico desde
 * la perspectiva del flush — si algo falla, la operación se aborta.
 *
 * Validaciones:
 * - newCedula debe existir como fila en USUARIOS
 * - oldCedula y newCedula no pueden ser iguales
 */
function usuarios_replaceApprover(oldCedula, newCedula) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_USUARIOS);
  if (!sheet) throw new Error('Hoja USUARIOS no encontrada.');

  const oldStr = String(oldCedula || '').trim();
  const newStr = String(newCedula || '').trim();
  if (!oldStr || !newStr) throw new Error('Cédulas inválidas.');
  if (oldStr === newStr) throw new Error('La cédula vieja y la nueva son iguales.');

  // El nuevo aprobador debe existir como usuario
  if (_findUsuarioRowByCedula_(sheet, newStr) < 0) {
    throw new Error('La cédula nueva (' + newStr + ') no existe en USUARIOS. Créala primero.');
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { affected: 0 };

  const lookup = _buildCedulaLookup_(sheet);
  const cedulasCol = sheet.getRange(2, 7, lastRow - 1, 1).getValues();
  let affected = 0;
  const affectedRows = [];

  cedulasCol.forEach(function(row, idx) {
    const original = String(row[0] || '').trim();
    if (!original) return;
    const cedulas = original.split(',').map(function(c) { return c.trim(); }).filter(function(c) { return c; });
    if (cedulas.indexOf(oldStr) === -1) return;

    // Reemplazar (preservando duplicados teóricos)
    const replaced = cedulas.map(function(c) { return c === oldStr ? newStr : c; });
    // Deduplicar por si new ya estaba presente además de old
    const seen = {};
    const dedup = replaced.filter(function(c) {
      if (seen[c]) return false;
      seen[c] = true;
      return c;
    });
    const updated = dedup.join(', ');

    affectedRows.push({
      rowNumber: idx + 2,
      newG: updated
    });
    affected++;
  });

  // Aplicar cambios
  affectedRows.forEach(function(a) {
    const r = _resolveAprobadores_(sheet, a.newG, lookup);
    sheet.getRange(a.rowNumber, 7).setValue(a.newG);
    sheet.getRange(a.rowNumber, 8).setValue(r.correos);
    sheet.getRange(a.rowNumber, 9).setValue(r.nombres);
  });
  SpreadsheetApp.flush();

  return { affected: affected };
}

// =====================================================================
// EDICIÓN MASIVA
// =====================================================================

/**
 * Aplica un cambio masivo a un conjunto de usuarios seleccionados.
 *
 * @param {Object} payload
 *   - action: 'setApprovers' | 'addApprover' | 'empresa' | 'sede' | 'centroCosto'
 *   - cedulas: string[]  — cédulas de los usuarios a modificar
 *   - value: string      — nuevo valor (cédulas de aprobadores separadas por coma, o texto según acción)
 * @returns {{ affected: number }}
 */
function usuarios_bulkUpdate(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_USUARIOS);
  if (!sheet) throw new Error('Hoja USUARIOS no encontrada.');

  var action = String(payload.action || '');
  var targetCedulas = payload.cedulas;
  var value = String(payload.value || '').trim();

  if (!targetCedulas || !targetCedulas.length) throw new Error('No se seleccionaron usuarios.');
  if (!action) throw new Error('Acción no especificada.');

  var validActions = ['setApprovers', 'addApprover', 'empresa', 'sede', 'centroCosto'];
  if (validActions.indexOf(action) === -1) throw new Error('Acción inválida: ' + action);

  // Para acciones de propiedad simple, value no puede estar vacío
  if (['empresa', 'sede', 'centroCosto'].indexOf(action) > -1 && !value) {
    throw new Error('El valor no puede estar vacío.');
  }

  var lookup = _buildCedulaLookup_(sheet);

  // Validar aprobadores si aplica
  if (action === 'setApprovers' || action === 'addApprover') {
    if (!value) throw new Error('Debe especificar al menos un aprobador.');
    var approverCedulas = value.split(',').map(function(c) { return c.trim(); }).filter(function(c) { return c; });
    approverCedulas.forEach(function(ced) {
      if (!lookup[ced]) throw new Error('Cédula de aprobador ' + ced + ' no existe en USUARIOS.');
    });
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('No hay usuarios.');
  var data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();

  // Build target set for O(1) lookups
  var targetSet = {};
  targetCedulas.forEach(function(c) { targetSet[String(c).trim()] = true; });

  // Column indices (1-based for sheet.getRange): A=1..J=10
  var COL_G = 7; // Cedulas Aprobadores
  var COL_H = 8; // Correos Aprobadores (auto)
  var COL_I = 9; // Nombres Aprobadores (auto)
  var colMap = { empresa: 4, sede: 5, centroCosto: 6 };

  var affected = 0;

  data.forEach(function(row, idx) {
    var ced = String(row[0]).trim();
    if (!targetSet[ced]) return;
    var rowNumber = idx + 2;

    switch (action) {
      case 'setApprovers': {
        var resolved = _resolveAprobadores_(sheet, value, lookup);
        sheet.getRange(rowNumber, COL_G).setValue(value);
        sheet.getRange(rowNumber, COL_H).setValue(resolved.correos);
        sheet.getRange(rowNumber, COL_I).setValue(resolved.nombres);
        break;
      }
      case 'addApprover': {
        var existing = String(row[6] || '').trim();
        var existingArr = existing ? existing.split(',').map(function(c) { return c.trim(); }).filter(function(c) { return c; }) : [];
        var toAdd = value.split(',').map(function(c) { return c.trim(); }).filter(function(c) { return c; });
        toAdd.forEach(function(a) {
          if (existingArr.indexOf(a) === -1) existingArr.push(a);
        });
        var newG = existingArr.join(', ');
        var resolved = _resolveAprobadores_(sheet, newG, lookup);
        sheet.getRange(rowNumber, COL_G).setValue(newG);
        sheet.getRange(rowNumber, COL_H).setValue(resolved.correos);
        sheet.getRange(rowNumber, COL_I).setValue(resolved.nombres);
        break;
      }
      case 'empresa':
      case 'sede':
      case 'centroCosto': {
        sheet.getRange(rowNumber, colMap[action]).setValue(value);
        break;
      }
    }
    affected++;
  });

  SpreadsheetApp.flush();
  return { affected: affected };
}

// =====================================================================
// REORGANIZACIÓN DE LA HOJA PRINCIPAL "Nueva Base Solicitudes"
// =====================================================================
// Workflow seguro de 6 pasos:
//   1. Crear hoja de trabajo paralela con headers canónicos
//   2. (Manual) Admin reorganiza columnas en la hoja
//   3. Verificar headers (¿están todos los requeridos?)
//   4. Migrar datos + validaciones + formatos + colores editables
//   5. Verificar (preview de filas migradas)
//   6. Switch: renombrar hoja vieja a *_OLD_<fecha>, hoja nueva a canónica
//
// Diseño defensivo: NUNCA toca la hoja original hasta el paso 6 (switch).
// Si algo falla, la hoja vieja sigue activa y la nueva queda como respaldo.
// =====================================================================

// Columnas que el analista de compras puede editar — fondo amarillo claro tras la migración.
// Definidas explícitamente según el flujo de gestión (ver memoria del proyecto).
const NBS_EDITABLE_COLUMNS = [
  'NOMBRE HOTEL',
  'PERSONA QUE TRAMITA EL TIQUETE /HOTEL',
  'TIPO DE COMPRA DE TKT',
  'FECHA DE FACTURA',
  '# DE FACTURA',
  'VALOR PAGADO A AEROLINEA Y/O HOTEL',
  'VALOR PAGADO A AVIATUR Y/O IVA',
  'TOTAL FACTURA',
  'TARJETA DE CREDITO CON LA QUE SE HIZO LA COMPRA',
  'COSTO_FINAL_TIQUETES',
  'COSTO_FINAL_HOTEL'
];
const NBS_EDITABLE_BG = '#FFF9C4'; // amarillo claro

// Carpeta de Drive para backups. Sobreescribible vía Script Property BACKUP_FOLDER_ID.
const BACKUP_FOLDER_ID = getConfig_('BACKUP_FOLDER_ID', '1psDuvtdUCxmRnBmFI8P3LPyVXvDUh-t6');

/**
 * SECURITY: verifica que el usuario actual sea analyst/admin.
 * Lanza excepción si no lo es. Debe llamarse al inicio de CADA función nbs_*.
 * Sin esto, cualquier usuario con acceso de edición al sheet podría ejecutar
 * switchMain/migrateData vía el sidebar y romper la base.
 *
 * Intenta obtener el email con dos métodos: getActiveUser (usuario que abrió
 * el sheet) y getEffectiveUser (usuario autorizado). Algunas veces uno devuelve
 * empty string según el contexto de dominio.
 */
function _requireAnalyst_() {
  var email = String(Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  if (!email) {
    // Fallback: getEffectiveUser para cuando getActiveUser devuelve '' por
    // restricciones de dominio cruzado.
    email = String(Session.getEffectiveUser().getEmail() || '').toLowerCase().trim();
  }
  if (!email) {
    throw new Error('No se pudo identificar al usuario. Asegúrate de estar autenticado con tu correo corporativo.');
  }
  if (!isUserAnalyst(email)) {
    var whitelist = getAnalystWhitelist_();
    throw new Error(
      'Acción no autorizada. Correo detectado: "' + email + '". ' +
      'Whitelist actual: ' + JSON.stringify(whitelist) + '. ' +
      'Ejecuta actualizarAnalystEmails() si necesitas agregarlo.'
    );
  }
}

/**
 * Normaliza un header para comparación tolerante a:
 *  - Espacios múltiples (los colapsa a uno solo)
 *  - Forma Unicode NFC vs NFD (p.ej. "CÉDULA" en NFC vs NFD)
 *  - Caracteres invisibles (BOM, ZWSP, soft hyphen, directional marks)
 *  - Espacios en extremos
 *  - Diferentes tipos de espacio (NBSP, tab, etc → espacio regular)
 * NO hace lowercase — preserva case (case-sensitive por diseño).
 */
function _normalizeHeader_(h) {
  if (!h) return '';
  var s = String(h).normalize('NFC');
  // Strip caracteres invisibles que confunden la comparación:
  //   U+00AD      soft hyphen
  //   U+200B-200F zero-width spaces + directional marks
  //   U+202A-202E directional override chars
  //   U+2060      word joiner
  //   U+FEFF      byte-order mark
  s = s.replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '');
  // Colapsa cualquier whitespace (incluye NBSP U+00A0, tab, etc.) a espacio simple
  s = s.replace(/\s+/g, ' ');
  return s.trim();
}

/**
 * Devuelve una representación debug de un string con códigos Unicode de
 * cada carácter. Útil cuando un header "parece" canónico visualmente pero
 * no compara como tal — revela caracteres invisibles.
 * Ejemplo: "ID\u00A0RESPUESTA" → "ID[U+00A0 NBSP]RESPUESTA"
 */
function _debugHeader_(h) {
  if (!h) return '(vacío)';
  var s = String(h);
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    var ch = s.charAt(i);
    // Chars "normales" visibles (letras, dígitos, espacio simple, guión, paréntesis, #, ¿, ?, /, _)
    if ((c >= 32 && c <= 126) || (c >= 192 && c <= 255)) {
      out += ch;
    } else {
      out += '[U+' + ('0000' + c.toString(16).toUpperCase()).slice(-4) + ']';
    }
  }
  return out;
}

// Columnas de dinero — formato pesos colombianos. Se aplica SIEMPRE (no negociable).
const NBS_CURRENCY_COLUMNS = [
  'COSTO COTIZADO PARA VIAJE',
  'VALOR PAGADO A AEROLINEA Y/O HOTEL',
  'VALOR PAGADO A AVIATUR Y/O IVA',
  'TOTAL FACTURA',
  'PRESUPUESTO',
  'COSTO_FINAL_TIQUETES',
  'COSTO_FINAL_HOTEL'
];
const NBS_CURRENCY_FORMAT = '"$"#,##0'; // Render: $1,200,000 (Sheets locale adapta separadores)

/**
 * Paso 1: Crea una hoja de trabajo paralela con todos los headers canónicos
 * en orden default. El admin puede luego reorganizar las columnas a mano.
 */
function nbs_createWorkSheet(targetName) {
  _requireAnalyst_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = String(targetName || '').trim();
  if (!name) throw new Error('Nombre de hoja requerido.');
  if (name === SHEET_NAME_REQUESTS) throw new Error('No puedes usar el nombre de la hoja activa. Usa otro temporal (ej: "Nueva Base 1").');
  if (ss.getSheetByName(name)) throw new Error('Ya existe una hoja con ese nombre.');

  var sheet = ss.insertSheet(name);
  sheet.getRange(1, 1, 1, HEADERS_REQUESTS.length).setValues([HEADERS_REQUESTS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS_REQUESTS.length)
    .setFontWeight('bold').setBackground('#D71920').setFontColor('white');
  return { ok: true, name: name, columns: HEADERS_REQUESTS.length };
}

/**
 * Paso 3: Verifica la estructura de la hoja de trabajo.
 * Retorna {ok, missing[], extra[], total}.
 *  - missing: headers canónicos que faltan
 *  - extra: headers que existen en el sheet pero NO en el canónico (preservados, no se borran)
 */
function nbs_verifyWorkSheet(targetName) {
  _requireAnalyst_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(targetName);
  if (!sheet) throw new Error('No existe la hoja "' + targetName + '".');
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) throw new Error('La hoja no tiene columnas.');

  // Normalizar headers con NFC + colapsar espacios múltiples
  var rawHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var headers = rawHeaders.map(_normalizeHeader_);

  // Detectar duplicados
  var counts = {};
  headers.forEach(function(h) {
    if (!h) return;
    counts[h] = (counts[h] || 0) + 1;
  });
  var duplicates = Object.keys(counts).filter(function(k) { return counts[k] > 1; });

  var present = {};
  headers.forEach(function(h) { if (h) present[h] = true; });

  var missing = [];
  HEADERS_REQUESTS.forEach(function(canonical) {
    if (!present[canonical]) missing.push(canonical);
  });

  var canonicalSet = {};
  HEADERS_REQUESTS.forEach(function(c) { canonicalSet[c] = true; });
  var extra = headers.filter(function(h) { return h && !canonicalSet[h]; });
  // Remove duplicate entries from `extra` so each name appears once
  var seenExtra = {};
  extra = extra.filter(function(h) {
    if (seenExtra[h]) return false;
    seenExtra[h] = true;
    return true;
  });

  return {
    ok: missing.length === 0 && duplicates.length === 0,
    missing: missing,
    extra: extra,
    duplicates: duplicates,
    totalCanonical: HEADERS_REQUESTS.length,
    totalInSheet: headers.filter(function(h) { return h; }).length
  };
}

/**
 * Paso 4: Migra los datos de la hoja activa a la hoja de trabajo.
 *
 * Orden de operaciones (equivalente a Ctrl+V "Pegar todo" por columna):
 *   1. Build header maps de fuente y destino (con normalización Unicode)
 *   2. Build column mappings (por nombre de header)
 *   3. WRITE DATA: escribe los valores columna por columna
 *   4. POST-FORMAT: aplica validaciones, formatos y colores DESPUÉS de los
 *      datos, usando copyTo(PASTE_DATA_VALIDATION) y copyTo(PASTE_FORMAT) —
 *      idéntico a lo que hace Ctrl+V en Sheets. Esto garantiza que los
 *      dropdowns y formatos se preserven exactamente como en el original.
 *   5. Auto-resize columnas mapeadas
 *
 * Las columnas extras (no canónicas) en destino NUNCA se tocan: preserva
 * sus datos, validaciones y formatos.
 */
function nbs_migrateData(sourceName, targetName, options) {
  _requireAnalyst_();
  options = options || {};
  var migrateValidations = options.migrateValidations !== false;
  var applyEditableColors = options.applyEditableColors !== false;
  var autoResize = options.autoResize !== false;

  // LOCK para evitar escrituras simultáneas durante la migración.
  // Protege contra createRequest/updateRequest ejecutándose en paralelo.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    throw new Error('Sistema ocupado. Intente de nuevo en unos segundos.');
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var source = ss.getSheetByName(sourceName);
    var target = ss.getSheetByName(targetName);
    if (!source) throw new Error('Hoja fuente "' + sourceName + '" no encontrada.');
    if (!target) throw new Error('Hoja destino "' + targetName + '" no encontrada.');
    if (sourceName === targetName) throw new Error('Fuente y destino son la misma hoja.');

    // ========== 1. HEADERS + MAPPINGS (con normalización NFC) ==========
    var srcLastCol = source.getLastColumn();
    var srcHeaders = source.getRange(1, 1, 1, srcLastCol).getValues()[0].map(_normalizeHeader_);
    var tgtLastCol = target.getLastColumn();
    var tgtHeaders = target.getRange(1, 1, 1, tgtLastCol).getValues()[0].map(_normalizeHeader_);

    var srcMap = {}; srcHeaders.forEach(function(h, i) { if (h) srcMap[h] = i; });
    var tgtMap = {}; tgtHeaders.forEach(function(h, i) { if (h) tgtMap[h] = i; });

    var srcLastRow = source.getLastRow();
    if (srcLastRow < 2) {
      return { rowsCopied: 0, validationsCopied: 0, columnsMapped: 0 };
    }

    var colMappings = []; // [{ srcCol, tgtCol, name }]
    Object.keys(srcMap).forEach(function(name) {
      if (tgtMap[name] !== undefined) {
        colMappings.push({ srcCol: srcMap[name], tgtCol: tgtMap[name], name: name });
      }
    });

    // GUARD: debe haber al menos 1 columna mapeada, si no es una hoja destino
    // completamente diferente que destruiría los datos.
    if (colMappings.length === 0) {
      throw new Error('No hay columnas con el mismo nombre entre fuente y destino. Verifica los headers.');
    }

    // ========== 2. ENSURE TARGET HAS ENOUGH ROWS ==========
    var numRows = srcLastRow - 1;
    var tgtMaxRows = target.getMaxRows();
    if (tgtMaxRows < numRows + 1) {
      target.insertRowsAfter(tgtMaxRows, (numRows + 1) - tgtMaxRows);
    }

    // Precomputar sets para lookups rápidos en las 2 fases
    var currencySet = {};
    NBS_CURRENCY_COLUMNS.forEach(function(n) { currencySet[n] = true; });
    var editableSet = {};
    NBS_EDITABLE_COLUMNS.forEach(function(n) { editableSet[n] = true; });

    var validationsCopied = 0;
    var formatsCopied = 0;
    var coloredColumns = 0;
    var currencyApplied = 0;

    // ========== 3. WRITE DATA FIRST (columna por columna, sin tocar extras) ==========
    // Escribimos PRIMERO los valores y DESPUÉS las validaciones/formatos/colores.
    // Razón: setValues en celdas con validación puede generar conflictos si el
    // valor no cumple la regla. Aplicando las reglas después, los valores ya
    // escritos no se revalidan y las reglas quedan en su lugar para futuras
    // ediciones — exactamente como Ctrl+V "Pegar todo" lo hace en Sheets.
    var srcData = source.getRange(2, 1, numRows, srcLastCol).getValues();

    colMappings.forEach(function(m) {
      var colValues = [];
      for (var r = 0; r < numRows; r++) {
        colValues.push([srcData[r][m.srcCol]]);
      }
      target.getRange(2, m.tgtCol + 1, numRows, 1).setValues(colValues);
    });
    SpreadsheetApp.flush();

    // ========== 4. POST-FORMAT: validaciones + formatos + colores ==========
    // Aplicar DESPUÉS de los datos usando copyTo (equivalente a Ctrl+V).
    // Esto es más robusto que setDataValidation porque copia por-celda.
    colMappings.forEach(function(m) {
      var tgtCol1 = m.tgtCol + 1;
      var srcCol1 = m.srcCol + 1;

      // 4a. VALIDACIÓN: copyTo(PASTE_DATA_VALIDATION) — igual que Ctrl+V
      // Copia las reglas de validación de cada celda del rango fuente a la
      // misma posición en destino, sin tocar valores. Preserva dropdowns
      // aunque el admin los haya aplicado por celda, por rango o por columna.
      if (migrateValidations) {
        try {
          var srcRange = source.getRange(2, srcCol1, numRows, 1);
          var tgtRange = target.getRange(2, tgtCol1, numRows, 1);
          srcRange.copyTo(tgtRange, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
          // Verificar que al menos 1 celda del target quedó con validación
          var sample = target.getRange(2, tgtCol1, Math.min(10, numRows), 1).getDataValidations();
          for (var si = 0; si < sample.length; si++) {
            if (sample[si][0]) { validationsCopied++; break; }
          }
        } catch (e) {
          console.warn('Validation copy failed for ' + m.name + ': ' + e);
        }
      }

      // 4b. NUMBER FORMAT: copyTo(PASTE_FORMAT) preserva formato numérico,
      // alineación y bordes. Luego si es moneda, sobreescribe con el formato
      // canónico de pesos colombianos.
      try {
        var srcRangeFmt = source.getRange(2, srcCol1, numRows, 1);
        var tgtRangeFmt = target.getRange(2, tgtCol1, numRows, 1);
        srcRangeFmt.copyTo(tgtRangeFmt, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
        formatsCopied++;
        if (currencySet[m.name]) {
          tgtRangeFmt.setNumberFormat(NBS_CURRENCY_FORMAT);
          currencyApplied++;
        }
      } catch (e) {
        console.warn('Format copy failed for ' + m.name + ': ' + e);
      }

      // 4c. FONDO AMARILLO: override del PASTE_FORMAT para columnas editables.
      if (applyEditableColors && editableSet[m.name]) {
        target.getRange(2, tgtCol1, numRows, 1).setBackground(NBS_EDITABLE_BG);
        coloredColumns++;
      }
    });

    SpreadsheetApp.flush();

    // ========== 5. AUTO-RESIZE COLUMNAS MAPEADAS ==========
    // Batch por rangos contiguos para minimizar round-trips.
    if (autoResize) {
      try {
        var sortedCols = colMappings.map(function(m) { return m.tgtCol + 1; })
          .sort(function(a, b) { return a - b; });
        var i = 0;
        while (i < sortedCols.length) {
          var start = sortedCols[i];
          var j = i + 1;
          while (j < sortedCols.length && sortedCols[j] === sortedCols[j - 1] + 1) j++;
          target.autoResizeColumns(start, j - i);
          i = j;
        }
      } catch (e) {
        console.warn('Auto-resize failed: ' + e);
      }
    }

    // Diagnóstico de mismatch con char codes para identificar chars invisibles
    var extraInTarget = tgtHeaders.filter(function(h) { return h && !srcMap[h]; });
    var droppedFromSource = srcHeaders.filter(function(h) { return h && !tgtMap[h]; });
    var mismatchDetails = [];
    if (extraInTarget.length > 0 || droppedFromSource.length > 0) {
      console.log('=== HEADER MISMATCH DEBUG ===');
      extraInTarget.forEach(function(h) {
        var debug = _debugHeader_(h);
        mismatchDetails.push('[target-only] "' + h + '" → ' + debug);
        console.log('[target-only] "' + h + '" → ' + debug);
      });
      droppedFromSource.forEach(function(h) {
        var debug = _debugHeader_(h);
        mismatchDetails.push('[source-only] "' + h + '" → ' + debug);
        console.log('[source-only] "' + h + '" → ' + debug);
      });
    }

    return {
      rowsCopied: numRows,
      columnsMapped: colMappings.length,
      validationsCopied: validationsCopied,
      formatsCopied: formatsCopied,
      currencyApplied: currencyApplied,
      coloredColumns: coloredColumns,
      extraInTarget: extraInTarget,
      droppedFromSource: droppedFromSource,
      mismatchDetails: mismatchDetails
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Paso 5 (helper): Lista los IDs de solicitudes en la hoja dada (para preview).
 */
function nbs_listRequests(sheetName, limit) {
  _requireAnalyst_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Hoja "' + sheetName + '" no encontrada.');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(h) { return String(h || '').trim(); });
  var idCol = headers.indexOf('ID RESPUESTA');
  var dateCol = headers.indexOf('FECHA SOLICITUD');
  var statusCol = headers.indexOf('STATUS');
  if (idCol < 0) throw new Error('La hoja "' + sheetName + '" no tiene columna ID RESPUESTA.');

  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var out = [];
  for (var i = 0; i < data.length; i++) {
    var id = String(data[i][idCol] || '').trim();
    if (!id) continue;
    out.push({
      id: id,
      date: dateCol >= 0 ? String(data[i][dateCol] || '') : '',
      status: statusCol >= 0 ? String(data[i][statusCol] || '') : ''
    });
  }
  // Sort newest first by ID (assuming SOL-NNNNNN format)
  out.sort(function(a, b) { return b.id.localeCompare(a.id); });
  if (limit && limit > 0) out = out.slice(0, limit);
  return out;
}

/**
 * Paso 5 (helper): Retorna todos los pares {header, value} de una solicitud
 * para que el admin verifique la migración celda por celda.
 */
function nbs_getRequestRow(sheetName, requestId) {
  _requireAnalyst_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Hoja "' + sheetName + '" no encontrada.');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(h) { return String(h || '').trim(); });
  var idCol = headers.indexOf('ID RESPUESTA');
  if (idCol < 0) throw new Error('No hay columna ID RESPUESTA en "' + sheetName + '".');

  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][idCol] || '').trim() === String(requestId).trim()) {
      var row = data[i];
      var pairs = [];
      headers.forEach(function(h, j) {
        if (h) {
          var val = row[j];
          if (val instanceof Date) val = val.toISOString();
          pairs.push({ header: h, value: String(val !== undefined && val !== null ? val : '') });
        }
      });
      return { id: requestId, pairs: pairs, rowNumber: i + 2 };
    }
  }
  return null;
}

/**
 * Paso 6: Switch atómico. Renombra la hoja activa a *_OLD_<fecha>, y
 * renombra la hoja de trabajo al nombre canónico.
 *
 * Tras este paso, el backend leerá automáticamente de la nueva hoja
 * (porque busca por SHEET_NAME_REQUESTS = 'Nueva Base Solicitudes').
 *
 * Reversible: si algo falla, basta con revertir los nombres manualmente.
 */
function nbs_switchMain(currentName, newName) {
  _requireAnalyst_();

  // LOCK: el switch hace dos setName() consecutivos. Sin lock, un usuario
  // escribiendo requests en paralelo puede encontrar el sheet renombrado
  // a mitad de su operación (race condition → pérdida de datos).
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    throw new Error('Sistema ocupado. Intente de nuevo en unos segundos.');
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (currentName !== SHEET_NAME_REQUESTS) {
      throw new Error('Solo puedes hacer switch desde la hoja activa "' + SHEET_NAME_REQUESTS + '".');
    }
    var current = ss.getSheetByName(currentName);
    var target = ss.getSheetByName(newName);
    if (!current) throw new Error('Hoja activa "' + currentName + '" no encontrada.');
    if (!target) throw new Error('Hoja de trabajo "' + newName + '" no encontrada.');

    // RE-VERIFY: antes de hacer el switch atómico, confirmar que la hoja destino
    // tiene TODOS los headers canónicos. Si falta alguno, el backend se rompe
    // inmediatamente después del switch. Mejor abortar aquí.
    var verify = nbs_verifyWorkSheet(newName);
    if (verify.missing.length > 0) {
      throw new Error('La hoja "' + newName + '" tiene headers canónicos faltantes: ' + verify.missing.join(', ') + '. Corrígelos antes del switch.');
    }
    if (verify.duplicates && verify.duplicates.length > 0) {
      throw new Error('La hoja "' + newName + '" tiene headers duplicados: ' + verify.duplicates.join(', ') + '. Corrígelos antes del switch.');
    }

    // Renombrar activa a _OLD_<fecha>
    var dateStr = Utilities.formatDate(new Date(), 'America/Bogota', 'yyyyMMdd_HHmm');
    var oldName = currentName + '_OLD_' + dateStr;
    var attempt = 0;
    while (ss.getSheetByName(oldName)) {
      attempt++;
      oldName = currentName + '_OLD_' + dateStr + '_' + attempt;
      if (attempt > 10) throw new Error('No se pudo encontrar un nombre disponible para la hoja antigua.');
    }
    current.setName(oldName);

    // Renombrar trabajo a canónica
    target.setName(currentName);

    // Limpiar cache de headers porque el "active" sheet cambió
    _clearReqHeadersCache_();
    SpreadsheetApp.flush();

    return {
      ok: true,
      oldSheetName: oldName,
      newActiveSheet: currentName
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Abre el sidebar de reorganización (separado del sidebar de USUARIOS).
 * GATED: solo accesible al analista/admin.
 */
function abrirSidebarReorg() {
  var ui = SpreadsheetApp.getUi();
  try {
    _requireAnalyst_();
  } catch (e) {
    // Pasa el mensaje real del error (incluye el email detectado y la whitelist)
    // para que se pueda diagnosticar si hay un mismatch.
    ui.alert('Acción no autorizada', e.message || String(e), ui.ButtonSet.OK);
    return;
  }
  var html = HtmlService.createHtmlOutputFromFile('ReorgSidebar')
    .setTitle('Reorganizar Base Principal');
  ui.showSidebar(html);
}

// =====================================================================
// BACKUP — copia de seguridad del spreadsheet completo a carpeta externa
// =====================================================================
// Pensado como función independiente (accesible desde el sidebar de reorg
// o como paso previo antes del switch). Copia TODO el archivo (todas las
// hojas incluyendo INTEGRANTES, USUARIOS, etc.) a una carpeta que el admin
// configura (típicamente su Drive personal / carpeta privada).
//
// Configuración: Script Property BACKUP_FOLDER_ID (opcional). Si no está
// configurada, la función acepta un folderId como parámetro explícito.
// =====================================================================

/**
 * Retorna la carpeta de backup configurada (url + nombre) o null si no hay.
 */
function nbs_getBackupFolderInfo() {
  _requireAnalyst_();
  var id = BACKUP_FOLDER_ID;
  if (!id) return { configured: false };
  try {
    var folder = DriveApp.getFolderById(id);
    return {
      configured: true,
      id: id,
      name: folder.getName(),
      url: folder.getUrl()
    };
  } catch (e) {
    return { configured: false, error: 'No se pudo acceder a la carpeta (' + id + '): ' + e.message };
  }
}

/**
 * Guarda la carpeta de backup en Script Properties. Acepta un folderId
 * directo o una URL de Drive (se extrae el ID).
 */
function nbs_setBackupFolder(folderIdOrUrl) {
  _requireAnalyst_();
  var raw = String(folderIdOrUrl || '').trim();
  if (!raw) throw new Error('Debe proporcionar un ID o URL de carpeta.');

  // Extraer ID si viene como URL: https://drive.google.com/drive/folders/XXX
  var id = raw;
  var match = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) id = match[1];

  // Validar que la carpeta es accesible antes de guardar
  try {
    var folder = DriveApp.getFolderById(id);
    var name = folder.getName();
    PropertiesService.getScriptProperties().setProperty('BACKUP_FOLDER_ID', id);
    return {
      ok: true,
      id: id,
      name: name,
      url: folder.getUrl()
    };
  } catch (e) {
    throw new Error('No se pudo acceder a la carpeta con ID "' + id + '". Verifique permisos y que el ID sea correcto.');
  }
}

/**
 * Crea una copia completa del spreadsheet actual y la mueve a la carpeta
 * de backup. El nombre incluye timestamp para evitar colisiones.
 *
 * @param {string} [folderIdOrUrl] Opcional: si se provee, sobreescribe el
 *   BACKUP_FOLDER_ID configurado solo para esta ejecución (no lo guarda).
 * @returns {{ok, url, name, folderUrl}} info de la copia creada
 */
function nbs_createBackup(folderIdOrUrl) {
  _requireAnalyst_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ssFile = DriveApp.getFileById(ss.getId());

  // Resolver carpeta destino
  var folderId = '';
  if (folderIdOrUrl) {
    var raw = String(folderIdOrUrl).trim();
    var match = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    folderId = match ? match[1] : raw;
  } else {
    folderId = BACKUP_FOLDER_ID;
  }
  if (!folderId) {
    throw new Error('No hay carpeta de backup configurada. Configure BACKUP_FOLDER_ID o pase la carpeta como parámetro.');
  }

  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    throw new Error('No se pudo acceder a la carpeta de backup: ' + e.message);
  }

  // Crear copia con timestamp
  var timestamp = Utilities.formatDate(new Date(), 'America/Bogota', 'yyyyMMdd_HHmm');
  var copyName = 'Backup_' + timestamp + '_' + ssFile.getName();
  var copy = ssFile.makeCopy(copyName, folder);

  return {
    ok: true,
    id: copy.getId(),
    url: copy.getUrl(),
    name: copy.getName(),
    folderUrl: folder.getUrl(),
    folderName: folder.getName()
  };
}

// =====================================================================
// VISIBILIDAD DE COLUMNAS — ocultar/mostrar columnas de la hoja activa
// =====================================================================

/**
 * Retorna los nombres de todas las hojas del spreadsheet activo.
 */
function nbs_listSheets() {
  _requireAnalyst_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheets().map(function(s) { return s.getName(); });
}

/**
 * Retorna el estado actual de visibilidad de cada columna con header no vacío.
 * Para cada columna devuelve {name, hidden, isCanonical}.
 */
function nbs_getColumnStates(sheetName) {
  _requireAnalyst_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Hoja "' + sheetName + '" no encontrada.');

  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(h) { return String(h || '').trim(); });

  var canonicalSet = {};
  HEADERS_REQUESTS.forEach(function(h) { canonicalSet[h] = true; });

  var states = [];
  for (var i = 0; i < lastCol; i++) {
    if (!headers[i]) continue;
    states.push({
      colIndex: i + 1, // 1-based
      name: headers[i],
      hidden: sheet.isColumnHiddenByUser(i + 1),
      isCanonical: !!canonicalSet[headers[i]]
    });
  }
  return states;
}

/**
 * Aplica visibilidad a las columnas según el estado recibido.
 * @param {string} sheetName
 * @param {Array<{name, visible}>} visibilityStates
 * @returns {{ hidden: number, shown: number }}
 */
function nbs_applyColumnVisibility(sheetName, visibilityStates) {
  _requireAnalyst_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Hoja "' + sheetName + '" no encontrada.');

  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(h) { return String(h || '').trim(); });

  var nameToCol = {};
  headers.forEach(function(h, i) { if (h) nameToCol[h] = i + 1; });

  var hidden = 0, shown = 0;
  visibilityStates.forEach(function(s) {
    var col = nameToCol[s.name];
    if (!col) return;
    if (s.visible) {
      sheet.showColumns(col);
      shown++;
    } else {
      sheet.hideColumns(col);
      hidden++;
    }
  });

  return { hidden: hidden, shown: shown };
}

// =====================================================================
// VISTA DE ANOMALÍAS
// =====================================================================

/**
 * Lista de dominios considerados "corporativos". Si el correo de un usuario
 * no termina en alguno de estos, se reporta como anomalía.
 * Sobreescribir vía Script Property CORPORATE_DOMAINS (CSV).
 */
function _getCorporateDomains_() {
  const raw = getConfig_('CORPORATE_DOMAINS', 'equitel.com.co');
  return raw.split(',').map(function(d) { return d.trim().toLowerCase(); }).filter(function(d) { return d; });
}

/**
 * Recorre USUARIOS y reporta tres tipos de anomalías:
 *   1. sinAprobador — col G vacía (no podrán crear solicitudes)
 *   2. correoNoCorporativo — dominio del correo no está en CORPORATE_DOMAINS
 *   3. aprobadorNoResuelto — col G referencia cédulas que no existen en USUARIOS
 *      (su col H contiene literalmente "(no resuelto)")
 */
function usuarios_getAnomalias() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_USUARIOS);
  if (!sheet || sheet.getLastRow() < 2) {
    return { sinAprobador: [], correoNoCorporativo: [], aprobadorNoResuelto: [] };
  }

  const corporateDomains = _getCorporateDomains_();
  const lastRow = sheet.getLastRow();
  const data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();

  const sinAprobador = [];
  const correoNoCorporativo = [];
  const aprobadorNoResuelto = [];

  data.forEach(function(r) {
    const cedula = String(r[0] || '').trim();
    if (!cedula) return;
    const nombre = String(r[1] || '').trim();
    const correo = String(r[2] || '').toLowerCase().trim();
    const cedulasAprobadores = String(r[6] || '').trim();
    const correosAprobadoresAuto = String(r[7] || '').trim();

    // 1. Sin aprobador asignado
    if (!cedulasAprobadores) {
      sinAprobador.push({ cedula: cedula, nombre: nombre, correo: correo });
    }

    // 2. Correo no corporativo
    if (correo) {
      const parts = correo.split('@');
      if (parts.length === 2) {
        const domain = parts[1];
        if (corporateDomains.indexOf(domain) === -1) {
          correoNoCorporativo.push({ cedula: cedula, nombre: nombre, correo: correo, dominio: domain });
        }
      } else {
        // Correo malformado también cuenta como anomalía
        correoNoCorporativo.push({ cedula: cedula, nombre: nombre, correo: correo, dominio: '(inválido)' });
      }
    }

    // 3. Aprobador huérfano: col G tiene cédulas pero col H/I tiene "(no resuelto)"
    if (cedulasAprobadores && correosAprobadoresAuto.indexOf('(no resuelto)') !== -1) {
      aprobadorNoResuelto.push({
        cedula: cedula,
        nombre: nombre,
        correo: correo,
        cedulasAprobadores: cedulasAprobadores,
        correosAprobadoresAuto: correosAprobadoresAuto
      });
    }
  });

  return {
    sinAprobador: sinAprobador,
    correoNoCorporativo: correoNoCorporativo,
    aprobadorNoResuelto: aprobadorNoResuelto
  };
}

// =====================================================================
// MÉTRICAS — event tracking + aggregation (admin-only panel)
// =====================================================================
// Eventos registrados en col EVENTOS_JSON de Nueva Base Solicitudes:
//   created             — al crear la solicitud
//   optionsUploaded     — analista carga opciones (PENDIENTE_SELECCION)
//   selectionMade       — usuario describe su selección (PENDIENTE_CONFIRMACION_COSTO)
//   costConfirmed       — analista confirma costos (PENDIENTE_APROBACION)
//   approvals.{role}    — cada vez que un aprobador clickea (NORMAL/CEO/CDS)
//   fullyApproved       — cuando se completan todas las aprobaciones requeridas
//   reservationRegistered — analista registra la reserva (RESERVADO)
//
// Las solicitudes anteriores al deploy no tendrán EVENTOS_JSON → métricas
// muestran "sin datos" para esos. De aquí en adelante, todo se rastrea.
// =====================================================================

const EVENTOS_JSON_HEADER = 'EVENTOS_JSON';

/**
 * Registra un evento en EVENTOS_JSON de la solicitud. Defensivo: si la
 * columna no existe (setupDatabase no se corrió post-deploy), o si hay
 * cualquier error, NO lanza excepción — solo loguea. Los flujos
 * principales NUNCA deben fallar por culpa de las métricas.
 *
 * @param {string} requestId  ID de la solicitud
 * @param {string} eventKey   'created' | 'optionsUploaded' | 'selectionMade' |
 *                            'costConfirmed' | 'approval' | 'fullyApproved' |
 *                            'reservationRegistered'
 * @param {object} [data]     Para 'approval': { role, email }. Resto: ignorado.
 */
function _recordEvent_(requestId, eventKey, data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
    if (!sheet) return;

    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const eventsCol = headers.indexOf(EVENTOS_JSON_HEADER);
    if (eventsCol < 0) {
      console.warn('METRICS: columna ' + EVENTOS_JSON_HEADER + ' no existe. Ejecuta setupDatabase() para agregarla.');
      return;
    }

    const idIdx = H('ID RESPUESTA');
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const ids = sheet.getRange(2, idIdx + 1, lastRow - 1, 1).getValues().flat();
    const rowIndex = ids.map(String).indexOf(String(requestId));
    if (rowIndex === -1) return;
    const rowNumber = rowIndex + 2;

    const existingRaw = sheet.getRange(rowNumber, eventsCol + 1).getValue();
    let events = {};
    if (existingRaw) {
      try { events = JSON.parse(existingRaw); } catch (e) { events = {}; }
    }

    const nowIso = new Date().toISOString();
    if (eventKey === 'approval') {
      events.approvals = events.approvals || {};
      const role = (data && data.role) || 'UNKNOWN';
      // Solo registra la PRIMERA aprobación de cada rol (consistente con
      // la lógica de "first wins" del flujo de aprobación existente).
      if (!events.approvals[role]) {
        events.approvals[role] = {
          email: (data && data.email) || '',
          at: nowIso
        };
      }
    } else {
      // Solo registra la primera vez que se dispara el evento.
      // Si el evento ya existe, no lo sobrescribe (evita falsear tiempos
      // si una solicitud transita un estado más de una vez).
      if (!events[eventKey]) {
        events[eventKey] = nowIso;
      }
    }

    sheet.getRange(rowNumber, eventsCol + 1).setValue(JSON.stringify(events));
  } catch (e) {
    // Nunca propagar — métricas son non-critical
    console.error('METRICS: error registrando evento ' + eventKey + ' para ' + requestId + ': ' + e);
  }
}

// =====================================================================
// METRICS CACHE — Drive JSON file for precomputed metrics
// =====================================================================

function _getMetricsCacheFile_() {
  var folder = DriveApp.getFolderById(ROOT_DRIVE_FOLDER_ID);
  var files = folder.getFilesByName('metricas_cache.json');
  if (files.hasNext()) return files.next();
  return folder.createFile('metricas_cache.json', JSON.stringify({
    version: 1, lastBuild: new Date().toISOString(), entries: {}
  }), 'application/json');
}

function _loadMetricsCache_() {
  try {
    var file = _getMetricsCacheFile_();
    var content = file.getBlob().getDataAsString();
    var cache = JSON.parse(content);
    if (!cache || !cache.entries || cache.version !== 1) {
      return { version: 1, lastBuild: new Date().toISOString(), entries: {} };
    }
    return cache;
  } catch (e) {
    console.warn('METRICS CACHE: failed to load, starting fresh: ' + e);
    return { version: 1, lastBuild: new Date().toISOString(), entries: {} };
  }
}

function _saveMetricsCache_(cache) {
  try {
    cache.lastBuild = new Date().toISOString();
    var file = _getMetricsCacheFile_();
    file.setContent(JSON.stringify(cache));
  } catch (e) {
    console.error('METRICS CACHE: failed to save: ' + e);
  }
}

function _buildEventsHash_(events) {
  var keys = [];
  Object.keys(events).forEach(function(k) {
    if (k === 'approvals') {
      var roles = events.approvals ? Object.keys(events.approvals).sort() : [];
      if (roles.length > 0) keys.push('approvals:' + roles.join(':'));
    } else if (events[k]) {
      keys.push(k);
    }
  });
  return keys.sort().join(',');
}

function _needsRecompute_(cacheEntry, currentStatus, currentEventsHash) {
  if (!cacheEntry) return true;
  if (cacheEntry.status !== currentStatus) return true;
  if (cacheEntry.eventsHash !== currentEventsHash) return true;
  return false;
}

// =====================================================================
// METRICS — main entry point (cached)
// =====================================================================

/**
 * Lee toda la base de solicitudes, usa cache para evitar recalcular
 * métricas de solicitudes que no han cambiado. Almacena el cache en
 * metricas_cache.json dentro de la carpeta raíz de Drive.
 *
 * @param {object} filters  { requestId?, dateFrom?, dateTo?, excludeStatuses?: string[], hideNoEvents?: boolean }
 * @returns {{ perRequest: array, aggregates: object, analystPerformance: array }}
 */
function getMetrics(filters) {
  filters = filters || {};
  var requestIdFilter = filters.requestId ? String(filters.requestId).trim().toLowerCase() : '';
  // FIX: parse dates with explicit Bogotá offset to prevent timezone mismatch
  var dateFrom = filters.dateFrom ? new Date(filters.dateFrom + 'T00:00:00-05:00') : null;
  var dateTo = filters.dateTo ? new Date(filters.dateTo + 'T23:59:59.999-05:00') : null;
  var excludeStatuses = filters.excludeStatuses || [];
  var hideNoEvents = filters.hideNoEvents !== undefined ? filters.hideNoEvents : true;

  var emptyResult = { perRequest: [], aggregates: _emptyAggregates_(), analystPerformance: _emptyAnalystPerformance_() };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
  if (!sheet) return emptyResult;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return emptyResult;

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var eventsCol = headers.indexOf(EVENTOS_JSON_HEADER);
  var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var idIdx = H('ID RESPUESTA');
  var requesterIdx = H('CORREO ENCUESTADO');
  var destinationIdx = H('CIUDAD DESTINO');
  var companyIdx = H('EMPRESA');
  var statusIdx = H('STATUS');
  var dateIdx = H('FECHA SOLICITUD');

  // --- CACHE LAYER ---
  var cache = _loadMetricsCache_();
  var cacheChanged = false;
  var allEntries = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var requestId = String(row[idIdx] || '').trim();
    if (!requestId) continue;

    var currentStatus = String(row[statusIdx] || '');
    var events = {};
    if (eventsCol >= 0 && row[eventsCol]) {
      try { events = JSON.parse(row[eventsCol]); } catch (e) {}
    }

    var requestDate = row[dateIdx];
    if (!(requestDate instanceof Date)) requestDate = new Date(requestDate);
    var isValidDate = requestDate instanceof Date && !isNaN(requestDate.getTime());

    if (!events.created && isValidDate) {
      events.created = requestDate.toISOString();
    }

    var eventsHash = _buildEventsHash_(events);
    var cached = cache.entries[requestId];
    var metrics;

    if (_needsRecompute_(cached, currentStatus, eventsHash)) {
      metrics = _buildRequestMetrics_(requestId, row, requesterIdx, destinationIdx, companyIdx, statusIdx, events);
      cache.entries[requestId] = {
        status: currentStatus,
        eventsHash: eventsHash,
        computedAt: new Date().toISOString(),
        metrics: metrics
      };
      cacheChanged = true;
    } else {
      metrics = cached.metrics;
      // Refresh volatile display fields from sheet (cheap, might have changed)
      metrics.status = currentStatus;
      metrics.requesterEmail = String(row[requesterIdx] || '');
      metrics.destination = String(row[destinationIdx] || '');
      metrics.company = String(row[companyIdx] || '');
    }

    // Attach requestDate for filtering (not stored in cache)
    metrics._requestDate = isValidDate ? requestDate : null;
    allEntries.push(metrics);
  }

  if (cacheChanged) {
    _saveMetricsCache_(cache);
  }

  // --- APPLY FILTERS ---
  var perRequest = [];
  for (var j = 0; j < allEntries.length; j++) {
    var m = allEntries[j];
    if (requestIdFilter && m.requestId.toLowerCase().indexOf(requestIdFilter) === -1) continue;
    if (dateFrom && m._requestDate && m._requestDate < dateFrom) continue;
    if (dateTo && m._requestDate && m._requestDate > dateTo) continue;
    if (excludeStatuses.length > 0 && excludeStatuses.indexOf(m.status) >= 0) continue;
    if (hideNoEvents && !m.hasEvents) continue;

    var clean = {};
    Object.keys(m).forEach(function(k) { if (k !== '_requestDate') clean[k] = m[k]; });
    perRequest.push(clean);
  }

  perRequest.sort(function(a, b) {
    if (!a.created && !b.created) return 0;
    if (!a.created) return 1;
    if (!b.created) return -1;
    return b.created.localeCompare(a.created);
  });

  return {
    perRequest: perRequest,
    aggregates: _aggregateMetrics_(perRequest),
    analystPerformance: _buildAnalystPerformance_(perRequest)
  };
}

// =====================================================================
// METRICS — working minutes + cross-day calculations
// =====================================================================

/**
 * Calcula minutos transcurridos entre dos timestamps ISO contando SOLO
 * horario laboral Equitel (Bogotá GMT-5):
 *   L-V: 07:00 – 17:00 (600 min/día)
 *   Sáb: 08:00 – 12:00 (240 min/día)
 *   Dom: 0 min
 *
 * Para rangos >90 días, aproxima con ~3240 min laborales/semana.
 */
function _workingMinutesBetween_(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  var from = new Date(fromIso);
  var to = new Date(toIso);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return null;
  if (to.getTime() <= from.getTime()) return 0;

  // Safety cap: rangos >90 días → aproximación para evitar timeout
  var totalRawMs = to.getTime() - from.getTime();
  if (totalRawMs > 90 * 24 * 60 * 60 * 1000) {
    var weeks = totalRawMs / (7 * 24 * 60 * 60 * 1000);
    return Math.round(weeks * 3240);
  }

  var BOG_OFFSET_MS = -5 * 60 * 60 * 1000;
  var toBogota = function(d) { return new Date(d.getTime() + BOG_OFFSET_MS); };

  var STEP_MS = 15 * 60 * 1000;
  var workingMinutes = 0;
  var cursor = from.getTime();
  var endMs = to.getTime();

  while (cursor < endMs) {
    var bog = toBogota(new Date(cursor));
    var dow = bog.getUTCDay();
    var minuteOfDay = bog.getUTCHours() * 60 + bog.getUTCMinutes();

    var isWorking = false;
    if (dow >= 1 && dow <= 5) {
      if (minuteOfDay >= 420 && minuteOfDay < 1020) isWorking = true;
    } else if (dow === 6) {
      if (minuteOfDay >= 480 && minuteOfDay < 720) isWorking = true;
    }

    if (isWorking) {
      var blockEnd = Math.min(cursor + STEP_MS, endMs);
      workingMinutes += Math.round((blockEnd - cursor) / 60000);
    }
    cursor += STEP_MS;
  }

  return workingMinutes > 0 ? workingMinutes : 0;
}

/**
 * Cuenta cuántos días hábiles separan dos timestamps (zona Bogotá).
 * Retorna 0 si mismo día calendario, 1 si día siguiente hábil, etc.
 */
function _businessDaysBetween_(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  var BOG_OFFSET_MS = -5 * 60 * 60 * 1000;
  var toBogDate = function(iso) {
    var d = new Date(new Date(iso).getTime() + BOG_OFFSET_MS);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  var fromDate = toBogDate(fromIso);
  var toDate = toBogDate(toIso);
  if (fromDate.getTime() === toDate.getTime()) return 0;

  var count = 0;
  var cursor = new Date(fromDate);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= toDate) {
    var dow = cursor.getDay();
    if (dow >= 1 && dow <= 6) count++; // Mon-Sat
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

// =====================================================================
// METRICS — per-request builder
// =====================================================================

function _buildRequestMetrics_(requestId, row, requesterIdx, destinationIdx, companyIdx, statusIdx, events) {
  var minutesBetween = _workingMinutesBetween_;
  var daysBetween = _businessDaysBetween_;

  var approvals = [];
  if (events.approvals) {
    Object.keys(events.approvals).forEach(function(role) {
      var a = events.approvals[role];
      approvals.push({
        role: role,
        email: a.email || '',
        timeMinutes: minutesBetween(events.costConfirmed, a.at)
      });
    });
  }

  var eventKeysReal = Object.keys(events).filter(function(k) {
    if (k === 'created') return false;
    if (k === 'approvals') return events.approvals && Object.keys(events.approvals).length > 0;
    return !!events[k];
  });
  var hasEvents = eventKeysReal.length > 0;

  return {
    requestId: requestId,
    requesterEmail: String(row[requesterIdx] || ''),
    destination: String(row[destinationIdx] || ''),
    company: String(row[companyIdx] || ''),
    status: String(row[statusIdx] || ''),
    created: events.created || null,
    timeToOptionsMinutes: minutesBetween(events.created, events.optionsUploaded),
    timeToSelectionMinutes: minutesBetween(events.optionsUploaded, events.selectionMade),
    timeToCostConfirmMinutes: minutesBetween(events.selectionMade, events.costConfirmed),
    timeToFullApprovalMinutes: minutesBetween(events.costConfirmed, events.fullyApproved),
    timeToReservationMinutes: minutesBetween(events.fullyApproved, events.reservationRegistered),
    totalCycleMinutes: minutesBetween(events.created, events.reservationRegistered),
    approvals: approvals,
    hasEvents: hasEvents,
    crossDays: {
      toOptions: daysBetween(events.created, events.optionsUploaded),
      toSelection: daysBetween(events.optionsUploaded, events.selectionMade),
      toCostConfirm: daysBetween(events.selectionMade, events.costConfirmed),
      toFullApproval: daysBetween(events.costConfirmed, events.fullyApproved),
      toReservation: daysBetween(events.fullyApproved, events.reservationRegistered),
      totalCycle: daysBetween(events.created, events.reservationRegistered)
    }
  };
}

// =====================================================================
// METRICS — aggregation + analyst performance
// =====================================================================

function _aggregateMetrics_(metrics) {
  var avg = function(arr) {
    var valid = arr.filter(function(v) { return v !== null && !isNaN(v); });
    if (valid.length === 0) return null;
    return Math.round(valid.reduce(function(s, v) { return s + v; }, 0) / valid.length);
  };

  var countWithEvents = metrics.filter(function(m) { return m.hasEvents; }).length;

  var approverMap = {};
  metrics.forEach(function(m) {
    (m.approvals || []).forEach(function(a) {
      if (!a.email || a.timeMinutes === null) return;
      if (!approverMap[a.email]) {
        approverMap[a.email] = { email: a.email, role: a.role, count: 0, total: 0 };
      }
      approverMap[a.email].count++;
      approverMap[a.email].total += a.timeMinutes;
    });
  });
  var approverPerformance = Object.keys(approverMap).map(function(email) {
    var a = approverMap[email];
    return { email: email, role: a.role, count: a.count, avgTimeMinutes: Math.round(a.total / a.count) };
  }).sort(function(a, b) { return b.count - a.count; });

  return {
    count: metrics.length,
    countWithCompleteData: countWithEvents,
    avgTimeToOptionsMinutes: avg(metrics.map(function(m) { return m.timeToOptionsMinutes; })),
    avgTimeToSelectionMinutes: avg(metrics.map(function(m) { return m.timeToSelectionMinutes; })),
    avgTimeToCostConfirmMinutes: avg(metrics.map(function(m) { return m.timeToCostConfirmMinutes; })),
    avgTimeToFullApprovalMinutes: avg(metrics.map(function(m) { return m.timeToFullApprovalMinutes; })),
    avgTimeToReservationMinutes: avg(metrics.map(function(m) { return m.timeToReservationMinutes; })),
    avgTotalCycleMinutes: avg(metrics.map(function(m) { return m.totalCycleMinutes; })),
    approverPerformance: approverPerformance
  };
}

/**
 * Performance del analista de compras. Calcula tiempos de las 3 etapas que
 * le corresponden: cotización, confirmación de costos, compra de tiquetes.
 */
function _buildAnalystPerformance_(metrics) {
  var stages = {
    cotizacion: { label: 'Cotización (Crear → Opciones)', count: 0, total: 0, values: [] },
    confirmacion: { label: 'Confirmación costos (Selección → Costo)', count: 0, total: 0, values: [] },
    compra: { label: 'Compra tiquetes (Aprobado → Reserva)', count: 0, total: 0, values: [] }
  };

  metrics.forEach(function(m) {
    if (m.timeToOptionsMinutes !== null && m.timeToOptionsMinutes !== undefined && !isNaN(m.timeToOptionsMinutes)) {
      stages.cotizacion.count++;
      stages.cotizacion.total += m.timeToOptionsMinutes;
      stages.cotizacion.values.push(m.timeToOptionsMinutes);
    }
    if (m.timeToCostConfirmMinutes !== null && m.timeToCostConfirmMinutes !== undefined && !isNaN(m.timeToCostConfirmMinutes)) {
      stages.confirmacion.count++;
      stages.confirmacion.total += m.timeToCostConfirmMinutes;
      stages.confirmacion.values.push(m.timeToCostConfirmMinutes);
    }
    if (m.timeToReservationMinutes !== null && m.timeToReservationMinutes !== undefined && !isNaN(m.timeToReservationMinutes)) {
      stages.compra.count++;
      stages.compra.total += m.timeToReservationMinutes;
      stages.compra.values.push(m.timeToReservationMinutes);
    }
  });

  var result = [];
  ['cotizacion', 'confirmacion', 'compra'].forEach(function(key) {
    var s = stages[key];
    result.push({
      stage: key,
      label: s.label,
      count: s.count,
      avgMinutes: s.count > 0 ? Math.round(s.total / s.count) : null,
      minMinutes: s.values.length > 0 ? Math.min.apply(null, s.values) : null,
      maxMinutes: s.values.length > 0 ? Math.max.apply(null, s.values) : null
    });
  });
  return result;
}

function _emptyAggregates_() {
  return {
    count: 0, countWithCompleteData: 0,
    avgTimeToOptionsMinutes: null, avgTimeToSelectionMinutes: null,
    avgTimeToCostConfirmMinutes: null, avgTimeToFullApprovalMinutes: null,
    avgTimeToReservationMinutes: null, avgTotalCycleMinutes: null,
    approverPerformance: []
  };
}

function _emptyAnalystPerformance_() {
  return [
    { stage: 'cotizacion', label: 'Cotización (Crear → Opciones)', count: 0, avgMinutes: null, minMinutes: null, maxMinutes: null },
    { stage: 'confirmacion', label: 'Confirmación costos (Selección → Costo)', count: 0, avgMinutes: null, minMinutes: null, maxMinutes: null },
    { stage: 'compra', label: 'Compra tiquetes (Aprobado → Reserva)', count: 0, avgMinutes: null, minMinutes: null, maxMinutes: null }
  ];
}

// =====================================================================
// UTILIDADES ADMIN — ejecutables manualmente desde el editor de Apps Script
// =====================================================================
// Estas funciones NO se llaman automáticamente; sirven como atajo para
// operaciones puntuales que requieren modificar Script Properties cuando la
// GUI de propiedades queda en modo read-only (>50 propiedades).
// =====================================================================

/**
 * Actualiza ANALYST_EMAILS (whitelist de admins autorizados).
 *
 * Modifica el array si necesitas quitar o agregar correos, luego ejecuta
 * esta función UNA VEZ desde el editor:
 *   1. Dropdown de funciones (arriba) → selecciona "actualizarAnalystEmails"
 *   2. Click ▶ Ejecutar
 *   3. Ver → Registros de ejecución (confirma el resultado)
 *
 * Seguridad: solo quienes tienen acceso al editor de Apps Script pueden
 * ejecutar esto (típicamente el dueño del proyecto GAS). No es un endpoint
 * expuesto al web app.
 */
function actualizarAnalystEmails() {
  var emails = [
    'apcompras@equitel.com.co',
    'dsanchez@equitel.com.co'
  ];
  setAnalystWhitelist(emails);
  var stored = PropertiesService.getScriptProperties().getProperty('ANALYST_EMAILS');
  Logger.log('ANALYST_EMAILS actualizado a: ' + stored);
  return stored;
}

/**
 * DIAGNÓSTICO: ejecuta desde el editor para ver qué correo detecta el script
 * y si está en la whitelist. Útil para debuggear el error "Acción no autorizada".
 *
 * Pasos:
 *   1. Dropdown de funciones → diagnosticarAuth
 *   2. ▶ Ejecutar
 *   3. Ver → Registros de ejecución
 */
function diagnosticarAuth() {
  var activeEmail = '';
  var effectiveEmail = '';
  var errorActive = '';
  var errorEffective = '';

  try {
    activeEmail = String(Session.getActiveUser().getEmail() || '');
  } catch (e) {
    errorActive = e.message;
  }
  try {
    effectiveEmail = String(Session.getEffectiveUser().getEmail() || '');
  } catch (e) {
    errorEffective = e.message;
  }

  var whitelist = getAnalystWhitelist_();
  var activeMatches = activeEmail && whitelist.indexOf(activeEmail.toLowerCase().trim()) >= 0;
  var effectiveMatches = effectiveEmail && whitelist.indexOf(effectiveEmail.toLowerCase().trim()) >= 0;

  Logger.log('=== DIAGNÓSTICO DE AUTENTICACIÓN ===');
  Logger.log('Session.getActiveUser().getEmail():    "' + activeEmail + '"' + (errorActive ? ' [ERROR: ' + errorActive + ']' : ''));
  Logger.log('Session.getEffectiveUser().getEmail(): "' + effectiveEmail + '"' + (errorEffective ? ' [ERROR: ' + errorEffective + ']' : ''));
  Logger.log('ANALYST_EMAILS whitelist:              ' + JSON.stringify(whitelist));
  Logger.log('');
  Logger.log('¿Active user en whitelist?    ' + (activeMatches ? '✅ SÍ' : '❌ NO'));
  Logger.log('¿Effective user en whitelist? ' + (effectiveMatches ? '✅ SÍ' : '❌ NO'));
  Logger.log('');
  if (!activeEmail && !effectiveEmail) {
    Logger.log('⚠️ PROBLEMA: Ninguno de los métodos de Session retorna email.');
    Logger.log('   Causa típica: falta autorización del script. Ejecuta cualquier');
    Logger.log('   función que requiera permisos (como esta) y completa el diálogo');
    Logger.log('   de autorización. Si ya lo hiciste, puede ser dominio cruzado.');
  } else if (!activeMatches && !effectiveMatches) {
    Logger.log('⚠️ PROBLEMA: El correo detectado NO está en la whitelist.');
    Logger.log('   Agrégalo editando actualizarAnalystEmails() y ejecutándola.');
  } else {
    Logger.log('✅ TODO OK: Deberías poder abrir los sidebars sin problema.');
  }

  return {
    activeEmail: activeEmail,
    effectiveEmail: effectiveEmail,
    whitelist: whitelist,
    activeMatches: activeMatches,
    effectiveMatches: effectiveMatches
  };
}

// =====================================================================
// PLAN 2 — ACTIVACIÓN/DESACTIVACIÓN DEL MODO USUARIOS (runtime flag)
// =====================================================================
// Estas funciones permiten alternar entre leer de INTEGRANTES (legacy) y
// leer de USUARIOS (Fase B) sin depender de la GUI de Script Properties
// (que se bloquea cuando hay >50 propiedades, como en este proyecto).
//
// FILOSOFÍA: NO están en el menú onOpen por diseño — solo accesibles desde
// el editor de Apps Script. Evita que alguien haga click por error.
// =====================================================================

/**
 * PRE-FLIGHT CHECK: valida que la migración de INTEGRANTES → USUARIOS está
 * completa antes de activar el flag. Ejecutar ANTES de toggleUsuariosMode().
 *
 * Reporta:
 *   - Usuarios en INTEGRANTES que NO están en USUARIOS (bloquearían login)
 *   - PIN hashes que NO se preservaron
 *   - Aprobadores con "(no resuelto)" en col H de USUARIOS
 *   - Usuarios en USUARIOS sin correo (inválidos)
 *
 * Pasos:
 *   1. Dropdown de funciones → verificarMigracionUsuarios
 *   2. ▶ Ejecutar
 *   3. Ver → Registros de ejecución
 *
 * Si todo sale OK ("✅ Migración consistente"), puedes proceder a ejecutar
 * toggleUsuariosMode() con confianza.
 */
function verificarMigracionUsuarios() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var integrantes = ss.getSheetByName(SHEET_NAME_INTEGRANTES);
  var usuarios = ss.getSheetByName(SHEET_NAME_USUARIOS);

  Logger.log('=== PRE-FLIGHT CHECK: MIGRACIÓN USUARIOS ===');
  Logger.log('');

  if (!integrantes) {
    Logger.log('⚠️  No existe la hoja INTEGRANTES. Nada que comparar.');
    return { ok: false, reason: 'INTEGRANTES no existe' };
  }
  if (!usuarios) {
    Logger.log('❌ No existe la hoja USUARIOS. Ejecuta crearHojaUsuarios() primero.');
    return { ok: false, reason: 'USUARIOS no existe' };
  }

  // Parse INTEGRANTES (sección verde)
  var intHeaders = integrantes.getRange(1, 1, 1, integrantes.getLastColumn()).getValues()[0];
  var idxIntCorreo = intHeaders.indexOf('correo');
  var idxIntPin = intHeaders.indexOf('PIN');
  if (idxIntCorreo < 0) {
    Logger.log('⚠️  INTEGRANTES no tiene columna "correo".');
    return { ok: false, reason: 'INTEGRANTES malformada' };
  }
  var intLastRow = integrantes.getLastRow();
  var intData = intLastRow >= 2 ? integrantes.getRange(2, 1, intLastRow - 1, integrantes.getLastColumn()).getValues() : [];
  var integrantesMap = {}; // correo → {pin}
  intData.forEach(function(r) {
    var email = String(r[idxIntCorreo] || '').toLowerCase().trim();
    if (!email) return;
    integrantesMap[email] = {
      pin: idxIntPin >= 0 ? String(r[idxIntPin] || '').trim() : ''
    };
  });

  // Parse USUARIOS
  var usrLastRow = usuarios.getLastRow();
  var usrData = usrLastRow >= 2 ? usuarios.getRange(2, 1, usrLastRow - 1, 10).getValues() : [];
  var usuariosMap = {}; // correo → {pin, unresolvedApprover}
  var usuariosSinCorreo = 0;
  usrData.forEach(function(r) {
    var email = String(r[2] || '').toLowerCase().trim();
    if (!email) { usuariosSinCorreo++; return; }
    usuariosMap[email] = {
      pin: String(r[9] || '').trim(),
      unresolvedApprover: String(r[7] || '').indexOf('(no resuelto)') !== -1
    };
  });

  // Comparar
  var missing = [];       // en INTEGRANTES, NO en USUARIOS
  var pinLost = [];       // tenían PIN en INTEGRANTES, NO en USUARIOS
  var unresolvedApp = []; // col H tiene "(no resuelto)"

  Object.keys(integrantesMap).forEach(function(email) {
    var intEntry = integrantesMap[email];
    var usrEntry = usuariosMap[email];
    if (!usrEntry) {
      missing.push(email);
    } else {
      if (intEntry.pin && !usrEntry.pin) {
        pinLost.push(email);
      }
    }
  });
  Object.keys(usuariosMap).forEach(function(email) {
    if (usuariosMap[email].unresolvedApprover) {
      unresolvedApp.push(email);
    }
  });

  Logger.log('Total INTEGRANTES: ' + Object.keys(integrantesMap).length);
  Logger.log('Total USUARIOS:    ' + Object.keys(usuariosMap).length);
  Logger.log('');

  var allOk = true;

  if (missing.length > 0) {
    allOk = false;
    Logger.log('❌ BLOQUEANTE: ' + missing.length + ' usuario(s) en INTEGRANTES pero NO en USUARIOS.');
    Logger.log('   Estos usuarios no podrán iniciar sesión tras el switch:');
    missing.slice(0, 10).forEach(function(e) { Logger.log('     - ' + e); });
    if (missing.length > 10) Logger.log('     ... y ' + (missing.length - 10) + ' más');
    Logger.log('   FIX: ejecuta migrarIntegrantesAUsuarios() o sincronizarConMaestroRH().');
    Logger.log('');
  } else {
    Logger.log('✅ Todos los correos de INTEGRANTES están en USUARIOS.');
  }

  if (pinLost.length > 0) {
    allOk = false;
    Logger.log('❌ ' + pinLost.length + ' usuario(s) tenían PIN en INTEGRANTES pero NO en USUARIOS.');
    Logger.log('   Estos deberán regenerar su PIN tras el switch:');
    pinLost.slice(0, 10).forEach(function(e) { Logger.log('     - ' + e); });
    Logger.log('   FIX: re-ejecutar migrarIntegrantesAUsuarios() con "borrar y re-migrar"=SÍ.');
    Logger.log('');
  } else {
    Logger.log('✅ Todos los PINs preservados.');
  }

  if (unresolvedApp.length > 0) {
    Logger.log('⚠️  ' + unresolvedApp.length + ' usuario(s) tienen aprobador sin resolver en USUARIOS.');
    Logger.log('   No bloquea el switch, pero estos usuarios no tendrán aprobador válido:');
    unresolvedApp.slice(0, 5).forEach(function(e) { Logger.log('     - ' + e); });
    Logger.log('   FIX: asignarles aprobador desde el sidebar o ejecutar recargarResolucionesUsuarios().');
    Logger.log('');
  }

  if (usuariosSinCorreo > 0) {
    Logger.log('⚠️  ' + usuariosSinCorreo + ' fila(s) en USUARIOS sin correo — ignoradas.');
    Logger.log('');
  }

  Logger.log('---');
  if (allOk) {
    Logger.log('✅ MIGRACIÓN CONSISTENTE. Puedes ejecutar toggleUsuariosMode() con confianza.');
  } else {
    Logger.log('❌ NO ACTIVES todavía. Corrige los problemas de arriba y vuelve a verificar.');
  }

  return {
    ok: allOk,
    integrantesTotal: Object.keys(integrantesMap).length,
    usuariosTotal: Object.keys(usuariosMap).length,
    missing: missing,
    pinLost: pinLost,
    unresolvedApprovers: unresolvedApp
  };
}

/**
 * TOGGLE IDEMPOTENTE: cambia el flag USE_USUARIOS_SHEET entre 'true' y 'false'.
 *
 * Comportamiento:
 *   - Si actualmente está en INTEGRANTES (flag='false' o vacío) → cambia a USUARIOS.
 *   - Si actualmente está en USUARIOS (flag='true') → cambia de vuelta a INTEGRANTES.
 *
 * Por qué existe: la GUI de Script Properties se bloquea cuando hay >50
 * propiedades (caso de este proyecto). Esta función es la forma confiable
 * de cambiar el flag.
 *
 * Seguridad: NO está en el menú onOpen — solo accesible desde el editor.
 * Esto evita que alguien lo ejecute sin entender las consecuencias.
 *
 * Pasos:
 *   1. Dropdown de funciones → toggleUsuariosMode
 *   2. ▶ Ejecutar
 *   3. Ver → Registros de ejecución
 *   4. Recarga el sheet para que onOpen() vuelva a leer el flag
 *
 * Rollback: ejecutar la misma función de nuevo — vuelve al estado anterior.
 *
 * RECOMENDACIÓN: ejecuta verificarMigracionUsuarios() ANTES de toggle para
 * asegurar que no vas a dejar usuarios varados tras el switch.
 */
function toggleUsuariosMode() {
  var props = PropertiesService.getScriptProperties();
  var currentRaw = props.getProperty('USE_USUARIOS_SHEET');
  var currentlyActive = (currentRaw === 'true');

  Logger.log('=== TOGGLE MODO USUARIOS ===');
  Logger.log('Estado previo: USE_USUARIOS_SHEET = ' + (currentRaw === null ? '(no definido, default=false)' : '"' + currentRaw + '"'));
  Logger.log('Modo previo:   ' + (currentlyActive ? 'USUARIOS (Fase B)' : 'INTEGRANTES (legacy)'));
  Logger.log('');

  var newValue = currentlyActive ? 'false' : 'true';
  props.setProperty('USE_USUARIOS_SHEET', newValue);

  Logger.log('Estado nuevo:  USE_USUARIOS_SHEET = "' + newValue + '"');
  Logger.log('Modo nuevo:    ' + (newValue === 'true' ? 'USUARIOS (Fase B)' : 'INTEGRANTES (legacy)'));
  Logger.log('');

  if (newValue === 'true') {
    Logger.log('✅ MODO USUARIOS ACTIVADO.');
    Logger.log('');
    Logger.log('Próximos pasos:');
    Logger.log('  1. Recarga el Google Sheet (F5) para que el menú refleje el cambio.');
    Logger.log('  2. Prueba el login con un usuario normal.');
    Logger.log('  3. Si algo falla, ejecuta toggleUsuariosMode() de nuevo para revertir.');
  } else {
    Logger.log('↩️  MODO REVERTIDO A INTEGRANTES (legacy).');
    Logger.log('');
    Logger.log('Próximos pasos:');
    Logger.log('  1. Recarga el Google Sheet (F5).');
    Logger.log('  2. La aplicación lee de INTEGRANTES como antes. Datos de USUARIOS quedan');
    Logger.log('     intactos pero no se usan.');
  }

  return {
    previousMode: currentlyActive ? 'USUARIOS' : 'INTEGRANTES',
    currentMode: newValue === 'true' ? 'USUARIOS' : 'INTEGRANTES',
    flagValue: newValue
  };
}
