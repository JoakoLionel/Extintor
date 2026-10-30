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
  fichaAgc: $("fichaAgc"),
  linkAgc: $("linkAgc"),
  ocrInput: $("ocrInput"),
  visor: $("visor"),
  video: $("video"),
  btnDiag: $("btnDiag"),
  diag: $("diag"),
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

// Si el QR es un link a la ficha de AGC, devuelve la URL validada
// (solo http/https y solo el dominio agcontrol.gob.ar). Si no, devuelve null.
function urlFichaAgc(texto) {
  try {
    const u = new URL(String(texto).trim());
    const dominioOk = u.hostname === "agcontrol.gob.ar" || u.hostname.endsWith(".agcontrol.gob.ar");
    const protocoloOk = u.protocol === "https:" || u.protocol === "http:";
    return protocoloOk && dominioOk ? u.href : null;
  } catch {
    return null;
  }
}

function mostrarFichaAgc(url) {
  el.linkAgc.href = url;
  el.fichaAgc.hidden = false;
}

function ocultarFichaAgc() {
  el.linkAgc.removeAttribute("href");
  el.fichaAgc.hidden = true;
}

// Vuelca los datos leídos en el formulario y registra el método usado
function procesarLectura(texto, metodo) {
  const original = String(texto ?? "");
  const recortado = original.trim();
  el.raw.value = limpiar(original, 500);

  const urlAgc = urlFichaAgc(recortado);
  const esUrl = /^https?:\/\//i.test(recortado);

  let datos;
  if (metodo === "BARCODE_1D" && /^\d{3,10}$/.test(recortado)) {
    datos = { id: recortado };
  } else {
    datos = parsearCodigo(original);
  }

  // Sin campos reconocidos: se busca un número de 4 a 6 dígitos como posible ID.
  // No se hace con un link, porque los números sueltos de una URL no son el ID.
  if (!datos.id && !esUrl) {
    const m = original.match(/\b\d{4,6}\b/);
    if (m) datos.id = m[0];
  }

  for (const campo of CAMPOS_EDITABLES) {
    if (datos[campo]) $("f-" + campo).value = datos[campo];
  }
  el.metodo.value = metodo;

  if (urlAgc) {
    mostrarFichaAgc(urlAgc);
    mostrarEstado("QR leído: es un link a la ficha de AGC, que muestra los datos como imagen. Tocá 'Abrir ficha de AGC', hacé zoom en la tabla, sacá una captura de pantalla y subila con 'Leer ficha AGC desde captura'.", "ok");
    return;
  }

  ocultarFichaAgc();
  if (!Object.keys(datos).length) {
    mostrarEstado("Se leyó un código pero no tiene los campos esperados. Revisá el código leído y completá los datos a mano.", "warn");
  } else {
    mostrarEstado(`Lectura correcta (${metodo}). Revisá los datos y guardá el registro.`, "ok");
  }
}

/* =========================================================
   Escaneo con cámara y desde foto
   ========================================================= */

const VERSION = "v4";

let stream = null;
let detector = null;
let escaneando = false;
let cvVideo = null;

function formatosSoportados() {
  return [
    Html5QrcodeSupportedFormats.QR_CODE,
    Html5QrcodeSupportedFormats.CODE_128
  ];
}

function textoError(err) {
  if (!err) return "error desconocido";
  if (typeof err === "string") return err;
  const nombre = err.name ? err.name + ": " : "";
  return nombre + (err.message || JSON.stringify(err));
}

function metodoDesdeFormato(formato, porDefecto = "QR") {
  const f = String(formato || "").toLowerCase();
  if (f.includes("code_128") || f.includes("code128")) return "BARCODE_1D";
  if (f.includes("qr")) return "QR";
  return porDefecto;
}

