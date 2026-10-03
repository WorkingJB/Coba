import { test, expect } from "@playwright/test";
test("two browsers complete a turn and a reload restores the seat", async ({
  browser,
}) => {
  const one = await browser.newContext();
  const two = await browser.newContext();
  const host = await one.newPage();
  const guest = await two.newPage();
  for (const page of [host, guest]) {
    await page.goto("/");
    await page.getByLabel("Playtest key").fill("cloud-ci-playtest-key");
    await page.getByRole("button", { name: "Enter playtest" }).click();
    await expect(
      page.getByRole("button", { name: "Create a battle" }),
    ).toBeVisible();
  }
  await host.screenshot({
    path: "test-results/lobby-desktop.png",
    fullPage: true,
  });
  await host.getByRole("button", { name: "Create a battle" }).click();
  const invite = host.getByLabel("Invite code", { exact: true });
  await expect(invite).toHaveText(/^[A-F0-9]{10}$/);
  const code = await invite.textContent();
  await guest.getByLabel("Or join with an invite code").fill(code!);
  await guest.getByRole("button", { name: "Join", exact: true }).click();
  await expect(host.getByRole("heading", { name: "Turn 1" })).toBeVisible();
  await host
    .getByRole("button", { name: /Pathfinder/ })
    .first()
    .click();
  await host.getByRole("button", { name: "Lock your move" }).click();
  await expect(
    host.getByRole("button", { name: "Locked · waiting for rival" }),
  ).toBeVisible();
  await host.reload();
  await expect(
    host.getByRole("button", { name: "Locked · waiting for rival" }),
  ).toBeVisible();
  await guest
    .getByRole("button", { name: /Pathfinder/ })
    .first()
    .click();
  await guest.getByRole("button", { name: "Lock your move" }).click();
  await expect(host.getByRole("heading", { name: "Turn 2" })).toBeVisible();
  await expect(guest.getByRole("heading", { name: "Turn 2" })).toBeVisible();
  await host.screenshot({
    path: "test-results/battle-desktop.png",
    fullPage: true,
  });
  await guest.setViewportSize({ width: 390, height: 844 });
  await guest.screenshot({
    path: "test-results/battle-mobile.png",
    fullPage: true,
  });
  expect(
    await guest.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await one.close();
  await two.close();
});
