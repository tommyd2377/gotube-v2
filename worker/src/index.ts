interface Env {
  YOUTUBE_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  GOTUBE_SYNC_KEY?: string;
}

type JsonValue = boolean | number | string | null | JsonValue[] | { [key: string]: JsonValue };

interface ChannelRow {
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

interface VideoRow {
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

interface WatchLaterRow {
  id?: string;
  youtube_video_id: string;
  added_at?: string;
}

interface WatchedVideoRow {
  youtube_video_id: string;
  watched_at?: string;
  progress_seconds?: number;
  completed?: boolean;
}

interface SettingRow {
  key: string;
  value: JsonValue;
  updated_at?: string;
}

interface SettingsShape {
  hideShorts: boolean;
  hideWatched: boolean;
  shortsThresholdSeconds: number;
}

interface SearchVideoResult {
  type: "video";
  youtube_video_id: string;
  youtube_channel_id: string;
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  channel_title?: string;
  published_at?: string | null;
}

interface SearchChannelResult {
  type: "channel";
  youtube_channel_id: string;
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  custom_url?: string | null;
}

type SearchResult = SearchVideoResult | SearchChannelResult;
type ChannelLookup = { id: string } | { forHandle: string } | { forUsername: string };
type YouTubeThumbnail = { url?: string; width?: number; height?: number };
type YouTubeThumbnails = {
  default?: YouTubeThumbnail;
  medium?: YouTubeThumbnail;
  high?: YouTubeThumbnail;
  standard?: YouTubeThumbnail;
  maxres?: YouTubeThumbnail;
};
type YouTubeChannelItem = {
  id: string;
  snippet: {
    title: string;
    description?: string;
    customUrl?: string;
    thumbnails?: YouTubeThumbnails;
  };
  contentDetails?: {
    relatedPlaylists?: { uploads?: string };
  };
};
type YouTubePlaylistItemsResponse = {
  nextPageToken?: string;
  items: Array<{
    contentDetails?: { videoId?: string; videoPublishedAt?: string };
    snippet?: { publishedAt?: string };
  }>;
};

const SHORTS_DURATION_SECONDS = 180;
const DEFAULT_SETTINGS: SettingsShape = {
  hideShorts: true,
  hideWatched: false,
  shortsThresholdSeconds: SHORTS_DURATION_SECONDS
};
const DEFAULT_FEED_LIMIT = 20;
const MAX_FEED_LIMIT = 50;
const CHANNEL_PAGE_LIMIT = 10;
const MAX_CHANNEL_PAGE_LIMIT = 50;
const CHANNEL_PAGE_LOOKAHEAD_PAGES = 5;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,x-gotube-sync-key"
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...init.headers
    }
  });
}

function error(status: number, message: string) {
  return json({ error: message }, { status });
}

function expectedSyncKey(env: Env) {
  return env.GOTUBE_SYNC_KEY ?? null;
}

function authorize(request: Request, env: Env) {
  const expected = expectedSyncKey(env);
  if (!expected) {
    return error(500, "GOTUBE_SYNC_KEY is required.");
  }

  if (request.headers.get("x-gotube-sync-key") !== expected) {
    return error(401, "Missing or invalid GoTube sync key.");
  }

  return null;
}

