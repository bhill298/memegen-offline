import { decodeAnimation, encodeAnimation } from '../../vendors/wasm-webp/index.js';

let encoderState;

function readFourCC(bytes, offset) {
    return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function setWebpAnimationMetadata(bytes, loopCount, delays) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let frameIndex = 0;
    for (let offset = 12; offset + 8 <= bytes.length;) {
        const length = view.getUint32(offset + 4, true);
        if (readFourCC(bytes, offset) === 'ANIM' && length >= 6) {
            view.setUint16(offset + 12, loopCount, true);
        }
        else if (readFourCC(bytes, offset) === 'ANMF' && length >= 16 &&
            frameIndex < delays.length) {
            const delay = Math.max(0, Math.min(0xffffff, Math.round(delays[frameIndex++])));
            bytes[offset + 20] = delay & 0xff;
            bytes[offset + 21] = (delay >>> 8) & 0xff;
            bytes[offset + 22] = (delay >>> 16) & 0xff;
        }
        offset += 8 + length + (length & 1);
    }
    return bytes;
}

async function handle(type, data) {
    if (type === 'frames:decode') {
        const decoded = await decodeAnimation(data, true);
        if (!decoded) {
            throw new Error('The animated WebP could not be decoded.');
        }
        const frames = decoded.map(function (frame) {
            return {
                width: frame.width,
                height: frame.height,
                delay: frame.duration,
                data: new Uint8ClampedArray(frame.data),
            };
        });
        return { data: frames, transfer: frames.map(frame => frame.data.buffer) };
    }
    if (type === 'encoder:init') {
        encoderState = {
            width: data.width,
            height: data.height,
            loopCount: data.loopCount,
            frames: [],
            delays: [],
            timestamp: 0,
            config: {
                lossless: data.webpLossless,
                quality: data.webpQuality,
            },
        };
        return { data: true };
    }
    if (type === 'encoder:encode') {
        encoderState.timestamp += data.delay;
        encoderState.delays.push(data.delay);
        encoderState.frames.push({
            data: data.data,
            // wasm-webp names this field "duration", but libwebp consumes it
            // as the frame's cumulative end timestamp.
            duration: encoderState.timestamp,
            config: encoderState.config,
        });
        return { data: true };
    }
    if (type === 'encoder:flush') {
        let bytes = await encodeAnimation(
            encoderState.width, encoderState.height, true, encoderState.frames
        );
        if (!bytes) {
            throw new Error('The animated WebP could not be encoded.');
        }
        bytes = setWebpAnimationMetadata(
            bytes, encoderState.loopCount, encoderState.delays
        );
        encoderState = undefined;
        return { data: bytes.buffer, transfer: [bytes.buffer] };
    }
    throw new Error(`Unknown WebP worker operation: ${type}`);
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
