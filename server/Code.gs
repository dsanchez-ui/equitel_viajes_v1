
/**
 * @OnlyCurrentDoc
 * @AuthorizationRequired
 * @oauthScopes https://www.googleapis.com/auth/spreadsheets.currentonly, https://www.googleapis.com/auth/drive, https://www.googleapis.com/auth/script.external_request, https://www.googleapis.com/auth/userinfo.email
 */

// --- CONFIGURATION & CONSTANTS ---
// TODO: AFTER DEPLOYING AS WEB APP, PASTE THE URL HERE FOR EMAILS (API ENDPOINT)
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbymPQQO0C8Xf089bjAVIciWNbsr9DmS50odghFp7t_nh5ZqHGFe7HisbaFF-TqMPxPwwQ/exec'; 

// LINK DE ACCESO A LA PLATAFORMA (INTERFAZ VISUAL)
const PLATFORM_URL = 'https://sistematiquetesequitel-302740316698.us-west1.run.app';

// LOGO URL
const EMAIL_LOGO_URL = 'https://drive.google.com/thumbnail?id=1hA1i-1mG4DbBmzG1pFWafoDrCWwijRjq&sz=w1000';

// TODO: INSERT YOUR GEMINI API KEY HERE
const GEMINI_API_KEY = 'test1'; 

// TIMEOUT PARA BLOQUEOS (CONCURRENCIA)
const LOCK_WAIT_MS = 30000; 

const SHEET_NAME_REQUESTS = 'Nueva Base Solicitudes';
const SHEET_NAME_MASTERS = 'MAESTROS';
const SHEET_NAME_RELATIONS = 'CDS vs UDEN';
const SHEET_NAME_INTEGRANTES = 'INTEGRANTES';

// DRIVE CONFIGURATION
const ROOT_DRIVE_FOLDER_ID = '1uaett_yH1qZcS-rVr_sUh73mODvX02im';

// ADMIN EMAIL CONFIGURATION
const ADMIN_EMAIL = 'dsanchez@equitel.com.co';

// EXTRA APPROVERS FOR INTERNATIONAL TRIPS
const CEO_EMAIL = 'misaza@equitel.com.co';
const DIRECTOR_EMAIL = 'yprieto@equitel.com.co';

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
  const isWriteAction = ['createRequest', 'updateRequest', 'uploadSupportFile', 'uploadOptionImage', 'closeRequest', 'requestModification', 'updateAdminPin', 'registerReservation'].includes(action);
  const lock = LockService.getScriptLock();

  let currentUserEmail = '';
  if (payload && payload.userEmail) {
    currentUserEmail = String(payload.userEmail).trim().toLowerCase();
  } else {
    currentUserEmail = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  }

  try {
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
      
      // NEW: UPLOAD OPTION IMAGE
      case 'uploadOptionImage': result = uploadOptionImage(payload.requestId, payload.fileData, payload.fileName, payload.type, payload.optionLetter); break;

      case 'closeRequest': result = updateRequestStatus(payload.requestId, 'PROCESADO'); break;
      case 'enhanceChangeText': result = enhanceTextWithGemini(payload.currentRequest, payload.userDraft); break;
      
      // REFACTORED MODIFICATION LOGIC
      case 'requestModification': result = requestModification(payload.requestId, payload.modifiedRequest, payload.changeReason, payload.emailHtml); break;
      
      // PIN FEATURES
      case 'verifyAdminPin': result = verifyAdminPin(payload.pin); break;
      case 'updateAdminPin': result = updateAdminPin(payload.newPin); break;

      // NEW: RESERVATION LOGIC
      case 'registerReservation': result = registerReservation(payload.requestId, payload.reservationNumber, payload.fileData, payload.fileName); break;

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

// ... HELPERS ...

function verifyAdminPin(inputPin) {
  const scriptProperties = PropertiesService.getScriptProperties();
  const storedPin = scriptProperties.getProperty('ADMIN_PIN');
  const currentPin = storedPin ? storedPin : '12345678';
  return String(inputPin) === String(currentPin);
}

function updateAdminPin(newPin) {
  if (!newPin || String(newPin).length !== 8) {
    throw new Error("El PIN debe tener exactamente 8 dígitos.");
  }
  const scriptProperties = PropertiesService.getScriptProperties();
  scriptProperties.setProperty('ADMIN_PIN', String(newPin));
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
        return renderMessagePage("Error", err.toString(), '#D71920');
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
              // Use actor if available, otherwise fallback to sheet (legacy)
              approverEmail = actor || sheet.getRange(rowNumber, HEADERS_REQUESTS.indexOf("CORREO DE QUIEN APRUEBA (AUTOMÁTICO)") + 1).getValue();
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
                  `Usted ya había registrado una decisión para esta solicitud anteriormente (Fecha: ${previousDecisionDate || 'Desconocida'}).<br/>No se han realizado cambios.`,
                  '#374151'
              );
          }
          
          SpreadsheetApp.flush(); // Ensure log is written before potential denial return

          // CHECK IF ALREADY ADVANCED - IF SO, STOP HERE
          if (isAdvancedStatus) {
              return renderMessagePage(
                  'Decisión Registrada', 
                  `Su decisión ha sido registrada en el sistema.<br/><br/><strong>Nota:</strong> Esta solicitud ya había avanzado previamente y se encuentra en estado: <span style="color:blue">${currentStatus}</span>. El flujo no se ha modificado.`,
                  '#374151'
              );
          }

          // 2. REJECTION: Any rejection kills the request instantly (ONLY IF NOT ADVANCED)
          if (!isApproved) {
              updateRequestStatus(id, 'DENEGADO', {}); // Update global status
              
              return renderMessagePage(
                  'Decisión Registrada', 
                  `Ha <strong>DENEGADO</strong> la solicitud. El proceso se ha detenido.`,
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
          
          let isFullyApproved = false;

          if (requiresExecutiveApproval) {
              // MODIFIED LOGIC: Area Approver AND (CDS OR CEO)
              // If either CDS or CEO approves (and Area approved), it counts as fully approved.
              if (areaApproved && (cdsApproved || ceoApproved)) {
                  isFullyApproved = true;
              }
          } else {
              // National: Just Normal Approver
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
          return renderMessagePage('Error', 'Error al procesar: ' + e.toString(), '#D71920');
      } finally {
          lock.releaseLock();
      }
  }
  return renderMessagePage("Sistema Ocupado", "Intente nuevamente.", '#D71920');
}

