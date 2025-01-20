import { AssetModels, LanguageModels, ManagementClient, SharedContracts } from '@kontent-ai/management-sdk';
import chalk from 'chalk';
import mime from 'mime';
import {
    geSizeInBytes,
    isNotUndefined,
    Logger,
    LogSpinnerData,
    MigrationAsset,
    MigrationAssetDescription,
    MigrationReference,
    processItemsAsync,
    runMapiRequestAsync
} from '../../core/index.js';
import { shouldReplaceBinaryFile, shouldUpdateAsset } from '../comparers/asset-comparer.js';
import { AssetToEdit, EditedAsset, ImportContext, ImportedAsset, ImportResult } from '../import.models.js';

export function assetsImporter(data: {
    readonly logger: Logger;
    readonly client: Readonly<ManagementClient>;
    readonly importContext: ImportContext;
}) {
    const getAssetsToUpload = (): readonly MigrationAsset[] => {
        return data.importContext.categorizedImportData.assets
            .filter((asset) => {
                return data.importContext.getAssetStateInTargetEnvironment(asset.codename).state === 'doesNotExists';
            })
            .map((asset) => ({ ...asset, descriptions: asset.descriptions?.filter(filterInvalidLanguages) }));
    };

    const getAssetsToEdit = (): readonly AssetToEdit[] => {
        return data.importContext.categorizedImportData.assets
            .map<AssetToEdit | undefined>((migrationAsset) => {
                const assetState = data.importContext.getAssetStateInTargetEnvironment(migrationAsset.codename);

                if (!assetState.asset || assetState.state === 'doesNotExists') {
                    return undefined;
                }

                if (
                    !shouldUpdateAsset({
                        collections: data.importContext.environmentData.collections,
                        languages: data.importContext.environmentData.languages,
                        assetFolders: data.importContext.environmentData.assetFolders,
                        migrationAsset: migrationAsset,
                        targetAsset: assetState.asset
                    })
                ) {
                    return undefined;
                }

                return {
                    migrationAsset: {
                        ...migrationAsset,
                        descriptions: migrationAsset.descriptions?.filter(filterInvalidLanguages)
                    },
                    replaceBinaryFile: shouldReplaceBinaryFile({
                        migrationAsset: migrationAsset,
                        targetAsset: assetState.asset
                    }),
                    targetAsset: assetState.asset
                };
            })
            .filter(isNotUndefined);
    };

    const editAssets = async (assetsToEdit: readonly AssetToEdit[]): Promise<readonly EditedAsset[]> => {
        data.logger.log({
            type: 'upsert',
            message: `Upserting '${chalk.yellow(assetsToEdit.length.toString())}' assets`
        });

        return await processItemsAsync<AssetToEdit, Readonly<AssetModels.Asset>>({
            action: 'Upserting assets',
            logger: data.logger,
            parallelLimit: 1,
            items: assetsToEdit,
            itemInfo: (input) => {
                return {
                    itemType: 'asset',
                    title: input.migrationAsset.title
                };
            },
            processAsync: async (assetEditRequest, logSpinner) => {
                let uploadedBinaryFile: Readonly<AssetModels.AssetFileReference> | undefined;

                if (assetEditRequest.replaceBinaryFile) {
                    uploadedBinaryFile = await uploadBinaryFileAsync(assetEditRequest.migrationAsset, logSpinner);
                }

                return await runMapiRequestAsync({
                    logger: data.logger,
                    func: async () => {
                        return (
                            await data.client
                                .upsertAsset()
                                .byAssetCodename(assetEditRequest.migrationAsset.codename)
                                .withData(() => {
                                    return {
                                        title: assetEditRequest.migrationAsset.title,
                                        descriptions: mapAssetDescriptions(assetEditRequest.migrationAsset.descriptions),
                                        collection: mapAssetCollection(assetEditRequest.migrationAsset.collection),
                                        file_reference: uploadedBinaryFile ?? undefined,
                                        folder: mapAssetFolder(assetEditRequest.migrationAsset.folder)
                                    };
                                })
                                .toPromise()
                        ).data;
                    },
                    action: 'upsert',
                    type: 'asset',
                    logSpinner: logSpinner,
                    itemName: `${assetEditRequest.migrationAsset.title ?? assetEditRequest.migrationAsset.filename}`
                });
            }
        });
    };

    const filterInvalidLanguages = (description: MigrationAssetDescription): Readonly<LanguageModels.LanguageModel> | undefined => {
        return data.importContext.environmentData.languages.find((lang) => lang.codename === description.language.codename);
    };

    const mapAssetCollection = (
        migrationCollection: MigrationReference | undefined
    ): Readonly<AssetModels.IAssetCollectionReferenceObject> | undefined => {
        return migrationCollection
            ? {
                  reference: {
                      codename: migrationCollection.codename
                  }
              }
            : undefined;
    };

    const mapAssetFolder = (
        migrationFolder: MigrationReference | undefined
    ): Readonly<SharedContracts.IReferenceObjectContract> | undefined => {
        return migrationFolder
            ? {
                  codename: migrationFolder.codename
              }
            : undefined;
    };

    const mapAssetDescriptions = (
        migrationDescription: readonly MigrationAssetDescription[] | undefined
    ): Readonly<AssetModels.IAssetFileDescription>[] => {
        return (migrationDescription ?? []).map((m) => {
            const assetDescription: Readonly<AssetModels.IAssetFileDescription> = {
                description: m.description ?? '',
                language: {
                    codename: m.language.codename
                }
            };

            return assetDescription;
        });
    };

    const uploadBinaryFileAsync = async (
        migrationAsset: MigrationAsset,
        logSpinner: LogSpinnerData
    ): Promise<Readonly<AssetModels.AssetFileReference>> => {
        return await runMapiRequestAsync({
            logger: data.logger,
            func: async () => {
                const contentType = mime.getType(migrationAsset.filename);

                if (!contentType) {
                    throw new Error(`Could not determine content type for file '${migrationAsset.filename}'`);
                }

                return (
                    await data.client
                        .uploadBinaryFile()
                        .withData({
                            binaryData: migrationAsset.binary_data,
                            contentLength: geSizeInBytes(migrationAsset.binary_data),
                            contentType: contentType,
                            filename: migrationAsset.filename
                        })
                        .toPromise()
                ).data;
            },
            action: 'upload',
            type: 'binaryFile',
            logSpinner: logSpinner,
            itemName: `${migrationAsset.title ?? migrationAsset.filename}`
        });
    };

    const uploadAssetsAsync = async (assetsToUpload: readonly MigrationAsset[]): Promise<readonly ImportedAsset[]> => {
        data.logger.log({
            type: 'upload',
            message: `Uploading '${chalk.yellow(assetsToUpload.length.toString())}' assets`
        });

        return await processItemsAsync<MigrationAsset, Readonly<AssetModels.Asset>>({
            action: 'Uploading assets',
            logger: data.logger,
            parallelLimit: 3,
            items: assetsToUpload,
            itemInfo: (input) => {
                return {
                    itemType: 'asset',
                    title: input.title
                };
            },
            processAsync: async (migrationAsset, logSpinner) => {
                const uploadedBinaryFile = await uploadBinaryFileAsync(migrationAsset, logSpinner);

                return await runMapiRequestAsync({
                    logger: data.logger,
                    func: async () =>
                        (
                            await data.client
                                .addAsset()
                                .withData(() => {
                                    const assetStateInTargetEnv = data.importContext.getAssetStateInTargetEnvironment(
                                        migrationAsset.codename
                                    );

                                    const assetRequestData: Readonly<AssetModels.IAddAssetRequestData> = {
                                        file_reference: uploadedBinaryFile,
                                        codename: migrationAsset.codename,
                                        title: migrationAsset.title,
                                        external_id: assetStateInTargetEnv.externalIdToUse,
                                        collection: mapAssetCollection(migrationAsset.collection),
                                        descriptions: mapAssetDescriptions(migrationAsset.descriptions),
                                        folder: mapAssetFolder(migrationAsset.folder)
                                    };
                                    return assetRequestData;
                                })
                                .toPromise()
                        ).data,
                    action: 'create',
                    type: 'asset',
                    logSpinner: logSpinner,
                    itemName: `${migrationAsset.title ?? migrationAsset.filename}`
                });
            }
        });
    };

    const importAsync = async (): Promise<Pick<ImportResult, 'editedAssets' | 'uploadedAssets'>> => {
        return {
            editedAssets: await editAssets(getAssetsToEdit()),
            uploadedAssets: await uploadAssetsAsync(getAssetsToUpload())
        };
    };

    return {
        importAsync
    };
}
