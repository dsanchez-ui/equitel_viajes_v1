import React, { useEffect, useRef, useState } from 'react';
import { CostEvidence } from '../types';

// #A128 (pedido de Yurani, 18-nov-2026): soporte del costo confirmado. El área de compras confirma
// el costo en un momento y la aprobación puede llegar días después, cuando el precio ya subió. Al
// confirmar puede adjuntar el soporte (pantallazo o PDF de la cotización), y el aprobador, el viajero
// y los administradores ven cuándo se confirmó, quién y con qué soporte.

export const COST_EVIDENCE_MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024; // el servidor tampoco recibe más (validateFileUpload_)
const TZ = 'America/Bogota';

/** «martes, 18 de noviembre de 2026 a las 10:32» (hora de Bogotá, 24 h, #A112). */
export const costEvidenceWhen = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('es-CO', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString('es-CO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${day} a las ${time}`;
};

/** «hace 3 días», «hace 5 h», «hace 20 min» (horas reales, como el semáforo de #A121). */
export const costEvidenceAgo = (iso: string, nowMs: number): string => {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const min = Math.max(0, Math.floor((nowMs - t) / 60000));
  if (min < 60) return min <= 1 ? 'hace un momento' : `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? 'hace 1 hora' : `hace ${h} horas`;
  const days = Math.floor(h / 24);
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
};

interface BoxProps {
  evidence: CostEvidence;
  /** Para «hace X»; por defecto, ahora. */
  nowMs?: number;
  className?: string;
}

/** Cuándo se confirmó el costo, quién y sus soportes. Lo ven el viajero, los administradores y el aprobador. */
export const CostEvidenceBox: React.FC<BoxProps> = ({ evidence, nowMs, className }) => {
  const when = costEvidenceWhen(evidence.at);
  const ago = costEvidenceAgo(evidence.at, nowMs ?? Date.now());
  const files = evidence.files || [];
  return (
    <div className={`rounded border border-indigo-200 border-l-4 border-l-indigo-500 bg-indigo-50 p-3 text-xs text-indigo-950 space-y-1.5 ${className || ''}`} data-cost-evidence>
      <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-800">Soporte del costo</p>
      <p>
        <strong>{evidence.byName || 'El área de compras'}</strong>{evidence.byName ? ' (área de compras)' : ''} confirmó este costo el{' '}
        <strong data-cost-evidence-when>{when}</strong>{ago ? <span className="text-indigo-700"> · {ago}</span> : null}.
      </p>
      <p className="text-indigo-800">Las tarifas cambian con los días: este es el valor de ese momento.</p>
      {files.length > 0 ? (
        <div className="flex flex-wrap gap-2 pt-1" data-cost-evidence-files>
          {files.map(f => (
            <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer"
               className="block border border-indigo-200 bg-white rounded overflow-hidden hover:border-indigo-500 max-w-[11rem]" title={f.name}>
              {f.thumb
                ? <img src={f.thumb} alt={f.name} referrerPolicy="no-referrer" className="h-24 w-full object-contain bg-white" />
                : <span className="flex h-24 w-40 items-center justify-center text-3xl bg-gray-50" aria-hidden>📄</span>}
              <span className="block truncate px-1.5 py-0.5 text-[11px] text-indigo-900">📎 {f.name}</span>
            </a>
          ))}
        </div>
      ) : (
        <p className="text-gray-500" data-cost-evidence-none>No se adjuntó soporte.</p>
      )}
      {evidence.count > 1 && (
        <p className="text-[11px] text-indigo-700">Los costos de esta solicitud se confirmaron {evidence.count} veces; esta es la última.</p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Selector del modal «Confirmar costos»: los archivos se quedan en el navegador y se suben al
// confirmar (si Laura cancela, no queda nada en Drive).
// ---------------------------------------------------------------------------

export interface PendingEvidence {
  key: string;
  file: File;
  /** Vista previa local (solo imágenes). */
  preview: string;
  /** ID en Drive cuando ya se subió (si la confirmación falla después, no se vuelve a subir). */
  uploadedId?: string;
}

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
};

/** El tipo del archivo (o el de su extensión); '' si no es imagen ni PDF. */
export const evidenceMimeType = (file: File): string => {
  const t = String(file.type || '').toLowerCase();
  if (t === 'application/pdf' || t.startsWith('image/')) return t;
  if (t) return '';
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return EXT_MIME[ext] || '';
};

/** Contenido del archivo en base64 (sin el «data:…;base64,»). */
export const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
  reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
  reader.readAsDataURL(file);
});

interface PickerProps {
  value: PendingEvidence[];
  onChange: (next: PendingEvidence[]) => void;
  disabled?: boolean;
}

export const CostEvidencePicker: React.FC<PickerProps> = ({ value, onChange, disabled }) => {
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // La función de agregar lee la lista más reciente aunque la llame el pegado (listener del documento).
  const valueRef = useRef(value);
  valueRef.current = value;

  const add = (incoming: File[]) => {
    if (disabled || incoming.length === 0) return;
    const current = valueRef.current;
    const problems: string[] = [];
    const next = [...current];
    incoming.forEach((raw, i) => {
      const mime = evidenceMimeType(raw);
      if (!mime) { problems.push(`«${raw.name || 'archivo'}» no es una imagen ni un PDF.`); return; }
      if (raw.size > MAX_BYTES) { problems.push(`«${raw.name || 'archivo'}» pesa ${(raw.size / 1024 / 1024).toFixed(1)} MB (máximo 10 MB).`); return; }
      if (next.length >= COST_EVIDENCE_MAX_FILES) { problems.push(`Máximo ${COST_EVIDENCE_MAX_FILES} soportes.`); return; }
      // Un pantallazo pegado llega como «image.png»: le ponemos un nombre que diga qué es.
      const pasted = !raw.name || /^image\.(png|jpe?g|gif|webp)$/i.test(raw.name);
      const stamp = new Date().toLocaleString('es-CO', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .replace(/[^\d]+/g, '-').replace(/^-|-$/g, '');
      const ext = mime === 'application/pdf' ? 'pdf' : (mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const file = pasted ? new File([raw], `pantallazo-${stamp}${incoming.length > 1 ? '-' + (i + 1) : ''}.${ext}`, { type: mime }) : raw;
      next.push({
        key: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        file,
        preview: mime.startsWith('image/') ? URL.createObjectURL(file) : '',
      });
    });
    setError(problems.join(' '));
    if (next.length !== current.length) onChange(next);
  };

  // Ctrl+V en cualquier parte del modal: si lo copiado es una imagen o un PDF, se agrega como soporte.
  // Si es texto (p. ej. un valor en un campo de costo), se pega normal. Ojo: unas celdas copiadas de
  // Excel traen el texto Y una imagen; con el cursor en un campo y texto en el portapapeles, gana el texto.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || []).filter(f => evidenceMimeType(f));
      if (files.length === 0) return;
      const target = e.target as HTMLElement | null;
      const editable = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (editable && (e.clipboardData?.getData('text/plain') || '').trim()) return;
      e.preventDefault();
      add(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  // Libera las vistas previas al cerrar el modal.
  useEffect(() => () => { valueRef.current.forEach(p => { if (p.preview) URL.revokeObjectURL(p.preview); }); }, []);

  const remove = (key: string) => {
    const gone = value.find(p => p.key === key);
    if (gone && gone.preview) URL.revokeObjectURL(gone.preview);
    setError('');
    onChange(value.filter(p => p.key !== key));
  };

  const full = value.length >= COST_EVIDENCE_MAX_FILES;

  return (
    <div className="border border-indigo-200 bg-indigo-50/60 rounded p-3 space-y-2" data-cost-evidence-picker>
      <div>
        <p className="text-sm font-bold text-gray-800">Soporte del costo <span className="font-normal text-gray-500">(opcional)</span></p>
        <p className="text-xs text-gray-600">
          Pantallazo o PDF de la cotización con el precio de hoy. Quien aprueba lo verá con la fecha y la hora de esta confirmación,
          aunque apruebe días después.
        </p>
      </div>
      {!full && (
        <div
          role="button"
          tabIndex={0}
          aria-disabled={disabled}
          onClick={() => { if (!disabled) inputRef.current?.click(); }}
          onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); inputRef.current?.click(); } }}
          onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); add(Array.from(e.dataTransfer.files || [])); }}
          className={`rounded border-2 border-dashed px-3 py-3 text-center text-xs cursor-pointer select-none transition-colors ${dragging ? 'border-indigo-500 bg-indigo-100' : 'border-indigo-300 bg-white hover:bg-indigo-50'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          data-cost-evidence-drop
        >
          <span className="font-bold text-indigo-800">Pegue el pantallazo con Ctrl+V</span>
          <span className="text-gray-600">, arrastre aquí el archivo o haga clic para elegirlo.</span>
          <span className="block text-[11px] text-gray-500 mt-0.5">Imágenes o PDF, hasta 10 MB cada uno; máximo {COST_EVIDENCE_MAX_FILES}.</span>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={e => { add(Array.from(e.target.files || [])); e.target.value = ''; }}
        data-cost-evidence-input
      />
      {error && <p className="text-xs text-red-700" data-cost-evidence-error>{error}</p>}
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" data-cost-evidence-pending>
          {value.map(p => (
            <li key={p.key} className="relative border border-gray-200 bg-white rounded overflow-hidden w-28">
              {p.preview
                ? <img src={p.preview} alt={p.file.name} className="h-20 w-full object-contain bg-white" />
                : <span className="flex h-20 items-center justify-center text-3xl bg-gray-50" aria-hidden>📄</span>}
              <span className="block truncate px-1 py-0.5 text-[10px] text-gray-700" title={p.file.name}>{p.file.name}</span>
              {!disabled && (
                <button type="button" onClick={() => remove(p.key)} title="Quitar"
                        className="absolute top-0.5 right-0.5 rounded-full bg-white/90 border border-gray-300 w-5 h-5 text-[11px] leading-none text-gray-700 hover:bg-red-50 hover:text-red-700">✕</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
