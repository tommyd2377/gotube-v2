import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const script = readFileSync(new URL("../src/main/assets/youtube-codec-compat.js", import.meta.url), "utf8");

function createPlayer({
  origin = "https://www.youtube.com",
  pathname = "/embed/test-video",
  topLevel = false
} = {}) {
  const calls = { source: [], element: [], decoding: [] };
  const messages = [];
  function record(name, implementation) {
    return function (...args) {
      const call = { receiver: this, args };
      calls[name].push(call);
      call.result = Reflect.apply(implementation, this, args);
      return call.result;
    };
  }
  function HTMLMediaElement() {}
  HTMLMediaElement.prototype.canPlayType = record("element", () => "probably");
  const window = {
    MediaSource: { isTypeSupported: record("source", () => true) },
    HTMLMediaElement
  };
  window.top = topLevel ? window : {};
  const navigator = {
    mediaCapabilities: {
      decodingInfo: record("decoding", configuration => Promise.resolve({
        supported: true,
        smooth: true,
        powerEfficient: true,
        keySystemAccess: null,
        configuration,
        extra: "native metadata"
      }))
    }
  };
  const context = vm.createContext({
    window,
    navigator,
    location: { origin, pathname },
    console: { info: message => messages.push(message) }
  });
  return {
    window,
    navigator,
    calls,
    messages,
    record,
    inject: () => vm.runInContext(script, context, { timeout: 1000 })
  };
}

const av1Types = [
  'video/mp4; codecs="av01.0.09M.08"',
  "video/mp4; codecs=av01.0.09m.08",
  "video/mp4; codecs='AV01.0.09M.08'",
  'video/mp4; codecs="avc1.4d401f, av01.0.09M.08"',
  'video/mp4; codecs="av01.0.09M.08,mp4a.40.2"',
  "video/mp4; codecs=av01; other=1"
];

const otherTypes = [
  'video/webm; codecs="vp09.00.10.08"',
  'video/webm; codecs="vp9"',
  'video/mp4; codecs="avc1.4d401f"',
  'audio/webm; codecs="opus"',
  'audio/mp4; codecs="mp4a.40.2"',
  'video/mp4; codecs="av010.0.09M.08"',
  'video/mp4; codecs="av10.0.09M.08"',
  'video/mp4; codecs="xav01.0.09M.08"',
  'video/mp4; codecs="av01suffix"',
  undefined,
  null,
  { toString: () => 'video/mp4; codecs="av01.0.09M.08"' }
];

test("restricts injection to embedded YouTube player documents", () => {
  const excluded = [
    { topLevel: true },
    { origin: "https://gotube.local" },
    { origin: "https://www.youtube.com.evil.example" },
    { origin: "http://www.youtube.com" },
    { pathname: "/watch" },
    { pathname: "/" },
    { pathname: "/embed" },
    { pathname: "/embedder/test-video" }
  ];
  for (const options of excluded) {
    const player = createPlayer(options);
    const source = player.window.MediaSource.isTypeSupported;
    const element = player.window.HTMLMediaElement.prototype.canPlayType;
    const decoding = player.navigator.mediaCapabilities.decodingInfo;
    player.inject();
    assert.equal(player.window.MediaSource.isTypeSupported, source);
    assert.equal(player.window.HTMLMediaElement.prototype.canPlayType, element);
    assert.equal(player.navigator.mediaCapabilities.decodingInfo, decoding);
    assert.equal(player.window.__goTubeCodecCompat, undefined);
    assert.equal(player.messages.length, 0);
  }
});

test("excludes complete AV1 codec tokens in both synchronous capability APIs", () => {
  const player = createPlayer();
  player.inject();
  const element = new player.window.HTMLMediaElement();
  for (const type of av1Types) {
    assert.equal(player.window.MediaSource.isTypeSupported(type), false, type);
    assert.equal(element.canPlayType(type), "", type);
  }
  assert.equal(player.calls.source.length, av1Types.length);
  assert.equal(player.calls.element.length, av1Types.length);
});

test("passes VP9, H264, audio, nonstrings and similar AV10 tokens through unchanged", () => {
  const player = createPlayer();
  player.inject();
  const element = new player.window.HTMLMediaElement();
  const extra = { extra: true };
  for (const type of otherTypes) {
    assert.equal(player.window.MediaSource.isTypeSupported(type, extra), true);
    assert.equal(element.canPlayType(type, extra), "probably");
    assert.equal(player.calls.source.at(-1).receiver, player.window.MediaSource);
    assert.equal(player.calls.element.at(-1).receiver, element);
    assert.deepEqual(player.calls.source.at(-1).args, [type, extra]);
    assert.deepEqual(player.calls.element.at(-1).args, [type, extra]);
  }
});

test("preserves native capability results and explicit receivers", () => {
  const player = createPlayer();
  const nativeResult = { native: true };
  player.window.MediaSource.isTypeSupported = player.record("source", () => nativeResult);
  player.window.HTMLMediaElement.prototype.canPlayType = player.record("element", () => "maybe");
  player.inject();
  const receiver = {};
  const type = otherTypes[0];
  assert.equal(player.window.MediaSource.isTypeSupported.call(receiver, type), nativeResult);
  assert.equal(player.window.HTMLMediaElement.prototype.canPlayType.call(receiver, type), "maybe");
  assert.equal(player.calls.source[0].receiver, receiver);
  assert.equal(player.calls.element[0].receiver, receiver);
});

