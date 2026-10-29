"use strict";

/* =========================================================
   Configuración
   ========================================================= */

const CLAVE_REGISTROS = "extintores.registros.v1";
const CLAVE_CONFIG = "extintores.config.v1";

// Orden de columnas: coincide con el orden pedido para la hoja de cálculo
const COLUMNAS = [
  "fecha_guardada", "id", "tarjeta", "fabricante", "recargadora", "agente",
  "capacidad", "clases", "certificacion", "ubicacion", "fabricacion",
  "proximo_mantenimiento", "vida_util", "prueba_hidraulica",
  "metodo", "codigo_crudo"
];

const CAMPOS_EDITABLES = [
  "id", "tarjeta", "fabricante", "recargadora", "agente", "capacidad",
  "clases", "certificacion", "ubicacion", "fabricacion",
  "proximo_mantenimiento", "vida_util", "prueba_hidraulica"
];

const ETIQUETAS = {
  fecha_guardada: "Fecha guardada",
  id: "ID",
  tarjeta: "Tarjeta/control",
  fabricante: "Fabricante",
  recargadora: "Recargadora",
  agente: "Agente",
  capacidad: "Capacidad",
  clases: "Clases",
  certificacion: "Certificación",
  ubicacion: "Ubicación",
  fabricacion: "Fabricación",
  proximo_mantenimiento: "Próximo mantenimiento",
  vida_util: "Vida útil",
  prueba_hidraulica: "Prueba hidráulica",
  metodo: "Método de lectura",
  codigo_crudo: "Código leído"
};

// Nombres (normalizados) que puede tener un dato dentro del QR, para reconocerlo
const ALIAS = {
  id: ["id", "idextintor", "extintor", "extintorn", "extintornro", "nroextintor", "numeroextintor", "codigo"],
  tarjeta: ["tarjeta", "tarjetacontrol", "control", "tarjetaagc", "nrotarjeta"],
  fabricante: ["fabricante"],
  recargadora: ["recargadora", "recargador", "empresarecargadora", "mantenedora"],
  agente: ["agente", "agenteextintor", "carga"],
  capacidad: ["capacidad"],
  clases: ["clases", "clasesdefuego", "fuegos"],
  certificacion: ["certificacion", "norma"],
  ubicacion: ["ubicacion", "direccion", "lugar"],
  fabricacion: ["fabricacion", "anofabricacion", "fechafabricacion"],
  proximo_mantenimiento: ["proximomantenimiento", "mantenimiento", "vencimientomantenimiento"],
  vida_util: ["vidautil", "vencimientovidautil"],
  prueba_hidraulica: ["pruebahidraulica", "ph", "vencimientoph"]
};

const ID_VALIDO = /^[0-9A-Za-z-]{1,20}$/;

/* =========================================================
   Elementos de la página
   ========================================================= */

const $ = (id) => document.getElementById(id);

const el = {
  btnStart: $("btnStart"),
  btnStop: $("btnStop"),
  fileInput: $("fileInput"),
  fileReader: $("fileReader"),
  status: $("status"),
  form: $("form"),
  formMsg: $("formMsg"),
  raw: $("raw"),
  metodo: null, // se crea abajo como campo oculto
  btnClear: $("btnClear"),
  count: $("count"),
  list: $("list"),
  btnExcel: $("btnExcel"),
  cfgUrl: $("cfgUrl"),
  cfgToken: $("cfgToken"),
  btnSaveCfg: $("btnSaveCfg"),
  btnSheets: $("btnSheets")
};

// Campo oculto con el método de lectura (QR, BARCODE_1D, FOTO o MANUAL)
el.metodo = document.createElement("input");
el.metodo.type = "hidden";
el.metodo.id = "metodo";
el.metodo.value = "MANUAL";
el.form.appendChild(el.metodo);

/* =========================================================
   Utilidades
   ========================================================= */