// Lector nativo del navegador (el mismo motor que la app de Cámara de Android)
async function crearDetector() {
  if (!("BarcodeDetector" in window)) return null;
  try {
    const soportados = await BarcodeDetector.getSupportedFormats();
    const formatos = ["qr_code", "code_128"].filter((f) => soportados.includes(f));
    if (!formatos.length) return null;
    return new BarcodeDetector({ formats: formatos });
  } catch {
    return null;
  }
}

// Plan B para QR si el navegador no trae lector nativo (librería jsQR)
function decodificarJsQR(cv) {
  if (typeof jsQR === "undefined") return null;
  try {
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, cv.width, cv.height);
    const r = jsQR(d.data, d.width, d.height, { inversionAttempts: "attemptBoth" });
    return r && r.data ? { texto: r.data, formato: "qr_code" } : null;
  } catch {
    return null;
  }
}

function canvasDeVideo(v, anchoMax) {
  const escala = Math.min(1, anchoMax / v.videoWidth);
  const w = Math.round(v.videoWidth * escala);
  const h = Math.round(v.videoHeight * escala);
  if (!cvVideo) cvVideo = document.createElement("canvas");
  cvVideo.width = w;
  cvVideo.height = h;
  cvVideo.getContext("2d", { willReadFrequently: true }).drawImage(v, 0, 0, w, h);
  return cvVideo;
}

async function cicloLectura() {
  if (!escaneando) return;
  const v = el.video;

  try {
    if (v.readyState >= 2 && v.videoWidth > 0) {
      let r = null;

      if (detector) {
        try {
          const res = await detector.detect(v);
          if (res && res.length) r = { texto: res[0].rawValue, formato: res[0].format };
        } catch { /* seguir con el plan B */ }
      }
      if (!r) r = decodificarJsQR(canvasDeVideo(v, 960));

      if (r && r.texto) {
        await detenerCamara(true);
        procesarLectura(r.texto, metodoDesdeFormato(r.formato));
        if (navigator.vibrate) navigator.vibrate(80);
        return;
      }
    }
  } catch { /* ignorar el error de este cuadro y seguir */ }

  setTimeout(cicloLectura, detector ? 150 : 300);
}

async function activarCamara() {
  if (escaneando) return;

  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return mostrarEstado("Este navegador no permite usar la cámara en esta página (hace falta HTTPS). Probá 'Tomar foto de la etiqueta'.", "error");
  }

  el.btnStart.disabled = true;
  mostrarEstado("Pidiendo permiso de cámara...");

  try {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
    } catch {
      // Segundo intento con la configuración más simple posible
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
  } catch (err) {
    el.btnStart.disabled = false;
    return mostrarEstado(`No se pudo abrir la cámara (${textoError(err)}). Tocá 'Diagnóstico' y mandame lo que dice.`, "error");
  }

  // Enfoque continuo, si el celular lo permite (importante para leer de cerca)
  try {
    const pista = stream.getVideoTracks()[0];
    const caps = pista.getCapabilities ? pista.getCapabilities() : {};
    if (caps.focusMode && caps.focusMode.includes("continuous")) {
      await pista.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
    }
  } catch { /* no es crítico */ }

  el.visor.hidden = false;
  el.video.srcObject = stream;

  try {
    await el.video.play();
  } catch (err) {
    await detenerCamara(true);
    return mostrarEstado(`La cámara se abrió pero el video no arrancó (${textoError(err)}).`, "error");
  }

  detector = await crearDetector();
  escaneando = true;
  el.btnStop.disabled = false;
  mostrarEstado(detector
    ? "Apuntá la cámara al QR o al código de barras."
    : "Apuntá la cámara al QR (este navegador no trae lector nativo: el código de barras solo se lee con foto o a mano).");
  cicloLectura();
}

async function detenerCamara(silencioso = false) {
  escaneando = false;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  el.video.srcObject = null;
  el.visor.hidden = true;
  el.btnStart.disabled = false;
  el.btnStop.disabled = true;
  if (!silencioso) mostrarEstado("Cámara detenida.");
}

