export function showBootError(error: unknown) {
  console.error("Glacier startup failed", error);
  const root = document.getElementById("root");
  if (!root) return;
  const panel = document.createElement("section");
  panel.id = "boot-error";
  panel.setAttribute("role", "alert");
  const heading = document.createElement("h1");
  heading.textContent = "Glacier EQ could not start";
  const message = document.createElement("p");
  message.textContent =
    "Try reopening the app. Your saved profiles have not been changed.";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry";
  retry.addEventListener("click", () => window.location.reload());
  panel.append(heading, message, retry);
  root.replaceChildren(panel);
  retry.focus();
}
