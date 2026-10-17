// =====================================================================
//  Trova — app.js
//
//  Struttura del database (Firebase Realtime Database):
//    devices/
//      <codice segreto>/
//        nome:     "iPhone di Luigi"
//        lat, lon: coordinate
//        accuracy: precisione in metri
//        speed:    velocità in m/s (se disponibile)
//        heading:  direzione di marcia in gradi (se disponibile)
//        alt:      altitudine in metri (se disponibile)
//        ts:       quando è stata letta la posizione (millisecondi)
//        ring:     true = "fai suonare"
// =====================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getDatabase, ref, update, onValue, off } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js";
import { firebaseConfig } from "./config.js";

const $ = (id) => document.getElementById(id);

// Modalità demo: apri la pagina con ?demo per vedere l'app con dati finti, senza Firebase
const DEMO = new URLSearchParams(location.search).has("demo");

// ---------- Firebase ----------
let db = null;
if (DEMO) {
  // niente database: i dati sono simulati (vedi in fondo al file)
} else if (firebaseConfig.databaseURL && firebaseConfig.databaseURL !== "...") {
  db = getDatabase(initializeApp(firebaseConfig));
} else {
  $("avviso-config").hidden = false;
}

// =====================================================================
//  UTILITÀ
// =====================================================================

// Legge/scrive in localStorage senza mai far crashare l'app
function leggi(chiave) {
  try { return localStorage.getItem(chiave); } catch { return null; }
}
function salva(chiave, valore) {
  try { localStorage.setItem(chiave, valore); } catch {}
}

// Crea un codice casuale di 20 caratteri, difficile da indovinare
function nuovoCodice() {
  const alfabeto = "abcdefghjkmnpqrstuvwxyz23456789";
  const numeri = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(numeri, (n) => alfabeto[n % alfabeto.length]).join("");
}

// "adesso", "3 min fa", "2 h fa"...
function quantoTempoFa(ts) {
  const secondi = Math.round((Date.now() - ts) / 1000);
  if (secondi < 15) return "adesso";
  if (secondi < 60) return `${secondi} s fa`;
  if (secondi < 3600) return `${Math.round(secondi / 60)} min fa`;
  if (secondi < 86400) return `${Math.round(secondi / 3600)} h fa`;
  return new Date(ts).toLocaleString("it-IT");
}

// 850 → "850 m", 1530 → "1.53 km"
function formattaDistanza(metri) {
  if (metri < 1000) return `${Math.round(metri)} m`;
  return `${(metri / 1000).toFixed(metri < 10000 ? 2 : 1)} km`;
}

// 75 secondi → "01:15", 3725 → "1:02:05"
function formattaDurata(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Distanza in metri tra due punti sulla Terra (formula dell'emisenoverso)
function distanza(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Direzione (0° = Nord, 90° = Est) per andare dal punto 1 al punto 2
function direzione(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * rad) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon2 - lon1) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

function puntoCardinale(gradi) {
  const nomi = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return nomi[Math.round(gradi / 45) % 8];
}

// Qualità del segnale a partire dalla precisione in metri
function qualita(precisione) {
  if (precisione <= 10) return { livello: 4, stato: "ottimo", testo: "Eccellente" };
  if (precisione <= 30) return { livello: 3, stato: "buono", testo: "Buono" };
  if (precisione <= 100) return { livello: 2, stato: "discreto", testo: "Discreto" };
  return { livello: 1, stato: "scarso", testo: "Scarso" };
}

// Piccolo messaggio che compare in basso per qualche secondo
let timerToast;
function toast(messaggio) {
  const el = $("toast");
  el.textContent = messaggio;
  el.hidden = false;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => (el.hidden = true), 3200);
}

// =====================================================================
//  NAVIGAZIONE TRA LE SCHERMATE
// =====================================================================
let tabAttiva = "tab-sonar";

document.querySelectorAll(".tabbar button").forEach((bottone) => {
  bottone.addEventListener("click", () => apriTab(bottone.dataset.tab));
});

function apriTab(id) {
  tabAttiva = id;
  document.querySelectorAll(".schermata").forEach((s) => s.classList.toggle("attiva", s.id === id));
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("attivo", b.dataset.tab === id));
  window.scrollTo(0, 0);

  if (id === "tab-trova") {
    preparaMappa();
    setTimeout(() => mappa.invalidateSize(), 60); // Leaflet deve ricalcolare le dimensioni
    if (vista === "radar") avviaRadar();
  } else {
    fermaRadar();
  }
  if (id === "tab-stat") aggiornaStatistiche();
}

// =====================================================================
//  SCHERMATA 1: SONAR — condivide la posizione di questo telefono
// =====================================================================

// Il codice di questo telefono resta sempre lo stesso (salvato nel telefono)
let mioCodice = leggi("mioCodice");
if (!mioCodice) {
  mioCodice = nuovoCodice();
  salva("mioCodice", mioCodice);
}
$("codice").textContent = mioCodice;

$("nome").value = leggi("nome") || "";
$("nome").addEventListener("change", () => {
  salva("nome", $("nome").value.trim());
  if (idWatch !== null) inviaAlDatabase({ nome: $("nome").value.trim() || "Senza nome" });
});

$("copia-codice").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(mioCodice);
    toast("Codice copiato ✓");
  } catch {
    toast("Copia non riuscita: tieni premuto sul codice.");
  }
});

// Condivide un link che apre direttamente la mappa su questo telefono
$("condividi-link").addEventListener("click", async () => {
  const link = `${location.origin}${location.pathname}?trova=${mioCodice}`;
  try {
    if (navigator.share) await navigator.share({ title: "Trova", text: "Ecco dove trovarmi:", url: link });
    else {
      await navigator.clipboard.writeText(link);
      toast("Link copiato ✓");
    }
  } catch {}
});