async function diagnostico() {
  const l = [];
  l.push("Versión de la página: " + VERSION);
  l.push("HTTPS: " + window.isSecureContext);
  l.push("Navegador: " + navigator.userAgent);
  l.push("getUserMedia: " + !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia));
  l.push("BarcodeDetector: " + ("BarcodeDetector" in window));
  if ("BarcodeDetector" in window) {
    try {
      l.push("  formatos: " + (await BarcodeDetector.getSupportedFormats()).join(", "));
    } catch (e) {
      l.push("  formatos: error " + textoError(e));
    }
  }
  l.push("jsQR cargada: " + (typeof jsQR !== "undefined"));
  l.push("html5-qrcode cargada: " + (typeof Html5Qrcode !== "undefined"));
  l.push("OCR (Tesseract) cargado: " + (typeof Tesseract !== "undefined"));
  l.push("Excel (XLSX) cargada: " + (typeof XLSX !== "undefined"));

  try {
    const p = await navigator.permissions.query({ name: "camera" });
    l.push("Permiso de cámara: " + p.state);
  } catch {
    l.push("Permiso de cámara: no se pudo consultar");
  }

  try {
    const dispositivos = await navigator.mediaDevices.enumerateDevices();
    l.push("Cámaras detectadas: " + dispositivos.filter((d) => d.kind === "videoinput").length);
  } catch (e) {
    l.push("Cámaras detectadas: error " + textoError(e));
  }

  if (!escaneando) {
    try {
      const prueba = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const cfg = prueba.getVideoTracks()[0].getSettings();
      l.push(`Prueba de cámara: OK (${cfg.width}x${cfg.height})`);
      prueba.getTracks().forEach((t) => t.stop());
    } catch (e) {
      l.push("Prueba de cámara: FALLÓ -> " + textoError(e));
    }
  } else {
    l.push("Prueba de cámara: la cámara ya está activa");
  }

  el.diag.textContent = l.join("\n");
  el.diag.hidden = false;
}

// Variantes que se prueban en orden sobre la misma foto, hasta encontrar un código.
// La primera es a resolución ORIGINAL (sin achicar), clave para QR muy densos o gastados.
const VARIANTES_FOTO = [
  { max: 4000, rot: 0 },
  { max: 4000, rot: 0, contraste: true },
  { max: 1600, rot: 0 },
  { max: 1600, rot: 0, contraste: true },
  { max: 1600, rot: 90 },
  { max: 1600, rot: 270 },
  { max: 1000, rot: 0, contraste: true }
];

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
    px[i] = v; px[i + 1] = v; px[i + 2] = v;
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

async function decodificarCanvas(cv) {
  if (detector) {
    try {
      const res = await detector.detect(cv);
      if (res && res.length) return { texto: res[0].rawValue, formato: res[0].format };
    } catch { /* seguir con el plan B */ }
  }
  return decodificarJsQR(cv);
}

