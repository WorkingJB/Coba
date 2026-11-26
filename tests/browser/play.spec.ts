import { test, expect, type Page } from "@playwright/test";

async function enter(page: Page) {
  await page.goto("/");
  await page.getByLabel("Playtest key").fill("cloud-ci-playtest-key");
  await page.getByRole("button", { name: "Enter playtest" }).click();
  await expect(page.getByRole("button", { name: "Solo 2v2" })).toBeVisible();
}
/** The battle is one screen: nothing may scroll in either direction. */
async function fitsViewport(page: Page) {
  expect(
    await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth <= innerWidth && root.scrollHeight <= innerHeight;
    }),
  ).toBe(true);
}
const playable = (page: Page) => page.locator(".hand .card:not(.unaffordable)").first();

test("two friends host a 2v2 with bots, plan by click and by drag, and watch it resolve", async ({
  browser,
}) => {
  const one = await browser.newContext();
  const two = await browser.newContext();
  const host = await one.newPage();
  const guest = await two.newPage();
  await enter(host);
  await enter(guest);
  await host.getByRole("button", { name: /The Corsair/ }).click();
  await host.screenshot({ path: "test-results/bridge-desktop.png", fullPage: true });

  await host.getByRole("button", { name: "Host 2v2 lobby" }).click();
  const invite = host.getByLabel("Invite code", { exact: true });
  await expect(invite).toHaveText(/^[A-F0-9]{10}$/);
  await guest.getByRole("button", { name: /The Quartermaster/ }).click();
  await guest.getByLabel("Invite code").fill((await invite.textContent())!);
  await guest.getByLabel("Side").selectOption("0");
  await guest.getByRole("button", { name: "Join", exact: true }).click();
  await expect(host.getByText("2 of 4 seats taken")).toBeVisible();
  await host.screenshot({ path: "test-results/lobby-desktop.png", fullPage: true });
  await host.getByRole("button", { name: /Start now/ }).click();

  for (const page of [host, guest])
    await expect(page.getByRole("heading", { name: /Turn 1/ })).toBeVisible();
  // Two people and two bots; the bots have already planned.
  await expect(host.locator(".roster.enemy .pilot.locked")).toHaveCount(2);

  // Host plans by click: card, then zone.
  const hostCard = await playable(host).getAttribute("data-name");
  await playable(host).click();
  await host.getByRole("button", { name: /^The Spindle/ }).click();
  await expect(host.locator('.zone[data-zone="1"] .chip.mine')).toContainText(hostCard!, {
    ignoreCase: true,
  });
  await host.screenshot({ path: "test-results/battle-planning-desktop.png" });
  await fitsViewport(host);
  await host.getByRole("button", { name: "Lock plan" }).click();
  await expect(host.getByRole("button", { name: "Plan locked" })).toBeVisible();
  await host.reload();
  await expect(host.getByRole("button", { name: "Plan locked" })).toBeVisible();
  await expect(host.locator('.zone[data-zone="1"] .chip')).toContainText(hostCard!, {
    ignoreCase: true,
  });
  // A teammate can read the locked plan.
  await expect(guest.locator('.zone[data-zone="1"] .chip')).toContainText(hostCard!, {
    ignoreCase: true,
  });

  // Guest plans by dragging a card onto a zone.
  const guestCard = await playable(guest).getAttribute("data-name");
  await playable(guest).dragTo(guest.locator('.zone[data-zone="0"]'));
  await expect(guest.locator('.zone[data-zone="0"] .chip.mine')).toContainText(guestCard!, {
    ignoreCase: true,
  });
  await guest.getByRole("button", { name: "Lock plan" }).click();

  // Everyone has locked: the turn plays back, then the next plan begins.
  await expect(guest.locator(".phase")).toBeVisible();
  await guest.waitForTimeout(1600);
  await guest.screenshot({ path: "test-results/battle-resolving-desktop.png" });
  for (const page of [host, guest])
    await expect(page.getByRole("heading", { name: /Turn 2/ })).toBeVisible({ timeout: 15_000 });
  await host.screenshot({ path: "test-results/battle-turn2-desktop.png" });
  await fitsViewport(host);

  await guest.setViewportSize({ width: 390, height: 844 });
  await playable(guest).click();
  await guest.getByRole("button", { name: /^The Relay/ }).click();
  await guest.screenshot({ path: "test-results/battle-mobile.png" });
  await fitsViewport(guest);
  await one.close();
  await two.close();
});

test("a solo duel against a bot runs to a result and can be replayed", async ({ browser }) => {
  // Reduced motion skips the turn playback, which keeps a full match short.
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await enter(page);
  await page.getByRole("button", { name: "Solo duel" }).click();
  await expect(page.getByRole("heading", { name: /Turn 1/ })).toBeVisible();
  const result = page.getByRole("dialog", { name: "Match result" });
  const pass = page.getByRole("button", { name: "Pass turn" });
  // Passing every turn loses, at the latest when the turn limit is reached.
  for (let turn = 0; turn < 12; turn++) {
    await expect(pass.or(result)).toBeVisible();
    if (await result.isVisible()) break;
    await pass.click();
    await expect(
      page.getByRole("heading", { name: new RegExp(`Turn ${turn + 2}`) }).or(result),
    ).toBeVisible();
  }
  await expect(result).toContainText("Defeat");
  await page.screenshot({ path: "test-results/result-desktop.png" });
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByRole("heading", { name: /Turn 1 / })).toBeVisible();
  await expect(result).toBeHidden();
  await context.close();
});
