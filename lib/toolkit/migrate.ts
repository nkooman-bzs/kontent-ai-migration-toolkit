import { IRetryStrategyOptions } from '@kontent-ai/core-sdk';
import {
    ExternalIdGenerator,
    FlattenedContentTypeElement,
    Logger,
    ManagementClientConfig,
    MigrationAsset,
    MigrationData,
    MigrationItem,
    executeWithTrackingAsync,
    getDefaultLogger
} from '../core/index.js';
import { ExportItem, SourceExportItem } from '../export/index.js';
import { ImportResult } from '../import/index.js';
import { libMetadata } from '../metadata.js';
import { exportAsync } from './export.js';
import { importAsync } from './import.js';
import { AssetModels } from '@kontent-ai/management-sdk';

export interface MigrationSource extends ManagementClientConfig {
    readonly items: readonly SourceExportItem[];
}

export interface MigrationConfig {
    readonly retryStrategy?: IRetryStrategyOptions;
    readonly externalIdGenerator?: ExternalIdGenerator;
    readonly logger?: Logger;
    readonly sourceEnvironment: MigrationSource;
    readonly targetEnvironment: ManagementClientConfig;
    readonly mapMigrationData: (data: MigrationData) => MigrationData;
    readonly onAction: (action: string | null) => void;
    readonly onItem: (item: ExportItem | MigrationItem | null) => void;
    readonly onElement: (element: FlattenedContentTypeElement | string | null) => void;
    readonly onAsset: (asset: AssetModels.Asset | MigrationAsset | null) => void;
}

export interface MigrationResult {
    readonly migrationData: MigrationData;
    readonly importResult: ImportResult;
}

export async function migrateAsync(config: MigrationConfig): Promise<MigrationResult> {
    const logger = config.logger ?? getDefaultLogger();

    return await executeWithTrackingAsync({
        event: {
            tool: 'migrationToolkit',
            package: {
                name: libMetadata.name,
                version: libMetadata.version
            },
            action: 'migrate',
            relatedEnvironmentId: undefined,
            details: {
                itemsCount: config.sourceEnvironment.items.length
            }
        },
        func: async () => {
            config.onAction('content-export');
            const migrationData = await exportAsync({
                ...config.sourceEnvironment,
                logger: logger,
                exportItems: config.sourceEnvironment.items,
                onAction: config.onAction,
                onItem: config.onItem,
                onElement: config.onElement,
                onAsset: config.onAsset
            });

            config.onAction('content-import');
            const importResult = await importAsync({
                ...config.targetEnvironment,
                logger: logger,
                data: config.mapMigrationData(migrationData),
                externalIdGenerator: config.externalIdGenerator,
                onAction: config.onAction,
                onItem: config.onItem,
                onElement: config.onElement,
                onAsset: config.onAsset
            });

            config.onAction(null);

            return {
                importResult,
                migrationData
            };
        },
        logger: config.logger
    });
}
