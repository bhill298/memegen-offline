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
  for (let y = Math.floor(height * 3 / 4); y < height; y++) {
    for (let x = Math.floor(width * 3 / 4); x < width; x++) {
      pixels[(y * width + x) * 4 + 3] = 0;
    }
  }
  return pixels;
}

async function animatedGifBuffer({ looped = true, loopCount = 0 } = {}) {
  const width = 64;
  const height = 48;
  const buffer = await encodeGif({
    width,
    height,
    looped,
    loopCount,
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

async function segmentedGifBuffer() {
  const width = 64;
  const height = 48;
  return Buffer.from(await encodeGif({
    width,
    height,
    looped: true,
    frames: [
      { data: solidFrame(width, height, 220, 20, 20), delay: 80 },
      { data: solidFrame(width, height, 20, 180, 40), delay: 90 },
      { data: solidFrame(width, height, 20, 40, 220), delay: 100 },
      { data: solidFrame(width, height, 220, 180, 20), delay: 110 },
    ],
  }));
}

async function openEditor(page) {
  await page.goto('/');
  await expect(page.locator('.memes-container img').first()).toBeVisible();
  await page.locator('#meme-input').setInputFiles(blankImage);
  await expect(page.locator('#generate-meme')).toBeEnabled();
  await expect(page.locator('.canvas-container')).toHaveCount(1);
}

async function openGifEditor(page, gifOptions) {
  await page.goto('/');
  await expect(page.locator('.memes-container img').first()).toBeVisible();
  await page.locator('#meme-input').setInputFiles({
    name: 'animated-test.gif',
    mimeType: 'image/gif',
    buffer: await animatedGifBuffer(gifOptions),
  });
  await expect(page.locator('#generate-meme')).toHaveText('Generate GIF');
  await expect(page.locator('#generate-meme')).toBeEnabled();
  await expect(page.locator('#animation-timeline')).toBeVisible();
  await expect(page.locator('#animation-frame-label')).toContainText('Frame 1 of 2');
}

async function openSegmentedGifEditor(page) {
  await page.goto('/');
  await expect(page.locator('.memes-container img').first()).toBeVisible();
  await page.locator('#meme-input').setInputFiles({
    name: 'segmented-test.gif',
    mimeType: 'image/gif',
    buffer: await segmentedGifBuffer(),
  });
  await expect(page.locator('#generate-meme')).toBeEnabled();
  await expect(page.locator('#animation-timeline')).toBeVisible();
  await expect(page.locator('#animation-frame-label')).toContainText('Frame 1 of 4');
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
      for (let y = Math.floor(height * 3 / 4); y < height; y++) {
        for (let x = Math.floor(width * 3 / 4); x < width; x++) {
          pixels[(y * width + x) * 4 + 3] = 0;
        }
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
      for (let y = Math.floor(height * 3 / 4); y < height; y++) {
        for (let x = Math.floor(width * 3 / 4); x < width; x++) {
          pixels[(y * width + x) * 4 + 3] = 0;
        }
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
  await expect(page.locator('#animation-timeline')).toBeVisible();
  await expect(page.locator('#animation-frame-label')).toContainText('Frame 1 of 2');
}

async function downloadAnimatedOutput(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#generate-meme').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return { download, output: Buffer.concat(chunks) };
}

async function decodeAnimatedOutput(page, format, output) {
  if (format === 'GIF') {
    const bytes = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
    const metadata = decodeGif(bytes);
    const frames = decodeGifFrames(bytes, { gif: metadata });
    return {
      width: metadata.width,
      height: metadata.height,
      delays: frames.map(frame => frame.delay),
      frameCount: frames.length,
      loopCount: metadata.loopCount || 0,
      looped: metadata.looped,
      hasTransparency: frames.some(frame =>
        frame.data.some((value, index) => index % 4 === 3 && value === 0)
      ),
    };
  }
  if (format === 'APNG') {
    await page.addScriptTag({ url: '/vendors/upng/UPNG.umd.js' });
  }
  return page.evaluate(async ({ format, bytes }) => {
    if (format === 'APNG') {
      const image = UPNG.decode(new Uint8Array(bytes).buffer);
      const frames = UPNG.toRGBA8(image);
      return {
        width: image.width,
        height: image.height,
        delays: image.frames.map(frame => frame.delay),
        frameCount: frames.length,
        loopCount: image.tabs.acTL.num_plays,
        hasTransparency: frames.some(frame =>
          new Uint8Array(frame).some((value, index) => index % 4 === 3 && value === 0)
        ),
      };
    }
    const { decodeAnimation } = await import('/vendors/wasm-webp/index.js');
    const data = new Uint8Array(bytes);
    const frames = await decodeAnimation(data, true);
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
      hasTransparency: frames.some(frame =>
        frame.data.some((value, index) => index % 4 === 3 && value === 0)
      ),
    };
  }, { format, bytes: Array.from(output) });
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

test('quality controls appear only for animations and explain the APNG exception', async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('#animation-quality-controls')).toBeHidden();

  await page.locator('.back-btn .btn').click();
  await openGifEditor(page);
  await expect(page.locator('#animation-quality-controls')).toBeVisible();
  await expect(page.locator('#animation-output-format')).toBeVisible();
  await expect(page.locator('#animation-quality')).toBeVisible();
  await expect(page.locator('#animation-quality')).toHaveValue('full');
  await expect(page.locator('#animation-output-format')).toHaveValue('gif');
  await expect(page.locator('#animation-output-format option')).toHaveText([
    'GIF (same as source)', 'WebP', 'APNG',
  ]);
  await expect(page.locator('#animation-gif-warning')).toBeHidden();
  await expect(page.locator('#animation-quality')).toHaveAttribute(
    'title',
    'Lower quality reduces file size and encoding time. For APNG, it reduces file size only. Full-quality WebP encoding is slow.'
  );
  await expect(page.locator('label[for="animation-quality"]')).toHaveAttribute(
    'title',
    'Lower quality reduces file size and encoding time. For APNG, it reduces file size only. Full-quality WebP encoding is slow.'
  );
  await expect(page.locator('#animation-quality-help')).toHaveCount(0);
});

test('WebP defaults to Balanced quality while GIF and APNG default to Full', async ({ page }) => {
  await openGifEditor(page);
  await expect(page.locator('#animation-quality')).toHaveValue('full');
  await page.locator('#animation-output-format').selectOption('webp');
  await expect(page.locator('#animation-quality')).toHaveValue('balanced');
  await page.locator('#animation-output-format').selectOption('apng');
  await expect(page.locator('#animation-quality')).toHaveValue('full');

  await page.locator('.back-btn .btn').click();
  await openAdditionalAnimationEditor(page, 'WebP');
  await expect(page.locator('#animation-quality')).toHaveValue('balanced');
});

test('encoding status does not push the Generate button below animation controls', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await openAdditionalAnimationEditor(page, 'WebP');
  const alignment = async label => page.evaluate(label => {
    const button = document.querySelector('#generate-meme');
    button.textContent = label;
    const quality = document.querySelector('#animation-quality').getBoundingClientRect();
    const generate = button.getBoundingClientRect();
    return {
      centerDifference: Math.abs(
        quality.top + quality.height / 2 - (generate.top + generate.height / 2)
      ),
      buttonWidth: generate.width,
    };
  }, label);

  const ready = await alignment('Generate WebP');
  const encoding = await alignment('Encoding WebP...');
  expect(ready.centerDifference).toBeLessThan(1);
  expect(encoding.centerDifference).toBeLessThan(1);
  expect(encoding.buttonWidth).toBeCloseTo(ready.buttonWidth, 1);
});

test('GIF conversion warning appears only for non-GIF sources exported as GIF', async ({ page }) => {
  await openAdditionalAnimationEditor(page, 'APNG');
  await expect(page.locator('#animation-output-format option')).toHaveText([
    'APNG (same as source)', 'GIF', 'WebP',
  ]);
  await expect(page.locator('#animation-gif-warning')).toBeHidden();

  const controlCenters = async () => page.evaluate(() => {
    const quality = document.querySelector('#animation-quality').getBoundingClientRect();
    const generate = document.querySelector('#generate-meme').getBoundingClientRect();
    return {
      quality: quality.top + quality.height / 2,
      generate: generate.top + generate.height / 2,
    };
  });
  const beforeWarning = await controlCenters();
  await page.locator('#animation-output-format').selectOption('gif');
  await expect(page.locator('#animation-gif-warning')).toBeVisible();
  await expect(page.locator('#animation-gif-warning')).toContainText(
    'Converting to GIF may reduce colors, transparency quality, and timing precision.'
  );
  const withWarning = await controlCenters();
  expect(Math.abs(beforeWarning.generate - beforeWarning.quality)).toBeLessThan(1);
  expect(Math.abs(withWarning.generate - withWarning.quality)).toBeLessThan(1);

  await page.locator('#animation-output-format').selectOption('webp');
  await expect(page.locator('#animation-gif-warning')).toBeHidden();
});

const conversionCases = [
  { source: 'GIF', output: 'WebP' },
  { source: 'GIF', output: 'APNG' },
  { source: 'APNG', output: 'GIF' },
  { source: 'APNG', output: 'WebP' },
  { source: 'WebP', output: 'GIF' },
  { source: 'WebP', output: 'APNG' },
];

for (const conversion of conversionCases) {
  test(`${conversion.source} can export as ${conversion.output}`, async ({ page }) => {
    if (conversion.source === 'GIF') {
      await openGifEditor(page);
    }
    else {
      await openAdditionalAnimationEditor(page, conversion.source);
    }
    await page.locator('#animation-output-format').selectOption(conversion.output.toLowerCase());
    await expect(page.locator('#generate-meme')).toHaveText(`Generate ${conversion.output}`);

    const { download, output } = await downloadAnimatedOutput(page);
    const extension = conversion.output === 'APNG' ? '.png' : `.${conversion.output.toLowerCase()}`;
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\${extension}$`));
    const decoded = await decodeAnimatedOutput(page, conversion.output, output);
    const sourceIsGif = conversion.source === 'GIF';
    const expectedLoopCount = conversion.output === 'GIF'
      ? 2
      : (sourceIsGif ? 0 : 3);
    expect(decoded).toMatchObject({
      width: sourceIsGif ? 64 : 32,
      height: sourceIsGif ? 48 : 24,
      delays: [100, 200],
      frameCount: 2,
      loopCount: expectedLoopCount,
      hasTransparency: true,
    });
    if (conversion.output === 'GIF') {
      expect(decoded.looped).toBe(true);
    }
  });
}

for (const outputFormat of ['APNG', 'WebP']) {
  test(`finite GIF loop count is preserved when converting to ${outputFormat}`, async ({ page }) => {
    // A GIF loop count of 2 means one initial play plus two repetitions.
    await openGifEditor(page, { loopCount: 2 });
    await page.locator('#animation-output-format').selectOption(outputFormat.toLowerCase());

    const { output } = await downloadAnimatedOutput(page);
    const decoded = await decodeAnimatedOutput(page, outputFormat, output);
    expect(decoded.loopCount).toBe(3);
  });
}

for (const format of ['GIF', 'APNG', 'WebP']) {
  for (const quality of ['balanced', 'low']) {
    test(`${format} ${quality} quality preserves animation metadata`, async ({ page }) => {
      if (format === 'GIF') {
        await openGifEditor(page);
      }
      else {
        await openAdditionalAnimationEditor(page, format);
      }
      await page.locator('#animation-quality').selectOption(quality);

      const downloadPromise = page.waitForEvent('download');
      await page.locator('#generate-meme').click();
      const download = await downloadPromise;
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const output = Buffer.concat(chunks);

      if (format === 'GIF') {
        const bytes = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
        const metadata = decodeGif(bytes);
        const frames = decodeGifFrames(bytes, { gif: metadata });
        expect({
          width: metadata.width,
          height: metadata.height,
          delays: frames.map(frame => frame.delay),
          frameCount: frames.length,
          looped: metadata.looped,
          hasTransparency: frames.some(frame =>
            frame.data.some((value, index) => index % 4 === 3 && value === 0)
          ),
        }).toEqual({
          width: quality === 'balanced' ? 42 : 32,
          height: quality === 'balanced' ? 32 : 24,
          delays: [100, 200],
          frameCount: 2,
          looped: true,
          hasTransparency: true,
        });
        return;
      }

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
            hasTransparency: frames.some(frame =>
              new Uint8Array(frame).some((value, index) => index % 4 === 3 && value === 0)
            ),
          };
        }
        const { decodeAnimation } = await import('/vendors/wasm-webp/index.js');
        const data = new Uint8Array(bytes);
        const frames = await decodeAnimation(data, true);
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
          hasTransparency: frames.some(frame =>
            frame.data.some((value, index) => index % 4 === 3 && value === 0)
          ),
        };
      }, { format, bytes: Array.from(output) });

      expect(decoded).toEqual({
        width: 32,
        height: 24,
        delays: [100, 200],
        frameCount: 2,
        loopCount: 3,
        hasTransparency: true,
      });
    });
  }
}

test('animation aliases find GIF, WebP, and APNG gallery entries', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.memes-container img').first()).toBeVisible();
  const results = await page.evaluate(() => {
    __imgNames.splice(0, __imgNames.length,
      '2014-moving-template.webp',
      '2015-classic-template.gif',
      '2016-animated-png.apng',
      '2017-static-template.png'
    );
    const search = term => {
      __lastMemeSearchTerm = '';
      doMemeSearch(term);
      return Array.from(document.querySelectorAll('.memes-container img'))
        .map(image => decodeURIComponent(new URL(image.src).pathname.split('/').pop()));
    };
    return {
      animated: search('animated'),
      animation: search('animation'),
      gif: search('gif'),
      gifs: search('gifs'),
    };
  });
  const expected = [
    '2014-moving-template.webp',
    '2015-classic-template.gif',
    '2016-animated-png.apng',
  ];
  expect(results.animated).toEqual(expected);
  expect(results.animation).toEqual(expected);
  expect(results.gif).toEqual(expected);
  expect(results.gifs).toEqual(expected);
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
  const pageCount = page.context().pages().length;
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#generate-meme').click();
  const download = await downloadPromise;
  expect(page.context().pages()).toHaveLength(pageCount);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const png = Buffer.concat(chunks);

  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(450);
  expect(png.readUInt32BE(20)).toBe(123);
});

test('an animated GIF is paused and can seek to exact frames', async ({ page }) => {
  await openGifEditor(page);
  expect(await page.evaluate(() => canvas.animationTimeline.segments)).toEqual([
    { startFrame: 0, editorState: [] },
  ]);
  const readColor = () => page.evaluate(() => {
    const frameCanvas = canvas.backgroundImage.getElement();
    return Array.from(frameCanvas.getContext('2d').getImageData(0, 0, 1, 1).data);
  });
  const firstColor = await readColor();
  await page.waitForTimeout(350);
  expect(await readColor()).toEqual(firstColor);
  await expect(page.locator('#animation-frame-label')).toContainText('Frame 1 of 2');
  await expect(page.locator('#animation-range-label')).toHaveText('Editing frames 1–2');
  await expect(page.locator('#animation-split')).toBeDisabled();

  await page.locator('#animation-frame-slider').fill('1');
  await expect.poll(readColor).not.toEqual(firstColor);
  await expect(page.locator('#animation-frame-label')).toContainText('Frame 2 of 2');
  await expect(page.locator('#animation-split')).toBeEnabled();
});

test('GIF export preserves frames and timing and applies one overlay to every frame', async ({ page }) => {
  await openGifEditor(page);
  await page.locator('#add-text').click();
  await waitForHistory(page);

  const labelsPromise = page.evaluate(() => new Promise(resolve => {
    const labels = [];
    const button = document.querySelector('#generate-meme');
    const observer = new MutationObserver(() => {
      const label = button.textContent.trim();
      if (labels.at(-1) !== label) labels.push(label);
      if (label === 'Generate GIF' && labels.some(value => value.startsWith('Encoding GIF'))) {
        observer.disconnect();
        resolve(labels);
      }
    });
    observer.observe(button, { childList: true, characterData: true, subtree: true });
  }));
  const pageCount = page.context().pages().length;
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#generate-meme').click();
  const download = await downloadPromise;
  expect(page.context().pages()).toHaveLength(pageCount);
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
  const labels = await labelsPromise;

  expect(metadata.width).toBe(64);
  expect(metadata.height).toBe(48);
  expect(metadata.frames).toHaveLength(2);
  expect(frames.map(frame => frame.delay)).toEqual([100, 200]);
  expect(metadata.looped).toBe(true);
  expect(frames.some(frame =>
    frame.data.some((value, index) => index % 4 === 3 && value === 0)
  )).toBe(true);
  expect(labels.some(label => /^Preparing GIF\.\.\. \d+\/2$/.test(label))).toBe(true);
  expect(labels).toContain('Encoding GIF...');
  expect(labels.some(label => label.startsWith('Finalizing'))).toBe(false);
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

test('animation safety limits include decoded source and output frame memory', async ({ page }) => {
  await page.goto('/');
  const message = await page.evaluate(() => {
    const metadata = { width: 1024, height: 1024, frameCount: 30 };
    const sizePlan = createAnimatedImageSizePlan(metadata.width, metadata.height);
    try {
      enforceAnimationLimits(metadata, 'GIF', sizePlan);
      return '';
    }
    catch (error) {
      return error.message;
    }
  });

  expect(message).toBe(
    'This GIF needs at least 240 MB for decoded source and output frames; ' +
    'the memory safety limit is 192 MB.'
  );
});

test('the animation file-size limit does not reject an oversized static PNG', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const png = await fetch('/img/memes/blank.png').then(response => response.arrayBuffer());
    const imgInfo = {
      fileName: 'oversized-static.png',
      mimeType: 'image/png',
      width: 1,
      height: 1,
      sourceFile: {
        size: 51 * 1024 * 1024,
        arrayBuffer: async () => png,
      },
    };
    const prepared = await prepareAnimatedMemeInfo(imgInfo);
    return { sameObject: prepared === imgInfo, animated: Boolean(prepared.animationInfo) };
  });

  expect(result).toEqual({ sameObject: true, animated: false });
});

test('the animation file-size limit still rejects an oversized animated GIF', async ({ page }) => {
  await page.goto('/');
  const gif = await animatedGifBuffer();
  const message = await page.evaluate(async bytes => {
    try {
      await prepareAnimatedMemeInfo({
        fileName: 'oversized-animation.gif',
        mimeType: 'image/gif',
        sourceFile: {
          size: 51 * 1024 * 1024,
          arrayBuffer: async () => new Uint8Array(bytes).buffer,
        },
      });
      return '';
    }
    catch (error) {
      return error.message;
    }
  }, Array.from(gif));

  expect(message).toBe('GIF files are limited to 50 MB.');
});

test('leaving a GIF editor restores the unchanged static editor path', async ({ page }) => {
  await openGifEditor(page);
  await page.locator('.back-btn .btn').click();
  await expect(page.locator('.canvas-container')).toHaveCount(0);
  await expect(page.locator('#animation-timeline')).toBeHidden();

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

    const firstColor = await page.evaluate(() => {
      const frameCanvas = canvas.backgroundImage.getElement();
      return Array.from(frameCanvas.getContext('2d').getImageData(0, 0, 1, 1).data);
    });
    await page.locator('#animation-frame-slider').fill('1');
    await expect.poll(() => page.evaluate(() => {
      const frameCanvas = canvas.backgroundImage.getElement();
      return Array.from(frameCanvas.getContext('2d').getImageData(0, 0, 1, 1).data);
    })).not.toEqual(firstColor);

    await page.locator('#add-text').click();
    await waitForHistory(page);
    const pageCount = page.context().pages().length;
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#generate-meme').click();
    const download = await downloadPromise;
    expect(page.context().pages()).toHaveLength(pageCount);
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
          hasTransparency: frames.some(frame =>
            new Uint8Array(frame).some((value, index) => index % 4 === 3 && value === 0)
          ),
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
        hasTransparency: frames.some(frame =>
          frame.data.some((value, index) => index % 4 === 3 && value === 0)
        ),
      };
    }, { format, bytes: Array.from(output) });

    expect(decoded).toMatchObject({
      width: 32, height: 24, delays: [100, 200], frameCount: 2, loopCount: 3,
      hasTransparency: true,
    });
    expect(decoded.firstFrameColors).toBeGreaterThan(1);
    expect(pageErrors).toEqual([]);
  });
}

test('a timeline split can be undone and redone', async ({ page }) => {
  await openSegmentedGifEditor(page);
  await page.locator('#animation-frame-slider').fill('2');
  await page.locator('#animation-split').click();
  expect(await page.evaluate(() => canvas.animationTimeline.segments.map(s => s.startFrame)))
    .toEqual([0, 2]);
  await expect(page.locator('.animation-segment-marker')).toHaveCount(2);
  await expect(page.locator('.animation-segment-marker.active')).toHaveCount(1);
  await expect(page.locator('.animation-segment-marker').nth(1)).toBeVisible();
  expect((await page.locator('.animation-segment-marker').nth(1).boundingBox()).height)
    .toBeGreaterThan(15);
  const markerOffset = await page.evaluate(() => {
    const slider = document.querySelector('#animation-frame-slider').getBoundingClientRect();
    const marker = document.querySelectorAll('.animation-segment-marker')[1]
      .getBoundingClientRect();
    const thumbSize = 16;
    const expectedCenter = slider.left + thumbSize / 2 +
      (slider.width - thumbSize) * 2 / 3;
    return marker.left + marker.width / 2 - expectedCenter;
  });
  expect(Math.abs(markerOffset)).toBeLessThan(0.2);
  await expect(page.locator('#animation-range-label')).toHaveText('Editing frames 3–4');

  await page.locator('#canvas-undo').click();
  await expect.poll(() => page.evaluate(() =>
    canvas.animationTimeline.segments.map(segment => segment.startFrame)
  )).toEqual([0]);
  await expect(page.locator('#animation-range-label')).toHaveText('Editing frames 1–4');

  await page.locator('#canvas-redo').click();
  await expect.poll(() => page.evaluate(() =>
    canvas.animationTimeline.segments.map(segment => segment.startFrame)
  )).toEqual([0, 2]);
});

test('segments can be created and edited back-to-front without changing later states', async ({ page }) => {
  await openSegmentedGifEditor(page);
  await page.locator('#add-text').click();
  await waitForHistory(page);

  await page.locator('#animation-frame-slider').fill('3');
  await page.locator('#animation-split').click();
  await page.locator('#add-text').click();
  await page.locator('#add-text').click();
  await waitForHistory(page);

  await page.locator('#animation-frame-slider').fill('1');
  await expect.poll(async () => (await canvasObjects(page)).length).toBe(1);
  await page.locator('#animation-split').click();
  await page.locator('#add-text').click();
  await waitForHistory(page);
  await expect.poll(() => page.evaluate(() =>
    canvas.animationTimeline.segments[1].editorState.length
  )).toBe(2);

  expect(await page.evaluate(() => canvas.animationTimeline.segments.map(segment => ({
    startFrame: segment.startFrame,
    objectCount: segment.editorState.length,
  })))).toEqual([
    { startFrame: 0, objectCount: 1 },
    { startFrame: 1, objectCount: 2 },
    { startFrame: 3, objectCount: 3 },
  ]);

  for (const [frame, objectCount] of [[0, 1], [2, 2], [3, 3]]) {
    await page.locator('#animation-frame-slider').fill(String(frame));
    await expect.poll(async () => (await canvasObjects(page)).length).toBe(objectCount);
  }

  await page.locator('#animation-frame-slider').fill('2');
  await page.locator('#add-text').click();
  await expect.poll(() => page.evaluate(() =>
    canvas.animationTimeline.segments[1].editorState.length
  )).toBe(3);
  await page.locator('#canvas-undo').click();
  await expect.poll(async () => (await canvasObjects(page)).length).toBe(2);
  expect(await page.evaluate(() =>
    canvas.animationTimeline.segments[2].editorState.length
  )).toBe(3);
});

test('animated export applies each segment only within its frame range', async ({ page }) => {
  await openSegmentedGifEditor(page);
  await page.locator('#animation-frame-slider').fill('2');
  await page.locator('#animation-split').click();
  await page.locator('#add-text').click();
  await waitForHistory(page);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#generate-meme').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const output = Buffer.concat(chunks);
  const exactOutput = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
  const metadata = decodeGif(exactOutput);
  const frames = decodeGifFrames(exactOutput, { gif: metadata });
  const colorCounts = frames.map(frame => {
    const colors = new Set();
    for (let index = 0; index < frame.data.length; index += 4) {
      colors.add(`${frame.data[index]},${frame.data[index + 1]},${frame.data[index + 2]}`);
    }
    return colors.size;
  });

  expect(colorCounts[0]).toBe(colorCounts[1]);
  expect(colorCounts[2]).toBeGreaterThan(colorCounts[0]);
  expect(colorCounts[3]).toBeGreaterThan(colorCounts[0]);
});

test('added image overlays remain local to their animation segment', async ({ page }) => {
  await openSegmentedGifEditor(page);
  await page.locator('#animation-frame-slider').fill('2');
  await page.locator('#animation-split').click();
  await page.locator('#add-image').setInputFiles(blankImage);
  await expect.poll(async () =>
    (await canvasObjects(page)).filter(object => object.type === 'image').length
  ).toBe(1);

  await page.locator('#animation-frame-slider').fill('0');
  await expect.poll(async () => (await canvasObjects(page)).length).toBe(0);
  await page.locator('#animation-frame-slider').fill('3');
  await expect.poll(async () =>
    (await canvasObjects(page)).filter(object => object.type === 'image').length
  ).toBe(1);
});