async function leerFoto(archivo) {
  await detenerCamara(true);

  let url = null;
  try {
    if (!detector) detector = await crearDetector();
    const cargada = await cargarImagen(archivo);
    url = cargada.url;

    // 1) Lector nativo del navegador y jsQR, sobre varias versiones de la foto
    for (let i = 0; i < VARIANTES_FOTO.length; i++) {
      mostrarEstado(`Buscando código en la foto (intento ${i + 1} de ${VARIANTES_FOTO.length})...`);
      const cv = dibujarVariante(cargada.img, VARIANTES_FOTO[i]);
      const r = await decodificarCanvas(cv);
      if (r && r.texto) {
        procesarLectura(r.texto, metodoDesdeFormato(r.formato, "FOTO"));
        return;
      }
    }

    // 2) Último recurso: la librería html5-qrcode
    if (typeof Html5Qrcode !== "undefined") {
      for (let i = 0; i < 4; i++) {
        mostrarEstado(`Probando otro método de lectura (${i + 1} de 4)...`);
        const cv = dibujarVariante(cargada.img, VARIANTES_FOTO[i]);
        const archivoVariante = await canvasAArchivo(cv);
        const lector = new Html5Qrcode("fileReader", { formatsToSupport: formatosSoportados(), verbose: false });
        try {
          const texto = await lector.scanFile(archivoVariante, false);
          procesarLectura(texto, "FOTO");
          return;
        } catch {
          /* siguiente variante */
        } finally {
          try { lector.clear(); } catch { /* nada que limpiar */ }
        }
      }
    }

    mostrarEstado("No se encontró ningún código en la foto. Probá acercarte, con más luz y sin reflejos, o cargá los datos a mano. Si sigue fallando, tocá 'Diagnóstico'.", "warn");
  } catch (err) {
    mostrarEstado(`No se pudo procesar la foto: ${textoError(err)}`, "error");
  } finally {
    if (url) URL.revokeObjectURL(url);
    el.fileInput.value = "";
  }
}

/* =========================================================
   Ficha de AGC: lectura con OCR de una captura de pantalla
   ========================================================= */

// Etiquetas de la ficha (se buscan en minúsculas y sin tildes).
// Las que empiezan con "_" son datos que la ficha trae pero que la planilla no guarda.
const ETIQUETAS_FICHA = [
  { campo: "ubicacion",             re: /domicilio\s*(de\s*)?instalaci[o0]n/ },
  { campo: "recargadora",           re: /empresa\s*recargadora/ },
  { campo: "proximo_mantenimiento", re: /fecha\s*vencimiento\s*mantenimiento/ },
  { campo: "vida_util",             re: /fecha\s*vencimiento\s*vida\s*util/ },
  { campo: "tarjeta",               re: /\bn\S{0,3}\s*tarjeta/ },
  { campo: "capacidad",             re: /capacidad/ },
  { campo: "_uso",                  re: /\buso\b/ },
  { campo: "fabricante",            re: /empresa\s*fabricante/ },
  { campo: "_ultimo_mantenimiento", re: /fecha\s*mantenimiento/ },
  { campo: "fabricacion",           re: /fecha\s*fabricaci[o0]n/ },
  { campo: "prueba_hidraulica",     re: /fecha\s*vencimiento\s*(ph|p\.h\.|prueba)/ },
  { campo: "agente",                re: /agente\s*extintor/ },
  { campo: "id",                    re: /\bn\S{0,3}\s*extintor/ }
];

// Campos que la ficha de AGC puede aportar
const CAMPOS_FICHA = [
  "id", "tarjeta", "fabricante", "recargadora", "agente", "capacidad",
  "ubicacion", "fabricacion", "proximo_mantenimiento", "vida_util", "prueba_hidraulica"
];

// Un carácter -> el mismo carácter sin tilde y en minúscula (siempre 1 a 1, para no desfasar posiciones)
function aplanarCaracter(c) {
  const base = c.normalize("NFD").replace(/[\u0300-\u036f]/g, "") || " ";
  return base[0].toLowerCase()[0] || " ";
}

// El OCR suele confundir O con 0 y l/I con 1 dentro de números
function corregirDigitos(v) {
  return v.replace(/[oO]/g, "0").replace(/[lI|]/g, "1");
}

function limpiarValorFicha(v) {
  return limpiar(String(v).replace(/[|_]+/g, " ").replace(/^[\s:.\-]+/, ""), 120);
}

function extraerFecha(v, permitirSoloAnio = false) {
  const t = corregirDigitos(v);
  const m = t.match(/(\d{1,2})\s*[\/\-.]\s*(\d{4})/);
  if (m) return `${m[1].padStart(2, "0")}/${m[2]}`;
  if (permitirSoloAnio) {
    const a = t.match(/\b(19|20)\d{2}\b/);
    if (a) return a[0];
  }
  return "";
}

