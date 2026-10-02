# Plan de trabajo — reuniones del 24-sep al 1-oct-2026

> **Estado (2026-10-02): en curso.** David aprobó el orden y respondió las decisiones el
> 2-oct (sección 5). V1, V3 y V4 están implementados, pendientes de despliegue. Reúne lo pedido, lo
> comprometido y lo decidido en tres reuniones, más el pedido de Alejandro Gómez sobre
> el comparador de precios (conversación con David, sin transcripción).
>
> **Fuentes:** notas y transcripciones de Gemini de cada reunión. Las citas son
> textuales de la transcripción automática, que tiene errores de reconocimiento; entre
> corchetes van aclaraciones. Ejemplo: "la TAM" es LATAM.
>
> **No se copiaron** los números de tarjeta ni de teléfono que se dictaron al final de la
> reunión del 24-sep.

| Fecha | Reunión | Asistentes | Tema principal |
|---|---|---|---|
| 2026-09-24 | Doge Supply Chain | Alejandro Gómez de Greiff, Yurani Prieto, Juan Camilo Pineda, Juan Esteban Ardila, David Sánchez | Automatización de compras, FPS, comercio exterior |
| 2026-09-30 | Revisión EquiHub #5 | Diego Caballero, Yurani Prieto, David Sánchez (Laura se une al final) | Portal de cotizaciones; al final, facturas de tiquetes |
| 2026-10-01 | Revisión Proceso Tiquetes Aviatur | Laura Molina, David Sánchez | Cómo cotiza y compra Laura; diferencias de precio con Aviatur |

---

## 1. Resumen: qué hay que hacer

### Plataforma de viajes (este proyecto)

Orden propuesto: primero lo comprometido y pequeño, luego lo que alimenta el estudio de
Alejandro, y al final lo más grande.

