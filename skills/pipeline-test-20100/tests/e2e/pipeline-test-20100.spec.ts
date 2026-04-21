import { test, expect } from '@playwright/test';

test.describe('pipeline-test-20100', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('skill responds to trigger', async ({ page }) => {
        await page.fill('input[placeholder*="message"], textarea', '/pipeline-test-20100');
        await page.press('input[placeholder*="message"], textarea', 'Enter');
        await expect(page.locator('.message, .response')).toBeVisible({ timeout: 10000 });
    });
});