let idWatch = null;        // id restituito da watchPosition (null = fermo)
let ultimoInvio = 0;       // per non scrivere sul database troppo spesso
let wakeLock = null;       // tiene acceso lo schermo
let audio = null;          // per il suono "fai suonare"

$("avvia").addEventListener("click", () => {
  if (idWatch === null) avviaCondivisione();
  else fermaCondivisione();
});

function avviaCondivisione() {
  if (!db && !DEMO) return toast("Prima configura Firebase in config.js");
  if (!("geolocation" in navigator)) return toast("Questo browser non supporta la posizione");

  // L'audio su iPhone si può "sbloccare" solo dopo un tocco dell'utente: lo facciamo ora
  audio = audio || new AudioContext();
  audio.resume();

  idWatch = DEMO
    ? demoGps(posizioneRicevuta)
    : navigator.geolocation.watchPosition(posizioneRicevuta, erroreGps, {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 20000
      });

  iniziaSessione();
  tieniSchermoAcceso();
  if (!DEMO) ascoltaSquillo();

  document.body.classList.add("live");
  $("pillola-testo").textContent = "LIVE";
  $("avvia-testo").textContent = "STOP";
  $("stato").textContent = "Acquisizione satelliti…";
}

function fermaCondivisione() {
  if (DEMO) clearInterval(idWatch);
  else {
    navigator.geolocation.clearWatch(idWatch);
    off(ref(db, `devices/${mioCodice}/ring`));
  }
  idWatch = null;
  wakeLock?.release();
  wakeLock = null;
  chiudiSessione();

  document.body.classList.remove("live");
  $("pillola-testo").textContent = "OFFLINE";
  $("avvia-testo").textContent = "AVVIA";
  $("stato").textContent = "Sistema in attesa";
}

function posizioneRicevuta(posizione) {
  const c = posizione.coords;
  mioPunto = { lat: c.latitude, lon: c.longitude, accuracy: c.accuracy };

  const campione = registraCampione(posizione);
  const q = qualita(c.accuracy);

  $("stato").textContent = `Trasmissione attiva · ${q.testo.toLowerCase()}`;
  $("t-lat").textContent = c.latitude.toFixed(5) + "°";
  $("t-lon").textContent = c.longitude.toFixed(5) + "°";
  $("t-prec").textContent = `±${Math.round(c.accuracy)} m`;
  $("t-barre").dataset.livello = q.livello;
  $("t-vel").textContent = campione.kmh.toFixed(1);
  $("t-alt").textContent = typeof c.altitude === "number" ? Math.round(c.altitude) : "—";

  if (tabAttiva === "tab-stat") aggiornaStatistiche();
  if (ultimiDati) aggiornaScheda(ultimiDati);

  // Al massimo un invio ogni 5 secondi
  if (Date.now() - ultimoInvio < 5000) return;
  ultimoInvio = Date.now();

  inviaAlDatabase({
    nome: $("nome").value.trim() || "Senza nome",
    lat: c.latitude,
    lon: c.longitude,
    accuracy: Math.round(c.accuracy),
    speed: campione.kmh / 3.6,
    heading: typeof c.heading === "number" && !isNaN(c.heading) ? Math.round(c.heading) : null,
    alt: typeof c.altitude === "number" ? Math.round(c.altitude) : null,
    ts: posizione.timestamp
  });
}

async function inviaAlDatabase(dati) {
  try {
    if (!DEMO) await update(ref(db, `devices/${mioCodice}`), dati);
    sessione.invii++;
    $("t-invio").textContent = new Date().toLocaleTimeString("it-IT");
    emettiOnda();
  } catch (e) {
    $("t-invio").textContent = "Errore";
    toast("Errore di invio: " + e.message);
  }
}

// Disegna un'onda che parte dal centro del radar
function emettiOnda() {
  const onda = document.createElement("i");
  $("onde").appendChild(onda);
  setTimeout(() => onda.remove(), 1900);
}

function erroreGps(errore) {
  const messaggi = {
    1: "Permesso negato. Su iPhone: Impostazioni → Privacy → Localizzazione → Safari.",
    2: "Posizione non disponibile.",
    3: "Il GPS ci mette troppo, riprovo…"
  };
  $("stato").textContent = errore.code === 3 ? "Segnale debole, riprovo…" : "Errore GPS";
  toast(messaggi[errore.code] || errore.message);
  if (errore.code === 1) fermaCondivisione();
}

// Chiede al telefono di non spegnere lo schermo (Safari 16.4+)
async function tieniSchermoAcceso() {
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch {}
}
// Quando torni nell'app il wake lock va richiesto di nuovo
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && idWatch !== null) tieniSchermoAcceso();
});

// ---------- "Fai suonare": questo telefono ascolta il comando ----------
let intervalloSuono = null;

function ascoltaSquillo() {
  onValue(ref(db, `devices/${mioCodice}/ring`), (snap) => {
    if (snap.val() === true) iniziaSquillo();
    else fermaSquillo();
  });
}

function iniziaSquillo() {
  if (intervalloSuono) return;
  $("squillo").hidden = false;
  beep();
  intervalloSuono = setInterval(beep, 700);
}

function fermaSquillo() {
  clearInterval(intervalloSuono);
  intervalloSuono = null;
  $("squillo").hidden = true;
}

$("ferma-squillo").addEventListener("click", () => {
  fermaSquillo();
  update(ref(db, `devices/${mioCodice}`), { ring: false });
});

