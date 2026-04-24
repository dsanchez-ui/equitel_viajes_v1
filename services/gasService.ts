
import { ApiResponse, TravelRequest, CostCenterMaster, SupportData, Integrant, Option, CityMaster, MetricsFilters, MetricsResponse } from '../types';
import { API_BASE_URL } from '../constants';

// Global handler so the App can react when the backend reports an expired session.
type SessionExpiredHandler = () => void;
let sessionExpiredHandler: SessionExpiredHandler | null = null;
export function setOnSessionExpired(handler: SessionExpiredHandler | null) {
  sessionExpiredHandler = handler;
}

// --- HEALTH MONITORING -------------------------------------------------------
// Detecta SOLO transport errors (fetch falló, HTTP 5xx, respuesta HTML en vez
// de JSON). NO cuenta errores lógicos del backend ({success:false, error:...})
// porque esos son respuestas válidas. Cuando hay N fallos de transporte
// consecutivos, notifica al listener (App.tsx) que muestra el banner.
type HealthStatus = 'ok' | 'down';
type HealthHandler = (status: HealthStatus) => void;
let healthHandler: HealthHandler | null = null;
let consecutiveTransportFailures = 0;
let reportedHealth: HealthStatus = 'ok';
const TRANSPORT_FAILURE_THRESHOLD = 3; // 3 fallos seguidos ≈ >10s de caída

export function setOnHealthChange(handler: HealthHandler | null) {
  healthHandler = handler;
}

function _notifyTransport(ok: boolean) {
  if (ok) {
    consecutiveTransportFailures = 0;
    if (reportedHealth === 'down') {
      reportedHealth = 'ok';
      if (healthHandler) { try { healthHandler('ok'); } catch (_) { /* noop */ } }
    }
  } else {
    consecutiveTransportFailures++;
    if (consecutiveTransportFailures >= TRANSPORT_FAILURE_THRESHOLD && reportedHealth === 'ok') {
      reportedHealth = 'down';
      if (healthHandler) { try { healthHandler('down'); } catch (_) { /* noop */ } }
    }
  }
}

class GasService {
  private _userEmail: string = '';
  private _sessionToken: string = '';

  setUserEmail(email: string) {
    this._userEmail = email.toLowerCase().trim();
  }

  setSessionToken(token: string) {
    this._sessionToken = token || '';
  }

  getSessionToken(): string {
    return this._sessionToken;
  }

  clearSession() {
    this._sessionToken = '';
    this._userEmail = '';
  }

