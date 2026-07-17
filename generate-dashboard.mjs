import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const runDate = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate || "")) throw new Error("Usage: node generate-dashboard.mjs YYYY-MM-DD");

const definitions = [
  ["fco", "FCO Talent (UK Foreign Office)"],
  ["british_council", "British Council"],
  ["exteriores", "Embajada de España en México"],
  ["franz_mayer", "Museo Franz Mayer"],
  ["museo_tamayo", "Museo Tamayo"],
  ["alianza_mx", "Alianza Francesa de México (.edu.mx)"],
  ["alianza_org", "Alianza Francesa (.org.mx)"],
  ["ifal", "IFAL"],
  ["ireland", "Embajada de Irlanda en México"],
  ["jumex", "Fundación Jumex"],
];

const warnings = [
  { site: "monitor", message: "WebFetch falló para Exteriores (403), Alianza Francesa .edu.mx (timeout) y FCO (URL no procesable); los tres se validaron correctamente con navegador y sus snapshots quedaron actualizados al 2026-07-17." },
  { site: "fco", message: "El URL actual NO está filtrando solo por México. Devuelve vacantes en LatAm general; se clasificaron como fuera de scope las de otras ciudades." },
  { site: "ifal", message: "Dos anuncios siguen visibles con fecha 15 de julio; se marcaron cerrados por deadline pasado. El detalle de “Stagiaire en coopération éducative” conserva texto antiguo de enero." },
];

const failed = new Set();
const sites = definitions.map(([key, name]) => {
  const state = JSON.parse(fs.readFileSync(path.join(root, "state", `${key}.json`), "utf8"));
  return {
    key,
    name,
    url: state.url,
    method: state.fetch_method,
    last_checked: state.last_checked,
    failed_today: failed.has(key),
    vacancies: state.vacancies.map(v => ({ ...v, is_new: v.first_seen === runDate })),
  };
});

const all = sites.flatMap(site => site.vacancies.map(v => ({ ...v, site: site.key })));
const active = v => v.status === "active" || v.status === "permanent";
const newToday = all.filter(v => v.first_seen === runDate);
const closedToday = all.filter(v => v.status === "closed" && (v.notes || "").includes(runDate));
const summary = {
  sites_checked: definitions.length,
  sites_with_error: failed.size,
  relevant_active: all.filter(v => v.relevance === "in_scope" && active(v)).length,
  out_of_scope: all.filter(v => v.relevance === "out_of_scope").length,
  closed: all.filter(v => v.status === "closed").length,
  new_today: newToday.length,
  removed_today: closedToday.length,
};

const data = { last_run: runDate, warnings, summary, sites };
fs.writeFileSync(path.join(root, "dashboard-data.json"), `${JSON.stringify(data, null, 2)}\n`);

const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const daysUntil = deadline => deadline ? Math.ceil((new Date(`${deadline}T12:00:00Z`) - new Date(`${runDate}T12:00:00Z`)) / 86400000) : null;

function card(v, siteKey) {
  const classes = ["vacancy", v.status === "closed" && "closed", v.relevance === "out_of_scope" && "out-of-scope"].filter(Boolean).join(" ");
  const badges = [
    v.is_new && '<span class="badge badge-new">Nueva</span>',
    v.status === "permanent" && '<span class="badge badge-permanent">Permanente</span>',
    v.status === "closed" && '<span class="badge badge-closed">Cerrada</span>',
    v.relevance === "out_of_scope" && '<span class="badge badge-out-of-scope">Fuera de scope</span>',
  ].filter(Boolean).join(" ");
  const due = daysUntil(v.deadline);
  const deadline = v.deadline ? `<span${due >= 0 && due <= 7 ? ' class="deadline-soon"' : ""}>Deadline: ${escape(v.deadline)}</span>` : "<span>Sin deadline</span>";
  const meta = [v.location && `<span>${escape(v.location)}</span>`, `<span>${deadline}</span>`, `<span>Vista desde: ${escape(v.first_seen)}</span>`].filter(Boolean).join("");
  const contacts = v.contact_emails?.length ? ` Contacto: ${v.contact_emails.join(", ")}` : "";
  const notes = v.notes || contacts ? `<div class="vacancy-notes">${escape(`${v.notes || ""}${contacts}`.trim())}</div>` : "";
  return `<div class="${classes}" data-vacancy-id="${escape(v.id)}" data-source-site="${escape(siteKey)}">
  <div class="vacancy-title"><a href="${escape(v.apply_url)}" target="_blank">${escape(v.display_title || v.title)}</a>${badges ? ` ${badges}` : ""}</div>
  <div class="vacancy-meta">${meta}</div>${notes ? `
  ${notes}` : ""}
</div>`;
}

