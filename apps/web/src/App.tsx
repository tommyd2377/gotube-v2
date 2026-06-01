import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  Clock,
  Download,
  Github,
  Globe2,
  HeartPulse,
  Linkedin,
  ListVideo,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Trash2,
  Tv,
  Twitter,
  Upload
} from "lucide-react";
import { ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LinkifiedText } from "./components/LinkifiedText";
import { PlayerOverlay } from "./components/PlayerOverlay";
import { VideoCard } from "./components/VideoCard";
import { ApiError, api, getSyncKey, setSyncKey } from "./lib/api";
import {
  cacheChannels,
  cacheSettings,
  cacheVideos,
  cacheWatchLater,
  cacheWatched,
  cachedFeed,
  db,
  DEFAULT_SETTINGS,
  exportLocalData,
  getCachedSettings,
  importLocalData
} from "./lib/db";
import { formatDateTime } from "./lib/format";
import { focusFirstTvElement, focusNearestTvElement, focusTvElement, type TvDirectionKey } from "./lib/tvFocus";
import type { Channel, SearchResult, SearchVideoResult, SettingsShape, Video, WatchedVideo, WatchLaterItem } from "./lib/types";
import { visibleVideos, visibleWatchLaterItems } from "./lib/videoFilter";

type TabId = "feed" | "watchLater" | "search" | "channels" | "settings";
type TvSection = "feed" | "watchLater" | "search" | "channels" | "channelFeed" | "settings";
type HealthState = "checking" | "ok" | "error";
type ChannelFeedTarget = Pick<Channel, "youtube_channel_id" | "title" | "description" | "thumbnail_url" | "custom_url" | "last_checked_at">;

const NOTICE_TIMEOUT_MS = 5000;
const tabs: Array<{ id: TabId; label: string; icon: typeof Rss }> = [
  { id: "feed", label: "Feed", icon: Rss },
  { id: "watchLater", label: "Watch Later", icon: Clock },
  { id: "search", label: "Search", icon: Search },
  { id: "channels", label: "Channels", icon: ListVideo },
  { id: "settings", label: "Settings", icon: Settings }
];
const FEED_PAGE_SIZE = 20;

function describeError(cause: unknown) {
  if (cause instanceof ApiError && cause.status === 401) {
    return "Enter the private sync key in Settings before using GoTube data.";
  }
  if (cause instanceof Error) {
    return cause.message;
  }
  return "Something went wrong.";
}

function videoFromSearch(result: SearchVideoResult): Video {
  return {
    youtube_video_id: result.youtube_video_id,
    youtube_channel_id: result.youtube_channel_id,
    title: result.title,
    description: result.description,
    thumbnail_url: result.thumbnail_url,
    published_at: result.published_at,
    channel_title: result.channel_title,
    is_short: false
  };
}

function cursorFromVideos(videos: Video[]) {
  const video = videos[videos.length - 1];
  return video?.published_at ? `${video.published_at}|${video.youtube_video_id}` : null;
}

function appendUniqueVideos(current: Video[], next: Video[]) {
  const visibleCurrent = visibleVideos(current);
  const seen = new Set(visibleCurrent.map((video) => video.youtube_video_id));
  return [...visibleCurrent, ...visibleVideos(next).filter((video) => !seen.has(video.youtube_video_id))];
}

function withWatchedState(video: Video, watched?: WatchedVideo): Video {
  if (!watched) {
    return video;
  }
  return {
    ...video,
    watched_at: watched.watched_at,
    progress_seconds: watched.progress_seconds,
    completed: watched.completed
  };
}

