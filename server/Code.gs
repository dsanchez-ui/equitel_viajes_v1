
/**
 * @OnlyCurrentDoc
 * @AuthorizationRequired
 * @oauthScopes https://www.googleapis.com/auth/spreadsheets.currentonly, https://www.googleapis.com/auth/drive, https://www.googleapis.com/auth/script.external_request, https://www.googleapis.com/auth/userinfo.email
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

const SHEET_NAME_REQUESTS = 'Nueva Base Solicitudes';
const SHEET_NAME_MASTERS = 'MAESTROS';
const SHEET_NAME_RELATIONS = 'CDS vs UDEN';
const SHEET_NAME_INTEGRANTES = 'INTEGRANTES';
const SHEET_NAME_CITIES = 'CIUDADES DEL MUNDO';

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
  "ES_CAMBIO_CON_COSTO", "FECHA_SOLICITUD_PADRE" // Nuevos headers para trazabilidad de cambios
];

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
    // Check if headers need update (append new columns if needed)
    const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (currentHeaders.length < HEADERS_REQUESTS.length) {
       // Append missing headers
       sheet.getRange(1, 1, 1, HEADERS_REQUESTS.length).setValues([HEADERS_REQUESTS]);
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
  const isWriteAction = ['createRequest', 'updateRequest', 'uploadSupportFile', 'uploadOptionImage', 'closeRequest', 'requestModification', 'updateAdminPin', 'registerReservation', 'deleteDriveFile', 'anularSolicitud', 'generateReport', 'createReportTemplate'].includes(action);
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
    const adminOnlyActions = ['updateAdminPin', 'anularSolicitud', 'generateReport', 'createReportTemplate', 'closeRequest', 'deleteDriveFile', 'uploadOptionImage', 'registerReservation'];
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
      case 'createRequest': result = createNewRequest(payload.data || payload, payload.emailHtml); break;
      case 'updateRequest': result = updateRequestStatus(payload.id, payload.status, payload.payload); break;
      case 'uploadSupportFile': result = uploadSupportFile(payload.requestId, payload.fileData, payload.fileName, payload.mimeType); break;
      
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
      
      // PIN FEATURES
      case 'verifyAdminPin': result = verifyAdminPin(payload.pin, payload.email); break;
      case 'updateAdminPin': result = updateAdminPin(payload.newPin); break;

      // USER PIN AUTHENTICATION + SESSIONS
      case 'requestUserPin': result = requestUserPin(payload.email, payload.forceRegenerate === true); break;
      case 'verifyUserPin': result = verifyUserPin(payload.email, payload.pin); break;
      case 'validateSession': result = validateSession(payload.email, payload.token); break;
      case 'logout': result = logout(payload.email, payload.token); break;

      // NEW: RESERVATION LOGIC
      case 'registerReservation': result = registerReservation(payload.requestId, payload.reservationNumber, payload.files, payload.creditCard); break;

      // NEW: DRIVE DELETION
      case 'deleteDriveFile': result = deleteDriveFile(payload.fileId); break;

      case 'anularSolicitud': result = anularSolicitud(payload.requestId, payload.reason); break;

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

// --- SECURITY: Validate email exists in INTEGRANTES sheet ---
function validateUserEmail_(email) {
  if (!email) return false;
  // Analysts are always valid (they are in the whitelist)
  if (isUserAnalyst(email)) return true;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_INTEGRANTES);
  if (!sheet) return false;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const emailIdx = headers.indexOf("correo");
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

// --- INTEGRANTES column M (PIN hash) read/write ---
function _findIntegranteRowByEmail_(sheet, email) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var emailIdx = headers.indexOf("correo");
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

function getUserPinHash_(email) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_INTEGRANTES);
  if (!sheet) return '';
  var row = _findIntegranteRowByEmail_(sheet, email);
  if (row < 0) return '';
  var pinCol = _getPinColumnIndex_(sheet);
  if (pinCol < 0) return '';
  return String(sheet.getRange(row, pinCol).getValue() || '').trim();
}

function setUserPinHash_(email, hash) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_INTEGRANTES);
  if (!sheet) throw new Error('Hoja INTEGRANTES no encontrada.');
  var row = _findIntegranteRowByEmail_(sheet, email);
  if (row < 0) throw new Error('Correo no encontrado en INTEGRANTES.');
  var pinCol = _getPinColumnIndex_(sheet);
  if (pinCol < 0) throw new Error('Columna PIN no encontrada en INTEGRANTES.');
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

   const idIdx = HEADERS_REQUESTS.indexOf("ID RESPUESTA");
   const statusIdx = HEADERS_REQUESTS.indexOf("STATUS");
   const obsIdx = HEADERS_REQUESTS.indexOf("OBSERVACIONES");
   const dateIdx = HEADERS_REQUESTS.indexOf("FECHA SOLICITUD");

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
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
        const idIdx = HEADERS_REQUESTS.indexOf("ID RESPUESTA");
        const statusIdx = HEADERS_REQUESTS.indexOf("STATUS");
        const requesterEmailIdx = HEADERS_REQUESTS.indexOf("CORREO ENCUESTADO");
        
        const lastRow = sheet.getLastRow();
        const ids = sheet.getRange(2, idIdx + 1, lastRow - 1, 1).getValues().flat();
        const rowIndex = ids.map(String).indexOf(String(id));
        
        if (rowIndex === -1) throw new Error("Solicitud no encontrada");
        const rowNumber = rowIndex + 2;
        const requesterEmail = sheet.getRange(rowNumber, requesterEmailIdx + 1).getValue();

        const rowData = sheet.getRange(rowNumber, 1, 1, HEADERS_REQUESTS.length).getValues()[0];
        const req = mapRowToRequest(rowData);
        const ccList = getCCList(req);
        const baseSubject = getStandardSubject(req);

        if (decision === 'study') {
             // Change status to PENDIENTE_OPCIONES so Wendy can see it in dashboard
             sheet.getRange(rowNumber, statusIdx + 1).setValue('PENDIENTE_OPCIONES');
             
             SpreadsheetApp.flush(); 

             // Notify Requester
             sendEmailRich(requesterEmail, baseSubject + " [CAMBIO EN ESTUDIO]", 
                 HtmlTemplates.modificationResult(req, 'study'), ccList
             );
        } else {
             // Reject the modification
             sheet.getRange(rowNumber, statusIdx + 1).setValue('DENEGADO');
             
             SpreadsheetApp.flush(); 

             sendEmailRich(requesterEmail, baseSubject + " [CAMBIO RECHAZADO]", 
                 HtmlTemplates.modificationResult(req, 'reject'), ccList
             );
        }
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
          const idIdx = HEADERS_REQUESTS.indexOf("ID RESPUESTA");
          const statusIdx = HEADERS_REQUESTS.indexOf("STATUS");
          const internationalIdx = HEADERS_REQUESTS.indexOf("ES INTERNACIONAL");
          
          const ids = sheet.getRange(2, idIdx + 1, lastRow - 1, 1).getValues().flat();
          const rowIndex = ids.map(String).indexOf(String(id));

          if (rowIndex === -1) throw new Error(`Solicitud ${id} no encontrada.`);
          const rowNumber = rowIndex + 2;

          const currentStatus = sheet.getRange(rowNumber, statusIdx + 1).getValue();
          const isInternational = sheet.getRange(rowNumber, internationalIdx + 1).getValue() === "SI";
          const costIdx = HEADERS_REQUESTS.indexOf("COSTO COTIZADO PARA VIAJE");
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
              const expectedApprover = String(sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("CORREO DE QUIEN APRUEBA (AUTOMÁTICO)") + 1).getValue()).toLowerCase().trim();
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
              const currentVal = sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("APROBADO CEO") + 1).getValue();
              if (currentVal && String(currentVal).trim() !== "") {
                  alreadyDecided = true;
                  // Extract date from "Sí_email_date time"
                  const parts = String(currentVal).split('_');
                  if (parts.length >= 3) previousDecisionDate = parts[2];
              } else {
                  sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("APROBADO CEO") + 1).setValue(logStringFull);
              }
          } else if (role === 'CDS') {
              const currentVal = sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("APROBADO CDS") + 1).getValue();
              if (currentVal && String(currentVal).trim() !== "") {
                  alreadyDecided = true;
                  const parts = String(currentVal).split('_');
                  if (parts.length >= 3) previousDecisionDate = parts[2];
              } else {
                  sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("APROBADO CDS") + 1).setValue(logStringFull);
              }
          } else {
              // Normal Approver
              const currentVal = sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("APROBADO POR ÁREA? (AUTOMÁTICO)") + 1).getValue();
              
              // Check if THIS specific actor already approved (or if anyone approved and we want to block)
              // Requirement: "si alguno de los dos aprueba, pues ya el proceso avanza"
              // If A approves, currentVal = "Sí_A". If B clicks, currentVal is "Sí_A".
              // We should treat this as "already decided" for the REQUEST, not necessarily for the PERSON.
              // But for traceability, if B clicks, we might want to know.
              // However, the logic below "if (alreadyDecided) return..." stops the flow.
              // So if A approved, B gets "Decision Previa Detectada". This is consistent with "First one wins".
              
              if (currentVal && String(currentVal).trim() !== "") {
                  alreadyDecided = true;
                  previousDecisionDate = sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("FECHA/HORA (AUTOMÁTICO)") + 1).getValue();
              } else {
                  sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("APROBADO POR ÁREA? (AUTOMÁTICO)") + 1).setValue(logStringArea);
                  sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("FECHA/HORA (AUTOMÁTICO)") + 1).setValue(timestamp);
                  sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("APROBADO POR ÁREA?") + 1).setValue(decisionPrefix);
              }
          }
          
          if (alreadyDecided) {
               return renderMessagePage(
                  'Decisión Previa Detectada', 
                  `Usted ya había registrado una decisión para esta solicitud anteriormente (Fecha: ${escapeHtml_(previousDecisionDate) || 'Desconocida'}).<br/>No se han realizado cambios.`,
                  '#374151'
              );
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
                  const obsIdx = HEADERS_REQUESTS.indexOf("OBSERVACIONES");
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
          const cdsVal = rowValues[HEADERS_REQUESTS.indexOf("APROBADO CDS")];
          const ceoVal = rowValues[HEADERS_REQUESTS.indexOf("APROBADO CEO")];
          // For area, we check the (AUTOMÁTICO) column we just wrote to or legacy
          const areaVal = rowValues[HEADERS_REQUESTS.indexOf("APROBADO POR ÁREA? (AUTOMÁTICO)")];

          const cdsApproved = String(cdsVal).startsWith("Sí");
          const ceoApproved = String(ceoVal).startsWith("Sí");
          const areaApproved = String(areaVal).startsWith("Sí");

          // Detect special cases: requester is CEO/CDS, or the assigned area approver
          // happens to be CEO/CDS (so a single click on the deduped email implicitly
          // covers both the area and the executive role).
          const requesterEmailRaw = rowValues[HEADERS_REQUESTS.indexOf("CORREO ENCUESTADO")];
          const requesterLowerHere = String(requesterEmailRaw || '').toLowerCase().trim();
          const ceoLowerHere = String(CEO_EMAIL).toLowerCase().trim();
          const cdsLowerHere = String(DIRECTOR_EMAIL).toLowerCase().trim();
          const requesterIsCeo = requesterLowerHere === ceoLowerHere;
          const requesterIsCds = requesterLowerHere === cdsLowerHere;

          const assignedAreaApproversRaw = rowValues[HEADERS_REQUESTS.indexOf("CORREO DE QUIEN APRUEBA (AUTOMÁTICO)")];
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

function registerReservation(requestId, reservationNumber, files, creditCard) {
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
    const idIdx = HEADERS_REQUESTS.indexOf("ID RESPUESTA");
    const resNoIdx = HEADERS_REQUESTS.indexOf("No RESERVA");
    const statusIdx = HEADERS_REQUESTS.indexOf("STATUS");
    const creditCardIdx = HEADERS_REQUESTS.indexOf("TARJETA DE CREDITO CON LA QUE SE HIZO LA COMPRA");
    const departureDateIdx = HEADERS_REQUESTS.indexOf("FECHA IDA");
    const parentIdIdx = HEADERS_REQUESTS.indexOf("ID SOLICITUD PADRE");

    const ids = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat();
    const rowIndex = ids.map(String).indexOf(String(requestId));
    if (rowIndex === -1) throw new Error("Solicitud no encontrada");
    const rowNumber = rowIndex + 2;

    // Check if this is a modification (has parent)
    const parentId = String(sheet.getRange(rowNumber, parentIdIdx + 1).getValue()).trim();
    const isModification = parentId && parentId !== '' && parentId !== 'undefined';

    // 1. Handle File Upload — Determine folder location
    const root = DriveApp.getFolderById(ROOT_DRIVE_FOLDER_ID);
    let folder;
    let parentFolder;

    if (isModification) {
        // MODIFICATION: Create folder as subfolder inside parent's folder
        // First, find parent folder in root (starts with parentId)
        const rootFolders = root.getFolders();
        while (rootFolders.hasNext()) {
            const f = rootFolders.next();
            if (f.getName().indexOf(parentId) === 0) {
                parentFolder = f;
                break;
            }
        }
        if (!parentFolder) {
            parentFolder = root.createFolder(parentId);
        }

        // Search for existing child folder inside parent
        const childFolders = parentFolder.getFolders();
        while (childFolders.hasNext()) {
            const f = childFolders.next();
            if (f.getName().indexOf(requestId) === 0) {
                folder = f;
                break;
            }
        }
        if (!folder) {
            folder = parentFolder.createFolder(requestId);
        }
    } else {
        // ORIGINAL: Create/find folder in root as before
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

    if (isModification) {
        // Child folder name: requestId - CAMBIO DE parentId - PNR - TC - MES
        let childFolderName = `${requestId} - CAMBIO DE ${parentId}`;
        if (reservationNumber) childFolderName += ` - ${reservationNumber}`;
        if (tcShort) childFolderName += ` - ${tcShort}`;
        if (monthYear) childFolderName += ` - ${monthYear}`;
        folder.setName(childFolderName);

        // Annotate parent folder name with CAMBIADA tag (if not already tagged)
        const currentParentName = parentFolder.getName();
        if (currentParentName.indexOf('CAMBIADA') === -1) {
            parentFolder.setName(currentParentName + ' [CAMBIADA]');
        }
    } else {
        // Original folder name: requestId - PNR - TC - MES
        let newFolderName = requestId;
        if (reservationNumber) newFolderName += ` - ${reservationNumber}`;
        if (tcShort) newFolderName += ` - ${tcShort}`;
        if (monthYear) newFolderName += ` - ${monthYear}`;
        folder.setName(newFolderName);
    }

    // 3. Update Sheets
    sheet.getRange(rowNumber, resNoIdx + 1).setValue(reservationNumber);
    sheet.getRange(rowNumber, statusIdx + 1).setValue('RESERVADO');
    if (creditCard && creditCardIdx > -1) {
        sheet.getRange(rowNumber, creditCardIdx + 1).setValue(creditCard);
    }

    // 4. Update JSON Support Data — push ALL uploaded files
    const supportIdx = HEADERS_REQUESTS.indexOf("SOPORTES (JSON)");
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

    return true;
}

/**
 * Get sites (sedes) from MISC sheet column D.
 * Header "SEDES" is in row 2, data starts at row 3.
 */
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
    let subject = `Solicitud de Viaje ${id} - ${data.requesterEmail} - ${data.company} ${data.site}`;
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

        return `
        <!-- ROUTE -->
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

        <!-- DATES -->
        <div style="display: table; width: 100%; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 20px; border-collapse: separate; border-spacing: 0;">
          <div style="display: table-cell; width: 50%; padding: 15px; text-align: center; vertical-align: top; border-right: 1px solid #e5e7eb;">
            <div style="font-size: 10px; color: #9ca3af; text-transform: uppercase; margin-bottom: 5px;">FECHA IDA</div>
            <div style="font-weight: bold; color: ${headerColor}; font-size: 14px;">📅 ${data.departureDate}</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">${data.departureTimePreference ? '('+data.departureTimePreference+')' : ''}</div>
          </div>
          <div style="display: table-cell; width: 50%; padding: 15px; text-align: center; vertical-align: top;">
            <div style="font-size: 10px; color: #9ca3af; text-transform: uppercase; margin-bottom: 5px;">FECHA REGRESO</div>
            <div style="font-weight: bold; color: ${headerColor}; font-size: 14px;">📅 ${data.returnDate || 'N/A'}</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">${data.returnTimePreference ? '('+data.returnTimePreference+')' : ''}</div>
          </div>
        </div>

        <!-- OBSERVATIONS (NOW PROMINENT) -->
        ${data.comments ? `
        <div style="background-color: #fefce8; border: 1px solid #fef08a; border-radius: 6px; padding: 15px; margin-bottom: 25px; border-left: 4px solid #eab308;">
          <div style="font-size: 11px; font-weight: bold; color: #b45309; text-transform: uppercase; margin-bottom: 5px; letter-spacing: 0.5px;">MOTIVO DEL VIAJE / OBSERVACIONES</div>
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
    adminReminderSummary: function(pendingOptionsRows, pendingCostRows, approvedRows) {
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
                                <th align="right" style="border-bottom: 1px solid #e5e7eb;">Fecha Vuelo</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            items.forEach(item => {
                html += `
                    <tr>
                        <td style="border-bottom: 1px solid #f3f4f6;"><strong>${escapeHtml_(item.requestId)}</strong></td>
                        <td style="border-bottom: 1px solid #f3f4f6;">${escapeHtml_(item.requesterEmail)}</td>
                        <td style="border-bottom: 1px solid #f3f4f6;">${escapeHtml_(item.origin)} ➝ ${escapeHtml_(item.destination)}</td>
                        <td align="right" style="border-bottom: 1px solid #f3f4f6;">${item.departureDate}</td>
                    </tr>
                `;
            });
            
            html += `</tbody></table></div>`;
            return html;
        };

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

        let content = `<p style="margin-bottom: 20px; color: #4b5563;">Se han cargado las opciones de viaje para su solicitud <strong>${request.requestId}</strong>. Por favor revise las imágenes a continuación e ingrese al aplicativo para confirmar su elección.</p>`;

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
        return this.layout(`${request.requestId}`, content);
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
            alertHtml += `<div style="background-color: #eff6ff; border: 1px solid #93c5fd; color: #1e3a8a; padding: 15px; margin-bottom: 20px; border-radius: 6px;"><strong>🌍 VIAJE INTERNACIONAL:</strong> Esta solicitud requiere aprobación de Gerencia General, Gerencia de Cadena de Suministro y Aprobador de Área.</div>`;
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
         Esta solicitud se hizo <strong>${diffDays} días</strong> antes del vuelo. <br/>
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
            alertHtml += `<div style="background-color: #fee2e2; border: 1px solid #fecaca; color: #991b1b; padding: 12px; border-radius: 4px; margin-bottom: 20px; font-size: 13px; border-left: 4px solid #ef4444;"><strong style="display:block; margin-bottom:4px; font-size:14px;">⚠️ CAMBIO CON COSTO EXTRA</strong>La solicitud original ya tenía tiquetes comprados (Etapa: RESERVADO).<br/>Este cambio generará penalidades o costos adicionales que se están aprobando.</div>`;
        }

        const content = `
            <p style="color: #4b5563; margin-bottom: 20px;">El usuario <strong>${escapeHtml_(request.requesterEmail)}</strong> requiere aprobación para el viaje <strong>${escapeHtml_(request.requestId)}</strong>.</p>
            
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
                    <tr>
                        <td style="border-bottom: 1px solid #e5e7eb; color: #6b7280;">Valor Tiquetes:</td>
                        <td style="border-bottom: 1px solid #e5e7eb; font-weight: bold; text-align: right;">$${Number(request.finalCostTickets || 0).toLocaleString()}</td>
                    </tr>
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
                <div style="font-size: 16px; color: #374151;">Su solicitud de viaje <strong>${request.requestId}</strong> ha sido <strong style="color: ${color};">${status}</strong>.</div>
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
                <div style="font-size: 40px; margin-bottom: 10px;">✈️</div>
                <div style="font-size: 16px; color: #374151;">Los tiquetes para su viaje <strong>${request.requestId}</strong> han sido comprados.</div>
            </div>

            <div style="background-color: #eff6ff; border: 1px solid #dbeafe; padding: 20px; border-radius: 8px; text-align: center; margin-bottom: 25px;">
                <div style="font-size: 12px; color: #60a5fa; margin-bottom: 5px; text-transform: uppercase; font-weight: bold;">NÚMERO DE RESERVA (PNR)</div>
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
        return this.layout(`${request.requestId}`, content, '#2563eb', 'TIQUETES COMPRADOS');
    },

    modificationResult: function(request, decision) {
        const isStudy = decision === 'study';
        const title = isStudy ? 'CAMBIO EN ESTUDIO' : 'CAMBIO RECHAZADO';
        const color = isStudy ? '#059669' : '#dc2626';
        const msg = isStudy ? 'Su solicitud ha pasado a etapa de cotización (Estudio). Pronto recibirá opciones.' : 'No fue posible realizar el cambio solicitado.';
        
        let content = `<p style="text-align:center; font-size:16px;">${msg}</p>`;
        
        if (isStudy) {
            content += `
                <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 30px 0;">
                ${this._getFullSummary(request)}
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
  const emailIdx = HEADERS_REQUESTS.indexOf("CORREO ENCUESTADO");
  const idIdx = HEADERS_REQUESTS.indexOf("ID RESPUESTA");
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
  const idIdx = HEADERS_REQUESTS.indexOf("ID RESPUESTA");
  
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
              // Avoid duplicates if the same person is in both lists (unlikely but possible)
              // We check if email already exists in the list we are building
              // However, iterating 400 rows x 2 checks is fast enough.
              // But `integrantes` array grows.
              
              // Only add if not already added (by email)
              // Note: Right section usually lacks ID, so we pass empty string.
              const exists = integrantes.some(u => u.email === email);
              if (!exists) {
                  integrantes.push({
                      idNumber: '', // Right section has no ID in the provided CSV
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
  if (!data.origin || String(data.origin).length > 200) errors.push('Ciudad origen inválida.');
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
  const idColIndex = HEADERS_REQUESTS.indexOf("ID RESPUESTA") + 1; 
  
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

  const row = new Array(HEADERS_REQUESTS.length).fill('');
  const set = (header, val) => { const i = HEADERS_REQUESTS.indexOf(header); if(i>-1) row[i] = val; };

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
  
  // Write the row data to the target row
  sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
  // --------------------------------------------------------------------------

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
 * If the request is a modification (has parent ID), the folder is created
 * as a subfolder inside the parent request's folder.
 */
function getOrCreateRequestFolder_(requestId, rowNumber, sheet) {
    const parentIdIdx = HEADERS_REQUESTS.indexOf("ID SOLICITUD PADRE");
    const parentId = String(sheet.getRange(rowNumber, parentIdIdx + 1).getValue()).trim();
    const isModification = parentId && parentId !== '' && parentId !== 'undefined';
    const root = DriveApp.getFolderById(ROOT_DRIVE_FOLDER_ID);

    if (isModification) {
        // Find or create parent folder in root
        let parentFolder;
        const rootFolders = root.getFolders();
        while (rootFolders.hasNext()) {
            const f = rootFolders.next();
            if (f.getName().indexOf(parentId) === 0) {
                parentFolder = f;
                break;
            }
        }
        if (!parentFolder) {
            parentFolder = root.createFolder(parentId);
        }

        // Find or create child folder inside parent
        let folder;
        const childFolders = parentFolder.getFolders();
        while (childFolders.hasNext()) {
            const f = childFolders.next();
            if (f.getName().indexOf(requestId) === 0) {
                folder = f;
                break;
            }
        }
        return folder || parentFolder.createFolder(requestId);
    } else {
        // Original request: find or create in root
        const allFolders = root.getFolders();
        while (allFolders.hasNext()) {
            const f = allFolders.next();
            if (f.getName().indexOf(requestId) === 0) {
                return f;
            }
        }
        return root.createFolder(requestId);
    }
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
    const idIdx = HEADERS_REQUESTS.indexOf("ID RESPUESTA");
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
   const idIdx = HEADERS_REQUESTS.indexOf("ID RESPUESTA");
   const statusIdx = HEADERS_REQUESTS.indexOf("STATUS");
   const ids = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat();
   const rowIndex = ids.map(String).indexOf(String(id));
   if (rowIndex === -1) throw new Error("ID no encontrado");
   const rowNumber = rowIndex + 2;

   sheet.getRange(rowNumber, statusIdx + 1).setValue(status);
   
   // --- STATISTICS ---
   if (status === 'APROBADO') {
       // sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("APROBADO POR ÁREA?") + 1).setValue("SÍ"); // REMOVED TO PRESERVE DETAILED LOGS
       const paxCountStr = sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("# PERSONAS QUE VIAJAN") + 1).getValue();
       const paxCount = parseInt(paxCountStr) || 1;
       const retDate = sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("FECHA VUELTA") + 1).getValue();
       const hasReturn = retDate && String(retDate).trim() !== '';
       const legs = hasReturn ? 2 : 1;
       sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("Q TKT") + 1).setValue(paxCount * legs);

       // CANCEL PARENT: When a modification is approved, the original request is cancelled
       const parentIdIdx = HEADERS_REQUESTS.indexOf("ID SOLICITUD PADRE");
       const parentId = sheet.getRange(rowNumber, parentIdIdx + 1).getValue();

       if (parentId && String(parentId).trim() !== '') {
           const allIds = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat();
           const parentRowIdx = allIds.map(String).indexOf(String(parentId));

           if (parentRowIdx !== -1) {
               const parentRowNum = parentRowIdx + 2;
               sheet.getRange(parentRowNum, statusIdx + 1).setValue('ANULADO');

               const obsIdx = HEADERS_REQUESTS.indexOf("OBSERVACIONES");
               const pObs = sheet.getRange(parentRowNum, obsIdx + 1).getValue();
               const cancelNote = `[SISTEMA]: Anulada automáticamente por aprobación del cambio ${id}.`;
               sheet.getRange(parentRowNum, obsIdx + 1).setValue((pObs ? pObs + "\n" : "") + cancelNote);
           }
       }

   } else if (status === 'DENEGADO') {
       // sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("APROBADO POR ÁREA?") + 1).setValue("NO"); // REMOVED TO PRESERVE DETAILED LOGS
   }

   // --- HANDLING NEW COLUMNS ---
   if (payload) {
       if (payload.analystOptions) {
           const optIdx = HEADERS_REQUESTS.indexOf("OPCIONES (JSON)");
           sheet.getRange(rowNumber, optIdx + 1).setValue(JSON.stringify(payload.analystOptions));
       }
       if (payload.selectionDetails) {
           const selIdx = HEADERS_REQUESTS.indexOf("SELECCION_TEXTO");
           sheet.getRange(rowNumber, selIdx + 1).setValue(payload.selectionDetails);
       }
       if (payload.finalCostTickets !== undefined) {
           sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("COSTO_FINAL_TIQUETES") + 1).setValue(payload.finalCostTickets);
       }
       if (payload.finalCostHotel !== undefined) {
           sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("COSTO_FINAL_HOTEL") + 1).setValue(payload.finalCostHotel);
       }
       if (payload.totalCost !== undefined) {
           // We have a COSTO COTIZADO column, can use that or TOTAL FACTURA? 
           // Let's use COSTO COTIZADO PARA VIAJE as the estimated approved cost
           sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("COSTO COTIZADO PARA VIAJE") + 1).setValue(payload.totalCost);
       }
   }

   // EMAILS
   if (status === 'PENDIENTE_SELECCION') {
      const fullReq = mapRowToRequest(sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0]);
      sendOptionsToRequester(fullReq.requesterEmail, fullReq, payload.analystOptions);
   }

   // NEW: NOTIFY ADMIN WHEN USER MAKES SELECTION
   if (status === 'PENDIENTE_CONFIRMACION_COSTO') {
      const fullReq = mapRowToRequest(sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0]);
      // The payload contains the new selection details, ensure it's in the object for the email
      if (payload && payload.selectionDetails) {
         fullReq.selectionDetails = payload.selectionDetails;
      }
      sendSelectionNotificationToAdmin(fullReq);
   }
   
   if (status === 'PENDIENTE_APROBACION') {
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

function uploadSupportFile(requestId, fileData, fileName, mimeType) {
  var sanitizedName = validateFileUpload_(fileData, fileName, mimeType);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
  const idIdx = HEADERS_REQUESTS.indexOf("ID RESPUESTA");
  const ids = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat();
  const rowIndex = ids.map(String).indexOf(String(requestId));
  if (rowIndex === -1) throw new Error("Solicitud no encontrada");
  const rowNumber = rowIndex + 2;
  const supportIdx = HEADERS_REQUESTS.indexOf("SOPORTES (JSON)");

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
  supportData.files.push({ id: file.getId(), name: file.getName(), url: file.getUrl(), mimeType, date: new Date().toISOString() });
  
  sheet.getRange(rowNumber, supportIdx + 1).setValue(JSON.stringify(supportData));
  return supportData;
}

function sendRequestEmailWithHtml(data, requestId, htmlTemplate) {
    const isModification = data.requestType === 'MODIFICACION';
    let baseHtml = htmlTemplate.replace("{{REQUEST_ID}}", requestId);

    if (isModification) {
        // --- 1. EMAIL FOR ADMIN (WITH BUTTONS) ---
        let adminActions = `
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
            <div style="background-color: #f3f4f6; border: 1px solid #e5e7eb; padding: 15px; border-radius: 6px; text-align: center; color: #4b5563;">
                <p style="margin: 0; font-weight: bold;">Solicitud de Cambio Enviada</p>
                <p style="margin-top: 5px; font-size: 13px;">El área de compras evaluará su solicitud. Recibirá una notificación si el cambio pasa a etapa de cotización.</p>
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
  const get = (h) => { const i = HEADERS_REQUESTS.indexOf(h); return (i>-1 && i<row.length) ? row[i] : ''; };
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
    comments: String(get("OBSERVACIONES")),
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
    creditCard: String(get("TARJETA DE CREDITO CON LA QUE SE HIZO LA COMPRA"))
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
function sendPendingApprovalReminders() {
  if (!isWorkingHour()) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
  const data = sheet.getDataRange().getValues();
  // Asumimos fila 1 headers, datos desde fila 2
  
  // Indices
  const statusIdx = HEADERS_REQUESTS.indexOf("STATUS");
  const areaApproveIdx = HEADERS_REQUESTS.indexOf("APROBADO POR ÁREA?");
  const cdsApproveIdx = HEADERS_REQUESTS.indexOf("APROBADO CDS");
  const ceoApproveIdx = HEADERS_REQUESTS.indexOf("APROBADO CEO");
  
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
             sendReminderEmail(request, target.email, target.role);
             remindersSent++;
         });
      }
    }
  }
  console.log(`Ejecución de recordatorios finalizada. Correos enviados: ${remindersSent}`);
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

// --- EMAIL HELPERS & TEMPLATES ---

function getStandardSubject(data) {
    const id = data.requestId || data.id; 
    let subject = `Solicitud de Viaje ${id} - ${data.requesterEmail} - ${data.company} ${data.site}`;
    if (data.isInternational) subject += " [INTERNACIONAL]";
    return subject;
}

function sendEmailRich(to, subject, htmlBody, cc) {
    try {
        const filterEmails = (str) => (str || "").split(',').map(e=>e.trim()).filter(e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).join(',');
        
        const ccAddress = (cc === undefined) ? ADMIN_EMAIL : cc;
        let validTo = filterEmails(to);
        let validCc = filterEmails(ccAddress);
        
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

/**
 * PERIODIC TASK: Send reminders to Admin for pending actions (v1.9)
 * Should be triggered every 2 hours manually via Triggers.
 */
function processAdminReminders() {
    if (!isWorkingHour()) return;
    
    console.log("Starting Admin Reminders process...");
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
    if (!sheet) return;

    const dataRows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    const requests = dataRows.map(mapRowToRequest);
    
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

    // Filter by status AND ensure the flight hasn't happened yet (not abandoned)
    const pendingOptions = requests.filter(r => r.status === 'PENDIENTE_OPCIONES' && r.departureDate >= today);
    const pendingCost = requests.filter(r => r.status === 'PENDIENTE_CONFIRMACION_COSTO' && r.departureDate >= today);
    const approved = requests.filter(r => (r.status === 'APROBADO' || r.status === 'RESERVADO_PARCIAL') && r.departureDate >= today);

    if (pendingOptions.length === 0 && pendingCost.length === 0 && approved.length === 0) {
        console.log("No pending tasks for admin. Skipping email.");
        return;
    }

    const html = HtmlTemplates.adminReminderSummary(pendingOptions, pendingCost, approved);
    const totalCount = pendingOptions.length + pendingCost.length + approved.length;
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
    // 1. Get template ID
    const templateId = PropertiesService.getScriptProperties().getProperty('REPORT_TEMPLATE_ID');
    if (!templateId) throw new Error('Plantilla de reporte no configurada. Ejecute createReportTemplate() primero.');
    
    // 2. Get request data
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
    const idIdx = HEADERS_REQUESTS.indexOf("ID RESPUESTA");
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
    body.replaceText('\\{\\{SOLICITUD_ID\\}\\}', requestId);
    body.replaceText('\\{\\{ESTADO\\}\\}', req.status || 'N/A');
    body.replaceText('\\{\\{FECHA_SOLICITUD\\}\\}', String(req.timestamp || 'N/A'));
    body.replaceText('\\{\\{TIPO_SOLICITUD\\}\\}', req.requestType || 'ORIGINAL');
    body.replaceText('\\{\\{SOLICITUD_PADRE\\}\\}', req.relatedRequestId || 'N/A');
    body.replaceText('\\{\\{SOLICITANTE\\}\\}', req.requesterEmail || 'N/A');
    
    body.replaceText('\\{\\{ORIGEN\\}\\}', req.origin || 'N/A');
    body.replaceText('\\{\\{DESTINO\\}\\}', req.destination || 'N/A');
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
function anularSolicitud(requestId, reason) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
  const idIdx = HEADERS_REQUESTS.indexOf("ID RESPUESTA");
  const statusIdx = HEADERS_REQUESTS.indexOf("STATUS");
  const obsIdx = HEADERS_REQUESTS.indexOf("OBSERVACIONES");
  const emailIdx = HEADERS_REQUESTS.indexOf("CORREO ENCUESTADO");
  
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
