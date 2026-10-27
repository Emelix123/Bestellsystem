# Bestellsystem für Vereinsfeste – Plan

Stand: v2 – Entscheidungen getroffen, Etappen 1–4 umgesetzt (siehe unten).
Ursprünglicher Entwurf (v1) ab Kapitel 0, ergänzt um die getroffenen Entscheidungen.

## Entscheidungen (Abstimmung nach v1)

| Frage | Entscheidung | Umsetzung |
|---|---|---|
| Weg aus Kapitel 0 | **B** – Bedienung kassiert bar, System ohne Zahlungsfunktion | Es werden keine Zahlungen gespeichert. Die Rechnungshilfe ist ein reiner Rechner, pro Verein ein- und ausschaltbar (Standard: aus). Euro-Werte in der Statistik sind separat schaltbar (Standard: aus). |
| Küche mit Tablet | Bon kommt, wenn die Küche **„Fertig“** drückt | Druck-Zeitpunkt pro Station: sofort / beim Annehmen / beim Fertigmelden / nie |
| Betrieb | **lokal**, vorhandenes WLAN-Intranet | Docker Compose auf einem Rechner im Netz, kein Internet nötig |
| Mandanten | **pro Verein unterschiedlich** | vollständige Mandantentrennung, Einstellungen pro Verein |
| Varianten, Extras, Pfand | **ja** | Optionsgruppen (eine/mehrere, Pflicht, Auf-/Abpreis), Pfand pro Produkt, Pfand-Rückgabe in der Rechnungshilfe |
| Drucker | **nur USB** (WLAN-Drucker waren unzuverlässig) | **Druck-Agent** auf einem kleinen Rechner am Drucker (siehe unten) |
| Sprache/Wartung | TypeScript | wie vorgeschlagen |

### Was sich durch „nur USB-Drucker“ an der Architektur geändert hat

Ein USB-Drucker hängt an genau einem Rechner. Küche, Schank und Bierstand liegen
aber auseinander, und USB-Kabel enden nach ein paar Metern. Deshalb läuft neben jedem
Drucker (oder jeder Druckergruppe) ein **Druck-Agent**, z. B. auf einem Raspberry Pi.
Der Agent baut selbst eine **WebSocket-Verbindung zum Server** auf und bekommt
Aufträge sofort gepusht. Es gibt kein Polling und keine Portfreigaben. Die Aufträge
liegen weiterhin in der Datenbank und gehen nicht verloren, wenn Agent, Drucker oder
WLAN kurz weg sind.

Ehrlicher Hinweis: Der Raspberry Pi hängt dann selbst am Netz, idealerweise per
Kabel, sonst per WLAN. Der Unterschied zu WLAN-Druckern ist, dass Aussetzer jetzt
**abgefangen** werden: Der Bon kommt verspätet, aber er kommt, in der richtigen
Reihenfolge und ohne Doppeldruck. Am Admin-Bildschirm sieht man sofort, welcher
Drucker gerade nicht erreichbar ist.

## Umsetzungsstand

| Etappe | Stand |
|---|---|
| 1 – Grundgerüst, Bestellen & Drucken | ✅ fertig |
| 2 – Stationen mit Tablet-Warteschlange, Storno, Nachdruck, Ausverkauft | ✅ fertig |
| 3 – To-Go mit Abholnummern, Abholbon, Abholmonitor | ✅ fertig |
| 4 – Statistik, Diagramme, Excel/CSV-Export | ✅ fertig |
| 5 – Mandanten, Rollen, Offline-Puffer, Backups, Betriebsanleitung | ✅ weitgehend. Offen: PostgreSQL-Row-Level-Security als zweite Sicherung (die Trennung erfolgt derzeit in jeder Abfrage und ist durch Tests abgedeckt), Lasttest mit vielen Geräten |
| Mehrere Druck-Rechner an verschiedenen Standorten, auch **Windows** | ✅ fertig: ein Agent pro Rechner; unter Windows Druck über die Windows-Druckerwarteschlange im RAW-Modus, Installation per PowerShell-Skript als geplante Aufgabe |
| Mit echter Hardware testen | ⏳ **muss bei euch passieren**: USB-Drucker, Umlaute, Schneidwerk, WLAN-Abdeckung (Checkliste in `docs/BETRIEB.md`). **Windows-Druck** ist nur mit simuliertem Druckdienst getestet. |

