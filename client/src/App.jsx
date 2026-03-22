import { useState, useEffect, useCallback } from "react";
import { BrowserRouter, Routes, Route, useNavigate, useParams, Navigate } from "react-router-dom";
import { useGame } from "./useGame.js";

// ── API helper (REST calls to our server) ─────────────────────
const SERVER = import.meta.env.VITE_SERVER_URL || "";
const api = {
  get: (path) => fetch(`${SERVER}${path}`).then(r => r.json()),
  post: async (path, body) => {
    const r = await fetch(`${SERVER}${path}`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
    const data = await r.json();
    if (r.status === 403) throw new Error("Invalid passcode");
    return data;
  },
  delete: async (path, body) => {
    const r = await fetch(`${SERVER}${path}`, { method:"DELETE", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
    const data = await r.json();
    if (r.status === 403) throw new Error("Invalid passcode");
    return data;
  },
};

// ── Root App ──────────────────────────────────────────────────
// Single game instance shared across all routes via React context
import { createContext, useContext } from "react";
const GameCtx = createContext(null);
const useGameCtx = () => useContext(GameCtx);

export default function App() {
  const game = useGame(); // ONE instance for the whole app
  return (
    <GameCtx.Provider value={game}>
      <BrowserRouter>
        <Routes>
          <Route path="/"           element={<HomeRoute />} />
          <Route path="/room/:code" element={<RoomRoute />} />
          <Route path="/admin"      element={<AdminPage onLeave={()=>window.location.href="/"} />} />
          <Route path="/test"       element={<SoloTestPage onLeave={()=>window.location.href="/"} />} />
          <Route path="*"           element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </GameCtx.Provider>
  );
}

// Home route wrapper
function HomeRoute() {
  const nav = useNavigate();
  const game = useGameCtx();
  const joinCode = new URLSearchParams(window.location.search).get("join") || "";

  useEffect(() => {
    if (game.roomCode) nav(`/room/${game.roomCode}`, { replace: true });
  }, [game.roomCode]);

  return <HomePage
    game={game}
    initialCode={joinCode}
    onEnter={(code) => nav(`/room/${code}`)}
    onAdmin={() => nav("/admin")}
    onSoloTest={() => nav("/test")}
  />;
}

// Room route wrapper — handles refresh via roomCode in URL
function RoomRoute() {
  const { code } = useParams();
  const nav = useNavigate();
  const game = useGameCtx();
  const upperCode = code.toUpperCase();

  // On mount: validate session, redirect if needed
  useEffect(() => {
    const saved = localStorage.getItem("imposter_session");
    if (!saved) {
      // No session — must be someone clicking a share link
      nav(`/?join=${upperCode}`, { replace: true });
      return;
    }
    try {
      const session = JSON.parse(saved);
      if (session.roomCode !== upperCode) {
        // Session is for a different room — redirect with new code pre-filled
        localStorage.removeItem("imposter_session");
        nav(`/?join=${upperCode}`, { replace: true });
      }
      // Session matches — useGame will handle the socket rejoin automatically
    } catch {
      localStorage.removeItem("imposter_session");
      nav("/", { replace: true });
    }
  }, []);

  function goHome() { game.leaveRoom(); nav("/"); }

  // Show loading until we have room data from socket
  if (!game.room) return (
    <div className="page">
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:16}}>
        <div style={{fontFamily:"var(--mono)",fontSize:11,color:"var(--muted)",letterSpacing:2,display:"flex",alignItems:"center",gap:8}}>
          <span className="spin"/>connecting to room {upperCode}…
        </div>
        <button className="nav-link" onClick={goHome}>Leave</button>
      </div>
    </div>
  );

  if (game.room?.gameState?.started) {
    return <GameScreen game={game} onLeave={goHome} />;
  }
  return <LobbyPage game={game} onLeave={goHome} />;
}

// ── Connection badge ──────────────────────────────────────────
function ConnBadge({ connected }) {
  return (
    <div className={`conn ${connected ? "conn--on" : "conn--off"}`}
      style={{position:"fixed", bottom:14, right:14, zIndex:50, background:"var(--bg)", padding:"4px 8px", borderRadius:4, border:"1px solid var(--border)"}}>
      <div className="dot" />
      <span>{connected ? "live" : "reconnecting…"}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PAGE: Home
// ═══════════════════════════════════════════════════════════════
function HomePage({ game, onEnter, onAdmin, onSoloTest, initialCode="" }) {
  const [mode, setMode]   = useState(initialCode ? "join" : "home");
  const [name, setName]   = useState("");
  const [code, setCode]   = useState(initialCode.toUpperCase());

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      const res = await game.createRoom(name);
      onEnter(res.roomCode);
    } catch {}
  }
  async function handleJoin() {
    if (!name.trim() || code.length < 6) return;
    try {
      const res = await game.joinRoom(code, name);
      onEnter(res.roomCode);
    } catch {}
  }

  return (
    <div className="page">
      <ConnBadge connected={game.connected} />

      {mode === "home" && (
        <>
          <div style={{textAlign:"center", marginBottom:36}}>
            <div className="logo">
              IMP<span className="logo__accent">O</span>STER
              <span className="logo__cursor" />
            </div>
            <div className="logo__sub">// the word game with a twist</div>
          </div>

          <div className="card bracket">
            <div className="field">
              <label>Your name</label>
              <input value={name} onChange={e=>setName(e.target.value)}
                placeholder="Enter your name" maxLength={30}
                onKeyDown={e=>e.key==="Enter" && name.trim() && setMode("create")} />
            </div>
            {game.error && <div className="msg msg--error">{game.error}</div>}
            <button className="btn btn--primary" onClick={() => name.trim() && setMode("create")}>
              Create Room
            </button>
            <button className="btn btn--ghost" onClick={() => name.trim() && setMode("join")}>
              Join Room
            </button>
            <div className="divider">or</div>
            <button className="nav-link" style={{display:"block",textAlign:"center",width:"100%"}} onClick={onAdmin}>
              Admin Panel
            </button>
          </div>
        </>
      )}

      {mode === "create" && (
        <div className="card bracket">
          <h2>New Room</h2>
          <div className="field">
            <label>Your name</label>
            <input value={name} onChange={e=>setName(e.target.value)} maxLength={30}
              onKeyDown={e=>e.key==="Enter" && handleCreate()} autoFocus />
          </div>
          {game.error && <div className="msg msg--error">{game.error}</div>}
          <button className="btn btn--primary" disabled={game.loading || !name.trim()} onClick={handleCreate}>
            {game.loading ? <><span className="spin"/>Creating…</> : "Create Room"}
          </button>
          <button className="btn btn--ghost" onClick={() => setMode("home")}>Back</button>
        </div>
      )}

      {mode === "join" && (
        <div className="card bracket">
          <h2>Join Room</h2>
          <div className="field">
            <label>Room Code</label>
            <input value={code} onChange={e=>setCode(e.target.value.toUpperCase())}
              placeholder="ABC123" maxLength={6} autoFocus
              style={{fontSize:28,letterSpacing:8,textAlign:"center",fontFamily:"var(--mono)"}}
              onKeyDown={e=>e.key==="Enter" && handleJoin()} />
          </div>
          <div className="field">
            <label>Your name</label>
            <input value={name} onChange={e=>setName(e.target.value)} maxLength={30}
              onKeyDown={e=>e.key==="Enter" && handleJoin()} />
          </div>
          {game.error && <div className="msg msg--error">{game.error}</div>}
          <button className="btn btn--primary" disabled={game.loading || !name.trim() || code.length<6} onClick={handleJoin}>
            {game.loading ? <><span className="spin"/>Joining…</> : "Join Room"}
          </button>
          <button className="btn btn--ghost" onClick={() => setMode("home")}>Back</button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// GAME AREA — switches between Lobby and Game Screen
// ═══════════════════════════════════════════════════════════════
function GameArea({ game, onLeave }) {
  if (game.room?.gameState?.started) {
    return <GameScreen game={game} onLeave={onLeave} />;
  }
  return <LobbyPage game={game} onLeave={onLeave} />;
}

// ═══════════════════════════════════════════════════════════════
// PAGE: Lobby
// ═══════════════════════════════════════════════════════════════
function LobbyPage({ game, onLeave }) {
  const [themes,   setThemes]   = useState([]);
  const [settings, setSettings] = useState({ imposters:1, mode:"hidden", themeId:null });
  const [copied,   setCopied]   = useState(null); // false | "link" | "code" 

  useEffect(() => {
    api.get("/themes").then(t => setThemes(Array.isArray(t) ? t : [])).catch(()=>{});
  }, []);

  function shareLink() {
    const url = `${window.location.origin}/room/${game.roomCode}`;
    const text = `Join my Imposter game! Code: ${game.roomCode}`;
    if (navigator.share) {
      // Mobile — native share sheet
      navigator.share({ title: "Imposter", text, url }).catch(()=>{});
    } else {
      // Desktop — copy link to clipboard
      navigator.clipboard.writeText(url).then(() => {
        setCopied("link");
        setTimeout(() => setCopied(null), 2000);
      }).catch(() => {
        // Fallback if clipboard API unavailable
        const el = document.createElement("textarea");
        el.value = url;
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
        setCopied("link");
        setTimeout(() => setCopied(null), 2000);
      });
    }
  }

  async function handleStart() {
    try {
      await game.updateSettings(settings);
      await game.startGame();
    } catch {}
  }

  const { room, players, isHost, roomCode, error, loading } = game;

  return (
    <div className="page">
      <ConnBadge connected={game.connected} />
      <div className="card" style={{maxWidth:480}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <h2 style={{marginBottom:0}}>Lobby</h2>
          <span className="badge badge--green">{players.length} online</span>
        </div>

        {/* Room code + share */}
        <div className="room-code bracket" onClick={shareLink} title="Tap to share or copy">
          {roomCode}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:6,marginBottom:16}}>
          {/* Big share/copy link button */}
          <button className="btn btn--primary" onClick={shareLink} style={{width:"100%",letterSpacing:1}}>
            {copied === "link"
              ? "Link copied!"
              : navigator.share ? "Share invite link" : "Copy invite link"}
          </button>
          {/* Thin copy code row */}
          <button
            onClick={()=>{
              navigator.clipboard.writeText(game.roomCode).catch(()=>{});
              setCopied("code"); setTimeout(()=>setCopied(null),2000);
            }}
            style={{
              background:"none", border:"none", cursor:"pointer",
              fontFamily:"var(--mono)", fontSize:11, color: copied==="code" ? "var(--green)" : "var(--muted)",
              letterSpacing:1, padding:"4px 0", textAlign:"center",
              transition:"color .2s",
            }}>
            {copied === "code" ? "code copied!" : `copy code only — ${game.roomCode}`}
          </button>
        </div>

        {/* Players */}
        <h3>Players</h3>
        <ul className="player-list" style={{marginBottom:20}}>
          {players.map(([id, p]) => (
            <li key={id} className="player-item">
              <div className="live-dot" />
              <span style={{flex:1}}>{p.name}</span>
              {room?.hostId === id && <span className="badge badge--yellow">host</span>}
              {id === game.playerId && <span className="badge badge--green">you</span>}
            </li>
          ))}
        </ul>

        {/* Host settings */}
        {isHost && (
          <>
            <h3>Settings</h3>
            <div style={{marginBottom:16}}>
              <div className="settings-row">
                <label>Imposters</label>
                <select value={settings.imposters} style={{maxWidth:100}}
                  onChange={e=>setSettings(s=>({...s,imposters:Number(e.target.value)}))}>
                  {[1,2,3,4].map(n=><option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="settings-row">
                <label>Mode</label>
                <select value={settings.mode} style={{maxWidth:200}}
                  onChange={e=>setSettings(s=>({...s,mode:e.target.value}))}>
                  <option value="hidden">Hidden imposter (default)</option>
                  <option value="known">Known imposter</option>
                </select>
              </div>
              <div className="settings-row" style={{flexDirection:"column",alignItems:"flex-start",gap:8}}>
                <label>Theme</label>
                <div style={{display:"flex",flexDirection:"column",gap:5,width:"100%",maxHeight:170,overflowY:"auto"}}>
                  <div className={`theme-card ${!settings.themeId?"theme-card--active":""}`}
                    onClick={()=>setSettings(s=>({...s,themeId:null}))}>
                    <span className="theme-card__name">No theme (random words)</span>
                    {!settings.themeId && <span className="badge badge--green">selected</span>}
                  </div>
                  {themes.map(t=>(
                    <div key={t.id}
                      className={`theme-card ${settings.themeId===t.id?"theme-card--active":""}`}
                      onClick={()=>setSettings(s=>({...s,themeId:t.id}))}>
                      <div>
                        <div className="theme-card__name">{t.name}</div>
                        <div className="theme-card__meta">{t.category} · {t.word_count} words</div>
                      </div>
                      {settings.themeId===t.id && <span className="badge badge--green">selected</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {error && <div className="msg msg--error">{error}</div>}

            <button className="btn btn--green" disabled={loading || players.length < 3} onClick={handleStart}>
              {loading ? <><span className="spin"/>Starting…</> : `Start Game`}
            </button>
            {players.length < 3 &&
              <p style={{fontSize:11,color:"var(--muted)",textAlign:"center",marginTop:6}}>Need at least 3 players to start</p>}
          </>
        )}

        {!isHost && (
          <div style={{textAlign:"center",padding:"14px 0",color:"var(--muted)",fontSize:13,fontStyle:"italic"}}>
            Waiting for host to start…
          </div>
        )}

        <button className="btn btn--ghost" style={{marginTop:14}} onClick={onLeave}>Leave</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PAGE: Game Screen
// ═══════════════════════════════════════════════════════════════
function GameScreen({ game, onLeave }) {
  const [showWord,   setShowWord]   = useState(false);
  const { room, players, isHost, roomCode, assignment, revealed, error, loading } = game;

  const modeLabel = room?.settings?.mode === "known" ? "Known Imposter" : "Hidden Imposter";

  return (
    <div className="page" style={{justifyContent:"flex-start",paddingTop:40}}>
      <ConnBadge connected={game.connected} />
      <div className="card" style={{maxWidth:480}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <h2 style={{marginBottom:0}}>In Game</h2>
          <div style={{display:"flex",gap:5,alignItems:"center"}}>
            <span className="badge">{roomCode}</span>
            <span className="badge">{modeLabel}</span>
            <button className="btn btn--ghost btn--sm" style={{padding:"4px 10px"}} onClick={()=>{
              const url = `${window.location.origin}/room/${roomCode}`;
              if (navigator.share) {
                navigator.share({title:"Imposter",text:`Join code: ${roomCode}`,url}).catch(()=>{});
              } else {
                navigator.clipboard.writeText(url).then(()=>{}).catch(()=>{
                  const el = document.createElement("textarea");
                  el.value = url; document.body.appendChild(el);
                  el.select(); document.execCommand("copy");
                  document.body.removeChild(el);
                });
              }
            }}>share</button>
          </div>
        </div>

        {/* Word reveal */}
        {!showWord ? (
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <p style={{color:"var(--muted)",fontSize:14,marginBottom:6,lineHeight:1.5}}>
              Tap to reveal your secret word.<br />
              <strong style={{color:"var(--text)"}}>Keep it hidden from others!</strong>
            </p>
            <button className="btn btn--yellow btn--inline" style={{width:"auto",padding:"12px 32px",marginTop:12}}
              onClick={()=>setShowWord(true)}>
              Reveal My Word
            </button>
          </div>
        ) : (
          <WordReveal assignment={assignment} onHide={() => setShowWord(false)} />
        )}

        {/* Words revealed at end of round */}
        {revealed && (
          <div style={{marginTop:16,padding:"14px",background:"var(--bg)",border:"1px solid var(--green)",borderRadius:6}}>
            <h3 style={{color:"var(--yellow)"}}>Round Reveal</h3>
            <div style={{fontSize:13,lineHeight:1.8}}>
              <div>Main word: <strong style={{color:"var(--green)"}}>{revealed.mainWord}</strong></div>
              <div>Imposter word: <strong style={{color:"var(--accent)"}}>{revealed.imposterWord}</strong></div>
            </div>
            {revealed.assignments && (
              <div style={{marginTop:10}}>
                <h3 style={{marginBottom:6}}>Roles</h3>
                <ul className="player-list">
                  {Object.entries(revealed.assignments).map(([pid, a]) => {
                    const p = room?.players?.[pid];
                    return (
                      <li key={pid} className="player-item">
                        <div className="live-dot" style={{background: a.role==="imposter" ? "var(--accent)" : "var(--green)"}} />
                        <span style={{flex:1}}>{p?.name || pid}</span>
                        <span className={`badge ${a.role==="imposter"?"badge--red":"badge--green"}`}>
                          {a.role}
                        </span>
                        {a.word && <span style={{fontFamily:"var(--mono)",fontSize:11,color:"var(--muted)"}}>{a.word}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Player list */}
        <div className="divider" style={{margin:"18px 0 12px"}}>Players — {players.length}</div>
        <ul className="player-list">
          {players.map(([id, p]) => (
            <li key={id} className="player-item">
              <div className="live-dot" />
              <span style={{flex:1}}>{p.name}</span>
              {room?.hostId === id && <span className="badge badge--yellow">host</span>}
              {id === game.playerId && <span className="badge badge--green">you</span>}
            </li>
          ))}
        </ul>

        {/* How to play */}
        <div style={{marginTop:16,padding:"11px 13px",background:"var(--bg)",border:"1px solid var(--border)",
          borderRadius:6,fontSize:12,color:"var(--muted)",lineHeight:1.6}}>
          <span style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--text)",letterSpacing:1}}>HOW TO PLAY  </span>
          Discuss clues about your word without saying it directly.
          {room?.settings?.mode==="hidden"
            ? " Imposters don't know they're imposters — they got a slightly different word!"
            : " Imposters know their role but have no word — they must bluff!"}
          {" "}Vote out who you think the imposter is.
        </div>

        {error && <div className="msg msg--error" style={{marginTop:10}}>{error}</div>}

        {/* Host controls */}
        {isHost && !revealed && (
          <div style={{marginTop:16,paddingTop:16,borderTop:"1px solid var(--border)"}}>
            <h3>Host Controls</h3>
            <button className="btn btn--yellow" disabled={loading} onClick={game.revealWords}>
              {loading ? <><span className="spin"/>…</> : "Reveal All Words"}
            </button>
          </div>
        )}
        {isHost && (
          <button className="btn btn--ghost" style={{marginTop:8}} disabled={loading} onClick={game.resetGame}>
            {loading ? <><span className="spin"/>…</> : "New Round"}
          </button>
        )}

        <button className="btn btn--danger" style={{marginTop:8}} onClick={onLeave}>Leave Game</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT: WordReveal
// ═══════════════════════════════════════════════════════════════
function WordReveal({ assignment, onHide }) {
  if (!assignment) return (
    <div className="reveal-wrap">
      <p style={{color:"var(--muted)"}}>Waiting for assignment…</p>
    </div>
  );

  const { role, word, knowsRole } = assignment;
  const isKnownImposter = role === "imposter" && knowsRole;

  return (
    <div className="reveal-wrap">
      <div className="reveal-role" style={{color: role==="crewmate" ? "var(--green)" : "var(--accent)"}}>
        {isKnownImposter ? "you are the imposter" : role === "crewmate" ? " crewmate" : "your word"}
      </div>
      <div className={`reveal-word ${role==="crewmate" ? "reveal-word--crew" : isKnownImposter ? "reveal-word--imp-know" : "reveal-word--imp-hide"}`}>
        {isKnownImposter ? "???" : word || "???"}
      </div>
      <div className="reveal-hint">
        {isKnownImposter
          ? "You have no word. Listen carefully and bluff using others' clues."
          : role === "crewmate"
            ? "Give clues about your word — but don't say it directly!"
            : "Give clues about your word. You might not know you're the imposter."}
      </div>
      <button className="btn btn--ghost btn--inline" style={{marginTop:16,width:"auto",padding:"8px 20px"}} onClick={onHide}>
        Hide Word
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PAGE: Admin
// ═══════════════════════════════════════════════════════════════
function AdminPage({ onLeave }) {
  const [authed,    setAuthed]    = useState(false);
  const [passcode,  setPasscode]  = useState("");
  const [authErr,   setAuthErr]   = useState("");
  const [shake,     setShake]     = useState(false);
  const [showPass,  setShowPass]  = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [themes,    setThemes]    = useState([]);
  const [editing,   setEditing]   = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [success,   setSuccess]   = useState(null);

  const [form, setForm] = useState({
    name:"", category:"anime", seedWords:"", referenceText:"",
    referenceUrls:[""],
    words:[],
  });
  const [genResult, setGenResult] = useState(null);
  const [generating, setGenerating] = useState(false);

  async function handleAuth() {
    if (!passcode.trim()) return triggerError("Enter a passcode");
    setLoading(true); setAuthErr("");
    try {
      await api.post("/admin/theme", { passcode, name: "", words: [] });
    } catch(e) {
      setLoading(false);
      if (e.message.includes("Invalid passcode")) return triggerError("Wrong passcode");
    }
    setLoading(false);
    setAuthed(true);
    loadThemes();
  }

  function triggerError(msg) {
    setAuthErr(msg);
    setShake(true);
    setPasscode("");
    setTimeout(() => setShake(false), 600);
  }

  async function loadThemes() {
    const t = await api.get("/themes").catch(()=>[]);
    setThemes(Array.isArray(t) ? t : []);
  }

  async function handleGenerate() {
    setGenerating(true); setError(null); setGenResult(null);
    const res = await api.post("/admin/generate", {
      passcode,
      themeName:     form.name,
      category:      form.category,
      seedWords:     form.seedWords.split(",").map(s=>s.trim()).filter(Boolean),
      referenceText: form.referenceText,
      referenceUrls: form.referenceUrls.filter(u=>u.trim()),
      modelChoice:   form.modelChoice,
    }).catch(e=>({error:e.message}));
    setGenerating(false);
    if (res.error) return setError(res.error);
    setGenResult(res);
    setForm(f=>({...f, words: res.words||[]}));
  }

  async function handleSave() {
    setLoading(true); setError(null); setSuccess(null);
    const res = await api.post("/admin/theme", {
      passcode, id: editing?.id,
      name: form.name, category: form.category,
      words: form.words,
    }).catch(e=>({error:e.message}));
    setLoading(false);
    if (res.error) return setError(res.error);
    setSuccess("Theme saved!");
    loadThemes();
    setEditing(null);
    setForm({name:"",category:"anime",seedWords:"",referenceText:"",referenceUrls:[""],words:[]});
    setGenResult(null);
  }

  async function handleDelete(id) {
    if (!confirm("Delete this theme?")) return;
    await api.delete(`/admin/theme/${id}`, { passcode }).catch(()=>{});
    loadThemes();
  }

  function startEdit(theme) {
    setEditing(theme);
    setGenResult(null);
    setForm({
      name: theme.name, category: theme.category||"anime",
      seedWords:"", referenceText:"", modelChoice:"fast",
      words: theme.words||[], referenceUrls:[""],
    });
    // Load full theme data for words
    api.get(`/themes`).then(ts => {
      // We only get counts from list — need full data for editing
      // In a real app you'd have /themes/:id; for now, words come from form
    });
  }

  // ── Auth gate ──────────────────────────────────────────────
  if (!authed) return (
    <div className="page" style={{animation:"fadeUp .3s ease both"}}>
      <div className="card bracket" style={{
        animation: shake ? "shake .5s ease" : "none",
        border: authErr ? "1px solid var(--accent)" : undefined,
        transition: "border-color .2s",
      }}>
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{fontFamily:"var(--mono)",fontSize:11,color: authErr ? "var(--accent)" : "var(--muted)",letterSpacing:2,marginBottom:12}}>
            {authErr ? "ACCESS DENIED" : "RESTRICTED"}
          </div>
          <h2 style={{marginBottom:4}}>Admin</h2>
          <p style={{color:"var(--muted)",fontSize:13}}>Theme management & AI generation</p>
        </div>
        <div className="field">
          <label style={{color: authErr ? "var(--accent)" : undefined}}>
            {authErr ? authErr : "Passcode"}
          </label>
          <div style={{position:"relative",display:"flex",alignItems:"center"}}>
            <input
              type={showPass ? "text" : "password"}
              value={passcode}
              onChange={e=>{setPasscode(e.target.value);setAuthErr("");}}
              onKeyDown={e=>e.key==="Enter"&&handleAuth()}
              placeholder="••••••••"
              autoFocus
              style={{
                borderColor: authErr ? "var(--accent)" : undefined,
                paddingRight: 44,
                width: "100%",
              }} />
            <button
              type="button"
              onClick={()=>setShowPass(s=>!s)}
              style={{
                position:"absolute", right:0,
                height:"100%", width:40,
                background:"none", border:"none",
                cursor:"pointer",
                color: showPass ? "var(--text)" : "var(--muted)",
                fontFamily:"var(--mono)", fontSize:9,
                letterSpacing:0.5,
                transition:"color .15s",
                display:"flex", alignItems:"center", justifyContent:"center",
              }}>
              {showPass ? "HIDE" : "SHOW"}
            </button>
          </div>
        </div>
        <button className="btn btn--primary" disabled={loading} onClick={handleAuth}>
          {loading ? <><span className="spin"/>Checking…</> : "Unlock"}
        </button>
        <button className="btn btn--ghost" style={{marginTop:16}} onClick={onLeave}>Back to Game</button>
      </div>
    </div>
  );

  // ── Dashboard ──────────────────────────────────────────────
  return (
    <div className="page" style={{justifyContent:"flex-start",paddingTop:50,alignItems:"stretch",maxWidth:860,margin:"0 auto"}}>
      <div className="admin-bar">
        ADMIN MODE
        <span style={{marginLeft:"auto",cursor:"pointer"}} onClick={onLeave}>Exit</span>
      </div>

      <div style={{padding:"0 16px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"16px 0"}}>
          <h2 style={{marginBottom:0}}>Theme Manager</h2>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button
              className={`badge ${debugMode?"badge--yellow":""}`}
              style={{cursor:"pointer",border:"none",padding:"5px 10px",fontSize:10}}
              onClick={()=>setDebugMode(d=>!d)}
              title="Toggle debug mode">
              {debugMode ? "DEBUG ON" : "DEBUG"}
            </button>
            <button className="btn btn--green btn--sm" onClick={()=>{
              setEditing({id:null});
              setForm({name:"",category:"anime",seedWords:"",referenceText:"",referenceUrls:[""],words:[]});
              setGenResult(null);
            }}>+ New Theme</button>
          </div>
        </div>

        {error   && <div className="msg msg--error">{error}</div>}
        {success && <div className="msg msg--success">{success}</div>}

        {debugMode && (
          <div style={{marginTop:8,padding:"12px 14px",background:"var(--bg)",border:"1px solid var(--yellow)",borderRadius:6,animation:"slideIn .2s ease"}}>
            <div style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--yellow)",letterSpacing:1,marginBottom:10}}>DEBUG MODE</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              <button className="btn btn--ghost btn--sm" onClick={loadThemes}>Reload Themes</button>
              <button className="btn btn--ghost btn--sm" onClick={()=>setEditing({id:null})}>+ Force New Theme</button>
              <button className="btn btn--ghost btn--sm" onClick={()=>{
                setSuccess("Test success message");
                setTimeout(()=>setSuccess(null),2000);
              }}>Test Success</button>
              <button className="btn btn--danger btn--sm" onClick={()=>{
                setError("Test error message");
                setTimeout(()=>setError(null),2000);
              }}>Test Error</button>
              <button className="btn btn--ghost btn--sm" onClick={()=>{
                const fake = {words:["test-word-1","test-word-2","test-word-3","test-word-4","test-word-5"],theme:"debug",model:"debug",cached:false};
                setGenResult(fake);
                setForm(f=>({...f,words:fake.words}));
              }}>Mock AI Result</button>
            </div>
            <div style={{marginTop:10,fontFamily:"var(--mono)",fontSize:10,color:"var(--muted)"}}>
              themes loaded: <span style={{color:"var(--text)"}}>{themes.length}</span>
            </div>
          </div>
        )}
      </div>

      <div style={{display:"flex",gap:16,padding:"0 16px 40px",flexWrap:"wrap",alignItems:"flex-start"}}>
        {/* Theme list */}
        <div style={{flex:"1 1 240px",minWidth:200}}>
          <h3>Themes ({themes.length})</h3>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {themes.length===0 && <p style={{color:"var(--muted)",fontSize:13}}>No themes yet.</p>}
            {themes.map(t=>(
              <div key={t.id} style={{background:"var(--surface)",border:"1px solid var(--border)",
                borderRadius:6,padding:"10px 13px",display:"flex",alignItems:"center",gap:8}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:500,fontSize:14}}>{t.name}</div>
                  <div style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--muted)"}}>
                    {t.category} · {t.word_count} words
                  </div>
                </div>
                <button className="btn btn--ghost btn--sm" onClick={()=>startEdit(t)}>Edit</button>
                <button className="btn btn--danger btn--sm" onClick={()=>handleDelete(t.id)}>x</button>
              </div>
            ))}
          </div>
        </div>

        {/* Editor */}
        {editing !== null && (
          <div style={{flex:"1 1 320px",minWidth:280}}>
            <h3>{editing.id ? "Edit Theme" : "New Theme"}</h3>
            <div className="card" style={{maxWidth:"100%",padding:20}}>
              <div className="field">
                <label>Theme Name</label>
                <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}
                  placeholder="e.g. Jujutsu Kaisen" autoFocus />
              </div>
              <div className="field">
                <label>Category</label>
                <select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
                  {["anime","game","show","animal","food","general"].map(c=>(
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Seed Words (comma-separated, optional)</label>
                <input value={form.seedWords} onChange={e=>setForm(f=>({...f,seedWords:e.target.value}))}
                  placeholder="gojo, sukuna, yuji" />
              </div>
              <div className="field">
                <label>Reference URLs (fandom wiki, etc.)</label>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {form.referenceUrls.map((url, i) => (
                    <div key={i} style={{display:"flex",gap:6}}>
                      <input
                        value={url}
                        onChange={e=>{
                          const urls = [...form.referenceUrls];
                          urls[i] = e.target.value;
                          setForm(f=>({...f, referenceUrls: urls}));
                        }}
                        placeholder="https://kimetsu-no-yaiba.fandom.com/wiki/..."
                        style={{flex:1, fontSize:12}}
                      />
                      {form.referenceUrls.length > 1 && (
                        <button className="btn btn--danger btn--sm" onClick={()=>{
                          setForm(f=>({...f, referenceUrls: f.referenceUrls.filter((_,j)=>j!==i)}));
                        }}>x</button>
                      )}
                    </div>
                  ))}
                  <button className="btn btn--ghost btn--sm" style={{width:"auto",alignSelf:"flex-start"}}
                    onClick={()=>setForm(f=>({...f, referenceUrls:[...f.referenceUrls,""]}))}>
                    + Add URL
                  </button>
                </div>
              </div>
              <div className="field">
                <label>Extra Reference Text (optional — paste additional wiki text)</label>
                <textarea value={form.referenceText} onChange={e=>setForm(f=>({...f,referenceText:e.target.value}))}
                  placeholder="Paste any extra character lists, lore, etc." rows={3} />
              </div>


              <button className="btn btn--yellow" disabled={generating||!form.name} onClick={handleGenerate}>
                {generating ? <><span className="spin"/>Generating…</> : "Generate with AI"}
              </button>

              {genResult && (
                <div className="msg msg--success" style={{marginTop:8}}>
                   {genResult.words?.length} words in pool
                  {genResult.cached ? " (cached)" : ` via ${genResult.model}`}
                </div>
              )}

              {/* Word editors */}
              {form.words.length > 0 && (
                <div style={{marginTop:14}}>
                  <WordEditor label={`Word Pool (${form.words.length})`}
                    accent="var(--green)" words={form.words}
                    onRemove={w=>setForm(f=>({...f,words:f.words.filter(x=>x!==w)}))}
                    onAdd={w=>{w=w.trim().toLowerCase();if(w)setForm(f=>({...f,words:[...new Set([...f.words,w])]}));}} />

                </div>
              )}

              <div style={{display:"flex",gap:8,marginTop:14}}>
                <button className="btn btn--primary" style={{flex:1}}
                  disabled={loading||!form.name||form.words.length===0} onClick={handleSave}>
                  {loading ? <><span className="spin"/>Saving…</> : "Save Theme"}
                </button>
                <button className="btn btn--ghost btn--sm" onClick={()=>setEditing(null)}>Cancel</button>
              </div>
            </div>

            {/* Prompt preview */}
            <PromptPreview form={form} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Component: WordEditor ─────────────────────────────────────
function WordEditor({ label, words, accent, onRemove, onAdd }) {
  const [input, setInput] = useState("");
  return (
    <div style={{marginBottom:14}}>
      <label style={{color:accent}}>{label}</label>
      <div className="word-grid">
        {words.map(w=>(
          <span key={w} className="chip" style={{borderColor:accent+"33"}}>
            {w}
            <button className="chip__remove" onClick={()=>onRemove(w)}>×</button>
          </span>
        ))}
      </div>
      <div style={{display:"flex",gap:6,marginTop:5}}>
        <input value={input} onChange={e=>setInput(e.target.value)}
          placeholder="Add word…" style={{flex:1,fontSize:12,padding:"7px 10px"}}
          onKeyDown={e=>{if(e.key==="Enter"){onAdd(input);setInput("");}}} />
        <button className="btn btn--ghost btn--sm" onClick={()=>{onAdd(input);setInput("");}}>Add</button>
      </div>
    </div>
  );
}

// ── Component: Prompt Preview ─────────────────────────────────
function PromptPreview({ form }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(null);
  if (!form.name) return null;

  const guides = {
    anime:"Characters, abilities, locations, organisations, items.",
    game:"Characters, weapons, maps/zones, items, abilities.",
    show:"Characters, locations, items, organisations.",
    animal:"Species, habitats, traits, behaviours.",
    food:"Dishes, ingredients, techniques, cuisines.",
    general:"Proper nouns specific to this theme.",
  };
  const g = guides[form.category]||guides.general;
  const seed = form.seedWords ? `Seed words: ${form.seedWords}` : "No seed words.";
  const refClip = form.referenceText.slice(0,150)+(form.referenceText.length>150?"…":"");

  const fast = `Theme: ${form.name} | Category: ${form.category}
Guidelines: ${g}
${seed}${refClip?`\nReference: ${refClip}`:""}
Output JSON: {"theme":"${form.name}","words":[50 words]}
No overlap. Lowercase. No markdown. JSON:`;

  const hq = `Theme: ${form.name} | Category: ${form.category}
Types: ${g}
${seed}${refClip?`\nRef: ${refClip}`:""}
Format: {"theme":"${form.name}","words":[50 words]}
JSON only:`;

  function copy(text, key) {
    navigator.clipboard.writeText(text).catch(()=>{});
    setCopied(key); setTimeout(()=>setCopied(null),1500);
  }

  return (
    <div style={{marginTop:12}}>
      <button className="nav-link" onClick={()=>setShow(s=>!s)}>
        {show?"-":"+"} Preview AI prompts
      </button>
      {show && (
        <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:10}}>
          {[["qwen-90k (qwen3.5:4b — 90k context)", fast, "fast"]].map(([label, prompt, key])=>(
            <div key={key} style={{border:"1px solid var(--border)",borderRadius:6,overflow:"hidden"}}>
              <div style={{padding:"6px 10px",background:"var(--bg)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--green)",letterSpacing:1}}>{label}</span>
                <button className="btn btn--ghost btn--sm" onClick={()=>copy(prompt,key)}>
                  {copied===key?" Copied":"Copy"}
                </button>
              </div>
              <pre className="prompt-box">{prompt}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PAGE: SoloTestPage — debug simulator for testing game logic
// Access: click the IMPOSTER logo 5 times fast on home screen
// ═══════════════════════════════════════════════════════════════
function SoloTestPage({ onLeave }) {
  const SERVER = import.meta.env.VITE_SERVER_URL || "";

  const [playerCount, setPlayerCount] = useState(4);
  const [imposterCount, setImposterCount] = useState(1);
  const [mode, setMode] = useState("hidden");
  const [themeId, setThemeId] = useState(null);
  const [themes, setThemes] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${SERVER}/themes`).then(r=>r.json()).then(t=>setThemes(Array.isArray(t)?t:[])).catch(()=>{});
  }, []);

  // Simulate role assignment locally (mirrors server logic exactly)
  function simulate() {
    setLoading(true);
    const theme = themes.find(t => t.id === themeId);
    const pool = theme?.words?.length
      ? theme.words
      : ["kettle","mirror","pillow","blanket","curtain","ladder","bucket","candle","drawer","fridge",
        "toaster","scissors","hammer","stapler","envelope","calendar","remote","charger","umbrella","suitcase",
        "doorbell","mailbox","bathtub","carpet","chimney","cupboard","wardrobe","pizza","burger","sushi",
        "ramen","pasta","curry","steak","salmon","mango","avocado","croissant","waffle","pancake",
        "brownie","pretzel","noodles","burrito","taco","dumpling","cheesecake","espresso","smoothie","lemonade",
        "milkshake","cocktail","whiskey","cider","yoghurt","granola","omelette","penguin","dolphin","elephant",
        "giraffe","cheetah","gorilla","panther","flamingo","octopus","hedgehog","mongoose","raccoon","platypus",
        "chameleon","pelican","vulture","meerkat","capybara","axolotl","hamster","parrot","iguana","tortoise",
        "piranha","narwhal","walrus","manatee","wolverine","armadillo","library","airport","stadium","hospital",
        "cathedral","lighthouse","cemetery","volcano","glacier","canyon","swamp","harbour","plateau","peninsula",
        "suburb","alleyway","rooftop","basement","greenhouse","warehouse","observatory","aquarium","monastery",
        "submarine","helicopter","motorcycle","skateboard","hovercraft","gondola","zeppelin","tractor","ambulance",
        "telescope","microscope","calculator","projector","satellite","compass","thermometer","hourglass","periscope",
        "tuxedo","kimono","sombrero","beret","gloves","scarf","boots","sandals","goggles","bracelet",
        "lightning","avalanche","monsoon","tornado","blizzard","earthquake","tsunami","rainbow","eclipse",
        "waterfall","geyser","quicksand","cactus","bamboo","mushroom","archery","fencing","surfing","wrestling",
        "lacrosse","cricket","badminton","blacksmith","surgeon","astronaut","detective","archaeologist","locksmith",
        "anchor","trophy","passport","blueprint","fossil","crystal","magnet","prism","vault","labyrinth"];

    const mainWord = pool[Math.floor(Math.random() * pool.length)];
    const remaining = pool.filter(w => w !== mainWord);
    const impWord = remaining.length
      ? remaining[Math.floor(Math.random() * remaining.length)]
      : mainWord;

    const names = ["Alice","Bob","Carol","Dave","Eve","Frank","Grace","Hal"];
    const players = Array.from({length: playerCount}, (_, i) => ({
      id: `player_${i}`, name: names[i] || `Player ${i+1}`
    }));

    const shuffled = [...players].sort(() => Math.random() - 0.5);
    const imposterSet = new Set(shuffled.slice(0, imposterCount).map(p => p.id));

    const assignments = players.map(p => {
      const isImp = imposterSet.has(p.id);
      return {
        name: p.name,
        role: isImp ? "imposter" : "crewmate",
        word: isImp
          ? (mode === "hidden" ? impWord : null)
          : mainWord,
        knowsRole: isImp ? mode === "known" : true,
      };
    });

    setTimeout(() => {
      setResult({ assignments, mainWord, impWord, pool: pool.slice(0, 10), theme: theme?.name || "default" });
      setLoading(false);
    }, 400);
  }

  return (
    <div className="page" style={{justifyContent:"flex-start", paddingTop:24}}>
      <div className="card" style={{maxWidth:520}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <h2 style={{marginBottom:0}}>Solo Test</h2>
          <span className="badge badge--yellow">DEBUG</span>
        </div>

        {/* Config */}
        <div className="settings-row">
          <label>Players</label>
          <select value={playerCount} style={{maxWidth:100}} onChange={e=>setPlayerCount(Number(e.target.value))}>
            {[3,4,5,6,7,8].map(n=><option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="settings-row">
          <label>Imposters</label>
          <select value={imposterCount} style={{maxWidth:100}} onChange={e=>setImposterCount(Number(e.target.value))}>
            {[1,2,3].map(n=><option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="settings-row">
          <label>Mode</label>
          <select value={mode} style={{maxWidth:180}} onChange={e=>setMode(e.target.value)}>
            <option value="hidden">Hidden imposter</option>
            <option value="known">Known imposter</option>
          </select>
        </div>
        <div className="settings-row" style={{flexDirection:"column",alignItems:"flex-start",gap:6}}>
          <label>Theme</label>
          <select value={themeId||""} style={{width:"100%"}} onChange={e=>setThemeId(e.target.value||null)}>
            <option value="">Default words (no theme)</option>
            {themes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <button className="btn btn--yellow" disabled={loading} style={{marginTop:16}} onClick={simulate}>
          {loading ? <><span className="spin"/>Simulating…</> : "Run Simulation"}
        </button>

        {/* Results */}
        {result && (
          <div style={{marginTop:20,animation:"fadeUp .25s ease"}}>
            <div className="divider">Round Result</div>

            <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
              <div style={{padding:"8px 12px",background:"var(--bg)",border:"1px solid var(--green)",borderRadius:6,flex:1}}>
                <div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--muted)",letterSpacing:1,marginBottom:4}}>CREWMATE WORD</div>
                <div style={{fontFamily:"var(--display)",fontSize:20,color:"var(--green)",fontWeight:700}}>{result.mainWord}</div>
              </div>
              <div style={{padding:"8px 12px",background:"var(--bg)",border:"1px solid var(--accent)",borderRadius:6,flex:1}}>
                <div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--muted)",letterSpacing:1,marginBottom:4}}>IMPOSTER WORD</div>
                <div style={{fontFamily:"var(--display)",fontSize:20,color:"var(--accent)",fontWeight:700}}>
                  {mode==="known" ? "none (known mode)" : result.impWord}
                </div>
              </div>
            </div>

            <h3 style={{marginBottom:8}}>Player Assignments</h3>
            <ul className="player-list">
              {result.assignments.map((a,i) => (
                <li key={i} className="player-item" style={{
                  borderColor: a.role==="imposter" ? "rgba(230,57,80,.3)" : undefined
                }}>
                  <div className="live-dot" style={{background: a.role==="imposter" ? "var(--accent)" : "var(--green)"}}/>
                  <span style={{flex:1,fontWeight:500}}>{a.name}</span>
                  <span className={`badge ${a.role==="imposter"?"badge--red":"badge--green"}`}>{a.role}</span>
                  <span style={{fontFamily:"var(--mono)",fontSize:11,color:"var(--muted)",minWidth:80,textAlign:"right"}}>
                    {a.role==="imposter" && mode==="known" ? "no word" : (a.word || "—")}
                  </span>
                </li>
              ))}
            </ul>

            <div style={{marginTop:12,padding:"10px 12px",background:"var(--bg)",border:"1px solid var(--border)",borderRadius:6}}>
              <div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--muted)",letterSpacing:1,marginBottom:6}}>VERIFICATION</div>
              <div style={{fontSize:12,color:"var(--muted)",lineHeight:1.8}}>
                <div>Theme: <span style={{color:"var(--text)"}}>{result.theme}</span></div>
                <div>Crewmates share: <span style={{color:"var(--green)"}}>{result.mainWord}</span></div>
                <div>Imposter{imposterCount>1?"s":""} got: <span style={{color:"var(--accent)"}}>{mode==="known"?"no word":result.impWord}</span></div>
                <div>Words are different: <span style={{color: result.mainWord!==result.impWord?"var(--green)":"var(--accent)"}}>{result.mainWord!==result.impWord?"yes — correct":"no — pool too small"}</span></div>
              </div>
            </div>

            <button className="btn btn--ghost" style={{marginTop:10}} onClick={simulate}>Run Again</button>
          </div>
        )}

        <button className="btn btn--ghost" style={{marginTop:12}} onClick={onLeave}>Back to Game</button>
      </div>
    </div>
  );
}
