# Guía del Google Sheets — Portal de Viajes Equitel

> **Para quién es esta guía:** cualquier persona del área de viajes que vaya a manejar el Google Sheets que está detrás del portal.
>
> **En qué se enfoca:** solo en la hoja de cálculo. Qué tiene, qué se puede tocar y qué no, y cómo usar el menú **Equitel Viajes** que aparece arriba del sheet.
>
> **Guía complementaria:** para la operación del portal completo (roles, workflows del analista, Script Properties, triggers, métricas, seguridad), ver la [Guía del Administrador](./guia-administrador.md).

---

## ¿Qué es este Google Sheets?

Es la **base de datos** de todo el portal. Cada solicitud, cada usuario, cada PIN, cada reserva — todo vive aquí.

Cuando un empleado crea una solicitud desde el portal, se agrega una fila en este sheet. Cuando un jefe aprueba por correo, se actualiza una celda de esa fila. Cuando el analista registra una reserva, el número de PNR queda guardado acá.

El portal (la página web) y este Sheets están conectados todo el tiempo: **lo que pasa en uno se refleja en el otro.**

---

## Las hojas y qué hay en cada una

El archivo tiene varias pestañas abajo. Aquí explico qué hay en cada una:

### Nueva Base Solicitudes (la más importante)

Una fila por cada solicitud de viaje u hospedaje que se haya creado. Tiene 75 columnas con todo: quién solicita, destino, fechas, pasajeros, costos, número de reserva, observaciones, aprobaciones, archivos adjuntos.

**¿Puedo editar a mano?** Sí, pero con mucho cuidado. Las columnas con fondo amarillo claro son las "editables" (nombre de hotel, tarjeta de crédito, tipo de compra, número de factura, etc.). El resto se llena automático desde el portal.

**Lo que NO debes hacer aquí:**
- Borrar filas (eso rompe los IDs y la trazabilidad).
- Cambiar el status a mano (usa el portal — los correos automáticos no saldrán si lo haces a mano).
- Cambiar el `ID RESPUESTA` de una solicitud.
- Eliminar columnas.
- Editar a mano las celdas de `APROBADO POR ÁREA? (AUTOMÁTICO)`, `APROBADO CDS` o `APROBADO CEO`: el portal las llena solo y usa esas celdas para decidir si la solicitud avanza. Si ves una solicitud con `APROBADO` global pero una celda ejecutiva vacía, la app lo corrige en pantalla automáticamente (no toques la hoja).
- Modificar `EVENTOS_JSON` u `OBSERVACIONES` a mano: son el log de auditoría. Pueden contener marcadores internos (`[CONSULTA_USUARIO_PENDIENTE]`, `[ETAPA SALTADA por …]`, `[RESERVA]: Registrada sin notificación al usuario`) que el backend lee y respeta.

### USUARIOS

Directorio de todas las personas que pueden usar el portal. Cada fila es una persona con:
- Cédula
- Nombre
- Correo corporativo
- Empresa (Cumandes, Equitel, Ingenergía, LAP)
- Sede
- Centro de costo
- Aprobadores asignados (quiénes le aprueban las solicitudes)
- PIN (automático — no se edita a mano)

**Tip:** puedes convertir esta hoja a una **tabla de Google Sheets** (menú Formato → Convertir a tabla) para tener filtros por columna, formato bonito, y poder referenciar columnas por nombre en otras fórmulas. No afecta el portal.

**Lo que NO debes hacer:**
- Editar la columna PIN a mano (borraría el PIN del usuario)
- Cambiar el orden de columnas
- Escribir directamente en las columnas "Correos Aprobadores (auto)" o "Nombres Aprobadores (auto)" — esas se llenan solas con base en las cédulas de la columna G

**Lo que SÍ puedes hacer, pero es mejor desde el sidebar** (ver más abajo):
- Agregar usuarios nuevos
- Cambiar aprobadores
- Corregir empresa/sede/centro de costo
- Borrar PINs viejos

