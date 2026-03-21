# 🕵️ IMPOSTER — Word Game (Free Stack)

## Tech Stack — 100% Free
| What | Service | Free tier |
|---|---|---|
| Backend (game server) | Railway.app | $5 credit/month (enough for hobby) |
| Database (themes) | Supabase | 500MB, unlimited API calls |
| Frontend hosting | Vercel | Unlimited static sites |
| Real-time | Socket.IO (built into server) | Free — runs on Railway |
| AI models | Ollama (local) | Free — runs on your machine |

---

## Project Structure
```
imposter-v2/
├── server/
│   ├── index.js          ← Express + Socket.IO backend (ALL game logic)
│   ├── package.json
│   └── .env.example      ← copy to .env and fill in
├── client/
│   ├── src/
│   │   ├── App.jsx       ← All pages: Home, Lobby, Game, Admin
│   │   ├── useGame.js    ← Socket hook (all real-time state)
│   │   ├── socket.js     ← Socket.IO connection singleton
│   │   ├── index.css     ← Full design system
│   │   └── main.jsx      ← React entry point
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── .env.example
├── supabase_setup.sql    ← Run once in Supabase SQL editor
├── railway.toml          ← Railway deployment config
├── vercel.json           ← Vercel deployment config
└── .gitignore
```

---

# SETUP — Step by Step

---

## STEP 1 — Install tools on your computer

You need Node.js and Git. Check if you have them:
```bash
node --version    # need v18 or higher
git --version
```

If not, download:
- Node.js: https://nodejs.org (click "LTS")
- Git: https://git-scm.com/downloads

---

## STEP 2 — Set up Supabase (free database)

Supabase stores your themes and AI cache. It's free forever for small projects.

1. Go to **https://supabase.com** → Sign up (use GitHub login for speed)
2. Click **"New project"**
3. Name it `imposter-game`, choose any region, set a database password (save it somewhere)
4. Wait ~2 minutes for it to spin up
5. Click **"SQL Editor"** in the left sidebar
6. Click **"New query"**
7. Open the file `supabase_setup.sql` from this project, copy ALL the text, paste it into the editor
8. Click **"Run"** — you should see "Success. No rows returned"

Now get your API keys:
1. Click **"Project Settings"** (gear icon, bottom left)
2. Click **"API"**
3. Copy these two values — you'll need them soon:
   - **Project URL** → looks like `https://abcdefgh.supabase.co`
   - **service_role key** → the long secret key (NOT the anon key — use the service_role one)

---

## STEP 3 — Set up Railway (free server hosting)

Railway runs your backend 24/7 for free.

1. Go to **https://railway.app** → Sign up with GitHub
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Connect your GitHub account if asked
4. First you need to push this code to GitHub:

```bash
# In your terminal, go into the imposter-v2 folder
cd imposter-v2

# Set up git
git init
git add .
git commit -m "initial commit"

# Create a new repo on github.com (click New repository, name it imposter-game)
# Then connect and push:
git remote add origin https://github.com/YOUR_USERNAME/imposter-game.git
git branch -M main
git push -u origin main
```

5. Back in Railway: select your `imposter-game` repo
6. Railway will detect the `railway.toml` and start building
7. Click on your new service → **"Variables"** tab → add these one by one:

| Variable name | Value |
|---|---|
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | your Supabase service_role key |
| `ADMIN_PASSCODE` | make up a strong password |
| `AI_BASE_URL` | `http://localhost:11434` for now (update later for AI) |
| `CLIENT_ORIGIN` | `https://your-vercel-app.vercel.app` (fill in after Step 4) |

8. Click **"Settings"** tab → **"Generate Domain"** → copy the URL (e.g. `https://imposter-game.up.railway.app`)
   Save this — you need it for the frontend

---

## STEP 4 — Set up Vercel (free frontend hosting)

1. Go to **https://vercel.com** → Sign up with GitHub
2. Click **"Add New Project"**
3. Import your `imposter-game` GitHub repo
4. Vercel will detect `vercel.json` automatically
5. Before clicking Deploy, click **"Environment Variables"** and add:

| Variable name | Value |
|---|---|
| `VITE_SERVER_URL` | your Railway URL from Step 3 (e.g. `https://imposter-game.up.railway.app`) |

6. Click **"Deploy"**
7. When done, copy your Vercel URL (e.g. `https://imposter-game.vercel.app`)

