import { AssetContracts, ContentItemContracts } from '@kontent-ai/management-sdk';
import { HttpService } from '@kontent-ai/core-sdk';
import { AsyncParser } from 'json2csv';
import * as JSZip from 'jszip';

import { IExportAllResult } from '../export';
import { IBinaryFile, IImportSource } from '../import';
import { IZipServiceConfig } from './zip.models';
import { yellow } from 'colors';
import { Readable } from 'stream';

export class ZipService {
    private readonly delayBetweenAssetRequestsMs: number;

    private readonly contentItemsName: string = 'contentItems.csv';
    private readonly assetsName: string = 'assets.json';
    private readonly languageVariantsName: string = 'languageVariants.json';
    private readonly metadataName: string = 'metadata.json';
    private readonly filesName: string = 'files';
    private readonly dataName: string = 'data';

    private readonly validationName: string = 'validation.json';

    private readonly httpService: HttpService = new HttpService();

    private readonly csvDelimiter: string = ',';
    private readonly csvParser: AsyncParser<any> = new AsyncParser({ delimiter: this.csvDelimiter });

    constructor(private config: IZipServiceConfig) {
        this.delayBetweenAssetRequestsMs = config?.delayBetweenAssetDownloadRequestsMs ?? 150;
    }

    public async extractZipAsync(zipFile: any): Promise<IImportSource> {
        if (this.config.enableLog) {
            console.log(`Unzipping file`);
        }

        const unzippedFile = await JSZip.loadAsync(zipFile);

        if (this.config.enableLog) {
            console.log(`Parsing zip contents`);
        }
        const assets = await this.readAndParseJsonFile(unzippedFile, this.assetsName);
        const result: IImportSource = {
            importData: {
                assets,
                languageVariants: await this.readAndParseJsonFile(unzippedFile, this.languageVariantsName),
                contentItems: await this.readAndParseJsonFile(unzippedFile, this.contentItemsName)
            },
            binaryFiles: await this.extractBinaryFilesAsync(unzippedFile, assets),
            validation: await this.readAndParseJsonFile(unzippedFile, this.validationName),
            metadata: await this.readAndParseJsonFile(unzippedFile, this.metadataName)
        };

        if (this.config.enableLog) {
            console.log(`Pasing zip completed`);
        }

        return result;
    }

    public async createZipAsync(exportData: IExportAllResult): Promise<any> {
        const zip = new JSZip();

        if (this.config.enableLog) {
            console.log(`Parsing json`);
        }

        const dataFolder = zip.folder(this.dataName);
        const assetsFolder = zip.folder(this.filesName);

        if (!assetsFolder) {
            throw Error(`Could not create folder '${yellow(this.filesName)}'`);
        }

        if (!dataFolder) {
            throw Error(`Could not create folder '${yellow(this.dataName)}'`);
        }

        dataFolder.file(
            this.contentItemsName,
            (await this.mapContentItemsToCsvAsync(exportData.data.contentItems)) ?? ''
        );
        dataFolder.file(this.assetsName, JSON.stringify(exportData.data.assets));
        dataFolder.file(this.languageVariantsName, JSON.stringify(exportData.data.languageVariants));

        zip.file(this.metadataName, JSON.stringify(exportData.metadata));
        zip.file(this.validationName, JSON.stringify(exportData.validation));

        if (this.config.enableLog) {
            console.log(`Adding assets to zip`);
        }

        for (const asset of exportData.data.assets) {
            const assetIdShortFolderName = asset.id.substr(0, 3);
            const assetIdShortFolder = assetsFolder.folder(assetIdShortFolderName);

            if (!assetIdShortFolder) {
                throw Error(`Could not create folder '${yellow(this.filesName)}'`);
            }

            const assetIdFolderName = asset.id;
            const assetIdFolder = assetIdShortFolder.folder(assetIdFolderName);

            if (!assetIdFolder) {
                throw Error(`Could not create folder '${yellow(this.filesName)}'`);
            }

            const assetFilename = asset.file_name;
            assetIdFolder.file(assetFilename, await this.getBinaryDataFromUrlAsync(asset.url, this.config.enableLog), {
                binary: true
            });

            // create artificial delay between requests as to prevent errors on network
            await this.sleepAsync(this.delayBetweenAssetRequestsMs);
        }

        if (this.config.enableLog) {
            console.log(`Creating zip file`);
        }

        const content = await zip.generateAsync({ type: this.getZipOutputType() });

        if (this.config.enableLog) {
            console.log(`Zip file prepared`);
        }

        return content;
    }

    private async mapContentItemsToCsvAsync(
        items: ContentItemContracts.IContentItemModelContract[]
    ): Promise<string | undefined> {
        const itemsAsReadableStream = new Readable();
        itemsAsReadableStream.push(JSON.stringify(items));
        itemsAsReadableStream.push(null);

        const parsingProcessor = this.csvParser.fromInput(itemsAsReadableStream);

        const result = await parsingProcessor.promise();

        return result ?? undefined;
    }

    private sleepAsync(ms: number): Promise<any> {
        return new Promise((resolve: any) => setTimeout(resolve, ms));
    }

    private async extractBinaryFilesAsync(
        zip: JSZip,
        assets: AssetContracts.IAssetModelContract[]
    ): Promise<IBinaryFile[]> {
        const binaryFiles: IBinaryFile[] = [];

        const files = zip.files;

        for (const asset of assets) {
            const assetFile = files[this.getFullAssetPath(asset.id, asset.file_name)];

            const binaryData = await assetFile.async(this.getZipOutputType());
            binaryFiles.push({
                asset,
                binaryData
            });
        }

        return binaryFiles;
    }

    private getZipOutputType(): 'nodebuffer' | 'blob' {
        if (this.config.context === 'browser') {
            return 'blob';
        }

        if (this.config.context === 'node.js') {
            return 'nodebuffer';
        }

        throw Error(`Unsupported context '${this.config.context}'`);
    }

    /**
     * Gets path to asset within zip folder. Uses tree format using asset ids such as:
     * "files/3b4/3b42f36c-2e67-4605-a8d3-fee2498e5224/image.jpg"
     */
    private getFullAssetPath(assetId: string, filename: string): string {
        return `${this.filesName}/${assetId.substr(0, 3)}/${assetId}/${filename}`;
    }

    private async readAndParseJsonFile(fileContents: any, filename: string): Promise<any> {
        const files = fileContents.files;
        const file = files[filename];

        if (!file) {
            throw Error(`Invalid file '${yellow(filename)}'`);
        }

        const text = await file.async('text');

        return JSON.parse(text);
    }

    private async getBinaryDataFromUrlAsync(url: string, enableLog: boolean): Promise<any> {
        // temp fix for Kontent.ai Repository not validating url
        url = url.replace('#', '%23');

        if (enableLog) {
            console.log(`Asset download: ${yellow(url)}`);
        }

        return (
            await this.httpService.getAsync(
                {
                    url
                },
                {
                    responseType: 'arraybuffer'
                }
            )
        ).data;
    }
}
