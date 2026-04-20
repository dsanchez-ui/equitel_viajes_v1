
import React, { useState, useRef, useEffect } from 'react';
import { Option, TravelRequest, RequestStatus } from '../types';
import { gasService } from '../services/gasService';
import { ConfirmationDialog } from './ConfirmationDialog';

interface PendingOption {
    tempId: string;
    type: 'FLIGHT' | 'HOTEL';
    direction?: 'IDA' | 'VUELTA';
    localPreview: string;
    base64Data: string;
    fileName: string;
    letter: string;
}

interface OptionUploadModalProps {
    request: TravelRequest;
    onClose: () => void;
    onSuccess: () => void;
}

export const OptionUploadModal = ({ request, onClose, onSuccess }: OptionUploadModalProps) => {
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);

    // #A40: evitar cerrar durante upload/guardado. Si ESC o click fuera ocurre
    // mientras hay archivos subiendo a Drive, quedarían huérfanos sin
    // referencia en OPCIONES (JSON). handleClose es el único punto de salida.
    const handleClose = () => {
      if (uploading || loading) {
        if (!window.confirm('Hay operaciones en curso. Si cierras ahora, archivos parciales podrían quedar en Drive. ¿Cerrar de todos modos?')) return;
      }
      onClose();
    };

    useEffect(() => {
      const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uploading, loading]);
    const [flightDirection, setFlightDirection] = useState<'IDA' | 'VUELTA'>('IDA');
    const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

    // Confirmed options: already in Drive (loaded from backend).
    // Filtramos nulls/undefined defensivamente por si el array en DB tiene restos.
    const [confirmedOptions, setConfirmedOptions] = useState<Option[]>(
        (request.analystOptions || []).filter((o): o is Option => !!o && typeof o === 'object')
    );
    // Pending options: local only, not yet in Drive
    const [pendingOptions, setPendingOptions] = useState<PendingOption[]>([]);
    // Marked-for-deletion driveIds: NO se borran de Drive hasta que el usuario
    // confirme. Si cancela el modal, no se ejecuta ningún borrado. Esto evita
    // el bug anterior donde click en X borraba inmediatamente y dejaba el modal
    // en estado inconsistente.
    const [markedForDeletion, setMarkedForDeletion] = useState<Set<string>>(new Set());

    // R8b: Notificar al usuario por correo con las opciones. Default ON.
    // Cuando el admin gestionó la compra por fuera (caso ejecutivos prioritarios),
    // carga las opciones solo para trazabilidad — desmarcarlo evita el correo
    // "seleccione opción" Y salta directo a PENDIENTE_CONFIRMACION_COSTO sin
    // esperar la selección del usuario (él ya tiene los tiquetes).
    const [sendUserNotification, setSendUserNotification] = useState(true);

    const flightInputRef = useRef<HTMLInputElement>(null);
    const hotelInputRef = useRef<HTMLInputElement>(null);

    const [dialog, setDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: 'ALERT' | 'CONFIRM' | 'SUCCESS';
        onConfirm: () => void;
        onCancel?: () => void;
    }>({ isOpen: false, title: '', message: '', type: 'ALERT', onConfirm: () => { } });

    const closeDialog = () => setDialog(prev => ({ ...prev, isOpen: false }));

    const getDriveImageUrl = (driveId: string) => `https://drive.google.com/uc?export=view&id=${driveId}`;

    // Count all options of a type (confirmed-no-deleted + pending) for letter assignment
    const getNextLetter = (type: 'FLIGHT' | 'HOTEL') => {
        const confirmedCount = confirmedOptions.filter(o => o.type === type && !markedForDeletion.has(o.driveId)).length;
        const pendingCount = pendingOptions.filter(o => o.type === type).length;
        return String.fromCharCode(65 + confirmedCount + pendingCount);
    };

    // Store image locally (NO Drive upload)
    // FIX (#A9): tamaño + MIME validados frontend-side ANTES de leer a base64
    // (leer 50MB a memoria tumba la pestaña). Backend también valida, esto es
    // feedback inmediato y defensivo. Consistente con SupportUploadModal.
    const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
    const processFile = (file: File, type: 'FLIGHT' | 'HOTEL') => {
        if (file.size > MAX_FILE_SIZE_BYTES) {
            alert('Archivo demasiado grande (máximo 10 MB). Tamaño actual: ' + (file.size / 1024 / 1024).toFixed(1) + ' MB.');
            return;
        }
        if (file.type && !file.type.startsWith('image/')) {
            alert('Solo se aceptan imágenes (PNG, JPEG, GIF, WebP). Tipo recibido: ' + file.type);
            return;
        }
        setUploading(true);
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result as string;
            const base64String = dataUrl.split(',')[1];
            const letter = getNextLetter(type);

            const pending: PendingOption = {
                tempId: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                type,
                direction: type === 'FLIGHT' ? flightDirection : undefined,
                localPreview: dataUrl,
                base64Data: base64String,
                fileName: file.name || `screenshot_${Date.now()}.png`,
                letter,
            };
            setPendingOptions(prev => [...prev, pending]);
            setUploading(false);

            if (type === 'FLIGHT' && flightInputRef.current) flightInputRef.current.value = '';
            if (type === 'HOTEL' && hotelInputRef.current) hotelInputRef.current.value = '';
        };
        reader.readAsDataURL(file);
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'FLIGHT' | 'HOTEL') => {
        if (!e.target.files || e.target.files.length === 0) return;
        processFile(e.target.files[0], type);
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>, type: 'FLIGHT' | 'HOTEL') => {
        e.preventDefault();
        if (uploading) return;

        const items = e.clipboardData.items;
        let blob: File | null = null;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                blob = items[i].getAsFile();
                break;
            }
        }

        if (blob) {
            const fileName = blob.name || `screenshot_${Date.now()}.png`;
            const fileToUpload = new File([blob], fileName, { type: blob.type });
            processFile(fileToUpload, type);
        }
    };

    // Marca una opción confirmada para borrado (LOCAL ONLY, no toca Drive todavía)
    // Si el usuario cancela el modal, NO se borra nada de Drive.
    const toggleConfirmedDeletion = (driveId: string) => {
        setMarkedForDeletion(prev => {
            const next = new Set(prev);
            if (next.has(driveId)) next.delete(driveId);
            else next.add(driveId);
            return next;
        });
    };

    // Delete a pending option (local only, nothing to clean up)
    const removePendingOption = (index: number) => {
        setPendingOptions(prev => prev.filter((_, i) => i !== index));
    };

    // Total visible (excluyendo las marcadas para borrar)
    const visibleConfirmedCount = confirmedOptions.filter(o => !markedForDeletion.has(o.driveId)).length;
    const totalCount = visibleConfirmedCount + pendingOptions.length;

    const handleSubmit = () => {
        if (totalCount === 0) {
            setDialog({
                isOpen: true, title: 'Sin Opciones',
                message: 'Debe cargar al menos una imagen (vuelo u hotel) para continuar.',
                type: 'ALERT', onConfirm: closeDialog
            });
            return;
        }

        // R8b: si se desmarcó "Enviar al usuario", exigir confirmación EXTRA
        // con advertencia antes del confirm normal.
        if (!sendUserNotification) {
            setDialog({
                isOpen: true,
                title: '⚠️ El usuario NO recibirá correo automático',
                message: 'Desmarcaste "Enviar correo al usuario". Se guardarán las opciones SOLO para trazabilidad y la solicitud avanzará directamente a PENDIENTE DE CONFIRMACIÓN DE COSTOS sin esperar la selección del usuario.\n\n⚠️ Úsalo solo cuando los tiquetes/hotel ya fueron gestionados por fuera del sistema. El usuario NO sabrá que estas opciones están cargadas.\n\n¿Continuar sin notificar al usuario?',
                type: 'CONFIRM',
                onConfirm: () => { closeDialog(); promptFinalConfirm(); },
                onCancel: closeDialog
            });
            return;
        }

        promptFinalConfirm();
    };

    const promptFinalConfirm = () => {
        const deleteCount = markedForDeletion.size;
        const uploadCount = pendingOptions.length;
        const summaryParts = [];
        if (uploadCount > 0) summaryParts.push(`${uploadCount} nueva(s)`);
        if (deleteCount > 0) summaryParts.push(`${deleteCount} eliminada(s)`);
        const summary = summaryParts.length > 0
            ? `Cambios pendientes: ${summaryParts.join(' y ')}.\n\n`
            : '';

        const message = sendUserNotification
            ? `${summary}Se enviarán ${totalCount} opciones visuales al usuario.\n\nEl usuario recibirá un correo con las imágenes y deberá ingresar a la plataforma para describir su elección.`
            : `${summary}Se guardarán ${totalCount} opciones SOLO para trazabilidad (SIN correo al usuario). La solicitud avanzará directamente a PENDIENTE DE CONFIRMACIÓN DE COSTOS.`;

        setDialog({
            isOpen: true,
            title: sendUserNotification ? 'Enviar Opciones' : 'Guardar Opciones (sin notificar)',
            message: message,
            type: 'CONFIRM', onConfirm: executeSubmission, onCancel: closeDialog
        });
    };

    const executeSubmission = async () => {
        closeDialog();
        setLoading(true);
        try {
            // 1. Aplicar borrados marcados (Drive trash). Errores se loggean
            //    pero no abortan el flujo — el archivo huérfano en Drive es
            //    inofensivo y el siguiente updateRequestStatus reescribirá el
            //    JSON de opciones sin la referencia.
            const deletionErrors: string[] = [];
            for (const driveId of markedForDeletion) {
                try {
                    await gasService.deleteOptionFile(driveId);
                } catch (err) {
                    deletionErrors.push(`${driveId}: ${err}`);
                    console.error('Error eliminando opción del Drive:', driveId, err);
                }
            }

            // 2. Upload all pending options to Drive
            const uploadedOptions: Option[] = [];
            for (const pending of pendingOptions) {
                const uploaded = await gasService.uploadOptionImage(
                    request.requestId,
                    pending.base64Data,
                    pending.fileName,
                    pending.type,
                    pending.letter,
                    pending.direction
                );
                // Defensa: nunca pushear null/undefined al array. Si el backend
                // responde algo inválido, lo ignoramos en vez de contaminar el JSON.
                if (uploaded && typeof uploaded === 'object') {
                    uploadedOptions.push(uploaded);
                }
            }

            // 3. Combine confirmed-survivors + newly uploaded (doble filtro defensivo)
            const survivors = confirmedOptions
                .filter((o): o is Option => !!o && typeof o === 'object')
                .filter(o => !markedForDeletion.has(o.driveId));
            const allOptions = [...survivors, ...uploadedOptions];

            // 4. Update request status — siempre pasa primero por PENDING_SELECTION
            // para que el backend persista las opciones. El flag skipNotification
            // le dice al backend que NO envíe correo al usuario en este paso.
            // Si no se notifica, hacemos un segundo update inmediato a
            // PENDING_CONFIRMACION_COSTO para que el admin continúe con costos.
            await gasService.updateRequestStatus(request.requestId, RequestStatus.PENDING_SELECTION, {
                analystOptions: allOptions,
                skipNotification: !sendUserNotification
            });

            if (!sendUserNotification) {
                // Avanza a PENDIENTE_CONFIRMACION_COSTO con un texto de selección
                // sintético para trazabilidad (refleja que la selección fue implícita
                // por gestión off-system).
                await gasService.updateRequestStatus(request.requestId, RequestStatus.PENDING_CONFIRMACION_COSTO, {
                    selectionDetails: '[OPCIONES CARGADAS SOLO POR TRAZABILIDAD — gestión fuera del sistema]'
                });
            }

            const baseMsg = sendUserNotification
                ? 'Las opciones han sido enviadas al usuario correctamente.'
                : 'Opciones guardadas solo para trazabilidad. La solicitud avanzó a PENDIENTE DE CONFIRMACIÓN DE COSTOS. No se envió correo al usuario.';
            const successMsg = deletionErrors.length > 0
                ? `${baseMsg}\n\nNota: ${deletionErrors.length} archivo(s) en Drive no se pudieron eliminar (referencia ya removida del registro, los huérfanos son inofensivos).`
                : baseMsg;

            setDialog({
                isOpen: true, title: 'Envío Exitoso',
                message: successMsg,
                type: 'SUCCESS',
                onConfirm: () => { closeDialog(); onSuccess(); }
            });
        } catch (e) {
            setDialog({
                isOpen: true, title: 'Error',
                message: 'Error subiendo opciones: ' + e,
                type: 'ALERT', onConfirm: closeDialog
            });
        } finally {
            setLoading(false);
        }
    };

    const flightCount = confirmedOptions.filter(o => o.type === 'FLIGHT' && !markedForDeletion.has(o.driveId)).length + pendingOptions.filter(o => o.type === 'FLIGHT').length;
    const hotelCount = confirmedOptions.filter(o => o.type === 'HOTEL' && !markedForDeletion.has(o.driveId)).length + pendingOptions.filter(o => o.type === 'HOTEL').length;

    return (
        <>
            <ConfirmationDialog
                isOpen={dialog.isOpen}
                title={dialog.title}
                message={dialog.message}
                onConfirm={dialog.onConfirm}
                onCancel={dialog.onCancel}
                type={dialog.type}
            />

            <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={handleClose}></div>
                    <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>

                    <div className="relative inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-5xl sm:w-full sm:p-6">
                        <div className="absolute top-0 right-0 pt-4 pr-4 z-10">
                            <button onClick={handleClose} className="bg-white rounded-md text-gray-400 hover:text-gray-500 text-2xl font-bold leading-none px-2 focus:outline-none">&times;</button>
                        </div>

                        <h3 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2">
                            Cargar Opciones Visuales - <span className="text-brand-red">{request.requestId}</span>
                        </h3>

                        <div className="flex flex-col lg:flex-row gap-6 h-[70vh]">

                            {/* UPLOAD ZONES */}
                            <div className="lg:w-1/3 space-y-6 overflow-y-auto pr-2">

                                {/* FLIGHT DROPZONE — hidden for hotel-only requests */}
                                {request.requestMode !== 'HOTEL_ONLY' && (<div
                                    tabIndex={0}
                                    onPaste={(e) => handlePaste(e, 'FLIGHT')}
                                    className="bg-blue-50 p-4 rounded-lg border-2 border-dashed border-blue-200 text-center outline-none focus:ring-2 focus:ring-blue-400 focus:bg-blue-100 transition-colors cursor-pointer group relative"
                                    title="Haga clic aquí y presione Ctrl+V para pegar"
                                >
                                    <h4 className="text-sm font-bold text-blue-800 mb-2">Agregar Opcion Vuelo</h4>

                                    <div className="flex justify-center gap-2 mb-3">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setFlightDirection('IDA'); }}
                                            className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${flightDirection === 'IDA' ? 'bg-amber-400 text-white shadow-sm scale-105' : 'bg-white text-gray-400 border border-gray-200'}`}
                                        >
                                            IDA (Amarillo)
                                        </button>
                                        {request.returnDate && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setFlightDirection('VUELTA'); }}
                                                className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${flightDirection === 'VUELTA' ? 'bg-green-500 text-white shadow-sm scale-105' : 'bg-white text-gray-400 border border-gray-200'}`}
                                            >
                                                VUELTA (Verde)
                                            </button>
                                        )}
                                    </div>

                                    <p className="text-xs text-blue-600 mb-1">Suba capturas o pegue recortes (Ctrl+V) aquí.</p>
                                    <p className="text-[10px] text-blue-400 mb-3 italic">(Siguiente letra: {String.fromCharCode(65 + flightCount)})</p>

                                    <input
                                        type="file" accept="image/*" className="hidden"
                                        ref={flightInputRef}
                                        onChange={(e) => handleFileUpload(e, 'FLIGHT')}
                                        disabled={uploading}
                                    />
                                    <button
                                        onClick={() => flightInputRef.current?.click()}
                                        disabled={uploading}
                                        className="bg-blue-600 text-white px-4 py-2 rounded text-xs font-bold hover:bg-blue-700 disabled:opacity-50 z-10 relative"
                                    >
                                        {uploading ? 'Procesando...' : 'Seleccionar Imagen'}
                                    </button>
                                </div>)}

                                {/* HOTEL DROPZONE — always shown for hotel-only, conditional for flights */}
                                {(request.requiresHotel || request.requestMode === 'HOTEL_ONLY') && (
                                    <div
                                        tabIndex={0}
                                        onPaste={(e) => handlePaste(e, 'HOTEL')}
                                        className="bg-green-50 p-4 rounded-lg border-2 border-dashed border-green-200 text-center outline-none focus:ring-2 focus:ring-green-400 focus:bg-green-100 transition-colors cursor-pointer group relative"
                                        title="Haga clic aquí y presione Ctrl+V para pegar"
                                    >
                                        <h4 className="text-sm font-bold text-green-800 mb-2">Agregar Opcion Hotel</h4>
                                        <p className="text-xs text-green-600 mb-1">Suba capturas o pegue recortes (Ctrl+V) aquí.</p>
                                        <p className="text-[10px] text-green-400 mb-3 italic">(Siguiente letra: {String.fromCharCode(65 + hotelCount)})</p>

                                        <input
                                            type="file" accept="image/*" className="hidden"
                                            ref={hotelInputRef}
                                            onChange={(e) => handleFileUpload(e, 'HOTEL')}
                                            disabled={uploading}
                                        />
                                        <button
                                            onClick={() => hotelInputRef.current?.click()}
                                            disabled={uploading}
                                            className="bg-green-600 text-white px-4 py-2 rounded text-xs font-bold hover:bg-green-700 disabled:opacity-50 z-10 relative"
                                        >
                                            {uploading ? 'Procesando...' : 'Seleccionar Imagen'}
                                        </button>
                                    </div>
                                )}

                                <div className="bg-gray-50 p-3 rounded border text-xs text-gray-500">
                                    <p><strong>Tip:</strong> Puede usar <kbd className="bg-gray-200 px-1 rounded">Win</kbd>+<kbd className="bg-gray-200 px-1 rounded">Shift</kbd>+<kbd className="bg-gray-200 px-1 rounded">S</kbd> para recortar pantalla, luego haga clic en el recuadro deseado y presione <kbd className="bg-gray-200 px-1 rounded">Ctrl</kbd>+<kbd className="bg-gray-200 px-1 rounded">V</kbd>.</p>
                                </div>
                            </div>

                            {/* PREVIEW GALLERY */}
                            <div className="lg:w-2/3 bg-gray-100 p-4 rounded-lg overflow-y-auto">
                                <h4 className="text-sm font-bold text-gray-700 mb-4 uppercase">Galería de Opciones ({totalCount})</h4>

                                {totalCount === 0 && (
                                    <div className="flex items-center justify-center h-40 text-gray-400">
                                        <p>No hay imágenes cargadas aún.</p>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {/* CONFIRMED OPTIONS (already in Drive). Las marcadas para borrar se muestran tachadas con botón Restaurar. El borrado real solo ocurre en Confirmar y Enviar. */}
                                    {confirmedOptions.map((opt, idx) => {
                                        const isMarkedForDelete = markedForDeletion.has(opt.driveId);
                                        return (
                                        <div
                                            key={`confirmed-${idx}`}
                                            className={`p-2 rounded shadow relative group border-2 ${isMarkedForDelete ? 'bg-red-50 border-red-300 opacity-60' :
                                                opt.type === 'HOTEL' ? 'bg-white border-transparent' :
                                                opt.direction === 'VUELTA' ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
                                                }`}
                                        >
                                            <div className="absolute top-2 left-2 flex gap-1 z-[1]">
                                                <div className="bg-black bg-opacity-70 text-white text-[10px] px-2 py-1 rounded">
                                                    {opt.type === 'FLIGHT' ? 'Vuelo' : 'Hotel'} - {opt.id}
                                                </div>
                                                {opt.type === 'FLIGHT' && (
                                                    <div className={`text-white text-[10px] px-2 py-1 rounded font-bold ${opt.direction === 'VUELTA' ? 'bg-green-600' : 'bg-amber-500'}`}>
                                                        {opt.direction === 'VUELTA' ? 'VUELTA' : 'IDA'}
                                                    </div>
                                                )}
                                                {isMarkedForDelete && (
                                                    <div className="bg-red-600 text-white text-[10px] px-2 py-1 rounded font-bold">
                                                        SE ELIMINARÁ
                                                    </div>
                                                )}
                                            </div>
                                            {isMarkedForDelete ? (
                                                <button
                                                    onClick={() => toggleConfirmedDeletion(opt.driveId)}
                                                    className="absolute top-2 right-2 bg-blue-600 text-white text-[10px] px-2 py-1 rounded font-bold opacity-100 transition shadow z-[1] hover:bg-blue-700"
                                                    title="Restaurar (no eliminar)"
                                                >
                                                    ↺ Restaurar
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => toggleConfirmedDeletion(opt.driveId)}
                                                    className="absolute top-2 right-2 bg-red-600 text-white w-6 h-6 rounded-full flex items-center justify-center font-bold opacity-0 group-hover:opacity-100 transition shadow z-[1]"
                                                    title="Marcar para eliminar (reversible hasta confirmar)"
                                                >
                                                    {'\u00d7'}
                                                </button>
                                            )}
                                            <img
                                                src={getDriveImageUrl(opt.driveId)}
                                                alt={`Opción ${opt.id}`}
                                                className={`w-full h-40 object-cover rounded mb-2 border border-white cursor-pointer ${isMarkedForDelete ? 'grayscale' : ''}`}
                                                referrerPolicy="no-referrer"
                                                onClick={() => !isMarkedForDelete && setPreviewImageUrl(`https://drive.google.com/thumbnail?id=${opt.driveId}&sz=w2000`)}
                                                title="Click para ver imagen completa"
                                                onError={(e) => {
                                                    const img = e.currentTarget;
                                                    if (!img.dataset.retried) {
                                                        img.dataset.retried = '1';
                                                        img.src = `https://drive.google.com/thumbnail?id=${opt.driveId}&sz=w1000`;
                                                    }
                                                }}
                                            />
                                            <p className={`text-xs truncate ${isMarkedForDelete ? 'text-red-600 line-through' : 'text-gray-500'}`} title={opt.name}>{opt.name}</p>
                                        </div>
                                        );
                                    })}

                                    {/* PENDING OPTIONS (local only, not in Drive yet) */}
                                    {pendingOptions.map((pending, idx) => (
                                        <div
                                            key={`pending-${pending.tempId}`}
                                            className={`p-2 rounded shadow relative group border-2 border-dashed ${pending.type === 'HOTEL' ? 'bg-white border-green-300' :
                                                pending.direction === 'VUELTA' ? 'bg-green-50 border-green-300' : 'bg-amber-50 border-amber-300'
                                                }`}
                                        >
                                            <div className="absolute top-2 left-2 flex gap-1 z-[1]">
                                                <div className="bg-black bg-opacity-70 text-white text-[10px] px-2 py-1 rounded">
                                                    {pending.type === 'FLIGHT' ? 'Vuelo' : 'Hotel'} - {pending.letter}
                                                </div>
                                                {pending.type === 'FLIGHT' && (
                                                    <div className={`text-white text-[10px] px-2 py-1 rounded font-bold ${pending.direction === 'VUELTA' ? 'bg-green-600' : 'bg-amber-500'}`}>
                                                        {pending.direction === 'VUELTA' ? 'VUELTA' : 'IDA'}
                                                    </div>
                                                )}
                                                <div className="bg-yellow-500 text-white text-[10px] px-2 py-1 rounded font-bold">
                                                    PENDIENTE
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => removePendingOption(idx)}
                                                className="absolute top-2 right-2 bg-red-600 text-white w-6 h-6 rounded-full flex items-center justify-center font-bold opacity-0 group-hover:opacity-100 transition shadow z-[1]"
                                                title="Quitar"
                                            >
                                                &times;
                                            </button>
                                            <img
                                                src={pending.localPreview}
                                                alt={`Opción ${pending.letter}`}
                                                className="w-full h-40 object-cover rounded mb-2 border border-white cursor-pointer"
                                                onClick={() => setPreviewImageUrl(pending.localPreview)}
                                                title="Click para ver imagen completa"
                                            />
                                            <p className="text-xs text-gray-400 truncate italic">Sin confirmar</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Checkbox R8b: enviar correo de selección al usuario */}
                        <div className={`mt-5 rounded p-3 border ${sendUserNotification ? 'bg-gray-50 border-gray-200' : 'bg-amber-50 border-amber-300'}`}>
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={sendUserNotification}
                                    onChange={(e) => setSendUserNotification(e.target.checked)}
                                    disabled={loading}
                                    className="mt-1 w-4 h-4 accent-brand-red flex-shrink-0"
                                />
                                <span className="text-sm text-gray-800 flex-1">
                                    <strong>Enviar correo al usuario</strong> para que revise las opciones y seleccione.
                                    {!sendUserNotification && (
                                        <span className="block mt-1 text-xs text-amber-800 font-medium">
                                            ⚠️ Desmarcado: las opciones se guardan solo para trazabilidad. La solicitud avanzará directamente a PENDIENTE DE CONFIRMACIÓN DE COSTOS sin esperar selección del usuario.
                                        </span>
                                    )}
                                </span>
                            </label>
                        </div>

                        <div className="mt-6 flex justify-end gap-3 border-t pt-4">
                            <button onClick={handleClose} className="px-4 py-2 border rounded text-gray-700 bg-white hover:bg-gray-50">Cancelar</button>
                            <button onClick={handleSubmit} disabled={loading || totalCount === 0} className="px-4 py-2 bg-brand-red text-white rounded font-bold hover:bg-red-700 disabled:opacity-50">
                                {loading ? `Subiendo (${pendingOptions.length} imágenes)...` : 'Confirmar y Enviar'}
                            </button>
                        </div>

                    </div>
                </div>
            </div>

            {/* LIGHTBOX: imagen completa al hacer click */}
            {previewImageUrl && (
                <div
                    className="fixed inset-0 z-[60] bg-black bg-opacity-80 flex items-center justify-center p-4 cursor-pointer"
                    onClick={() => setPreviewImageUrl(null)}
                >
                    <div className="relative max-w-[95vw] max-h-[95vh]">
                        <button
                            onClick={() => setPreviewImageUrl(null)}
                            className="absolute -top-3 -right-3 bg-white text-gray-800 w-8 h-8 rounded-full flex items-center justify-center font-bold shadow-lg hover:bg-gray-100 z-10 text-lg"
                        >&times;</button>
                        <img
                            src={previewImageUrl}
                            alt="Vista completa"
                            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
                            referrerPolicy="no-referrer"
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                </div>
            )}
        </>
    );
};