// Genera un "bip-bip" con il sintetizzatore del browser
function beep() {
  if (!audio) return;
  [0, 0.18].forEach((ritardo) => {
    const osc = audio.createOscillator();
    const volume = audio.createGain();
    osc.frequency.value = 1320;
    osc.type = "square";
    volume.gain.value = 0.3;
    osc.connect(volume).connect(audio.destination);
    const t = audio.currentTime + ritardo;
    osc.start(t);
    osc.stop(t + 0.12);
  });
}

// =====================================================================
//  SESSIONE E STATISTICHE (salvate solo su questo telefono)
// =====================================================================
const MAX_CAMPIONI = 120;
let sessione = sessioneVuota();
let timerSessione = null;

function sessioneVuota() {
  return { inizio: null, fine: null, campioni: [], distanza: 0, invii: 0, velMax: 0, ultimo: null };
}

function totali() {
  return {
    distanza: Number(leggi("totDistanza")) || 0,
    tempo: Number(leggi("totTempo")) || 0,
    sessioni: Number(leggi("totSessioni")) || 0
  };
}

function iniziaSessione() {
  sessione = sessioneVuota();
  sessione.inizio = Date.now();
  salva("totSessioni", totali().sessioni + 1);
  clearInterval(timerSessione);
  timerSessione = setInterval(() => {
    if (tabAttiva === "tab-stat") aggiornaTempo();
  }, 1000);
}

function chiudiSessione() {
  clearInterval(timerSessione);
  sessione.fine = Date.now();
  salva("totTempo", totali().tempo + (sessione.fine - sessione.inizio));
}

// Salva un punto e calcola distanza e velocità rispetto al precedente
function registraCampione(posizione) {
  const c = posizione.coords;
  const t = posizione.timestamp;
  const prec = sessione.ultimo;
  const haVelocita = typeof c.speed === "number" && c.speed >= 0;
  let kmh = haVelocita ? c.speed * 3.6 : 0;

  if (prec) {
    const d = distanza(prec.lat, prec.lon, c.latitude, c.longitude);
    const secondi = (t - prec.t) / 1000;
    // Conta lo spostamento solo se è più grande dell'errore del GPS
    // (altrimenti stando fermi si "camminerebbe" lo stesso)
    const soglia = Math.max(4, (c.accuracy + prec.accuracy) / 3);
    if (c.accuracy < 60 && d > soglia) {
      sessione.distanza += d;
      salva("totDistanza", totali().distanza + d);
      if (!haVelocita && secondi > 0) kmh = (d / secondi) * 3.6;
      sessione.ultimo = { lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, t };
    }
  } else {
    sessione.ultimo = { lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, t };
  }

  if (kmh > 300) kmh = 0; // salto sballato del GPS
  sessione.velMax = Math.max(sessione.velMax, kmh);
  sessione.direzione = typeof c.heading === "number" && !isNaN(c.heading) ? c.heading : sessione.direzione;

  const campione = { t, kmh, acc: c.accuracy };
  sessione.campioni.push(campione);
  if (sessione.campioni.length > MAX_CAMPIONI) sessione.campioni.shift();
  return campione;
}

function aggiornaTempo() {
  const durata = sessione.inizio ? (sessione.fine && idWatch === null ? sessione.fine : Date.now()) - sessione.inizio : 0;
  $("s-tempo").textContent = formattaDurata(durata);
}

function aggiornaStatistiche() {
  const s = sessione;
  const n = s.campioni.length;

  $("s-dist").textContent = (s.distanza / 1000).toFixed(2);
  $("s-sub").textContent = idWatch !== null
    ? `Sessione in corso · ${n} rilevamenti`
    : n ? `Ultima sessione · ${n} rilevamenti` : "Avvia il sonar per raccogliere dati";
  aggiornaTempo();
  $("s-invii").textContent = s.invii;
  $("s-prec").textContent = n ? Math.round(s.campioni.reduce((a, c) => a + c.acc, 0) / n) : "—";
  $("s-vmax").textContent = n ? s.velMax.toFixed(1) : "—";

  // Indicatore qualità segnale (semicerchio)
  const arco = $("gauge-arco");
  const lunghezza = arco.getTotalLength();
  if (n) {
    const acc = s.campioni[n - 1].acc;
    // 5 m o meno = 100, 150 m o più = 0 (scala logaritmica)
    const punti = Math.round(Math.max(0, Math.min(100, 100 * (1 - Math.log(acc / 5) / Math.log(30)))));
    const q = qualita(acc);
    arco.style.strokeDasharray = `${(punti / 100) * lunghezza} ${lunghezza}`;
    arco.style.stroke = { ottimo: "var(--accento)", buono: "var(--blu)", discreto: "var(--giallo)", scarso: "var(--rosso)" }[q.stato];
    $("gauge-valore").textContent = punti;
    $("gauge-etichetta").textContent = q.testo;
    $("gauge-etichetta").dataset.stato = q.stato;
  } else {
    arco.style.strokeDasharray = `0 ${lunghezza}`;
  }

  // Bussola: usa la bussola del telefono se attiva, altrimenti la direzione di marcia
  const dir = bussolaAttiva ? orientamento : s.direzione;
  if (typeof dir === "number") {
    $("ago").style.transform = `rotate(${dir}deg)`;
    $("dir-testo").textContent = `${Math.round(dir)}° ${puntoCardinale(dir)}`;
  } else {
    $("dir-testo").textContent = "Fermo";
  }

  // Grafici
  graficoArea($("g-vel"), s.campioni.map((c) => ({ t: c.t, v: c.kmh })), "km/h", 1);
  graficoBarre($("g-prec"), s.campioni.slice(-40).map((c) => ({ t: c.t, v: c.acc })), "m");

  // Totali
  const tot = totali();
  $("s-tot-dist").textContent = `${(tot.distanza / 1000).toFixed(2)} km`;
  $("s-tot-tempo").textContent = `${Math.round((tot.tempo + (idWatch !== null ? Date.now() - s.inizio : 0)) / 60000)} min`;
  $("s-sessioni").textContent = tot.sessioni;
}

