import { useEffect, useRef } from "preact/hooks";
import type { Ticker } from "pixi.js";
import { GameStartedPlayer, VillagePlayerInput } from "../shared/types.ts";

interface VillagePixiWorldProps {
  players: GameStartedPlayer[];
  connectedPlayerIds: Set<string>;
  inputsRef: { current: Map<string, VillagePlayerInput> };
}

interface RenderedPlayer {
  id: string;
  body: import("pixi.js").Graphics;
  label: import("pixi.js").Text;
  scoreLabel: import("pixi.js").Text;
  color: number;
  x: number;
  y: number;
}

interface TriviaFact {
  text: string;
  isCorrect: boolean;
}

interface TriviaZone {
  id: number;
  body: import("pixi.js").Graphics;
  label: import("pixi.js").Text;
  x: number;
  y: number;
  width: number;
  height: number;
  velocityX: number;
  velocityY: number;
  isCorrect: boolean;
}

const PLAYER_SIZE = 34;
const PLAYER_BORDER_SIZE = 2;
const PLAYER_SPEED_PX_PER_SECOND = 220;
const LABEL_LIMIT = 12;
const WINNING_SCORE = 1000;
const CORRECT_POINTS_PER_SECOND = 20;
const INCORRECT_POINTS_PER_SECOND = -40;
const POINT_ACCELERATION_PER_SECOND = 0.01;
const WORLD_PADDING = 24;
const ROOM_BACKGROUND = "#ffe9ee";
const ROOM_STRIPE = "#ffdce5";
const STRIPE_WIDTH = 20;
const STRIPE_SPACING = 72;
const MAX_ZONES = 8;
const INITIAL_ZONE_LIMIT = 2;
const MAX_ZONE_LIMIT_AT_SECONDS = 90;
const INITIAL_SPAWN_INTERVAL_SECONDS = 5;
const MIN_SPAWN_INTERVAL_SECONDS = 2;
const ZONE_SPEED = 58;
const DIAGONAL_ZONE_SPEED_MULTIPLIER = 1.5;
const ZONE_COLORS = [
  0xffdbdb,
  0xcff1fb,
  0xd1d1f9,
  0xd6fbe4,
  0xfcfdcd,
];
const TRIVIA_FACTS: TriviaFact[] = [
  {
    text: "Newborn babies sleep most of the day.",
    isCorrect: true,
  },
  {
    text: "Babies are born with fully developed adult vision.",
    isCorrect: false,
  },
  {
    text: "Tummy time helps babies build neck and shoulder strength.",
    isCorrect: true,
  },
  {
    text: "A baby should sleep with loose blankets in the crib.",
    isCorrect: false,
  },
  {
    text: "Many babies double their birth weight by about five months.",
    isCorrect: true,
  },
  {
    text: "Newborn babies can safely drink cow's milk instead of formula.",
    isCorrect: false,
  },
  {
    text: "Babies recognize familiar voices before they can talk.",
    isCorrect: true,
  },
  {
    text: "Baby teeth are not important because they fall out.",
    isCorrect: false,
  },
  {
    text: "Most babies need support for their head at first.",
    isCorrect: true,
  },
  {
    text: "A rear-facing car seat is never needed after birth.",
    isCorrect: false,
  },
  {
    text: "Babies communicate needs with cries, faces, and movement.",
    isCorrect: true,
  },
  {
    text: "All babies crawl before they learn to walk.",
    isCorrect: false,
  },
  {
    text: "Babies are born with soft spots on the skull.",
    isCorrect: true,
  },
  {
    text: "Babies need pillows to sleep safely.",
    isCorrect: false,
  },
  {
    text: "Newborns can hear familiar voices.",
    isCorrect: true,
  },
  {
    text: "A baby's first bath must happen immediately.",
    isCorrect: false,
  },
  {
    text: "Babies usually need frequent feeding.",
    isCorrect: true,
  },
  {
    text: "Every baby gets teeth at the same age.",
    isCorrect: false,
  },
  {
    text: "Infants should sleep on their backs.",
    isCorrect: true,
  },
  {
    text: "Honey is safe for newborn babies.",
    isCorrect: false,
  },
  {
    text: "Baby nails can be trimmed carefully.",
    isCorrect: true,
  },
  {
    text: "Newborns can regulate heat like adults.",
    isCorrect: false,
  },
  {
    text: "Babies learn through touch and sound.",
    isCorrect: true,
  },
  {
    text: "Crying always means a baby is hungry.",
    isCorrect: false,
  },
  {
    text: "Pacifiers can soothe some babies.",
    isCorrect: true,
  },
  {
    text: "Babies should sleep on soft couches.",
    isCorrect: false,
  },
  {
    text: "Diaper changes help prevent rashes.",
    isCorrect: true,
  },
  {
    text: "Formula should be mixed extra strong.",
    isCorrect: false,
  },
  {
    text: "Babies often hiccup.",
    isCorrect: true,
  },
  {
    text: "All babies sleep through the night quickly.",
    isCorrect: false,
  },
  {
    text: "Burping can help after feeding.",
    isCorrect: true,
  },
  {
    text: "Baby bottles never need cleaning.",
    isCorrect: false,
  },
  {
    text: "Babies can recognize caregiver smells.",
    isCorrect: true,
  },
  {
    text: "Infants should ride forward-facing at birth.",
    isCorrect: false,
  },
  {
    text: "A clean diaper area matters.",
    isCorrect: true,
  },
  {
    text: "Teething always causes a high fever.",
    isCorrect: false,
  },
  {
    text: "Some babies spit up after feeding.",
    isCorrect: true,
  },
  {
    text: "Babies should drink water all day.",
    isCorrect: false,
  },
  {
    text: "Skin-to-skin contact can comfort babies.",
    isCorrect: true,
  },
  {
    text: "Baby walkers are required for walking.",
    isCorrect: false,
  },
  {
    text: "Reading to babies supports language.",
    isCorrect: true,
  },
  {
    text: "All newborn cries sound exactly alike.",
    isCorrect: false,
  },
  {
    text: "Babies need supervised tummy time.",
    isCorrect: true,
  },
  {
    text: "Crib bumpers make sleep safer.",
    isCorrect: false,
  },
  {
    text: "Babies track faces as vision develops.",
    isCorrect: true,
  },
  {
    text: "A newborn can eat solid food right away.",
    isCorrect: false,
  },
  {
    text: "Vaccines help protect babies.",
    isCorrect: true,
  },
  {
    text: "A baby car seat can be loose.",
    isCorrect: false,
  },
  {
    text: "Babies can get overstimulated.",
    isCorrect: true,
  },
  {
    text: "Bottle propping is a safe feeding habit.",
    isCorrect: false,
  },
  {
    text: "Hand washing helps protect newborns.",
    isCorrect: true,
  },
  {
    text: "Babies never need head support.",
    isCorrect: false,
  },
  {
    text: "Many babies enjoy gentle rocking.",
    isCorrect: true,
  },
  {
    text: "A fever in a newborn can be ignored.",
    isCorrect: false,
  },
  {
    text: "Babies grow at different rates.",
    isCorrect: true,
  },
  {
    text: "All babies roll over on the same day.",
    isCorrect: false,
  },
  {
    text: "Safe sleep uses a firm flat surface.",
    isCorrect: true,
  },
  {
    text: "Toys with small parts are for newborns.",
    isCorrect: false,
  },
  {
    text: "Babies respond to gentle voices.",
    isCorrect: true,
  },
  {
    text: "More blankets always make sleep safer.",
    isCorrect: false,
  },
  {
    text: "Caregivers should check diaper fit.",
    isCorrect: true,
  },
  {
    text: "A baby monitor replaces supervision.",
    isCorrect: false,
  },
];

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