Bewusst **nicht** gebaut: Zahlungen erfassen, Kassenabschluss, Bedienungsabrechnung in
Euro (siehe Kapitel 0).

---

---

## 0. Ehrliche Vorbemerkung: TSE und "kein Kassensystem"

Das muss vor allem anderen geklärt werden, weil es die Architektur beeinflusst.

**Für das Finanzamt zählt nicht der Name, sondern die Funktion.** Laut
Anwendungserlass zu § 146a AO hat ein elektronisches Aufzeichnungssystem eine
*Kassenfunktion*, wenn es der Erfassung und Abwicklung von zumindest teilweise
baren Zahlungsvorgängen *dienen kann*. Ausdrücklich gilt das auch für Bons,
Wertmarken o. Ä., die an Geldes statt angenommen werden. Ob das Ding im Menü
"Bestellsystem" heißt, ist egal.

Meine Einschätzung der gewünschten Funktionen (keine Rechtsberatung, ich bin
kein Steuerberater):

| Funktion | Einschätzung |
|---|---|
| Bestellung aufnehmen und an Drucker/Tablets verteilen, **keine** Zahlungen im System | reines Bestellsystem, unkritisch |
| Statistik über **Stückzahlen**, Zeiten, Auslastung | unkritisch |
| Statistik/Export über **Umsätze in €** | Grauzone: zeigt, dass Umsätze erfasst werden |
| **Rechnungshilfe** am Tisch (Summe, getrennt zahlen, Rückgeld) | Grauzone bis kritisch: dient der Abwicklung der Barzahlung |
| Abrechnung "Bedienung X muss Y € abliefern" | Grauzone bis kritisch |
| **To-Go-Kasse**, an der bar kassiert wird | Das ist eine Kasse. Da gibt es nichts zu deuten. |

Was passiert, wenn ein System mit Kassenfunktion ohne TSE läuft: Ordnungs­widrigkeit
(§ 379 AO, bis 25.000 €). Bei einer Kassen-Nachschau kann außerdem die
Kassenführung verworfen und **geschätzt** werden, und das ist meistens teurer als
das Bußgeld. Seit 2025 gibt es zusätzlich die Mitteilungspflicht für elektronische
Kassen an das Finanzamt.

**Die gute Nachricht:** In Deutschland gibt es keine Registrierkassenpflicht. Eine
*offene Ladenkasse* (Geldkassette + Kassenbericht) ist legal und braucht keine TSE.
Das Ziel "ohne TSE" ist also legitim erreichbar, nur eben nicht, indem man eine
Kasse anders benennt.

### Drei saubere Wege

**A) Wertmarken-Modell (am saubersten)**
Geld fließt nur an einer Bon-Kasse (offene Ladenkasse, Wertmarken nummeriert →
Kassenbericht ist einfach). Das Bestellsystem kennt keine Zahlungen, nur
Bestellungen. To-Go: Gast zahlt mit Wertmarken, das System vergibt nur die
Abholnummer.

**B) Bedienung kassiert bar, System ohne Zahlungsfunktion**
Klassisches Fest mit Kellnerbrieftasche. Das System routet nur Bestellungen.
Rechnungshilfe und Bedienungs-Abrechnung sind hier die Grauzone; vor dem Einsatz
mit Steuerberater oder Finanzamt klären.

**C) TSE einbauen (Cloud-TSE, z. B. fiskaly)**
Dann ist alles erlaubt: Rechnungshilfe, To-Go-Kasse, Umsatzstatistik. Aber dann
ist es ein selbstgebautes Kassensystem mit allen Pflichten: TSE-Signatur je
Vorgang, Beleg mit TSE-Daten, DSFinV-K-Export, Verfahrensdokumentation, Meldung
ans Finanzamt, laufende TSE-Gebühren. Machbar, aber deutlich mehr Aufwand als der
Rest des Systems zusammen.

### Was ich daraus für die Architektur ableite

- Das **Zahlungs-/Abrechnungsmodul** wird ein klar abgetrennter Baustein, der pro
  Mandant/Veranstaltung per Schalter aktiviert wird. Standard: aus.
- Der Kern (Bestellen → Routen → Drucken/Tablet) funktioniert vollständig ohne.
- Damit bleibt Weg C später nachrüstbar, ohne den Kern umzubauen.
- Bestelldaten werden nicht "weg­optimiert" oder still gelöscht. Stornos werden
  protokolliert. Am Ende einer Veranstaltung gibt es einen Archiv-Export.