// Quita caracteres de control y recorta longitud
function limpiar(valor, max = 200) {
  return String(valor ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Normaliza claves: sin tildes, minúsculas y sin símbolos
function normalizar(texto) {
  return String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Evita que una celda de hoja de cálculo se interprete como fórmula
function seguroCelda(valor) {
  const s = String(valor ?? "");
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function fechaTexto(d) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fechaArchivo(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function mostrarEstado(texto, tipo = "") {
  el.status.textContent = texto;
  el.status.className = "status " + tipo;
}

function mostrarMensajeForm(texto, tipo = "") {
  el.formMsg.textContent = texto;
  el.formMsg.className = "status " + tipo;
}

/* =========================================================
   Almacenamiento local (funciona sin conexión)
   ========================================================= */

function cargarRegistros() {
  try {
    const datos = JSON.parse(localStorage.getItem(CLAVE_REGISTROS) || "[]");
    return Array.isArray(datos) ? datos : [];
  } catch {
    return [];
  }
}

function guardarRegistros(lista) {
  localStorage.setItem(CLAVE_REGISTROS, JSON.stringify(lista));
}

function cargarConfig() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_CONFIG) || "{}");
  } catch {
    return {};
  }
}

/* =========================================================
   Interpretación del código leído
   ========================================================= */

// Intenta extraer datos de un QR en formato JSON, URL o "campo: valor"
function parsearCodigo(texto) {
  const t = String(texto).trim();
  let pares = [];

  if (t.startsWith("{")) {
    try {
      pares = Object.entries(JSON.parse(t)).map(([k, v]) => [k, String(v)]);
    } catch { /* no es JSON válido */ }
  }

  if (!pares.length && /^https?:\/\//i.test(t)) {
    try {
      pares = [...new URL(t).searchParams.entries()];
    } catch { /* URL inválida */ }
  }

  if (!pares.length) {
    pares = t.split(/[\n;|]+/)
      .map((parte) => {
        const m = parte.match(/^\s*([^:=]{1,40}?)\s*[:=]\s*(.+?)\s*$/);
        return m ? [m[1], m[2]] : null;
      })
      .filter(Boolean);
  }

  const resultado = {};
  for (const [clave, valor] of pares) {
    const k = normalizar(clave);
    const v = limpiar(valor);
    if (!v) continue;
    for (const campo of Object.keys(ALIAS)) {
      if (!resultado[campo] && ALIAS[campo].includes(k)) {
        resultado[campo] = v;
      }
    }
  }
  return resultado;
}

// Vuelca los datos leídos en el formulario y registra el método usado
function procesarLectura(texto, metodo) {
  const original = String(texto ?? "");
  el.raw.value = limpiar(original, 500);

  let datos;
  if (metodo === "BARCODE_1D" && /^\d{3,10}$/.test(original.trim())) {
    datos = { id: original.trim() };
  } else {
    datos = parsearCodigo(original);
  }

  // Si no se reconoció ningún campo, busca un número de 4 a 6 dígitos como posible ID
  if (!datos.id) {
    const m = original.match(/\b\d{4,6}\b/);
    if (m) datos.id = m[0];
  }

  for (const campo of CAMPOS_EDITABLES) {
    if (datos[campo]) $("f-" + campo).value = datos[campo];
  }
  el.metodo.value = metodo;

  if (!Object.keys(datos).length) {
    mostrarEstado("Se leyó un código pero no tiene los campos esperados. Revisá el código leído y completá los datos a mano.", "warn");
  } else {
    mostrarEstado(`Lectura correcta (${metodo}). Revisá los datos y guardá el registro.`, "ok");
  }
}

/* =========================================================
   Escaneo con cámara y desde foto
   ========================================================= */

let escaner = null;

function formatosSoportados() {
  return [
    Html5QrcodeSupportedFormats.QR_CODE,
    Html5QrcodeSupportedFormats.CODE_128
  ];
}

// Recuadro de escaneo CUADRADO: un QR necesita un área cuadrada para entrar completo.
// Si fuera rectangular y bajo (como antes), el QR nunca calza y no se lee.
function calcularRecuadro(anchoVisor, altoVisor) {
  const lado = Math.floor(Math.min(anchoVisor, altoVisor) * 0.75);
  const minimo = 180;
  return { width: Math.max(lado, minimo), height: Math.max(lado, minimo) };
}

function textoError(err) {
  if (!err) return "error desconocido";
  if (typeof err === "string") return err;
  return err.message || err.name || JSON.stringify(err);
}

async function activarCamara() {
  if (typeof Html5Qrcode === "undefined") {
    return mostrarEstado("No se cargó la librería de escaneo. Revisá la conexión a internet y recargá la página.", "error");
  }
  if (!window.isSecureContext) {
    return mostrarEstado("La cámara requiere HTTPS. Si estás probando con un archivo local o http://, usá la dirección de GitHub Pages (https://...).", "error");
  }

  el.btnStart.disabled = true;
  mostrarEstado("Pidiendo permiso de cámara...");

  try {
    escaner = new Html5Qrcode("reader", {
      formatsToSupport: formatosSoportados(),
      verbose: false
    });

    const callbackExito = async (texto, resultado) => {
      await detenerCamara(true);
      const formato = resultado?.result?.format?.formatName || "";
      const metodo = formato === "CODE_128" ? "BARCODE_1D" : "QR";
      procesarLectura(texto, metodo);
    };
    const callbackSinLectura = () => { /* sin lectura en este cuadro: no mostrar nada */ };
    const config = { fps: 10, qrbox: calcularRecuadro, aspectRatio: 1 };

    try {
      // Primer intento: cámara trasera por nombre lógico (funciona en la mayoría de los celulares)
      await escaner.start({ facingMode: { ideal: "environment" } }, config, callbackExito, callbackSinLectura);
    } catch (err1) {
      // Segundo intento: listar las cámaras del dispositivo y elegir la trasera por nombre,
      // o la última de la lista (suele ser la trasera en Android)
      mostrarEstado(`El primer intento falló (${textoError(err1)}). Probando otra forma de acceder a la cámara...`, "warn");
      const camaras = await Html5Qrcode.getCameras();
      if (!camaras || !camaras.length) {
        throw new Error("no se detectó ninguna cámara en el dispositivo");
      }
      const trasera = camaras.find((c) => /back|tras|rear|environment/i.test(c.label)) || camaras[camaras.length - 1];
      await escaner.start({ deviceId: { exact: trasera.id } }, config, callbackExito, callbackSinLectura);
    }

    el.btnStop.disabled = false;
    mostrarEstado("Apuntá la cámara al QR o al código de barras, llenando el recuadro.");
  } catch (err) {
    escaner = null;
    el.btnStart.disabled = false;
    mostrarEstado(`No se pudo acceder a la cámara: ${textoError(err)}. Revisá que le hayas dado permiso de cámara a esta página, o usá 'Tomar foto de la etiqueta'.`, "error");
  }
}

async function detenerCamara(silencioso = false) {
  if (escaner) {
    try {
      await escaner.stop();
      escaner.clear();
    } catch { /* ya estaba detenida */ }
    escaner = null;
  }
  el.btnStart.disabled = false;
  el.btnStop.disabled = true;
  if (!silencioso) mostrarEstado("Cámara detenida.");
}

async function leerFoto(archivo) {
  if (typeof Html5Qrcode === "undefined") {
    return mostrarEstado("No se cargó la librería de escaneo.", "error");
  }
  await detenerCamara(true);
  try {
    const lector = new Html5Qrcode("fileReader", {
      formatsToSupport: formatosSoportados(),
      verbose: false
    });
    const texto = await lector.scanFile(archivo, false);
    procesarLectura(texto, "FOTO");
  } catch (err) {
    mostrarEstado(`No se encontró ningún código en la foto (${textoError(err)}). Probá sacarla más de cerca, con más luz y sin reflejos, o cargá los datos a mano.`, "warn");
  } finally {
    el.fileInput.value = "";
  }
}

/* =========================================================
   Formulario
   ========================================================= */

function leerFormulario() {
  const datos = {};
  for (const campo of CAMPOS_EDITABLES) {
    datos[campo] = limpiar($("f-" + campo).value);
  }
  return datos;
}

function limpiarFormulario() {
  for (const campo of CAMPOS_EDITABLES) $("f-" + campo).value = "";
  el.metodo.value = "MANUAL";
  el.raw.value = "";
  el.formMsg.textContent = "";
  el.formMsg.className = "status";
}

function guardarRegistro(evento) {
  evento.preventDefault();

  const datos = leerFormulario();
  if (!datos.id) {
    return mostrarMensajeForm("Falta el ID del extintor.", "error");
  }
  if (!ID_VALIDO.test(datos.id)) {
    return mostrarMensajeForm("El ID solo puede tener letras, números o guiones (máximo 20 caracteres).", "error");
  }

  const registros = cargarRegistros();
  const nuevo = {
    fecha_guardada: fechaTexto(new Date()),
    ...datos,
    metodo: el.metodo.value || "MANUAL",
    codigo_crudo: limpiar(el.raw.value, 500),
    _enviado: false
  };

  const pos = registros.findIndex((r) => r.id === datos.id);
  if (pos >= 0) {
    if (!confirm(`El extintor ${datos.id} ya está guardado. ¿Actualizar sus datos?`)) return;
    registros[pos] = nuevo;
  } else {
    registros.push(nuevo);
  }

  guardarRegistros(registros);
  renderLista();
  limpiarFormulario();
  mostrarMensajeForm("Registro guardado.", "ok");
  mostrarEstado("Listo para escanear el siguiente extintor.");
}

/* =========================================================
   Lista de registros
   ========================================================= */

function renderLista() {
  const registros = cargarRegistros();
  el.count.textContent = String(registros.length);
  el.list.textContent = "";

  if (!registros.length) {
    const li = document.createElement("li");
    li.className = "vacio";
    li.textContent = "Todavía no hay registros.";
    el.list.appendChild(li);
    return;
  }

  registros.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "item";

    const titulo = document.createElement("strong");
    titulo.textContent = `Extintor ${r.id || "sin ID"}`;

    const detalle = document.createElement("span");
    detalle.textContent = [
      r.agente,
      r.ubicacion,
      r.proximo_mantenimiento && `Mant.: ${r.proximo_mantenimiento}`
    ].filter(Boolean).join(" · ");

    const estado = document.createElement("small");
    estado.textContent = `${r.fecha_guardada || ""} · ${r._enviado ? "enviado" : "pendiente"}`;

    const borrar = document.createElement("button");
    borrar.type = "button";
    borrar.className = "btn danger small";
    borrar.textContent = "Borrar";
    borrar.dataset.borrar = String(i);

    li.append(titulo, detalle, estado, borrar);
    el.list.appendChild(li);
  });
}

