export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const hours = (minutes) => `${(Number(minutes || 0) / 60).toFixed(1)}h`;
export const initials = (name) =>
  String(name)
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
export const date = (value) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
const paths = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  clock: "M12 8v4l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  chart: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 4l3 1 5-2 5 2 3-1 1 4-1 4 1 4-1 4-3-1-5 2-5-2-3 1-1-4 1-4-1-4z",
  plus: "M12 5v14 M5 12h14",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  play: "m8 5 11 7-11 7z",
  stop: "M6 6h12v12H6z",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12 M18 6 6 18",
  logout: "M9 4H4v16h5 M13 8l4 4-4 4 M8 12h13",
  brief: "M6 3h12v18H6z M9 8h6 M9 12h6 M9 16h4",
  chevron: "m9 6 6 6-6 6",
  search: "M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
};
export const icon = (name) =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.grid}"/></svg>`;
export const statusLabel = (s) =>
  ({
    todo: "To do",
    in_progress: "In progress",
    blocked: "Blocked",
    done: "Done",
  })[s] || s;
export const pill = (s) =>
  `<span class="pill ${escape(s)}"><i></i>${escape(statusLabel(s))}</span>`;
export function bars(rows, max = 0) {
  const largest = max || Math.max(1, ...rows.map((r) => r.minutes));
  return rows
    .map(
      (r) =>
        `<div class="bar-row"><div><span>${escape(r.name)}</span><strong>${hours(r.minutes)}</strong></div><div class="bar-track"><span style="width:${Math.max(2, (r.minutes / largest) * 100)}%;background:${escape(r.color || "#4263eb")}"></span></div></div>`,
    )
    .join("");
}
export function columns(rows) {
  const max = Math.max(1, ...rows.map((r) => r.minutes));
  return `<div class="columns" role="img" aria-label="Logged hours by day">${rows.map((r) => `<div class="column"><span title="${escape(r.date)}: ${hours(r.minutes)}" style="height:${Math.max(3, (r.minutes / max) * 110)}px"></span><small>${new Date(r.date + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2)}</small></div>`).join("")}</div>`;
}
export function toast(message, error = false) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.className = `visible ${error ? "error" : ""}`;
  clearTimeout(window.toastTimeout);
  window.toastTimeout = setTimeout(() => (el.className = ""), 4000);
}
export function dialog(title, body, onSubmit) {
  const modal = document.querySelector("#dialog");
  document.querySelector("#dialog-body").innerHTML =
    `<div class="dialog-heading"><h2>${escape(title)}</h2><button class="icon-button" type="button" data-close aria-label="Close dialog">${icon("close")}</button></div>${body}`;
  modal.showModal();
  modal.querySelector("[data-close]").onclick = () => modal.close();
  const form = modal.querySelector("form");
  if (form && onSubmit)
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = form.querySelector("[type=submit]");
      button.disabled = true;
      form
        .querySelectorAll("[aria-invalid]")
        .forEach((el) => el.removeAttribute("aria-invalid"));
      try {
        await onSubmit(new FormData(form));
        modal.close();
      } catch (error) {
        for (const field of error.fields || []) {
          const input = form.elements.namedItem(field.path);
          if (input) input.setAttribute("aria-invalid", "true");
        }
        toast(error.message, true);
      } finally {
        button.disabled = false;
      }
    };
}
