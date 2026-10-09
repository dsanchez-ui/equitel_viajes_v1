# Prueba de Ignav: ¿sirve para comparar con la misma tarifa?

> **Resultado (9-oct-2026): no sirve.** Se probaron 5 rutas (161 vuelos directos, 19 consultas).
> Los precios coinciden con Google Flights, pero:
> - el filtro de bodega no cambió el precio de ningún vuelo;
> - el de maleta de mano sacó a Avianca y LATAM de los resultados;
> - el equipaje informado está errado (Avianca Basic con 1 maleta de bodega, LATAM Basic con 2);
> - las opciones de compra no traen el nombre de la tarifa.
>
> El comparador sigue con Google Flights (SerpApi) y la comparación por maleta de mano (#A95).
> Detalle en [docs/plan-comparador-precios.md](../../docs/plan-comparador-precios.md).

Hoy el comparador usa Google Flights (SerpApi) y compara por equipaje (#A95). Tiene dos
límites:
- Google no trae por separado las tarifas del manual COM-P-02.
- No se puede pedir maleta de bodega.

**Ignav** es otra API de precios de vuelos. Su documentación muestra tres cosas que podrían
resolverlo:

1. **Filtros de equipaje:** `min_carry_on_bags` (maleta de mano) y `min_checked_bags` (**bodega**): «solo tarifas que incluyan ese equipaje».
2. **El equipaje de cada resultado** (`bags`: mano y bodega incluidas).
3. **El nombre de la tarifa** (`fare_name`, por ejemplo «Main Cabin») en las **opciones de compra** de cada vuelo.

> **Ojo con `cabin_class`:** es la **cabina** del avión (`economy`, `premium_economy`,
> `business`, `first`), no la tarifa. Basic, Classic y Flex de Avianca, y Basic, Light y Full
> de LATAM, son todas `economy`. Por eso ese campo no sirve para distinguirlas.

Esta prueba responde cinco preguntas:

1. ¿Trae vuelos **nacionales directos** de Avianca y LATAM, **en pesos**?
2. Al pedir **maleta de mano** o **de bodega**, ¿el precio del **mismo vuelo** sube a la tarifa que la incluye? Por ejemplo, Avianca Basic → Classic, o LATAM Basic → Light → Full.
3. ¿Las opciones de compra traen el **nombre de la tarifa** (Basic, Classic, Flex / Light, Full)?
4. ¿Los precios coinciden con avianca.com y latam.com?
5. Con 2 pasajeros, ¿el precio es el del grupo?

| | |
|---|---|
| **Tiempo** | unos 20 minutos |
| **Costo** | **$0.** Ignav regala 1.000 consultas una sola vez y **no pide tarjeta**. Solo cobra (USD 2 por cada 1.000) si después registras un medio de pago. |
| **Consultas** | unas 19 (paso 4) más 5 (paso 6), de las 1.000 gratis. Las consultas con error no se cobran. |
| **Dónde corre** | solo en este computador. No toca la plataforma, la base de datos ni Apps Script. |

**No usa datos personales:** solo envía ruta, fecha y número de pasajeros. **No compra ni
reserva nada:** Ignav solo da precios y enlaces.

---

## Antes de empezar: abrir la terminal en la carpeta del proyecto

1. Abre el proyecto en VS Code.
2. Menú **Terminal → Nueva terminal**.
3. Comprueba que tienes Node con `node --version`. Debe decir `v18` o más.

Todos los comandos se escriben en esa terminal, desde la carpeta del proyecto
(`cd ~/Documents/VSC/AgentTest/equitel_viajes_v1` si abriste otra).

## Paso 0. Ver el formato con datos inventados (10 segundos, no se conecta)

```bash
node tools/comparador-precios/ignav.cjs --demo
```

Muestra el caso que buscamos, con precios inventados:

```
  Vuelo      Sale   Sin filtro                    Con maleta de mano            Con bodega
  LA 4003    05:50  $154.600 (mano 0, bodega 0)   $198.300 (mano 1, bodega 0)   $301.900 (mano 1, bodega 1)
  AV 9368    06:00  $265.270 (mano 0, bodega 0)   $339.050 (mano 1, bodega 1)   $339.050 (mano 1, bodega 1)
  Con bodega: el precio sube en 2 vuelo(s), queda igual en 0 y el vuelo desaparece en 0.

--- Opciones de compra: AV 9368 06:00
  Avianca                airline      tarifa: Basic              $265.270
  Avianca                airline      tarifa: Classic            $339.050
  Avianca                airline      tarifa: Flex               $512.400
```

Si los datos reales se ven así, Ignav permite comparar por tarifa, **también con bodega**.

## Paso 1. Crear la cuenta gratis (3 minutos, una sola vez)

1. Entra a [ignav.com](https://ignav.com) y crea la cuenta gratis (*Sign up*). Puedes usar tu correo de Equitel.
2. **Verifica el correo** con el enlace que te llega. Sin eso, la clave no funciona.
3. **No pide tarjeta.** Quedan 1.000 consultas gratis. Si algún día se acaban, Ignav responde «hay que registrar un medio de pago» y **no cobra nada** hasta que lo registres.

## Paso 2. Copiar la clave (1 minuto)

1. Entra al panel: [ignav.com/dashboard](https://ignav.com/dashboard).
2. Copia la clave de la API (*API key*).

**No la pegues en chats, correos ni archivos del proyecto.** Si se filtra, en el panel se
puede cambiar por otra.

## Paso 3. Guardar la clave (1 minuto, no se cobra)

```bash
node tools/comparador-precios/ignav.cjs --configurar
```

Pega la clave y presiona Enter. Solo verás asteriscos. El script hace una consulta incompleta
a propósito para revisar la clave: Ignav responde «faltan datos» y **eso no se cobra**.

Debe responder:

```
✓ Clave válida y guardada en …/tools/comparador-precios/.ignav-key (solo la lee su usuario; no se sube al repositorio).
```

## Paso 4. La prueba (unas 19 consultas, 2 a 3 minutos)

```bash
node tools/comparador-precios/ignav.cjs --prueba
```

Busca 5 rutas nacionales (Bogotá–Medellín, Bogotá–Cali, Bogotá–Cartagena,
Bogotá–Barranquilla y Medellín–Cartagena). Usa un martes a dos semanas o más, solo vuelos
directos y precios en pesos. Cada ruta se busca **tres veces**:

1. **Sin filtro:** lo más barato, como lo da hoy Google Flights.
2. **Con maleta de mano:** solo tarifas que la incluyan.
3. **Con bodega:** solo tarifas que la incluyan.

Para un vuelo de Avianca y uno de LATAM, pide también las **opciones de compra**, sin
filtro y con bodega, para ver los nombres de las tarifas.

**Qué mirar en cada ruta:**

- **La línea «Con bodega: el precio sube en N vuelo(s)…»**
  - **Sube:** al pedir bodega, el mismo vuelo trae la tarifa que la incluye. **Esto es lo que buscamos.**
  - **Queda igual:** el vuelo ya incluía bodega, o Ignav no cambió de tarifa.
  - **Desaparece:** el filtro solo esconde los vuelos sin bodega y no busca la tarifa con bodega. **Así no sirve.**
- **Las columnas `mano` y `bodega` de cada precio:** si dicen `?`, Ignav no sabe el equipaje de esa tarifa.
- **En las opciones de compra, «Nombres de tarifa vistos»:** si aparecen Basic, Classic, Flex o Light, Full, hay nombre de tarifa (pregunta 3).

Al final dice dónde quedó todo:

```
Resultados en …/resultados-comparador/ignav_20261009_1530 (resumen.csv para Excel y las respuestas completas en crudo/).
```

`resumen.csv` tiene una fila por vuelo, con el precio y el equipaje en las tres búsquedas.
La carpeta no se sube al repositorio.

## Paso 5. ¿Los precios son reales? (unos 15 minutos)

Escoge 3 vuelos del resultado: dos de Avianca y uno de LATAM.

1. En una ventana de incógnito, busca en [avianca.com](https://www.avianca.com) o [latam.com](https://www.latam.com) la misma ruta y fecha, solo ida y 1 adulto.
2. Anota el precio de las tres tarifas de ese vuelo.
3. Compara con Ignav:
   - «Sin filtro» debería ser la **Basic**.
   - «Con maleta de mano» debería ser la **Light** de LATAM o la **Classic** de Avianca.
   - «Con bodega» debería ser la **Full** de LATAM o la **Classic** de Avianca.

Diferencias de unos pocos pesos son normales.

## Paso 6. Precio con 2 pasajeros (3 consultas, más 2 de opciones de compra)

```bash
node tools/comparador-precios/ignav.cjs --origen BOG --destino CLO --pasajeros 2
```

Compara con el precio de Bogotá–Cali del paso 4: con 2 pasajeros debería ser más o menos el
doble.

## Paso 7. Anotar los resultados y decidir

| Pregunta | Respuesta | Nota |
|---|---|---|
| 1. ¿Vuelos nacionales directos de Avianca y LATAM, en COP? | sí / no | en cuántas de las 5 rutas; ¿salen Wingo y JetSMART? |
| 2. ¿Con maleta o bodega, el precio del mismo vuelo sube? | sí / no / a veces | qué pasa con Avianca y qué con LATAM |
| 3. ¿Las opciones de compra traen el nombre de la tarifa? | sí / no | qué nombres |
| 4. ¿Precios iguales a los de la aerolínea? | sí / no | diferencias |
| 5. ¿Precio del grupo con 2 pasajeros? | sí / no | |

**Decisión:**
- **Si 1, 2 y 4 son «sí»:** se cambia el rastreo de Google Flights (SerpApi) a Ignav en el mismo proyecto aparte de Apps Script, sin tocar la plataforma. TIPO 1 se busca sin filtro, TIPO 2 con maleta de mano y TIPO 3 con bodega. Así la comparación queda «peras con peras» también en LATAM y con bodega.
- **Si no:** nos quedamos con Google Flights y la comparación por maleta de mano de hoy.

Me pasas la tabla, o la carpeta `resultados-comparador/ignav_…`, y yo hago el análisis.

## Si algo falla

| Mensaje | Qué hacer |
|---|---|
| `Falta la clave de Ignav` | Paso 3. |
| `Ignav no reconoce la clave` | Verifica el correo (paso 1) y copia la clave completa de nuevo. |
| `Ignav pide registrar un medio de pago` | Se acabaron las 1.000 consultas gratis. No sigas: avísame. |
| `Ignav rechazó la consulta` | Revisa los códigos de aeropuerto (BOG, MDE, CLO…) y que la fecha sea futura. |
| `Sin vuelos directos para esa ruta y fecha` | Prueba otra fecha con `--ida AAAA-MM-DD`. |

## Archivos

| Archivo | Qué es |
|---|---|
| `ignav.cjs` | El script de la prueba. Solo consulta precios. |
| `ejemplo-ignav.json` | Respuestas inventadas con el formato de Ignav, para `--demo`. |
| `.ignav-key` | Tu clave. La crea el paso 3, solo la lee tu usuario y no se sube (está en `.gitignore`). |

## Fuentes

- Ignav, documentación: <https://ignav.com/docs>
- Búsqueda de solo ida (campos y filtros): <https://ignav.com/docs/one-way>
- Filtros de equipaje: <https://ignav.com/docs/filtering>
- Formato de respuesta (`bags`, `cabin_class`): <https://ignav.com/docs/response-format>
- Opciones de compra (`fare_name`): <https://ignav.com/docs/booking-links>
- Mercados (CO = pesos): <https://ignav.com/docs/markets>
- Precios (1.000 gratis, sin tarjeta; solo se cobran las respuestas exitosas): <https://ignav.com/pricing>
- Errores: <https://ignav.com/docs/errors>
