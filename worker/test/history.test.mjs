import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/index.js";

const SYNC_KEY = "test-sync-key";
const SUPABASE_URL = "https://example.supabase.co";

async function withHistoryData({ watched, channels = [], videos = [] }, run) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const videosById = new Map(videos.map((video) => [video.youtube_video_id, video]));

  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    assert.equal(url.origin, SUPABASE_URL, "History must not call YouTube or other services");
    assert.equal(init?.method ?? "GET", "GET", "History must only read saved data");

    let data;
    if (url.pathname === "/rest/v1/watched_videos") {
      data = watched;
    } else if (url.pathname === "/rest/v1/channels") {
      data = channels;
    } else if (url.pathname === "/rest/v1/videos") {
      const filter = url.searchParams.get("youtube_video_id");
      assert.match(filter, /^in\.\(.+\)$/);
      const ids = filter.slice(4, -1).split(",");
      data = ids.map((id) => videosById.get(id)).filter(Boolean).reverse();
    } else {
      assert.fail(`Unexpected history request: ${url.pathname}`);
    }
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const response = await worker.fetch(
      new Request("https://gotube.test/api/watched", {
        headers: { "x-gotube-sync-key": SYNC_KEY }
      }),
      {
        GOTUBE_SYNC_KEY: SYNC_KEY,
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test_key",
        SUPABASE_URL
      }
    );
    assert.equal(response.status, 200);
    await run(await response.json(), calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("history includes partial progress, old videos, hidden channels, and missing metadata", async () => {
  const watched = [
    { youtube_video_id: "history0001", watched_at: "2026-10-17T19:00:00Z", progress_seconds: 123, completed: false },
    { youtube_video_id: "history0002", watched_at: "2026-10-16T19:00:00Z", progress_seconds: 3600, completed: true },
    { youtube_video_id: "history0003", watched_at: "2026-10-15T19:00:00Z", progress_seconds: 12, completed: false }
  ];
  const channels = [
    { youtube_channel_id: "hidden-channel", title: "Archived channel", hidden: true, thumbnail_url: "https://example.test/channel.png" }
  ];
  const videos = [
    { youtube_video_id: "history0001", youtube_channel_id: "current-channel", title: "Recent video", duration_seconds: 1800, channel_title: "Stored channel title" },
    { youtube_video_id: "history0002", youtube_channel_id: "hidden-channel", title: "Old video", duration_seconds: 3600, published_at: "2005-01-01T00:00:00Z" }
  ];

  await withHistoryData({ watched, channels, videos }, ({ items }, calls) => {
    assert.deepEqual(items.map(({ video, ...item }) => item), watched);
    assert.equal(items[0].video.youtube_video_id, "history0001");
    assert.equal(items[0].video.channel_title, "Stored channel title");
    assert.equal(items[0].video.progress_seconds, 123);
    assert.equal(items[0].video.completed, false);
    assert.equal(items[1].video.title, "Old video");
    assert.equal(items[1].video.published_at, "2005-01-01T00:00:00Z");
    assert.equal(items[1].video.channel_title, "Archived channel");
    assert.equal(items[1].video.channel_thumbnail_url, "https://example.test/channel.png");
    assert.equal(items[1].video.completed, true);
    assert.equal("video" in items[2], false, "A missing video must retain its watched record");
    const channelCall = calls.find(({ url }) => url.pathname === "/rest/v1/channels");
    assert.equal(channelCall.url.searchParams.has("hidden"), false);
    const watchedCall = calls.find(({ url }) => url.pathname === "/rest/v1/watched_videos");
    assert.equal(watchedCall.url.searchParams.get("order"), "watched_at.desc");
    const videoCall = calls.find(({ url }) => url.pathname === "/rest/v1/videos");
    assert.equal(videoCall.url.searchParams.get("youtube_video_id"), "in.(history0001,history0002,history0003)");
    assert.equal(calls.length, 3);
  });
});

test("empty history skips metadata and channel lookups", async () => {
  await withHistoryData({ watched: [] }, (body, calls) => {
    assert.deepEqual(body, { items: [] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.pathname, "/rest/v1/watched_videos");
  });
});

test("history resolves metadata beyond one video lookup batch", async () => {
  const watched = Array.from({ length: 101 }, (_, index) => ({
    youtube_video_id: String(index).padStart(11, "0"),
    watched_at: "2026-10-17T19:00:00Z",
    progress_seconds: index,
    completed: false
  }));
  const videos = watched.map((item, index) => ({
    youtube_video_id: item.youtube_video_id,
    youtube_channel_id: "saved-channel",
    title: `Saved video ${index}`,
    duration_seconds: 1800
  }));

  await withHistoryData({ watched, videos }, ({ items }, calls) => {
    assert.equal(items.length, watched.length);
    assert.deepEqual(items.map((item) => item.video.youtube_video_id), watched.map((item) => item.youtube_video_id));
    const videoCalls = calls.filter(({ url }) => url.pathname === "/rest/v1/videos");
    assert.equal(videoCalls.length, 2);
    assert.deepEqual(videoCalls.map(({ url }) => Number(url.searchParams.get("limit"))), [100, 1]);
    assert.equal(items[100].video.title, "Saved video 100");
    assert.equal(items[100].video.progress_seconds, 100);
  });
});

async function withSearchData({ query, searchItems = [], videoItems }, run) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const savedRows = [];

  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    let data;
    if (url.origin === "https://www.googleapis.com" && url.pathname === "/youtube/v3/search") {
      assert.equal(init?.method ?? "GET", "GET");
      data = { items: searchItems };
    } else if (url.origin === "https://www.googleapis.com" && url.pathname === "/youtube/v3/videos") {
      assert.equal(init?.method ?? "GET", "GET");
      data = { items: videoItems };
    } else if (url.origin === SUPABASE_URL && url.pathname === "/rest/v1/videos") {
      assert.equal(init?.method, "POST");
      assert.equal(url.searchParams.get("on_conflict"), "youtube_video_id");
      const rows = JSON.parse(init.body);
      savedRows.push(...rows);
      data = rows;
    } else {
      assert.fail(`Unexpected search request: ${url.origin}${url.pathname}`);
    }
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const response = await worker.fetch(
      new Request(`https://gotube.test/api/search?type=video&q=${encodeURIComponent(query)}`, {
        headers: { "x-gotube-sync-key": SYNC_KEY }
      }),
      {
        GOTUBE_SYNC_KEY: SYNC_KEY,
        YOUTUBE_API_KEY: "fake-youtube-key",
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test_key",
        SUPABASE_URL
      }
    );
    assert.equal(response.status, 200);
    await run(await response.json(), calls, savedRows);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function youtubeVideo(id, title, duration = "PT30M") {
  return {
    id,
    snippet: {
      channelId: "search-channel",
      channelTitle: "Search channel",
      title,
      description: "Already fetched metadata",
      publishedAt: "2026-10-01T12:00:00Z",
      thumbnails: { high: { url: "https://example.test/video.jpg", width: 480, height: 360 } }
    },
    contentDetails: { duration }
  };
}

function assertSavedVideoColumns(row) {
  assert.deepEqual(Object.keys(row).sort(), [
    "youtube_video_id", "youtube_channel_id", "title", "description", "thumbnail_url",
    "duration_seconds", "published_at", "is_short", "channel_title", "fetched_at"
  ].sort());
  assert.equal("type" in row, false, "Search-only result fields must not become database columns");
  assert.equal(Number.isNaN(Date.parse(row.fetched_at)), false);
}

test("exact video URL search persists fetched metadata without another YouTube request", async () => {
  const video = youtubeVideo("search00001", "Exact video");
  await withSearchData({
    query: "https://www.youtube.com/watch?v=search00001",
    videoItems: [video]
  }, ({ results }, calls, savedRows) => {
    assert.equal(results.length, 1);
    assert.equal(results[0].type, "video");
    assert.equal(results[0].title, "Exact video");
    assert.equal(savedRows.length, 1);
    assertSavedVideoColumns(savedRows[0]);
    assert.equal(savedRows[0].youtube_video_id, "search00001");
    assert.equal(savedRows[0].channel_title, "Search channel");
    assert.equal(savedRows[0].duration_seconds, 1800);
    assert.deepEqual(calls.map(({ url }) => url.pathname), ["/youtube/v3/videos", "/rest/v1/videos"]);
    assert.equal(calls[0].url.searchParams.get("id"), "search00001");
  });
});

test("query video search persists returned metadata and omits Shorts without extra YouTube requests", async () => {
  const regular = youtubeVideo("search00001", "Detailed video title");
  const short = youtubeVideo("search00002", "Brief clip", "PT30S");
  await withSearchData({
    query: "interesting videos",
    searchItems: [regular, short].map((video) => ({ id: { videoId: video.id }, snippet: video.snippet })),
    videoItems: [regular, short]
  }, ({ results }, calls, savedRows) => {
    assert.deepEqual(results.map((result) => result.youtube_video_id), ["search00001"]);
    assert.equal(savedRows.length, 1);
    assertSavedVideoColumns(savedRows[0]);
    assert.equal(savedRows[0].title, "Detailed video title");
    assert.equal(savedRows[0].description, "Already fetched metadata");
    assert.equal(savedRows[0].duration_seconds, 1800);
    assert.deepEqual(calls.map(({ url }) => url.pathname), ["/youtube/v3/search", "/youtube/v3/videos", "/rest/v1/videos"]);
    assert.equal(calls[0].url.searchParams.get("q"), "interesting videos");
    assert.equal(calls[1].url.searchParams.get("id"), "search00001,search00002");
  });
});
