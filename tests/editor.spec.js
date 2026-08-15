const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { encode: encodeGif, decode: decodeGif, decodeFrames: decodeGifFrames } = require('modern-gif');

const blankImage = path.resolve(__dirname, '..', 'server', 'img', 'memes', 'blank.png');
const largeOverlayImage = path.resolve(
  __dirname, '..', 'server', 'img', 'memes', '1036-hide-the-pain-harold-thumbs-up.jpg'
);

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

test('ignores overlapping custom-template selections while preparing an editor', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.memes-container img').first()).toBeVisible();
  await page.evaluate(() => {
    window.__prepareCallCount = 0;
    const originalPrepareAnimatedMemeInfo = prepareAnimatedMemeInfo;
    prepareAnimatedMemeInfo = async function (imgInfo) {
      window.__prepareCallCount++;
      await new Promise(resolve => setTimeout(resolve, 300));
      return originalPrepareAnimatedMemeInfo(imgInfo);
    };
  });

  await page.locator('#meme-input').setInputFiles(blankImage);
  await page.locator('#meme-input').setInputFiles(blankImage);
  await expect(page.locator('#generate-meme')).toBeEnabled();

  expect(await page.evaluate(() => window.__prepareCallCount)).toBe(1);
  await expect(page.locator('.canvas-container')).toHaveCount(1);
  await expect(page.locator('#meme-canvas')).toHaveCount(1);
});

test('quality controls appear only for animations and explain slow full-quality encoding', async ({ page }) => {
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
    'Lower quality reduces file size and encoding time. Full-quality APNG and WebP encoding is slow.'
  );
  await expect(page.locator('label[for="animation-quality"]')).toHaveAttribute(
    'title',
    'Lower quality reduces file size and encoding time. Full-quality APNG and WebP encoding is slow.'
  );
  await expect(page.locator('#animation-quality-help')).toHaveCount(0);
});

test('icon-only text controls have descriptive accessible names', async ({ page }) => {
  await openEditor(page);
  const expectedNames = {
    '#bold': 'Bold text',
    '#italic': 'Italic text',
    '#underline': 'Underline text',
    '#left': 'Align text left',
    '#center': 'Align text center',
    '#right': 'Align text right',
    '#bg-option': 'Toggle text background color',
  };

  for (const [selector, name] of Object.entries(expectedNames)) {
    await expect(page.locator(selector)).toHaveAccessibleName(name);
  }
  await expect.poll(() => page.locator(
    '#font-style i, label.align i, #bg-option i'
  ).evaluateAll(icons => icons.map(icon => icon.getAttribute('aria-hidden')))).toEqual(
    Array(7).fill('true')
  );
});

test('color controls have descriptive button semantics and keyboard activation', async ({ page }) => {
  await openEditor(page);
  const expectedNames = {
    '#stroke-color': 'Choose text stroke color',
    '#shadow-color': 'Choose text shadow color',
    '#bg-color': 'Choose text background color',
    '#text-color': 'Choose text color',
  };

  for (const [selector, name] of Object.entries(expectedNames)) {
    const control = page.locator(selector);
    await expect(control).toHaveRole('button');
    await expect(control).toHaveAccessibleName(name);
    await expect(control).toHaveAttribute('tabindex', '0');
    await expect(control.locator('i')).toHaveAttribute('aria-hidden', 'true');
  }

  await page.evaluate(() => {
    window.__colorControlClicks = { stroke: 0, brush: 0 };
    $('#stroke-color').on('click.accessibilityTest', () => window.__colorControlClicks.stroke++);
    $('#brush-color').on('click.accessibilityTest', () => window.__colorControlClicks.brush++);
  });
  await page.locator('#stroke-color').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__colorControlClicks.stroke)).toBe(1);

  await page.locator('#toggle-brush').click();
  const brushColor = page.locator('#brush-color');
  await expect(brushColor).toHaveRole('button');
  await expect(brushColor).toHaveAccessibleName('Choose brush color');
  await expect(brushColor).toHaveAttribute('tabindex', '0');
  await expect(brushColor.locator('i')).toHaveAttribute('aria-hidden', 'true');
  await brushColor.focus();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__colorControlClicks.brush)).toBe(1);
});

