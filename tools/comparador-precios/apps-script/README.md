# Rastreo de precios de tiquetes: instalación (#A84)

Un proyecto de Apps Script **aparte de la plataforma** busca cada solicitud de vuelo en
Google Flights (a través de SerpApi) y guarda el resultado en una pestaña oculta de la base
de datos. El dashboard de costos lo muestra en la sección **Comparador de precios**: solo la
ven Yurani, Diego y David, no Laura.

**No toca la operación:**
- La plataforma no cambia su forma de trabajar ni sus permisos.
- Este proyecto **solo lee** la hoja de solicitudes y **solo escribe** en sus dos pestañas
  ocultas: `COMPARATIVO PRECIOS` y `COMPARATIVO ESTADO`.
- Se apaga en un clic (paso 7).

## Qué hace

Cada 15 minutos revisa las solicitudes de vuelo con fecha de ida futura y busca el precio en
dos momentos, una sola vez en cada uno:

| Momento | Cuándo | Para qué |
|---|---|---|
| **Al cotizar** | La solicitud está en `PENDIENTE_APROBACION` y los costos se confirmaron después de empezar el estudio | Comparar la cotización de Aviatur con el mercado **en el mismo momento** |
| **Al comprar** | La solicitud está en `APROBADO`, o pasó a `RESERVADO` hace menos de 6 horas | Ver cuánto costaría la opción más barata cuando Laura compra |

Para cada búsqueda guarda:
- el más barato del día;
- el más barato saliendo entre 2 horas antes y 2 horas después de la hora pedida;
- el de la aerolínea que registró Laura;
- el precio por aerolínea y el rango normal de Google.

No guarda nombres, cédulas ni correos. Tampoco busca:
- solicitudes de solo hospedaje;
- viajes que ya salieron;
- otros estados.

**Cupo:**
- Son 2 búsquedas por solicitud: unas 60 en dos semanas, dentro de las 250 gratis del mes.
- El proyecto no busca si a la cuenta le quedan menos de 15.
- Tiene un tope de 40 consultas al día.

## Instalación (unos 15 minutos)

Hazlo con **tu cuenta** (la que tiene acceso de edición a la hoja de la base de datos).
Antes, la plataforma debe tener publicada la versión de `Code.gs` y `CostsDashboard.html` que
incluye el comparador.

### Paso 1. Crear el proyecto

