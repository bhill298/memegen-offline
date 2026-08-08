const { test, expect } = require('@playwright/test');
const path = require('node:path');

const blankImage = path.resolve(__dirname, '..', 'server', 'img', 'memes', 'blank.png');

async function openEditor(page) {
  await page.goto('/');
  await expect(page.locator('.memes-container img').first()).toBeVisible();
  await page.locator('#meme-input').setInputFiles(blankImage);
  await expect(page.locator('#generate-meme')).toBeEnabled();
  await expect(page.locator('.canvas-container')).toHaveCount(1);
}

async function canvasObjects(page) {
  return page.evaluate(() => canvas.getObjects().map(object => ({
    type: object.type,
    left: object.left,
    top: object.top,
  })));
}

async function waitForHistory(page) {
  await expect(page.locator('#canvas-undo')).toBeEnabled();
}

test('can repeatedly enter and leave the editor without retaining a canvas', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await openEditor(page);
  await page.locator('.back-btn .btn').click();
  await expect(page.locator('.canvas-container')).toHaveCount(0);
  await expect(page.locator('.choice-section')).toBeVisible();

  await page.locator('#meme-input').setInputFiles(blankImage);
  await expect(page.locator('#generate-meme')).toBeEnabled();
  await expect(page.locator('.canvas-container')).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

test('undo and redo restore edits and discard an abandoned redo branch', async ({ page }) => {
  await openEditor(page);
  await page.locator('#add-text').click();
  await waitForHistory(page);
  await expect.poll(async () => (await canvasObjects(page)).length).toBe(1);

  await page.locator('#canvas-undo').click();
  await expect.poll(async () => (await canvasObjects(page)).length).toBe(0);
  await expect(page.locator('#canvas-redo')).toBeEnabled();

  await page.locator('#canvas-redo').click();
  await expect.poll(async () => (await canvasObjects(page)).length).toBe(1);
  await page.locator('#canvas-undo').click();
  await expect.poll(async () => (await canvasObjects(page)).length).toBe(0);

  await page.locator('#add-text').click();
  await waitForHistory(page);
  await expect(page.locator('#canvas-redo')).toBeDisabled();
});

test('keyboard movement is undoable', async ({ page }) => {
  await openEditor(page);
  await page.locator('#add-text').click();
  await waitForHistory(page);
  const originalLeft = (await canvasObjects(page))[0].left;

  await page.locator('#meme-canvas-wrapper').focus();
  await page.evaluate(() => canvas.setActiveObject(canvas.item(0)).renderAll());
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await canvasObjects(page))[0].left).toBe(originalLeft + 5);
  await page.locator('#canvas-undo').click();
  await expect.poll(async () => (await canvasObjects(page))[0].left).toBe(originalLeft);
});

test('brush strokes can be undone', async ({ page }) => {
  await openEditor(page);
  await page.locator('#toggle-brush').click();
  const surface = page.locator('.upper-canvas');
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await canvasObjects(page)).some(object => object.type === 'path')).toBe(true);
  await waitForHistory(page);

  await page.locator('#canvas-undo').click();
  await expect.poll(async () => (await canvasObjects(page)).length).toBe(0);
});

test('an image overlay can be added, undone, and redone', async ({ page }) => {
  await openEditor(page);
  await page.locator('#add-image').setInputFiles(blankImage);
  await expect.poll(async () => (await canvasObjects(page)).filter(object => object.type === 'image').length).toBe(1);
  await waitForHistory(page);

  await page.locator('#canvas-undo').click();
  await expect.poll(async () => (await canvasObjects(page)).length).toBe(0);
  await page.locator('#canvas-redo').click();
  await expect.poll(async () => (await canvasObjects(page)).filter(object => object.type === 'image').length).toBe(1);
});

test('export preserves the template resolution', async ({ page }) => {
  await openEditor(page);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#generate-meme').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const png = Buffer.concat(chunks);

  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(450);
  expect(png.readUInt32BE(20)).toBe(123);
});
