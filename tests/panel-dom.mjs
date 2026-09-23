// Boots the real panel bundle inside jsdom so UI regressions (dropdown picks,
// accordions) are covered without downloading a browser.
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const PUBLIC = path.join(process.cwd(), "public");

export function bootPanel({ lang = "fa" } = {}) {
  const html = fs
    .readFileSync(path.join(PUBLIC, "index.html"), "utf8")
    .replace(/<script[\s\S]*?<\/script>/g, "");
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://panel.test/",
  });
  const win = dom.window;
  const inject = (code) => {
    const el = win.document.createElement("script");
    el.textContent = code;
    win.document.body.appendChild(el);
    return el;
  };
  inject(`
    window.lucide = { createIcons() {} };
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: {} }) });
  `);
  for (const file of ["panel.js", "studio.js", "services.js", "bpb.js"])
    inject(fs.readFileSync(path.join(PUBLIC, file), "utf8"));
  inject(`S.token = 'test-token'; S.lang = ${JSON.stringify(lang)};`);
  const doc = win.document;
  const tap = (el, { pointer = true } = {}) => {
    if (pointer) el.dispatchEvent(new win.Event("pointerdown", { bubbles: true }));
    el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  };
  return { dom, win, doc, inject, tap, close: () => win.close() };
}
