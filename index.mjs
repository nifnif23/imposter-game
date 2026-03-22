// ============================================================
// server/index.js
// Express + Socket.IO backend for Imposter Word Game
// Runs free on Railway.app
// ============================================================

import "dotenv/config";
import express          from "express";
import { createServer } from "http";
import { Server }       from "socket.io";
import cors             from "cors";
import { createClient } from "@supabase/supabase-js";

// ── Fix for node-fetch ESM in CommonJS-style usage ───────────
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

// ── Config ───────────────────────────────────────────────────
const PORT          = process.env.PORT          || 3001;
const ADMIN_PASS    = process.env.ADMIN_PASSCODE || "changeme";
const AI_BASE_URL   = process.env.AI_BASE_URL    || "http://localhost:11434";
// Support multiple origins separated by commas e.g. "https://a.vercel.app,https://b.vercel.app"
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",").map(o => o.trim().replace(/\/+$/, ""));

// ── Supabase (server-side, uses service key — never expose to client) ──
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Express setup ─────────────────────────────────────────────
const app    = express();
const server = createServer(app);

app.use(cors({ origin: CLIENT_ORIGINS, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// ── Socket.IO setup ───────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGINS, methods: ["GET","POST"], credentials: true }
});

// ── In-memory room store ──────────────────────────────────────
// Rooms live in memory (fast, free, no DB needed for ephemeral game state)
// Themes and AI cache persist in Supabase
const rooms = new Map();
// rooms[code] = {
//   code, hostId, players: Map(id → {name, socketId}),
//   settings: {imposters, mode, themeId},
//   gameState: {started, assignments, mainWord, imposterWord}
// }

// ── Helpers ───────────────────────────────────────────────────
function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do { code = Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join(""); }
  while (rooms.has(code));
  return code;
}

function assignRoles(playerIds, wordPool, imposterCount, mode) {
  // Pick crewmate word
  const mainWord = wordPool[Math.floor(Math.random() * wordPool.length)];
  // Pick a DIFFERENT word from the same pool for the imposter
  const remaining = wordPool.filter(w => w !== mainWord);
  const imposterWord = remaining.length
    ? remaining[Math.floor(Math.random() * remaining.length)]
    : mainWord; // fallback if only 1 word in pool

  const shuffled    = [...playerIds].sort(() => Math.random() - 0.5);
  const imposterSet = new Set(shuffled.slice(0, imposterCount));

  const assignments = {};
  for (const pid of playerIds) {
    const isImposter = imposterSet.has(pid);
    assignments[pid] = isImposter
      ? { role: "imposter", word: mode === "hidden" ? imposterWord : null, knowsRole: mode === "known" }
      : { role: "crewmate", word: mainWord, knowsRole: true };
  }
  return { assignments, mainWord, imposterWord };
}

function roomPublicState(room) {
  // Never send assignments in bulk — players fetch their own via socket
  return {
    code:      room.code,
    hostId:    room.hostId,
    players:   Object.fromEntries(
      [...room.players.entries()].map(([id, p]) => [id, { name: p.name }])
    ),
    settings:  room.settings,
    gameState: {
      started:        room.gameState.started,
      mainWord:       null,   // hidden until host reveals
      imposterWord:   null,
      roundStartedAt: room.gameState.roundStartedAt,
    },
  };
}

// ── REST: Health check ────────────────────────────────────────
app.get("/health", (_, res) => res.json({ ok: true }));

