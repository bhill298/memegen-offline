var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// @ts-ignore
// The npm package omits the extension, which browsers do not resolve for ESM.
import Module from './webp-wasm.js';
// default webp config
const defaultWebpConfig = {
    lossless: 0,
    quality: 100,
};
export const encoderVersion = () => __awaiter(void 0, void 0, void 0, function* () {
    const module = yield Module();
    return module.encoder_version();
});
export const encodeRGB = (rgb, width, height, quality) => __awaiter(void 0, void 0, void 0, function* () {
    const module = yield Module();
    quality = typeof quality !== 'number' ? 100 : Math.min(100, Math.max(0, quality));
    return module.encodeRGB(rgb, width, height, quality);
});
export const encodeRGBA = (rgba, width, height, quality) => __awaiter(void 0, void 0, void 0, function* () {
    const module = yield Module();
    quality = typeof quality !== 'number' ? 100 : Math.min(100, Math.max(0, quality));
    return module.encodeRGBA(rgba, width, height, quality);
});
export const encode = (data, width, height, hasAlpha, config) => __awaiter(void 0, void 0, void 0, function* () {
    const module = yield Module();
    const webpConfig = Object.assign(Object.assign({}, defaultWebpConfig), config);
    webpConfig.lossless = Math.min(1, Math.max(0, webpConfig.lossless));
    webpConfig.quality = Math.min(100, Math.max(0, webpConfig.quality));
    return module.encode(data, width, height, hasAlpha, webpConfig);
});
export const encodeAnimation = (width, height, hasAlpha, frames) => __awaiter(void 0, void 0, void 0, function* () {
    const module = yield Module();
    const frameVector = new module.VectorWebPAnimationFrame();
    frames.forEach((frame) => {
        const hasConfig = frame.config !== undefined;
        const config = Object.assign(Object.assign({}, defaultWebpConfig), frame.config);
        config.lossless = Math.min(1, Math.max(0, config.lossless));
        config.quality = Math.min(100, Math.max(0, config.quality));
        frameVector.push_back({
            duration: frame.duration,
            data: frame.data,
            config,
            has_config: hasConfig,
        });
    });
    return module.encodeAnimation(width, height, hasAlpha, frameVector);
});
export const decoderVersion = () => __awaiter(void 0, void 0, void 0, function* () {
    const module = yield Module();
    return module.decoder_version();
});
export const decodeRGB = (data) => __awaiter(void 0, void 0, void 0, function* () {
    const module = yield Module();
    return module.decodeRGB(data);
});
export const decodeRGBA = (data) => __awaiter(void 0, void 0, void 0, function* () {
    const module = yield Module();
    return module.decodeRGBA(data);
});
// TODO:
// export const decode = async (data: Uint8Array, hasAlpha: boolean) => {
// 	const module = await Module()
// 	return module.decode(data, hasAlpha)
// }
export const decodeAnimation = (data, hasAlpha) => __awaiter(void 0, void 0, void 0, function* () {
    const module = yield Module();
    return module.decodeAnimation(data, hasAlpha);
});
