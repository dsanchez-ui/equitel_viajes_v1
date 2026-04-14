# Guía: Reorganizar la Base Principal

> **Quién lo usa:** Solo el administrador (no la analista de compras).
> **Cuándo usarlo:** Cuando necesites cambiar el orden de las columnas, agregar columnas nuevas, o limpiar la hoja principal.
> **Riesgo:** Muy bajo. El workflow está diseñado para que la hoja activa NO se toque hasta el último paso. Si algo sale mal, la hoja vieja sigue intacta.

---

## ¿Por qué existe esta herramienta?

La hoja `Nueva Base Solicitudes` tiene 75 columnas. Con el tiempo:
- El orden original puede no ser cómodo para el trabajo diario
- Puedes querer agregar columnas nuevas (ej: prioridad, notas internas)
- Puedes querer quitar columnas que ya no usas

Antes, cambiar el orden rompía la aplicación porque el código asumía posiciones fijas. Ahora el código usa los **nombres** de las columnas para encontrarlas, así que puedes reorganizar libremente.

---

## Cómo abrir el wizard

1. Abre el Google Sheet `Sistema Tiquetes Equitel V2`
2. En el menú superior, click **Equitel Viajes → Reorganizar Base Principal (Sidebar)**
3. Se abre un panel lateral a la derecha con los pasos

**Seguridad:** solo el correo configurado como analista/admin (en Script Property `ANALYST_EMAILS`) puede abrir este sidebar y ejecutar cualquier acción. Otros usuarios ven un mensaje de "Acción no autorizada".

---

## Sección de respaldo (siempre visible al inicio)

**🛡️ Respaldo completo del archivo**

Independiente del workflow de 6 pasos. Crea una copia COMPLETA del Google Sheets (todas las hojas, no solo la principal) en tu carpeta privada de Drive.

**Primera vez:**
1. Pega el ID o URL de tu carpeta de Drive en el campo
2. Click **Guardar carpeta** → se valida que la carpeta sea accesible
3. Click **📋 Crear respaldo ahora** → espera ~30-60 segundos
4. Aparece el link del archivo copiado

**Siguientes veces:**
La carpeta queda recordada. Solo tienes que clickear **Crear respaldo ahora**.

**Recomendado:** crear un respaldo antes de cualquier reorganización grande.

---

## Los 6 pasos

### Paso 1 — Crear hoja de trabajo

**Qué hace:** Crea una hoja nueva llamada `Nueva Base 1` (o el nombre que elijas) con todos los headers canónicos del sistema en el orden default.

**Qué debes hacer tú:**
1. Deja el nombre "Nueva Base 1" o escribe otro (ej: "Nueva Base Reorganizada")
2. Click **Crear hoja**
3. Verás el mensaje `✓ Hoja "X" creada con 75 columnas canónicas`

**Qué NO pasa:** La hoja `Nueva Base Solicitudes` no se toca. Sigue activa y funcionando normal.

---

### Paso 2 — Reorganizar columnas (manual)

**Qué hace:** Nada automático — este paso es 100% manual tuyo.

**Qué debes hacer tú:**
1. Ve a la nueva hoja que acabas de crear (`Nueva Base 1`)
2. Reorganiza las columnas como prefieras:
   - **Mover columnas:** arrastra el header a otra posición
   - **Agregar columnas nuevas:** inserta columna, escribe el header (cualquier nombre que tú quieras)
   - **Quitar columnas:** borra la columna. **⚠️ Si borras una columna canónica, el sistema te avisará en el paso 3**
   - **Cambiar formato:** aplica colores, bordes, formatos numéricos — lo que quieras
3. Cuando termines, regresa al sidebar y click **Listo, continuar →**

**Headers canónicos (no se pueden borrar):**

Todos estos 75 deben existir en la nueva hoja:

