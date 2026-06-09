import { qrcode } from "@libs/qrcode";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { VillageController } from "../game/VillageController.tsx";
import { VillagePixiWorld } from "../game/VillagePixiWorld.tsx";
import {
  buildVillageSnapshot,
  createVillageState,
  reduceVillageState,
} from "../shared/state.ts";
import {
  ControllerEnvelope,
  ControllerRole,
  DisplayEnvelope,
  GameStartedEnvelope,
  GameStartedPlayer,
  SignalClientMessage,
  SignalServerMessage,
  SnapshotEnvelope,
  VillageClientRole,
  VillagePlayerInput,
  VillageSnapshot,
  VillageState,
} from "../shared/types.ts";

interface VillageAppProps {
  iceServers: RTCIceServer[];
  initialJoinCode: string;
}

const PARTICIPANT_ID_STORAGE_KEY = "village:participant-id";
const PARTICIPANT_NAME_STORAGE_KEY = "village:participant-name";
const PLAYER_COLORS = [
  0xffdbdb,
  0xcff1fb,
  0xd1d1f9,
  0xd6fbe4,
  0xfcfdcd,
];

function createSessionId(): string {
  return crypto.randomUUID().split("-")[0];
}

function createJoinCode(excluded?: string): string {
  let code = "";
  do {
    code = Array.from(
      { length: 6 },
      () => Math.floor(Math.random() * 10).toString(),
    ).join("");
  } while (code === excluded || !hasRepeatedDigit(code));
  return code;
}

function hasRepeatedDigit(code: string): boolean {
  return new Set(code).size < code.length;
}

function createClientId(): string {
  return crypto.randomUUID();
}

function trimName(input: string): string {
  return input.trim().slice(0, 30);
}

function readStoredValue(key: string): string {
  try {
    return globalThis.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStoredValue(key: string, value: string) {
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    // localStorage can fail in restricted browsing modes.
  }
}

function createFreshDisplayState(): VillageState {
  const playerCode = createJoinCode();
  return createVillageState(
    createSessionId(),
    createJoinCode(playerCode),
    playerCode,
  );
}

function buildJoinLink(code: string): string {
  if (typeof globalThis.location === "undefined") {
    return `/?code=${encodeURIComponent(code)}`;
  }

  const url = new URL(globalThis.location.href);
  url.pathname = "/";
  url.search = "";
  url.searchParams.set("code", code);
  return url.toString();
}

function makeSvgDataUrl(svg: string): string {
  if (!svg) return "";
  return `data:image/svg+xml;charset=utf-8,${
    encodeURIComponent(
      svg.replace("<svg", '<svg preserveAspectRatio="xMidYMid meet"'),
    )
  }`;
}

function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") return blob.text();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read blob text."));
    });
    reader.readAsText(blob);
  });
}

async function parseSignalMessageData(
  data: unknown,
): Promise<SignalServerMessage> {
  if (typeof data === "string") return JSON.parse(data) as SignalServerMessage;
  if (data instanceof Blob) {
    return JSON.parse(await readBlobText(data)) as SignalServerMessage;
  }
  if (data instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(data)));
  }
  if (ArrayBuffer.isView(data)) {
    return JSON.parse(
      new TextDecoder().decode(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      ),
    );
  }
  throw new Error("Unsupported websocket message data.");
}

function isSessionDescriptionPayload(
  payload: RTCIceCandidateInit | RTCSessionDescriptionInit,
): payload is RTCSessionDescriptionInit {
  return typeof (payload as RTCSessionDescriptionInit).type === "string";
}

function displayName(name: string, fallback: string) {
  return trimName(name) || fallback;
}