function borrarRegistro(evento) {
  const boton = evento.target.closest("button[data-borrar]");
  if (!boton) return;

  const i = Number(boton.dataset.borrar);
  const registros = cargarRegistros();
  const r = registros[i];
  if (!r) return;
  if (!confirm(`¿Borrar el extintor ${r.id}?`)) return;

  registros.splice(i, 1);
  guardarRegistros(registros);
  renderLista();
}

/* =========================================================
   Exportación a Excel
   ========================================================= */

function exportarExcel() {
  if (typeof XLSX === "undefined") {
    return mostrarEstado("No se cargó la librería de Excel. Revisá la conexión.", "error");
  }
  const registros = cargarRegistros();
  if (!registros.length) {
    return mostrarEstado("No hay registros para exportar.", "warn");
  }

  const cabeceras = COLUMNAS.map((c) => ETIQUETAS[c]);
  const filas = registros.map((r) => {
    const fila = {};
    COLUMNAS.forEach((c, i) => {
      fila[cabeceras[i]] = seguroCelda(r[c] ?? "");
    });
    return fila;
  });

  const hoja = XLSX.utils.json_to_sheet(filas, { header: cabeceras });
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Extintores");
  XLSX.writeFile(libro, `extintores_${fechaArchivo()}.xlsx`);

  mostrarEstado(`Excel descargado con ${registros.length} registro(s).`, "ok");
}

