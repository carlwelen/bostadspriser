Roll: Du är en senior fullstack-utvecklare och expert på data engineering.
Mål: Skapa en webbapplikation som aggregerar, analyserar och visualiserar bostadspriser i Stockholms innerstad (Östermalm, Vasastan, Norrmalm, Södermalm).
1. Systemarkitektur & Datainsamling

Skapa en plan för en applikation med följande komponenter:

    Scraper-modul: Utveckla en metod (förslagsvis med Playwright eller Selenium) som kan extrahera slutpriser och objektbeskrivningar från Hemnet och Booli. Du kan även skaffa Boolis api.

        Filter: Specifikt för Stockholms innerstad (stadsdelar och gator).

        Datafält: Pris, kvadratmeterpris, gatuadress, stadsdel, datum för försäljning, samt antal rum.

    Databas: Designa ett schema (PostgreSQL rekommenderas) för att lagra historisk data. Vi behöver kunna lagra tidsserier för att generera grafer över månader och år.

2. Funktionalitet & API

Implementera logik för att bearbeta den insamlade datan:

    Aggregeringsmotor: Skapa funktioner för att beräkna medelpriser och prisutveckling per:

        Gata, där varje nummer kan "klickas" på för att kunna sedan få upp en graf på för just den gatan, det numret på den gatan, och i området.

        Stadsdel (Östermalm, Vasastan, Norrmalm, Södermalm).

        Hela innerstaden jämfört mellan stadsdelar.

    API-endpoints: Skapa endpoints som levererar JSON-data optimerad för tidsseriedata och geografisk visualisering.

3. Visualisering (Frontend-logik)

Fokusera på datatäthet och interaktivitet:

    Grafer: Använd ett bibliotek som Chart.js eller Recharts. Skapa vyer för prisutveckling över tid där användaren kan växla mellan månadsvy och årsvy. Det ska gå att jämföra två olika gator eller stadsdelar i samma graf.

    Heatmap: Implementera en kartvy (t.ex. med Leaflet eller Mapbox). Använd koordinater (lat/long) baserat på gatuadresser för att generera en heatmap som visar färgkodade områden baserat på kvadratmeterpris (dyrast vs. billigast).

4. Tekniska Krav & Begränsningar

    Stack: Valfri modern stack (förslagsvis Next.js med en Python-backend för scraping, eller Node.js).

    Prestanda: Eftersom scraping kan vara tidskrävande, implementera en cache-strategi eller ett bakgrundsjobb som uppdaterar databasen periodvis istället för vid varje sidladdning.

    Design: Håll gränssnittet rent och funktionellt (trådrullar/wireframe-nivå). Fokusera på att datan presenteras korrekt och att filtreringen fungerar sömlöst.

Börja med att skissa upp filstrukturen och databasschemat, och beskriv sedan steg för steg hur scrapingen ska kringgå eventuella bot-skydd på ett ansvarsfullt sätt.