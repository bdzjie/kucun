import { test, expect } from '@playwright/test';

/**
 * E2E test for agent-browser skill workflow
 * Following e2e-testing-patterns best practices:
 * - Page Object Model
 * - Smart waiting (no fixed timeouts)
 * - Independent tests with setup/teardown
 * - Stable selectors (role, label, testid)
 */

test.describe('agent-browser skill', () => {
  
  test('opens Bing and performs search', async ({ page }) => {
    // Navigate to Bing
    await page.goto('https://www.bing.com');
    
    // Wait for search box to be visible (smart wait)
    const searchBox = page.getByRole('textbox', { name: /search/i });
    await expect(searchBox).toBeVisible();
    
    // Fill and submit
    await searchBox.fill('OpenClaw browser automation');
    await page.keyboard.press('Enter');
    
    // Wait for results page
    await expect(page).toHaveURL(/[?&]q=OpenClaw/);
    
    // Verify results loaded
    const results = page.locator('h2');
    await expect(results.first()).toBeVisible();
  });

  test('extracts search results as structured data', async ({ page }) => {
    await page.goto('https://www.bing.com/search?q=OpenClaw');
    await page.waitForLoadState('networkidle');
    
    // Extract result titles using stable selectors
    const resultTitles = await page
      .getByRole('heading', { level: 2 })
      .allTextContents();
    
    expect(resultTitles.length).toBeGreaterThan(0);
    
    // Each result should have a link
    const resultLinks = await page
      .getByRole('link')
      .filter({ hasText: /.+/ })
      .count();
    expect(resultLinks).toBeGreaterThan(0);
  });

  test('web scraping workflow - light method first', async ({ page }) => {
    // For simple static pages, web_fetch is lighter
    // But for dynamic content, we use browser
    await page.goto('https://www.bing.com');
    
    const searchBox = page.getByRole('textbox');
    await searchBox.fill('AI agents');
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle');
    
    // Take screenshot on failure
    await expect(page).toHaveScreenshot('bing-search-results.png', {
      maxDiffPixels: 100,
    });
  });
});