// --- NEW RESERVATION FUNCTION ---

function registerReservation(requestId, reservationNumber, fileData, fileName) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
    
    // Find Row
    const idIdx = HEADERS_REQUESTS.indexOf("ID RESPUESTA");
    const resNoIdx = HEADERS_REQUESTS.indexOf("No RESERVA");
    const statusIdx = HEADERS_REQUESTS.indexOf("STATUS");
    
    const ids = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat();
    const rowIndex = ids.map(String).indexOf(String(requestId));
    if (rowIndex === -1) throw new Error("Solicitud no encontrada");
    const rowNumber = rowIndex + 2;

    // 1. Handle File Upload
    // Find existing folder by name (Request ID) or create new (should exist)
    const root = DriveApp.getFolderById(ROOT_DRIVE_FOLDER_ID);
    const folders = root.getFoldersByName(requestId);
    let folder;
    if (folders.hasNext()) {
        folder = folders.next();
    } else {
        folder = root.createFolder(requestId);
    }

    // Create file
    const blob = Utilities.newBlob(Utilities.base64Decode(fileData), MimeType.PDF, fileName); // Default PDF or detect
    blob.setName(`Reserva_${reservationNumber}_${requestId}`);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const fileUrl = `https://drive.google.com/file/d/${file.getId()}/view?usp=sharing`;

    // 2. Rename Folder
    const newFolderName = `${requestId} - Reserva ${reservationNumber}`;
    folder.setName(newFolderName);

    // 3. Update Sheets
    sheet.getRange(rowNumber, resNoIdx + 1).setValue(reservationNumber);
    sheet.getRange(rowNumber, statusIdx + 1).setValue('RESERVADO');

    // 4. Update JSON Support Data (Optional but good for record keeping)
    // We reuse "SOPORTES (JSON)" or better yet, store the URL in support data to show in UI
    const supportIdx = HEADERS_REQUESTS.indexOf("SOPORTES (JSON)");
    const jsonStr = sheet.getRange(rowNumber, supportIdx + 1).getValue();
    let supportData = jsonStr ? JSON.parse(jsonStr) : { folderId: folder.getId(), folderUrl: folder.getUrl(), files: [] };
    
    // Add special reservation file
    supportData.files.push({ 
        id: file.getId(), 
        name: `Reserva ${reservationNumber}`, 
        url: fileUrl, 
        mimeType: 'application/pdf', 
        date: new Date().toISOString(),
        isReservation: true // Tag it
    });
    sheet.getRange(rowNumber, supportIdx + 1).setValue(JSON.stringify(supportData));

    // 5. Send Email
    const fullReq = mapRowToRequest(sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0]);
    // Inject reservation data manually since mapRowToRequest might not catch it immediately before flush
    fullReq.reservationNumber = reservationNumber;
    fullReq.reservationUrl = fileUrl;

    const html = HtmlTemplates.reservationConfirmed(fullReq);
    
    // IMPORTANT: Use the standard subject so it threads correctly in Gmail
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
    // SHARED: Generates the full Route, Dates, Passengers and Details block.
    // Replicates the "Initial Email" visual structure for consistency.
    _getFullSummary: function(data) {
        let ccDisplay = '';
        if (data.costCenter === 'VARIOS' && data.variousCostCenters) {
            const listItems = data.variousCostCenters.split(',').map(cc => `<li style="margin-bottom: 3px;">${cc.trim()}</li>`).join('');
            ccDisplay = `VARIOS:<ul style="margin: 5px 0 0; padding-left: 18px; font-size: 12px; line-height: 1.4; color: #374151;">${listItems}</ul>`;
        } else {
            ccDisplay = `${data.costCenter}${data.costCenterName ? ' - ' + data.costCenterName : ''}`;
        }
            
        const approverDisplay = data.approverName 
            ? `${data.approverName} <span style="font-weight:normal; font-size:12px; color:#6b7280;">(${data.approverEmail})</span>`
            : (data.approverEmail || 'Por Definir');

        const headerColor = '#D71920'; 
        const internationalBadge = data.isInternational
            ? `<span style="background-color: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; text-transform: uppercase; margin-left: 5px;">Internacional 🌍</span>`
            : '';

        const passengerList = (data.passengers || []).map(p => 
            `<li style="margin-bottom: 4px;">${p.name} <span style="color:#6b7280; font-size:12px;">(${p.idNumber})</span></li>`
        ).join('');

        return `
        <!-- ROUTE -->
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 20px; text-align: center;">
          <table width="100%">
            <tr>
              <td width="45%" align="left">
                <div style="font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">ORIGEN</div>
                <div style="font-size: 18px; font-weight: bold; color: #111827;">${data.origin}</div>
              </td>
              <td width="10%" align="center"><span style="color: #d1d5db; font-size: 20px;">&#10142;</span></td>
              <td width="45%" align="right">
                <div style="font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">DESTINO ${internationalBadge}</div>
                <div style="font-size: 18px; font-weight: bold; color: #111827;">${data.destination}</div>
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
          <div style="font-size: 14px; color: #713f12; font-style: italic; line-height: 1.5;">"${data.comments}"</div>
        </div>` : ''}

        <!-- DETAILS -->
        <div style="margin-top: 25px;">
            <div style="font-size: 14px; font-weight: bold; color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 15px;">Detalles del Caso</div>
            <table width="100%" cellpadding="6" cellspacing="0" border="0" style="font-size: 13px;">
                <tr><td width="35%" style="color: #6b7280;">Empresa / Sede:</td><td style="font-weight: 600; color: #111827;">${data.company} - ${data.site}</td></tr>
                <tr><td style="color: #6b7280;">Unidad de Negocio:</td><td style="font-weight: 600; color: #111827;">${data.businessUnit}</td></tr>
                <tr><td style="color: #6b7280;">Centro de Costos:</td><td style="font-weight: 600; color: #111827;">${ccDisplay}</td></tr>
                ${data.workOrder ? `<tr><td style="color: #6b7280;">Orden de Trabajo:</td><td style="font-weight: 600; color: #111827;">${data.workOrder}</td></tr>` : ''}
                <tr><td style="color: #6b7280;">Solicitante:</td><td><a href="mailto:${data.requesterEmail}" style="color: #0056b3;">${data.requesterEmail}</a></td></tr>
                <tr><td style="color: #6b7280;">Aprobador:</td><td style="font-weight: 600; color: #111827;">${approverDisplay}</td></tr>
                <tr><td style="color: #6b7280;">Hospedaje:</td><td style="font-weight: 600; color: #0056b3;">${data.requiresHotel ? `Sí (${data.nights} Noches)` : 'No'}</td></tr>
                ${data.requiresHotel ? `<tr><td style="color: #6b7280;">Hotel Sugerido:</td><td style="font-weight: 600; color: #111827;">${data.hotelName || 'N/A'}</td></tr>` : ''}
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

        const renderImages = (opts) => opts.map(opt => `
            <div style="margin-bottom: 15px; border: 1px solid #ddd; padding: 10px; border-radius: 4px;">
                <div style="font-weight:bold; color:#D71920; margin-bottom:5px;">Opción ${opt.id}</div>
                <img src="${opt.url}" alt="${opt.name}" style="max-width: 100%; height: auto; display: block; border-radius: 4px;" />
            </div>
        `).join('');

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
                El usuario <strong>${request.requesterEmail}</strong> ha realizado su selección para la solicitud <strong>${request.requestId}</strong>.
            </p>

            <div style="background-color: #f3f4f6; border-left: 4px solid #D71920; padding: 15px; margin-bottom: 25px; border-radius: 4px;">
                <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight:bold; margin-bottom: 5px;">SELECCIÓN DEL USUARIO</div>
                <div style="font-size: 14px; color: #111827; font-style: italic;">"${request.selectionDetails}"</div>
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
            <p style="color: #4b5563; margin-bottom: 20px;">El usuario <strong>${request.requesterEmail}</strong> requiere aprobación para el viaje <strong>${request.requestId}</strong>.</p>
            
            ${alertHtml}

            <!-- USER SELECTION TEXT -->
            <div style="background-color: #f3f4f6; border-left: 4px solid #374151; padding: 15px; margin-bottom: 25px; border-radius: 4px;">
                <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight:bold; margin-bottom: 5px;">ELECCIÓN DEL USUARIO</div>
                <div style="font-size: 14px; color: #111827; font-style: italic;">"${request.selectionDetails}"</div>
            </div>

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
        
        const content = `
            <div style="text-align: center; margin-bottom: 25px;">
                <div style="font-size: 40px; margin-bottom: 10px;">${icon}</div>
                <div style="font-size: 16px; color: #374151;">Su solicitud de viaje <strong>${request.requestId}</strong> ha sido <strong style="color: ${color};">${status}</strong>.</div>
            </div>
            
            ${isApproved ? `<div style="text-align: center; margin-bottom: 30px;"><a href="${PLATFORM_URL}" style="background-color: #111827; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; font-size: 12px;">Ingresar a la Plataforma</a></div>` : ''}

            <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 30px 0;">
            ${this._getFullSummary(request)}
        `;
        return this.layout(`${request.requestId}`, content, color, title);
    },
    
    // NEW TEMPLATE FOR RESERVATION CONFIRMATION (Updated with Full Summary)
    reservationConfirmed: function(request) {
        const content = `
            <div style="text-align: center; margin-bottom: 25px;">
                <div style="font-size: 40px; margin-bottom: 10px;">✈️</div>
                <div style="font-size: 16px; color: #374151;">Los tiquetes para su viaje <strong>${request.requestId}</strong> han sido comprados.</div>
            </div>
            
            <div style="background-color: #eff6ff; border: 1px solid #dbeafe; padding: 20px; border-radius: 8px; text-align: center; margin-bottom: 25px;">
                <div style="font-size: 12px; color: #60a5fa; margin-bottom: 5px; text-transform: uppercase; font-weight: bold;">NÚMERO DE RESERVA (PNR)</div>
                <div style="font-size: 24px; font-weight: bold; color: #1e3a8a; letter-spacing: 2px;">${request.reservationNumber || 'N/A'}</div>
            </div>

            <p style="text-align: center; color: #4b5563; margin-bottom: 25px;">
                Puede descargar la confirmación de la reserva y los tiquetes directamente desde la plataforma.
            </p>
            
            <div style="text-align: center;">
                <a href="${PLATFORM_URL}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">VER EN LA APP</a>
                <br/><br/>
                <a href="${request.reservationUrl}" style="color: #2563eb; font-size: 12px; text-decoration: underline;">Descargar Archivo Directamente</a>
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
    <script>function go(){document.getElementById('c').style.display='none';document.getElementById('l').style.display='block';window.location.href="${actionUrl}";}</script>
    </head><body>
    <div id="c" class="card"><h1>${title}</h1><p>${message}</p><button onclick="go()" class="btn">${actionText}</button></div>
    <div id="l" class="card" style="display:none"><h1>Procesando...</h1><p>Por favor espere.</p></div>
    </body></html>`;
    return HtmlService.createHtmlOutput(html).setTitle(title).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function renderMessagePage(title, message, color) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:sans-serif;background:#f3f4f6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:white;padding:40px;border-radius:8px;text-align:center}</style></head><body><div class="card"><h1 style="color:${color}">${title}</h1><p>${message}</p></div></body></html>`;
    return HtmlService.createHtmlOutput(html).setTitle(title).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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

function getCostCenterData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_RELATIONS);
  if (!sheet) return [];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  return data.map(row => ({ code: String(row[0]).trim(), name: String(row[1]), businessUnit: String(row[2]) })).filter(i => i.code);
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

