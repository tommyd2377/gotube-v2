import Dexie, { type Table } from "dexie";
import type { Channel, LocalExport, SettingsShape, Video, WatchedVideo, WatchLaterItem } from "./types";

type SettingRow = {
  key: string;
  value: unknown;
  updated_at?: string;
};

class GoTubeDb extends Dexie {
  channels!: Table<Channel, string>;
  videos!: Table<Video, string>;
  watchLater!: Table<WatchLaterItem, string>;
  watchedVideos!: Table<WatchedVideo, string>;
  settings!: Table<SettingRow, string>;

  constructor() {
    super("gotube");
    this.version(1).stores({
      channels: "youtube_channel_id, added_at, hidden",
      videos: "youtube_video_id, published_at, youtube_channel_id, is_short",
      watchLater: "youtube_video_id, added_at",
      watchedVideos: "youtube_video_id, watched_at",
      settings: "key"
    });
  }
}

export const db = new GoTubeDb();

export const DEFAULT_SETTINGS: SettingsShape = {
  hideShorts: true,
  hideWatched: false,
  shortsThresholdSeconds: 90
};

export async function getCachedSettings() {
  const rows = await db.settings.toArray();
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    settings.hideShorts = true;
    settings.hideWatched = false;
    if (row.key === "shortsThresholdSeconds" && typeof row.value === "number") {
      settings.shortsThresholdSeconds = row.value;
    }
  }
  return settings;
}

export async function cacheSettings(settings: SettingsShape) {
  await db.settings.bulkPut([
    { key: "hideShorts", value: true, updated_at: new Date().toISOString() },
    { key: "hideWatched", value: false, updated_at: new Date().toISOString() },
    { key: "shortsThresholdSeconds", value: settings.shortsThresholdSeconds, updated_at: new Date().toISOString() }
  ]);
}

export async function cacheChannels(channels: Channel[]) {
  await db.channels.bulkPut(channels);
}

export async function cacheVideos(videos: Video[]) {
  await db.videos.bulkPut(videos);
}

export async function cacheWatchLater(items: WatchLaterItem[]) {
  await db.watchLater.clear();
  await db.watchLater.bulkPut(items.filter((item) => !item.video.is_short));
}

export async function cachedFeed(_settings: SettingsShape, limit?: number) {
  const [videos, channels, watched] = await Promise.all([
    db.videos.orderBy("published_at").reverse().toArray(),
    db.channels.toArray(),
    db.watchedVideos.toArray()
  ]);
  const channelIds = new Set(channels.filter((channel) => !channel.hidden).map((channel) => channel.youtube_channel_id));
  const watchedById = new Map(watched.map((row) => [row.youtube_video_id, row]));

  const filtered = videos
    .filter((video) => channelIds.has(video.youtube_channel_id))
    .filter((video) => !video.is_short)
    .map((video) => {
      const channel = channels.find((item) => item.youtube_channel_id === video.youtube_channel_id);
      const watchedState = watchedById.get(video.youtube_video_id);
      return {
        ...video,
        channel_title: video.channel_title ?? channel?.title,
        channel_thumbnail_url: video.channel_thumbnail_url ?? channel?.thumbnail_url ?? null,
        watched_at: watchedState?.watched_at ?? null,
        progress_seconds: watchedState?.progress_seconds ?? null,
        completed: watchedState?.completed ?? null
      };
    });

  return typeof limit === "number" ? filtered.slice(0, limit) : filtered;
}

export async function cacheWatched(youtubeVideoId: string, progressSeconds = 0, completed = true) {
  await db.watchedVideos.put({
    youtube_video_id: youtubeVideoId,
    watched_at: new Date().toISOString(),
    progress_seconds: progressSeconds,
    completed
  });
}

export async function exportLocalData(): Promise<LocalExport> {
  const [channels, videos, watchLater, watchedVideos, settings] = await Promise.all([
    db.channels.toArray(),
    db.videos.toArray(),
    db.watchLater.toArray(),
    db.watchedVideos.toArray(),
    db.settings.toArray()
  ]);

  return {
    exportedAt: new Date().toISOString(),
    channels,
    videos,
    watchLater,
    watchedVideos,
    settings
  };
}

export async function importLocalData(data: Partial<LocalExport>) {
  await db.transaction("rw", [db.channels, db.videos, db.watchLater, db.watchedVideos, db.settings], async () => {
    if (Array.isArray(data.channels)) {
      await db.channels.bulkPut(data.channels);
    }
    if (Array.isArray(data.videos)) {
      await db.videos.bulkPut(data.videos);
    }
    if (Array.isArray(data.watchLater)) {
      await db.watchLater.bulkPut(data.watchLater);
    }
    if (Array.isArray(data.watchedVideos)) {
      await db.watchedVideos.bulkPut(data.watchedVideos);
    }
    if (Array.isArray(data.settings)) {
      await db.settings.bulkPut(data.settings);
    }
  });
}
