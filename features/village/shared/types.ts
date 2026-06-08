export type ControllerRole = "host" | "player";
export type VillageClientRole = "display" | ControllerRole;

export interface VillageParticipant {
  id: string;
  name: string;
  connected: boolean;
  joinedOrder: number;
  role: ControllerRole;
}

export interface VillageState {
  sessionId: string;
  hostCode: string;
  playerCode: string;
  participants: VillageParticipant[];
  hostParticipantId: string | null;
}

export interface VillageSnapshot {
  sessionId: string;
  participants: VillageParticipant[];
  hostParticipantId: string | null;
  viewerParticipantId: string | null;
  isHost: boolean;
}

export interface ControllerHelloEvent {
  type: "hello";
  participantId: string;
  name: string;
  role: ControllerRole;
}

export interface SetNameEvent {
  type: "set_name";
  name: string;
}

export type ControllerEvent = ControllerHelloEvent | SetNameEvent;

export interface ControllerEnvelope {
  kind: "controller_event";
  event: ControllerEvent;
}

export interface SnapshotEnvelope {
  kind: "snapshot";
  snapshot: VillageSnapshot;
}

export interface SignalPeerInfo {
  clientId: string;
  kind: "display" | "controller";
  role?: ControllerRole;
}

export type SignalServerMessage =
  | {
    type: "signal_ready";
    sessionId: string;
    role: VillageClientRole;
    peers: SignalPeerInfo[];
  }
  | {
    type: "peer_joined";
    peer: SignalPeerInfo;
  }
  | {
    type: "peer_left";
    clientId: string;
  }
  | {
    type: "signal";
    fromClientId: string;
    payload: RTCIceCandidateInit | RTCSessionDescriptionInit;
  }
  | {
    type: "error";
    error: string;
  };

export type SignalClientMessage =
  | {
    type: "register_room";
    sessionId: string;
    hostCode: string;
    playerCode: string;
  }
  | {
    type: "signal";
    targetClientId: string;
    payload: RTCIceCandidateInit | RTCSessionDescriptionInit;
  };

export type VillageEngineEvent =
  | {
    type: "peer_connected";
    participantId: string;
    name: string;
    role: ControllerRole;
  }
  | {
    type: "peer_disconnected";
    participantId: string;
  }
  | {
    type: "controller_event";
    participantId: string;
    event: SetNameEvent;
  };