| # | Qué | Pedido por | Compromiso / meta | Estado (2-oct) |
|---|---|---|---|---|
| V1 | Mostrar el detalle de la solicitud en **Confirmar costos** | Laura (1-oct) | David: "Te lo quedo debiendo" | **Implementado (#A81)**, pendiente de push |
| V2 | Comparador de precios y estudio de 2–3 semanas de sobrecosto | Alejandro (1–2 oct) | Plan y prueba para que David la ejecute | **Plan y prueba listos** ([plan](plan-comparador-precios.md)) |
| V3 | Registrar con qué aerolínea y canal se compró (Aviatur o directo) | Se desprende de V2 y del 1-oct | Fase 1 del plan del comparador | **Implementado (#A82)**, pendiente de despliegue |
| V4 | **Cierre automático** de solicitudes cuando las facturas suman lo cotizado, con alerta si falta algo | Laura (1-oct); "va de la mano" con lo hablado con Diego | Decisión **acordada**; David: "sí se puede" | **Implementado (#A83)**, pendiente de despliegue y menú 12 |
| V5 | **Leer las facturas PDF** del Drive y llenar costos y facturas en la hoja | Diego (30-sep) | David: "sobre el final del mes … del otro mes" (dicho el 30-sep: finales de octubre) | **Solo plan** (decisión del 2-oct): [plan-lectura-facturas.md](plan-lectura-facturas.md) |
| V6 | Menos correos de recordatorio para el área de viajes | Laura (1-oct) | Resuelto con un filtro de Gmail en la reunión | Paliativo hecho; mejora por decidir |
| V7 | "Tipo de compra" (TIPO 1/2/3): nadie lo encuentra en el manual | Diego y Laura (30-sep) | Diego pregunta a Yurani | Esperando respuesta |
| V8 | Evitar sobrecostos por tarifas básicas (cambios y maletas) | Laura (1-oct) | David: es tema de cultura; Yurani ya decidió un caso | Idea opcional |

### Otros proyectos (compromisos de David)

Detalle en la sección 4: portal de cotizaciones (EquiHub), FPS, comercio exterior,
Banco de la República, integración con Labroides/Siesa y reunión con Julio.

---

## 2. Plataforma de viajes — detalle

### V1. Detalle de la solicitud al confirmar costos

**Qué pasa hoy.** Laura abre la misma solicitud en otra pestaña para ver el detalle
mientras confirma costos:

> **Laura:** "lo que hago aquí, abro la la página, la pongo acá y acá digo, eh, confirmar
> costos. Entonces, digamos acá abro para confirmar la misma solicitud de acá. … yo
> mientras acá voy viendo qué necesito, acá le voy subiendo los costos, digamos, y así voy
> trabajando y luego voy cerrando." (1-oct, 00:08:04)

> **David:** "Ahora que me lo mencionas, eso sí me quedó faltando, que mostrara el detalle
> cuando uno va a confirmar los costos. Te lo te lo quedo debiendo." (1-oct, 00:08:41)

Las notas de Gemini lo registran como: *"Mostrar el desglose completo al confirmar los
costos dentro de la plataforma."*

**Cambio propuesto.** Hoy el modal *Confirmar costos* muestra solo el número de solicitud
y el texto de la selección del viajero. Habría que agregar un resumen que se lea sin
salir del modal:
- pasajeros
- ruta y fechas, con las horas pedidas
- hospedaje y observaciones
- las imágenes de las opciones, con la elegida resaltada

Antes de abrir el modal hay que cargar la solicitud completa con `getRequestById`, porque
las filas del panel no traen las opciones (#A60).

**Tamaño:** pequeño. Solo frontend.

### V2. Comparador de precios y estudio de sobrecosto

**Pedido (Alejandro, 1–2 oct, resumido por David):**
- un robot que busque los precios de cada solicitud en las aerolíneas y los compare con
  lo que cotiza Aviatur
- que Laura vea la comparación y registre con qué aerolínea y canal compra
- un estudio de 2 a 3 semanas para saber cuánto se gasta de más
- sin IA

**Lo que se dijo el 1-oct confirma el problema y la utilidad:**

> **Laura:** "A veces pues se supone que los precios no deben variar más de 50 70,000, pero
> a veces sí hay desfaces de precio. Eh, ahí es donde me dice Yura, pues hay que hablar con
> Aviaturporque [Aviatur porque] pues no puede ser muy diferente, pero pues a veces pasa."
> (00:02:23)

> **Laura:** "según Yurani me decía, "No, esos son como 30 40,000 pesos, pero pues digamos
> que son como 70 más o menos."" (00:03:13)

> **Laura:** "El viajero me dice que en la TAM [LATAM] lo encontró a 270 y usted me lo está
> vendiendo a 388." Él [Rubiel, asesor de Aviatur] dice, "Sí, lo que pasa es que la
> plataforma cobra un dinero adicional por la administración, por eso es entonces no
> muchas gracias." Entonces termino comprándolo por la TAM" (00:31:01) … "son 117,000 pesos
> de diferencia." (00:31:45)

> **David:** "sí te serviría … que la plataforma … pudiera buscar los costos directamente
> en la TAM o en Avianca y te arrojara como, mira, en estas aerolíneas el costo está en tal
> y tal de una vez sin que tú tengas que entrar a buscar."
> **Laura:** "Ah, oye, eso le ayudaría. Claro, porque ya sí decido si por aviatur" (00:31:45)

En la reunión del 24-sep ya se había planteado el fondo:

> **Juan Camilo:** "vale la pena que revisemos lo de lo que en un momento dijimos de de
> Aviatur Yura para comprar los internos y que se haya una economía, no sé, comprando los
> tiquetes directo, los hoteles o todavía no."
> **Yurani:** "Pues pues yo le daría tiempo a eso mientras desarrollamos esto." (00:52:46)

**Cifras dichas en la reunión del 1-oct:**
- Bogotá–Cartagena, LATAM basic: $442.000 directo contra $472.000 en Aviatur, $30.000 de
  diferencia.
- Otro vuelo: $270.000 contra $388.000, $117.000 a $118.000 de diferencia.
- Margen aceptable según Yurani: $30.000 a $40.000. Según Laura, en la práctica hasta
  $50.000 o $70.000.

**Estado:** el plan está en [plan-comparador-precios.md](plan-comparador-precios.md).
Recomienda usar Google Flights vía SerpApi en lugar de un robot propio, porque las
aerolíneas bloquean los robots. La prueba está en
[tools/comparador-precios/](../tools/comparador-precios/README.md).

**Siguiente paso:** David crea la cuenta gratis y la ejecuta.

### V3. Registrar aerolínea y canal de compra

Hoy no queda registrado si un tiquete se compró en Aviatur o directo en la aerolínea:

> **Laura:** "cuando vemos que un un precio es demasiado … alto y que el definitivamente
> aviatur no nos ajusta, … entonces compramos directamente acá" (00:27:19)

Las compras directas además dejan solicitudes sin factura:

> **Laura:** "mira que hay varios aquí en tu sistema de etiquetas [tiquetes] que falta
> factura porque son comprados directamente por Avianca o algo porque … no y me preocupa
> porque pues se tienen que cerrar y no sé cómo hace eso." (00:14:08–00:15:04)

**Cambio propuesto** (fase 1 del plan del comparador). En *Confirmar costos*, Laura
registra:
- aerolínea
- canal: Aviatur, página de la aerolínea u otra agencia. Va en la columna `PROVEEDOR`,
  que está vacía en las 614 solicitudes.
- si el tiquete incluye maleta de bodega (sí/no). El 10-sep se descartó una lista fija de
  categorías de tarifa.

Así V4 sabe qué factura esperar y el estudio puede comparar por canal.

**Pendiente de proceso, no de código:** que las facturas de las compras directas lleguen
al correo de proveedores.

### V4. Cierre automático cuando las facturas suman lo cotizado

> **Laura:** "no sé si por costo cuando ya tiene aquí las facturas y acá tiene los costos,
> se pueda el sistema sumar esa parte de la factura total y … decir, "No, pues esta
> solicitud ya tiene los costos a prox de lo que se supone que dice … de lo que se había
> cotizado." Entonces, … cerrémosla de una vez automáticamente." (00:37:42–00:38:37)

> **David:** "Y que cuando esté incompleto te dé una alerta como e a esto le falta un le
> falta que no ha llegado al … costo." (00:38:37)

> **Laura:** "entonces directamente le voy a dar aquí cerrado para yo no tener que volver,
> que a veces se me pasa y tendría que volver a mirar el historial." (00:39:14)

> **David:** "Sí se puede hacer y va de la mano con lo que hablamos ayer con Diego."
> (00:39:14)

Gemini lo marca como **decisión acordada**: *"implementar una funcionalidad en el sistema
para cerrar automáticamente las solicitudes cuando el total de las facturas coincida con
los costos cotizados."*

**Lo que ya existe:**
- El sistema suma las facturas 1 a 3 en el dashboard de costos.
- La variación cotizado contra facturado (#A78) ya compara las dos cifras.
- El reporte del 29-sep mostró que lo facturado suele quedar un 2,6 % por encima de lo
  confirmado.

**Lo que decidió David (2-oct):** si lo facturado es **igual o mayor** que lo cotizado, se
cierra (facturar de más es normal y no debe dar error). Si es menor, aparece una alerta
para cargar las facturas, y Laura puede **omitir el aviso**.

**Implementado en #A83:**
- se cierra solo con el viaje terminado, porque una solicitud PROCESADO ya no se puede
  modificar
- menos de $1.000 de diferencia cuenta como redondeo
- la alerta aparece desde el día 7 después del viaje
- se suman las facturas 1 a 6
- exige un PDF subido por cada factura escrita, porque con PROCESADO ya no se pueden subir
  soportes desde la app (aprobado por David el 2-oct)
- un disparador cada hora (menú 12)

Con la base del 29-sep se cerrarían 15 solicitudes y quedarían 85 por revisar: 54 por
facturas faltantes y 31 solo por PDF faltantes.

### V5. Leer las facturas PDF y llenar la hoja

> **Diego:** "Imagínese, ayer estaba en pleno cierre y Laura tiene 150 facturas por cerrar
> o procesos por cerrar." (30-sep, 00:34:13)

> **Diego:** "nosotros le colocamos una factura en PDF al Yemin [Gemini], le dijimos, "Venga,
> calcule el costo total, coloque el costo del IVA y súmele otros costos y colóquele y
> después lo hizo tal cual." Hicimos el ejercicio con cinco facturas y todas las cargó
> bien." (00:35:12)

> **Diego:** "¿Hay posibilidades de de meterle el último empujón a esa vaina? Es que es
> diligenciar. Imagínese, usted se queda ciego mirando cada registro" (00:34:13)

> **David:** "el sistema puede directamente ir a la carpeta, sacar las las facturas, decir,
> "Ah, bueno, en este en esta solicitud hay cuatro facturas." Entonces, las lee todas, saca
> los precios y los pone ahí en las en las columnas y ya." (00:38:32)

> **David:** "yo creo que sobre el final del mes ya le podría del otro mes le podría decir
> que ya queda como garantizado." (00:38:32) … "Yo creo que la otra semana de pronto le
> puedo votar corriente." (00:45:19)

**Problemas que salieron en la prueba de Diego:**
- **Facturas que llegan meses después:**
  > **Diego:** "la solicitud viejita por allá de Wendy de julio, digamos, y hoy llegó una
  > factura de un hotel de Ecuador. … Que me va y me la llena donde está Wendy en julio"
  > (00:42:45)

  La solución natural es leer cada factura **desde la carpeta de su solicitud** en Drive.
  El sistema ya guarda los soportes por solicitud, así que no hay que adivinar a cuál
  pertenece.
- **Hoja protegida:**
  > **Diego:** "solo diligencie ciertas casillas y le colocamos las que están habilitadas,
  > que es lo que está en amarillo." **David:** "lo que está en amarillo. Sí, señor."
  > (00:45:19)
- **¿Es obligatorio?** Diego: "que más que que ser un requisito para el cierre, esto es más
  informativo". David: "habría que hablarlo con Yurani a ver exactamente si es si es una
  obligación." (00:36:53)

**Implica volver a usar IA en el backend.** En agosto se retiró (#A62) y el proyecto de
Apps Script no tiene permiso de salida a internet. Hay dos caminos:
- **Dar el permiso:** re-autorizar de inmediato para no dejar sin autorización los
  recordatorios ni la copia diaria.
- **Proyecto de Apps Script aparte**, como el que propone el plan del comparador. Aísla el
  riesgo del de producción.

Es la misma lectura de facturas que pide el
[plan de legalizaciones](plan-legalizaciones-gastos.md); conviene diseñarlas juntas.

**Tamaño:** grande.

### V6. Correos de recordatorio

> **Laura:** "Laura tiene que trabajar Laura. La Entonces me llega tengo 310 correos"
> (00:11:46)
> **David:** "eso es eso me lo pidieron porque Wendy a veces se le olvidaba trabajar."

En la reunión se creó un filtro de Gmail que archiva los correos con "recordatorio
administrativo".

**Mejora posible**, a decidir con Yurani: un solo correo consolidado por ronda, en lugar
de uno por solicitud. Así el recordatorio sirve sin saturar.

### V7. "Tipo de compra" (TIPO 1/2/3)

> **Diego:** "mira que estuve leyéndome y el manual y eso de tipo de compra no lo encontré.
> … Si es tipo uno, tipo dos, tipo tres" (30-sep, 00:39:24)
> **David:** "es un documento todo antiguo que me pasó Yurani" … "habría que entonces
> preguntarle a Yuranien [Yurani en] qué documento está" (00:40:38)

En la base, la columna `TIPO DE COMPRA DE TKT` está vacía en 313 de las 614 solicitudes.

**Pendiente de Diego:** confirmar con Yurani el procedimiento vigente. Con eso se
documenta en la guía o se deja de pedir.

### V8. Tarifas básicas: cambios y maletas que salen caros (idea opcional)

> **Laura:** "Este tickete valió como 250,000, … pero con los cambios, un cambio le vale 300,
> 400, 500,000 pesos." (00:18:26)
> **Laura** (sobre una maleta agregada después de comprar): "tocó añadirle y pues son
> 100,000" … "si tú me pones en la observación que es esa maleta, yo no, pues yo compro lo
> que tú me pones." (00:19:10–00:20:04)
> **David:** "eso es más de eso es más de cultura, Laura, porque sea la solución que uno les
> dé, pues igual si se va a generar un costo extra, … si no tienen la cultura de de
> planificar bien los viajes" (00:20:58)

Yurani ya resolvió un caso: "cómprale una categoría que podamos hacer algo en el momento
en que él necesite un cambio" (00:27:19).

**Idea (no pedida):** preguntar en el formulario qué equipaje lleva el viajero (solo
mochila, maleta de mano, maleta de bodega). Así la tarifa se compra bien desde el
principio.

### Otras observaciones del 1-oct

- **Subir opciones es lento.** Laura trabaja en varias pestañas mientras carga ("mientras
  espero esto me muero"). David: "tiene que ir y guardarlas una por una en Drive y
  renombrarlas".
- **Aviatur no siempre muestra todas las tarifas:** "a mí me aparecía de full en adelante"
  mientras en la aerolínea había basic.
- **Lo que Laura valora de Aviatur:**
  - historial de compras y reportes por viajero
  - cruce de facturas: "Y para el cruce de facturas es importante" (00:33:28)
  - gestión de cambios con su asesor: "ese es el plus que tiene esto, el tema de los
    cambios" (00:25:35)

  Si se cambia la forma de comprar, la plataforma tendría que cubrir esto. Los reportes ya
  los cubre el dashboard de costos. Los cambios y el cruce de facturas no.

---

## 3. Lineamientos de Alejandro para los desarrollos (24-sep)

> **Alejandro:** "David y pensemos en agents first, o sea, no hagamos aplicaciones o algo
> así, sino más bien agentes y que la básicamente la interface sea un chat y que el humano
> … cuando tenga que tomar la decisión para lo que tenga que tomar que intervenga ahí en el
> chat" (00:52:46)

> **Alejandro:** "Entonces como que por Telegram ahí le escribe el man y usted le tiene que
> responder y eso es como si fuera el … analista." (00:54:19)

**Telegram quedó como el canal acordado.**

> **Alejandro:** "ustedes ustedes me dicen qué necesitamos y cuánto vale y ahí tomamos la
> decisión." (00:33:32)

Para la plataforma de viajes, el comparador encaja en esta línea: automatiza y deja el
juicio a Laura. Pero Alejandro pidió que no use IA (por costo), así que no es un agente.

---

## 4. Compromisos en otros proyectos

Sin verificar el estado: solo se registra lo dicho.

### 24-sep — Doge Supply Chain

| Compromiso | Responsable | Cita / contexto |
|---|---|---|
| Google Sheets para automatizar la revisión de facturas de proveedores (FPS), como medida temporal | David | "lo que yo proponía hacer les toma por ahí una semana" (00:02:12). Alejandro: hablarlo con Julio por si hay algo definitivo |
| Reunión con Julio y Angi: subir la facturación directa | El grupo; Yurani pregunta por la reunión del 24-sep | Yurani: "de las 2000 casi 3,000 facturas que nos llegan, eh, directo solo se hace el 30% el 20%." (00:07:40) |
| Reunión con Julio para integrar lo hecho con Siesa y Labroides ("el end to end") | David | "Sí, yo lo cuadro para la otra semana." (00:51:21) |
| Automatizar el reporte mensual al Banco de la República con reglas | David | Alejandro: "es un agentico que haga la vaina y literal eso … debería salir en un minuto." (00:19:32) |
| Mapear comercio exterior: liquidaciones de importación (gastos por DO, prorrateo por valor) y seguimiento de plantas y motores | David, con Sonia; invitar a Yurani | Meta de Alejandro: "que a finales de año haya una persona encargada … de todo ese proceso de seguimiento de de Cómics." Yurani: "Está muy agresivo" (00:32:47) |
| Recordatorios automáticos a proveedores que no responden en 24 h (portal de cotizaciones) | David | Alejandro: "si a las 24 horas no me aceptó y no me mandó la cotización … pongamos ahí un bot" (00:42:37) |
| Compras indirectas: agente con políticas para las directoras de sede | David (por definir) | Yurani: "a mí parece que las compras indirectas quitan mucho tiempo" (00:45:35) |
| Copiar a Yurani en todas las pruebas de compras y comercio exterior | David y Juan Esteban | Yurani: "Todos todos esos desarrollos de compras, de come, eh, mándame mí también las pruebas." (00:56:11) |
| Priorizar con Juan Ardila lo de la reunión | David | Juan Camilo: "¿y cómo usted se organiza ya después, David, con Juan Ardila de todo lo que priorizamos hoy, ¿cierto?" (00:52:07) |
| Instalar el programa para que las facturas lleguen a contabilidad | David | (01:00:35) |
| Tránsito de comercio exterior al 99 %, salida "la otra semana" | David | Dicho el 24-sep: semana del 28-sep |

### 30-sep — Revisión EquiHub #5

| Compromiso | Responsable | Cita / contexto |
|---|---|---|
| Producto: solo la ventana de ítems. Servicio: campo abierto con botón "agregar servicio" y varias líneas | David | Diego: "en el momento en que tú selecciones arriba producto, … solo le aparece la ventana de los ítems." (00:02:34) |
| Enviar cada solicitud al comprador de compra directa o indirecta (columna que pasó Diego) | David | Diego: "yo coloqué cuál es la unidad y cada persona se haría compra directa o indirecta." (00:10:42) |
| Acuerdos marco: ver los proveedores en bloques, para que al abrir uno no se oculten los demás | David | "si yo abro Donaldson se me desaparece el resto. Vale, vale, lo voy a revisar." (00:23:11) |
| Afinar el buscador de proveedores con IA (contexto: bomba de carro o de acueducto) | David | (00:31:07) |
| Pruebas funcionales con el equipo de marketing | David | "para pruebas, Diego, ya se podría empezar a hacer desde la semana que viene" (00:17:27). Dicho el 30-sep: semana del 5-oct |
| Hablar con Julio de la hora de los reportes del PBO (que estén a las 7 a. m.) | David | "yo igual tengo reunión … el lunes con con él y con Yurani" (00:20:38). Dicho el 30-sep: lunes 5-oct |
| Reunirse con Santiago para el módulo de legalizaciones urgentes de Cris (72 h) | David | "voy a reunirme con él y ver cómo va a desarrollar él" (00:24:34) |
| Enviar catálogo de servicios, códigos, PBO actualizado y una orden de compra de ejemplo | Diego | (00:03:01, 00:14:06, 00:26:03, 00:28:23) |
| Confirmar con Yurani el procedimiento de tipos de solicitud | Diego | Ver V7 |
| API Cris–Keyhop: el lado de David está listo; faltan los proveedores (Diego) y el módulo de Santiago | Diego, Santiago | "de mi lado ya está hecho la mitad del puente" (00:04:52) |

---

## 5. Decisiones de David (2-oct)

1. **Orden:** aprobado. V1, V3 y V4 hechos; V2 lo prueba David antes de integrarlo; V5
   queda como plan.
2. **V4:** facturado igual o mayor que lo cotizado → se cierra. Menor → alerta, con la
   opción de omitir el aviso. Mencionó primero un 10 % y luego precisó que lo menor debe
   avisar; se aplicó esa precisión, más $1.000 de tolerancia por redondeo.
3. **V5:** proyecto de Apps Script **completamente aparte**, que escriba directo en la
   hoja. Detalle en [plan-lectura-facturas.md](plan-lectura-facturas.md).
4. **V6:** sin respuesta todavía (¿un solo correo de recordatorio por ronda?).
