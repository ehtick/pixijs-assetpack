/* eslint-disable no-console */
import chalk from 'chalk';
import { Command } from 'commander';
import { findUp } from 'find-up';
import { createRequire } from 'module';
import path from 'path';
import { pathToFileURL } from 'url';

import type { AssetPack as AP } from '../core/AssetPack.js';
import type { AssetPackConfig } from '../core/config.js';

const require = createRequire(import.meta.url);

interface Options {
    config: string;
    watch: boolean;
}

const program = new Command();

program.description('AssetPack CLI - A tool for building and transforming assets');
program.version('0.2.0');
program.option('-c, --config <path>', 'config file to use');
program.option('-w, --watch', 'watch for changes');
program.allowExcessArguments();

async function main() {
    await program.parseAsync();

    const options = program.opts<Options>();

    // if config exist then use that path, otherwise use find-up
    const configPath = options.config
        ? path.resolve(process.cwd(), options.config)
        : await findUp('.assetpack.js', { cwd: process.cwd() });

    if (!configPath) {
        logEvent({
            message: 'No config file found',
            level: 'error',
        });
        process.exit(1);
    }

    let config: AssetPackConfig;
    let AssetPack: typeof AP;

    // We try to load cjs first, if that fails we try to load esm
    try {
        const configModule = require(configPath);

        config = configModule.__esModule ? configModule.default : configModule;
        AssetPack = require('@assetpack/core').AssetPack;
    } catch (error: any) {
        if (error.code === 'ERR_REQUIRE_ESM') {
            const esmLoader = dynamicImportLoader();
            const urlForConfig = pathToFileURL(configPath);

            config = (await esmLoader!(urlForConfig)).default;
            AssetPack = (await esmLoader!('@assetpack/core')).AssetPack;
        } else {
            logEvent({
                message: error.message,
                level: 'error',
            });
            process.exit(1);
        }
    }

    if (!config) {
        logEvent({
            message: 'Config file found, but could not be read',
            level: 'error',
        });
        process.exit(1);
    }

    const assetpack = new AssetPack(config);

    if (options.watch) {
        await assetpack.watch();
    } else {
        await assetpack.run();
    }
}

function logEvent(event: { message: string; level: 'verbose' | 'info' | 'warn' | 'error' }) {
    switch (event.level) {
        case 'verbose':
        case 'info':
            console.log(`${chalk.blue.bold('›')} Info: ${chalk.blue.bold(event.message)}`);
            break;
        case 'warn':
            console.log(`${chalk.yellow.bold('›')} Warn: ${chalk.yellow.bold(event.message)}`);
            break;
        case 'error':
            console.log(`${chalk.red.bold('›')} Error: ${chalk.red.bold(event.message)}`);
            process.exit(1);
            break;
        default:
            throw new Error(`Unknown log level ${event.level}`);
    }
}

function dynamicImportLoader() {
    let importESM;

    try {
        // eslint-disable-next-line no-new-func
        importESM = new Function('id', 'return import(id);');
    } catch (_e) {
        importESM = null;
    }

    return importESM;
}

void main();