function cleanText(value?: string | null) {
  return (value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function nowIso() {
  return new Date().toISOString();
}

function parseJsonBody<T>(request: Request) {
  return request.json<T>().catch(() => {
    throw new Error("Request body must be valid JSON.");
  });
}

function isTruthyQuery(value: string | null) {
  return value === "true" || value === "1" || value === "yes";
}

function feedLimitFromUrl(url: URL) {
  const requested = Number(url.searchParams.get("limit") ?? DEFAULT_FEED_LIMIT);
  if (!Number.isFinite(requested)) {
    return DEFAULT_FEED_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_FEED_LIMIT);
}

function channelPageLimitFromValue(value?: number | null) {
  const requested = Number(value ?? CHANNEL_PAGE_LIMIT);
  if (!Number.isFinite(requested)) {
    return CHANNEL_PAGE_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_CHANNEL_PAGE_LIMIT);
}

function feedCursorFromUrl(url: URL): { publishedAt: string; youtubeVideoId: string | null } | null {
  const before = url.searchParams.get("before");
  if (!before) {
    return null;
  }

  const [publishedAt, youtubeVideoId] = before.split("|");
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) {
    return null;
  }
  return { publishedAt, youtubeVideoId: youtubeVideoId || null };
}

function compareFeedVideos(a: VideoRow, b: VideoRow) {
  const dateSort = (b.published_at ?? "").localeCompare(a.published_at ?? "");
  if (dateSort !== 0) {
    return dateSort;
  }
  return b.youtube_video_id.localeCompare(a.youtube_video_id);
}

function isBeforeFeedCursor(video: VideoRow, cursor: { publishedAt: string; youtubeVideoId: string | null }) {
  if (!video.published_at) {
    return false;
  }
  if (video.published_at < cursor.publishedAt) {
    return true;
  }
  if (video.published_at > cursor.publishedAt || !cursor.youtubeVideoId) {
    return false;
  }
  return video.youtube_video_id < cursor.youtubeVideoId;
}

function feedCursorFromVideo(video?: VideoRow) {
  if (!video?.published_at) {
    return null;
  }
  return `${video.published_at}|${video.youtube_video_id}`;
}

function isRecentlySynced(channel: ChannelRow) {
  if (!channel.last_checked_at) {
    return false;
  }

  const elapsed = Date.now() - new Date(channel.last_checked_at).getTime();
  return elapsed < 30 * 60 * 1000;
}

function isoDurationToSeconds(duration: string) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(duration);
  if (!match) {
    return null;
  }

  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days ?? 0) * 86400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  );
}

function looksLikeShort(video: Pick<VideoRow, "title" | "description" | "duration_seconds">, threshold: number) {
  const effectiveThreshold = Math.max(threshold, SHORTS_DURATION_SECONDS);
  if (typeof video.duration_seconds === "number" && video.duration_seconds > 0 && video.duration_seconds <= effectiveThreshold) {
    return true;
  }

  const text = `${video.title} ${video.description ?? ""}`.toLowerCase();
  return text.includes("#shorts") || text.includes("youtube shorts") || text.includes("ytshorts");
}

function thumbnailsLookLikeShort(thumbnails?: YouTubeThumbnails) {
  return Object.values(thumbnails ?? {}).some((thumbnail) => {
    if (!thumbnail?.width || !thumbnail.height) {
      return false;
    }
    return thumbnail.height > thumbnail.width * 1.1;
  });
}

function isShortFormVideo(video: Pick<VideoRow, "title" | "description" | "duration_seconds" | "is_short">, threshold: number) {
  return Boolean(video.is_short) || looksLikeShort(video, threshold);
}

function withChannelInfo(video: VideoRow, channels: ChannelRow[], watched: WatchedVideoRow[] = []) {
  const channel = channels.find((item) => item.youtube_channel_id === video.youtube_channel_id);
  const watchedState = watched.find((item) => item.youtube_video_id === video.youtube_video_id);
  return {
    ...video,
    channel_title: channel?.title,
    channel_thumbnail_url: channel?.thumbnail_url ?? null,
    watched_at: watchedState?.watched_at ?? null,
    progress_seconds: watchedState?.progress_seconds ?? null,
    completed: watchedState?.completed ?? null
  };
}

