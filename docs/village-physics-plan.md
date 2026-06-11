# Village Physics Plan

## Movement

- Replace static joystick speed with a true physics model.
- Movement should feel snappy arcade-style.
- Full joystick tilt should ramp up over a few tenths of a second.
- Top speed should be slightly faster than the current movement speed.
- Keep diagonal movement normalized.
- Use moderate drag so players coast a bit, but stop quickly.

## Bump Attack

- Action button fires a one-time bump.
- Bump cooldown is 1000ms.
- Bump direction uses the last non-zero movement direction.
- If the player has not moved yet, default the facing direction upward.
- The bump should be a narrow cone.
- Target cone shape: about 60 degrees wide and about 1.5x player radius long.
- The attack should originate slightly in front of the player.
- The bump should be purely offensive and not affect territory directly.
- The bump should hit every player inside the cone.
- Each hit applies the same fixed knockback.
- The hit player gets a 400ms stun.
- During stun, movement force is reduced to 0.3x.
- During stun, the player can still aim and fire bumps.
- The bump cooldown continues running during stun.
- The hit effect is only knockback and stun, with no score penalty.
- The attack is not blocked by player-player body collisions.

## Attack Visual

- Render the bump as a small custom SVG or texture overlay attached to the
  player.
- The visual should be a gray crescent arc that wraps slightly around the front
  half of the player.
- Tint the crescent faintly with the player color.
- The crescent should be visible to everyone on the display.
- The crescent should linger briefly after the hit window ends, with about a
  150ms fade-out.

## Player Collision

- Player-player collision should use the existing square hitboxes.
- Collisions should be equal-mass and elastic.
- Existing velocity should be preserved on collision.
- Fast moving players should be able to shove other players around.
- Collisions are separate from the bump hitbox.

## Territory and Score

- Keep the current territory system unchanged.
- Score still comes from standing in the moving baby fact regions.
- Correct facts add score.
- Incorrect facts subtract score.
- Keep the current first-to-score-threshold win condition.

## Haptics

- Use `web-haptics` if available.
- If haptics are unavailable, silently no-op.
- Action press should play a light tap.
- A hit should play a short buzz.
- Winning should play a strong buzz.
- Losing should play an error buzz.
- Win/loss haptics fire immediately when the match ends.
- Only the local controller should receive win/loss haptics.

## Notes

- The game display is the primary shared view, so the bump visual does not need
  extra controller-side feedback.
- The current controller disconnect and lobby flow should remain unchanged while
  the physics system is added.
