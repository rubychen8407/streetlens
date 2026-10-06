import assert from 'node:assert/strict';
import type { Browser, BrowserContext } from 'playwright';

export async function testProfileUI(browser: Browser, prepare: (context: BrowserContext) => Promise<void>, baseURL: string) {
  for (const width of [320, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await prepare(context);
    const page = await context.newPage();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseURL);
    const dock = page.getByRole('navigation');
    await dock.waitFor();
    assert.equal(await dock.getByRole('button', { name: 'CLS 結果報告', exact: true }).count(), 0);
    for (const label of ['個人設定', '實勘', '環境觀察', '資料狀態']) {
      const button = dock.getByRole('button', { name: label, exact: true });
      await button.hover();
      const tooltip = button.getByRole('tooltip');
      await tooltip.waitFor();
      assert.equal(await tooltip.innerText(), label);
      const box = await tooltip.boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 900);
    }
    if (width >= 1024) {
      const field = await dock.getByRole('button', { name: '環境觀察', exact: true }).boundingBox();
      const data = await dock.getByRole('button', { name: '資料狀態', exact: true }).boundingBox();
      assert.ok(field && data && data.y - field.y - field.height <= 16, 'data status stays next to the other dock actions');
      assert.ok((await dock.boundingBox())!.height < 350, 'desktop dock fits its contents');
    }
    const dataButton = dock.getByRole('button', { name: '資料狀態', exact: true });
    const inactive = await dataButton.evaluate(element => getComputedStyle(element).backgroundColor);
    await dataButton.click();
    assert.equal(await dataButton.getAttribute('aria-pressed'), 'true');
    assert.notEqual(await dataButton.evaluate(element => getComputedStyle(element).backgroundColor), inactive);
    assert.equal(await dock.locator('button[aria-pressed="true"]').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await dataButton.getAttribute('aria-pressed'), 'false');
    const profileButton = dock.getByRole('button', { name: '個人設定', exact: true });
    await profileButton.click();
    let dialog = page.getByRole('dialog', { name: '個人設定', exact: true });
    await dialog.waitFor();
    assert.equal(await page.locator('button[aria-haspopup="dialog"]').getAttribute('aria-pressed'), 'true');
    await dialog.getByRole('radio', { name: 'English', exact: true }).check();
    dialog = page.getByRole('dialog', { name: 'Profile settings', exact: true });
    await dialog.getByRole('radio', { name: 'Light mode', exact: true }).check();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('#app-root').getAttribute('data-map-theme'), 'light');
    const before = await page.evaluate(() => localStorage.getItem('cls_saved_locations'));
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Environment observations', exact: true }).click();
    assert.equal(await dock.getByRole('button', { name: 'Environment observations', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await dock.getByRole('button', { name: 'Data status', exact: true }).getAttribute('aria-pressed'), 'false');
    const panel = page.getByRole('complementary');
    assert.equal(await page.getByLabel('Search locations', { exact: true }).isVisible(), width >= 1024, 'mobile search stays hidden behind the open observation panel');
    const colors = await panel.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, text: getComputedStyle(element.querySelector('h3')!).color }));
    const red = (color: string) => Number(color.match(/[\d.]+/)?.[0]);
    assert.ok(red(colors.background) > 220 && red(colors.text) < 130, 'light panels have light surfaces and readable dark headings');
    const selectedStepColor = await panel.getByRole('button', { name: 'Observe', exact: true }).evaluate(element => getComputedStyle(element).color);
    assert.ok(red(selectedStepColor) < 130, 'selected steps remain readable on light surfaces');
    await page.screenshot({ path: `artifacts/walk-ui/light-observation-${width}.png` });
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByRole('button', { name: 'Profile settings', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Profile settings', exact: true });
    assert.equal(await dialog.getByRole('radio', { name: 'English', exact: true }).isChecked(), true);
    assert.equal(await dialog.getByRole('radio', { name: 'Light mode', exact: true }).isChecked(), true);
    await dialog.getByRole('radio', { name: 'Dark mode', exact: true }).check();
    assert.equal(await page.locator('#app-root').getAttribute('data-map-theme'), 'dark');
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0, 'Escape dismisses profile settings');
    assert.equal(await page.getByRole('button', { name: 'Profile settings', exact: true }).evaluate(element => element === document.activeElement), true, 'profile restores keyboard focus to its opener');
    assert.equal(await page.evaluate(() => localStorage.getItem('cls_saved_locations')), before, 'preferences do not modify street records');
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await context.close();
  }
  console.log('Profile/dock UI passed: compact desktop grouping, tooltips, selection highlight, persisted bilingual preferences and theme, contrast, mobile layout and focus restoration.');
}
