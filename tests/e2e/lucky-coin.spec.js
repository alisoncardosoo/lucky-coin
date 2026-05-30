import { expect, test } from "@playwright/test";

test("coin flips and lands on cara or coroa", async ({ page }) => {
  await page.goto("/");

  const coinButton = page.locator("#coin-button");
  const spinButton = page.locator("#spin-button");
  const result = page.locator("#result");
  const outcome = page.locator("#coin-outcome");

  await expect(result).toContainText("Pronto para jogar");
  await expect(outcome).toContainText("Jogue para descobrir");

  await coinButton.click();
  await expect(result).toContainText("Girando...");
  await expect(outcome).toContainText("Girando moeda...");

  await expect(result).toHaveText(/Resultado: (Cara|Coroa)/, { timeout: 5000 });
  await expect(outcome).toHaveText(/Deu (Cara|Coroa)/, { timeout: 5000 });
  await expect(coinButton).toBeEnabled();
  await expect(spinButton).toBeEnabled();

  await spinButton.click();
  await expect(result).toContainText("Girando...");
  await expect(outcome).toContainText("Girando moeda...");
  await expect(result).toHaveText(/Resultado: (Cara|Coroa)/, { timeout: 5000 });
  await expect(outcome).toHaveText(/Deu (Cara|Coroa)/, { timeout: 5000 });
});
