(function () {
  const savedTheme = localStorage.getItem("engineeringDashboard.theme");
  document.documentElement.dataset.theme = savedTheme === "light" ? "light" : "dark";
})();
