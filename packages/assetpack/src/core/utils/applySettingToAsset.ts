import { minimatch } from 'minimatch';
import { merge } from './merge.js';
import { path } from './path.js';

import type { Asset } from '../Asset.js';
import type { AssetSettings } from '../pipes/PipeSystem.js';

export function applySettingToAsset(asset: Asset, settings: AssetSettings[], entryPath: string) {
    const relativePath = path.relative(entryPath, asset.path);

    let assetOptions;
    let metaData;

    for (let i = 0; i < settings.length; i++) {
        const setting = settings[i];

        const match = setting.files.some((item: string) => minimatch(relativePath, item, { dot: true }));

        if (match) {
            assetOptions = merge.recursive(assetOptions ?? {}, setting.settings);
            metaData = { ...(metaData ?? {}), ...setting.metaData };
        }
    }

    // if we have settings, then apply them to the asset
    if (assetOptions) {
        asset.settings = assetOptions;
        asset.metaData = { ...metaData, ...asset.metaData };
    }
}
