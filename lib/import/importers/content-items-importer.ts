import { ContentItemModels, ManagementClient } from '@kontent-ai/management-sdk';
import chalk from 'chalk';
import { LogSpinnerData, Logger, MigrationItem, findRequired, processItemsAsync, runMapiRequestAsync } from '../../core/index.js';
import { ImportContext, ImportedItem } from '../import.models.js';

export function contentItemsImporter(data: {
    readonly logger: Logger;
    readonly client: Readonly<ManagementClient>;
    readonly importContext: ImportContext;
}) {
    const shouldUpdateContentItem = (migrationItem: MigrationItem, contentItem: Readonly<ContentItemModels.ContentItem>): boolean => {
        const collection = findRequired(
            data.importContext.environmentData.collections,
            (collection) => collection.id === contentItem.collection.id,
            `Invalid collection with id '${contentItem.collection.id}' for content item '${contentItem.codename}'`
        );

        return migrationItem.system.name !== contentItem.name || migrationItem.system.collection.codename !== collection.codename;
    };

    const prepareContentItemAsync = async (
        logSpinner: LogSpinnerData,
        migrationItem: MigrationItem
    ): Promise<{ contentItem: Readonly<ContentItemModels.ContentItem>; status: 'created' | 'itemAlreadyExists' }> => {
        const itemStateInTargetEnv = data.importContext.getItemStateInTargetEnvironment(migrationItem.system.codename);

        if (itemStateInTargetEnv.state === 'exists' && itemStateInTargetEnv.item) {
            return {
                contentItem: itemStateInTargetEnv.item,
                status: 'itemAlreadyExists'
            };
        }

        const createdContentItem = await runMapiRequestAsync({
            logger: data.logger,
            func: async () =>
                (
                    await data.client
                        .addContentItem()
                        .withData({
                            name: migrationItem.system.name,
                            type: {
                                codename: migrationItem.system.type.codename
                            },
                            external_id: itemStateInTargetEnv.externalIdToUse,
                            codename: migrationItem.system.codename,
                            collection: {
                                codename: migrationItem.system.collection.codename
                            }
                        })
                        .toPromise()
                ).data,
            action: 'create',
            type: 'contentItem',
            logSpinner: logSpinner,
            itemName: `${migrationItem.system.codename} (${migrationItem.system.language.codename})`
        });

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

    const importAsync = async (): Promise<readonly ImportedItem[]> => {
        // Only import unique content items based on their codename. The input may contain items in various language variants which share
        // the same underlying content item.
        const contentItemsToImport = data.importContext.categorizedImportData.contentItems.reduce<Readonly<MigrationItem[]>>(
            (filteredItems, item) => {
                if (filteredItems.some((m) => m.system.codename === item.system.codename)) {
                    return filteredItems;
                }

                return [...filteredItems, item];
            },
            []
        );

        data.logger.log({
            type: 'info',
            message: `Importing '${chalk.yellow(contentItemsToImport.length.toString())}' content items`
        });

        return await processItemsAsync<MigrationItem, Readonly<ContentItemModels.ContentItem>>({
            action: 'Importing content items',
            logger: data.logger,
            parallelLimit: 1,
            items: contentItemsToImport,
            itemInfo: (item) => {
                return {
                    itemType: 'contentItem',
                    codename: item.system.codename,
                    title: `${item.system.codename} -> ${item.system.type.codename}`
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