function createNewRequest(data, emailHtml) {
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

// NEW FUNCTION: Upload Option Image
function uploadOptionImage(requestId, fileData, fileName, type, optionLetter) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
    const idIdx = HEADERS_REQUESTS.indexOf("ID RESPUESTA");
    const ids = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat();
    const rowIndex = ids.map(String).indexOf(String(requestId));
    if (rowIndex === -1) throw new Error("Solicitud no encontrada");
    
    // Get or Create Folder
    const root = DriveApp.getFolderById(ROOT_DRIVE_FOLDER_ID);
    const name = `${requestId}`;
    const folders = root.getFoldersByName(name);
    const folder = folders.hasNext() ? folders.next() : root.createFolder(name);
    
    // Ensure folder is accessible (optional based on org policy, but needed for public links if not using service account bridging)
    // folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const blob = Utilities.newBlob(Utilities.base64Decode(fileData), MimeType.PNG, fileName); // Assume PNG or detect
    const newName = `Opcion_${optionLetter}_${type}_${requestId}`;
    blob.setName(newName);
    
    const file = folder.createFile(blob);
    // Make file viewable to anyone with link so it can be embedded in emails easily
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const publicUrl = `https://drive.google.com/thumbnail?id=${file.getId()}&sz=w1000`; // CHANGED FROM uc?export=view for reliability
    // Or use file.getThumbnailLink() if size is an issue, but view link is better for quality

    return {
        id: optionLetter,
        type: type,
        url: publicUrl,
        driveId: file.getId(),
        name: newName
    };
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

       // *** NEW LOGIC: CANCEL PARENT IF THIS WAS A MODIFICATION ***
       const parentIdIdx = HEADERS_REQUESTS.indexOf("ID SOLICITUD PADRE");
       const parentId = sheet.getRange(rowNumber, parentIdIdx + 1).getValue();
       
       if (parentId && String(parentId).trim() !== '') {
           // Find parent row
           const allIds = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat();
           const parentRowIdx = allIds.map(String).indexOf(String(parentId));
           
           if (parentRowIdx !== -1) {
               const parentRowNum = parentRowIdx + 2;
               // Set Parent Status to ANULADO
               sheet.getRange(parentRowNum, statusIdx + 1).setValue('ANULADO');
               
               // Add observation note to parent
               const obsIdx = HEADERS_REQUESTS.indexOf("OBSERVACIONES");
               const pObs = sheet.getRange(parentRowNum, obsIdx + 1).getValue();
               const cancelNote = `[SISTEMA]: Anulada automáticamente por aprobación del cambio ${id}.`;
               sheet.getRange(parentRowNum, obsIdx + 1).setValue((pObs ? pObs + "\n" : "") + cancelNote);
           }
       }
       // *** END NEW LOGIC ***

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
      sendDecisionNotification(fullReq, status);
   }
   
   return true;
}