function siteBlock(site) {
  const relevant = site.vacancies.filter(v => v.relevance === "in_scope" && active(v)).length;
  const out = site.vacancies.filter(v => v.relevance === "out_of_scope").length;
  const closed = site.vacancies.filter(v => v.status === "closed").length;
  const count = `${relevant} relevantes · ${out} fuera scope · ${closed} cerradas`;
  const body = site.vacancies.length ? site.vacancies.map(v => card(v, site.key)).join("\n") : '<div class="empty-state">Sin vacantes registradas.</div>';
  return `<details class="site" data-site-key="${site.key}"${site.vacancies.some(active) ? " open" : ""}>
  <summary><span class="site-title">${escape(site.name)}${site.failed_today ? ' <span class="badge badge-closed">Error</span>' : ""}</span><span class="site-count${site.vacancies.length ? " has" : ""}">${count}</span></summary>
  <div class="site-body">
    <div class="meta"><span>Método: ${site.method === "playwright" ? "Playwright" : "WebFetch"}</span><a href="${escape(site.url)}" target="_blank">Abrir sitio</a><span>Último estado: ${escape(site.last_checked)}</span></div>
${body}
  </div>
</details>`;
}

const warningHtml = warnings.map(w => `<div class="warning"><strong>${escape(sites.find(s => s.key === w.site)?.name || w.site)}</strong> — ${escape(w.message)}</div>`).join("\n");
const content = `
<h2>Novedades</h2>
${newToday.length ? newToday.map(v => card(v, v.site)).join("\n") : '<div class="empty-state">No hay vacantes nuevas hoy.</div>'}

<h2>Cerradas hoy</h2>
${closedToday.length ? closedToday.map(v => card(v, v.site)).join("\n") : '<div class="empty-state">No se detectaron cierres hoy.</div>'}

<h2>Avisos</h2>
${warningHtml}

<h2>Por sitio</h2>
${sites.map(siteBlock).join("\n")}
`;

const htmlPath = path.join(root, "dashboard.html");
const previous = fs.readFileSync(htmlPath, "utf8");
const activeMarker = '<div class="tab-panel active" data-panel="active">';
const appliedMarker = '<div class="tab-panel" data-panel="applied">';
const before = previous.slice(0, previous.indexOf(activeMarker) + activeMarker.length);
const after = previous.slice(previous.indexOf(appliedMarker));
let html = `${before}${content}\n</div>\n\n${after}`;
const stat = (label, value) => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value${value === 0 ? " zero" : ""}">${value}</div></div>`;
html = html.replace(/<title>Vacantes — [^<]+<\/title>/, `<title>Vacantes — ${runDate}</title>`)
  .replace(/Última corrida: <strong>[^<]+<\/strong> &middot; \d+ sitios revisados &middot; \d+ warnings/, `Última corrida: <strong>${runDate}</strong> &middot; ${summary.sites_checked} sitios revisados &middot; ${warnings.length} warnings`)
  .replace(/<div class="stat"><div class="stat-label">Relevantes \(CDMX\/remoto\)<\/div><div class="stat-value(?: zero)?">\d+<\/div><\/div>/, stat("Relevantes (CDMX/remoto)", summary.relevant_active))
  .replace(/<div class="stat"><div class="stat-label">Fuera de scope<\/div><div class="stat-value(?: zero)?">\d+<\/div><\/div>/, stat("Fuera de scope", summary.out_of_scope))
  .replace(/<div class="stat"><div class="stat-label">Cerradas<\/div><div class="stat-value(?: zero)?">\d+<\/div><\/div>/, stat("Cerradas", summary.closed))
  .replace(/<div class="stat"><div class="stat-label">Nuevas hoy<\/div><div class="stat-value(?: zero)?">\d+<\/div><\/div>/, stat("Nuevas hoy", summary.new_today))
  .replace(/<div class="stat"><div class="stat-label">Errores<\/div><div class="stat-value(?: zero)?">\d+<\/div><\/div>/, stat("Errores", summary.sites_with_error));
fs.writeFileSync(htmlPath, html);
