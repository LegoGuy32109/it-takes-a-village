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

function assignHost(
  participants: VillageParticipant[],
  preferredHostParticipantId: string | null,
): {
  participants: VillageParticipant[];
  hostParticipantId: string | null;
} {
  const preferredHost = preferredHostParticipantId
    ? participants.find((participant) =>
      participant.id === preferredHostParticipantId && participant.connected
    ) ?? null
    : null;
  const host = preferredHost ?? participants
    .filter((participant) => participant.connected)
    .sort((left, right) => left.joinedOrder - right.joinedOrder)[0] ??
    null;
  const hostParticipantId = host?.id ?? null;

  return {
    participants: participants.map((participant) => ({
      ...participant,
      role: participant.connected && participant.id === hostParticipantId
        ? "host"
        : "player",
    })),
    hostParticipantId,
  };
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
          role: "player",
        };
      } else {
        nextParticipants.push({
          id: event.participantId,
          name,
          connected: true,
          joinedOrder: state.participants.length,
          role: "player",
        });
      }

      const assignment = assignHost(nextParticipants, state.hostParticipantId);
      return {
        ...state,
        participants: assignment.participants,
        hostParticipantId: assignment.hostParticipantId,
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

      const assignment = assignHost(nextParticipants, state.hostParticipantId);
      return {
        ...state,
        participants: assignment.participants,
        hostParticipantId: assignment.hostParticipantId,
      };
    }
    case "peer_removed": {
      const nextParticipants = state.participants.filter((participant) =>
        participant.id !== event.participantId
      );
      if (nextParticipants.length === state.participants.length) return state;

      const assignment = assignHost(nextParticipants, state.hostParticipantId);
      return {
        ...state,
        participants: assignment.participants,
        hostParticipantId: assignment.hostParticipantId,
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
