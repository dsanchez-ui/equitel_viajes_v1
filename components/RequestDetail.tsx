
import React, { useState } from 'react';
import { TravelRequest, RequestStatus, Integrant } from '../types';
import { gasService } from '../services/gasService';
import { ConfirmationDialog } from './ConfirmationDialog';
import { getDaysDiff, formatToDDMMYYYY } from '../utils/dateUtils';

interface RequestDetailProps {
    request: TravelRequest;
    integrantes: Integrant[];
    onClose: () => void;
    onRefresh?: () => void;
    onModify: (req: TravelRequest) => void;
    isAdmin?: boolean;
}

// Drive image URL: uc?export=view serves raw content for public files (works cross-origin in browsers)
const getDriveImageUrl = (driveId: string) => `https://drive.google.com/uc?export=view&id=${driveId}`;
// Fallback URL formats if primary fails
const getDriveFallbackUrl = (driveId: string) => `https://drive.google.com/thumbnail?id=${driveId}&sz=w1000`;
// Viewer URL for "open in new tab"
const getViewerUrl = (driveId: string) => `https://drive.google.com/file/d/${driveId}/view?usp=sharing`;

type EffectiveStatus = 'APPROVED' | 'DENIED' | 'PENDING' | 'NA';

const ApprovalStatusRow = ({
    label,
    effectiveStatus,
    rawStatusString,
    naReason
}: {
    label: string;
    effectiveStatus?: EffectiveStatus;
    rawStatusString?: string;
    naReason?: string;
}) => {
    // Extract date from the raw status string (format: "Sí_email_dd/m/yyyy hh:mm" or "Sí_email")
    const parts = rawStatusString ? rawStatusString.split('_') : [];
    const date = parts.length > 2 ? parts[2] : '';

    const renderBadge = () => {
        switch (effectiveStatus) {
            case 'APPROVED':
                return (
                    <div className="flex flex-col items-end">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-800">
                            ✅ APROBADO
                        </span>
                        {date && <span className="text-[10px] text-gray-400 mt-0.5">{date}</span>}
                    </div>
                );
            case 'DENIED':
                return (
                    <div className="flex flex-col items-end">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-800">
                            ❌ DENEGADO
                        </span>
                        {date && <span className="text-[10px] text-gray-400 mt-0.5">{date}</span>}
                    </div>
                );
            case 'NA':
                return (
                    <span
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-400"
                        title={naReason || 'No aplica'}
                    >
                        🚫 NO APLICA
                    </span>
                );
            case 'PENDING':
            default:
                return (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                        ⏳ PENDIENTE
                    </span>
                );
        }
    };

    return (
        <div className="flex justify-between items-start py-2 border-b border-gray-100 last:border-0 text-sm">
            <div className="flex flex-col flex-1 min-w-0 pr-3">
                <span className="text-gray-600 font-medium">{label}</span>
                {effectiveStatus === 'NA' && naReason && (
                    <span className="text-[11px] text-gray-400 italic mt-0.5">{naReason}</span>
                )}
            </div>
            <div className="text-right flex-shrink-0">{renderBadge()}</div>
        </div>
    );
};

