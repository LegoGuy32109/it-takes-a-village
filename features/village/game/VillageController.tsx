import { useEffect, useRef, useState } from "preact/hooks";
import { VillagePlayerInput } from "../shared/types.ts";

interface VillageControllerProps {
  name: string;
  signalStatus: string;
  connectionDetail: string;
  onInput: (input: VillagePlayerInput) => void;
  onDisconnect: () => void;
}

const JOYSTICK_RADIUS = 74;
const KNOB_RADIUS = 28;
const SEND_INTERVAL_MS = 50;

export function VillageController(
  { name, signalStatus, connectionDetail, onInput, onDisconnect }:
    VillageControllerProps,
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
    const clampedDistance = Math.min(JOYSTICK_RADIUS - KNOB_RADIUS, distance);
    const angle = Math.atan2(rawY, rawX);
    const knobX = distance > 0 ? Math.cos(angle) * clampedDistance : 0;
    const knobY = distance > 0 ? Math.sin(angle) * clampedDistance : 0;
    const normalizedDistance = clampedDistance /
      (JOYSTICK_RADIUS - KNOB_RADIUS);

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
    emitInput(true);
  }

  return (
    <main class="fixed inset-0 h-[100dvh] w-screen select-none overflow-hidden bg-[#fff7fb] text-[#514158] [touch-action:none]">
      <div class="fixed left-0 right-0 top-0 z-10 flex items-start justify-between gap-3 px-[max(1rem,env(safe-area-inset-left))] pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
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

      <div class="absolute inset-0 grid h-[100dvh] grid-cols-2 landscape:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)]">
        <section class="flex items-end justify-center pb-[max(2.5rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))] landscape:items-center landscape:pb-0">
          <div
            ref={joystickRef}
            onPointerDown={handleJoystickPointerDown}
            onPointerMove={handleJoystickPointerMove}
            onPointerUp={releaseJoystick}
            onPointerCancel={releaseJoystick}
            onLostPointerCapture={releaseJoystick}
            class="relative h-[148px] w-[148px] rounded-full border-4 border-[#cfe2ff] bg-[#eef6ff] shadow-lg [touch-action:none]"
            aria-label="Movement joystick"
          >
            <div
              class="absolute left-1/2 top-1/2 h-14 w-14 rounded-full border-4 border-[#9ebbe0] bg-[#d7e6f8] shadow"
              style={{
                transform:
                  `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
              }}
            />
          </div>
        </section>

        <section class="flex items-end justify-center pb-[max(2.5rem,env(safe-area-inset-bottom))] pr-[max(1.25rem,env(safe-area-inset-right))] landscape:items-center landscape:pb-0">
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
            class={`h-36 w-36 rounded-full border-4 text-2xl font-black shadow-lg [touch-action:none] ${
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
