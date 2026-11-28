# Guía del área de compras — Portal de Viajes Equitel

> **Para quién es:** quien gestiona los viajes día a día — cotizar opciones, confirmar
> costos, registrar reservas, resolver cambios y mantener la base de usuarios.
>
> **Si lo que busca es el procedimiento completo** (quién interviene en cada etapa y qué
> pasa en cada caso), está resumido en una hoja en la
> [infografía del procedimiento](./infografia-procedimiento.html).
>
> **Lo que no cubre:** la parte técnica del sistema (activadores, propiedades del script,
> respaldos, despliegue). Eso está en la *Guía técnica del administrador*, dentro del repo.

---

## 1. Vista general

### ¿Qué es el sistema?

Una plataforma web donde los empleados piden viajes y hospedajes corporativos, sus jefes aprueban, y el área de compras gestiona la compra. Todo el estado vive en un Google Sheets, la lógica en un proyecto Apps Script, y el frontend en React desplegado en Cloud Run.

### Los cuatro roles de usuario

| Rol | Qué hace | Dónde ingresa |
|---|---|---|
| **Solicitante** | Crea solicitudes de viaje/hospedaje, selecciona opciones, sube soportes post-viaje. | Botón rojo **INGRESAR** con su correo corporativo + PIN personal. |
| **Aprobador** | Recibe correo de aprobación, click en APROBAR o DENEGAR. NO necesita iniciar sesión en la app. | Botones firmados HMAC en el correo. |
| **Analista / Admin (ANALYST)** | Cotiza opciones, confirma costos, registra reservas, gestiona usuarios, consulta métricas. Puede saltar la etapa de selección cuando el viaje se gestionó fuera del sistema. Puede omitir el correo automático al registrar una reserva. | Botón negro **ADMINISTRADOR** con PIN admin compartido, o botón rojo **INGRESAR** con su PIN personal si tiene fila en USUARIOS. |
| **Superadmin (SUPERADMIN)** | Todo lo del analista **más**: recibir escalamientos cuando los aprobadores no responden, alternar entre vista admin y vista usuario con el botón **VER USUARIO / VER ADMIN**, y modificar cualquier solicitud (no solo las propias). | Igual que analista. El rol se asigna en `SUPER_ADMIN_EMAILS` (Script Property). |

> **Jerarquía:** SUPERADMIN hereda todo lo de ANALYST; ANALYST hereda todo lo de SOLICITANTE. Quien está en `SUPER_ADMIN_EMAILS` NO necesita estar también en `ANALYST_EMAILS` — la herencia es automática.

---
## 2. Ciclo de vida de una solicitud (estados)

```
  CREAR
    ↓
  PENDIENTE_APROBACION       ← aprobadores pueden aprobar/denegar por correo
    ↓ (aprobado)
  PENDIENTE_OPCIONES          ← analista debe subir opciones de vuelo/hotel
    ↓ (opciones subidas)
  PENDIENTE_SELECCION         ← usuario debe describir su selección
    ↓ (usuario escribe)
  PENDIENTE_CONFIRMACION_COSTO ← analista debe confirmar costos finales
    ↓ (costos confirmados)
  PENDIENTE_APROBACION         ← nueva aprobación si >$1.2M o internacional
    ↓
  APROBADO                    ← todas las aprobaciones completas
    ↓ (analista registra reserva)
  RESERVADO                   ← PNR + archivos de confirmación subidos
    ↓ (post-viaje, soportes subidos)
  PROCESADO                   ← estado final
```

**Estados terminales** (no pueden volver):
- `DENEGADO` — algún aprobador dijo no
- `ANULADO` — cancelada manualmente por admin o usuario
- `PROCESADO` — ciclo completo

**Estado especial de cambios:**
- `PENDIENTE_ANALISIS_CAMBIO` — una solicitud "hija" que reemplaza a otra. El admin decide pasarla a estudio (entra al flujo normal) o denegarla (y decidir qué hacer con la original).

