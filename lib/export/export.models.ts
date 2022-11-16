import { IRetryStrategyOptions } from '@kontent-ai/core-sdk';

import { IProcessedItem, IPackageMetadata } from '../core';
import { IContentItem, IContentType, ILanguage } from '@kontent-ai/delivery-sdk';

export interface IExportFilter {
    /**
     * Array of type codenames to export. Defaults to all content types if none type is provided.
     */
    types?: string[];
}

export interface IExportConfig {
    projectId: string;
    apiKey: string;
    baseUrl?: string;
    onExport?: (item: IProcessedItem) => void;
    exportFilter?: IExportFilter;
    retryStrategy?: IRetryStrategyOptions;
}

export interface IExportData {
    contentItems: IContentItem[];
    contentTypes: IContentType[];
    languages: ILanguage[];
    assets: IExportedAsset[];
}

export interface IExportAllResult {
    metadata: IPackageMetadata;
    data: IExportData;
}

export interface IExportedAsset {
    url: string;
    extension: string;
    assetId: string;
    filename: string;
}
