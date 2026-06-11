import { useEffect, useRef, useState } from "preact/hooks";
import { VillagePlayerInput } from "../shared/types.ts";
import { triggerLightTap } from "../shared/haptics.ts";

interface VillageControllerProps {
  name: string;
  signalStatus: string;
  connectionDetail: string;
  backgroundColor: string;
  onInput: (input: VillagePlayerInput) => void;
  onDisconnect: () => void;
}

const KNOB_RADIUS_RATIO = 0.19;
const SEND_INTERVAL_MS = 50;

export function VillageController(
  {
    name,
    signalStatus,
    connectionDetail,
    backgroundColor,
    onInput,
    onDisconnect,
  }: VillageControllerProps,
) {
  const joystickRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const actionPointerIdRef = useRef<number | null>(null);
  const seqRef = useRef(0);
  const lastSentAtRef = useRef(0);
  const latestVectorRef = useRef({ x: 0, y: 0 });
  const actionPressedRef = useRef(false);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [actionPressed, setActionPressed] = useState(false);

  function emitInput(force = false) {
    const now = performance.now();
    if (!force && now - lastSentAtRef.current < SEND_INTERVAL_MS) return;
    lastSentAtRef.current = now;
    seqRef.current += 1;
    onInput({
      x: latestVectorRef.current.x,
      y: latestVectorRef.current.y,
      action_pressed: actionPressedRef.current,
      seq: seqRef.current,
      sentAt: Date.now(),
    });
  }

  function resetControls(force = true) {
    actionPressedRef.current = false;
    setActionPressed(false);
    actionPointerIdRef.current = null;
    resetJoystick(force);
  }

  function resetJoystick(force = true) {
    pointerIdRef.current = null;
    latestVectorRef.current = { x: 0, y: 0 };
    setKnob({ x: 0, y: 0 });
    emitInput(force);
  }

  async function requestFullscreen() {
    const root = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    try {
      if (document.fullscreenElement) return;
      if (typeof root.requestFullscreen === "function") {
        await root.requestFullscreen();
        return;
      }
      if (typeof root.webkitRequestFullscreen === "function") {
        await root.webkitRequestFullscreen();
      }
    } catch {
      // Some mobile browsers reject fullscreen requests; the controller remains usable.
    }
  }

  useEffect(() => {
    const preventDefault = (event: Event) => event.preventDefault();
    const resetAfterViewportChange = () => {
      resetControls(true);
      globalThis.scrollTo(0, 0);
    };

    document.documentElement.style.overscrollBehavior = "none";
    document.body.style.overscrollBehavior = "none";
    document.body.style.position = "fixed";
    document.body.style.inset = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";

    document.addEventListener("gesturestart", preventDefault);
    document.addEventListener("gesturechange", preventDefault);
    document.addEventListener("gestureend", preventDefault);
    document.addEventListener("touchmove", preventDefault, { passive: false });
    globalThis.addEventListener("resize", resetAfterViewportChange);
    globalThis.addEventListener("orientationchange", resetAfterViewportChange);
    globalThis.visualViewport?.addEventListener(
      "resize",
      resetAfterViewportChange,
    );

    return () => {
      document.documentElement.style.overscrollBehavior = "";
      document.body.style.overscrollBehavior = "";
      document.body.style.position = "";
      document.body.style.inset = "";
      document.body.style.width = "";
      document.body.style.overflow = "";
      document.removeEventListener("gesturestart", preventDefault);
      document.removeEventListener("gesturechange", preventDefault);
      document.removeEventListener("gestureend", preventDefault);
      document.removeEventListener("touchmove", preventDefault);
      globalThis.removeEventListener("resize", resetAfterViewportChange);
      globalThis.removeEventListener(
        "orientationchange",
        resetAfterViewportChange,
      );
      globalThis.visualViewport?.removeEventListener(
        "resize",
        resetAfterViewportChange,
      );
    };
  }, []);

  function updateJoystick(event: PointerEvent, force = false) {
    const joystick = joystickRef.current;
    if (!joystick) return;
    const bounds = joystick.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const rawX = event.clientX - centerX;
    const rawY = event.clientY - centerY;
    const distance = Math.hypot(rawX, rawY);
    const joystickRadius = Math.min(bounds.width, bounds.height) / 2;
    const knobRadius = joystickRadius * KNOB_RADIUS_RATIO;
    const clampedDistance = Math.min(joystickRadius - knobRadius, distance);
    const angle = Math.atan2(rawY, rawX);
    const knobX = distance > 0 ? Math.cos(angle) * clampedDistance : 0;
    const knobY = distance > 0 ? Math.sin(angle) * clampedDistance : 0;
    const normalizedDistance = clampedDistance / (joystickRadius - knobRadius);

    latestVectorRef.current = {
      x: distance > 0 ? Math.cos(angle) * normalizedDistance : 0,
      y: distance > 0 ? Math.sin(angle) * normalizedDistance : 0,
    };
    setKnob({ x: knobX, y: knobY });
    emitInput(force);
  }

  function handleJoystickPointerDown(event: PointerEvent) {
    event.preventDefault();
    pointerIdRef.current = event.pointerId;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    updateJoystick(event, true);
  }

  function handleJoystickPointerMove(event: PointerEvent) {
    if (pointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    updateJoystick(event);
  }

  function releaseJoystick(event: PointerEvent) {
    if (pointerIdRef.current !== event.pointerId) return;
    resetJoystick(true);
  }

  function setAction(nextPressed: boolean) {
    actionPressedRef.current = nextPressed;
    setActionPressed(nextPressed);
    if (nextPressed) {
      triggerLightTap();
    }
    emitInput(true);
  }

  return (
    <main
      class="fixed inset-0 h-[100dvh] w-screen select-none overflow-hidden text-[#514158] [touch-action:none]"
      style={{ backgroundColor }}
    >
      <div class="fixed left-0 right-0 top-0 z-10 flex items-start justify-between gap-2 px-[max(0.5rem,env(safe-area-inset-left))] pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div class="rounded-full border border-[#efd0ef] bg-white/85 px-4 py-2 text-center shadow-sm">
          <p class="text-sm font-black text-[#6d4d73]">{name || "Helper"}</p>
          <p class="text-xs font-semibold text-[#806d7b]">{signalStatus}</p>
          {connectionDetail && (
            <p class="max-w-48 text-[0.68rem] font-semibold text-[#947f91]">
              {connectionDetail}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={requestFullscreen}
          class="rounded-full border border-[#cfe2ff] bg-[#eef6ff]/95 px-4 py-3 text-sm font-black text-[#52627d] shadow-sm"
        >
          Full Screen
        </button>
        <button
          type="button"
          onClick={onDisconnect}
          class="rounded-full border border-[#f0b9ad] bg-[#ffe5df]/95 px-4 py-3 text-sm font-black text-[#875548] shadow-sm"
        >
          Disconnect
        </button>
      </div>

      <div class="pointer-events-none fixed left-1/2 top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 rounded-[1.5rem] border border-[#ffe1a8] bg-[#fff4d7]/95 px-7 py-6 text-center text-xl font-black text-[#806230] shadow-lg portrait:flex landscape:hidden">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          class="h-12 w-12"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2.4"
        >
          <path d="M20 11a8 8 0 0 0-14.2-5" />
          <path d="M6 2v4h4" />
          <path d="M4 13a8 8 0 0 0 14.2 5" />
          <path d="M18 22v-4h-4" />
        </svg>
        <span>playing horizontal recommended</span>
      </div>

      <div class="absolute inset-0 grid h-[100dvh] grid-cols-2 landscape:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)]">
        <section class="flex items-end justify-center pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] landscape:items-center landscape:pb-0">
          <div
            ref={joystickRef}
            onPointerDown={handleJoystickPointerDown}
            onPointerMove={handleJoystickPointerMove}
            onPointerUp={releaseJoystick}
            onPointerCancel={releaseJoystick}
            onLostPointerCapture={releaseJoystick}
            class="relative h-[clamp(170px,44vw,220px)] w-[clamp(170px,44vw,220px)] rounded-full border-4 border-[#cfe2ff] bg-[#eef6ff] shadow-lg [touch-action:none]"
            aria-label="Movement joystick"
          >
            <div
              class="absolute left-1/2 top-1/2 h-[38%] w-[38%] rounded-full border-4 border-[#9ebbe0] bg-[#d7e6f8] shadow"
              style={{
                transform:
                  `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
              }}
            />
          </div>
        </section>

        <section class="flex items-end justify-center pb-[max(1rem,env(safe-area-inset-bottom))] pr-[max(0.5rem,env(safe-area-inset-right))] landscape:items-center landscape:pb-0">
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              actionPointerIdRef.current = event.pointerId;
              (event.currentTarget as HTMLElement).setPointerCapture(
                event.pointerId,
              );
              setAction(true);
            }}
            onPointerUp={(event) => {
              if (actionPointerIdRef.current !== event.pointerId) return;
              event.preventDefault();
              actionPointerIdRef.current = null;
              setAction(false);
            }}
            onPointerCancel={(event) => {
              if (actionPointerIdRef.current !== event.pointerId) return;
              actionPointerIdRef.current = null;
              setAction(false);
            }}
            onLostPointerCapture={() => {
              actionPointerIdRef.current = null;
              setAction(false);
            }}
            class={`h-[clamp(170px,44vw,220px)] w-[clamp(170px,44vw,220px)] rounded-full border-4 text-3xl font-black shadow-lg [touch-action:none] ${
              actionPressed
                ? "border-[#dd9ab3] bg-[#f3ccd9] text-[#6d4d73]"
                : "border-[#ffe1a8] bg-[#fff4d7] text-[#806230]"
            }`}
          >
            Action
          </button>
        </section>
      </div>
    </main>
  );
}
