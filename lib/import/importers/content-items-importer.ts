import { ContentItemModels, ManagementClient } from '@kontent-ai/management-sdk';
import {
    Logger,
    processItemsAsync,
    runMapiRequestAsync,
    MigrationItem,
    LogSpinnerData,
    findRequired
} from '../../core/index.js';
import chalk from 'chalk';
import { ImportContext } from '../import.models.js';

export function contentItemsImporter(data: {
    readonly logger: Logger;
    readonly client: Readonly<ManagementClient>;
    readonly importContext: ImportContext;
    readonly failOnError: boolean;
}) {
    const shouldUpdateContentItem = (
        migrationContentItem: MigrationItem,
        contentItem: Readonly<ContentItemModels.ContentItem>
    ): boolean => {
        const collection = findRequired(
            data.importContext.environmentData.collections,
            (collection) => collection.id === contentItem.collection.id,
            `Invalid collection '${migrationContentItem.system.collection.codename}'`
        );

        return (
            migrationContentItem.system.name !== contentItem.name ||
            migrationContentItem.system.collection.codename !== collection.codename
        );
    };

    const createdContentItems = new Map<string, ContentItemModels.ContentItem>();

    const prepareContentItemAsync = async (
        logSpinner: LogSpinnerData,
        migrationContentItem: MigrationItem
    ): Promise<{ contentItem: Readonly<ContentItemModels.ContentItem>; status: 'created' | 'itemAlreadyExists' }> => {
        const itemStateInTargetEnv = data.importContext.getItemStateInTargetEnvironment(
            migrationContentItem.system.codename
        );

        if (itemStateInTargetEnv.state === 'exists' && itemStateInTargetEnv.item) {
            return {
                contentItem: itemStateInTargetEnv.item,
                status: 'itemAlreadyExists'
            };
        }

        // Checks if the content item was already created in this import session
        if (createdContentItems.has(migrationContentItem.system.codename)) {
            return {
                contentItem: createdContentItems.get(migrationContentItem.system.codename)!,
                status: 'created'
            };
        }

        const createdContentItem = await runMapiRequestAsync({
            logger: data.logger,
            func: async () =>
                (
                    await data.client
                        .addContentItem()
                        .withData({
                            name: migrationContentItem.system.name,
                            type: {
                                codename: migrationContentItem.system.type.codename
                            },
                            external_id: itemStateInTargetEnv.externalIdToUse,
                            codename: migrationContentItem.system.codename,
                            collection: {
                                codename: migrationContentItem.system.collection.codename
                            }
                        })
                        .toPromise()
                ).data,
            action: 'create',
            type: 'contentItem',
            logSpinner: logSpinner,
            itemName: `${migrationContentItem.system.codename} (${migrationContentItem.system.language.codename})`
        })

        createdContentItems.set(createdContentItem.codename, createdContentItem);

        return {
            contentItem: createdContentItem,
            status: 'created'
        };
    };

    const importContentItemAsync = async (
        logSpinner: LogSpinnerData,
        migrationItem: MigrationItem
    ): Promise<Readonly<ContentItemModels.ContentItem>> => {
        const preparedContentItemResult = await prepareContentItemAsync(logSpinner, migrationItem);

        // check if name should be updated, no other changes are supported
        if (preparedContentItemResult.status === 'itemAlreadyExists') {
            if (shouldUpdateContentItem(migrationItem, preparedContentItemResult.contentItem)) {
                await runMapiRequestAsync({
                    logger: data.logger,
                    func: async () => {
                        await data.client
                            .upsertContentItem()
                            .byItemCodename(migrationItem.system.codename)
                            .withData({
                                name: migrationItem.system.name,
                                collection: {
                                    codename: migrationItem.system.collection.codename
                                }
                            })
                            .toPromise();
                    },
                    action: 'upsert',
                    type: 'contentItem',
                    logSpinner: logSpinner,
                    itemName: `${migrationItem.system.codename} (${migrationItem.system.language.codename})`
                });
            }
        }

        return preparedContentItemResult.contentItem;
    };

    const importAsync = async (): Promise<readonly Readonly<ContentItemModels.ContentItem>[]> => {
        const contentItemsToImport = data.importContext.categorizedImportData.contentItems;

        data.logger.log({
            type: 'info',
            message: `Importing '${chalk.yellow(contentItemsToImport.length.toString())}' content items`
        });

        return await processItemsAsync<MigrationItem, Readonly<ContentItemModels.ContentItem>>({
            action: 'Importing content items',
            logger: data.logger,
            parallelLimit: 1,
            failOnError: data.failOnError,
            items: contentItemsToImport,
            itemInfo: (item) => {
                return {
                    itemType: 'contentItem',
                    codename: item.system.codename,
                    title: `${item.system.codename} -> ${item.system.language.codename}`
                };
            },
            processAsync: async (item, logSpinner) => {
                return await importContentItemAsync(logSpinner, item);
            }
        });
    };

    return {
        importAsync
    };
}
