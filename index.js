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
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN  || "http://localhost:5173";

// ── Supabase (server-side, uses service key — never expose to client) ──
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Express setup ─────────────────────────────────────────────
const app    = express();
const server = createServer(app);

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// ── Socket.IO setup ───────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ["GET","POST"], credentials: true }
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

function assignRoles(playerIds, mainWords, imposterWords, imposterCount, mode) {
  const mainWord     = mainWords[Math.floor(Math.random() * mainWords.length)];
  const filtered     = imposterWords.filter(w => w !== mainWord);
  const imposterWord = (filtered.length ? filtered : imposterWords)[Math.floor(Math.random() * (filtered.length || imposterWords.length))];

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
    name:          name.trim(),
    category:      category || "general",
    words:         (words    || []).map(w => String(w).toLowerCase().trim()).filter(Boolean),
    imposters:     (imposters|| []).map(w => String(w).toLowerCase().trim()).filter(Boolean),
    word_count:    (words    || []).length,
    imposter_count:(imposters|| []).length,
    updated_at:    new Date().toISOString(),
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

// ── REST: Admin — generate theme with AI ─────────────────────
app.post("/admin/generate", async (req, res) => {
  const { passcode, themeName, category, seedWords = [], referenceText = "", modelChoice = "fast" } = req.body;
  if (passcode !== ADMIN_PASS) return res.status(403).json({ error: "Invalid passcode" });
  if (!themeName?.trim())      return res.status(400).json({ error: "Theme name required" });

  // Check cache
  const cacheKey = `${themeName.trim().toLowerCase()}_${modelChoice}`;
  const { data: cached } = await supabase.from("ai_cache").select("*").eq("cache_key", cacheKey).single();
  if (cached) return res.json({ ...cached.result, cached: true });

  // Build prompt
  const { model, prompt } = buildPrompt(modelChoice, { themeName: themeName.trim(), category, seedWords, referenceText });

  // Call local AI model via Ollama API
  try {
    const aiRes = await fetch(`${AI_BASE_URL}/api/generate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ model, prompt, stream: false }),
      signal:  AbortSignal.timeout(90_000),
    });

    if (!aiRes.ok) throw new Error(`AI returned ${aiRes.status}`);
    const raw  = await aiRes.json();
    const text = (raw.response || raw.content || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(text);

    if (!Array.isArray(parsed.words) || !Array.isArray(parsed.imposters))
      throw new Error("AI returned invalid structure");

    const result = {
      theme:     parsed.theme || themeName,
      words:     parsed.words.map(w => String(w).toLowerCase().trim()).filter(Boolean),
      imposters: parsed.imposters.map(w => String(w).toLowerCase().trim()).filter(Boolean),
      model,
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
  const seedSection = seedWords.length ? `Seed words (include if valid): ${seedWords.join(", ")}` : "No seed words.";

  if (modelChoice === "fast") {
    const refSection = referenceText.trim() ? `\n--- REFERENCE ---\n${referenceText.trim()}\n--- END ---` : "";
    return {
      model: "qwen2.5:latest",
      prompt: `You are a word-list curator for an online multiplayer Imposter Word Game.
Theme: ${themeName} | Category: ${category}
Guidelines: ${guide}
${seedSection}${refSection}
Output ONLY valid JSON (no markdown, no fences):
{"theme":"${themeName}","words":[30-50 proper nouns],"imposters":[15-25 different nouns from same theme]}
No overlap between arrays. Lowercase. Hyphens for compound words.
JSON:`,
    };
  }

  // HQ model — tighter context
  const clipped = referenceText.trim().slice(0, 3000);
  return {
    model: "qwen2.5:7b",
    prompt: `TASK: Imposter Word Game word list. JSON only.
Theme: ${themeName} | Category: ${category}
Types: ${guide}
${seedSection}${clipped ? `\nReference: ${clipped}` : ""}
Format: {"theme":"${themeName}","words":[20-35 nouns],"imposters":[10-18 nouns]}
No overlap, lowercase, proper nouns, no markdown.
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

    // Load theme words
    let mainWords     = ["apple","banana","cherry","dragon","eagle"];
    let imposterWords = ["apricot","blueberry","coconut","dolphin","falcon"];

    if (room.settings.themeId) {
      const theme = await fetchTheme(room.settings.themeId);
      if (theme?.words?.length)     mainWords     = theme.words;
      if (theme?.imposters?.length) imposterWords = theme.imposters;
    }

    const playerIds     = [...room.players.keys()];
    const imposterCount = Math.min(room.settings.imposters, Math.floor(playerIds.length / 2));
    const { assignments, mainWord, imposterWord } = assignRoles(
      playerIds, mainWords, imposterWords, imposterCount, room.settings.mode
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
    }, 30_000);

    console.log(`[~] ${socket.id} disconnected`);
  });
});

// ── Start server ──────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`🎮 Imposter Game server running on port ${PORT}`);
  console.log(`   AI endpoint: ${AI_BASE_URL}`);
});
