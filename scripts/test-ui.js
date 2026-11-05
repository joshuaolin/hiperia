import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
mkdirSync("test-results", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
const origin = process.env.UI_TEST_ORIGIN || "http://127.0.0.1:5173";
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(`${origin}/`, {
  waitUntil: "networkidle",
  timeout: 60000,
});
await page.getByRole("heading", { name: "Dodos.", exact: true }).waitFor();
await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
  "content",
  "#0b0911",
);
await expect(
  page.locator('link[rel="icon"][type="image/svg+xml"]'),
).toHaveAttribute("href", "/favicon.svg?v=solana");
const iconResponse = await page.request.get(
  new URL("/favicon.svg?v=solana", page.url()).href,
);
const iconSource = await iconResponse.text();
if (
  !iconResponse.ok() ||
  !iconSource.includes("#9945ff") ||
  !iconSource.includes("#14f195")
)
  throw new Error("Favicon must use the current purple and green brand colors");
const icoResponse = await page.request.get(
  new URL("/favicon.ico?v=solana", page.url()).href,
);
const icoBytes = await icoResponse.body();
if (
  !icoResponse.ok() ||
  icoBytes.readUInt16LE(2) !== 1 ||
  icoBytes.readUInt16LE(4) !== 4
)
  throw new Error("Fallback favicon must contain the updated four icon sizes");
const guide = page.locator("#game-guide");
await expect(guide).not.toHaveAttribute("open");
const ticketDisclosure = page.locator("#your-tickets");
const resultDisclosure = page.locator("#draw-results");
await expect(ticketDisclosure).not.toHaveAttribute("open");
await expect(resultDisclosure).not.toHaveAttribute("open");
await expect(ticketDisclosure.locator(".count-badge")).toHaveCount(0);
await page.getByRole("link", { name: "Your tickets", exact: true }).click();
await expect(ticketDisclosure).toHaveAttribute("open", "");
const ticketAlignment = await page
  .locator(".dashboard-grid")
  .evaluate((element) => {
    const purchase = element
      .querySelector(".purchase-panel")
      .getBoundingClientRect();
    const tickets = element
      .querySelector(".tickets-panel")
      .getBoundingClientRect();
    return {
      top: Math.abs(purchase.top - tickets.top),
      bottom: Math.abs(purchase.bottom - tickets.bottom),
    };
  });
if (ticketAlignment.top > 1 || ticketAlignment.bottom > 1)
  throw Error(
    "Expanded empty ticket panel must align with the purchase panel on desktop",
  );
await ticketDisclosure.locator(":scope > summary").click();
await expect(ticketDisclosure).not.toHaveAttribute("open");
const collapsedAlignment = await page
  .locator(".dashboard-grid")
  .evaluate((element) => {
    const purchase = element
      .querySelector(".purchase-panel")
      .getBoundingClientRect();
    const tickets = element
      .querySelector(".tickets-panel")
      .getBoundingClientRect();
    return Math.max(
      Math.abs(purchase.top - tickets.top),
      Math.abs(purchase.bottom - tickets.bottom),
    );
  });
if (collapsedAlignment > 1)
  throw Error(
    "Collapsed ticket panel must align with the purchase panel on desktop",
  );
await page.getByRole("link", { name: "Your tickets", exact: true }).click();
await expect(ticketDisclosure).toHaveAttribute("open", "");
await ticketDisclosure.locator(":scope > summary").click();
await page.getByRole("link", { name: "Draw results", exact: true }).click();
await expect(resultDisclosure).toHaveAttribute("open", "");
await resultDisclosure.locator(":scope > summary").click();
await expect(resultDisclosure).not.toHaveAttribute("open");
const supportLayout = await page.locator("#support").evaluate((element) => {
  const support = element.getBoundingClientRect();
  const results = document
    .getElementById("draw-results")
    .getBoundingClientRect();
  const recipient = element
    .querySelector(".donation-recipient")
    .getBoundingClientRect();
  const form = element.querySelector("form").getBoundingClientRect();
  return {
    width: support.width,
    resultsWidth: results.width,
    left: support.left,
    resultsLeft: results.left,
    height: support.height,
    sideBySide: form.left >= recipient.right,
  };
});
if (
  Math.abs(supportLayout.width - supportLayout.resultsWidth) > 1 ||
  Math.abs(supportLayout.left - supportLayout.resultsLeft) > 1 ||
  supportLayout.height > 450 ||
  !supportLayout.sideBySide
)
  throw Error("Desktop support must occupy its own compact full-width panel");