test("preserves native synchronous errors, including invalid AV1 calls", () => {
  for (const type of [av1Types[0], otherTypes[0]]) {
    const player = createPlayer();
    const failure = new TypeError("native validation failure");
    const fail = () => { throw failure; };
    player.window.MediaSource.isTypeSupported = player.record("source", fail);
    player.window.HTMLMediaElement.prototype.canPlayType = player.record("element", fail);
    player.navigator.mediaCapabilities.decodingInfo = player.record("decoding", fail);
    player.inject();
    const receiver = {};
    assert.throws(() => player.window.MediaSource.isTypeSupported.call(receiver, type), error => error === failure);
    assert.throws(() => player.window.HTMLMediaElement.prototype.canPlayType.call(receiver, type), error => error === failure);
    const configuration = { video: { contentType: type } };
    assert.throws(() => player.navigator.mediaCapabilities.decodingInfo.call(receiver, configuration), error => error === failure);
    for (const calls of Object.values(player.calls)) {
      assert.equal(calls.length, 1);
      assert.equal(calls[0].receiver, receiver);
    }
  }
});

test("retains native decoding promises, arguments and receivers for all other formats", async () => {
  const player = createPlayer();
  player.inject();
  const receiver = {};
  const extra = { extra: true };
  const configurations = [
    ...otherTypes.map(contentType => ({ video: { contentType } })),
    { audio: { contentType: av1Types[0] } },
    {},
    null,
    undefined
  ];
  for (const configuration of configurations) {
    const result = player.navigator.mediaCapabilities.decodingInfo.call(receiver, configuration, extra);
    const call = player.calls.decoding.at(-1);
    assert.equal(result, call.result);
    assert.equal(call.receiver, receiver);
    assert.deepEqual(call.args, [configuration, extra]);
    assert.equal((await result).supported, true);
  }
});

test("marks AV1 decoding unavailable without mutating native results or losing metadata", async () => {
  const player = createPlayer();
  player.inject();
  for (const contentType of av1Types) {
    const configuration = { type: "media-source", video: { contentType } };
    const result = player.navigator.mediaCapabilities.decodingInfo(configuration);
    const call = player.calls.decoding.at(-1);
    assert.notEqual(result, call.result);
    assert.equal(call.receiver, player.navigator.mediaCapabilities);
    assert.equal(call.args[0], configuration);
    const nativeInfo = await call.result;
    const restrictedInfo = await result;
    assert.equal(restrictedInfo.supported, false);
    assert.equal(restrictedInfo.smooth, false);
    assert.equal(restrictedInfo.powerEfficient, false);
    assert.equal(restrictedInfo.keySystemAccess, null);
    assert.equal(restrictedInfo.configuration, configuration);
    assert.equal(restrictedInfo.extra, "native metadata");
    assert.equal(nativeInfo.supported, true);
    assert.equal(nativeInfo.smooth, true);
    assert.equal(nativeInfo.powerEfficient, true);
  }
});

test("preserves native decoding rejection reasons for AV1 and passthrough formats", async () => {
  for (const contentType of [av1Types[0], otherTypes[0]]) {
    const player = createPlayer();
    const failure = new TypeError("unsupported native decoding configuration");
    player.navigator.mediaCapabilities.decodingInfo = player.record("decoding", () => Promise.reject(failure));
    player.inject();
    const result = player.navigator.mediaCapabilities.decodingInfo({ video: { contentType } });
    assert.equal(player.calls.decoding.length, 1);
    await assert.rejects(result, error => error === failure);
    await assert.rejects(player.calls.decoding[0].result, error => error === failure);
  }
});

test("tolerates absent capability APIs while wrapping those still available", () => {
  const removeApis = [
    player => { delete player.window.MediaSource; },
    player => { delete player.window.HTMLMediaElement; },
    player => { delete player.navigator.mediaCapabilities; },
    player => {
      delete player.window.MediaSource;
      delete player.window.HTMLMediaElement;
      delete player.navigator.mediaCapabilities;
    }
  ];
  for (const remove of removeApis) {
    const player = createPlayer();
    remove(player);
    assert.doesNotThrow(player.inject);
    assert.equal(player.window.__goTubeCodecCompat, true);
    if (player.window.MediaSource) {
      assert.equal(player.window.MediaSource.isTypeSupported(av1Types[0]), false);
    }
    if (player.window.HTMLMediaElement) {
      assert.equal(new player.window.HTMLMediaElement().canPlayType(av1Types[0]), "");
    }
  }
});

test("leaves missing or nonfunction API methods untouched", () => {
  const player = createPlayer();
  player.window.MediaSource.isTypeSupported = undefined;
  player.window.HTMLMediaElement.prototype.canPlayType = null;
  player.navigator.mediaCapabilities.decodingInfo = "unavailable";
  assert.doesNotThrow(player.inject);
  assert.equal(player.window.MediaSource.isTypeSupported, undefined);
  assert.equal(player.window.HTMLMediaElement.prototype.canPlayType, null);
  assert.equal(player.navigator.mediaCapabilities.decodingInfo, "unavailable");
});

test("repeated injection neither stacks wrappers nor repeats initialization", async () => {
  const player = createPlayer();
  player.inject();
  const source = player.window.MediaSource.isTypeSupported;
  const element = player.window.HTMLMediaElement.prototype.canPlayType;
  const decoding = player.navigator.mediaCapabilities.decodingInfo;
  player.inject();
  assert.equal(player.window.MediaSource.isTypeSupported, source);
  assert.equal(player.window.HTMLMediaElement.prototype.canPlayType, element);
  assert.equal(player.navigator.mediaCapabilities.decodingInfo, decoding);
  assert.equal(player.messages.length, 1);
  assert.equal(source(av1Types[0]), false);
  assert.equal(element.call({}, av1Types[0]), "");
  assert.equal((await decoding({ video: { contentType: av1Types[0] } })).supported, false);
  for (const calls of Object.values(player.calls)) {
    assert.equal(calls.length, 1);
  }
});
