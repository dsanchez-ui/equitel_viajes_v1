
// Hardcoded mapping based on CSV column headers or indices
// NOTE: In a real GAS project, we might fetch headers dynamically. 
// Here we map key properties to their conceptual column usage.

// API URL: env var for local dev, hardcoded default for production builds (public GAS endpoint, not a secret)
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://script.google.com/macros/s/AKfycbymPQQO0C8Xf089bjAVIciWNbsr9DmS50odghFp7t_nh5ZqHGFe7HisbaFF-TqMPxPwwQ/exec';

// Dominio de Google Workspace de Equitel (#A53, #A91).
export const WORKSPACE_DOMAIN = 'equitel.com.co';

/**
 * URL de una PÁGINA del web app que abre una persona (p. ej. el dashboard de costos),
 * con el dominio explícito: script.google.com/a/macros/equitel.com.co/s/…/exec (#A91).
 * Con la URL corta, un celular con varias cuentas de Google abiertas muestra "No se pudo
 * abrir el archivo"; con el dominio, Google usa la cuenta de Equitel. Es el mismo arreglo
 * de #A53 para los botones de los correos. Las llamadas del API (gasService) siguen con
 * API_BASE_URL tal cual.
 */
export function webAppPageUrl(query: string, base: string = API_BASE_URL): string {
  const url = base.replace(/^https:\/\/script\.google\.com\/macros\/s\//, 'https://script.google.com/a/macros/' + WORKSPACE_DOMAIN + '/s/');
  return url + (url.indexOf('?') > -1 ? '&' : '?') + query;
}

// Logo hosted on Google Drive (Using Thumbnail endpoint for better embedding reliability)
export const LOGO_URL = 'https://drive.google.com/thumbnail?id=1hA1i-1mG4DbBmzG1pFWafoDrCWwijRjq&sz=w1000';

export const SHEET_NAMES = {
  REQUESTS: 'Nueva Base Solicitudes',
  MASTERS: 'MAESTROS'
};

export const APP_VERSION = '2.9';

// Application Colors
export const COLORS = {
  primary: '#D71920', // Equitel Red
  secondary: '#000000', // Equitel Black
};

// Dropdown Options (Simplified for demo, usually fetched from Masters)
export const COMPANIES = ['Cumandes', 'Equitel', 'Ingenergía', 'LAP'];
export const BUSINESS_UNITS = ['ADM ADMON Y FINANCIERA', 'ENERGIA PROYECTOS', 'PARTES Y MOTORES', 'VICEPRESIDENCIA'];
export const COST_CENTERS = ['0100', '0101', '0200', '0400', '0500', 'VARIOS'];

export const MAX_PASSENGERS = 5;
