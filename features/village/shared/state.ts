import {
  VillageEngineEvent,
  VillageParticipant,
  VillageSnapshot,
  VillageState,
} from "./types.ts";

function findParticipantIndex(
  participants: VillageParticipant[],
  participantId: string,
): number {
  return participants.findIndex((participant) =>
    participant.id === participantId
  );
}

function trimName(name: string): string {
  return name.trim().slice(0, 30);
}

export function createVillageState(
  sessionId: string,
  joinCode: string,
): VillageState {
  return {
    sessionId,
    joinCode,
    participants: [],
    hostParticipantId: null,
  };
}

export function reduceVillageState(
  state: VillageState,
  event: VillageEngineEvent,
): VillageState {
  switch (event.type) {
    case "peer_connected": {
      const participantIndex = findParticipantIndex(
        state.participants,
        event.participantId,
      );
      const nextParticipants = [...state.participants];
      const name = trimName(event.name);

      if (participantIndex >= 0) {
        nextParticipants[participantIndex] = {
          ...nextParticipants[participantIndex],
          connected: true,
          name: name || nextParticipants[participantIndex].name,
          role: event.role,
        };
      } else {
        nextParticipants.push({
          id: event.participantId,
          name,
          connected: true,
          joinedOrder: state.participants.length,
          role: event.role,
        });
      }

      return {
        ...state,
        participants: nextParticipants,
        hostParticipantId: event.role === "host"
          ? event.participantId
          : state.hostParticipantId,
      };
    }
    case "peer_disconnected": {
      const participantIndex = findParticipantIndex(
        state.participants,
        event.participantId,
      );
      if (participantIndex < 0) return state;

      const nextParticipants = [...state.participants];
      nextParticipants[participantIndex] = {
        ...nextParticipants[participantIndex],
        connected: false,
      };

      return {
        ...state,
        participants: nextParticipants,
      };
    }
    case "controller_event": {
      const participantIndex = findParticipantIndex(
        state.participants,
        event.participantId,
      );
      if (participantIndex < 0) return state;

      const nextParticipants = [...state.participants];
      nextParticipants[participantIndex] = {
        ...nextParticipants[participantIndex],
        name: trimName(event.event.name),
      };
      return { ...state, participants: nextParticipants };
    }
  }
}

export function buildVillageSnapshot(
  state: VillageState,
  viewerParticipantId: string | null,
): VillageSnapshot {
  return {
    sessionId: state.sessionId,
    participants: [...state.participants].sort((left, right) =>
      left.joinedOrder - right.joinedOrder
    ),
    hostParticipantId: state.hostParticipantId,
    viewerParticipantId,
    isHost: viewerParticipantId !== null &&
      state.hostParticipantId === viewerParticipantId,
  };
}