**Estado especial de la política de anticipación (#A100, octubre de 2026):**
- `PENDIENTE_APROBACION_POLITICA` — la pidió un solicitante con menos anticipación de la que pide la política (8 días nacional, 30 internacional; también solo hospedaje). **No todas las que se piden fuera de plazo llegan a este estado**: algunas siguen el proceso normal desde el principio, marcadas fuera de política. Ver [§3.15](#515-solicitudes-fuera-de-plazo-y-tarifas-superiores-aprobación-del-cfo).

**Aprobadores requeridos según el tipo de solicitud:**

| Tipo de solicitud | Aprobador de área | Director de Cadena de Suministro (CDS) | Gerencia General (CEO) |
|---|---|---|---|
| Nacional ≤ $1.200.000 | ✅ obligatorio | ❌ no aplica | ❌ no aplica |
| Nacional > $1.200.000 | ✅ obligatorio | ✅ obligatorio | ❌ no aplica (se excluye desde el flujo) |
| Internacional (cualquier monto) | ✅ obligatorio | ✅ al menos uno de los dos | ✅ al menos uno de los dos |

Cuando el solicitante **es** un ejecutivo (CEO o CDS), su sola aprobación basta y los banners de "aprobación extraordinaria" / "internacional" se ocultan para no saturarlo. La app también incluye una **defensa en el mapper**: si el status global es `APROBADO` pero la celda ejecutiva quedó vacía porque el propio ejecutivo se aprobó a sí mismo, la app muestra `APROBADO` en esa fila automáticamente.

---
## 3. El trabajo del día a día

### 3.1 Cotizar opciones (PENDIENTE_OPCIONES → PENDIENTE_SELECCION)

1. Panel admin → fila con status `PENDIENTE_OPCIONES`
2. Abre el detalle → **"Subir imágenes de opciones"**
3. Para vuelos: sube una imagen por opción (A, B, C…). Si hay ida y vuelta, indica dirección IDA o VUELTA. Para hoteles: sube una imagen por opción.
   - En vuelos, arriba aparece la **tarifa a cotizar según el manual COM-P-02** (#A95): TIPO 1 para viajes de 0 a 1 noche, TIPO 2 de 2 a 5 y TIPO 3 de 6 o más, con su nombre en cada aerolínea (por ejemplo, TIPO 2 = Avianca Classic, LATAM Light).
4. Al guardar, el sistema envía automáticamente un correo al solicitante con las imágenes.

### 3.2 Revisar selección y confirmar costos (PENDIENTE_CONFIRMACION_COSTO → PENDIENTE_APROBACION)

1. Fila con status `PENDIENTE_CONFIRMACION_COSTO`
2. **"Confirmar costos"** abre un modal con todo el detalle de la solicitud a la izquierda (#A81): viaje, datos corporativos y OT, pasajeros con su fecha de nacimiento y celular, hospedaje, observaciones y las imágenes de las opciones. A la derecha, el texto que escribió el usuario ("Opción A, categoría Económica…") y el formulario. Ya no hace falta abrir la solicitud en otra pestaña.
3. Escribe el costo de los tiquetes y, si aplica, el del hotel, en pesos, con o sin puntos de miles (`889.518` o `889518`). Bajo cada campo aparece cómo se va a registrar. Si no tiene costo (por ejemplo, un apartamento corporativo), escribe `0`; cualquier otro valor debe ser de al menos $10.000. La confirmación avisa si el total queda en $0.
   - **Compra prevista** (#A82): la **aerolínea** (lista o "Otra…") y el **canal**: *Aviatur*, *Directo* (con la aerolínea o, en solo hospedaje, con el hotel) u *Otra agencia*. Son obligatorios; en solo hospedaje no se pide aerolínea.
   - **Regreso con otra aerolínea** (#A85): si la ida es con una aerolínea y el regreso con otra (por ejemplo, LATAM de ida y Avianca de regreso), marca *"El regreso es con otra aerolínea"* y elige la del regreso. Solo aparece en viajes con regreso.
   - **Tarifa del tiquete** (#A95): viene seleccionada la que recomienda el manual COM-P-02 por las noches del viaje, con el equipaje que incluye. Si vas a comprar otra, elígela y escribe por qué en *"¿Por qué otra tarifa?"* (mínimo 10 caracteres). Si el viajero marcó *maleta de bodega* en la solicitud, el bloque lo dice y muestra qué tarifas la incluyen; al elegir una de ellas el motivo se llena solo (puedes cambiarlo), y si eliges una que no la incluye te avisa. Es obligatoria en vuelos; en solo hospedaje no aparece. Ver [manual-com-p-02.md](manual-com-p-02.md).
   - **Soporte del costo** (#A128, opcional): el pantallazo o el PDF de la cotización con el precio de hoy. La forma más rápida: toma el pantallazo y, con la ventana de *Confirmar costos* abierta, pulsa **Ctrl+V** (no hace falta hacer clic en ningún lugar). También puedes arrastrar el archivo al recuadro o hacer clic para elegirlo. Imágenes o PDF, hasta 10 MB cada uno y máximo 5; con la ✕ quitas uno. Los archivos se suben al tocar *Confirmar y Enviar* (si cancelas, no se guarda nada). Quien aprueba los ve en el correo, en «Mis aprobaciones» y en el detalle, con la fecha y la hora en que confirmaste y la frase *«Las tarifas cambian con los días: este es el valor de ese momento»*. Así, si aprueban días después y el precio ya subió, se sabe por qué registraste ese valor. El viajero también lo ve en su solicitud.
4. Al guardar, si el total ≤ $1.2M y no es internacional → pasa a `APROBADO` directo. Si no → pasa a `PENDIENTE_APROBACION` y se envía correo a CEO + CDS + aprobador de área.

**Costos mal digitados antes del 2026-09-14:** con el campo anterior, `889.518` se guardaba como 889 pesos con decimales. **Equitel Viajes → 11. Corregir costos mal digitados** los corrige: muestra una vista previa, pide confirmación, deja una nota en OBSERVACIONES y el detalle en la pestaña "Reporte corrección costos". Los que no se pueden deducir (por ejemplo, costos de $1) solo los lista para revisarlos a mano.

   - **Tarifa superior a la del manual** (#A100): si eliges una tarifa de mayor TIPO que la recomendada (con nombre distinto, p. ej. *Light* en un viaje de 1 noche), el bloque avisa que la aprobación también le pedirá el voto a quien aprueba las excepciones (hoy Alejandro Gómez). Ver [§3.15](#515-solicitudes-fuera-de-plazo-y-tarifas-superiores-aprobación-del-cfo).

### 3.3 Registrar reserva (APROBADO → RESERVADO)

1. Fila con status `APROBADO`
2. Abre el detalle → **"Registrar reserva"**
3. Ingresa:
   - **No. reserva / PNR** (texto libre, 3-10 caracteres usualmente)
   - **Tarjeta de crédito** usada (del dropdown)
   - **Fecha de compra** (hoy por default; si ya hay una guardada, por ejemplo de una reserva parcial, viene esa)
   - **Archivos de confirmación** (PDF de la aerolínea / hotel — puedes subir varios)
   - **Compra (aerolínea y canal)** (#A82): viene llena con lo previsto al confirmar costos. Cámbiala si se compró por otro canal (por ejemplo, directo con la aerolínea porque Aviatur no ajustó el precio). Es obligatoria al registrar; al corregir una reserva es opcional. Si el regreso se compró con otra aerolínea, marca *"El regreso es con otra aerolínea"* (#A85).
   - **Tarifa comprada** (#A95): viene con la que se registró al confirmar costos. Cámbiala si al final se compró otra; si no es la recomendada, escribe por qué. Es obligatoria al confirmar la reserva; al corregir o con *"Guardar sin enviar"* solo se revisa si la cambias.
   - **Hotel (nombre y canal)** (#A94): solo en solicitudes con hospedaje. Viene con el hotel que pidió el viajero; cámbialo si reservaste otro y elige el canal (*Aviatur*, *Directo con el hotel* u *Otra agencia*). Es obligatorio al confirmar la reserva; con *"Guardar sin enviar"* puede quedar para después. Si al final no se reservó hotel (lo quitó el aprobador o es un apartamento corporativo), marca *"No se reservó hotel"*. En solo hospedaje este bloque reemplaza al de compra.
   - **Valor pagado (opcional)** (#A102): lo que se pagó por los tiquetes y, si hubo hotel, por el hotel, en pesos (con o sin puntos de miles; 0 vale para un apartamento corporativo). Si aún no lo tienes, déjalo vacío y agrégalo después con *"Corregir reserva"*. Mientras llega la factura, el dashboard de costos usa este valor en vez de lo cotizado.
4. Al guardar:
   - La carpeta en Drive se renombra a `SOL-000123 - PNR12345 - TC 1234 - MAY 26`
   - Se envía correo al usuario con el PNR y los archivos adjuntos

### 3.4 Corregir una reserva ya registrada (RESERVADO → RESERVADO)

Si algo salió mal (PNR equivocado, archivo erróneo, cambió la tarjeta):

1. Fila con status `RESERVADO`
2. Abre el detalle → **"Corregir reserva"**
3. Puedes:
   - Editar PNR / tarjeta / fecha (la fecha viene con la de compra registrada: cámbiala solo si está mal)
   - Eliminar archivos existentes
   - Subir archivos nuevos
   - Agregar nota de corrección (explicación libre)
   - Cambiar la compra: aerolínea, canal, tarifa, hotel o valor pagado
4. El usuario recibe un correo "Corrección de reserva" con los nuevos datos.
   - **Excepción (#A102):** si solo cambiaste la compra (aerolínea, canal, tarifa, hotel o valor pagado) y nada de la reserva (PNR, tarjeta, fecha, archivos ni nota), se guarda **sin correo**: el viajero no ve esos datos. Así puedes agregar el valor pagado cuando lo tengas.

### 3.5 Cerrar la solicitud (RESERVADO → PROCESADO)

Cuando los soportes post-viaje están listos:

1. Fila con status `RESERVADO`
2. **"Finalizar solicitud"** → se genera automáticamente el reporte PDF de soporte
3. Estado final: `PROCESADO`

**Listas para cerrar y facturas por revisar (#A83).** En el panel del analista aparece una barra con dos cifras: **✅ Listas para cerrar** y **🧾 Facturas por revisar**. Al abrirla se ven las dos listas. **Ninguna solicitud se cierra sola:** tú las revisas y las cierras.

**Listas para cerrar.** Solicitudes `RESERVADO` que cumplen las tres condiciones:
- el viaje ya terminó (fecha de regreso o, si es solo ida, la de ida, anterior a hoy). Antes no aparecen, porque una solicitud `PROCESADO` ya no se puede modificar.
- lo facturado es **igual o mayor** que lo cotizado. Una diferencia menor a $1.000 cuenta como igual (redondeo). Facturar de más es normal y no es error.
- hay **al menos un PDF de factura subido por el sistema por cada factura escrita** (los de la reserva no cuentan). Es la misma regla con que avisa el cierre manual, y es necesaria porque con la solicitud `PROCESADO` ya no se pueden subir soportes desde la app.

Lo facturado se suma igual que en el dashboard de costos, con las facturas 1 a 6. Cada fila muestra cotizado, facturado y cuántos PDF hay. El botón **Cerrar** es el cierre manual de siempre: pide confirmación (con el resumen "Facturado $X de $Y cotizado; N PDF de M facturas") y genera el reporte PDF.

**Facturas por revisar.** Viajes terminados hace 7 días o más cuyas facturas suman menos de lo cotizado, no tienen ninguna o no tienen sus PDF subidos. Cada fila muestra cotizado, facturado y lo que falta: el monto, o "Faltan PDF (1 de 2)". Botones:
- **Subir PDF:** abre los soportes de la solicitud. Al subir el que falta y pulsar **↻ Actualizar**, pasa a "Listas para cerrar".
- **Cerrar:** el cierre manual de siempre, aunque falten facturas.
- **Omitir aviso:** deja de mostrarla y anota quién y cuándo en la columna `AVISO FACTURAS OMITIDO`. Si después se completan las facturas y sus PDF, pasa a "Listas para cerrar". Para volver a ver el aviso, borra esa celda.

Las listas se consultan al abrir el panel y con **↻ Actualizar**. No envían correos ni cambian nada en la hoja.

### 3.6 Gestionar solicitudes de cambio («Cambiar mi viaje», #A103)

Desde el 19-oct los viajeros piden los cambios con el botón **😕 ¿Necesita cambiar su viaje?**: fecha, hora, destino, **regreso a otra ciudad** (#A134, desde el 24-nov: el regreso llega a una ciudad distinta del origen, p. ej. Medellín → Bogotá y regreso a Pereira; queda en `CIUDAD REGRESO` y en el detalle dice «Regresa a …») o equipaje, con un motivo obligatorio, hasta las **5:00 p. m. del día hábil anterior al vuelo** (sábado 12:00 m.; domingos y festivos no cuentan). Con el viaje en curso solo cambian el regreso. Si el tiquete **no se ha comprado**, nadie ha volado: el viajero cambia todo el viaje con una fecha de ida nueva que dé tiempo, aunque la de la solicitud ya haya llegado (#A120, caso SOL-000714). En el panel esas solicitudes dicen **IDA VENCIDA · SE PUEDE CAMBIAR** en vez de «ABANDONADA», y **CAMBIO EN CURSO** si ya tienen uno (#A126); usted lo registra a nombre del viajero con «Solicitar Cambio» en el detalle. Puede poner una ida que ya pasó (el viajero ya voló, p. ej. porque no había tiquete el día pedido) mientras el regreso sea de hoy en adelante (#A127); si el viaje ya terminó del todo, es una solicitud nueva. Después del plazo, y solo si es urgente, el portal les dice a quién llamar y en qué orden (tabla de MISC, **menú 16**; ver abajo). **Después del plazo, el viajero sí puede pedir alargar el viaje** (#A129, casos SOL-000777 y SOL-000782): con el tiquete comprado y el regreso de hoy en adelante, un regreso más tarde (fecha u hora) y, si hace falta, otro hospedaje. Te llega con el aviso **«Pedido después del plazo… Es urgente»** y en «Revisar Cambio» dice **«Se pidió después del plazo»**: gestiónalo ese mismo día. En la aprobación vota también quien aprueba las excepciones (hoy Alejandro Gómez), además del aprobador de área; no se puede comprar hasta que los dos aprueben (o Yurani o David salten la etapa).

Se crea una solicitud "hija" en `PENDIENTE_ANALISIS_CAMBIO`, ligada a la original, con lo de antes y lo de ahora. Te llega el correo **CAMBIO DE VIAJE**.

1. En el panel, la fila del cambio tiene **🔄 Revisar Cambio**. La ventana muestra:
   - qué cambia (antes / ahora), el motivo y si la maleta se pidió después de comprar;
   - **lo que ya se compró** de la original (PNR, aerolínea, canal, tarifa, valor pagado, tarjeta, fecha y archivos);
   - un **mensaje listo para la agencia** con el botón para copiarlo.
2. **ACEPTAR Y COTIZAR** → la hija sigue el flujo de siempre (opciones, selección del viajero o saltar la selección, confirmar costos, aprobación, reserva).
   **Denegar** funciona igual que antes (mantener la original, anularla o consultar al usuario).
3. **Confirmar costos** de un cambio de un tiquete **ya comprado**: se escribe **solo el costo del cambio** en tres campos: *Penalidad y cargos*, *Diferencia de tarifa* y *Hotel* (si cambió). Al lado ves lo que costó el viaje, el viaje con el cambio y cuánto suma. Si no tiene costo, escribe 0: igual va al aprobador.
4. El aprobador recibe **APROBACIÓN DE CAMBIO** con lo que costó el viaje, el costo del cambio y el total. Cadena de Suministro aprueba si el **viaje con el cambio** supera $1.200.000.
5. Al **registrar la reserva** del cambio, la aerolínea, el canal, el PNR y la tarjeta vienen de la compra original: corrige solo lo que cambió. La original **no se anula**: queda «Cambiada» (columna `REEMPLAZADA POR`) y su costo sigue contando.

Si el tiquete **no se había comprado**, la hija se cotiza como el viaje completo y la original se anula al aprobarse el cambio, como antes.

**Si la original tiene la reserva guardada por partes** («Guardar sin enviar», sigue en APROBADO; #A109): para la plataforma el tiquete **ya está comprado**. En **Revisar Cambio** sale un aviso amarillo y *ACEPTAR Y COTIZAR* queda desactivado hasta que confirmes lo que se compró:
1. Toca **Confirmar lo que se compró de SOL-…**. Se abre *Registrar reserva* de la original, con el PNR, la compra y lo pagado ya puestos y **sin correo al viajero** (ya pidió otras fechas).
2. Si el hotel no se alcanzó a reservar, marca **No se reservó hotel**: el hotel de las fechas nuevas va en el cambio. Si sí se reservó, escribe el hotel y lo pagado.
3. **Confirmar lo que se compró** → la original queda RESERVADO y sale un aviso verde. Ahora sí, **ACEPTAR Y COTIZAR**: el cambio se cotiza como cambio de un tiquete comprado (penalidad, diferencia de tarifa y hotel) y la original no se anula.

**Si un viajero te pide un cambio por correo, teléfono o WhatsApp** (#A106, Yurani y David, 22-oct):
- **Si todavía está en plazo**, pídele que lo haga en la plataforma con «Cambiar mi viaje»: así queda con su motivo y a su nombre. Si abres **Solicitar Cambio** en un viaje así, la ventana te avisa en amarillo que el viajero todavía puede pedirlo él mismo y hasta cuándo.
- **Si ya pasó el plazo y es urgente**, ábrelo desde el detalle de la solicitud con **Solicitar Cambio**. Lo registras a nombre del viajero, sin plazo, y queda constancia de que lo registraste tú. Si hay que cambiar pasajeros, el centro de costo o el hotel, usa **el formulario completo** desde esa misma ventana.

**A quién llama el viajero después del plazo (menú 16).** La lista está en MISC: correo, nombre y cargo de cada persona, en el orden en que se llama (la primera y, si no responde, la siguiente; máximo 3). El celular se toma de la columna *Celular* de USUARIOS, así que se corrige en un solo lugar (sidebar o panel móvil). **Equitel Viajes → 16. Contactos para cambios de viaje** crea la tabla la primera vez (con Laura y Diego), muestra el mensaje que ve el viajero y avisa si a alguien le falta el celular. Si alguien cambia de rol, se cambia su fila. La app lo muestra en unos 10 minutos, o de inmediato al volver a correr el menú.

**Control:** *Métricas → 🔄 Cambios* muestra cada cambio con lo que costó el viaje, el costo del cambio, la penalidad, las maletas pedidas después y el total por unidad (y CSV). El dashboard de costos tiene la pestaña **🔄 Cambios de viaje** por unidad (cada líder ve las suyas) y el informe mensual trae la sección «Cambios de viaje».

### 3.7 Anular una solicitud

1. Fila con cualquier status activo
2. Detalle → **"Anular"**
3. Requiere motivo → queda en el campo `OBSERVACIONES` + correo al usuario

### 3.8 Saltar la etapa de SELECCIÓN (cualquier analista)

Cuando los tiquetes ya se compraron por fuera del sistema y no tiene sentido pedirle al usuario que "seleccione una opción":

1. Carga las opciones desde el modal **"Subir imágenes de opciones"** — desmarca el checkbox **"Enviar correo al usuario"** si no quieres notificarlo. Las opciones quedan guardadas solo para trazabilidad.
2. La solicitud avanza directamente a `PENDIENTE_CONFIRMACION_COSTO`, lista para que confirmes los costos.
3. Alternativamente, si ya está en `PENDIENTE_SELECCION`: abre el detalle → botón indigo **"SALTAR SELECCIÓN"** → escribe justificación (≥10 caracteres) → confirma.

Queda registrado en OBSERVACIONES con tu correo, timestamp y justificación. No se envía correo al solicitante.

### 3.9 Saltar la etapa de APROBACIÓN (solo Yurani Prieto y David Sánchez)

**Quién puede:** solo Yurani Prieto y David Sánchez (decisión de Yurani, 2026-09-14). Es una lista fija en el código (`SKIP_APPROVAL_ALLOWED` en `Code.gs`), **no un rol**: ningún otro superadmin ni analista puede, aunque tenga acceso de administrador, y para cambiarla hay que modificar el código. Para comprobar quién puede: **Equitel Viajes → 10. Ver administradores y permisos especiales**. A los demás no les aparecen ni el botón ni la casilla, y el sistema rechaza el intento si llegara por otra vía.

Cuando un ejecutivo ya autorizó verbalmente, por WhatsApp o correo fuera del sistema, y quieres registrar la solicitud como APROBADA sin esperar más votos:

1. Fila con status `PENDIENTE_APROBACION` → abre el detalle.
2. Aparece un banner ámbar **"⏩ Saltar etapa de aprobación (permiso especial)"** con un botón **"SALTAR APROBACIÓN"**.
3. Click → justificación (≥10 caracteres) → confirma.
4. La solicitud pasa directamente a `APROBADO`. Las columnas `APROBADO POR ÁREA?`, `APROBADO CDS`, `APROBADO CEO` y `APROBADO PRESUPUESTO` se marcan con `Sí (ETAPA SALTADA por tu.correo)` y la justificación queda en OBSERVACIONES. Al solicitante no le llega correo (recibe el de "Tiquetes Comprados" cuando se registra la reserva). **A los aprobadores a los que ya se les había pedido el voto les llega un aviso** (#A118): que la solicitud quedó aprobada, que tú saltaste la etapa, cuándo y **con tu justificación**, y que no tienen nada pendiente. Escríbela pensando en que ellos la leen. Si alguno abre el enlace de un correo anterior, la página le dice lo mismo y no cambia nada.

**Alternativa equivalente durante confirmación de costos:** en el modal **"Confirmar costos"** aparece un checkbox "Saltar etapa de aprobación" con el mismo efecto, útil cuando sabes desde antes que no quieres pasar por aprobadores. Ahí no se le pidió el voto a nadie, así que nadie recibe el aviso.

### 3.10 Omitir correo al registrar reserva

En el modal **"Registrar reserva"** hay un checkbox **"Enviar correo al usuario"** marcado por default. Si el PNR ya se entregó al usuario por otro medio, desmárcalo. Aparece una confirmación doble para evitar errores. Queda nota en OBSERVACIONES.

### 3.11 Alternar vista admin ↔ usuario

Si eres analista o superadmin Y tienes solicitudes propias pendientes (p.ej. tú creaste una), puedes alternar entre el panel de analista y el panel de solicitante usando el botón **VER USUARIO / VER ADMIN** en el header. El sistema revalida tus permisos en cada switch.

### 3.12 Íconos de prioridad y proxy en el panel

El dashboard del analista marca con íconos las solicitudes que merecen atención especial:

- **⭐** — solicitud **prioritaria**: al menos un pasajero es un ejecutivo del grupo (CEO, CDS o equivalentes). Significa que parte del viaje puede haber sido gestionado por fuera del sistema; revisa antes de pedir selección.
- **👥** — solicitud **proxy**: el solicitante registró la solicitud a nombre de otra persona (el primer pasajero no coincide con su cédula). Útil para saber que el solicitante no es quien viaja.

Ambos íconos se calculan al leer la solicitud, comparando la cédula del primer pasajero contra el directorio de USUARIOS.

### 3.13 Fecha de creación visible en tabla y detalle

Las tablas de admin y usuario muestran ahora la **fecha de creación** de cada solicitud junto al ID, en formato local (`DD/MM/AAAA HH:mm`). El detalle también la muestra. El parser es tolerante con el formato almacenado (ISO o `DD/MM/YYYY`) para no romperse con solicitudes antiguas.

### 3.14 Conectividad y banner de fallas

Al arrancar, el frontend envía un **ping de warmup** al backend. Si la red local o Apps Script están caídos, aparece un banner rojo arriba informando que hay problemas de conectividad. El banner desaparece solo cuando la conexión vuelve. Esto evita que los usuarios confundan un error de red con un problema de permisos o credenciales.

Relacionado: si el login del admin falla por un error de red (no por PIN incorrecto), el mensaje ahora lo dice explícitamente y **no** consume un intento del rate-limit.

### 3.15 Solicitudes fuera de plazo y tarifas superiores: aprobación del CFO (#A100)

Desde octubre de 2026 (pedido de Yurani y reglas de Alejandro Gómez), **toda desviación de la política la aprueba el CFO antes de la compra**. Quién aprueba es el mismo responsable del **presupuesto excedido**: `budgetApproverEmail` y `budgetApproverName` en la **configuración del dashboard de costos** (⚙️, solo superadmin). Si se cambia allí, cambia para las dos reglas, y los enlaces que ya tenía el anterior dejan de servir.

**1. Anticipación.** Una solicitud nueva que no cumple 8 días (nacional) o 30 (internacional) **puede quedar** en `PENDIENTE_APROBACION_POLITICA`. Las que no quedan en ese estado te llegan como cualquier solicitud nueva, **marcadas fuera de política** (⚠️ en el detalle y en *Confirmar costos*) y contando igual en el informe mensual: gestiónalas con normalidad. Cuando sí queda en espera:

- **El área de compras no la gestiona**: no aparece en la lista principal del panel, ni en el resumen de pendientes, ni en métricas ni en el dashboard de costos. Para verlas hay un botón aparte, **«⏳ En espera de preaprobación (N)»**, arriba de la lista: muestra, solo para leer, quién la pidió, quién viaja, el viaje, la anticipación, la justificación y cuándo vence, con el aviso de que **no cumplen la política de anticipación y no se gestionan**.
- El solicitante escribe por qué (obligatorio) y recibe un correo **[EN ESPERA DE APROBACIÓN]**.
- El CFO recibe **un resumen cada 2 horas en horario laboral** (lunes a viernes de 7:00 a 17:00, sábados de 8:00 a 12:00, como los demás resúmenes) con una fila por solicitud y los botones **APROBAR** / **RECHAZAR**.
- **Aprobada** → pasa a `PENDIENTE_OPCIONES` y te llega un correo **[APROBADA POR EXCEPCIÓN]** como cualquier solicitud nueva. Los tiempos de las métricas cuentan desde ese momento.
- **Rechazada** → `DENEGADO` con el motivo «No se aprobó la excepción por incumplimiento de la política de anticipación». Solo se avisa al solicitante.
- **Vencida** (7 días sin respuesta o pasó la fecha del viaje) → `DENEGADO` sola, con el mismo motivo.
- **Lo que creas tú (cualquier administrador) no queda en espera**, por ejemplo al registrar un viaje que ya se compró por fuera: queda marcado fuera de política y cuenta en el informe.
- No aplica a las solicitudes de cambio.
- **Multidestino:** cada tramo se evalúa por su fecha, pero si **cualquier tramo** no cumple, **todo el viaje espera** (los tramos quedan enlazados en `GRUPO MULTIDESTINO`). En el resumen del CFO el viaje es una sola fila y **una decisión cubre todos los tramos**: aprobado, te llegan todos como nuevos; rechazado o vencido, se deniegan todos.

**2. Tarifa superior a la del manual.** Si al confirmar costos registras una tarifa de mayor TIPO que la recomendada (y es una excepción), la hoja marca `REQUIERE APROB TARIFA` y la aprobación le pide el voto al CFO (el mismo voto del presupuesto excedido: uno cubre los dos motivos). Al **registrar la reserva** no se puede subir la tarifa por encima de la aprobada; solo Yurani Prieto y David Sánchez pueden autorizarlo. Corregir una reserva ya registrada sí se permite (refleja lo que se compró).

**Hoja de cálculo:** columnas `JUSTIFICACION ANTICIPACION`, `APROBACION CFO ANTICIPACION` (`Sí_correo_fecha`, `No_…`, `Vencida_sistema_…`), `REQUIERE APROB TARIFA` y `GRUPO MULTIDESTINO`; las crea el sistema o el **menú 12**. El menú **13** activa el resumen cada 2 horas y el **14** muestra las solicitudes en espera, quién aprueba y cuántas personas leyeron el aviso.

**Aviso a los solicitantes:** cada solicitante ve al entrar una ventana con las reglas nuevas y debe tocar **«Entendido»**. No tiene fecha de fin: le sigue saliendo cada vez que entra hasta que lo acepta. Cada lectura queda en la hoja **CONSTANCIA AVISOS** (fecha y correo). Si la constancia no se puede guardar, la ventana lo dice y deja intentarlo otra vez.

**Apagar las reglas sin tocar código:** `"policyApprovalEnabled": false` en la configuración del dashboard de costos. Las solicitudes que ya estén en espera se quedan así hasta que se decidan o venzan.

**Informe mensual de cumplimiento (#A101):** el primer día hábil de cada mes, en horario laboral, la plataforma le envía a quien aprueba (hoy Alejandro Gómez), con copia a Yurani Prieto y David Sánchez, el informe del mes anterior. Trae lo mismo que el informe del 13 de octubre:

- las tres cifras del mes (pedidos fuera de plazo, compras a tiempo y viajes de 0–1 noche en tarifa superior) frente al mes anterior;
- la tendencia de los últimos 6 meses y el resultado por unidad;
- los cuadros de honor y de deshonor y «quién pide fuera de plazo», con los últimos 3 meses;
- las compras registradas después de hacerse y lo que pasó por el CFO (aprobadas, rechazadas, vencidas y tarifas superiores).

Lleva un PDF con lo mismo y un CSV con el detalle de cada solicitud del mes (sin cédulas). Cada viaje cuenta en el mes en que se pidió. Lo envía la misma pasada del resumen cada 2 horas, así que no necesita otro activador. El **menú 15** te lo manda solo a ti para revisarlo.

### 3.16 Centros de costos de otra unidad (#A133)

Desde noviembre de 2026 (pedido de Yurani) la plataforma sabe **a qué unidad pertenece el primer pasajero** (el que también decide el aprobador), y la unidad y el centro de costos del formulario son **a los que se carga el viaje**, como siempre. Si no coinciden, el viaje se carga a otra unidad:

- **El costo va a la unidad dueña del centro de costos**: `UNIDAD DE NEGOCIO` de la solicitud es esa unidad, y así cuenta en su presupuesto, en el dashboard de costos, en su reporte en Excel y en la aprobación de presupuesto excedido.
- **La solicitud queda marcada:** en el detalle sale el recuadro morado **🏷️ CENTRO DE COSTOS DE OTRA UNIDAD** (de qué unidad es el viajero y a cuál se cargó), la información corporativa dice *Unidad que paga* y *Unidad del viajero*, y en OBSERVACIONES queda la nota `[OTRA UNIDAD]`.
- **La aprueba también el responsable de esa unidad**, además del aprobador de siempre (y de Cadena de Suministro, Gerencia o el CFO si aplican). Su voto sale en *Aprobaciones* como **Unidad del centro de costos**. Si la unidad tiene varios responsables, basta con uno. Si el responsable es la misma persona que ya aprueba por otro motivo (por ejemplo, el jefe del viajero), su voto cubre los dos. Nadie aprueba su propio viaje.
- **Recordatorios, «Mis aprobaciones», avisos y la línea de tiempo** incluyen ese voto como cualquier otro. Saltar la etapa de aprobación también lo salta.

**De dónde sale cada cosa** (lo administra el área de compras desde la hoja; ver la guía de la hoja de cálculo):
- **La unidad del viajero:** columna `Unidad de negocio` de USUARIOS (**menú 17**, que la propone por el historial, el código de RR. HH. o el aprobador de cada persona). Si el primer pasajero no la tiene, el formulario le pregunta una sola vez y queda guardada (nunca cambia una ya escrita); la solicitud lleva la nota `[UNIDAD REGISTRADA]` y al aprobador le llega el aviso **🆕 UNIDAD REGISTRADA POR PRIMERA VEZ**. Al crear la solicitud el servidor vuelve a mirar USUARIOS: no vale lo que diga el navegador.
- **Quién responde por cada unidad:** la tabla `RESPONSABLE UNIDAD` de MISC (**menú 18**). **Una unidad sin responsable no aparece** entre los centros de costos de otras unidades, y si alguien intenta cargarle un viaje, la solicitud no se crea y le dice por qué. Un cambio de un viaje que ya estaba cargado allá sí pasa (marcado, sin el voto extra).

Si un viajero dice que su unidad está mal, se corrige en la columna `Unidad de negocio` de USUARIOS; las solicitudes nuevas ya salen con la correcta.

---
## 4. Capacidades exclusivas de SUPERADMIN

Los **superadmins** (configurados en `SUPER_ADMIN_EMAILS`) tienen capacidades adicionales que un analista normal no tiene. **Saltar la etapa de aprobación ya no es una de ellas** (#A77): solo Yurani Prieto y David Sánchez, ver 5.9.

| Capacidad | Disponible desde |
|---|---|
| **Botón VER USUARIO / VER ADMIN** | Header del panel de analista — alternar vistas. |
| **Recibir escalamientos** | Correos automáticos cuando una solicitud lleva 30h laborales sin aprobación (≈3 días hábiles). |
| **Ejecutar helpers de Script Properties** | `setScriptProperty`, `deleteScriptProperty`, `listScriptProperties` desde el editor GAS. |
| **Modificar cualquier solicitud** | El endpoint `requestModification` valida que el solicitante sea el dueño de la solicitud, pero el bypass permite que cualquier analista o superadmin gestione modificaciones a nombre del usuario (caso típico: el área de compras ajusta la solicitud por pedido verbal). Cualquier otro usuario autenticado solo puede modificar las suyas. |

**Configurar o quitar un superadmin:**
```javascript
// Desde el editor GAS → función temporal → ejecutar UNA vez:
setScriptProperty('SUPER_ADMIN_EMAILS', '["dsanchez@equitel.com.co","yprieto@equitel.com.co"]');
```
El cambio aplica **inmediatamente** (no requiere redeploy). Si quitas a alguien, su capacidad superadmin desaparece al siguiente request sin invalidar su sesión.

**Escalamiento automático a superadmins:** tras 30 horas laborales efectivas (L-V 7-17, Sáb 8-12) desde que una solicitud entra a `PENDIENTE_APROBACION` sin que los aprobadores respondan, el sistema envía UN correo único a todos los superadmins pidiéndoles intervenir. El correo sugiere 3 acciones: contactar al aprobador, saltar la aprobación (si el viaje ya fue autorizado por fuera) o anular. Después de ese correo, los recordatorios automáticos a los aprobadores se detienen para no saturar.

---
## 5. Gestionar usuarios (sidebar de USUARIOS)

**Cuándo usarlo:** agregar usuarios nuevos, cambiar aprobadores, detectar problemas.

**Tabs:**

| Tab | Para qué |
|---|---|
| **Usuarios** | CRUD básico. Buscar, crear, editar, eliminar, borrar PIN. Incluye la **unidad de negocio** de la persona (#A135). |
| **Unidades** | Quién responde por cada unidad de negocio (aprueba los viajes que otras unidades le cargan, #A133), con las personas que más aprobaron sus viajes como sugerencia. Lo ven todos los administradores; lo cambian solo Yurani Prieto y David Sánchez (#A135). |
| **Anomalías** | Diagnóstico: correos no corporativos, usuarios sin aprobador, aprobadores huérfanos (cédula no existe en USUARIOS). |
| **Reemplazar** | Si un aprobador sale de la empresa: reemplazar su cédula por la de otro en TODOS los usuarios que lo tienen como aprobador. Vista previa antes de aplicar. |
| **Ed. Masiva** | Cambios masivos: asignar/agregar aprobador, cambiar empresa/sede/CC o unidad de negocio a un grupo filtrado de usuarios (filtro «Sin unidad» para los que no la tienen). |
| **Duplicados** | Detecta filas con cédula, correo, o nombre repetido. Compara cada grupo lado-a-lado (datos + estado del PIN) y elimina las que sobran. |

#### 6.1.bis Comportamiento del formulario "Nuevo / Editar usuario"

El formulario tiene tres ayudas integradas para evitar errores típicos al gestionar directivos o usuarios urgentes:

- **Checkbox "Esta persona es su propio aprobador (autoaprobador)"** — Útil cuando llega un nuevo directivo (CEO, CDS, gerente) que se aprueba a sí mismo. Al marcarlo, se oculta el picker de aprobadores y al guardar el sistema escribe automáticamente la propia cédula, correo y nombre en las columnas G, H e I de USUARIOS — sin necesidad de crear primero al usuario y luego buscarlo en el picker. Funciona tanto al crear como al editar. Si abres a un usuario que ya era autoaprobador, el checkbox aparece pre-marcado.

- **Detector de duplicados en vivo** — A medida que escribes la cédula, correo o nombre, el formulario busca coincidencias en USUARIOS. Si la cédula o el correo ya existen, aparece un badge rojo y el botón **Guardar** se bloquea. Si solo el nombre coincide (homónimo), aparece un badge ámbar de advertencia pero deja guardar. Cada badge incluye un botón **"→ Ver / editar este usuario"** que lleva directo a editarlo, útil para corregir información en el registro existente en lugar de duplicarlo.

- **Sugerencias de nombre filtradas por Maestro RH** — El campo "Nombre" autocompleta con personas del Maestro RH, pero excluye automáticamente a las que ya están en USUARIOS. Así, al crear un nuevo usuario, las sugerencias muestran solo empleados aún no registrados.

- **Confirmación visual tras crear** — Después de guardar un usuario nuevo, el listado se refresca automáticamente, hace scroll hasta la fila del nuevo usuario y la resalta con un fondo amarillo durante 3 segundos. Te indica visualmente que quedó registrado.

- **Unidad de negocio** (#A135) — Lista con las unidades de «CDS vs UDEN». Al editar solo se guarda si la cambias; si la escrita en la hoja no es una de la lista, el formulario lo avisa en rojo. Vacía, el portal se la pregunta a la persona la primera vez que es primer pasajero.
## 6. Validaciones en los formularios

Tanto el sidebar como el panel móvil (§7) aplican validaciones "en vivo" mientras el admin escribe:

| Campo | Restricción |
|---|---|
| Cédula | Solo dígitos. Cualquier letra/símbolo se filtra al escribir. Teclado numérico en móvil. |
| Nombre completo | Auto-UPPERCASE mientras se escribe. Se preservan tildes y Ñ (ej: `CÓRDOBA`, `ZUÑIGA`). |
| Correo | Auto-lowercase. Espacios removidos. Validación de formato `algo@algo.algo` antes de enviar. |
| Centro de costo | Solo dígitos. Teclado numérico en móvil. |

Las validaciones se ejecutan también en el `Guardar`, por si el admin pega un valor con copy-paste que saltó los filtros. Si algo no cumple, no se envía al backend y se muestra el error.

**Sobre caracteres especiales (tildes, Ñ, Ü):** son **100% seguros** en el sistema. Los nombres se usan en correos, PDFs de reporte, nombres de archivos Drive y comparaciones — en todos los casos el código maneja UTF-8 correctamente. Escribir `BRICEÑO` o `BRICENO` es indiferente para el backend, pero el primero respeta la ortografía real del nombre.

---
## 7. Panel móvil de usuarios

**Para qué sirve:** gestionar usuarios desde el celular sin abrir el Sheet. Desde el 25-nov-2026 (#A135) es **la misma Gestión de Usuarios del sidebar (§5)**, con letra y botones para el celular: todo lo que hace el sidebar se hace también aquí.

**Caso de uso típico:** llega RRHH con un empleado nuevo que necesita acceso al portal YA. Al entrar se abre directamente «Nuevo usuario»: cédula, nombre, fecha de nacimiento, correo, empresa, sede, CC, unidad de negocio y aprobador — un minuto y listo.

### Quién puede usarlo

Únicamente los correos registrados como administradores. El panel usa el mismo PIN de administrador de 8 dígitos que el portal. Cualquier otra persona ve la pantalla de ingreso, pero su PIN siempre falla.

### Cómo se entra

Con un enlace propio del panel, que pide quien administra el sistema (dsanchez@equitel.com.co). Conviene guardarlo en la pantalla de inicio del celular: en iPhone, Safari → compartir → «Añadir a pantalla de inicio»; en Android, Chrome → menú → «Añadir a pantalla de inicio». Queda como si fuera una aplicación.

### Qué hace

- **Login**: correo admin + PIN (mismo del portal). Rate-limit de 5 intentos por 15 min. La sesión queda recordada en ese navegador; **Cerrar sesión** está arriba a la derecha.
- **Crear usuario** (lo que abre primero): el mismo formulario del sidebar, con autoaprobador, detector de duplicados (con «→ Ver / editar este usuario») y sugerencias del Maestro RH.
- **Usuarios**: buscar (también por unidad), editar, eliminar, borrar PIN y limpiar pasaporte. La fecha de nacimiento y el celular de una persona se cargan al abrirla.
- **Unidades**: quién responde por cada unidad y, para Yurani y David, cambiarlo con las sugerencias.
- **Anomalías, Reemplazar** (con «Reevaluar solicitudes pendientes»), **Ed. Masiva** y **Duplicados**, como en el sidebar.

No incluye lo que no es de usuarios: reorganizar la base principal ni ver métricas (eso sigue en el Sheet y en el portal).

### Seguridad

- La URL es pública pero la página es inútil sin PIN.
- Cada acción pasa por una sola puerta del backend (`mobileAdmin_run`) que valida el token de sesión y confirma que el correo sea administrador antes de ejecutarse, y solo deja las funciones del sidebar. Sin auth válida, cualquier intento retorna error y la página vuelve al ingreso.
- La lista de usuarios llega sin fechas de nacimiento ni celulares: los de cada persona se piden al abrirla.
- Cambiar los responsables de una unidad lo decide el servidor con el correo de la sesión: solo Yurani y David.
- Si el admin es removido de `ANALYST_EMAILS` mientras tiene sesión activa, la siguiente llamada falla automáticamente y lo manda al login.

### Impacto en la operación mientras se usa

**Ninguno para aprobadores ni solicitantes.** El panel móvil escribe en la hoja USUARIOS (y, al cambiar responsables, en la tabla de MISC), mientras que las solicitudes y aprobaciones viven en la hoja Nueva Base Solicitudes. Apps Script soporta ejecuciones concurrentes (hasta 30 por script). Un admin creando un usuario no bloquea:
- Aprobadores clickeando correos de aprobación
- Usuarios haciendo login y generando su PIN por primera vez
- Usuarios creando solicitudes nuevas
- Triggers programados de recordatorios

El único caso donde hay serialización es cuando **dos admins crean usuarios simultáneamente** (uno desde el sidebar y otro desde el móvil): el segundo espera máximo 2-3 segundos al primero. Esto es intencional para evitar que ambos escriban en la misma fila.

---
## 8. Métricas

Panel accesible desde el dashboard admin → botón **Métricas**. Tiene cuatro pestañas: **Tiempos del flujo**, **Aprobaciones**, **Compras y costos** y **Cambios**.

### 8.1 Tiempos del flujo

**Qué muestra (desde el 5-nov-2026, #A121, en horas reales):**
- Tiempos promedio por etapa, en **horas reales, de calendario** (incluyen noches y fines de semana; antes eran horas laborales):
  - Excepción a la política (pedido → aprobada por el CFO), solo en las que la necesitaron (#A123)
  - Aceptar cambio (pedido → aceptado por el área de compras), solo en cambios (#A123)
  - Cotización (desde que se puede gestionar → opciones cargadas)
  - Selección (opciones → usuario describe)
  - Confirmación costos (selección → costos finales)
  - Aprobación completa (costos → todas las aprobaciones)
  - Reserva (aprobación → PNR registrado)
  - Ciclo total (creación → reserva, con la espera de la excepción a la política si la hubo)
- Performance del analista en las etapas que le corresponden (revisión de cambios, cotización, confirmación costos, compra).
- En la tabla, la columna **Aceptar** dice lo que tardó, antes de cotizar, aceptar el cambio («cambio») o aprobar la excepción («CFO»).
- Performance de cada aprobador (cuánto tarda en aprobar).
- Debajo de cada tiempo, cuándo terminó esa etapa (día/mes y hora). **Al tocar una solicitud** se abre el mismo semáforo del detalle: cuándo pasó por cada etapa, a quién le tocaba, lo que tardó cada voto y quién tuvo la solicitud más tiempo. El solicitante ve ese semáforo en el detalle de su solicitud.

**Filtros:**
- Rango de fechas (últimos 30d, 90d, todo, personalizado)
- ID específico
- Excluir: Anuladas, Denegadas, Sin datos (pre-deploy)

**Notas:**
- Usa un cache JSON en Drive (`metricas_cache.json`) — recalcula solo las solicitudes cuyos eventos cambiaron desde la última carga.
- Solicitudes creadas antes del deploy de métricas no tienen `EVENTOS_JSON` y aparecen como "sin datos".
- Los cambios aceptados antes del 5-nov-2026 no tienen la hora en que se aceptaron: el semáforo dice «Antes del 5-nov no se guardaba esta hora» y la cotización incluye esa revisión.
- Los tiempos son de calendario (hora de Colombia). Los recordatorios y el escalamiento sí siguen contando horas laborales (L-V 07:00–17:00, Sáb 08:00–12:00).
- En los cambios pedidos antes del 5-nov no quedó cuándo se aceptaron: su cotización se mide desde la solicitud («Incluye la revisión del cambio»).

### 8.1.1 Aprobaciones (#A125)

Pestaña **✅ Aprobaciones**: cada solicitud que pasó por aprobación, con **qué se decidió, quién aprobó, quién denegó y el motivo**.
Responde preguntas como «¿qué le ha negado Alejandro?» sin buscar solicitud por solicitud.

- **Resultado** (tocar una tarjeta filtra la lista):
  - **Aprobada:** tiene todas sus aprobaciones.
  - **Denegada:** la denegó un aprobador, el CFO (excepción a la política de anticipación) o el área de compras (un cambio que no se aceptó).
  - **Esperando votos:** ya se pidió el voto y alguien todavía no decide; dice a quién le falta.
  - **En trámite:** se aprobó la excepción a la política y el viaje aún no llega a la aprobación.
  - **Anulada:** se anuló después de alguna decisión.
- **Quién decidió:** cuántas aprobó y cuántas denegó cada persona. Tocar una persona deja solo sus decisiones. Por ejemplo, tocar
  «Alejandro Gómez de Greiff» y después **Denegada** muestra todo lo que él negó.
- **Solicitud por solicitud:** quién aprobó (con su rol y la hora), quién denegó o a quién le falta, y el motivo de la denegación o el
  comentario que dejó quien aprobó. **Al tocar una fila** se abre el semáforo con los tiempos de cada etapa.
- Aquí no se excluyen las denegadas ni las anuladas. Cuenta la fecha en que se pidió la solicitud (Últimos 30 días, Todo, etc.).
- Las que todavía esperan que se apruebe la excepción a la política no salen aquí: están en **En espera de preaprobación** del panel
  principal. Cuando el CFO decide, pasan a esta pestaña (y las denegadas, al filtro **Denegado** del panel principal).

### 8.2 Compras y costos

Cuántos tiquetes y noches de hotel se compran, a qué costo y con cuánta anticipación (#A80). Sirve para comparar precios con otra agencia sin armar un Excel a mano. Solo la ven los administradores.

**Qué muestra:**
- Tarjetas:
  - tiquetes comprados (nacionales e internacionales), por día hábil y por mes
  - costo promedio del tiquete nacional (y su mediana) y del internacional
  - costo por noche en estadías de 1 a 6 noches (las de 7 o más se muestran aparte porque tienen tarifas mucho menores)
  - gasto del periodo, proyección anual y cuánto vale cada 1 % de descuento
  - porcentaje de tiquetes comprados con 7 días o menos
- **¿Cuánto cuesta comprar tarde?:** costo por tiquete nacional según la anticipación de la compra, el sobrecosto del periodo y el ahorro si la mitad de esas compras se planeara con 8 días o más.
- Meses, las 10 rutas con más tiquetes (con el precio comprando con 0 a 7 días y con 8 o más) y las 10 ciudades con más solicitudes con hotel.
- Cómo se viaja: pasajeros por viaje, ida y regreso, anticipación, compras en fin de semana, facturado frente a confirmado y cargos de Aviatur y/o IVA de la factura 1.
- **Descargar CSV:** todas las tablas en un archivo que abre en Excel.

**Filtro:** fecha de compra (todo, últimos 30 o 90 días, este año o personalizado).

**Cómo se cuenta:**
- Solo solicitudes reservadas o procesadas.
- Tiquetes = pasajeros × trayectos: ida y regreso son 2 por persona. Cada tramo de un multidestino es su propia solicitud.
- Noches-habitación = noches × pasajeros, solo con hotel pagado.
- Costos confirmados; los menores a $10.000 no entran en los promedios.
- La fecha de cada compra es la fecha de compra del tiquete, o la de la solicitud si falta.
- Días hábiles: lunes a viernes sin festivos de Colombia.
- El panel no muestra nombres, cédulas ni correos de los pasajeros.

---

### 8.3 Cambios (#A103)

Pestaña **🔄 Cambios**: cada cambio pedido con «Cambiar mi viaje», con filtros de mes y tipo de cambio. Muestra cuántos fueron de tiquetes ya comprados, lo que costaron los cambios (penalidad, diferencia de tarifa y hotel), qué parte fue penalidad, las maletas pedidas después de comprar y el costo por unidad. Los cambios de antes (formulario anterior) se cuentan aparte porque no traen el detalle. *¿Cómo se calcula?* explica cada cifra. Exporta a CSV.

### 8.4 Dashboard de costos: reporte en Excel de una unidad (#A132)

Para llevarle a una unidad (por ejemplo, POTENCIA) el detalle de lo que suma a su presupuesto y que ella diga qué pagó la fábrica, qué le reconocen con descuento o nota crédito y qué corresponde a una OT. Está en el **dashboard de costos**, pestañas *Año*, *Periodo* y *Mes*, al final: tarjeta **📊 Reporte en Excel de una unidad**.

1. Elige la **unidad de negocio** (o *Todas las unidades*) y los meses de compra (**desde** y **hasta**). El año y la empresa son los de los filtros de arriba.
2. Toca **📥 Descargar Excel**. Suele tardar unos 10 segundos; mientras tanto el botón dice cuántos lleva. Baja el archivo *Viajes que suman - UNIDAD - meses.xlsx*. Si Google no responde en unos minutos, la tarjeta lo dice y se puede volver a intentar.

Se puede generar cuantas veces se quiera: cada archivo es una foto del momento en que se generó.

**Qué trae** (las mismas cifras del dashboard para esos filtros):
- **Resumen:** lo facturado, lo pendiente de factura (con lo pagado al comprar o lo cotizado), el total que suma, el presupuesto y el % usado, lo cargado a OT, cada mes de compra y cómo leer el archivo.
- **Viajes que suman:** una fila por viaje: solicitante, pasajeros, servicio, origen y destino, fechas de ida y regreso, motivo del viaje, centro de costos, la unidad del viajero si es de otra unidad (#A133), anticipación, aerolínea, tarifa, hotel, cada factura (número y fecha), el valor que suma y si ya está facturado o pendiente. Al final, **columnas amarillas** para que la unidad escriba a qué OT corresponde el viaje, cuánto pagó la fábrica, cuánto le reconocen con descuento o nota crédito y su justificación; el **valor neto** y el resumen se calculan solos.
- **Facturas:** cada factura por separado (en la factura 1, lo pagado a la aerolínea o el hotel y el cargo de la agencia con su IVA; en las demás, el valor y el IVA).
- **Por pasajero:** cuántos viajes y cuánto suma cada persona (el valor de cada viaje se reparte en partes iguales entre sus pasajeros).
- **Cargados a OT (no suman):** los viajes con número de OT, aparte.

**Quién lo genera:** quien entra al dashboard de costos. Un líder solo puede sacar el de sus unidades y su archivo no trae lo cotizado ni lo pagado al comprar (eso, como la variación, es solo para Yurani, Diego, David y quien tenga `COMPLETO`). El archivo no trae cédulas, fechas de nacimiento, celulares ni tarjetas.

**Desde noviembre de 2026 el dashboard suma también las facturas 4 a 6** (antes solo de la 1 a la 3): las cifras de las unidades con una cuarta factura subieron un poco.
## 9. Problemas frecuentes

### El usuario dice que no le llega el PIN

1. Verifica que el correo esté en USUARIOS (tab Usuarios del sidebar, o busca en la hoja).
2. Verifica que el correo tenga dominio corporativo (`@equitel.com.co`). Si no, el filtro de validación puede rechazarlo — revisa el tab "Anomalías".
3. El PIN se envía vía Gmail desde el correo del dueño del script. Si Gmail bloqueó al usuario, no llega.
4. Fuerza un nuevo PIN: en el login del usuario, que pulse "Reenviar PIN".

### El aprobador dice que no le llega el correo

1. Busca la solicitud en el sheet, campo `CORREO DE QUIEN APRUEBA (AUTOMÁTICO)` — confirma el correo.
2. Si viajan pasajeros corporativos, el aprobador del primer pasajero es quien aprueba. Si ese correo está mal, la solicitud no puede aprobarse.
3. Si es internacional o >$1.2M, también se envía a CEO y CDS — ver `CEO_EMAIL` / `DIRECTOR_EMAIL` en Script Properties.

### La sesión expira muy seguido

Las sesiones duran **7 días**. Si expiran antes:
- Script Properties puede estar lleno (límite 500 KB total). El trigger diario `cleanupExpiredSessions` limpia lo vencido; si sospechas acumulación, ejecútalo manualmente desde el editor.
- El usuario cambió de navegador o dispositivo — normal.
- El navegador borró localStorage (modo incógnito, limpieza automática).
- El token guardado fue manipulado o corrupto → el frontend lo detecta y fuerza relogin sin consumir rate-limit.
### El usuario ve un banner rojo de "problemas de conectividad"

Significa que el ping de warmup al backend falló. Causas típicas:
- El backend GAS está desplegado pero la cuota diaria (6 h/día en Workspace) se agotó.
- El dominio del frontend cambió y el CORS del backend no lo reconoce.
- La URL `WEB_APP_URL` apunta a un deploy viejo o eliminado.

Revisa `Ejecuciones` en el editor GAS — si ves "Se superó la cuota", espera hasta el reset diario (medianoche hora Pacífico).

### El admin cree que su PIN es incorrecto pero en realidad es problema de red

Desde los últimos cambios, el login distingue claramente: si falla por red, el mensaje dice "error de conexión" y **no** consume un intento del rate-limit. Si dice "PIN incorrecto" u otro mensaje de permiso, sí es un fallo real. Esto evita bloqueos accidentales por fallos temporales de red.

---

---

## 10. Contactos

| Para qué | A quién |
|---|---|
| Gestión del viaje (opciones, tarifas, fechas, cambios). | **compras.equitel@equitel.com.co** |
| Agregar o corregir una persona en el directorio (cédula, correo, aprobador). | **compras.equitel@equitel.com.co** |
| Excepciones a la política: fuera de plazo, presupuesto excedido, tarifa superior. | Quien aprueba el presupuesto (hoy, Alejandro Gómez de Greiff). |
| Problemas técnicos de la plataforma (no carga, errores). | **dsanchez@equitel.com.co** |

---

## Otras guías

- [Infografía del procedimiento](./infografia-procedimiento.html) — el camino completo y los casos, en dos hojas.
- [Guía del usuario](./guia-usuario.md) — lo que ve y hace quien pide el viaje.
- [Guía del Google Sheets](./guia-hoja-calculo.md) — qué se puede tocar a mano en la hoja y qué no.

---

*Última actualización: 2026-11-28*
