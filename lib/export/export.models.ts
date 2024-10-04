import {
    Logger,
    FlattenedContentType,
    AssetStateInSourceEnvironmentById,
    FlattenedContentTypeElement,
    ItemStateInSourceEnvironmentById,
    ReferencedDataInLanguageVariants,
    MigrationElementValue,
    MigrationComponent,
    MigrationUrlSlugMode,
    ManagementClientConfig
} from '../core/index.js';
import {
    LanguageVariantModels,
    ContentItemModels,
    WorkflowModels,
    CollectionModels,
    LanguageModels,
    TaxonomyModels,
    ManagementClient,
    SharedModels,
    AssetFolderModels
} from '@kontent-ai/management-sdk';

export interface ExportContextEnvironmentData {
    readonly languages: readonly Readonly<LanguageModels.LanguageModel>[];
    readonly contentTypes: readonly Readonly<FlattenedContentType>[];
    readonly collections: readonly Readonly<CollectionModels.Collection>[];
    readonly assetFolders: readonly Readonly<AssetFolderModels.AssetFolder>[];
    readonly workflows: readonly Readonly<WorkflowModels.Workflow>[];
    readonly taxonomies: readonly Readonly<TaxonomyModels.Taxonomy>[];
}

export type ExportElementValue = string | number | SharedModels.ReferenceObject[] | undefined;

export interface ExportElement {
    readonly value: ExportElementValue;
    readonly components: readonly MigrationComponent[];
    readonly urlSlugMode: MigrationUrlSlugMode | undefined;
}

export type ExportTransformFunc = (data: {
    readonly typeElement: FlattenedContentTypeElement;
    readonly exportElement: ExportElement;
    readonly context: ExportContext;
    readonly skipMissingLinkedItems?: boolean;
}) => MigrationElementValue;

export interface ExportContext {
    readonly environmentData: ExportContextEnvironmentData;
    readonly referencedData: ReferencedDataInLanguageVariants;
    readonly getItemStateInSourceEnvironment: (id: string) => ItemStateInSourceEnvironmentById;
    readonly getAssetStateInSourceEnvironment: (id: string) => AssetStateInSourceEnvironmentById;
    readonly exportItems: readonly ExportItem[];
    readonly getElement: GetFlattenedElementByIds;
}

export interface SourceExportItem {
    readonly itemCodename: string;
    readonly languageCodename: string;
}

export interface ExportConfig extends ManagementClientConfig {
    readonly exportItems: readonly SourceExportItem[];
    readonly logger?: Logger;
    readonly skipMissingLinkedItems?: boolean;
}

export interface DefaultExportContextConfig {
    readonly logger: Logger;
    readonly exportItems: readonly SourceExportItem[];
    readonly managementClient: Readonly<ManagementClient>;
}

export type GetFlattenedElementByIds = (contentTypeId: string, elementId: string) => FlattenedContentTypeElement;

export interface ExportItemVersion {
    readonly workflowStepCodename: string;
    readonly languageVariant: Readonly<LanguageVariantModels.ContentItemLanguageVariant>;
}

export interface ExportItem {
    readonly requestItem: SourceExportItem;
    readonly versions: readonly ExportItemVersion[];
    readonly contentItem: Readonly<ContentItemModels.ContentItem>;

    readonly collection: Readonly<CollectionModels.Collection>;
    readonly language: Readonly<LanguageModels.LanguageModel>;
    readonly workflow: Readonly<WorkflowModels.Workflow>;
    readonly contentType: Readonly<FlattenedContentType>;
}
