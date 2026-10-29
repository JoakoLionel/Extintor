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

// Nombres (normalizados) que puede tener un dato dentro del QR
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

// Versiones de la foto que se prueban en orden hasta encontrar un código
const VARIANTES_FOTO = [
  { max: 1600, rot: 0 },
  { max: 1600, rot: 90 },
  { max: 1600, rot: 270 },
  { max: 2400, rot: 0 },
  { max: 1600, rot: 0, contraste: true },
  { max: 1000, rot: 0, contraste: true },
  { max: 1600, rot: 180 }
];

const ID_VALIDO = /^[0-9A-Za-z-]{1,20}$/;

/* =========================================================
   Elementos de la página
   ========================================================= */

const $ = (id) => document.getElementById(id);

const el = {
  reader: $("reader"),
  btnStart: $("btnStart"),
  btnStop: $("btnStop"),
  fileInput: $("fileInput"),
  fileReader: $("fileReader"),
  status: $("status"),
  form: $("form"),
  formMsg: $("formMsg"),
  raw: $("raw"),
  btnClear: $("btnClear"),
  count: $("count"),
  list: $("list"),
  btnExcel: $("btnExcel"),
  cfgUrl: $("cfgUrl"),
  cfgToken: $("cfgToken"),
  btnSaveCfg: $("btnSaveCfg"),
  btnSheets: $("btnSheets")
};

// Campo oculto con el método de lectura (QR, BARCODE_1D, FOTO, CAMARA o MANUAL)
const metodoInput = document.createElement("input");
metodoInput.type = "hidden";
metodoInput.id = "metodo";
metodoInput.value = "MANUAL";
el.form.appendChild(metodoInput);

/* =========================================================
   Utilidades
   ========================================================= */

function limpiar(valor, max = 200) {
  return String(valor ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizar(texto) {
  return String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

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
   Almacenamiento local
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

function procesarLectura(texto, metodo) {
  const original = String(texto ?? "");
  const recortado = original.trim();
  el.raw.value = limpiar(original, 500);

  let datos;
  if (/^\d{3,10}$/.test(recortado)) {
    // Un número solo (típico del código de barras) es el ID
    datos = { id: recortado };
  } else {
    datos = parsearCodigo(original);
  }

  // Si no se reconoció ningún campo, busca un número de 4 a 6 dígitos
  if (!datos.id) {
    const m = original.match(/\b\d{4,6}\b/);
    if (m) datos.id = m[0];
  }

  for (const campo of CAMPOS_EDITABLES) {
    if (datos[campo]) $("f-" + campo).value = datos[campo];
  }
  metodoInput.value = metodo;

  if (!Object.keys(datos).length) {
    mostrarEstado("Se leyó un código pero no tiene los campos esperados. Revisá el código leído y completá los datos a mano.", "warn");
  } else {
    mostrarEstado(`Lectura correcta (${metodo}). Revisá los datos y guardá el registro.`, "ok");
  }
}

function metodoDesdeFormato(formato, porDefecto = "CAMARA") {
  if (formato === "CODE_128") return "BARCODE_1D";
  if (formato === "QR_CODE") return "QR";
  return porDefecto;
}

/* =========================================================
   Escaneo con cámara
   ========================================================= */

let escaner = null;
let arrancando = false;

function formatosSoportados() {
  return [
    Html5QrcodeSupportedFormats.QR_CODE,
    Html5QrcodeSupportedFormats.CODE_128
  ];
}

function errorCamara(err) {
  const texto = `${err?.name || ""} ${err?.message || err || ""}`;
  if (/NotAllowed|Permission/i.test(texto)) {
    return "Permiso de cámara denegado. Habilitalo desde el candado de la barra de direcciones y volvé a intentar.";
  }
  if (/NotFound|Overconstrained|Requested device/i.test(texto)) {
    return "No se encontró una cámara en este dispositivo.";
  }
  if (/NotReadable|TrackStart|in use/i.test(texto)) {
    return "La cámara está siendo usada por otra aplicación. Cerrala y volvé a intentar.";
  }
  return "No se pudo iniciar la cámara.";
}

async function activarCamara() {
  if (arrancando || escaner) return;

  if (typeof Html5Qrcode === "undefined") {
    return mostrarEstado("No se cargó la librería de escaneo. Recargá la página con internet activo.", "error");
  }
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return mostrarEstado("La cámara solo funciona si la página se abre con HTTPS (por ejemplo, la dirección de GitHub Pages), no como archivo local.", "error");
  }

  arrancando = true;
  el.btnStart.disabled = true;
  mostrarEstado("Iniciando cámara...");

  try {
    escaner = new Html5Qrcode("reader", {
      formatsToSupport: formatosSoportados(),
      verbose: false
    });

    await escaner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 260, height: 160 } },
      onLecturaCamara,
      () => { /* cuadro sin código: no hacer nada */ }
    );

    el.btnStop.disabled = false;
    mostrarEstado("Apuntá la cámara al QR o al código de barras.");
  } catch (err) {
    escaner = null;
    el.btnStart.disabled = false;
    const detalle = err?.name || err?.message || String(err);
    mostrarEstado(`${errorCamara(err)} (Detalle: ${detalle})`, "error");
  } finally {
    arrancando = false;
  }
}

