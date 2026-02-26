
import { TravelRequest } from '../types';
import { LOGO_URL } from '../constants';
import { getDaysDiff } from './dateUtils';

/**
 * Generates a modern HTML email template mimicking the "Gestión de Viajes" card style.
 */
export const generateTravelRequestEmail = (data: Partial<TravelRequest>, isModification: boolean): string => {
  const title = isModification ? "SOLICITUD DE MODIFICACIÓN" : "GESTIÓN DE VIAJES";
  const headerColor = isModification ? "#F59E0B" : "#D71920"; // Amber for mod, Red for new

  // Helper for dates
  const formatDate = (dateStr?: string) => dateStr || 'N/A';
  const formatTime = (timeStr?: string) => timeStr ? `(${timeStr})` : '';

  // Passenger List
  const passengerList = (data.passengers || []).map(p =>
    `<li style="margin-bottom: 4px;">${p.name} <span style="color:#6b7280; font-size:12px;">(${p.idNumber})</span></li>`
  ).join('');

  // Cost Center Display
  const ccDisplay = data.costCenter === 'VARIOS'
    ? `VARIOS:\n${(data.costCenterName || data.variousCostCenters || '').split(',').map(c => `• ${c.trim()}`).join('\n')}`
    : `${data.costCenter} - ${data.costCenterName || ''}`;

  // Approver Display
  const approverDisplay = data.approverName
    ? `${data.approverName} <span style="color:#6b7280; font-weight:normal;">&lt;${data.approverEmail}&gt;</span>`
    : (data.approverEmail || 'Por Definir');

  // Linked Request Logic (Days ago)
  let linkedRequestInfo = '';
  if (isModification && data.relatedRequestId && data.parentTimestamp) {
    const diffDays = getDaysDiff(data.parentTimestamp, new Date());

    linkedRequestInfo = `
      <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; padding: 10px; border-radius: 4px; margin-bottom: 10px; font-size: 12px; text-align: center;">
         <strong>ℹ️ SOLICITUD VINCULADA:</strong><br/>
         Esta solicitud reemplaza a la solicitud <strong>${data.relatedRequestId}</strong>, creada hace <strong>${diffDays} días</strong>.
      </div>`;
  }

  // Extra Cost Warning Logic
  let extraCostWarning = '';
  if (isModification && data.parentWasReserved) {
    extraCostWarning = `
      <div style="background-color: #fee2e2; border: 1px solid #fecaca; color: #991b1b; padding: 12px; border-radius: 4px; margin-bottom: 15px; font-size: 13px; text-align: center; border-left: 4px solid #ef4444;">
         <strong style="display:block; margin-bottom:4px; font-size:14px;">⚠️ CAMBIO CON COSTO EXTRA</strong>
         La solicitud original (<strong>${data.relatedRequestId}</strong>) ya tenía tiquetes comprados (Etapa: RESERVADO).<br/>
         Este cambio generará penalidades o costos adicionales.
      </div>`;
  }

  // Modification Reason Block
  const modBlock = isModification
    ? `<div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
         <strong style="color: #92400e; display: block; font-size: 12px; margin-bottom: 5px; text-transform:uppercase;">Motivo del Cambio:</strong>
         <div style="color: #333; font-style: italic;">"${data.changeReason}"</div>
       </div>`
    : '';

  // Policy Violation Block Logic
  let policyBlock = '';
  if (data.policyViolation && data.departureDate) {
    // Use getDaysDiff instead of data.daysInAdvance parameter
    const diffDays = data.timestamp ? getDaysDiff(data.timestamp, data.departureDate) : (data.daysInAdvance || 0);

    const required = data.isInternational ? 30 : 8;

    policyBlock = `<div style="background-color: #fff1f2; border: 1px solid #fecaca; color: #be123c; padding: 10px; border-radius: 4px; margin-bottom: 15px; font-size: 12px; text-align: center;">
         <strong style="display:block; margin-bottom:4px;">⚠️ SOLICITUD FUERA DE POLÍTICA DE ANTICIPACIÓN</strong>
         Esta solicitud se hizo <strong>${diffDays} días</strong> antes del vuelo. <br/>
         Por ser ${data.isInternational ? 'internacional' : 'nacional'}, debería haberse hecho con al menos <strong>${required} días</strong> de anticipación.
       </div>`;
  }


  // International Badge
  const internationalBadge = data.isInternational
    ? `<span style="background-color: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; text-transform: uppercase; margin-left: 5px;">Internacional 🌍</span>`
    : '';

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: Helvetica, Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; color: #333; }
      .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
      .header { background-color: ${headerColor}; color: #ffffff; padding: 30px 20px; text-align: center; }
      .header h1 { margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 1px; }
      .header .id { margin-top: 5px; font-size: 14px; opacity: 0.9; }
      .content { padding: 30px; }
      .intro { margin-bottom: 25px; color: #4b5563; font-size: 14px; line-height: 1.5; }
      
      .route-box { border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 20px; text-align: center; }
      .route-label { font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
      .route-city { font-size: 18px; font-weight: bold; color: #111827; }
      .route-arrow { color: #d1d5db; font-size: 20px; vertical-align: middle; padding: 0 10px; }

      .dates-box { display: table; width: 100%; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 20px; border-collapse: separate; border-spacing: 0; }
      .date-cell { display: table-cell; width: 50%; padding: 15px; text-align: center; vertical-align: top; }
      .date-cell:first-child { border-right: 1px solid #e5e7eb; }
      .date-label { font-size: 10px; color: #9ca3af; text-transform: uppercase; margin-bottom: 5px; }
      .date-value { font-weight: bold; color: ${headerColor}; font-size: 14px; }
      .time-value { font-size: 12px; color: #6b7280; margin-top: 2px; }

      .details-section { margin-top: 25px; }
      .section-title { font-size: 14px; font-weight: bold; color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 15px; }
      .detail-row { display: table; width: 100%; margin-bottom: 8px; font-size: 13px; }
      .detail-label { display: table-cell; color: #6b7280; width: 40%; }
      .detail-value { display: table-cell; color: #111827; font-weight: bold; width: 60%; }

      .note-box { background-color: #fefce8; border: 1px solid #fef08a; border-radius: 6px; padding: 15px; margin-top: 20px; }
      .note-label { font-size: 11px; font-weight: bold; color: #b45309; text-transform: uppercase; margin-bottom: 5px; }
      .note-text { font-size: 13px; color: #b45309; font-style: italic; }

      .passenger-box { background-color: #eff6ff; border: 1px solid #dbeafe; border-radius: 6px; padding: 15px; margin-top: 15px; }
      .passenger-label { font-size: 11px; font-weight: bold; color: #1e40af; text-transform: uppercase; margin-bottom: 5px; }
      .passenger-list { margin: 0; padding-left: 20px; font-size: 13px; color: #1e3a8a; }

      .actions { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #f3f4f6; }
      .footer { text-align: center; font-size: 11px; color: #9ca3af; margin-top: 20px; padding-bottom: 20px; }
    </style>
  </head>
  <body>
    <div class="container">
      <!-- HEADER -->
      <div class="header">
        <h1>${title}</h1>
        <div class="id">ID: {{REQUEST_ID}}</div>
      </div>

      <!-- CONTENT -->
      <div class="content">
        ${extraCostWarning}
        ${linkedRequestInfo}
        ${modBlock}
        ${policyBlock}
        
        <div class="intro">
          Se ha registrado un ${isModification ? 'requerimiento de cambio' : 'nuevo requerimiento de viaje'} para 
          <strong>${data.requesterEmail}</strong>.
        </div>

        <!-- ROUTE -->
        <div class="route-box">
          <table width="100%">
            <tr>
              <td width="45%" align="left">
                <div class="route-label">ORIGEN</div>
                <div class="route-city">${data.origin}</div>
              </td>
              <td width="10%" align="center"><span class="route-arrow">&#10142;</span></td>
              <td width="45%" align="right">
                <div class="route-label">DESTINO ${internationalBadge}</div>
                <div class="route-city">${data.destination}</div>
              </td>
            </tr>
          </table>
        </div>

        <!-- DATES -->
        <div class="dates-box">
          <div class="date-cell">
            <div class="date-label">FECHA IDA</div>
            <div class="date-value">📅 ${formatDate(data.departureDate)}</div>
            <div class="time-value">${formatTime(data.departureTimePreference)}</div>
          </div>
          <div class="date-cell">
            <div class="date-label">FECHA REGRESO</div>
            <div class="date-value">📅 ${formatDate(data.returnDate)}</div>
            <div class="time-value">${formatTime(data.returnTimePreference)}</div>
          </div>
        </div>

        <!-- DETAILS -->
        <div class="details-section">
          <div class="section-title">Detalles del Caso</div>
          <div class="detail-row">
            <span class="detail-label">Empresa / Sede:</span>
            <span class="detail-value">${data.company} - ${data.site}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Unidad de Negocio:</span>
            <span class="detail-value">${data.businessUnit}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Centro de Costos:</span>
            <span class="detail-value">${ccDisplay}</span>
          </div>
          ${data.workOrder ? `
          <div class="detail-row">
            <span class="detail-label">Orden de Trabajo:</span>
            <span class="detail-value">${data.workOrder}</span>
          </div>
          ` : ''}
          <div class="detail-row">
            <span class="detail-label">Hospedaje:</span>
            <span class="detail-value">${data.requiresHotel ? `Sí - ${data.hotelName} (${data.nights} Noches)` : 'No'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Aprobador:</span>
            <span class="detail-value">${approverDisplay}</span>
          </div>
        </div>

        <!-- OBSERVATIONS -->
        ${data.comments ? `
        <div class="note-box">
          <div class="note-label">OBSERVACIONES / NOTAS:</div>
          <div class="note-text">${data.comments}</div>
        </div>` : ''}

        <!-- PASSENGERS -->
        <div class="passenger-box">
          <div class="passenger-label">PASAJERO(S) (${(data.passengers || []).length}):</div>
          <ul class="passenger-list">
            ${passengerList}
          </ul>
        </div>

        <!-- ACTIONS -->
        <div class="actions">
           {{ACTION_BUTTONS}}
        </div>

      </div>
    </div>

    <div class="footer">
      &copy; ${new Date().getFullYear()} Organización Equitel. Gestión de Viajes Corporativos.<br>
      Este es un mensaje automático, por favor no responder.
    </div>
  </body>
  </html>
  `;
};
