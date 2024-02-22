import { parse } from 'csv-parse';
import { AsyncParser, FieldInfo } from 'json2csv';
import { Readable } from 'stream';
import { AssetsParseData, AssetsTransformData, FileBinaryData } from '../file-processor.models.js';
import { BaseAssetProcessorService } from '../base-asset-processor.service.js';
import { IMigrationAsset } from '../../core/index.js';

export class AssetCsvProcessorService extends BaseAssetProcessorService {
    private readonly csvDelimiter: string = ',';
    private readonly assetsFilename: string = 'assets.csv';
    public readonly name: string = 'csv';

    async transformAssetsAsync(data: AssetsTransformData): Promise<FileBinaryData> {
        const asssetFiels: FieldInfo<string>[] = this.getAssetFields();
        const stream = new Readable();
        stream.push(JSON.stringify(data.assets));
        stream.push(null); // required to end the stream

        const parsingProcessor = this.geCsvParser({
            fields: asssetFiels
        }).fromInput(stream);

        const csvContent = (await parsingProcessor.promise()) ?? '';

        data.zip.addFile(this.assetsFilename, csvContent);

        for (const exportAsset of data.assets) {
            await data.zip.addFile(
                this.getAssetZipFilename(exportAsset.assetExternalId, exportAsset.extension),
                exportAsset.binaryData
            );
        }

        return data.zip.generateZipAsync();
    }

    async parseAssetsAsync(data: AssetsParseData): Promise<IMigrationAsset[]> {
        const text = await data.zip.getFileContentAsync(this.assetsFilename);

        if (!text) {
            return [];
        }

        const parsedAssets: IMigrationAsset[] = [];
        let index = 0;
        const parser = parse(text, {
            cast: true,
            delimiter: this.csvDelimiter
        });

        let parsedColumns: string[] = [];

        for await (const record of parser) {
            if (index === 0) {
                // process header row
                parsedColumns = record;
            } else {
                // process data row
                const parsedAsset: IMigrationAsset = {
                    assetExternalId: '',
                    extension: '',
                    filename: '',
                    url: '',
                    binaryData: undefined
                };

                let fieldIndex: number = 0;
                for (const columnName of parsedColumns) {
                    const columnValue = record[fieldIndex];
                    (parsedAsset as any)[columnName] = columnValue;
                    fieldIndex++;
                }

                // add binary data to record
                parsedAsset.binaryData = await data.zip.getBinaryDataAsync(
                    this.getAssetZipFilename(parsedAsset.assetExternalId, parsedAsset.extension)
                );

                parsedAssets.push(parsedAsset);
            }
            index++;
        }

        return parsedAssets;
    }

    private getAssetZipFilename(assetId: string, extension: string): string {
        return `${assetId}.${extension}`; // use id as filename to prevent filename conflicts
    }

    private geCsvParser(config: { fields: string[] | FieldInfo<string>[] }): AsyncParser<string> {
        return new AsyncParser({
            delimiter: this.csvDelimiter,
            fields: config.fields
        });
    }

    private getAssetFields(): FieldInfo<string>[] {
        return [
            ...this.getSystemAssetFields().map((m) => {
                const field: FieldInfo<string> = {
                    label: m,
                    value: m
                };

                return field;
            })
        ];
    }
}