function activateRowWithKeyboard(event: ReactKeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

function useGoTubeData() {
  const [settings, setSettingsState] = useState<SettingsShape>(DEFAULT_SETTINGS);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [feed, setFeed] = useState<Video[]>([]);
  const [feedCursor, setFeedCursor] = useState<string | null>(null);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [watchLater, setWatchLater] = useState<WatchLaterItem[]>([]);
  const [watchedVideos, setWatchedVideos] = useState<WatchedVideo[]>([]);
  const [health, setHealth] = useState<HealthState>("checking");
  const [notice, setNoticeState] = useState("");
  const [noticeToken, setNoticeToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const startupSyncStartedRef = useRef(false);

  const setNotice = useCallback((message: string) => {
    setNoticeState(message);
    setNoticeToken((token) => token + 1);
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = window.setTimeout(() => setNoticeState(""), NOTICE_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [notice, noticeToken]);

  const refreshHealth = useCallback(async () => {
    try {
      await api.health();
      setHealth("ok");
    } catch {
      setHealth("error");
    }
  }, []);

  const loadCached = useCallback(async () => {
    const cachedSettings = await getCachedSettings();
    const [cachedChannels, cachedVideos, cachedWatchLater, cachedWatched] = await Promise.all([
      db.channels.toArray(),
      cachedFeed(cachedSettings, FEED_PAGE_SIZE + 1),
      db.watchLater.toArray(),
      db.watchedVideos.toArray()
    ]);
    const cachedPage = cachedVideos.slice(0, FEED_PAGE_SIZE);
    setSettingsState(cachedSettings);
    setChannels(cachedChannels.filter((channel) => !channel.hidden));
    setFeed(cachedPage);
    setFeedCursor(cursorFromVideos(cachedPage));
    setFeedHasMore(cachedVideos.length > FEED_PAGE_SIZE);
    setWatchLater(visibleWatchLaterItems(cachedWatchLater));
    setWatchedVideos(cachedWatched);
    return cachedSettings;
  }, []);

  const refreshFeed = useCallback(async (nextSettings: SettingsShape) => {
    const response = await api.feed(nextSettings, { limit: FEED_PAGE_SIZE });
    const videos = visibleVideos(response.videos);
    setFeed(videos);
    setFeedCursor(response.nextCursor);
    setFeedHasMore(response.hasMore);
    await cacheVideos(response.videos);
    return videos;
  }, []);

  const refreshRemote = useCallback(
    async (settingsOverride?: SettingsShape, silent = false, manageBusy = true) => {
      if (manageBusy) {
        setBusy(true);
      }
      try {
        const remoteSettings = await api.getSettings();
        const nextSettings = { ...(settingsOverride ?? settings), ...remoteSettings.settings };
        setSettingsState(nextSettings);
        await cacheSettings(nextSettings);

        const [channelResponse, feedResponse, watchLaterResponse, watchedResponse] = await Promise.all([
          api.listChannels(),
          api.feed(nextSettings, { limit: FEED_PAGE_SIZE }),
          api.watchLater(),
          api.watched()
        ]);
        setChannels(channelResponse.channels);
        const feedVideos = visibleVideos(feedResponse.videos);
        const watchLaterItems = visibleWatchLaterItems(watchLaterResponse.items);
        setFeed(feedVideos);
        setFeedCursor(feedResponse.nextCursor);
        setFeedHasMore(feedResponse.hasMore);
        setWatchLater(watchLaterItems);
        setWatchedVideos(watchedResponse.items);
        await Promise.all([
          cacheChannels(channelResponse.channels),
          cacheVideos(feedResponse.videos),
          cacheWatchLater(watchLaterResponse.items),
          watchedResponse.items.length ? db.watchedVideos.bulkPut(watchedResponse.items) : Promise.resolve()
        ]);
        if (!silent) {
          setNotice("Synced with GoTube backend.");
        }
        return true;
      } catch (cause) {
        if (!silent) {
          setNotice(describeError(cause));
        }
        return false;
      } finally {
        if (manageBusy) {
          setBusy(false);
        }
      }
    },
    [settings, setNotice]
  );

  const syncAllQuietly = useCallback(
    async (settingsOverride: SettingsShape) => {
      setBusy(true);
      try {
        await api.syncAll();
        await refreshRemote(settingsOverride, true, false);
      } catch {
        // Startup sync is a best-effort freshness pass; cached and backend-loaded data still render.
      } finally {
        setBusy(false);
      }
    },
    [refreshRemote]
  );

  const loadOlderFeed = useCallback(async () => {
    if (!feedCursor || loadingOlder) {
      return;
    }

    setLoadingOlder(true);
    try {
      const response = await api.feed(settings, { limit: FEED_PAGE_SIZE, before: feedCursor });
      const videos = visibleVideos(response.videos);
      setFeed((items) => appendUniqueVideos(items, videos));
      setFeedCursor(response.nextCursor);
      setFeedHasMore(response.hasMore);
      await cacheVideos(response.videos);
      if (!videos.length) {
        setNotice("No older synced videos found.");
      }
    } catch (cause) {
      setNotice(describeError(cause));
    } finally {
      setLoadingOlder(false);
    }
  }, [feedCursor, loadingOlder, settings]);

  useEffect(() => {
    if (startupSyncStartedRef.current) {
      return;
    }

    startupSyncStartedRef.current = true;
    let cancelled = false;

    void (async () => {
      const cachedSettings = await loadCached();
      if (cancelled) {
        return;
      }
      await refreshHealth();
      if (!cancelled && getSyncKey()) {
        const remoteLoaded = await refreshRemote(cachedSettings, true);
        if (!cancelled && remoteLoaded) {
          await syncAllQuietly(cachedSettings);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const updateSetting = useCallback(
    async <K extends keyof SettingsShape>(key: K, value: SettingsShape[K]) => {
      const nextSettings = { ...settings, [key]: value };
      setSettingsState(nextSettings);
      await cacheSettings(nextSettings);
      try {
        await api.putSetting(key, value);
        await refreshFeed(nextSettings);
        setNotice("Setting saved.");
      } catch (cause) {
        setNotice(getSyncKey() ? describeError(cause) : "Setting saved locally. Add a sync key to sync it.");
      }
    },
    [refreshFeed, settings]
  );

  const syncAll = useCallback(async () => {
    setBusy(true);
    try {
      const channelResponse = await api.listChannels();
      for (const channel of channelResponse.channels) {
        await api.syncChannel(channel.youtube_channel_id);
      }
      const refreshed = await refreshRemote(settings, true, false);
      setNotice(refreshed ? "Manual refresh complete." : "Manual refresh synced, but GoTube data could not reload.");
    } catch (cause) {
      setNotice(describeError(cause));
    } finally {
      setBusy(false);
    }
  }, [refreshRemote, settings]);

  const syncOne = useCallback(
    async (youtubeChannelId: string) => {
      setBusy(true);
      try {
        await api.syncChannel(youtubeChannelId);
        await refreshRemote(settings);
        setNotice("Channel synced.");
      } catch (cause) {
        setNotice(describeError(cause));
      } finally {
        setBusy(false);
      }
    },
    [refreshRemote, settings]
  );

  const addWatchLater = useCallback(
    async (video: Video) => {
      try {
        await api.addWatchLater(video.youtube_video_id);
        const response = await api.watchLater();
        setWatchLater(visibleWatchLaterItems(response.items));
        await cacheVideos([video]);
        await cacheWatchLater(response.items);
        setNotice("Added to Watch Later.");
      } catch (cause) {
        setNotice(describeError(cause));
      }
    },
    []
  );

  const removeWatchLater = useCallback(async (video: Video) => {
    try {
      await api.removeWatchLater(video.youtube_video_id);
      const response = await api.watchLater();
      setWatchLater(visibleWatchLaterItems(response.items));
      await cacheWatchLater(response.items);
      setNotice("Removed from Watch Later.");
    } catch (cause) {
      setNotice(describeError(cause));
    }
  }, []);

  const markWatched = useCallback(async (video: Video, progressSeconds = video.duration_seconds ?? 0, completed = true) => {
      try {
        const response = await api.markWatched(video.youtube_video_id, progressSeconds, completed);
        await cacheWatched(video.youtube_video_id, response.watched.progress_seconds ?? progressSeconds, response.watched.completed ?? completed);
        setWatchedVideos((items) => [
          ...items.filter((item) => item.youtube_video_id !== video.youtube_video_id),
          response.watched
        ]);
        setFeed((items) =>
          items.map((item) =>
            item.youtube_video_id === video.youtube_video_id
              ? {
                  ...item,
                  watched_at: response.watched.watched_at,
                  progress_seconds: response.watched.progress_seconds,
                  completed: response.watched.completed
                }
              : item
          )
        );
        setNotice(completed ? "Marked watched." : "Progress saved.");
      } catch (cause) {
        setNotice(describeError(cause));
      }
  }, []);

  const saveProgress = useCallback(async (video: Video, progressSeconds: number, completed = false) => {
    try {
      const response = await api.markWatched(video.youtube_video_id, progressSeconds, completed);
      await cacheWatched(video.youtube_video_id, response.watched.progress_seconds ?? progressSeconds, response.watched.completed ?? completed);
      setWatchedVideos((items) => [
        ...items.filter((item) => item.youtube_video_id !== video.youtube_video_id),
        response.watched
      ]);
      setFeed((items) =>
        items.map((item) =>
          item.youtube_video_id === video.youtube_video_id
            ? {
                ...item,
                watched_at: response.watched.watched_at,
                progress_seconds: response.watched.progress_seconds,
                completed: response.watched.completed
              }
            : item
        )
      );
    } catch {
      await cacheWatched(video.youtube_video_id, progressSeconds, completed);
    }
  }, []);

  return {
    settings,
    channels,
    feed,
    feedHasMore,
    loadingOlder,
    watchLater,
    watchedVideos,
    health,
    notice,
    busy,
    setNotice,
    refreshHealth,
    refreshRemote,
    loadOlderFeed,
    updateSetting,
    syncAll,
    syncOne,
    addWatchLater,
    removeWatchLater,
    markWatched,
    saveProgress
  };
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="emptyState">
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function PersonalFooter({ tvMode = false }: { tvMode?: boolean }) {
  const links = [
    { href: "https://thomasdevito.me/", label: "Thomas DeVito website", icon: Globe2 },
    { href: "https://x.com/thomasfdevito", label: "Thomas DeVito on X", icon: Twitter },
    { href: "https://t.me/doubting_tom", label: "Thomas DeVito on Telegram", icon: Send },
    { href: "https://www.linkedin.com/in/tdevito", label: "Thomas DeVito on LinkedIn", icon: Linkedin },
    { href: "https://github.com/tommyd2377", label: "Thomas DeVito on GitHub", icon: Github }
  ];

  return (
    <footer className={tvMode ? "personalFooter tvPersonalFooter" : "personalFooter"}>
      <p>Presented by Thomas DeVito</p>
      <div className="personalFooterLinks">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" aria-label={link.label}>
              <Icon aria-hidden="true" />
            </a>
          );
        })}
      </div>
      <div className="madeInNyc">
        Made with <span aria-hidden="true">&hearts;</span> in NYC
      </div>
    </footer>
  );
}

type TvKeyboardTarget = "search" | "syncKey";

const tvKeyboardRows = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
  ["-", "_", ".", "@", "/", ":", "+", "=", "#", "!", "?", "&"]
];

function TvKeyboardOverlay({
  title,
  value,
  password = false,
  onChange,
  onClose
}: {
  title: string;
  value: string;
  password?: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [shift, setShift] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const displayValue = password && !showPassword ? "•".repeat(value.length) : value;

  useEffect(() => {
    window.setTimeout(() => {
      if (rootRef.current) {
        focusFirstTvElement(rootRef.current);
      }
    }, 50);
  }, []);

  function addCharacter(character: string) {
    onChange(`${value}${character}`);
  }

  return (
    <div className="tvKeyboardBackdrop">
      <div className="tvKeyboardOverlay" ref={rootRef} role="dialog" aria-label={title}>
        <div className="tvKeyboardHeader">
          <div>
            <p className="eyebrow">{title}</p>
            <div className="tvKeyboardValue" aria-label={title}>
              {displayValue || <span>{password ? "Sync key" : "Search"}</span>}
            </div>
          </div>
          <button className="secondaryButton" type="button" onClick={onClose} data-tv-focusable="true">
            Done
          </button>
        </div>

        <div className="tvKeyboardRows">
          {tvKeyboardRows.map((row) => (
            <div className="tvKeyboardRow" key={row.join("")}>
              {row.map((key) => {
                const character = shift && /^[a-z]$/.test(key) ? key.toUpperCase() : key;
                return (
                  <button
                    className="tvKeyboardKey"
                    key={key}
                    type="button"
                    onClick={() => addCharacter(character)}
                    data-tv-focusable="true"
                  >
                    {character}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="tvKeyboardRow tvKeyboardActions">
            <button className={shift ? "tvKeyboardKey active" : "tvKeyboardKey"} type="button" onClick={() => setShift((value) => !value)} data-tv-focusable="true">
              Shift
            </button>
            <button className="tvKeyboardKey wide" type="button" onClick={() => addCharacter(" ")} data-tv-focusable="true">
              Space
            </button>
            <button className="tvKeyboardKey" type="button" onClick={() => onChange(value.slice(0, -1))} data-tv-focusable="true">
              Delete
            </button>
            <button className="tvKeyboardKey" type="button" onClick={() => onChange("")} data-tv-focusable="true">
              Clear
            </button>
            {password ? (
              <button className="tvKeyboardKey" type="button" onClick={() => setShowPassword((value) => !value)} data-tv-focusable="true">
                {showPassword ? "Hide" : "Show"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function DesktopApp() {
  const data = useGoTubeData();
  const [activeTab, setActiveTab] = useState<TabId>("feed");
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [searchType, setSearchType] = useState<"video" | "channel">("video");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [addingChannelId, setAddingChannelId] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<ChannelFeedTarget | null>(null);
  const [channelFeed, setChannelFeed] = useState<Video[]>([]);
  const [channelFeedCursor, setChannelFeedCursor] = useState<string | null>(null);
  const [channelFeedHasMore, setChannelFeedHasMore] = useState(false);
  const [channelFeedLoading, setChannelFeedLoading] = useState(false);
  const [bulkImportDraft, setBulkImportDraft] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [syncKeyDraft, setSyncKeyDraft] = useState(getSyncKey());
  const watchLaterVideos = useMemo(() => data.watchLater.map((item) => item.video), [data.watchLater]);
  const watchedById = useMemo(
    () => new Map(data.watchedVideos.map((item) => [item.youtube_video_id, item])),
    [data.watchedVideos]
  );
  const selectedChannelSaved = useMemo(
    () => Boolean(selectedChannel && data.channels.some((channel) => channel.youtube_channel_id === selectedChannel.youtube_channel_id)),
    [data.channels, selectedChannel]
  );

  useEffect(() => {
    function onScroll() {
      setShowBackToTop(window.scrollY > 420);
    }

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function playVideo(video: Video) {
    setSelectedVideo(withWatchedState(video, watchedById.get(video.youtube_video_id)));
  }

  async function loadChannelFeed(channel: ChannelFeedTarget, before: string | null = null) {
    setChannelFeedLoading(true);
    try {
      const response = await api.feed(data.settings, {
        limit: FEED_PAGE_SIZE,
        before,
        channelId: channel.youtube_channel_id
      });
      const videos = visibleVideos(response.videos);
      setChannelFeed((items) => (before ? appendUniqueVideos(items, videos) : videos));
      setChannelFeedCursor(response.nextCursor);
      setChannelFeedHasMore(response.hasMore);
      await cacheVideos(response.videos);
      if (!videos.length && !before) {
        data.setNotice("No synced videos for this channel yet. Add or sync it to build this channel feed.");
      }
    } catch (cause) {
      data.setNotice(describeError(cause));
    } finally {
      setChannelFeedLoading(false);
    }
  }

  async function openChannelFeed(channel: ChannelFeedTarget) {
    setActiveTab("feed");
    setSelectedChannel(channel);
    setChannelFeed([]);
    setChannelFeedCursor(null);
    setChannelFeedHasMore(false);
    await loadChannelFeed(channel);
  }

  async function openVideoChannel(video: Video) {
    const savedChannel = data.channels.find((channel) => channel.youtube_channel_id === video.youtube_channel_id);
    setSelectedVideo(null);
    await openChannelFeed(
      savedChannel ?? {
        youtube_channel_id: video.youtube_channel_id,
        title: video.channel_title ?? "Saved channel",
        description: null,
        thumbnail_url: video.channel_thumbnail_url ?? null,
        custom_url: null,
        last_checked_at: null
      }
    );
  }

  function returnToMainFeed() {
    setSelectedChannel(null);
    setChannelFeed([]);
    setChannelFeedCursor(null);
    setChannelFeedHasMore(false);
  }

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) {
      setResults([]);
      return;
    }

    try {
      const response = await api.search(query.trim(), searchType);
      setResults(response.results);
      data.setNotice("Search complete.");
    } catch (cause) {
      data.setNotice(describeError(cause));
    }
  }

  async function addChannel(youtubeChannelId: string) {
    setAddingChannelId(youtubeChannelId);
    try {
      await api.addChannel(youtubeChannelId);
      await api.syncChannel(youtubeChannelId);
      await data.refreshRemote(data.settings);
      if (selectedChannel?.youtube_channel_id === youtubeChannelId) {
        await loadChannelFeed(selectedChannel);
      }
      data.setNotice("Channel added and synced.");
    } catch (cause) {
      data.setNotice(describeError(cause));
    } finally {
      setAddingChannelId(null);
    }
  }

  async function removeChannel(youtubeChannelId: string) {
    try {
      await api.removeChannel(youtubeChannelId);
      await data.refreshRemote(data.settings);
      if (selectedChannel?.youtube_channel_id === youtubeChannelId) {
        returnToMainFeed();
      }
      data.setNotice("Channel removed from GoTube.");
    } catch (cause) {
      data.setNotice(describeError(cause));
    }
  }

  async function bulkImportChannels() {
    const entries = Array.from(
      new Set(
        bulkImportDraft
          .split(/[\n,]+/)
          .map((entry) => entry.trim())
          .filter(Boolean)
      )
    );

    if (!entries.length) {
      data.setNotice("Paste at least one channel @handle or URL to import.");
      return;
    }

    setBulkImporting(true);
    const failed: string[] = [];
    let imported = 0;

    for (const entry of entries) {
      try {
        const response = await api.search(entry, "channel");
        const channel = response.results.find((result) => result.type === "channel");
        if (!channel) {
          throw new Error("No channel result found.");
        }
        await api.addChannel(channel.youtube_channel_id);
        await api.syncChannel(channel.youtube_channel_id);
        imported += 1;
        data.setNotice(`Imported ${imported}/${entries.length}: ${channel.title}`);
      } catch {
        failed.push(entry);
      }
    }

    await data.refreshRemote(data.settings, true);
    setBulkImporting(false);
    setBulkImportDraft("");
    data.setNotice(
      failed.length
        ? `Imported ${imported}/${entries.length} channels. Failed: ${failed.join(", ")}`
        : `Imported ${imported} channels.`
    );
  }

  async function saveSyncKey(event: FormEvent) {
    event.preventDefault();
    setSyncKey(syncKeyDraft);
    await data.refreshRemote(data.settings);
  }

  async function exportData() {
    const payload = await exportLocalData();
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `gotube-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const text = await file.text();
    await importLocalData(JSON.parse(text));
    await data.refreshRemote(data.settings);
    data.setNotice("Local data imported.");
    event.target.value = "";
  }

  return (
    <div className="appShell">
      <header className="appHeader">
        <button
          className="brandHomeButton"
          type="button"
          onClick={() => {
            setActiveTab("feed");
            returnToMainFeed();
          }}
          aria-label="Go to Feed"
        >
          <div className="brandMark">
            <img className="brandMarkImage" src="/brand/gotube-icon.svg" alt="" aria-hidden="true" />
          </div>
          <div>
            <h1>GoTube</h1>
            <p>Intentional YouTube, private subscriptions, no recommendations.</p>
          </div>
        </button>
        <a className="tvLink" href="/tv">
          <Tv aria-hidden="true" />
          TV
        </a>
      </header>

      <nav className="tabBar" aria-label="GoTube sections">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={activeTab === tab.id && (tab.id !== "feed" || !selectedChannel) ? "tab active" : "tab"}
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id === "feed") {
                  returnToMainFeed();
                }
              }}
            >
              <Icon aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {data.notice ? <div className="notice" role="status">{data.notice}</div> : null}

      <main className="content">
        {activeTab === "feed" ? (
          <section>
            <div className="sectionHeader">
              <div>
                {selectedChannel ? (
                  <button className="backLinkButton" type="button" onClick={returnToMainFeed}>
                    <ArrowLeft aria-hidden="true" />
                    All Feed
                  </button>
                ) : null}
                <h2>{selectedChannel ? selectedChannel.title : "Feed"}</h2>
                <p>
                  {selectedChannel
                    ? "Reverse-chronological uploads from this channel only."
                    : "Reverse-chronological uploads from your saved channels only. GoTube shows 20 at a time."}
                </p>
              </div>
              {selectedChannel ? (
                <div className="buttonRow sectionActions">
                  {selectedChannelSaved ? (
                    <button
                      className="primaryButton"
                      onClick={async () => {
                        await data.syncOne(selectedChannel.youtube_channel_id);
                        await loadChannelFeed(selectedChannel);
                      }}
                      disabled={data.busy || channelFeedLoading}
                    >
                      <RefreshCw aria-hidden="true" />
                      Sync Channel
                    </button>
                  ) : (
                    <button
                      className="primaryButton"
                      onClick={() => addChannel(selectedChannel.youtube_channel_id)}
                      disabled={addingChannelId !== null}
                    >
                      {addingChannelId === selectedChannel.youtube_channel_id ? (
                        <RefreshCw className="spinIcon" aria-hidden="true" />
                      ) : (
                        <Plus aria-hidden="true" />
                      )}
                      {addingChannelId === selectedChannel.youtube_channel_id ? "Adding" : "Add Channel"}
                    </button>
                  )}
                </div>
              ) : (
                <button className="primaryButton" onClick={() => void data.syncAll()} disabled={data.busy} aria-busy={data.busy}>
                  <RefreshCw className={data.busy ? "spinIcon" : undefined} aria-hidden="true" />
                  {data.busy ? "Refreshing" : "Manual Refresh"}
                </button>
              )}
            </div>
            {(selectedChannel ? channelFeed : data.feed).length ? (
              <>
                <div className="videoGrid">
                  {(selectedChannel ? channelFeed : data.feed).map((video) => (
                    <VideoCard
                      key={video.youtube_video_id}
                      video={video}
                      watched={watchedById.get(video.youtube_video_id)}
                      onPlay={playVideo}
                      onChannelOpen={openVideoChannel}
                      onWatchLater={data.addWatchLater}
                      onMarkWatched={data.markWatched}
                    />
                  ))}
                </div>
                {selectedChannel ? (
                  channelFeedHasMore ? (
                    <div className="loadMoreRow">
                      <button
                        className="secondaryButton"
                        onClick={() => selectedChannel && loadChannelFeed(selectedChannel, channelFeedCursor)}
                        disabled={channelFeedLoading || data.busy}
                      >
                        <ChevronDown aria-hidden="true" />
                        {channelFeedLoading ? "Loading Older" : "Load Older"}
                      </button>
                    </div>
                  ) : null
                ) : data.feedHasMore ? (
                  <div className="loadMoreRow">
                    <button className="secondaryButton" onClick={data.loadOlderFeed} disabled={data.loadingOlder || data.busy}>
                      <ChevronDown aria-hidden="true" />
                      {data.loadingOlder ? "Loading Older" : "Load Older"}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <EmptyState
                title={selectedChannel ? "No synced videos for this channel" : "No feed videos yet"}
                body={
                  selectedChannel
                    ? "Add or sync this channel to load its latest uploads into GoTube."
                    : "Add a channel in Search or Channels, then sync it to build your private feed."
                }
              />
            )}
          </section>
        ) : null}

        {activeTab === "watchLater" ? (
          <section>
            <div className="sectionHeader">
              <div>
                <h2>Watch Later</h2>
                <p>Your GoTube queue, stored outside YouTube account data.</p>
              </div>
            </div>
            {watchLaterVideos.length ? (
              <div className="videoGrid">
                {watchLaterVideos.map((video) => (
                  <VideoCard
                    key={video.youtube_video_id}
                    video={video}
                    watched={watchedById.get(video.youtube_video_id)}
                    onPlay={playVideo}
                    onChannelOpen={openVideoChannel}
                    onRemove={data.removeWatchLater}
                    onMarkWatched={data.markWatched}
                    showRemove
                  />
                ))}
              </div>
            ) : (
              <EmptyState title="Nothing saved" body="Use Search or Feed to add videos to Watch Later." />
            )}
          </section>
        ) : null}

        {activeTab === "search" ? (
          <section>
            <div className="sectionHeader">
              <div>
                <h2>Search</h2>
                <p>Search only runs when you submit. For exact channel adds, paste a YouTube channel URL or @handle.</p>
              </div>
            </div>
            <form className="searchForm" onSubmit={onSearch}>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchType === "channel" ? "Channel name, @handle, or URL" : "Search intentionally"}
              />
              <div className="segmentedControl" aria-label="Search type">
                <button type="button" className={searchType === "video" ? "active" : ""} onClick={() => setSearchType("video")}>
                  Videos
                </button>
                <button type="button" className={searchType === "channel" ? "active" : ""} onClick={() => setSearchType("channel")}>
                  Channels
                </button>
              </div>
              <button className="primaryButton" type="submit">
                <Search aria-hidden="true" />
                Search
              </button>
            </form>
            <div className="resultList">
              {results.map((result) =>
                result.type === "channel" ? (
                  <article
                    className="channelRow channelRowClickable"
                    key={result.youtube_channel_id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openChannelFeed(result)}
                    onKeyDown={(event) => activateRowWithKeyboard(event, () => openChannelFeed(result))}
                  >
                    {result.thumbnail_url ? <img src={result.thumbnail_url} alt="" /> : <div className="avatarFallback">GT</div>}
                    <div className="channelCopy">
                      <h3>{result.title}</h3>
                      <p>
                        <LinkifiedText text={result.description} />
                      </p>
                      <span>{result.custom_url}</span>
                    </div>
                    <button
                      className="primaryButton"
                      onClick={(event) => {
                        event.stopPropagation();
                        void addChannel(result.youtube_channel_id);
                      }}
                      disabled={addingChannelId !== null}
                    >
                      {addingChannelId === result.youtube_channel_id ? (
                        <RefreshCw className="spinIcon" aria-hidden="true" />
                      ) : (
                        <Plus aria-hidden="true" />
                      )}
                      {addingChannelId === result.youtube_channel_id ? "Adding" : "Add Channel"}
                    </button>
                  </article>
                ) : (
                  <VideoCard
                    key={result.youtube_video_id}
                    video={videoFromSearch(result)}
                    watched={watchedById.get(result.youtube_video_id)}
                    onPlay={playVideo}
                    onWatchLater={data.addWatchLater}
                  />
                )
              )}
            </div>
          </section>
        ) : null}

        {activeTab === "channels" ? (
          <section>
            <div className="sectionHeader">
              <div>
                <h2>Channels</h2>
                <p>Your private subscription list. Removed channels are excluded from the feed.</p>
              </div>
            </div>
            <div className="importPanel">
              <div>
                <h3>Import channels</h3>
                <p>Paste YouTube @handles or channel URLs, one per line. GoTube adds and syncs them one at a time.</p>
              </div>
              <textarea
                value={bulkImportDraft}
                onChange={(event) => setBulkImportDraft(event.target.value)}
                placeholder="@channelhandle&#10;https://www.youtube.com/@example"
                rows={4}
              />
              <button className="primaryButton" onClick={bulkImportChannels} disabled={bulkImporting || data.busy}>
                {bulkImporting ? <RefreshCw className="spinIcon" aria-hidden="true" /> : <Upload aria-hidden="true" />}
                {bulkImporting ? "Importing" : "Import Channels"}
              </button>
            </div>
            {data.channels.length ? (
              <div className="channelList">
                {data.channels.map((channel) => (
                  <article
                    className="channelRow channelRowClickable"
                    key={channel.youtube_channel_id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openChannelFeed(channel)}
                    onKeyDown={(event) => activateRowWithKeyboard(event, () => openChannelFeed(channel))}
                  >
                    {channel.thumbnail_url ? <img src={channel.thumbnail_url} alt="" /> : <div className="avatarFallback">GT</div>}
                    <div className="channelCopy">
                      <h3>{channel.title}</h3>
                      <p>
                        <LinkifiedText text={channel.description} />
                      </p>
                      <span>Last synced: {formatDateTime(channel.last_checked_at)}</span>
                    </div>
                    <div className="buttonRow">
                      <button
                        className="secondaryButton"
                        onClick={(event) => {
                          event.stopPropagation();
                          void data.syncOne(channel.youtube_channel_id);
                        }}
                      >
                        <RefreshCw aria-hidden="true" />
                        Sync
                      </button>
                      <button
                        className="dangerButton"
                        onClick={(event) => {
                          event.stopPropagation();
                          void removeChannel(channel.youtube_channel_id);
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                        Remove
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="No channels saved" body="Use Search to add channels to your GoTube subscription list." />
            )}
          </section>
        ) : null}

        {activeTab === "settings" ? (
          <section>
            <div className="sectionHeader">
              <div>
                <h2>Settings</h2>
                <p>GoTube is intentionally recommendation-free and stores its own subscriptions, queue, and watched state.</p>
              </div>
            </div>
            <div className="settingsGrid">
              <form className="settingsPanel" onSubmit={saveSyncKey}>
                <h3>Private Sync Key</h3>
                <input
                  type="password"
                  value={syncKeyDraft}
                  onChange={(event) => setSyncKeyDraft(event.target.value)}
                  placeholder="Enter GOTUBE_SYNC_KEY"
                />
                <button className="primaryButton" type="submit">
                  <Check aria-hidden="true" />
                  Save Key
                </button>
              </form>

              <div className="settingsPanel">
                <h3>Playback Memory</h3>
                <p>
                  Shorts are always hidden in GoTube. Watched videos stay in your feed with a watched or resume marker, and playback
                  progress is saved to GoTube's own database.
                </p>
              </div>

              <div className="settingsPanel">
                <h3>Local Data</h3>
                <div className="buttonRow">
                  <button className="secondaryButton" onClick={exportData}>
                    <Download aria-hidden="true" />
                    Export JSON
                  </button>
                  <label className="fileButton">
                    <Upload aria-hidden="true" />
                    Import JSON
                    <input type="file" accept="application/json" onChange={importData} />
                  </label>
                </div>
              </div>

              <div className="settingsPanel">
                <h3>Backend Status</h3>
                <p className={data.health === "ok" ? "statusOk" : "statusError"}>
                  {data.health === "checking" ? "Checking" : data.health === "ok" ? "Healthy" : "Unavailable"}
                </p>
                <button className="secondaryButton" onClick={data.refreshHealth}>
                  <HeartPulse aria-hidden="true" />
                  Check
                </button>
              </div>
            </div>
          </section>
        ) : null}
      </main>

      <PersonalFooter />

      {selectedVideo ? (
        <PlayerOverlay
          video={selectedVideo}
          onClose={() => setSelectedVideo(null)}
          onProgress={data.saveProgress}
          onChannelOpen={openVideoChannel}
        />
      ) : null}

      {showBackToTop ? (
        <button
          className="backToTopButton"
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Back to top"
        >
          <ArrowUp aria-hidden="true" />
          Top
        </button>
      ) : null}
    </div>
  );
}

function TvApp() {
  const data = useGoTubeData();
  const [section, setSection] = useState<TvSection>("feed");
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [channelFeed, setChannelFeed] = useState<Video[]>([]);
  const [channelFeedCursor, setChannelFeedCursor] = useState<string | null>(null);
  const [channelFeedHasMore, setChannelFeedHasMore] = useState(false);
  const [channelFeedLoading, setChannelFeedLoading] = useState(false);
  const [syncKeyDraft, setSyncKeyDraft] = useState(getSyncKey());
  const [tvKeyboardTarget, setTvKeyboardTarget] = useState<TvKeyboardTarget | null>(null);
  const [activeActionCardId, setActiveActionCardId] = useState<string | null>(null);
  const lastTvFocusRef = useRef<HTMLElement | null>(null);

  const watchLaterVideos = useMemo(() => data.watchLater.map((item) => item.video), [data.watchLater]);
  const watchedById = useMemo(
    () => new Map(data.watchedVideos.map((item) => [item.youtube_video_id, item])),
    [data.watchedVideos]
  );

  const focusSectionStart = useCallback((nextSection: TvSection = section) => {
    const root = document.querySelector<HTMLElement>(".tvShell");
    const firstInSection = root?.querySelector<HTMLElement>(`[data-tv-section='${nextSection}']`);
    if (firstInSection) {
      focusTvElement(firstInSection);
      return;
    }
    if (root) {
      focusFirstTvElement(root);
    }
  }, [section]);

  const findTvCard = useCallback((cardId: string | null) => {
    if (!cardId) {
      return null;
    }
    return (
      Array.from(document.querySelectorAll<HTMLElement>("[data-tv-card='true']")).find(
        (card) => card.dataset.tvCardId === cardId
      ) ?? null
    );
  }, []);

  const enterTvCardActions = useCallback((card: HTMLElement) => {
    const cardId = card.dataset.tvCardId;
    if (!cardId) {
      return false;
    }
    setActiveActionCardId(cardId);
    window.setTimeout(() => {
      const activeCard = findTvCard(cardId);
      if (activeCard) {
        focusFirstTvElement(activeCard);
      }
    }, 40);
    return true;
  }, [findTvCard]);

  const exitTvCardActions = useCallback((cardId: string | null = activeActionCardId) => {
    const card = findTvCard(cardId);
    setActiveActionCardId(null);
    if (card) {
      focusTvElement(card);
    }
    return Boolean(card);
  }, [activeActionCardId, findTvCard]);

  useEffect(() => {
    window.setTimeout(() => focusSectionStart(section), 60);
  }, [focusSectionStart, section]);

  useEffect(() => {
    if (!activeActionCardId) {
      return;
    }

    function onFocusIn(event: FocusEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const card = target.closest<HTMLElement>("[data-tv-card='true']");
      if (card?.dataset.tvCardId !== activeActionCardId) {
        setActiveActionCardId(null);
      }
    }

    window.addEventListener("focusin", onFocusIn);
    return () => window.removeEventListener("focusin", onFocusIn);
  }, [activeActionCardId]);

  async function loadChannelFeed(channel: Channel, before: string | null = null) {
    setChannelFeedLoading(true);
    try {
      const response = await api.feed(data.settings, {
        limit: FEED_PAGE_SIZE,
        before,
        channelId: channel.youtube_channel_id
      });
      const videos = visibleVideos(response.videos);
      setChannelFeed((items) => (before ? appendUniqueVideos(items, videos) : videos));
      setChannelFeedCursor(response.nextCursor);
      setChannelFeedHasMore(response.hasMore);
      await cacheVideos(response.videos);
      if (!videos.length && !before) {
        data.setNotice("No synced videos for this channel yet.");
      }
    } catch (cause) {
      data.setNotice(describeError(cause));
    } finally {
      setChannelFeedLoading(false);
    }
  }

  async function openChannel(channel: Channel) {
    setActiveActionCardId(null);
    setSelectedChannel(channel);
    setChannelFeed([]);
    setChannelFeedCursor(null);
    setChannelFeedHasMore(false);
    setSection("channelFeed");
    await loadChannelFeed(channel);
  }

  function backToChannels() {
    setActiveActionCardId(null);
    setSelectedChannel(null);
    setChannelFeed([]);
    setChannelFeedCursor(null);
    setChannelFeedHasMore(false);
    setSection("channels");
  }

  function openTvVideo(video: Video) {
    lastTvFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedVideo(withWatchedState(video, watchedById.get(video.youtube_video_id)));
  }

  function closeTvVideo() {
    setSelectedVideo(null);
    window.setTimeout(() => {
      if (lastTvFocusRef.current?.isConnected) {
        focusTvElement(lastTvFocusRef.current);
        return;
      }
      focusSectionStart(section);
    }, 40);
  }

  async function loadOlderChannelFeed() {
    if (!selectedChannel || !channelFeedCursor || channelFeedLoading) {
      return;
    }
    await loadChannelFeed(selectedChannel, channelFeedCursor);
  }

  function goToSection(nextSection: Exclude<TvSection, "channelFeed">) {
    setActiveActionCardId(null);
    setSelectedChannel(null);
    setChannelFeed([]);
    setChannelFeedCursor(null);
    setChannelFeedHasMore(false);
    setSection(nextSection);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (selectedVideo) {
        return;
      }

      if (tvKeyboardTarget) {
        if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          const root = document.querySelector<HTMLElement>(".tvKeyboardOverlay");
          if (root) {
            focusNearestTvElement(event.key as TvDirectionKey, root);
          }
          return;
        }

        if (event.key === "Enter") {
          const active = document.activeElement as HTMLElement | null;
          if (active?.dataset.tvFocusable === "true") {
            event.preventDefault();
            active.click();
          }
          return;
        }

        if (event.key === "Escape" || event.key === "Backspace") {
          event.preventDefault();
          setTvKeyboardTarget(null);
          return;
        }
      }

      const arrowKeys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
      const target = event.target;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const activeCard = active?.closest<HTMLElement>("[data-tv-card='true']") ?? null;
      const activeCardId = activeCard?.dataset.tvCardId ?? null;
      const activeIsCardAction = active?.dataset.tvCardAction === "true" && activeCardId === activeActionCardId;

      if (target instanceof HTMLInputElement && !arrowKeys.includes(event.key)) {
        return;
      }

      if (activeIsCardAction && arrowKeys.includes(event.key)) {
        event.preventDefault();

        if (event.key === "ArrowUp") {
          exitTvCardActions(activeCardId);
          return;
        }

        if (event.key === "ArrowDown") {
          if (activeCard) {
            setActiveActionCardId(null);
            focusTvElement(activeCard);
            window.setTimeout(() => {
              const root = document.querySelector<HTMLElement>(".tvShell");
              if (root) {
                focusNearestTvElement("ArrowDown", root);
              }
            }, 0);
          }
          return;
        }

        if (activeCard) {
          focusNearestTvElement(event.key as TvDirectionKey, activeCard);
        }
        return;
      }

      if (arrowKeys.includes(event.key)) {
        event.preventDefault();
        const root = document.querySelector<HTMLElement>(".tvShell");
        if (root) {
          focusNearestTvElement(event.key as TvDirectionKey, root);
        }
      }

      if (event.key === "Enter") {
        if (active instanceof HTMLInputElement) {
          return;
        }
        if (active?.dataset.tvCard === "true") {
          event.preventDefault();
          enterTvCardActions(active);
          return;
        }
        if (active?.dataset.tvFocusable === "true") {
          event.preventDefault();
          active.click();
        }
      }

      if (event.key === "Escape" || event.key === "Backspace") {
        event.preventDefault();
        if (activeActionCardId && exitTvCardActions(activeActionCardId)) {
          return;
        }
        if (section === "channelFeed") {
          backToChannels();
          return;
        }
        if (section !== "feed") {
          goToSection("feed");
          return;
        }
        focusSectionStart("feed");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeActionCardId, enterTvCardActions, exitTvCardActions, focusSectionStart, section, selectedVideo, tvKeyboardTarget]);

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) {
      setResults([]);
      return;
    }
    try {
      const response = await api.search(query.trim(), "video");
      setResults(response.results);
      data.setNotice("Search complete.");
    } catch (cause) {
      data.setNotice(describeError(cause));
    }
  }

  async function saveTvSyncKey(event: FormEvent) {
    event.preventDefault();
    setSyncKey(syncKeyDraft);
    await data.refreshRemote(data.settings);
  }

  return (
    <div className={selectedVideo ? "tvShell tvShellPlayback" : "tvShell"}>
      {selectedVideo ? (
        <PlayerOverlay video={selectedVideo} tvMode onClose={closeTvVideo} onProgress={data.saveProgress} />
      ) : (
        <>
      <header className="tvHeader">
        <button className="brandHomeButton tvBrandHomeButton" type="button" onClick={() => goToSection("feed")} aria-label="Go to Feed">
          <div className="brandMark">
            <img className="brandMarkImage" src="/brand/gotube-icon.svg" alt="" aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">GoTube TV</p>
            <h1>
              {section === "feed"
                ? "Feed"
                : section === "watchLater"
                  ? "Watch Later"
                  : section === "search"
                    ? "Search"
                    : section === "channelFeed"
                      ? selectedChannel?.title ?? "Channel"
                      : section === "settings"
                        ? "Settings"
                        : "Channels"}
            </h1>
          </div>
        </button>
        <div className="tvHeaderActions">
          <a href="/" className="secondaryButton" data-tv-focusable="true">
            Standard
          </a>
          <button
            className="primaryButton"
            type="button"
            onClick={() => void data.syncAll()}
            disabled={data.busy}
            aria-busy={data.busy}
            data-tv-focusable="true"
          >
            <RefreshCw className={data.busy ? "spinIcon" : undefined} aria-hidden="true" />
            {data.busy ? "Refreshing" : "Refresh"}
          </button>
          <button
            className="secondaryButton"
            type="button"
            onClick={() => goToSection("settings")}
            data-tv-focusable="true"
            data-tv-section="settings"
          >
            Settings
          </button>
        </div>
      </header>

      <nav className="tvNav">
        <button
          className={section === "feed" ? "active" : ""}
          onClick={() => goToSection("feed")}
          data-tv-focusable="true"
          data-tv-section="feed"
        >
          Feed
        </button>
        <button
          className={section === "watchLater" ? "active" : ""}
          onClick={() => goToSection("watchLater")}
          data-tv-focusable="true"
          data-tv-section="watchLater"
        >
          Watch Later
        </button>
        <button
          className={section === "search" ? "active" : ""}
          onClick={() => goToSection("search")}
          data-tv-focusable="true"
          data-tv-section="search"
        >
          Search
        </button>
        <button
          className={section === "channels" || section === "channelFeed" ? "active" : ""}
          onClick={() => goToSection("channels")}
          data-tv-focusable="true"
          data-tv-section="channels"
        >
          Channels
        </button>
      </nav>

      {data.notice ? <div className="tvNotice" role="status">{data.notice}</div> : null}

      <main className="tvContent">
        {section === "feed" ? (
          data.feed.length ? (
            <>
              <div className="tvGrid">
                {data.feed.map((video) => (
                  <VideoCard
                    key={video.youtube_video_id}
                    video={video}
                    watched={watchedById.get(video.youtube_video_id)}
                    tvMode
                    tvActionsActive={activeActionCardId === video.youtube_video_id}
                    onPlay={openTvVideo}
                    onWatchLater={data.addWatchLater}
                    onMarkWatched={data.markWatched}
                  />
                ))}
              </div>
              {data.feedHasMore ? (
                <div className="tvLoadMoreRow">
                  <button
                    className="secondaryButton"
                    onClick={data.loadOlderFeed}
                    disabled={data.loadingOlder || data.busy}
                    data-tv-focusable="true"
                  >
                    <ChevronDown aria-hidden="true" />
                    {data.loadingOlder ? "Loading Older" : "Load Older"}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState title="No feed videos" body="Add and sync channels from the standard interface or TV search." />
          )
        ) : null}

        {section === "watchLater" ? (
          watchLaterVideos.length ? (
            <div className="tvGrid">
              {watchLaterVideos.map((video) => (
                <VideoCard
                  key={video.youtube_video_id}
                  video={video}
                  watched={watchedById.get(video.youtube_video_id)}
                  tvMode
                  tvActionsActive={activeActionCardId === video.youtube_video_id}
                  showRemove
                  onPlay={openTvVideo}
                  onRemove={data.removeWatchLater}
                  onMarkWatched={data.markWatched}
                />
              ))}
            </div>
          ) : (
            <EmptyState title="No saved videos" body="Videos you add to Watch Later appear here." />
          )
        ) : null}

        {section === "search" ? (
          <section>
            <form className="tvSearch" onSubmit={onSearch}>
              <input
                value={query}
                onFocus={() => setTvKeyboardTarget("search")}
                onClick={() => setTvKeyboardTarget("search")}
                placeholder="Search videos"
                readOnly
                data-tv-focusable="true"
              />
              <button className="primaryButton" type="submit" data-tv-focusable="true">
                <Search aria-hidden="true" />
                Search
              </button>
            </form>
            <div className="tvGrid">
              {results
                .filter((result): result is SearchVideoResult => result.type === "video")
                .map((result) => (
                  <VideoCard
                    key={result.youtube_video_id}
                    video={videoFromSearch(result)}
                    watched={watchedById.get(result.youtube_video_id)}
                    tvMode
                    tvActionsActive={activeActionCardId === result.youtube_video_id}
                    onPlay={openTvVideo}
                    onWatchLater={data.addWatchLater}
                  />
                ))}
            </div>
          </section>
        ) : null}

        {section === "channels" ? (
          data.channels.length ? (
            <div className="tvChannelList">
              {data.channels.map((channel) => (
                <article
                  className="tvChannel"
                  key={channel.youtube_channel_id}
                  data-tv-focusable="true"
                  tabIndex={0}
                  role="button"
                  aria-label={`Open ${channel.title}`}
                  onClick={() => {
                    void openChannel(channel);
                  }}
                >
                  {channel.thumbnail_url ? <img src={channel.thumbnail_url} alt="" /> : <div className="avatarFallback">GT</div>}
                  <div>
                    <h3>{channel.title}</h3>
                    <p>Last synced: {formatDateTime(channel.last_checked_at)}</p>
                  </div>
                  <button
                    className="primaryButton"
                    onClick={(event) => {
                      event.stopPropagation();
                      void data.syncOne(channel.youtube_channel_id);
                    }}
                    data-tv-focusable="true"
                  >
                    <RefreshCw aria-hidden="true" />
                    Sync
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No channels saved" body="Add channels in Search, then they appear here." />
          )
        ) : null}

        {section === "channelFeed" && selectedChannel ? (
          <section>
            <div className="tvSectionHeader">
              <button className="secondaryButton" onClick={backToChannels} data-tv-focusable="true" data-tv-section="channelFeed">
                <ArrowLeft aria-hidden="true" />
                Channels
              </button>
              <button
                className="primaryButton"
                onClick={async () => {
                  await data.syncOne(selectedChannel.youtube_channel_id);
                  await loadChannelFeed(selectedChannel);
                }}
                disabled={data.busy || channelFeedLoading}
                data-tv-focusable="true"
              >
                <RefreshCw aria-hidden="true" />
                {channelFeedLoading ? "Syncing" : "Sync Channel"}
              </button>
            </div>
            {channelFeed.length ? (
              <>
                <div className="tvGrid">
                  {channelFeed.map((video) => (
                    <VideoCard
                      key={video.youtube_video_id}
                      video={video}
                      watched={watchedById.get(video.youtube_video_id)}
                      tvMode
                      tvActionsActive={activeActionCardId === video.youtube_video_id}
                      onPlay={openTvVideo}
                      onWatchLater={data.addWatchLater}
                      onMarkWatched={data.markWatched}
                    />
                  ))}
                </div>
                {channelFeedHasMore ? (
                  <div className="tvLoadMoreRow">
                    <button
                      className="secondaryButton"
                      onClick={loadOlderChannelFeed}
                      disabled={channelFeedLoading}
                      data-tv-focusable="true"
                    >
                      <ChevronDown aria-hidden="true" />
                      {channelFeedLoading ? "Loading Older" : "Load Older"}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <EmptyState title="No synced videos" body="Sync this channel to build its TV feed." />
            )}
          </section>
        ) : null}

        {section === "settings" ? (
          <section className="tvSettings">
            <form className="tvSettingsPanel" onSubmit={saveTvSyncKey}>
              <label className="tvFieldLabel">
                <span>Private Sync Key</span>
                <input
                  type="password"
                  value={syncKeyDraft}
                  onFocus={() => setTvKeyboardTarget("syncKey")}
                  onClick={() => setTvKeyboardTarget("syncKey")}
                  placeholder="Enter GOTUBE_SYNC_KEY"
                  autoComplete="current-password"
                  readOnly
                  data-tv-focusable="true"
                />
              </label>
              <button className="primaryButton" type="submit" data-tv-focusable="true">
                <Check aria-hidden="true" />
                Save Key
              </button>
            </form>

            <div className="tvSettingsPanel">
              <h3>Backend Status</h3>
              <p className={data.health === "ok" ? "statusOk" : "statusError"}>
                {data.health === "checking" ? "Checking" : data.health === "ok" ? "Healthy" : "Unavailable"}
              </p>
              <button className="secondaryButton" onClick={data.refreshHealth} data-tv-focusable="true">
                <HeartPulse aria-hidden="true" />
                Check
              </button>
            </div>
          </section>
        ) : null}
      </main>

      <footer className="tvFooter">
        <SlidersHorizontal aria-hidden="true" />
        Arrow keys move focus. Enter selects. Escape goes back. Space toggles playback.
      </footer>

      <PersonalFooter tvMode />

      {tvKeyboardTarget ? (
        <TvKeyboardOverlay
          title={tvKeyboardTarget === "search" ? "Search" : "Private Sync Key"}
          value={tvKeyboardTarget === "search" ? query : syncKeyDraft}
          password={tvKeyboardTarget === "syncKey"}
          onChange={tvKeyboardTarget === "search" ? setQuery : setSyncKeyDraft}
          onClose={() => setTvKeyboardTarget(null)}
        />
      ) : null}

        </>
      )}
    </div>
  );
}

export default function App() {
  return window.location.pathname.startsWith("/tv") ? <TvApp /> : <DesktopApp />;
}
