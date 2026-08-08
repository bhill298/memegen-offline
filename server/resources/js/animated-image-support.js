const ANIMATION_LIMITS = Object.freeze({
    maxFileBytes: 50 * 1024 * 1024,
    maxFrames: 300,
    maxSourceDimension: 4096,
    maxSourcePixels: 4 * 1024 * 1024,
    maxDecodedPixelFrames: 40 * 1024 * 1024,
    maxOutputDimension: 2048,
    maxOutputPixels: 2 * 1024 * 1024,
});

const ANIMATION_FORMATS = Object.freeze({
    gif: { label: 'GIF', extension: '.gif', mimeType: 'image/gif' },
    webp: { label: 'WebP', extension: '.webp', mimeType: 'image/webp' },
    apng: { label: 'APNG', extension: '.png', mimeType: 'image/png' },
});

const GIF_WORKER_URL = new URL(
    'vendors/modern-gif/modern-gif.worker.min.js', document.baseURI
).href;
const APNG_WORKER_URL = new URL(
    'resources/js/apng-codec.worker.js', document.baseURI
).href;
const WEBP_WORKER_URL = new URL(
    'resources/js/webp-codec.worker.js', document.baseURI
).href;

function getSourcePath(imgInfo) {
    if (imgInfo.fileName) {
        return imgInfo.fileName.toLowerCase();
    }
    try {
        return new URL(imgInfo.url, document.baseURI).pathname.toLowerCase();
    }
    catch (_error) {
        return '';
    }
}

function getPossibleAnimationFormat(imgInfo) {
    const mimeType = (imgInfo.mimeType || '').toLowerCase();
    const sourcePath = getSourcePath(imgInfo);
    if (mimeType === 'image/gif' || sourcePath.endsWith('.gif')) return 'gif';
    if (mimeType === 'image/webp' || sourcePath.endsWith('.webp')) return 'webp';
    if (mimeType === 'image/apng' || mimeType === 'image/png' ||
        sourcePath.endsWith('.apng') || sourcePath.endsWith('.png')) return 'apng';
    return undefined;
}

function createAnimatedImageSizePlan(width, height) {
    const output = fitImageDimensions(
        width, height, ANIMATION_LIMITS.maxOutputDimension, ANIMATION_LIMITS.maxOutputPixels
    );
    const working = fitWorkingDimensions(output.width, output.height);
    const exportMultiplier = Math.min(
        output.width / working.width,
        output.height / working.height
    );
    return {
        sourceWidth: width,
        sourceHeight: height,
        outputWidth: Math.floor(working.width * exportMultiplier),
        outputHeight: Math.floor(working.height * exportMultiplier),
        workingWidth: working.width,
        workingHeight: working.height,
        exportMultiplier: exportMultiplier,
        outputWasReduced: output.width < width || output.height < height,
    };
}

function resolveAnimationQualityProfile(format, quality, sizePlan) {
    const selectedQuality = ['low', 'balanced', 'full'].includes(quality)
        ? quality : 'full';
    let scale = 1;
    let gifColors = 255;
    let webpLossless = 1;
    let webpQuality = 100;
    let apngColors = 0;

    if (format === 'gif') {
        if (selectedQuality === 'balanced') scale = 2 / 3;
        if (selectedQuality === 'low') {
            scale = 0.5;
            gifColors = 64;
        }
    }
    else if (format === 'webp' && selectedQuality !== 'full') {
        webpLossless = 0;
        webpQuality = selectedQuality === 'balanced' ? 90 : 70;
    }
    else if (format === 'apng' && selectedQuality !== 'full') {
        apngColors = selectedQuality === 'balanced' ? 256 : 128;
    }

    return {
        quality: selectedQuality,
        outputWidth: Math.max(1, Math.floor(sizePlan.outputWidth * scale)),
        outputHeight: Math.max(1, Math.floor(sizePlan.outputHeight * scale)),
        gifColors,
        webpLossless,
        webpQuality,
        apngColors,
    };
}

async function readAnimatedSource(imgInfo, label) {
    let buffer;
    if (imgInfo.sourceFile) {
        if (imgInfo.sourceFile.size > ANIMATION_LIMITS.maxFileBytes) {
            throw new Error(`${label} files are limited to 50 MB.`);
        }
        buffer = await imgInfo.sourceFile.arrayBuffer();
    }
    else {
        const response = await fetch(imgInfo.url);
        if (!response.ok) {
            throw new Error(`The ${label} could not be loaded (HTTP ${response.status}).`);
        }
        buffer = await response.arrayBuffer();
    }
    if (buffer.byteLength > ANIMATION_LIMITS.maxFileBytes) {
        throw new Error(`${label} files are limited to 50 MB.`);
    }
    return buffer;
}

