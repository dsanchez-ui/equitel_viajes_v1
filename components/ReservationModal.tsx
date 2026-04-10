
import React, { useState, useRef, useEffect } from 'react';
import { TravelRequest } from '../types';
import { gasService } from '../services/gasService';
import { ConfirmationDialog } from './ConfirmationDialog';

interface ReservationModalProps {
    request: TravelRequest;
    onClose: () => void;
    onSuccess: () => void;
}

export const ReservationModal = ({ request, onClose, onSuccess }: ReservationModalProps) => {
    const [loading, setLoading] = useState(false);
    const [reservationNumber, setReservationNumber] = useState('');
    const [creditCard, setCreditCard] = useState('');
    const [creditCards, setCreditCards] = useState<{ value: string, label: string }[]>([]);
    const [loadingCards, setLoadingCards] = useState(true);
    const [files, setFiles] = useState<File[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [dialog, setDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: 'ALERT' | 'CONFIRM' | 'SUCCESS';
        onConfirm: () => void;
        onCancel?: () => void;
    }>({ isOpen: false, title: '', message: '', type: 'ALERT', onConfirm: () => { } });

    const closeDialog = () => setDialog({ ...dialog, isOpen: false });

    useEffect(() => {
        const loadCards = async () => {
            try {
                const cards = await gasService.getCreditCards();
                setCreditCards(cards);
            } catch (e) {
                console.error('Error loading credit cards:', e);
            } finally {
                setLoadingCards(false);
            }
        };
        loadCards();
    }, []);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const incoming: File[] = Array.from(e.target.files);
            setFiles((prev: File[]) => {
                const merged: File[] = [...prev];
                incoming.forEach((nf: File) => {
                    if (!merged.some((f: File) => f.name === nf.name && f.size === nf.size)) merged.push(nf);
                });
                if (merged.length > 10) {
                    setDialog({
                        isOpen: true,
                        title: 'Demasiados archivos',
                        message: 'Máximo 10 archivos por reserva.',
                        type: 'ALERT',
                        onConfirm: closeDialog
                    });
                    return prev;
                }
                return merged;
            });
            // reset input so the same file can be re-added if removed
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const removeFile = (idx: number) => {
        setFiles(prev => prev.filter((_, i) => i !== idx));
    };

    const readFileAsBase64 = (f: File): Promise<string> => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
        };
        reader.onerror = () => reject(new Error('No se pudo leer ' + f.name));
        reader.readAsDataURL(f);
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!reservationNumber.trim()) {
            setDialog({
                isOpen: true,
                title: 'Campo Requerido',
                message: 'Debe ingresar el número de reserva (PNR).',
                type: 'ALERT',
                onConfirm: closeDialog
            });
            return;
        }
        if (!creditCard) {
            setDialog({
                isOpen: true,
                title: 'Campo Requerido',
                message: 'Debe seleccionar la tarjeta de crédito utilizada para la compra.',
                type: 'ALERT',
                onConfirm: closeDialog
            });
            return;
        }
        if (files.length === 0) {
            setDialog({
                isOpen: true,
                title: 'Archivo Requerido',
                message: 'Debe cargar al menos un archivo de confirmación de la reserva.',
                type: 'ALERT',
                onConfirm: closeDialog
            });
            return;
        }

        setDialog({
            isOpen: true,
            title: 'Confirmar Reserva',
            message: `Se registrará la reserva ${reservationNumber} con la tarjeta ${creditCard}, se subirán ${files.length} archivo(s) y se notificará al usuario.\n\n¿Desea continuar?`,
            type: 'CONFIRM',
            onConfirm: executeSubmission,
            onCancel: closeDialog
        });
    };

    const executeSubmission = async () => {
        closeDialog();
        setLoading(true);

        try {
            const payload = await Promise.all(files.map(async (f) => ({
                fileData: await readFileAsBase64(f),
                fileName: f.name
            })));

            await gasService.registerReservation(
                request.requestId,
                reservationNumber,
                payload,
                creditCard
            );

            setDialog({
                isOpen: true,
                title: 'Reserva Registrada',
                message: `La reserva ha sido guardada (${files.length} archivo(s)) y el usuario notificado.`,
                type: 'SUCCESS',
                onConfirm: () => {
                    closeDialog();
                    onSuccess();
                }
            });
        } catch (err) {
            setDialog({
                isOpen: true,
                title: 'Error',
                message: 'Error al registrar reserva: ' + err,
                type: 'ALERT',
                onConfirm: closeDialog
            });
        } finally {
            setLoading(false);
        }
    };

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

            <div className="fixed inset-0 z-[60] overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose}></div>
                    <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>

                    <div className="relative inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
                        <div className="absolute top-0 right-0 pt-4 pr-4 z-10">
                            <button onClick={onClose} className="bg-white rounded-md text-gray-400 hover:text-gray-500 text-2xl font-bold leading-none px-2 focus:outline-none">✕</button>
                        </div>

                        <h3 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2">
                            Registrar Compra / Reserva - <span className="text-brand-red">{request.requestId}</span>
                        </h3>

                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">{request.requestMode === 'HOTEL_ONLY' ? 'Número de Confirmación del Hotel' : 'Número de Reserva (PNR)'}</label>
                                <input
                                    type="text"
                                    value={reservationNumber}
                                    onChange={(e) => setReservationNumber(e.target.value)}
                                    className="w-full border border-gray-300 rounded p-2 text-gray-900 bg-white uppercase focus:ring-brand-red focus:border-brand-red"
                                    placeholder={request.requestMode === 'HOTEL_ONLY' ? 'Ej: HC-123456' : 'Ej: BZQYX'}
                                    disabled={loading}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">Tarjeta de Crédito</label>
                                {loadingCards ? (
                                    <div className="flex items-center gap-2 text-sm text-gray-500 p-2">
                                        <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                                        Cargando tarjetas...
                                    </div>
                                ) : (
                                    <select
                                        value={creditCard}
                                        onChange={(e) => setCreditCard(e.target.value)}
                                        className="w-full border border-gray-300 rounded p-2 text-gray-900 bg-white focus:ring-brand-red focus:border-brand-red"
                                        disabled={loading}
                                    >
                                        <option value="">-- Seleccionar tarjeta --</option>
                                        {creditCards.map((card) => (
                                            <option key={card.value} value={card.value}>
                                                {card.label}
                                            </option>
                                        ))}
                                    </select>
                                )}
                                <p className="text-xs text-gray-400 mt-1 italic">La tarjeta seleccionada se usará para nombrar la carpeta en Drive.</p>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">
                                    Archivos de Confirmación {files.length > 0 && <span className="text-gray-500 font-normal">({files.length})</span>}
                                </label>

                                {files.length > 0 && (
                                    <div className="mb-3 space-y-2">
                                        {files.map((f, idx) => (
                                            <div key={idx} className="flex items-center justify-between bg-green-50 border border-green-200 rounded p-2">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="text-green-700">📄</span>
                                                    <span className="text-sm text-gray-800 truncate" title={f.name}>{f.name}</span>
                                                    <span className="text-xs text-gray-400 flex-shrink-0">({(f.size / 1024).toFixed(0)} KB)</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeFile(idx)}
                                                    disabled={loading}
                                                    className="text-xs text-red-500 hover:text-red-700 underline ml-2 flex-shrink-0"
                                                >
                                                    Quitar
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div
                                    onClick={() => fileInputRef.current?.click()}
                                    className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:bg-gray-50 transition"
                                >
                                    <div className="text-gray-500">
                                        <span className="text-2xl block mb-1">📎</span>
                                        <span className="text-sm font-medium">
                                            {files.length === 0 ? 'Clic para cargar PDF o imágenes' : 'Agregar más archivos'}
                                        </span>
                                        <span className="block text-xs text-gray-400 mt-1">Puedes cargar varios archivos a la vez (máx. 10)</span>
                                    </div>
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        onChange={handleFileChange}
                                        className="hidden"
                                        accept=".pdf,image/*"
                                        multiple
                                    />
                                </div>
                            </div>

                            <div className="mt-6 flex justify-end gap-3 border-t pt-4">
                                <button type="button" onClick={onClose} className="px-4 py-2 border rounded text-gray-700 bg-white hover:bg-gray-50">Cancelar</button>
                                <button type="submit" disabled={loading} className="px-4 py-2 bg-brand-red text-white rounded font-bold hover:bg-red-700 disabled:opacity-50">
                                    {loading ? 'Procesando...' : (request.requestMode === 'HOTEL_ONLY' ? 'Confirmar Reserva Hotel' : 'Confirmar Compra')}
                                </button>
                            </div>
                        </form>

                    </div>
                </div>
            </div>
        </>
    );
};
