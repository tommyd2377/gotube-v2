import Dexie, { type Table } from "dexie";
import type { Channel, LocalExport, SettingsShape, Video, WatchedVideo, WatchLaterItem } from "./types";
import { markShortFormVideo, SHORTS_DURATION_SECONDS, visibleWatchLaterItems } from "./videoFilter";

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
  shortsThresholdSeconds: SHORTS_DURATION_SECONDS
};

export async function getCachedSettings() {
  const rows = await db.settings.toArray();
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    settings.hideShorts = true;
    settings.hideWatched = false;
    if (row.key === "shortsThresholdSeconds" && typeof row.value === "number") {
      settings.shortsThresholdSeconds = Math.max(row.value, SHORTS_DURATION_SECONDS);
    }
  }
  return settings;
}

export async function cacheSettings(settings: SettingsShape) {
  await db.settings.bulkPut([
    { key: "hideShorts", value: true, updated_at: new Date().toISOString() },
    { key: "hideWatched", value: false, updated_at: new Date().toISOString() },
    { key: "shortsThresholdSeconds", value: Math.max(settings.shortsThresholdSeconds, SHORTS_DURATION_SECONDS), updated_at: new Date().toISOString() }
  ]);
}

export async function cacheChannels(channels: Channel[]) {
  await db.transaction("rw", [db.channels], async () => {
    await db.channels.clear();
    if (channels.length) {
      await db.channels.bulkPut(channels);
    }
  });
}

function preferNonEmptyText(preferred?: string | null, fallback?: string | null) {
  return preferred?.trim() ? preferred : fallback ?? preferred;
}

function mergeVideoMetadata(preferred: Video, fallback: Video): Video {
  const preferredHasIdentity = Boolean(preferred.youtube_channel_id && preferred.title.trim());

  return {
    ...fallback,
    ...preferred,
    youtube_channel_id: preferred.youtube_channel_id || fallback.youtube_channel_id,
    title: preferredHasIdentity ? preferred.title : fallback.title,
    description: preferredHasIdentity
      ? preferNonEmptyText(preferred.description, fallback.description)
      : preferNonEmptyText(fallback.description, preferred.description),
    thumbnail_url: preferredHasIdentity
      ? preferNonEmptyText(preferred.thumbnail_url, fallback.thumbnail_url)
      : preferNonEmptyText(fallback.thumbnail_url, preferred.thumbnail_url),
    duration_seconds: preferredHasIdentity
      ? preferred.duration_seconds ?? fallback.duration_seconds
      : fallback.duration_seconds ?? preferred.duration_seconds,
    published_at: preferredHasIdentity ? preferred.published_at ?? fallback.published_at : fallback.published_at ?? preferred.published_at,
    channel_title: preferredHasIdentity
      ? preferNonEmptyText(preferred.channel_title, fallback.channel_title)
      : preferNonEmptyText(fallback.channel_title, preferred.channel_title),
    channel_thumbnail_url: preferredHasIdentity
      ? preferNonEmptyText(preferred.channel_thumbnail_url, fallback.channel_thumbnail_url)
      : preferNonEmptyText(fallback.channel_thumbnail_url, preferred.channel_thumbnail_url),
    fetched_at: preferredHasIdentity ? preferred.fetched_at ?? fallback.fetched_at : fallback.fetched_at ?? preferred.fetched_at,
    is_short: preferredHasIdentity ? preferred.is_short ?? fallback.is_short : fallback.is_short ?? preferred.is_short
  };
}

export async function cacheVideos(videos: Video[]) {
  const markedVideos = videos.map(markShortFormVideo);
  await db.transaction("rw", [db.videos], async () => {
    const cachedVideos = await db.videos.bulkGet(markedVideos.map((video) => video.youtube_video_id));
    await db.videos.bulkPut(
      markedVideos.map((video, index) => {
        const cachedVideo = cachedVideos[index];
        return cachedVideo ? mergeVideoMetadata(video, cachedVideo) : video;
      })
    );
  });
}

export async function cacheWatchLater(items: WatchLaterItem[]) {
  return db.transaction("rw", [db.videos, db.watchLater], async () => {
    const videoIds = items.map((item) => item.youtube_video_id);
    const [cachedVideos, cachedWatchLater] = await Promise.all([
      db.videos.bulkGet(videoIds),
      db.watchLater.bulkGet(videoIds)
    ]);
    const cachedById = new Map<string, Video>();
    for (const video of cachedVideos) {
      if (video) {
        cachedById.set(video.youtube_video_id, video);
      }
    }
    for (const item of cachedWatchLater) {
      if (item) {
        const cachedVideo = cachedById.get(item.youtube_video_id);
        cachedById.set(item.youtube_video_id, cachedVideo ? mergeVideoMetadata(cachedVideo, item.video) : item.video);
      }
    }

    const mergedItems = visibleWatchLaterItems(
      items.map((item) => {
        const cachedVideo = cachedById.get(item.youtube_video_id);
        if (!cachedVideo) {
          return item;
        }

        const remoteVideo = item.video;
        return {
          ...item,
          video: mergeVideoMetadata(remoteVideo, cachedVideo)
        };
      })
    );

    if (mergedItems.length) {
      await db.videos.bulkPut(mergedItems.map((item) => item.video));
    }
    await db.watchLater.clear();
    if (mergedItems.length) {
      await db.watchLater.bulkPut(mergedItems);
    }
    return mergedItems;
  });
}

export async function cachedFeed(_settings: SettingsShape, limit?: number) {
  const channels = await db.channels.toArray();
  const channelsById = new Map(
    channels
      .filter((channel) => !channel.hidden)
      .map((channel) => [channel.youtube_channel_id, channel])
  );
  if (!channelsById.size) {
    return [];
  }

  let videosQuery = db.videos
    .orderBy("published_at")
    .reverse()
    .filter((video) => channelsById.has(video.youtube_channel_id) && !markShortFormVideo(video).is_short);
  if (typeof limit === "number") {
    videosQuery = videosQuery.limit(limit);
  }

  const videos = await videosQuery.toArray();
  const watched = await db.watchedVideos.bulkGet(videos.map((video) => video.youtube_video_id));

  return videos.map((video, index) => {
    const markedVideo = markShortFormVideo(video);
    const channel = channelsById.get(markedVideo.youtube_channel_id);
    const watchedState = watched[index];
    return {
      ...markedVideo,
      channel_title: markedVideo.channel_title ?? channel?.title,
      channel_thumbnail_url: markedVideo.channel_thumbnail_url ?? channel?.thumbnail_url ?? null,
      watched_at: watchedState?.watched_at ?? null,
      progress_seconds: watchedState?.progress_seconds ?? null,
      completed: watchedState?.completed ?? null
    };
  });
}

export async function cacheWatched(youtubeVideoId: string, progressSeconds = 0, completed = true) {
  await db.watchedVideos.put({
    youtube_video_id: youtubeVideoId,
    watched_at: new Date().toISOString(),
    progress_seconds: progressSeconds,
    completed
  });
}

export async function cacheWatchedSnapshot(items: WatchedVideo[]) {
  await db.transaction("rw", [db.watchedVideos], async () => {
    await db.watchedVideos.clear();
    if (items.length) {
      await db.watchedVideos.bulkPut(items);
    }
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
