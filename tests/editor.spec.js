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
  await expect(page.locator('#animation-status')).toContainText('2 frames');
}

async function animatedApngBuffer(page) {
  await page.addScriptTag({ url: '/vendors/upng/UPNG.umd.js' });
  const bytes = await page.evaluate(() => {
    const width = 32;
    const height = 24;
    const frame = (red, green, blue) => {
      const pixels = new Uint8Array(width * height * 4);
      for (let index = 0; index < pixels.length; index += 4) {
        pixels[index] = red;
        pixels[index + 1] = green;
        pixels[index + 2] = blue;
        pixels[index + 3] = 255;
      }
      return pixels.buffer;
    };
    const output = new Uint8Array(
      UPNG.encode([frame(220, 20, 20), frame(20, 180, 40)], width, height, 0, [100, 200])
    );
    const view = new DataView(output.buffer);
    const crc32 = (start, length) => {
      let crc = 0xffffffff;
      for (let index = start; index < start + length; index++) {
        crc ^= output[index];
        for (let bit = 0; bit < 8; bit++) {
          crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
      }
      return (crc ^ 0xffffffff) >>> 0;
    };
    for (let offset = 8; offset + 20 <= output.length;) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...output.subarray(offset + 4, offset + 8));
      if (type === 'acTL') {
        view.setUint32(offset + 12, 3);
        view.setUint32(offset + 16, crc32(offset + 4, 12));
        break;
      }
      offset += 12 + length;
    }
    return Array.from(output);
  });
  return Buffer.from(bytes);
}

async function animatedWebpBuffer(page) {
  const bytes = await page.evaluate(async () => {
    const { encodeAnimation } = await import('/vendors/wasm-webp/index.js');
    const width = 32;
    const height = 24;
    const frame = (red, green, blue) => {
      const pixels = new Uint8Array(width * height * 4);
      for (let index = 0; index < pixels.length; index += 4) {
        pixels[index] = red;
        pixels[index + 1] = green;
        pixels[index + 2] = blue;
        pixels[index + 3] = 255;
      }
      return pixels;
    };
    const output = await encodeAnimation(width, height, true, [
      { data: frame(220, 20, 20), duration: 100, config: { lossless: 1, quality: 100 } },
      { data: frame(20, 180, 40), duration: 200, config: { lossless: 1, quality: 100 } },
    ]);
    let frameIndex = 0;
    const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
    for (let offset = 12; offset + 8 <= output.length;) {
      const length = view.getUint32(offset + 4, true);
      const type = String.fromCharCode(...output.subarray(offset, offset + 4));
      if (type === 'ANIM') {
        view.setUint16(offset + 12, 3, true);
      }
      else if (type === 'ANMF') {
        const delay = [100, 200][frameIndex++];
        output[offset + 20] = delay & 255;
        output[offset + 21] = (delay >>> 8) & 255;
        output[offset + 22] = (delay >>> 16) & 255;
      }
      offset += 8 + length + (length & 1);
    }
    return Array.from(output);
  });
  return Buffer.from(bytes);
}

async function openAdditionalAnimationEditor(page, format) {
  await page.goto('/');
  await expect(page.locator('.memes-container img').first()).toBeVisible();
  const isApng = format === 'APNG';
  const buffer = isApng ? await animatedApngBuffer(page) : await animatedWebpBuffer(page);
  await page.locator('#meme-input').setInputFiles({
    name: isApng ? 'animated-test.apng' : 'animated-test.webp',
    mimeType: isApng ? 'image/apng' : 'image/webp',
    buffer,
  });
  await expect(page.locator('#generate-meme')).toHaveText(`Generate ${format}`);
  await expect(page.locator('#generate-meme')).toBeEnabled();
  await expect(page.locator('#animation-status')).toContainText('2 frames');
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
  expect(await page.evaluate(() => canvas.animationTimeline.segments)).toEqual([
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
  await expect(page.locator('#animation-status')).toBeHidden();

  await page.locator('#meme-input').setInputFiles(blankImage);
  await expect(page.locator('#generate-meme')).toHaveText('Generate Meme');
  await expect(page.locator('#generate-meme')).toBeEnabled();
  expect(await page.evaluate(() => canvas.animationTimeline)).toBeUndefined();
});

for (const format of ['APNG', 'WebP']) {
  test(`${format} previews and exports both frames with their original timing`, async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await openAdditionalAnimationEditor(page, format);

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

    await page.locator('#add-text').click();
    await waitForHistory(page);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#generate-meme').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(format === 'APNG' ? /\.png$/ : /\.webp$/);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const output = Buffer.concat(chunks);

    const decoded = await page.evaluate(async ({ format, bytes }) => {
      if (format === 'APNG') {
        const image = UPNG.decode(new Uint8Array(bytes).buffer);
        const frames = UPNG.toRGBA8(image);
        return {
          width: image.width,
          height: image.height,
          delays: image.frames.map(frame => frame.delay),
          frameCount: frames.length,
          loopCount: image.tabs.acTL.num_plays,
          firstFrameColors: new Set(Array.from(new Uint32Array(frames[0]))).size,
        };
      }
      const { decodeAnimation } = await import('/vendors/wasm-webp/index.js');
      const frames = await decodeAnimation(new Uint8Array(bytes), true);
      const data = new Uint8Array(bytes);
      const view = new DataView(data.buffer);
      let loopCount;
      for (let offset = 12; offset + 8 <= data.length;) {
        const length = view.getUint32(offset + 4, true);
        if (String.fromCharCode(...data.subarray(offset, offset + 4)) === 'ANIM') {
          loopCount = view.getUint16(offset + 12, true);
          break;
        }
        offset += 8 + length + (length & 1);
      }
      return {
        width: frames[0].width,
        height: frames[0].height,
        delays: frames.map(frame => frame.duration),
        frameCount: frames.length,
        loopCount,
        firstFrameColors: new Set(Array.from(new Uint32Array(frames[0].data.buffer))).size,
      };
    }, { format, bytes: Array.from(output) });

    expect(decoded).toMatchObject({
      width: 32, height: 24, delays: [100, 200], frameCount: 2, loopCount: 3,
    });
    expect(decoded.firstFrameColors).toBeGreaterThan(1);
    expect(pageErrors).toEqual([]);
  });
}
