# Comparador de precios de tiquetes: tutorial de la prueba

Esta prueba responde cuatro preguntas antes de meter el comparador en la aplicación:

1. ¿Aparecen en Google Flights las aerolíneas que usa Equitel (Avianca, LATAM, Wingo, JetSMART, Satena, Clic)?
2. ¿Los precios coinciden con los de la página de cada aerolínea?
3. Con 2 pasajeros, ¿el precio es el del grupo o el de una persona?
4. ¿Aviatur aparece como vendedor de esas tarifas, y a qué precio?

El plan completo está en [docs/plan-comparador-precios.md](../../docs/plan-comparador-precios.md).

| | |
|---|---|
| **Tiempo** | unos 30 minutos, contando la creación de la cuenta |
| **Costo** | $0 (plan gratis de SerpApi: 250 búsquedas al mes, sin tarjeta) |
| **Búsquedas que gasta** | 16 (pasos 4 a 7), más 1 por viaje si haces el paso opcional |
| **Dónde corre** | solo en este computador |

**No hay que crear una hoja de Google ni un proyecto de Apps Script.** La prueba no se
conecta a la plataforma, a la base de datos ni a Apps Script: solo consulta precios en
Google Flights a través de SerpApi. El proyecto de Apps Script aparte es la fase 2, cuando
se integre a la aplicación.

**No usa datos personales.** A SerpApi solo le envía ruta, fechas y número de pasajeros.

---

## Antes de empezar: abrir la terminal en la carpeta del proyecto