async function onLecturaCamara(texto, resultado) {
  await detenerCamara(true);
  const formato = resultado?.result?.format?.formatName || "";
  procesarLectura(texto, metodoDesdeFormato(formato));
}

async function detenerCamara(silencioso = false) {
  if (escaner) {
    try { await escaner.stop(); } catch { /* ya estaba detenida */ }
    try { escaner.clear(); } catch { /* nada que limpiar */ }
    escaner = null;
  }
  el.btnStart.disabled = false;
  el.btnStop.disabled = true;
  if (!silencioso) mostrarEstado("Cámara detenida.");
}

/* =========================================================
   Lectura desde foto
   ========================================================= */

function cargarImagen(archivo) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("el archivo no es una imagen válida"));
    };
    img.src = url;
  });
}

function aplicarContraste(cv) {
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const datos = ctx.getImageData(0, 0, cv.width, cv.height);
  const px = datos.data;
  for (let i = 0; i < px.length; i += 4) {
    const gris = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const v = Math.max(0, Math.min(255, (gris - 128) * 1.8 + 128));
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
  }
  ctx.putImageData(datos, 0, 0);
}

function dibujarVariante(img, { max, rot, contraste = false }) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const escala = Math.min(1, max / Math.max(w, h));
  const dw = Math.round(w * escala);
  const dh = Math.round(h * escala);
  const girado = rot === 90 || rot === 270;

  const cv = document.createElement("canvas");
  cv.width = girado ? dh : dw;
  cv.height = girado ? dw : dh;

  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.translate(cv.width / 2, cv.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (contraste) aplicarContraste(cv);
  return cv;
}

function canvasAArchivo(cv) {
  return new Promise((resolve, reject) => {
    cv.toBlob((blob) => {
      if (blob) resolve(new File([blob], "etiqueta.png", { type: "image/png" }));
      else reject(new Error("no se pudo preparar la imagen"));
    }, "image/png");
  });
}

async function escanearArchivo(lector, archivo) {
  if (typeof lector.scanFileV2 === "function") {
    const r = await lector.scanFileV2(archivo, false);
    return { texto: r.decodedText, formato: r.result?.format?.formatName || "" };
  }
  const texto = await lector.scanFile(archivo, false);
  return { texto, formato: "" };
}

async function leerFoto(archivo) {
  if (typeof Html5Qrcode === "undefined") {
    return mostrarEstado("No se cargó la librería de escaneo. Recargá la página con internet activo.", "error");
  }
  await detenerCamara(true);

  let url = null;
  try {
    const cargada = await cargarImagen(archivo);
    url = cargada.url;
    const lector = new Html5Qrcode("fileReader", {
      formatsToSupport: formatosSoportados(),
      verbose: false
    });

    for (let i = 0; i < VARIANTES_FOTO.length; i++) {
      mostrarEstado(`Buscando código en la foto (intento ${i + 1} de ${VARIANTES_FOTO.length})...`);
      const cv = dibujarVariante(cargada.img, VARIANTES_FOTO[i]);
      const archivoVariante = await canvasAArchivo(cv);

      try {
        const r = await escanearArchivo(lector, archivoVariante);
        procesarLectura(r.texto, metodoDesdeFormato(r.formato, "FOTO"));
        return;
      } catch {
        // no encontró código en esta variante: seguir con la próxima
      }
    }

    mostrarEstado("No se encontró ningún código en la foto. Probá acercándote, con más luz y sin reflejos, o cargá los datos a mano.", "warn");
  } catch (err) {
    const detalle = err?.message || String(err);
    mostrarEstado(`No se pudo procesar la foto: ${detalle}`, "error");
  } finally {
    if (url) URL.revokeObjectURL(url);
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
  metodoInput.value = "MANUAL";
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
    metodo: metodoInput.value || "MANUAL",
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
   Google Sheets (Apps Script)
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

document.addEventListener("visibilitychange", () => {
  if (document.hidden) detenerCamara(true);
});

el.form.addEventListener("submit", guardarRegistro);
el.btnClear.addEventListener("click", limpiarFormulario);
el.list.addEventListener("click", borrarRegistro);
el.btnExcel.addEventListener("click", exportarExcel);
el.btnSaveCfg.addEventListener("click", guardarConfig);
el.btnSheets.addEventListener("click", enviarPendientes);

/* =========================================================
   Inicio
   ========================================================= */

function verificarLibrerias() {
  const faltan = [];
  if (typeof Html5Qrcode === "undefined") faltan.push("escáner");
  if (typeof XLSX === "undefined") faltan.push("Excel");
  if (faltan.length) {
    mostrarEstado(`No se cargó: ${faltan.join(" y ")}. Revisá tu conexión a internet y recargá la página.`, "error");
  }
}

cargarConfigEnFormulario();
renderLista();
verificarLibrerias();