function displayGameName(name: string): string {
  const trimmed = displayName(name, "Helper");
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 11)}-`;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function seededUnit(seed: number): number {
  let value = seed >>> 0;
  value += 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function clampColorChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function shiftColorBrightness(color: number, amount: number): number {
  const red = (color >> 16) & 255;
  const green = (color >> 8) & 255;
  const blue = color & 255;
  const shift = (channel: number) =>
    amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount);

  return (clampColorChannel(shift(red)) << 16) |
    (clampColorChannel(shift(green)) << 8) |
    clampColorChannel(shift(blue));
}

function colorForParticipant(participantId: string): number {
  const seed = hashString(participantId);
  const baseColor = PLAYER_COLORS[seed % PLAYER_COLORS.length];
  const brightness = (seededUnit(seed ^ 0xa5a5a5a5) - 0.5) * 0.18;
  return shiftColorBrightness(baseColor, brightness);
}

function createRandomPlayerColor(): number {
  const baseColor =
    PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
  const brightness = (Math.random() - 0.5) * 0.22;
  return shiftColorBrightness(baseColor, brightness);
}

function shortId(value: string | null | undefined): string {
  if (!value) return "";
  return value.length <= 8
    ? value
    : `${value.slice(0, 4)}...${value.slice(-4)}`;
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

const PLACEHOLDER_DISPLAY_STATE = createVillageState(
  "pending",
  "HOST00",
  "PLAY00",
);

export default function VillageApp(
  { iceServers, initialJoinCode }: VillageAppProps,
) {
  const [booted, setBooted] = useState(false);
  const [joinCode] = useState(initialJoinCode);
  const [mode, setMode] = useState<VillageClientRole>(
    initialJoinCode ? "player" : "display",
  );
  const [displayState, setDisplayState] = useState<VillageState>(
    PLACEHOLDER_DISPLAY_STATE,
  );
  const [participantId] = useState(() => {
    if (typeof globalThis.localStorage === "undefined") return "pending";
    const stored = readStoredValue(PARTICIPANT_ID_STORAGE_KEY);
    if (stored) return stored;
    const created = crypto.randomUUID();
    writeStoredValue(PARTICIPANT_ID_STORAGE_KEY, created);
    return created;
  });
  const [participantName, setParticipantName] = useState("");
  const [draftName, setDraftName] = useState("");
  const [signalStatus, setSignalStatus] = useState("Idle");
  const [transportError, setTransportError] = useState("");
  const [controllerSnapshot, setControllerSnapshot] = useState<
    VillageSnapshot | null
  >(null);
  const [resolvedRole, setResolvedRole] = useState<ControllerRole | null>(null);
  const [connectAttempt, setConnectAttempt] = useState(0);
  const [gamePhase, setGamePhase] = useState<"lobby" | "playing">("lobby");
  const [gamePlayers, setGamePlayers] = useState<GameStartedPlayer[]>([]);

  const clientIdRef = useRef(createClientId());
  const participantNameRef = useRef("");
  const resolvedRoleRef = useRef<ControllerRole | null>(null);
  const gamePhaseRef = useRef<"lobby" | "playing">("lobby");
  const gamePlayersRef = useRef<GameStartedPlayer[]>([]);
  const gameInputsRef = useRef(new Map<string, VillagePlayerInput>());
  const actionPressedRef = useRef(new Map<string, boolean>());
  const signalSocketRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const peerChannelsRef = useRef(new Map<string, RTCDataChannel>());
  const peerParticipantIdsRef = useRef(new Map<string, string>());
  const participantPeerIdsRef = useRef(new Map<string, string>());
  const peerRolesRef = useRef(new Map<string, ControllerRole>());
  const pendingCandidatesRef = useRef(
    new Map<string, RTCIceCandidateInit[]>(),
  );
  const gameStateRef = useRef(displayState);
  const reconnectTimerRef = useRef<number | null>(null);
  const isDisplayMode = mode === "display";

  function debugLog(event: string, fields: Record<string, unknown> = {}) {
    const payload = {
      event,
      mode,
      resolvedRole,
      isDisplayMode,
      clientId: shortId(clientIdRef.current),
      participantId: shortId(participantId),
      sessionId: isDisplayMode ? displayState.sessionId : undefined,
      joinCode: joinCode ? `****${joinCode.slice(-2)}` : undefined,
      signalStatus,
      ...fields,
    };

    console.info("[village:client]", payload);

    try {
      fetch("/api/village/client-log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Diagnostic logging should never affect gameplay.
    }
  }

  useEffect(() => {
    const storedName = readStoredValue(PARTICIPANT_NAME_STORAGE_KEY);
    setParticipantName(storedName);
    setDraftName(storedName);

    if (joinCode) {
      setMode("player");
      setDisplayState(PLACEHOLDER_DISPLAY_STATE);
    } else {
      const freshState = createFreshDisplayState();
      gameStateRef.current = freshState;
      setDisplayState(freshState);
      setMode("display");
    }

    setBooted(true);
    debugLog("boot", {
      hasJoinCode: Boolean(joinCode),
      storedName: Boolean(storedName),
      iceServerCount: iceServers.length,
    });
  }, [joinCode]);

  useEffect(() => {
    resolvedRoleRef.current = resolvedRole;
  }, [resolvedRole]);

  useEffect(() => {
    participantNameRef.current = participantName;
  }, [participantName]);

  useEffect(() => {
    gamePhaseRef.current = gamePhase;
  }, [gamePhase]);

  useEffect(() => {
    gamePlayersRef.current = gamePlayers;
  }, [gamePlayers]);

  useEffect(() => {
    if (!booted || !isDisplayMode || gamePhase !== "lobby") return;
    import("pixi.js")
      .then(() => debugLog("pixi_preload_complete"))
      .catch(() => debugLog("pixi_preload_failed"));
  }, [booted, gamePhase, isDisplayMode]);

  useEffect(() => {
    if (!booted) return;
    writeStoredValue(PARTICIPANT_NAME_STORAGE_KEY, participantName);
  }, [booted, participantName]);

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current !== null) {
        globalThis.clearTimeout(reconnectTimerRef.current);
      }
      signalSocketRef.current?.close();
      for (const channel of peerChannelsRef.current.values()) channel.close();
      for (const connection of peerConnectionsRef.current.values()) {
        connection.close();
      }
    };
  }, []);

  const displaySnapshot = useMemo(
    () => buildVillageSnapshot(displayState, null),
    [displayState],
  );
  const hostLink = useMemo(
    () => buildJoinLink(displayState.hostCode),
    [displayState.hostCode],
  );
  const playerLink = useMemo(
    () => buildJoinLink(displayState.playerCode),
    [displayState.playerCode],
  );
  const hostQr = useMemo(
    () => makeSvgDataUrl(qrcode(hostLink, { output: "svg" })),
    [hostLink],
  );
  const playerQr = useMemo(
    () => makeSvgDataUrl(qrcode(playerLink, { output: "svg" })),
    [playerLink],
  );
  const host = displaySnapshot.hostParticipantId
    ? displaySnapshot.participants.find((participant) =>
      participant.id === displaySnapshot.hostParticipantId
    ) ?? null
    : null;
  const players = displaySnapshot.participants.filter((participant) =>
    participant.role === "player"
  );

  function sendSignalMessage(message: SignalClientMessage) {
    const socket = signalSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      debugLog("signal_send_skipped_socket_not_open", {
        messageType: message.type,
        readyState: socket?.readyState ?? "missing",
      });
      return;
    }
    debugLog("signal_send", {
      messageType: message.type,
      targetClientId: message.type === "signal"
        ? shortId(message.targetClientId)
        : undefined,
      payloadKind: message.type === "signal"
        ? signalPayloadKind(message.payload)
        : undefined,
    });
    socket.send(JSON.stringify(message));
  }

  function sendControllerEnvelope(envelope: ControllerEnvelope) {
    let sentCount = 0;
    for (const channel of peerChannelsRef.current.values()) {
      if (channel.readyState === "open") {
        channel.send(JSON.stringify(envelope));
        sentCount += 1;
      }
    }
    if (envelope.event.type !== "input") {
      debugLog("controller_envelope_send", {
        eventType: envelope.event.type,
        sentCount,
        channelCount: peerChannelsRef.current.size,
      });
    }
  }

  function sendDisplayEnvelope(peerId: string, envelope: DisplayEnvelope) {
    const channel = peerChannelsRef.current.get(peerId);
    if (!channel || channel.readyState !== "open") return;
    channel.send(JSON.stringify(envelope));
  }

  function broadcastGameStarted(playersForGame: GameStartedPlayer[]) {
    for (const [peerId, channel] of peerChannelsRef.current.entries()) {
      if (channel.readyState !== "open") continue;
      const viewerParticipantId = peerParticipantIdsRef.current.get(peerId) ??
        null;
      const payload: GameStartedEnvelope = {
        kind: "game_started",
        players: playersForGame,
        viewerParticipantId,
      };
      channel.send(JSON.stringify(payload));
    }
  }

  function sendSnapshotToControllers(state: VillageState) {
    for (const [peerId, channel] of peerChannelsRef.current.entries()) {
      if (channel.readyState !== "open") continue;
      const viewerParticipantId = peerParticipantIdsRef.current.get(peerId) ??
        null;
      const payload: SnapshotEnvelope = {
        kind: "snapshot",
        snapshot: buildVillageSnapshot(state, viewerParticipantId),
      };
      channel.send(JSON.stringify(payload));
    }
  }

  function startGameFromDisplay() {
    const currentState = gameStateRef.current;
    const existingPlayers = new Map(
      gamePlayersRef.current.map((player) => [player.id, player]),
    );
    const eligibleParticipants = currentState.participants.filter((
      participant,
    ) => participant.connected && trimName(participant.name));
    const playersForGame = eligibleParticipants.map((participant) =>
      existingPlayers.get(participant.id) ?? {
        id: participant.id,
        name: displayGameName(participant.name),
        color: colorForParticipant(participant.id),
      }
    );

    debugLog("game_start", {
      playerCount: playersForGame.length,
      participantIds: playersForGame.map((player) => shortId(player.id)),
    });
    gamePlayersRef.current = playersForGame;
    setGamePlayers(playersForGame);
    setGamePhase("playing");
    broadcastGameStarted(playersForGame);
  }

  function rerollPlayerColor(participantId: string) {
    const nextPlayers = gamePlayersRef.current.map((player) =>
      player.id === participantId
        ? { ...player, color: createRandomPlayerColor() }
        : player
    );
    gamePlayersRef.current = nextPlayers;
    setGamePlayers(nextPlayers);
    debugLog("player_color_reroll", {
      participantId: shortId(participantId),
    });
  }

  function applyPlayerInput(
    participantId: string,
    input: VillagePlayerInput,
  ) {
    const wasActionPressed = actionPressedRef.current.get(participantId) ??
      false;
    gameInputsRef.current.set(participantId, input);
    actionPressedRef.current.set(participantId, input.action_pressed);
    if (input.action_pressed && !wasActionPressed) {
      rerollPlayerColor(participantId);
    }
  }

  function commitDisplayEvent(event: Parameters<typeof reduceVillageState>[1]) {
    debugLog("display_commit_event", {
      eventType: event.type,
      participantId: "participantId" in event
        ? shortId(event.participantId)
        : undefined,
    });
    const nextState = reduceVillageState(gameStateRef.current, event);
    gameStateRef.current = nextState;
    setDisplayState(nextState);
    sendSnapshotToControllers(nextState);
  }

  function cleanupPeer(clientId: string) {
    debugLog("cleanup_peer", {
      peerId: shortId(clientId),
      hasConnection: peerConnectionsRef.current.has(clientId),
      hasChannel: peerChannelsRef.current.has(clientId),
    });
    const channel = peerChannelsRef.current.get(clientId);
    if (channel) {
      channel.close();
      peerChannelsRef.current.delete(clientId);
    }

    const connection = peerConnectionsRef.current.get(clientId);
    if (connection) {
      connection.close();
      peerConnectionsRef.current.delete(clientId);
    }

    pendingCandidatesRef.current.delete(clientId);
    peerRolesRef.current.delete(clientId);

    const participantIdForPeer = peerParticipantIdsRef.current.get(clientId);
    if (participantIdForPeer) {
      peerParticipantIdsRef.current.delete(clientId);
      if (
        participantPeerIdsRef.current.get(participantIdForPeer) === clientId
      ) {
        participantPeerIdsRef.current.delete(participantIdForPeer);
      }
      if (isDisplayMode) {
        commitDisplayEvent({
          type: "peer_disconnected",
          participantId: participantIdForPeer,
        });
      }
    }
  }

  function attachChannelHandlers(peerId: string, channel: RTCDataChannel) {
    debugLog("datachannel_attach", {
      peerId: shortId(peerId),
      label: channel.label,
      readyState: channel.readyState,
    });
    peerChannelsRef.current.set(peerId, channel);

    channel.addEventListener("open", () => {
      debugLog("datachannel_open", {
        peerId: shortId(peerId),
        label: channel.label,
      });
      setSignalStatus(isDisplayMode ? "Display connected" : "Connected");
      if (!isDisplayMode) {
        channel.send(JSON.stringify(
          {
            kind: "controller_event",
            event: {
              type: "hello",
              participantId,
              name: trimName(participantNameRef.current),
              role: resolvedRoleRef.current ?? "player",
            },
          } satisfies ControllerEnvelope,
        ));
      }
    });

    channel.addEventListener("close", () => {
      debugLog("datachannel_close", {
        peerId: shortId(peerId),
        label: channel.label,
      });
      peerChannelsRef.current.delete(peerId);
      if (!isDisplayMode) {
        setSignalStatus("Waiting for display");
        setControllerSnapshot(null);
      }
    });

    channel.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as
          | ControllerEnvelope
          | DisplayEnvelope;
        if (
          payload.kind !== "controller_event" || payload.event.type !== "input"
        ) {
          debugLog("datachannel_message", {
            peerId: shortId(peerId),
            kind: payload.kind,
            eventType: payload.kind === "controller_event"
              ? payload.event.type
              : undefined,
          });
        }

        if (isDisplayMode) {
          if (payload.kind !== "controller_event") return;

          if (payload.event.type === "hello") {
            const previousPeerId = participantPeerIdsRef.current.get(
              payload.event.participantId,
            );
            if (previousPeerId && previousPeerId !== peerId) {
              cleanupPeer(previousPeerId);
            }

            const assignedRole = peerRolesRef.current.get(peerId) ??
              payload.event.role;
            peerParticipantIdsRef.current.set(
              peerId,
              payload.event.participantId,
            );
            participantPeerIdsRef.current.set(
              payload.event.participantId,
              peerId,
            );
            commitDisplayEvent({
              type: "peer_connected",
              participantId: payload.event.participantId,
              name: payload.event.name,
              role: assignedRole,
            });
            if (gamePhaseRef.current === "playing") {
              sendDisplayEnvelope(peerId, {
                kind: "game_started",
                players: gamePlayersRef.current,
                viewerParticipantId: payload.event.participantId,
              });
            }
            return;
          }

          const participantIdFromPeer = peerParticipantIdsRef.current.get(
            peerId,
          );
          if (!participantIdFromPeer) return;
          if (payload.event.type === "start_game") {
            if (
              participantIdFromPeer === gameStateRef.current.hostParticipantId
            ) {
              startGameFromDisplay();
            } else {
              debugLog("game_start_rejected_non_host", {
                participantId: shortId(participantIdFromPeer),
              });
            }
            return;
          }
          if (payload.event.type === "input") {
            applyPlayerInput(participantIdFromPeer, payload.event.input);
            return;
          }
          commitDisplayEvent({
            type: "controller_event",
            participantId: participantIdFromPeer,
            event: payload.event,
          });
          return;
        }

        if (payload.kind === "snapshot") {
          setControllerSnapshot(payload.snapshot);
          return;
        }
        if (payload.kind === "game_started") {
          setGamePlayers(payload.players);
          setGamePhase("playing");
        }
      } catch {
        debugLog("datachannel_message_malformed", { peerId: shortId(peerId) });
        setTransportError("Received malformed realtime data.");
      }
    });
  }

  async function addIceCandidateWhenReady(
    peerId: string,
    connection: RTCPeerConnection,
    candidate: RTCIceCandidateInit,
  ) {
    if (!connection.remoteDescription) {
      const candidates = pendingCandidatesRef.current.get(peerId) ?? [];
      candidates.push(candidate);
      pendingCandidatesRef.current.set(peerId, candidates);
      debugLog("ice_candidate_queued", {
        peerId: shortId(peerId),
        payloadKind: signalPayloadKind(candidate),
        queueLength: candidates.length,
      });
      return;
    }
    debugLog("ice_candidate_add", {
      peerId: shortId(peerId),
      payloadKind: signalPayloadKind(candidate),
    });
    await connection.addIceCandidate(candidate);
  }

  async function flushPendingCandidates(
    peerId: string,
    connection: RTCPeerConnection,
  ) {
    const candidates = pendingCandidatesRef.current.get(peerId) ?? [];
    pendingCandidatesRef.current.delete(peerId);
    debugLog("ice_candidates_flush", {
      peerId: shortId(peerId),
      count: candidates.length,
    });
    for (const candidate of candidates) {
      await connection.addIceCandidate(candidate);
    }
  }

  function createDisplayPeerConnection(targetClientId: string) {
    if (peerConnectionsRef.current.has(targetClientId)) {
      debugLog("display_peer_connection_reuse", {
        peerId: shortId(targetClientId),
      });
      return;
    }

    debugLog("display_peer_connection_create", {
      peerId: shortId(targetClientId),
      iceServerCount: iceServers.length,
    });
    const connection = new RTCPeerConnection({ iceServers });
    const channel = connection.createDataChannel("village-control", {
      ordered: true,
    });

    connection.addEventListener("icecandidate", (event) => {
      if (!event.candidate) {
        debugLog("display_ice_gathering_complete", {
          peerId: shortId(targetClientId),
        });
        return;
      }
      debugLog("display_ice_candidate", {
        peerId: shortId(targetClientId),
        payloadKind: signalPayloadKind(event.candidate.toJSON()),
      });
      sendSignalMessage({
        type: "signal",
        targetClientId,
        payload: event.candidate.toJSON(),
      });
    });

    connection.addEventListener("connectionstatechange", () => {
      debugLog("display_peer_connection_state", {
        peerId: shortId(targetClientId),
        connectionState: connection.connectionState,
        iceConnectionState: connection.iceConnectionState,
        iceGatheringState: connection.iceGatheringState,
        signalingState: connection.signalingState,
      });
      if (
        connection.connectionState === "failed" ||
        connection.connectionState === "disconnected" ||
        connection.connectionState === "closed"
      ) {
        cleanupPeer(targetClientId);
      }
    });

    connection.addEventListener("iceconnectionstatechange", () => {
      debugLog("display_ice_connection_state", {
        peerId: shortId(targetClientId),
        iceConnectionState: connection.iceConnectionState,
      });
    });

    connection.addEventListener("icegatheringstatechange", () => {
      debugLog("display_ice_gathering_state", {
        peerId: shortId(targetClientId),
        iceGatheringState: connection.iceGatheringState,
      });
    });

    peerConnectionsRef.current.set(targetClientId, connection);
    attachChannelHandlers(targetClientId, channel);

    connection.createOffer()
      .then((offer) => {
        debugLog("display_offer_created", {
          peerId: shortId(targetClientId),
        });
        return offer;
      })
      .then((offer) => connection.setLocalDescription(offer))
      .then(() => {
        if (!connection.localDescription) return;
        sendSignalMessage({
          type: "signal",
          targetClientId,
          payload: connection.localDescription.toJSON(),
        });
      })
      .catch(() => {
        debugLog("display_peer_connection_create_failed", {
          peerId: shortId(targetClientId),
        });
        setTransportError("Failed to create a display peer connection.");
        cleanupPeer(targetClientId);
      });
  }

  function createControllerPeerConnection(displayClientId: string) {
    const existing = peerConnectionsRef.current.get(displayClientId);
    if (existing) {
      debugLog("controller_peer_connection_reuse", {
        peerId: shortId(displayClientId),
      });
      return existing;
    }

    debugLog("controller_peer_connection_create", {
      peerId: shortId(displayClientId),
      iceServerCount: iceServers.length,
    });
    const connection = new RTCPeerConnection({ iceServers });
    peerConnectionsRef.current.set(displayClientId, connection);

    connection.addEventListener("icecandidate", (event) => {
      if (!event.candidate) {
        debugLog("controller_ice_gathering_complete", {
          peerId: shortId(displayClientId),
        });
        return;
      }
      debugLog("controller_ice_candidate", {
        peerId: shortId(displayClientId),
        payloadKind: signalPayloadKind(event.candidate.toJSON()),
      });
      sendSignalMessage({
        type: "signal",
        targetClientId: displayClientId,
        payload: event.candidate.toJSON(),
      });
    });

    connection.addEventListener("connectionstatechange", () => {
      debugLog("controller_peer_connection_state", {
        peerId: shortId(displayClientId),
        connectionState: connection.connectionState,
        iceConnectionState: connection.iceConnectionState,
        iceGatheringState: connection.iceGatheringState,
        signalingState: connection.signalingState,
      });
      if (
        connection.connectionState === "failed" ||
        connection.connectionState === "disconnected" ||
        connection.connectionState === "closed"
      ) {
        cleanupPeer(displayClientId);
      }
    });

    connection.addEventListener("iceconnectionstatechange", () => {
      debugLog("controller_ice_connection_state", {
        peerId: shortId(displayClientId),
        iceConnectionState: connection.iceConnectionState,
      });
    });

    connection.addEventListener("icegatheringstatechange", () => {
      debugLog("controller_ice_gathering_state", {
        peerId: shortId(displayClientId),
        iceGatheringState: connection.iceGatheringState,
      });
    });

    connection.addEventListener("datachannel", (event) => {
      debugLog("controller_datachannel_received", {
        peerId: shortId(displayClientId),
        label: event.channel.label,
      });
      attachChannelHandlers(displayClientId, event.channel);
    });

    return connection;
  }

  function handleSignalMessage(message: SignalServerMessage) {
    switch (message.type) {
      case "signal_ready":
        debugLog("signal_ready", {
          role: message.role,
          sessionId: message.sessionId,
          peers: message.peers.map((peer) => ({
            clientId: shortId(peer.clientId),
            kind: peer.kind,
            role: peer.role,
          })),
        });
        setTransportError("");
        setSignalStatus(
          message.role === "display" ? "Room open" : "Signal ready",
        );
        setMode(message.role);
        if (message.role === "host" || message.role === "player") {
          setResolvedRole(message.role);
        }
        if (message.role === "display") {
          for (const peer of message.peers) {
            if (peer.kind === "controller" && peer.role) {
              peerRolesRef.current.set(peer.clientId, peer.role);
              createDisplayPeerConnection(peer.clientId);
            }
          }
        }
        return;
      case "peer_joined":
        debugLog("peer_joined", {
          peer: {
            clientId: shortId(message.peer.clientId),
            kind: message.peer.kind,
            role: message.peer.role,
          },
        });
        if (
          isDisplayMode && message.peer.kind === "controller" &&
          message.peer.role
        ) {
          peerRolesRef.current.set(message.peer.clientId, message.peer.role);
          createDisplayPeerConnection(message.peer.clientId);
        }
        return;
      case "peer_left":
        debugLog("peer_left", { peerId: shortId(message.clientId) });
        cleanupPeer(message.clientId);
        return;
      case "signal": {
        debugLog("signal_received", {
          fromClientId: shortId(message.fromClientId),
          payloadKind: signalPayloadKind(message.payload),
        });
        if (isDisplayMode) {
          const connection = peerConnectionsRef.current.get(
            message.fromClientId,
          );
          if (!connection) return;
          if (isSessionDescriptionPayload(message.payload)) {
            debugLog("display_apply_remote_description", {
              peerId: shortId(message.fromClientId),
              type: message.payload.type,
            });
            connection.setRemoteDescription(message.payload)
              .then(() =>
                flushPendingCandidates(message.fromClientId, connection)
              )
              .catch(() =>
                setTransportError("Failed to apply controller answer.")
              );
            return;
          }
          addIceCandidateWhenReady(
            message.fromClientId,
            connection,
            message.payload,
          ).catch(() => setTransportError("Failed to add controller ICE."));
          return;
        }

        const connection = createControllerPeerConnection(message.fromClientId);
        if (isSessionDescriptionPayload(message.payload)) {
          if (message.payload.type === "offer") {
            debugLog("controller_apply_offer", {
              peerId: shortId(message.fromClientId),
            });
            connection.setRemoteDescription(message.payload)
              .then(() =>
                flushPendingCandidates(message.fromClientId, connection)
              )
              .then(() => connection.createAnswer())
              .then((answer) => {
                debugLog("controller_answer_created", {
                  peerId: shortId(message.fromClientId),
                });
                return answer;
              })
              .then((answer) => connection.setLocalDescription(answer))
              .then(() => {
                if (!connection.localDescription) return;
                sendSignalMessage({
                  type: "signal",
                  targetClientId: message.fromClientId,
                  payload: connection.localDescription.toJSON(),
                });
              })
              .catch(() =>
                setTransportError("Failed to answer display offer.")
              );
            return;
          }
          debugLog("controller_apply_remote_description", {
            peerId: shortId(message.fromClientId),
            type: message.payload.type,
          });
          connection.setRemoteDescription(message.payload)
            .then(() =>
              flushPendingCandidates(message.fromClientId, connection)
            )
            .catch(() => setTransportError("Failed to apply display session."));
          return;
        }

        addIceCandidateWhenReady(
          message.fromClientId,
          connection,
          message.payload,
        ).catch(() => setTransportError("Failed to add display ICE."));
        return;
      }
      case "error":
        debugLog("signal_error_message", { error: message.error });
        setTransportError(message.error);
        return;
    }
  }

  useEffect(() => {
    if (!booted || (!isDisplayMode && !joinCode)) return;
    let disposed = false;

    setSignalStatus("Connecting...");
    setTransportError("");

    signalSocketRef.current?.close();
    for (const channel of peerChannelsRef.current.values()) channel.close();
    for (const connection of peerConnectionsRef.current.values()) {
      connection.close();
    }
    peerChannelsRef.current.clear();
    peerConnectionsRef.current.clear();
    peerParticipantIdsRef.current.clear();
    participantPeerIdsRef.current.clear();
    peerRolesRef.current.clear();
    pendingCandidatesRef.current.clear();

    const socketProtocol = globalThis.location.protocol === "https:"
      ? "wss:"
      : "ws:";
    const signalUrl = new URL(
      `${socketProtocol}//${globalThis.location.host}/api/village/signal`,
    );
    signalUrl.searchParams.set("clientId", clientIdRef.current);
    if (isDisplayMode) {
      signalUrl.searchParams.set("kind", "display");
      signalUrl.searchParams.set("session", displayState.sessionId);
      signalUrl.searchParams.set("hostCode", displayState.hostCode);
      signalUrl.searchParams.set("playerCode", displayState.playerCode);
    } else {
      signalUrl.searchParams.set("kind", "controller");
      signalUrl.searchParams.set("code", joinCode);
    }

    debugLog("websocket_connect", {
      url: `${signalUrl.protocol}//${signalUrl.host}${signalUrl.pathname}`,
      kind: isDisplayMode ? "display" : "controller",
      sessionId: isDisplayMode ? displayState.sessionId : undefined,
      code: joinCode ? `****${joinCode.slice(-2)}` : undefined,
      iceServerCount: iceServers.length,
    });
    const socket = new WebSocket(signalUrl);
    signalSocketRef.current = socket;

    socket.addEventListener("open", () => {
      debugLog("websocket_open", {
        kind: isDisplayMode ? "display" : "controller",
      });
      setSignalStatus(isDisplayMode ? "Room open" : "Waiting for display");
      if (isDisplayMode) {
        sendSignalMessage({
          type: "register_room",
          sessionId: displayState.sessionId,
          hostCode: displayState.hostCode,
          playerCode: displayState.playerCode,
        });
      }
    });

    socket.addEventListener("message", (event) => {
      debugLog("websocket_message", {
        dataType: typeof event.data,
        byteLength: typeof event.data === "string" ? event.data.length : null,
      });
      parseSignalMessageData(event.data)
        .then((message) => {
          if (!disposed) handleSignalMessage(message);
        })
        .catch(() =>
          setTransportError("Realtime signaling returned invalid data.")
        );
    });

    socket.addEventListener("close", () => {
      debugLog("websocket_close");
      if (disposed) return;
      setSignalStatus("Disconnected");
      if (!isDisplayMode) setControllerSnapshot(null);
      if (reconnectTimerRef.current !== null) {
        globalThis.clearTimeout(reconnectTimerRef.current);
      }
      reconnectTimerRef.current = globalThis.setTimeout(() => {
        setSignalStatus("Reconnecting...");
        setConnectAttempt((current) => current + 1);
      }, Math.min(8000, 1200 + connectAttempt * 600));
    });

    socket.addEventListener("error", () => {
      debugLog("websocket_error");
      setTransportError("Realtime signaling failed.");
    });

    return () => {
      disposed = true;
      socket.close();
    };
  }, [
    booted,
    connectAttempt,
    displayState.hostCode,
    displayState.playerCode,
    displayState.sessionId,
    iceServers,
    isDisplayMode,
    joinCode,
  ]);

  function submitName(event: Event) {
    event.preventDefault();
    const nextName = trimName(draftName);
    debugLog("submit_name", {
      hasName: Boolean(nextName),
      channelCount: peerChannelsRef.current.size,
      openChannelCount: [...peerChannelsRef.current.values()].filter((
        channel,
      ) => channel.readyState === "open").length,
    });
    setDraftName(nextName);
    setParticipantName(nextName);
    if (!isDisplayMode) {
      sendControllerEnvelope({
        kind: "controller_event",
        event: { type: "set_name", name: nextName },
      });
    }
  }

  function handleHostStart() {
    debugLog("host_start_pressed", {
      hasSnapshot: Boolean(controllerSnapshot),
      isHost: Boolean(controllerSnapshot?.isHost),
      hasName: Boolean(trimName(participantName)),
    });
    sendControllerEnvelope({
      kind: "controller_event",
      event: { type: "start_game" },
    });
  }

  function sendGameInput(input: VillagePlayerInput) {
    sendControllerEnvelope({
      kind: "controller_event",
      event: { type: "input", input },
    });
  }

  if (!booted) {
    return <div class="min-h-screen bg-[#fff7fb]" />;
  }

  if (isDisplayMode) {
    if (gamePhase === "playing") {
      const connectedPlayerIds = new Set(
        displayState.participants
          .filter((participant) => participant.connected)
          .map((participant) => participant.id),
      );
      return (
        <VillagePixiWorld
          players={gamePlayers}
          connectedPlayerIds={connectedPlayerIds}
          inputsRef={gameInputsRef}
        />
      );
    }

    return (
      <main class="min-h-screen bg-[#fff7fb] text-[#514158]">
        <div class="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-5 py-6">
          <header class="rounded-[2rem] border border-[#f3ccd9] bg-[#ffe2ec] px-6 py-5 shadow-sm">
            <p class="text-sm font-semibold uppercase tracking-[0.32em] text-[#a06d85]">
              baby kitchen party room
            </p>
            <div class="mt-3 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 class="text-5xl font-black tracking-tight text-[#6d4d73]">
                  It Takes a Village
                </h1>
                <p class="mt-2 max-w-2xl text-lg text-[#765c72]">
                  Gather the helpers, stock the nursery, and get ready for cozy
                  chaos.
                </p>
              </div>
              <div class="rounded-2xl bg-white/75 px-4 py-3 text-right">
                <p class="text-xs font-bold uppercase tracking-[0.24em] text-[#a06d85]">
                  Session
                </p>
                <p class="text-xl font-bold text-[#6d4d73]">
                  {displayState.sessionId}
                </p>
                <p class="text-sm text-[#8b7186]">{signalStatus}</p>
              </div>
            </div>
          </header>

          <section class="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div class="rounded-[2rem] border border-[#d8e8d5] bg-[#e9f7e6] p-6 shadow-sm">
              <div class="grid gap-4 md:grid-cols-2">
                <div class="rounded-3xl border border-[#cfe2ff] bg-[#eef6ff] p-5">
                  <p class="text-xs font-bold uppercase tracking-[0.28em] text-[#667fa3]">
                    Host
                  </p>
                  <p class="mt-3 text-3xl font-black text-[#52627d]">
                    {host
                      ? displayName(host.name, "Host helper")
                      : "Waiting for host"}
                  </p>
                  <p class="mt-2 text-sm text-[#667285]">
                    {host?.connected
                      ? "Host controller connected."
                      : "The host joins with the private code."}
                  </p>
                </div>

                <div class="rounded-3xl border border-[#ffe1a8] bg-[#fff4d7] p-5">
                  <p class="text-xs font-bold uppercase tracking-[0.28em] text-[#9b7b36]">
                    Village Helpers
                  </p>
                  <p class="mt-3 text-3xl font-black text-[#806230]">
                    {players.length}
                  </p>
                  <p class="mt-2 text-sm text-[#7b6b4d]">
                    Players appear here after they enter a name.
                  </p>
                </div>
              </div>

              <div class="mt-5 rounded-[1.75rem] border border-[#efd0be] bg-[#fff8f3] p-5">
                <p class="text-xs font-bold uppercase tracking-[0.28em] text-[#a87965]">
                  Connected Players
                </p>
                <div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {players.map((player) => (
                    <div
                      key={player.id}
                      class="rounded-2xl border border-[#f4d7c9] bg-white/80 px-4 py-3"
                    >
                      <p class="text-xl font-bold text-[#6d4d73]">
                        {displayName(player.name, "Tiny helper")}
                      </p>
                      <p class="text-sm text-[#8d7689]">
                        {player.connected ? "Ready in the nursery" : "Away"}
                      </p>
                    </div>
                  ))}
                  {players.length === 0 && (
                    <div class="rounded-2xl border-2 border-dashed border-[#e7c8d5] bg-white/50 px-4 py-8 text-center text-[#8d7689] sm:col-span-2 xl:col-span-3">
                      Share the player code to fill the village.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <aside class="space-y-5">
              <JoinCard
                title="Player Code"
                code={displayState.playerCode}
                note="Public code for every helper."
                qr={playerQr}
                color="text-[#667fa3]"
              />
              <JoinCard
                title="Host Code"
                code={displayState.hostCode}
                note="Private code for the room leader."
                qr={hostQr}
                color="text-[#a06d85]"
              />
              {transportError && (
                <div class="rounded-2xl border border-[#f0b9ad] bg-[#ffe5df] px-4 py-3 text-sm text-[#875548]">
                  {transportError}
                </div>
              )}
            </aside>
          </section>
        </div>
      </main>
    );
  }

  const controllerTitle = resolvedRole === "host"
    ? "Host Controller"
    : resolvedRole === "player"
    ? "Player Controller"
    : "Joining Room";
  const snapshotName = controllerSnapshot?.participants.find((participant) =>
    participant.id === controllerSnapshot.viewerParticipantId
  )?.name;
  const controllerDisplayName = displayName(
    snapshotName ?? participantName,
    resolvedRole === "host" ? "Host helper" : "Tiny helper",
  );
  const openControllerChannelCount = [...peerChannelsRef.current.values()]
    .filter((channel) => channel.readyState === "open").length;
  const canHostStart = resolvedRole === "host" &&
    Boolean(controllerSnapshot?.isHost) &&
    Boolean(trimName(participantName)) &&
    openControllerChannelCount > 0;

  if (gamePhase === "playing") {
    return (
      <VillageController
        name={displayGameName(controllerDisplayName)}
        signalStatus={signalStatus}
        onInput={sendGameInput}
      />
    );
  }

  return (
    <main class="min-h-screen bg-[#fdf4ff] px-4 py-6 text-[#514158]">
      <div class="mx-auto flex min-h-[calc(100vh-3rem)] max-w-xl flex-col gap-5">
        <section class="rounded-[2rem] border border-[#efd0ef] bg-white/80 p-6 shadow-sm">
          <p class="text-xs font-bold uppercase tracking-[0.32em] text-[#a06d85]">
            {controllerTitle}
          </p>
          <h1 class="mt-3 text-4xl font-black tracking-tight text-[#6d4d73]">
            It Takes a Village
          </h1>
          <p class="mt-2 text-sm text-[#806d7b]">Join code: {joinCode}</p>
          <p class="mt-1 text-sm text-[#806d7b]">{signalStatus}</p>

          <form class="mt-6 space-y-3" onSubmit={submitName}>
            <label class="block text-sm font-bold text-[#6d4d73]" for="name">
              {resolvedRole === "host" ? "Host name" : "Player name"}
            </label>
            <input
              id="name"
              value={draftName}
              onInput={(event) =>
                setDraftName((event.currentTarget as HTMLInputElement).value)}
              placeholder={resolvedRole === "host"
                ? "Village lead"
                : "Helper name"}
              class="h-14 w-full rounded-2xl border border-[#e7c8d5] bg-[#fff7fb] px-4 text-lg font-semibold text-[#514158] outline-none focus:border-[#b8d8c0]"
            />
            <button
              type="submit"
              class="h-14 w-full rounded-2xl bg-[#b8d8c0] text-lg font-black text-[#385443] transition hover:bg-[#a7cfae]"
            >
              Save Name
            </button>
          </form>

          {transportError && (
            <div class="mt-4 rounded-2xl border border-[#f0b9ad] bg-[#ffe5df] px-4 py-3 text-sm text-[#875548]">
              {transportError}
            </div>
          )}
        </section>

        {resolvedRole === "host" && (
          <section class="rounded-[2rem] border border-[#cfe2ff] bg-[#eef6ff] p-6">
            <p class="text-sm font-bold uppercase tracking-[0.26em] text-[#667fa3]">
              Room Controls
            </p>
            <p class="mt-3 text-2xl font-black text-[#52627d]">
              {controllerDisplayName}
            </p>
            <button
              type="button"
              disabled={!canHostStart}
              onClick={handleHostStart}
              class={`mt-5 h-16 w-full rounded-2xl text-xl font-black transition ${
                canHostStart
                  ? "bg-[#9ec5fe] text-[#384b68] hover:bg-[#8ab6ef]"
                  : "cursor-not-allowed bg-[#d7e6f8] text-[#8394ad]"
              }`}
            >
              Start Game
            </button>
          </section>
        )}

        {resolvedRole === "player" && (
          <section class="flex flex-1 flex-col justify-center rounded-[2rem] border border-[#ffe1a8] bg-[#fff4d7] p-6 text-center">
            <p class="text-sm font-bold uppercase tracking-[0.26em] text-[#9b7b36]">
              Ready helper
            </p>
            <p class="mt-4 text-3xl font-black text-[#806230]">
              {controllerDisplayName}
            </p>
            <p class="mt-4 text-lg font-semibold text-[#7b6b4d]">
              Waiting for host to start...
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

function JoinCard(
  { title, code, note, qr, color }: {
    title: string;
    code: string;
    note: string;
    qr: string;
    color: string;
  },
) {
  return (
    <div class="rounded-[2rem] border border-[#efd0ef] bg-white/80 p-5 shadow-sm">
      <p class={`text-xs font-bold uppercase tracking-[0.28em] ${color}`}>
        {title}
      </p>
      <p class="mt-3 break-all text-4xl font-black tracking-[0.12em] text-[#6d4d73]">
        {code}
      </p>
      <p class="mt-2 text-sm text-[#806d7b]">{note}</p>
      <div class="mt-4 rounded-3xl bg-white p-3">
        <img src={qr} alt={`${title} QR code`} class="mx-auto h-44 w-44" />
      </div>
    </div>
  );
}