```
FECHA SOLICITUD, EMPRESA, CIUDAD ORIGEN, CIUDAD DESTINO, # ORDEN TRABAJO,
# PERSONAS QUE VIAJAN, CORREO ENCUESTADO, CÉDULA PERSONA 1..5, NOMBRE PERSONA 1..5,
CENTRO DE COSTOS, VARIOS CENTROS COSTOS, NOMBRE CENTRO DE COSTOS (AUTOMÁTICO),
UNIDAD DE NEGOCIO, SEDE, REQUIERE HOSPEDAJE, NOMBRE HOTEL, # NOCHES (AUTOMÁTICO),
FECHA IDA, FECHA VUELTA, HORA LLEGADA VUELO IDA, HORA LLEGADA VUELO VUELTA,
ID RESPUESTA, APROBADO POR ÁREA?, COSTO COTIZADO PARA VIAJE,
FECHA DE COMPRA DE TIQUETE, PERSONA QUE TRAMITA EL TIQUETE /HOTEL, STATUS,
TIPO DE COMPRA DE TKT, FECHA DEL VUELO, No RESERVA, PROVEEDOR, SERVICIO SOLICITADO,
FECHA DE FACTURA, # DE FACTURA, TIPO DE TKT, Q TKT, DIAS DE ANTELACION TKT,
VALOR PAGADO A AEROLINEA Y/O HOTEL, VALOR PAGADO A AVIATUR Y/O IVA, TOTAL FACTURA,
PRESUPUESTO, TARJETA DE CREDITO CON LA QUE SE HIZO LA COMPRA, OBSERVACIONES,
QUIÉN APRUEBA? (AUTOMÁTICO), APROBADO POR ÁREA? (AUTOMÁTICO), FECHA/HORA (AUTOMÁTICO),
CORREO DE QUIEN APRUEBA (AUTOMÁTICO), FECHASIMPLE_SOLICITUD, OPCIONES (JSON),
SELECCION (JSON), SOPORTES (JSON), CORREOS PASAJEROS (JSON), ID SOLICITUD PADRE,
TIPO DE SOLICITUD, TEXTO_CAMBIO, FLAG_CAMBIO_REALIZADO, ES INTERNACIONAL,
VIOLACION POLITICA, APROBADO CDS, APROBADO CEO, SELECCION_TEXTO,
COSTO_FINAL_TIQUETES, COSTO_FINAL_HOTEL, ES_CAMBIO_CON_COSTO, FECHA_SOLICITUD_PADRE,
EVENTOS_JSON, MODO_SOLICITUD
```

**Headers extras (tuyos, no se borran):** Cualquier columna que agregues con un nombre que NO esté en la lista canónica es un "extra". El sistema la respeta y NO la toca.

---

### Paso 3 — Verificar estructura

**Qué hace:** El sistema compara los headers de tu hoja reorganizada con los canónicos. Te dice qué falta y qué es extra.

**Qué debes hacer tú:**
1. Click **Verificar headers**
2. Revisa el resultado:

**Caso A — Todo OK:**
```
✓ Estructura OK. Puedes continuar al paso 4.
Headers canónicos requeridos: 75
Headers en la hoja: 75+
Faltantes: 0
Extras: 0 (o los que tú agregaste)
```

**Caso B — Faltan headers:**
```
Faltan 2 headers. Agrégalos a la hoja y vuelve a verificar.
```
Y abajo verás la lista con los nombres exactos. Ve a la hoja, crea las columnas faltantes con los nombres exactos, regresa al sidebar y click **Verificar headers** de nuevo.

**Caso C — Tienes extras:**
```
Headers extras (preservados, no se borran): PRIORIDAD, NOTAS INTERNAS
```
Esto es informativo. Los extras se preservan, sus datos no se borran, sus validaciones/formatos se mantienen.

---

### Paso 4 — Migrar datos + validaciones

**Qué hace:** Copia TODAS las filas de `Nueva Base Solicitudes` a tu hoja reorganizada, mapeando cada columna por su nombre.

**Orden interno (optimizado para persistir validaciones):**
1. Aplica validaciones (dropdowns) al rango destino
2. Aplica formatos de número (incluyendo **pesos colombianos automáticos** a columnas de dinero)
3. Aplica fondo amarillo a columnas editables
4. Escribe los datos sobre las celdas ya formateadas
5. Redimensiona (auto-resize) todas las columnas para que el texto quepa

