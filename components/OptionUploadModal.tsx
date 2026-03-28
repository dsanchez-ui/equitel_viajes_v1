
import React, { useState, useRef } from 'react';
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
    const [flightDirection, setFlightDirection] = useState<'IDA' | 'VUELTA'>('IDA');

    // Confirmed options: already in Drive (loaded from backend)
    const [confirmedOptions, setConfirmedOptions] = useState<Option[]>(request.analystOptions || []);
    // Pending options: local only, not yet in Drive
    const [pendingOptions, setPendingOptions] = useState<PendingOption[]>([]);

    const [deletingId, setDeletingId] = useState<string | null>(null);

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

    const closeDialog = () => setDialog({ ...dialog, isOpen: false });

    const getDriveImageUrl = (driveId: string) => `https://drive.google.com/uc?export=view&id=${driveId}`;

    // Count all options of a type (confirmed + pending) for letter assignment
    const getNextLetter = (type: 'FLIGHT' | 'HOTEL') => {
        const confirmedCount = confirmedOptions.filter(o => o.type === type).length;
        const pendingCount = pendingOptions.filter(o => o.type === type).length;
        return String.fromCharCode(65 + confirmedCount + pendingCount);
    };

    // Store image locally (NO Drive upload)
    const processFile = (file: File, type: 'FLIGHT' | 'HOTEL') => {
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

    // Delete a confirmed option (already in Drive)
    const removeConfirmedOption = async (index: number) => {
        const opt = confirmedOptions[index];
        if (!opt) return;
        setDeletingId(opt.id);
        try {
            await gasService.deleteOptionFile(opt.driveId);
            setConfirmedOptions(prev => prev.filter((_, i) => i !== index));
        } catch (err) {
            setDialog({
                isOpen: true, title: 'Error al eliminar',
                message: 'No se pudo eliminar el archivo de Drive: ' + err,
                type: 'ALERT', onConfirm: closeDialog
            });
        } finally {
            setDeletingId(null);
        }
    };

    // Delete a pending option (local only, nothing to clean up)
    const removePendingOption = (index: number) => {
        setPendingOptions(prev => prev.filter((_, i) => i !== index));
    };

    const totalCount = confirmedOptions.length + pendingOptions.length;

    const handleSubmit = () => {
        if (totalCount === 0) {
            setDialog({
                isOpen: true, title: 'Sin Opciones',
                message: 'Debe cargar al menos una imagen (vuelo u hotel) para continuar.',
                type: 'ALERT', onConfirm: closeDialog
            });
            return;
        }

        setDialog({
            isOpen: true, title: 'Enviar Opciones',
            message: `Se enviarán ${totalCount} opciones visuales al usuario.\n\nEl usuario recibirá un correo con las imágenes y deberá ingresar a la plataforma para describir su elección.`,
            type: 'CONFIRM', onConfirm: executeSubmission, onCancel: closeDialog
        });
    };

    const executeSubmission = async () => {
        closeDialog();
        setLoading(true);
        try {
            // 1. Upload all pending options to Drive
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
                uploadedOptions.push(uploaded);
            }

            // 2. Combine confirmed + newly uploaded
            const allOptions = [...confirmedOptions, ...uploadedOptions];

            // 3. Update request status with all options
            await gasService.updateRequestStatus(request.requestId, RequestStatus.PENDING_SELECTION, {
                analystOptions: allOptions
            });

            setDialog({
                isOpen: true, title: 'Envío Exitoso',
                message: 'Las opciones han sido enviadas al usuario correctamente.',
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

    const flightCount = confirmedOptions.filter(o => o.type === 'FLIGHT').length + pendingOptions.filter(o => o.type === 'FLIGHT').length;
    const hotelCount = confirmedOptions.filter(o => o.type === 'HOTEL').length + pendingOptions.filter(o => o.type === 'HOTEL').length;

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
                    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose}></div>
                    <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>

                    <div className="relative inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-5xl sm:w-full sm:p-6">
                        <div className="absolute top-0 right-0 pt-4 pr-4 z-10">
                            <button onClick={onClose} className="bg-white rounded-md text-gray-400 hover:text-gray-500 text-2xl font-bold leading-none px-2 focus:outline-none">&times;</button>
                        </div>

                        <h3 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2">
                            Cargar Opciones Visuales - <span className="text-brand-red">{request.requestId}</span>
                        </h3>

                        <div className="flex flex-col lg:flex-row gap-6 h-[70vh]">

                            {/* UPLOAD ZONES */}
                            <div className="lg:w-1/3 space-y-6 overflow-y-auto pr-2">

                                {/* FLIGHT DROPZONE */}
                                <div
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
                                </div>

                                {/* HOTEL DROPZONE */}
                                {request.requiresHotel && (
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
                                    {/* CONFIRMED OPTIONS (already in Drive) */}
                                    {confirmedOptions.map((opt, idx) => (
                                        <div
                                            key={`confirmed-${idx}`}
                                            className={`p-2 rounded shadow relative group border-2 ${opt.type === 'HOTEL' ? 'bg-white border-transparent' :
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
                                            </div>
                                            <button
                                                onClick={() => removeConfirmedOption(idx)}
                                                disabled={deletingId === opt.id}
                                                className="absolute top-2 right-2 bg-red-600 text-white w-6 h-6 rounded-full flex items-center justify-center font-bold opacity-0 group-hover:opacity-100 transition shadow disabled:opacity-50 z-[1]"
                                                title="Eliminar"
                                            >
                                                {deletingId === opt.id ? '...' : '\u00d7'}
                                            </button>
                                            <img
                                                src={getDriveImageUrl(opt.driveId)}
                                                alt={`Opción ${opt.id}`}
                                                className="w-full h-40 object-cover rounded mb-2 border border-white"
                                                referrerPolicy="no-referrer"
                                                onError={(e) => {
                                                    const img = e.currentTarget;
                                                    if (!img.dataset.retried) {
                                                        img.dataset.retried = '1';
                                                        img.src = `https://drive.google.com/thumbnail?id=${opt.driveId}&sz=w1000`;
                                                    }
                                                }}
                                            />
                                            <p className="text-xs text-gray-500 truncate" title={opt.name}>{opt.name}</p>
                                        </div>
                                    ))}

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
                                                className="w-full h-40 object-cover rounded mb-2 border border-white"
                                            />
                                            <p className="text-xs text-gray-400 truncate italic">Sin confirmar</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end gap-3 border-t pt-4">
                            <button onClick={onClose} className="px-4 py-2 border rounded text-gray-700 bg-white hover:bg-gray-50">Cancelar</button>
                            <button onClick={handleSubmit} disabled={loading || totalCount === 0} className="px-4 py-2 bg-brand-red text-white rounded font-bold hover:bg-red-700 disabled:opacity-50">
                                {loading ? `Subiendo (${pendingOptions.length} imágenes)...` : 'Confirmar y Enviar'}
                            </button>
                        </div>

                    </div>
                </div>
            </div>
        </>
    );
};
