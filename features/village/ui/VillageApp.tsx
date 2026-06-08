import { qrcode } from "@libs/qrcode";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  buildVillageSnapshot,
  createVillageState,
  reduceVillageState,
} from "../shared/state.ts";
import {
  ControllerEnvelope,
  ControllerRole,
  SignalClientMessage,
  SignalServerMessage,
  SnapshotEnvelope,
  VillageClientRole,
  VillageSnapshot,
  VillageState,
} from "../shared/types.ts";

interface VillageAppProps {
  iceServers: RTCIceServer[];
  initialJoinCode: string;
}

const PARTICIPANT_ID_STORAGE_KEY = "village:participant-id";
const PARTICIPANT_NAME_STORAGE_KEY = "village:participant-name";

function createSessionId(): string {
  return crypto.randomUUID().split("-")[0];
}

function createJoinCode(excluded?: string): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  do {
    code = Array.from(
      { length: 6 },
      () => alphabet[Math.floor(Math.random() * alphabet.length)],
    ).join("");
  } while (code === excluded);
  return code;
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

  const clientIdRef = useRef(createClientId());
  const resolvedRoleRef = useRef<ControllerRole | null>(null);
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
  }, [joinCode]);

  useEffect(() => {
    resolvedRoleRef.current = resolvedRole;
  }, [resolvedRole]);

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

  const isDisplayMode = mode === "display";
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
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }

  function sendControllerEnvelope(envelope: ControllerEnvelope) {
    for (const channel of peerChannelsRef.current.values()) {
      if (channel.readyState === "open") {
        channel.send(JSON.stringify(envelope));
      }
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

  function commitDisplayEvent(event: Parameters<typeof reduceVillageState>[1]) {
    const nextState = reduceVillageState(gameStateRef.current, event);
    gameStateRef.current = nextState;
    setDisplayState(nextState);
    sendSnapshotToControllers(nextState);
  }

  function cleanupPeer(clientId: string) {
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
    peerChannelsRef.current.set(peerId, channel);

    channel.addEventListener("open", () => {
      setSignalStatus(isDisplayMode ? "Display connected" : "Connected");
      if (!isDisplayMode) {
        channel.send(JSON.stringify(
          {
            kind: "controller_event",
            event: {
              type: "hello",
              participantId,
              name: trimName(participantName),
              role: resolvedRoleRef.current ?? "player",
            },
          } satisfies ControllerEnvelope,
        ));
      }
    });

    channel.addEventListener("close", () => {
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
          | SnapshotEnvelope;

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
            return;
          }

          const participantIdFromPeer = peerParticipantIdsRef.current.get(
            peerId,
          );
          if (!participantIdFromPeer) return;
          commitDisplayEvent({
            type: "controller_event",
            participantId: participantIdFromPeer,
            event: payload.event,
          });
          return;
        }

        if (payload.kind !== "snapshot") return;
        setControllerSnapshot(payload.snapshot);
      } catch {
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
      return;
    }
    await connection.addIceCandidate(candidate);
  }

  async function flushPendingCandidates(
    peerId: string,
    connection: RTCPeerConnection,
  ) {
    const candidates = pendingCandidatesRef.current.get(peerId) ?? [];
    pendingCandidatesRef.current.delete(peerId);
    for (const candidate of candidates) {
      await connection.addIceCandidate(candidate);
    }
  }

  function createDisplayPeerConnection(targetClientId: string) {
    if (peerConnectionsRef.current.has(targetClientId)) return;

    const connection = new RTCPeerConnection({ iceServers });
    const channel = connection.createDataChannel("village-control", {
      ordered: true,
    });

    connection.addEventListener("icecandidate", (event) => {
      if (!event.candidate) return;
      sendSignalMessage({
        type: "signal",
        targetClientId,
        payload: event.candidate.toJSON(),
      });
    });

    connection.addEventListener("connectionstatechange", () => {
      if (
        connection.connectionState === "failed" ||
        connection.connectionState === "disconnected" ||
        connection.connectionState === "closed"
      ) {
        cleanupPeer(targetClientId);
      }
    });

    peerConnectionsRef.current.set(targetClientId, connection);
    attachChannelHandlers(targetClientId, channel);

    connection.createOffer()
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
        setTransportError("Failed to create a display peer connection.");
        cleanupPeer(targetClientId);
      });
  }

  function createControllerPeerConnection(displayClientId: string) {
    const existing = peerConnectionsRef.current.get(displayClientId);
    if (existing) return existing;

    const connection = new RTCPeerConnection({ iceServers });
    peerConnectionsRef.current.set(displayClientId, connection);

    connection.addEventListener("icecandidate", (event) => {
      if (!event.candidate) return;
      sendSignalMessage({
        type: "signal",
        targetClientId: displayClientId,
        payload: event.candidate.toJSON(),
      });
    });

    connection.addEventListener("connectionstatechange", () => {
      if (
        connection.connectionState === "failed" ||
        connection.connectionState === "disconnected" ||
        connection.connectionState === "closed"
      ) {
        cleanupPeer(displayClientId);
      }
    });

    connection.addEventListener("datachannel", (event) => {
      attachChannelHandlers(displayClientId, event.channel);
    });

    return connection;
  }

  function handleSignalMessage(message: SignalServerMessage) {
    switch (message.type) {
      case "signal_ready":
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
        if (
          isDisplayMode && message.peer.kind === "controller" &&
          message.peer.role
        ) {
          peerRolesRef.current.set(message.peer.clientId, message.peer.role);
          createDisplayPeerConnection(message.peer.clientId);
        }
        return;
      case "peer_left":
        cleanupPeer(message.clientId);
        return;
      case "signal": {
        if (isDisplayMode) {
          const connection = peerConnectionsRef.current.get(
            message.fromClientId,
          );
          if (!connection) return;
          if (isSessionDescriptionPayload(message.payload)) {
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
            connection.setRemoteDescription(message.payload)
              .then(() =>
                flushPendingCandidates(message.fromClientId, connection)
              )
              .then(() => connection.createAnswer())
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

    const socket = new WebSocket(signalUrl);
    signalSocketRef.current = socket;

    socket.addEventListener("open", () => {
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
      parseSignalMessageData(event.data)
        .then((message) => {
          if (!disposed) handleSignalMessage(message);
        })
        .catch(() =>
          setTransportError("Realtime signaling returned invalid data.")
        );
    });

    socket.addEventListener("close", () => {
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
    setDraftName(nextName);
    setParticipantName(nextName);
    if (!isDisplayMode) {
      sendControllerEnvelope({
        kind: "controller_event",
        event: { type: "set_name", name: nextName },
      });
    }
  }

  if (!booted) {
    return <div class="min-h-screen bg-[#fff7fb]" />;
  }

  if (isDisplayMode) {
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
              {displayName(snapshotName ?? participantName, "Host helper")}
            </p>
            <button
              type="button"
              disabled
              class="mt-5 h-16 w-full cursor-not-allowed rounded-2xl bg-[#d7e6f8] text-xl font-black text-[#8394ad]"
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
              {displayName(snapshotName ?? participantName, "Tiny helper")}
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
