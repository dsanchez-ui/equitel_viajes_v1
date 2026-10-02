# Comparador de precios de tiquetes (prueba)

Busca los precios que publican las aerolíneas en Google Flights para un viaje, y los
compara con lo que cotizó el área de viajes. No usa IA: es una consulta a una API y
un cálculo de mínimos. El plan completo está en
[docs/plan-comparador-precios.md](../../docs/plan-comparador-precios.md).

## Tutorial paso a paso

**Es seguro para la aplicación:** el comparador corre solo en tu computador. No se conecta
a la plataforma, a la hoja ni a Apps Script; solo consulta precios en Google Flights.

### Paso 1. Crear la cuenta gratis de SerpApi (una sola vez, 5 minutos)

1. Entra a [serpapi.com/users/sign_up](https://serpapi.com/users/sign_up) y regístrate con
   tu correo (o con Google).
2. Verifica el correo y el celular (llega un código por SMS). **No pide tarjeta.** El plan
   gratis da 250 búsquedas al mes.
3. En el panel de tu cuenta, busca **API Key** y copia la clave (una cadena larga de letras
   y números).

### Paso 2. Guardar la clave en el computador

En una terminal, dentro de la carpeta del proyecto:

```bash
echo "PEGUE_AQUI_LA_CLAVE" > tools/comparador-precios/.serpapi-key
```

Ese archivo está en `.gitignore`: no se sube al repositorio. Para usarla solo en la
terminal actual, sin archivo: `export SERPAPI_KEY=PEGUE_AQUI_LA_CLAVE`.

### Paso 3. Ver el formato sin gastar búsquedas

```bash
node tools/comparador-precios/buscar.cjs --demo
```

Muestra un ejemplo con **datos inventados** (lo dice arriba en mayúsculas). Sirve para ver
cómo se leen los resultados.

### Paso 4. Probar un viaje real (gasta 1 búsqueda)

Escoge una ruta y una fecha futura (Google Flights solo tiene precios futuros):

```bash
node tools/comparador-precios/buscar.cjs --origen BOGOTA --destino MEDELLIN --ida 2026-10-20 --regreso 2026-10-22 --hora-ida 06:30
```

Para leer el resultado:
- **Tabla:** el precio más bajo de cada aerolínea ese día, con la hora y el vuelo.
- **"Más barato del día":** el menor precio de todas las aerolíneas.
- **"Más barato saliendo entre 2 h antes y 2 h después":** el menor cerca de la hora que
  pidió el viajero. Es el que más se parece a lo que Laura compraría.
- **"Google considera típico":** el rango normal de precio para esa ruta.

Abre la página de la aerolínea a la misma hora y compara uno o dos precios.

### Paso 5. Probar los viajes próximos de la base (gasta 1 búsqueda por viaje)

```bash
node tools/comparador-precios/buscar.cjs --lote ~/Downloads/comparador-viajes-proximos.csv
```

El archivo tiene los 13 viajes próximos de la base del 29-sep, con lo que se cotizó. No
tiene nombres ni cédulas. Si un viaje ya pasó, el comando lo salta con un aviso.

### Paso 6. ¿Aviatur vende la misma tarifa? (gasta 1 o 2 búsquedas más por viaje)

Agrega `--vendedores` a cualquiera de los comandos anteriores. Muestra quién vende la
opción más barata (la aerolínea, Aviatur u otras agencias) y a qué precio.

### Qué revisar con los resultados

1. **Cobertura:** ¿aparecen Avianca, LATAM, Wingo, JetSMART, Satena y Clic donde operan?
   En Medellín se buscan los dos aeropuertos (MDE y Olaya Herrera, EOH), porque Satena y
   Clic salen de Olaya.
2. **Exactitud:** 2 o 3 precios comparados con la página de la aerolínea a la misma hora.
3. **Varios pasajeros:** la misma ruta con `--pasajeros 1` y con `--pasajeros 2`. Si el
   precio se duplica, es el total del grupo (lo esperado).
4. **Aviatur:** con `--vendedores`, ¿aparece como vendedor y a qué precio?
5. **Comparación con lo cotizado:** el lote trae lo que se cotizó hace unos días y los
   precios cambian, así que es una referencia, no una medición. La medición justa
   (buscar en el mismo momento en que se cotiza) es la fase 2 del plan.

### Si algo falla

| Mensaje | Qué hacer |
|---|---|
| `Falta la clave de SerpApi` | Repite el paso 2 |
| `SerpApi rechazó la clave (HTTP 401)` | La clave está mal copiada: cópiala de nuevo del panel |
| `No conozco el aeropuerto de "…"` | Usa el código IATA (p. ej. `--origen BOG`) |
| `… no tiene vuelos comerciales; el aeropuerto más cercano es …` | Busca con ese código |
| `La fecha de ida ya pasó` | Usa una fecha futura |
| `Sin resultados: Google Flights hasn't returned any results…` | Esa ruta o fecha no tiene vuelos publicados; prueba otra fecha |

### Opciones

| Opción | Qué hace | Búsquedas que gasta |
|---|---|---|
| (ninguna) | Precio más bajo por aerolínea, el más barato del día y el más barato cerca de la hora pedida | 1 por viaje |
| `--vendedores` | Además, quién vende la opción más barata (la aerolínea, Aviatur u otras agencias) y a qué precio | +1 en solo ida, +2 en ida y regreso |
| `--profunda` | Pide a Google la búsqueda completa, igual a la del navegador. Más lenta y más fiel | igual |
| `--pasajeros N` | Número de pasajeros (por defecto 1) | igual |
| `--cotizado N` | Lo que cotizó el área de viajes, para ver la diferencia | igual |
| `--salida carpeta` | Dónde guardar los resultados (por defecto `resultados-comparador/`) | — |

Cada ejecución deja un `resumen.csv` (abre en Excel) y la respuesta completa de cada
viaje en `crudo/`. Al final dice cuántas búsquedas quedan en el mes.

## Archivos

| Archivo | Qué es |
|---|---|
| `comparador.cjs` | Núcleo: aeropuertos, parámetros, resumen por aerolínea. Sin nada de Node, para reutilizarlo en Apps Script |
| `buscar.cjs` | El comando de Node |
| `ejemplo-respuesta.json`, `ejemplo-vendedores.json` | Respuestas inventadas para `--demo` |

La búsqueda solo envía ruta, fechas y número de pasajeros. Ningún nombre, cédula ni
correo sale del computador.