test('APNG and WebP default to Balanced quality while GIF defaults to Full', async ({ page }) => {
  await openGifEditor(page);
  await expect(page.locator('#animation-quality')).toHaveValue('full');
  await page.locator('#animation-output-format').selectOption('webp');
  await expect(page.locator('#animation-quality')).toHaveValue('balanced');
  await page.locator('#animation-output-format').selectOption('apng');
  await expect(page.locator('#animation-quality')).toHaveValue('balanced');

  await page.locator('.back-btn .btn').click();
  await openAdditionalAnimationEditor(page, 'WebP');
  await expect(page.locator('#animation-quality')).toHaveValue('balanced');

  await page.locator('.back-btn .btn').click();
  await openAdditionalAnimationEditor(page, 'APNG');
  await expect(page.locator('#animation-quality')).toHaveValue('balanced');
});

test('the longest encoding status fits without shifting the Generate button', async ({ page }) => {
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
      textFits: button.scrollWidth <= button.clientWidth,
    };
  }, label);

  const ready = await alignment('Generate WebP');
  const encoding = await alignment('Preparing APNG... 300/300');
  expect(ready.centerDifference).toBeLessThan(1);
  expect(encoding.centerDifference).toBeLessThan(1);
  expect(encoding.buttonWidth).toBeCloseTo(ready.buttonWidth, 1);
  expect(encoding.textFits).toBe(true);
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

test('GIF conversion warning wraps without causing narrow viewport overflow', async ({ page }) => {
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await openAdditionalAnimationEditor(page, 'APNG');
    await page.locator('#animation-output-format').selectOption('gif');
    await expect(page.locator('#animation-gif-warning')).toBeVisible();

    const layout = await page.evaluate(() => {
      const warning = document.querySelector('#animation-gif-warning');
      const bounds = warning.getBoundingClientRect();
      return {
        documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
        warningLeft: bounds.left,
        warningRight: bounds.right,
        viewportWidth: window.innerWidth,
        whiteSpace: getComputedStyle(warning).whiteSpace,
      };
    });
    expect(layout.documentOverflow).toBeLessThanOrEqual(0);
    expect(layout.warningLeft).toBeGreaterThanOrEqual(0);
    expect(layout.warningRight).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.whiteSpace).toBe('normal');
  }

  await page.setViewportSize({ width: 1100, height: 900 });
  await openAdditionalAnimationEditor(page, 'APNG');
  await page.locator('#animation-output-format').selectOption('gif');
  await expect(page.locator('#animation-gif-warning')).toHaveCSS('white-space', 'nowrap');
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

test('gallery search handles OR, AND, case, repeated whitespace, no results, and reset', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.memes-container img').first()).toBeVisible();
  await page.evaluate(() => {
    __imgNames.splice(0, __imgNames.length,
      'alpha-only.png',
      'alpha-beta.png',
      'beta-only.png',
      'unrelated.png'
    );
    __currentMemeIndex = 0;
    __currentMemeEndIndex = __imgNames.length - 1;
    __lastMemeSearchTerm = '';
    updatePhotosFromNames(__imgNames);
  });

  const visibleNames = () => page.locator('.memes-container img').evaluateAll(images =>
    images.map(image => image.title)
  );

  await page.locator('#meme-search').fill('alpha beta');
  await expect.poll(visibleNames).toEqual([
    'alpha-only', 'alpha-beta', 'beta-only',
  ]);

  await page.locator('#meme-search-option-and').check();
  await expect.poll(visibleNames).toEqual(['alpha-beta']);

  await page.locator('#meme-search').fill('  ALPHA   BETA  ');
  await expect.poll(visibleNames).toEqual(['alpha-beta']);

  await page.locator('#meme-search').fill('missing');
  await expect.poll(visibleNames).toEqual([]);

  await page.locator('#meme-search').fill('');
  await expect.poll(visibleNames).toEqual([
    'alpha-only', 'alpha-beta', 'beta-only', 'unrelated',
  ]);
});