### CDS vs UDEN

Catálogo de centros de costo con su descripción y la unidad de negocio a la que pertenecen. El portal lo usa para mostrar el nombre del centro de costo cuando alguien selecciona un código.

**Lo que SÍ puedes hacer:** agregar nuevos centros de costo al final.

**Lo que NO debes hacer:** cambiar las columnas.

### CIUDADES DEL MUNDO

Listado de ciudades con país. Se usa para el autocompletar de origen/destino en el portal, y para detectar si un viaje es internacional.

**Lo que SÍ puedes hacer:** agregar ciudades nuevas al final. Columna A = país, Columna B = ciudad.

**Lo que NO debes hacer:** cambiar el nombre de las columnas.

### MISC

Hoja con dos catálogos pequeños:
- Tarjetas de crédito disponibles (las que aparecen en el dropdown cuando registras una reserva)
- Sedes (para el formulario de nueva solicitud)

**Lo que SÍ puedes hacer:** agregar sedes o tarjetas nuevas al final.

### REGLAS_COAPROBADOR

Define reglas especiales de co-aprobación. Por ejemplo: "si alguien internacional tiene a Juan Pérez como aprobador, también debe aprobarlo María García". Útil para viajes internacionales que requieren doble aprobación.

**Lo que SÍ puedes hacer:** agregar reglas nuevas con la misma estructura.

### INTEGRANTES_OLD

La antigua hoja de usuarios, antes de la migración a USUARIOS. Está ahí como respaldo histórico.

**Lo que NO debes hacer:** borrarla todavía. Déjala al menos 1-2 meses más por si acaso.

### Hojas con `_OLD_` en el nombre

Son respaldos de reorganizaciones anteriores de la hoja principal. **Déjalas quietas** hasta que hayas confirmado que la versión activa funciona bien (usualmente 1-2 semanas) y luego puedes borrarlas.

---

## El menú Equitel Viajes (la barra de herramientas)

Arriba del sheet, al lado de los menús estándar (Archivo, Editar, Ver…), aparece un menú llamado **Equitel Viajes**. Este es tu centro de control.

### Gestionar Usuarios (Sidebar)

Abre un panel lateral a la derecha con **5 pestañas**. Esta es la herramienta principal para manejar la lista de empleados sin tener que tocar la hoja directamente.

#### Pestaña "Usuarios"

**Para qué sirve:** ver, crear, editar o eliminar usuarios.

**Botones y qué hacen:**
- **Buscar** (arriba): escribe un nombre, cédula o correo y filtra en tiempo real.
- **+ Nuevo** (botón rojo): abre el formulario para crear un usuario nuevo.
- **Click en un usuario de la lista**: abre el formulario con sus datos para editar.
- **Eliminar** (solo cuando estás editando): borra al usuario.
- **Borrar PIN** (solo cuando estás editando): borra el PIN del usuario para forzarle a generar uno nuevo en su próximo login.
- **Cancelar / Guardar**: descartar o guardar los cambios.

**Cómo agregar aprobadores a un usuario:**
1. Edita el usuario
2. En el campo "Aprobadores" escribe el nombre o cédula del aprobador
3. Te aparece una lista — los que ya son aprobadores de alguien tienen un chip azul "aprobador" al lado
4. Haz click en la persona que quieres → se agrega como chip amarillo arriba
5. Puedes agregar varios
6. Para quitar uno, click en la "×" de su chip
7. **Guardar**

#### Pestaña "Anomalías"

**Para qué sirve:** diagnóstico rápido de problemas en la hoja USUARIOS.

Hace click en **Recargar** y te muestra en rojo/amarillo:
- **Aprobadores huérfanos** 🚨 — un usuario tiene como aprobador a alguien cuya cédula no está en USUARIOS. Esto impide que le lleguen los correos de aprobación.
- **Sin aprobador** ⚠️ — usuarios que no tienen a nadie asignado como aprobador. Sus solicitudes no pueden avanzar.
- **Correo no corporativo** 📧 — usuarios con un correo que no es @equitel.com.co. No los bloquea, pero conviene actualizarlos.

