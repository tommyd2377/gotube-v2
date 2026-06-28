import { ArrowLeft, FastForward, LogIn, Maximize2, Minimize2, Pause, Play, Rewind } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDate, formatDuration } from "../lib/format";
import { focusFirstTvElement, focusNearestTvElement, focusTvElement, type TvDirectionKey } from "../lib/tvFocus";
import type { Video } from "../lib/types";
import { LinkifiedText } from "./LinkifiedText";

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        options: {
          videoId: string;
          host?: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (event: { target: YouTubePlayer }) => void;
            onStateChange?: (event: { data: number; target: YouTubePlayer }) => void;
          };
        }
      ) => YouTubePlayer;
      PlayerState: {
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
    GoTubeNative?: {
      setKeepScreenOn: (enabled: boolean) => void;
    };
  }
}

interface YouTubePlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  destroy: () => void;
}

let apiPromise: Promise<void> | null = null;
const TV_SEEK_SECONDS = 30;
const TV_SEEK_ACCELERATION_SECONDS = [30, 60, 120, 300];
const FULLSCREEN_CONTROLS_IDLE_MS = 7000;
const TV_PREFERRED_PLAYBACK_QUALITY = "hd720";
const TV_PROGRESS_POLL_PLAYING_MS = 2500;
const TV_PROGRESS_POLL_IDLE_MS = 5000;
const TV_PROGRESS_SAVE_MS = 30000;
const TV_DIRECT_PLAYER_SYNC_MS = 1000;
const TV_DIRECT_PLAYER_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5
};

type SeekFeedback = {
  amountLabel: string;
  targetLabel: string;
};

type DirectPlayerMessage = {
  event?: string;
  info?: number | {
    currentTime?: number;
    duration?: number;
    playerState?: number;
  };
};

function loadYouTubeApi() {
  if (window.YT?.Player) {
    return Promise.resolve();
  }

  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      window.onYouTubeIframeAPIReady = () => resolve();
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    });
  }

  return apiPromise;
}

function directEmbedUrl(videoId: string, startSeconds: number, widgetId: string) {
  const url = new URL(`https://www.youtube.com/embed/${encodeURIComponent(videoId)}`);
  url.searchParams.set("enablejsapi", "1");
  url.searchParams.set("origin", window.location.origin);
  url.searchParams.set("widgetid", widgetId);
  url.searchParams.set("rel", "0");
  url.searchParams.set("modestbranding", "1");
  url.searchParams.set("playsinline", "1");
  url.searchParams.set("controls", "1");
  url.searchParams.set("autoplay", "0");
  url.searchParams.set("vq", TV_PREFERRED_PLAYBACK_QUALITY);
  if (startSeconds > 0) {
    url.searchParams.set("start", String(Math.floor(startSeconds)));
  }
  return url.toString();
}

function parseDirectPlayerMessage(data: unknown): DirectPlayerMessage | null {
  const payload = typeof data === "string"
    ? (() => {
        try {
          return JSON.parse(data) as unknown;
        } catch {
          return null;
        }
      })()
    : data;

  if (!payload || typeof payload !== "object") {
    return null;
  }

  return payload as DirectPlayerMessage;
}

function isDirectPlayerMessageSource(event: MessageEvent, iframe: HTMLIFrameElement | null) {
  const isFrameSource = Boolean(iframe?.contentWindow && event.source === iframe.contentWindow);
  const isYouTubeOrigin = /^https:\/\/([a-z0-9-]+\.)?youtube(-nocookie)?\.com$/i.test(event.origin);
  return isFrameSource || isYouTubeOrigin;
}

function setNativeKeepScreenOn(enabled: boolean) {
  try {
    window.GoTubeNative?.setKeepScreenOn(enabled);
  } catch {
    // The native bridge is available only inside the Fire TV APK shell.
  }
}

interface PlayerOverlayProps {
  video: Video;
  tvMode?: boolean;
  onClose: () => void;
  onProgress?: (video: Video, progressSeconds: number, completed: boolean) => void | Promise<void>;
  onChannelOpen?: (video: Video) => void | Promise<void>;
}

