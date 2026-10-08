# Manual COM-P-02 en la plataforma de viajes

> Manual *Solicitud de viajes y hospedaje y reembolso de gastos*, **COM-P-02 versión 07**
> (5-mar-2025). Este documento resume qué reglas aplica la plataforma, cuáles no y en qué
> difiere. Se revisó el 2026-10-08, con la reunión «Doge Supply Chain» de ese día (#A95).
> Si el manual cambia de versión, revisar esta tabla.

## Lo que aplica la plataforma

| Regla del manual | Cómo la aplica la plataforma |
|---|---|
| Ningún viaje sin autorización previa (presidencia, vicepresidencia financiera, gerente de unidad o líder designado) | Toda solicitud pasa por el aprobador de área, con un enlace firmado en el correo (#A5). |
| Nacionales con 8 días de anticipación; internacionales con 30 | Se marca como fuera de política (`policyViolation`) sin bloquear la solicitud. |
| Tiquetes nacionales de más de $1.200.000: aprobación del CEO y/o del gerente de cadena de suministro | Se pide además la aprobación del Director de Cadena de Suministro. |
| Si el viaje va a una Orden de Trabajo, debe quedar relacionada, con los centros de costos | OT opcional con formato `OT-<EE><CCC>-<NÚMERO>` (#A66); centro de costo y unidad de negocio en cada solicitud. |
| Aerolínea y horario: lo más conveniente en costo, ajustado en lo posible al horario pedido | El comparador busca el directo más barato a ±2 h de la hora pedida (#A84–#A88). Solo lo ven los administradores autorizados. |
| **Tarifa por noches del viaje** (tabla de la página 2) | Se recomienda en *Cargar opciones*, *Confirmar costos* y *Registrar reserva*. Otra tarifa exige una justificación, y todo queda en la hoja (#A95). Ver abajo. |
| Otras aerolíneas (JetSMART, etc.) si el integrante lo requiere | La compra admite cualquier aerolínea de la lista u «Otra…» (#A82). |
| Facturas a nombre de la empresa como soporte del viaje | Soportes después del viaje y avisos de facturas por revisar desde el día 7 (#A83). |

## La tarifa del tiquete (#A95)

| TIPO | Noches del viaje | LATAM | Avianca | Clic | Satena |
|---|---|---|---|---|---|
| 1 | 0 a 1 | Basic | Basic | VeLigera | Z0Basic |
| 2 | 2 a 5 | Light | Classic | VeEcono | Z0Econo |
| 3 | 6 o más | Full | Classic | VePreferencial | Z0Flexi |

**Equipaje:**
- **Basic:** solo un artículo pequeño (45 × 35 × 20 cm).
- **LATAM Light:** agrega maleta de mano de 10 kg.
- **LATAM Full y Avianca Classic:** maleta de mano de 10 kg y de bodega de 23 kg.
- **Clic:** maleta de mano de 5, 5 y 10 kg y de bodega de 10, 15 y 20 kg.
- **Satena:** maleta de mano de 5 kg en las tres.

**Cómo la interpreta la plataforma:**
- **Noches** = fecha de regreso − fecha de ida; sin regreso, las noches de hotel.
- **Los 6 noches** son TIPO 3. El manual dice «más de 6» y deja los 6 por fuera (Yurani: *«la tres es de 6 días»*).
- **Excepción** = una tarifa con otro nombre que la recomendada. En Avianca, TIPO 2 y 3 son la misma Classic: comprar una u otra no es excepción. Con aerolíneas fuera de la tabla (Wingo, JetSMART…) cuenta el número.
- **En la hoja:**
  - la tarifa comprada va en `TIPO DE COMPRA DE TKT`, la misma columna que se llenaba a mano;
  - la recomendada, en `TARIFA RECOMENDADA`, la calcula el servidor;
  - el nombre, en `TARIFA NOMBRE`;
  - el motivo de una excepción, en `TARIFA JUSTIFICACION`.

**Comparación con Google («peras con peras»):**
- TIPO 1 se compara con Google sin maleta.
- TIPO 2 y 3 se comparan con una maleta de mano por pasajero.

**Límites de Google Flights (pruebas del 8-oct):**
- No trae las tres tarifas por separado.
- No deja pedir maleta de bodega.
- En LATAM no cambia el precio al pedir maleta de mano.

Por eso, en LATAM TIPO 2 y en todo TIPO 3, el precio de Google puede quedar por debajo del real.

## Diferencias con la plataforma

| Manual | Plataforma hoy | Estado |
|---|---|---|
| Tiquetes internacionales: aprobación **del CEO** | Basta el CEO **o** el Director de Cadena de Suministro | Anotado para decidir; no se cambió |
| El COM-F-06 debe decir **si el viajero requiere equipaje de bodega** | El formulario no lo pregunta | Propuesta: preguntarlo al crear la solicitud. Sustentaría las excepciones de tarifa y la comparación con Google |

## Lo que la plataforma no cubre hoy

- **Topes de hotel por grupo (Tabla 1):** $304.100 (grupo I), $248.300 (grupo II) y $165.200 (grupo III) por noche, más IPC cada 1 de enero. La plataforma registra el hotel y su canal (#A94), pero no compara la tarifa contra el tope.
- **Hoteles por ciudad y Ayenda:** no se modelan. La plataforma guarda el hotel que se reservó (#A94).
- **Clase económica sin sillas, ascensos, salas VIP ni maletas adicionales:** no se modela. La tarifa solo ofrece TIPO 1 a 3.
- **Cambios y cancelaciones por emergencia** autorizados según el grupo del solicitante (I, II o III): la plataforma tiene solicitudes de cambio (#A63), pero no la tabla de grupos.
- **Anticipos, alimentación** ($52.600 al día; US$50 en el exterior), **transporte terrestre, Uber for Business y kilometraje:** fuera de la plataforma.
- **Legalización de viáticos en 5 días hábiles:** fuera de la plataforma. Está en el plan de legalizaciones ([plan-legalizaciones-gastos.md](plan-legalizaciones-gastos.md)).