function channelLookupFromInput(input: string, allowBareHandle = false): ChannelLookup | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (/^UC[\w-]{20,}$/.test(trimmed)) {
    return { id: trimmed };
  }

  if (/^@[\w.-]{3,}$/.test(trimmed)) {
    return { forHandle: trimmed };
  }

  const urlText = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /(^|\.)youtube\.com\//i.test(trimmed)
      ? `https://${trimmed}`
      : null;

  if (urlText) {
    try {
      const url = new URL(urlText);
      const host = url.hostname.replace(/^www\./, "").toLowerCase();
      if (host === "youtube.com" || host === "m.youtube.com") {
        const segments = url.pathname.split("/").filter(Boolean);
        const [first, second] = segments;
        if (first === "channel" && second && /^UC[\w-]{20,}$/.test(second)) {
          return { id: second };
        }
        if (first?.startsWith("@")) {
          return { forHandle: first };
        }
        if (first === "user" && second) {
          return { forUsername: second };
        }
      }
    } catch {
      return null;
    }
  }

  if (allowBareHandle && /^[\w.-]{3,}$/.test(trimmed)) {
    return { forHandle: trimmed };
  }

  return null;
}

function channelRowFromYouTubeItem(item: YouTubeChannelItem) {
  return {
    youtube_channel_id: item.id,
    title: cleanText(item.snippet.title),
    description: cleanText(item.snippet.description),
    thumbnail_url:
      item.snippet.thumbnails?.high?.url ??
      item.snippet.thumbnails?.medium?.url ??
      item.snippet.thumbnails?.default?.url ??
      null,
    custom_url: item.snippet.customUrl ?? null,
    uploads_playlist_id: item.contentDetails?.relatedPlaylists?.uploads ?? null,
    added_at: nowIso(),
    hidden: false
  } satisfies ChannelRow;
}

function channelSearchResultFromRow(channel: ChannelRow) {
  return {
    type: "channel",
    youtube_channel_id: channel.youtube_channel_id,
    title: channel.title,
    description: channel.description,
    thumbnail_url: channel.thumbnail_url,
    custom_url: channel.custom_url
  } satisfies SearchChannelResult;
}

