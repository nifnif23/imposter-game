// src/useGame.js — socket-based game state hook
import { useState, useEffect, useCallback } from "react";
import { socket } from "./socket.js";

export function useGame() {
  const [connected,    setConnected]    = useState(socket.connected);
  const [room,         setRoom]         = useState(null);
  const [roomCode,     setRoomCode]     = useState(null);
  const [playerId,     setPlayerId]     = useState(null);
  const [assignment,   setAssignment]   = useState(null);   // private — only this player's word
  const [revealed,     setRevealed]     = useState(null);   // from host after round ends
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);

  // Restore session from localStorage — attempt rejoin once socket is connected
  useEffect(() => {
    function tryRejoin() {
      const saved = localStorage.getItem("imposter_session");
      if (!saved) return;
      try {
        const { roomCode, playerId, playerName } = JSON.parse(saved);
        if (!roomCode || !playerId) return;
        socket.emit("rejoin_room", { roomCode, playerId, playerName }, (res) => {
          if (!res?.error) {
            setRoomCode(roomCode);
            setPlayerId(playerId);
          } else {
            // Room expired — clear session
            localStorage.removeItem("imposter_session");
          }
        });
      } catch {
        localStorage.removeItem("imposter_session");
      }
    }

    // If already connected, rejoin immediately
    if (socket.connected) {
      tryRejoin();
    }
    // Also rejoin on every (re)connect — handles reload + reconnect cases
    socket.on("connect", tryRejoin);
    return () => socket.off("connect", tryRejoin);
  }, []);

  useEffect(() => {
    const onConnect    = () => { setConnected(true); };
    const onDisconnect = () => setConnected(false);
    const onRoomUpdate = (data) => setRoom(data);
    const onAssignment = (data) => setAssignment(data);
    const onRevealed   = (data) => setRevealed(data);
    const onReset      = ()     => { setAssignment(null); setRevealed(null); };

    socket.on("connect",        onConnect);
    socket.on("disconnect",     onDisconnect);
    socket.on("room_update",    onRoomUpdate);
    socket.on("your_assignment",onAssignment);
    socket.on("words_revealed", onRevealed);
    socket.on("game_reset",     onReset);

    return () => {
      socket.off("connect",        onConnect);
      socket.off("disconnect",     onDisconnect);
      socket.off("room_update",    onRoomUpdate);
      socket.off("your_assignment",onAssignment);
      socket.off("words_revealed", onRevealed);
      socket.off("game_reset",     onReset);
    };
  }, []);

  // Promisify socket emit with callback
  function emit(event, data) {
    return new Promise((resolve, reject) => {
      socket.emit(event, data, (res) => {
        if (res?.error) reject(new Error(res.error));
        else resolve(res);
      });
    });
  }

  const wrap = useCallback(async (fn) => {
    setLoading(true); setError(null);
    try   { return await fn(); }
    catch (e) { setError(e.message); throw e; }
    finally   { setLoading(false); }
  }, []);

  const createRoom = useCallback((playerName) => wrap(async () => {
    const res = await emit("create_room", { playerName });
    setRoomCode(res.roomCode);
    setPlayerId(res.playerId);
    localStorage.setItem("imposter_session", JSON.stringify({ roomCode: res.roomCode, playerId: res.playerId, playerName }));
    return res;
  }), [wrap]);

  const joinRoom = useCallback((code, playerName) => wrap(async () => {
    const res = await emit("join_room", { roomCode: code.toUpperCase(), playerName });
    setRoomCode(res.roomCode);
    setPlayerId(res.playerId);
    localStorage.setItem("imposter_session", JSON.stringify({ roomCode: res.roomCode, playerId: res.playerId, playerName }));
    return res;
  }), [wrap]);

  const updateSettings = useCallback((settings) =>
    wrap(() => emit("update_settings", { settings })), [wrap]);

  const startGame = useCallback(() =>
    wrap(() => emit("start_game", {})), [wrap]);

  const resetGame = useCallback(() =>
    wrap(async () => {
      setAssignment(null); setRevealed(null);
      return emit("reset_game", {});
    }), [wrap]);

  const revealWords = useCallback(() =>
    wrap(() => emit("reveal_words", {})), [wrap]);

  const leaveRoom = useCallback(() => {
    localStorage.removeItem("imposter_session");
    setRoom(null); setRoomCode(null); setPlayerId(null);
    setAssignment(null); setRevealed(null);
    socket.disconnect();
    setTimeout(() => socket.connect(), 100);
  }, []);

  const isHost = room?.hostId === playerId;
  const players = room ? Object.entries(room.players) : [];

  return {
    connected, room, roomCode, playerId, isHost, players,
    assignment, revealed, loading, error,
    createRoom, joinRoom, updateSettings, startGame,
    resetGame, revealWords, leaveRoom,
  };
}
