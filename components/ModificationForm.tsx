
import React, { useState, useEffect } from 'react';
import { TravelRequest, Passenger, CostCenterMaster, Integrant } from '../types';
import { COMPANIES, SITES, MAX_PASSENGERS } from '../constants';
import { gasService } from '../services/gasService';

interface ModificationFormProps {
  originalRequest: TravelRequest;
  integrantes: Integrant[]; // Data passed from App via RequestDetail
  onClose: () => void;
  onSuccess: () => void;
}

type TripType = 'ROUND_TRIP' | 'ONE_WAY';

export const ModificationForm: React.FC<ModificationFormProps> = ({ originalRequest, integrantes, onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [geminiLoading, setGeminiLoading] = useState(false);

  // --- FORM STATE INITIALIZATION ---
  
  // Determine initial Trip Type
  const [tripType, setTripType] = useState<TripType>(originalRequest.returnDate ? 'ROUND_TRIP' : 'ONE_WAY');
  
  // Hotel Logic
  const [requiresHotel, setRequiresHotel] = useState(originalRequest.requiresHotel);
  const [manualNights, setManualNights] = useState<boolean>(false);
  const [numberOfNights, setNumberOfNights] = useState<number>(originalRequest.nights || 0);

  // Master Data State
  const [masterData, setMasterData] = useState<CostCenterMaster[]>([]);
  const [availableBusinessUnits, setAvailableBusinessUnits] = useState<string[]>([]);
  const [filteredCostCenters, setFilteredCostCenters] = useState<CostCenterMaster[]>([]);
  
  // Various Cost Center State
  const [variousCCList, setVariousCCList] = useState<string[]>(
    originalRequest.variousCostCenters ? originalRequest.variousCostCenters.split(',').map(s => s.split(' - ')[0].trim()) : []
  );
  const [variousCCInput, setVariousCCInput] = useState<string>('');

  // Main Form Data
  const [formData, setFormData] = useState<Partial<TravelRequest>>({
    ...originalRequest,
    passengers: originalRequest.passengers.map(p => ({ ...p })) // Deep copy
  });

  // Change Reason State
  const [changeDraft, setChangeDraft] = useState('');
  const [changeReason, setChangeReason] = useState('');

  // --- EFFECTS ---

  // 1. Load Master Data
  useEffect(() => {
    const fetchMasters = async () => {
      try {
        const data = await gasService.getCostCenterData();
        setMasterData(data);
        
        // Extract Unique Business Units
        const uniqueUnits = Array.from(new Set(data.map(item => item.businessUnit)))
                             .filter(u => u && u !== 'NA') 
                             .sort();
        setAvailableBusinessUnits(uniqueUnits);
        
        // Initial filter based on existing BU
        if (originalRequest.businessUnit) {
            const filtered = data.filter(item => item.businessUnit === originalRequest.businessUnit);
            const variosOption: CostCenterMaster = { code: 'VARIOS', name: 'Múltiples Centros de Costo', businessUnit: originalRequest.businessUnit };
            setFilteredCostCenters([...filtered, variosOption]);
        }
      } catch (err) {
        console.error("Error loading masters:", err);
      }
    };
    fetchMasters();
  }, [originalRequest.businessUnit]);

  // 2. Filter Cost Centers when Business Unit Changes
  useEffect(() => {
    if (formData.businessUnit && masterData.length > 0) {
      const filtered = masterData.filter(item => item.businessUnit === formData.businessUnit);
      const variosOption: CostCenterMaster = { code: 'VARIOS', name: 'Múltiples Centros de Costo', businessUnit: formData.businessUnit };
      setFilteredCostCenters([...filtered, variosOption]);
    } else {
      setFilteredCostCenters([]);
    }
  }, [formData.businessUnit, masterData]);

  // 3. Handle Trip Type Changes
  useEffect(() => {
    if (tripType === 'ONE_WAY') {
        setManualNights(true);
        setFormData(prev => ({ ...prev, returnDate: '', returnTimePreference: '' }));
    } else {
        // If switching back to Round Trip, maybe restore date? No, let user pick.
        setManualNights(false);
    }
  }, [tripType]);

  // 4. Calculate Nights Automatically
  useEffect(() => {
    if (requiresHotel && tripType === 'ROUND_TRIP' && !manualNights && formData.departureDate && formData.returnDate) {
        const d1 = new Date(formData.departureDate);
        const d2 = new Date(formData.returnDate);
        const diffTime = d2.getTime() - d1.getTime(); // Allow negative to show 0
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        setNumberOfNights(diffDays > 0 ? diffDays : 0);
    }
  }, [requiresHotel, tripType, manualNights, formData.departureDate, formData.returnDate]);


  // --- HANDLERS ---

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    let finalValue = value;

    if (name === 'origin' || name === 'destination') {
       finalValue = value
        .toUpperCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") 
        .replace(/[^A-Z\s]/g, ""); 
    }
    
    if (name === 'businessUnit') {
      // If BU changes, clear CC
      setFormData(prev => ({ ...prev, [name]: finalValue, costCenter: '' }));
      setVariousCCList([]); 
    } else {
      setFormData(prev => ({ ...prev, [name]: finalValue }));
    }
  };

  // Helper to check if passenger is in DB
  const isPassengerInDb = (idNumber: string) => {
      return integrantes.some(i => i.idNumber === idNumber);
  };

  // Passenger Logic
  const handlePassengerChange = (index: number, field: keyof Passenger, value: string) => {
    let finalValue = value;
    if (field === 'name') {
      finalValue = value.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z\s]/g, "");
    } else if (field === 'idNumber') {
      finalValue = value.replace(/[^0-9]/g, "");
    }

    const newPassengers = [...(formData.passengers || [])];
    if (newPassengers[index]) {
       // @ts-ignore
       newPassengers[index][field] = finalValue;

       // --- AUTO-FILL LOGIC ---
       if (field === 'idNumber') {
           const found = integrantes.find(i => i.idNumber === finalValue);
           if (found) {
               newPassengers[index].name = found.name;
               // Optional: Set email if needed, though ModificationForm partial might not use it directly for display
               newPassengers[index].email = found.email;
           }
       }
       // -----------------------

       setFormData({ ...formData, passengers: newPassengers });
    }
  };

  const addPassenger = () => {
    const currentList = formData.passengers || [];
    if (currentList.length < MAX_PASSENGERS) {
      setFormData({ 
          ...formData, 
          passengers: [...currentList, { name: '', idNumber: '', email: '' }] 
      });
    }
  };

  const removePassenger = (index: number) => {
    const currentList = formData.passengers || [];
    if (currentList.length > 1) {
      setFormData({ 
          ...formData, 
          passengers: currentList.filter((_, i) => i !== index) 
      });
    }
  };

  // Various CC Logic
  const handleAddVariousCC = () => {
    if (!variousCCInput.trim()) return;
    let code = variousCCInput.trim();
    if (/^\d+$/.test(code)) code = code.padStart(4, '0');
    if (!variousCCList.includes(code)) {
      setVariousCCList([...variousCCList, code]);
    }
    setVariousCCInput('');
  };

  const handleRemoveVariousCC = (codeToRemove: string) => {
    setVariousCCList(variousCCList.filter(c => c !== codeToRemove));
  };

  // Gemini & Submit
  const handleEnhanceText = async () => {
    if (!changeDraft.trim()) return;
    setGeminiLoading(true);
    try {
       // We pass the ORIGINAL request context to Gemini so it knows what changed
       const enhanced = await gasService.enhanceTextWithGemini(originalRequest, changeDraft);
       setChangeReason(enhanced);
    } catch (e) {
       console.error(e);
       alert("Error conectando con Gemini. Se usará el texto original.");
       setChangeReason(changeDraft);
    } finally {
       setGeminiLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
     e.preventDefault();
     
     // Validations
     if (formData.costCenter === 'VARIOS' && variousCCList.length === 0) {
        alert('Debe agregar al menos un centro de costos en la lista de VARIOS.');
        return;
     }
     if (tripType === 'ROUND_TRIP' && !formData.returnDate) {
        alert('Fecha de regreso obligatoria para viaje redondo.');
        return;
     }
     if (requiresHotel && numberOfNights <= 0) {
        alert('El número de noches debe ser mayor a 0.');
        return;
     }
     if (!changeReason.trim()) {
         alert("Debe incluir una descripción del cambio (Paso 2).");
         return;
     }

     setLoading(true);

     const getVariousCCFormatted = () => {
         if (formData.costCenter !== 'VARIOS' || variousCCList.length === 0) return undefined;
         return variousCCList.map(code => {
             const ccObj = masterData.find(cc => cc.code === code);
             return ccObj ? `${code} - ${ccObj.name}` : code;
         }).join(', ');
     };

     // Prepare final payload
     const finalPayload: Partial<TravelRequest> = {
         ...formData,
         returnDate: tripType === 'ONE_WAY' ? '' : formData.returnDate,
         returnTimePreference: tripType === 'ONE_WAY' ? '' : formData.returnTimePreference,
         requiresHotel,
         nights: requiresHotel ? numberOfNights : 0,
         variousCostCenters: getVariousCCFormatted()
     };

     try {
         await gasService.requestModification(originalRequest.requestId, finalPayload, changeReason);
         onSuccess();
     } catch (e) {
         alert("Error enviando modificación: " + e);
     } finally {
         setLoading(false);
     }
  };

  const handleOpenPicker = (e: React.MouseEvent<HTMLInputElement>) => {
    try {
      if ('showPicker' in e.currentTarget) {
        e.currentTarget.showPicker();
      }
    } catch (error) {}
  };

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
        <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>
            
            <div className="relative inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full sm:p-6">
                <div className="absolute top-0 right-0 pt-4 pr-4 z-10">
                    <button onClick={onClose} className="bg-white rounded-md text-gray-400 hover:text-gray-500 text-2xl font-bold leading-none px-2 focus:outline-none">✕</button>
                </div>

                <h3 className="text-xl font-bold text-gray-900 mb-6 border-b pb-2">
                    Solicitar Modificación - <span className="text-brand-red">{originalRequest.requestId}</span>
                </h3>

                <form onSubmit={handleSubmit} className="space-y-8">
                    
                    {/* --- STEP 1: FULL DATA EDIT --- */}
                    <div className="bg-gray-50 p-6 rounded-md border border-gray-200 space-y-6">
                        <h4 className="text-sm font-bold text-gray-700 uppercase border-b border-gray-200 pb-2 mb-4">
                            1. Actualice los datos necesarios
                        </h4>
                        
                        {/* 1.1 Company & BU */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Empresa</label>
                                <select 
                                  name="company" 
                                  value={formData.company} 
                                  onChange={handleInputChange} 
                                  className="block w-full bg-white text-gray-900 border-gray-300 rounded-md shadow-sm focus:ring-brand-red focus:border-brand-red sm:text-sm p-2"
                                >
                                  {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Sede</label>
                                <select 
                                  name="site" 
                                  value={formData.site} 
                                  onChange={handleInputChange} 
                                  className="block w-full bg-white text-gray-900 border-gray-300 rounded-md shadow-sm focus:ring-brand-red focus:border-brand-red sm:text-sm p-2"
                                >
                                  {SITES.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Unidad de Negocio</label>
                                <select 
                                    name="businessUnit" 
                                    value={formData.businessUnit} 
                                    onChange={handleInputChange}
                                    className="block w-full bg-white text-gray-900 border-gray-300 rounded-md shadow-sm focus:ring-brand-red focus:border-brand-red sm:text-sm p-2"
                                >
                                    <option value="">Seleccione...</option>
                                    {availableBusinessUnits.map(u => <option key={u} value={u}>{u}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Orden de Trabajo</label>
                                <input 
                                    type="text" 
                                    name="workOrder" 
                                    value={formData.workOrder || ''} 
                                    onChange={handleInputChange}
                                    className="block w-full bg-white text-gray-900 border-gray-300 rounded-md shadow-sm focus:ring-brand-red focus:border-brand-red sm:text-sm p-2"
                                />
                            </div>
                        </div>

                        {/* 1.2 Cost Center */}
                        <div>
                             <label className="block text-xs font-medium text-gray-500 mb-1">Centro de Costos</label>
                             <select 
                                name="costCenter" 
                                value={formData.costCenter} 
                                onChange={handleInputChange}
                                disabled={!formData.businessUnit}
                                className="block w-full bg-white text-gray-900 border-gray-300 rounded-md shadow-sm focus:ring-brand-red focus:border-brand-red sm:text-sm p-2"
                             >
                                <option value="">Seleccione...</option>
                                {filteredCostCenters.map(c => (
                                  <option key={c.code} value={c.code}>{c.code === 'VARIOS' ? 'VARIOS' : `${c.code} - ${c.name}`}</option>
                                ))}
                             </select>
                             
                             {formData.costCenter === 'VARIOS' && (
                                <div className="mt-2 bg-white p-2 rounded border border-gray-200">
                                    <div className="flex gap-2">
                                        <input 
                                            value={variousCCInput} 
                                            onChange={(e) => setVariousCCInput(e.target.value)} 
                                            placeholder="Ej: 0101" 
                                            className="flex-1 border p-1 rounded text-sm bg-white"
                                        />
                                        <button type="button" onClick={handleAddVariousCC} className="bg-brand-red text-white text-xs px-2 rounded">Agregar</button>
                                    </div>
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {variousCCList.map((cc, i) => (
                                            <span key={i} className="text-xs bg-gray-100 px-2 py-1 rounded border flex items-center gap-1">
                                                {cc} <button type="button" onClick={() => handleRemoveVariousCC(cc)} className="text-red-500 font-bold">x</button>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                             )}
                        </div>
                        
                        <hr className="border-gray-200"/>

                        {/* 1.3 Passengers */}
                        <div>
                             <div className="flex justify-between items-center mb-2">
                                 <label className="block text-xs font-bold text-gray-700 uppercase">Pasajeros</label>
                                 {(formData.passengers?.length || 0) < MAX_PASSENGERS && (
                                     <button type="button" onClick={addPassenger} className="text-xs text-brand-red font-bold hover:underline">+ Agregar</button>
                                 )}
                             </div>
                             <div className="space-y-2">
                                 {formData.passengers?.map((p, idx) => (
                                     <div key={idx} className="flex gap-2 items-center">
                                         <input 
                                            value={p.idNumber} 
                                            onChange={(e) => handlePassengerChange(idx, 'idNumber', e.target.value)} 
                                            className="w-1/3 bg-white text-gray-900 border-gray-300 rounded-md shadow-sm focus:ring-brand-red focus:border-brand-red sm:text-sm p-2" 
                                            placeholder="Cédula"
                                         />
                                         <input 
                                            value={p.name} 
                                            onChange={(e) => handlePassengerChange(idx, 'name', e.target.value)} 
                                            readOnly={isPassengerInDb(p.idNumber)} // LOCK IF FOUND
                                            className={`flex-1 rounded-md border-gray-300 shadow-sm focus:ring-brand-red focus:border-brand-red sm:text-sm p-2 ${isPassengerInDb(p.idNumber) ? 'bg-gray-200 cursor-not-allowed text-gray-600' : 'bg-white text-gray-900'}`} 
                                            placeholder="Nombre Completo"
                                         />
                                         {(formData.passengers?.length || 0) > 1 && (
                                             <button type="button" onClick={() => removePassenger(idx)} className="text-red-500 p-2 hover:bg-red-50 rounded">🗑️</button>
                                         )}
                                     </div>
                                 ))}
                             </div>
                        </div>

                        <hr className="border-gray-200"/>

                        {/* 1.4 Itinerary */}
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <label className="block text-xs font-bold text-gray-700 uppercase">Itinerario</label>
                                <div className="flex bg-gray-200 p-1 rounded">
                                    <button type="button" onClick={() => setTripType('ROUND_TRIP')} className={`px-2 py-1 text-xs rounded ${tripType === 'ROUND_TRIP' ? 'bg-white shadow text-brand-red font-bold' : 'text-gray-500'}`}>Ida y Vuelta</button>
                                    <button type="button" onClick={() => setTripType('ONE_WAY')} className={`px-2 py-1 text-xs rounded ${tripType === 'ONE_WAY' ? 'bg-white shadow text-brand-red font-bold' : 'text-gray-500'}`}>Solo Ida</button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Origen</label>
                                    <input 
                                        name="origin" 
                                        value={formData.origin} 
                                        onChange={handleInputChange} 
                                        className="block w-full bg-white text-gray-900 border-gray-300 rounded-md shadow-sm focus:ring-brand-red focus:border-brand-red sm:text-sm p-2"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Destino</label>
                                    <input 
                                        name="destination" 
                                        value={formData.destination} 
                                        onChange={handleInputChange} 
                                        className="block w-full bg-white text-gray-900 border-gray-300 rounded-md shadow-sm focus:ring-brand-red focus:border-brand-red sm:text-sm p-2"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Fecha Ida</label>
                                    <input 
                                        type="date" 
                                        name="departureDate" 
                                        value={formData.departureDate} 
                                        onChange={handleInputChange} 
                                        onClick={handleOpenPicker}
                                        style={{ colorScheme: 'light' }}
                                        className="block w-full bg-white text-gray-900 border-gray-300 rounded-md shadow-sm focus:ring-brand-red focus:border-brand-red sm:text-sm p-2"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Hora Ida</label>
                                    <input 
                                        type="time" 
                                        name="departureTimePreference" 
                                        value={formData.departureTimePreference} 
                                        onChange={handleInputChange} 
                                        onClick={handleOpenPicker}
                                        style={{ colorScheme: 'light' }}
                                        className="block w-full bg-white text-gray-900 border-gray-300 rounded-md shadow-sm focus:ring-brand-red focus:border-brand-red sm:text-sm p-2"
                                    />
                                </div>
                                
                                {tripType === 'ROUND_TRIP' && (
                                    <>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-500 mb-1">Fecha Vuelta</label>
                                            <input 
                                                type="date" 
                                                name="returnDate" 
                                                value={formData.returnDate} 
                                                onChange={handleInputChange} 
                                                onClick={handleOpenPicker}
                                                style={{ colorScheme: 'light' }}
                                                className="block w-full bg-white text-gray-900 border-gray-300 rounded-md shadow-sm focus:ring-brand-red focus:border-brand-red sm:text-sm p-2"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-500 mb-1">Hora Vuelta</label>
                                            <input 
                                                type="time" 
                                                name="returnTimePreference" 
                                                value={formData.returnTimePreference} 
                                                onChange={handleInputChange} 
                                                onClick={handleOpenPicker}
                                                style={{ colorScheme: 'light' }}
                                                className="block w-full bg-white text-gray-900 border-gray-300 rounded-md shadow-sm focus:ring-brand-red focus:border-brand-red sm:text-sm p-2"
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        <hr className="border-gray-200"/>

                        {/* 1.5 Hotel & Notes */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <input 
                                        type="checkbox" 
                                        checked={requiresHotel} 
                                        onChange={(e) => setRequiresHotel(e.target.checked)}
                                        className="focus:ring-brand-red h-4 w-4 text-brand-red border-gray-300 rounded"
                                    />
                                    <label className="text-xs font-bold text-gray-700 uppercase">Requiere Hospedaje</label>
                                </div>
                                {requiresHotel && (
                                    <div className="bg-blue-50 p-3 rounded border border-blue-100 space-y-3">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-500">Nombre Hotel</label>
                                            <input 
                                                name="hotelName" 
                                                value={formData.hotelName} 
                                                onChange={handleInputChange} 
                                                className="block w-full bg-white text-gray-900 border-gray-300 rounded-md shadow-sm focus:ring-brand-red focus:border-brand-red sm:text-sm p-2"
                                            />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <label className="block text-xs font-medium text-gray-500">Noches</label>
                                                {tripType === 'ROUND_TRIP' && (
                                                    <label className="text-[10px] flex items-center gap-1 text-gray-600">
                                                        <input type="checkbox" checked={manualNights} onChange={(e) => setManualNights(e.target.checked)} />
                                                        Manual?
                                                    </label>
                                                )}
                                            </div>
                                            <input 
                                                type="number" 
                                                value={numberOfNights} 
                                                onChange={(e) => setNumberOfNights(parseInt(e.target.value) || 0)}
                                                readOnly={!manualNights && tripType === 'ROUND_TRIP'}
                                                className={`block w-20 bg-white text-gray-900 border-gray-300 rounded-md shadow-sm focus:ring-brand-red focus:border-brand-red sm:text-sm p-2 ${!manualNights && tripType === 'ROUND_TRIP' ? 'bg-gray-100' : ''}`}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                            
                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase mb-2">Observaciones</label>
                                <textarea 
                                    name="comments" 
                                    rows={4} 
                                    value={formData.comments} 
                                    onChange={handleInputChange} 
                                    className="block w-full bg-white text-gray-900 border-gray-300 rounded-md shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm p-2"
                                />
                            </div>
                        </div>

                    </div>

                    {/* --- STEP 2: REASON & GEMINI --- */}
                    <div className="bg-blue-50 p-6 rounded-md border border-blue-200">
                        <h4 className="text-sm font-bold text-blue-800 uppercase mb-4 border-b border-blue-200 pb-2">
                            2. Describa el motivo del cambio
                        </h4>
                        
                        <div className="mb-4">
                            <label className="block text-xs text-gray-600 mb-1">Borrador de su solicitud (Escriba aquí qué desea cambiar)</label>
                            <div className="flex gap-2">
                                <textarea 
                                    className="flex-1 p-2 border rounded text-sm bg-white text-gray-900 focus:ring-purple-500 focus:border-purple-500" 
                                    rows={2}
                                    value={changeDraft}
                                    onChange={(e) => setChangeDraft(e.target.value)}
                                    placeholder="Ej: Necesito cambiar la fecha de regreso para un día después porque la reunión se extendió..."
                                />
                                <button 
                                    type="button"
                                    onClick={handleEnhanceText}
                                    disabled={geminiLoading || !changeDraft}
                                    className="bg-purple-600 text-white px-3 rounded font-bold text-xs hover:bg-purple-700 transition flex flex-col items-center justify-center min-w-[100px]"
                                >
                                    {geminiLoading ? (
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                    ) : (
                                        <>
                                            <span className="text-lg">✨</span>
                                            <span>Mejorar<br/>con Gemini</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-800 mb-1">Texto Final de la Petición (Se enviará al administrador)</label>
                            <textarea 
                                className="w-full p-2 border border-blue-300 rounded text-sm bg-white font-medium text-gray-900 focus:ring-blue-500 focus:border-blue-500" 
                                rows={3}
                                value={changeReason}
                                onChange={(e) => setChangeReason(e.target.value)}
                                placeholder="El texto mejorado por IA aparecerá aquí, o puede escribirlo manualmente."
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t">
                        <button type="button" onClick={onClose} className="px-4 py-2 border rounded text-gray-700 bg-white hover:bg-gray-50 shadow-sm">Cancelar</button>
                        <button type="submit" disabled={loading} className="px-4 py-2 bg-brand-red text-white rounded hover:bg-red-700 disabled:opacity-50 shadow-sm font-bold">
                            {loading ? 'Enviando...' : 'Confirmar Cambio'}
                        </button>
                    </div>

                </form>
            </div>
        </div>
    </div>
  );
};
