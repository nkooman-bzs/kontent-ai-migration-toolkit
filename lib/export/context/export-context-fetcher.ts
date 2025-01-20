import {
    AssetModels,
    CollectionModels,
    ContentItemModels,
    LanguageModels,
    LanguageVariantModels,
    WorkflowModels
} from '@kontent-ai/management-sdk';
import chalk from 'chalk';
import {
    AssetStateInSourceEnvironmentById,
    extractErrorData,
    findRequired,
    FlattenedContentType,
    is404Error,
    ItemStateInSourceEnvironmentById,
    LogSpinnerData,
    managementClientUtils,
    processItemsAsync,
    runMapiRequestAsync,
    workflowHelper
} from '../../core/index.js';
import { itemsExtractionProcessor } from '../../translation/index.js';
import {
    DefaultExportContextConfig,
    ExportContext,
    ExportContextEnvironmentData,
    ExportItem,
    ExportItemVersion,
    GetFlattenedElementByIds,
    SourceExportItem
} from '../export.models.js';
import { throwErrorForItemRequest } from '../utils/export.utils.js';

export async function exportContextFetcherAsync(config: DefaultExportContextConfig) {
    const getEnvironmentDataAsync = async (): Promise<ExportContextEnvironmentData> => {
        const mapiUtils = managementClientUtils(config.managementClient, config.logger);

        return await config.logger.logWithSpinnerAsync(async (spinnerData) => {
            spinnerData({ type: 'info', message: `Loading environment data` });

            const environmentData: ExportContextEnvironmentData = {
                collections: await mapiUtils.getAllCollectionsAsync(spinnerData),
                contentTypes: await mapiUtils.getFlattenedContentTypesAsync(spinnerData),
                languages: await mapiUtils.getAllLanguagesAsync(spinnerData),
                workflows: await mapiUtils.getAllWorkflowsAsync(spinnerData),
                taxonomies: await mapiUtils.getAllTaxonomiesAsync(spinnerData),
                assetFolders: await mapiUtils.getAllAssetFoldersAsync(spinnerData)
            };

            spinnerData({ type: 'info', message: `Environmental data loaded` });

            return environmentData;
        });
    };

    const environmentData = await getEnvironmentDataAsync();

    const getContentItemAsync = async (
        sourceItem: SourceExportItem,
        logSpinner: LogSpinnerData
    ): Promise<Readonly<ContentItemModels.ContentItem>> => {
        return await runMapiRequestAsync({
            logger: config.logger,
            logSpinner: logSpinner,
            func: async () => {
                return (await config.managementClient.viewContentItem().byItemCodename(sourceItem.itemCodename).toPromise()).data;
            },
            action: 'view',
            type: 'contentItem',
            itemName: `codename -> ${sourceItem.itemCodename}`
        });
    };

    const getLatestLanguageVariantAsync = async (
        sourceItem: SourceExportItem,
        logSpinner: LogSpinnerData
    ): Promise<Readonly<LanguageVariantModels.ContentItemLanguageVariant>> => {
        return await runMapiRequestAsync({
            logger: config.logger,
            logSpinner: logSpinner,
            func: async () => {
                return (
                    await config.managementClient
                        .viewLanguageVariant()
                        .byItemCodename(sourceItem.itemCodename)
                        .byLanguageCodename(sourceItem.languageCodename)
                        .toPromise()
                ).data;
            },

            action: 'view',
            type: 'languageVariant',
            itemName: `codename -> ${sourceItem.itemCodename} -> latest (${sourceItem.languageCodename})`
        });
    };

    const isLanguageVariantPublished = (languageVariant: Readonly<LanguageVariantModels.ContentItemLanguageVariant>): boolean => {
        return environmentData.workflows.find((workflow) => workflow.publishedStep.id === languageVariant.workflow.stepIdentifier.id)
            ? true
            : false;
    };

    const mapToExportVersionItem = (
        sourceItem: SourceExportItem,
        contentItem: Readonly<ContentItemModels.ContentItem>,
        languageVariant: Readonly<LanguageVariantModels.ContentItemLanguageVariant>
    ): ExportItemVersion => {
        return {
            languageVariant: languageVariant,
            workflowStepCodename: validateExportItem({
                sourceItem: sourceItem,
                contentItem: contentItem,
                languageVariant: languageVariant
            }).workflowStepCodename
        };
    };

    const getExportItemVersionsAsync = async (
        sourceItem: SourceExportItem,
        contentItem: Readonly<ContentItemModels.ContentItem>,
        logSpinner: LogSpinnerData
    ): Promise<readonly ExportItemVersion[]> => {
        const latestLanguageVariant = await getLatestLanguageVariantAsync(sourceItem, logSpinner);
        const latestExportVersion = mapToExportVersionItem(sourceItem, contentItem, latestLanguageVariant);

        if (isLanguageVariantPublished(latestLanguageVariant)) {
            // latest language variant is also published = no need to fetch published version
            return [latestExportVersion];
        }

        const publishedLanguageVariant = await getPublishedLanguageVariantAsync(sourceItem, logSpinner);

        if (!publishedLanguageVariant) {
            return [latestExportVersion];
        }

        return [latestExportVersion, mapToExportVersionItem(sourceItem, contentItem, publishedLanguageVariant)];
    };

    const getPublishedLanguageVariantAsync = async (
        sourceItem: SourceExportItem,
        logSpinner: LogSpinnerData
    ): Promise<Readonly<LanguageVariantModels.ContentItemLanguageVariant> | undefined> => {
        return await runMapiRequestAsync({
            logger: config.logger,
            logSpinner: logSpinner,
            func: async () => {
                try {
                    return (
                        await config.managementClient
                            .viewLanguageVariant()
                            .byItemCodename(sourceItem.itemCodename)
                            .byLanguageCodename(sourceItem.languageCodename)
                            .published()
                            .toPromise()
                    ).data;
                } catch (error) {
                    if (is404Error(error)) {
                        return undefined;
                    }
                    throw error;
                }
            },
            action: 'view',
            type: 'languageVariant',
            itemName: `codename -> ${sourceItem.itemCodename} -> published (${sourceItem.languageCodename})`
        });
    };

    const validateExportItem = (data: {
        readonly sourceItem: SourceExportItem;
        readonly contentItem: Readonly<ContentItemModels.ContentItem>;
        readonly languageVariant: Readonly<LanguageVariantModels.ContentItemLanguageVariant>;
    }): {
        readonly collection: Readonly<CollectionModels.Collection>;
        readonly language: Readonly<LanguageModels.LanguageModel>;
        readonly workflow: Readonly<WorkflowModels.Workflow>;
        readonly contentType: Readonly<FlattenedContentType>;
        readonly workflowStepCodename: string;
    } => {
        const collection = findRequired(
            environmentData.collections,
            (collection) => collection.id === data.contentItem.collection.id,
            () => {
                throwErrorForItemRequest(data.sourceItem, `Invalid collection '${chalk.yellow(data.contentItem.collection.id ?? '')}'`);
            }
        );

        const contentType = findRequired(
            environmentData.contentTypes,
            (contentType) => contentType.contentTypeId === data.contentItem.type.id,
            () => {
                throwErrorForItemRequest(data.sourceItem, `Invalid content type '${chalk.red(data.contentItem.type.id)}'`);
            }
        );

        const language = findRequired(
            environmentData.languages,
            (language) => language.id === data.languageVariant.language.id,
            () => {
                throwErrorForItemRequest(data.sourceItem, `Invalid language '${chalk.red(data.languageVariant.language.id ?? '')}'`);
            }
        );

        const workflow = findRequired(
            environmentData.workflows,
            (workflow) => workflow.id === data.languageVariant.workflow.workflowIdentifier.id,
            () => {
                throwErrorForItemRequest(
                    data.sourceItem,
                    `Invalid workflow '${chalk.red(data.languageVariant.workflow.workflowIdentifier.id ?? '')}'`
                );
            }
        );

        const workflowStep = workflowHelper(environmentData.workflows).getWorkflowStep(workflow, {
            match: (step) => step.id === data.languageVariant.workflow.stepIdentifier.id,
            errorMessage: `Invalid workflow step '${chalk.red(data.languageVariant.workflow.stepIdentifier.id ?? '')}'`
        });

        return {
            collection,
            language,
            workflow,
            contentType,
            workflowStepCodename: workflowStep.codename
        };
    };

    const prepareExportItemsAsync = async (exportItems: readonly SourceExportItem[]): Promise<readonly ExportItem[]> => {
        config.logger.log({
            type: 'info',
            message: `Preparing '${chalk.yellow(config.exportItems.length.toString())}' items for export`
        });

        const processedItems = await processItemsAsync<SourceExportItem, ExportItem>({
            logger: config.logger,
            action: 'Preparing content items & language variants',
            parallelLimit: 1,
            itemInfo: (input) => {
                return {
                    title: `${input.itemCodename} (${input.languageCodename})`,
                    itemType: 'exportItem'
                };
            },
            items: exportItems,
            processAsync: async (requestItem, logSpinner) => {
                const contentItem = await getContentItemAsync(requestItem, logSpinner);
                const versions = await getExportItemVersionsAsync(requestItem, contentItem, logSpinner);

                // get shared attributes from any version
                const anyVersion = versions[0];
                if (!anyVersion) {
                    throwErrorForItemRequest(requestItem, `Expected at least 1 version of the content item`);
                }

                const { collection, contentType, language, workflow } = validateExportItem({
                    sourceItem: requestItem,
                    contentItem: contentItem,
                    languageVariant: anyVersion.languageVariant
                });

                return {
                    contentItem,
                    versions,
                    contentType,
                    requestItem,
                    workflow,
                    collection,
                    language
                };
            }
        });

        const failedItems = processedItems.filter((m) => m.state === 'error');

        const errors = failedItems.map((m) => [
            `Codename: ${chalk.yellow(m.inputItem.itemCodename)}`,
            `Language Codename: ${chalk.yellow(m.inputItem.languageCodename)}`,
            `${chalk.red(extractErrorData(m.error).message)}`
        ])

        errors.forEach((error, index) => {
            config.logger.log({ message: `${chalk.red(`\nError #${index + 1}`)}` });
            error.forEach((m) => {
                config.logger.log({ message: m });
            });
        });

        return processedItems
            .filter((m) => m.state === 'valid')
            .map((m) => m.outputItem);
    };

    const getContentItemsByIdsAsync = async (itemIds: ReadonlySet<string>): Promise<readonly Readonly<ContentItemModels.ContentItem>[]> => {
        return (
            await processItemsAsync<string, Readonly<ContentItemModels.ContentItem>>({
                logger: config.logger,
                action: 'Fetching content items',
                parallelLimit: 1,
                items: Array.from(itemIds),
                itemInfo: (id) => {
                    return {
                        itemType: 'contentItem',
                        title: id
                    };
                },
                processAsync: async (id, logSpinner) => {
                    try {
                        return await runMapiRequestAsync({
                            logSpinner: logSpinner,
                            logger: config.logger,
                            func: async () => (await config.managementClient.viewContentItem().byItemId(id).toPromise()).data,
                            action: 'view',
                            type: 'contentItem',
                            itemName: `id -> ${id}`
                        });
                    } catch (error) {
                        if (!is404Error(error)) {
                            throw error;
                        }

                        return '404';
                    }
                }
            })
        )
            .filter((m) => m.state === 'valid')
            .map((m) => m.outputItem);
    };

    const getAssetsByIdsAsync = async (itemIds: ReadonlySet<string>): Promise<readonly Readonly<AssetModels.Asset>[]> => {
        return (
            await processItemsAsync<string, Readonly<AssetModels.Asset>>({
                logger: config.logger,
                action: 'Fetching assets',
                parallelLimit: 1,
                items: Array.from(itemIds),
                itemInfo: (id) => {
                    return {
                        itemType: 'asset',
                        title: id
                    };
                },
                processAsync: async (id, logSpinner) => {
                    try {
                        return await runMapiRequestAsync({
                            logger: config.logger,
                            logSpinner: logSpinner,
                            func: async () => (await config.managementClient.viewAsset().byAssetId(id).toPromise()).data,
                            action: 'view',
                            type: 'asset',
                            itemName: `id -> ${id}`
                        });
                    } catch (error) {
                        if (!is404Error(error)) {
                            throw error;
                        }

                        return '404';
                    }
                }
            })
        )
            .filter((m) => m.state === 'valid')
            .map((m) => m.outputItem);
    };

    const getItemStatesAsync = async (itemIds: ReadonlySet<string>): Promise<readonly ItemStateInSourceEnvironmentById[]> => {
        const items = await getContentItemsByIdsAsync(itemIds);

        return Array.from(itemIds).map<ItemStateInSourceEnvironmentById>((itemId) => {
            const item = items.find((m) => m.id === itemId);
            return {
                id: itemId,
                item: item,
                state: item ? 'exists' : 'doesNotExists'
            };
        });
    };

    const getAssetStatesAsync = async (assetIds: ReadonlySet<string>): Promise<readonly AssetStateInSourceEnvironmentById[]> => {
        const assets = await getAssetsByIdsAsync(assetIds);

        return Array.from(assetIds).map<AssetStateInSourceEnvironmentById>((assetId) => {
            const asset = assets.find((m) => m.id === assetId);
            return {
                id: assetId,
                asset: asset,
                state: asset ? 'exists' : 'doesNotExists'
            };
        });
    };

    const getElementByIds = (): GetFlattenedElementByIds => {
        const getFunc: GetFlattenedElementByIds = (contentTypeId: string, elementId: string) => {
            const contentType = findRequired(
                environmentData.contentTypes,
                (contentType) => contentType.contentTypeId === contentTypeId,
                `Could not find content type with id '${chalk.red(contentTypeId)}'`
            );

            const element = findRequired(
                contentType.elements,
                (element) => element.id === elementId,
                `Could not find element with id '${chalk.red(elementId)}' in content type '${chalk.red(contentType.contentTypeCodename)}'`
            );

            return element;
        };

        return getFunc;
    };

    const getExportContextAsync = async (): Promise<ExportContext> => {
        const preparedItems = await prepareExportItemsAsync(config.exportItems);

        config.logger.log({
            type: 'info',
            message: `Extracting referenced items & assets from content`
        });

        const referencedData = itemsExtractionProcessor().extractReferencedDataFromExtractItems(
            preparedItems.map((exportItem) => {
                return {
                    contentTypeId: exportItem.contentType.contentTypeId,
                    elements: exportItem.versions.flatMap((m) => m.languageVariant).flatMap((s) => s.elements)
                };
            }),
            getElementByIds()
        );

        const itemStates: readonly ItemStateInSourceEnvironmentById[] = await getItemStatesAsync(
            // fetch both referenced items and items that are set to be exported
            new Set<string>([...referencedData.itemIds, ...preparedItems.map((m) => m.contentItem.id)])
        );
        const assetStates: readonly AssetStateInSourceEnvironmentById[] = await getAssetStatesAsync(
            new Set<string>([...referencedData.assetIds])
        );

        const exportContext: ExportContext = {
            getElement: getElementByIds(),
            exportItems: preparedItems,
            environmentData: environmentData,
            referencedData: referencedData,
            getAssetStateInSourceEnvironment: (id) =>
                findRequired(
                    assetStates,
                    (m) => m.id === id,
                    `Invalid state for asset '${chalk.red(id)}'. It is expected that all asset states will be initialized`
                ),
            getItemStateInSourceEnvironment: (id) =>
                findRequired(
                    itemStates,
                    (m) => m.id === id,
                    `Invalid state for item '${chalk.red(id)}'. It is expected that all item states will be initialized`
                )
        };

        return exportContext;
    };

    return {
        getExportContextAsync
    };
}
