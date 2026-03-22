import { useState, useEffect, useCallback } from "react";
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
export default function App() {
  const [page, setPage] = useState("home"); // home | game | admin
  const game = useGame();

  // Auto-enter game page if we have a room (e.g. after reconnect)
  useEffect(() => {
    if (game.roomCode && page === "home") setPage("game");
  }, [game.roomCode]);

  function goHome() { game.leaveRoom(); setPage("home"); }

  if (page === "admin") return <AdminPage onLeave={() => setPage("home")} />;
  if (page === "game")  return <GameArea  game={game} onLeave={goHome} />;
  return <HomePage game={game} onEnter={() => setPage("game")} onAdmin={() => setPage("admin")} />;
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
function HomePage({ game, onEnter, onAdmin }) {
  const [mode, setMode]   = useState("home"); // home | create | join
  const [name, setName]   = useState("");
  const [code, setCode]   = useState("");

  async function handleCreate() {
    if (!name.trim()) return;
    try { await game.createRoom(name); onEnter(); } catch {}
  }
  async function handleJoin() {
    if (!name.trim() || code.length < 6) return;
    try { await game.joinRoom(code, name); onEnter(); } catch {}
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
              ⚙ Admin Panel
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
          <button className="btn btn--ghost" onClick={() => setMode("home")}>← Back</button>
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
          <button className="btn btn--ghost" onClick={() => setMode("home")}>← Back</button>
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
  const [copied,   setCopied]   = useState(false);

  useEffect(() => {
    api.get("/themes").then(t => setThemes(Array.isArray(t) ? t : [])).catch(()=>{});
  }, []);

  function copy() {
    navigator.clipboard.writeText(game.roomCode).catch(()=>{});
    setCopied(true); setTimeout(() => setCopied(false), 1500);
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

        {/* Room code */}
        <div className="room-code bracket" onClick={copy} title="Tap to copy">
          {roomCode}
        </div>
        {copied
          ? <div className="msg msg--success" style={{textAlign:"center",marginTop:-4,marginBottom:8}}>Copied!</div>
          : <p style={{fontSize:12,color:"var(--muted)",textAlign:"center",marginBottom:16}}>Share this code with friends to join</p>
        }

        {/* Players */}
        <h3>Players</h3>
        <ul className="player-list" style={{marginBottom:20}}>
          {players.map(([id, p]) => (
            <li key={id} className="player-item">
              <div className="live-dot" />
              <span style={{flex:1}}>{p.name}</span>
              {room?.hostId === id && <span style={{color:"#f5c842"}}>👑</span>}
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
                    <span className="theme-card__name">🎲 No theme (random words)</span>
                    {!settings.themeId && <span style={{color:"var(--green)"}}>✓</span>}
                  </div>
                  {themes.map(t=>(
                    <div key={t.id}
                      className={`theme-card ${settings.themeId===t.id?"theme-card--active":""}`}
                      onClick={()=>setSettings(s=>({...s,themeId:t.id}))}>
                      <div>
                        <div className="theme-card__name">{t.name}</div>
                        <div className="theme-card__meta">{t.category} · {t.word_count} words</div>
                      </div>
                      {settings.themeId===t.id && <span style={{color:"var(--green)"}}>✓</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {error && <div className="msg msg--error">{error}</div>}

            <button className="btn btn--green" disabled={loading || players.length < 3} onClick={handleStart}>
              {loading ? <><span className="spin"/>Starting…</> : `▶ Start Game`}
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
          <div style={{display:"flex",gap:5}}>
            <span className="badge">{roomCode}</span>
            <span className="badge">{modeLabel}</span>
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
              👁 Reveal My Word
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
              {room?.hostId === id && <span style={{color:"var(--yellow)"}}>👑</span>}
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
              {loading ? <><span className="spin"/>…</> : "🔓 Reveal All Words"}
            </button>
          </div>
        )}
        {isHost && (
          <button className="btn btn--ghost" style={{marginTop:8}} disabled={loading} onClick={game.resetGame}>
            {loading ? <><span className="spin"/>…</> : "↩ New Round"}
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
        {isKnownImposter ? "⚠ you are the imposter" : role === "crewmate" ? "✓ crewmate" : "your word"}
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
  const [authed,   setAuthed]   = useState(false);
  const [passcode, setPasscode] = useState("");
  const [authErr,  setAuthErr]  = useState("");
  const [themes,   setThemes]   = useState([]);
  const [editing,  setEditing]  = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [success,  setSuccess]  = useState(null);

  const [form, setForm] = useState({
    name:"", category:"anime", seedWords:"", referenceText:"",
    words:[],
  });
  const [genResult, setGenResult] = useState(null);
  const [generating, setGenerating] = useState(false);

  async function handleAuth() {
    if (!passcode.trim()) return setAuthErr("Enter passcode");
    setLoading(true); setAuthErr("");
    try {
      // Test the passcode server-side — wrong passcode returns 403 which throws
      // Correct passcode returns 400 "Name required" which is fine — means auth passed
      await api.post("/admin/theme", { passcode, name: "", words: [] });
    } catch(e) {
      setLoading(false);
      if (e.message.includes("Invalid passcode")) return setAuthErr("Wrong passcode");
    }
    setLoading(false);
    setAuthed(true);
    loadThemes();
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
    setForm({name:"",category:"anime",seedWords:"",referenceText:"",words:[]});
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
      words: theme.words||[],
    });
    // Load full theme data for words
    api.get(`/themes`).then(ts => {
      // We only get counts from list — need full data for editing
      // In a real app you'd have /themes/:id; for now, words come from form
    });
  }

  // ── Auth gate ──────────────────────────────────────────────
  if (!authed) return (
    <div className="page">
      <div className="card bracket">
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{fontSize:36,marginBottom:8}}>⚙</div>
          <h2 style={{marginBottom:4}}>Admin Panel</h2>
          <p style={{color:"var(--muted)",fontSize:13}}>Theme management & AI generation</p>
        </div>
        <div className="field">
          <label>Passcode</label>
          <input type="password" value={passcode} onChange={e=>setPasscode(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&handleAuth()} placeholder="••••••••" autoFocus />
        </div>
        {authErr && <div className="msg msg--error">{authErr}</div>}
        <button className="btn btn--primary" onClick={handleAuth}>Unlock</button>
        <button className="btn btn--ghost" onClick={onLeave}>← Back to Game</button>
      </div>
    </div>
  );

  // ── Dashboard ──────────────────────────────────────────────
  return (
    <div className="page" style={{justifyContent:"flex-start",paddingTop:50,alignItems:"stretch",maxWidth:860,margin:"0 auto"}}>
      <div className="admin-bar">
        ⚠ ADMIN MODE — {passcode}
        <span style={{marginLeft:"auto",cursor:"pointer"}} onClick={onLeave}>← Exit</span>
      </div>

      <div style={{padding:"0 16px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"16px 0"}}>
          <h2 style={{marginBottom:0}}>Theme Manager</h2>
          <button className="btn btn--green btn--sm" onClick={()=>{
            setEditing({id:null});
            setForm({name:"",category:"anime",seedWords:"",referenceText:"",words:[]});
            setGenResult(null);
          }}>+ New Theme</button>
        </div>

        {error   && <div className="msg msg--error">{error}</div>}
        {success && <div className="msg msg--success">{success}</div>}
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
                <button className="btn btn--danger btn--sm" onClick={()=>handleDelete(t.id)}>✕</button>
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
                <label>Reference Text (paste wiki / fandom text)</label>
                <textarea value={form.referenceText} onChange={e=>setForm(f=>({...f,referenceText:e.target.value}))}
                  placeholder="Paste character lists, wiki excerpts, etc." rows={4} />
              </div>


              <button className="btn btn--yellow" disabled={generating||!form.name} onClick={handleGenerate}>
                {generating ? <><span className="spin"/>Generating…</> : "✨ Generate with AI"}
              </button>

              {genResult && (
                <div className="msg msg--success" style={{marginTop:8}}>
                  ✓ {genResult.words?.length} words in pool
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
                  {loading ? <><span className="spin"/>Saving…</> : "💾 Save Theme"}
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
        {show?"▼":"▶"} Preview AI prompts
      </button>
      {show && (
        <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:10}}>
          {[["qwen-90k (qwen3.5:4b — 90k context)", fast, "fast"]].map(([label, prompt, key])=>(
            <div key={key} style={{border:"1px solid var(--border)",borderRadius:6,overflow:"hidden"}}>
              <div style={{padding:"6px 10px",background:"var(--bg)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--green)",letterSpacing:1}}>{label}</span>
                <button className="btn btn--ghost btn--sm" onClick={()=>copy(prompt,key)}>
                  {copied===key?"✓ Copied":"Copy"}
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
