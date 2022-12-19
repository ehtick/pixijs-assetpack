import { Runner } from '@pixi/runner';
import { copySync, existsSync, outputFileSync, removeSync } from 'fs-extra';
import merge from 'merge';
import minimatch from 'minimatch';
import type { RootTree, Tags, TransformedTree } from './Assetpack';
import { Logger } from './logger/Logger';
import type { Plugin } from './Plugin';
import type { ReqAssetpackConfig } from './config';
import { hasTag, replaceExt } from './utils';

interface SaveOptions<T extends RootTree | TransformedTree>
{
    tree: T
    outputOptions?: {
        outputExtension?: string;
        outputPathOverride?: string;
        outputData?: any;
    },
    transformOptions?: {
        isFolder?: boolean,
        fileTags?: Tags,
        transformId?: string
        transformData?: Record<string, string>
    },
}

export class Processor
{
    private readonly _config: ReqAssetpackConfig;
    private _pluginMap: Map<Plugin, string> = new Map();
    /** Array of plugins to be called */
    private readonly _plugins: Plugin[] = [];
    /**  A runner that calls the start function of a plugin */
    private readonly _onStart: Runner = new Runner('start');
    /** A runner that calls the finish function of a plugin */
    private readonly _onFinish: Runner = new Runner('finish');
    /** Time a tree was modified */
    private _modifiedTime = 0;

    private _transformHash: Record<string, TransformedTree[] | null> = {};
    private _hash: Record<string, RootTree> = {};

    constructor(config: ReqAssetpackConfig)
    {
        this._config = config;
    }

    public addPlugin(plugin: Plugin, key: string): void
    {
        this._pluginMap.set(plugin, key);
        this._plugins.push(plugin);
        this._onStart.add(plugin);
        this._onFinish.add(plugin);
    }

    public async run(tree: RootTree): Promise<void>
    {
        this._modifiedTime = Date.now();

        tree.state = 'modified';

        Logger.report({
            type: 'buildStart',
            message: this._config.entry,
        });

        Logger.report({
            type: 'buildProgress',
            phase: 'start',
        });

        // step 1: first let all plugins know that we have begun..
        // this gets called ONCE for each plugin
        this._onStart.emit(tree, this);

        Logger.report({
            type: 'buildProgress',
            phase: 'delete',
        });

        // step 2: run all plugins
        // this loops through and deletes any output files
        // that have been deleted from input folder
        await Promise.all(this._cleanTree(tree).map((p) => p.catch((e) =>
        {
            Logger.error(`[processor] Clean failed: ${e.message}`);
        })));

        Logger.report({
            type: 'buildProgress',
            phase: 'transform',
        });

        // step 3: next we transform our files
        // this is where one file can become another (or multiple!)
        // eg tps folder becomes a json + png file
        // all transformed files are attached to the tree node as an array
        // call 'transformed'
        // if there is no transform for a particular item then the
        // file is simply copied and stored in the transformed
        await Promise.all(this._transformTree(tree).map((p) => p.catch((e) =>
        {
            Logger.error(`[processor] Transform failed: ${e.message}`);
        })));

        Logger.report({
            type: 'buildProgress',
            phase: 'post',
        });

        // step 4: this will do a pass on all transformed files
        // An opportunity to compress files or build manifests
        await Promise.all(this._postTree(tree).map((p) => p.catch((e) =>
        {
            Logger.error(`[processor] Post Transform failed: ${e.message}`);
        })));

        Logger.report({
            type: 'buildProgress',
            phase: 'finish',
        });

        // now everything is done, we let all processes know that is the case.
        this._onFinish.emit(tree, this);

        Logger.report({
            type: 'buildSuccess',
        });
    }

    public inputToOutput(inputPath: string, extension?: string): string
    {
        const targetPath = inputPath.replace(/{(.*?)}/g, '');

        let output = targetPath.replace(this._config.entry, this._config.output);

        if (extension)
        {
            output = replaceExt(output, extension);
        }

        return output;
    }

    public addToTreeAndSave(data: SaveOptions<RootTree>)
    {
        const outputName = data.outputOptions?.outputPathOverride
            ?? this.inputToOutput(data.tree.path, data.outputOptions?.outputExtension);

        this.addToTree({
            tree: data.tree,
            outputOptions: {
                outputPathOverride: outputName,
            },
            ...data.transformOptions
        });

        this.saveToOutput({
            tree: data.tree,
            outputOptions: {
                outputPathOverride: outputName,
                outputData: data.outputOptions?.outputData,
            },
        });
    }

    public saveToOutput(data: Omit<SaveOptions<RootTree | TransformedTree>, 'transformOptions'>)
    {
        const outputName = data.outputOptions?.outputPathOverride
            ?? this.inputToOutput(data.tree.path, data.outputOptions?.outputExtension);

        if (!data.outputOptions?.outputData)
        {
            copySync(data.tree.path, outputName);
            Logger.verbose(`[processor] File Copied: ${outputName}`);

            return outputName;
        }

        outputFileSync(outputName, data.outputOptions.outputData);
        Logger.verbose(`[processor] File Saved: ${outputName}`);

        return outputName;
    }