Was ich **nicht** bauen werde: Funktionen, deren Zweck es ist, eine Kassenfunktion
vor einer Prüfung zu verstecken (z. B. "Prüfer-Modus", Umsätze nachträglich
spurlos ändern). Das wäre für den Verein das größte Risiko überhaupt.

---

## 1. Grundidee in einem Satz

Produkte werden nicht direkt einem Drucker zugeordnet, sondern einer **Station**
(Küche, Getränke, Bier, To-Go-Ausgabe …). Die Station entscheidet per
Konfiguration, *ob* eine Bestellung auf einem Tablet in eine Warteschlange geht
und *wann* (und auf welchem Drucker) ein Bon gedruckt wird.

Damit sind die Unterschiede zwischen Vereinen reine Konfiguration, kein Code:

| Station | `auf Tablet anzeigen` | `Bon drucken` | Drucker |
|---|---|---|---|
| Verein A – Küche | ja | bei "Annehmen" | Küche |
| Verein A – Getränke | ja | bei "Annehmen" | Schank |
| Verein B – Küche | ja | bei "Annehmen" | Küche |
| Verein B – Getränke | nein | sofort | Schank |
| Verein B – Bier | nein | sofort | Bier |
| To-Go-Abholbon | – | sofort | Ausgabe |

Druck-Zeitpunkt: `sofort` | `bei Annehmen` | `bei Fertig` | `nie`.
Eine Bestellung wird beim Absenden automatisch nach Stationen aufgeteilt; jede
Station bekommt ihr eigenes Ticket (Kachel am Tablet und/oder Bon).

---

## 2. Architektur

```
  Handys/Tablets der Bedienungen, Küche, To-Go, Admin (Browser, PWA)
                │  HTTPS/HTTP + WebSocket (Live-Updates)
                ▼
  ┌──────────────────────────────┐        ┌────────────────────────┐
  │ app                          │  SQL   │ db                     │
  │ - API + WebSocket            │◄──────►│ PostgreSQL             │
  │ - liefert Web-Oberfläche aus │        │ - Stammdaten, Bestell.  │
  │ - schreibt Druckaufträge     │        │ - Druckauftrags-Queue  │
  └──────────────────────────────┘        └───────────▲────────────┘
                                                      │ LISTEN/NOTIFY
                                          ┌───────────┴────────────┐
                                          │ print (Druck-Agent)    │
                                          │ - holt Jobs, druckt    │
                                          │ - Retry, Status        │
                                          └───────────┬────────────┘
                                                      │ TCP 9100, ESC/POS
                                     ┌────────────────┼────────────────┐
                                     ▼                ▼                ▼
                                Küche-Drucker   Schank-Drucker   Bier-Drucker
```

### Bewertung deiner Annahme (drei Container)

- **Drei Container: ja, passt.** `db`, `app`, `print`. Optional ein vierter
  (`caddy`) als Reverse-Proxy für HTTPS.
- **Kleine Korrektur:** Der Druck-Agent braucht **keine eigene Weboberfläche**.
  Druckerverwaltung, Status ("Papier leer", "offline"), Testdruck und Nachdruck
  gehören in die Admin-Oberfläche der App. Der Agent meldet seinen Status nur an
  die App. Eine UI weniger zu bauen und zu pflegen.
- **Polling vs. besser:** Druckaufträge landen als Zeilen in einer Job-Tabelle in
  der DB (Outbox-Prinzip). Das ist wichtig, weil dann **kein Auftrag verloren
  geht**, wenn ein Drucker oder der Agent kurz weg ist. Der Agent wird über
  PostgreSQL `LISTEN/NOTIFY` sofort geweckt (keine Verzögerung) und pollt nur als
  Sicherheitsnetz alle paar Sekunden. Jobs werden mit
  `SELECT … FOR UPDATE SKIP LOCKED` geholt, damit nichts doppelt gedruckt wird.
- **Drucker-Ansteuerung:** direkt per ESC/POS über TCP-Port 9100. Kein CUPS, keine
  Treiber. Funktioniert mit praktisch allen Netzwerk-Bondruckern.
- Falls der Server später doch in der Cloud läuft und der Agent im Festzelt: Dann
  baut der Agent eine ausgehende WebSocket-Verbindung zum Server auf (keine
  Portfreigaben nötig) und bekommt Jobs gepusht. Das gleiche Programm, nur ein
  anderer Transportweg. Für Version 1 nicht nötig.

### Wo läuft das? Klare Empfehlung: lokal am Fest

