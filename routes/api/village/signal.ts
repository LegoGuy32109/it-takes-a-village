import {
  ControllerRole,
  SignalClientMessage,
  SignalPeerInfo,
  SignalServerMessage,
  VillageClientRole,
} from "../../../features/village/shared/types.ts";
import { define } from "../../../utils.ts";

interface SignalConnection {
  clientId: string;
  kind: "display" | "controller";
  role: VillageClientRole;
  sessionId: string;
  socket: WebSocket;
}

interface VillageSignalRoom {
  sessionId: string;
  displayClientId: string | null;
  joinCode: string;
  createdAt: number;
  lastSeenAt: number;
  connections: Map<string, SignalConnection>;
  disconnectTimers: Map<string, number>;
}

const ROOM_TTL_MS = 4 * 60 * 60 * 1000;
const RECONNECT_GRACE_MS = 3500;
const roomsBySessionId = new Map<string, VillageSignalRoom>();
const sessionIdByCode = new Map<string, string>();

function redact(value: string): string {
  if (value.length <= 2) return "*".repeat(value.length);
  return `${"*".repeat(Math.max(0, value.length - 2))}${value.slice(-2)}`;
}

function getRequestIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
}

function signalPayloadKind(
  payload: RTCIceCandidateInit | RTCSessionDescriptionInit,
): string {
  const description = payload as RTCSessionDescriptionInit;
  if (typeof description.type === "string") return `sdp:${description.type}`;

  const candidate = payload as RTCIceCandidateInit;
  if (typeof candidate.candidate !== "string") return "ice:unknown";
  const candidateType = candidate.candidate.match(/ typ ([a-z]+)/)?.[1] ??
    "unknown";
  const protocol = candidate.candidate.match(/ udp | tcp /)?.[0]?.trim() ??
    "unknown";
  return `ice:${candidateType}:${protocol}`;
}

function logSignal(event: string, fields: Record<string, unknown> = {}) {
  console.info("[village:signal]", {
    at: new Date().toISOString(),
    event,
    ...fields,
  });
}

function getPeerInfo(connection: SignalConnection): SignalPeerInfo {
  return {
    clientId: connection.clientId,
    kind: connection.kind,
    role: connection.kind === "controller"
      ? connection.role as ControllerRole
      : undefined,
  };
}

function sendMessage(socket: WebSocket, message: SignalServerMessage) {
  if (socket.readyState !== WebSocket.OPEN) {
    logSignal("send_skipped_socket_not_open", {
      messageType: message.type,
      readyState: socket.readyState,
    });
    return;
  }
  socket.send(JSON.stringify(message));
}

function broadcast(
  room: VillageSignalRoom,
  message: SignalServerMessage,
  excludedClientId?: string,
) {
  for (const connection of room.connections.values()) {
    if (connection.clientId === excludedClientId) continue;
    sendMessage(connection.socket, message);
  }
}

function deleteRoom(room: VillageSignalRoom) {
  logSignal("room_deleted", {
    sessionId: room.sessionId,
    connections: room.connections.size,
  });
  for (const timer of room.disconnectTimers.values()) clearTimeout(timer);
  room.disconnectTimers.clear();
  roomsBySessionId.delete(room.sessionId);
  sessionIdByCode.delete(room.joinCode);
}

function cleanupExpiredRooms() {
  const now = Date.now();
  for (const room of roomsBySessionId.values()) {
    if (now - room.lastSeenAt <= ROOM_TTL_MS) continue;
    logSignal("room_expired", {
      sessionId: room.sessionId,
      ageMs: now - room.createdAt,
      idleMs: now - room.lastSeenAt,
      connections: room.connections.size,
    });
    for (const connection of room.connections.values()) {
      connection.socket.close(4001, "Room expired");
    }
    deleteRoom(room);
  }
}

function cleanupRoomIfEmpty(sessionId: string) {
  const room = roomsBySessionId.get(sessionId);
  if (!room || room.connections.size > 0) return;
  deleteRoom(room);
}

function registerRoom(
  sessionId: string,
  joinCode: string,
): VillageSignalRoom {
  cleanupExpiredRooms();
  const room = roomsBySessionId.get(sessionId) ?? {
    sessionId,
    displayClientId: null,
    joinCode,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    connections: new Map<string, SignalConnection>(),
    disconnectTimers: new Map<string, number>(),
  };

  if (room.joinCode !== joinCode) {
    sessionIdByCode.delete(room.joinCode);
    room.joinCode = joinCode;
  }

  room.lastSeenAt = Date.now();
  sessionIdByCode.set(joinCode, sessionId);
  roomsBySessionId.set(sessionId, room);
  logSignal("room_registered", {
    sessionId,
    joinCode: redact(joinCode),
    connections: room.connections.size,
  });
  return room;
}