$("azzera").addEventListener("click", () => {
  if (!confirm("Vuoi azzerare tutte le statistiche di questo telefono?")) return;
  ["totDistanza", "totTempo", "totSessioni"].forEach((k) => salva(k, 0));
  const inCorso = idWatch !== null;
  sessione = sessioneVuota();
  if (inCorso) sessione.inizio = Date.now();
  aggiornaStatistiche();
  toast("Statistiche azzerate");
});

// ---------- Grafici disegnati in SVG ----------
const NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attributi, padre) {
  const el = document.createElementNS(NS, tag);
  for (const k in attributi) el.setAttribute(k, attributi[k]);
  padre?.appendChild(el);
  return el;
}

// Trova un valore "tondo" sopra il massimo, per l'asse Y (es. 7.3 → 10)
function massimoTondo(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

function preparaGrafico(svg, punti) {
  svg.innerHTML = "";
  const W = svg.clientWidth || 300;
  const H = svg.clientHeight || 150;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const area = { x: 30, y: 8, w: W - 38, h: H - 26 };

  if (punti.length < 2) {
    svgEl("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "vuoto" }, svg).textContent =
      "Servono almeno 2 rilevamenti";
    return null;
  }

  const max = massimoTondo(Math.max(...punti.map((p) => p.v)) * 1.1);
  const griglia = svgEl("g", { class: "griglia" }, svg);
  for (let i = 0; i <= 2; i++) {
    const v = (max / 2) * i;
    const y = area.y + area.h - (v / max) * area.h;
    svgEl("line", { x1: area.x, x2: area.x + area.w, y1: y, y2: y }, griglia);
    svgEl("text", { x: area.x - 6, y: y + 3, "text-anchor": "end", class: "asse" }, svg).textContent =
      v % 1 ? v.toFixed(1) : v;
  }
  // Etichette tempo: inizio e fine
  const ora = (t) => new Date(t).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  svgEl("text", { x: area.x, y: H - 4, class: "asse" }, svg).textContent = ora(punti[0].t);
  svgEl("text", { x: area.x + area.w, y: H - 4, "text-anchor": "end", class: "asse" }, svg).textContent =
    ora(punti[punti.length - 1].t);

  return { W, H, area, max, y: (v) => area.y + area.h - (v / max) * area.h };
}

// Grafico ad area con mirino e tooltip (velocità)
function graficoArea(svg, punti, unita, decimali) {
  const g = preparaGrafico(svg, punti);
  if (!g) return;
  const { area } = g;
  const x = (i) => area.x + (i / (punti.length - 1)) * area.w;

  const defs = svgEl("defs", {}, svg);
  const grad = svgEl("linearGradient", { id: "sfumatura-" + svg.id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  svgEl("stop", { offset: "0%", "stop-color": "#2af5c1", "stop-opacity": 0.35 }, grad);
  svgEl("stop", { offset: "100%", "stop-color": "#2af5c1", "stop-opacity": 0 }, grad);

  const linea = punti.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${g.y(p.v).toFixed(1)}`).join(" ");
  const fondo = area.y + area.h;
  svgEl("path", { d: `${linea} L${x(punti.length - 1)},${fondo} L${x(0)},${fondo} Z`, fill: `url(#sfumatura-${svg.id})` }, svg);
  svgEl("path", { d: linea, class: "linea" }, svg);

  // Etichetta diretta solo sull'ultimo valore
  const ultimo = punti[punti.length - 1];
  svgEl("circle", { cx: x(punti.length - 1), cy: g.y(ultimo.v), r: 4, class: "punto-ultimo" }, svg);
  svgEl("text", { x: x(punti.length - 1) - 8, y: g.y(ultimo.v) - 9, "text-anchor": "end", class: "etichetta-ultima" }, svg)
    .textContent = ultimo.v.toFixed(decimali);

  // Mirino
  const mirino = svgEl("g", { visibility: "hidden" }, svg);
  const lineaV = svgEl("line", { y1: area.y, y2: fondo, class: "croce-v" }, mirino);
  const cerchio = svgEl("circle", { r: 4.5, class: "punto-ultimo" }, mirino);
  attivaTooltip(svg, punti, x, (i) => {
    lineaV.setAttribute("x1", x(i));
    lineaV.setAttribute("x2", x(i));
    cerchio.setAttribute("cx", x(i));
    cerchio.setAttribute("cy", g.y(punti[i].v));
    mirino.setAttribute("visibility", "visible");
    return `${punti[i].v.toFixed(decimali)} ${unita}`;
  }, () => mirino.setAttribute("visibility", "hidden"));
}

// Grafico a barre con tooltip (precisione)
function graficoBarre(svg, punti, unita) {
  const g = preparaGrafico(svg, punti);
  if (!g) return;
  const { area } = g;
  const passo = area.w / punti.length;
  const larghezza = Math.max(2, passo - 2); // 2px di spazio tra le barre
  const x = (i) => area.x + passo * i + passo / 2;
  const fondo = area.y + area.h;

  const barre = punti.map((p, i) => {
    const h = Math.max(2, fondo - g.y(p.v));
    const r = Math.min(3, larghezza / 2);
    const bx = x(i) - larghezza / 2;
    const by = fondo - h;
    // Barra con gli angoli arrotondati solo in alto
    const d = `M${bx},${fondo} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + larghezza - r} Q${bx + larghezza},${by} ${bx + larghezza},${by + r} V${fondo} Z`;
    return svgEl("path", { d, class: "barra" }, svg);
  });

  let evidenziata = null;
  attivaTooltip(svg, punti, x, (i) => {
    evidenziata?.classList.remove("evidenziata");
    evidenziata = barre[i];
    evidenziata.classList.add("evidenziata");
    return `±${Math.round(punti[i].v)} ${unita}`;
  }, () => evidenziata?.classList.remove("evidenziata"));
}

// Mostra il tooltip toccando o passando sopra un grafico
function attivaTooltip(svg, punti, x, alPunto, allUscita) {
  const tip = svg.parentElement.querySelector(".tooltip");
  const muovi = (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * (svg.viewBox.baseVal.width || box.width);
    let i = 0;
    punti.forEach((_, j) => { if (Math.abs(x(j) - px) < Math.abs(x(i) - px)) i = j; });
    const testo = alPunto(i);
    const ora = new Date(punti[i].t).toLocaleTimeString("it-IT");
    tip.innerHTML = `${testo} <span>· ${ora}</span>`;
    tip.style.left = `${Math.min(Math.max((x(i) / svg.viewBox.baseVal.width) * box.width, 60), box.width - 60)}px`;
    tip.hidden = false;
  };
  const esci = () => { tip.hidden = true; allUscita(); };
  svg.onpointermove = muovi;
  svg.onpointerdown = muovi;
  svg.onpointerleave = esci;
  svg.onpointerup = (e) => { if (e.pointerType !== "mouse") setTimeout(esci, 1500); };
}

// =====================================================================
//  SCHERMATA 2: TROVA — mappa e radar per un dispositivo
// =====================================================================
let mappa = null;
let marker = null;
let markerIo = null;
let cerchio = null;
let codiceSeguito = null;   // il dispositivo che stiamo guardando
let primaVolta = true;      // per centrare la mappa solo al primo arrivo
let ultimiDati = null;      // l'ultima posizione ricevuta
let mioPunto = null;        // la MIA posizione (serve per distanza e radar)
let idWatchMio = null;

function preparaMappa() {
  if (mappa) return;
  mappa = L.map("mappa", { zoomControl: true, attributionControl: true, zoomSnap: 0.25 }).setView([41.9, 12.5], 5);
  // Mappa di OpenStreetMap (gratuita); la rendiamo scura con un filtro CSS in style.css
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  }).addTo(mappa);
}

const iconaSonar = (classe = "") => L.divIcon({
  className: `marker-sonar ${classe}`,
  html: "<i></i><i></i><i></i><span class='punto'></span>",
  iconSize: [20, 20]
});

$("codice-cerca").value = leggi("codiceCerca") || "";
$("cerca").addEventListener("click", () => segui($("codice-cerca").value.trim().toLowerCase()));
$("codice-cerca").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("cerca").click();
});

function segui(codice) {
  if (DEMO) return demoSegui(codice);
  if (!db) return toast("Prima configura Firebase in config.js");
  if (codice.length < 16) return toast("Codice troppo corto: controlla di averlo copiato tutto");

  // Smetti di ascoltare il dispositivo precedente
  if (codiceSeguito) off(ref(db, `devices/${codiceSeguito}`));

  codiceSeguito = codice;
  primaVolta = true;
  ultimiDati = null;
  salva("codiceCerca", codice);
  $("codice-cerca").blur();
  seguiLaMiaPosizione();

  // onValue viene chiamato subito e poi ogni volta che i dati cambiano
  onValue(ref(db, `devices/${codice}`), (snap) => {
    const d = snap.val();
    if (!d || typeof d.lat !== "number") {
      $("scheda").hidden = false;
      $("d-nome").textContent = "Nessun segnale";
      $("d-agg").textContent = "Il dispositivo non ha ancora trasmesso la posizione";
      $("d-live").textContent = "OFFLINE";
      $("d-live").classList.remove("live");
      return;
    }
    aggiornaTarget(d);
  }, (errore) => toast("Errore dal database: " + errore.message));
}

function aggiornaTarget(d) {
  ultimiDati = d;
  const punto = [d.lat, d.lon];

  if (!marker) {
    cerchio = L.circle(punto, { radius: d.accuracy, color: "#2af5c1", weight: 1, fillOpacity: 0.08 }).addTo(mappa);
    marker = L.marker(punto, { icon: iconaSonar() }).addTo(mappa);
  } else {
    marker.setLatLng(punto);
    cerchio.setLatLng(punto).setRadius(d.accuracy);
  }

  if (primaVolta) {
    mappa.setView(punto, 16);
    primaVolta = false;
  }
  $("centra").hidden = false;
  aggiornaScheda(d);
}

function aggiornaScheda(d) {
  const recente = Date.now() - d.ts < 60000;
  $("scheda").hidden = false;
  $("d-nome").textContent = d.nome || "Senza nome";
  $("d-agg").textContent = `Ultimo segnale ${quantoTempoFa(d.ts)}`;
  $("d-live").textContent = recente ? "● LIVE" : "OFFLINE";
  $("d-live").classList.toggle("live", recente);
  $("d-prec").textContent = `±${d.accuracy} m`;
  $("d-vel").textContent = typeof d.speed === "number" ? `${(d.speed * 3.6).toFixed(1)} km/h` : "—";
  $("indicazioni").href = `https://maps.apple.com/?daddr=${d.lat},${d.lon}`;
  $("suona-testo").textContent = d.ring ? "Sta suonando…" : "Fai suonare";
  $("suona").classList.toggle("attivo", !!d.ring);

  if (mioPunto) {
    $("d-dist").textContent = formattaDistanza(distanza(mioPunto.lat, mioPunto.lon, d.lat, d.lon));
    const dir = direzione(mioPunto.lat, mioPunto.lon, d.lat, d.lon);
    $("d-dir").textContent = `${Math.round(dir)}° ${puntoCardinale(dir)}`;
  } else {
    $("d-dist").textContent = "—";
    $("d-dir").textContent = "—";
  }
}

// La mia posizione serve per distanza, direzione e radar
function seguiLaMiaPosizione() {
  if (DEMO) return;
  if (idWatchMio !== null || !("geolocation" in navigator)) return;
  idWatchMio = navigator.geolocation.watchPosition((p) => {
    mioPunto = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy };
    if (mappa) {
      if (!markerIo) markerIo = L.marker([mioPunto.lat, mioPunto.lon], { icon: iconaSonar("marker-io") }).addTo(mappa);
      else markerIo.setLatLng([mioPunto.lat, mioPunto.lon]);
    }
    if (ultimiDati) aggiornaScheda(ultimiDati);
  }, () => {}, { enableHighAccuracy: true, maximumAge: 5000 });
}

