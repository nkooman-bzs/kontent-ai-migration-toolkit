import { AssetFolderModels, AssetModels, CollectionModels, ContentItemModels, ElementModels } from '@kontent-ai/management-sdk';
import chalk from 'chalk';
import {
    extractErrorData,
    findRequired,
    FlattenedContentType,
    FlattenedContentTypeElement,
    getBinaryDataFromUrlAsync,
    getDefaultLogger,
    getMigrationManagementClient,
    isNotUndefined,
    MigrationAsset,
    MigrationAssetsSchema,
    MigrationComponent,
    MigrationData,
    MigrationElements,
    MigrationElementTransformData,
    MigrationItem,
    MigrationItemsSchema,
    MigrationItemVersion,
    processItemsAsync,
    Writeable
} from '../core/index.js';
import { exportTransforms } from '../translation/index.js';
import { exportContextFetcherAsync } from './context/export-context-fetcher.js';
import { ExportConfig, ExportContext, ExportItem } from './export.models.js';

export function exportManager(config: ExportConfig) {
    const logger = config.logger ?? getDefaultLogger();
    const managementClient = getMigrationManagementClient(config);

    const getMigrationItems = (context: ExportContext): readonly MigrationItem[] => {
        return context.exportItems.map<MigrationItem | null>((exportItem) => mapToMigrationItem(context, exportItem,)).filter(item => item !== null);
    };

    const mapToMigrationItem = (context: ExportContext, exportItem: ExportItem): Readonly<MigrationItem | null> => {
        config.onAction(`processing-item`);
        config.onItem(exportItem);
        try {
            const migrationItem: MigrationItem = {
                system: {
                    name: exportItem.contentItem.name,
                    codename: exportItem.contentItem.codename,
                    language: { codename: exportItem.language.codename },
                    type: { codename: exportItem.contentType.contentTypeCodename },
                    collection: { codename: exportItem.collection.codename },
                    workflow: {
                        codename: exportItem.workflow.codename
                    }
                },
                versions: exportItem.versions.map<MigrationItemVersion>((version) => {
                    return {
                        elements: getMigrationElements(context, exportItem.contentType, version.languageVariant.elements, exportItem.contentItem, exportItem.language.codename),
                        schedule: {
                            publish_time: version.languageVariant.schedule.publishTime ?? undefined,
                            publish_display_timezone: version.languageVariant.schedule.publishDisplayTimezone ?? undefined,
                            unpublish_display_timezone: version.languageVariant.schedule.unpublishDisplayTimezone ?? undefined,
                            unpublish_time: version.languageVariant.schedule.unpublishTime ?? undefined
                        },
                        workflow_step: {
                            codename: version.workflowStepCodename
                        }
                    };
                })
            };
    
            return migrationItem;
        } catch (error) {
            logger.log({
                type: 'mapError',
                message: `Failed to map item '${chalk.yellow(exportItem.contentItem.name)}': '${chalk.red(exportItem.contentItem.codename)}'. ${error as string}`,
                itemName: exportItem.contentItem.name,
                itemCodename: exportItem.contentItem.codename
            });

            return null;
        } finally {
            config.onItem(null)
        }
    };

    const mapToMigrationComponent = (
        context: ExportContext,
        component: Readonly<ElementModels.ContentItemElementComponent>,
        contentItem: Readonly<ContentItemModels.ContentItem>,
        language: string
    ): MigrationComponent => {
        const componentType = context.environmentData.contentTypes.find((m) => m.contentTypeId === component.type.id);

        if (!componentType) {
            throw Error(`Could not find content type with id '${chalk.red(component.type.id)}' for component '${chalk.red(component.id)}'`);
        }

        const migrationItem: MigrationComponent = {
            system: {
                id: component.id,
                type: {
                    codename: componentType.contentTypeCodename
                }
            },
            elements: getMigrationElements(context, componentType, component.elements, contentItem, language)
        };

        return migrationItem;
    };

    const getMigrationElements = (
        context: ExportContext,
        contentType: FlattenedContentType,
        elements: readonly Readonly<ElementModels.ContentItemElement>[],
        contentItem: Readonly<ContentItemModels.ContentItem>,
        language: string
    ): MigrationElements => {
        return contentType.elements
            .toSorted((a, b) => {
                if (a.codename < b.codename) {
                    return -1;
                }
                if (a.codename > b.codename) {
                    return 1;
                }
                return 0;
            })
            .reduce<Writeable<MigrationElements>>((model, typeElement) => {
                config.onElement(typeElement);

                const itemElement = findRequired(
                    elements,
                    (m) => m.element.id === typeElement.id,
                    `Could not find element '${chalk.red(typeElement.codename)}'`
                );

                model[typeElement.codename] = {
                    type: typeElement.type,
                    ...getMigrationElementToStore({
                        context: context,
                        contentType: contentType,
                        exportElement: itemElement,
                        typeElement: typeElement,
                        contentItem,
                        language
                    })
                };

                config.onElement(null);

                return model;
            }, {});
    };

    const getMigrationElementToStore = (data: {
        readonly context: ExportContext;
        readonly contentType: FlattenedContentType;
        readonly typeElement: FlattenedContentTypeElement;
        readonly exportElement: ElementModels.ContentItemElement;
        readonly contentItem: ContentItemModels.ContentItem;
        readonly language: string;
    }): MigrationElementTransformData => {
        try {
            return exportTransforms[data.typeElement.type]({
                context: data.context,
                typeElement: data.typeElement,
                contentItem: data.contentItem,
                language: data.language,
                logger,
                exportElement: {
                    components: data.exportElement.components.map((component) => mapToMigrationComponent(data.context, component, data.contentItem, data.language)),
                    value: data.exportElement.value,
                    urlSlugMode: data.exportElement.mode,
                    displayTimezone: data.exportElement.display_timezone
                }
            });
        } catch (error) {
            const errorData = extractErrorData(error);
            let jsonValue = 'n/a';

            try {
                jsonValue = JSON.stringify(data.exportElement.value);
            } catch (jsonError) {
                console.error(`Failed to convert json value`, jsonError);
            }

            throw new Error(
                `Failed to map value of element '${chalk.yellow(data.typeElement.codename)}' of type '${chalk.cyan(
                    data.typeElement.type
                )}'. Value: ${chalk.bgMagenta(jsonValue)}. Message: ${errorData.message}`
            );
        }
    };

    const exportAssetsAsync = async (context: ExportContext): Promise<readonly Readonly<MigrationAsset>[]> => {
        const assets = Array.from(context.referencedData.assetIds)
            .map<Readonly<AssetModels.Asset> | undefined>((assetId) => context.getAssetStateInSourceEnvironment(assetId).asset)
            .filter(isNotUndefined);

        return await getMigrationAssetsWithBinaryDataAsync(assets, context);
    };

    const getMigrationAssetsWithBinaryDataAsync = async (
        assets: readonly Readonly<AssetModels.Asset>[],
        context: ExportContext
    ): Promise<readonly MigrationAsset[]> => {
        logger.log({
            type: 'info',
            message: `Preparing to download '${chalk.yellow(assets.length.toString())}' assets`
        });

        return (
            await processItemsAsync<Readonly<AssetModels.Asset>, MigrationAsset>({
                action: 'Downloading assets',
                logger: logger,
                parallelLimit: 5,
                itemInfo: (input) => {
                    return {
                        title: input.codename,
                        itemType: 'asset'
                    };
                },
                items: assets,
                processAsync: async (asset, logSpinner) => {
                    config.onAction(`processing-asset`);
                    config.onAsset(asset);

                    const assetCollection: Readonly<CollectionModels.Collection> | undefined = context.environmentData.collections.find(
                        (m) => m.id === asset.collection?.reference?.id
                    );
                    const assetFolder: Readonly<AssetFolderModels.AssetFolder> | undefined = context.environmentData.assetFolders.find(
                        (m) => m.id === asset.folder?.id
                    );

                    logSpinner({
                        type: 'download',
                        message: `${asset.url}`
                    });

                    const migrationAsset: MigrationAsset = {
                        filename: asset.fileName,
                        title: asset.title ?? '',
                        codename: asset.codename,
                        binary_data: (await getBinaryDataFromUrlAsync(asset.url)).data,
                        collection: assetCollection ? { codename: assetCollection.codename } : undefined,
                        folder: assetFolder ? { codename: assetFolder.codename } : undefined,
                        descriptions: asset.descriptions.map((description) => {
                            const language = findRequired(
                                context.environmentData.languages,
                                (language) => language.id === description.language.id,
                                `Could not find language with id '${chalk.red(description.language.id)}' requested by asset '${chalk.red(
                                    asset.codename
                                )}'`
                            );

                            return {
                                description: description.description ?? undefined,
                                language: {
                                    codename: language.codename
                                }
                            };
                        })
                    };

                    return migrationAsset;
                }
            })
        )
            .filter((m) => m.state === 'valid')
            .map((m) => m.outputItem);
    };

    return {
        async exportAsync(): Promise<MigrationData> {
            const exportContext = await (
                await exportContextFetcherAsync({
                    exportItems: config.exportItems,
                    logger: logger,
                    managementClient: managementClient
                })
            ).getExportContextAsync();
            
            const migrationData: MigrationData = {
                items: MigrationItemsSchema.parse(getMigrationItems(exportContext)),
                assets: MigrationAssetsSchema.parse(await exportAssetsAsync(exportContext))
            };
            
            logger.log({
                type: 'completed',
                message: `Finished export`
            });

            config.onAction(null);

            return migrationData;
        }
    };
}
