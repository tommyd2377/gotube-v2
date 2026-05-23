import type { Video, WatchLaterItem } from "./types";

export const SHORTS_DURATION_SECONDS = 180;

export function isShortFormVideo(video: Pick<Video, "title" | "description" | "duration_seconds" | "is_short">) {
  if (video.is_short) {
    return true;
  }

  if (typeof video.duration_seconds === "number" && video.duration_seconds > 0 && video.duration_seconds <= SHORTS_DURATION_SECONDS) {
    return true;
  }

  const text = `${video.title} ${video.description ?? ""}`.toLowerCase();
  return text.includes("#shorts") || text.includes("youtube shorts") || text.includes("ytshorts");
}

export function markShortFormVideo(video: Video): Video {
  return isShortFormVideo(video) ? { ...video, is_short: true } : video;
}

export function visibleVideos(videos: Video[]) {
  return videos.map(markShortFormVideo).filter((video) => !isShortFormVideo(video));
}

export function visibleWatchLaterItems(items: WatchLaterItem[]) {
  return items
    .map((item) => ({ ...item, video: markShortFormVideo(item.video) }))
    .filter((item) => !isShortFormVideo(item.video));
}