$("centra").addEventListener("click", () => {
  if (ultimiDati) mappa.flyTo([ultimiDati.lat, ultimiDati.lon], 17, { duration: 0.8 });
  else if (segnale) mappa.flyToBounds(segnale[0].getBounds(), { padding: [16, 16], duration: 0.8 });
});

$("suona").addEventListener("click", () => {
  if (!codiceSeguito) return;
  if (DEMO) {
    ultimiDati.ring = !ultimiDati.ring;
    return aggiornaScheda(ultimiDati);
  }
  update(ref(db, `devices/${codiceSeguito}`), { ring: !ultimiDati?.ring })
    .catch((e) => toast("Non riesco a farlo suonare: " + e.message));
});

// Aggiorna la scritta "x min fa" ogni 15 secondi
setInterval(() => {
  if (ultimiDati) aggiornaScheda(ultimiDati);
}, 15000);

// ---------- Mappa / Radar ----------
let vista = "mappa";
document.querySelectorAll(".segmenti button").forEach((b) => {
  b.addEventListener("click", () => impostaVista(b.dataset.vista));
});

function impostaVista(nuova) {
  vista = nuova;
  document.querySelector(".segmenti").dataset.vista = vista;
  document.querySelectorAll(".segmenti button").forEach((x) => x.classList.toggle("attivo", x.dataset.vista === vista));
  $("vista-mappa").classList.toggle("attiva", vista === "mappa");
  $("vista-radar").classList.toggle("attiva", vista === "radar");
  if (vista === "radar") { seguiLaMiaPosizione(); avviaRadar(); }
  else { fermaRadar(); mappa?.invalidateSize(); }
}