**Click en cualquier fila** → te lleva directo a editar ese usuario en la pestaña Usuarios.

Si el badge al lado de "Anomalías" muestra un número rojo (ej: "3"), son problemas que debes atender.

#### Pestaña "Reemplazar"

**Para qué sirve:** cambiar a un aprobador por otro en todos los usuarios que lo tienen asignado. Útil cuando alguien sale de la empresa.

**Cómo usarlo:**
1. En "Aprobador a reemplazar (viejo)" busca a la persona que sale
2. En "Aprobador nuevo" busca a quien va a reemplazarla
3. **Vista previa** → te dice cuántos usuarios serán afectados y te muestra la lista
4. Si todo se ve bien → **Confirmar reemplazo**

**Seguro porque:** solo cambia la columna de aprobadores (col G). No borra a nadie ni toca PINs.

#### Pestaña "Ed. Masiva"

**Para qué sirve:** cambios masivos a varios usuarios al mismo tiempo (ej: asignarle a 50 personas el mismo aprobador de una sola vez).

**Cómo usarlo:**

**Paso 1 — Seleccionar usuarios:**
- Escoge un filtro: "Sin aprob." (los que no tienen aprobador asignado), "Por aprob." (busca por aprobador específico), o "Búsqueda" (por nombre/cédula/correo)
- Marca los checkboxes de los usuarios que quieres cambiar (o usa "Todos" / "Ninguno")
- **Siguiente →**

**Paso 2 — Qué cambiar:**
- Escoge la acción del dropdown:
  - *Asignar aprobador(es)* — reemplaza los aprobadores actuales por los que selecciones
  - *Agregar aprobador* — suma un aprobador sin borrar los que ya tenían
  - *Cambiar empresa / sede / centro de costo*
- Completa el valor nuevo
- **Aplicar cambios**

**Advertencia:** los cambios masivos no se pueden deshacer automáticamente. Usa este tab con calma y siempre revisa a quiénes vas a afectar antes de confirmar.

#### Pestaña "Duplicados"

**Para qué sirve:** detectar y limpiar filas repetidas en USUARIOS.

**Cómo usarlo:**
1. **Escanear duplicados** → busca filas con cédula, correo o nombre repetido
2. Cada grupo muestra las filas duplicadas lado a lado con toda su información (datos + si tiene PIN configurado)
3. Compara y decide cuál dejar. La que quieres borrar → botón **Eliminar**.
4. Si la que borras tenía un PIN, el sistema te advierte primero.

**Orden recomendado:**
- Primero elimina los duplicados por **cédula** (los más graves — rompen lookups)
- Luego los de **correo** (el PIN siempre se lee de la primera fila, las demás quedan huérfanas)
- Los de **nombre** son informativos — no siempre son errores, a veces son dos personas distintas con el mismo nombre

---

### Reorganizar Base Principal (Sidebar)

**⚠️ ADVERTENCIA IMPORTANTE:** Esta es una herramienta avanzada. Úsala solo si realmente necesitas cambiar el orden de las columnas de la hoja principal. Si no sabes qué hace o por qué la necesitarías, **no la abras**. Déjala quieta.

**Para qué sirve (si es necesario):** permite al admin reorganizar el orden de las 75 columnas de "Nueva Base Solicitudes" sin romper el portal. El proceso es un workflow de 6 pasos que:
1. Crea una hoja paralela con los headers canónicos
2. Te deja reorganizar las columnas a mano
3. Verifica que no falten columnas
4. Migra todos los datos (con validaciones, colores, formatos)
5. Te permite comparar fila por fila
6. Hace el "switch" final: renombra la hoja vieja a `_OLD_<fecha>` y activa la nueva

