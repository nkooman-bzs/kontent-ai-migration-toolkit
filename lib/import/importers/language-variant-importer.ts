import { ElementContracts, LanguageVariantModels, ManagementClient, WorkflowModels } from '@kontent-ai/management-sdk';
import chalk from 'chalk';
import { match } from 'ts-pattern';
import {
    findRequired,
    isNotUndefined,
    LanguageVariantSchedulesStateValues,
    LanguageVariantStateInTargetEnvironmentByCodename,
    Logger,
    LogSpinnerData,
    MigrationElement,
    MigrationItem,
    MigrationItemVersion,
    processItemsAsync,
    runMapiRequestAsync,
    workflowHelper
} from '../../core/index.js';
import { importTransforms } from '../../translation/index.js';
import { ImportContext, ImportedItem, ImportedLanguageVariant } from '../import.models.js';
import { throwErrorForMigrationItem } from '../utils/import.utils.js';
import { workflowImporter as workflowImporterInit } from './workflow-importer.js';

export function languageVariantImporter(config: {
    readonly logger: Logger;
    readonly preparedContentItems: readonly ImportedItem[];
    readonly importContext: ImportContext;
    readonly client: Readonly<ManagementClient>;
}) {
    const workflowImporter = workflowImporterInit({
        logger: config.logger,
        managementClient: config.client,
        workflows: config.importContext.environmentData.workflows
    });

    const upsertLanguageVariantAsync = async (data: {
        readonly workflow: Readonly<WorkflowModels.Workflow>;
        readonly logSpinner: LogSpinnerData;
        readonly migrationItem: MigrationItem;
        readonly migrationItemVersion: MigrationItemVersion;
        readonly preparedContentItem: ImportedItem;
    }): Promise<Readonly<LanguageVariantModels.ContentItemLanguageVariant>> => {
        return await runMapiRequestAsync({
            logger: config.logger,
            func: async () => {
                const response = await config.client
                    .upsertLanguageVariant()
                    .byItemCodename(data.preparedContentItem.inputItem.system.codename)
                    .byLanguageCodename(data.migrationItem.system.language.codename)
                    .withData(() => {
                        return {
                            elements: Object.entries(data.migrationItemVersion.elements).map(([codename, migrationElement]) => {
                                return getElementContract(data.migrationItem, migrationElement, codename);
                            }),
                            workflow: {
                                workflow_identifier: {
                                    codename: data.workflow.codename
                                },
                                step_identifier: {
                                    codename: data.workflow.steps[0].codename // use always first step
                                }
                            }
                        };
                    })
                    .toPromise();
                 
                response.data.item.codename = data.preparedContentItem.inputItem.system.codename;
                response.data._raw.item.codename = data.preparedContentItem.inputItem.system.codename;
                response.data.language.codename = data.migrationItem.system.language.codename;

                return response.data;
            },
            action: 'upsert',
            type: 'languageVariant',
            logSpinner: data.logSpinner,
            itemName: `${data.migrationItem.system.codename} (${data.migrationItem.system.language.codename})`
        });
    };

    const categorizeVersions = (
        migrationItem: MigrationItem
    ): { publishedVersion: MigrationItemVersion | undefined; draftVersion: MigrationItemVersion | undefined } => {
        const workflow = workflowHelper(config.importContext.environmentData.workflows).getWorkflowByCodename(
            migrationItem.system.workflow.codename
        );

        const publishedVersions = migrationItem.versions.filter((version) =>
            isPublishedWorkflowStep(version.workflow_step.codename, workflow)
        );
        const draftVersions = migrationItem.versions.filter(
            (version) => !isPublishedWorkflowStep(version.workflow_step.codename, workflow)
        );

        if (publishedVersions.length > 1) {
            throwErrorForMigrationItem(
                migrationItem,
                `There can be only 1 published version. There are '${publishedVersions.length}' published versions for the item.`
            );
        }

        if (draftVersions.length > 1) {
            throwErrorForMigrationItem(
                migrationItem,
                `There can be only 1 draft version. There are '${draftVersions.length}' draft versions for the item.`
            );
        }

        return {
            draftVersion: draftVersions?.[0],
            publishedVersion: publishedVersions?.[0]
        };
    };

    const importVersionAsync = async (data: {
        readonly logSpinner: LogSpinnerData;
        readonly migrationItem: MigrationItem;
        readonly migrationItemVersion: MigrationItemVersion;
        readonly preparedContentItem: ImportedItem;
        readonly createNewVersion?: boolean;
    }): Promise<Readonly<LanguageVariantModels.ContentItemLanguageVariant>> => {
        // validate workflow
        const { step, workflow } = workflowHelper(config.importContext.environmentData.workflows).getWorkflowAndStepByCodenames({
            workflowCodename: data.migrationItem.system.workflow.codename,
            stepCodename: data.migrationItemVersion.workflow_step.codename
        });

        // create new version if necessary. This is needed when both draft & published version are imported
        if (data.createNewVersion) {
            await workflowImporter.createNewVersionOfLanguageVariantAsync({
                logSpinner: data.logSpinner,
                migrationItem: data.migrationItem
            });
        }
        // upsert language variant
        const languageVariant = await upsertLanguageVariantAsync({
            logSpinner: data.logSpinner,
            migrationItem: data.migrationItem,
            preparedContentItem: data.preparedContentItem,
            migrationItemVersion: data.migrationItemVersion,
            workflow
        });

        // set workflow accordingly (publish, move to workflow step, archive ...)
        await workflowImporter.setWorkflowOfLanguageVariantAsync({
            logSpinner: data.logSpinner,
            migrationItem: data.migrationItem,
            workflowCodename: workflow.codename,
            stepCodename: step.codename,
            migrationItemVersion: data.migrationItemVersion,
            languageVariant: languageVariant
        });

        // set scheduling
        await workflowImporter.setScheduledStateOfLanguageVariantAsync({
            logSpinner: data.logSpinner,
            migrationItem: data.migrationItem,
            migrationItemVersion: data.migrationItemVersion
        });

        return languageVariant;
    };

    const importLanguageVariantAsync = async (
        logSpinner: LogSpinnerData,
        migrationItem: MigrationItem,
        preparedContentItem: ImportedItem
    ): Promise<readonly LanguageVariantModels.ContentItemLanguageVariant[]> => {
        const { draftVersion, publishedVersion } = categorizeVersions(migrationItem);

        // get initial state of language variant from target env
        const targetVariantState = config.importContext.getLanguageVariantStateInTargetEnvironment(
            migrationItem.system.codename,
            migrationItem.system.language.codename
        );

        // prepare language variant for import (unpublish, create new version, un-schedule ...)
        await prepareTargetEnvironmentVariantForImportAsync({
            logSpinner,
            migrationItem,
            targetVariantState
        });

        // first import published version if it exists
        const publishedLanguageVariant: Readonly<LanguageVariantModels.ContentItemLanguageVariant> | undefined = publishedVersion
            ? await importVersionAsync({
                  logSpinner: logSpinner,
                  migrationItem: migrationItem,
                  preparedContentItem: preparedContentItem,
                  migrationItemVersion: publishedVersion
              })
            : undefined;

        // if target env contains published version & imported version not, unpublish it from the target env
        if (targetVariantState.publishedLanguageVariant && !publishedVersion) {
            await workflowImporter.unpublishLanguageVariantAsync({
                logSpinner,
                migrationItem
            });
            await workflowImporter.moveToDraftStepAsync({
                logSpinner,
                migrationItem
            });
        }
        const draftLanguageVariant: Readonly<LanguageVariantModels.ContentItemLanguageVariant> | undefined = draftVersion
            ? await importVersionAsync({
                  logSpinner: logSpinner,
                  migrationItem: migrationItem,
                  preparedContentItem: preparedContentItem,
                  migrationItemVersion: draftVersion,
                  createNewVersion: publishedLanguageVariant ? true : false
              })
            : undefined;

        return [publishedLanguageVariant, draftLanguageVariant].filter(isNotUndefined);
    };

    const cancelScheduledStateAsync = async (data: {
        readonly logSpinner: LogSpinnerData;
        readonly migrationItem: MigrationItem;
        readonly scheduledState: LanguageVariantSchedulesStateValues;
    }): Promise<void> => {
        const changeWorkflowData = {
            logSpinner: data.logSpinner,
            migrationItem: data.migrationItem
        };

        await match(data.scheduledState)
            .with('scheduledPublish', async () => {
                // cancel scheduled publish if language variant is scheduled to be published
                await workflowImporter.cancelScheduledPublishAsync(changeWorkflowData);
            })
            .with('scheduledUnpublish', async () => {
                // cancel scheduled unpublish if language variant is scheduled to be unpublished
                await workflowImporter.cancelScheduledUnpublishAsync(changeWorkflowData);
            })
            .otherwise(() => {});
    };

    const prepareTargetEnvironmentVariantForImportAsync = async (data: {
        readonly logSpinner: LogSpinnerData;
        readonly migrationItem: MigrationItem;
        readonly targetVariantState: LanguageVariantStateInTargetEnvironmentByCodename;
    }): Promise<void> => {
        if (!data.targetVariantState) {
            // no need to prepare language variant as it doesn't exist in target environment
            return;
        }

        // when language variant exists in target env, we need to prepare it for import by unscheduling, moving to draft etc...
        // we use draft language variant if it exists, otherwise we use published language variant
        const languageVariantToPrepare = data.targetVariantState.draftLanguageVariant ?? data.targetVariantState.publishedLanguageVariant;

        if (!languageVariantToPrepare) {
            return;
        }

        // there is likely a bug which causes /published endpoint to return invalid scheduled state
        // use conditions below to determine scheduled state to use - this will be fixed in future
        if (languageVariantToPrepare.workflowState?.scheduledState) {
            await cancelScheduledStateAsync({
                logSpinner: data.logSpinner,
                migrationItem: data.migrationItem,
                scheduledState: languageVariantToPrepare.workflowState.scheduledState
            });
        }

        const changeWorkflowData = {
            logSpinner: data.logSpinner,
            migrationItem: data.migrationItem
        };

        await match(languageVariantToPrepare.workflowState?.workflowState)
            .with('published', async () => {
                // create new version if language variant is published
                await workflowImporter.createNewVersionOfLanguageVariantAsync(changeWorkflowData);
            })
            .with('archived', async () => {
                // move to draft step if language variant is archived
                await workflowImporter.moveToDraftStepAsync(changeWorkflowData);
            })
            .otherwise(() => {});
    };

    const isPublishedWorkflowStep = (stepCodename: string, workflow: Readonly<WorkflowModels.Workflow>): boolean => {
        return workflow.publishedStep.codename === stepCodename;
    };

    const getElementContract = (
        migrationItem: MigrationItem,
        element: MigrationElement,
        elementCodename: string
    ): Readonly<ElementContracts.IContentItemElementContract> => {
        const importTransformResult = importTransforms[
            config.importContext.getElement(migrationItem.system.type.codename, elementCodename, element.type).type
        ]({
            elementCodename: elementCodename,
            importContext: config.importContext,
            migrationItems: config.importContext.categorizedImportData.contentItems,
            elementData: element
        });

        return importTransformResult;
    };

    const importAsync = async (): Promise<readonly ImportedLanguageVariant[]> => {
        config.logger.log({
            type: 'info',
            message: `Importing '${chalk.yellow(
                config.importContext.categorizedImportData.contentItems.length.toString()
            )}' language variants`
        });

        return await processItemsAsync<MigrationItem, readonly Readonly<LanguageVariantModels.ContentItemLanguageVariant>[]>({
            action: 'Importing language variants',
            logger: config.logger,
            parallelLimit: 1,
            items: config.importContext.categorizedImportData.contentItems,
            itemInfo: (input) => {
                return {
                    itemType: 'languageVariant',
                    title: input.system.name,
                    codename: input.system.codename,
                    partA: input.system.language.codename
                };
            },
            processAsync: async (migrationItem, logSpinner) => {
                const contentItem = findRequired(
                    config.preparedContentItems,
                    (item) => item.inputItem.system.codename === migrationItem.system.codename,
                    `Missing content item with codename '${chalk.red(
                        migrationItem.system.codename
                    )}'. Content item should have been prepepared.`
                );

                return await importLanguageVariantAsync(logSpinner, migrationItem, contentItem);
            }
        });
    };

    return {
        importAsync
    };
}
