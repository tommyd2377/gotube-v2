import { ArrowLeft, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDate, formatDuration } from "../lib/format";
import { focusFirstTvElement, focusNearestTvElement, type TvDirectionKey } from "../lib/tvFocus";
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
  }
}

interface YouTubePlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  destroy: () => void;
}

let apiPromise: Promise<void> | null = null;

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

interface PlayerOverlayProps {
  video: Video;
  tvMode?: boolean;
  onClose: () => void;
  onProgress?: (video: Video, progressSeconds: number, completed: boolean) => void | Promise<void>;
  onChannelOpen?: (video: Video) => void | Promise<void>;
}

export function PlayerOverlay({ video, tvMode = false, onClose, onProgress, onChannelOpen }: PlayerOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const lastSavedProgressRef = useRef(video.progress_seconds ?? 0);
  const [playing, setPlaying] = useState(false);
  const channelLabel = video.channel_title ?? "Saved channel";
  const durationLabel = video.duration_seconds ? formatDuration(video.duration_seconds) : null;
  const resumeSeconds = video.completed ? 0 : Math.floor(video.progress_seconds ?? 0);

  function currentProgressSeconds() {
    const current = playerRef.current?.getCurrentTime();
    return typeof current === "number" && Number.isFinite(current) ? Math.max(0, Math.floor(current)) : 0;
  }

  function saveCurrentProgress(completed = false) {
    if (!onProgress) {
      return;
    }

    const progressSeconds = completed ? (video.duration_seconds ?? currentProgressSeconds()) : currentProgressSeconds();
    if (!completed && progressSeconds < 5) {
      return;
    }

    if (!completed && Math.abs(progressSeconds - lastSavedProgressRef.current) < 10) {
      return;
    }

    lastSavedProgressRef.current = progressSeconds;
    void onProgress(video, progressSeconds, completed);
  }

  useEffect(() => {
    let disposed = false;

    loadYouTubeApi().then(() => {
      if (disposed || !containerRef.current || !window.YT?.Player) {
        return;
      }

      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId: video.youtube_video_id,
        host: "https://www.youtube-nocookie.com",
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
              if (resumeSeconds > 5) {
                event.target.seekTo(resumeSeconds, true);
              }
            },
            onStateChange: (event) => {
              setPlaying(event.data === window.YT?.PlayerState.PLAYING);
              if (event.data === window.YT?.PlayerState.ENDED) {
                saveCurrentProgress(true);
              }
            }
          }
        });
    });

    return () => {
      disposed = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [resumeSeconds, video.youtube_video_id]);

  useEffect(() => {
    if (!onProgress) {
      return;
    }

    const interval = window.setInterval(() => saveCurrentProgress(false), 15000);
    return () => {
      window.clearInterval(interval);
      saveCurrentProgress(false);
    };
  }, [onProgress, video]);

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
    function onKeyDown(event: KeyboardEvent) {
      if (tvMode && ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        if (overlayRef.current) {
          focusNearestTvElement(event.key as TvDirectionKey, overlayRef.current);
        }
      }

      if (event.key === "Enter" && tvMode) {
        const active = document.activeElement as HTMLElement | null;
        if (active?.dataset.tvFocusable === "true") {
          event.preventDefault();
          active.click();
        }
      }

      if (event.key === "Escape" || event.key === "Backspace") {
        event.preventDefault();
        onClose();
      }

      if (event.key === " ") {
        event.preventDefault();
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
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, tvMode]);

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
    <div className={tvMode ? "playerOverlay playerOverlayTv" : "playerOverlay"} role="dialog" aria-label="Video player" ref={overlayRef}>
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
          onClick={() => {
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
          }}
          data-tv-focusable={tvMode ? "true" : undefined}
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
      </div>
      <div className="playerSurface">
        <div className="playerFrame">
          <div className="playerFrameSizer" aria-hidden="true" />
          <div className="playerEmbedMount" ref={containerRef} />
        </div>
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