function drawDashedRect(
  graphics: import("pixi.js").Graphics,
  width: number,
  height: number,
  color: number,
) {
  const dash = 14;
  const gap = 8;
  for (let x = 0; x < width; x += dash + gap) {
    graphics.rect(x, 0, Math.min(dash, width - x), 2).fill(color);
    graphics.rect(x, height - 2, Math.min(dash, width - x), 2).fill(color);
  }
  for (let y = 0; y < height; y += dash + gap) {
    graphics.rect(0, y, 2, Math.min(dash, height - y)).fill(color);
    graphics.rect(width - 2, y, 2, Math.min(dash, height - y)).fill(color);
  }
}

function drawZoneBody(
  graphics: import("pixi.js").Graphics,
  width: number,
  height: number,
  color: number,
) {
  const borderColor = darkenColor(color);
  graphics.clear()
    .rect(0, 0, width, height)
    .fill({ color, alpha: 0.88 });
  drawDashedRect(graphics, width, height, borderColor);
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

function getZoneLimit(elapsedSeconds: number): number {
  return Math.min(
    MAX_ZONES,
    INITIAL_ZONE_LIMIT +
      Math.floor(elapsedSeconds / (MAX_ZONE_LIMIT_AT_SECONDS / 6)),
  );
}

function getSpawnInterval(elapsedSeconds: number): number {
  const progress = Math.min(1, elapsedSeconds / MAX_ZONE_LIMIT_AT_SECONDS);
  return INITIAL_SPAWN_INTERVAL_SECONDS -
    (INITIAL_SPAWN_INTERVAL_SECONDS - MIN_SPAWN_INTERVAL_SECONDS) * progress;
}

function getRandomFact(): TriviaFact {
  return TRIVIA_FACTS[Math.floor(Math.random() * TRIVIA_FACTS.length)];
}

function rectanglesOverlap(
  leftA: number,
  topA: number,
  rightA: number,
  bottomA: number,
  leftB: number,
  topB: number,
  rightB: number,
  bottomB: number,
): boolean {
  return leftA < rightB && rightA > leftB && topA < bottomB && bottomA > topB;
}

export function VillagePixiWorld(
  { players, connectedPlayerIds, inputsRef }: VillagePixiWorldProps,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderedPlayersRef = useRef(new Map<string, RenderedPlayer>());
  const scoresRef = useRef(new Map<string, number>());
  const playersRef = useRef(players);
  const connectedPlayerIdsRef = useRef(connectedPlayerIds);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    connectedPlayerIdsRef.current = connectedPlayerIds;
  }, [connectedPlayerIds]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let app: import("pixi.js").Application | null = null;
    let background: import("pixi.js").Graphics | null = null;
    let border: import("pixi.js").Graphics | null = null;
    let zoneLayer: import("pixi.js").Container | null = null;
    let playerLayer: import("pixi.js").Container | null = null;
    let winnerText: import("pixi.js").Text | null = null;
    const zones: TriviaZone[] = [];
    let clearZonesForCleanup = () => {};
    let nextZoneId = 1;
    let elapsedSeconds = 0;
    let nextSpawnInSeconds = 2;
    let gameEnded = false;
    let winnerId: string | null = null;

    import("pixi.js").then(
      async ({ Application, Container, Graphics, Text }) => {
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
        zoneLayer = new Container();
        border = new Graphics();
        playerLayer = new Container();
        winnerText = new Text({
          text: "",
          style: {
            fill: "#514158",
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
            fontSize: 56,
            fontWeight: "900",
            align: "center",
          },
        });
        winnerText.anchor.set(0.5);
        winnerText.visible = false;
        app.stage.addChild(
          background,
          zoneLayer,
          border,
          playerLayer,
          winnerText,
        );

        function drawBackground() {
          if (!app || !background || !border) return;
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

          border.clear()
            .rect(0, 0, width, WORLD_PADDING)
            .fill("#ffffff")
            .rect(0, height - WORLD_PADDING, width, WORLD_PADDING)
            .fill("#ffffff")
            .rect(0, 0, WORLD_PADDING, height)
            .fill("#ffffff")
            .rect(width - WORLD_PADDING, 0, WORLD_PADDING, height)
            .fill("#ffffff");

          if (winnerText) {
            winnerText.x = width / 2;
            winnerText.y = height / 2;
            winnerText.style.fontSize = Math.max(
              32,
              Math.min(72, width * 0.065),
            );
          }
        }

        function spawnZone() {
          if (!app || !zoneLayer || gameEnded || zones.length >= MAX_ZONES) {
            return;
          }
          const width = app.renderer.width;
          const height = app.renderer.height;
          const fact = getRandomFact();
          const zoneWidth = 100 + Math.random() * 200;
          const zoneHeight = 100 + Math.random() * 200;
          const color =
            ZONE_COLORS[Math.floor(Math.random() * ZONE_COLORS.length)];
          const directions = [
            { x: 1, y: 0 },
            { x: -1, y: 0 },
            { x: 0, y: 1 },
            { x: 0, y: -1 },
            { x: 1, y: 1 },
            { x: -1, y: 1 },
            { x: 1, y: -1 },
            { x: -1, y: -1 },
          ];
          const direction =
            directions[Math.floor(Math.random() * directions.length)];
          const isDiagonal = direction.x !== 0 && direction.y !== 0;
          const speed = ZONE_SPEED *
            (isDiagonal ? DIAGONAL_ZONE_SPEED_MULTIPLIER : 1);
          const length = Math.hypot(direction.x, direction.y);
          const velocityX = direction.x / length * speed;
          const velocityY = direction.y / length * speed;
          const x = direction.x > 0
            ? -zoneWidth
            : direction.x < 0
            ? width
            : WORLD_PADDING + Math.random() *
                Math.max(0, width - WORLD_PADDING * 2 - zoneWidth);
          const y = direction.y > 0
            ? -zoneHeight
            : direction.y < 0
            ? height
            : WORLD_PADDING + Math.random() *
                Math.max(0, height - WORLD_PADDING * 2 - zoneHeight);

          const body = new Graphics();
          drawZoneBody(body, zoneWidth, zoneHeight, color);
          const label = new Text({
            text: fact.text,
            style: {
              fill: darkenColor(color),
              fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
              fontSize: Math.max(14, Math.min(22, zoneWidth / 12)),
              fontWeight: "800",
              align: "center",
              wordWrap: true,
              wordWrapWidth: Math.max(72, zoneWidth - 24),
            },
          });
          label.anchor.set(0.5);
          zoneLayer.addChild(body, label);
          const zone: TriviaZone = {
            id: nextZoneId,
            body,
            label,
            x,
            y,
            width: zoneWidth,
            height: zoneHeight,
            velocityX,
            velocityY,
            isCorrect: fact.isCorrect,
          };
          nextZoneId += 1;
          zones.push(zone);
          console.info("[village:game]", {
            event: "zone_spawn",
            zoneId: zone.id,
            correct: zone.isCorrect,
          });
        }

        function removeZone(zone: TriviaZone) {
          if (!zoneLayer) return;
          zoneLayer.removeChild(zone.body, zone.label);
          zone.body.destroy();
          zone.label.destroy();
          const index = zones.indexOf(zone);
          if (index >= 0) zones.splice(index, 1);
        }

        function updateZones(deltaSeconds: number) {
          if (!app || gameEnded) return;
          elapsedSeconds += deltaSeconds;
          nextSpawnInSeconds -= deltaSeconds;
          const zoneLimit = getZoneLimit(elapsedSeconds);
          if (nextSpawnInSeconds <= 0 && zones.length < zoneLimit) {
            spawnZone();
            nextSpawnInSeconds = getSpawnInterval(elapsedSeconds);
          }

          const width = app.renderer.width;
          const height = app.renderer.height;
          for (const zone of [...zones]) {
            zone.x += zone.velocityX * deltaSeconds;
            zone.y += zone.velocityY * deltaSeconds;
            zone.body.x = zone.x;
            zone.body.y = zone.y;
            zone.label.x = zone.x + zone.width / 2;
            zone.label.y = zone.y + zone.height / 2;
            if (
              zone.x > width ||
              zone.x + zone.width < 0 ||
              zone.y > height ||
              zone.y + zone.height < 0
            ) {
              removeZone(zone);
            }
          }
        }

        function clearZones() {
          for (const zone of [...zones]) removeZone(zone);
        }
        clearZonesForCleanup = clearZones;

        function endGame(player: RenderedPlayer) {
          if (!winnerText || gameEnded) return;
          gameEnded = true;
          winnerId = player.id;
          clearZones();
          winnerText.text = `${displayLabel(String(player.label.text))} wins!`;
          winnerText.visible = true;
          console.info("[village:game]", {
            event: "game_end",
            winnerId: player.id,
            score: scoresRef.current.get(player.id) ?? 0,
          });
        }

        function scorePlayer(player: RenderedPlayer, deltaSeconds: number) {
          if (gameEnded || !connectedPlayerIdsRef.current.has(player.id)) {
            return;
          }
          const acceleration = 1 +
            elapsedSeconds * POINT_ACCELERATION_PER_SECOND;
          let velocity = 0;
          const tolerance = PLAYER_SIZE / 4 - 0.5;
          const playerLeft = player.x - PLAYER_SIZE / 2 + tolerance;
          const playerRight = player.x + PLAYER_SIZE / 2 - tolerance;
          const playerTop = player.y - PLAYER_SIZE / 2 + tolerance;
          const playerBottom = player.y + PLAYER_SIZE / 2 - tolerance;

          for (const zone of zones) {
            if (
              !rectanglesOverlap(
                playerLeft,
                playerTop,
                playerRight,
                playerBottom,
                zone.x,
                zone.y,
                zone.x + zone.width,
                zone.y + zone.height,
              )
            ) {
              continue;
            }
            velocity += zone.isCorrect
              ? CORRECT_POINTS_PER_SECOND * acceleration
              : INCORRECT_POINTS_PER_SECOND * acceleration;
          }

          if (velocity === 0) return;
          const nextScore = Math.max(
            0,
            (scoresRef.current.get(player.id) ?? 0) + velocity * deltaSeconds,
          );
          scoresRef.current.set(player.id, nextScore);
          player.scoreLabel.text = nextScore > 0
            ? `${Math.round(nextScore)}`
            : "";
          if (nextScore >= WINNING_SCORE) {
            player.scoreLabel.style.fill = "#ffd84d";
            endGame(player);
          }
        }

        function syncPlayers() {
          if (!app || !playerLayer) return;
          const activePlayerLayer = playerLayer;
          const currentPlayers = playersRef.current;
          const currentIds = new Set(currentPlayers.map((player) => player.id));

          for (const [playerId, rendered] of renderedPlayersRef.current) {
            if (currentIds.has(playerId)) continue;
            activePlayerLayer.removeChild(
              rendered.body,
              rendered.label,
              rendered.scoreLabel,
            );
            rendered.body.destroy();
            rendered.label.destroy();
            rendered.scoreLabel.destroy();
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
            const scoreLabel = new Text({
              text: "",
              style: {
                fill: "#514158",
                fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
                fontSize: 15,
                fontWeight: "900",
              },
            });
            scoreLabel.anchor.set(0.5, 0);
            activePlayerLayer.addChild(body, label, scoreLabel);
            renderedPlayersRef.current.set(player.id, {
              id: player.id,
              body,
              label,
              scoreLabel,
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

        console.info("[village:game]", {
          event: "game_start",
          players: playersRef.current.length,
        });

        app.ticker.add((ticker: Ticker) => {
          if (!app) return;
          syncPlayers();
          const deltaSeconds = ticker.deltaMS / 1000;
          updateZones(deltaSeconds);
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
            rendered.scoreLabel.x = rendered.x;
            rendered.scoreLabel.y = rendered.y + PLAYER_SIZE / 2 + 5;
            if (winnerId !== rendered.id) {
              rendered.scoreLabel.style.fill = "#514158";
            }
            scorePlayer(rendered, deltaSeconds);
          }
        });
      },
    );

    return () => {
      disposed = true;
      for (const rendered of renderedPlayersRef.current.values()) {
        rendered.body.destroy();
        rendered.label.destroy();
        rendered.scoreLabel.destroy();
      }
      clearZonesForCleanup();
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
