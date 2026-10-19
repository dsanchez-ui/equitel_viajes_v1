# Plan — Cambios de viaje simplificados («Cambiar mi viaje»)

> **Estado (2026-10-19): construido (#A103), pendiente de desplegar.** Yurani aprobó el prototipo
> (<https://claude.ai/artifact/Ekx5v8GDaYnWvQ9B6aS1Nu>) y las propuestas de la §9 tal como se mostraron.
> El detalle de lo construido está en BUG_REPORT.md (#A103). Se prueba antes de publicar con el entorno
> local (`tools/entorno-prueba/README.md`).

---

## 1. Por qué

- **Los viajeros no usan el cambio de la plataforma.** El botón «Solicitar Cambio» está dentro
  del detalle y abre el formulario completo de solicitud (`RequestForm` en modo modificación):
  hay que volver a revisar todos los campos. Los cambios llegan por correo, y entonces no quedan
  en la plataforma ni su costo.
- **La jugada de la maleta (Yurani).** Un área pide el tiquete en tarifa Basic y, ya comprado,
  pide un cambio para llevar maleta. La tarifa pasa a Classic y además se paga penalidad. Si la
  Basic no admite cambios, el tiquete se pierde y se compra otro. Pedida desde el principio, la
  tarifa con maleta habría salido más barata, porque no se habría pagado el cambio.
- **El costo se pierde entre la solicitud original y la nueva.** Hoy la solicitud de cambio
  (hija) se cotiza como un viaje completo y la original (padre) se anula al aprobarse la hija.
  Nadie ve cuánto costó el viaje, cuánto sumó el cambio ni cuánto fue penalidad.

Lo que se busca: que **todo cambio pase por la plataforma**, que pedirlo sea fácil y que los
administradores **vean y controlen el sobrecosto** de cada cambio.

## 2. Qué hay hoy

| Paso | Dónde | Comportamiento |
|---|---|---|
| Pedir el cambio | `RequestDetail` → «Solicitar Cambio» → `RequestForm` (`isModification`) → `gasService.requestModification` | El navegador manda la solicitud completa ya modificada y un motivo. |
| Crear la hija | `requestModification` (`Code.gs` ~1797) | Valida que el usuario sea el dueño (o administrador). No deja cambiar si la padre está ANULADO, DENEGADO, PROCESADO o en espera del CFO (#A100), ni si ya tiene un cambio vivo (#A63). Crea la hija con `createNewRequest` en `PENDIENTE_ANALISIS_CAMBIO`, con `ID SOLICITUD PADRE`, `TIPO DE SOLICITUD = MODIFICACION`, `ES_CAMBIO_CON_COSTO = SI` si la padre estaba RESERVADO y `FECHA_SOLICITUD_PADRE`. |
| Revisión | `ChangeRequestModal` / correo «PASAR A ESTUDIO» → `processChangeDecision` (~2020) | *Estudio* → `PENDIENTE_OPCIONES`. *Rechazo* con motivo; con la padre se puede: dejarla, anularla o consultar al viajero. |
| Después | Flujo normal | Opciones, selección, costos del **viaje completo**, aprobación, reserva. |
| La padre | `_cancelParentIfModificationApproved_` (~9809) | Se anula cuando se aprueba la hija, también si se salta la aprobación. Mientras la hija está viva, la padre no recibe recordatorios (`_computePausedParentIds_`). |
| Presupuesto | `updateRequestStatus` (~7414) | Al confirmar los costos de la hija se excluyen la hija y la padre del ejecutado (porque la padre se va a anular). |

## 3. Reglas decididas (David, 15-oct)

1. **Qué se cambia: fecha, hora, destino y equipaje** (maleta de bodega). La tarifa no la elige el
   viajero: la elige Laura según el manual (#A95) y la maleta pedida. Para cambiar pasajeros
   se crea una solicitud nueva.
2. **Plazo: hasta las 5:00 p. m. del día hábil anterior al vuelo**; si ese día es sábado, hasta
   las 12:00 m. Domingos y festivos de Colombia no cuentan. Antes del límite se puede pedir a
   cualquier hora. Después del plazo, la plataforma no deja pedirlo y muestra el contacto del
   área de viajes.
3. **Viaje en curso:** si la ida ya voló y falta el regreso, se puede cambiar **solo el regreso**
   (fecha, hora, equipaje), con el plazo contado hasta el vuelo de regreso.
4. **Tiquete comprado: opciones y selección igual que hoy.** Laura carga las opciones del cambio,
   el viajero elige y Laura confirma el **costo del cambio**.
5. **Todo cambio pasa por el aprobador, aunque cueste $0.** Con el tiquete comprado, el aprobador
   aprueba el costo del cambio, no otra vez el viaje.

Ejemplos del plazo, verificados con el cálculo del prototipo (los mismos festivos de `_psHolidaysCO_`):

| Vuelo | Se puede pedir hasta | Por qué |
|---|---|---|
| jueves 22-oct-2026 | miércoles 21-oct, 5:00 p. m. | Día hábil anterior. |
| viernes 16-oct | jueves 15-oct, 5:00 p. m. | |
| lunes 19-oct | sábado 17-oct, 12:00 m. | El domingo no cuenta; el sábado cierra a las 12. |
| martes 13-oct | sábado 10-oct, 12:00 m. | Lunes 12 festivo y domingo. |
| martes 3-nov | sábado 31-oct, 12:00 m. | Lunes 2 festivo y domingo. |
| sábado 26-dic | jueves 24-dic, 5:00 p. m. | 25 festivo. |

## 4. Diseño

### 4.1 Viajero

- **Botón grande** en «Mis solicitudes» (`UserDashboard`), arriba de las tarjetas:
  «😕 ¿Necesita cambiar su viaje? Fecha, hora, destino o equipaje. Toma un minuto.» El ícono está por decidir (§9).
- **Paso 1, elegir el viaje:** lista de sus solicitudes activas. Las que se pueden cambiar dicen
  hasta cuándo («Puede pedir el cambio hoy hasta las 5:00 p. m.»). Las que no, dicen por qué:
  plazo vencido, viaje terminado, cambio en curso, en espera del CFO o ya reemplazada.
- **Paso 2, formulario corto** (componente nuevo `TripChangeModal.tsx`):
  - cuatro botones (*Fechas*, *Horas*, *Destino*, *Equipaje*); cada uno abre su campo con el valor actual al lado;
  - *Destino* bloqueado si el viaje está en curso;
  - lo que cambia con esto, calculado en vivo: noches, tarifa del manual, hotel ajustado a las fechas y aviso de viaje internacional (pasaporte);
  - si el tiquete ya se compró: aviso de costo y de que lo aprueba su jefe, que verá lo que costó el viaje;
  - si agrega maleta después de comprar: «Agregar la maleta ahora cuesta más que haberla pedido al crear la solicitud»;
  - resumen *Antes → Ahora* y **motivo obligatorio** (10 a 500 caracteres);
  - la fecha nueva también tiene que cumplir el plazo (propuesta, §9).
- **Paso 3, confirmación** con *Qué sigue* y «hasta que reciba el tiquete nuevo, el que tiene sigue siendo el válido».
- El botón «Solicitar Cambio» del detalle abre este mismo formulario con el viaje ya elegido. El
  formulario completo de modificación deja de usarse para los solicitantes; se conserva para los
  administradores mientras se decide la §9 punto 6.

### 4.2 Regla del plazo: validador gemelo

`utils/changeWindow.ts` ↔ `_changeWindow_` en `Code.gs`, comparados por `tools/check-change-window.cjs`
dentro de `npm run verify` (igual que OT, fechas, celular, costos y tarifa).

```
changeDeadline(fechaVuelo) → Date        // 17:00 del día hábil anterior; sábado 12:00
changeTarget(solicitud, ahora) → { modo: 'completo' | 'regreso' | null, fecha, motivoSiNo }
```

- Se usa el reloj del **servidor** (Bogotá); el navegador solo muestra.
- Los festivos salen de `_psHolidaysCO_` (ya probado por #A80). En TypeScript se porta igual
  (`utils/holidays.ts`), y el chequeo compara las dos versiones para varios años.

### 4.3 Servidor: acción nueva `requestTripChange`

El navegador manda **solo lo que cambia**, y el servidor arma la hija desde la fila de la padre:

```js
requestTripChange({ requestId, changes: { departureDate?, returnDate?, departureTimePreference?,
  returnTimePreference?, destination?, checkedBaggage? }, changeReason })
```

1. Dueño (o administrador), estado de la padre, un solo cambio vivo (#A63) y padre no reemplazada.
2. Plazo con `_changeWindow_`: con el viaje en curso solo se aceptan claves del regreso. La fecha
   nueva también se valida.
3. Hija = copia de la padre (empresa, unidad, CC, OT, pasajeros, correos, fechas de nacimiento y
   celulares de externos) + los cambios. Se recalculan:
   - noches (`# NOCHES`), `FECHA DEL VUELO`, `DIAS DE ANTELACION TKT` y `MALETA DE BODEGA`;
   - `ES INTERNACIONAL`, con el país de la ciudad en `CIUDADES DEL MUNDO`. Si el viaje pasa a
     internacional, se piden los pasaportes (`_assertPassportsForInternational_`).
   - El aprobador se resuelve de nuevo con `_resolveApproverForFirstPassenger_`, como hoy.
4. Columna nueva **`CAMBIO PEDIDO (JSON)`** en la hija:
   `{ v: 1, padre, comprado, modo, campos: { departureDate: { antes, ahora }, … }, tipos: ['Fecha','Equipaje'] }`.
   Es la fuente de *Qué cambia* para Laura, el aprobador y el control. Que exista (`v: 1`) marca la
   hija como **cambio nuevo**, con las reglas de costo de la §4.5. Las hijas de antes siguen como hoy.
5. Estado inicial `PENDIENTE_ANALISIS_CAMBIO` y nota en `OBSERVACIONES` de la padre, como hoy.
6. Correos:
   - al viajero, un recibo corto con *Antes → Ahora*;
   - a Laura (`ADMIN_EMAIL`), «[CAMBIO DE SOL-x]» con el *Antes → Ahora*, el motivo y, si estaba comprado, el PNR.

`requestModification` queda igual, para las pestañas con la app anterior.

### 4.4 Laura: revisar el cambio

`ChangeRequestModal` rediseñado:

- *Qué pide*: tipos y *Antes → Ahora* (de `CAMBIO PEDIDO (JSON)`) y el motivo.
- *Lo que ya se compró*: datos de la padre (PNR, aerolínea, canal, tarifa, valor pagado, tarjeta, fecha de compra) y
  sus archivos (`supportData` de la padre, reserva y facturas). La padre se lee con `getRequestById`
  (administrador, completa: #A60). No se copian archivos de Drive.
- *Mensaje para Aviatur*: texto armado con el PNR, el pasajero y los cambios, con botón *Copiar*.
- *Cuánto lleva este viaje*: lo pagado en la padre + el cambio (por cotizar).
- *Aceptar y cargar opciones* (= `study`, hacia `PENDIENTE_OPCIONES`) o *Rechazar* con motivo, como hoy.
- Arriba del panel, un aviso «Cambios por revisar: N», como las facturas por revisar (#A83).

### 4.5 El costo del cambio (tiquete comprado)

Para una hija con `CAMBIO PEDIDO (JSON)` cuya padre estaba RESERVADO:

- **Confirmar costos** (`CostConfirmationModal` en modo cambio) pide:
  - **penalidad y cargos**;
  - **diferencia de tarifa**;
  - **hotel** (noches nuevas o penalidad).

  Se muestra, solo para leer, lo que costó la padre. Se escribe así:
  - `COSTO_FINAL_TIQUETES` = penalidad de tiquetes + diferencia de tarifa;
  - `COSTO_FINAL_HOTEL` = hotel;
  - `COSTO COTIZADO` = la suma (regla #A79);
  - columna nueva **`PENALIDAD CAMBIO`** = la parte que es penalidad y cargos (informativa; no puede superar el total).

  `$0` es válido (#A79) y **igual va al aprobador**.
- La **tarifa** del tiquete nuevo usa el bloque de #A95 con las noches nuevas y la maleta.
- **Presupuesto:** al confirmar costos de un cambio nuevo comprado **no se excluye la padre** del
  ejecutado (`_excludeIds`), porque la padre ya no se anula y su costo sigue contando. El cambio
  suma solo su costo, en el mes en que se paga.

Sin comprar: no cambia nada. La hija se cotiza como viaje completo y la padre se anula al aprobarse, como hoy.

### 4.6 Aprobación

- **Plantilla nueva «APROBACIÓN DE CAMBIO»** (`HtmlTemplates.approvalRequest` con rama de cambio). Muestra:
  - qué cambia y el motivo;
  - el costo del viaje original (aprobado y pagado);
  - el **costo del cambio** desglosado (penalidad, diferencia de tarifa, hotel);
  - el viaje con el cambio y el % que suma;
  - un aviso si la maleta se pidió después de comprar, y otro si cuesta $0.
- Mismos aprobadores que una solicitud. Lo que falta decidir con Yurani (§9 punto 4):
  - con qué cifra se aplica el tope de $1.200.000 de Cadena de Suministro;
  - el voto del CFO cuando la tarifa es superior a la del manual (#A100) sigue igual.
- Recordatorios y escalamiento (#A16): iguales.

### 4.7 Registrar el cambio y la padre «Cambiada»

- `ReservationModal`, para un cambio nuevo comprado:
  - viene con el PNR, la aerolínea, el canal y la tarjeta de la padre, editables;
  - el *valor pagado* (#A102) es lo pagado por el cambio.
- **La padre no se anula.** En `_cancelParentIfModificationApproved_`: si la hija es un cambio nuevo y
  la padre estaba RESERVADO, no se toca al aprobar. Al pasar la hija a RESERVADO se escribe en la padre
  la columna nueva **`REEMPLAZADA POR`** (= id de la hija) y una nota. La padre sigue RESERVADO y se cierra
  con sus facturas, como cualquier otra (#A83).
- En la app la padre se ve como **«Cambiada → SOL-x»**:
  - en las tarjetas y en el detalle;
  - no se puede volver a cambiar: se cambia la hija;
  - no se puede anular, porque eso borraría un costo que sí se pagó.
- Las hijas creadas con `requestModification` (antes de esta versión) conservan la regla de hoy.

### 4.8 Control de cambios (administradores)

Endpoint `getChangeControl(filtros)`, solo lectura y en caché como el dashboard (#A89). Por cada hija con `CAMBIO PEDIDO (JSON)` trae:
- de dónde viene: padre e hija;
- qué se cambió y quién lo registró (el viajero o Laura a su nombre);
- costo de la padre (lo pagado o, si no, lo cotizado), costo del cambio, penalidad y el % sobre el viaje;
- unidad, empresa y mes.

Totales del periodo:
- cambios pedidos y cuántos con el tiquete comprado;
- costo de los cambios y, de eso, penalidades;
- cambios para agregar maleta;
- por unidad.

Se ve en tres lugares (propuesta, §9 punto 5): una pestaña **«Cambios»** en Métricas para los administradores; en el dashboard de costos, donde cada líder ve sus unidades con el filtro en el servidor (#A76); y una sección corta en el informe mensual (#A101). Sin cédulas. Los cambios de antes de esta versión no tienen detalle y se listan aparte o se omiten.

### 4.9 Lo que hay que ajustar en lo que ya existe

| Dónde | Ajuste |
|---|---|
| Estadísticas de compra (#A80, `_psRecord_`) | Un cambio comprado no son tiquetes nuevos: no suma `tickets` ni noches-habitación; su costo va aparte como «cambios». |
| Rastreo de precios (#A84, `Rastreo.gs`, proyecto aparte) | No buscar hijas de cambio comprado: su cotizado es el costo del cambio, no el de un tiquete. Hay que pegar `Rastreo.gs`. |
| Proyección de ahorro (#A90, `_saTrips_`) | Igual: excluir los cambios comprados de las comparaciones y contarlos aparte. |
| Informe mensual (#A101) | Ya excluye las `MODIFICACION` de la anticipación. La tarifa del cambio cuenta en su mes de compra (es una compra). Sección nueva de cambios (§4.8). |
| Dashboard de costos y variación (#A76, #A78) | La hija cuenta con el costo del cambio y la padre con el suyo: el total del viaje queda bien. La variación compara cotizado contra facturado de cada una. |
| Facturas por cerrar (#A83) | Sin cambio: la hija tiene sus facturas (las del cambio) y la padre las suyas. |
| Recordatorios | Sin cambio: la padre se pausa mientras la hija está viva (`_computePausedParentIds_`). |

### 4.10 Laura registra cambios a nombre del viajero

Propuesta (§9 punto 6): un administrador puede abrir el mismo formulario desde el detalle de
cualquier solicitud, **sin plazo**, para registrar los cambios que llegan por correo o WhatsApp. Queda
`registradoPor` en el JSON y el control lo muestra.

### 4.11 Prevención

Propuesta (§9 punto 7): en el formulario de solicitud nueva, junto a la casilla de maleta de bodega,
«Si cree que la va a necesitar, márquela ahora: agregarla después cuesta el cambio y la diferencia de tarifa».

## 5. Compatibilidad y orden de despliegue

- **La clave presente activa la regla.** `bootstrap` agrega `tripChange: { enabled, contacto }`. La app
  muestra el botón nuevo solo si llega. Con un servidor anterior se queda el flujo de hoy.
- **Servidor nuevo + app anterior:** `requestModification` no cambia y esas hijas siguen las reglas de hoy.
- **Hijas viejas en curso:** sin `CAMBIO PEDIDO (JSON)` siguen como hoy (costo completo, padre anulada).
  Así una hija de antes nunca deja su padre viva con el costo duplicado.
- **Columnas nuevas al final** (`CAMBIO PEDIDO (JSON)`, `PENALIDAD CAMBIO`, `REEMPLAZADA POR`). Las crea el
  menú 12 o el sistema la primera vez.
- **Orden:**
  1. pegar `Code.gs` y correr el menú 12;
  2. crear la versión nueva del web app;
  3. publicar el frontend;
  4. pegar `Rastreo.gs` en el proyecto del rastreo.

  Cualquier orden es seguro: cada lado funciona con la versión anterior del otro.

## 6. Verificación

`tools/check-trip-change.cjs` (en `npm run verify`), con `Code.gs` en `vm` sobre una hoja simulada y el reloj fijo:

- plazo: los ejemplos de la §3 y la paridad con `utils/changeWindow.ts` para 2026–2030;
- elegibilidad:
  - dueño, administrador y otro usuario;
  - estados terminales, cambio vivo, padre reemplazada y espera del CFO;
  - viaje en curso: solo claves del regreso;
- armado de la hija: campos copiados y recalculados, internacional y pasaportes, la clave `checkedBaggage`;
- costo del cambio: escritura en las columnas, penalidad que no supere el total y $0 que igual pide aprobación;
- presupuesto: no se excluye la padre en el cambio comprado y sí en el cambio sin comprar;
- padre: no se anula y queda `REEMPLAZADA POR` en el cambio comprado nuevo; se anula como hoy en el
  cambio sin comprar y en las hijas viejas;
- control: totales, filtros, alcance por unidad y sin cédulas;
- exclusiones en las estadísticas de compra y en la proyección de ahorro.

Prueba manual contra el deployment de prueba con los dos caminos completos, y capturas con el backend simulado.

## 7. Orden de trabajo sugerido

1. Regla del plazo (gemelo + chequeo) y `requestTripChange` con el JSON del cambio.
2. Formulario del viajero y botón (`TripChangeModal`, `UserDashboard`, `RequestDetail`).
3. Revisión de Laura (`ChangeRequestModal`) y costo del cambio (`CostConfirmationModal`).
4. Correo de aprobación del cambio y regla de la padre «Cambiada» (`ReservationModal`, `_cancelParent…`).
5. Control de cambios y ajustes de la §4.9.
6. Guías (`guia-usuario.md`, `guia-administrador.md`), BUG_REPORT y aviso a los usuarios.

Las partes 1 a 4 salen juntas: si sale el formulario sin la regla de costo, los cambios comprados
quedarían cotizados como viaje completo con la padre viva.

## 8. Fuera de alcance

- Cambiar pasajeros.
- Quitar o agregar hotel (§9 punto 2).
- Leer la hora real del vuelo del tiquete: el plazo usa solo la fecha.
- Cambiar los tramos de un multidestino a la vez: cada tramo es su solicitud y se cambia por separado.

## 9. Preguntas para Yurani y Laura

Están también al final del prototipo, cada una con su propuesta:

1. Ícono del botón (😕, 🔄 o ✈️).
2. Hotel: ¿basta con que se ajuste solo a las fechas y al destino?
3. ¿La fecha nueva también cumple el plazo?
4. ¿El tope de Cadena de Suministro ($1.200.000) se aplica al viaje con el cambio o solo al costo del cambio?
5. ¿Dónde se ve el control de cambios (Métricas, dashboard de costos, informe mensual)?
6. ¿Laura registra a nombre del viajero los cambios que llegan por correo, sin plazo?
7. ¿Se agrega el aviso de la maleta en el formulario de solicitud nueva?
8. ¿Qué contacto se muestra después del plazo (hoy, compras.equitel@equitel.com.co)?
