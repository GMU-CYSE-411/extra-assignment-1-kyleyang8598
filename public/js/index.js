(async function bootstrapHome() {
  try {
    const user = await loadCurrentUser();
    writeJson("session-box", user || { anonymous: true });

    if (!user || user.role !== "admin") {
      document.getElementById("admin-link").style.display = "none";
    }
  } catch (error) {
    writeJson("session-box", { error: error.message });
  }
})();
