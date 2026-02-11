# 🚀 Pod Dashboard — AAA Accelerator

Simpel dashboard voor wekelijkse pod meetings. Iedereen kan de agenda aanpassen, topics toevoegen, check-ins doen, en attendance bijhouden — allemaal vanuit één pagina.

## Features

- 📋 **Agenda** — Agendapunten met tijdsindicatie, drag & drop herordenen
- 👥 **Aanwezigheid** — Toggle per lid per meeting
- 💡 **Onderwerpen** — Topics toevoegen, markeren als besproken
- 📝 **Check-ins** — 4 vragen (goals, progress, challenges, support) + screenshot paste
- 📄 **Samenvatting** — Vorige meeting summary bewerkbaar
- 🔒 **Wachtwoord** — Simpele login (client-side)
- ⚡ **Realtime** — Wijzigingen van anderen verschijnen direct

## Setup (5 minuten)

### 1. Supabase project aanmaken

1. Ga naar [supabase.com](https://supabase.com) → New Project (gratis)
2. Kies een naam (bijv. "pod-dashboard") en wachtwoord
3. Wacht tot het project klaar is

### 2. Database opzetten

1. Ga naar **SQL Editor** in je Supabase project
2. Plak de inhoud van `setup.sql`
3. **Pas de namen aan** onderaan het script (vervang "Lid 2" t/m "Lid 5")
4. Klik **Run**

### 3. Credentials invullen

1. Ga naar **Settings → API** in Supabase
2. Kopieer `Project URL` en `anon public key`
3. Open `app.js` en vervang:
   - `YOUR_SUPABASE_URL` → je Project URL
   - `YOUR_SUPABASE_ANON_KEY` → je anon key

### 4. Wachtwoord wijzigen

Het standaard wachtwoord is "password". Om te wijzigen:

1. Kies een wachtwoord
2. Genereer de SHA-256 hash (bijv. via browser console):
   ```js
   crypto.subtle.digest('SHA-256', new TextEncoder().encode('jouw-wachtwoord'))
     .then(h => console.log(Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,'')).join('')))
   ```
3. Vervang `PASSWORD_HASH` in `app.js`

### 5. Deploy naar GitHub Pages

1. Push naar GitHub
2. Ga naar **Settings → Pages** → Source: "main" branch, root folder
3. Site is live op `https://[username].github.io/pod-dashboard/`

## Tech

- Vanilla HTML/CSS/JS (geen framework, geen build step)
- Supabase (gratis tier: database + storage + realtime)
- GitHub Pages (gratis hosting)
