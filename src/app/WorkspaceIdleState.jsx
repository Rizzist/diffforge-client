import { memo, useEffect, useState } from "react";
import { PlanFlame } from "./PlanFlame.jsx";
import { getRenderabilitySnapshot, subscribeToRenderability } from "./renderability.js";
import {
  AUTH_TILE_SIZE,
  ButtonAddIcon,
  PrimaryButton,
  SquareField,
  SquarePulse,
  WorkspaceIdleDetail,
  WorkspaceIdleLogo,
  WorkspaceIdlePanel,
  WorkspaceIdleSurface,
  WorkspaceIdleTitle,
} from "./appStyles";

const BRAND_NAME = "Diff Forge AI";
const AUTH_TILE_COLUMNS = 64;
const AUTH_TILE_ROWS = 24;
const AUTH_TILE_BURSTS = Array.from({ length: 156 }, (_, index) => {
  const col = (index * 9 + Math.floor(index / 4) * 5) % AUTH_TILE_COLUMNS;
  const row = (index * 7 + Math.floor(index / 6) * 4) % AUTH_TILE_ROWS;
  const delay = `${((index * 0.47) % 12).toFixed(1)}s`;
  const duration = `${(7.2 + (index % 8) * 0.48).toFixed(1)}s`;
  const peak = (0.2 + (index % 6) * 0.026).toFixed(3);

  return [col, row, delay, duration, peak];
});

// memo: the tile field is static per tone; App-level state churn (connection
// status, sync events) must not re-reconcile 156 animated spans per commit.
export const AuthSquareBackdrop = memo(function AuthSquareBackdrop({ tone = "default" } = {}) {
  const [renderable, setRenderable] = useState(() => getRenderabilitySnapshot().renderable);

  useEffect(() => {
    const unsubscribeRenderability = subscribeToRenderability((nextSnapshot) => {
      setRenderable(nextSnapshot.renderable);
    });
    setRenderable(getRenderabilitySnapshot().renderable);
    return unsubscribeRenderability;
  }, []);

  return (
    <SquareField aria-hidden="true" data-tone={tone}>
      {renderable && AUTH_TILE_BURSTS.map(([col, row, delay, duration, peak]) => (
        <SquarePulse
          key={`${col}-${row}-${delay}`}
          style={{
            "--left": `${col * AUTH_TILE_SIZE}px`,
            "--top": `${row * AUTH_TILE_SIZE}px`,
            "--delay": delay,
            "--duration": duration,
            "--peak": peak,
          }}
        />
      ))}
    </SquareField>
  );
});

export default function WorkspaceIdleState({
  actionLabel = "",
  ariaLabel = "No workspace selected",
  children = null,
  detail = "No workspace selected.",
  flameActive = true,
  onAction = null,
  plan = "",
  title = BRAND_NAME,
  viewMotion,
}) {
  return (
    <WorkspaceIdleSurface aria-label={ariaLabel} data-motion={viewMotion}>
      <AuthSquareBackdrop tone="quiet" />
      {/* The signed-in plan rendered as its pricing-page flame tier. */}
      <PlanFlame active={flameActive} plan={plan} showControls={Boolean(plan)} />
      <WorkspaceIdlePanel>
        <WorkspaceIdleLogo src="/logo.webp" alt="" />
        <WorkspaceIdleTitle>{title}</WorkspaceIdleTitle>
        {detail ? <WorkspaceIdleDetail>{detail}</WorkspaceIdleDetail> : null}
        {children || (actionLabel && typeof onAction === "function" ? (
          <PrimaryButton onClick={onAction} type="button">
            <ButtonAddIcon aria-hidden="true" />
            <span>{actionLabel}</span>
          </PrimaryButton>
        ) : null)}
      </WorkspaceIdlePanel>
    </WorkspaceIdleSurface>
  );
}
