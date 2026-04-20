
import React, { useState, useEffect, useMemo } from 'react';
import { TravelRequest, Passenger, RequestStatus, CostCenterMaster, Integrant, CityMaster } from '../types';
import { COMPANIES, MAX_PASSENGERS } from '../constants';
import { gasService } from '../services/gasService';
import { generateTravelRequestEmail } from '../utils/EmailGenerator';
import { formatToYYYYMMDD, formatToDDMMYYYY, parseDate } from '../utils/dateUtils';
import { CityCombobox } from './CityCombobox';

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
type RequestMode = 'FLIGHT' | 'HOTEL_ONLY';

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

  // Request mode: FLIGHT (viaje normal) or HOTEL_ONLY (solo hospedaje)
  const [requestMode, setRequestMode] = useState<RequestMode>(
    initialData?.requestMode === 'HOTEL_ONLY' ? 'HOTEL_ONLY' : 'FLIGHT'
  );
  const isHotelOnly = requestMode === 'HOTEL_ONLY';

  const [tripType, setTripType] = useState<TripType>(
    initialData ? (initialData.returnDate ? 'ROUND_TRIP' : 'ONE_WAY') : 'ROUND_TRIP'
  );

  // Hotel-only always requires hotel; for flights it's a toggle
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

  // Sites (sedes) loaded dynamically from MISC sheet
  const [sites, setSites] = useState<string[]>([]);
  const [isSitesLoading, setIsSitesLoading] = useState<boolean>(true);

  const [variousCCList, setVariousCCList] = useState<string[]>(
    initialData?.variousCostCenters ? initialData.variousCostCenters.split(',').map(s => s.split(' - ')[0].trim()) : []
  );
  const [variousCCInput, setVariousCCInput] = useState<string>('');

  // Modification Reason State
  const [changeReason, setChangeReason] = useState('');

  // Co-approver rules from backend
  const [coApproverRules, setCoApproverRules] = useState<{ principalEmail: string, coApproverName: string, coApproverEmail: string, condition: string }[]>([]);
  // Executive emails (CEO + Director CDS) — needed to detect special cases
  const [executiveEmails, setExecutiveEmails] = useState<{ ceoEmail: string, directorEmail: string }>({ ceoEmail: '', directorEmail: '' });

  useEffect(() => {
    gasService.getCoApproverRules().then(setCoApproverRules).catch(() => {});
    gasService.getExecutiveEmails().then(setExecutiveEmails).catch(() => {});
    gasService.getSites()
      .then(s => setSites(Array.isArray(s) ? s : []))
      .catch(() => setSites([]))
      .finally(() => setIsSitesLoading(false));
  }, []);

  // The effective requester email — for modifications it's the original requester,
  // otherwise it's the currently logged-in user.
  const effectiveRequesterEmail = (isModification && initialData?.requesterEmail) ? initialData.requesterEmail : userEmail;

  // Resolve full approver chain preview, with awareness of CEO/CDS deduplication rules.
  // Returns one entry per unique person, with one or more "roles" they cover.
  // Special cases:
  // - If the requester IS the CEO → single self-approval entry, no other approvers shown.
  // - If the requester IS the CDS → same.
  // - If the area approver IS the CEO/CDS → that person gets BOTH "Área" and "Ejecutivo" labels (single email).
  const approverPreview = useMemo(() => {
    const requesterLower = String(effectiveRequesterEmail || '').toLowerCase().trim();
    const ceoLower = (executiveEmails.ceoEmail || '').toLowerCase().trim();
    const cdsLower = (executiveEmails.directorEmail || '').toLowerCase().trim();
    const requesterIsCeo = !!ceoLower && requesterLower === ceoLower;
    const requesterIsCds = !!cdsLower && requesterLower === cdsLower;

    type Entry = { name: string; email: string; roles: string[]; note?: string };

    // Special case 1: requester is CEO → only the CEO needs to approve
    if (requesterIsCeo) {
      return [{
        name: 'Tú mismo (CEO)',
        email: ceoLower,
        roles: ['Aprobación única'],
        note: 'Como CEO, tu sola aprobación basta para esta solicitud — no se notifica a nadie más.'
      }] as Entry[];
    }

    // Special case 2: requester is CDS → only the CDS needs to approve
    if (requesterIsCds) {
      return [{
        name: 'Tú mismo (Director CDS)',
        email: cdsLower,
        roles: ['Aprobación única'],
        note: 'Como Director CDS, tu sola aprobación basta para esta solicitud — no se notifica a nadie más.'
      }] as Entry[];
    }

    // Standard case: dedupe by email so a person who is BOTH area approver AND
    // CEO/CDS only appears once with a combined role label.
    const map = new Map<string, Entry>();

    // 1. Area approver(s) from the first passenger's integrant lookup
    if (passengers.length > 0 && passengers[0].idNumber) {
      const p1 = integrantes.find(i => i.idNumber === passengers[0].idNumber);
      if (p1 && p1.approverEmail) {
        const lower = p1.approverEmail.toLowerCase().trim();
        if (lower && !map.has(lower)) {
          map.set(lower, { name: p1.approverName || lower, email: lower, roles: ['Área'] });
        }

        // Co-approvers from REGLAS_COAPROBADOR (international only)
        if (isInternational) {
          const matches = coApproverRules.filter(r =>
            r.principalEmail === lower && r.condition === 'INTERNACIONAL'
          );
          matches.forEach(rule => {
            const coLower = rule.coApproverEmail.toLowerCase().trim();
            if (coLower && !map.has(coLower)) {
              map.set(coLower, { name: rule.coApproverName, email: coLower, roles: ['Área (co-aprobador)'] });
            }
          });
        }
      }
    }

    // 2. Executive approvers (CEO + CDS) only if international
    if (isInternational) {
      if (ceoLower) {
        if (map.has(ceoLower)) {
          // CEO is also area approver — append role to existing entry, single email
          const existing = map.get(ceoLower)!;
          existing.roles.push('Ejecutivo (CEO)');
          existing.note = 'Cubre área y aprobación ejecutiva con un solo click.';
        } else {
          map.set(ceoLower, { name: 'CEO', email: ceoLower, roles: ['Ejecutivo (CEO)'] });
        }
      }
      if (cdsLower) {
        if (map.has(cdsLower)) {
          const existing = map.get(cdsLower)!;
          existing.roles.push('Ejecutivo (Director CDS)');
          existing.note = 'Cubre área y aprobación ejecutiva con un solo click.';
        } else {
          map.set(cdsLower, { name: 'Director CDS', email: cdsLower, roles: ['Ejecutivo (Director CDS)'] });
        }
      }
    }

    return Array.from(map.values());
  }, [passengers, integrantes, isInternational, coApproverRules, executiveEmails, effectiveRequesterEmail]);

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

  // Handle Request Mode Change (HOTEL_ONLY)
  useEffect(() => {
    if (isHotelOnly) {
      // Hotel-only: always requires hotel, clear flight-specific fields, no origin
      setRequiresHotel(true);
      setManualNights(false);
      setFormData(prev => ({
        ...prev,
        origin: '',
        departureTimePreference: '',
        returnTimePreference: ''
      }));
    }
  }, [isHotelOnly]);

  // AUTO-INTERNATIONAL LOGIC
  useEffect(() => {
    if (isHotelOnly) {
      // Hotel-only: internacional si la ciudad del hospedaje NO es colombiana
      const destCity = cities.find(c => `${c.city}, ${c.country}` === formData.destination);
      if (destCity) {
        setIsInternational(destCity.country !== 'COLOMBIA');
      }
    } else {
      // Viaje normal: internacional si cualquiera de las dos ciudades NO es colombiana
      const originCity = cities.find(c => `${c.city}, ${c.country}` === formData.origin);
      const destCity = cities.find(c => `${c.city}, ${c.country}` === formData.destination);
      if (originCity && destCity) {
        const autoIsInternational = originCity.country !== 'COLOMBIA' || destCity.country !== 'COLOMBIA';
        setIsInternational(autoIsInternational);
      }
    }
  }, [formData.origin, formData.destination, cities, isHotelOnly]);

  // POLICY VALIDATION LOGIC
  // FIX (#A4): usar parseDate en vez de `new Date(YYYY-MM-DD)`. El string ISO
  // sin hora se parseaba como UTC, produciendo desfase de 1 día al borde del
  // día calendario en GMT-5. parseDate interpreta la fecha en zona local,
  // consistente con el resto del código y con lo que ve el usuario.
  useEffect(() => {
    if (formData.departureDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const depDate = parseDate(formData.departureDate);
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
      // Allow letters, numbers, spaces, and commas for city/country
      finalValue = value.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9\s,]/g, "");
    }

    if (name === 'businessUnit') {
      setFormData(prev => ({ ...prev, [name]: finalValue, costCenter: '' }));
      setVariousCCList([]);
    } else {
      setFormData(prev => ({ ...prev, [name]: finalValue }));
    }
  };

  const handleCityChange = (fieldName: string, value: string) => {
    setFormData(prev => ({ ...prev, [fieldName]: value }));
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
        } else if (index === 0) {
          // Pasajero 1 DEBE venir del directorio (determina el aprobador de área).
          // Si la cédula no matchea, se limpia para forzar corrección.
          newPassengers[index].name = '';
          newPassengers[index].email = '';
        } else {
          // Pasajeros 2-5: permitir input manual cuando la cédula no está en el
          // directorio (p.ej. un cliente externo, un proveedor invitado). El
          // usuario podrá escribir nombre + correo a mano.
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
    // Auto-calcular noches: hotel-only siempre (check-in/check-out), round-trip cuando no es manual
    const shouldAutoCalc = (isHotelOnly || (requiresHotel && tripType === 'ROUND_TRIP' && !manualNights));
    if (shouldAutoCalc && formData.departureDate && formData.returnDate) {
      const d1 = new Date(formData.departureDate);
      const d2 = new Date(formData.returnDate);
      const diffDays = Math.ceil(Math.abs(d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      setNumberOfNights(diffDays > 0 ? diffDays : 0);
    }
  }, [requiresHotel, tripType, manualNights, formData.departureDate, formData.returnDate, isHotelOnly]);

  const isPassengerInDb = (idNumber: string) => integrantes.some(i => i.idNumber === idNumber);

  // El primer pasajero DEBE estar en el directorio: de él se deriva el
  // aprobador de área. Si no existe, el backend queda con approverEmail='Por
  // Definir' y la solicitud nunca puede avanzar. Bloqueamos el submit.
  const firstPassengerValid = passengers.length > 0
    && !!passengers[0].idNumber
    && isPassengerInDb(passengers[0].idNumber);

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

    // STRICT CITY VALIDATION
    const validCityOptions = cities.map(c => `${c.city}, ${c.country}`);
    const isDestValid = validCityOptions.includes(formData.destination || '');

    // Origin solo se valida para vuelos (hotel-only no tiene origin)
    if (!isHotelOnly) {
      const isOriginValid = validCityOptions.includes(formData.origin || '');
      if (!isOriginValid) {
        alert(`La ciudad de origen "${formData.origin}" no es válida. Debe seleccionarla de la lista.`);
        return;
      }
    }
    if (!isDestValid) {
      alert(isHotelOnly
        ? `La ciudad del hospedaje "${formData.destination}" no es válida. Debe seleccionarla de la lista.`
        : `La ciudad de destino "${formData.destination}" no es válida. Debe seleccionarla de la lista.`
      );
      return;
    }

    if (formData.costCenter === 'VARIOS' && variousCCList.length === 0) {
      alert('Debe agregar al menos un centro de costos en la lista de VARIOS.');
      return;
    }
    // GUARD: primer pasajero obligatoriamente en directorio (define el aprobador).
    if (!firstPassengerValid) {
      alert(
        'El primer pasajero debe estar registrado en el directorio de usuarios.\n\n' +
        'Su cédula determina quién aprobará la solicitud. Si la persona que va a viajar ' +
        'no aparece en el directorio, contacte al área de viajes o al administrador del ' +
        'aplicativo para que la registre antes de continuar.'
      );
      return;
    }
    // Fecha de retorno obligatoria para round-trip y hotel-only (check-out)
    if ((isHotelOnly || tripType === 'ROUND_TRIP') && !formData.returnDate) {
      alert(isHotelOnly ? 'La fecha de check-out es obligatoria.' : 'Para vuelos de ida y regreso, la fecha de retorno es obligatoria.');
      return;
    }
    if ((isHotelOnly || tripType === 'ROUND_TRIP') && formData.departureDate && formData.returnDate) {
      if (new Date(formData.returnDate) < new Date(formData.departureDate)) {
        alert(isHotelOnly ? 'La fecha de check-out no puede ser anterior a la de check-in.' : 'La fecha de regreso no puede ser anterior a la fecha de ida.');
        return;
      }
    }
    if (requiresHotel || isHotelOnly) {
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
        requestMode: requestMode,
        departureDate: formatToDDMMYYYY(formData.departureDate),
        isInternational,
        policyViolation,
        costCenterName,
        approverName,
        approverEmail,
        origin: isHotelOnly ? '' : formData.origin,
        // Hotel-only: returnDate = check-out (PRESERVAR). Solo ida: returnDate vacío.
        returnDate: (!isHotelOnly && tripType === 'ONE_WAY') ? '' : formatToDDMMYYYY(formData.returnDate),
        returnTimePreference: (isHotelOnly || tripType === 'ONE_WAY') ? '' : formData.returnTimePreference,
        departureTimePreference: isHotelOnly ? '' : formData.departureTimePreference,
        requesterEmail: isModification && initialData?.requesterEmail ? initialData.requesterEmail : userEmail,
        passengers,
        requiresHotel: isHotelOnly ? true : requiresHotel,
        nights: (isHotelOnly || requiresHotel) ? numberOfNights : 0,
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
              <select name="site" required className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 text-gray-900" value={formData.site} onChange={handleInputChange} disabled={isSitesLoading}>
                <option value="">{isSitesLoading ? 'Cargando...' : 'Seleccione...'}</option>
                {sites.map(s => <option key={s} value={s}>{s}</option>)}
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
                      <input
                        type="text"
                        className="flex-1 rounded-md border-gray-300 shadow-sm border p-1 bg-white text-gray-900"
                        placeholder="Ej: 0101"
                        value={variousCCInput}
                        onChange={(e) => setVariousCCInput(e.target.value)}
                        onKeyDown={(e) => {
                          // FIX (#A11): Enter dentro de <form> dispara submit por default.
                          // Aquí queremos que Enter agregue el CC, no envíe el formulario.
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddVariousCC();
                          }
                        }}
                      />
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
            {passengers.map((p, idx) => {
              const inDb = isPassengerInDb(p.idNumber);
              // Pasajeros 2-5 pueden ser externos: si la cédula no está en el
              // directorio, habilitamos inputs manuales para nombre + correo.
              const allowManual = idx > 0 && p.idNumber && !inDb;
              // Pasajero 1 bloqueante: si tiene cédula pero no matchea el
              // directorio, muestra error rojo (define el aprobador de área).
              const firstPassengerMissing = idx === 0 && p.idNumber && !inDb;
              return (
              <div key={idx} className="flex flex-col gap-3 bg-gray-50 p-4 rounded-md">
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
                  <div className="flex-1 w-full sm:w-auto">
                    <label className="block text-xs font-medium text-gray-500">Cédula *</label>
                    <input type="text" required className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 text-gray-900" value={p.idNumber} onChange={(e) => handlePassengerChange(idx, 'idNumber', e.target.value)} />
                  </div>
                  <div className="flex-1 w-full sm:w-auto">
                    <label className="block text-xs font-medium text-gray-500">Nombre *</label>
                    <input type="text" required readOnly={inDb} className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm border p-2 text-gray-900 ${inDb ? 'bg-gray-200 cursor-not-allowed' : 'bg-white'}`} value={p.name} onChange={(e) => handlePassengerChange(idx, 'name', e.target.value)} />
                  </div>
                  {passengers.length > 1 && (
                    <button type="button" onClick={() => removePassenger(idx)} className="text-red-500 p-2 hover:bg-red-50 rounded">🗑️</button>
                  )}
                </div>
                {allowManual && (
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-500">
                        Correo del pasajero {idx + 1} (opcional)
                      </label>
                      <input
                        type="email"
                        className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 text-gray-900"
                        value={p.email}
                        onChange={(e) => handlePassengerChange(idx, 'email', e.target.value.toLowerCase().trim())}
                        placeholder="externo@ejemplo.com"
                      />
                      <p className="text-[11px] text-amber-700 mt-1">
                        Esta cédula no está en el directorio. Escriba manualmente el nombre y correo (si aplica) del pasajero externo.
                      </p>
                    </div>
                  </div>
                )}
                {firstPassengerMissing && (
                  <div className="rounded-md border border-red-300 bg-red-50 p-3">
                    <p className="text-xs text-red-800 font-semibold">
                      ⚠️ Cédula no encontrada en el directorio.
                    </p>
                    <p className="text-[11px] text-red-700 mt-1 leading-relaxed">
                      El primer pasajero debe estar registrado — de su ficha se toma el aprobador
                      que autorizará la solicitud. Verifique el número; si la persona no está
                      registrada, contacte al área de viajes o al administrador del aplicativo
                      para que la agreguen antes de continuar.
                    </p>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </div>

        <hr />

        {/* Section 3: Mode + Itinerary */}
        <div>
          <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
            <h3 className="text-md font-medium text-gray-900">{isHotelOnly ? 'Hospedaje' : 'Itinerario'}</h3>
            <div className="flex items-center gap-4 flex-wrap">
              {/* International badge (auto) */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isInternational"
                  checked={isInternational}
                  readOnly
                  disabled
                  className="focus:ring-brand-red h-4 w-4 text-brand-red border-gray-300 rounded bg-gray-100 cursor-not-allowed"
                />
                <label htmlFor="isInternational" className="text-sm font-bold text-blue-900">¿Internacional? (Auto)</label>
              </div>
              <div className="h-6 w-px bg-gray-300"></div>
              {/* MODE PILLS: 3 opciones */}
              <div className="flex bg-gray-200 p-1 rounded-lg">
                <button type="button" onClick={() => { setRequestMode('FLIGHT'); setTripType('ROUND_TRIP'); }}
                  className={`px-3 py-1 text-xs font-bold rounded-md transition ${requestMode === 'FLIGHT' && tripType === 'ROUND_TRIP' ? 'bg-white shadow text-brand-red' : 'text-gray-500'}`}>
                  ✈️ Ida y Regreso
                </button>
                <button type="button" onClick={() => { setRequestMode('FLIGHT'); setTripType('ONE_WAY'); }}
                  className={`px-3 py-1 text-xs font-bold rounded-md transition ${requestMode === 'FLIGHT' && tripType === 'ONE_WAY' ? 'bg-white shadow text-brand-red' : 'text-gray-500'}`}>
                  ✈️ Solo Ida
                </button>
                <button type="button" onClick={() => setRequestMode('HOTEL_ONLY')}
                  className={`px-3 py-1 text-xs font-bold rounded-md transition ${isHotelOnly ? 'bg-white shadow text-brand-red' : 'text-gray-500'}`}>
                  🏨 Solo Hospedaje
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Ciudad Origen — solo para vuelos */}
            {!isHotelOnly && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Ciudad Origen *</label>
                <CityCombobox
                  name="origin"
                  value={formData.origin || ''}
                  cities={cities}
                  isLoading={isCitiesLoading}
                  onChange={handleCityChange}
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700">{isHotelOnly ? 'Ciudad del Hospedaje *' : 'Ciudad Destino *'}</label>
              <CityCombobox
                name="destination"
                value={formData.destination || ''}
                cities={cities}
                isLoading={isCitiesLoading}
                onChange={handleCityChange}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">{isHotelOnly ? 'Fecha Check-in *' : 'Fecha Ida *'}</label>
              <input type="date" name="departureDate" required min={new Date().toISOString().split('T')[0]} style={{ colorScheme: 'light' }} className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 text-gray-900 cursor-pointer" value={formData.departureDate} onChange={handleInputChange} onClick={handleOpenPicker} />
            </div>
            {/* Hora vuelo ida — solo para vuelos */}
            {!isHotelOnly && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Hora Requerida de Vuelo - Ida (Pref.)</label>
                <input type="time" name="departureTimePreference" style={{ colorScheme: 'light' }} className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 text-gray-900 cursor-pointer" value={formData.departureTimePreference} onChange={handleInputChange} onClick={handleOpenPicker} />
              </div>
            )}
            {/* Fecha Check-out / Vuelta — hotel-only o round-trip */}
            {(isHotelOnly || tripType === 'ROUND_TRIP') && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700">{isHotelOnly ? 'Fecha Check-out *' : 'Fecha Vuelta *'}</label>
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
                {/* Hora vuelo vuelta — solo para vuelos round-trip, NO para hotel-only */}
                {!isHotelOnly && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Hora Requerida de Vuelo - Vuelta (Pref.)</label>
                    <input type="time" name="returnTimePreference" style={{ colorScheme: 'light' }} className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 text-gray-900 cursor-pointer" value={formData.returnTimePreference} onChange={handleInputChange} onClick={handleOpenPicker} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <hr />

        {/* Section 4: Hotel — siempre visible y forzado para hotel-only, toggle para vuelos */}
        <div>
          {!isHotelOnly && (
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center h-5">
                <input id="hotel" type="checkbox" className="focus:ring-brand-red h-4 w-4 text-brand-red border-gray-300 rounded" checked={requiresHotel} onChange={(e) => setRequiresHotel(e.target.checked)} />
              </div>
              <div className="text-sm"><label htmlFor="hotel" className="font-medium text-gray-700">¿Requiere Hospedaje?</label></div>
            </div>
          )}
          {isHotelOnly && (
            <h3 className="text-md font-medium text-gray-900 mb-4">Detalles del Hospedaje</h3>
          )}
          {(requiresHotel || isHotelOnly) && (
            <div className="bg-blue-50 p-4 rounded-md border border-blue-100 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">{isHotelOnly ? 'Nombre del Hotel *' : 'Nombre del Hotel (Preferencia) *'}</label>
                <input type="text" name="hotelName" required className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 uppercase text-gray-900" value={formData.hotelName} onChange={handleInputChange} />
              </div>
              <div className="bg-white p-3 rounded border border-gray-200">
                {/* Para hotel-only: noches se calculan automáticamente desde check-in/check-out.
                    Para vuelos round-trip: opción de noches diferentes al vuelo.
                    Para solo ida: noches manuales. */}
                {!isHotelOnly && tripType === 'ROUND_TRIP' && (
                  <div className="flex items-center gap-2 mb-2">
                    <input id="manualNights" type="checkbox" className="focus:ring-brand-red h-4 w-4 text-brand-red border-gray-300 rounded" checked={manualNights} onChange={(e) => setManualNights(e.target.checked)} />
                    <label htmlFor="manualNights" className="text-xs text-gray-700 font-bold">¿Fechas de hospedaje diferentes al vuelo?</label>
                  </div>
                )}
                {(isHotelOnly || (!manualNights && (tripType === 'ROUND_TRIP' || isHotelOnly))) ? (
                  <div><span className="text-sm text-gray-600">Noches calculadas: </span><span className="font-bold text-gray-900 text-lg">{numberOfNights}</span></div>
                ) : (manualNights || tripType === 'ONE_WAY') ? (
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

          {approverPreview.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
              <p className="text-xs font-semibold text-blue-700 uppercase mb-2">Cadena de aprobación estimada</p>
              <div className="space-y-2">
                {approverPreview.map((a, i) => {
                  const isExecutive = a.roles.some(r => r.startsWith('Ejecutivo') || r === 'Aprobación única');
                  return (
                    <div key={i} className={`flex flex-col gap-1 px-3 py-2 rounded ${isExecutive ? 'bg-amber-50 border border-amber-200' : 'bg-white border border-blue-100'}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900">{a.name}</span>
                        <div className="flex flex-wrap gap-1">
                          {a.roles.map((r, j) => (
                            <span key={j} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${r.startsWith('Ejecutivo') || r === 'Aprobación única' ? 'bg-amber-200 text-amber-900' : 'bg-blue-200 text-blue-900'}`}>
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>
                      {a.note && <p className="text-[11px] text-gray-500 italic">{a.note}</p>}
                    </div>
                  );
                })}
              </div>
              {!isInternational && approverPreview.length > 0 && approverPreview[0].roles[0] !== 'Aprobación única' && (
                <p className="text-xs text-blue-500 mt-2">* Aprobadores ejecutivos (CEO, Director CDS) podrían requerirse si el costo final supera $1.200.000 COP</p>
              )}
            </div>
          )}

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
            <button
              type="submit"
              className="px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-brand-red hover:bg-red-700 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading || !firstPassengerValid}
              title={!firstPassengerValid ? 'El primer pasajero debe estar registrado en el directorio antes de enviar.' : undefined}
            >
              {loading ? 'Procesando...' : (isModification ? 'Confirmar Cambio' : 'Crear Solicitud')}
            </button>
          </div>
        </div>

      </form>
    </div>
  );
};
