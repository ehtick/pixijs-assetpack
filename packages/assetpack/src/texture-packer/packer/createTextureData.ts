import { MaxRectsPacker } from 'maxrects-packer';
import sharp from 'sharp';
import { BuildReporter } from '../../core/index.js';

import type { PackTexturesOptions, PixiRectData, TextureData } from './packTextures.js';

/**
 * Creates texture data for packing by processing individual textures and setting up a MaxRects packer.
 *
 * This function processes a collection of textures by scaling, trimming (if enabled), and preparing
 * them for efficient packing into sprite sheets. It handles error cases by creating empty pixel
 * textures as fallbacks and calculates trim offsets for proper sprite positioning.
 */
export async function createTextureData(options: Required<PackTexturesOptions>) {
    const packer = new MaxRectsPacker<PixiRectData>(options.width, options.height, options.padding, {
        smart: true,
        pot: options.powerOfTwo,
        border: options.padding,
        allowRotation: options.allowRotation,
    });

    const scale = options.scale;

    const textureDatas = await Promise.all(
        options.texturesToPack.map(async (texture) => {
            let sharpImage = sharp(texture.contents);

            const metaData = await sharpImage.metadata();

            if (!metaData.width || !metaData.height) {
                throw new Error(`[AssetPack][packTextures] Could not get metadata for ${texture.path}`);
            }

            const newWidth = Math.ceil(metaData.width * scale);
            const newHeight = Math.ceil(metaData.height * scale);

            const allowTrim = options.allowTrim && newWidth >= 3 && newHeight >= 3;

            if (scale < 1) {
                sharpImage = sharpImage.resize({
                    width: newWidth,
                    height: newHeight,
                    ...options.sharpOptions.resize,
                });

                if (allowTrim) {
                    sharpImage = sharp(await sharpImage.toBuffer());
                }
            }

            if (allowTrim) {
                sharpImage = sharpImage.trim({
                    threshold: options.alphaThreshold,
                    background: { r: 0, g: 0, b: 0, alpha: 0 },
                });
            }

            let result = await sharpImage.toBuffer({ resolveWithObject: true }).catch((error) => {
                BuildReporter.error(
                    `[AssetPack][packTextures] Failed to process texture: ${texture.path} - ${error}, using empty pixel texture instead.`,
                );

                return { data: null, info: null };
            });

            if (!result.data || !result.info) {
                const buffer = Buffer.alloc(4);

                const emptyPixelTexture = sharp(buffer, {
                    raw: {
                        width: 1,
                        height: 1,
                        channels: 4,
                    },
                });

                result = await emptyPixelTexture.png().toBuffer({ resolveWithObject: true });
            }

            const { data: buffer, info } = result;

            const trimmed = info.width < newWidth || info.height < newHeight;

            const textureData: TextureData = {
                buffer,
                originalWidth: newWidth,
                originalHeight: newHeight,
                width: info.width,
                height: info.height,
                trimOffsetLeft: -(info.trimOffsetLeft ?? 0),
                trimOffsetTop: -(info.trimOffsetTop ?? 0),
                path: texture.path,
                trimmed,
            };

            return textureData;
        }),
    );

    textureDatas.forEach((textureData) => {
        packer.add({
            width: textureData.width,
            height: textureData.height,
            path: textureData.path,
            textureData,
        } as any);
    });

    return packer;
}
