# Plan — Comparador de precios de tiquetes y estudio de sobrecosto

> **Estado (2026-10-07): prueba hecha el 6-oct (demostración para Alejandro). Fase 1 en producción (#A82). Fase 2 activa desde el 7-oct como estudio de 2 semanas, oculto para Laura (#A84); desde #A86 busca cada tramo por separado y el dashboard muestra el detalle de cada viaje; desde #A95 (8-oct) compara con la misma tarifa del manual.** Pedido de Alejandro
> Gómez (vicepresidente) a David. La prueba (fase 0) está en
> [tools/comparador-precios/](../tools/comparador-precios/README.md); las fases 1 a 4
> esperan su resultado y las decisiones del final.

---

## 1. Qué se pidió

- Un robot que, apenas se crea una solicitud de viaje, busque precios en las aerolíneas
  (Avianca, LATAM, Satena, Clic…) y arme una comparativa con lo que cotiza Aviatur.
- Que Laura vea esa comparación al confirmar costos y registre con qué aerolínea y por
  qué canal compra (Aviatur u otro).
- Un estudio de **2 a 3 semanas** para saber cuánto dinero de más se gasta y si se
  justifica cambiar la forma de comprar.
- Sin IA (por costo) y de la forma más económica posible.

## 2. Recomendación

**No construir un robot propio que recorra las páginas de las aerolíneas.** Usar los
precios que las mismas aerolíneas publican en Google Flights, a través de una API
(SerpApi). Para el volumen de Equitel cuesta **$0**, no usa IA y se puede llamar
desde Apps Script.

### Por qué no un robot propio

Lo verificamos el 2026-10-02 pidiendo, desde este computador, el archivo `robots.txt`
de cada aerolínea (el archivo donde un sitio dice qué deja recorrer a los robots):

| Aerolínea | Resultado |
|---|---|
| Avianca | **Bloqueado** ("Access Denied" de Akamai, su sistema antibots), incluso para ese archivo público |
| LATAM | **Conexión cortada** |
| Wingo | Prohíbe a los robots las rutas de búsqueda de vuelos (`/Flight/`) y su API (`/api/*`) |
| JetSMART | Prohíbe a los robots su sitio de reservas |
| Clic | Detrás de Cloudflare (otro sistema antibots) |

Pasar esas barreras exige técnicas para evadir la detección: proxies residenciales,
falsear la huella del navegador, resolver captchas. Es frágil (se rompe cada vez que
la aerolínea cambia su página), costoso de mantener y contrario a sus condiciones de
uso. Desde Apps Script es inviable: las direcciones de Google son de las primeras
que bloquean.

### Opciones evaluadas

| Opción | Aerolíneas | Costo | Riesgo | Veredicto |
|---|---|---|---|---|
| Robot propio (navegador automatizado) | Las que no lo bloqueen | Servidor + proxies | Bloqueos, condiciones de uso, mantenimiento | Descartada |
| **Google Flights vía SerpApi** | Las que publican en Google Flights: Avianca, LATAM, Wingo, JetSMART, Satena y Clic (a confirmar en la prueba) | **Gratis hasta 250 búsquedas/mes**; US$25/mes por 1.000 | Depende de un proveedor; Google no es la compra exacta | **Recomendada** |
| Google Flights vía SearchApi.io | Igual | 100 gratis; desde US$40/mes | Igual | Alternativa si SerpApi falla |
| Amadeus Self-Service | — | — | **Apagado el 17-jul-2026** | No existe |
| Duffel | LATAM directo; Avianca vía Travelport; sin confirmación de Wingo, JetSMART, Satena ni Clic | Cobra por reserva y por exceso de búsquedas | Cobertura incompleta en Colombia | No para este estudio |

**Volumen:** unos 65 viajes con vuelo al mes (reporte de compras del 29-sep). Con dos
búsquedas por viaje (sección 3) son unas 130 al mes, dentro del plan gratis.

## 3. Cómo funcionaría, por fases

### Fase 0 — Prueba local (lista)

Un comando que David ejecuta en su computador con la clave gratis de SerpApi, siguiendo el
[tutorial paso a paso](../tools/comparador-precios/README.md) (unos 30 minutos y 16
búsquedas de las 250 gratis del mes). No necesita hoja de cálculo ni proyecto de Apps Script.
Para cada viaje muestra:
- el precio más bajo por aerolínea
- el más barato del día
- el más barato saliendo 2 horas antes o después de la hora pedida
- la diferencia con lo cotizado
- con `--vendedores`, quién vende la tarifa: la aerolínea, Aviatur u otras agencias

La prueba principal son 8 rutas escogidas para cubrir las aerolíneas (`--rutas-prueba`), con
fechas calculadas desde el día en que se corre. El lote con los 13 viajes próximos de la base
del 29-sep (`~/Downloads/comparador-viajes-proximos.csv`) queda como paso opcional: sus viajes
van venciendo.

**Qué decide la prueba:**
1. ¿Aparecen las aerolíneas que importan en las rutas de Equitel?
2. ¿Los precios coinciden con la página de la aerolínea a la misma hora?
3. Con varios pasajeros, ¿el precio es el del grupo o por persona?
4. ¿Aviatur aparece como vendedor en Google Flights?

### Fase 1 — Registrar cómo se compró (implementada: #A82)

Columnas nuevas `AEROLINEA` y `CANAL DE COMPRA` (*Aviatur*, *Directo* u *Otra agencia*):
- **Confirmar costos:** Laura registra el canal previsto.
- **Registrar reserva:** confirma o cambia el canal real. Ahí se decide comprar directo
  cuando Aviatur no ajusta el precio.

Sirve aunque no haya comparador: permite medir por aerolínea y por canal.

**Pendiente de decidir:** preguntar si el tiquete incluye maleta de bodega. Es lo que más
cambia el precio, y en la reunión del 10-sep se descartó una lista fija de categorías. Se
agrega si la prueba del comparador muestra que hace falta para comparar en igualdad.

### Fase 2 — Búsqueda automática (implementada: #A84)

Un **proyecto de Apps Script aparte**, no el de producción, con un disparador cada
15 minutos ([instalación](../tools/comparador-precios/apps-script/README.md)). Busca cada
solicitud de vuelo en dos momentos (decisión de David del 7-oct):
1. **Al cotizar** (`PENDIENTE_APROBACION`): el precio comparable con la cotización, porque
   se busca casi a la misma hora en que Aviatur cotiza.
2. **Al comprar** (`APROBADO`, o recién `RESERVADO`): cuánto costaría la opción más barata
   cuando Laura compra.

No se busca al crearse la solicitud: entre la creación y la compra pasan la selección y
las aprobaciones, y ese precio no se compara con nada.

**Cada tramo por separado (#A86, pedido de David del 7-oct):** la ida con su hora pedida y
el regreso con la suya, como se compran (a veces con aerolíneas distintas). Así cada precio
se puede encontrar igual en la página de la aerolínea. La primera versión buscaba ida y
vuelta juntos: Google daba un solo precio, el vuelo de ida con el regreso más barato que le
combinaba, sin tener en cuenta la hora del regreso. En internacionales de ida y vuelta se
busca además el tiquete redondo y se compara contra el menor. Cuesta una búsqueda más por
viaje de ida y regreso (2 por momento).

**Solo vuelos directos (#A88, David, 7-oct):** a los viajeros no se les compran vuelos con
escala, así que, si un tramo tiene vuelos directos, solo esos se comparan. Los de escala
cuentan solo si ese día no hay directos.

Los resultados van a dos pestañas ocultas de la misma base, **COMPARATIVO PRECIOS** y
**COMPARATIVO ESTADO**, que el proyecto aparte es el único que escribe. La clave de la API
va en las propiedades de ese proyecto, nunca en el código ni en la hoja.

**Por qué un proyecto aparte:** el de producción no tiene permiso de salida a internet
(#A62). Dárselo obliga a volver a autorizar el script, con riesgo para los
recordatorios y la copia diaria, que corren con la autorización del dueño. Uno aparte
aísla ese riesgo y se apaga sin tocar la plataforma.

### Misma tarifa: «peras con peras» (implementada: #A95)

En la reunión del 8-oct Yurani pidió comparar con la tarifa real de compra y no con la más
barata, porque el viajero puede necesitar maleta. Se acordó registrar la tarifa en la
plataforma y que el comparador la use.

**Lo que da la API** (pruebas del 8-oct):
- Google no trae las tres tarifas del manual por separado en rutas nacionales.
- Sí acepta el número de maletas de mano (`bags`). Con ese dato, Avianca pasa a la Classic.
- En LATAM, pedir maleta de mano no cambia el precio.
- No se puede pedir maleta de bodega.

**Cómo funciona:**
- Laura registra la tarifa (TIPO 1, 2 o 3) al confirmar costos y al registrar la reserva.
- El rastreo busca con su equipaje: TIPO 1 sin maleta; TIPO 2 y 3 con una maleta de mano por pasajero.
- Si la tarifa cambia después de una búsqueda, esa búsqueda se repite una sola vez.
- El dashboard compara por defecto solo los viajes buscados con el equipaje de su tarifa. *Todas las búsquedas* queda como referencia.

Reglas del manual y límites: [manual-com-p-02.md](manual-com-p-02.md).

**Otras fuentes de las tres tarifas (investigación del 8-oct, pedido de David):**

| Opción | Qué daría | Conclusión |
|---|---|---|
| SerpApi y otros lectores de Google Flights | Lo que muestra Google | No resuelve: en las respuestas guardadas del 8-oct ninguna opción de compra trae el nombre de la tarifa. LATAM devuelve un solo precio, marcado «con maleta de mano». |
| Duffel (API de reservas) | Una oferta por tarifa (`fare_brand_name`), con precio y equipaje | **Descartada por David (8-oct):** sus pagos no operan en Colombia, el modo real exige verificar la empresa y cobraría por búsquedas de un servicio que quizá no se podría usar. Además solo tiene Avianca y LATAM (por Travelport). |
| Ignav (API de precios, autoservicio) | Un precio por vuelo, en pesos (mercado `CO`), con filtros de maleta | **Descartada tras la prueba del 9-oct** (5 rutas, 161 vuelos directos; [README-ignav.md](../tools/comparador-precios/README-ignav.md)). Los precios coinciden con Google (Avianca $265.270 = la Basic de SerpApi) y trae Avianca, LATAM, Wingo y JetSMART, pero: el filtro de bodega no cambió el precio de **ningún** vuelo; el de maleta de mano **saca** a Avianca y LATAM (SerpApi, en cambio, devuelve la Classic de Avianca); el equipaje que informa está errado (Avianca Basic con 1 maleta de bodega, LATAM Basic con 2); las opciones de compra no traen `fare_name`. No mejora lo que ya da Google Flights. |
| Amadeus, Sabre, Travelport, intermediarios NDC (AirGateway, Verteil, Mystifly), Travelfusion | Las tarifas completas | Piden ser agencia (acreditación IATA o código de agencia) o un contrato comercial. Amadeus Self-Service cerró el 17-jul-2026. |
| Kiwi, Skyscanner, Travelpayouts | El precio más barato o precios guardados | No traen las tarifas por separado. |
| Leer avianca.com o latam.com con un robot | Las tarifas | Descartado: ambos sitios rechazaron las consultas automáticas (error 403), y habría que mantenerlo y revisar sus términos de uso. |
| **Aviatur** | La tarifa, el precio y el equipaje reales | Lo más confiable y sin costo: pedir que cada cotización traiga el precio de las tres tarifas y cuál se compró. La agencia las ve en su sistema de reservas. Yurani ya quedó en pedir el informe por categorías (reunión del 8-oct). |

**¿Una diferencia fija entre tarifas?** No es seguro. Cada tarifa tiene sus propias clases y cupos, así que lo
esperable es que la diferencia cambie según la ruta, la fecha y la ocupación. Si se quiere usar un factor, primero
hay que medirlo con una muestra real.

Fuentes: [Duffel, precios](https://duffel.com/pricing) · [Duffel, campos de la oferta](https://duffel.com/docs/api/v2/offers/schema) ·
[Duffel, aerolíneas](https://duffel.com/flights/airlines) · [SerpApi, opciones de compra](https://serpapi.com/google-flights-booking-options) ·
[Cierre de Amadeus Self-Service](https://airlabs.co/amadeus-self-service-api-shutdown) · [Sabre, preguntas de agencias](https://developer.sabre.com/guides/travel-agency/faqs) ·
[Tarifas nacionales de LATAM](https://www.latamairlines.com/co/es/centro-ayuda/preguntas/compras/asistencia/tarifas-pasaje-domestico) ·
[Tarifas de Avianca (2024)](https://www.valoraanalitik.com/2024/01/25/avianca-lanza-nuevas-tarifas-para-vuelos-nacionales-e-internacionales/)

### Tarifa por noches, qué tan comparable y dos precios por vuelo (#A97, 9-oct, idea de David)

Solo el dashboard de costos y el rastreo. La app de Laura no cambia: falta la autorización de Yurani.

**1. ¿Cuántos viajes son TIPO 1?** Base del 8-oct: 421 viajes comprados de abril a octubre.

| Nacionales | Viajes | Tiquetes | Gasto |
|---|---|---|---|
| TIPO 1 (0 a 1 noche) | 44 % | 38 % | 39 % |
| TIPO 2 (2 a 5 noches) | 45 % | 51 % | 51 % |
| TIPO 3 (6 o más) | 11 % | 11 % | 10 % |

- En los de ida y vuelta, TIPO 1 es el 29 %.
- Los de solo ida son TIPO 1 en el 80 %, porque sin regreso se cuentan las noches de hotel y 85 de 116 no tienen.

**Conclusión:** TIPO 1 no es la mayoría, pero pesa un 40 % del gasto, y en TIPO 1 lo más barato de Google **es** la tarifa del manual.

**2. Dos precios por vuelo.** El 9-oct se buscó Bogotá–Medellín sin maleta y con 1 maleta de mano (2 búsquedas):

| Aerolínea | Al pedir maleta de mano | Qué se deduce |
|---|---|---|
| Avianca | sube en 25 de 25 vuelos, siempre +$73.780 | Basic y Classic de cada vuelo (la Flex no) |
| JetSMART | sube en 6 de 6 (+$83.300) | la tarifa y la tarifa con maleta |
| LATAM | no cambia en 16 de 16 | nada: Google no distingue Basic, Light ni Full |
| Wingo | no cambia (6 de 6) | ya incluye la maleta de mano |
| Clic | solo aparece al pedir maleta | su precio con maleta |

**Qué se construye:**
- **Tarifa por noches cuando no está registrada.** El comparador usa la tarifa que registró el área de viajes y, si falta, la que corresponde por las noches del viaje. Los viajes TIPO 1 se comparan con lo más barato de Google. El rastreo busca con ese mismo equipaje.
- **Qué tan comparable es cada viaje:**
  - **Exacta:** TIPO 1 sin maleta; TIPO 2 con maleta de mano cuando el vuelo de referencia es de Avianca, JetSMART o Wingo; TIPO 3 solo con Avianca, porque su Classic incluye bodega. (Clic se pasó a aproximada en #A98: Google trae su VeLigera y el manual pide VeEcono o VePreferencial.)
  - **Aproximada:** LATAM en TIPO 2 o 3, porque Google no la distingue, y cualquier TIPO 3 que no sea Avianca, porque no se puede pedir bodega. El precio de Google puede quedar por debajo.
  - **No comparable:** Google se buscó con otro equipaje que el de la tarifa.

  El dashboard lo dice en cada viaje y deja ver «solo comparaciones exactas».
- **Dos precios por vuelo al comprar.** El rastreo busca también el otro equipaje (`DOS_NIVELES`: `compra` por defecto, `ambos` o `no`). Es una consulta más por tramo. El detalle del viaje muestra, vuelo por vuelo, el precio sin maleta y con maleta de mano, y lo que se deduce de cada aerolínea.
- **Proyección por tarifa:**
  - el volumen se separa por TIPO;
  - un control *«Viajes a proyectar: todos / solo TIPO 1»* deja proyectar solo donde la comparación es exacta;
  - la muestra se puede limitar a comparaciones exactas.

**Cupo de SerpApi:** quedan 187 búsquedas este mes. Con el ritmo del estudio (unas 6 al día) y la búsqueda extra al comprar, alcanza hasta el 21-oct. Si no alcanzara, se apaga con `DOS_NIVELES` = `no`.

### Claridad: los dos precios del mismo momento y cada viaje en palabras (#A98, 9-oct)

Al revisar SOL-000633 salieron tres problemas:
- la tabla de dos precios juntaba búsquedas con casi 20 horas de diferencia;
- una baja de precio salía como «mismo precio»;
- Clic contaba como exacta.

**Qué cambió:**
- **Pares del mismo momento:**
  - los dos precios de un vuelo solo se comparan si las búsquedas tienen 3 horas o menos de diferencia;
  - si no, el detalle dice de cuándo es cada una;
  - el rastreo repite una vez la del otro equipaje mientras el viaje siga por comprar.
- **Resumen por aerolínea en cada tramo:** en cuántos vuelos sube con maleta y cuánto, típicamente.
- **«Qué dice esta comparación»:** cinco o seis líneas al abrir un viaje:
  - lo cotizado frente a la misma aerolínea;
  - de dónde sale la diferencia;
  - el aeropuerto: en Medellín, Clic y Satena operan desde Olaya Herrera, no desde Rionegro;
  - la bodega: con maleta de mano, Wingo, JetSMART y LATAM no la traen y la Classic de Avianca sí;
  - la anticipación;
  - qué tan comparable es.
- **Calidad:**
  - Clic queda aproximada;
  - si el viajero pidió bodega, solo Avianca es exacta en TIPO 2 y 3.

### Fase 3 — Comparación visible para Laura (después del estudio)

Por ahora (#A84) la comparación **solo la ven Yurani, Diego y David**, en una sección del
dashboard de costos (las mismas personas de la variación cotizado vs facturado). Laura no
la ve. Lo que sigue es para después del estudio, si se decide mostrársela:

En **Confirmar costos**, junto al costo que está escribiendo, una tabla con el precio
más bajo por aerolínea de la búsqueda más reciente. El backend la lee de la hoja
COMPARATIVO PRECIOS y no necesita permisos nuevos. No cambia la decisión de que las
opciones de vuelo sean imágenes.

### Fase 4 — Estudio de 2 a 3 semanas e informe

Por cada solicitud del periodo: lo cotizado, contra el precio de la **misma aerolínea**
a una hora parecida, y contra el **más barato del mercado** en esa franja. Sale el
sobrecosto total del periodo y su proyección anual, en la pestaña Compras y costos de
Métricas o en un Excel como el del 29-sep.

## 4. Cómo medir el sobrecosto sin engañarse

- **Mismo momento:** los precios cambian durante el día. Por eso cuenta la búsqueda
  hecha cuando se cotiza (fase 2, momento 2).
- **Misma aerolínea y hora parecida (±2 h):** el viajero pide una hora; un vuelo más
  barato a otra hora no siempre es una opción real.
- **Misma tarifa:** Google muestra la tarifa más barata, que muchas veces no incluye
  maleta de bodega. Por eso Laura registra si el tiquete la incluye.
- **Dos ahorros distintos:**
  - *Sobrecosto de canal:* Aviatur frente a la misma aerolínea comprada directo. Es lo
    que decide si cambiar de agencia.
  - *Ahorro de elección:* otra aerolínea u otra hora. Es una decisión de política de
    viajes, no de la agencia.
- **Cargo de servicio de la agencia:** el reporte del 29-sep muestra que lo pagado a
  "Aviatur y/o IVA" es el 34 % del valor base de la factura 1, pero mezcla IVA, tasas y
  tarifa de servicio. Pedir a Aviatur el desglose completa la comparación.

## 5. Costos y riesgos

- **SerpApi:** gratis hasta 250 búsquedas al mes, sin tarjeta. Si se quiere más
  detalle (por ejemplo, vendedores en cada viaje), el plan Starter cuesta US$25 al
  mes por 1.000 búsquedas. Las búsquedas fallidas o en caché no se cobran.
- **Apps Script:** gratis (cuota de llamadas a internet muy por encima de este uso).
- **Exactitud:** Google Flights no es la compra; puede diferir unos minutos de la
  página de la aerolínea. Se mitiga validando a mano 2 o 3 casos por semana.
- **Cobertura:** si Satena o Clic no aparecen, sus rutas quedan sin referencia. En
  Medellín se buscan los dos aeropuertos (Olaya Herrera es donde operan).
- **Proveedor:** si SerpApi cambia condiciones, SearchApi.io ofrece lo mismo; el
  núcleo del comparador está separado de la llamada, así que el cambio es pequeño.
- **Datos personales:** la búsqueda solo envía ruta, fechas y número de pasajeros.
  Ningún nombre, cédula ni correo sale a terceros.

## 6. Decisiones pendientes

1. **David:** crear la cuenta gratis de SerpApi y ejecutar la prueba (fase 0).
2. **David y Alejandro**, con el resultado de la prueba:
   - ¿Se sigue con las fases 1 a 4?
   - ¿Qué canales se registran en confirmación de costos?
   - ¿Una o dos búsquedas por solicitud?
   - ¿Desde qué fecha corre el estudio?
3. **Área de viajes:** pedir a Aviatur el desglose de sus cargos (tarifa de servicio
   separada de IVA y tasas).

## Fuentes

- SerpApi, documentación de Google Flights: <https://serpapi.com/google-flights-api>
- SerpApi, vendedores (booking options): <https://serpapi.com/google-flights-booking-options>
- SerpApi, precios: <https://serpapi.com/pricing>
- SearchApi.io, Google Flights: <https://www.searchapi.io/google-flights-api>
- Cierre de Amadeus Self-Service: <https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers>
- Duffel, LATAM: <https://duffel.com/blog/latam-joins-duffel> · Avianca: <https://duffel.com/flights/airlines/avianca>
- Aerolíneas de Colombia en Google Flights: <https://www.google.com/travel/flights/flights-to-bogota.html>
- Prueba de `robots.txt` de las aerolíneas: hecha desde este computador el 2026-10-02 (sección 2).