Internet im Festzelt ist unzuverlässig. Deshalb: ein günstiger **Mini-PC**
(z. B. Intel-N100-Klasse) oder ein Raspberry Pi 5 mit Docker, im selben lokalen
Netz wie Drucker und Handys. Alles läuft auch ohne Internet. Mandantenfähigkeit
geht trotzdem (siehe Frage 4 unten).

---

## 3. Tech-Stack (Vorschlag)

Eine Sprache für alles: **TypeScript**. Geteilte Typen zwischen Oberfläche und
Server, weniger Fehler.

| Teil | Wahl | Warum |
|---|---|---|
| Backend | Node.js, Fastify, WebSockets, Zod | schnell, schlank, gute WebSocket-Unterstützung |
| DB-Zugriff | Drizzle ORM + Migrationen | typsicher, nah an SQL |
| Datenbank | PostgreSQL 16 | `LISTEN/NOTIFY`, `SKIP LOCKED`, Row-Level-Security für Mandanten |
| Frontend | React + Vite, Tailwind, als PWA | sehr verbreitet, später leicht Mitwirkende zu finden |
| Diagramme | Apache ECharts | leistungsfähig, gut auf Tablets |
| Export | CSV + XLSX (exceljs) | Excel ist im Verein Standard |
| Druck | eigener kleiner ESC/POS-Encoder | volle Kontrolle über Umlaute, Schriftgrößen, Schnitt |
| Betrieb | Docker Compose | `docker compose up -d` und fertig |

---

## 4. Datenmodell (Entwurf)

```
tenant          Verein: Name, Kürzel, Einstellungen
user            tenant, Name, Rolle (admin | bedienung | station | togo), PIN/Passwort, aktiv
event           tenant, Name, Datum, aktiv, Schalter (Rechnungshilfe, To-Go, Preise anzeigen …)
area            event, Name ("Gang A"), Sortierung
table           area, Bezeichnung ("12"), Sortierung
category        event, Name, Farbe, Sortierung
product         event, Kategorie, Name, Kurzname für Bon, Preis, Station, Sortierung,
                ausverkauft, aktiv
station         event, Name, auf_tablet (ja/nein), druck_zeitpunkt, Drucker, Ersatzdrucker,
                ein_bon_pro_stück (ja/nein)
printer         tenant, Name, IP, Port, Papierbreite (58/80 mm), Zeichensatz, Status, zuletzt gesehen
order           event, Art (tisch | togo), Tisch oder Abholnummer, Bedienung, Zeit,
                client_request_id (eindeutig → keine Doppelbestellung bei Netz-Wacklern)
order_item      order, Produkt, Name+Preis als Kopie, Menge, Notiz, Station, Status
ticket          order, Station, Status (offen | in Arbeit | fertig | storniert), Zeitstempel
print_job       Drucker, Ticket, Art (bon | storno | abholbon | test | nachdruck),
                Inhalt, Status (wartet | druckt | fertig | fehler), Versuche, Fehlertext
audit_log       wer hat wann was storniert/geändert
```

Hinweise:
- Produkte, Preise und Stationen hängen an der **Veranstaltung**, nicht am Verein.
  So kann jedes Fest eigene Preise haben; "Veranstaltung kopieren" spart Arbeit.
- Name und Preis werden in der Bestellposition **kopiert**, damit spätere
  Preisänderungen alte Bestellungen nicht verfälschen.
- Jede Tabelle trägt (direkt oder indirekt) die Mandanten-ID; zusätzlich
  PostgreSQL Row-Level-Security als Sicherheitsnetz gegen Datenlecks zwischen
  Vereinen.

---

## 5. Oberflächen

### 5.1 Bedienung (Handy, Hauptsache: schnell)
- Anmeldung per **PIN**, Gerät bleibt angemeldet.
- **Gang wählen → Tisch wählen** (große Kacheln, letzte Tische oben).
- Produkt-Raster nach Kategorie, farbig. Tippen = +1. Langes Drücken = Notiz
  ("ohne Zwiebeln").
- Warenkorb unten fest sichtbar, Absenden mit einem Tipp.
- Bestätigung: "Gesendet an Küche, Getränke, Bier".
- **Netz-Wackler:** Bestellung wird lokal zwischengespeichert und automatisch
  nachgesendet. Eindeutige Request-ID verhindert Doppeldruck.