// =====================================================================
//  RILEVA SEGNALE: apre la mappa sulla mia posizione con un cerchio blu
// =====================================================================
let segnale = null; // i livelli del cerchio sulla mappa

$("rileva").addEventListener("click", rilevaSegnale);

async function rilevaSegnale() {
  const bottone = $("rileva");
  if (bottone.classList.contains("in-corso")) return;
  bottone.classList.add("in-corso");
  $("rileva-testo").textContent = "Rilevamento…";

  try {
    const pos = await leggiPosizioneAttuale();
    apriTab("tab-trova");
    impostaVista("mappa");
    // aspetta che la mappa sia visibile prima di spostarla
    setTimeout(() => mostraSegnale(pos), 120);
  } catch (errore) {
    if (!window.isSecureContext) {
      toast("Safari dà il GPS solo su indirizzi https://. Funzionerà quando la pubblichi su GitHub Pages (oppure prova con ?demo).");
    } else if (errore.code === 1) {
      toast("Permesso negato. Impostazioni → Privacy → Localizzazione → Safari.");
    } else {
      toast("Non riesco a trovare il segnale GPS, riprova all'aperto.");
    }
  } finally {
    bottone.classList.remove("in-corso");
    $("rileva-testo").textContent = "Rileva segnale";
  }
}