test('stale search layouts cannot show pagination for current empty results', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.memes-container img').first()).toBeVisible();
  await page.evaluate(() => {
    __imgNames.splice(0, __imgNames.length, 'alpha.png', 'beta.png');
    __currentMemeIndex = 0;
    __currentMemeEndIndex = __imgNames.length - 1;
    __lastMemeSearchTerm = '';
    updatePhotosFromNames(__imgNames);
  });

  await page.locator('#meme-search').fill('alpha');
  await expect.poll(() => page.locator('.memes-container img').count()).toBe(1);
  await page.locator('#meme-search').fill('missing');
  await expect.poll(() => page.locator('.memes-container img').count()).toBe(0);

  // Simulate a delayed Masonry completion after the newer empty search rendered.
  await page.evaluate(() => $('.grid').trigger('layoutComplete'));
  await expect(page.locator('#prev-next-buttons')).toBeHidden();
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

for (const deletion of [
  { name: 'Clear', perform: async page => page.locator('#canvas-clear').click() },
  {
    name: 'Delete button',
    perform: async page => {
      await page.evaluate(() => canvas.setActiveObject(canvas.item(0)).renderAll());
      await page.locator('#canvas-delete').click();
    },
  },
  {
    name: 'Delete key',
    perform: async page => {
      await page.locator('#meme-canvas-wrapper').focus();
      await page.evaluate(() => canvas.setActiveObject(canvas.item(0)).renderAll());
      await page.keyboard.press('Delete');
    },
  },
  {
    name: 'Cut shortcut',
    perform: async page => {
      await page.locator('#meme-canvas-wrapper').focus();
      await page.evaluate(() => canvas.setActiveObject(canvas.item(0)).renderAll());
      await page.keyboard.press('Control+x');
    },
  },
]) {
  test(`${deletion.name} preserves a pending edit as an undo state`, async ({ page }) => {
    await openEditor(page);
    await page.locator('#add-text').click();
    await deletion.perform(page);
    await expect.poll(async () => (await canvasObjects(page)).length).toBe(0);
    await expect(page.locator('#canvas-undo')).toBeEnabled();

    await page.locator('#canvas-undo').click();
    await expect.poll(async () => (await canvasObjects(page)).length).toBe(1);
  });
}

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
  expect(await page.evaluate(() => {
    const center = canvas.getObjects().find(object => object.type === 'image').getCenterPoint();
    return { x: center.x, y: center.y };
  })).toEqual({ x: 225, y: 61.5 });
  await waitForHistory(page);

  await page.locator('#canvas-undo').click();
  await expect.poll(async () => (await canvasObjects(page)).length).toBe(0);
  await page.locator('#canvas-redo').click();
  await expect.poll(async () => (await canvasObjects(page)).filter(object => object.type === 'image').length).toBe(1);
});

test('large added images are reduced to interactive working dimensions', async ({ page }) => {
  await openEditor(page);
  await page.locator('#add-image').setInputFiles(largeOverlayImage);
  await expect.poll(() => page.evaluate(() => {
    const image = canvas.getObjects().find(object => object.type === 'image');
    const element = image && image.getElement();
    return element && { width: element.width, height: element.height };
  })).toEqual({ width: 1652, height: 1388 });
  await expect(page.locator('.alert-container')).toContainText(
    'Large added image resized to 1652 x 1388.'
  );
});