- Tischansicht: was wurde an diesem Tisch bestellt (mit Status aus der Küche).
- Rechnungshilfe nur, wenn für die Veranstaltung aktiviert (siehe Kapitel 0).
- Zielwert: Bestellung mit 5 Positionen in unter 15 Sekunden.

### 5.2 Station / Tablet (Küche, ggf. Getränke)
- Kacheln je Ticket, ältestes oben, Farbe nach Wartezeit (grün → gelb → rot).
- Ton bei neuer Bestellung.
- Tippen: "Annehmen" (druckt ggf. Bon) → "Fertig" (verschwindet, ggf. Abholnummer
  auf Abholmonitor). Rückgängig möglich.
- Zusammenfassung oben: "offen: 7× Schnitzel, 4× Pommes" (hilft der Küche beim
  Vorbereiten).

### 5.3 To-Go
- Schnellerfassung wie bei der Bedienung, aber ohne Tisch.
- Vergibt fortlaufende **Abholnummer**, Bon an Küche + **Abholbon** für den Gast.
- Optional **Abholmonitor** (Fernseher/Tablet): "Nr. 42 ist fertig".
- Bezahlung: je nach Weg aus Kapitel 0 (Wertmarken / offene Ladenkasse / TSE).

### 5.4 Admin
- Mandanten (Super-Admin), Veranstaltungen anlegen/kopieren.
- Gänge und Tische, auch in Serie ("Gang A, Tische 1–20").
- Kategorien und Produkte inkl. Station, Preis, Reihenfolge, **ausverkauft**
  (wirkt sofort auf allen Handys).
- Stationen und Drucker: Testdruck, Live-Status, **Ersatzdrucker mit zwei Klicks**
  (wenn der Bierdrucker ausfällt).
- Benutzer und PINs.
- Bon-Layout: Kopfzeile, Schriftgröße, Logo (später).
- Live-Übersicht: offene Tickets je Station, fehlgeschlagene Druckaufträge,
  Storno, Nachdruck.

### 5.5 Statistik
- Stückzahlen je Produkt / Kategorie / Station / Bedienung.
- Verlauf über die Zeit (Bestellungen pro Viertelstunde) als Diagramm.
- Durchlaufzeit Küche (Bestellung → fertig).
- Export CSV und XLSX, Archiv-Export am Ende der Veranstaltung.
- €-Werte nur, wenn der in Kapitel 0 gewählte Weg das hergibt.

---

## 6. Drucken im Detail

- Ein Bon pro Station und Bestellung (optional "ein Bon pro Stück", z. B. pro Teller).
- Bon-Inhalt: Station, **Gang/Tisch groß**, Bedienung, Uhrzeit, Bestellnummer,
  Positionen groß, Notizen hervorgehoben, Schnitt.
- **Storno-Bon** an die betroffene Station.
- Fehlerbehandlung: Wiederholungen mit Pause, nach X Fehlversuchen Warnung im
  Admin und am Tablet der Station; Umleitung auf Ersatzdrucker.
- Druckerstatus (offline, Papier leer, Deckel offen) per ESC/POS-Statusabfrage,
  soweit das Modell das unterstützt.
- **Druck-Simulator**: ein virtueller Drucker, der Bons im Browser anzeigt. Damit
  lässt sich ohne Hardware entwickeln, schulen und vorführen.
- Hardware-Empfehlung: Netzwerk-Bondrucker mit ESC/POS und Ethernet (Epson
  TM-T20/TM-T88 oder kompatible). **Kein USB, kein Bluetooth.**

---

## 7. Netzwerk und Betrieb (hier scheitern Feste in der Praxis)

Ehrlich: Die meisten Ausfälle bei solchen Systemen sind nicht die Software, sondern
WLAN und Strom.

- **Eigenes WLAN** mit vernünftigen Access Points, nicht die Fritzbox im
  Kassenhäuschen. Eigenes Netz nur für das System, 5 GHz bevorzugt.
- Drucker wo möglich **per Kabel**, feste IP-Adressen.
- Server und Router an eine kleine **USV** (Fritteuse + Kaffeemaschine auf einer
  Phase ist ein Klassiker).
- Automatische DB-Sicherung während der Veranstaltung (z. B. alle 10 Minuten auf
  USB-Stick).
- HTTPS: Ohne HTTPS funktioniert alles, nur echte Offline-Fähigkeit (App lädt auch
  ohne Netz neu) ist eingeschränkt. Die Zwischenspeicherung von Bestellungen geht
  trotzdem. Wer es perfekt will: eigene Domain mit Zertifikat, die lokal auf den
  Server zeigt.
