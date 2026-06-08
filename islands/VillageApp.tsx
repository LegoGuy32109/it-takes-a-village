import VillageApp from "../features/village/ui/VillageApp.tsx";

interface VillageAppIslandProps {
  iceServers: RTCIceServer[];
  initialJoinCode: string;
}

export default function VillageAppIsland(props: VillageAppIslandProps) {
  return <VillageApp {...props} />;
}