function uploadSupportFile(requestId, fileData, fileName, mimeType) {
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
     const root = DriveApp.getFolderById(ROOT_DRIVE_FOLDER_ID);
     const name = `${requestId}`;
     const folders = root.getFoldersByName(name);
     folder = folders.hasNext() ? folders.next() : root.createFolder(name);
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
        const ccEmails = [data.requesterEmail, getCCList(data)].filter(e => e).join(',');
        
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
   try { sendEmailRich(to, getStandardSubject(req), html, getCCList(req)); } catch(e) {}
}

// NEW FUNCTION
function sendSelectionNotificationToAdmin(req) {
    const html = HtmlTemplates.userSelectionNotification(req);
    try { 
        sendEmailRich(ADMIN_EMAIL, "Selección Realizada - Solicitud " + req.requestId, html, null);
    } catch(e) { console.error("Error sending admin selection notification: " + e); }
}

function sendDecisionNotification(req, status) {
  try { sendEmailRich(req.requesterEmail, getStandardSubject(req), html, ADMIN_EMAIL + ',' + getCCList(req)); } catch(e){}
}

function sendApprovalRequestEmail(req) {
    const getLinks = (role, actorEmail) => ({
        approve: `${WEB_APP_URL}?action=approve&id=${req.requestId}&decision=approved&role=${role}&actor=${encodeURIComponent(actorEmail || '')}`,
        reject: `${WEB_APP_URL}?action=approve&id=${req.requestId}&decision=denied&role=${role}&actor=${encodeURIComponent(actorEmail || '')}`
    });

    const subject = getStandardSubject(req) + " - APROBACIÓN REQUERIDA";

    // Handle Multiple Area Approvers
    const approverEmails = req.approverEmail.split(',').map(e => e.trim()).filter(e => e);
    
    approverEmails.forEach(email => {
        const normalLinks = getLinks('NORMAL', email);
        const normalHtml = HtmlTemplates.approvalRequest(req, req.selectedOption, normalLinks.approve, normalLinks.reject);
        sendEmailRich(email, subject, normalHtml, null);
    });

    // Check for High Cost Threshold (1.2M)
    const totalCost = Number(req.totalCost) || 0;
    const requiresExecutiveApproval = req.isInternational || totalCost > 1200000;

    if (requiresExecutiveApproval) {
        const ceoLinks = getLinks('CEO', CEO_EMAIL);
        const ceoHtml = HtmlTemplates.approvalRequest(req, req.selectedOption, ceoLinks.approve, ceoLinks.reject);
        sendEmailRich(CEO_EMAIL, subject, ceoHtml, null);

        const cdsLinks = getLinks('CDS', DIRECTOR_EMAIL);
        const cdsHtml = HtmlTemplates.approvalRequest(req, req.selectedOption, cdsLinks.approve, cdsLinks.reject);
        sendEmailRich(DIRECTOR_EMAIL, subject, cdsHtml, null);
    }
}

