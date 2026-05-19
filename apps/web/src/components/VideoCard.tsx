import { Check, Clock, Play } from "lucide-react";
import type { Video, WatchedVideo } from "../lib/types";
import { formatDate, formatDuration } from "../lib/format";
import { LinkifiedText } from "./LinkifiedText";

interface VideoCardProps {
  video: Video;
  watched?: WatchedVideo;
  tvMode?: boolean;
  showRemove?: boolean;
  onPlay: (video: Video) => void;
  onChannelOpen?: (video: Video) => void | Promise<void>;
  onWatchLater?: (video: Video) => void;
  onMarkWatched?: (video: Video) => void;
  onRemove?: (video: Video) => void;
}

export function VideoCard({
  video,
  watched,
  tvMode = false,
  showRemove = false,
  onPlay,
  onChannelOpen,
  onWatchLater,
  onMarkWatched,
  onRemove
}: VideoCardProps) {
  const channelLabel = video.channel_title ?? "Saved channel";
  const progressSeconds = watched?.progress_seconds ?? video.progress_seconds ?? 0;
  const completed = watched?.completed ?? video.completed ?? false;
  const progressPercent =
    video.duration_seconds && progressSeconds > 0 ? Math.min(100, Math.max(0, (progressSeconds / video.duration_seconds) * 100)) : 0;
  const progressLabel = completed
    ? "Watched"
    : progressSeconds > 10
      ? `Resume ${formatDuration(Math.floor(progressSeconds))}`
      : null;

  return (
    <article
      className={tvMode ? "videoCard tvVideoCard" : "videoCard"}
      data-tv-focusable={tvMode ? "true" : undefined}
      tabIndex={tvMode ? 0 : undefined}
      role={tvMode ? "button" : undefined}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onPlay(video);
        }
      }}
    >
      <div className="thumbFrame">
        <button className="thumbButton" onClick={() => onPlay(video)} aria-label={`Play ${video.title}`}>
          <div className="thumbFallback">GoTube</div>
          {video.thumbnail_url ? (
            <img
              src={video.thumbnail_url}
              alt=""
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
          ) : null}
          {video.is_short ? <span className="badge">Short</span> : null}
        </button>
      </div>
      <div className="videoBody">
        <h3>{video.title}</h3>
        <p className="metaLine">
          {onChannelOpen ? (
            <button
              className="channelNameButton"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void onChannelOpen(video);
              }}
            >
              {channelLabel}
            </button>
          ) : (
            channelLabel
          )}
          {video.published_at ? ` · ${formatDate(video.published_at)}` : ""}
          {video.duration_seconds ? ` · ${formatDuration(video.duration_seconds)}` : ""}
        </p>
        {video.description ? (
          <p className="description">
            <LinkifiedText text={video.description} />
          </p>
        ) : null}
        {progressLabel ? (
          <div className="videoProgress" aria-label={progressLabel}>
            <div className="videoProgressMeta">
              <span>{progressLabel}</span>
              {progressPercent > 0 && !completed ? <span>{Math.round(progressPercent)}%</span> : null}
            </div>
            {progressPercent > 0 ? (
              <div className="videoProgressTrack">
                <span style={{ width: `${completed ? 100 : progressPercent}%` }} />
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="buttonRow">
          <button className="primaryButton" onClick={() => onPlay(video)} data-tv-focusable={tvMode ? "true" : undefined}>
            <Play aria-hidden="true" />
            Play
          </button>
          {onWatchLater ? (
            <button className="secondaryButton" onClick={() => onWatchLater(video)} data-tv-focusable={tvMode ? "true" : undefined}>
              <Clock aria-hidden="true" />
              Watch Later
            </button>
          ) : null}
          {onMarkWatched ? (
            <button className="secondaryButton" onClick={() => onMarkWatched(video)} data-tv-focusable={tvMode ? "true" : undefined}>
              <Check aria-hidden="true" />
              Mark Watched
            </button>
          ) : null}
          {showRemove && onRemove ? (
            <button className="dangerButton" onClick={() => onRemove(video)} data-tv-focusable={tvMode ? "true" : undefined}>
              Remove
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