**Incluye también** una sección para:
- Crear respaldo completo del archivo antes de hacer cambios
- Ocultar/mostrar columnas (sin afectar el portal)

**Sugerencia:** si alguna vez quieres usarla, léete primero la guía detallada en `docs/guia-reorganizar-base.md` antes.

---

## 📱 Crear usuarios desde el celular (Módulo Móvil)

Cuando llega alguien nuevo y necesita acceso inmediato al portal, y tú no estás frente al computador, **no hace falta abrir el Google Sheets**. Hay una página web pensada para el celular que te deja crear usuarios en un minuto.

### ¿Cómo accedes?

Abre este enlace desde el navegador de tu teléfono (Safari o Chrome):

```
https://script.google.com/macros/s/AKfycbymPQQO0C8Xf089bjAVIciWNbsr9DmS50odghFp7t_nh5ZqHGFe7HisbaFF-TqMPxPwwQ/exec?action=admin
```

**Recomendación:** guárdalo como atajo en la pantalla de inicio de tu celular para abrirlo de un solo toque como si fuera una app:
- **iPhone** (Safari): botón compartir → "Añadir a pantalla de inicio"
- **Android** (Chrome): menú ⋮ → "Añadir a pantalla de inicio"

### ¿Cómo entras?

La primera vez te pide:
- Tu correo de administrador.
- El PIN de 8 dígitos (el mismo que usas en el portal normal con el botón negro "Administrador", o tu PIN personal si tienes fila propia en USUARIOS).

Una vez que entras, el teléfono recuerda tu sesión **por 7 días**. No tienes que volver a meter el PIN cada vez. Si cambias de celular o borras datos del navegador, sí hay que volver a ingresar.

### ¿Qué puedes hacer?

**Solo una cosa: crear usuarios.** El módulo móvil tiene un formulario simple con los mismos campos que el sidebar del Sheets:
- Cédula
- Nombre completo
- Correo
- Empresa (dropdown)
- Sede (dropdown)
- Centro de costo
- Aprobadores (buscador)

Llenas los campos, presionas "Crear usuario" y listo — el usuario queda en la hoja USUARIOS y puede iniciar sesión en el portal de inmediato.

### ¿Qué NO puedes hacer desde el móvil?

El móvil está pensado para la acción más urgente fuera de oficina: **agregar gente nueva**. Todo lo demás se hace desde el sidebar del Google Sheets:
- Editar un usuario existente
- Eliminar un usuario
- Ver anomalías o duplicados
- Reemplazar aprobador masivo
- Cambios masivos (empresa/sede/CC)
- Borrar un PIN

Si necesitas cualquiera de esas, abre el Sheets en el computador y usa el sidebar.

### ¿Es seguro?

Sí. Aunque el enlace sea público, **sin el PIN nadie puede hacer nada**. Además:
- Solo correos que están en la lista `ANALYST_EMAILS` (los administradores autorizados) pueden usar el módulo. El resto verá la pantalla de login pero su PIN siempre fallará.
- Después de 5 intentos fallidos, el sistema bloquea **a ese correo específico** por 15 minutos (no afecta a los demás administradores).
- Si el login falla por red y no por PIN, el sistema lo detecta y **no** consume intentos del rate-limit.
- Cada acción (cargar datos, crear usuario) re-verifica que tu sesión siga siendo válida. Si te quitaron de la lista de administradores mientras estabas logueado, la siguiente acción te saca automáticamente.

### ¿Afecta a las demás personas mientras yo lo uso?

**No.** Los aprobadores pueden seguir aprobando desde sus correos, los solicitantes pueden seguir creando solicitudes, los usuarios nuevos pueden seguir generando su PIN por primera vez — todo al mismo tiempo que tú creas un usuario desde el celular, sin conflictos.

La única vez que algo espera es si otro admin está creando otro usuario al mismo segundo desde el sidebar del Sheets. En ese caso, tu creación espera 2-3 segundos al otro admin y luego procede. Nada grave.

