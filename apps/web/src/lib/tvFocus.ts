export type TvDirectionKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

function isVisible(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function overlapRatio(startA: number, endA: number, startB: number, endB: number) {
  const overlap = Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
  const smallerSpan = Math.min(endA - startA, endB - startB);
  return smallerSpan > 0 ? overlap / smallerSpan : 0;
}

export function getTvFocusables(root: Document | HTMLElement = document) {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-tv-focusable='true']")).filter(
    (element) => !element.hasAttribute("disabled") && isVisible(element)
  );
}

export function focusTvElement(element: HTMLElement) {
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function focusFirstTvElement(root: Document | HTMLElement = document) {
  const first = getTvFocusables(root)[0];
  if (first) {
    focusTvElement(first);
  }
  return Boolean(first);
}

export function focusNearestTvElement(direction: TvDirectionKey, root: Document | HTMLElement = document) {
  const focusables = getTvFocusables(root);
  if (!focusables.length) {
    return false;
  }

  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const current = active && focusables.includes(active) ? active : focusables[0];
  const currentRect = current.getBoundingClientRect();
  const currentCenter = {
    x: currentRect.left + currentRect.width / 2,
    y: currentRect.top + currentRect.height / 2
  };
  const horizontalMove = direction === "ArrowRight" || direction === "ArrowLeft";

  const candidates = focusables
    .filter((element) => element !== current)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
      const dx = center.x - currentCenter.x;
      const dy = center.y - currentCenter.y;
      const primary =
        direction === "ArrowRight" ? dx : direction === "ArrowLeft" ? -dx : direction === "ArrowDown" ? dy : -dy;
      const secondary = horizontalMove ? Math.abs(dy) : Math.abs(dx);
      const laneOverlap = horizontalMove
        ? overlapRatio(currentRect.top, currentRect.bottom, rect.top, rect.bottom)
        : overlapRatio(currentRect.left, currentRect.right, rect.left, rect.right);
      const laneSlack = horizontalMove
        ? Math.max(24, Math.min(currentRect.height, rect.height) * 0.4)
        : Math.max(24, Math.min(currentRect.width, rect.width) * 0.25);
      const inLane = laneOverlap >= 0.35 || secondary <= laneSlack;

      return { element, inLane, primary, secondary };
    })
    .filter((candidate) => candidate.primary > 8);

  const laneCandidates = candidates.filter((candidate) => candidate.inLane);
  const candidatePool = laneCandidates.length ? laneCandidates : candidates;
  candidatePool.sort((a, b) => a.primary * 2 + a.secondary - (b.primary * 2 + b.secondary));

  const next = candidatePool[0]?.element;
  if (!next) {
    return false;
  }

  focusTvElement(next);
  return true;
}
