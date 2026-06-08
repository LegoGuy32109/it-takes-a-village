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
  hostCode: string;
  playerCode: string;
  createdAt: number;
  lastSeenAt: number;
  connections: Map<string, SignalConnection>;
}

const ROOM_TTL_MS = 4 * 60 * 60 * 1000;
const roomsBySessionId = new Map<string, VillageSignalRoom>();
const sessionIdByCode = new Map<string, string>();

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
  if (socket.readyState !== WebSocket.OPEN) return;
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
  roomsBySessionId.delete(room.sessionId);
  sessionIdByCode.delete(room.hostCode);
  sessionIdByCode.delete(room.playerCode);
}

function cleanupExpiredRooms() {
  const now = Date.now();
  for (const room of roomsBySessionId.values()) {
    if (now - room.lastSeenAt <= ROOM_TTL_MS) continue;
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
  hostCode: string,
  playerCode: string,
): VillageSignalRoom {
  cleanupExpiredRooms();
  const room = roomsBySessionId.get(sessionId) ?? {
    sessionId,
    displayClientId: null,
    hostCode,
    playerCode,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    connections: new Map<string, SignalConnection>(),
  };

  if (room.hostCode !== hostCode) {
    sessionIdByCode.delete(room.hostCode);
    room.hostCode = hostCode;
  }

  if (room.playerCode !== playerCode) {
    sessionIdByCode.delete(room.playerCode);
    room.playerCode = playerCode;
  }

  room.lastSeenAt = Date.now();
  sessionIdByCode.set(hostCode, sessionId);
  sessionIdByCode.set(playerCode, sessionId);
  roomsBySessionId.set(sessionId, room);
  return room;
}

function removeConnection(sessionId: string, clientId: string) {
  const room = roomsBySessionId.get(sessionId);
  if (!room) return;

  const connection = room.connections.get(clientId);
  if (!connection) return;

  room.connections.delete(clientId);
  if (room.displayClientId === clientId) room.displayClientId = null;

  broadcast(room, { type: "peer_left", clientId }, clientId);
  cleanupRoomIfEmpty(sessionId);
}

function closeExistingHost(room: VillageSignalRoom, nextClientId: string) {
  for (const connection of room.connections.values()) {
    if (
      connection.kind === "controller" && connection.role === "host" &&
      connection.clientId !== nextClientId
    ) {
      connection.socket.close(4000, "Replaced by a new host");
      room.connections.delete(connection.clientId);
    }
  }
}

function resolveControllerRoom(code: string) {
  cleanupExpiredRooms();
  const sessionId = sessionIdByCode.get(code);
  if (!sessionId) return null;
  const room = roomsBySessionId.get(sessionId);
  if (!room) return null;

  room.lastSeenAt = Date.now();
  const role: ControllerRole = room.hostCode === code ? "host" : "player";
  return { room, role };
}

function makeErrorResponse(message: string, status: number) {
  return new Response(message, { status });
}

function parseClientMessage(data: unknown): SignalClientMessage | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as SignalClientMessage;
    if (parsed.type !== "signal" && parsed.type !== "register_room") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export const handler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    const clientId = url.searchParams.get("clientId")?.trim() ?? "";
    const kind = url.searchParams.get("kind")?.trim() ?? "";

    if (!clientId || (kind !== "display" && kind !== "controller")) {
      return makeErrorResponse("Expected clientId and valid kind.", 400);
    }

    if (kind === "display") {
      const sessionId = url.searchParams.get("session")?.trim() ?? "";
      const hostCode = url.searchParams.get("hostCode")?.trim() ?? "";
      const playerCode = url.searchParams.get("playerCode")?.trim() ?? "";
      if (!sessionId || !hostCode || !playerCode) {
        return makeErrorResponse(
          "Expected session, hostCode, and playerCode.",
          400,
        );
      }

      const room = registerRoom(sessionId, hostCode, playerCode);
      const { socket, response } = Deno.upgradeWebSocket(ctx.req);
      const existing = room.connections.get(clientId);
      if (existing) existing.socket.close(4000, "Replaced by a new connection");

      socket.addEventListener("open", () => {
        room.displayClientId = clientId;
        room.connections.set(clientId, {
          clientId,
          kind: "display",
          role: "display",
          sessionId,
          socket,
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
          registerRoom(payload.sessionId, payload.hostCode, payload.playerCode);
          return;
        }

        const target = room.connections.get(payload.targetClientId);
        if (!target) return;
        sendMessage(target.socket, {
          type: "signal",
          fromClientId: clientId,
          payload: payload.payload,
        });
      });

      const handleClose = () => removeConnection(sessionId, clientId);
      socket.addEventListener("close", handleClose);
      socket.addEventListener("error", handleClose);
      return response;
    }

    const code = url.searchParams.get("code")?.trim() ?? "";
    if (!code) return makeErrorResponse("Expected a join code.", 400);

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
    if (existing) existing.socket.close(4000, "Replaced by a new connection");
    if (role === "host") closeExistingHost(room, clientId);

    socket.addEventListener("open", () => {
      room.connections.set(clientId, {
        clientId,
        kind: "controller",
        role,
        sessionId: room.sessionId,
        socket,
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
      if (!target) return;
      sendMessage(target.socket, {
        type: "signal",
        fromClientId: clientId,
        payload: payload.payload,
      });
    });

    const handleClose = () => removeConnection(room.sessionId, clientId);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleClose);
    return response;
  },
});
