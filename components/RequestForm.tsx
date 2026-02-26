
import React, { useState, useEffect } from 'react';
import { TravelRequest, Passenger, RequestStatus, CostCenterMaster, Integrant, CityMaster } from '../types';
import { COMPANIES, SITES, MAX_PASSENGERS } from '../constants';
import { gasService } from '../services/gasService';
import { generateTravelRequestEmail } from '../utils/EmailGenerator';
import { formatToYYYYMMDD, formatToDDMMYYYY } from '../utils/dateUtils';

interface RequestFormProps {
  userEmail: string;
  integrantes: Integrant[];
  onSuccess: () => void;
  onCancel: () => void;
  // Modification Props
  isModification?: boolean;
  initialData?: TravelRequest;
}

type TripType = 'ROUND_TRIP' | 'ONE_WAY';

export const RequestForm: React.FC<RequestFormProps> = ({
  userEmail,
  integrantes,
  onSuccess,
  onCancel,
  isModification = false,
  initialData
}) => {
  const [loading, setLoading] = useState(false);
  const [geminiLoading, setGeminiLoading] = useState(false);

  // Initialize State
  const [passengers, setPassengers] = useState<Passenger[]>(
    initialData ? initialData.passengers.map(p => ({ ...p })) : [{ name: '', idNumber: '', email: '' }]
  );

  const [tripType, setTripType] = useState<TripType>(
    initialData ? (initialData.returnDate ? 'ROUND_TRIP' : 'ONE_WAY') : 'ROUND_TRIP'
  );

  const [requiresHotel, setRequiresHotel] = useState(initialData ? initialData.requiresHotel : false);
  const [manualNights, setManualNights] = useState<boolean>(false);
  const [numberOfNights, setNumberOfNights] = useState<number>(initialData ? (initialData.nights || 0) : 0);

  // New International Logic
  const [isInternational, setIsInternational] = useState<boolean>(initialData ? !!initialData.isInternational : false);
  const [policyViolation, setPolicyViolation] = useState<boolean>(false);

  // Master Data State
  const [masterData, setMasterData] = useState<CostCenterMaster[]>([]);
  const [availableBusinessUnits, setAvailableBusinessUnits] = useState<string[]>([]);
  const [filteredCostCenters, setFilteredCostCenters] = useState<CostCenterMaster[]>([]);

  // Cities Data
  const [cities, setCities] = useState<CityMaster[]>([]);
  const [isCitiesLoading, setIsCitiesLoading] = useState(false);

  const [variousCCList, setVariousCCList] = useState<string[]>(
    initialData?.variousCostCenters ? initialData.variousCostCenters.split(',').map(s => s.split(' - ')[0].trim()) : []
  );
  const [variousCCInput, setVariousCCInput] = useState<string>('');

  // Modification Reason State
  const [changeReason, setChangeReason] = useState('');

  const [formData, setFormData] = useState<Partial<TravelRequest>>({
    company: initialData?.company || '',
    businessUnit: initialData?.businessUnit || '',
    site: initialData?.site || '',
    costCenter: initialData?.costCenter || '',
    origin: initialData?.origin || '',
    destination: initialData?.destination || '',
    departureDate: formatToYYYYMMDD(initialData?.departureDate) || '',
    returnDate: formatToYYYYMMDD(initialData?.returnDate) || '',
    departureTimePreference: initialData?.departureTimePreference || '',
    returnTimePreference: initialData?.returnTimePreference || '',
    workOrder: initialData?.workOrder || '',
    hotelName: initialData?.hotelName || '',
    comments: initialData?.comments || '',
  });

  // Load Master Data on Mount
  useEffect(() => {
    const fetchMasters = async () => {
      try {
        setIsCitiesLoading(true);
        const [ccData, cityData] = await Promise.all([
          gasService.getCostCenterData(),
          gasService.getCitiesList()
        ]);

        setMasterData(ccData);
        setCities(cityData);

        const uniqueUnits = Array.from(new Set(ccData.map(item => item.businessUnit)))
          .filter(u => u && u !== 'NA')
          .sort();
        setAvailableBusinessUnits(uniqueUnits);

        // Pre-filter if modification
        if (initialData?.businessUnit) {
          const filtered = ccData.filter(item => item.businessUnit === initialData.businessUnit);
          const variosOption = { code: 'VARIOS', name: 'Múltiples Centros de Costo', businessUnit: initialData.businessUnit };
          setFilteredCostCenters([...filtered, variosOption]);
        }
      } catch (err) {
        console.error("Error loading masters:", err);
      } finally {
        setIsCitiesLoading(false);
      }
    };
    fetchMasters();
  }, []);

  // Filter Cost Centers when Business Unit Changes
  useEffect(() => {
    if (formData.businessUnit) {
      const filtered = masterData.filter(item => item.businessUnit === formData.businessUnit);
      const variosOption: CostCenterMaster = { code: 'VARIOS', name: 'Múltiples Centros de Costo', businessUnit: formData.businessUnit };
      setFilteredCostCenters([...filtered, variosOption]);
    } else {
      setFilteredCostCenters([]);
    }
  }, [formData.businessUnit, masterData]);

  // Handle Trip Type Change
  useEffect(() => {
    if (tripType === 'ONE_WAY') {
      setManualNights(true);
      setFormData(prev => ({ ...prev, returnDate: '', returnTimePreference: '' }));
    } else {
      setManualNights(false);
    }
  }, [tripType]);

  // AUTO-INTERNATIONAL LOGIC
  useEffect(() => {
    const originCity = cities.find(c => `${c.city} (${c.country})` === formData.origin);
    const destCity = cities.find(c => `${c.city} (${c.country})` === formData.destination);

    if (originCity && destCity) {
      // It's international if ANY of the cities is NOT in COLOMBIA
      const autoIsInternational = originCity.country !== 'COLOMBIA' || destCity.country !== 'COLOMBIA';
      setIsInternational(autoIsInternational);
    }
  }, [formData.origin, formData.destination, cities]);

  // POLICY VALIDATION LOGIC
  useEffect(() => {
    if (formData.departureDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const depDate = new Date(formData.departureDate);
      depDate.setHours(0, 0, 0, 0);

      const diffTime = depDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      const threshold = isInternational ? 30 : 8;

      // If diffDays is less than threshold (e.g. 7 days for national), it's a violation
      setPolicyViolation(diffDays < threshold);
    } else {
      setPolicyViolation(false);
    }
  }, [formData.departureDate, isInternational]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    let finalValue = value;

    // Force Uppercase for Origin, Destination AND Hotel Name
    if (name === 'origin' || name === 'destination' || name === 'hotelName') {
      finalValue = value.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9\s]/g, "");
    }

    if (name === 'businessUnit') {
      setFormData(prev => ({ ...prev, [name]: finalValue, costCenter: '' }));
      setVariousCCList([]);
    } else {
      setFormData(prev => ({ ...prev, [name]: finalValue }));
    }
  };

  const handleOpenPicker = (e: React.MouseEvent<HTMLInputElement>) => {
    try {
      if ('showPicker' in e.currentTarget) e.currentTarget.showPicker();
    } catch (error) { }
  };

  const handlePassengerChange = (index: number, field: keyof Passenger, value: string) => {
    let finalValue = value;
    if (field === 'name') {
      finalValue = value.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z\s]/g, "");
    } else if (field === 'idNumber') {
      finalValue = value.replace(/[^0-9]/g, "");
    }

    const newPassengers = [...passengers];
    newPassengers[index] = { ...newPassengers[index], [field]: finalValue };

    if (field === 'idNumber') {
      if (!finalValue) {
        newPassengers[index].name = '';
        newPassengers[index].email = '';
      } else {
        const found = integrantes.find(i => i.idNumber === finalValue);
        if (found) {
          newPassengers[index].name = found.name;
          newPassengers[index].email = found.email;
        } else {
          // If not found, keep the name and email as they are (or clear them if you prefer)
          // We'll leave them to allow manual entry if needed, but usually they should be cleared
          // if the ID doesn't match. Let's clear them to be safe and force correct IDs.
          newPassengers[index].name = '';
          newPassengers[index].email = '';
        }
      }
    }
    setPassengers(newPassengers);
  };

  const addPassenger = () => {
    if (passengers.length < MAX_PASSENGERS) {
      setPassengers([...passengers, { name: '', idNumber: '', email: '' }]);
    }
  };

  const removePassenger = (index: number) => {
    if (passengers.length > 1) {
      setPassengers(passengers.filter((_, i) => i !== index));
    }
  };

  const handleAddVariousCC = () => {
    if (!variousCCInput.trim()) return;
    const input = variousCCInput.trim();

    // Attempt to find a match in the allowed cost centers for the business unit
    // We try original input and unpadded version if input starts with '0'
    let match = filteredCostCenters.find(c => c.code === input);

    if (!match && input.startsWith('0')) {
      const unpadded = input.replace(/^0+/, '');
      match = filteredCostCenters.find(c => c.code === unpadded);
    }

    if (!match) {
      alert(`El centro de costos '${input}' no es válido para la unidad de negocio '${formData.businessUnit}'`);
      return;
    }

    // Always store the code as it exists in the database
    const codeToStore = match.code;

    if (!variousCCList.includes(codeToStore)) {
      setVariousCCList([...variousCCList, codeToStore]);
    }
    setVariousCCInput('');
  };

  const handleRemoveVariousCC = (codeToRemove: string) => {
    setVariousCCList(variousCCList.filter(c => c !== codeToRemove));
  };

  useEffect(() => {
    if (requiresHotel && tripType === 'ROUND_TRIP' && !manualNights && formData.departureDate && formData.returnDate) {
      const d1 = new Date(formData.departureDate);
      const d2 = new Date(formData.returnDate);
      const diffDays = Math.ceil(Math.abs(d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      setNumberOfNights(diffDays > 0 ? diffDays : 0);
    }
  }, [requiresHotel, tripType, manualNights, formData.departureDate, formData.returnDate]);

  const isPassengerInDb = (idNumber: string) => integrantes.some(i => i.idNumber === idNumber);

  // Gemini Enhancement
  const handleEnhanceText = async () => {
    if (!changeReason.trim() || !initialData) return;
    setGeminiLoading(true);
    try {
      const enhanced = await gasService.enhanceTextWithGemini(initialData, changeReason);
      setChangeReason(enhanced);
    } catch (e) {
      console.error(e);
    } finally {
      setGeminiLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.costCenter === 'VARIOS' && variousCCList.length === 0) {
      alert('Debe agregar al menos un centro de costos en la lista de VARIOS.');
      return;
    }
    if (tripType === 'ROUND_TRIP' && (!formData.returnDate)) {
      alert('Para vuelos de ida y regreso, la fecha de retorno es obligatoria.');
      return;
    }
    if (tripType === 'ROUND_TRIP' && formData.departureDate && formData.returnDate) {
      if (new Date(formData.returnDate) < new Date(formData.departureDate)) {
        alert('La fecha de regreso no puede ser anterior a la fecha de ida.');
        return;
      }
    }
    if (requiresHotel) {
      if (numberOfNights <= 0) {
        alert('El número de noches de hospedaje debe ser mayor a 0.');
        return;
      }

      if (tripType === 'ROUND_TRIP' && formData.departureDate && formData.returnDate) {
        const d1 = new Date(formData.departureDate); d1.setHours(0, 0, 0, 0);
        const d2 = new Date(formData.returnDate); d2.setHours(0, 0, 0, 0);
        const tripDays = Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        if (numberOfNights > tripDays) {
          alert(`El número de noches (${numberOfNights}) no puede ser mayor a los días del viaje (${tripDays} días).`);
          return;
        }
      } else if (tripType === 'ONE_WAY') {
        if (numberOfNights > 100) {
          alert('Para viajes de solo ida, el máximo permitido de hospedaje es 100 noches.');
          return;
        }
      }
    }
    if (isModification && !changeReason.trim()) {
      alert('Por favor describa el motivo del cambio en la sección final.');
      return;
    }

    setLoading(true);

    try {
      // 1. Resolve Cost Center Name
      let costCenterName = '';
      if (formData.costCenter === 'VARIOS') {
        costCenterName = 'Múltiples Centros de Costo';
      } else {
        const ccObj = masterData.find(cc => cc.code === formData.costCenter);
        costCenterName = ccObj ? ccObj.name : '';
      }

      // 2. Resolve Approver
      let approverName = 'Por Definir';
      let approverEmail = 'Por Definir';

      if (passengers.length > 0 && passengers[0].idNumber) {
        const p1 = integrantes.find(i => i.idNumber === passengers[0].idNumber);
        if (p1) {
          approverName = p1.approverName;
          approverEmail = p1.approverEmail;
        }
      }

      const getVariousCCFormatted = () => {
        if (formData.costCenter !== 'VARIOS' || variousCCList.length === 0) return undefined;
        return variousCCList.map(code => {
          const ccObj = masterData.find(cc => cc.code === code);
          return ccObj ? `${code} - ${ccObj.name}` : code;
        }).join(', ');
      };

      const payload: Partial<TravelRequest> = {
        ...formData,
        departureDate: formatToDDMMYYYY(formData.departureDate),
        isInternational,
        policyViolation,
        costCenterName,
        approverName,
        approverEmail,
        returnDate: tripType === 'ONE_WAY' ? '' : formatToDDMMYYYY(formData.returnDate),
        returnTimePreference: tripType === 'ONE_WAY' ? '' : formData.returnTimePreference,
        requesterEmail: userEmail,
        passengers,
        requiresHotel,
        nights: requiresHotel ? numberOfNights : 0,
        status: isModification ? RequestStatus.PENDING_CHANGE_APPROVAL : RequestStatus.PENDING_OPTIONS,
        variousCostCenters: getVariousCCFormatted(),
        timestamp: new Date().toISOString()
      };

      // GENERATE HTML TEMPLATE CLIENT-SIDE
      // If modification, calculate details for the banner
      if (isModification && initialData) {
        payload.parentWasReserved = initialData.status === RequestStatus.RESERVED;
        payload.parentTimestamp = initialData.timestamp;
      }

      const emailHtml = generateTravelRequestEmail({
        ...payload,
        relatedRequestId: isModification && initialData ? initialData.requestId : undefined,
        changeReason: changeReason,
        parentWasReserved: payload.parentWasReserved,
        parentTimestamp: payload.parentTimestamp
      }, isModification);

      if (isModification && initialData) {
        await gasService.requestModification(initialData.requestId, payload, changeReason, emailHtml);
      } else {
        await gasService.createRequest(payload, emailHtml);
      }

      onSuccess();
    } catch (error) {
      alert('Error: ' + error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white shadow-lg rounded-lg overflow-hidden">

      {/* HEADER WITH CONTEXT BANNER */}
      <div className="bg-gray-50 border-b border-gray-200">
        <div className="px-6 py-4">
          <h2 className="text-lg font-medium text-gray-900">
            {isModification ? 'Solicitar Modificación de Viaje' : 'Nueva Solicitud de Viaje'}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {isModification ? 'Actualice los datos necesarios. Se generará una nueva solicitud vinculada a la original.' : 'Diligencie todos los campos obligatorios.'}
          </p>
        </div>

        {isModification && initialData && (
          <div className="bg-yellow-50 px-6 py-2 border-t border-yellow-200 flex items-center gap-2">
            <span className="text-lg">⚠️</span>
            <div className="text-sm text-yellow-800">
              <span className="font-bold">Estás modificando la solicitud <span className="underline">{initialData.requestId}</span>.</span>
              {initialData.status === RequestStatus.RESERVED && (
                <div className="text-red-600 font-bold mt-1">
                  ¡ATENCIÓN! La solicitud original ya tiene tiquetes comprados. Este cambio generará costos extra.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-8">

        {/* Section 1: General Info */}
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700">Empresa *</label>
              <select name="company" required className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 text-gray-900" value={formData.company} onChange={handleInputChange}>
                <option value="">Seleccione...</option>
                {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Sede *</label>
              <select name="site" required className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 text-gray-900" value={formData.site} onChange={handleInputChange}>
                <option value="">Seleccione...</option>
                {SITES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">Unidad de Negocio *</label>
                <select name="businessUnit" required className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 text-gray-900" value={formData.businessUnit} onChange={handleInputChange} disabled={availableBusinessUnits.length === 0}>
                  <option value="">{availableBusinessUnits.length === 0 ? 'Cargando...' : 'Seleccione...'}</option>
                  {availableBusinessUnits.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Orden de Trabajo (Opcional)</label>
                <input type="text" name="workOrder" className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 text-gray-900" value={formData.workOrder} onChange={handleInputChange} />
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">Centro de Costos *</label>
                <select name="costCenter" required className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 text-gray-900" value={formData.costCenter} onChange={handleInputChange} disabled={!formData.businessUnit || filteredCostCenters.length === 0}>
                  <option value="">{!formData.businessUnit ? 'Seleccione Unidad Primero' : 'Seleccione...'}</option>
                  {filteredCostCenters.map(c => (
                    <option key={c.code} value={c.code}>{c.code === 'VARIOS' ? 'VARIOS' : `${c.code} - ${c.name || ''}`}</option>
                  ))}
                </select>
                {formData.costCenter === 'VARIOS' && (
                  <div className="mt-3 bg-gray-50 p-3 rounded-md border border-gray-200">
                    <div className="flex gap-2 mb-2">
                      <input type="text" className="flex-1 rounded-md border-gray-300 shadow-sm border p-1 bg-white text-gray-900" placeholder="Ej: 0101" value={variousCCInput} onChange={(e) => setVariousCCInput(e.target.value)} />
                      <button type="button" onClick={handleAddVariousCC} className="bg-brand-red text-white text-xs px-3 py-1 rounded font-bold">Agregar</button>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {variousCCList.map((cc, idx) => {
                        const ccObj = filteredCostCenters.find(c => c.code === cc);
                        return (
                          <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 border border-gray-300">
                            {cc}{ccObj ? ` - ${ccObj.name}` : ''}
                            <button type="button" onClick={() => handleRemoveVariousCC(cc)} className="ml-1 text-gray-500 hover:text-red-500 font-bold">✕</button>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <hr />

        {/* Section 2: Passengers */}
        <div>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-md font-medium text-gray-900">Pasajeros ({passengers.length})</h3>
            {passengers.length < MAX_PASSENGERS && (
              <button type="button" onClick={addPassenger} className="text-sm text-brand-red font-semibold hover:text-red-700">+ Agregar Pasajero</button>
            )}
          </div>
          <div className="space-y-4">
            {passengers.map((p, idx) => (
              <div key={idx} className="flex flex-col sm:flex-row gap-4 items-start sm:items-end bg-gray-50 p-4 rounded-md">
                <div className="flex-1 w-full sm:w-auto">
                  <label className="block text-xs font-medium text-gray-500">Cédula *</label>
                  <input type="text" required className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 text-gray-900" value={p.idNumber} onChange={(e) => handlePassengerChange(idx, 'idNumber', e.target.value)} />
                </div>
                <div className="flex-1 w-full sm:w-auto">
                  <label className="block text-xs font-medium text-gray-500">Nombre *</label>
                  <input type="text" required readOnly={isPassengerInDb(p.idNumber)} className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm border p-2 text-gray-900 ${isPassengerInDb(p.idNumber) ? 'bg-gray-200 cursor-not-allowed' : 'bg-white'}`} value={p.name} onChange={(e) => handlePassengerChange(idx, 'name', e.target.value)} />
                </div>
                {passengers.length > 1 && (
                  <button type="button" onClick={() => removePassenger(idx)} className="text-red-500 p-2 hover:bg-red-50 rounded">🗑️</button>
                )}
              </div>
            ))}
          </div>
        </div>

        <hr />

        {/* Section 3: Itinerary */}
        <div>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-md font-medium text-gray-900">Itinerario</h3>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isInternational"
                  checked={isInternational}
                  readOnly
                  disabled
                  className="focus:ring-brand-red h-4 w-4 text-brand-red border-gray-300 rounded bg-gray-100 cursor-not-allowed"
                />
                <label htmlFor="isInternational" className="text-sm font-bold text-blue-900">¿Es viaje internacional? (Auto)</label>
              </div>
              <div className="h-6 w-px bg-gray-300 mx-2"></div>
              <div className="flex bg-gray-200 p-1 rounded-lg">
                <button type="button" onClick={() => setTripType('ROUND_TRIP')} className={`px-3 py-1 text-xs font-bold rounded-md transition ${tripType === 'ROUND_TRIP' ? 'bg-white shadow text-brand-red' : 'text-gray-500'}`}>Ida y Regreso</button>
                <button type="button" onClick={() => setTripType('ONE_WAY')} className={`px-3 py-1 text-xs font-bold rounded-md transition ${tripType === 'ONE_WAY' ? 'bg-white shadow text-brand-red' : 'text-gray-500'}`}>Solo Ida</button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700">Ciudad Origen *</label>
              <input
                list="cities-list"
                name="origin"
                required
                placeholder={isCitiesLoading ? "Cargando ciudades..." : "Escriba y seleccione ciudad..."}
                className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 uppercase text-gray-900"
                value={formData.origin}
                onChange={handleInputChange}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Ciudad Destino *</label>
              <input
                list="cities-list"
                name="destination"
                required
                placeholder={isCitiesLoading ? "Cargando ciudades..." : "Escriba y seleccione ciudad..."}
                className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 uppercase text-gray-900"
                value={formData.destination}
                onChange={handleInputChange}
              />
            </div>

            <datalist id="cities-list">
              {cities.map((c, i) => (
                <option key={i} value={`${c.city} (${c.country})`} />
              ))}
            </datalist>
            <div>
              <label className="block text-sm font-medium text-gray-700">Fecha Ida *</label>
              <input type="date" name="departureDate" required min={new Date().toISOString().split('T')[0]} style={{ colorScheme: 'light' }} className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 text-gray-900 cursor-pointer" value={formData.departureDate} onChange={handleInputChange} onClick={handleOpenPicker} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Hora Llegada Vuelo Ida (Pref.)</label>
              <input type="time" name="departureTimePreference" style={{ colorScheme: 'light' }} className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 text-gray-900 cursor-pointer" value={formData.departureTimePreference} onChange={handleInputChange} onClick={handleOpenPicker} />
            </div>
            {tripType === 'ROUND_TRIP' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Fecha Vuelta *</label>
                  <input
                    type="date"
                    name="returnDate"
                    required
                    disabled={!formData.departureDate}
                    min={formData.departureDate || new Date().toISOString().split('T')[0]}
                    style={{ colorScheme: 'light' }}
                    className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 text-gray-900 ${!formData.departureDate ? 'bg-gray-100 cursor-not-allowed' : 'cursor-pointer animate-pulse-subtle'}`}
                    value={formData.returnDate}
                    onChange={handleInputChange}
                    onClick={handleOpenPicker}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Hora Llegada Vuelo Vuelta (Pref.)</label>
                  <input type="time" name="returnTimePreference" style={{ colorScheme: 'light' }} className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 text-gray-900 cursor-pointer" value={formData.returnTimePreference} onChange={handleInputChange} onClick={handleOpenPicker} />
                </div>
              </>
            )}
          </div>
        </div>

        <hr />

        {/* Section 4: Hotel */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center h-5">
              <input id="hotel" type="checkbox" className="focus:ring-brand-red h-4 w-4 text-brand-red border-gray-300 rounded" checked={requiresHotel} onChange={(e) => setRequiresHotel(e.target.checked)} />
            </div>
            <div className="text-sm"><label htmlFor="hotel" className="font-medium text-gray-700">¿Requiere Hospedaje?</label></div>
          </div>
          {requiresHotel && (
            <div className="bg-blue-50 p-4 rounded-md border border-blue-100 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Nombre del Hotel (Preferencia) *</label>
                <input type="text" name="hotelName" required className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 uppercase text-gray-900" value={formData.hotelName} onChange={handleInputChange} />
              </div>
              <div className="bg-white p-3 rounded border border-gray-200">
                {tripType === 'ROUND_TRIP' && (
                  <div className="flex items-center gap-2 mb-2">
                    <input id="manualNights" type="checkbox" className="focus:ring-brand-red h-4 w-4 text-brand-red border-gray-300 rounded" checked={manualNights} onChange={(e) => setManualNights(e.target.checked)} />
                    <label htmlFor="manualNights" className="text-xs text-gray-700 font-bold">¿Fechas de hospedaje diferentes al vuelo?</label>
                  </div>
                )}
                {manualNights || tripType === 'ONE_WAY' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Número de Noches *</label>
                    <input type="number" min="1" required className="mt-1 block w-32 bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 text-gray-900" value={numberOfNights} onChange={(e) => setNumberOfNights(parseInt(e.target.value) || 0)} />
                  </div>
                ) : (
                  <div><span className="text-sm text-gray-600">Noches calculadas: </span><span className="font-bold text-gray-900 text-lg">{numberOfNights}</span></div>
                )}
              </div>
            </div>
          )}
        </div>

        <hr />

        {/* Section 5: Observations */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Motivo del Viaje / Observaciones (Describa el propósito para el aprobador)</label>
          <textarea name="comments" rows={3} className="block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 text-gray-900" value={formData.comments} onChange={handleInputChange} />
        </div>

        {/* Section 6: MODIFICATION REASON (Only if isModification) */}
        {isModification && (
          <div className="bg-blue-50 p-6 rounded-md border border-blue-200 mt-6">
            <h4 className="text-sm font-bold text-blue-800 uppercase mb-4 border-b border-blue-200 pb-2">Motivo del Cambio (Obligatorio)</h4>
            <div className="mb-4">
              <label className="block text-xs text-gray-600 mb-1">Escriba qué desea cambiar y por qué</label>
              <div className="flex gap-2">
                <textarea className="flex-1 p-2 border rounded text-sm bg-white text-gray-900" rows={3} value={changeReason} onChange={(e) => setChangeReason(e.target.value)} required />
                <button type="button" onClick={handleEnhanceText} disabled={geminiLoading || !changeReason} className="bg-purple-600 text-white px-3 rounded font-bold text-xs hover:bg-purple-700 transition flex flex-col items-center justify-center min-w-[120px]">
                  {geminiLoading ? '...' : 'Mejorar con IA (Opcional)'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ACTIONS & ALERTS */}
        <div className="pt-4 space-y-4">

          {policyViolation && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-md animate-pulse">
              <div className="flex">
                <div className="flex-shrink-0">
                  <span className="text-yellow-400 text-xl">⚠️</span>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-yellow-700 font-bold">
                    Solicitud Fuera de Política de Anticipación
                  </p>
                  <p className="text-xs text-yellow-600 mt-1">
                    {isInternational
                      ? "Los viajes internacionales requieren al menos 30 días de anticipación."
                      : "Los viajes nacionales requieren al menos 8 días de anticipación."
                    }
                    <br />Esta solicitud requerirá aprobaciones adicionales.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button type="button" onClick={onCancel} className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50" disabled={loading}>
              Cancelar
            </button>
            <button type="submit" className="px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-brand-red hover:bg-red-700 focus:outline-none disabled:opacity-50" disabled={loading}>
              {loading ? 'Procesando...' : (isModification ? 'Confirmar Cambio' : 'Crear Solicitud')}
            </button>
          </div>
        </div>

      </form>
    </div>
  );
};
