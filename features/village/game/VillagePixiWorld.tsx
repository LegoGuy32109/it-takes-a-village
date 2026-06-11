import { useEffect, useRef } from "preact/hooks";
import type { Ticker } from "pixi.js";
import { GameStartedPlayer, VillagePlayerInput } from "../shared/types.ts";

interface VillagePixiWorldProps {
  players: GameStartedPlayer[];
  connectedPlayerIds: Set<string>;
  inputsRef: { current: Map<string, VillagePlayerInput> };
  debugKeyboardPlayerId: string | null;
  onReturnToLobby: () => void;
  onBumpHit: (participantId: string, hitCount: number) => void;
  onGameResult: (winnerParticipantId: string) => void;
}

interface RenderedPlayer {
  id: string;
  body: import("pixi.js").Graphics;
  attackOverlay: import("pixi.js").Graphics;
  label: import("pixi.js").Text;
  scoreLabel: import("pixi.js").Text;
  color: number;
  isDebug: boolean;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  facingX: number;
  facingY: number;
  lastActionPressed: boolean;
  nextBumpAtMs: number;
  stunUntilMs: number;
  attackStartedAtMs: number;
  attackVisibleUntilMs: number;
  attackAngle: number;
  knockbackUntilMs: number;
  aiSeed: number;
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
const PLAYER_RADIUS = PLAYER_SIZE / 2;
const PLAYER_TOP_SPEED_PX_PER_SECOND = 250;
const PLAYER_ACCELERATION_PX_PER_SECOND_SQUARED = 1800;
const PLAYER_DRAG_PER_SECOND = 6.5;
const STUN_MOVEMENT_SCALE = 0.3;
const BUMP_COOLDOWN_MS = 1000;
const BUMP_STUN_MS = 400;
const BUMP_KNOCKBACK_PX_PER_SECOND = 1500;
const BUMP_KNOCKBACK_DRAG_PER_SECOND = 1.25;
const BUMP_KNOCKBACK_TOP_SPEED_PX_PER_SECOND = 1500;
const BUMP_KNOCKBACK_DURATION_MS = 280;
const BUMP_HIT_RADIUS = PLAYER_RADIUS * 3.25;
const BUMP_VISUAL_HIT_WINDOW_MS = 100;
const BUMP_VISUAL_FADE_MS = 150;
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
const WIN_SCREEN_DELAY_MS = 2000;
const LOBBY_RETURN_COUNTDOWN_SECONDS = 5;
const ZONE_COLORS = [
  0xffdbdb,
  0xcff1fb,
  0xd1d1f9,
  0xd6fbe4,
  0xfcfdcd,
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeVector(x: number, y: number): { x: number; y: number } {
  const length = Math.hypot(x, y);
  if (length === 0) return { x: 0, y: 0 };
  return { x: x / length, y: y / length };
}

function vectorLength(x: number, y: number): number {
  return Math.hypot(x, y);
}

function vectorDot(
  leftX: number,
  leftY: number,
  rightX: number,
  rightY: number,
): number {
  return leftX * rightX + leftY * rightY;
}

function createKeyboardInput(
  keys: Set<string>,
  actionPressed: boolean,
  seq: number,
): VillagePlayerInput {
  const moveLeft = keys.has("KeyA");
  const moveRight = keys.has("KeyD");
  const moveUp = keys.has("KeyW");
  const moveDown = keys.has("KeyS");
  let x = (moveRight ? 1 : 0) - (moveLeft ? 1 : 0);
  let y = (moveDown ? 1 : 0) - (moveUp ? 1 : 0);
  const magnitude = Math.hypot(x, y);

  if (magnitude > 1) {
    x /= magnitude;
    y /= magnitude;
  }

  return {
    x,
    y,
    action_pressed: actionPressed,
    seq,
    sentAt: Date.now(),
  };
}

function botSeed(id: string): number {
  let seed = 0;
  for (let index = 0; index < id.length; index += 1) {
    seed = (seed * 33 + id.charCodeAt(index)) >>> 0;
  }
  return seed >>> 0;
}

function getDebugBotInput(
  bot: RenderedPlayer,
  nowMs: number,
  players: RenderedPlayer[],
): { x: number; y: number; action_pressed: boolean } {
  const humanTarget = players
    .filter((player) => player.id !== bot.id && !player.isDebug)
    .map((player) => ({
      player,
      distance: vectorLength(player.x - bot.x, player.y - bot.y),
    }))
    .sort((left, right) => left.distance - right.distance)[0]?.player ?? null;

  if (!humanTarget) {
    const wobble = nowMs / 1000 + bot.aiSeed * 0.0004;
    return {
      x: Math.cos(wobble) * 0.5,
      y: Math.sin(wobble * 0.9) * 0.5,
      action_pressed: false,
    };
  }

  const toTargetX = humanTarget.x - bot.x;
  const toTargetY = humanTarget.y - bot.y;
  const distance = vectorLength(toTargetX, toTargetY);
  const direction = normalizeVector(toTargetX, toTargetY);
  const wobble = Math.sin(nowMs / 620 + bot.aiSeed * 0.0012) * 0.18;
  const strafeX = -direction.y * wobble;
  const strafeY = direction.x * wobble;
  const attackPulse = ((nowMs + bot.aiSeed * 17) % 2100) < 110;

  return {
    x: clamp((direction.x + strafeX) * 0.5, -0.5, 0.5),
    y: clamp((direction.y + strafeY) * 0.5, -0.5, 0.5),
    action_pressed: distance < 124 && attackPulse &&
      Math.abs(wobble) < 0.12 &&
      nowMs >= bot.nextBumpAtMs,
  };
}
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

function drawAttackOverlay(
  graphics: import("pixi.js").Graphics,
  color: number,
  alpha: number,
) {
  graphics.clear();
  if (alpha <= 0) {
    graphics.visible = false;
    return;
  }

  graphics.visible = true;
  graphics.alpha = alpha;
  const crescentCenterX = PLAYER_RADIUS * 1.25;
  const outerRadius = PLAYER_RADIUS * 1.7;
  const innerRadius = PLAYER_RADIUS * 1.28;
  const arcStart = -Math.PI * 0.58;
  const arcEnd = Math.PI * 0.58;

  graphics
    .arc(crescentCenterX, 0, outerRadius, arcStart, arcEnd)
    .stroke({ color: 0x525252, width: PLAYER_RADIUS * 0.5, alpha: 0.62 })
    .arc(crescentCenterX, 0, innerRadius, arcStart, arcEnd)
    .stroke({ color, width: PLAYER_RADIUS * 0.24, alpha: 0.92 })
    .arc(crescentCenterX, 0, innerRadius * 0.88, arcStart, arcEnd)
    .stroke({
      color: darkenColor(color),
      width: PLAYER_RADIUS * 0.12,
      alpha: 0.28,
    });
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
  {
    players,
    connectedPlayerIds,
    inputsRef,
    debugKeyboardPlayerId,
    onReturnToLobby,
    onBumpHit,
    onGameResult,
  }: VillagePixiWorldProps,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const keyboardKeysRef = useRef(new Set<string>());
  const keyboardActionPressedRef = useRef(false);
  const keyboardSeqRef = useRef(0);
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
    if (!debugKeyboardPlayerId) return;

    const sendKeyboardInput = () => {
      keyboardSeqRef.current += 1;
      inputsRef.current.set(
        debugKeyboardPlayerId,
        createKeyboardInput(
          keyboardKeysRef.current,
          keyboardActionPressedRef.current,
          keyboardSeqRef.current,
        ),
      );
    };

    const resetKeyboardInput = () => {
      keyboardKeysRef.current.clear();
      keyboardActionPressedRef.current = false;
      inputsRef.current.delete(debugKeyboardPlayerId);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (
        event.code !== "KeyW" && event.code !== "KeyA" &&
        event.code !== "KeyS" && event.code !== "KeyD" &&
        event.code !== "Space"
      ) {
        return;
      }
      event.preventDefault();
      if (event.code === "Space") {
        keyboardActionPressedRef.current = true;
      } else {
        keyboardKeysRef.current.add(event.code);
      }
      sendKeyboardInput();
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (
        event.code !== "KeyW" && event.code !== "KeyA" &&
        event.code !== "KeyS" && event.code !== "KeyD" &&
        event.code !== "Space"
      ) {
        return;
      }
      event.preventDefault();
      if (event.code === "Space") {
        keyboardActionPressedRef.current = false;
      } else {
        keyboardKeysRef.current.delete(event.code);
      }
      sendKeyboardInput();
    };

    const handleBlur = () => {
      resetKeyboardInput();
    };

    sendKeyboardInput();
    globalThis.addEventListener("keydown", handleKeyDown);
    globalThis.addEventListener("keyup", handleKeyUp);
    globalThis.addEventListener("blur", handleBlur);

    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
      globalThis.removeEventListener("keyup", handleKeyUp);
      globalThis.removeEventListener("blur", handleBlur);
      resetKeyboardInput();
    };
  }, [debugKeyboardPlayerId, inputsRef]);

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
    let returnText: import("pixi.js").Text | null = null;
    const zones: TriviaZone[] = [];
    let clearZonesForCleanup = () => {};
    let returnDelayTimer: number | null = null;
    let returnCountdownTimer: number | null = null;
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
        returnText = new Text({
          text: "",
          style: {
            fill: "#806d7b",
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
            fontSize: 24,
            fontWeight: "800",
            align: "center",
          },
        });
        returnText.anchor.set(0.5);
        returnText.visible = false;
        app.stage.addChild(
          background,
          zoneLayer,
          border,
          playerLayer,
          winnerText,
          returnText,
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
          if (returnText) {
            returnText.x = width / 2;
            returnText.y = height / 2 +
              Math.max(42, Math.min(72, height * 0.08));
            returnText.style.fontSize = Math.max(
              16,
              Math.min(28, width * 0.026),
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

        function startLobbyReturnCountdown() {
          if (!returnText || disposed) return;
          let secondsRemaining = LOBBY_RETURN_COUNTDOWN_SECONDS;
          returnText.text = `returning to lobby in ${secondsRemaining}...`;
          returnText.visible = true;
          returnCountdownTimer = globalThis.setInterval(() => {
            secondsRemaining -= 1;
            if (!returnText || disposed) return;
            if (secondsRemaining <= 0) {
              if (returnCountdownTimer !== null) {
                globalThis.clearInterval(returnCountdownTimer);
                returnCountdownTimer = null;
              }
              onReturnToLobby();
              return;
            }
            returnText.text = `returning to lobby in ${secondsRemaining}...`;
          }, 1000);
        }

        function endGame(player: RenderedPlayer) {
          if (!winnerText || gameEnded) return;
          gameEnded = true;
          winnerId = player.id;
          clearZones();
          onGameResult(player.id);
          winnerText.text = `${displayLabel(String(player.label.text))} wins!`;
          winnerText.visible = true;
          console.info("[village:game]", {
            event: "game_end",
            winnerId: player.id,
            score: scoresRef.current.get(player.id) ?? 0,
          });
          returnDelayTimer = globalThis.setTimeout(
            startLobbyReturnCountdown,
            WIN_SCREEN_DELAY_MS,
          );
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

        function refreshAttackOverlay(player: RenderedPlayer, nowMs: number) {
          if (nowMs >= player.attackVisibleUntilMs) {
            player.attackOverlay.visible = false;
            player.attackOverlay.alpha = 0;
            return;
          }

          const fadeStart = player.attackStartedAtMs +
            BUMP_VISUAL_HIT_WINDOW_MS;
          const alpha = nowMs <= fadeStart
            ? 1
            : 1 - (nowMs - fadeStart) / BUMP_VISUAL_FADE_MS;
          player.attackOverlay.visible = true;
          player.attackOverlay.alpha = clamp(alpha, 0, 1);
        }

        function beginBumpAttack(player: RenderedPlayer, nowMs: number) {
          if (nowMs < player.nextBumpAtMs) return;

          const direction = normalizeVector(player.facingX, player.facingY);
          const attackDirection = direction.x === 0 && direction.y === 0
            ? { x: 0, y: -1 }
            : direction;
          const hits: RenderedPlayer[] = [];

          player.nextBumpAtMs = nowMs + BUMP_COOLDOWN_MS;
          player.attackStartedAtMs = nowMs;
          player.attackVisibleUntilMs = nowMs + BUMP_VISUAL_HIT_WINDOW_MS +
            BUMP_VISUAL_FADE_MS;
          player.attackAngle = Math.atan2(attackDirection.y, attackDirection.x);
          player.attackOverlay.rotation = player.attackAngle;
          drawAttackOverlay(player.attackOverlay, player.color, 1);

          for (const target of renderedPlayersRef.current.values()) {
            if (target.id === player.id) continue;

            const offsetX = target.x - player.x;
            const offsetY = target.y - player.y;
            const distance = vectorLength(offsetX, offsetY);
            if (distance > BUMP_HIT_RADIUS + PLAYER_RADIUS) continue;

            const targetDirection = distance > 0
              ? normalizeVector(offsetX, offsetY)
              : attackDirection;
            const forwardDot = vectorDot(
              attackDirection.x,
              attackDirection.y,
              targetDirection.x,
              targetDirection.y,
            );
            if (forwardDot <= 0) continue;

            hits.push(target);
            const alignment = clamp(forwardDot, 0, 1);
            const distanceFactor = 1 - clamp(distance / BUMP_HIT_RADIUS, 0, 1);
            const lateralDirection = {
              x: targetDirection.x - attackDirection.x * forwardDot,
              y: targetDirection.y - attackDirection.y * forwardDot,
            };
            const lateralLength = vectorLength(
              lateralDirection.x,
              lateralDirection.y,
            );
            const normalizedLateral = lateralLength > 0
              ? {
                x: lateralDirection.x / lateralLength,
                y: lateralDirection.y / lateralLength,
              }
              : { x: 0, y: 0 };
            const launchSpeed = BUMP_KNOCKBACK_PX_PER_SECOND *
              (0.72 + alignment * 0.55 + distanceFactor * 0.4);
            const sidePush = (1 - alignment) * launchSpeed * 0.42;

            target.velocityX = target.velocityX * 0.2 +
              attackDirection.x * launchSpeed +
              normalizedLateral.x * sidePush;
            target.velocityY = target.velocityY * 0.2 +
              attackDirection.y * launchSpeed +
              normalizedLateral.y * sidePush;
            target.knockbackUntilMs = Math.max(
              target.knockbackUntilMs,
              nowMs + BUMP_KNOCKBACK_DURATION_MS,
            );
            target.stunUntilMs = Math.max(
              target.stunUntilMs,
              nowMs + BUMP_STUN_MS + BUMP_KNOCKBACK_DURATION_MS / 2,
            );
          }

          if (hits.length > 0) {
            onBumpHit(player.id, hits.length);
          }
        }

        function updatePlayerMotion(
          player: RenderedPlayer,
          deltaSeconds: number,
          nowMs: number,
        ) {
          const input = player.isDebug
            ? getDebugBotInput(
              player,
              nowMs,
              [...renderedPlayersRef.current.values()],
            )
            : inputsRef.current.get(player.id);
          const inputX = input?.x ?? 0;
          const inputY = input?.y ?? 0;
          const inputMagnitude = clamp(vectorLength(inputX, inputY), 0, 1);
          const inputDirection = inputMagnitude > 0
            ? normalizeVector(inputX, inputY)
            : { x: 0, y: 0 };
          const stunned = nowMs < player.stunUntilMs;
          const knockbackActive = nowMs < player.knockbackUntilMs;

          if (inputMagnitude > 0) {
            player.facingX = inputDirection.x;
            player.facingY = inputDirection.y;
          }

          if (input?.action_pressed && !player.lastActionPressed) {
            beginBumpAttack(player, nowMs);
          }
          player.lastActionPressed = Boolean(input?.action_pressed);

          if (inputMagnitude > 0) {
            const steeringScale = stunned ? STUN_MOVEMENT_SCALE : 1;
            const acceleration = PLAYER_ACCELERATION_PX_PER_SECOND_SQUARED *
              steeringScale *
              inputMagnitude;
            player.velocityX += inputDirection.x * acceleration * deltaSeconds;
            player.velocityY += inputDirection.y * acceleration * deltaSeconds;
          }

          const drag = Math.exp(
            -(knockbackActive
              ? BUMP_KNOCKBACK_DRAG_PER_SECOND
              : PLAYER_DRAG_PER_SECOND) * deltaSeconds,
          );
          player.velocityX *= drag;
          player.velocityY *= drag;

          const speed = vectorLength(player.velocityX, player.velocityY);
          const topSpeed = knockbackActive
            ? BUMP_KNOCKBACK_TOP_SPEED_PX_PER_SECOND
            : PLAYER_TOP_SPEED_PX_PER_SECOND;
          if (speed > topSpeed) {
            const clamped = topSpeed / speed;
            player.velocityX *= clamped;
            player.velocityY *= clamped;
          }

          player.x += player.velocityX * deltaSeconds;
          player.y += player.velocityY * deltaSeconds;

          const minX = WORLD_PADDING + PLAYER_RADIUS;
          const minY = WORLD_PADDING + PLAYER_RADIUS;
          const maxX = (app?.renderer.width ?? 0) - WORLD_PADDING -
            PLAYER_RADIUS;
          const maxY = (app?.renderer.height ?? 0) - WORLD_PADDING -
            PLAYER_RADIUS;

          if (player.x < minX) {
            player.x = minX;
            player.velocityX = Math.max(0, player.velocityX);
          } else if (player.x > maxX) {
            player.x = maxX;
            player.velocityX = Math.min(0, player.velocityX);
          }

          if (player.y < minY) {
            player.y = minY;
            player.velocityY = Math.max(0, player.velocityY);
          } else if (player.y > maxY) {
            player.y = maxY;
            player.velocityY = Math.min(0, player.velocityY);
          }
        }

        function resolvePlayerCollisions() {
          const players = [...renderedPlayersRef.current.values()];

          for (let pass = 0; pass < 3; pass += 1) {
            for (
              let leftIndex = 0;
              leftIndex < players.length;
              leftIndex += 1
            ) {
              const left = players[leftIndex];
              for (
                let rightIndex = leftIndex + 1;
                rightIndex < players.length;
                rightIndex += 1
              ) {
                const right = players[rightIndex];
                const deltaX = right.x - left.x;
                const deltaY = right.y - left.y;
                const overlapX = PLAYER_SIZE - Math.abs(deltaX);
                const overlapY = PLAYER_SIZE - Math.abs(deltaY);
                if (overlapX <= 0 || overlapY <= 0) continue;

                if (overlapX < overlapY) {
                  const normalX = deltaX === 0
                    ? Math.sign(left.velocityX - right.velocityX) || 1
                    : Math.sign(deltaX);
                  const separation = overlapX / 2 + 0.01;
                  left.x -= normalX * separation;
                  right.x += normalX * separation;
                  const leftVelocityX = left.velocityX;
                  left.velocityX = right.velocityX;
                  right.velocityX = leftVelocityX;
                } else {
                  const normalY = deltaY === 0
                    ? Math.sign(left.velocityY - right.velocityY) || 1
                    : Math.sign(deltaY);
                  const separation = overlapY / 2 + 0.01;
                  left.y -= normalY * separation;
                  right.y += normalY * separation;
                  const leftVelocityY = left.velocityY;
                  left.velocityY = right.velocityY;
                  right.velocityY = leftVelocityY;
                }
              }
            }
          }

          const minX = WORLD_PADDING + PLAYER_RADIUS;
          const minY = WORLD_PADDING + PLAYER_RADIUS;
          const maxX = (app?.renderer.width ?? 0) - WORLD_PADDING -
            PLAYER_RADIUS;
          const maxY = (app?.renderer.height ?? 0) - WORLD_PADDING -
            PLAYER_RADIUS;
          for (const player of players) {
            player.x = clamp(player.x, minX, maxX);
            player.y = clamp(player.y, minY, maxY);
          }
        }

        function syncPlayers(nowMs: number) {
          if (!app || !playerLayer) return;
          const activePlayerLayer = playerLayer;
          const currentPlayers = playersRef.current;
          const currentIds = new Set(currentPlayers.map((player) => player.id));

          for (const [playerId, rendered] of renderedPlayersRef.current) {
            if (currentIds.has(playerId)) continue;
            activePlayerLayer.removeChild(
              rendered.body,
              rendered.attackOverlay,
              rendered.label,
              rendered.scoreLabel,
            );
            rendered.body.destroy();
            rendered.attackOverlay.destroy();
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
                drawAttackOverlay(existing.attackOverlay, player.color, 0);
              }
              existing.isDebug = Boolean(player.isDebug);
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
            const attackOverlay = new Graphics();
            drawAttackOverlay(attackOverlay, player.color, 0);
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
            activePlayerLayer.addChild(body, attackOverlay, label, scoreLabel);
            renderedPlayersRef.current.set(player.id, {
              id: player.id,
              body,
              attackOverlay,
              label,
              scoreLabel,
              color: player.color,
              isDebug: Boolean(player.isDebug),
              x: spawn.x,
              y: spawn.y,
              velocityX: 0,
              velocityY: 0,
              facingX: 0,
              facingY: -1,
              lastActionPressed: false,
              nextBumpAtMs: 0,
              stunUntilMs: 0,
              attackStartedAtMs: 0,
              attackVisibleUntilMs: 0,
              attackAngle: -Math.PI / 2,
              knockbackUntilMs: 0,
              aiSeed: botSeed(player.id),
            });
          });

          for (const rendered of renderedPlayersRef.current.values()) {
            rendered.body.x = rendered.x;
            rendered.body.y = rendered.y;
            rendered.attackOverlay.x = rendered.x;
            rendered.attackOverlay.y = rendered.y;
            rendered.label.x = rendered.x;
            rendered.label.y = rendered.y - PLAYER_SIZE / 2 - 6;
            rendered.scoreLabel.x = rendered.x;
            rendered.scoreLabel.y = rendered.y + PLAYER_SIZE / 2 + 5;
            refreshAttackOverlay(rendered, nowMs);
          }
        }

        drawBackground();
        syncPlayers(performance.now());

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
          const nowMs = performance.now();
          syncPlayers(nowMs);
          const deltaSeconds = ticker.deltaMS / 1000;
          updateZones(deltaSeconds);
          for (const rendered of renderedPlayersRef.current.values()) {
            updatePlayerMotion(rendered, deltaSeconds, nowMs);
          }

          resolvePlayerCollisions();

          for (const rendered of renderedPlayersRef.current.values()) {
            rendered.body.x = rendered.x;
            rendered.body.y = rendered.y;
            rendered.attackOverlay.x = rendered.x;
            rendered.attackOverlay.y = rendered.y;
            rendered.label.x = rendered.x;
            rendered.label.y = rendered.y - PLAYER_SIZE / 2 - 6;
            rendered.scoreLabel.x = rendered.x;
            rendered.scoreLabel.y = rendered.y + PLAYER_SIZE / 2 + 5;
            if (winnerId !== rendered.id) {
              rendered.scoreLabel.style.fill = "#514158";
            }
            refreshAttackOverlay(rendered, nowMs);
            scorePlayer(rendered, deltaSeconds);
          }
        });
      },
    );

    return () => {
      disposed = true;
      for (const rendered of renderedPlayersRef.current.values()) {
        rendered.body.destroy();
        rendered.attackOverlay.destroy();
        rendered.label.destroy();
        rendered.scoreLabel.destroy();
      }
      clearZonesForCleanup();
      if (returnDelayTimer !== null) {
        globalThis.clearTimeout(returnDelayTimer);
      }
      if (returnCountdownTimer !== null) {
        globalThis.clearInterval(returnCountdownTimer);
      }
      renderedPlayersRef.current.clear();
      app?.destroy(true, { children: true });
      app = null;
    };
  }, [inputsRef, onReturnToLobby]);

  return (
    <div
      ref={containerRef}
      class="fixed inset-0 overflow-hidden bg-[#ffe9ee]"
    />
  );
}
