import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.STS_BASE_URL || "http://127.0.0.1:4173";
const outputDir = path.resolve(process.cwd(), "..", "ui-overhaul-after");

const captures = [
  { name: "after-light-generation.png", route: "/", theme: "light", readyText: "prompt constructor" },
  { name: "after-light-projects.png", route: "/projects", theme: "light", readyText: "projects" },
  { name: "after-light-pipes.png", route: "/pipes", theme: "light", readyText: "pipes" },
  { name: "after-light-gallery.png", route: "/gallery", theme: "light", readyText: "gallery" },
  { name: "after-light-library.png", route: "/library", theme: "light", readyText: "prompt library" },
  { name: "after-light-models.png", route: "/models", theme: "light", readyText: "models" },
  { name: "after-dark-generation.png", route: "/", theme: "dark", readyText: "prompt constructor" },
  { name: "after-dark-gallery.png", route: "/gallery", theme: "dark", readyText: "gallery" },
  { name: "after-dark-settings.png", route: "/settings", theme: "dark", readyText: "settings" },
  { name: "after-dark-models.png", route: "/models", theme: "dark", readyText: "models" },
];

async function captureRoute(browser, capture) {
  const context = await browser.newContext({
    viewport: { width: 1536, height: 864 },
  });

  await context.addInitScript((theme) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("ds_theme", theme);
    window.localStorage.setItem("ds_feed_open", "false");
    window.localStorage.setItem("ds_library_open", "false");
    window.localStorage.setItem("ds_palette_open", "false");
    window.localStorage.setItem("ds_perf_hud_open", "false");
  }, capture.theme);

  const page = await context.newPage();
  const url = `${baseUrl}${capture.route}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("text=sweet tea", { timeout: 20000 });
  await page.getByText(capture.readyText, { exact: false }).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(900);

  const outPath = path.join(outputDir, capture.name);
  await page.screenshot({ path: outPath, fullPage: true });
  await context.close();
  return outPath;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  try {
    for (const capture of captures) {
      const saved = await captureRoute(browser, capture);
      console.log(`Saved: ${saved}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