- **Probelauf** vor jedem Fest mit echten Geräten.

---

## 8. Umsetzung in Etappen

Jede Etappe ist für sich nutzbar. Erst wenn eine Etappe stabil ist, kommt die
nächste.

**Etappe 1 – Grundgerüst und "Bestellen & Drucken" (MVP)**
- Docker Compose (db, app, print), Migrationen, Seed-Daten für eine Demo.
- Admin: Veranstaltung, Gänge/Tische, Kategorien/Produkte, Stationen, Drucker,
  Benutzer.
- Bedienungs-Oberfläche: Gang → Tisch → Produkte → Absenden.
- Aufteilen nach Stationen, Druck-Queue, Druck-Agent mit ESC/POS und Simulator.
- Abnahme: Bestellung vom Handy erscheint als korrekter Bon am richtigen Drucker
  (bzw. im Simulator), auch wenn der Drucker zwischendurch aus war.

**Etappe 2 – Stationen mit Tablet-Warteschlange**
- Live-Kacheln, Annehmen/Fertig, Druck-Zeitpunkt pro Station konfigurierbar.
- Storno mit Storno-Bon, Nachdruck, ausverkauft-Schalter live.
- Tischansicht für die Bedienung.

**Etappe 3 – To-Go**
- Abholnummern, Abholbon, Abholmonitor.

**Etappe 4 – Statistik und Export**
- Diagramme, CSV/XLSX, Archiv-Export.

**Etappe 5 – Mandanten-Feinschliff und Robustheit**
- Super-Admin, Row-Level-Security, Rollen, Bon-Layout, Offline-Zwischenspeicher,
  Lasttest (z. B. 30 Bedienungen gleichzeitig), Backup-Skripte, Betriebsanleitung.

**Optional – Zahlungsmodul**
- Rechnungshilfe / Abrechnung, je nach Entscheidung aus Kapitel 0; mit TSE nur,
  wenn Weg C gewählt wird.

Tests: automatische Tests für Aufteilung, Druck-Queue und Mandantentrennung;
Ende-zu-Ende-Test mit Simulator. Mit echten Druckern kann ich hier nicht testen,
das muss bei euch einmal passieren (Umlaute, €-Zeichen und Schneidwerk verhalten
sich je Modell leicht unterschiedlich).

---

## 9. Ehrliche Risiken und Grenzen

1. **Recht/Steuer** (Kapitel 0): der wichtigste Punkt, vor dem ersten Einsatz klären.
2. **WLAN/Strom**: siehe Kapitel 7.
3. **Drucker-Eigenheiten**: lösbar, aber nur mit echtem Gerät endgültig testbar.
4. **Wartung**: Jemand im Verein muss `docker compose up -d`, Updates und Backups
   beherrschen. Ich schreibe dafür eine Anleitung, aber ganz ohne Technik-Person
   geht es nicht.
5. **"Und so weiter"**: Der größte Feind solcher Projekte ist, dass vor dem ersten
   Fest noch zehn Funktionen dazu sollen. Lieber eine Etappe sauber fertig und auf
   einem echten Fest getestet.

---

## 10. Offene Fragen (aus v1 – inzwischen beantwortet, siehe „Entscheidungen“ oben)

1. **Welcher Weg aus Kapitel 0?** A (Wertmarken), B (Bedienung kassiert bar,
   System ohne Zahlungen) oder C (mit TSE)?
2. **Küche mit Tablet:** Wann soll der Bon gedruckt werden: beim Annehmen, beim
   Fertigmelden oder gar nicht (nur Tablet)?
3. **Betrieb:** lokal am Fest auf einem Mini-PC (empfohlen) oder zentraler Server
   mit Internet?
4. **Mandanten:** Betreibt ihr eine Instanz für mehrere Vereine (z. B. ihr verleiht
   das System), oder hat jeder Verein seine eigene Box?
5. **Geräte der Bedienungen:** eigene Handys oder Vereinsgeräte?
6. **Varianten/Extras:** z. B. Pommes rot-weiß, Größen 0,3/0,5, Beilagen? Und
   **Pfand**?
7. **Vorhandene Drucker:** welche Modelle, Netzwerk oder USB, 58 oder 80 mm?
8. **Wer wartet das später** und gibt es eine Sprach-Präferenz (falls jemand im
   Verein z. B. PHP oder Python kann, ist das ein Argument)?
