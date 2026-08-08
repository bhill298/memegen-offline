importScripts('../../vendors/upng/UPNG.umd.js');

let encoderState;

function crc32(bytes, start, length) {
    let crc = 0xffffffff;
    for (let index = start; index < start + length; index++) {
        crc ^= bytes[index];
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function writeUint32(bytes, offset, value) {
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value);
}

function setApngAnimationMetadata(buffer, loopCount, delays) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let frameIndex = 0;
    for (let offset = 8; offset + 20 <= bytes.length;) {
        const length = view.getUint32(offset);
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        if (type === 'acTL' && length === 8) {
            writeUint32(bytes, offset + 12, loopCount >>> 0);
            writeUint32(bytes, offset + 16, crc32(bytes, offset + 4, 12));
        }
        else if (type === 'fcTL' && length === 26 && frameIndex < delays.length) {
            const delay = Math.max(0, delays[frameIndex++]);
            const denominator = delay === 0 ? 1000 : Math.max(
                1, Math.min(1000, Math.floor(65535 * 1000 / delay))
            );
            const numerator = Math.min(65535, Math.round(delay * denominator / 1000));
            view.setUint16(offset + 28, numerator);
            view.setUint16(offset + 30, denominator);
            writeUint32(bytes, offset + 34, crc32(bytes, offset + 4, 30));
        }
        offset += 12 + length;
    }
    return buffer;
}

async function handle(type, data) {
    if (type === 'frames:decode') {
        const image = UPNG.decode(data.buffer);
        const rgbaFrames = UPNG.toRGBA8(image);
        return {
            data: rgbaFrames.map(function (buffer, index) {
                return {
                    width: image.width,
                    height: image.height,
                    delay: image.frames[index].delay,
                    data: new Uint8ClampedArray(buffer),
                };
            }),
            transfer: rgbaFrames,
        };
    }
    if (type === 'encoder:init') {
        encoderState = {
            width: data.width,
            height: data.height,
            loopCount: data.loopCount,
            frames: [],
            delays: [],
            colors: data.apngColors,
        };
        return { data: true };
    }
    if (type === 'encoder:encode') {
        encoderState.frames.push(data.data.buffer);
        encoderState.delays.push(data.delay);
        return { data: true };
    }
    if (type === 'encoder:flush') {
        let buffer = UPNG.encode(
            encoderState.frames,
            encoderState.width,
            encoderState.height,
            encoderState.colors,
            encoderState.delays
        );
        buffer = setApngAnimationMetadata(
            buffer, encoderState.loopCount, encoderState.delays
        );
        encoderState = undefined;
        return { data: buffer, transfer: [buffer] };
    }
    throw new Error(`Unknown APNG worker operation: ${type}`);
}

self.onmessage = async function (event) {
    try {
        const result = await handle(event.data.type, event.data.data);
        self.postMessage({ id: event.data.id, data: result.data }, result.transfer || []);
    }
    catch (error) {
        self.postMessage({ id: event.data.id, error: error.message || String(error) });
    }
};