// Recibe el texto que devolvió el OCR y devuelve { campo: valor } con lo que pudo reconocer
function parsearFichaAgc(texto) {
  const original = String(texto ?? "")
    .replace(/[\u{10000}-\u{10FFFF}]/gu, " ")
    .replace(/\s/g, " ");
  const plano = Array.from(original).map(aplanarCaracter).join("");

  const hallazgos = [];
  for (const { campo, re } of ETIQUETAS_FICHA) {
    const m = re.exec(plano);
    if (m) hallazgos.push({ campo, inicio: m.index, fin: m.index + m[0].length });
  }
  hallazgos.sort((a, b) => a.inicio - b.inicio);

  const datos = {};
  hallazgos.forEach((h, i) => {
    // El valor de cada etiqueta llega hasta la etiqueta siguiente
    const hasta = i + 1 < hallazgos.length
      ? hallazgos[i + 1].inicio
      : Math.min(original.length, h.fin + 60);
    const valor = limpiarValorFicha(original.slice(h.fin, hasta));
    if (!valor) return;

    switch (h.campo) {
      case "id": {
        const m = corregirDigitos(valor).match(/\d{3,8}/);
        if (m) datos.id = m[0];
        break;
      }
      case "tarjeta": {
        const m = corregirDigitos(valor).match(/\d[\d ]{5,}\d/);
        if (m) datos.tarjeta = m[0].replace(/ /g, "");
        break;
      }
      case "proximo_mantenimiento":
      case "vida_util":
      case "prueba_hidraulica": {
        const f = extraerFecha(valor);
        if (f) datos[h.campo] = f;
        break;
      }
      case "fabricacion": {
        const f = extraerFecha(valor, true);
        if (f) datos.fabricacion = f;
        break;
      }
      case "capacidad": {
        const m = valor.match(/(\d+(?:[.,]\d+)?)\s*kg\s*\/\s*l\w*/i);
        const m2 = valor.match(/(\d+(?:[.,]\d+)?)\s*kg/i);
        datos.capacidad = m ? `${m[1]} Kg/Lts` : (m2 ? `${m2[1]} Kg` : limpiar(valor, 25));
        break;
      }
      case "ubicacion":
      case "recargadora":
      case "fabricante":
      case "agente":
        if (valor.length >= 2) datos[h.campo] = valor.slice(0, 80);
        break;
      default:
        break; // datos que no se guardan
    }
  });
  return datos;
}

const ESTADOS_OCR = {
  "loading tesseract core": "cargando el motor",
  "initializing tesseract": "iniciando",
  "initialized tesseract": "iniciado",
  "loading language traineddata": "descargando el idioma",
  "loaded language traineddata": "idioma cargado",
  "initializing api": "iniciando",
  "initialized api": "listo",
  "recognizing text": "leyendo la ficha"
};

let ocrWorker = null;

async function crearOcr() {
  if (typeof Tesseract === "undefined") {
    throw new Error("no se cargó la librería de OCR; revisá la conexión a internet y recargá la página");
  }
  if (!ocrWorker) {
    ocrWorker = await Tesseract.createWorker("spa", 1, {
      logger: (m) => {
        if (!m || !m.status) return;
        const pct = typeof m.progress === "number" ? ` ${Math.round(m.progress * 100)}%` : "";
        mostrarEstado(`OCR: ${ESTADOS_OCR[m.status] || m.status}${pct}`);
      }
    });
  }
  return ocrWorker;
}

// El texto de la ficha es muy chico: se agranda, se pasa a grises y se sube el contraste
function prepararParaOcr(img) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  let escala = Math.min(4, Math.max(1, 2000 / w));
  escala = Math.max(1, Math.min(escala, 5000 / h));

  const cv = document.createElement("canvas");
  cv.width = Math.round(w * escala);
  cv.height = Math.round(h * escala);
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  aplicarContraste(cv);
  return cv;
}