**Formato de pesos colombianos (automático, no negociable):**
Aplicado a: `COSTO COTIZADO PARA VIAJE`, `VALOR PAGADO A AEROLINEA Y/O HOTEL`, `VALOR PAGADO A AVIATUR Y/O IVA`, `TOTAL FACTURA`, `PRESUPUESTO`, `COSTO_FINAL_TIQUETES`, `COSTO_FINAL_HOTEL`. Se renderiza como `$1.200.000`.

**Opciones:**
- **☑ Migrar validaciones (dropdowns)**: Copia los dropdowns de `PERSONA QUE TRAMITA` y `TARJETA DE CREDITO`.
- **☑ Aplicar fondo amarillo a columnas editables**: Pinta las 11 columnas que el analista llena manualmente.

**Qué debes hacer tú:**
1. Deja las 2 opciones marcadas (default)
2. Click **Migrar ahora**
3. Confirma en el popup
4. Espera (puede tomar 60-90 segundos con ~2000 filas)

**Resultado esperado:**
```
Filas migradas: 1974
Columnas mapeadas: 75
Validaciones copiadas: 2
Formatos copiados: 4
Cols con moneda aplicada: 7
Cols pintadas amarillo: 11
```

**Advertencias posibles:**
- **⚠️ Columnas perdidas**: Si en la hoja original hay una columna que NO existe en la nueva, te avisa qué se perdió.
- **ℹ️ Columnas extras en destino**: Confirma que tus extras quedaron preservadas intactas (el código escribe SOLO a columnas mapeadas, no toca las extras).

**Qué NO pasa:** La hoja `Nueva Base Solicitudes` sigue intacta. Solo se LEE, nunca se modifica.

---

### Paso 5 — Verificar migración

**Qué hace:** Te permite inspeccionar solicitudes específicas en la nueva hoja para verificar que los datos quedaron bien.

**Qué debes hacer tú:**
1. En el dropdown **Solicitud**, selecciona un ID (aparecen las 100 más recientes)
2. Se muestra una lista completa de TODOS los campos de esa solicitud con sus valores
3. Abre la hoja original, busca la misma solicitud, y compara visualmente

**Qué verificar:**
- ✓ Datos correctos (nombres, fechas, costos, observaciones)
- ✓ Dropdowns funcionan (si pones el cursor en una celda editable)
- ✓ Fondo amarillo aplicado a columnas editables
- ✓ Tus columnas extras quedaron vacías (listas para que tú las llenes si quieres)

**Revisa al menos 3-5 solicitudes diferentes:**
- Una reciente con muchos datos (ej: PROCESADO, con facturas)
- Una en estado intermedio (ej: PENDIENTE_APROBACION)
- Una con modificaciones (ES_CAMBIO_CON_COSTO = SI)
- Una anulada

Si todo está OK: click **Migración OK, continuar →**

---

### Paso 6 — Activar nueva hoja

**⚠️ Este es el único paso irreversible automáticamente.**

**Qué hace:**
1. Renombra la hoja activa `Nueva Base Solicitudes` → `Nueva Base Solicitudes_OLD_<fecha>`
2. Renombra tu hoja reorganizada → `Nueva Base Solicitudes`
3. El backend empieza a leer automáticamente de la nueva hoja

**Qué debes hacer tú:**
1. Click **Activar nueva hoja**
2. Confirma en el popup (lee el mensaje completo)
3. Espera ~5 segundos
4. Verás el mensaje:
```
✓ Activación completa.
Hoja antigua: Nueva Base Solicitudes_OLD_20260413_2345
Hoja activa: Nueva Base Solicitudes
```

**Qué hacer después:**
1. **Prueba crear una solicitud nueva** desde la app → debe aparecer en la nueva hoja
2. **Prueba aprobar una** → el botón del correo debe funcionar
3. **Prueba las métricas** → deben mostrar todas las solicitudes

### Paso 7 — Ocultar columnas (opcional, independiente)

**Qué hace:** Permite ocultar columnas de la vista sin quitarlas del sheet. Las columnas ocultas siguen siendo leídas/escritas por el backend, solo quedan invisibles.

**Cuándo usarlo:**
- Después del switch, para simplificar la vista diaria del admin
- Sobre cualquier hoja en cualquier momento (no depende de los pasos anteriores)

