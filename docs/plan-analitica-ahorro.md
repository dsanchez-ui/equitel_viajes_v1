# Plan — Análisis de ahorro en tiquetes (dashboard de costos)

> **Documento vivo.** Es el rumbo del trabajo: se actualiza con cada avance, idea o pedido
> nuevo (ver §9 *Pendientes* y §11 *Bitácora*). Si se retoma desde otra máquina o en otra
> sesión, se empieza leyendo §9.
>
> **Origen:** Juan Camilo Pineda vio el comparador de precios (#A84–#A88) el 8-oct.
> Pidió analíticas de volumen de viajes y una proyección de cuánto se habría ahorrado si
> se compra lo que recomienda el comparador.
>
> **Meta inmediata:** tenerlo listo para la reunión del 8-oct a las 2 p. m. (todo hoy, no
> por fases de varios días).
>
> **Pilar n.º 1, pedido de David:** la velocidad del dashboard. Si no es rápido, nadie lo
> usa.

## 1. La pregunta que responde

**Si el área de viajes comprara lo que recomienda el comparador, ¿cuánto se habría
ahorrado en un mes cualquiera?**

Hacen falta tres piezas, y la sección las muestra en este orden:

1. **Volumen:** cuántos viajes hay al mes y de qué tipo. Sin esto, un ahorro por viaje no
   se puede convertir en plata por mes.
2. **Ahorro observado:** cuánto se ahorra en los viajes ya comparados, y **por qué** (canal
   o vuelo).
3. **Proyección:** juntar las dos con un método visible que se puede cambiar en pantalla,
   siempre con un rango y no con una sola cifra.

## 2. Principios, en orden de prioridad

1. **Rápido.** Metas medibles en §3. Toda visual nueva tiene que cumplirlas; si no las
   cumple, no se publica.
2. **Correcto y al día.** Las mismas reglas que ya usa la plataforma (#A80 para contar
   compras, #A87 para lo facturado). La caché nunca muestra datos de hace más de 10 minutos
   sin decirlo, y siempre se puede forzar *Actualizar*.
3. **Claro.** Lenguaje simple, como el comparador (#A85): frases que responden la pregunta,
   un *"¿Cómo se lee?"*, diferencias en palabras.
4. **Privado.** Ningún nombre, cédula ni correo de viajeros o solicitantes llega al
   navegador. Solo totales, ids de solicitud, empresa y unidad.
5. **No toca la operación.** Solo lectura sobre la base. Lo ven las mismas tres personas de
   la variación (`COSTS_VARIANCE_ALLOWED`); Laura y los líderes no.

## 3. Velocidad (el pilar)

### 3.1 Diagnóstico de hoy (8-oct)

David mide entre 30 y 40 segundos para ver el comparador. Hay tres causas, en el código:

1. **Llamadas en cadena.** El dashboard pide primero los datos generales (`getData`) y
   **solo cuando llegan** pide la variación y el comparador. Los tiempos se suman.
2. **Todo se recalcula en cada carga.** `getData`:
   - lee la hoja completa (unas 630 filas por 110 columnas);
   - calcula un MD5 por solicitud para su caché;
   - **lee y reescribe un archivo de caché en Drive**, de cientos de KB, con candado.

   El cálculo que esa caché evita (sumar unas celdas de factura) es más barato que el MD5 y
   el viaje a Drive: la caché en Drive no ahorra tiempo, lo agrega.
3. **Arranque en frío** de cada ejecución de Apps Script (1 a 3 s cada una). Con llamadas
   en cadena se paga varias veces seguidas.

### 3.2 Metas

| Situación | Meta |
|---|---|
| Abrir el dashboard con datos en caché | cada sección en **menos de 2 s** |
| Primera carga después de un cambio (sin caché) | cada sección en **menos de 8 s**, todas a la vez |
| Mover un control (método, periodo, filtro) | **instantáneo** (< 100 ms, sin ir al servidor) |
| Abrir el detalle de un viaje | menos de 3 s la primera vez; instantáneo la segunda |

Cada respuesta trae cuánto tardó el servidor y si salió de la caché. El dashboard lo
muestra al pie, para medir en vez de suponer.

### 3.3 Cómo se logra

1. **Todo en paralelo.** El dashboard pide al mismo tiempo los datos generales, la
   variación y el comparador con el análisis. Cada sección aparece apenas llega su parte.
   - Para quien no tiene permiso, el servidor responde *"restringido"* de inmediato y la
     sección no aparece.
2. **Caché de respuestas en `CacheService`** (la memoria rápida de Apps Script):
   - Se guarda la respuesta ya calculada de cada sección. Leerla toma milisegundos.
   - **Llave:** sección + año + alcance del usuario (todas las unidades, o las unidades de
     ese líder) + una *versión de datos*. Un líder nunca recibe la respuesta de otro.
   - **Se invalida sola:**
     - cuando cualquier acción de la app escribe en la base (crear, aprobar, confirmar
       costos, registrar reserva…), porque `dispatch` cambia la versión de datos;
     - para el comparador, también cuando el rastreo escribe búsquedas nuevas (cambia el
       número de filas de su pestaña);
     - como red de seguridad, cada entrada vence a los **10 minutos**. Esto cubre lo que se
       edita a mano en la hoja.
   - **Botón *Actualizar ahora*** junto a *"datos de hace X min"*: recalcula sin caché.
   - Las respuestas grandes se parten en trozos de menos de 100 KB, el límite por valor de
     `CacheService`.
   - **Si la caché falla o se vacía, se calcula como hoy:** nunca se muestra un error por
     culpa de la caché.
3. **Por qué `CacheService` y no otra cosa:**

   | Opción | Leer | Escribir | Problema |
   |---|---|---|---|
   | **`CacheService`** | milisegundos | milisegundos | se puede vaciar sola; por eso es solo caché y siempre se puede recalcular |
   | JSON en Drive (la carpeta de las solicitudes) | 0,5 a 1,5 s | 1 a 3 s, con candado | más lento que recalcular; es lo que hoy frena `getData` |
   | Hoja nueva en la base | 0,5 a 1 s | 1 a 2 s | igual de lento, y crece la base |
   | Script Properties | rápido | rápido | **descartada (David):** el límite es pequeño y, si se excede, la consola del proyecto se bloquea |

   El JSON en Drive solo valdría como una segunda capa para el "arranque en frío" si algún
   día `CacheService` se vaciara seguido. Hoy no hace falta; queda anotado en §9.
4. **Respuestas livianas:**
   - Los viajes del periodo viajan como una tabla compacta (listas, no objetos con
     nombres largos).
   - Empresa y unidad van como índices de un diccionario.
   - La lista de vuelos de cada búsqueda **no** viaja en la carga inicial: se pide al abrir
     el detalle de un viaje, y esa respuesta también se guarda en caché.
5. **Los cálculos interactivos van en el navegador.** El servidor manda una vez los datos
   del periodo. Filtros, método, ajuste, adopción y periodo se recalculan en el navegador,
   sin volver al servidor.
6. **Una sola lectura de la hoja por llamada.** El análisis sale de la misma lectura que ya
   hace el comparador: no se agrega una segunda pasada.

**Regla para todo lo que se agregue después:** sale de un payload que ya está en caché (o
de uno nuevo que también se guarde en caché), lee la hoja una sola vez, no encadena
llamadas y se mide.

## 4. Datos que se usan, y por qué

Todo existe hoy en la base; no hace falta ninguna columna nueva.

| Dato (columna) | Para qué | Por qué importa |
|---|---|---|
| `STATUS` | Contar solo lo comprado (`RESERVADO`, `PROCESADO`), y aparte lo anulado y denegado | Proyectar sobre solicitudes que no se compraron inflaría el ahorro |
| `FECHA DE COMPRA DE TIQUETE` (si falta, `FECHA SOLICITUD`) | El mes de cada viaje | Es la regla de #A80; el ahorro ocurre cuando se compra |
| `MODO_SOLICITUD` | Separar viajes en avión de solo hospedaje | Solo hospedaje no tiene tiquetes que ahorrar |
| `FECHA VUELTA` | Solo ida o ida y vuelta | Un ida y vuelta son dos tiquetes: el doble de ahorro posible |
| `# PERSONAS QUE VIAJAN` | Pasajeros por viaje | El ahorro escala con los pasajeros; Google da el precio del grupo |
| Pasajeros × tramos | Tiquetes por viaje | La unidad justa para comparar viajes de distinto tamaño |
| `COSTO_FINAL_TIQUETES` | Lo cotizado en tiquetes | La base del % de ahorro y del gasto del mes |
| `COSTO_FINAL_HOTEL` | Si el viaje llevó hotel | Lo facturado incluye el hotel: con hotel no se compara con Google (#A87) |
| `ES INTERNACIONAL` | Nacional o internacional | Los precios internacionales son muy distintos; se proyectan aparte |
| `TIPO DE SOLICITUD`, `ES_CAMBIO_CON_COSTO` | Viajes con cambios | Un cambio puede encarecer el tiquete; si son muchos, el ahorro real es otro |
| `OBSERVACIONES` (nota `[MULTIDESTINO]`) | Viajes por tramos de un itinerario | Cada tramo es una solicitud; conviene saber cuántas lo son |
| Fechas de compra e ida | Anticipación (días entre compra y vuelo) | Comprar tarde sale más caro (#A80); explica parte del ahorro |
| `AEROLINEA`, `AEROLINEA REGRESO`, `CANAL DE COMPRA` | Con quién y por dónde se compró (desde el 2-oct) | Separa el ahorro de canal del de cambiar de vuelo |
| Facturas (`TOTAL FACTURA` y siguientes) | Lo que de verdad se pagó | El único ahorro con plata real |
| `EMPRESA`, `UNIDAD DE NEGOCIO` | Filtros del dashboard | Para ver el ahorro de una empresa o unidad |
| Pestaña `COMPARATIVO PRECIOS` | La muestra: cotizado contra Google por viaje | Es la evidencia del ahorro |

**No se envían al navegador:** nombres, cédulas, correos, observaciones ni la nota de
multidestino (solo la marca de que lo es).

## 5. La sección: «📈 Proyección de ahorro»

Va en el dashboard de costos, debajo del comparador, con el mismo permiso. Arriba, en una
sola fila, van los controles, que responden al instante:

| Control | Opciones | Por defecto | Por qué |
|---|---|---|---|
| Periodo | meses desde abril de 2026 | abril al último mes cerrado | La plataforma arrancó en abril; antes no hay datos comparables |
| Empresa / unidad | los filtros de arriba del dashboard | todas | Ver el ahorro por empresa o unidad |
| Método | mínimo · percentil 25 · mediana · promedio · valor fijo por tiquete · por viaje · % fijo | mediana por tiquete | La mediana no se deja arrastrar por un viaje raro; por tiquete permite aplicarlo a viajes de cualquier tamaño |
| Qué ahorro cuenta | todo (canal + vuelo) · solo canal | todo | *Solo canal* es el escenario que no le cambia nada al viajero |
| Ajuste por equipaje | pesos por tiquete que se restan | $0 | Google muestra la tarifa sin maleta; así se puede descontar |
| Adopción | % de viajes que seguirían la recomendación | 100 % | No todos los viajes podrán comprarse al precio de Google |
| Internacionales | incluir o no | no incluir | Son el 8 %, con otra lógica de precios |

### A. Volumen de viajes

Responde *cuántos viajes hay y de qué tipo*.

- **Indicadores** (promedio mensual del periodo, con el total debajo): viajes en avión,
  tiquetes, gasto en tiquetes y costo por tiquete. Son los números contra los que se mide
  el ahorro.
- **Columnas por mes** divididas en *solo ida* e *ida y vuelta*. Muestra la tendencia y el
  peso de cada tipo, que define cuántos tiquetes hay detrás de cada viaje. Son dos series,
  con leyenda y el detalle al pasar el mouse.
- **Tabla por mes**, con el promedio y el total al final. Son demasiadas categorías para un
  gráfico de colores; en tabla se leen todas:
  - solicitudes, compradas, anuladas y denegadas: el embudo;
  - solo ida, ida y vuelta y multidestino;
  - 1, 2 y 3 o más pasajeros;
  - con hotel, solo hospedaje e internacional;
  - con cambios, y cuántos con costo;
  - anticipación de la compra: 0–3, 4–7, 8–14 y 15 o más días;
  - canal de compra (desde el 2-oct).

### B. Ahorro observado (la muestra)

Responde *cuánto y por qué* en los viajes comparados.

- **Indicadores:**
  - viajes comparados, con aviso si son menos de 15;
  - ahorro mediano por viaje, por tiquete y como % del cotizado;
  - cuántos viajes tenían algo más barato en Google.
- **Tabla por viaje** con la diferencia partida en dos, bajo *«¿De dónde sale la diferencia?»*
  (#A92; internamente *canal* y *vuelo*):
  - **Comprando la misma aerolínea** = cotizado − la misma aerolínea en Google;
  - **Cambiando de vuelo o aerolínea** = la misma aerolínea − el más barato.

  Muestra si el ahorro está en *por dónde se compra* o en *qué vuelo se compra*.
- **Por tipo de viaje**, cuando hay al menos 5 viajes en el grupo: solo ida e ida y vuelta,
  aerolínea registrada, anticipación. Muestra si el ahorro depende de algo.

### C. Proyección

Responde *cuánto se habría ahorrado* en cada mes.

- **Frase arriba.** Por ejemplo: *"Con el ahorro típico por tiquete, en septiembre se habrían
  ahorrado unos $29 M (38 % de lo gastado en tiquetes). En un mes promedio, entre $6,3 M
  (solo con la misma aerolínea) y $21,7 M (todo el ahorro)."*
- **Columnas por mes:** el ahorro proyectado con el método elegido, una sola serie en pesos.
  El rango aparece al pasar el dedo sobre la columna.
- **Tabla por mes:**
  - viajes, tiquetes y gasto;
  - ahorro proyectado y % de lo gastado;
  - rango, de *solo con la misma aerolínea* a *todo el ahorro*.

  Al final van el total del periodo y el equivalente a un año.

### D. Contraste con lo facturado

- **Por mes:** cotizado frente a facturado, en viajes sin hotel. Muestra si lo cotizado se
  parece a lo que se pagó.
- **Por viaje comparado y ya facturado:** facturado frente a Google. Es la única cifra de
  ahorro con plata real; se llena a medida que se suben facturas.

### E. Exportar

CSV con el volumen por mes, la muestra con su partición y la proyección con los parámetros
usados. Así la cifra de una reunión se puede rehacer.

## 6. Cómo se calcula la proyección

Para cada viaje en avión comprado del mes (nacional, salvo que se marquen internacionales):

1. **Ahorro del viaje según el método:**
   - *por tiquete:* el valor por tiquete del método × los tiquetes del viaje;
   - *% del cotizado:* el % del método × el costo cotizado del viaje;
   - *por viaje:* el valor fijo.

   Mínimo, percentil 25, mediana y promedio se calculan sobre la muestra. Si hay al menos
   5 viajes comparados del mismo tipo (solo ida o ida y vuelta), se usa el valor de ese
   grupo; si no, el de todos.
2. **Ahorro a contar:** con *solo con la misma aerolínea* se usa esa parte de la muestra.
3. **Ajuste por equipaje:** se resta el valor por tiquete × los tiquetes del viaje.
4. **Tope:** el ahorro de un viaje no supera su costo cotizado × el % más alto observado,
   para que un valor fijo no "ahorre" más de lo que costó un tiquete barato.
5. **Adopción:** se multiplica por el % de adopción.
6. **El mes** = la suma de sus viajes. El año = el promedio de los meses del periodo × 12.

**El rango que siempre se ve** (antes *prudente* y *probable*; nombres cambiados en #A92):
- *Solo con la misma aerolínea:* esa parte de la muestra, con la mediana por tiquete.
- *Todo el ahorro:* la diferencia completa, con la mediana por tiquete.

Lo que se elija en *Cómo calcular* se muestra además de ese rango.

## 7. Cómo leer la proyección (va en un *"¿Cómo se lee?"* en pantalla)

- **La muestra es pequeña.** El 8-oct hay 3 viajes. Al terminar el estudio (21-oct)
  deberían ser unos 30. La sección muestra el tamaño de la muestra y avisa por debajo
  de 15.
- **Google muestra la tarifa más económica,** normalmente sin maleta ni cambios. Lo
  cotizado puede incluirlos, además del cargo de la agencia. Para eso está el ajuste por
  equipaje.
- **El ahorro por cambiar de vuelo** solo existe si el viajero acepta otra aerolínea u
  horario. *Solo con la misma aerolínea* no le cambia nada.
- **Los meses pasados se proyectan con el patrón de octubre.** Los precios cambian por
  temporada y anticipación: es una estimación, no lo que pasó.
- **La búsqueda se hace minutos después de aprobarse la solicitud,** no en el instante de
  la compra.

## 8. Lo que dicen los datos hoy (base del 8-oct)

### Volumen: viajes en avión comprados, abril a septiembre de 2026

| Mes | Viajes | Tiquetes | Gasto en tiquetes | Por tiquete | Ida y vuelta | 1 pasajero | Con hotel | Internacional |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| abr | 64 | 119 | $44,2 M | $371.000 | 75 % | 94 % | 50 % | 2 % |
| may | 60 | 111 | $46,5 M | $419.000 | 68 % | 95 % | 42 % | 2 % |
| jun | 52 | 109 | $62,2 M | $571.000 | 75 % | 88 % | 52 % | 12 % |
| jul | 89 | 155 | $88,6 M | $579.000 | 65 % | 97 % | 25 % | 18 % |
| ago | 52 | 101 | $42,9 M | $425.000 | 79 % | 96 % | 56 % | 2 % |
| sep | 92 | 157 | $75,6 M | $482.000 | 70 % | 99 % | 48 % | 7 % |
| **Promedio** | **68** | **125** | **$60,0 M** | **$480.000** | **71 %** | **95 %** | **44 %** | **8 %** |

Además:
- **Cambios:** unos 5 viajes comprados al mes son una modificación de una solicitud
  anterior (32 entre abril y septiembre). Solo 6 modificaciones de toda la base fueron
  con costo.
- **Solo hospedaje:** unas 8 al mes (22 en julio).
- **Anuladas:** entre 9 y 36 al mes.
- **Canal de compra** (desde el 2-oct): 6 registradas, todas por Aviatur.

### Ahorro observado: comparador, 8-oct (por tramos y solo vuelos directos, #A86–#A88)

| Viaje | Valor cotizado | Precio más barato en Google | Diferencia | Por tiquete | % de ahorro | Misma aerolínea | Otro vuelo o aerolínea |
|---|---:|---:|---:|---:|---:|---:|---:|
| SOL-000627 Barranquilla → Bogotá | $701.818 | $198.486 | $503.332 | $251.666 | 72 % | $112.658 | $390.674 |
| SOL-000629 Medellín → Bogotá | $819.228 | $419.080 | $400.148 | $200.074 | 49 % | **−$106.302** | $506.450 |
| SOL-000631 Pereira → Bogotá | $611.569 | $457.380 | $154.189 | $77.094 | 25 % | $154.189 | $0 |

**Lectura.** La mayor parte del ahorro viene de **escoger otro vuelo u otra aerolínea**, no
de comprar el mismo vuelo más barato. En SOL-000629, Avianca en Google salía más cara que en
Aviatur.

### Proyección de ejemplo con esos 3 viajes

| Método | Septiembre ($75,6 M) | Mes promedio ($60,0 M) |
|---|---:|---:|
| Solo con la misma aerolínea, mediana por viaje | $10,4 M (14 %) | $7,7 M (13 %) |
| Mínimo por tiquete ($77.094) | $12,1 M (16 %) | $9,7 M (16 %) |
| Mínimo por viaje ($154.189, los *"150 mil por solicitud"*) | $14,2 M (19 %) | $10,5 M (18 %) |
| Mediana por tiquete ($200.074) | $31,4 M (42 %) | $25,1 M (42 %) |
| Mediana como % del cotizado (49 %) | $36,9 M (49 %) | $29,3 M (49 %) |

## 9. Pendientes y prioridades

**Hoy, 8-oct, para la reunión de las 2 p. m.**, en este orden:

- [x] **P0 Velocidad (#A89):** llamadas en paralelo; caché de respuestas en `CacheService`
  con versión de datos, vencimiento de 10 min y *⟳ Actualizar datos*; tiempos al pie. Aplica
  a datos generales, variación, comparador y detalle de un viaje.
- [x] **P1 Datos del análisis (#A90)** en el mismo payload del comparador, compactos y en
  caché (52 KB con la base real).
- [x] **P1 Sección A (volumen)** y **C (proyección)** con sus controles.
- [x] **P2 Sección B (ahorro observado)** con la partición canal/vuelo.
- [x] **P2 Sección D (facturado)** y **E (CSV)**.
- [x] **Prueba automática:** `tools/check-savings-analysis.cjs` (36 comprobaciones), dentro de
  `npm run verify`.
- [x] **Documentación:** `BUG_REPORT.md` (#A89, #A90) y `CLAUDE.md`.
- [x] **Lenguaje simple en todo el dashboard (#A92):** nada de *canal*, *vuelo*, *prudente*,
  *probable*, *embudo* ni nombres de columnas de la hoja en pantalla. Sin recuadros de texto
  nuevos.
- [ ] **David:** pegar `Code.gs` y `CostsDashboard.html` y crear la versión nueva del web app
  antes de la reunión. Luego mirar al pie del dashboard los tiempos reales.

**Siguiente, con lo que se vea en la reunión o con más muestra:**
- Decidir el método por defecto. Con la base real, *por tiquete* da % altos en meses de
  tiquetes baratos (abril: 50 % del gasto) y *% del cotizado* da lo mismo todos los meses.
  Mostrar los dos en la reunión.
- Valor por tipo de viaje con la muestra completa (al menos 5 viajes por grupo).

**Después:**
- Gráfico de puntos de la muestra (un punto por viaje) cuando haya más de 10 viajes.
- Ahorro por ruta y por anticipación, cuando la muestra lo permita.
- Segunda capa de caché en Drive para el arranque en frío, solo si `CacheService` se vacía
  seguido.
- Revisar si la caché por fila en Drive de `getData` (§3.1) se puede retirar, ya con la
  caché de respuestas funcionando y medida.
- Pendientes de decisión con Laura: valor pagado en *Registrar reserva*; marcar si se siguió
  la recomendación; si la cotización incluye maleta.

## 10. Decisiones

| # | Tema | Estado |
|---|---|---|
| 1 | Método por defecto | Propuesto y aplicado: ahorro típico (mediana) por tiquete, con el rango a la vista |
| 2 | Ahorro por cambiar de aerolínea | Propuesto y aplicado: se cuenta, siempre separado del de la misma aerolínea |
| 3 | Ajuste por equipaje | Control en pantalla, $0 por defecto; falta la cifra de David |
| 4 | Periodo base | Desde abril de 2026 |
| 5 | Filtros de empresa y unidad | Sí, en volumen y proyección |
| 6 | Internacionales | Aparte, sin incluir por defecto |
| 7 | "Viaje con cambios" | La compra es una modificación (`TIPO DE SOLICITUD = MODIFICACION`), contando aparte las con costo |
| 8 | Dónde guardar lo precalculado | `CacheService`, sin Script Properties (David, 8-oct) |
| 10 | Toda estimación es verificable | Cada sección con cifras derivadas tiene un *¿Cómo se calcula?* breve (cómo y por qué); la proyección muestra la cuenta de cada mes en pesos y el CSV la trae (David, 8-oct, #A93) |
| 9 | Cómo se nombran las cifras | En palabras de la pregunta que responden (*Precio más barato en Google*, *% de ahorro sobre lo cotizado*, *¿De dónde sale la diferencia?*), nunca con nombres internos ni de columnas; sin recuadros de texto (David, 8-oct, #A92) |

## 11. Bitácora

- **2026-10-08 (noche)** — David pide poder sustentar y repetir a mano cada estimación (#A93).
  - Cada sección tiene un *¿Cómo se calcula?* breve.
  - La proyección guarda cada paso de su cuenta: la tabla muestra solo lo que se proyecta (viajes nacionales con costo) y el CSV trae la cuenta.
  - Con la base del 8-oct: sep 2026 = 145 tiquetes × $200.074 = $29.010.730; el tope recorta $122.171 en 3 viajes → $28.888.559.

- **2026-10-08 (tarde)** — David no entendía *Canal* y *Vuelo* en *Ahorro observado* y pidió
  revisar todo el dashboard (#A92). Se renombraron las cifras en palabras, el rango
  reemplazó a *prudente/probable*, se quitó el recuadro de la variación y la nota al pie
  de la muestra, y el *¿Cómo se lee?* del comparador quedó cerrado y más corto. Las cuentas no
  cambiaron.
- **2026-10-08 (mañana)** — Implementados P0 (#A89) y P1/P2 (#A90). Con la base real:
  - 68,2 viajes al mes, $60,0 M y $479.921 por tiquete;
  - con la mediana por tiquete, septiembre da $28,9 M sin internacionales;
  - lo facturado sale 13 % por encima de lo cotizado.

  La caché se probó con datos reales en simulación: 70 ms calculando y 2 ms desde la caché.
  Los tiempos reales en Apps Script se ven al pie del dashboard.
- **2026-10-08** — Pedido de Juan Camilo. Plan inicial con las cifras de la base del día. David
  pide que la velocidad sea el pilar (hoy el comparador tarda de 30 a 40 s), guardar lo
  precalculado sin Script Properties, y tener todo listo para las 2 p. m. Diagnóstico de la
  lentitud en §3.1.