function isUserAnalyst(email) { return email.includes('admin') || email.includes('compras') || email.includes('analista') || email === ADMIN_EMAIL; }

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

  return {
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

    // METADATA FOR BANNERS
    parentWasReserved: get("ES_CAMBIO_CON_COSTO") === "SI",
    parentTimestamp: String(get("FECHA_SOLICITUD_PADRE"))
  };
}

// --- CRON JOBS / TRIGGERS ---

/**
 * Función para ser ejecutada por un Trigger de Tiempo (ej. cada 2 horas).
 * Revisa solicitudes PENDIENTE_APROBACION y envía recordatorios solo a quienes faltan.
 */
function sendPendingApprovalReminders() {
  // Time check (Bogotá GMT-5)
  const now = new Date();
  const dayOfWeek = parseInt(Utilities.formatDate(now, "America/Bogota", "u")); // 1 (Monday) - 7 (Sunday)
  const hour = parseInt(Utilities.formatDate(now, "America/Bogota", "H")); // 0-23
  
  let isWorkingHour = false;
  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      // Monday to Friday: 7:00 AM to 5:00 PM (17:00)
      if (hour >= 7 && hour < 17) {
          isWorkingHour = true;
      }
  } else if (dayOfWeek === 6) {
      // Saturday: 8:00 AM to 12:00 PM (12:00)
      if (hour >= 8 && hour < 12) {
          isWorkingHour = true;
      }
  }

  if (!isWorkingHour) {
      console.log("Fuera de horario laboral. No se enviarán recordatorios.");
      return;
  }

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

  // Empezar desde fila 2 (índice 1)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = row[statusIdx];

    if (status === 'PENDIENTE_APROBACION') {
      const request = mapRowToRequest(row); // Reutilizamos el mapper existente
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