**Qué debes hacer tú:**
1. Elige la hoja del dropdown (default: `Nueva Base Solicitudes`)
2. Click **Cargar columnas**
3. Aparece la lista de todas las columnas con checkboxes:
   - ☑ = visible
   - ☐ = ocultar
   - Las columnas "extras" (no canónicas) aparecen marcadas en ámbar
4. Marca/desmarca las que quieras
5. Click **Aplicar** → se ocultan/muestran instantáneamente en la hoja

**Ideas de uso:**
- Ocultar columnas automáticas: `(AUTOMÁTICO)`, `FECHASIMPLE_SOLICITUD`
- Ocultar columnas JSON: `OPCIONES (JSON)`, `SELECCION (JSON)`, `SOPORTES (JSON)`, `CORREOS PASAJEROS (JSON)`, `EVENTOS_JSON`
- Ocultar columnas legacy poco usadas: `PROVEEDOR`, `SERVICIO SOLICITADO`, `FLAG_CAMBIO_REALIZADO`

---

### Si algo sale mal

La hoja vieja está intacta con el nombre `Nueva Base Solicitudes_OLD_<fecha>`. Para revertir:

1. Renombra manualmente la hoja nueva: `Nueva Base Solicitudes` → `Nueva Base 1` (o cualquier nombre no-canónico)
2. Renombra la vieja: `Nueva Base Solicitudes_OLD_...` → `Nueva Base Solicitudes`
3. Recarga el sheet
4. Todo vuelve al estado anterior

---

## Después del switch

- **La hoja vieja** (`Nueva Base Solicitudes_OLD_<fecha>`) queda como respaldo histórico. No la borres hasta que confirmes que la nueva funciona perfectamente (idealmente 1-2 semanas de uso normal).
- **Pasado un tiempo** (meses), puedes borrarla manualmente o dejarla indefinidamente.
- **Para reorganizar otra vez**, repite todo el proceso con un nombre nuevo (ej: "Nueva Base 2").

---

## Reglas importantes

1. **No elimines columnas canónicas** — el sistema te avisará pero si avanzas igual, funciones del código pueden fallar
2. **No cambies los nombres de los headers canónicos** — el sistema los busca por nombre exacto (incluye tildes, mayúsculas, espacios)
3. **Las columnas extras son 100% tuyas** — el sistema nunca las toca, escribe, ni lee. Son tu espacio de trabajo personal
4. **El fondo amarillo es solo visual** — no restringe nada. Cualquier persona con acceso al sheet puede editar cualquier celda (incluyendo dropdowns o texto libre)
5. **Los dropdowns solo se copian para las columnas que los tenían en la hoja original** — Si tú agregaste uno manualmente en una columna antes de migrar, ese dropdown se copia. Si quieres dropdowns nuevos, agrégalos a mano después en la hoja activa

---

## Troubleshooting

**P: El sidebar no aparece en el menú**
R: Recarga el sheet (F5). Si sigue sin aparecer, verifica que el Code.gs en producción incluya la función `abrirSidebarReorg`.

**P: Me da error "No existe el archivo HTML ReorgSidebar"**
R: El archivo `ReorgSidebar.html` no fue subido al proyecto GAS. Súbelo desde `server/ReorgSidebar.html`.

**P: Hice la migración pero faltan solicitudes en la nueva hoja**
R: Revisa en el paso 5 si el dropdown muestra todos los IDs esperados. Si no, la causa probable es que había filas con IDs vacíos en la hoja original (comunes si alguien insertó filas sin datos). Esto no es un bug — las filas sin ID nunca se migran.

**P: Las métricas no se cargan después del switch**
R: Normal en la primera carga. El cache en Drive se regenera automáticamente. Espera ~30s y recarga el panel.

**P: Quiero revertir pero ya pasó 1 semana**
R: Puedes hacerlo igual. Renombrar las hojas como se indica arriba funciona siempre. Pero las solicitudes creadas en la hoja nueva durante esa semana no estarán en la vieja. Si reviertes, perderías esas solicitudes (a menos que las migres manualmente).

---

*Última actualización: 2026-04-13*