// Restituisce { lat, lon, accuracy } della posizione di adesso
function leggiPosizioneAttuale() {
  if (DEMO) {
    return Promise.resolve({ lat: 45.4642 + (Math.random() - 0.5) * 0.001, lon: 9.19 + (Math.random() - 0.5) * 0.001, accuracy: 25 + Math.random() * 40 });
  }
  return new Promise((ok, ko) => {
    if (!("geolocation" in navigator)) return ko(new Error("no gps"));
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      ko,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

function mostraSegnale({ lat, lon, accuracy }) {
  preparaMappa();
  mappa.invalidateSize();
  mioPunto = { lat, lon, accuracy };

  // Il cerchio è grande: almeno 120 m, o di più se il GPS è impreciso
  const raggio = Math.max(120, accuracy * 1.5);
  const centro = [lat, lon];

  if (segnale) segnale.forEach((l) => l.remove());
  segnale = [
    // alone blu sfocato (il colore sfuma dal centro verso il bordo, vedi gradiente sotto)
    L.circle(centro, { radius: raggio, stroke: false, fillColor: "url(#gradiente-segnale)", fillOpacity: 1, className: "segnale-alone" }),
    // bordo tratteggiato tipo "range"
    L.circle(centro, { radius: raggio, fill: false, color: "#44a8ff", weight: 1.5, opacity: 0.7, dashArray: "4 7", interactive: false }),
    // cerchio interno = precisione reale del GPS
    L.circle(centro, { radius: accuracy, fill: false, color: "#44a8ff", weight: 1, opacity: 0.35, interactive: false }),
    // il punto che pulsa al centro
    L.marker(centro, { icon: iconaSonar("marker-io"), interactive: false })
  ];
  segnale.forEach((l) => l.addTo(mappa));
  aggiungiGradienteSegnale();

  const ora = new Date().toLocaleTimeString("it-IT");
  segnale[0].bindPopup(
    `<b>Sei qui</b><br>Precisione ±${Math.round(accuracy)} m<br>Rilevato alle ${ora}`,
    { className: "popup-scuro", closeButton: false }
  );

  mappa.flyToBounds(segnale[0].getBounds(), { padding: [16, 16], duration: 1 });
  $("centra").hidden = false;
  if (ultimiDati) aggiornaScheda(ultimiDati);
  toast(`Segnale rilevato · precisione ±${Math.round(accuracy)} m`);
}

// Crea (una volta sola) il gradiente blu "sfocato" dentro l'SVG della mappa
function aggiungiGradienteSegnale() {
  const svg = mappa.getPanes().overlayPane.querySelector("svg");
  if (!svg || svg.querySelector("#gradiente-segnale")) return;
  const defs = svgEl("defs", {}, null);
  const grad = svgEl("radialGradient", { id: "gradiente-segnale" }, defs);
  svgEl("stop", { offset: "0%", "stop-color": "#44a8ff", "stop-opacity": 0.75 }, grad);
  svgEl("stop", { offset: "40%", "stop-color": "#44a8ff", "stop-opacity": 0.45 }, grad);
  svgEl("stop", { offset: "80%", "stop-color": "#44a8ff", "stop-opacity": 0.14 }, grad);
  svgEl("stop", { offset: "100%", "stop-color": "#44a8ff", "stop-opacity": 0 }, grad);
  svg.insertBefore(defs, svg.firstChild);
}

// ---------- Bussola del telefono ----------
let bussolaAttiva = false;
let orientamento = 0; // gradi: 0 = il telefono punta a Nord

$("bussola").addEventListener("click", async () => {
  try {
    // Su iPhone serve chiedere il permesso
    if (typeof DeviceOrientationEvent?.requestPermission === "function") {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== "granted") return toast("Permesso bussola negato");
    }
    window.addEventListener("deviceorientation", (e) => {
      if (typeof e.webkitCompassHeading === "number") orientamento = e.webkitCompassHeading;
      else if (e.absolute && typeof e.alpha === "number") orientamento = 360 - e.alpha;
      else return;
      bussolaAttiva = true;
    });
    $("bussola").hidden = true;
    toast("Bussola attiva: ruota il telefono");
  } catch {
    toast("Bussola non disponibile su questo dispositivo");
  }
});

// ---------- Radar disegnato su canvas ----------
const canvas = $("radar-trova");
const ctx = canvas.getContext("2d");
let animazione = null;

function avviaRadar() {
  if (animazione) return;
  const ciclo = (t) => {
    disegnaRadar(t);
    animazione = requestAnimationFrame(ciclo);
  };
  animazione = requestAnimationFrame(ciclo);
}

function fermaRadar() {
  cancelAnimationFrame(animazione);
  animazione = null;
}

// Sceglie un raggio "tondo" per il radar: 50 m, 100 m, 200 m, 500 m, 1 km...
function scalaRadar(metri) {
  const passi = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 500000, 1000000, 5000000];
  return passi.find((p) => p >= metri * 1.25) || passi[passi.length - 1];
}

function disegnaRadar(tempo) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2;
  const cy = H / 2 - 10;
  const R = Math.min(W, H) / 2 - 28;
  const verde = "42, 245, 193";
  const rotazione = bussolaAttiva ? -orientamento : 0; // con la bussola il radar gira col telefono
  const rad = Math.PI / 180;

  // Calcola dove si trova il bersaglio
  let bersaglio = null;
  if (ultimiDati && mioPunto) {
    const d = distanza(mioPunto.lat, mioPunto.lon, ultimiDati.lat, ultimiDati.lon);
    const dir = direzione(mioPunto.lat, mioPunto.lon, ultimiDati.lat, ultimiDati.lon);
    bersaglio = { d, dir, scala: scalaRadar(d) };
  }
  const scala = bersaglio ? bersaglio.scala : 100;

  // Anelli con le distanze
  ctx.lineWidth = 1;
  ctx.font = "500 10px 'JetBrains Mono', monospace";
  for (let i = 1; i <= 4; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${verde}, ${i === 4 ? 0.4 : 0.15})`;
    ctx.setLineDash(i === 4 ? [] : [3, 5]);
    ctx.stroke();
    // etichetta in diagonale (in basso a destra), lontana dalle lettere N/E/S/O
    ctx.fillStyle = `rgba(${verde}, 0.55)`;
    ctx.fillText(formattaDistanza((scala * i) / 4), cx + ((R * i) / 4) * 0.707 + 4, cy + ((R * i) / 4) * 0.707 + 4);
  }
  ctx.setLineDash([]);

  // Tacche ogni 10° e lettere cardinali (ruotano con la bussola)
  for (let g = 0; g < 360; g += 10) {
    const a = (g + rotazione - 90) * rad;
    const lungo = g % 90 === 0 ? 10 : g % 30 === 0 ? 6 : 3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.lineTo(cx + Math.cos(a) * (R - lungo), cy + Math.sin(a) * (R - lungo));
    ctx.strokeStyle = `rgba(${verde}, ${g % 90 === 0 ? 0.8 : 0.3})`;
    ctx.stroke();
  }
  ctx.font = "600 11px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  [["N", 0], ["E", 90], ["S", 180], ["O", 270]].forEach(([l, g]) => {
    const a = (g + rotazione - 90) * rad;
    ctx.fillStyle = l === "N" ? "#ff4d6d" : `rgba(${verde}, 0.7)`;
    ctx.fillText(l, cx + Math.cos(a) * (R + 14), cy + Math.sin(a) * (R + 14));
  });

  // Fascio che gira
  const angoloFascio = ((tempo / 1000) * 120) % 360; // 120°/s
  const a0 = (angoloFascio - 90) * rad;
  if (ctx.createConicGradient) {
    const cg = ctx.createConicGradient(a0 - Math.PI / 2.2, cx, cy);
    cg.addColorStop(0, `rgba(${verde}, 0)`);
    cg.addColorStop(0.27, `rgba(${verde}, 0.35)`);
    cg.addColorStop(0.2727, `rgba(${verde}, 0)`);
    cg.addColorStop(1, `rgba(${verde}, 0)`);
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
  ctx.strokeStyle = `rgba(${verde}, 0.9)`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Io al centro (blu)
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#44a8ff";
  ctx.shadowColor = "#44a8ff";
  ctx.shadowBlur = 12;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Il bersaglio: si illumina quando il fascio ci passa sopra
  ctx.textAlign = "center";
  if (bersaglio) {
    const r = Math.min(1, bersaglio.d / bersaglio.scala) * R;
    const angolo = bersaglio.dir + rotazione;
    const bx = cx + Math.cos((angolo - 90) * rad) * r;
    const by = cy + Math.sin((angolo - 90) * rad) * r;
    const ritardo = (((angoloFascio - angolo) % 360) + 360) % 360; // gradi da quando il fascio è passato
    const luce = Math.max(0.25, 1 - ritardo / 300);

    ctx.beginPath();
    ctx.arc(bx, by, 6 + (1 - luce) * 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${verde}, ${luce})`;
    ctx.shadowColor = `rgb(${verde})`;
    ctx.shadowBlur = 20 * luce;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(bx, by, 12 + ritardo / 12, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${verde}, ${luce * 0.5})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = "600 11px 'Space Grotesk', sans-serif";
    ctx.fillStyle = "#e6f0fb";
    ctx.fillText((ultimiDati.nome || "").slice(0, 18), bx, by - 18);

    // Lettura in basso
    ctx.font = "600 22px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#e6f0fb";
    ctx.fillText(formattaDistanza(bersaglio.d), cx, H - 34);
    ctx.font = "500 11px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#8396ab";
    ctx.fillText(`DIREZIONE ${Math.round(bersaglio.dir)}° ${puntoCardinale(bersaglio.dir)}`, cx, H - 14);
  } else {
    ctx.font = "600 11px 'JetBrains Mono', monospace";
    ctx.fillStyle = `rgba(${verde}, ${0.5 + 0.3 * Math.sin(tempo / 300)})`;
    const msg = !codiceSeguito ? "INSERISCI UN CODICE" : !mioPunto ? "CERCO LA TUA POSIZIONE…" : "IN ATTESA DI SEGNALE…";
    ctx.fillText(msg, cx, H - 20);
  }
}

