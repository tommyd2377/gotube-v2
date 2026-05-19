export type TvDirectionKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

function isVisible(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
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
      const secondary = direction === "ArrowRight" || direction === "ArrowLeft" ? Math.abs(dy) : Math.abs(dx);

      return { element, primary, secondary };
    })
    .filter((candidate) => candidate.primary > 8)
    .sort((a, b) => a.primary * 3 + a.secondary - (b.primary * 3 + b.secondary));

  const next = candidates[0]?.element;
  if (!next) {
    return false;
  }

  focusTvElement(next);
  return true;
}
