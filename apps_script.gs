/*
  CONFIGURACIÓN (una sola vez):
  1. Abrí script.google.com > Nuevo proyecto y pegá este código.
  2. Engranaje "Configuración del proyecto" > Propiedades de la secuencia de comandos > Agregar:
       CLAVE    = una clave larga que solo vos conozcas
       SHEET_ID = el ID de tu hoja (está en la URL entre /d/ y /edit)
  3. Implementar > Nueva implementación > Tipo: Aplicación web
       Ejecutar como: Yo
       Quién tiene acceso: Cualquier usuario
  4. Copiá la URL que termina en /exec y pegala en la página, junto con la misma CLAVE.
*/

const HOJA = "Extintores";

const COLUMNAS = [
  "fecha_guardada", "id", "tarjeta", "fabricante", "recargadora", "agente",
  "capacidad", "clases", "certificacion", "ubicacion", "fabricacion",
  "proximo_mantenimiento", "vida_util", "prueba_hidraulica",
  "metodo", "codigo_crudo"
];

function doPost(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const claveGuardada = props.getProperty("CLAVE");
    const sheetId = props.getProperty("SHEET_ID");

    if (!claveGuardada || !sheetId) {
      return respuesta({ ok: false, error: "Falta configurar CLAVE o SHEET_ID" });
    }

    const datos = JSON.parse(e.postData.contents);
    if (datos.token !== claveGuardada) {
      return respuesta({ ok: false, error: "No autorizado" });
    }

    const reg = datos.registro || {};
    if (!reg.id) {
      return respuesta({ ok: false, error: "Falta el ID del extintor" });
    }

    const ss = SpreadsheetApp.openById(sheetId);
    let hoja = ss.getSheetByName(HOJA);
    if (!hoja) {
      hoja = ss.insertSheet(HOJA);
    }
    if (hoja.getLastRow() === 0) {
      hoja.appendRow(COLUMNAS);
      hoja.setFrozenRows(1);
    }

    hoja.appendRow(COLUMNAS.map((c) => seguro(reg[c] ?? "")));
    return respuesta({ ok: true });

  } catch (err) {
    return respuesta({ ok: false, error: "Error del servidor" });
  }
}

// Evita que un valor se interprete como fórmula dentro de la hoja
function seguro(valor) {
  const s = String(valor);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function respuesta(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
