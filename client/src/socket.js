// src/socket.js — singleton socket connection
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "";
// Empty string = same origin (works with vite proxy in dev, and when
// you serve frontend from same host in prod)

export const socket = io(SERVER_URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1500,
});
