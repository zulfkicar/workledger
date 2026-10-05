window.WORKLEDGER_DEMO =
  document.documentElement.dataset.demo === "true" ||
  new URLSearchParams(location.search).get("demo") === "1";