export function PlayerOverlay({ video, tvMode = false, onClose, onProgress, onChannelOpen }: PlayerOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const playbackButtonRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const directIframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const lastSavedProgressRef = useRef(video.progress_seconds ?? 0);
  const seekFeedbackTimeoutRef = useRef<number | null>(null);
  const controlsHideTimeoutRef = useRef<number | null>(null);
  const seekBurstRef = useRef({ direction: 0, count: 0, timestamp: 0 });
  const browserFullscreenRef = useRef(false);
  const fullscreenExitAtRef = useRef(0);
  const directPlaybackRef = useRef({
    offsetSeconds: video.completed ? 0 : Math.floor(video.progress_seconds ?? 0),
    startedAtMs: 0,
    playing: false
  });
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [currentSeconds, setCurrentSeconds] = useState(video.completed ? 0 : Math.floor(video.progress_seconds ?? 0));
  const [durationSeconds, setDurationSeconds] = useState(video.duration_seconds ?? 0);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [seekFeedback, setSeekFeedback] = useState<SeekFeedback | null>(null);
  const channelLabel = video.channel_title ?? "Saved channel";
  const durationLabel = durationSeconds ? formatDuration(durationSeconds) : video.duration_seconds ? formatDuration(video.duration_seconds) : null;
  const resumeSeconds = video.completed ? 0 : Math.floor(video.progress_seconds ?? 0);
  const progressPercent = durationSeconds > 0 ? Math.min(100, Math.max(0, (currentSeconds / durationSeconds) * 100)) : 0;
  const useDirectTvEmbed = tvMode;
  const directPlayerWidgetId = `gotube-tv-player-${video.youtube_video_id}`;
  const tvEmbedSrc = useDirectTvEmbed ? directEmbedUrl(video.youtube_video_id, resumeSeconds, directPlayerWidgetId) : null;

  function directCurrentSeconds() {
    const state = directPlaybackRef.current;
    if (!state.playing) {
      return state.offsetSeconds;
    }
    return state.offsetSeconds + Math.max(0, (Date.now() - state.startedAtMs) / 1000);
  }

  function sendDirectPlayerMessage(message: Record<string, unknown>) {
    directIframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({
        id: directPlayerWidgetId,
        channel: "widget",
        ...message
      }),
      "https://www.youtube.com"
    );
  }

  function sendDirectPlayerCommand(func: string, args: Array<string | number | boolean> = []) {
    sendDirectPlayerMessage({ event: "command", func, args });
  }

  function listenToDirectPlayer() {
    if (!useDirectTvEmbed) {
      return;
    }
    sendDirectPlayerMessage({ event: "listening" });
    sendDirectPlayerCommand("addEventListener", ["onStateChange"]);
  }

  function applyTvPlaybackQuality() {
    if (!useDirectTvEmbed) {
      return;
    }
    sendDirectPlayerCommand("setPlaybackQuality", [TV_PREFERRED_PLAYBACK_QUALITY]);
  }

  function requestDirectPlayerSnapshot() {
    if (!useDirectTvEmbed) {
      return;
    }
    listenToDirectPlayer();
    sendDirectPlayerCommand("getCurrentTime");
    sendDirectPlayerCommand("getDuration");
    sendDirectPlayerCommand("getPlayerState");
  }

  function scheduleDirectPlayerSnapshot() {
    requestDirectPlayerSnapshot();
    window.setTimeout(requestDirectPlayerSnapshot, 250);
    window.setTimeout(requestDirectPlayerSnapshot, 900);
  }

  function scheduleTvPlaybackQuality() {
    if (!useDirectTvEmbed) {
      return;
    }
    applyTvPlaybackQuality();
    window.setTimeout(applyTvPlaybackQuality, 600);
    window.setTimeout(applyTvPlaybackQuality, 1800);
  }

  function setDirectProgress(seconds: number) {
    const nextSeconds = Math.max(0, Math.floor(seconds));
    directPlaybackRef.current.offsetSeconds = nextSeconds;
    directPlaybackRef.current.startedAtMs = Date.now();
    setCurrentSeconds(nextSeconds);
  }

  function currentProgressSeconds() {
    if (useDirectTvEmbed) {
      return Math.floor(directCurrentSeconds());
    }
    const current = playerRef.current?.getCurrentTime();
    return typeof current === "number" && Number.isFinite(current) ? Math.max(0, Math.floor(current)) : 0;
  }

  function currentDurationSeconds() {
    if (useDirectTvEmbed) {
      return durationSeconds > 0 ? durationSeconds : (video.duration_seconds ?? 0);
    }
    const duration = playerRef.current?.getDuration();
    if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
      return Math.floor(duration);
    }
    return video.duration_seconds ?? 0;
  }

  function updateProgressState() {
    setCurrentSeconds(currentProgressSeconds());
    const duration = currentDurationSeconds();
    if (duration > 0) {
      setDurationSeconds(duration);
    }
  }

  function saveCurrentProgress(completed = false, overrideProgressSeconds?: number) {
    if (!onProgress) {
      return;
    }

    const progressSeconds = completed
      ? (currentDurationSeconds() || currentProgressSeconds())
      : (overrideProgressSeconds ?? currentProgressSeconds());
    if (!completed && progressSeconds < 5) {
      return;
    }

    if (!completed && Math.abs(progressSeconds - lastSavedProgressRef.current) < 10) {
      return;
    }

    lastSavedProgressRef.current = progressSeconds;
    void onProgress(video, progressSeconds, completed);
  }

  function applyDirectPlayerSnapshot(playerState?: number, currentTime?: number, duration?: number) {
    if (!useDirectTvEmbed) {
      return;
    }

    const state = directPlaybackRef.current;
    const previousSeconds = state.offsetSeconds;
    const nextSeconds =
      typeof currentTime === "number" && Number.isFinite(currentTime) && currentTime >= 0
        ? Math.floor(currentTime)
        : Math.floor(directCurrentSeconds());
    const inferredPlaying =
      playerState === undefined &&
      typeof currentTime === "number" &&
      Number.isFinite(currentTime) &&
      currentTime > previousSeconds + 0.5;

    if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
      setDurationSeconds(Math.floor(duration));
    }

    if (typeof currentTime === "number" && Number.isFinite(currentTime) && currentTime >= 0) {
      state.offsetSeconds = nextSeconds;
      state.startedAtMs = Date.now();
      setCurrentSeconds(nextSeconds);
    }

    if (playerState === TV_DIRECT_PLAYER_STATE.PLAYING) {
      state.offsetSeconds = nextSeconds;
      state.startedAtMs = Date.now();
      state.playing = true;
      setPlaying(true);
      setCurrentSeconds(nextSeconds);
      return;
    }

    if (inferredPlaying) {
      state.offsetSeconds = nextSeconds;
      state.startedAtMs = Date.now();
      state.playing = true;
      setPlaying(true);
      setCurrentSeconds(nextSeconds);
      return;
    }

    if (
      playerState === TV_DIRECT_PLAYER_STATE.PAUSED ||
      playerState === TV_DIRECT_PLAYER_STATE.CUED ||
      playerState === TV_DIRECT_PLAYER_STATE.UNSTARTED
    ) {
      state.offsetSeconds = nextSeconds;
      state.startedAtMs = Date.now();
      state.playing = false;
      setPlaying(false);
      setCurrentSeconds(nextSeconds);
      saveCurrentProgress(false, nextSeconds);
      return;
    }

    if (playerState === TV_DIRECT_PLAYER_STATE.ENDED) {
      state.offsetSeconds = nextSeconds;
      state.startedAtMs = Date.now();
      state.playing = false;
      setPlaying(false);
      setCurrentSeconds(nextSeconds);
      saveCurrentProgress(true);
    }
  }

  function formatSeekAmount(seconds: number) {
    return seconds < 60 ? `${seconds}s` : formatDuration(seconds);
  }

  function showSeekFeedback(seconds: number, targetSeconds: number) {
    const direction = seconds > 0 ? "Forward" : "Back";
    setSeekFeedback({
      amountLabel: `${direction} ${formatSeekAmount(Math.abs(seconds))}`,
      targetLabel: formatDuration(Math.floor(targetSeconds))
    });
    if (seekFeedbackTimeoutRef.current) {
      window.clearTimeout(seekFeedbackTimeoutRef.current);
    }
    seekFeedbackTimeoutRef.current = window.setTimeout(() => setSeekFeedback(null), 1100);
  }

  function seekBy(seconds: number) {
    if (useDirectTvEmbed) {
      const duration = currentDurationSeconds();
      const nextSeconds = Math.max(0, duration > 0 ? Math.min(duration, directCurrentSeconds() + seconds) : directCurrentSeconds() + seconds);
      sendDirectPlayerCommand("seekTo", [Math.floor(nextSeconds), true]);
      setDirectProgress(nextSeconds);
      showSeekFeedback(seconds, nextSeconds);
      saveCurrentProgress(false, Math.floor(nextSeconds));
      scheduleDirectPlayerSnapshot();
      return;
    }

    const player = playerRef.current;
    if (!player) {
      return;
    }
    const duration = currentDurationSeconds();
    const nextSeconds = Math.max(0, duration > 0 ? Math.min(duration, currentProgressSeconds() + seconds) : currentProgressSeconds() + seconds);
    player.seekTo(nextSeconds, true);
    setCurrentSeconds(Math.floor(nextSeconds));
    showSeekFeedback(seconds, nextSeconds);
    saveCurrentProgress(false, Math.floor(nextSeconds));
  }

  function seekByDirection(direction: -1 | 1) {
    const now = Date.now();
    const burst = seekBurstRef.current;
    if (burst.direction === direction && now - burst.timestamp < 900) {
      burst.count = Math.min(burst.count + 1, TV_SEEK_ACCELERATION_SECONDS.length - 1);
    } else {
      burst.direction = direction;
      burst.count = 0;
    }
    burst.timestamp = now;
    seekBy(direction * TV_SEEK_ACCELERATION_SECONDS[burst.count]);
  }

  function togglePlayback() {
    if (useDirectTvEmbed) {
      const state = directPlaybackRef.current;
      if (state.playing) {
        state.offsetSeconds = Math.floor(directCurrentSeconds());
        state.playing = false;
        sendDirectPlayerCommand("pauseVideo");
        setPlaying(false);
        setCurrentSeconds(state.offsetSeconds);
        saveCurrentProgress(false, state.offsetSeconds);
        scheduleDirectPlayerSnapshot();
        return;
      }

      state.startedAtMs = Date.now();
      state.playing = true;
      applyTvPlaybackQuality();
      sendDirectPlayerCommand("playVideo");
      setPlaying(true);
      scheduleDirectPlayerSnapshot();
      return;
    }
    const player = playerRef.current;
    if (!player || !window.YT?.PlayerState) {
      return;
    }
    if (player.getPlayerState() === window.YT.PlayerState.PLAYING) {
      player.pauseVideo();
      setPlaying(false);
    } else {
      player.playVideo();
      setPlaying(true);
    }
  }

  function focusPlayerStageSoon() {
    window.setTimeout(() => {
      if (frameRef.current) {
        focusTvElement(frameRef.current);
      }
    }, 60);
  }

  async function enterFullscreen() {
    setFullscreen(true);
    focusPlayerStageSoon();

    const overlay = overlayRef.current;
    if (!overlay?.requestFullscreen || document.fullscreenElement === overlay) {
      return;
    }

    try {
      await overlay.requestFullscreen();
    } catch {
      // Keep the app-level fullscreen layout if browser fullscreen is unavailable.
    }
  }

  async function exitFullscreen() {
    if (document.fullscreenElement === overlayRef.current && document.exitFullscreen) {
      try {
        await document.exitFullscreen();
      } catch {
        // Fall through and reset the app-level fullscreen layout.
      }
    }

    fullscreenExitAtRef.current = Date.now();
    setFullscreen(false);
    focusPlayerStageSoon();
  }

  function toggleFullscreen() {
    if (fullscreen || document.fullscreenElement === overlayRef.current) {
      void exitFullscreen();
      return;
    }

    void enterFullscreen();
  }

  const clearControlsHideTimeout = useCallback(() => {
    if (controlsHideTimeoutRef.current) {
      window.clearTimeout(controlsHideTimeoutRef.current);
      controlsHideTimeoutRef.current = null;
    }
  }, []);

  const revealFullscreenControls = useCallback(() => {
    if (!tvMode || !fullscreen) {
      return;
    }

    setControlsVisible(true);
    clearControlsHideTimeout();
    controlsHideTimeoutRef.current = window.setTimeout(() => {
      setControlsVisible(false);
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest(".playerTvControls") && frameRef.current) {
        focusTvElement(frameRef.current);
      }
    }, FULLSCREEN_CONTROLS_IDLE_MS);
  }, [clearControlsHideTimeout, fullscreen, tvMode]);

  function openYouTubeSignIn() {
    const signInUrl = new URL("https://accounts.google.com/ServiceLogin");
    signInUrl.searchParams.set("service", "youtube");
    signInUrl.searchParams.set("continue", "https://www.youtube.com/");
    window.location.assign(signInUrl.toString());
  }

  useEffect(() => {
    let disposed = false;

    if (useDirectTvEmbed) {
      directPlaybackRef.current = {
        offsetSeconds: resumeSeconds,
        startedAtMs: 0,
        playing: false
      };
      setPlaying(false);
      setReady(false);
      setCurrentSeconds(resumeSeconds);
      setDurationSeconds(video.duration_seconds ?? 0);
      return () => {
        disposed = true;
        directPlaybackRef.current.playing = false;
        setReady(false);
      };
    }

    loadYouTubeApi().then(() => {
      if (disposed || !containerRef.current || !window.YT?.Player) {
        return;
      }

      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId: video.youtube_video_id,
        host: "https://www.youtube.com",
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          enablejsapi: 1,
          origin: window.location.origin
        },
        events: {
          onReady: (event) => {
            playerRef.current = event.target;
            setReady(true);
            setCurrentSeconds(currentProgressSeconds());
            setDurationSeconds(currentDurationSeconds());
          },
          onStateChange: (event) => {
            setPlaying(event.data === window.YT?.PlayerState.PLAYING);
            updateProgressState();
            if (event.data === window.YT?.PlayerState.ENDED) {
              saveCurrentProgress(true);
            }
          }
        }
      });
    });

    return () => {
      disposed = true;
      setReady(false);
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [resumeSeconds, useDirectTvEmbed, video.duration_seconds, video.youtube_video_id]);

  useEffect(() => {
    if (!useDirectTvEmbed) {
      return;
    }

    function onDirectPlayerMessage(event: MessageEvent) {
      if (!isDirectPlayerMessageSource(event, directIframeRef.current)) {
        return;
      }

      const message = parseDirectPlayerMessage(event.data);
      if (!message) {
        return;
      }

      if (message.event === "onReady") {
        setReady(true);
        scheduleTvPlaybackQuality();
        scheduleDirectPlayerSnapshot();
        return;
      }

      if (message.event === "onStateChange" && typeof message.info === "number") {
        applyDirectPlayerSnapshot(message.info);
        return;
      }

      if (message.info && typeof message.info === "object") {
        applyDirectPlayerSnapshot(message.info.playerState, message.info.currentTime, message.info.duration);
      }
    }

    window.addEventListener("message", onDirectPlayerMessage);
    return () => window.removeEventListener("message", onDirectPlayerMessage);
  }, [useDirectTvEmbed, video.youtube_video_id]);

  useEffect(() => {
    if (!useDirectTvEmbed) {
      return;
    }

    function onNativePlayerTap() {
      applyTvPlaybackQuality();
      scheduleDirectPlayerSnapshot();
    }

    window.addEventListener("gotube-tv-native-player-tap", onNativePlayerTap);
    return () => window.removeEventListener("gotube-tv-native-player-tap", onNativePlayerTap);
  }, [useDirectTvEmbed, video]);

  useEffect(() => {
    if (!tvMode) {
      return;
    }

    setNativeKeepScreenOn(playing);
    return () => setNativeKeepScreenOn(false);
  }, [playing, tvMode]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    const interval = window.setInterval(
      updateProgressState,
      tvMode ? (playing ? TV_PROGRESS_POLL_PLAYING_MS : TV_PROGRESS_POLL_IDLE_MS) : (playing ? 1000 : 3000)
    );
    return () => window.clearInterval(interval);
  }, [playing, ready, tvMode, video.duration_seconds]);

  useEffect(() => {
    if (!useDirectTvEmbed || !ready) {
      return;
    }

    listenToDirectPlayer();
    scheduleDirectPlayerSnapshot();
    const interval = window.setInterval(requestDirectPlayerSnapshot, TV_DIRECT_PLAYER_SYNC_MS);
    return () => window.clearInterval(interval);
  }, [ready, useDirectTvEmbed, video.youtube_video_id]);

  useEffect(() => {
    if (!onProgress) {
      return;
    }

    const interval = window.setInterval(() => saveCurrentProgress(false), tvMode ? TV_PROGRESS_SAVE_MS : 15000);
    return () => {
      window.clearInterval(interval);
      saveCurrentProgress(false);
    };
  }, [onProgress, tvMode, video]);

  useEffect(() => {
    return () => {
      if (seekFeedbackTimeoutRef.current) {
        window.clearTimeout(seekFeedbackTimeoutRef.current);
      }
      clearControlsHideTimeout();
    };
  }, [clearControlsHideTimeout]);

  useEffect(() => {
    if (!tvMode || !fullscreen) {
      setControlsVisible(true);
      clearControlsHideTimeout();
      return;
    }

    revealFullscreenControls();
    return clearControlsHideTimeout;
  }, [clearControlsHideTimeout, fullscreen, revealFullscreenControls, tvMode]);

  useEffect(() => {
    if (!tvMode || !fullscreen) {
      return;
    }

    const overlay = overlayRef.current;
    if (!overlay) {
      return;
    }

    overlay.addEventListener("pointermove", revealFullscreenControls);
    overlay.addEventListener("pointerdown", revealFullscreenControls);
    overlay.addEventListener("touchstart", revealFullscreenControls);
    return () => {
      overlay.removeEventListener("pointermove", revealFullscreenControls);
      overlay.removeEventListener("pointerdown", revealFullscreenControls);
      overlay.removeEventListener("touchstart", revealFullscreenControls);
    };
  }, [fullscreen, revealFullscreenControls, tvMode]);

  useEffect(() => {
    if (!tvMode) {
      return;
    }
    window.setTimeout(() => {
      if (overlayRef.current) {
        focusFirstTvElement(overlayRef.current);
      }
    }, 60);
  }, [tvMode, video.youtube_video_id]);

  useEffect(() => {
    function onFullscreenChange() {
      const isBrowserFullscreen = document.fullscreenElement === overlayRef.current;
      if (browserFullscreenRef.current && !isBrowserFullscreen) {
        fullscreenExitAtRef.current = Date.now();
      }
      browserFullscreenRef.current = isBrowserFullscreen;
      setFullscreen(isBrowserFullscreen);
    }

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (document.fullscreenElement === overlayRef.current && document.exitFullscreen) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      revealFullscreenControls();
      const active = document.activeElement as HTMLElement | null;
      const activeIsPlayerStage = active?.dataset.tvPlayerStage === "true";

      if (event.key === "MediaRewind") {
        event.preventDefault();
        seekByDirection(-1);
        return;
      }

      if (event.key === "MediaFastForward") {
        event.preventDefault();
        seekByDirection(1);
        return;
      }

      if (tvMode && activeIsPlayerStage && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        seekByDirection(event.key === "ArrowLeft" ? -1 : 1);
        return;
      }

      if (tvMode && activeIsPlayerStage && event.key === "ArrowDown" && playbackButtonRef.current) {
        event.preventDefault();
        focusTvElement(playbackButtonRef.current);
        return;
      }

      if (tvMode && active?.dataset.tvPlayerControl === "true" && event.key === "ArrowUp" && frameRef.current) {
        event.preventDefault();
        focusTvElement(frameRef.current);
        return;
      }

      if (tvMode && ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        if (overlayRef.current) {
          focusNearestTvElement(event.key as TvDirectionKey, overlayRef.current);
        }
      }

      if (event.key === "Enter" && tvMode) {
        if (activeIsPlayerStage) {
          event.preventDefault();
          togglePlayback();
          return;
        }
        if (active?.dataset.tvPlayerFullscreen === "true") {
          event.preventDefault();
          toggleFullscreen();
          return;
        }
        if (active?.dataset.tvFocusable === "true") {
          event.preventDefault();
          active.click();
        }
      }

      if (event.key === "Escape" || event.key === "Backspace") {
        event.preventDefault();
        if (fullscreen || document.fullscreenElement === overlayRef.current) {
          void exitFullscreen();
          return;
        }
        if (Date.now() - fullscreenExitAtRef.current < 300) {
          return;
        }
        onClose();
      }

      if (event.key === " ") {
        event.preventDefault();
        togglePlayback();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen, onClose, revealFullscreenControls, tvMode]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

  return (
    <div
      className={[
        "playerOverlay",
        tvMode ? "playerOverlayTv" : "",
        tvMode ? "playerOverlayTvPerformance" : "",
        fullscreen ? "playerOverlayFullscreen" : ""
      ].filter(Boolean).join(" ")}
      role="dialog"
      aria-label="Video player"
      ref={overlayRef}
    >
      <div className="playerTopbar">
        <button className="primaryButton" onClick={onClose} data-tv-focusable={tvMode ? "true" : undefined}>
          <ArrowLeft aria-hidden="true" />
          Back to GoTube
        </button>
        <div className="playerTitleBlock">
          <strong>{video.title}</strong>
          {video.channel_title ? <span>{video.channel_title}</span> : null}
        </div>
        <button
          className="iconButton"
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
          onClick={togglePlayback}
          data-tv-focusable={tvMode ? "true" : undefined}
          data-tv-player-tap={tvMode ? "true" : undefined}
          data-tv-player-direct={useDirectTvEmbed ? "true" : undefined}
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
      </div>
      <div className="playerSurface">
        <div
          className="playerFrame"
          ref={frameRef}
          data-tv-focusable={tvMode ? "true" : undefined}
          data-tv-player-stage={tvMode ? "true" : undefined}
          data-tv-player-direct={useDirectTvEmbed ? "true" : undefined}
          tabIndex={tvMode ? 0 : undefined}
          role={tvMode ? "button" : undefined}
          aria-label="Video player"
        >
          <div className="playerFrameSizer" aria-hidden="true" />
          <div className="playerEmbedMount" ref={containerRef}>
            {tvEmbedSrc ? (
              <iframe
                ref={directIframeRef}
                title={video.title}
                src={tvEmbedSrc}
                allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                allowFullScreen
                onLoad={() => {
                  setReady(true);
                  listenToDirectPlayer();
                  scheduleTvPlaybackQuality();
                  scheduleDirectPlayerSnapshot();
                }}
              />
            ) : null}
          </div>
          {seekFeedback ? (
            <div className="playerSeekFeedback">
              <strong>{seekFeedback.amountLabel}</strong>
              <span>{seekFeedback.targetLabel}</span>
            </div>
          ) : null}
        </div>
        {tvMode ? (
          <div className={["playerTvControls", fullscreen && !controlsVisible ? "playerTvControlsHidden" : ""].filter(Boolean).join(" ")}>
            <div className="playerTvProgress" aria-label="Playback progress">
              <span>{seekFeedback ? seekFeedback.amountLabel : formatDuration(currentSeconds)}</span>
              <div className="playerTvProgressTrack">
                <span style={{ width: `${progressPercent}%` }} />
              </div>
              <span>{seekFeedback ? seekFeedback.targetLabel : (durationLabel ?? "--:--")}</span>
            </div>
            <div className="playerTvButtonRow">
              <button
                className="secondaryButton"
                type="button"
                onClick={() => seekBy(-TV_SEEK_SECONDS)}
                data-tv-focusable="true"
                data-tv-player-control="true"
                disabled={!ready}
              >
                <Rewind aria-hidden="true" />
                30s
              </button>
              <button
                className="primaryButton"
                type="button"
                onClick={togglePlayback}
                data-tv-focusable="true"
                data-tv-player-control="true"
                data-tv-player-tap="true"
                data-tv-player-direct={useDirectTvEmbed ? "true" : undefined}
                disabled={!ready}
                ref={playbackButtonRef}
              >
                {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                {useDirectTvEmbed ? "Play/Pause" : playing ? "Pause" : "Play"}
              </button>
              <button
                className="secondaryButton"
                type="button"
                onClick={() => seekBy(TV_SEEK_SECONDS)}
                data-tv-focusable="true"
                data-tv-player-control="true"
                disabled={!ready}
              >
                <FastForward aria-hidden="true" />
                30s
              </button>
              <button
                className="secondaryButton"
                type="button"
                onClick={openYouTubeSignIn}
                data-tv-focusable="true"
                data-tv-player-control="true"
                data-tv-youtube-signin="true"
              >
                <LogIn aria-hidden="true" />
                Sign In
              </button>
              <button
                className="secondaryButton"
                type="button"
                onClick={toggleFullscreen}
                data-tv-focusable="true"
                data-tv-player-control="true"
                data-tv-player-fullscreen="true"
              >
                {fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
                {fullscreen ? "Exit" : "Full"}
              </button>
            </div>
          </div>
        ) : null}
        <section className="playerDetails" aria-label="Video details">
          <div>
            <h2>{video.title}</h2>
            <div className="playerDetailsMeta">
              {onChannelOpen ? (
                <button
                  className="playerChannelButton"
                  type="button"
                  onClick={() => {
                    void onChannelOpen(video);
                  }}
                >
                  {channelLabel}
                </button>
              ) : (
                <span>{channelLabel}</span>
              )}
              {video.published_at ? <span>{formatDate(video.published_at)}</span> : null}
              {durationLabel ? <span>{durationLabel}</span> : null}
              {video.is_short ? <span className="playerShortBadge">Short</span> : null}
            </div>
          </div>
          {video.description ? (
            <p className="playerDescription">
              <LinkifiedText text={video.description} />
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