function clearDisconnectTimer(room: VillageSignalRoom, clientId: string) {
  const timer = room.disconnectTimers.get(clientId);
  if (timer === undefined) return;
  clearTimeout(timer);
  room.disconnectTimers.delete(clientId);
}

function removeConnection(
  sessionId: string,
  clientId: string,
  socket: WebSocket,
  reason: string,
) {
  const room = roomsBySessionId.get(sessionId);
  if (!room) return;

  const connection = room.connections.get(clientId);
  if (!connection) return;
  if (connection.socket !== socket) {
    logSignal("connection_remove_skipped_stale_socket", {
      sessionId,
      clientId,
      kind: connection.kind,
      role: connection.role,
      reason,
    });
    return;
  }

  room.connections.delete(clientId);
  if (room.displayClientId === clientId) room.displayClientId = null;
  clearDisconnectTimer(room, clientId);

  logSignal("connection_removed", {
    sessionId,
    clientId,
    kind: connection.kind,
    role: connection.role,
    reason,
    remainingConnections: room.connections.size,
  });
  broadcast(room, { type: "peer_left", clientId }, clientId);
  cleanupRoomIfEmpty(sessionId);
}

function scheduleRemoveConnection(
  sessionId: string,
  clientId: string,
  socket: WebSocket,
  reason: string,
) {
  const room = roomsBySessionId.get(sessionId);
  if (!room) return;

  clearDisconnectTimer(room, clientId);
  const timer = setTimeout(() => {
    const activeRoom = roomsBySessionId.get(sessionId);
    if (!activeRoom) return;
    activeRoom.disconnectTimers.delete(clientId);
    removeConnection(sessionId, clientId, socket, reason);
  }, RECONNECT_GRACE_MS);
  room.disconnectTimers.set(clientId, timer);
  logSignal("connection_remove_scheduled", {
    sessionId,
    clientId,
    reason,
    graceMs: RECONNECT_GRACE_MS,
  });
}

function resolveControllerRoom(code: string) {
  cleanupExpiredRooms();
  const sessionId = sessionIdByCode.get(code);
  if (!sessionId) {
    logSignal("controller_room_not_found", { code: redact(code) });
    return null;
  }
  const room = roomsBySessionId.get(sessionId);
  if (!room) {
    logSignal("controller_room_missing_for_code", {
      code: redact(code),
      sessionId,
    });
    return null;
  }

  room.lastSeenAt = Date.now();
  const role: ControllerRole = "player";
  logSignal("controller_room_resolved", {
    code: redact(code),
    sessionId,
    role,
    connections: room.connections.size,
  });
  return { room, role };
}

function makeErrorResponse(message: string, status: number) {
  return new Response(message, { status });
}

function parseClientMessage(data: unknown): SignalClientMessage | null {
  if (typeof data !== "string") {
    logSignal("message_rejected_non_string", { dataType: typeof data });
    return null;
  }
  try {
    const parsed = JSON.parse(data) as SignalClientMessage;
    if (parsed.type !== "signal" && parsed.type !== "register_room") {
      logSignal("message_rejected_unknown_type", {
        type: (parsed as { type?: unknown }).type,
      });
      return null;
    }
    return parsed;
  } catch {
    logSignal("message_rejected_bad_json");
    return null;
  }
}

