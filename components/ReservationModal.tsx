
import React, { useState, useRef, useEffect } from 'react';
import { TravelRequest, SupportFile } from '../types';
import { gasService } from '../services/gasService';
import { ConfirmationDialog } from './ConfirmationDialog';

interface ReservationModalProps {
    request: TravelRequest;
    onClose: () => void;
    onSuccess: () => void;
}

export const ReservationModal = ({ request, onClose, onSuccess }: ReservationModalProps) => {
    // Detect edit mode: the request already has a reservation number
    const isEditMode = !!(request.reservationNumber && request.reservationNumber.trim());
    const isHotelOnly = request.requestMode === 'HOTEL_ONLY';

    const [loading, setLoading] = useState(false);

    // #A40: evita cerrar mientras hay upload/submit en curso. Sin guard, un
    // click-outside o × a mitad de executeSubmission puede dejar archivos
    // parciales en Drive sin referencia en SOPORTES (JSON).
    const handleClose = () => {
      if (loading) {
        if (!window.confirm('Hay una operación en curso. Cerrar ahora podría dejar archivos parciales. ¿Cerrar de todos modos?')) return;
      }
      onClose();
    };

    useEffect(() => {
      const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading]);

    const [reservationNumber, setReservationNumber] = useState(isEditMode ? request.reservationNumber : '');
    const [creditCard, setCreditCard] = useState(isEditMode ? (request.creditCard || '') : '');
    const [creditCards, setCreditCards] = useState<{ value: string, label: string }[]>([]);
    const [loadingCards, setLoadingCards] = useState(true);
    const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().split('T')[0]);

    // New files selected locally (not yet uploaded)
    const [newFiles, setNewFiles] = useState<File[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Existing reservation files from Drive (edit mode only)
    const existingReservationFiles: SupportFile[] = isEditMode
        ? (request.supportData?.files || []).filter(f => f.isReservation)
        : [];
    const [filesToDelete, setFilesToDelete] = useState<Set<string>>(new Set());

    // Correction note (edit mode only)
    const [correctionNote, setCorrectionNote] = useState('');

    // R8: Controla si se envía el correo automático al usuario. Default: sí.
    // Solo aplica en modo NEW (en edit siempre se envía correo de corrección).
    const [sendUserNotification, setSendUserNotification] = useState(true);

    const [dialog, setDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: 'ALERT' | 'CONFIRM' | 'SUCCESS';
        onConfirm: () => void;
        onCancel?: () => void;
    }>({ isOpen: false, title: '', message: '', type: 'ALERT', onConfirm: () => { } });

    const closeDialog = () => setDialog(prev => ({ ...prev, isOpen: false }));

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
            setNewFiles((prev: File[]) => {
                const merged: File[] = [...prev];
                incoming.forEach((nf: File) => {
                    if (!merged.some((f: File) => f.name === nf.name && f.size === nf.size)) merged.push(nf);
                });
                const totalFiles = merged.length + existingReservationFiles.length - filesToDelete.size;
                if (totalFiles > 10) {
                    setDialog({
                        isOpen: true,
                        title: 'Demasiados archivos',
                        message: 'Máximo 10 archivos de reserva en total.',
                        type: 'ALERT',
                        onConfirm: closeDialog
                    });
                    return prev;
                }
                return merged;
            });
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const removeNewFile = (idx: number) => {
        setNewFiles(prev => prev.filter((_, i) => i !== idx));
    };

    const toggleDeleteExisting = (fileId: string) => {
        setFilesToDelete(prev => {
            const next = new Set(prev);
            if (next.has(fileId)) next.delete(fileId);
            else next.add(fileId);
            return next;
        });
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
                message: isHotelOnly ? 'Debe ingresar el número de confirmación.' : 'Debe ingresar el número de reserva (PNR).',
                type: 'ALERT',
                onConfirm: closeDialog
            });
            return;
        }
        if (!creditCard) {
            setDialog({
                isOpen: true,
                title: 'Campo Requerido',
                message: 'Debe seleccionar la tarjeta de crédito.',
                type: 'ALERT',
                onConfirm: closeDialog
            });
            return;
        }

        // In new mode, must have at least one file
        // In edit mode, must have at least one file remaining (existing not deleted + new)
        const remainingExisting = existingReservationFiles.filter(f => !filesToDelete.has(f.id)).length;
        const totalAfter = remainingExisting + newFiles.length;
        if (totalAfter === 0) {
            setDialog({
                isOpen: true,
                title: 'Archivo Requerido',
                message: 'Debe quedar al menos un archivo de confirmación de la reserva.',
                type: 'ALERT',
                onConfirm: closeDialog
            });
            return;
        }

        // R8: si se desmarcó "Enviar correo", primero exigir confirmación
        // explícita con advertencia antes de siquiera llegar al confirm normal.
        // Esto evita olvidos accidentales (la reserva queda sin notificar).
        if (!isEditMode && !sendUserNotification) {
            setDialog({
                isOpen: true,
                title: '⚠️ El usuario NO recibirá correo automático',
                message: 'Desmarcaste "Enviar correo al usuario". El sistema NO le enviará el PNR ni el soporte a su correo.\n\n⚠️ Si NO ha enviado el PNR por otro medio (WhatsApp, correo manual, etc.), HÁGALO AHORA antes de registrar la reserva.\n\nLa acción quedará registrada en observaciones. ¿Continuar sin notificar al usuario?',
                type: 'CONFIRM',
                onConfirm: () => {
                    closeDialog();
                    promptFinalConfirm();
                },
                onCancel: closeDialog
            });
            return;
        }

        promptFinalConfirm();
    };

    const promptFinalConfirm = () => {
        const deleteCount = filesToDelete.size;
        const confirmMsg = isEditMode
            ? `Se actualizará la reserva a ${reservationNumber} con tarjeta ${creditCard}.`
              + (deleteCount > 0 ? `\nSe eliminarán ${deleteCount} archivo(s) de Drive.` : '')
              + (newFiles.length > 0 ? `\nSe subirán ${newFiles.length} archivo(s) nuevo(s).` : '')
              + `\nSe enviará correo de corrección al usuario.\n\n¿Desea continuar?`
            : `Se registrará la reserva ${reservationNumber} con la tarjeta ${creditCard}, se subirán ${newFiles.length} archivo(s)`
              + (sendUserNotification ? ' y se notificará al usuario.' : ' (SIN notificación al usuario).')
              + '\n\n¿Desea continuar?';

        setDialog({
            isOpen: true,
            title: isEditMode ? 'Confirmar Corrección' : 'Confirmar Reserva',
            message: confirmMsg,
            type: 'CONFIRM',
            onConfirm: executeSubmission,
            onCancel: closeDialog
        });
    };

    const executeSubmission = async () => {
        closeDialog();
        setLoading(true);

        try {
            const filePayloads = await Promise.all(newFiles.map(async (f) => ({
                fileData: await readFileAsBase64(f),
                fileName: f.name
            })));

            if (isEditMode) {
                await gasService.amendReservation(
                    request.requestId,
                    reservationNumber,
                    creditCard,
                    purchaseDate,
                    Array.from(filesToDelete),
                    filePayloads,
                    correctionNote.trim() || undefined
                );
                setDialog({
                    isOpen: true,
                    title: 'Reserva Corregida',
                    message: 'La reserva ha sido actualizada y el usuario notificado.',
                    type: 'SUCCESS',
                    onConfirm: () => { closeDialog(); onSuccess(); }
                });
            } else {
                await gasService.registerReservation(
                    request.requestId,
                    reservationNumber,
                    filePayloads,
                    creditCard,
                    purchaseDate,
                    !sendUserNotification
                );
                setDialog({
                    isOpen: true,
                    title: 'Reserva Registrada',
                    message: sendUserNotification
                        ? `La reserva ha sido guardada (${newFiles.length} archivo(s)) y el usuario notificado.`
                        : `La reserva ha sido guardada (${newFiles.length} archivo(s)). NO se envió correo automático al usuario — verifique que haya recibido la información por otro medio.`,
                    type: 'SUCCESS',
                    onConfirm: () => { closeDialog(); onSuccess(); }
                });
            }
        } catch (err) {
            setDialog({
                isOpen: true,
                title: 'Error',
                message: 'Error: ' + err,
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
                    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={handleClose}></div>
                    <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>

                    <div className="relative inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
                        <div className="absolute top-0 right-0 pt-4 pr-4 z-10">
                            <button onClick={handleClose} className="bg-white rounded-md text-gray-400 hover:text-gray-500 text-2xl font-bold leading-none px-2 focus:outline-none">✕</button>
                        </div>

                        <h3 className="text-lg font-bold text-gray-900 mb-1 border-b pb-2">
                            {isEditMode ? 'Corregir Reserva' : 'Registrar Compra / Reserva'} - <span className="text-brand-red">{request.requestId}</span>
                        </h3>
                        {isEditMode && (
                            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
                                Está editando una reserva existente. Los cambios se aplicarán y se enviará un correo de corrección al usuario.
                            </p>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-5">
                            {/* PNR */}
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">{isHotelOnly ? 'Número de Confirmación del Hotel' : 'Número de Reserva (PNR)'}</label>
                                <input
                                    type="text"
                                    value={reservationNumber}
                                    onChange={(e) => setReservationNumber(e.target.value)}
                                    className="w-full border border-gray-300 rounded p-2 text-gray-900 bg-white uppercase focus:ring-brand-red focus:border-brand-red"
                                    placeholder={isHotelOnly ? 'Ej: HC-123456' : 'Ej: BZQYX'}
                                    disabled={loading}
                                />
                            </div>

                            {/* Purchase Date */}
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">Fecha de Compra</label>
                                <input
                                    type="date"
                                    value={purchaseDate}
                                    onChange={(e) => setPurchaseDate(e.target.value)}
                                    className="w-full border border-gray-300 rounded p-2 text-gray-900 bg-white focus:ring-brand-red focus:border-brand-red"
                                    disabled={loading}
                                />
                                <p className="text-xs text-gray-400 mt-1 italic">Por defecto: fecha de hoy.</p>
                            </div>

                            {/* Credit Card */}
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
                            </div>

                            {/* Existing Reservation Files (edit mode) */}
                            {isEditMode && existingReservationFiles.length > 0 && (
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">
                                        Archivos de Reserva Actuales ({existingReservationFiles.length})
                                    </label>
                                    <div className="space-y-2">
                                        {existingReservationFiles.map((f) => {
                                            const markedForDelete = filesToDelete.has(f.id);
                                            return (
                                                <div key={f.id} className={`flex items-center justify-between rounded p-2 border ${markedForDelete ? 'bg-red-50 border-red-300 line-through opacity-60' : 'bg-blue-50 border-blue-200'}`}>
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span>{markedForDelete ? '🗑️' : '📄'}</span>
                                                        <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-700 hover:underline truncate" title={f.name}>
                                                            {f.name}
                                                        </a>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleDeleteExisting(f.id)}
                                                        disabled={loading}
                                                        className={`text-xs underline ml-2 flex-shrink-0 ${markedForDelete ? 'text-green-600 hover:text-green-800' : 'text-red-500 hover:text-red-700'}`}
                                                    >
                                                        {markedForDelete ? 'Restaurar' : 'Eliminar'}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* New Files */}
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">
                                    {isEditMode ? 'Subir Archivos Nuevos' : 'Archivos de Confirmación'} {newFiles.length > 0 && <span className="text-gray-500 font-normal">({newFiles.length})</span>}
                                </label>

                                {newFiles.length > 0 && (
                                    <div className="mb-3 space-y-2">
                                        {newFiles.map((f, idx) => (
                                            <div key={idx} className="flex items-center justify-between bg-green-50 border border-green-200 rounded p-2">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="text-green-700">📄</span>
                                                    <span className="text-sm text-gray-800 truncate" title={f.name}>{f.name}</span>
                                                    <span className="text-xs text-gray-400 flex-shrink-0">({(f.size / 1024).toFixed(0)} KB)</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeNewFile(idx)}
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
                                    onClick={() => !loading && fileInputRef.current?.click()}
                                    className={`border-2 border-dashed border-gray-300 rounded-lg p-4 text-center transition ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}
                                >
                                    <div className="text-gray-500">
                                        <span className="text-2xl block mb-1">📎</span>
                                        <span className="text-sm font-medium">
                                            {newFiles.length === 0 ? 'Clic para cargar PDF o imágenes' : 'Agregar más archivos'}
                                        </span>
                                        <span className="block text-xs text-gray-400 mt-1">Puedes cargar varios archivos a la vez (máx. 10 en total)</span>
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

                            {/* Correction Note (edit mode) */}
                            {isEditMode && (
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">Nota de Corrección (opcional)</label>
                                    <textarea
                                        value={correctionNote}
                                        onChange={(e) => setCorrectionNote(e.target.value)}
                                        rows={2}
                                        placeholder="Ej: Se corrige voucher de hotel por error en la categoría..."
                                        className="w-full border border-gray-300 rounded p-2 text-sm text-gray-900 focus:ring-brand-red focus:border-brand-red"
                                        disabled={loading}
                                    />
                                    <p className="text-xs text-gray-400 mt-1 italic">Se incluirá en el correo de corrección al usuario.</p>
                                </div>
                            )}

                            {/* Checkbox: enviar correo al usuario (solo modo nuevo) */}
                            {!isEditMode && (
                                <div className={`rounded p-3 border ${sendUserNotification ? 'bg-gray-50 border-gray-200' : 'bg-amber-50 border-amber-300'}`}>
                                    <label className="flex items-start gap-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={sendUserNotification}
                                            onChange={(e) => setSendUserNotification(e.target.checked)}
                                            disabled={loading}
                                            className="mt-1 w-4 h-4 accent-brand-red flex-shrink-0"
                                        />
                                        <span className="text-sm text-gray-800 flex-1">
                                            <strong>Enviar correo al usuario</strong> con el PNR y los soportes.
                                            {!sendUserNotification && (
                                                <span className="block mt-1 text-xs text-amber-800 font-medium">
                                                    ⚠️ Desmarcado: el usuario NO recibirá notificación automática. Si ya le enviaste el PNR por otro medio, continúa. De lo contrario, márcalo o envíalo manualmente.
                                                </span>
                                            )}
                                        </span>
                                    </label>
                                </div>
                            )}

                            <div className="mt-6 flex justify-end gap-3 border-t pt-4">
                                <button type="button" onClick={handleClose} className="px-4 py-2 border rounded text-gray-700 bg-white hover:bg-gray-50">Cancelar</button>
                                <button type="submit" disabled={loading} className={`px-4 py-2 text-white rounded font-bold disabled:opacity-50 ${isEditMode ? 'bg-amber-600 hover:bg-amber-700' : 'bg-brand-red hover:bg-red-700'}`}>
                                    {loading ? 'Procesando...' : (isEditMode ? 'Guardar Corrección' : (isHotelOnly ? 'Confirmar Reserva Hotel' : 'Confirmar Compra'))}
                                </button>
                            </div>
                        </form>

                    </div>
                </div>
            </div>
        </>
    );
};
