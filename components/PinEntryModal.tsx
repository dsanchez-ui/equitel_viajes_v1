
import React, { useState, useEffect, useRef } from 'react';

interface PinEntryModalProps {
  isOpen: boolean;
  title?: string;
  subtitle?: string;
  infoBox?: React.ReactNode;
  onClose: () => void;
  onSubmit: (pin: string) => Promise<boolean>; // Returns success status
  onChangeMode?: boolean; // If true, logic changes to "New Pin" entry
  onResend?: () => Promise<void>; // If provided, shows a "Resend PIN" button
  associatedEmail?: string; // For browser password manager integration (autofill)
}

export const PinEntryModal: React.FC<PinEntryModalProps> = ({ isOpen, title = "Ingrese PIN de Administrador", subtitle, infoBox, onClose, onSubmit, onChangeMode = false, onResend, associatedEmail }) => {
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
        setPin('');
        setError('');
        setResendMsg('');
        setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const handleResendClick = async () => {
    if (!onResend || resending) return;
    setResending(true);
    setError('');
    setResendMsg('');
    try {
      await onResend();
      setResendMsg('Te enviamos un nuevo PIN. Revisa tu correo.');
      setPin('');
    } catch (e: any) {
      setError(e?.message || 'No se pudo reenviar el PIN. Intenta nuevamente.');
    } finally {
      setResending(false);
    }
  };

  if (!isOpen) return null;

  const defaultSubtitle = onChangeMode
    ? "Ingrese el nuevo PIN de 8 dígitos."
    : "Área restringida. Ingrese su clave de acceso.";

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, ''); // Only digits
    if (val.length <= 8) {
        setPin(val);
        setError('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 8) {
        setError('El PIN debe tener 8 dígitos.');
        return;
    }

    setLoading(true);
    setError('');
    
    try {
        const success = await onSubmit(pin);
        if (!success) {
            setError('PIN Incorrecto.');
        } else {
            // Parent handles closing on success usually
        }
    } catch (err) {
        setError('Error de validación.');
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
        <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-600 bg-opacity-75 transition-opacity" onClick={onClose}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>
            
            <div className="relative inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-sm sm:w-full sm:p-6 border-t-4 border-brand-red">
                <div className="text-center">
                    <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 mb-4">
                        <span className="text-xl">🔒</span>
                    </div>
                    <h3 className="text-lg leading-6 font-bold text-gray-900 mb-2">{title}</h3>
                    <p className="text-xs text-gray-500 mb-4">
                        {subtitle || defaultSubtitle}
                    </p>

                    {infoBox && <div className="mb-4">{infoBox}</div>}

                    <form onSubmit={handleSubmit}>
                        {/* Hidden username field so the browser password manager can associate
                            the saved PIN with the user's email account. */}
                        {associatedEmail && (
                            <input
                                type="email"
                                name="email"
                                autoComplete="username"
                                value={associatedEmail}
                                readOnly
                                tabIndex={-1}
                                aria-hidden="true"
                                style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: 0 }}
                            />
                        )}
                        <input
                            ref={inputRef}
                            type="password"
                            inputMode="numeric"
                            name="pin"
                            autoComplete={onChangeMode ? "new-password" : "current-password"}
                            value={pin}
                            onChange={handleChange}
                            className="block w-full text-center text-2xl tracking-[0.5em] font-bold border-gray-300 rounded-md focus:ring-brand-red focus:border-brand-red p-2 border mb-2 bg-white text-gray-900 placeholder-gray-400"
                            placeholder="••••••••"
                            disabled={loading || resending}
                        />

                        {error && <p className="text-xs text-red-600 font-bold mb-2 animate-pulse">{error}</p>}
                        {resendMsg && <p className="text-xs text-green-700 font-bold mb-2">{resendMsg}</p>}

                        <div className="mt-4 flex gap-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none"
                                disabled={loading || resending}
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={loading || resending || pin.length !== 8}
                                className="flex-1 inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-black text-base font-medium text-white hover:bg-gray-800 focus:outline-none disabled:opacity-50 sm:text-sm"
                            >
                                {loading ? '...' : 'Entrar'}
                            </button>
                        </div>

                        {onResend && (
                            <button
                                type="button"
                                onClick={handleResendClick}
                                disabled={resending || loading}
                                className="mt-3 text-xs text-blue-600 hover:text-blue-800 font-semibold underline disabled:opacity-50"
                            >
                                {resending ? 'Enviando...' : 'No recibí el correo · Reenviar PIN'}
                            </button>
                        )}
                    </form>
                </div>
            </div>
        </div>
    </div>
  );
};