1. Entra a [script.google.com](https://script.google.com) y pulsa **Nuevo proyecto**.
2. Arriba a la izquierda, cambia el nombre *Proyecto sin título* por **Equitel · Rastreo de precios**.

### Paso 2. Pegar el manifiesto

1. Ícono de engranaje **Configuración del proyecto** (barra izquierda).
2. Marca **Mostrar el archivo de manifiesto "appsscript.json" en el editor**.
3. Vuelve al **Editor** (ícono `< >`), abre `appsscript.json`, borra todo y pega el contenido de
   [appsscript.json](appsscript.json). Guarda (`Ctrl+S`).

El manifiesto pide solo tres permisos: editar hojas de cálculo, conectarse a un servicio
externo (SerpApi) y crear el disparador.

### Paso 3. Pegar el código (dos archivos)

1. Abre `Código.gs` (o `Code.gs`), cámbiale el nombre a **Nucleo** (menú ⋮ → Cambiar nombre),
   borra todo y pega el contenido de [../comparador.cjs](../comparador.cjs) completo.
2. Pulsa **+** junto a *Archivos* → **Secuencia de comandos**, llámalo **Rastreo** y pega el
   contenido de [Rastreo.gs](Rastreo.gs) completo.
3. Guarda (`Ctrl+S`).

### Paso 4. Guardar la clave y el ID de la hoja

1. **Configuración del proyecto** → al final, **Propiedades del script** → **Agregar propiedad del script**.
2. Agrega estas dos propiedades:

   | Propiedad | Valor |
   |---|---|
   | `SERPAPI_KEY` | Tu clave de SerpApi: la misma de `tools/comparador-precios/.serpapi-key`, o cópiala de [serpapi.com/manage-api-key](https://serpapi.com/manage-api-key) |
   | `SPREADSHEET_ID` | El ID de la hoja de la base de datos: en su enlace `docs.google.com/spreadsheets/d/`**`ESTE-TEXTO`**`/edit`, la parte entre `/d/` y `/edit` |

3. **Guardar las propiedades del script.**

La clave queda solo en este proyecto: nunca se escribe en la hoja ni en el repositorio.

### Paso 5. Probar sin gastar búsquedas

1. En el **Editor**, abre `Rastreo`. En la barra de arriba, en la lista de funciones, elige
   **probarConfiguracion** y pulsa **Ejecutar**.
2. La primera vez Google pide permisos:
   - pulsa **Revisar permisos** y elige tu cuenta;
   - si aparece *"Google no verificó esta app"*, pulsa **Configuración avanzada** → **Ir a Equitel · Rastreo de precios (no seguro)**. Es tu propio proyecto: el aviso aparece en cualquier script personal;
   - pulsa **Permitir**.
3. El **Registro de ejecución** debe mostrar:

   ```
   ✓ Hoja: «…», N filas en «Nueva Base Solicitudes».
   ✓ Clave de SerpApi válida. Quedan … búsquedas este mes.
   Buscaría ahora X solicitud(es):
     SOL-000… COMPRA · BOGOTA → CALI · ida 2026-10-20 …
   ```

   Esa lista son las solicitudes aprobadas (por comprar) con fecha de ida futura. Si sale un
   error, mira la tabla del final.

### Paso 6. Activar el rastreo

Elige **activarRastreo** en la lista de funciones y pulsa **Ejecutar**. Hace cuatro cosas:
1. Fija el estudio: empieza hoy y termina en 14 días (propiedades `INICIO_ESTUDIO` y `FIN_ESTUDIO`).
2. Crea las dos pestañas ocultas en la base de datos.
3. Instala el disparador cada 15 minutos.
4. Hace la primera pasada: busca las solicitudes de la lista del paso 5.

El registro termina con algo como `Rastreo activo cada 15 minutos, del 2026-10-07 al
2026-10-21. Primera pasada: 6 búsqueda(s), estado ACTIVO.`

**Comprobar:** abre el dashboard de costos con tu cuenta. Al final aparece la sección
**🔎 Comparador de precios de tiquetes** con estado *ACTIVO* y las solicitudes buscadas.

### Paso 7. Apagarlo

Elige **desactivarRastreo** y pulsa **Ejecutar**. Quita el disparador; lo buscado se conserva
y el dashboard lo sigue mostrando. Para retomarlo, ejecuta **activarRastreo** otra vez (no
cambia las fechas ya fijadas).

Al pasar `FIN_ESTUDIO` deja de buscar solo, aunque el disparador siga instalado. Para
alargar el estudio, cambia `FIN_ESTUDIO` en las propiedades (formato `AAAA-MM-DD`).

## Ajustes opcionales (propiedades del script)

| Propiedad | Por defecto | Qué hace |
|---|---|---|
| `INICIO_ESTUDIO` | el día de `activarRastreo` | Solo busca *al cotizar* si los costos se confirmaron desde esta fecha |
| `FIN_ESTUDIO` | inicio + 14 días | Después de esta fecha no busca |
| `VENDEDORES` | `no` | `compra`, `cotizacion` o `ambos`: además busca quién vende el vuelo más barato (Aviatur, la aerolínea, otras agencias). Gasta 1 o 2 consultas más por búsqueda |
| `MAX_POR_EJECUCION` | `8` | Búsquedas por pasada; lo demás queda para la siguiente |
| `MAX_BUSQUEDAS_DIA` | `40` | Tope de consultas a SerpApi por día |
| `RESERVA_MINIMA` | `15` | No busca si a la cuenta le quedan menos |

## Dónde mirar

- **Dashboard de costos → Comparador de precios:** el estado del rastreo (última ejecución,
  búsquedas, cupo), los totales y el detalle por solicitud, con exportación a CSV.
- **Pestaña oculta `COMPARATIVO PRECIOS`** de la base de datos: una fila por búsqueda. Para
  verla en la hoja: menú **Ver → Hojas ocultas**. Tiene un aviso si alguien intenta editarla:
  no la edites.
- **Ejecuciones** del proyecto (ícono ☰ con reloj): cada pasada deja una línea en el registro.

## Si algo falla

| Mensaje | Qué hacer |
|---|---|
| `Falta la propiedad SPREADSHEET_ID` / `SERPAPI_KEY` | Repite el paso 4 |
| `Exception: … openById … no tiene permiso` | La cuenta con la que ejecutas no tiene acceso de edición a la hoja, o el ID está mal copiado |
| `No se encontró la hoja «Nueva Base Solicitudes»` | El ID es de otro archivo |
| Estado `CLAVE INVALIDA` en el dashboard | Copia la clave de nuevo en `SERPAPI_KEY` |
| Estado `SIN CUPO` | Se acabaron las búsquedas del mes (o queda la reserva). Se reanuda solo cuando SerpApi renueva el cupo |
| Estado `TOPE DIARIO` | Se alcanzó `MAX_BUSQUEDAS_DIA`; sigue al día siguiente |
| El dashboard avisa *"No ha corrido en más de 45 minutos"* | Revisa en **Activadores** (ícono de reloj) que exista `rastrearPrecios` cada 15 minutos; si no, ejecuta `activarRastreo` |
| Una solicitud dice *sin aeropuerto* | La ciudad no está en la lista de aeropuertos del núcleo (p. ej. Tunja). Se puede agregar en `CP_AEROPUERTOS` de `comparador.cjs` |

Si el proyecto falla al ejecutarse solo, Google envía un correo de error a la cuenta dueña
del proyecto.
