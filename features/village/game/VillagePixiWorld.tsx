import { useEffect, useRef } from "preact/hooks";
import type { Ticker } from "pixi.js";
import { GameStartedPlayer, VillagePlayerInput } from "../shared/types.ts";

interface VillagePixiWorldProps {
  players: GameStartedPlayer[];
  inputsRef: { current: Map<string, VillagePlayerInput> };
}

interface RenderedPlayer {
  id: string;
  body: import("pixi.js").Graphics;
  label: import("pixi.js").Text;
  x: number;
  y: number;
}

const PLAYER_SIZE = 34;
const PLAYER_SPEED_PX_PER_SECOND = 220;
const LABEL_LIMIT = 12;

function displayLabel(name: string): string {
  const trimmed = name.trim() || "Helper";
  if (trimmed.length <= LABEL_LIMIT) return trimmed;
  return `${trimmed.slice(0, Math.max(0, LABEL_LIMIT - 1))}-`;
}

function getSpawnPoint(
  index: number,
  total: number,
  width: number,
  height: number,
) {
  const zoneSize = Math.max(160, height * 0.5);
  const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
  const rows = Math.max(1, Math.ceil(total / columns));
  const cellSize = zoneSize / Math.max(columns, rows);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const zoneLeft = width / 2 - zoneSize / 2;
  const zoneTop = height / 2 - zoneSize / 2;

  return {
    x: zoneLeft + cellSize * (column + 0.5),
    y: zoneTop + cellSize * (row + 0.5 + Math.max(0, columns - rows) * 0.08),
  };
}

export function VillagePixiWorld(
  { players, inputsRef }: VillagePixiWorldProps,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderedPlayersRef = useRef(new Map<string, RenderedPlayer>());
  const playersRef = useRef(players);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let app: import("pixi.js").Application | null = null;
    let background: import("pixi.js").Graphics | null = null;

    import("pixi.js").then(async ({ Application, Graphics, Text }) => {
      if (disposed) return;

      app = new Application();
      await app.init({
        antialias: true,
        autoDensity: true,
        background: "#fff7fb",
        resizeTo: window,
      });

      if (disposed) {
        app.destroy(true);
        return;
      }

      app.canvas.style.display = "block";
      app.canvas.style.width = "100vw";
      app.canvas.style.height = "100vh";
      container.appendChild(app.canvas);

      background = new Graphics();
      app.stage.addChild(background);

      function drawBackground() {
        if (!app || !background) return;
        const width = app.renderer.width;
        const height = app.renderer.height;
        const spawnSize = Math.max(160, height * 0.5);
        const spawnLeft = width / 2 - spawnSize / 2;
        const spawnTop = height / 2 - spawnSize / 2;

        background.clear()
          .rect(0, 0, width, height)
          .fill("#fff7fb")
          .rect(24, 24, Math.max(0, width - 48), Math.max(0, height - 48))
          .fill("#e9f7e6")
          .rect(spawnLeft, spawnTop, spawnSize, spawnSize)
          .fill({ color: "#fff4d7", alpha: 0.9 })
          .rect(spawnLeft + 14, spawnTop + 14, spawnSize - 28, spawnSize - 28)
          .fill({ color: "#eef6ff", alpha: 0.42 });
      }

      function syncPlayers() {
        if (!app) return;
        const currentPlayers = playersRef.current;
        const currentIds = new Set(currentPlayers.map((player) => player.id));

        for (const [playerId, rendered] of renderedPlayersRef.current) {
          if (currentIds.has(playerId)) continue;
          app.stage.removeChild(rendered.body, rendered.label);
          rendered.body.destroy();
          rendered.label.destroy();
          renderedPlayersRef.current.delete(playerId);
        }

        currentPlayers.forEach((player, index) => {
          if (!app) return;
          const existing = renderedPlayersRef.current.get(player.id);
          if (existing) {
            existing.label.text = displayLabel(player.name);
            return;
          }

          const spawn = getSpawnPoint(
            index,
            currentPlayers.length,
            app.renderer.width,
            app.renderer.height,
          );
          const body = new Graphics()
            .rect(-PLAYER_SIZE / 2, -PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE)
            .fill(player.color);
          const label = new Text({
            text: displayLabel(player.name),
            style: {
              fill: "#514158",
              fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
              fontSize: 14,
              fontWeight: "700",
            },
          });
          label.anchor.set(0.5, 1);
          app.stage.addChild(body, label);
          renderedPlayersRef.current.set(player.id, {
            id: player.id,
            body,
            label,
            x: spawn.x,
            y: spawn.y,
          });
        });
      }

      drawBackground();
      syncPlayers();

      app.renderer.on("resize", () => {
        drawBackground();
        for (const rendered of renderedPlayersRef.current.values()) {
          rendered.x = Math.min(
            Math.max(PLAYER_SIZE / 2, rendered.x),
            app!.renderer.width - PLAYER_SIZE / 2,
          );
          rendered.y = Math.min(
            Math.max(PLAYER_SIZE / 2 + 22, rendered.y),
            app!.renderer.height - PLAYER_SIZE / 2,
          );
        }
      });

      app.ticker.add((ticker: Ticker) => {
        if (!app) return;
        syncPlayers();
        const deltaSeconds = ticker.deltaMS / 1000;
        const maxX = app.renderer.width - PLAYER_SIZE / 2;
        const maxY = app.renderer.height - PLAYER_SIZE / 2;

        for (const rendered of renderedPlayersRef.current.values()) {
          const input = inputsRef.current.get(rendered.id);
          const inputX = input?.x ?? 0;
          const inputY = input?.y ?? 0;
          const magnitude = Math.hypot(inputX, inputY);
          const normalizedX = magnitude > 1 ? inputX / magnitude : inputX;
          const normalizedY = magnitude > 1 ? inputY / magnitude : inputY;

          rendered.x = Math.min(
            Math.max(
              PLAYER_SIZE / 2,
              rendered.x +
                normalizedX * PLAYER_SPEED_PX_PER_SECOND * deltaSeconds,
            ),
            maxX,
          );
          rendered.y = Math.min(
            Math.max(
              PLAYER_SIZE / 2 + 22,
              rendered.y +
                normalizedY * PLAYER_SPEED_PX_PER_SECOND * deltaSeconds,
            ),
            maxY,
          );
          rendered.body.x = rendered.x;
          rendered.body.y = rendered.y;
          rendered.label.x = rendered.x;
          rendered.label.y = rendered.y - PLAYER_SIZE / 2 - 6;
        }
      });
    });

    return () => {
      disposed = true;
      for (const rendered of renderedPlayersRef.current.values()) {
        rendered.body.destroy();
        rendered.label.destroy();
      }
      renderedPlayersRef.current.clear();
      app?.destroy(true, { children: true });
      app = null;
    };
  }, [inputsRef]);

  return (
    <div
      ref={containerRef}
      class="fixed inset-0 overflow-hidden bg-[#fff7fb]"
    />
  );
}
