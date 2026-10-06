import type { Page } from 'playwright';

/** Exercise the keyboard-accessible map entry, not an obsolete dock button. */
export async function openMapAssessment(page: Page) {
  const map = page.locator('#leaflet-apple-map');
  await map.focus();
  await map.press('Enter');
  await page.getByRole('complementary').waitFor();
}
