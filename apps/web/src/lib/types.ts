export interface Channel {
  id?: string;
  youtube_channel_id: string;
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  custom_url?: string | null;
  uploads_playlist_id?: string | null;
  added_at?: string;
  last_checked_at?: string | null;
  hidden?: boolean;
}

export interface Video {
  id?: string;
  youtube_video_id: string;
  youtube_channel_id: string;
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  duration_seconds?: number | null;
  published_at?: string | null;
  is_short?: boolean;
  fetched_at?: string;
  channel_title?: string;
  channel_thumbnail_url?: string | null;
  watched_at?: string | null;
  progress_seconds?: number | null;
  completed?: boolean | null;
}

export interface FeedResponse {
  videos: Video[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ChannelPageResponse {
  channel: Channel;
  count?: number;
  skipped?: boolean;
  videos: Video[];
  nextPageToken: string | null;
  hasMore: boolean;
}

export interface WatchLaterItem {
  id?: string;
  youtube_video_id: string;
  added_at?: string;
  video: Video;
}

export interface WatchedVideo {
  youtube_video_id: string;
  watched_at?: string;
  progress_seconds?: number;
  completed?: boolean;
}

export interface SettingsShape {
  hideShorts: boolean;
  hideWatched: boolean;
  shortsThresholdSeconds: number;
}

export interface SearchVideoResult {
  type: "video";
  youtube_video_id: string;
  youtube_channel_id: string;
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  channel_title?: string;
  published_at?: string | null;
}

export interface SearchChannelResult {
  type: "channel";
  youtube_channel_id: string;
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  custom_url?: string | null;
}

export type SearchResult = SearchVideoResult | SearchChannelResult;

export interface LocalExport {
  exportedAt: string;
  channels: Channel[];
  videos: Video[];
  watchLater: WatchLaterItem[];
  watchedVideos: WatchedVideo[];
  settings: Array<{ key: string; value: unknown; updated_at?: string }>;
}
