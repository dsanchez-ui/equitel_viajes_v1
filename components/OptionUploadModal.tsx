
import React, { useState, useRef } from 'react';
import { Option, TravelRequest, RequestStatus } from '../types';
import { gasService } from '../services/gasService';
import { ConfirmationDialog } from './ConfirmationDialog';

interface OptionUploadModalProps {
    request: TravelRequest;
    onClose: () => void;
    onSuccess: () => void;
}

export const OptionUploadModal = ({ request, onClose, onSuccess }: OptionUploadModalProps) => {
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);

    // State for Options (Images)
    const [options, setOptions] = useState<Option[]>(request.analystOptions || []);
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

    // Helper to generate reliable thumbnail URLs based on Drive ID
    const getThumbnailUrl = (driveId: string) => `https://drive.google.com/thumbnail?id=${driveId}&sz=w1000`;

    // Reusable function to process a File object (from Input or Paste)
    const processFile = (file: File, type: 'FLIGHT' | 'HOTEL') => {
        setUploading(true);

        const reader = new FileReader();
        reader.onload = async () => {
            const base64String = (reader.result as string).split(',')[1];

            // Calculate next letter based on count OF THIS SPECIFIC TYPE
            // This ensures we have Option A for Flight and Option A for Hotel independently
            const existingTypeOptions = options.filter(o => o.type === type);
            const nextLetter = String.fromCharCode(65 + existingTypeOptions.length); // 65 is 'A'

            try {
                const newOption = await gasService.uploadOptionImage(
                    request.requestId,
                    base64String,
                    file.name,
                    type,
                    nextLetter
                );
                setOptions(prev => [...prev, newOption]);
            } catch (err) {
                setDialog({
                    isOpen: true,
                    title: 'Error de Carga',
                    message: 'No se pudo subir la imagen: ' + err,
                    type: 'ALERT',
                    onConfirm: closeDialog
                });
            } finally {
                setUploading(false);
                // Clear input just in case
                if (type === 'FLIGHT' && flightInputRef.current) flightInputRef.current.value = '';
                if (type === 'HOTEL' && hotelInputRef.current) hotelInputRef.current.value = '';
            }
        };
        reader.readAsDataURL(file);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'FLIGHT' | 'HOTEL') => {
        if (!e.target.files || e.target.files.length === 0) return;
        processFile(e.target.files[0], type);
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>, type: 'FLIGHT' | 'HOTEL') => {
        // Prevent default behavior to avoid pasting text if any
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
            // If the pasted image doesn't have a name (common in screenshots), give it a generic one
            const fileName = blob.name || `screenshot_${Date.now()}.png`;
            // Create a new File object to ensure name property exists if blob was just a blob
            const fileToUpload = new File([blob], fileName, { type: blob.type });
            processFile(fileToUpload, type);
        } else {
            // Optional: Feedback if no image found
            console.log("No image found in clipboard");
        }
    };

    const removeOption = async (index: number) => {
        const optionToRemove = options[index];
        if (!optionToRemove) return;

        setDeletingId(optionToRemove.id);
        try {
            // Delete from Drive via backend
            await gasService.deleteOptionFile(optionToRemove.driveId);
            // Remove from local state
            setOptions(options.filter((_, i) => i !== index));
        } catch (err) {
            setDialog({
                isOpen: true,
                title: 'Error al eliminar',
                message: 'No se pudo eliminar el archivo de Drive: ' + err,
                type: 'ALERT',
                onConfirm: closeDialog
            });
        } finally {
            setDeletingId(null);
        }
    };

    const handleSubmit = () => {
        if (options.length === 0) {
            setDialog({
                isOpen: true,
                title: 'Sin Opciones',
                message: 'Debe cargar al menos una imagen (vuelo u hotel) para continuar.',
                type: 'ALERT',
                onConfirm: closeDialog
            });
            return;
        }

        setDialog({
            isOpen: true,
            title: 'Enviar Opciones',
            message: `Se enviarán ${options.length} opciones visuales al usuario.\n\nEl usuario recibirá un correo con las imágenes y deberá ingresar a la plataforma para describir su elección.`,
            type: 'CONFIRM',
            onConfirm: executeSubmission,
            onCancel: closeDialog
        });
    };

    const executeSubmission = async () => {
        closeDialog();
        setLoading(true);
        try {
            await gasService.updateRequestStatus(request.requestId, RequestStatus.PENDING_SELECTION, {
                analystOptions: options
            });

            setDialog({
                isOpen: true,
                title: 'Envío Exitoso',
                message: 'Las opciones han sido enviadas al usuario correctamente.',
                type: 'SUCCESS',
                onConfirm: () => {
                    closeDialog();
                    onSuccess();
                }
            });
        } catch (e) {
            setDialog({
                isOpen: true,
                title: 'Error',
                message: 'Error guardando opciones: ' + e,
                type: 'ALERT',
                onConfirm: closeDialog
            });
        } finally {
            setLoading(false);
        }
    };

    // Helper to get counts for UI
    const flightCount = options.filter(o => o.type === 'FLIGHT').length;
    const hotelCount = options.filter(o => o.type === 'HOTEL').length;

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
                            <button onClick={onClose} className="bg-white rounded-md text-gray-400 hover:text-gray-500 text-2xl font-bold leading-none px-2 focus:outline-none">✕</button>
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
                                    <h4 className="text-sm font-bold text-blue-800 mb-2">✈️ Agregar Opción Vuelo</h4>
                                    <p className="text-xs text-blue-600 mb-1">Suba capturas o pegue recortes (Ctrl+V) aquí.</p>
                                    <p className="text-[10px] text-blue-400 mb-3 italic">(Siguiente letra: {String.fromCharCode(65 + flightCount)})</p>

                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
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
                                <div
                                    tabIndex={0}
                                    onPaste={(e) => handlePaste(e, 'HOTEL')}
                                    className="bg-green-50 p-4 rounded-lg border-2 border-dashed border-green-200 text-center outline-none focus:ring-2 focus:ring-green-400 focus:bg-green-100 transition-colors cursor-pointer group relative"
                                    title="Haga clic aquí y presione Ctrl+V para pegar"
                                >
                                    <h4 className="text-sm font-bold text-green-800 mb-2">🏨 Agregar Opción Hotel</h4>
                                    <p className="text-xs text-green-600 mb-1">Suba capturas o pegue recortes (Ctrl+V) aquí.</p>
                                    <p className="text-[10px] text-green-400 mb-3 italic">(Siguiente letra: {String.fromCharCode(65 + hotelCount)})</p>

                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
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

                                <div className="bg-gray-50 p-3 rounded border text-xs text-gray-500">
                                    <p><strong>Tip:</strong> Puede usar <kbd className="bg-gray-200 px-1 rounded">Win</kbd>+<kbd className="bg-gray-200 px-1 rounded">Shift</kbd>+<kbd className="bg-gray-200 px-1 rounded">S</kbd> para recortar pantalla, luego haga clic en el recuadro deseado y presione <kbd className="bg-gray-200 px-1 rounded">Ctrl</kbd>+<kbd className="bg-gray-200 px-1 rounded">V</kbd>.</p>
                                </div>
                            </div>

                            {/* PREVIEW GALLERY */}
                            <div className="lg:w-2/3 bg-gray-100 p-4 rounded-lg overflow-y-auto">
                                <h4 className="text-sm font-bold text-gray-700 mb-4 uppercase">Galería de Opciones Cargadas ({options.length})</h4>

                                {options.length === 0 && (
                                    <div className="flex items-center justify-center h-40 text-gray-400">
                                        <p>No hay imágenes cargadas aún.</p>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {options.map((opt, idx) => (
                                        <div key={idx} className="bg-white p-2 rounded shadow relative group">
                                            <div className="absolute top-2 left-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
                                                {opt.type === 'FLIGHT' ? '✈️ Vuelo' : '🏨 Hotel'} - {opt.id}
                                            </div>
                                            <button
                                                onClick={() => removeOption(idx)}
                                                disabled={deletingId === opt.id}
                                                className={`absolute top-2 right-2 bg-red-600 text-white w-6 h-6 rounded-full flex items-center justify-center font-bold opacity-0 group-hover:opacity-100 transition shadow disabled:opacity-50`}
                                                title="Eliminar"
                                            >
                                                {deletingId === opt.id ? '...' : '✕'}
                                            </button>
                                            {/* Use constructed thumbnail URL for reliability */}
                                            <img src={getThumbnailUrl(opt.driveId)} alt={`Opción ${opt.id}`} className="w-full h-40 object-cover rounded mb-2 border" />
                                            <p className="text-xs text-gray-500 truncate" title={opt.name}>{opt.name}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end gap-3 border-t pt-4">
                            <button onClick={onClose} className="px-4 py-2 border rounded text-gray-700 bg-white hover:bg-gray-50">Cancelar</button>
                            <button onClick={handleSubmit} disabled={loading || options.length === 0} className="px-4 py-2 bg-brand-red text-white rounded font-bold hover:bg-red-700 disabled:opacity-50">
                                {loading ? 'Enviando...' : 'Confirmar y Enviar'}
                            </button>
                        </div>

                    </div>
                </div>
            </div>
        </>
    );
};
