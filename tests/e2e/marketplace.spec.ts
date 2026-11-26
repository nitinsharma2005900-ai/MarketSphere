import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
const base = "http://localhost:4040/api/v1";
test.beforeAll(() =>
  mkdirSync("docs/evidence/screenshots", { recursive: true }),
);
test("desktop discovery, filtering, detail and responsive storefront", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Good finds/ })).toBeVisible();
  await expect(page.locator(".product-card").first()).toBeVisible();
  await page.screenshot({
    path: "docs/evidence/screenshots/storefront-desktop.png",
    fullPage: true,
  });
  await page.screenshot({path:'docs/evidence/screenshots/storefront-viewport.png'});
  await page.getByRole("link", { name: "Shop all", exact: true }).click();
  await expect(page.locator(".product-card")).toHaveCount(12);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(
    page.locator('.filter-panel select option[value="home-living"]'),
  ).toBeAttached();
  await page
    .getByLabel("Category", { exact: true })
    .selectOption("home-living");
  await expect(page).toHaveURL(/category=home-living/);
  await expect(page.locator(".product-card").first()).toBeVisible();
  await page.locator(".product-name").first().click();
  await expect(
    page.getByRole("button", { name: "Add to bag", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Premium", exact: true }).click();
  await page.screenshot({
    path: "docs/evidence/screenshots/product-detail.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".product-card").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/evidence/screenshots/storefront-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("customer completes a sandbox purchase and opens a support conversation", async ({
  page,
  request,
}) => {
  const email = "browser-" + Date.now() + "@marketsphere.test",
    password = "BrowserSynthetic!2026";
  const reg = await request.post(base + "/auth/register", {
    data: { name: "Browser Customer", email, password },
  });
  expect(reg.status()).toBe(201);
  const token = (await reg.json()).data.accessToken;
  const headers = { Authorization: "Bearer " + token };
  await request.post(base + "/addresses", {
    headers,
    data: {
      name: "Browser Customer",
      line1: "42 Test Lane",
      city: "Bengaluru",
      region: "Karnataka",
      postalCode: "560001",
    },
  });
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/");
  await page.locator(".product-name").first().click();
  await page.getByRole("button", { name: "Add to bag", exact: true }).click();
  await expect(
    page.getByText("Added to your bag", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Shopping bag", exact: true }).click();
  await expect(page.locator(".cart-item")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Continue to payment", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm sandbox payment", exact: true })
    .click();
  await expect(page).toHaveURL("/orders");
  await expect(page.locator(".order-card").first()).toContainText("paid");
  await page
    .getByRole("button", { name: "Order details", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Delivery address", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/evidence/screenshots/customer-orders.png",
    fullPage: true,
  });
  await page.goto("/support");
  await page.getByRole("button", { name: "New ticket" }).click();
  await page
    .getByLabel("Subject", { exact: true })
    .fill("Browser sandbox delivery question");
  await page
    .getByLabel("Your message", { exact: true })
    .fill("Please help with this synthetic demonstration order.");
  await page
    .getByRole("button", { name: "Create ticket", exact: true })
    .click();
  await expect(
    page.getByText("Browser sandbox delivery question", { exact: true }),
  ).toBeVisible();
});
for (const [role, section, title] of [
  ["seller", "products", "Your product collection"],
  ["warehouse", "inventory", "Inventory, in the clear."],
  ["support", "tickets", "Support tickets"],
  ["admin", "health", "System health"],
]) {
  test(`${role} login and role workspace`, async ({ page }) => {
    await page.goto("/login");
    await page
      .locator(".demo-buttons")
      .getByRole("button", { name: role, exact: true })
      .click();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/portal");
    await expect(
      page.getByRole("heading", { name: /Good to see you/ }),
    ).toBeVisible();
    await expect(page.locator("main .loading")).toHaveCount(0);
    await expect(page.locator('main [role="alert"]')).toHaveCount(0);
    await page.screenshot({
      path: `docs/evidence/screenshots/${role}-dashboard.png`,
      fullPage: true,
    });
    await page.goto("/portal/" + section);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(page.locator("main .loading")).toHaveCount(0);
    await expect(page.locator('main [role="alert"]')).toHaveCount(0);
  });
}
