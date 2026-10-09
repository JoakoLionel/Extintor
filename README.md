# ExtintorScan

Prototipo educativo de lectura asistida de etiquetas de extintores, desarrollado siguiendo el **modelo incremental**.

## Cómo ejecutarlo
1. Descomprimí el ZIP.
2. Abrí `index.html` en un navegador moderno.
3. Para usar la cámara, otorgá permiso al navegador. La cámara suele requerir HTTPS o `localhost`; si no funciona al abrir el archivo directamente, ejecutá un servidor local (por ejemplo, `python -m http.server 8000`) y abrí `http://localhost:8000`.
4. Para el OCR se carga Tesseract.js desde CDN, así que la primera carga requiere conexión a Internet.

## Funciones
- Captura de imagen desde archivo o cámara.
- OCR en español e inglés.
- Extracción heurística de campos conocidos.
- Edición manual de la ficha.
- Guardado local en el navegador, exportación JSON e impresión.
- Tabla de registros locales.

## Limitaciones importantes
- Es un prototipo: detecta palabras clave y extrae campos mediante patrones de texto; no es un modelo de visión entrenado para localizar automáticamente el objeto extintor dentro de cualquier escena.
- El OCR puede equivocarse con números, fechas, reflejos o etiquetas dañadas. Confirmá los datos manualmente.
- No determina si un extintor es seguro, está cargado, vigente o habilitado; no reemplaza una inspección técnica ni los registros oficiales.
- Los registros quedan en el almacenamiento local del navegador y pueden perderse si se borra ese almacenamiento.

## Modelo de desarrollo seleccionado: Incremental
1. Captura de imagen.
2. Lectura OCR.
3. Interpretación de los datos.
4. Registro y exportación.

Cada módulo puede probarse y mejorarse sin rehacer todo el software.