// ── REST: List themes (public) ────────────────────────────────
app.get("/themes", async (_, res) => {
  const { data, error } = await supabase
    .from("themes")
    .select("id, name, category, word_count, imposter_count")
    .order("category");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── REST: Get single theme (server uses internally) ───────────
async function fetchTheme(themeId) {
  const { data } = await supabase.from("themes").select("*").eq("id", themeId).single();
  return data;
}

// ── REST: Admin — save theme ──────────────────────────────────
app.post("/admin/theme", async (req, res) => {
  const { passcode, id, name, category, words, imposters } = req.body;
  if (passcode !== ADMIN_PASS) return res.status(403).json({ error: "Invalid passcode" });
  if (!name?.trim())           return res.status(400).json({ error: "Name required" });

  const payload = {
    name:       name.trim(),
    category:   category || "general",
    words:      (words || []).map(w => String(w).toLowerCase().trim()).filter(Boolean),
    word_count: (words || []).length,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = id
    ? await supabase.from("themes").update(payload).eq("id", id).select().single()
    : await supabase.from("themes").insert(payload).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── REST: Admin — delete theme ────────────────────────────────
app.delete("/admin/theme/:id", async (req, res) => {
  const { passcode } = req.body;
  if (passcode !== ADMIN_PASS) return res.status(403).json({ error: "Invalid passcode" });
  const { error } = await supabase.from("themes").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});


// ── REST: Admin — scrape a URL for reference text ────────────
// Fetches a webpage and strips it to plain text for use as AI reference
app.post("/admin/scrape", async (req, res) => {
  const { passcode, url } = req.body;
  if (passcode !== ADMIN_PASS) return res.status(403).json({ error: "Invalid passcode" });
  if (!url?.trim())            return res.status(400).json({ error: "URL required" });

  try {
    const text = await scrapeUrl(url.trim());
    res.json({ text, url, length: text.length });
  } catch (err) {
    console.error("Scrape error:", err.message);
    res.status(500).json({ error: `Could not fetch page: ${err.message}` });
  }
});

// ── Helper: fetch a URL and extract readable plain text ───────
async function scrapeUrl(url) {
  // Validate URL
  const parsed = new URL(url); // throws if invalid
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP/HTTPS URLs are supported");
  }

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ImposterGameBot/1.0)",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const html = await resp.text();

  // Strip HTML tags and extract readable text
  let text = html
    // Remove script and style blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    // Convert common block elements to newlines
    .replace(/<(br|p|div|h[1-6]|li|tr)[^>]*>/gi, "\n")
    // Strip remaining tags
    .replace(/<[^>]+>/g, " ")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, " ")
    // Collapse whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Limit to 60k chars (well within 90k context)
  // Focus on the first chunk which usually has the most relevant content
  if (text.length > 60000) text = text.slice(0, 60000) + "\n[truncated]";

  return text;
}

// ── REST: Admin — generate theme with AI ─────────────────────
app.post("/admin/generate", async (req, res) => {
  const { passcode, themeName, category, seedWords = [], referenceText = "", referenceUrls = [], modelChoice = "fast" } = req.body;
  if (passcode !== ADMIN_PASS) return res.status(403).json({ error: "Invalid passcode" });
  if (!themeName?.trim())      return res.status(400).json({ error: "Theme name required" });

  // Check cache
  const cacheKey = `${themeName.trim().toLowerCase()}_${modelChoice}`;
  const { data: cached } = await supabase.from("ai_cache").select("*").eq("cache_key", cacheKey).single();
  if (cached) return res.json({ ...cached.result, cached: true });

  // Scrape any reference URLs and append to referenceText
  let fullReference = referenceText;
  if (referenceUrls.length > 0) {
    const scraped = await Promise.allSettled(
      referenceUrls.filter(u => u?.trim()).map(u => scrapeUrl(u.trim()))
    );
    const scrapedText = scraped
      .filter(r => r.status === "fulfilled")
      .map(r => r.value)
      .join("\n\n---\n\n");
    if (scrapedText) {
      fullReference = [referenceText, scrapedText].filter(Boolean).join("\n\n");
    }
  }

  // Build prompt
  const { model, prompt } = buildPrompt(modelChoice, { themeName: themeName.trim(), category, seedWords, referenceText: fullReference });

  // Call local AI model via Ollama API
  try {
    const aiRes = await fetch(`${AI_BASE_URL}/api/generate`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",  // bypass ngrok browser warning page
        "User-Agent": "ImposterGameServer/1.0",
      },
      body:    JSON.stringify({ model, prompt, stream: false }),
      signal:  AbortSignal.timeout(90_000),
    });

    if (!aiRes.ok) throw new Error(`AI returned ${aiRes.status}`);
    const raw  = await aiRes.json();
    const text = (raw.response || raw.content || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(text);

    if (!Array.isArray(parsed.words))
      throw new Error("AI returned invalid structure");

    const scrapedCount = referenceUrls.filter(u => u?.trim()).length;
    const result = {
      theme:        parsed.theme || themeName,
      words:        parsed.words.map(w => String(w).toLowerCase().trim()).filter(Boolean),
      model,
      scraped_urls: scrapedCount,
      generated_at: new Date().toISOString(),
    };

    // Cache it
    await supabase.from("ai_cache").upsert({ cache_key: cacheKey, result });

    res.json({ ...result, cached: false });
  } catch (err) {
    console.error("AI error:", err.message);
    res.status(500).json({ error: `AI generation failed: ${err.message}` });
  }
});

// ── Prompt builder ────────────────────────────────────────────
const GUIDELINES = {
  anime:   "Characters (main/side/antagonists), abilities/jutsu/powers, locations, organisations, items/artefacts. Proper nouns only.",
  game:    "Characters, weapons/equipment, maps/zones/levels, items/consumables, named abilities. Proper nouns only.",
  show:    "Characters (first+last name), locations, key items/props, organisations/groups. Proper nouns only.",
  animal:  "Species names, habitats/biomes, physical traits, behaviours, taxonomic groups.",
  food:    "Named dishes, specific ingredients/cultivars, cooking techniques, regional cuisines, equipment.",
  general: "Proper nouns, named people/places/things specific to the theme. Avoid generic words.",
};

function buildPrompt(modelChoice, { themeName, category, seedWords, referenceText }) {
  const guide       = GUIDELINES[category] || GUIDELINES.general;
  const seedSection = seedWords.length ? `Seed words (must include if valid): ${seedWords.join(", ")}` : "No seed words provided.";
  const refSection  = referenceText.trim() ? `\n--- REFERENCE MATERIAL ---\n${referenceText.trim()}\n--- END REFERENCE ---` : "";

  // Single pool prompt — all words go in one array, game picks two different ones each round
  return {
    model: "qwen-90k",
    prompt: `You are generating a word pool for an Imposter Word Game.
In this game, all players get a word from the same pool. Crewmates share one word, the imposter gets a DIFFERENT word from the same pool. So all words must be from the same theme but distinct enough that having a different word would be noticeable.

Theme: ${themeName}
Category: ${category}
Word types to include: ${guide}
${seedSection}${refSection}

Generate exactly 50 words split into these categories:
- 15 character/person names (specific, canonical)
- 10 location/place names (specific, named)
- 10 ability/technique/move names (named, not generic)
- 8 item/weapon/object names (specific, named)
- 7 organisation/group/faction names

Rules:
- Output ONLY valid JSON, no markdown, no explanation
- All words lowercase, hyphens for compound names
- Proper nouns only — no generic words like sword or power
- Must be canon/official entries for this theme
- Format: {theme:${themeName},words:[word1,word2,...]}

JSON:`,
  };
}

// ── Socket.IO: Game logic ─────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[+] ${socket.id} connected`);

  // ── CREATE ROOM ───────────────────────────────────────────
  socket.on("create_room", ({ playerName }, cb) => {
    if (!playerName?.trim()) return cb({ error: "Name required" });

    const code = makeCode();
    const pid  = socket.id;

    rooms.set(code, {
      code,
      hostId:    pid,
      players:   new Map([[pid, { name: playerName.trim().slice(0,30), socketId: socket.id }]]),
      settings:  { imposters: 1, mode: "hidden", themeId: null },
      gameState: { started: false, assignments: {}, mainWord: "", imposterWord: "", roundStartedAt: null },
    });

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = pid;

    cb({ ok: true, roomCode: code, playerId: pid });
    io.to(code).emit("room_update", roomPublicState(rooms.get(code)));
  });

  // ── JOIN ROOM ─────────────────────────────────────────────
  socket.on("join_room", ({ roomCode, playerName }, cb) => {
    const code = roomCode?.toUpperCase().trim();
    const room = rooms.get(code);

    if (!room)                    return cb({ error: "Room not found" });
    if (room.gameState.started)   return cb({ error: "Game already started" });
    if (room.players.size >= 16)  return cb({ error: "Room is full" });
    if (!playerName?.trim())      return cb({ error: "Name required" });

    const pid = socket.id;
    room.players.set(pid, { name: playerName.trim().slice(0,30), socketId: socket.id });

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = pid;

    cb({ ok: true, roomCode: code, playerId: pid });
    io.to(code).emit("room_update", roomPublicState(room));
  });

  // ── REJOIN (on reconnect) ─────────────────────────────────
  socket.on("rejoin_room", ({ roomCode, playerId, playerName }, cb) => {
    const code = roomCode?.toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb({ error: "Room expired or not found" });

    // Update socket ID for this player
    if (room.players.has(playerId)) {
      room.players.get(playerId).socketId = socket.id;
    } else {
      room.players.set(playerId, { name: playerName || "Player", socketId: socket.id });
    }

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = playerId;

    cb({ ok: true });
    io.to(code).emit("room_update", roomPublicState(room));

    // If game started, send their assignment privately
    if (room.gameState.started && room.gameState.assignments[playerId]) {
      socket.emit("your_assignment", room.gameState.assignments[playerId]);
    }
  });

  // ── UPDATE SETTINGS (host only) ───────────────────────────
  socket.on("update_settings", ({ settings }, cb) => {
    const code = socket.data.roomCode;
    const pid  = socket.data.playerId;
    const room = rooms.get(code);

    if (!room)               return cb?.({ error: "Room not found" });
    if (room.hostId !== pid) return cb?.({ error: "Only host can change settings" });

    room.settings = {
      imposters: Math.max(1, Math.min(Number(settings.imposters) || 1, 4)),
      mode:      ["hidden","known"].includes(settings.mode) ? settings.mode : "hidden",
      themeId:   settings.themeId || null,
    };

    io.to(code).emit("room_update", roomPublicState(room));
    cb?.({ ok: true });
  });

  // ── START GAME (host only) ────────────────────────────────
  socket.on("start_game", async (_, cb) => {
    const code = socket.data.roomCode;
    const pid  = socket.data.playerId;
    const room = rooms.get(code);

    if (!room)               return cb?.({ error: "Room not found" });
    if (room.hostId !== pid) return cb?.({ error: "Only host can start" });
    if (room.gameState.started) return cb?.({ error: "Already started" });
    if (room.players.size < 3)  return cb?.({ error: "Need at least 3 players" });

    // Load theme words — single pool, both roles draw from it
    // Default pool — 300+ everyday nouns covering objects, places, animals, food, concepts
    let wordPool = [
      // Household objects
      "kettle","mirror","pillow","blanket","curtain","ladder","bucket","candle","drawer","fridge",
      "toaster","kettle","scissors","hammer","stapler","envelope","calendar","remote","charger","umbrella",
      "suitcase","doorbell","mailbox","bathtub","shower","carpet","ceiling","chimney","cupboard","wardrobe",
      // Food & drink
      "pizza","burger","sushi","ramen","pasta","curry","steak","salmon","mango","avocado",
      "croissant","waffle","pancake","brownie","pretzel","noodles","burrito","taco","dumpling","cheesecake",
      "espresso","smoothie","lemonade","milkshake","cocktail","whiskey","cider","yoghurt","granola","omelette",
      // Animals
      "penguin","dolphin","elephant","giraffe","cheetah","gorilla","panther","flamingo","octopus","hedgehog",
      "mongoose","raccoon","platypus","salamander","chameleon","pelican","vulture","meerkat","capybara","axolotl",
      "hamster","parrot","iguana","tortoise","piranha","narwhal","walrus","manatee","wolverine","armadillo",
      // Places
      "library","airport","stadium","hospital","cathedral","lighthouse","cemetery","volcano","glacier","canyon",
      "swamp","harbour","plateau","peninsula","archipelago","suburb","alleyway","rooftop","basement","greenhouse",
      "warehouse","observatory","aquarium","monastery","colosseum","pyramid","fortress","marina","quarry","tundra",
      // Vehicles & transport
      "submarine","helicopter","motorcycle","skateboard","hovercraft","gondola","zeppelin","tractor","ambulance","bulldozer",
      // Technology & objects
      "telescope","microscope","calculator","projector","satellite","compass","thermometer","hourglass","periscope","barometer",
      // Clothing & accessories
      "tuxedo","kimono","sombrero","beret","gloves","scarf","boots","sandals","goggles","bracelet",
      // Nature & weather
      "lightning","avalanche","monsoon","tornado","blizzard","earthquake","tsunami","drought","rainbow","eclipse",
      "stalactite","waterfall","geyser","quicksand","mangrove","cactus","bamboo","seaweed","mushroom","lichen",
      // Sports & games
      "archery","fencing","javelin","surfing","wrestling","bobsled","lacrosse","polo","cricket","badminton",
      // Professions & roles
      "blacksmith","surgeon","astronaut","detective","archaeologist","sommelier","cartographer","taxidermist","locksmith","falconer",
      // Misc concepts & things
      "compass","lantern","anchor","trophy","passport","blueprint","fossil","crystal","magnet","prism",
      "vault","labyrinth","mirage","shipwreck","treasure","crown","sceptre","goblet","parchment","hourglass"
    ];

    if (room.settings.themeId) {
      const theme = await fetchTheme(room.settings.themeId);
      if (theme?.words?.length) wordPool = theme.words;
    }

    const playerIds     = [...room.players.keys()];
    const imposterCount = Math.min(room.settings.imposters, Math.floor(playerIds.length / 2));
    const { assignments, mainWord, imposterWord } = assignRoles(
      playerIds, wordPool, imposterCount, room.settings.mode
    );

    room.gameState = { started: true, assignments, mainWord, imposterWord, roundStartedAt: Date.now() };

    // Broadcast public state (no assignments, no words)
    io.to(code).emit("room_update", roomPublicState(room));
    io.to(code).emit("game_started");

    // Send each player ONLY their own assignment — privately via their socket
    for (const [playerId, assignment] of Object.entries(assignments)) {
      const player = room.players.get(playerId);
      if (player) {
        // Find the socket for this player
        const targetSocket = io.sockets.sockets.get(player.socketId);
        if (targetSocket) targetSocket.emit("your_assignment", assignment);
      }
    }

    cb?.({ ok: true });
  });

  // ── RESET GAME (host only) ────────────────────────────────
  socket.on("reset_game", (_, cb) => {
    const code = socket.data.roomCode;
    const pid  = socket.data.playerId;
    const room = rooms.get(code);

    if (!room)               return cb?.({ error: "Room not found" });
    if (room.hostId !== pid) return cb?.({ error: "Only host can reset" });

    room.gameState = { started: false, assignments: {}, mainWord: "", imposterWord: "", roundStartedAt: null };

    io.to(code).emit("room_update", roomPublicState(room));
    io.to(code).emit("game_reset");
    cb?.({ ok: true });
  });

  // ── HOST: REVEAL WORDS (host only, after discussion) ─────
  socket.on("reveal_words", (_, cb) => {
    const code = socket.data.roomCode;
    const pid  = socket.data.playerId;
    const room = rooms.get(code);

    if (!room)               return cb?.({ error: "Room not found" });
    if (room.hostId !== pid) return cb?.({ error: "Only host can reveal" });
    if (!room.gameState.started) return cb?.({ error: "Game not started" });

    // Broadcast the answer to everyone
    io.to(code).emit("words_revealed", {
      mainWord:     room.gameState.mainWord,
      imposterWord: room.gameState.imposterWord,
      assignments:  room.gameState.assignments, // full reveal at end of round
    });

    cb?.({ ok: true });
  });

  // ── DISCONNECT ────────────────────────────────────────────
  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const pid  = socket.data.playerId;
    if (!code || !pid) return;

    const room = rooms.get(code);
    if (!room) return;

    // Don't remove immediately — give 30s for reconnect
    setTimeout(() => {
      const room = rooms.get(code);
      if (!room) return;

      const player = room.players.get(pid);
      // If socket ID changed, player reconnected — don't remove
      if (player && player.socketId !== socket.id) return;

      room.players.delete(pid);
      console.log(`[-] ${pid} left ${code} (${room.players.size} remaining)`);

      if (room.players.size === 0) {
        rooms.delete(code);
        console.log(`[x] Room ${code} deleted (empty)`);
        return;
      }

      // Transfer host if needed
      if (room.hostId === pid) {
        room.hostId = room.players.keys().next().value;
        console.log(`[~] Host transferred in ${code}`);
      }

      io.to(code).emit("room_update", roomPublicState(room));
    }, 120_000); // 2 min grace for reload/reconnect

    console.log(`[~] ${socket.id} disconnected`);
  });
});

// ── Start server ──────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`🎮 Imposter Game server running on port ${PORT}`);
  console.log(`   AI endpoint: ${AI_BASE_URL}`);
});
