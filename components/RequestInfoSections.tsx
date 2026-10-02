import React from 'react';
import { TravelRequest, PassengerAdminInfo, Option } from '../types';
import { getDaysDiff, formatToDDMMYYYY } from '../utils/dateUtils';
import { ageOnDate, todayIsoLocal } from '../utils/birthdate';
import { formatPhone } from '../utils/phone';

/**
 * Secciones de solo lectura del detalle de una solicitud (#A81). Las usan el
 * detalle (RequestDetail) y el modal "Confirmar costos", para que el área de
 * viajes vea toda la información sin abrir la solicitud en otra pestaña.
 * El JSX se movió tal cual desde RequestDetail.tsx.
 */

// Drive image URL: uc?export=view serves raw content for public files (works cross-origin in browsers)
const getDriveImageUrl = (driveId: string) => `https://drive.google.com/uc?export=view&id=${driveId}`;
// Fallback URL formats if primary fails
const getDriveFallbackUrl = (driveId: string) => `https://drive.google.com/thumbnail?id=${driveId}&sz=w1000`;
// Viewer URL for "open in new tab"
const getViewerUrl = (driveId: string) => `https://drive.google.com/file/d/${driveId}/view?usp=sharing`;

export const sanitizeCedula = (raw: string) => String(raw || '').replace(/\D+/g, '').substring(0, 30);

// ============================================================
// FECHA DE NACIMIENTO Y CELULAR por pasajero (C2 y #A74, 2026-09-10).
// Solo se muestran a administradores: el área de viajes necesita la fecha para
// emitir el tiquete y el celular para contactar al pasajero. El solicitante no
// los ve: en una solicitud se pueden escribir cédulas de otras personas.
// ============================================================
export type BirthdatesLoadState = 'idle' | 'loading' | 'ready' | 'error';

const PassengerBirthdatePart: React.FC<{ entry?: PassengerAdminInfo }> = ({ entry }) => {
    if (!entry || !entry.birthdate) {
        return <span className="text-[11px] font-semibold text-amber-700">⚠️ Sin fecha de nacimiento</span>;
    }
    const age = ageOnDate(entry.birthdate, todayIsoLocal());
    // Se reordena el texto 'AAAA-MM-DD' → 'DD-MM-AAAA' sin crear un Date: una
    // fecha así interpretada en UTC se ve un día antes en Colombia.
    const fecha = entry.birthdate.split('-').reverse().join('-');
    return (
        <span className="text-xs text-gray-600">
            🎂 Nac.: <span className="font-mono">{fecha}</span> ({age} años)
            {entry.source === 'SOLICITUD' && (
                <span className="text-[10px] text-gray-400"> · registrada en esta solicitud</span>
            )}
        </span>
    );
};

