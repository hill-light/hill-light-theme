/* ==========================================================================
   山色 / Hill Light · four-season theme controller
   The inline script in <head> applies the first paint. This file takes over:
   buttons, storage, the 30-minute clock check, and the styleguide compare.
   ========================================================================== */
(function () {
  "use strict";

  var STORAGE_KEY = "hill-light-theme";
  var THEMES = ["dawn", "noon", "dusk", "night"];
  var LABELS = {
    dawn: { full: "溪山晓雾", short: "晓雾", span: "清晨 06:00–10:59" },
    noon: { full: "溪山午荫", short: "午荫", span: "正午 11:00–16:59" },
    dusk: { full: "溪山暮烟", short: "暮烟", span: "黄昏 17:00–19:59" },
    night: { full: "溪山夜月", short: "夜月", span: "夜晚 20:00–05:59" }
  };
  var SOURCE_TEXT = {
    auto: "按本地时间",
    manual: "已手动选择",
    preview: "单次预览"
  };

  var root = document.documentElement;
  var buttons = Array.prototype.slice.call(document.querySelectorAll("[data-theme-choice]"));
  var nameOutputs = Array.prototype.slice.call(document.querySelectorAll("[data-theme-label]"));
  var sourceOutputs = Array.prototype.slice.call(document.querySelectorAll("[data-theme-source-label]"));
  var status = document.getElementById("theme-status");

  function isTheme(value) {
    return THEMES.indexOf(value) !== -1;
  }

  function byHour(hour) {
    if (hour >= 6 && hour < 11) return "dawn";
    if (hour >= 11 && hour < 17) return "noon";
    if (hour >= 17 && hour < 20) return "dusk";
    return "night";
  }

  function savedTheme() {
    try {
      var value = window.localStorage.getItem(STORAGE_KEY);
      return isTheme(value) ? value : null;
    } catch (error) {
      return null;
    }
  }

  function urlTheme() {
    try {
      var value = new URLSearchParams(window.location.search).get("theme");
      return isTheme(value) ? value : null;
    } catch (error) {
      return null;
    }
  }

  function metaColor() {
    var sheet = getComputedStyle(root);
    return sheet.getPropertyValue("--bg").trim();
  }

  function paint(theme, source) {
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-source", source);
    root.style.colorScheme = theme === "night" ? "dark" : "light";

    var themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor && metaColor()) {
      themeColor.setAttribute("content", metaColor());
    }

    buttons.forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.getAttribute("data-theme-choice") === theme));
    });

    if (nameOutputs.length) {
      nameOutputs.forEach(function (output) {
        output.textContent = LABELS[theme].full;
      });
    }
    if (sourceOutputs.length) {
      sourceOutputs.forEach(function (output) {
        output.textContent = SOURCE_TEXT[source] || SOURCE_TEXT.auto;
      });
    }
  }

  function setTheme(theme, source, persist) {
    if (!isTheme(theme)) return;
    paint(theme, source);
    if (persist) {
      try {
        window.localStorage.setItem(STORAGE_KEY, theme);
      } catch (error) {
        /* private mode: the theme still applies for this page */
      }
    }
    if (status) {
      status.textContent = "已切换到" + LABELS[theme].full + "，" + LABELS[theme].span + "。";
    }
  }

  function clearPreviewParam() {
    if (!window.history || !window.history.replaceState) return;
    try {
      var url = new URL(window.location.href);
      if (!url.searchParams.has("theme")) return;
      url.searchParams.delete("theme");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch (error) {
      /* keep the URL; the click still applies */
    }
  }

  buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      clearPreviewParam();
      setTheme(button.getAttribute("data-theme-choice"), "manual", true);
    });
  });

  /* First paint was set inline; synchronise labels and color-scheme. */
  var initialTheme = root.getAttribute("data-theme");
  var initialSource = root.getAttribute("data-theme-source");
  paint(isTheme(initialTheme) ? initialTheme : "dawn", initialSource || (savedTheme() ? "manual" : "auto"));

  /* Re-check the clock only while the reader has not chosen a theme. */
  var timer = window.setInterval(function () {
    if (savedTheme() || urlTheme()) return;
    var next = byHour(new Date().getHours());
    if (next !== root.getAttribute("data-theme")) {
      paint(next, "auto");
    }
  }, 30 * 60 * 1000);

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible" || savedTheme() || urlTheme()) return;
    var next = byHour(new Date().getHours());
    if (next !== root.getAttribute("data-theme")) {
      paint(next, "auto");
    }
  });

  window.addEventListener("storage", function (event) {
    if (event.key !== STORAGE_KEY) return;
    var next = savedTheme();
    paint(next || byHour(new Date().getHours()), next ? "manual" : "auto");
  });

  window.addEventListener("pagehide", function () {
    window.clearInterval(timer);
  });

  /* Styleguide: CSS-only split comparison of dawn and night. */
  var compareToggle = document.querySelector("[data-compare-toggle]");
  var compare = document.getElementById("compare");
  if (compareToggle && compare) {
    compareToggle.addEventListener("click", function () {
      var open = compareToggle.getAttribute("aria-pressed") === "true";
      var next = !open;
      compareToggle.setAttribute("aria-pressed", String(next));
      compareToggle.textContent = next ? "收起并排对比" : "并排对比 · 晓雾 / 夜月";
      compare.hidden = !next;
      if (next) {
        compare.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  }
})();