export const handler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    const clientId = url.searchParams.get("clientId")?.trim() ?? "";
    const kind = url.searchParams.get("kind")?.trim() ?? "";

    logSignal("request", {
      kind,
      clientId,
      ip: getRequestIp(ctx.req),
      ua: ctx.req.headers.get("user-agent") ?? "unknown",
    });

    if (!clientId || (kind !== "display" && kind !== "controller")) {
      logSignal("request_rejected_invalid_params", { kind, clientId });
      return makeErrorResponse("Expected clientId and valid kind.", 400);
    }

    if (kind === "display") {
      const sessionId = url.searchParams.get("session")?.trim() ?? "";
      const joinCode = url.searchParams.get("code")?.trim() ?? "";
      if (!sessionId || !joinCode) {
        logSignal("display_rejected_missing_params", {
          sessionId,
          hasJoinCode: Boolean(joinCode),
        });
        return makeErrorResponse(
          "Expected session and code.",
          400,
        );
      }

      const room = registerRoom(sessionId, joinCode);
      const { socket, response } = Deno.upgradeWebSocket(ctx.req);
      const existing = room.connections.get(clientId);
      if (existing) {
        logSignal("display_replacing_existing_connection", {
          sessionId,
          clientId,
        });
        existing.socket.close(4000, "Replaced by a new connection");
      }

      socket.addEventListener("open", () => {
        clearDisconnectTimer(room, clientId);
        room.displayClientId = clientId;
        room.connections.set(clientId, {
          clientId,
          kind: "display",
          role: "display",
          sessionId,
          socket,
        });

        logSignal("display_socket_open", {
          sessionId,
          clientId,
          peers: room.connections.size - 1,
        });
        sendMessage(socket, {
          type: "signal_ready",
          sessionId,
          role: "display",
          peers: [...room.connections.values()]
            .filter((connection) => connection.clientId !== clientId)
            .map(getPeerInfo),
        });

        broadcast(
          room,
          {
            type: "peer_joined",
            peer: getPeerInfo(room.connections.get(clientId)!),
          },
          clientId,
        );
      });

      socket.addEventListener("message", (event) => {
        const payload = parseClientMessage(event.data);
        if (!payload) return;

        room.lastSeenAt = Date.now();
        if (payload.type === "register_room") {
          logSignal("display_register_room_message", {
            clientId,
            sessionId: payload.sessionId,
            joinCode: redact(payload.joinCode),
          });
          registerRoom(payload.sessionId, payload.joinCode);
          return;
        }

        const target = room.connections.get(payload.targetClientId);
        if (!target) {
          logSignal("display_signal_target_missing", {
            sessionId,
            fromClientId: clientId,
            targetClientId: payload.targetClientId,
            payloadKind: signalPayloadKind(payload.payload),
          });
          return;
        }
        logSignal("display_signal_relay", {
          sessionId,
          fromClientId: clientId,
          targetClientId: payload.targetClientId,
          payloadKind: signalPayloadKind(payload.payload),
        });
        sendMessage(target.socket, {
          type: "signal",
          fromClientId: clientId,
          payload: payload.payload,
        });
      });

      socket.addEventListener("close", (event) => {
        logSignal("display_socket_close", {
          sessionId,
          clientId,
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });
        scheduleRemoveConnection(sessionId, clientId, socket, "close");
      });
      socket.addEventListener("error", () => {
        logSignal("display_socket_error", { sessionId, clientId });
        scheduleRemoveConnection(sessionId, clientId, socket, "error");
      });
      return response;
    }

    const code = url.searchParams.get("code")?.trim() ?? "";
    if (!code) {
      logSignal("controller_rejected_missing_code", { clientId });
      return makeErrorResponse("Expected a join code.", 400);
    }

    const resolved = resolveControllerRoom(code);
    if (!resolved) {
      return makeErrorResponse(
        "No active village room found for that code.",
        404,
      );
    }

    const { room, role } = resolved;
    const { socket, response } = Deno.upgradeWebSocket(ctx.req);
    const existing = room.connections.get(clientId);
    if (existing) {
      logSignal("controller_replacing_existing_connection", {
        sessionId: room.sessionId,
        clientId,
        role,
      });
      existing.socket.close(4000, "Replaced by a new connection");
    }
    socket.addEventListener("open", () => {
      clearDisconnectTimer(room, clientId);
      room.connections.set(clientId, {
        clientId,
        kind: "controller",
        role,
        sessionId: room.sessionId,
        socket,
      });

      logSignal("controller_socket_open", {
        sessionId: room.sessionId,
        clientId,
        role,
        peers: room.connections.size - 1,
      });
      const connection = room.connections.get(clientId)!;
      sendMessage(socket, {
        type: "signal_ready",
        sessionId: room.sessionId,
        role,
        peers: [...room.connections.values()]
          .filter((entry) => entry.clientId !== clientId)
          .map(getPeerInfo),
      });

      broadcast(
        room,
        { type: "peer_joined", peer: getPeerInfo(connection) },
        clientId,
      );
    });

    socket.addEventListener("message", (event) => {
      const payload = parseClientMessage(event.data);
      if (!payload || payload.type !== "signal") return;

      room.lastSeenAt = Date.now();
      const target = room.connections.get(payload.targetClientId);
      if (!target) {
        logSignal("controller_signal_target_missing", {
          sessionId: room.sessionId,
          fromClientId: clientId,
          targetClientId: payload.targetClientId,
          role,
          payloadKind: signalPayloadKind(payload.payload),
        });
        return;
      }
      logSignal("controller_signal_relay", {
        sessionId: room.sessionId,
        fromClientId: clientId,
        targetClientId: payload.targetClientId,
        role,
        payloadKind: signalPayloadKind(payload.payload),
      });
      sendMessage(target.socket, {
        type: "signal",
        fromClientId: clientId,
        payload: payload.payload,
      });
    });

    socket.addEventListener("close", (event) => {
      logSignal("controller_socket_close", {
        sessionId: room.sessionId,
        clientId,
        role,
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
      scheduleRemoveConnection(room.sessionId, clientId, socket, "close");
    });
    socket.addEventListener("error", () => {
      logSignal("controller_socket_error", {
        sessionId: room.sessionId,
        clientId,
        role,
      });
      scheduleRemoveConnection(room.sessionId, clientId, socket, "error");
    });
    return response;
  },
});