test('an added image can be cropped and the crop can be undone and redone', async ({ page }) => {
  await openEditor(page);
  await page.locator('#add-image').setInputFiles(blankImage);
  await expect(page.locator('#crop-image')).toHaveCount(0);
  await page.evaluate(() => {
    canvas.getActiveObject().set({ left: 50, top: 70 }).setCoords();
    canvas.renderAll();
  });

  async function clickCanvasControl(controlName) {
    const target = await page.evaluate(name => {
      const image = canvas.getActiveObject();
      image.setCoords();
      return {
        point: { x: image.oCoords[name].x, y: image.oCoords[name].y },
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      };
    }, controlName);
    const bounds = await page.locator('.upper-canvas').boundingBox();
    await page.mouse.click(
      bounds.x + target.point.x * bounds.width / target.canvasWidth,
      bounds.y + target.point.y * bounds.height / target.canvasHeight
    );
  }

  const original = await page.evaluate(() => {
    const image = canvas.getActiveObject();
    return { width: image.width, height: image.height };
  });
  const cropLeft = Math.min(80, original.width - 1);

  expect(await page.evaluate(() => Object.keys(canvas.getActiveObject().controls))).toContain('cropMode');
  const triggerLayout = await page.evaluate(() => {
    const image = canvas.getActiveObject();
    image.setCoords();
    return {
      crop: image.oCoords.cropMode,
      middle: image.oCoords.mt,
      rotation: image.oCoords.mtr,
      right: image.oCoords.tr,
      control: {
        x: image.controls.cropMode.x,
        y: image.controls.cropMode.y,
        offsetX: image.controls.cropMode.offsetX *
          image.canvas.upperCanvasEl.getBoundingClientRect().width / image.canvas.width,
        offsetY: image.controls.cropMode.offsetY *
          image.canvas.upperCanvasEl.getBoundingClientRect().width / image.canvas.width,
        sizeX: image.controls.cropMode.sizeX *
          image.canvas.upperCanvasEl.getBoundingClientRect().width / image.canvas.width,
        resizeHandleSize: image.cornerSize *
          image.canvas.upperCanvasEl.getBoundingClientRect().width / image.canvas.width,
      },
      displayScale: image.canvas.upperCanvasEl.getBoundingClientRect().width / image.canvas.width,
    };
  });
  expect(triggerLayout.control.x).toBe(0);
  expect(triggerLayout.control.y).toBe(-0.5);
  expect(triggerLayout.control.offsetX).toBeCloseTo(20, 1);
  expect(triggerLayout.control.offsetY).toBeCloseTo(-20, 1);
  expect(triggerLayout.control.sizeX).toBeCloseTo(28, 1);
  expect(triggerLayout.control.resizeHandleSize).toBeCloseTo(14, 1);
  const horizontalGap = (triggerLayout.crop.x - triggerLayout.middle.x) *
    triggerLayout.displayScale - 12;
  const verticalGap = (triggerLayout.middle.y - triggerLayout.crop.y) *
    triggerLayout.displayScale - 12;
  expect(Math.abs(horizontalGap - verticalGap)).toBeLessThan(1);
  expect(triggerLayout.crop.y).toBeCloseTo(
    (triggerLayout.middle.y + triggerLayout.rotation.y) / 2,
    5
  );
  expect(triggerLayout.crop.y).toBeGreaterThan(triggerLayout.right.y - 40);
  expect(triggerLayout.crop.y).toBeLessThan(triggerLayout.middle.y);
  await page.locator('#meme-canvas-wrapper').focus();
  await page.keyboard.press('Control+c');
  expect(await page.evaluate(() => Object.keys(canvas.getActiveObject().controls))).toContain('mtr');
  await clickCanvasControl('cropMode');
  expect(await page.evaluate(() => Object.keys(canvas.getActiveObject().controls).sort())).toEqual(
    ['bl', 'br', 'cropMode', 'mb', 'ml', 'mr', 'mt', 'tl', 'tr']
  );

  // The icon toggles crop mode off, and the keyboard shortcuts offer the same path.
  await clickCanvasControl('cropMode');
  expect(await page.evaluate(() => Object.keys(canvas.getActiveObject().controls))).toContain('mtr');
  await page.locator('#meme-canvas-wrapper').focus();
  await page.keyboard.press('c');
  expect(await page.evaluate(() => Object.keys(canvas.getActiveObject().controls))).not.toContain('mtr');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => Object.keys(canvas.getActiveObject().controls))).toContain('mtr');
  await clickCanvasControl('cropMode');

  async function dragLeftCrop(sourcePixelDelta) {
    const drag = await page.evaluate(delta => {
      const image = canvas.getActiveObject();
      image.setCoords();
      return {
        start: { x: image.oCoords.ml.x, y: image.oCoords.ml.y },
        end: { x: image.oCoords.ml.x + delta * image.scaleX, y: image.oCoords.ml.y },
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      };
    }, sourcePixelDelta);
    const bounds = await page.locator('.upper-canvas').boundingBox();
    const point = ({ x, y }) => ({
      x: bounds.x + x * bounds.width / drag.canvasWidth,
      y: bounds.y + y * bounds.height / drag.canvasHeight,
    });
    const start = point(drag.start);
    const end = point(drag.end);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();
  }

  await dragLeftCrop(cropLeft);

  await expect.poll(() => page.evaluate(() => {
    const image = canvas.getActiveObject();
    return Math.round(image.cropX);
  })).toBe(cropLeft);

  // The crop is still reversible while the crop handles are active.
  await dragLeftCrop(-cropLeft - 10);
  await expect.poll(() => page.evaluate(() => Math.round(canvas.getActiveObject().cropX))).toBe(0);
  await dragLeftCrop(cropLeft);

  const movement = await page.evaluate(() => {
    const image = canvas.getActiveObject();
    const center = image.getCenterPoint();
    return { center, canvasWidth: canvas.width, canvasHeight: canvas.height };
  });
  const movementBounds = await page.locator('.upper-canvas').boundingBox();
  const movementScaleX = movementBounds.width / movement.canvasWidth;
  const movementScaleY = movementBounds.height / movement.canvasHeight;
  const startX = movementBounds.x + movement.center.x * movementScaleX;
  const startY = movementBounds.y + movement.center.y * movementScaleY;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 20 * movementScaleX, startY + 10 * movementScaleY, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(expected => {
    const center = canvas.getActiveObject().getCenterPoint();
    return center.x - expected.x > 15 && center.y - expected.y > 5;
  }, movement.center)).toBe(true);

  // Clicking empty canvas commits the crop and restores the regular resize handles.
  const surface = page.locator('.upper-canvas');
  const surfaceBounds = await surface.boundingBox();
  await page.mouse.click(surfaceBounds.x + surfaceBounds.width - 4, surfaceBounds.y + surfaceBounds.height - 4);
  await expect(page.locator('#meme-canvas-wrapper')).toHaveAttribute(
    'aria-label', 'Meme canvas editor. Select an image to edit it.'
  );
  expect(await page.evaluate(() => Object.keys(canvas.getObjects()[0].controls))).toContain('mtr');
  expect(await page.evaluate(() => Object.keys(canvas.getObjects()[0].controls))).toContain('cropMode');
  await page.locator('#canvas-undo').click();
  await expect.poll(() => page.evaluate(() => {
    const image = canvas.getObjects().find(object => object.type === 'image');
    return { cropX: image.cropX, cropY: image.cropY, width: image.width, height: image.height };
  })).toEqual({ cropX: 0, cropY: 0, width: original.width, height: original.height });

  await page.locator('#canvas-redo').click();
  await expect.poll(() => page.evaluate(() => {
    const image = canvas.getObjects().find(object => object.type === 'image');
    return {
      cropX: Math.round(image.cropX),
      cropY: Math.round(image.cropY),
      width: Math.round(image.width),
      height: Math.round(image.height),
    };
  })).toEqual({
    cropX: cropLeft,
    cropY: 0,
    width: original.width - cropLeft,
    height: original.height,
  });
});

