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
  color: number;
  x: number;
  y: number;
}

const PLAYER_SIZE = 34;
const PLAYER_BORDER_SIZE = 2;
const PLAYER_SPEED_PX_PER_SECOND = 220;
const LABEL_LIMIT = 12;
const WORLD_PADDING = 24;
const ROOM_BACKGROUND = "#ffe9ee";
const ROOM_STRIPE = "#ffdce5";
const STRIPE_WIDTH = 20;
const STRIPE_SPACING = 72;

function displayLabel(name: string): string {
  const trimmed = name.trim() || "Helper";
  if (trimmed.length <= LABEL_LIMIT) return trimmed;
  return `${trimmed.slice(0, Math.max(0, LABEL_LIMIT - 1))}-`;
}

function darkenColor(color: number): number {
  const darken = (channel: number) => Math.round(channel * 0.74);
  return (darken((color >> 16) & 255) << 16) |
    (darken((color >> 8) & 255) << 8) |
    darken(color & 255);
}

function drawPlayerBody(
  body: import("pixi.js").Graphics,
  color: number,
) {
  const borderColor = darkenColor(color);
  const innerSize = PLAYER_SIZE - PLAYER_BORDER_SIZE * 2;
  body.clear()
    .rect(-PLAYER_SIZE / 2, -PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE)
    .fill(borderColor)
    .rect(-innerSize / 2, -innerSize / 2, innerSize, innerSize)
    .fill(color);
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
        background: ROOM_BACKGROUND,
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

        background.clear()
          .rect(0, 0, width, height)
          .fill("#ffffff")
          .rect(
            WORLD_PADDING,
            WORLD_PADDING,
            Math.max(0, width - WORLD_PADDING * 2),
            Math.max(0, height - WORLD_PADDING * 2),
          )
          .fill(ROOM_BACKGROUND);

        const worldLeft = WORLD_PADDING;
        const worldTop = WORLD_PADDING;
        const worldRight = width - WORLD_PADDING;
        const worldBottom = height - WORLD_PADDING;
        for (
          let stripeX = worldLeft - height;
          stripeX < worldRight;
          stripeX += STRIPE_SPACING
        ) {
          background
            .poly([
              stripeX,
              worldBottom,
              stripeX + STRIPE_WIDTH,
              worldBottom,
              stripeX + height + STRIPE_WIDTH,
              worldTop,
              stripeX + height,
              worldTop,
            ])
            .fill({ color: ROOM_STRIPE, alpha: 0.55 });
        }

        background
          .rect(0, 0, width, WORLD_PADDING)
          .fill("#ffffff")
          .rect(0, height - WORLD_PADDING, width, WORLD_PADDING)
          .fill("#ffffff")
          .rect(0, 0, WORLD_PADDING, height)
          .fill("#ffffff")
          .rect(width - WORLD_PADDING, 0, WORLD_PADDING, height)
          .fill("#ffffff");
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
            if (existing.color !== player.color) {
              existing.color = player.color;
              drawPlayerBody(existing.body, player.color);
            }
            return;
          }

          const spawn = getSpawnPoint(
            index,
            currentPlayers.length,
            app.renderer.width,
            app.renderer.height,
          );
          const body = new Graphics();
          drawPlayerBody(body, player.color);
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
            color: player.color,
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
            Math.max(WORLD_PADDING + PLAYER_SIZE / 2, rendered.x),
            app!.renderer.width - WORLD_PADDING - PLAYER_SIZE / 2,
          );
          rendered.y = Math.min(
            Math.max(WORLD_PADDING + PLAYER_SIZE / 2, rendered.y),
            app!.renderer.height - WORLD_PADDING - PLAYER_SIZE / 2,
          );
        }
      });

      app.ticker.add((ticker: Ticker) => {
        if (!app) return;
        syncPlayers();
        const deltaSeconds = ticker.deltaMS / 1000;
        const minX = WORLD_PADDING + PLAYER_SIZE / 2;
        const minY = WORLD_PADDING + PLAYER_SIZE / 2;
        const maxX = app.renderer.width - WORLD_PADDING - PLAYER_SIZE / 2;
        const maxY = app.renderer.height - WORLD_PADDING - PLAYER_SIZE / 2;

        for (const rendered of renderedPlayersRef.current.values()) {
          const input = inputsRef.current.get(rendered.id);
          const inputX = input?.x ?? 0;
          const inputY = input?.y ?? 0;
          const magnitude = Math.hypot(inputX, inputY);
          const normalizedX = magnitude > 1 ? inputX / magnitude : inputX;
          const normalizedY = magnitude > 1 ? inputY / magnitude : inputY;

          rendered.x = Math.min(
            Math.max(
              minX,
              rendered.x +
                normalizedX * PLAYER_SPEED_PX_PER_SECOND * deltaSeconds,
            ),
            maxX,
          );
          rendered.y = Math.min(
            Math.max(
              minY,
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
      class="fixed inset-0 overflow-hidden bg-[#ffe9ee]"
    />
  );
}