function readFourCC(bytes, offset) {
    return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function readUint24LE(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function parseApngMetadata(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 33 || readFourCC(bytes, 1) !== 'PNG\r') return undefined;
    const view = new DataView(buffer);
    let width;
    let height;
    let frameCount = 0;
    let loopCount = 0;
    const delays = [];
    for (let offset = 8; offset + 12 <= bytes.length;) {
        const length = view.getUint32(offset);
        if (offset + 12 + length > bytes.length) break;
        const type = readFourCC(bytes, offset + 4);
        const dataOffset = offset + 8;
        if (type === 'IHDR' && length >= 8) {
            width = view.getUint32(dataOffset);
            height = view.getUint32(dataOffset + 4);
        }
        else if (type === 'acTL' && length === 8) {
            frameCount = view.getUint32(dataOffset);
            loopCount = view.getUint32(dataOffset + 4);
        }
        else if (type === 'fcTL' && length === 26) {
            const numerator = view.getUint16(dataOffset + 20);
            const denominator = view.getUint16(dataOffset + 22) || 100;
            delays.push(Math.round(1000 * numerator / denominator));
        }
        offset += 12 + length;
    }
    if (!width || !height || frameCount <= 1) return undefined;
    return { width, height, frameCount, loopCount, delays };
}

function parseWebpMetadata(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 20 || readFourCC(bytes, 0) !== 'RIFF' ||
        readFourCC(bytes, 8) !== 'WEBP') return undefined;
    const view = new DataView(buffer);
    let width;
    let height;
    let animated = false;
    let loopCount = 0;
    const delays = [];
    for (let offset = 12; offset + 8 <= bytes.length;) {
        const length = view.getUint32(offset + 4, true);
        const dataOffset = offset + 8;
        if (dataOffset + length > bytes.length) break;
        const type = readFourCC(bytes, offset);
        if (type === 'VP8X' && length >= 10) {
            animated = (bytes[dataOffset] & 2) !== 0;
            width = readUint24LE(bytes, dataOffset + 4) + 1;
            height = readUint24LE(bytes, dataOffset + 7) + 1;
        }
        else if (type === 'ANIM' && length >= 6) {
            animated = true;
            loopCount = view.getUint16(dataOffset + 4, true);
        }
        else if (type === 'ANMF' && length >= 16) {
            delays.push(readUint24LE(bytes, dataOffset + 12));
        }
        offset += 8 + length + (length & 1);
    }
    if (!animated || !width || !height || delays.length <= 1) return undefined;
    return { width, height, frameCount: delays.length, loopCount, delays };
}

function inspectAnimation(format, buffer) {
    if (format === 'gif') {
        let gif;
        try {
            gif = modernGif.decode(buffer);
        }
        catch (_error) {
            throw new Error('The selected GIF could not be decoded.');
        }
        if (gif.frames.length <= 1) return undefined;
        return {
            width: gif.width,
            height: gif.height,
            frameCount: gif.frames.length,
            loopCount: gif.loopCount || 0,
            looped: gif.looped === true,
            delays: gif.frames.map(frame => frame.delay),
            gifMetadata: gif,
        };
    }
    if (format === 'apng') return parseApngMetadata(buffer);
    return parseWebpMetadata(buffer);
}

function enforceAnimationLimits(metadata, label) {
    const sourcePixels = metadata.width * metadata.height;
    if (metadata.frameCount > ANIMATION_LIMITS.maxFrames) {
        throw new Error(
            `This ${label} has ${metadata.frameCount} frames; the maximum is ` +
            `${ANIMATION_LIMITS.maxFrames}.`
        );
    }
    if (Math.max(metadata.width, metadata.height) > ANIMATION_LIMITS.maxSourceDimension ||
        sourcePixels > ANIMATION_LIMITS.maxSourcePixels) {
        throw new Error(
            `This ${label} is too large to decode safely (${metadata.width} x ${metadata.height}). ` +
            `The maximum source size is ${ANIMATION_LIMITS.maxSourceDimension}px per side and 4 megapixels.`
        );
    }
    if (sourcePixels * metadata.frameCount > ANIMATION_LIMITS.maxDecodedPixelFrames) {
        throw new Error(
            `This ${label} is too large to decode safely (${metadata.frameCount} frames at ` +
            `${metadata.width} x ${metadata.height}).`
        );
    }
}

async function prepareAnimatedMemeInfo(imgInfo) {
    const format = getPossibleAnimationFormat(imgInfo);
    if (!format) return imgInfo;
    const formatInfo = ANIMATION_FORMATS[format];
    const buffer = await readAnimatedSource(imgInfo, formatInfo.label);
    let metadata;
    try {
        metadata = inspectAnimation(format, buffer);
    }
    catch (error) {
        if (format === 'gif') throw error;
        throw new Error(`The selected ${formatInfo.label} could not be decoded.`);
    }
    if (!metadata) return imgInfo;

    enforceAnimationLimits(metadata, formatInfo.label);
    imgInfo.width = metadata.width;
    imgInfo.height = metadata.height;
    imgInfo.sizePlan = createAnimatedImageSizePlan(metadata.width, metadata.height);
    imgInfo.animationInfo = {
        format,
        formatLabel: formatInfo.label,
        extension: formatInfo.extension,
        mimeType: formatInfo.mimeType,
        buffer,
        metadata,
        frameCount: metadata.frameCount,
        duration: metadata.delays.reduce((total, delay) => total + delay, 0),
        timeline: {
            currentFrame: 0,
            activeSegmentIndex: 0,
            segments: [{ startFrame: 0, editorState: null }],
        },
    };
    return imgInfo;
}