---

### Modo activo: ⚡ USUARIOS (o 📋 INTEGRANTES legacy)

Un item del menú que al hacer click te muestra un diálogo diciendo **qué hoja está leyendo el portal en este momento**. No cambia nada, solo te informa.

En producción debe decir "Modo activo: USUARIOS". Si dice "INTEGRANTES" significa que alguien revirtió el flag.

---

### Opciones de migración (1-4)

Estas opciones (`Crear hoja USUARIOS`, `Migrar desde INTEGRANTES`, `Sincronizar con Maestro RH`, `Recargar resoluciones`) se usaron durante la migración inicial a USUARIOS. **Hoy día casi no las necesitas**, salvo:

- **"Sincronizar con Maestro RH"**: si Recursos Humanos actualiza su base con empleados nuevos, ejecuta esto para traerlos a USUARIOS como filas stub (solo cédula, nombre, correo). Después les asignas aprobador manualmente desde la pestaña Usuarios del sidebar.

- **"Recargar resoluciones"**: si editaste manualmente la columna G (cédulas aprobadores) de USUARIOS, ejecuta esto para que las columnas H e I (correos/nombres auto) se actualicen.

Las otras dos (Crear / Migrar) ya se ejecutaron. No las corras de nuevo a menos que sepas exactamente lo que haces.

---

## Cómo funcionan los campos del formulario de usuarios

Tanto en el sidebar (pestaña Usuarios) como en el módulo móvil, los campos tienen reglas automáticas que te ayudan a escribir datos bien formateados sin pensar:

| Campo | Qué pasa mientras escribes |
|---|---|
| **Cédula** | Solo acepta números. Si intentas escribir letras, las ignora. En el celular sale el teclado numérico. |
| **Nombre completo** | Todo lo que escribes se convierte automáticamente a MAYÚSCULAS. Las tildes y la Ñ se respetan — puedes escribir `CÓRDOBA`, `ÁNGEL`, `ZÚÑIGA` normalmente. |
| **Correo** | Se convierte a minúsculas solo. Los espacios se eliminan. Si el formato no es tipo `algo@algo.algo`, el guardado falla y te avisa. |
| **Centro de costo** | Solo acepta números. Teclado numérico en el celular. |

**Duda común:** ¿es importante escribir nombres con tildes y Ñ o sin ellos?
**Respuesta:** Da exactamente lo mismo para el portal. El sistema maneja ambos igual — los correos que salen, los reportes en PDF, los nombres de archivos en Drive, todo funciona idéntico con o sin tildes. Es solo estética. Mi recomendación: escribir con tildes y Ñ para respetar la ortografía real de los nombres, pero si prefieres sin ellos por simplicidad, también está bien.

---

## Reglas de oro

1. **Siempre haz respaldo antes de cambios grandes.** Menú → Reorganizar Base Principal → "Crear respaldo ahora". Tarda 30 segundos y te guarda una copia completa en tu Drive privado.

2. **No edites la columna PIN a mano.** Si necesitas borrar un PIN, usa el botón "Borrar PIN" en la pestaña Usuarios del sidebar.

3. **Para agregar, editar o eliminar usuarios, prefiere el sidebar.** Es más rápido y evita errores comunes.

4. **Nunca cambies el nombre de las columnas.** El portal las busca por nombre exacto. Si cambias "CORREO ENCUESTADO" a "CORREO SOLICITANTE", el portal se rompe.

5. **No cambies los IDs de solicitud.** La trazabilidad depende de ellos.

6. **Si ves algo raro, primero busca en Anomalías.** La mitad de los problemas del portal se detectan ahí.

7. **Para cambios masivos, usa Ed. Masiva — pero con vista previa.** Nunca confirmes sin haber revisado la lista de afectados.

8. **Antes de borrar un usuario, busca duplicados.** Quizás hay dos filas del mismo y puedes consolidar en vez de borrar el "bueno".

