const GIF_LIMITS = Object.freeze({
    maxFileBytes: 50 * 1024 * 1024,
    maxFrames: 300,
    maxSourceDimension: 4096,
    maxSourcePixels: 4 * 1024 * 1024,
    maxDecodedPixelFrames: 40 * 1024 * 1024,
    maxOutputDimension: 2048,
    maxOutputPixels: 2 * 1024 * 1024,
});

const GIF_WORKER_URL = new URL(
    'vendors/modern-gif/modern-gif.worker.min.js', document.baseURI
).href;

function sourceLooksLikeGif(imgInfo) {
    if (imgInfo.mimeType === 'image/gif') {
        return true;
    }
    if (imgInfo.fileName && imgInfo.fileName.toLowerCase().endsWith('.gif')) {
        return true;
    }
    try {
        return new URL(imgInfo.url, document.baseURI).pathname.toLowerCase().endsWith('.gif');
    }
    catch (_error) {
        return false;
    }
}

function createGifImageSizePlan(width, height) {
    const output = fitImageDimensions(
        width, height, GIF_LIMITS.maxOutputDimension, GIF_LIMITS.maxOutputPixels
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

async function readGifSource(imgInfo) {
    let buffer;
    if (imgInfo.sourceFile) {
        if (imgInfo.sourceFile.size > GIF_LIMITS.maxFileBytes) {
            throw new Error('GIF files are limited to 50 MB.');
        }
        buffer = await imgInfo.sourceFile.arrayBuffer();
    }
    else {
        const response = await fetch(imgInfo.url);
        if (!response.ok) {
            throw new Error(`The GIF could not be loaded (HTTP ${response.status}).`);
        }
        buffer = await response.arrayBuffer();
    }
    if (buffer.byteLength > GIF_LIMITS.maxFileBytes) {
        throw new Error('GIF files are limited to 50 MB.');
    }
    return buffer;
}

async function prepareGifMemeInfo(imgInfo) {
    if (!sourceLooksLikeGif(imgInfo)) {
        return imgInfo;
    }

    const buffer = await readGifSource(imgInfo);
    let gif;
    try {
        gif = modernGif.decode(buffer);
    }
    catch (_error) {
        throw new Error('The selected GIF could not be decoded.');
    }

    const frameCount = gif.frames.length;
    if (frameCount <= 1) {
        return imgInfo;
    }
    const sourcePixels = gif.width * gif.height;
    if (frameCount > GIF_LIMITS.maxFrames) {
        throw new Error(
            `This GIF has ${frameCount} frames; the maximum is ${GIF_LIMITS.maxFrames}.`
        );
    }
    if (Math.max(gif.width, gif.height) > GIF_LIMITS.maxSourceDimension ||
        sourcePixels > GIF_LIMITS.maxSourcePixels) {
        throw new Error(
            `This GIF is too large to decode safely (${gif.width} x ${gif.height}). ` +
            `The maximum source size is ${GIF_LIMITS.maxSourceDimension}px per side and 4 megapixels.`
        );
    }
    if (sourcePixels * frameCount > GIF_LIMITS.maxDecodedPixelFrames) {
        throw new Error(
            `This GIF is too large to decode safely (${frameCount} frames at ` +
            `${gif.width} x ${gif.height}).`
        );
    }

    const duration = gif.frames.reduce(function (total, frame) {
        return total + frame.delay;
    }, 0);
    imgInfo.width = gif.width;
    imgInfo.height = gif.height;
    imgInfo.sizePlan = createGifImageSizePlan(gif.width, gif.height);
    imgInfo.gifInfo = {
        buffer: buffer,
        metadata: gif,
        frameCount: frameCount,
        duration: duration,
        timeline: {
            currentFrame: 0,
            activeSegmentIndex: 0,
            segments: [{ startFrame: 0, editorState: null }],
        },
    };
    return imgInfo;
}

function createGifWorkerClient() {
    const worker = new Worker(GIF_WORKER_URL);
    const pending = new Map();
    let nextId = 0;
    let stopped = false;

    worker.onmessage = function (event) {
        const request = pending.get(event.data.id);
        if (!request) {
            return;
        }
        pending.delete(event.data.id);
        request.resolve(event.data.data);
    };
    worker.onerror = function (event) {
        const error = new Error(event.message || 'The GIF worker failed.');
        pending.forEach(function (request) {
            request.reject(error);
        });
        pending.clear();
    };

    return {
        call: function (type, data, transfer) {
            if (stopped) {
                return Promise.reject(new Error('The GIF operation was cancelled.'));
            }
            const id = nextId++;
            return new Promise(function (resolve, reject) {
                pending.set(id, { resolve: resolve, reject: reject });
                worker.postMessage({ id: id, type: type, data: data }, transfer || []);
            });
        },
        terminate: function () {
            if (stopped) {
                return;
            }
            stopped = true;
            worker.terminate();
            const error = new Error('The GIF operation was cancelled.');
            pending.forEach(function (request) {
                request.reject(error);
            });
            pending.clear();
        },
    };
}

function createGifFrameDecoder(gifInfo) {
    const client = createGifWorkerClient();
    const bytes = new Uint8Array(gifInfo.buffer.slice(0));
    return {
        promise: client.call('frames:decode', bytes, [bytes.buffer]).finally(function () {
            client.terminate();
        }),
        terminate: function () {
            client.terminate();
        },
    };
}

function createGifEncoder(gifInfo, width, height) {
    const client = createGifWorkerClient();
    const metadata = gifInfo.metadata;
    let initialized = false;
    return {
        initialize: async function () {
            await client.call('encoder:init', {
                width: width,
                height: height,
                version: '89a',
                looped: metadata.looped === true,
                loopCount: metadata.loopCount || 0,
                maxColors: 255,
            });
            initialized = true;
        },
        addFrame: function (pixels, delay) {
            if (!initialized) {
                return Promise.reject(new Error('The GIF encoder is not ready.'));
            }
            return client.call('encoder:encode', {
                data: pixels,
                delay: delay,
                width: width,
                height: height,
            }, [pixels.buffer]);
        },
        finish: async function () {
            const buffer = await client.call('encoder:flush', 'arrayBuffer');
            return new Blob([buffer], { type: 'image/gif' });
        },
        terminate: function () {
            client.terminate();
        },
    };
}

function formatGifDuration(duration) {
    return `${(duration / 1000).toFixed(1)} seconds`;
}

function createGifFramePlayer(frames, renderFrame) {
    let frameIndex = 0;
    let timer;
    let playing = false;

    function showFrame(index) {
        frameIndex = index;
        renderFrame(frames[frameIndex], frameIndex);
    }

    function scheduleNextFrame() {
        if (!playing) {
            return;
        }
        timer = setTimeout(function () {
            showFrame((frameIndex + 1) % frames.length);
            scheduleNextFrame();
        }, Math.max(20, frames[frameIndex].delay));
    }

    showFrame(0);
    return {
        play: function () {
            if (playing) {
                return;
            }
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
        getCurrentFrame: function () {
            return frameIndex;
        },
        destroy: function () {
            this.pause();
        },
    };
}
