const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { encode: encodeGif, decode: decodeGif, decodeFrames: decodeGifFrames } = require('modern-gif');

const blankImage = path.resolve(__dirname, '..', 'server', 'img', 'memes', 'blank.png');

function solidFrame(width, height, red, green, blue) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = red;
    pixels[index + 1] = green;
    pixels[index + 2] = blue;
    pixels[index + 3] = 255;
  }
  return pixels;
}

async function animatedGifBuffer() {
  const width = 64;
  const height = 48;
  const buffer = await encodeGif({
    width,
    height,
    looped: true,
    loopCount: 0,
    frames: [
      { data: solidFrame(width, height, 220, 20, 20), delay: 100 },
      { data: solidFrame(width, height, 20, 180, 40), delay: 200 },
    ],
  });
  return Buffer.from(buffer);
}

async function tooManyFramesGifBuffer() {
  const frames = Array.from({ length: 301 }, (_value, index) => ({
    data: solidFrame(1, 1, index % 2 ? 255 : 0, 0, 0),
    delay: 100,
  }));
  return Buffer.from(await encodeGif({ width: 1, height: 1, frames }));
}

async function openEditor(page) {
  await page.goto('/');
  await expect(page.locator('.memes-container img').first()).toBeVisible();
  await page.locator('#meme-input').setInputFiles(blankImage);
  await expect(page.locator('#generate-meme')).toBeEnabled();
  await expect(page.locator('.canvas-container')).toHaveCount(1);
}

async function openGifEditor(page) {
  await page.goto('/');
  await expect(page.locator('.memes-container img').first()).toBeVisible();
  await page.locator('#meme-input').setInputFiles({
    name: 'animated-test.gif',
    mimeType: 'image/gif',
    buffer: await animatedGifBuffer(),
  });
  await expect(page.locator('#generate-meme')).toHaveText('Generate GIF');
  await expect(page.locator('#generate-meme')).toBeEnabled();
  await expect(page.locator('#gif-status')).toContainText('2 frames');
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

test('an animated GIF previews multiple decoded frames', async ({ page }) => {
  await openGifEditor(page);
  expect(await page.evaluate(() => canvas.gifTimeline.segments)).toEqual([
    { startFrame: 0, editorState: null },
  ]);
  const observedColors = await page.evaluate(() => new Promise(resolve => {
    const colors = new Set();
    const sample = () => {
      const frameCanvas = canvas.backgroundImage.getElement();
      const pixel = frameCanvas.getContext('2d').getImageData(0, 0, 1, 1).data;
      colors.add(`${pixel[0]},${pixel[1]},${pixel[2]}`);
    };
    sample();
    const timer = setInterval(sample, 25);
    setTimeout(() => {
      clearInterval(timer);
      resolve([...colors]);
    }, 450);
  }));
  expect(observedColors.length).toBeGreaterThan(1);
});

test('GIF export preserves frames and timing and applies one overlay to every frame', async ({ page }) => {
  await openGifEditor(page);
  await page.locator('#add-text').click();
  await waitForHistory(page);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#generate-meme').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.gif$/);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const output = Buffer.concat(chunks);
  const exactOutput = output.buffer.slice(
    output.byteOffset, output.byteOffset + output.byteLength
  );
  const metadata = decodeGif(exactOutput);
  const frames = decodeGifFrames(exactOutput, { gif: metadata });

  expect(metadata.width).toBe(64);
  expect(metadata.height).toBe(48);
  expect(metadata.frames).toHaveLength(2);
  expect(frames.map(frame => frame.delay)).toEqual([100, 200]);
  expect(metadata.looped).toBe(true);
  for (const frame of frames) {
    const colors = new Set();
    for (let index = 0; index < frame.data.length; index += 4) {
      colors.add(`${frame.data[index]},${frame.data[index + 1]},${frame.data[index + 2]}`);
    }
    expect(colors.size).toBeGreaterThan(1);
  }
});

test('GIF safety limits reject excessive frame counts before opening the editor', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.memes-container img').first()).toBeVisible();
  await page.locator('#meme-input').setInputFiles({
    name: 'too-many-frames.gif',
    mimeType: 'image/gif',
    buffer: await tooManyFramesGifBuffer(),
  });

  await expect(page.locator('.alert-container')).toContainText('maximum is 300');
  await expect(page.locator('.choice-section')).toBeVisible();
  await expect(page.locator('.canvas-container')).toHaveCount(0);
});

test('leaving a GIF editor restores the unchanged static editor path', async ({ page }) => {
  await openGifEditor(page);
  await page.locator('.back-btn .btn').click();
  await expect(page.locator('.canvas-container')).toHaveCount(0);
  await expect(page.locator('#gif-status')).toBeHidden();

  await page.locator('#meme-input').setInputFiles(blankImage);
  await expect(page.locator('#generate-meme')).toHaveText('Generate Meme');
  await expect(page.locator('#generate-meme')).toBeEnabled();
  expect(await page.evaluate(() => canvas.gifTimeline)).toBeUndefined();
});