8. Go back to Railway → Variables → update `CLIENT_ORIGIN` to your Vercel URL
9. Railway will auto-redeploy with the new variable

---

## STEP 5 — Test the game

1. Open your Vercel URL in a browser
2. Open it again in a second tab (or on your phone)
3. Tab 1: enter a name → Create Room
4. Tab 2: enter a name → Join Room → type the 6-letter code
5. Open a 3rd tab and join too (need minimum 3 players)
6. Tab 1 (host): select a theme → click Start Game
7. Each tab: tap "Reveal My Word"
8. Play!

---

## STEP 6 — Connect your AI models (for admin theme generation)

This is optional — you can manually add word lists in the admin panel without AI.
If you want AI generation:

### Install Ollama
```bash
# Mac/Linux:
curl -fsSL https://ollama.com/install.sh | sh

# Windows: download from https://ollama.com/download
```

### Pull the models
```bash
ollama pull qwen2.5:latest    # fast model (~4B)
ollama pull qwen2.5:7b        # high quality model
```

### Expose your local Ollama so Railway can reach it

Railway is a cloud server — it can't reach `localhost` on your machine.
You need to tunnel your local Ollama to the internet.

**Option A — ngrok (easiest)**
```bash
# Download ngrok from https://ngrok.com/download
# Create free account, get your auth token from dashboard

ngrok config add-authtoken YOUR_TOKEN_HERE
ngrok http 11434

# You'll see: Forwarding https://abc123.ngrok-free.app -> localhost:11434
# Copy the https URL
```

Then in Railway Variables, update:
```
AI_BASE_URL = https://abc123.ngrok-free.app
```

Railway redeploys automatically. Now the admin AI generation button works.

**⚠️ Free ngrok URLs change every restart.**
Each time you stop and restart ngrok, update `AI_BASE_URL` in Railway.
Paid ngrok ($8/mo) gives a fixed URL.

**Option B — run Ollama on a VPS**
If you have a cheap VPS (Hetzner, DigitalOcean, etc.), run Ollama there and point `AI_BASE_URL` at its IP. No ngrok needed.

---

## STEP 7 — Use the Admin Panel

1. On the home screen, click **"Admin Panel"**
2. Enter your `ADMIN_PASSCODE` (the one you set in Railway)
3. Click **"+ New Theme"**
4. Fill in: Theme name, Category, optional seed words, optional pasted wiki text
5. Choose model (fast = qwen2.5:latest, hq = qwen2.5:7b)
6. Click **"✨ Generate with AI"** — waits ~10-30 seconds
7. Review the word lists, add/remove individual words
8. Click **"💾 Save Theme"**

The theme now appears in the lobby for all players.

---

## Making changes and redeploying

After any code edit:
```bash
git add .
git commit -m "describe your change"
git push
```

Both Railway and Vercel watch your GitHub repo and auto-redeploy. Takes ~1-2 minutes.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Game works locally but not on Vercel | Check `VITE_SERVER_URL` is set correctly in Vercel env vars |
| "Room not found" after page refresh | Normal — rooms live in server memory. Refresh and rejoin |
| AI generation times out | Ollama isn't running, or ngrok URL changed. Restart both |
| CORS error in browser console | Check `CLIENT_ORIGIN` in Railway matches your exact Vercel URL |
| Railway build fails | Check build logs — usually a missing package. Run `npm install` locally first |
| Themes not loading | Check Supabase SQL ran successfully. Go to Supabase → Table Editor → themes |
| Socket not connecting | Make sure Railway service is running (check Railway logs) |

---

## Local development (no internet needed)

```bash
# Terminal 1 — run the server
cd server
cp .env.example .env
# Edit .env with your real Supabase keys and ADMIN_PASSCODE
npm install
npm run dev

# Terminal 2 — run the frontend
cd client
npm install
npm run dev
# Opens at http://localhost:5173
```

The vite proxy automatically forwards API calls to localhost:3001.

---

## Free tier limits summary

**Supabase free tier:**
- 500MB database storage (themes take < 1MB)
- Unlimited API requests
- Never expires

**Railway free tier:**
- $5 of credit per month
- Your server uses ~$0.50-1.00/month at low traffic
- Effectively free for a hobby game

**Vercel free tier:**
- Unlimited deployments
- 100GB bandwidth/month
- Never expires for hobby projects

**Total cost: $0** for normal friend-group usage.