const PassengerPhonePart: React.FC<{ entry?: PassengerAdminInfo }> = ({ entry }) => {
    // Sin `phone` = backend anterior a #A74: no se muestra nada.
    if (!entry || entry.phone === undefined) return null;
    if (!entry.phone) {
        return <span className="text-[11px] text-gray-400">📱 Sin celular registrado</span>;
    }
    return (
        <span className="text-xs text-gray-600">
            📱 <a href={`tel:+57${entry.phone}`} className="font-mono hover:underline">{formatPhone(entry.phone)}</a>
            {' · '}
            <a
                href={`https://wa.me/57${entry.phone}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-green-700 hover:underline"
            >
                WhatsApp
            </a>
        </span>
    );
};

const PassengerAdminInfoLine: React.FC<{ state: BirthdatesLoadState; entry?: PassengerAdminInfo }> = ({ state, entry }) => {
    if (state === 'loading' || state === 'idle') {
        return <span className="text-[11px] text-gray-400 animate-pulse">Fecha de nacimiento y celular…</span>;
    }
    if (state === 'error') {
        return <span className="text-[11px] text-gray-400">No se pudo cargar la fecha de nacimiento ni el celular.</span>;
    }
    return (
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <PassengerBirthdatePart entry={entry} />
            <PassengerPhonePart entry={entry} />
        </span>
    );
};


export const RequestTripCorporateInfo: React.FC<{ request: TravelRequest }> = ({ request }) => (
    <>
                                {/* --- SECTION 1: DETAILED INFO GRID --- */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                                    {/* Left Col: Trip / Hotel Details */}
                                    <div className="bg-gray-50 rounded-lg p-4 text-sm border border-gray-200">
                                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-200 pb-2">
                                            {request.requestMode === 'HOTEL_ONLY' ? 'Información del Hospedaje' : 'Información del Viaje'}
                                        </h4>
                                        <div className="space-y-3">
                                            <div className={`grid gap-2 ${request.requestMode === 'HOTEL_ONLY' ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                                {request.requestMode !== 'HOTEL_ONLY' && (
                                                    <div><span className="block text-xs text-gray-500">Origen</span><span className="font-semibold text-gray-900">{request.origin}</span></div>
                                                )}
                                                <div>
                                                    <span className="block text-xs text-gray-500">{request.requestMode === 'HOTEL_ONLY' ? 'Ciudad del Hospedaje' : 'Destino'}</span>
                                                    <span className="font-semibold text-gray-900">{request.destination}</span>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <span className="block text-xs text-gray-500">{request.requestMode === 'HOTEL_ONLY' ? 'Check-in' : 'Fecha Ida'}</span>
                                                    <span className="font-medium">{formatToDDMMYYYY(request.departureDate)}</span>
                                                    {request.requestMode !== 'HOTEL_ONLY' && <span className="text-xs text-gray-400 block">{request.departureTimePreference}</span>}
                                                </div>
                                                <div>
                                                    <span className="block text-xs text-gray-500">{request.requestMode === 'HOTEL_ONLY' ? 'Check-out' : 'Fecha Regreso'}</span>
                                                    <span className="font-medium">{request.returnDate ? formatToDDMMYYYY(request.returnDate) : (request.requestMode === 'HOTEL_ONLY' ? 'N/A' : 'Solo Ida')}</span>
                                                    {request.requestMode !== 'HOTEL_ONLY' && <span className="text-xs text-gray-400 block">{request.returnTimePreference}</span>}
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 bg-white p-2 rounded border border-gray-100">
                                                <div>
                                                    <span className="block text-[10px] text-gray-400 uppercase font-bold">Antelación</span>
                                                    <span className="font-medium text-gray-700">{getDaysDiff(request.timestamp, request.departureDate)} días</span>
                                                </div>
                                                <div>
                                                    <span className="block text-[10px] text-gray-400 uppercase font-bold">Faltan</span>
                                                    <span className="font-medium text-gray-700">
                                                        {getDaysDiff(new Date(), request.departureDate) < 0
                                                            ? <span className="italic text-gray-400">Sol. Antigua</span>
                                                            : `${getDaysDiff(new Date(), request.departureDate)} días`}
                                                    </span>
                                                </div>
                                            </div>
                                            <div><span className="block text-xs text-gray-500">Solicitante</span><span className="font-medium break-words text-blue-600">{request.requesterEmail}</span></div>
                                        </div>
                                    </div>

                                    {/* Right Col: Corporate Details */}
                                    <div className="bg-white rounded-lg p-4 text-sm border border-gray-200">
                                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-100 pb-2">Información Corporativa</h4>
                                        <div className="space-y-2">
                                            <div className="flex justify-between border-b border-gray-50 pb-1">
                                                <span className="text-gray-500 text-xs">Empresa</span>
                                                <span className="font-medium text-right">{request.company}</span>
                                            </div>
                                            <div className="flex justify-between border-b border-gray-50 pb-1">
                                                <span className="text-gray-500 text-xs">Sede</span>
                                                <span className="font-medium text-right">{request.site}</span>
                                            </div>
                                            <div className="flex justify-between border-b border-gray-50 pb-1">
                                                <span className="text-gray-500 text-xs">Unidad de Negocio</span>
                                                <span className="font-medium text-right text-xs max-w-[60%]">{request.businessUnit}</span>
                                            </div>
                                            <div className="flex justify-between border-b border-gray-50 pb-1">
                                                <span className="text-gray-500 text-xs">Centro de Costos</span>
                                                <div className="text-right max-w-[70%]">
                                                    {request.costCenter === 'VARIOS' ? (
                                                        <span className="font-medium text-xs block">{request.costCenterName || request.variousCostCenters}</span>
                                                    ) : (
                                                        <>
                                                            <span className="font-medium block">{request.costCenter}</span>
                                                            {request.costCenterName && <span className="text-[10px] text-gray-400 block ml-auto">{request.costCenterName}</span>}
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            {request.workOrder && (
                                                <div className="flex justify-between pt-1">
                                                    <span className="text-gray-500 text-xs">Orden de Trabajo</span>
                                                    <span className="font-medium text-right">{request.workOrder}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
    </>
);

export const RequestPassengersHotelInfo: React.FC<{
    request: TravelRequest;
    isAdmin: boolean;
    passengerInfoState: BirthdatesLoadState;
    passengerInfoByCedula: Record<string, PassengerAdminInfo>;
}> = ({ request, isAdmin, passengerInfoState, passengerInfoByCedula }) => (
    <>
                                {/* --- SECTION 2: PASSENGERS & HOTEL --- */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Passengers */}
                                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-100 pb-2">
                                            Pasajeros ({request.passengers.length})
                                        </h4>
                                        <div className={`space-y-2 ${isAdmin ? 'max-h-64' : 'max-h-40'} overflow-y-auto pr-1`}>
                                            {request.passengers.map((p, idx) => (
                                                <div key={idx} className="flex flex-col bg-gray-50 p-2 rounded border border-gray-100">
                                                    <span className="font-bold text-gray-800 text-sm">{p.name}</span>
                                                    <span className="text-xs text-gray-500 font-mono">CC: {p.idNumber}</span>
                                                    {isAdmin && (
                                                        <PassengerAdminInfoLine state={passengerInfoState} entry={passengerInfoByCedula[sanitizeCedula(p.idNumber)]} />
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Hotel Preference */}
                                    {request.requiresHotel && (
                                        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                                            <h4 className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-3 border-b border-blue-200 pb-2">
                                                Preferencia de Hospedaje
                                            </h4>
                                            <div className="space-y-2 text-sm">
                                                <div>
                                                    <span className="text-blue-500 text-xs block">Hotel Sugerido</span>
                                                    <span className="font-bold text-gray-900 text-lg">{request.hotelName || 'No especificado'}</span>
                                                </div>
                                                <div>
                                                    <span className="text-blue-500 text-xs block">Duración</span>
                                                    <span className="font-medium text-gray-800">{request.nights} Noches</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
    </>
);

export const RequestComments: React.FC<{ request: TravelRequest }> = ({ request }) => (
    <>
                                {/* --- OBSERVATIONS --- */}
                                {request.comments && (
                                    <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-4">
                                        <h4 className="text-xs font-bold text-yellow-800 uppercase tracking-wider mb-2">Observaciones / Notas</h4>
                                        <p className="text-sm text-gray-800 italic whitespace-pre-line">{request.comments}</p>
                                    </div>
                                )}
    </>
);

export const RequestOptionsGallery: React.FC<{ flightOptions: Option[]; hotelOptions: Option[] }> = ({ flightOptions, hotelOptions }) => (
    <>
                                {/* --- SECTION 3: OPTIONS GALLERY (For Selection Phase) --- */}
                                {flightOptions.length > 0 && (
                                    <div className="border-t pt-4">
                                        <h4 className="text-sm font-bold text-gray-700 uppercase mb-3 flex items-center justify-between">
                                            <span>✈️ Opciones de Vuelo</span>
                                            <div className="flex gap-3 text-[10px] lowercase font-normal italic">
                                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400"></span> ida</span>
                                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500"></span> vuelta</span>
                                            </div>
                                        </h4>

                                        <div className="bg-gray-50 p-3 rounded-md mb-4 border border-gray-100 text-xs text-gray-600">
                                            <p>Nota: Las opciones resaltadas en <strong className="text-amber-600">amarillo</strong> corresponden a los vuelos de <strong>IDA</strong> y las resaltadas en <strong className="text-green-600">verde</strong> a los vuelos de <strong>VUELTA</strong>.</p>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            {flightOptions.map((opt, i) => (
                                                <div
                                                    key={i}
                                                    className={`border-2 p-3 rounded-lg shadow-sm transition-all ${opt.direction === 'VUELTA' ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
                                                        }`}
                                                >
                                                    <div className="flex justify-between items-center mb-2">
                                                        <div className={`font-bold text-lg ${opt.direction === 'VUELTA' ? 'text-green-700' : 'text-amber-700'}`}>
                                                            Opción {opt.id}
                                                        </div>
                                                        <div className={`px-2 py-0.5 rounded text-[10px] font-bold text-white ${opt.direction === 'VUELTA' ? 'bg-green-600' : 'bg-amber-500'}`}>
                                                            {opt.direction === 'VUELTA' ? 'VUELTA' : 'IDA'}
                                                        </div>
                                                    </div>
                                                    <div className="bg-white rounded mb-2 overflow-hidden border border-white relative group">
                                                        <img
                                                            src={getDriveImageUrl(opt.driveId)}
                                                            alt="Vuelo"
                                                            className="w-full h-64 object-contain mx-auto"
                                                            loading="lazy"
                                                            referrerPolicy="no-referrer"
                                                            onError={(e) => {
                                                                const img = e.currentTarget;
                                                                if (img.dataset.retried === '1') {
                                                                    img.dataset.retried = '2';
                                                                    img.src = `https://lh3.googleusercontent.com/d/${opt.driveId}=w800`;
                                                                } else if (!img.dataset.retried) {
                                                                    img.dataset.retried = '1';
                                                                    img.src = getDriveFallbackUrl(opt.driveId);
                                                                }
                                                            }}
                                                        />
                                                        <a
                                                            href={getViewerUrl(opt.driveId)}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100"
                                                        >
                                                            <span className="bg-white text-gray-900 px-4 py-2 rounded-full font-bold shadow-lg text-xs transform scale-90 group-hover:scale-100 transition-transform">
                                                                🔍 Ver Imagen Completa
                                                            </span>
                                                        </a>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {hotelOptions.length > 0 && (
                                    <div className="border-t pt-4">
                                        <h4 className="text-sm font-bold text-blue-800 uppercase mb-3">🏨 Opciones de Hotel</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            {hotelOptions.map((opt, i) => (
                                                <div key={i} className="border border-gray-200 p-3 rounded-lg shadow-sm bg-white">
                                                    <div className="font-bold text-blue-600 mb-2 text-lg">Opción {opt.id}</div>
                                                    <div className="bg-gray-100 rounded mb-2 overflow-hidden border border-gray-100 relative group">
                                                        <img
                                                            src={getDriveImageUrl(opt.driveId)}
                                                            alt="Hotel"
                                                            className="w-full h-64 object-contain mx-auto"
                                                            loading="lazy"
                                                            referrerPolicy="no-referrer"
                                                            onError={(e) => {
                                                                const img = e.currentTarget;
                                                                if (img.dataset.retried === '1') {
                                                                    img.dataset.retried = '2';
                                                                    img.src = `https://lh3.googleusercontent.com/d/${opt.driveId}=w800`;
                                                                } else if (!img.dataset.retried) {
                                                                    img.dataset.retried = '1';
                                                                    img.src = getDriveFallbackUrl(opt.driveId);
                                                                }
                                                            }}
                                                        />
                                                        <a
                                                            href={getViewerUrl(opt.driveId)}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100"
                                                        >
                                                            <span className="bg-white text-gray-900 px-4 py-2 rounded-full font-bold shadow-lg text-xs transform scale-90 group-hover:scale-100 transition-transform">
                                                                🔍 Ver Imagen Completa
                                                            </span>
                                                        </a>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
    </>
);