test('the on-canvas crop trigger is only attached to image overlays', async ({ page }) => {
  await openEditor(page);
  await page.locator('#add-text').click();
  await page.evaluate(() => canvas.setActiveObject(canvas.item(0)).renderAll());
  expect(await page.evaluate(() => Object.keys(canvas.getActiveObject().controls))).not.toContain('cropMode');
  await expect(page.locator('#meme-canvas-wrapper')).toHaveAttribute('aria-keyshortcuts', 'C Escape');
});

test('crop handle cursors rotate with the image like resize handle cursors', async ({ page }) => {
  await openEditor(page);
  await page.locator('#add-image').setInputFiles(blankImage);
  const angles = [0, 30, 90, 135];
  const controlNames = ['tl', 'mt', 'tr', 'ml', 'mr', 'bl', 'mb', 'br'];
  const readCursors = () => page.evaluate(({ angles, controlNames }) => {
    const image = canvas.getActiveObject();
    return angles.map(angle => {
      image.angle = angle;
      return controlNames.map(name => {
        const control = image.controls[name];
        return control.cursorStyleHandler({}, control, image);
      });
    });
  }, { angles, controlNames });

  const resizeCursors = await readCursors();
  await page.locator('#meme-canvas-wrapper').focus();
  await page.keyboard.press('c');
  expect(await readCursors()).toEqual(resizeCursors);
});