    /**
     * Adds files that have been transformed into the tree.
     *
     * @param data.outputName - Path of the file.
     * @param data.tree - Tree that will have transformed files added too.
     * @param data.isFolder - Whether transformed file is a folder.
     * @param data.fileTags - Tags that are associated with the folder.
     * @param data.transformId - Unique id for the transformed file.
     * @param data.transformData - any optional data you want to pass in with the transform.
     */
    public addToTree(data: Omit<SaveOptions<RootTree>, 'transformOptions'> & SaveOptions<RootTree>['transformOptions']): void
    {
        // eslint-disable-next-line prefer-const
        let { tree, isFolder, fileTags, transformId, transformData } = data;

        const outputName = data.outputOptions?.outputPathOverride
            ?? this.inputToOutput(data.tree.path, data.outputOptions?.outputExtension);

        if (!tree.transformed)
        {
            tree.transformed = [];
        }

        isFolder = isFolder ?? tree.isFolder;
        fileTags = { ...tree.fileTags, ...fileTags };

        tree.transformed.push({
            path: outputName,
            isFolder,
            creator: tree.path,
            time: this._modifiedTime,
            fileTags,
            pathTags: tree.pathTags,
            transformId: transformId ?? null,
            transformData: transformData || {},
        });
    }

    /**
     * Recursively checks for the deleted state of the files in a tree.
     * If found then its removed from the tree and plugin.delete() is called.
     * @param tree - Tree to be processed.
     * @param promises - Array of plugin.delete promises to be returned.
     */
    private _cleanTree(tree: RootTree, promises: Promise<void>[] = []): Promise<void>[]
    {
        for (const i in tree.files)
        {
            this._cleanTree(tree.files[i], promises);
        }

        if (tree.state === 'deleted')
        {
            for (let j = 0; j < this._plugins.length; j++)
            {
                const plugin = this._plugins[j];

                if (
                    plugin.delete
                    && !hasTag(tree, 'path', 'ignore')
                    && plugin.test(tree, this, this.getOptions(tree.path, plugin))
                )
                {
                    promises.push(plugin.delete(tree, this, this.getOptions(tree.path, plugin)));
                }
            }

            const transformed = tree.transformed;

            if (transformed)
            {
                transformed.forEach((out: TransformedTree) =>
                {
                    removeSync(out.path);
                });

                this._transformHash[tree.path] = null;
            }
        }

        return promises;
    }

    /**
     * Recursively loops through a tree and called the transform function on a plugin if the tree was added or modified
     * @param tree - Tree to be processed
     * @param promises - Array of plugin.transform promises to be returned.
     */
    private _transformTree(tree: RootTree, promises: Promise<void>[] = []): Promise<void>[]
    {
        let stopProcessing = false;
        let transformed = false;

        // first apply transforms / copy to other place..
        if (tree.state === 'modified' || tree.state === 'added')
        {
            if (tree.path && !existsSync(tree.path))
            {
                Logger.error(
                    `[processor] Asset ${tree.path} does not exist. Could have been deleted half way through processing.`
                );

                return promises;
            }

            for (let j = 0; j < this._plugins.length; j++)
            {
                const plugin = this._plugins[j];

                if (
                    plugin.transform
                    && !hasTag(tree, 'path', 'ignore')
                    && plugin.test(tree, this, this.getOptions(tree.path, plugin))
                )
                {
                    transformed = true;

                    promises.push(plugin.transform(tree, this, this.getOptions(tree.path, plugin)));

                    if (plugin.folder)
                    {
                        stopProcessing = true;
                    }
                }
            }

            // if tree.path is nul the this is the root..
            if (!transformed)
            {
                if (!tree.isFolder)
                {
                    this.addToTreeAndSave({ tree });
                }
                else
                {
                    this.addToTree({ tree });
                }
            }
        }

        this._hash[tree.path] = tree;

        if (tree.transformed.length > 0)
        {
            this._transformHash[tree.path] = tree.transformed;
        }
        else
        {
            tree.transformed = this._transformHash[tree.path] || [];
        }

        if (stopProcessing) return promises;

        for (const i in tree.files)
        {
            this._transformTree(tree.files[i], promises);
        }

        return promises;
    }

    /**
     * Recursively loops through a tree and called the test and post function on a process if the tree was added or modified
     * @param tree - Tree to be processed.
     * @param promises - Array of plugin.post promises to be returned.
     */
    private _postTree(tree: RootTree, promises: Promise<void>[] = []): Promise<void>[]
    {
        let stopProcessing = false;

        // first apply transforms / copy to other place..
        if (tree.state === 'modified' || tree.state === 'added')
        {
            if (tree.transformed)
            {
                for (let i = 0; i < tree.transformed.length; i++)
                {
                    const processList: Plugin[] = [];
                    const outfile = tree.transformed[i];

                    for (let j = 0; j < this._plugins.length; j++)
                    {
                        const plugin = this._plugins[j];

                        if (
                            plugin.post
                            && !hasTag(tree, 'path', 'ignore')
                            && plugin.test(tree, this, this.getOptions(tree.path, plugin))
                        )
                        {
                            processList.push(plugin);

                            if (plugin.folder)
                            {
                                stopProcessing = true;
                            }
                        }
                    }

                    promises.push(new Promise(async (resolve) =>
                    {
                        for (let j = 0; j < processList.length; j++)
                        {
                            const plugin = processList[j];

                            await plugin.post?.(outfile, this, this.getOptions(tree.path, plugin));
                        }

                        resolve();
                    }));
                }
            }
        }

        if (stopProcessing) return promises;

        for (const i in tree.files)
        {
            this._postTree(tree.files[i], promises);
        }

        return promises;
    }

    private getOptions(file: string, plugin: Plugin)
    {
        let options: Record<string, any> = {};

        // walk through the config.files and see if we have a match..
        for (const i in this._config.files)
        {
            const fileConfig = this._config.files[i];

            // use minimatch to see if we have a match on any item in the files array
            const match = fileConfig.files.some((item: string) => minimatch(file, item));

            if (match)
            {
                options = merge.recursive(options, fileConfig.settings);
            }
        }

        const name = this._pluginMap.get(plugin);

        if (!name) throw new Error(`[processor] Plugin not found in map.`);

        return options[name] || {};
    }
}