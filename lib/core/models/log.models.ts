import { MigrationItemType, MapiAction, MapiType } from '../index.js';

type MigrationToolErrorType =
    | 'linkedItemsError'
    | 'mapError'
    | 'publishError'
    | 'processingError'
    | 'kontentDebug'

export type DebugType =
    | 'error'
    | 'completed'
    | 'warning'
    | 'info'
    | 'errorData'
    | 'cancel'
    | 'process'
    | 'readFs'
    | 'skip'
    | 'writeFs'
    | 'download'
    | MigrationToolErrorType
    | MigrationItemType
    | MapiType
    | MapiAction;

export interface LogMessage {
    readonly type: DebugType;
    readonly message: string;
    readonly itemName?: string;
    readonly itemCodename?: string;
    readonly languageCodename?: string;
    readonly data?: unknown;
}

export interface LogSpinnerMessage extends LogMessage {
    readonly prefix?: string;
}

export type LogData = (data: LogMessage) => void;
export type LogSpinnerData = (data: LogSpinnerMessage) => void;

export interface Logger {
    readonly logWithSpinnerAsync: <T>(func: (logData: LogSpinnerData) => Promise<T>) => Promise<T>;
    readonly log: LogData;
}
