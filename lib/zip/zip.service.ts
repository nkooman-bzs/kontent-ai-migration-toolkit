import chalk from 'chalk';
import JSZip from 'jszip';

import { IExportAdapterResult } from '../export/index.js';
import {
    IItemFormatService,
    ZipCompressionLevel,
    IAssetFormatService,
    FileBinaryData,
    ZipContext
} from './zip.models.js';
import { ZipPackage } from './zip-package.class.js';
import { IMigrationAsset, IMigrationItem, Log } from '../core/index.js';
import { IImportData } from '../import/import.models.js';

export function getZipService(log: Log, zipContext: ZipContext): ZipService {
    return new ZipService(log, zipContext);
}

export class ZipService {
    constructor(private readonly log: Log, private readonly zipContext: ZipContext) {}

    async parseZipAsync(data: {
        items?: {
            file: Buffer;
            formatService: IItemFormatService;
        };
        assets?: {
            file: Buffer;
            formatService: IAssetFormatService;
        };
    }): Promise<IImportData> {
        const result: IImportData = {
            items: [],
            assets: []
        };

        if (data.items) {
            this.log.default({
                type: 'info',
                message: 'Loading items zip file'
            });
            const itemsZipFile = await JSZip.loadAsync(data.items.file, {});

            this.log.default({
                type: 'info',
                message: 'Parsing items zip data'
            });

            result.items.push(
                ...(await data.items.formatService.parseAsync({
                    zip: new ZipPackage(itemsZipFile, this.log, this.zipContext)
                }))
            );
        }

        if (data.assets) {
            this.log.default({
                type: 'info',
                message: 'Loading assets zip file'
            });
            const assetsZipFile = await JSZip.loadAsync(data.assets.file, {});

            this.log.default({
                type: 'info',
                message: 'Parsing assets zip data'
            });

            result.assets.push(
                ...(await data.assets.formatService.parseAsync({
                    zip: new ZipPackage(assetsZipFile, this.log, this.zipContext)
                }))
            );
        }

        this.log.default({
            type: 'info',
            message: `Parsing completed. Parsed '${chalk.yellow(
                result.items.length.toString()
            )}' items and '${chalk.yellow(result.assets.length.toString())}' assets`
        });

        return result;
    }

    async parseFileAsync(data: {
        items?: {
            file: Buffer;
            formatService: IItemFormatService;
        };
        assets?: {
            file: Buffer;
            formatService: IAssetFormatService;
        };
    }): Promise<IImportData> {
        let parsedItems: IMigrationItem[] = [];
        let parsedAssets: IMigrationAsset[] = [];

        if (data.items) {
            this.log.default({
                type: 'info',
                message: `Parsing items file with '${chalk.yellow(data.items.formatService.name)}' `
            });

            const itemsZipFile = await JSZip.loadAsync(data.items.file, {});
            parsedItems = await data.items.formatService.parseAsync({
                zip: new ZipPackage(itemsZipFile, this.log, this.zipContext)
            });
        }

        if (data.assets) {
            this.log.default({
                type: 'info',
                message: `Parsing assets file with '${chalk.yellow(data.assets.formatService.name)}' `
            });

            const assetsZipFile = await JSZip.loadAsync(data.assets.file, {});
            parsedAssets = await data.assets.formatService.parseAsync({
                zip: new ZipPackage(assetsZipFile, this.log, this.zipContext)
            });
        }

        const result: IImportData = {
            items: parsedItems,
            assets: parsedAssets
        };

        this.log.default({
            type: 'info',
            message: `Parsing completed. Parsed '${chalk.yellow(
                result.items.length.toString()
            )}' items and '${chalk.yellow(result.assets.length.toString())}' assets`
        });

        return result;
    }

    async createItemsZipAsync(
        exportData: IExportAdapterResult,
        config: {
            itemFormatService: IItemFormatService;
            compressionLevel?: ZipCompressionLevel;
        }
    ): Promise<FileBinaryData> {
        this.log.default({
            type: 'info',
            message: `Creating items zip`
        });

        const zip = await config.itemFormatService.transformAsync({
            items: exportData.items,
            zip: new ZipPackage(new JSZip(), this.log, this.zipContext)
        });

        return zip;
    }

    async createAssetsZipAsync(
        exportData: IExportAdapterResult,
        config: {
            assetFormatService: IAssetFormatService;
            compressionLevel?: ZipCompressionLevel;
        }
    ): Promise<FileBinaryData> {
        this.log.default({
            type: 'info',
            message: `Creating assets zip`
        });

        const zip = await config.assetFormatService.transformAsync({
            assets: exportData.assets,
            zip: new ZipPackage(new JSZip(), this.log, this.zipContext)
        });

        return zip;
    }
}