export const RequestDetail = ({ request, integrantes, onClose, onRefresh, onModify, isAdmin = false }: RequestDetailProps) => {
    const [loading, setLoading] = useState(false);
    const [userSelectionText, setUserSelectionText] = useState('');

    const [dialog, setDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: 'ALERT' | 'CONFIRM' | 'SUCCESS';
        onConfirm: () => void;
        onCancel?: () => void;
    }>({
        isOpen: false,
        title: '',
        message: '',
        type: 'ALERT',
        onConfirm: () => { },
    });

    const closeDialog = () => setDialog({ ...dialog, isOpen: false });

    // Determine Actions based on State
    const isSelectionPhase = request.status === RequestStatus.PENDING_SELECTION;
    const isCostPhase = request.status === RequestStatus.PENDING_CONFIRMACION_COSTO;
    // Allow edit if not processed/cancelled. RESERVED is now allowed but with warning.
    const isEditable = request.status !== RequestStatus.PROCESSED && request.status !== RequestStatus.CANCELLED;

    // Custom Status Display for User Peace of Mind
    const getDisplayStatus = (status: RequestStatus) => {
        if (status === RequestStatus.RESERVED) return 'TIQUETES COMPRADOS';
        return status.replace(/_/g, ' ');
    };

    const getStatusColor = (status: RequestStatus) => {
        if (status === RequestStatus.APPROVED) return 'bg-green-100 text-green-700';
        if (status === RequestStatus.RESERVED) return 'bg-blue-100 text-blue-800'; // Special color for bought
        if (status === RequestStatus.PROCESSED) return 'bg-gray-800 text-white';
        return 'bg-gray-100 text-gray-600';
    };

    const flightOptions = request.analystOptions?.filter(o => o.type === 'FLIGHT') || [];
    const hotelOptions = request.analystOptions?.filter(o => o.type === 'HOTEL') || [];

    const handleUserSelectionSubmit = async () => {
        if (!userSelectionText.trim()) {
            alert("Por favor describa qué opción desea seleccionar.");
            return;
        }
        setLoading(true);
        try {
            await gasService.updateRequestStatus(request.requestId, RequestStatus.PENDING_CONFIRMACION_COSTO, {
                selectionDetails: userSelectionText
            });
            onSuccessAction("Selección enviada correctamente. El analista confirmará los costos.");
        } catch (e) {
            alert("Error: " + e);
            setLoading(false);
        }
    };

    const onSuccessAction = (msg: string) => {
        setDialog({
            isOpen: true,
            title: 'Exito',
            message: msg,
            type: 'SUCCESS',
            onConfirm: () => {
                closeDialog();
                if (onRefresh) onRefresh();
                onClose();
            }
        });
    };

    const handleModifyClick = () => {
        if (request.status === RequestStatus.RESERVED) {
            setDialog({
                isOpen: true,
                title: '¡Advertencia de Costo Extra!',
                message: 'Esta solicitud ya tiene tiquetes comprados (RESERVADO).\n\nRealizar un cambio en esta etapa generará costos adicionales por penalidades y requerirá aprobaciones adicionales.\n\n¿Desea continuar?',
                type: 'CONFIRM',
                onConfirm: () => {
                    closeDialog();
                    onModify(request);
                },
                onCancel: closeDialog
            });
        } else {
            onModify(request);
        }
    };

    return (
        <>
            <ConfirmationDialog
                isOpen={dialog.isOpen}
                title={dialog.title}
                message={dialog.message}
                type={dialog.type}
                onConfirm={dialog.onConfirm}
                onCancel={dialog.onCancel}
            />

            <div className="fixed inset-0 z-[60] overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose}></div>
                    <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>

                    <div className="relative inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full sm:p-6">
                        <div className="absolute top-0 right-0 pt-4 pr-4 z-10">
                            <button onClick={onClose} className="bg-white rounded-md text-gray-400 hover:text-gray-500 text-2xl font-bold leading-none px-2 focus:outline-none">✕</button>
                        </div>

                        <div className="w-full">
                            <div className="border-b border-gray-200 pb-4 mb-4">
                                <h3 className="text-xl leading-6 font-bold text-gray-900">
                                    Detalle Solicitud <span className="text-brand-red">{request.requestId}</span>
                                </h3>
                                <div className={`mt-2 inline-flex px-3 py-1 text-xs font-bold rounded-full ${getStatusColor(request.status)}`}>
                                    {getDisplayStatus(request.status)}
                                </div>
                                {request.relatedRequestId && (
                                    <div className="mt-2 text-sm text-blue-600 font-medium">
                                        Vinculada a {request.relatedRequestId}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">

                                {request.policyViolation && request.departureDate && (
                                    <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md text-sm text-center">
                                        <strong className="block mb-1">⚠️ SOLICITUD FUERA DE POLÍTICA DE ANTICIPACIÓN</strong>
                                        Esta solicitud se hizo <strong>{getDaysDiff(request.timestamp, request.departureDate)} días</strong> antes del vuelo. <br />
                                        Por ser {request.isInternational ? 'internacional' : 'nacional'}, debería haberse hecho con al menos <strong>{request.isInternational ? 30 : 8} días</strong> de anticipación.
                                    </div>
                                )}
                                {request.isInternational && (
                                    <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-md text-sm">
                                        <strong>🌍 VIAJE INTERNACIONAL:</strong> Requiere aprobación de Gerencia General, Gerencia de Cadena de Suministro y Aprobador de Área.
                                    </div>
                                )}

                                {(Number(request.totalCost) || 0) > 1200000 && (
                                    <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md text-sm">
                                        <strong>⚠️ APROBACIÓN EXTRAORDINARIA:</strong> El costo total de esta solicitud (${Number(request.totalCost).toLocaleString()}) excede el tope establecido ($1,200,000), por lo que requiere aprobación adicional de Gerencia General, Gerencia de Cadena de Suministro y Aprobador de Área.
                                    </div>
                                )}

                                {/* --- SECTION 1: DETAILED INFO GRID --- */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                                    {/* Left Col: Trip Details */}
                                    <div className="bg-gray-50 rounded-lg p-4 text-sm border border-gray-200">
                                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-200 pb-2">Información del Viaje</h4>
                                        <div className="space-y-3">
                                            <div className="grid grid-cols-2 gap-2">
                                                <div><span className="block text-xs text-gray-500">Origen</span><span className="font-semibold text-gray-900">{request.origin}</span></div>
                                                <div><span className="block text-xs text-gray-500">Destino</span><span className="font-semibold text-gray-900">{request.destination}</span></div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <span className="block text-xs text-gray-500">Fecha Ida</span>
                                                    <span className="font-medium">{formatToDDMMYYYY(request.departureDate)}</span>
                                                    <span className="text-xs text-gray-400 block">{request.departureTimePreference}</span>
                                                </div>
                                                <div>
                                                    <span className="block text-xs text-gray-500">Fecha Regreso</span>
                                                    <span className="font-medium">{request.returnDate ? formatToDDMMYYYY(request.returnDate) : 'Solo Ida'}</span>
                                                    <span className="text-xs text-gray-400 block">{request.returnTimePreference}</span>
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

                                {/* --- SECTION 2: PASSENGERS & HOTEL --- */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Passengers */}
                                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-100 pb-2">
                                            Pasajeros ({request.passengers.length})
                                        </h4>
                                        <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                                            {request.passengers.map((p, idx) => (
                                                <div key={idx} className="flex flex-col bg-gray-50 p-2 rounded border border-gray-100">
                                                    <span className="font-bold text-gray-800 text-sm">{p.name}</span>
                                                    <span className="text-xs text-gray-500 font-mono">CC: {p.idNumber}</span>
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

                                {/* --- OBSERVATIONS --- */}
                                {request.comments && (
                                    <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-4">
                                        <h4 className="text-xs font-bold text-yellow-800 uppercase tracking-wider mb-2">Observaciones / Notas</h4>
                                        <p className="text-sm text-gray-800 italic">{request.comments}</p>
                                    </div>
                                )}

                                {/* --- RESERVATION INFO (NEW) --- */}
                                {(request.status === RequestStatus.RESERVED || request.status === RequestStatus.PROCESSED) && (
                                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 shadow-sm">
                                        <h4 className="text-sm font-bold text-blue-900 uppercase mb-3 flex items-center gap-2">
                                            <span>✈️</span> Confirmación de Reserva
                                        </h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                                            <div>
                                                <span className="block text-xs text-blue-500 mb-1">Número de Reserva (PNR)</span>
                                                <div className="text-xl font-mono font-bold text-gray-900 tracking-wider">
                                                    {request.reservationNumber || 'N/A'}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                {request.reservationUrl ? (
                                                    <a
                                                        href={request.reservationUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-bold rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                                                    >
                                                        📄 Descargar Tiquetes/Reserva
                                                    </a>
                                                ) : (
                                                    <span className="text-sm text-gray-500 italic">Archivo no disponible</span>
                                                )}
                                            </div>
                                        </div>
                                        {isAdmin && request.creditCard && (
                                            <div className="mt-3 pt-3 border-t border-blue-200">
                                                <span className="block text-xs text-blue-500 mb-1">Tarjeta de Crédito</span>
                                                <div className="text-sm font-mono font-bold text-gray-900 bg-white px-3 py-1.5 rounded border border-blue-100 inline-block">
                                                    💳 {request.creditCard}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

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

                                {/* --- SECTION 4: USER SELECTION INPUT --- */}
                                {isSelectionPhase && (
                                    <div className="bg-yellow-50 p-6 rounded-lg border-2 border-yellow-200 mt-6 shadow-md">
                                        <h4 className="text-lg font-bold text-yellow-800 mb-2">✅ Realice su Selección</h4>
                                        <p className="text-sm text-yellow-700 mb-3">
                                            Revise las imágenes de arriba y escriba detalladamente cuál opción de vuelo {request.requiresHotel ? 'y hotel ' : ''}desea tomar.
                                        </p>

                                        {/* Recordatorio claro de incluir CATEGORÍA */}
                                        <div className="bg-amber-100 border border-amber-300 rounded p-3 mb-4 text-xs text-amber-900 leading-relaxed">
                                            <strong>⚠️ Importante:</strong> indique siempre la <strong>categoría</strong> que elige, no solo la letra de la opción.
                                            <ul className="mt-1 ml-4 list-disc">
                                                <li><strong>Vuelo:</strong> Económica, Economy Plus, Premium, Business...</li>
                                                {request.requiresHotel && <li><strong>Hotel:</strong> Estándar, Superior, Suite...</li>}
                                            </ul>
                                            <div className="mt-2 italic">
                                                Ej: "Opción A vuelo de ida en categoría Económica{request.returnDate ? ', Opción C vuelta en Economy Plus' : ''}{request.requiresHotel ? ', Opción B hotel habitación Estándar' : ''}."
                                            </div>
                                        </div>

                                        <label className="block text-xs font-bold uppercase text-yellow-800 mb-1 tracking-wide">
                                            Su selección (incluya categoría)
                                        </label>
                                        <textarea
                                            className="w-full p-3 border border-yellow-300 rounded focus:ring-2 focus:ring-yellow-500 text-gray-900 bg-white"
                                            rows={4}
                                            placeholder={`Ej: Opción A vuelo de ida en categoría Económica${request.returnDate ? ', Opción C vuelta Economy Plus' : ''}${request.requiresHotel ? ', Opción B hotel habitación Estándar' : ''}...`}
                                            value={userSelectionText}
                                            onChange={(e) => setUserSelectionText(e.target.value)}
                                        />
                                        <div className="mt-4 text-right">
                                            <button
                                                onClick={handleUserSelectionSubmit}
                                                disabled={loading}
                                                className="bg-yellow-600 text-white px-6 py-2 rounded font-bold hover:bg-yellow-700 shadow transition"
                                            >
                                                {loading ? 'Enviando...' : 'Confirmar Selección'}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* --- SECTION 5B: COST CONFIRMATION MESSAGE (USER ONLY) --- */}
                                {isCostPhase && !isAdmin && (
                                    <div className="bg-purple-50 p-6 rounded-lg border-2 border-purple-200 mt-6 shadow-sm">
                                        <h4 className="text-lg font-bold text-purple-900 mb-2">⏳ Confirmación de Costos</h4>
                                        <div className="bg-white p-4 rounded border border-purple-100">
                                            <p className="text-purple-800 font-medium text-sm">
                                                Hemos recibido su selección: <span className="italic">"{request.selectionDetails}"</span>
                                            </p>
                                            <div className="mt-3 text-sm text-gray-600">
                                                El área de compras está confirmando los costos finales con la agencia.
                                                <br />Una vez registrados, se enviará la solicitud a su jefe para aprobación.
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* --- DISPLAY SELECTION & COST IF PAST STAGES --- */}
                                {request.selectionDetails && !isSelectionPhase && (
                                    <div className="bg-white border border-gray-200 rounded p-4 mt-4">
                                        <h4 className="text-sm font-bold text-gray-500 uppercase border-b pb-2 mb-2">Resumen de Selección</h4>
                                        <div className="mb-2">
                                            <span className="block text-xs text-gray-400">Elección Usuario:</span>
                                            <p className="text-sm text-gray-800 italic">"{request.selectionDetails}"</p>
                                        </div>
                                        {(request.totalCost || 0) > 0 ? (
                                            <div className="grid grid-cols-3 gap-2 text-sm bg-gray-50 p-2 rounded">
                                                <div><span className="block text-xs text-gray-400">Tiquetes</span>${request.finalCostTickets?.toLocaleString()}</div>
                                                <div><span className="block text-xs text-gray-400">Hotel</span>${request.finalCostHotel?.toLocaleString()}</div>
                                                <div className="font-bold text-brand-red"><span className="block text-xs text-gray-400 font-normal">Total</span>${request.totalCost?.toLocaleString()}</div>
                                            </div>
                                        ) : null}
                                    </div>
                                )}

                                {/* APPROVAL STATUS SECTION */}
                                <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm mt-4">
                                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 border-b border-gray-100 pb-2">
                                        Estado de Aprobaciones
                                    </h4>

                                    {/* Context banner: explain WHO needs to approve in special cases */}
                                    {request.requesterIsCeo && (
                                        <div className="mb-3 bg-blue-50 border border-blue-200 rounded-md p-2 text-xs text-blue-800">
                                            ℹ️ Como el solicitante es el <strong>CEO</strong>, su sola aprobación es suficiente. No se requiere aprobación de área ni del Director CDS.
                                        </div>
                                    )}
                                    {request.requesterIsCds && (
                                        <div className="mb-3 bg-blue-50 border border-blue-200 rounded-md p-2 text-xs text-blue-800">
                                            ℹ️ Como el solicitante es el <strong>Director CDS</strong>, su sola aprobación es suficiente. No se requiere aprobación de área ni del CEO.
                                        </div>
                                    )}
                                    {!request.requesterIsCeo && !request.requesterIsCds && (request.ceoIsAreaApprover || request.cdsIsAreaApprover) && (
                                        <div className="mb-3 bg-blue-50 border border-blue-200 rounded-md p-2 text-xs text-blue-800">
                                            ℹ️ El aprobador de área de esta solicitud es {request.ceoIsAreaApprover ? 'el CEO' : 'el Director CDS'}. Su click cubre tanto el rol de área como el ejecutivo.
                                        </div>
                                    )}

                                    <div className="flex flex-col">
                                        <ApprovalStatusRow
                                            label={`Aprobador de Área${request.approverName ? ` (${request.approverName})` : ''}`}
                                            effectiveStatus={request.effectiveApprovalArea}
                                            rawStatusString={request.approvalStatusArea}
                                            naReason={request.effectiveApprovalAreaReason}
                                        />
                                        <ApprovalStatusRow
                                            label="Gerencia General (CEO)"
                                            effectiveStatus={request.effectiveApprovalCeo}
                                            rawStatusString={request.approvalStatusCEO}
                                            naReason={request.effectiveApprovalCeoReason}
                                        />
                                        <ApprovalStatusRow
                                            label="Dirección Cadena Suministro"
                                            effectiveStatus={request.effectiveApprovalCds}
                                            rawStatusString={request.approvalStatusCDS}
                                            naReason={request.effectiveApprovalCdsReason}
                                        />
                                    </div>
                                </section>

                            </div>
                        </div>

                        <div className="mt-5 sm:mt-6 border-t pt-4 flex justify-between items-center">
                            {/* MODIFY BUTTON */}
                            {isEditable ? (
                                <button
                                    type="button"
                                    className="inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-orange-600 text-base font-medium text-white hover:bg-orange-700 focus:outline-none sm:text-sm"
                                    onClick={handleModifyClick}
                                >
                                    Solicitar Cambio
                                </button>
                            ) : (
                                <div></div>
                            )}

                            <button
                                type="button"
                                className="inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none sm:text-sm"
                                onClick={onClose}
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};