test('image editing controls keep constant display dimensions when the canvas resizes', async ({ page }) => {
  await openEditor(page);
  await page.locator('#add-image').setInputFiles(blankImage);

  const displayMetrics = () => page.evaluate(() => {
    const image = canvas.getActiveObject();
    const displayScale = canvas.upperCanvasEl.getBoundingClientRect().width / canvas.width;
    const cropButton = image.controls.cropMode;
    const cropHandle = Object.values(image.controls).find(control => control.actionName === 'crop');
    const rotation = image.controls.mtr;
    return {
      corner: image.cornerSize * displayScale,
      touchCorner: image.touchCornerSize * displayScale,
      border: image.borderScaleFactor * displayScale,
      padding: image.padding * displayScale,
      cropButton: cropButton.sizeX * displayScale,
      cropTouch: cropButton.touchSizeX * displayScale,
      cropOffsetX: cropButton.offsetX * displayScale,
      cropOffsetY: cropButton.offsetY * displayScale,
      cropHandle: cropHandle && cropHandle.sizeX * displayScale,
      cropHandleTouch: cropHandle && cropHandle.touchSizeX * displayScale,
      rotationOffset: rotation && rotation.offsetY * displayScale,
    };
  });
  const roundedMetrics = async () => Object.fromEntries(
    Object.entries(await displayMetrics())
      .filter(([_key, value]) => value !== undefined)
      .map(([key, value]) => [key, Math.round(value)])
  );

  expect(await roundedMetrics()).toEqual({
    corner: 14,
    touchCorner: 28,
    border: 2,
    padding: 4,
    cropButton: 28,
    cropTouch: 44,
    cropOffsetX: 20,
    cropOffsetY: -20,
    rotationOffset: -40,
  });

  await page.locator('#meme-canvas-wrapper').focus();
  await page.keyboard.press('c');
  await page.setViewportSize({ width: 760, height: 900 });
  await expect.poll(async () => (await roundedMetrics()).cropButton).toBe(28);
  expect(await roundedMetrics()).toEqual({
    corner: 14,
    touchCorner: 28,
    border: 2,
    padding: 4,
    cropButton: 28,
    cropTouch: 44,
    cropOffsetX: 20,
    cropOffsetY: -20,
    cropHandle: 28,
    cropHandleTouch: 36,
  });
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

test('leaving the editor cancels a pending static export', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      originalToBlob.call(this, blob => setTimeout(() => callback(blob), 600), ...args);
    };
  });

  let downloadStarted = false;
  page.on('download', () => {
    downloadStarted = true;
  });
  await page.locator('#generate-meme').click();
  await page.locator('.back-btn .btn').click();
  await expect(page.locator('.choice-section')).toBeVisible();
  await page.waitForTimeout(300);

  expect(downloadStarted).toBe(false);
  await expect(page.locator('.alert-container')).toBeHidden();
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

test('failed animated gallery fetch reports the format and HTTP status', async ({ page }) => {
  await page.route('**/missing-animation.gif', route => route.fulfill({ status: 404 }));
  await page.goto('/');
  const message = await page.evaluate(async () => {
    try {
      await prepareAnimatedMemeInfo({
        url: '/img/memes/missing-animation.gif',
        width: 1,
        height: 1,
        mimeType: 'image/gif',
      });
    }
    catch (error) {
      return error.message;
    }
    return undefined;
  });

  expect(message).toBe('The GIF could not be loaded (HTTP 404).');
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

test('APNG inspection rejects inconsistent frame metadata before decoding', async ({ page }) => {
  await page.goto('/');
  const apng = await animatedApngBuffer(page);
  const messages = await page.evaluate(bytes => {
    function mutateChunk(type, mutate) {
      const copy = new Uint8Array(bytes);
      const view = new DataView(copy.buffer);
      for (let offset = 8; offset + 12 <= copy.length;) {
        const length = view.getUint32(offset);
        const chunkType = String.fromCharCode(...copy.subarray(offset + 4, offset + 8));
        if (chunkType === type) {
          mutate(view, offset + 8);
          return copy.buffer;
        }
        offset += 12 + length;
      }
      throw new Error(`Missing ${type} test chunk.`);
    }
    function inspect(buffer) {
      try {
        parseApngMetadata(buffer);
        return '';
      }
      catch (error) {
        return error.message;
      }
    }

    return {
      frameCount: inspect(mutateChunk('acTL', (view, dataOffset) => {
        view.setUint32(dataOffset, 1);
      })),
      frameBounds: inspect(mutateChunk('fcTL', (view, dataOffset) => {
        view.setUint32(dataOffset + 4, 33);
      })),
    };
  }, Array.from(apng));

  expect(messages).toEqual({
    frameCount: 'The APNG declares 1 frames but contains 2 frame control chunks.',
    frameBounds: 'The APNG contains a frame outside its image bounds.',
  });
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

test('animated export releases each rendered segment overlay', async ({ page }) => {
  await openSegmentedGifEditor(page);
  await page.locator('#animation-frame-slider').fill('1');
  await page.locator('#animation-split').click();
  await page.locator('#animation-frame-slider').fill('2');
  await page.locator('#animation-split').click();
  await page.evaluate(() => {
    window.__exportOverlayCanvases = [];
    const originalToCanvasElement = fabric.StaticCanvas.prototype.toCanvasElement;
    fabric.StaticCanvas.prototype.toCanvasElement = function (...args) {
      const output = originalToCanvasElement.apply(this, args);
      window.__exportOverlayCanvases.push(output);
      return output;
    };
  });

  await downloadAnimatedOutput(page);

  expect(await page.evaluate(() => __exportOverlayCanvases.map(overlay => ({
    width: overlay.width,
    height: overlay.height,
  })))).toEqual([
    { width: 0, height: 0 },
    { width: 0, height: 0 },
    { width: 0, height: 0 },
  ]);
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