  /**
   * Universal Bridge using HTTP FETCH.
   */
  private async runGas(action: string, payload: any = null): Promise<ApiResponse<any>> {
    if (!API_BASE_URL || API_BASE_URL.includes('REPLACE')) {
      console.warn("API URL not configured in constants.ts");
      return { success: false, error: "API URL no configurada." };
    }

    try {
      const response = await fetch(API_BASE_URL, {
        method: 'POST',
        mode: 'cors',
        redirect: 'follow',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify({
          action,
          payload: {
            ...payload,
            userEmail: payload?.userEmail || this._userEmail,
            sessionToken: payload?.sessionToken || this._sessionToken
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
      }

      const textResult = await response.text();

      if (!textResult) {
        return { success: true, data: null };
      }

      let result;
      try {
        result = JSON.parse(textResult);
      } catch (e) {
        if (textResult.trim().startsWith('<')) {
          throw new Error("El servidor devolvió HTML en lugar de JSON (Posible error de script o acceso).");
        }
        console.error("Invalid JSON response:", textResult);
        throw new Error("El servidor devolvió una respuesta inválida.");
      }

      // If the backend reports an expired/invalid session, notify the app shell.
      if (result && result.success === false && result.code === 'SESSION_EXPIRED') {
        this.clearSession();
        if (sessionExpiredHandler) {
          try { sessionExpiredHandler(); } catch (_) { /* noop */ }
        }
      }

      // Transport OK: llegamos hasta aquí con JSON parseado. Aunque el backend
      // haya devuelto {success:false}, eso es lógica, no caída de conectividad.
      _notifyTransport(true);
      return result;

    } catch (error: any) {
      let msg = error.message || 'Error de conexión';
      const isNetworkError = msg.includes('Failed to fetch') || msg.includes('NetworkError');

      if ((action === 'getCurrentUser' || action === 'getIntegrantesData') && isNetworkError) {
        console.warn(`[API Info] Connection check failed for ${action}: Server unreachable or offline.`);
      } else {
        console.error(`[API Error] ${action}:`, error);
      }

      if (isNetworkError) {
        msg = 'No se pudo conectar con el servidor. Verifique su conexión o la URL del script.';
      }
      // Transport fail: fetch lanzó, HTTP !ok, HTML en vez de JSON, etc.
      // Estos son los casos que cuentan para el health banner.
      _notifyTransport(false);
      return { success: false, error: msg };
    }
  }

  async getCurrentUser(): Promise<string> {
    const response = await this.runGas('getCurrentUser');
    return response.data || '';
  }

  async getMyRequests(userEmail: string): Promise<TravelRequest[]> {
    const response = await this.runGas('getMyRequests', { userEmail });
    return response.data || [];
  }

  async getAllRequests(userEmail: string): Promise<TravelRequest[]> {
    const response = await this.runGas('getAllRequests', { userEmail });
    return response.data || [];
  }

  async createRequest(request: Partial<TravelRequest>, emailHtml?: string): Promise<string> {
    const response = await this.runGas('createRequest', { ...request, emailHtml });
    if (!response.success) throw new Error(response.error);
    return response.data;
  }

  async updateRequestStatus(id: string, status: string, payload?: any): Promise<void> {
    const response = await this.runGas('updateRequest', { id, status, payload });
    if (!response.success) throw new Error(response.error);
  }

  /**
   * Helper para los fetches "bootstrap" (datos de referencia que la app
   * necesita para funcionar: directorio, ciudades, centros de costo, reglas,
   * etc.). Antes silenciábamos fallos con `response.data || []`, lo que
   * causaba UI rota e invisible (ej. dropdowns vacíos sin explicación,
   * "cédula no encontrada" para todo el mundo si el directorio fallaba).
   *
   * Política nueva:
   *   - Un reintento con 800 ms para sobrevivir cold starts de GAS y
   *     hipos transient de red (los más frecuentes).
   *   - Si ambos intentos fallan, lanzamos error para que el caller
   *     decida: alertar al usuario, re-login, reintentar manualmente.
   *   - Sesión expirada NO se reintenta (runGas ya disparó el handler).
   *
   * @param action            Nombre de la acción en el backend.
   * @param humanName         Nombre legible para el mensaje de error.
   * @param payload           Payload opcional de la acción.
   * @param expectArray       Si true, valida que `data` sea array.
   */
  private async _bootstrapFetch<T>(
    action: string,
    humanName: string,
    payload: any = null,
    expectArray: boolean = true
  ): Promise<T> {
    let response = await this.runGas(action, payload);
    if (!response || response.success === false) {
      if (response && response.code === 'SESSION_EXPIRED') {
        throw new Error(response.error || 'Sesión expirada.');
      }
      await new Promise(r => setTimeout(r, 800));
      response = await this.runGas(action, payload);
    }
    if (!response || response.success === false) {
      throw new Error(response?.error || `No se pudo cargar ${humanName}.`);
    }
    if (expectArray) {
      if (!Array.isArray(response.data)) {
        throw new Error(`Respuesta inesperada del servidor al cargar ${humanName}.`);
      }
    } else if (response.data === undefined || response.data === null) {
      throw new Error(`Respuesta inesperada del servidor al cargar ${humanName}.`);
    }
    return response.data as T;
  }

  async getCostCenterData(): Promise<CostCenterMaster[]> {
    return this._bootstrapFetch<CostCenterMaster[]>('getCostCenterData', 'los centros de costo');
  }

  async getIntegrantesData(): Promise<Integrant[]> {
    return this._bootstrapFetch<Integrant[]>('getIntegrantesData', 'el directorio de usuarios');
  }

  async getCitiesList(): Promise<CityMaster[]> {
    return this._bootstrapFetch<CityMaster[]>('getCitiesList', 'el listado de ciudades');
  }

  async getCoApproverRules(): Promise<{ principalEmail: string, coApproverName: string, coApproverEmail: string, condition: string }[]> {
    return this._bootstrapFetch<{ principalEmail: string, coApproverName: string, coApproverEmail: string, condition: string }[]>('getCoApproverRules', 'las reglas de co-aprobación');
  }

  async getExecutiveEmails(): Promise<{ ceoEmail: string, directorEmail: string }> {
    return this._bootstrapFetch<{ ceoEmail: string, directorEmail: string }>('getExecutiveEmails', 'los correos ejecutivos', null, false);
  }

  async getCreditCards(): Promise<{ value: string, label: string }[]> {
    return this._bootstrapFetch<{ value: string, label: string }[]>('getCreditCards', 'las tarjetas de crédito');
  }

  async getSites(): Promise<string[]> {
    return this._bootstrapFetch<string[]>('getSites', 'las sedes');
  }

  async uploadSupportFile(requestId: string, fileData: string, fileName: string, mimeType: string): Promise<SupportData> {
    const response = await this.runGas('uploadSupportFile', { requestId, fileData, fileName, mimeType });
    if (!response.success) throw new Error(response.error);
    return response.data;
  }

  // --- OPTION IMAGES UPLOAD ---
  async uploadOptionImage(requestId: string, fileData: string, fileName: string, type: 'FLIGHT' | 'HOTEL', optionLetter: string, direction?: 'IDA' | 'VUELTA'): Promise<Option> {
    const response = await this.runGas('uploadOptionImage', { requestId, fileData, fileName, type, optionLetter, direction });
    if (!response.success) throw new Error(response.error);
    return response.data; // Returns Option object with URL
  }

  async deleteOptionFile(fileId: string): Promise<boolean> {
    const response = await this.runGas('deleteDriveFile', { fileId });
    if (!response.success) throw new Error(response.error);
    return response.data === true;
  }

  async getMetrics(filters: MetricsFilters = {}): Promise<MetricsResponse> {
    const response = await this.runGas('getMetrics', { filters });
    if (!response.success) throw new Error(response.error);
    return response.data;
  }

  async closeRequest(requestId: string): Promise<void> {
    const response = await this.runGas('closeRequest', { requestId });
    if (!response.success) throw new Error(response.error);
  }

  // --- RESERVATION ---
  async registerReservation(requestId: string, reservationNumber: string, files: { fileData: string, fileName: string }[], creditCard: string, purchaseDate?: string, skipNotification?: boolean): Promise<void> {
    const response = await this.runGas('registerReservation', { requestId, reservationNumber, files, creditCard, purchaseDate, skipNotification });
    if (!response.success) throw new Error(response.error);
  }

  /**
   * Superadmin-only: salta la etapa PENDIENTE_SELECCION de una solicitud.
   * Backend valida rol en tiempo real + justificación min 10 chars.
   */
  async skipSelectionStage(requestId: string, justification: string): Promise<void> {
    const response = await this.runGas('skipSelectionStage', { requestId, justification });
    if (!response.success) throw new Error(response.error);
  }

  /**
   * Saltar la etapa de aprobación (solo SUPERADMIN). La solicitud pasa de
   * PENDIENTE_APROBACION → APROBADO directamente. No se envían correos a
   * CEO/CDS/área. Queda registrado en OBSERVACIONES y EVENTOS_JSON.
   */
  async skipApprovalStage(requestId: string, justification: string): Promise<void> {
    const response = await this.runGas('skipApprovalStage', { requestId, justification });
    if (!response.success) throw new Error(response.error);
  }

  /**
   * Amend an existing reservation: update PNR/card/date, delete old files,
   * upload new files, and send a correction email to the user.
   */
  async amendReservation(
    requestId: string,
    reservationNumber: string,
    creditCard: string,
    purchaseDate: string,
    fileIdsToDelete: string[],
    newFiles: { fileData: string, fileName: string }[],
    correctionNote?: string
  ): Promise<void> {
    const response = await this.runGas('amendReservation', {
      requestId,
      reservationNumber,
      creditCard,
      purchaseDate,
      fileIdsToDelete,
      newFiles,
      correctionNote
    });
    if (!response.success) throw new Error(response.error);
  }

  // --- MODIFICATION FEATURES ---

  async enhanceTextWithGemini(currentRequest: TravelRequest, userDraft: string): Promise<string> {
    const response = await this.runGas('enhanceChangeText', { currentRequest, userDraft });
    if (!response.success) throw new Error(response.error);
    return response.data;
  }

  async requestModification(requestId: string, modifiedRequest: Partial<TravelRequest>, changeReason: string, emailHtml?: string): Promise<void> {
    const response = await this.runGas('requestModification', { requestId, modifiedRequest, changeReason, emailHtml });
    if (!response.success) throw new Error(response.error);
  }

  /**
   * Admin: resolve a pending change request (PENDIENTE_ANALISIS_CAMBIO) from the app.
   * - decision 'study' → pass the change to PENDIENTE_OPCIONES (same as the email button)
   * - decision 'deny'  → deny the change with a required reason. `parentAction` controls
   *   what happens to the original request: 'keep' (default) or 'anulate'.
   */
  async processChangeDecision(
    childRequestId: string,
    decision: 'study' | 'deny',
    options?: { reason?: string; parentAction?: 'keep' | 'anulate' | 'consult' }
  ): Promise<{ childId: string; action: string; parentAction?: string; parentId?: string | null }> {
    const response = await this.runGas('processChangeDecision', {
      childRequestId,
      decision,
      reason: options?.reason || '',
      parentAction: options?.parentAction || 'keep',
    });
    if (!response.success) throw new Error(response.error);
    return response.data;
  }

  // --- ADMIN SECURITY ---

  async cancelRequest(requestId: string, reason: string): Promise<void> {
    const response = await this.runGas('anularSolicitud', { requestId, reason });
    if (!response.success) throw new Error(response.error);
  }

  /** User self-cancellation: cancel own request (no admin required). */
  async cancelOwnRequest(requestId: string, reason: string): Promise<void> {
    const response = await this.runGas('cancelOwnRequest', { requestId, reason });
    if (!response.success) throw new Error(response.error);
  }

  async generateReport(requestId: string): Promise<string> {
    const response = await this.runGas('generateReport', { requestId });
    if (!response.success) throw new Error(response.error);
    return response.data;
  }

  async createReportTemplate(): Promise<string> {
    const response = await this.runGas('createReportTemplate');
    if (!response.success) throw new Error(response.error);
    return response.data;
  }

  async checkIsAnalyst(email: string): Promise<boolean> {
    const response = await this.runGas('checkIsAnalyst', { userEmail: email });
    // CRÍTICO: si response.success es false (cold start GAS, timeout, error red),
    // NO retornar false silenciosamente — eso hace que el UI muestre "no tiene
    // permisos de administrador" cuando en realidad hubo un error de conexión.
    // Lanzar para que el caller distinga: "Error al verificar" vs "no es admin".
    if (!response.success) {
      throw new Error(response.error || 'Error verificando permisos.');
    }
    return response.data === true;
  }

  async verifyAdminPin(pin: string, email: string): Promise<{ success: boolean, token?: string, expiresAt?: number, role?: string }> {
    const response = await this.runGas('verifyAdminPin', { pin, email, userEmail: email });
    if (!response.success) throw new Error(response.error);
    // New response shape: { success, token, expiresAt, role }
    if (response.data && typeof response.data === 'object') {
      return response.data;
    }
    // Backward-compat fallback (old backend that returns boolean)
    return { success: response.data === true };
  }

  async updateAdminPin(newPin: string): Promise<boolean> {
    const response = await this.runGas('updateAdminPin', { newPin });
    if (!response.success) throw new Error(response.error);
    return response.data === true;
  }

  // --- USER PIN AUTHENTICATION ---

  async requestUserPin(email: string, forceRegenerate: boolean = false): Promise<{ sent: boolean, hasExistingPin: boolean, isFirstTime: boolean, maskedEmail: string }> {
    const response = await this.runGas('requestUserPin', { email, forceRegenerate, userEmail: email });
    if (!response.success) throw new Error(response.error);
    return response.data;
  }

  async verifyUserPin(email: string, pin: string): Promise<{ success: boolean, token?: string, expiresAt?: number, role?: string }> {
    const response = await this.runGas('verifyUserPin', { email, pin, userEmail: email });
    if (!response.success) throw new Error(response.error);
    return response.data;
  }

  async validateSession(email: string, token: string): Promise<{ valid: boolean, role?: string, expiresAt?: number }> {
    const response = await this.runGas('validateSession', { email, token, userEmail: email });
    if (!response.success) return { valid: false };
    return response.data || { valid: false };
  }

  async logout(): Promise<void> {
    if (!this._userEmail || !this._sessionToken) {
      this.clearSession();
      return;
    }
    try {
      await this.runGas('logout', { email: this._userEmail, token: this._sessionToken });
    } catch (_) { /* best-effort */ }
    this.clearSession();
  }
}

export const gasService = new GasService();