1. Abre el proyecto en VS Code.
2. Menú **Terminal → Nueva terminal**. Se abre abajo, ya dentro de la carpeta del proyecto.
3. Comprueba que tienes Node:

   ```bash
   node --version
   ```

   Debe decir `v18` o más (este computador tiene `v20`). Si dice "command not found",
   instala Node LTS desde [nodejs.org](https://nodejs.org).

**Todos los comandos de este tutorial se escriben en esa terminal, desde la carpeta del
proyecto.** Si abriste otra terminal, entra primero a la carpeta:

```bash
cd ~/Documents/VSC/AgentTest/equitel_viajes_v1
```

---

## Paso 1. Crear la cuenta gratis de SerpApi (5 minutos, una sola vez)

1. Entra a [serpapi.com/users/sign_up](https://serpapi.com/users/sign_up) y regístrate con tu
   correo o con tu cuenta de Google.
2. Confirma el correo con el enlace que te llega. SerpApi también puede pedirte un código por
   SMS al celular.
3. **No pide tarjeta.** Quedas en el plan *Free*: 250 búsquedas al mes, máximo 50 por hora.

Tu clave está en [serpapi.com/manage-api-key](https://serpapi.com/manage-api-key): una cadena
larga de letras y números. **No la pegues en chats, correos ni archivos del proyecto.** Si se
filtra, en esa misma página hay un botón para generar una nueva.

## Paso 2. Guardar la clave (1 minuto, no gasta búsquedas)

```bash
node tools/comparador-precios/buscar.cjs --configurar
```

1. Copia la clave de la página del paso 1.
2. Pégala en la terminal (clic derecho → Pegar, o `Ctrl+Shift+V`) y presiona Enter.
   Mientras la pegas solo ves asteriscos: es normal.

Debe responder:

```
✓ Clave válida y guardada en …/tools/comparador-precios/.serpapi-key
  Plan Free Plan: le quedan 250 búsquedas este mes (máximo 50 por hora).
```

La clave queda en un archivo que solo lee tu usuario y que **no se sube al repositorio**
(está en `.gitignore`). Puedes repetir este comando cuando quieras para ver cuántas búsquedas
te quedan: presiona solo Enter, sin pegar nada.

## Paso 3. Ver el formato con datos inventados (10 segundos, no gasta búsquedas)

```bash
node tools/comparador-precios/buscar.cjs --demo
```

Arriba dice en mayúsculas **MODO DEMO: datos INVENTADOS**. Sirve para aprender a leer el
resultado antes de gastar búsquedas:

```
 DEMO · BOGOTA → CALI · ida 2026-10-20, regreso 2026-10-22 · 1 pasajero(s) · cotizado $569.395
  Aerolínea                Más barato  Salida Vuelo             Escalas  Opciones
  JetSMART                   $351.700  13:20  JA 5242           directo  1
  Wingo                      $389.200  05:40  P5 7120           directo  1
  …
  → Más barato del día: $351.700 (JetSMART, sale 13:20). Lo cotizado está $217.695 por encima (+61,9 %).
  → Más barato saliendo entre 2 h antes y 2 h después de las 06:30: $389.200 (Wingo, 05:40); …
  → Google considera típico para esta ruta: $330.000 a $520.000 (hoy el precio está en lo típico).
```

- **Cada fila** es una aerolínea: su precio más bajo ese día, a qué hora sale ese vuelo, el
  número de vuelo y cuántas opciones encontró.
- En **ida y regreso**, el precio es el del viaje redondo completo, igual que en Google Flights.
- **Más barato saliendo entre 2 h antes y 2 h después** es el que más se parece a lo que
  compraría Laura, porque respeta la hora que pidió el viajero.

## Paso 4. Prueba de cobertura: 8 rutas (8 búsquedas, unos 2 minutos)

```bash
node tools/comparador-precios/buscar.cjs --rutas-prueba
```

Busca ida y regreso para 8 rutas, con 1 pasajero y hora pedida 07:00:
- **Fechas:** ida un martes al menos 2 semanas después de hoy y regreso el jueves. Las calcula
  el comando y las muestra en la primera línea.
- **Antes de buscar** te dice cuántas búsquedas va a gastar y cuántas te quedan.

| Ruta | Por qué está |
|---|---|
| R1 Bogotá → Medellín | La de más oferta. En Medellín se buscan los dos aeropuertos: Rionegro (MDE) y Olaya Herrera (EOH) |
| R2 Bogotá → Cali | Ruta grande |
| R3 Bogotá → Barranquilla | Ruta grande |
| R4 Bogotá → Cartagena | Ruta grande |
| R5 Medellín → Cali | Sale de MDE y de EOH |
| R6 Medellín → Quibdó | Sale de Olaya Herrera, donde operan Satena y Clic |
| R7 Bogotá → Yopal | Regional |
| R8 Bogotá → Quito | Internacional |

**Qué mirar:** en qué rutas aparece cada aerolínea. Anótalo en la tabla del paso 8.

## Paso 5. ¿Los precios son reales? (1 búsqueda y unos 10 minutos)

Haz este paso **justo después de buscar**: los precios cambian en minutos. Es más fácil
comparar solo ida:

```bash
node tools/comparador-precios/buscar.cjs --origen BOGOTA --destino MEDELLIN --solo-ida
```

Usa la misma fecha de ida del paso 4 y la muestra arriba ("ida AAAA-MM-DD").

1. Escoge 2 o 3 filas de aerolíneas distintas y anota el **número de vuelo**, la **hora** y el
   **precio**.
2. Abre la página de esa aerolínea en otra pestaña: [avianca.com](https://www.avianca.com),
   [latamairlines.com/co](https://www.latamairlines.com/co/es),
   [wingo.com](https://www.wingo.com) o [jetsmart.com/co](https://jetsmart.com/co/es).
3. Busca **solo ida, Bogotá → Medellín, esa fecha, 1 adulto**. En Medellín escoge
   **Rionegro (MDE)**, salvo que el vuelo del comparador diga EOH.
4. Busca el **mismo número de vuelo**. Mira la tarifa **más barata** (la básica, la que no
   incluye maleta de bodega): Google muestra esa.
5. Compara con el **total a pagar** (con impuestos), no con el precio antes de impuestos.

**Qué esperar:** una diferencia menor al 5 % es normal (los precios cambian mientras
comparas). Si la diferencia es mayor, anota el vuelo y el precio de los dos lados.

## Paso 6. Precio con 2 pasajeros (1 búsqueda, 1 minuto)

```bash
node tools/comparador-precios/buscar.cjs --origen BOGOTA --destino MEDELLIN --solo-ida --pasajeros 2
```

Compara con el paso 5:
- **Los precios salen casi al doble:** es el total del grupo. Es lo esperado.
- **Salen iguales:** es el precio por persona. Anótalo, porque cambia cómo se compara con lo
  cotizado.

## Paso 7. ¿Aviatur vende esas tarifas? (6 búsquedas, 2 minutos)

```bash
node tools/comparador-precios/buscar.cjs --origen BOGOTA --destino CALI --vendedores
node tools/comparador-precios/buscar.cjs --origen BOGOTA --destino BARRANQUILLA --vendedores
```

Usan las mismas fechas del paso 4 (ida y regreso). Cada uno gasta 3 búsquedas: la búsqueda,
el regreso y los vendedores. Al final de cada viaje aparece:

```
  → Quién vende la opción más barata: Avianca (aerolínea) $… · Aviatur $… · Otra agencia $…
     Aviatur la vende en $….
```

o *"Aviatur no aparece entre los vendedores de esta tarifa en Google Flights"*.

## Paso 8. Anotar los resultados

Copia esta tabla, llénala y envíamela:

```
Cobertura (paso 4): ¿en cuántas de las 8 rutas aparece cada una?
  Avianca: __  LATAM: __  Wingo: __  JetSMART: __  Satena: __  Clic: __
Exactitud (paso 5):
  Vuelo ______ comparador $______ página $______
  Vuelo ______ comparador $______ página $______
  Vuelo ______ comparador $______ página $______
2 pasajeros (paso 6): el precio sale [ ] al doble  [ ] igual
Aviatur (paso 7): Bogotá–Cali [ ] aparece, a $______  [ ] no aparece
                  Bogotá–Barranquilla [ ] aparece, a $______  [ ] no aparece
```

Si te queda más fácil, dime **"listo"** y yo leo los resultados en la carpeta
`resultados-comparador/` de este computador. Ahí no hay datos personales. Lo único que no
puedo ver son las comparaciones del paso 5 con las páginas de las aerolíneas: esas
envíamelas.

## Paso opcional. Viajes reales de la base (1 búsqueda por viaje)

```bash
node tools/comparador-precios/buscar.cjs --lote ~/Downloads/comparador-viajes-proximos.csv
```

El archivo tiene 13 viajes próximos de la base del 29-sep, con lo que se cotizó y sin nombres
ni cédulas. Los viajes que ya pasaron se saltan sin gastar búsquedas: el 6-oct quedaban 10, y
cada día vencen más.

La diferencia con lo cotizado es solo una **referencia**: se cotizó hace días y los precios
cambian. La comparación justa, con la búsqueda hecha en el mismo momento en que se cotiza, es
la fase 2 del plan.

---

## Dónde quedan los resultados

Cada ejecución crea una carpeta en `resultados-comparador/AAAAMMDD_HHMM/`, dentro de la carpeta
del proyecto (no se sube al repositorio):
- `resumen.csv`: una fila por viaje con el más barato, el más barato cerca de la hora pedida,
  el precio por aerolínea, los vendedores y la diferencia con lo cotizado. Se abre con Excel o
  LibreOffice; las columnas van separadas por punto y coma.
- `crudo/`: la respuesta completa de SerpApi por viaje, por si hay que revisar algo. Con
  `--vendedores` también guarda la del regreso y la de los vendedores (`-regreso.json`,
  `-vendedores.json`). La clave aparece reemplazada por `***`.

## Si algo falla

| Mensaje | Qué hacer |
|---|---|
| `Falta la clave de SerpApi` | Repite el paso 2 |
| `SerpApi no reconoce esa clave` | Copia la clave de nuevo desde [serpapi.com/manage-api-key](https://serpapi.com/manage-api-key) y repite el paso 2 |
| `La clave tiene espacios` | Copia solo la clave, sin espacios antes ni después |
| `No alcanzan las búsquedas del mes` | Se acabaron las 250 del mes. Espera al mes siguiente o usa menos viajes |
| `SerpApi permite 50 búsquedas por hora` | Espera una hora |
| `No se pudo conectar con SerpApi` | Revisa la conexión a internet |
| `No conozco el aeropuerto de "…"` | Usa el código del aeropuerto, por ejemplo `--origen BOG` |
| `… no tiene vuelos comerciales; el aeropuerto más cercano es …` | Busca con ese código |
| `La fecha de ida ya pasó` | Usa una fecha futura: Google Flights solo tiene precios futuros |
| `Sin resultados: Google Flights hasn't returned any results…` | Esa ruta o fecha no tiene vuelos publicados. Prueba otra fecha |
| `command not found: node` | Instala Node LTS desde [nodejs.org](https://nodejs.org) |

## Todas las opciones

| Opción | Qué hace | Búsquedas que gasta |
|---|---|---|
| `--configurar` | Guarda y valida la clave, y muestra cuántas búsquedas quedan | 0 |
| `--demo` | Muestra el formato con datos inventados | 0 |
| `--rutas-prueba` | Las 8 rutas del paso 4, con fechas calculadas desde hoy | 8 |
| `--origen X --destino Y` | Un viaje. Sin `--ida` usa las fechas de la prueba de rutas | 1 |
| `--ida AAAA-MM-DD` | Fecha de ida. Sin `--regreso`, es solo ida | — |
| `--regreso AAAA-MM-DD` | Fecha de regreso | — |
| `--solo-ida` | Quita el regreso | — |
| `--hora-ida HH:MM` | Hora que pidió el viajero (busca el más barato ±2 h) | — |
| `--pasajeros N` | Número de pasajeros (por defecto 1) | — |
| `--cotizado N` | Lo que cotizó el área de viajes, para ver la diferencia | — |
| `--vendedores` | Quién vende la opción más barata (la aerolínea, Aviatur u otras agencias) y a qué precio | +1 en solo ida, +2 en ida y regreso |
| `--profunda` | Búsqueda completa de Google, más lenta y más fiel | igual |
| `--lote archivo.csv` | Varios viajes desde un CSV con `id,origen,destino,ida,regreso,pasajeros,hora_ida,cotizado` | 1 por viaje |
| `--salida carpeta` | Dónde guardar los resultados (por defecto `resultados-comparador/`) | — |

Antes de buscar, el comando siempre dice cuántas búsquedas va a gastar y no empieza si no
alcanzan las del mes o las de la hora.

## Archivos

| Archivo | Qué es |
|---|---|
| `comparador.cjs` | Núcleo: aeropuertos, parámetros y resumen por aerolínea. No usa nada de Node, para reutilizarlo en Apps Script en la fase 2 |
| `buscar.cjs` | El comando de Node |
| `ejemplo-respuesta.json`, `ejemplo-vendedores.json` | Respuestas inventadas para `--demo` |
| `apps-script/` | El rastreo automático del estudio de dos semanas (#A84): un proyecto de Apps Script aparte que usa este mismo núcleo. [Instalación](apps-script/README.md) |
| `.serpapi-key` | Tu clave (la crea `--configurar`; no se sube al repositorio) |
