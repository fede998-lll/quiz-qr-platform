import { expect, test } from "@playwright/test";

test("host route loads with configured Supabase environment", async ({ page }) => {
  await page.goto("/?mode=host");
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
});

test("student route without a code shows the join form", async ({ page }) => {
  await page.goto("/?mode=student&session=ABC123");
  await expect(page.getByText("Session not found")).toBeVisible();
});