// =====================================================================
//  AVVIO
// =====================================================================

// Se apri l'app con un link tipo ...?trova=CODICE va direttamente sulla mappa
const daLink = new URLSearchParams(location.search).get("trova");
if (daLink) {
  $("codice-cerca").value = daLink;
  apriTab("tab-trova");
  segui(daLink);
}

// =====================================================================
//  MODALITÀ DEMO (?demo): posizioni finte intorno al Duomo di Milano
// =====================================================================

// Simula il GPS: una passeggiata in cerchio con precisione variabile
function demoGps(callback) {
  let passo = 0;
  const giro = () => {
    passo++;
    const a = passo / 25;
    const acc = 6 + Math.abs(Math.sin(passo / 7)) * 30 + Math.random() * 8;
    callback({
      timestamp: Date.now(),
      coords: {
        latitude: 45.4642 + Math.sin(a) * 0.002,
        longitude: 9.19 + Math.cos(a) * 0.003,
        accuracy: acc,
        speed: 1 + Math.abs(Math.sin(passo / 9)) * 3 + Math.random() * 0.6,
        heading: ((a * 180) / Math.PI + 90) % 360,
        altitude: 120 + Math.sin(passo / 10) * 4
      }
    });
  };
  giro();
  return setInterval(giro, 1500);
}

// Simula un dispositivo da trovare, che si muove vicino a te
function demoSegui(codice) {
  codiceSeguito = codice || "demo";
  primaVolta = true;
  mioPunto = { lat: 45.4642, lon: 9.19, accuracy: 8 };
  if (!markerIo) markerIo = L.marker([mioPunto.lat, mioPunto.lon], { icon: iconaSonar("marker-io") }).addTo(mappa);
  let t = 0;
  const muovi = () => {
    t++;
    aggiornaTarget({
      nome: "iPhone di prova",
      lat: 45.4668 + Math.sin(t / 20) * 0.0015,
      lon: 9.1935 + Math.cos(t / 20) * 0.002,
      accuracy: 12,
      speed: 1.3,
      ts: Date.now(),
      ring: ultimiDati?.ring || false
    });
  };
  muovi();
  clearInterval(demoSegui.timer);
  demoSegui.timer = setInterval(muovi, 3000);
}

if (DEMO) {
  $("pillola-testo").textContent = "DEMO";
  toast("Modalità demo: i dati sono simulati");
}