function aplicarDatosFicha(datos) {
  const campos = Object.keys(datos).filter((k) => !k.startsWith("_"));
  if (!campos.length) {
    return mostrarEstado("No se pudo reconocer ningún dato en la imagen. Probá con una captura más grande (hacé zoom en la tabla antes de sacarla) o completá a mano.", "warn");
  }

  // Control de seguridad: la ficha tiene que ser del mismo extintor que ya está cargado
  const idActual = limpiar($("f-id").value);
  if (datos.id && idActual && datos.id !== idActual) {
    return mostrarEstado(`La ficha es del extintor ${datos.id}, pero tenés cargado el ${idActual}. No se completó nada: revisá que sea el mismo extintor.`, "error");
  }

  for (const campo of campos) {
    const input = $("f-" + campo);
    if (!input) continue;
    input.value = datos[campo];
    input.classList.add("ocr-revisar");
  }
  el.metodo.value = el.metodo.value === "QR" ? "QR+OCR" : "OCR_FICHA";

  const noLeidos = CAMPOS_FICHA.filter((c) => !datos[c]).map((c) => ETIQUETAS[c]);
  let texto = `Se completaron ${campos.length} de ${CAMPOS_FICHA.length} campos (marcados en amarillo). Comparalos con la ficha antes de guardar: el OCR puede equivocarse. Clases de fuego y certificación van a mano.`;
  if (noLeidos.length) texto += ` No se leyó: ${noLeidos.join(", ")}.`;
  if (!datos.id && idActual) texto += " No se pudo verificar que la ficha sea de este extintor.";
  mostrarEstado(texto, noLeidos.length ? "warn" : "ok");
}

async function leerFichaAgc(archivo) {
  await detenerCamara(true);

  let url = null;
  try {
    mostrarEstado("Preparando la imagen...");
    const cargada = await cargarImagen(archivo);
    url = cargada.url;
    const cv = prepararParaOcr(cargada.img);
    const worker = await crearOcr();

    let datos = {};
    let textoOcr = "";
    // Modo 6: lee línea por línea (conserva cada etiqueta junto a su valor). Modo 4 de respaldo.
    for (const modo of ["6", "4"]) {
      await worker.setParameters({ tessedit_pageseg_mode: modo });
      const resultado = await worker.recognize(cv);
      textoOcr = (resultado && resultado.data && resultado.data.text) || "";
      datos = parsearFichaAgc(textoOcr);
      if (Object.keys(datos).length >= 6) break;
    }

    aplicarDatosFicha(datos);

    // Si casi no se reconoció nada, se muestra el texto crudo para poder diagnosticar
    if (Object.keys(datos).length < 3) {
      el.diag.textContent = "Texto que leyó el OCR:\n" + (textoOcr.trim() || "(vacío)");
      el.diag.hidden = false;
    }
  } catch (err) {
    mostrarEstado(`No se pudo leer la ficha: ${textoError(err)}. El OCR necesita internet la primera vez (descarga el idioma). Tocá 'Diagnóstico' si sigue fallando.`, "error");
  } finally {
    if (url) URL.revokeObjectURL(url);
    el.ocrInput.value = "";
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
  for (const campo of CAMPOS_EDITABLES) {
    $("f-" + campo).value = "";
    $("f-" + campo).classList.remove("ocr-revisar");
  }
  el.metodo.value = "MANUAL";
  el.raw.value = "";
  ocultarFichaAgc();
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
el.btnDiag.addEventListener("click", diagnostico);
el.ocrInput.addEventListener("change", (e) => {
  const archivo = e.target.files[0];
  if (archivo) leerFichaAgc(archivo);
});
// Al editar un campo marcado por el OCR, se quita la marca amarilla
el.form.addEventListener("input", (e) => e.target.classList.remove("ocr-revisar"));
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
mostrarEstado(`Listo para escanear. (versión ${VERSION})`);