/* =========================================================
   Envío a Google Sheets (Apps Script)
   ========================================================= */

function aFila(registro) {
  const fila = {};
  for (const c of COLUMNAS) {
    fila[c] = limpiar(registro[c] ?? "", 500);
  }
  return fila;
}

function guardarConfig() {
  const url = limpiar(el.cfgUrl.value, 300);
  const token = limpiar(el.cfgToken.value, 200);

  if (url && !/^https:\/\/script\.google\.com\//.test(url)) {
    return mostrarEstado("La URL debe empezar con https://script.google.com/", "error");
  }
  localStorage.setItem(CLAVE_CONFIG, JSON.stringify({ url, token }));
  mostrarEstado("Conexión guardada en este dispositivo.", "ok");
}

function cargarConfigEnFormulario() {
  const cfg = cargarConfig();
  el.cfgUrl.value = cfg.url || "";
  el.cfgToken.value = cfg.token || "";
}

async function enviarPendientes() {
  const cfg = cargarConfig();
  if (!cfg.url || !cfg.token) {
    return mostrarEstado("Primero configurá la URL y la clave de Google Sheets.", "warn");
  }

  const registros = cargarRegistros();
  const pendientes = registros.filter((r) => !r._enviado);
  if (!pendientes.length) {
    return mostrarEstado("No hay registros pendientes de enviar.", "ok");
  }

  el.btnSheets.disabled = true;
  let enviados = 0;

  try {
    for (const r of pendientes) {
      const res = await fetch(cfg.url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ token: cfg.token, registro: aFila(r) })
      });
      const respuesta = await res.json();
      if (!respuesta.ok) {
        throw new Error(respuesta.error || "respuesta no válida");
      }
      r._enviado = true;
      enviados++;
    }
    mostrarEstado(`Se enviaron ${enviados} registro(s) a Google Sheets.`, "ok");
  } catch (err) {
    mostrarEstado(`Error al enviar (${enviados} enviado(s)): ${err.message}`, "error");
  } finally {
    guardarRegistros(registros);
    renderLista();
    el.btnSheets.disabled = false;
  }
}

/* =========================================================
   Eventos
   ========================================================= */

el.btnStart.addEventListener("click", activarCamara);
el.btnStop.addEventListener("click", () => detenerCamara());
el.fileInput.addEventListener("change", (e) => {
  const archivo = e.target.files[0];
  if (archivo) leerFoto(archivo);
});

// Apaga la cámara al cambiar de aplicación o pestaña
document.addEventListener("visibilitychange", () => {
  if (document.hidden) detenerCamara(true);
});

el.form.addEventListener("submit", guardarRegistro);
el.btnClear.addEventListener("click", limpiarFormulario);
el.list.addEventListener("click", borrarRegistro);
el.btnExcel.addEventListener("click", exportarExcel);
el.btnSaveCfg.addEventListener("click", guardarConfig);
el.btnSheets.addEventListener("click", enviarPendientes);

// Inicialización
cargarConfigEnFormulario();
renderLista();