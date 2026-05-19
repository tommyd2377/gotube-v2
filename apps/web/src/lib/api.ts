import type { Channel, FeedResponse, SearchResult, SettingsShape, Video, WatchLaterItem } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const SYNC_KEY_STORAGE = "gotube.syncKey";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getSyncKey() {
  return localStorage.getItem(SYNC_KEY_STORAGE) ?? "";
}

export function setSyncKey(syncKey: string) {
  const trimmed = syncKey.trim();
  if (trimmed) {
    localStorage.setItem(SYNC_KEY_STORAGE, trimmed);
  } else {
    localStorage.removeItem(SYNC_KEY_STORAGE);
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}, includeSyncKey = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json");
  }

  if (includeSyncKey) {
    const syncKey = getSyncKey();
    if (syncKey) {
      headers.set("x-gotube-sync-key", syncKey);
    }
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(response.status, data?.error ?? `Request failed with ${response.status}`);
  }
  return data as T;
}

export const api = {
  health: () => apiFetch<{ ok: boolean }>("/health", {}, false),
  search: (q: string, type: "video" | "channel") =>
    apiFetch<{ results: SearchResult[] }>(
      `/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}`
    ),
  addChannel: (youtubeChannelId: string) =>
    apiFetch<{ channel: Channel }>("/channels", {
      method: "POST",
      body: JSON.stringify({ youtubeChannelId })
    }),
  listChannels: () => apiFetch<{ channels: Channel[] }>("/channels"),
  removeChannel: (youtubeChannelId: string) =>
    apiFetch<{ channel: Channel | null }>(`/channels/${encodeURIComponent(youtubeChannelId)}`, {
      method: "DELETE"
    }),
  syncChannel: (youtubeChannelId: string) =>
    apiFetch<{ channel: Channel; count?: number; skipped?: boolean; videos: Video[] }>(
      `/sync-channel/${encodeURIComponent(youtubeChannelId)}`,
      { method: "POST" }
    ),
  syncAll: (force = false) =>
    apiFetch<{ results: Array<{ channel: Channel; count?: number; skipped?: boolean; videos: Video[] }> }>(
      `/sync-all${force ? "?force=true" : ""}`,
      { method: "POST" }
    ),
  feed: (
    _settings: Pick<SettingsShape, "hideShorts" | "hideWatched">,
    options: { limit?: number; before?: string | null; channelId?: string | null } = {}
  ) => {
    const params = new URLSearchParams();
    if (options.limit) {
      params.set("limit", String(options.limit));
    }
    if (options.before) {
      params.set("before", options.before);
    }
    if (options.channelId) {
      params.set("channelId", options.channelId);
    }
    return apiFetch<FeedResponse>(`/feed?${params.toString()}`);
  },
  addWatchLater: (youtubeVideoId: string) =>
    apiFetch<{ item: { youtube_video_id: string; added_at?: string } }>("/watch-later", {
      method: "POST",
      body: JSON.stringify({ youtubeVideoId })
    }),
  watchLater: () => apiFetch<{ items: WatchLaterItem[] }>("/watch-later"),
  removeWatchLater: (youtubeVideoId: string) =>
    apiFetch<{ ok: boolean }>(`/watch-later/${encodeURIComponent(youtubeVideoId)}`, { method: "DELETE" }),
  markWatched: (youtubeVideoId: string, progressSeconds = 0, completed = true) =>
    apiFetch<{ watched: { youtube_video_id: string; watched_at?: string; progress_seconds?: number; completed?: boolean } }>("/watched", {
      method: "POST",
      body: JSON.stringify({ youtubeVideoId, progressSeconds, completed })
    }),
  watched: () => apiFetch<{ items: Array<{ youtube_video_id: string; watched_at?: string; progress_seconds?: number; completed?: boolean }> }>("/watched"),
  getSettings: () => apiFetch<{ settings: SettingsShape }>("/settings"),
  putSetting: (key: keyof SettingsShape, value: SettingsShape[keyof SettingsShape]) =>
    apiFetch<{ setting: { key: string; value: unknown } }>(`/settings/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ value })
    })
};
