# Workout

Web app (PWA) per gestire schede di allenamento, dieta settimanale e conversioni tra alimenti.
Funziona interamente nel browser: i dati restano sul dispositivo (localStorage) e si possono esportare/importare come backup JSON.

**Live:** https://felixone04.github.io/workout-app/

## Funzioni

- **Allenamento** – schede per giornata, esercizi classici o superset con peso/ripetizioni per ogni serie, registro delle sessioni con storico e record, riordino esercizi, calendario degli allenamenti.
- **Condivisione** – una scheda si condivide con un link o un QR (i dati viaggiano nel link, nessun server); le schede si importano anche incollando il testo del personal trainer.
- **Timer** – cronometro libero o circuito (serie / lavoro / recupero) con suoni a volume regolabile, voce guida (conto alla rovescia e annuncio delle fasi), vibrazione e schermo sempre acceso. Suoni e voce si possono disattivare.
- **Dieta** – pasti per ogni giorno della settimana con calorie e carboidrati/proteine/grassi calcolati su tutti i valori di ogni alimento; sostituzione di un alimento con un equivalente mostrando la variazione di tutti i macro.
- **Peso corporeo** – una pesata al giorno con storico, grafico e media a 7 giorni.
- **Conversioni** – convertitore tra alimenti con lo stesso macro e database di alimenti personali.
- Tema chiaro/scuro, installabile sulla schermata Home, funziona offline.

## Struttura

| File | Contenuto |
| --- | --- |
| `index.html` | Struttura della pagina, stile e finestre modali |
| `js/app.js` | Logica dell'app (dati, viste, timer, backup) |
| `js/foods.js` | Database alimenti predefinito (grammi di macro per 100 g) |
| `js/share.js` | Condivisione schede via link/QR e importazione da testo || `sw.js` | Service worker per l'uso offline |
| `manifest.webmanifest`, `icons/` | Installazione come app |

Nessuna build: basta pubblicare la cartella (GitHub Pages dal branch `main`).
Quando si modificano i file dell'app, aumentare `CACHE` in `sw.js` e `APP_VERSION` in `js/app.js`.
