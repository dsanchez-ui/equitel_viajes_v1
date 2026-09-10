# Plan — Ajustes de la reunión "Tiquetes / Aviatur" (2026-09-10)

> **Estado (2026-09-10):** A (#A68), A2 (#A70), B1 (#A69) y C2 (#A71)
> **implementados y verificados, pendientes de despliegue**. Sin push por
> instrucción de David hasta terminar y probar todo lo pedido. D actualizado.
> Siguen pendientes la carga masiva (espera la lista de Karen) y decidir C1 y C3.
> P0 descartado por decisión de David.
>
> **Asistentes:** Diego Fernando Caballero Vargas, Yurani Astrid Prieto Forero,
> Laura Cristina Molina Ortiz, David Santiago Sánchez Rocha.
>
> **Fuentes:** notas de Gemini de la reunión, hoja "Sistema Tiquetes Equitel V2"
> descargada el 2026-09-10, y el código en `main` (`59346f3`).

---

## 0. Ya resuelto (verificado el 2026-09-10)

| Pedido de la reunión | Estado | Evidencia |
|---|---|---|
| Usuario administrador para Diego | ✅ Hecho | `SUPER_ADMIN_EMAILS` pasó de 2 a 3 correos conservando los existentes; `isSuperAdmin`, `isUserAnalyst` y fila en `USUARIOS` = `true`. **Falta borrar el archivo `Temporal` del editor.** |
| Ampliar facturas a 6 | ✅ Columnas hechas | `FECHA FACTURA 4–6` / `FACTURA 4–6` en AJ–AO; `VALOR` / `IVA` / `TOTAL FACTURA 4–6` en BB–BJ. Sin duplicados ni espacios raros. Las fórmulas de `TOTAL FACTURA 4–6` siguen el mismo patrón que la 2 y la 3 (`=IF(BB2+BC2>0,…)`). Las 81 columnas estándar están presentes. |
| Facturas 4–6 en el dashboard de costos | ⏳ Listo para pegar | JSON completo validado contra `_csIsConfigValid_` real: resto de la configuración idéntico, facturas 1–3 intactas, los 27 encabezados que usa existen en la hoja. |
| Agregar a Diego a la lista de quienes diligencian | ✅ Ya estaba | La lista desplegable de `PERSONA QUE TRAMITA EL TIQUETE /HOTEL` sale de `MISC!F` (`Tabla_3[COMPRADOR]`), que ya contiene `LAURA MOLINA`, `YURANI PRIETO` y `DIEGO CABALLERO`. |
| Ocultar columnas en lugar de borrarlas | ✅ No requiere código | La hoja principal se lee por nombre de columna. Ocultar es seguro; borrar una columna estándar rompe el sistema. Para ocultar/mostrar en bloque ya existe *Reorganizar Base Principal → visibilidad de columnas*. |
| Mantener fijos los aprobadores | ✅ Ya funciona así | El aprobador sale de la fila del **primer pasajero** en `USUARIOS`, no de la unidad de negocio elegida en el viaje. |

**Decidido en la reunión que no se hace** (se deja constancia): cálculo automático
de IVA (las tarifas varían: 6 %, 8 %, 19 %, hoteles) y lista fija de categorías de
tiquete (cambian por aerolínea). Las compras fuera de Aviatur ya funcionan.

---

## P0 · Hallazgo de seguridad — DESCARTADO por decisión de David (2026-09-10)

**Decisión:** no se corrige. Motivo de David: AdminMobile exige iniciar sesión
como administrador o superadmin, y solo 4 personas tienen acceso a la hoja.

**Constancia técnica, por si se retoma:**

- `doGet` sirve `AdminMobile` (`?action=admin`) y `CostsDashboard` sin verificar
  sesión en el servidor. El login de AdminMobile lo resuelve su propio JavaScript
  (`init()` → `showLogin()`) **después** de cargar la página.
- Desde cualquier página del proyecto, `google.script.run` puede invocar toda
  función cuyo nombre no termine en `_`, sin pasar por ese login ni por `dispatch`.
  El acceso a la hoja no restringe las páginas servidas por el web app.
- Funciones públicas sin control propio, entre otras: `usuarios_update`,
  `usuarios_listAll`, `usuarios_clearPin`, `setScriptProperty`, `updateAdminPin`,
  `registerReservation`, `anularSolicitud`.
- `_requireAnalyst_` recurre a `Session.getEffectiveUser()` cuando no identifica al
  visitante; en un web app que se ejecuta como el dueño, ese usuario es el dueño.
- La configuración "Quién tiene acceso" del deployment no está en el repo.

**Verificación de solo lectura (5 min)**, si algún día se quiere confirmar: abrir
`WEB_APP_URL?action=admin` en incógnito y ejecutar en la consola:

```js
google.script.run
  .withSuccessHandler(function (r) { console.log('EXPUESTO: ' + r.length + ' usuarios'); })
  .withFailureHandler(function (e) { console.log('BLOQUEADO: ' + e.message); })
  .usuarios_listAll();
```

**Consecuencia para este plan:** A y A2 se diseñan para que ningún camino nuevo
exponga fechas de nacimiento a quien no las necesita, sin depender de P0.

---

## A · Fecha de nacimiento — PRIORIDAD (pedido explícito)

**Acordado en la reunión:** la fecha de nacimiento es **obligatoria al crear
usuarios nuevos**. Se pidió a Karen la base actualizada de integrantes con fecha de
nacimiento para cargarla.

### Decisiones de diseño (confirmadas por David el 2026-09-10 · implementado en #A68)

1. **Columna nueva al final de `USUARIOS` (`Fecha Nacimiento`), localizada siempre por nombre.** En producción quedó en la O porque la celda N233 tenía un valor suelto; puede moverse a cualquier posición desde la M. A diferencia
   de la hoja principal, `USUARIOS` se lee y escribe **por posición** (PIN en la
   columna 10, aprobadores en 7–9, pasaporte en 11–12, `_writeUsuarioRow_` escribe
   1–9 fijas). Insertarla en medio desplazaría el PIN y rompería el inicio de sesión.
2. **Migración idempotente** `agregarColumnaFechaNacimiento()`, con el mismo patrón
   que `agregarColumnaComentariosAprobadores` / `agregarColumnasPasaporte`: solo
   agrega si no existe, repara el encabezado si tiene espacios raros, y aparece en el
   menú. `HEADERS_USUARIOS` gana la entrada al final.
3. **Formato de celda texto, valor `AAAA-MM-DD`.** Una fecha "real" de Sheets se
   devuelve a Apps Script como objeto con zona horaria y puede correrse un día. Se
   muestra al usuario como `DD/MM/AAAA`.
4. **Obligatoria al crear, opcional al editar.** Al crear (sidebar y móvil) no se
   puede guardar sin ella. Al editar se precarga y se muestra "Pendiente" si falta,
   pero no bloquea: los 763 usuarios actuales todavía no la tienen, y exigirla
   impediría cambiarles, por ejemplo, el aprobador.
5. **Validación:** fecha existente, no futura, edad entre 15 y 100 años. Se valida
   en el formulario **y** en el backend (`usuarios_create`), porque un sidebar o
   móvil abierto con la versión vieja no enviaría el campo.
6. **`sincronizarConMaestroRH` no se toca:** sigue creando fichas incompletas sin
   fecha. La obligatoriedad vive en `usuarios_create`, no en `_writeUsuarioRow_`.
7. **Nunca en el directorio que reciben todos los usuarios.** `getIntegrantesData` /
   `bootstrap` envían el directorio a **cada** usuario que inicia sesión y lo guardan
   en su navegador. La fecha de nacimiento solo viaja en contextos de administración
   (`usuarios_listAll`, `mobileAdmin_getBootstrap`).
   Nota: `usuarios_listAll` es una de las funciones del hallazgo P0 (descartado por
   decisión de David); agregarle la fecha la incluye en esa exposición.

### Cambios por archivo

| Archivo | Cambio |
|---|---|
| `server/Code.gs` | `HEADERS_USUARIOS` + migración + menú; `_writeUsuarioRow_` escribe la fecha por **nombre de columna** (como el pasaporte) cuando viene; `usuarios_create` la exige y valida; `usuarios_update` la acepta; `usuarios_listAll` la devuelve. |
| `server/AdminSidebar.html` | Campo `type="date"` en crear/editar, precarga en `startEdit`, validación, envío en el payload, limpieza en `clearForm`. |
| `server/AdminMobile.html` | Campo `type="date"` obligatorio en "Crear usuario nuevo", validación y envío en el payload. |
| Validador de fecha | Autoritativo en el backend (`_validateBirthdate_`), verificado por `tools/check-birthdate-rules.cjs` dentro de `npm run verify`. Los formularios validan presencia y muestran el mensaje del backend. El gemelo TypeScript llega con A2. |

### Carga masiva (cuando llegue la lista de Karen)

Función `cargarFechasNacimiento()` desde una hoja temporal `CARGA_FECHAS` con dos
columnas (`Cédula`, `Fecha`). Cruza por cédula y **por defecto solo llena celdas
vacías**; nunca borra. Reporta: cargadas, cédulas no encontradas en `USUARIOS`,
fechas inválidas y filas que ya tenían fecha distinta. **Se necesita ver el formato
real de la lista antes de escribirla.**

### Despliegue

1. Apps Script: pegar `Code.gs`, `AdminSidebar.html` y `AdminMobile.html` → Guardar.
2. Ejecutar `agregarColumnaFechaNacimiento()` (o desde el menú).
3. Crear versión nueva del web app.
4. No requiere push del frontend.

**Orden seguro:** backend nuevo + formularios viejos abiertos → `usuarios_create`
rechaza con mensaje claro ("la fecha de nacimiento es obligatoria") y basta con
recargar el sidebar. Formularios nuevos + backend viejo → el campo se ignora sin
error (no se pierde nada más).

**Esfuerzo:** ~3–4 h con pruebas en el deployment de prueba.

---

## A2 · Recoger la fecha de nacimiento en el formulario de solicitudes

**Pedido de David (2026-09-10):** pedir la fecha de nacimiento al crear una
solicitud, a los pasajeros que aún no la tengan, para ir completando la base sin
esperar la lista de Karen. El campo debe explicar para qué se usa.
**Implementado en #A70.**

### Decisiones (David, 2026-09-10)

- **Obligatoria** en solicitudes de vuelo para todo pasajero que no la tenga.
- **Pasajeros externos también:** se les pide, pero se guarda **en la solicitud**,
  no en `USUARIOS`. Como no tienen perfil, se les pide en cada solicitud.
- **Si la consulta "¿a quién le falta?" falla**, el formulario no se bloquea: pide
  la fecha a todos los pasajeros (el backend ignora la de quien ya la tiene).

### Cómo funciona

1. **Cuándo aparece.** En solicitudes de **vuelo** (crear, modificar y multidestino),
   por cada pasajero sin fecha: registrado en `USUARIOS` sin fecha válida, o externo.
   No aplica a solo hospedaje: los hoteles no la piden.
2. **Qué ve el usuario.** Bajo el pasajero, un campo de fecha obligatorio (sin
   fechas futuras) con el texto *"La exigen las aerolíneas y agencias de viaje para
   emitir el tiquete."* más, según el caso: *"Se guarda una sola vez en su perfil y
   no se volverá a pedir"* (registrado) o *"Como este pasajero no está registrado en
   el sistema, se guarda solo en esta solicitud"* (externo). Una edad fuera de rango
   se marca en línea.
3. **Consulta.** `getBirthdateStatus(cedulas)` (máx. 5) devuelve **solo**
   `{ cedula, registered, hasBirthdate }`. **Nunca devuelve la fecha.**
4. **Envío.** El payload lleva `passengerBirthdates: { cedula: 'AAAA-MM-DD' }` solo
   con los pasajeros a los que les faltaba (vacío `{}` si a nadie).
5. **Guardado** (dentro de `createNewRequest`):
   - La validación corre **antes** de escribir nada; si falta o es inválida, se
     rechaza nombrando al pasajero.
   - **Externos:** columna `FECHAS NACIMIENTO PASAJEROS (JSON)` de la solicitud, en
     la misma escritura de la fila.
   - **Registrados:** se completa `USUARIOS` **después** de guardar la solicitud,
     dentro de `try/catch`. Solo llena celdas vacías o con texto que no es fecha;
     **nunca sobrescribe una fecha válida** (dos capas: la validación omite a quien
     la tiene y el guardado lo vuelve a comprobar).
   - `requestModification` hereda el campo por el `...modifiedRequestData` del
     payload de la solicitud hija; multidestino lo repite por tramo de forma
     idempotente. Ambos verificados.
6. **Validación.** Misma regla que en A (fecha real, no futura, edad 15–100). El
   gemelo `utils/birthdate.ts` y el backend se comparan en `npm run verify`.

### Despliegue (orden recomendado)

1. **Primero Apps Script:** pegar `Code.gs` → Guardar → menú *Equitel Viajes → 6.
   Agregar columnas Fecha de Nacimiento* (crea la columna en `USUARIOS` y en la hoja
   de solicitudes) → versión nueva del web app. El formulario anterior no envía
   `passengerBirthdates`, así que el backend nuevo no exige nada: todo sigue igual.
2. **Después el push** del frontend.

El orden inverso también es seguro (nunca bloquea), pero mientras tanto la consulta
nueva no existe, el formulario la trata como caída y **pide la fecha a todos**, y el
backend viejo la descarta.

---

## B · Otros pedidos de la reunión

### B1 · Recordatorio de unidad de negocio y centro de costo (David, próximo paso)

Texto destacado sobre los campos *Unidad de Negocio* / *Centro de Costos* del
formulario de solicitud (`components/RequestForm.tsx`). Propuesta:

> ⚠️ **Verifique la unidad de negocio y el centro de costos.** El costo del viaje se
> cargará exactamente a los que seleccione aquí. Su aprobador no cambia: es el
> mismo que tiene asignado en el sistema.

La segunda frase refuerza la decisión de mantener fijos los aprobadores.

**Solo frontend** (push a `main`). **Esfuerzo:** ~20 min. **Estado:** ✅ implementado (#A69), pendiente de push.

### B2 · Mensaje de preregistro

Actualizado en el Anexo. Además de agregar la fecha de nacimiento:

- **Corrige un dato:** el PIN **no** llega al crear el usuario (`usuarios_create` no
  envía correo). Llega cuando la persona entra al portal y escribe su correo.
- **Aclara el nombre:** debe ir como en el documento de identidad; las aerolíneas
  pueden negar el abordaje si no coincide.
- Incluye el enlace al portal.

---

## C · Mejoras pequeñas propuestas (opcionales)

| # | Mejora | Por qué | Esfuerzo |
|---|---|---|---|
| C1 | **Autollenar `PERSONA QUE TRAMITA EL TIQUETE /HOTEL`** al registrar la reserva, con el nombre de quien la registra (correo → nombre de `Tabla_3`), **solo si la celda está vacía**. | En la reunión se pidió que no quede en blanco; hoy la app nunca la llena. | ~1 h, solo backend |
| C2 | ✅ **Implementado (#A71).** Fecha de nacimiento de cada pasajero en el detalle de la solicitud, bajo nombre y cédula, con edad, "registrada en esta solicitud" para externos y aviso "Sin fecha de nacimiento". **Solo administradores** (en una solicitud se pueden escribir cédulas ajenas). | El área de viajes la registra en la aerolínea sin abrir la hoja. | Hecho |
| C3 | **Nota en los encabezados de la hoja principal:** "Ocultar, no borrar". | Refuerza lo acordado en la reunión justo donde se comete el error. | ~10 min |

---

## D · Mantenimiento de documentación

- `CLAUDE.md`: todavía dice que `ModificationForm.tsx` es código muerto y que `serve`
  tiene vulnerabilidades (ambos resueltos en #A67). Actualizar el rango a #A1–#A67 y
  agregar la columna `Fecha Nacimiento` de `USUARIOS` (localizada por nombre).
- Documentar en `docs/` los procedimientos de alta de superadmin y de columnas de
  factura extra, ya ejecutados.
- Una entrada `#Axx` en `BUG_REPORT.md` por cada bloque implementado.

---

## Orden recomendado

| Paso | Quién | Qué | Código |
|---|---|---|---|
| 1 | David | ✅ JSON del dashboard pegado y mensaje de preregistro enviado. Borrar `Temporal` si falta. | No |
| 2 | Claude | ✅ A (#A68), A2 (#A70) y B1 (#A69) implementados y verificados. | Sí |
| 3 | David | Autorizar commit + push. Despliegue: **primero Apps Script** (pegar `Code.gs`, `AdminSidebar.html`, `AdminMobile.html` → menú 6 → versión nueva), **después el push**. | — |
| 4 | David | Pasar la lista de Karen apenas llegue. | No |
| 5 | Claude | Carga masiva de fechas con el formato real de la lista (solo llena vacías). | Sí |
| 6 | Claude | ✅ C2 (#A71) implementado y verificado. C1 y C3 pendientes de decisión de David. | Sí |

## Decisiones pendientes de David

1. ✅ **A:** obligatoria al crear usuario y opcional al editar; edad válida 15–100 años — confirmado (2026-09-10).
2. ✅ **A2:** obligatoria en vuelos; externos también, guardada en la solicitud — decidido (2026-09-10).
3. ✅ C2 aprobada e implementada (#A71). Pendiente decidir C1 y C3.
4. Formato de la lista de Karen (cuando llegue).

---

## Anexo · Mensaje de preregistro actualizado

```
¡Hola! 👋 Para registrarte en el Portal de Viajes Equitel necesito los siguientes datos. Me los puedes enviar por este mismo chat:

1️⃣ Cédula
2️⃣ Nombre completo, tal como aparece en tu documento de identidad (así saldrá en los tiquetes)
3️⃣ Fecha de nacimiento (DD/MM/AAAA) — la solicitan las aerolíneas y agencias de viaje para emitir tus tiquetes
4️⃣ Correo corporativo (@equitel.com.co)
5️⃣ Empresa (Cumandes / Equitel / Ingenergía / LAP)
6️⃣ Sede (ciudad)
7️⃣ Centro de Costo al que perteneces
8️⃣ Nombre y correo de tu jefe aprobador (quien autoriza tus viajes)

En cuanto me los envíes te creo el usuario. Luego entra a https://sistematiquetesequitel-302740316698.us-west1.run.app, escribe tu correo corporativo y te llegará un PIN de 8 dígitos para ingresar.

Tus datos solo se usan para gestionar tus viajes corporativos. ¡Gracias! ✈️
```
