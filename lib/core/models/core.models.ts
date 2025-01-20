import { AssetModels, ContentItemModels, ContentTypeElements, LanguageVariantModels, WorkflowModels } from '@kontent-ai/management-sdk';
import { MigrationElementType } from './migration.models.js';

export type LiteralUnion<T extends string> = T | (string & {});
export type TargetItemState = 'exists' | 'doesNotExists';
export type CliAction = 'export' | 'import' | 'migrate';
export type EnvContext = 'browser' | 'node';

export type MapiAction =
    | 'list'
    | 'view'
    | 'archive'
    | 'unpublish'
    | 'changeWorkflowStep'
    | 'publish'
    | 'upload'
    | 'create'
    | 'upsert'
    | 'schedulePublish'
    | 'scheduleUnpublish'
    | 'cancelScheduledPublish'
    | 'cancelScheduledUnpublish'
    | 'createNewVersion';

export type MigrationItemType = 'exportItem';

export type MapiType =
    | 'contentType'
    | 'assetFolder'
    | 'asset'
    | 'contentTypeSnippet'
    | 'contentItem'
    | 'languageVariant'
    | 'language'
    | 'collection'
    | 'taxonomy'
    | 'binaryFile'
    | 'workflow';

export type LanguageVariantWorkflowStateValues = 'published' | 'archived' | 'draft' | 'scheduled';
export type LanguageVariantSchedulesStateValues = 'scheduledPublish' | 'scheduledUnpublish' | 'n/a';
export type LanguageVariantWorkflowState =
    | {
          readonly workflowState: LanguageVariantWorkflowStateValues;
          readonly scheduledState: LanguageVariantSchedulesStateValues;
      }
    | undefined;

export interface ItemInfo {
    readonly title: string;
    readonly itemType: MapiType | MigrationItemType;
    readonly languageCodename?: string;
}

export interface ErrorData {
    readonly message: string;
    readonly requestData?: string;
    readonly requestUrl?: string;
    readonly isUnknownError: boolean;
    readonly error: unknown;
}

export interface ReferencedDataInMigrationItems {
    readonly itemCodenames: ReadonlySet<string>;
    readonly assetCodenames: ReadonlySet<string>;
}

export interface ReferencedDataInLanguageVariants {
    readonly itemIds: ReadonlySet<string>;
    readonly assetIds: ReadonlySet<string>;
}

export interface ItemStateInSourceEnvironmentById {
    readonly state: TargetItemState;
    readonly id: string;
    readonly item: Readonly<ContentItemModels.ContentItem> | undefined;
}

export interface AssetStateInSourceEnvironmentById {
    readonly state: TargetItemState;
    readonly id: string;
    readonly asset: Readonly<AssetModels.Asset> | undefined;
}

export interface ItemStateInTargetEnvironmentByCodename {
    readonly state: TargetItemState;
    readonly itemCodename: string;
    readonly item: Readonly<ContentItemModels.ContentItem> | undefined;
    readonly externalIdToUse: string;
}

export interface LanguageVariantStateData {
    readonly languageVariant: Readonly<LanguageVariantModels.ContentItemLanguageVariant> | undefined;
    readonly workflow: Readonly<WorkflowModels.Workflow> | undefined;
    readonly workflowState: LanguageVariantWorkflowState;
}

export interface LanguageVariantStateInTargetEnvironmentByCodename {
    readonly state: TargetItemState;
    readonly itemCodename: string;
    readonly languageCodename: string;
    readonly publishedLanguageVariant: LanguageVariantStateData | undefined;
    readonly draftLanguageVariant: LanguageVariantStateData | undefined;
}

export interface AssetStateInTargetEnvironmentByCodename {
    readonly state: TargetItemState;
    readonly assetCodename: string;
    readonly asset: Readonly<AssetModels.Asset> | undefined;
    readonly externalIdToUse: string;
}

export interface PackageMetadata {
    readonly created: Date;
    readonly environmentId: string;
    readonly dataOverview: PackageDataOverview;
}

export interface PackageDataOverview {
    readonly contentItemsCount: number;
    readonly assetsCount: number;
}

export interface FlattenedContentTypeElement {
    readonly codename: string;
    readonly id: string;
    readonly type: MigrationElementType;
    readonly element: Readonly<ContentTypeElements.ContentTypeElementModel>;
}

export interface FlattenedContentType {
    readonly contentTypeCodename: string;
    readonly contentTypeId: string;
    readonly elements: readonly FlattenedContentTypeElement[];
}

export interface OriginalManagementError {
    readonly response?: {
        readonly status?: number;
        readonly config?: {
            readonly url?: string;
            readonly data?: string;
        };
        readonly data?: {
            readonly error_code?: number;
        };
    };
}

export type ItemProcessingResult<InputItem, OutputItem> =
    | {
          readonly state: 'valid';
          readonly inputItem: InputItem;
          readonly outputItem: OutputItem;
      }
    | {
          readonly state: 'error';
          readonly inputItem: InputItem;
          readonly error: unknown;
      }
    | {
          readonly state: '404';
          readonly inputItem: InputItem;
      };
