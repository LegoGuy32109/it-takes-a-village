const XIRSYS_TURN_ENDPOINT = "https://global.xirsys.net";

type XirsysTurnResponse = {
  s?: string;
  v?: unknown;
};

type IceServerLike = {
  credential?: unknown;
  url?: unknown;
  urls?: unknown;
  username?: unknown;
};

function normalizeIceServer(server: IceServerLike): RTCIceServer | null {
  const urls = Array.isArray(server.urls)
    ? server.urls.filter((value): value is string => typeof value === "string")
    : typeof server.urls === "string"
    ? server.urls
    : typeof server.url === "string"
    ? server.url
    : Array.isArray(server.url)
    ? server.url.filter((value): value is string => typeof value === "string")
    : null;

  if (urls === null || (Array.isArray(urls) && urls.length === 0)) return null;

  const normalized: RTCIceServer = { urls };
  if (typeof server.username === "string") {
    normalized.username = server.username;
  }
  if (typeof server.credential === "string") {
    normalized.credential = server.credential;
  }
  return normalized;
}

function parseIceServers(value: unknown): RTCIceServer[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const normalized = normalizeIceServer(entry as IceServerLike);
      return normalized ? [normalized] : [];
    });
  }

  if (typeof value === "string") {
    try {
      return parseIceServers(JSON.parse(value));
    } catch {
      return [];
    }
  }

  if (value && typeof value === "object") {
    const candidate = value as { iceServers?: unknown };
    if (Array.isArray(candidate.iceServers)) {
      return parseIceServers(candidate.iceServers);
    }
  }

  return [];
}

export async function loadVillageIceServers(): Promise<RTCIceServer[]> {
  const ident = Deno.env.get("XIRSYS_IDENT")?.trim();
  const secret = Deno.env.get("XIRSYS_SECRET")?.trim();
  const channel = Deno.env.get("XIRSYS_CHANNEL")?.trim();

  if (!ident || !secret || !channel) return [];

  const response = await fetch(
    `${XIRSYS_TURN_ENDPOINT}/_turn/${encodeURIComponent(channel)}`,
    {
      method: "PUT",
      headers: {
        authorization: `Basic ${btoa(`${ident}:${secret}`)}`,
        "content-type": "application/json",
      },
    },
  );

  if (!response.ok) {
    console.error(
      `Failed to load village ICE servers from Xirsys: ${response.status} ${response.statusText}`,
    );
    return [];
  }

  const payload = await response.json() as XirsysTurnResponse;
  return parseIceServers(payload.v);
}
