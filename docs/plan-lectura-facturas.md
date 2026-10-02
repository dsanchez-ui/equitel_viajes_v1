# Plan — Lectura automática de facturas de tiquetes (V5)

> **Estado (2026-10-02): solo plan, por decisión de David.** Compromiso con Diego (reunión
> del 30-sep) para finales de octubre. Origen y citas en
> [plan-reuniones-2026-09-24-al-10-01.md](plan-reuniones-2026-09-24-al-10-01.md), V5.

---

## 1. Qué se quiere

Leer los PDF de las facturas que ya se guardan en la carpeta de Drive de cada solicitud y
llenar sus valores en la hoja: número, fecha, valor, IVA y total de cada factura. Hoy
Laura los escribe a mano, una por una (Diego: *"Laura tiene 150 facturas por cerrar"*).

Encaja con lo que ya está construido. Cuando las facturas quedan escritas y suman lo
cotizado, la solicitud pasa a la bandeja "Listas para cerrar" (#A83) y Laura la cierra.

## 2. ¿Apps Script puede hacerlo?

**Sí.** Puede llamar a la API de Gemini (`UrlFetchApp`), enviarle el PDF que lee de Drive
y recibir los valores en un formato fijo. No hace falta hacerlo desde la página web ni
pedirle nada distinto a Alejandro.

Lo único que falta es un **permiso**. El proyecto de producción no tiene autorizado salir
a internet (`script.external_request`), y por eso se retiró el botón de IA en agosto
(#A62). Dárselo exige que el dueño vuelva a autorizar el proyecto. Mientras no lo haga,
dejan de correr los disparadores: recordatorios y copia diaria.

### ¿Archivo aparte en el mismo proyecto, o proyecto aparte?

- **Un archivo `.gs` aparte dentro del mismo proyecto no aísla nada.** Los permisos son de
  todo el proyecto: agregar la llamada a Gemini en cualquier archivo obliga a re-autorizar
  el de producción.
- **Un proyecto de Apps Script completamente aparte (recomendado).** Lo crea David con su
  cuenta. Puede escribir directo en la hoja de la base de datos
  (`SpreadsheetApp.openById(...)`) y leer las carpetas de Drive, porque su cuenta tiene
  acceso. Tiene sus propios permisos y disparadores, y se apaga sin tocar la plataforma.

  Cumple la condición de David: escribe en la hoja de este proyecto. Es la misma
  arquitectura que propone la fase 2 del [comparador de precios](plan-comparador-precios.md),
  así que pueden vivir en el mismo proyecto aparte.

## 3. Cómo funcionaría

1. **Cada noche** (o con un botón de su menú), el proyecto aparte busca solicitudes
   `RESERVADO` o `PROCESADO` con facturas en su carpeta (`SOPORTES (JSON)`, archivos que no
   son de reserva) cuyos valores de factura estén vacíos.
2. Para cada PDF nuevo pide a Gemini un JSON con forma fija:
   - número y fecha de la factura
   - proveedor y NIT
   - si es tiquete, hotel u otro
   - valor, IVA y total
3. **Valida** antes de escribir:
   - total = valor + IVA
   - montos en pesos reales (mismas reglas de #A79)
   - la fecha no es futura
   - la factura no está ya registrada (número repetido)

   Si algo no cuadra, no escribe y lo deja en la lista para revisar.
4. **Escribe solo celdas vacías** del siguiente espacio de factura libre (1 a 6). Usa las
   columnas amarillas, que son las que se llenan a mano. Nunca sobrescribe lo que escribió
   Laura.
5. Deja constancia en una pestaña nueva, *Lectura de facturas*: archivo, solicitud,
   valores leídos, qué se escribió y qué quedó para revisar.

**Por qué de noche:** el proyecto aparte no comparte el bloqueo del de producción. Las
celdas de factura solo las escribe Laura a mano, así que el único choque posible es con
ella; de noche no ocurre.

**Soluciona lo que vio Diego en su prueba:** que una factura que llega meses después se
escriba en la fila equivocada. Cada PDF se lee desde la carpeta de **su** solicitud, así
que la fila es siempre la correcta.

## 4. Pasos

| Paso | Qué | Cómo se valida |
|---|---|---|
| P0 | Prueba con 30 facturas ya registradas a mano | Comparar lo que lee Gemini con lo que escribió Laura. La base tiene más de 300 facturas escritas: la respuesta correcta ya existe. |
| P1 | Disparador nocturno en modo **solo sugerencias**: llena *Lectura de facturas*, no la hoja principal | Laura revisa una o dos semanas |
| P2 | Escribe en la hoja principal (solo celdas vacías) | Con la tasa de acierto de P1 |

## 5. Costos y cuidados

- **Costo:** una llamada a Gemini por factura nueva, unas 15 a 30 diarias. Con los modelos
  *Flash* es muy bajo. Confirmar con la tarifa vigente de Google antes de P1.
- **Datos:** las facturas tienen datos de la empresa y nombres de viajeros. Usar la API
  de pago (los datos no se usan para entrenar) y confirmarlo con Yurani o TI.
- **Clave de la API:** en las propiedades del proyecto aparte, nunca en el código.
- **Junto con el módulo de legalizaciones:** su plan pide el mismo lector de facturas
  ([plan-legalizaciones-gastos.md](plan-legalizaciones-gastos.md)). Conviene construir un
  solo lector para los dos.

## 6. Decisiones pendientes

1. **David:** crear el proyecto aparte con su cuenta (o la de Yurani, si ella debe ser la
   dueña).
2. **David y Diego:** ¿se escribe directo en la hoja (P2) o se queda en sugerencias?
3. **Yurani o TI:** visto bueno para enviar las facturas a la API de Gemini.