function createWorkerClient(url, options, label) {
    const worker = new Worker(url, options);
    const pending = new Map();
    let nextId = 0;
    let stopped = false;
    worker.onmessage = function (event) {
        const request = pending.get(event.data.id);
        if (!request) return;
        pending.delete(event.data.id);
        if (event.data.error) request.reject(new Error(event.data.error));
        else request.resolve(event.data.data);
    };
    worker.onerror = function (event) {
        const error = new Error(event.message || `The ${label} worker failed.`);
        pending.forEach(request => request.reject(error));
        pending.clear();
    };
    return {
        call: function (type, data, transfer) {
            if (stopped) {
                return Promise.reject(new Error(`The ${label} operation was cancelled.`));
            }
            const id = nextId++;
            return new Promise(function (resolve, reject) {
                pending.set(id, { resolve, reject });
                worker.postMessage({ id, type, data }, transfer || []);
            });
        },
        terminate: function () {
            if (stopped) return;
            stopped = true;
            worker.terminate();
            const error = new Error(`The ${label} operation was cancelled.`);
            pending.forEach(request => request.reject(error));
            pending.clear();
        },
    };
}

function createAnimationWorkerClient(format, formatLabel) {
    if (format === 'gif') {
        return createWorkerClient(GIF_WORKER_URL, undefined, 'GIF');
    }
    if (format === 'apng') {
        return createWorkerClient(APNG_WORKER_URL, undefined, 'APNG');
    }
    return createWorkerClient(WEBP_WORKER_URL, { type: 'module' }, formatLabel);
}

function createAnimationFrameDecoder(animationInfo) {
    const client = createAnimationWorkerClient(
        animationInfo.format, animationInfo.formatLabel
    );
    const bytes = new Uint8Array(animationInfo.buffer.slice(0));
    return {
        promise: client.call('frames:decode', bytes, [bytes.buffer]).finally(function () {
            client.terminate();
        }),
        terminate: function () { client.terminate(); },
    };
}

function createAnimationEncoder(
    animationInfo, outputFormat, width, height, qualityProfile
) {
    const outputInfo = ANIMATION_FORMATS[outputFormat];
    const client = createAnimationWorkerClient(outputFormat, outputInfo.label);
    let initialized = false;
    return {
        initialize: async function () {
            const metadata = animationInfo.metadata;
            const sourceDoesNotLoop = animationInfo.format === 'gif' &&
                metadata.looped !== true;
            const data = {
                width,
                height,
                loopCount: sourceDoesNotLoop && outputFormat !== 'gif'
                    ? 1 : metadata.loopCount || 0,
                webpLossless: qualityProfile.webpLossless,
                webpQuality: qualityProfile.webpQuality,
                apngColors: qualityProfile.apngColors,
            };
            if (outputFormat === 'gif') {
                Object.assign(data, {
                    version: '89a',
                    looped: animationInfo.format === 'gif'
                        ? metadata.looped === true : true,
                    maxColors: qualityProfile.gifColors,
                });
            }
            await client.call('encoder:init', data);
            initialized = true;
        },
        addFrame: function (pixels, delay) {
            if (!initialized) {
                return Promise.reject(new Error(
                    `The ${outputInfo.label} encoder is not ready.`
                ));
            }
            return client.call('encoder:encode', {
                data: pixels, delay, width, height,
            }, [pixels.buffer]);
        },
        finish: async function () {
            const output = await client.call('encoder:flush',
                outputFormat === 'gif' ? 'arrayBuffer' : undefined
            );
            return new Blob([output], { type: outputInfo.mimeType });
        },
        terminate: function () { client.terminate(); },
    };
}

function createAnimationFramePlayer(frames, renderFrame) {
    let frameIndex = 0;
    let timer;
    let playing = false;
    function showFrame(index) {
        frameIndex = index;
        renderFrame(frames[frameIndex], frameIndex);
    }
    function scheduleNextFrame() {
        if (!playing) return;
        timer = setTimeout(function () {
            showFrame((frameIndex + 1) % frames.length);
            scheduleNextFrame();
        }, Math.max(20, frames[frameIndex].delay));
    }
    showFrame(0);
    return {
        play: function () {
            if (playing) return;
            playing = true;
            scheduleNextFrame();
        },
        pause: function () {
            playing = false;
            if (timer !== undefined) {
                clearTimeout(timer);
                timer = undefined;
            }
        },
        showFrame: function (index) {
            this.pause();
            showFrame(Math.max(0, Math.min(frames.length - 1, index)));
        },
        getCurrentFrame: function () { return frameIndex; },
        destroy: function () { this.pause(); },
    };
}
