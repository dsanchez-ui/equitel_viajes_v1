
import { ApiResponse, TravelRequest, CostCenterMaster, SupportData, Integrant, Option, CityMaster } from '../types';
import { API_BASE_URL } from '../constants';

// Global handler so the App can react when the backend reports an expired session.
type SessionExpiredHandler = () => void;
let sessionExpiredHandler: SessionExpiredHandler | null = null;
export function setOnSessionExpired(handler: SessionExpiredHandler | null) {
  sessionExpiredHandler = handler;
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

  async getCostCenterData(): Promise<CostCenterMaster[]> {
    const response = await this.runGas('getCostCenterData');
    return response.data || [];
  }

  async getIntegrantesData(): Promise<Integrant[]> {
    const response = await this.runGas('getIntegrantesData');
    return response.data || [];
  }

  async getCitiesList(): Promise<CityMaster[]> {
    const response = await this.runGas('getCitiesList');
    return response.data || [];
  }

  async getCoApproverRules(): Promise<{ principalEmail: string, coApproverName: string, coApproverEmail: string, condition: string }[]> {
    const response = await this.runGas('getCoApproverRules');
    return response.data || [];
  }

  async getCreditCards(): Promise<{ value: string, label: string }[]> {
    const response = await this.runGas('getCreditCards');
    return response.data || [];
  }

  async getSites(): Promise<string[]> {
    const response = await this.runGas('getSites');
    return response.data || [];
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

  async closeRequest(requestId: string): Promise<void> {
    const response = await this.runGas('closeRequest', { requestId });
    if (!response.success) throw new Error(response.error);
  }

  // --- RESERVATION ---
  async registerReservation(requestId: string, reservationNumber: string, files: { fileData: string, fileName: string }[], creditCard: string): Promise<void> {
    const response = await this.runGas('registerReservation', { requestId, reservationNumber, files, creditCard });
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

  // --- ADMIN SECURITY ---

  async cancelRequest(requestId: string, reason: string): Promise<void> {
    const response = await this.runGas('anularSolicitud', { requestId, reason });
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
    return response.success && response.data === true;
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