await page.getByRole("link", { name: "How to play", exact: true }).click();
await expect(guide).toHaveAttribute("open", "");
await expect(
  page.getByRole("heading", { name: "How to play Dodos", exact: true }),
).toBeVisible();
await guide.locator(":scope > summary").click();
await expect(guide).not.toHaveAttribute("open");
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
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
const navigation = page.locator(".sidebar-nav");
const navigationToggle = page.locator(".navigation-toggle");
await expect(navigation).not.toBeVisible();
await navigationToggle.click();
await expect(navigationToggle).toHaveAttribute("aria-expanded", "true");
await expect(navigation).toBeVisible();
await page.keyboard.press("Escape");
await expect(navigation).not.toBeVisible();
await expect(navigationToggle).toBeFocused();
await navigationToggle.click();
await page.locator(".network-badge").click();
await expect(navigation).not.toBeVisible();
await navigationToggle.click();
await page.setViewportSize({ width: 1440, height: 1100 });
await expect(navigationToggle).not.toBeVisible();
await expect(navigation).toBeVisible();
await page.setViewportSize({ width: 390, height: 844 });
await expect(navigation).not.toBeVisible();
await navigationToggle.click();
await expect(
  navigation.getByRole("button", {
    name: "Lemon, coming in 2027",
    exact: true,
  }),
).toBeDisabled();
await expect(
  navigation.getByText("Coming 2027", { exact: true }),
).toBeVisible();
const theme = await page.evaluate(() => {
  const style = getComputedStyle(document.documentElement);
  return {
    green: style.getPropertyValue("--mint").trim(),
    purple: style.getPropertyValue("--purple").trim(),
    background: style.getPropertyValue("--bg").trim(),
  };
});
if (
  theme.green !== "#14f195" ||
  theme.purple !== "#9945ff" ||
  theme.background !== "#0b0911"
)
  throw Error("Solana purple and green dark theme is missing");
await navigation
  .getByRole("link", { name: "Support Hiperia", exact: true })
  .click();
await expect(navigation).not.toBeVisible();
await expect(
  navigation.locator('a[href="#support"]'),
).toHaveAttribute("aria-current", "location");
await expect(
  navigation.locator('a[href="#dodos"]'),
).not.toHaveAttribute("aria-current");
const backToTop = page.getByRole("button", {
  name: "Back to top",
  exact: true,
});
await expect(backToTop).toBeVisible();
await page.getByRole("textbox", { name: "Amount", exact: true }).focus();
await expect(backToTop).toHaveCount(0);
await page.getByRole("textbox", { name: "Amount", exact: true }).blur();
await expect(backToTop).toBeVisible();
await page
  .locator("#support")
  .getByRole("button", { name: "Connect wallet", exact: true })
  .click();
await expect(page.locator(".wallet-adapter-modal")).toBeVisible();
await expect(backToTop).toHaveCount(0);
await page.locator(".wallet-adapter-modal-button-close").click();
await expect(backToTop).toBeVisible();
await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
await page
  .getByRole("button", { name: "Copy support wallet address", exact: true })
  .click();
await expect(
  page.getByText("Wallet address copied.", { exact: true }),
).toBeVisible();
if (
  (await page.evaluate(() => navigator.clipboard.readText())) !==
  (await page.locator(".donation-recipient code").innerText())
)
  throw Error("Copied support address does not match the displayed recipient");
await backToTop.click();
await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
await expect(backToTop).toHaveCount(0);
await expect(page.locator("#dodos-heading")).toBeFocused();
await expect(
  navigation.locator('a[href="#dodos"]'),
).toHaveAttribute("aria-current", "location");
await expect(
  navigation.locator('a[href="#support"]'),
).not.toHaveAttribute("aria-current");
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
await page.getByRole("textbox", { name: "Amount", exact: true }).blur();
await page.emulateMedia({ reducedMotion: "reduce" });
await page.evaluate(() =>
  window.scrollTo({
    top: document.documentElement.scrollHeight,
    behavior: "instant",
  }),
);
await expect(backToTop).toBeVisible();
await backToTop.click();
await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
await page.evaluate(() => {
  window.location.hash = "dodos-guide";
});
await expect(guide).toHaveAttribute("open", "");
await expect(guide.locator(":scope > summary")).toBeInViewport();
for (const path of [
  "/hiperia_program/target/deploy/deployer-keypair.json",
  "/hiperia_program/target/deploy/hiperia_program-keypair.json",
  "/.local/solana/deployer-keypair.json",
  "/.local/solana/hiperia_program-keypair.json",
]) {
  const response = await page.request.get(origin + path);
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
    supportAddressCopy: true,
    navigationActiveState: true,
    lemonDisabledUntil2027: true,
    solanaTheme: true,
    privateArtifactsBlocked: true,
    desktopSupportLayout: true,
    collapsibleGuide: true,
    mobileBackToTop: true,
    mobileNavigationToggle: true,
    navigationKeyboardAndOutsideClose: true,
    collapsedTicketAlignment: true,
    backToTopHiddenForInputsAndWalletModal: true,
    reducedMotion: true,
  }),
);
console.log((await page.locator("main").innerText()).slice(0, 700));
await browser.close();