9. **No toques la hoja REGLAS_COAPROBADOR salvo que sepas qué estás haciendo.** Un cambio mal hecho ahí rompe las aprobaciones ejecutivas.

10. **Si todo falla, siempre puedes restaurar el respaldo.** Los respaldos están en tu carpeta privada de Drive (la que configuraste en el sidebar de Reorganizar).

11. **No edites las celdas de aprobación (`APROBADO POR ÁREA?`, `APROBADO CDS`, `APROBADO CEO`).** Las llena el portal. Si ves una solicitud `APROBADO` global con alguna de esas celdas vacía, no es un error: el portal la muestra como `APROBADO` en pantalla automáticamente cuando el propio ejecutivo se aprobó a sí mismo.

12. **No toques `EVENTOS_JSON` ni los marcadores dentro de `OBSERVACIONES`.** Son la bitácora que el portal usa para métricas, recordatorios y lógica de negocio. Cualquier edición manual puede romper los badges de cruce de día o impedir que los triggers funcionen.

---

## Preguntas frecuentes

**¿Puedo filtrar la hoja USUARIOS con la herramienta de filtro de Sheets?**
Sí, no afecta el portal. Los filtros son solo visuales para ti.

**¿Puedo ordenar las filas de USUARIOS?**
Sí, pero procura no cortar filas a la mitad. Ordena rangos completos, no columnas sueltas.

**¿Puedo convertir USUARIOS a tabla de Google Sheets (Formato → Convertir a tabla)?**
Sí, te da filtros nativos y referencias por nombre de columna en otras fórmulas. Las filas nuevas que se creen desde el sidebar se absorben automáticamente en la tabla (si la tabla tiene "Extender automáticamente" activado, que es el default). Si vas a hacerlo, haz respaldo antes y prueba creando un usuario después para confirmar.

**¿Puedo dar permisos a otra persona para que edite el sheet?**
Sí, usa **Compartir** (botón azul arriba a la derecha del sheet). Pero **solo da permisos a personas de confianza** — cualquiera con acceso de edición puede abrir los sidebars y hacer cambios masivos.

**¿Qué pasa si borro por error un usuario?**
Tienes dos opciones: (a) ctrl+Z inmediatamente para deshacer en el sheet, o (b) abrir un respaldo reciente y copiarle la fila.

**¿Por qué un usuario no puede iniciar sesión?**
En orden: (1) revisa que su correo esté en USUARIOS, (2) revisa que tenga un aprobador asignado (sidebar → Anomalías), (3) pídele que presione "Reenviar PIN" en el login, (4) borra su PIN manualmente desde el sidebar para forzarle uno nuevo.

**¿Cómo sé si el portal está leyendo de USUARIOS o de INTEGRANTES?**
Menú → "Modo activo". Te lo dice.

**¿Qué pasa si alguien anula una solicitud que tiene un cambio en curso?**
El portal lo impide: si la solicitud tiene una "hija" (modificación) activa, no se puede anular al padre hasta resolver primero la hija. Evita que queden huérfanos en la base.

**¿Qué significan los íconos ⭐ y 👥 en el panel del administrador?**
- ⭐ = solicitud **prioritaria** (al menos un pasajero es ejecutivo del grupo — CEO, CDS o equivalentes). Puede haberse gestionado por fuera.
- 👥 = solicitud **proxy** (la creó una persona distinta a quien viaja; el primer pasajero tiene cédula diferente a la del solicitante).

Se calculan al leer la solicitud y no se guardan como columnas — son derivados.

---

## Referencias cruzadas

- [Guía del Administrador](./guia-administrador.md) — operación completa del portal, Script Properties, triggers, métricas, seguridad.
- [Guía de reorganización de columnas](./guia-reorganizar-base.md) — workflow de 6 pasos para reordenar "Nueva Base Solicitudes" sin romper el portal.

---

*Última actualización: 2026-04-20*
