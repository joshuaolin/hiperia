import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
mkdirSync("test-results", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto("http://127.0.0.1:5173/", {
  waitUntil: "networkidle",
  timeout: 60000,
});
await page.getByRole("heading", { name: "Dodos.", exact: true }).waitFor();
await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
for (const width of [320, 390, 768, 1440]) {
  await page.setViewportSize({ width, height: 1100 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 1,
  );
  if (overflow) throw new Error(`Horizontal overflow at ${width}px`);
}
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
if (await page.getByRole("button", { name: "Number 1", exact: true }).count())
  throw Error("Number 01 is still offered for a new ticket");
if ((await page.locator(".number-grid button").count()) !== 21)
  throw Error("New tickets must offer exactly the numbers 02 through 22");
await page.getByRole("button", { name: "Number 2", exact: true }).click();
await page.getByRole("button", { name: "Number 22", exact: true }).click();
if (
  !(await page
    .getByRole("button", { name: "Number 3", exact: true })
    .isDisabled())
)
  throw Error("Selection accepts more than two picks");
await page
  .getByRole("textbox", { name: "Amount", exact: true })
  .fill("0.0000000001");
await page.getByRole("textbox", { name: "Amount", exact: true }).blur();
if (
  !(await page
    .getByText("Enter a SOL amount with up to 9 decimal places.", {
      exact: true,
    })
    .isVisible())
)
  throw Error("Donation amount validation missing");
for (const path of [
  "/hiperia_program/target/deploy/deployer-keypair.json",
  "/hiperia_program/target/deploy/hiperia_program-keypair.json",
  "/.local/solana/deployer-keypair.json",
  "/.local/solana/hiperia_program-keypair.json",
]) {
  const response = await page.request.get("http://127.0.0.1:5173" + path);
  if (response.status() !== 403)
    throw Error(`Development server exposes private artifact: ${path}`);
}
if (errors.length) throw Error(errors.join("\n"));
console.log(
  JSON.stringify({
    viewportChecks: [320, 390, 768, 1440],
    pageErrors: errors,
    selection: true,
    newTicketRange: "02-22",
    donationValidation: true,
    privateArtifactsBlocked: true,
  }),
);
console.log((await page.locator("main").innerText()).slice(0, 700));
await browser.close();
