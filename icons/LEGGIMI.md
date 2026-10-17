# Trova 📡

Una mini "Trova il mio iPhone" fatta in HTML + JavaScript.
Un telefono **condivide** la sua posizione, un altro (o un computer) la **vede sulla mappa** e può farlo **suonare**.

## Provala subito (modalità demo)

Apri la pagina aggiungendo `?demo` all'indirizzo (es. `http://127.0.0.1:5500/index.html?demo` con Live Server).
I dati sono finti (una passeggiata intorno al Duomo di Milano) e Firebase non serve:
premi **AVVIA** sul radar, poi guarda **Statistiche** e **Trova** (scrivi un codice qualsiasi e premi *Traccia*).

## Le tre schermate

- **Sonar**: il radar per avviare la condivisione, i dati GPS in tempo reale e il tuo codice segreto
- **Trova**: mappa scura oppure **radar** che mostra dove si trova il dispositivo rispetto a te
  (con *Attiva bussola* il radar ruota insieme al telefono)
- **Statistiche**: distanza percorsa, tempo, velocità massima, qualità del segnale, bussola e grafici

## I file

| File | A cosa serve |
|---|---|
| `index.html` | Le due schermate (Condividi e Trova) e la barra in basso |
| `style.css` | La grafica (tema scuro "sonar") |
| `app.js` | Tutta la logica: GPS, invio a Firebase, mappa, radar, statistiche, squillo |
| `config.js` | **I dati del tuo progetto Firebase (da compilare)** |
| `manifest.json` + `icons/` | Servono per installarla come app sulla schermata Home |
| `database.rules.json` | Le regole di sicurezza da incollare in Firebase |

---

## Passo 1: crea il database su Firebase

1. Vai su **console.firebase.google.com** ed entra con un account Google
2. **Crea un progetto** (es. `trova`). Google Analytics non serve: puoi disattivarlo
3. Nel menu a sinistra: **Build → Realtime Database → Crea database**
   - posizione: **Belgio (europe-west1)**
   - modalità: **blocco** (le regole le mettiamo noi tra un attimo)
4. Nella scheda **Regole** cancella tutto, incolla il contenuto di `database.rules.json` e premi **Pubblica**
5. Torna alla home del progetto, clicca l'icona **`</>`** (aggiungi app Web), dai un nome e registrala.
   Hosting di Firebase non serve
6. Ti mostra un blocco `const firebaseConfig = { ... }`: copia i valori dentro **`config.js`**
   (controlla che ci sia anche `databaseURL`)

> 🔐 L'`apiKey` di Firebase non è un segreto: finisce comunque dentro la pagina.
> A proteggere i dati sono le **regole** del database e il **codice segreto** di ogni telefono.

## Passo 2: pubblica la pagina su GitHub Pages

1. Crea un account su **github.com**
2. **New repository** → nome es. `trova` → **Public** → Create
3. **Add file → Upload files**: trascina *tutti* i file e la cartella `icons` → **Commit changes**
4. **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main`, cartella `/ (root)` → Save
5. Dopo un minuto la trovi su `https://TUONOME.github.io/trova/` (con HTTPS, quindi il GPS funziona)

Ogni volta che modifichi un file, ricaricalo su GitHub: dopo circa un minuto la pagina si aggiorna.

## Passo 3: installala sull'iPhone

1. Apri il link con **Safari**
2. **Condividi** (il quadrato con la freccia) → **Aggiungi alla schermata Home**
3. Aprila dall'icona, scrivi un nome, premi **Inizia a condividere** e consenti la posizione

## Passo 4: trovalo

Su un altro telefono o sul computer apri l'app → **Trova** → incolla il codice segreto → **Cerca**.
Scorciatoia: il link `https://TUONOME.github.io/trova/?trova=CODICE` apre direttamente la mappa.

---

## Limiti da conoscere

- **Funziona solo con l'app aperta e lo schermo acceso.** iOS sospende le pagine web in background.
  L'app chiede di tenere acceso lo schermo mentre condivide.
- **Lo squillo** suona solo se l'app è aperta e hai premuto "Inizia" (iOS blocca l'audio senza un tocco).
  Con la modalità silenziosa attiva potrebbe non sentirsi.

## Idee per esercitarti

- [ ] Mostrare **più dispositivi** sulla mappa (una lista di codici salvati)
- [ ] Salvare lo **storico** e disegnare il percorso con `L.polyline`
- [ ] Un bottone **"Centra"** che riporta la mappa sul dispositivo
- [ ] Un bottone **"Nuovo codice"** per cambiare il codice segreto
- [ ] Mostrare **la tua** posizione sulla mappa e la distanza dal dispositivo (`mappa.distance(a, b)`)
- [ ] Marker personalizzato con l'emoji 📱 (`L.divIcon`)
