(function () {
  "use strict";

  // This TV's WebView stalls on some AV1 streams despite a healthy buffer.
  // Let YouTube adapt resolution using its remaining VP9/H.264 formats.
  if (window.top === window || location.origin !== "https://www.youtube.com" ||
      !location.pathname.startsWith("/embed/") || window.__goTubeCodecCompat) {
    return;
  }
  window.__goTubeCodecCompat = true;

  function isAv1(type) {
    return typeof type === "string" && /(?:^|[=,\s"'])av01(?:\.[a-z0-9.]+)?(?=$|[,\s"';])/i.test(type);
  }

  function restrictCapability(target, method, unsupported) {
    if (!target || typeof target[method] !== "function") {
      return;
    }
    var original = target[method];
    target[method] = function () {
      var result = original.apply(this, arguments);
      return isAv1(arguments[0]) ? unsupported : result;
    };
  }

  restrictCapability(window.MediaSource, "isTypeSupported", false);
  restrictCapability(window.HTMLMediaElement && window.HTMLMediaElement.prototype, "canPlayType", "");

  var capabilities = navigator.mediaCapabilities;
  if (capabilities && typeof capabilities.decodingInfo === "function") {
    var decodingInfo = capabilities.decodingInfo;
    capabilities.decodingInfo = function (configuration) {
      var result = decodingInfo.apply(this, arguments);
      if (!configuration || !configuration.video || !isAv1(configuration.video.contentType)) {
        return result;
      }
      return result.then(function (info) {
        return Object.assign({}, info, { supported: false, smooth: false, powerEfficient: false });
      });
    };
  }

  console.info("[GoTubePlayer] codec-compat: AV1 capability excluded");
}());
