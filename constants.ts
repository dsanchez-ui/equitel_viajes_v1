
// Hardcoded mapping based on CSV column headers or indices
// NOTE: In a real GAS project, we might fetch headers dynamically. 
// Here we map key properties to their conceptual column usage.

// TODO: REPLACE THIS WITH YOUR DEPLOYED GOOGLE APPS SCRIPT WEB APP URL
export const API_BASE_URL = 'https://script.google.com/macros/s/AKfycbymPQQO0C8Xf089bjAVIciWNbsr9DmS50odghFp7t_nh5ZqHGFe7HisbaFF-TqMPxPwwQ/exec';

// Logo hosted on Google Drive (Using Thumbnail endpoint for better embedding reliability)
export const LOGO_URL = 'https://drive.google.com/thumbnail?id=1hA1i-1mG4DbBmzG1pFWafoDrCWwijRjq&sz=w1000';

export const SHEET_NAMES = {
  REQUESTS: 'Nueva Base Solicitudes',
  MASTERS: 'MAESTROS'
};

// Application Colors
export const COLORS = {
  primary: '#D71920', // Equitel Red
  secondary: '#000000', // Equitel Black
};

// Dropdown Options (Simplified for demo, usually fetched from Masters)
export const COMPANIES = ['Cummins', 'Equitel', 'Ingenergía', 'LAP'];
export const SITES = ['MOSQUERA', 'PEREIRA', 'BARRANQUILLA', 'MEDELLIN', 'YUMBO', 'BOGOTA', 'CALI'];
export const BUSINESS_UNITS = ['ADM ADMON Y FINANCIERA', 'ENERGIA PROYECTOS', 'PARTES Y MOTORES', 'VICEPRESIDENCIA'];
export const COST_CENTERS = ['0100', '0101', '0200', '0400', '0500', 'VARIOS'];

export const MAX_PASSENGERS = 5;
