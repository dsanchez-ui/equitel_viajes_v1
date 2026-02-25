
import { ApiResponse, TravelRequest, CostCenterMaster, SupportData, Integrant, Option } from '../types';
import { API_BASE_URL } from '../constants';

class GasService {
  
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
          payload
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

  async uploadSupportFile(requestId: string, fileData: string, fileName: string, mimeType: string): Promise<SupportData> {
    const response = await this.runGas('uploadSupportFile', { requestId, fileData, fileName, mimeType });
    if (!response.success) throw new Error(response.error);
    return response.data;
  }

  // --- OPTION IMAGES UPLOAD ---
  async uploadOptionImage(requestId: string, fileData: string, fileName: string, type: 'FLIGHT' | 'HOTEL', optionLetter: string): Promise<Option> {
    const response = await this.runGas('uploadOptionImage', { requestId, fileData, fileName, type, optionLetter });
    if (!response.success) throw new Error(response.error);
    return response.data; // Returns Option object with URL
  }

  async closeRequest(requestId: string): Promise<void> {
    const response = await this.runGas('closeRequest', { requestId });
    if (!response.success) throw new Error(response.error);
  }

  // --- RESERVATION ---
  async registerReservation(requestId: string, reservationNumber: string, fileData: string, fileName: string): Promise<void> {
    const response = await this.runGas('registerReservation', { requestId, reservationNumber, fileData, fileName });
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
  
  async verifyAdminPin(pin: string): Promise<boolean> {
     const response = await this.runGas('verifyAdminPin', { pin });
     if (!response.success) throw new Error(response.error);
     return response.data === true;
  }

  async updateAdminPin(newPin: string): Promise<boolean> {
     const response = await this.runGas('updateAdminPin', { newPin });
     if (!response.success) throw new Error(response.error);
     return response.data === true;
  }
}

export const gasService = new GasService();
