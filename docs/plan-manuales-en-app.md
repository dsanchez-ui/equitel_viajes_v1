# Plan — Manuales dentro de la app

> **Estado (2026-10-14): solo plan, por decisión de David.** Hoy David envía los PDF de
> `docs/` uno por uno. La idea es que cada persona encuentre su manual en el portal, siempre
> en la versión vigente, sin que nadie se lo mande.

---

## 1. Qué hay hoy

| Material | Para quién | Dónde está | Notas |
|---|---|---|---|
| Guía del usuario | Solicitantes | `docs/guia-usuario.md` → HTML y PDF | Al día (14-oct, incluye #A100). Sin imágenes. |
| Guía del administrador | Mezcla: área de compras **y** mantenimiento técnico | `docs/guia-administrador.md` → HTML y PDF | §4–8 son operación (Laura); §2 y §9–14 son técnicos (Script Properties, activadores, funciones del editor, respaldo). |
| Guía de la hoja de cálculo | Área de compras | `docs/guia-hoja-calculo.md` → HTML y PDF | Menú *Equitel Viajes*, qué tocar y qué no. |
| Infografía de aprobadores | Aprobadores | `infografia-aprobadores.html` / `.pdf` | Formato de correo (tablas). |
| Infografía de tarifas | Área de compras y viajeros | `infografia-tarifas.html` / `.pdf` | Una hoja, TIPO 1 a 3 (#A95). |
| `docs/manual-com-p-02.md` | David y Yurani | Repo | Interno: cómo aplica la plataforma el manual, con referencias #Axx. **No se publica.** |

Las guías se generan con `npm run build:guia` (markdown → HTML con estilos → PDF con
Chrome). Los títulos ya tienen anclas (`#24-fechas-y-horario`), así que se puede enlazar
a una sección.

## 2. Lo que decide el diseño

- **Un solo archivo JavaScript (#A96).** No se pueden cargar las guías bajo demanda con
  `import()` ni `React.lazy`. Si se metieran en el JavaScript, todos descargarían unos
  130 KB más en cada visita, y cualquiera podría leer la guía del área de compras desde el
  navegador. **Las guías van como archivos aparte, no dentro de la app.**
- **Archivos con nombre fijo en `public/`.** Lo que se pone en `public/manuales/` se publica
  con el mismo nombre en cada push. Un enlace a `/manuales/guia-usuario.html` no se rompe
  al publicar otra versión. Eso pasaba con los archivos con huella del #A96, y aquí no
  pasa. Los sirve el mismo `serve` de siempre.
- **Se abren en otra pestaña, no dentro de la app.** `public/serve.json` prohíbe que una
  página se muestre dentro de otra (`X-Frame-Options: DENY` y `frame-ancestors 'none'`), y
  está bien que siga así. El HTML de las guías no tiene scripts y sus estilos van en la
  página, así que cumple la política de seguridad (CSP) actual sin cambiarla.
- **Todo lo que está en `public/` lo puede abrir cualquiera que tenga el enlace.** Mostrar
  cada guía solo al rol que le corresponde es una comodidad, no un control de acceso. Por
  eso la parte técnica de la guía del administrador no se publica (§3.3).
- **Las fases 1 a 3 no tocan el backend:** solo un push, sin pegar `Code.gs`. La fase 4 sí.

## 3. Propuesta

### 3.1 Botón «Manuales»

- Un botón **«❓ Manuales»** en el encabezado (`components/Layout.tsx`), junto a refrescar y
  salir, para todos los que entran.
- En la pantalla de ingreso, un enlace: **«¿Primera vez? Lee la guía del usuario»**. Su
  sección 1 explica justamente cómo ingresar y pedir el PIN.
- El botón abre un panel pequeño con los manuales del rol:

  | Rol | Ve en el panel |
  |---|---|
  | Solicitante | Guía del usuario · Tarifa del tiquete (infografía) |
  | Aprobador | Lo anterior + Guía del aprobador (infografía) |
  | Analista y superadmin | Lo anterior + Guía del área de compras · Guía de la hoja de cálculo |

  Cada manual tiene **«Abrir»** (HTML en otra pestaña: se lee bien en el celular, con su
  índice y se puede buscar) y **«PDF»**. Al lado, la fecha en que se actualizó.

### 3.2 Archivos y verificación

- Carpeta `public/manuales/` con nombres fijos, por ejemplo:
  - `guia-usuario.html` y `.pdf`
  - `area-de-viajes.html` y `.pdf`
  - `hoja-calculo.html` y `.pdf`
  - `tarifas.pdf`
  - `aprobadores.pdf`
- `npm run build:guia` los escribe ahí además de en `docs/`. Cada HTML lleva:
  - una línea visible *«Actualizada el …»*;
  - un comentario con la huella (hash) del `.md` del que salió.
- Nueva verificación `tools/check-manuales.cjs`, dentro de `npm run verify`:
  - cada HTML de `public/manuales/` corresponde al `.md` actual, para no publicar una guía
    vieja por olvidar `build:guia`;
  - en la carpeta solo están los archivos de la lista permitida, para no publicar por error
    la guía técnica ni `manual-com-p-02`;
  - ningún HTML tiene `<script>`, porque la CSP lo bloquearía;
  - las anclas que usa la ayuda en contexto (§3.4) existen;
  - los manuales llegan a `dist/manuales/` después del build.
- Peso: los PDF pesan de 0,4 a 0,6 MB cada uno y solo se descargan al tocarlos. El
  JavaScript de la app no cambia de tamaño.

### 3.3 Separar la guía del administrador

Hoy mezcla dos públicos. Propuesta:

- **Guía del área de compras (se publica):** §1 (vista general y roles), §4 (estados), §5
  (trabajo del día a día, incluida la aprobación del CFO), §6.1 y §6.3 (usuarios y
  validaciones), §7 (panel móvil, sin la URL), §8 (métricas) y la parte de §12 que le pasa
  a un usuario (no llega el PIN, no llega el correo, banner rojo).
- **Guía técnica (solo en el repo):** §2 (arquitectura), §6.2 (reorganizar base), §9
  (activadores), §10 (Script Properties, remitente, autenticación, límites), §11 (funciones
  del editor), el resto de §12, §13 (respaldo) y §14 (despliegue).

Es trabajo de redacción, sin código. Conviene que Laura lea la versión publicada antes
de publicarla.

**Pantallazos (opcional).** Ninguna guía tiene imágenes. Se pueden sacar con el backend
simulado (`Code.gs` en `vm` con datos ficticios, como el recorrido para Yurani del 14-oct),
sin tocar producción ni mostrar datos reales. Los más útiles:

- el formulario con la ventana de política;
- describir la selección por escrito;
- *Confirmar costos* y *Registrar reserva*.

### 3.4 Ayuda en contexto (fase 3)

Enlaces cortos **«¿Cómo funciona?»** donde la gente se traba. Cada uno abre la guía en
su sección:

| Dónde | Abre |
|---|---|
| Formulario: aviso de anticipación y justificación | Guía del usuario §2.4 y §9.5 |
| Formulario: maleta de bodega | Guía del usuario §2.4, «Maleta de bodega» |
| Detalle: describir la selección | Guía del usuario §4 (la etapa más importante) |
| *Confirmar costos* y *Registrar reserva*: tarifa del manual | Guía del área de compras §5.2–5.3 e infografía de tarifas |
| Panel del analista: facturas por revisar, en espera de preaprobación | Guía del área de compras §5.5 y §5.15 |

Si se cambia el título de una sección, el ancla cambia. La verificación de §3.2 falla
antes de publicar un enlace roto.

### 3.5 Enlaces fuera de la app (fase 4: toca `Code.gs`)

- Correo del PIN: enlace a la guía del usuario.
- Correo de aprobación: enlace a la guía del aprobador (casi nunca entran al portal).
- Dashboard de costos y panel móvil: enlace a su sección de la guía del área de compras.

Los enlaces se arman con `PLATFORM_URL + '/manuales/…'` (Cloud Run). La regla de #A53, que
pide poner el dominio en el enlace, es para las páginas del web app de Apps Script, no
para estas. Hay que pegar `Code.gs` y `CostsDashboard.html` y crear una versión nueva.

### 3.6 Novedades (opcional)

Cada guía abre con una sección **«Novedades»**. La del usuario ya tiene la de octubre. El
botón «Manuales» muestra un punto cuando hay algo nuevo desde la última vez que se abrió.
Eso se recuerda solo en el navegador de cada persona (`localStorage`): si se pierde, no
pasa nada. La ventana con «Entendido» y constancia (#A100) queda solo para reglas en las
que hace falta probar que la persona las leyó.

## 4. Pasos

| Fase | Qué | Toca | Despliegue | Tamaño |
|---|---|---|---|---|
| 1 | Botón y panel, `public/manuales/` (guía del usuario, hoja de cálculo, infografías) y `check-manuales` | `Layout.tsx`, `App.tsx` (pantalla de ingreso), `scripts/build-guia.cjs`, `tools/` | Push | Pequeño |
| 2 | Guía del área de compras separada de la técnica (+ pantallazos, si se quiere) | `docs/` | Push | Mediano (redacción y revisión de Laura) |
| 3 | Ayuda en contexto | Formulario, detalle, modales del analista | Push | Pequeño |
| 4 | Enlaces en correos, dashboard y panel móvil | `Code.gs`, `CostsDashboard.html`, `AdminMobile.html` | Pegar y crear versión nueva | Pequeño |

Mientras no exista la guía del área de compras (fase 2), el panel de los administradores
puede enlazar la guía del administrador completa. No tiene secretos (nombres de
propiedades, no sus valores), pero es mejor no dejarla publicada mucho tiempo.

## 5. Qué no hacer

- Meter las guías en el JavaScript de la app o cargarlas con `import()` / `React.lazy` (#A96).
- Mostrarlas dentro de la app con un `iframe`: la política de seguridad lo prohíbe, y
  debe seguir así.
- Publicar la guía técnica o `manual-com-p-02.md`.
- Subir los PDF a Drive para enlazarlos: se desactualizan y tienen permisos aparte.

## 6. Cómo se mantiene

Regla para `CLAUDE.md`: **un cambio que altera lo que una persona ve actualiza su guía en
el mismo commit y corre `npm run build:guia`.** La verificación de §3.2 garantiza que lo
publicado coincide con el `.md`. No puede saber si el `.md` quedó al día: eso se revisa al
escribir la entrada de `BUG_REPORT.md`.

## 7. Decisiones para David

1. ¿Se separa la guía del administrador en *área de compras* y *técnica*? (Recomendado.)
2. ¿Quién lee la guía del área de compras antes de publicarla: Laura, Yurani o las dos?
3. ¿La fase 4 (correos) va con la fase 1 o después?
4. ¿Pantallazos en la guía del usuario?
