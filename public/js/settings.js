async function loadSettings() {
  const result = await api(`/api/settings`);
  const settings = result.settings;

  const form = document.getElementById("settings-form");
  form.elements.displayName.value = settings.displayName;
  form.elements.theme.value = settings.theme;
  form.elements.statusMessage.value = settings.statusMessage;
  form.elements.emailOptIn.checked = Boolean(settings.emailOptIn);

  const preview = document.getElementById("status-preview");
  preview.innerHTML = "";

  const nameEl = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = settings.displayName;
  nameEl.appendChild(strong);

  const statusEl = document.createElement("p");
  statusEl.textContent = settings.statusMessage;

  preview.appendChild(nameEl);
  preview.appendChild(statusEl);

  writeJson("settings-output", settings);
}

(async function bootstrapSettings() {
  try {
    const user = await loadCurrentUser();

    if (!user) {
      writeJson("settings-output", { error: "Please log in first." });
      return;
    }

    await loadSettings();
  } catch (error) {
    writeJson("settings-output", { error: error.message });
  }
})();

document.getElementById("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(event.currentTarget);
  const csrfToken = await getCsrfToken();

  const payload = {
    displayName: formData.get("displayName"),
    theme: formData.get("theme"),
    statusMessage: formData.get("statusMessage"),
    emailOptIn: formData.get("emailOptIn") === "on",
    csrfToken
  };

  const result = await api("/api/settings", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  writeJson("settings-output", result);
  await loadSettings();
});

document.getElementById("enable-email").addEventListener("click", async () => {
  const csrfToken = await getCsrfToken();

  const result = await api("/api/settings/toggle-email", {
    method: "POST",
    body: JSON.stringify({ enabled: 1, csrfToken })
  });

  writeJson("settings-output", result);
});

document.getElementById("disable-email").addEventListener("click", async () => {
  const csrfToken = await getCsrfToken();

  const result = await api("/api/settings/toggle-email", {
    method: "POST",
    body: JSON.stringify({ enabled: 0, csrfToken })
  });

  writeJson("settings-output", result);
});