async function supabaseFetch<T>(env: Env, path: string, init: RequestInit = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase is not configured.");
  }

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...init.headers
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${body}`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json<T>();
}

function restParams(params: Record<string, string>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    searchParams.set(key, value);
  }
  return searchParams.toString();
}

async function listChannels(env: Env, includeHidden = false) {
  const params: Record<string, string> = {
    select: "*",
    order: "added_at.desc"
  };
  if (!includeHidden) {
    params.hidden = "eq.false";
  }
  return supabaseFetch<ChannelRow[]>(env, `channels?${restParams(params)}`);
}

async function getChannel(env: Env, youtubeChannelId: string) {
  const rows = await supabaseFetch<ChannelRow[]>(
    env,
    `channels?${restParams({ select: "*", youtube_channel_id: `eq.${youtubeChannelId}`, limit: "1" })}`
  );
  return rows[0] ?? null;
}

async function upsertChannel(env: Env, channel: ChannelRow) {
  const row: ChannelRow = {
    ...channel,
    added_at: channel.added_at ?? nowIso(),
    hidden: channel.hidden ?? false
  };

  const rows = await supabaseFetch<ChannelRow[]>(
    env,
    "channels?on_conflict=youtube_channel_id",
    {
      method: "POST",
      headers: {
        prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(row)
    }
  );
  return rows[0];
}

async function removeChannel(env: Env, youtubeChannelId: string) {
  const rows = await supabaseFetch<ChannelRow[]>(
    env,
    `channels?${restParams({ youtube_channel_id: `eq.${youtubeChannelId}` })}`,
    {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ hidden: true })
    }
  );
  return rows[0] ?? null;
}

async function updateChannelCheckedAt(env: Env, youtubeChannelId: string) {
  const lastCheckedAt = nowIso();
  await supabaseFetch<ChannelRow[]>(
    env,
    `channels?${restParams({ youtube_channel_id: `eq.${youtubeChannelId}` })}`,
    {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ last_checked_at: lastCheckedAt })
    }
  );
}

async function listVideos(env: Env) {
  return supabaseFetch<VideoRow[]>(
    env,
    `videos?${restParams({ select: "*", order: "published_at.desc.nullslast", limit: "500" })}`
  );
}

async function upsertVideos(env: Env, videos: VideoRow[]) {
  const rows = videos.map((video) => ({
    ...video,
    fetched_at: nowIso()
  }));

  return supabaseFetch<VideoRow[]>(
    env,
    "videos?on_conflict=youtube_video_id",
    {
      method: "POST",
      headers: {
        prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(rows)
    }
  );
}

async function listWatchLater(env: Env) {
  return supabaseFetch<WatchLaterRow[]>(
    env,
    `watch_later?${restParams({ select: "*", order: "added_at.desc" })}`
  );
}

async function addWatchLater(env: Env, youtubeVideoId: string) {
  const row: WatchLaterRow = {
    youtube_video_id: youtubeVideoId,
    added_at: nowIso()
  };

  const existingVideos = await listVideos(env);
  const existingVideo = existingVideos.find((video) => video.youtube_video_id === youtubeVideoId);
  if (existingVideo && isShortFormVideo(existingVideo, DEFAULT_SETTINGS.shortsThresholdSeconds)) {
    throw new Error("Shorts are not available in GoTube.");
  }
  if (!existingVideo) {
    const video = await fetchVideoDetailsById(env, youtubeVideoId, DEFAULT_SETTINGS.shortsThresholdSeconds);
    if (video) {
      if (isShortFormVideo(video, DEFAULT_SETTINGS.shortsThresholdSeconds)) {
        throw new Error("Shorts are not available in GoTube.");
      }
      await upsertVideos(env, [video]);
    }
  }

  const rows = await supabaseFetch<WatchLaterRow[]>(
    env,
    "watch_later?on_conflict=youtube_video_id",
    {
      method: "POST",
      headers: {
        prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(row)
    }
  );
  return rows[0];
}

async function removeWatchLater(env: Env, youtubeVideoId: string) {
  await supabaseFetch<null>(
    env,
    `watch_later?${restParams({ youtube_video_id: `eq.${youtubeVideoId}` })}`,
    {
      method: "DELETE",
      headers: { prefer: "return=minimal" }
    }
  );
}

async function listWatched(env: Env) {
  return supabaseFetch<WatchedVideoRow[]>(
    env,
    `watched_videos?${restParams({ select: "*", order: "watched_at.desc" })}`
  );
}

async function markWatched(env: Env, row: WatchedVideoRow) {
  const watched: WatchedVideoRow = {
    youtube_video_id: row.youtube_video_id,
    watched_at: nowIso(),
    progress_seconds: row.progress_seconds ?? 0,
    completed: row.completed ?? true
  };

  const rows = await supabaseFetch<WatchedVideoRow[]>(
    env,
    "watched_videos?on_conflict=youtube_video_id",
    {
      method: "POST",
      headers: {
        prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(watched)
    }
  );
  return rows[0];
}

async function getSettings(env: Env) {
  const rows = await supabaseFetch<SettingRow[]>(env, `settings?${restParams({ select: "*" })}`);

  const settings: SettingsShape = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key === "shortsThresholdSeconds" && typeof row.value === "number") {
      settings.shortsThresholdSeconds = Math.max(row.value, SHORTS_DURATION_SECONDS);
    }
  }
  settings.hideShorts = true;
  settings.hideWatched = false;
  return settings;
}

async function putSetting(env: Env, key: string, value: JsonValue) {
  const row: SettingRow = {
    key,
    value,
    updated_at: nowIso()
  };

  const rows = await supabaseFetch<SettingRow[]>(
    env,
    "settings?on_conflict=key",
    {
      method: "POST",
      headers: {
        prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(row)
    }
  );
  return rows[0];
}

async function youtubeFetch<T>(env: Env, endpoint: string, params: Record<string, string>) {
  if (!env.YOUTUBE_API_KEY) {
    throw new Error("YouTube API key is not configured.");
  }

  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("key", env.YOUTUBE_API_KEY);

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`YouTube API request failed (${response.status}): ${body}`);
  }
  return response.json<T>();
}

async function searchYouTube(env: Env, q: string, type: "video" | "channel") {
  if (type === "channel") {
    const lookup = channelLookupFromInput(q, true);
    if (lookup) {
      const channel = await fetchChannelMetadata(env, q, true);
      if (channel) {
        return [channelSearchResultFromRow(channel)] satisfies SearchResult[];
      }
    }
  }

  type SearchResponse = {
    items: Array<{
      id: { videoId?: string; channelId?: string };
      snippet: {
        title: string;
        description?: string;
        channelId?: string;
        channelTitle?: string;
        publishedAt?: string;
        thumbnails?: YouTubeThumbnails;
      };
    }>;
  };

  const response = await youtubeFetch<SearchResponse>(env, "search", {
    part: "snippet",
    maxResults: "10",
    q,
    type,
    safeSearch: "strict"
  });

  const results = response.items.flatMap<SearchResult>((item) => {
    const thumbnail =
      item.snippet.thumbnails?.high?.url ??
      item.snippet.thumbnails?.medium?.url ??
      item.snippet.thumbnails?.default?.url ??
      null;

    if (type === "channel" && item.id.channelId) {
      return [
        {
          type: "channel",
          youtube_channel_id: item.id.channelId,
          title: cleanText(item.snippet.title),
          description: cleanText(item.snippet.description),
          thumbnail_url: thumbnail
        }
      ];
    }

    if (type === "video" && item.id.videoId && item.snippet.channelId) {
      return [
        {
          type: "video",
          youtube_video_id: item.id.videoId,
          youtube_channel_id: item.snippet.channelId,
          title: cleanText(item.snippet.title),
          description: cleanText(item.snippet.description),
          thumbnail_url: thumbnail,
          channel_title: cleanText(item.snippet.channelTitle),
          published_at: item.snippet.publishedAt ?? null
        }
      ];
    }

    return [];
  });

  if (type !== "video") {
    return results;
  }

  const videoIds = results
    .filter((result): result is SearchVideoResult => result.type === "video")
    .map((result) => result.youtube_video_id);
  const details = await fetchVideoDetails(env, videoIds, DEFAULT_SETTINGS.shortsThresholdSeconds);
  const detailById = new Map(details.map((video) => [video.youtube_video_id, video]));

  return results.flatMap<SearchResult>((result) => {
    if (result.type !== "video") {
      return [result];
    }

    const detail = detailById.get(result.youtube_video_id);
    if (detail && isShortFormVideo(detail, DEFAULT_SETTINGS.shortsThresholdSeconds)) {
      return [];
    }

    return [
      {
        ...result,
        description: detail?.description ?? result.description,
        thumbnail_url: detail?.thumbnail_url ?? result.thumbnail_url,
        published_at: detail?.published_at ?? result.published_at
      }
    ];
  });
}

async function fetchChannelMetadata(env: Env, channelInput: string): Promise<ChannelRow>;
async function fetchChannelMetadata(env: Env, channelInput: string, allowNotFound: true): Promise<ChannelRow | null>;
async function fetchChannelMetadata(env: Env, channelInput: string, allowNotFound = false): Promise<ChannelRow | null> {
  type ChannelsResponse = {
    items: YouTubeChannelItem[];
  };

  const lookup = channelLookupFromInput(channelInput, true) ?? { id: channelInput };
  const response = await youtubeFetch<ChannelsResponse>(env, "channels", {
    part: "snippet,contentDetails",
    ...lookup
  });

  const item = response.items[0];
  if (!item) {
    if (allowNotFound) {
      return null;
    }
    throw new Error("YouTube channel was not found.");
  }

  return channelRowFromYouTubeItem(item);
}

async function fetchVideoDetailsById(env: Env, youtubeVideoId: string, shortsThreshold: number) {
  const videos = await fetchVideoDetails(env, [youtubeVideoId], shortsThreshold);
  return videos[0] ?? null;
}

async function fetchVideoDetails(env: Env, youtubeVideoIds: string[], shortsThreshold: number) {
  if (youtubeVideoIds.length === 0) {
    return [];
  }

  type VideosResponse = {
    items: Array<{
      id: string;
      snippet: {
        channelId: string;
        title: string;
        description?: string;
        publishedAt?: string;
        thumbnails?: YouTubeThumbnails;
      };
      contentDetails?: {
        duration?: string;
      };
    }>;
  };

  const response = await youtubeFetch<VideosResponse>(env, "videos", {
    part: "snippet,contentDetails",
    id: youtubeVideoIds.join(","),
    maxResults: "50"
  });

  return response.items.map<VideoRow>((item) => {
    const durationSeconds = item.contentDetails?.duration ? isoDurationToSeconds(item.contentDetails.duration) : null;
    const thumbnails = item.snippet.thumbnails;
    const video: VideoRow = {
      youtube_video_id: item.id,
      youtube_channel_id: item.snippet.channelId,
      title: cleanText(item.snippet.title),
      description: cleanText(item.snippet.description),
      thumbnail_url:
        thumbnails?.standard?.url ??
        thumbnails?.high?.url ??
        thumbnails?.medium?.url ??
        thumbnails?.default?.url ??
        null,
      duration_seconds: durationSeconds,
      published_at: item.snippet.publishedAt ?? null,
      is_short: false
    };
    video.is_short = looksLikeShort(video, shortsThreshold) || thumbnailsLookLikeShort(thumbnails);
    return video;
  });
}

async function getChannelForPagedSync(env: Env, youtubeChannelId: string) {
  const existingChannel = await getChannel(env, youtubeChannelId);
  if (existingChannel?.uploads_playlist_id) {
    return { channel: existingChannel, saved: !existingChannel.hidden };
  }

  const metadata = await fetchChannelMetadata(env, youtubeChannelId);
  if (existingChannel && !existingChannel.hidden) {
    const channel = await upsertChannel(env, {
      ...metadata,
      id: existingChannel.id,
      added_at: existingChannel.added_at,
      hidden: existingChannel.hidden ?? false
    });
    return { channel, saved: true };
  }

  return { channel: metadata, saved: false };
}

async function fetchChannelUploadsPage(env: Env, channel: ChannelRow, pageToken: string | null, limit: number) {
  if (!channel.uploads_playlist_id) {
    throw new Error("Channel does not have an uploads playlist.");
  }

  const params: Record<string, string> = {
    part: "contentDetails,snippet",
    playlistId: channel.uploads_playlist_id,
    maxResults: String(limit)
  };
  if (pageToken) {
    params.pageToken = pageToken;
  }

  return youtubeFetch<YouTubePlaylistItemsResponse>(env, "playlistItems", params);
}

async function syncChannelPage(
  env: Env,
  youtubeChannelId: string,
  options: { pageToken?: string | null; limit?: number | null } = {}
) {
  const { channel, saved } = await getChannelForPagedSync(env, youtubeChannelId);
  const settings = await getSettings(env);
  const limit = channelPageLimitFromValue(options.limit);
  const videos: VideoRow[] = [];
  let pageToken = options.pageToken ?? null;
  let nextPageToken: string | null = null;
  let pagesFetched = 0;

  do {
    const playlist = await fetchChannelUploadsPage(env, channel, pageToken, limit);
    const ids = playlist.items
      .map((item) => item.contentDetails?.videoId)
      .filter((id): id is string => Boolean(id));
    const pageVideos = (await fetchVideoDetails(env, ids, settings.shortsThresholdSeconds)).filter(
      (video) => !isShortFormVideo(video, settings.shortsThresholdSeconds)
    );
    videos.push(...pageVideos);
    nextPageToken = playlist.nextPageToken ?? null;
    pageToken = nextPageToken;
    pagesFetched += 1;
  } while (videos.length < limit && nextPageToken && pagesFetched < CHANNEL_PAGE_LOOKAHEAD_PAGES);

  const storedVideos = videos.length ? await upsertVideos(env, videos) : [];
  if (saved) {
    await updateChannelCheckedAt(env, youtubeChannelId);
  }

  const responseChannel = (saved ? await getChannel(env, youtubeChannelId) : null) ?? channel;
  const watched = await listWatched(env);

  return {
    skipped: false,
    channel: responseChannel,
    count: storedVideos.length,
    videos: storedVideos.sort(compareFeedVideos).map((video) => withChannelInfo(video, [responseChannel], watched)),
    nextPageToken,
    hasMore: Boolean(nextPageToken)
  };
}

async function syncChannel(env: Env, youtubeChannelId: string, force = true) {
  let channel = await getChannel(env, youtubeChannelId);
  if (!channel) {
    channel = await upsertChannel(env, await fetchChannelMetadata(env, youtubeChannelId));
  }

  if (!force && isRecentlySynced(channel)) {
    return { skipped: true, reason: "Channel was synced recently.", channel, videos: [] as VideoRow[] };
  }

  const settings = await getSettings(env);
  let videos: VideoRow[];

  if (!channel.uploads_playlist_id) {
    throw new Error("Channel does not have an uploads playlist.");
  }

  const playlist = await youtubeFetch<YouTubePlaylistItemsResponse>(env, "playlistItems", {
    part: "contentDetails,snippet",
    playlistId: channel.uploads_playlist_id,
    maxResults: "25"
  });
  const ids = playlist.items
    .map((item) => item.contentDetails?.videoId)
    .filter((id): id is string => Boolean(id));
  videos = (await fetchVideoDetails(env, ids, settings.shortsThresholdSeconds)).filter(
    (video) => !isShortFormVideo(video, settings.shortsThresholdSeconds)
  );

  const storedVideos = await upsertVideos(env, videos);
  await updateChannelCheckedAt(env, youtubeChannelId);
  const updatedChannel = await getChannel(env, youtubeChannelId);

  return {
    skipped: false,
    channel: updatedChannel ?? channel,
    count: storedVideos.length,
    videos: storedVideos
  };
}

async function getFeed(env: Env, url: URL) {
  const channelId = url.searchParams.get("channelId");
  const limit = feedLimitFromUrl(url);
  const before = feedCursorFromUrl(url);

  const [channels, videos, watched] = await Promise.all([listChannels(env), listVideos(env), listWatched(env)]);
  const channelIds = new Set(channels.map((channel) => channel.youtube_channel_id));

  const filtered = videos
    .filter((video) => channelIds.has(video.youtube_channel_id))
    .filter((video) => !channelId || video.youtube_channel_id === channelId)
    .filter((video) => !isShortFormVideo(video, DEFAULT_SETTINGS.shortsThresholdSeconds))
    .filter((video) => !before || isBeforeFeedCursor(video, before))
    .sort(compareFeedVideos)
    .map((video) => withChannelInfo(video, channels, watched));
  const page = filtered.slice(0, limit);
  const lastVideo = page[page.length - 1];

  return {
    videos: page,
    nextCursor: feedCursorFromVideo(lastVideo),
    hasMore: filtered.length > limit
  };
}

async function getWatchLater(env: Env) {
  const [channels, videos, watchLater, watched] = await Promise.all([listChannels(env, true), listVideos(env), listWatchLater(env), listWatched(env)]);
  const items: Array<WatchLaterRow & { video: VideoRow }> = [];

  for (const item of watchLater) {
    const video = videos.find((candidate) => candidate.youtube_video_id === item.youtube_video_id);
    if (video) {
      if (isShortFormVideo(video, DEFAULT_SETTINGS.shortsThresholdSeconds)) {
        continue;
      }
      items.push({
        ...item,
        video: withChannelInfo(video, channels, watched)
      });
      continue;
    }

    items.push({
      ...item,
      video: {
        youtube_video_id: item.youtube_video_id,
        youtube_channel_id: "",
        title: "Saved video",
        description: null,
        thumbnail_url: null,
        duration_seconds: null,
        published_at: null,
        is_short: false
      }
    });
  }

  return items;
}

async function handleRequest(request: Request, env: Env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (url.pathname === "/api/health" && request.method === "GET") {
    return json({ ok: true });
  }

  if (!url.pathname.startsWith("/api/")) {
    return error(404, "Not found.");
  }

  const authError = authorize(request, env);
  if (authError) {
    return authError;
  }

  const segments = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [resource, id] = segments;

  if (resource === "search" && request.method === "GET") {
    const q = url.searchParams.get("q") ?? "";
    const type = url.searchParams.get("type") === "channel" ? "channel" : "video";
    return json({ results: await searchYouTube(env, q, type) });
  }

  if (resource === "channels" && request.method === "GET" && !id) {
    return json({ channels: await listChannels(env) });
  }

  if (resource === "channels" && request.method === "POST" && !id) {
    const body = await parseJsonBody<{ youtubeChannelId?: string }>(request);
    if (!body.youtubeChannelId) {
      return error(400, "youtubeChannelId is required.");
    }
    const channel = await upsertChannel(env, await fetchChannelMetadata(env, body.youtubeChannelId));
    return json({ channel });
  }

  if (resource === "channels" && request.method === "DELETE" && id) {
    return json({ channel: await removeChannel(env, decodeURIComponent(id)) });
  }

  if (resource === "sync-channel" && request.method === "POST" && id) {
    return json(await syncChannel(env, decodeURIComponent(id), true));
  }

  if (resource === "sync-channel-page" && request.method === "POST" && id) {
    const body = await parseJsonBody<{ pageToken?: string | null; limit?: number | null }>(request);
    return json(await syncChannelPage(env, decodeURIComponent(id), body));
  }

  if (resource === "sync-all" && request.method === "POST") {
    const force = isTruthyQuery(url.searchParams.get("force"));
    const channels = await listChannels(env);
    const results = [];
    for (const channel of channels) {
      results.push(await syncChannel(env, channel.youtube_channel_id, force));
    }
    return json({ results });
  }

  if (resource === "feed" && request.method === "GET") {
    return json(await getFeed(env, url));
  }

  if (resource === "watch-later" && request.method === "GET" && !id) {
    return json({ items: await getWatchLater(env) });
  }

  if (resource === "watch-later" && request.method === "POST" && !id) {
    const body = await parseJsonBody<{ youtubeVideoId?: string }>(request);
    if (!body.youtubeVideoId) {
      return error(400, "youtubeVideoId is required.");
    }
    return json({ item: await addWatchLater(env, body.youtubeVideoId) });
  }

  if (resource === "watch-later" && request.method === "DELETE" && id) {
    await removeWatchLater(env, decodeURIComponent(id));
    return json({ ok: true });
  }

  if (resource === "watched" && request.method === "POST") {
    const body = await parseJsonBody<{
      youtubeVideoId?: string;
      progressSeconds?: number;
      completed?: boolean;
    }>(request);
    if (!body.youtubeVideoId) {
      return error(400, "youtubeVideoId is required.");
    }
    return json({
      watched: await markWatched(env, {
        youtube_video_id: body.youtubeVideoId,
        progress_seconds: body.progressSeconds,
        completed: body.completed
      })
    });
  }

  if (resource === "watched" && request.method === "GET") {
    return json({ items: await listWatched(env) });
  }

  if (resource === "settings" && request.method === "GET" && !id) {
    return json({ settings: await getSettings(env) });
  }

  if (resource === "settings" && request.method === "PUT" && id) {
    const body = await parseJsonBody<{ value?: JsonValue }>(request);
    if (!Object.prototype.hasOwnProperty.call(body, "value")) {
      return error(400, "value is required.");
    }
    return json({ setting: await putSetting(env, decodeURIComponent(id), body.value ?? null) });
  }

  return error(404, "Not found.");
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unexpected server error.";
      return error(500, message);
    }
  }
} satisfies ExportedHandler<Env>;
