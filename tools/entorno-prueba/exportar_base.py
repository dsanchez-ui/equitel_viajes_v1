"""Convierte la exportación de la hoja (.xlsx) a JSON para el entorno de prueba local.

Uso (lo llama servidor.cjs; no hace falta correrlo a mano):
    python3 -E -P exportar_base.py "Sistema Tiquetes Equitel V2.xlsx" salida.json

Fechas -> {"$d": "AAAA-MM-DDTHH:MM:SS"} (hora de Bogotá, como en la hoja)
Horas  -> {"$t": "HH:MM:SS"}
La salida trae datos personales: servidor.cjs la escribe en una carpeta temporal y la
borra apenas la carga. Nunca guardarla en el repositorio.
"""
import datetime
import json
import sys

import openpyxl

src, dst = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
out = {}
for ws in wb.worksheets:
    rows = []
    for r in ws.iter_rows(values_only=True):
        row = []
        for v in r:
            if isinstance(v, datetime.datetime):
                row.append({"$d": v.isoformat()})
            elif isinstance(v, datetime.date):
                row.append({"$d": datetime.datetime(v.year, v.month, v.day).isoformat()})
            elif isinstance(v, datetime.time):
                row.append({"$t": v.isoformat()})
            else:
                row.append(v)
        rows.append(row)
    # Sin filas ni columnas vacías al final (como getLastRow / getLastColumn de Sheets).
    while rows and all(c in (None, '') for c in rows[-1]):
        rows.pop()
    width = max((max((i + 1 for i, c in enumerate(r) if c not in (None, '')), default=0) for r in rows), default=0)
    rows = [r[:width] + [None] * (width - len(r[:width])) for r in rows]
    out[ws.title] = {"state": ws.sheet_state, "rows": rows}
with open(dst, 'w', encoding='utf-8') as fh:
    json.dump(out, fh, ensure_ascii=False, default=str)
