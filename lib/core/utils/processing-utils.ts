import chalk from 'chalk';
import pLimit from 'p-limit';
import { ItemInfo, ItemProcessingResult } from '../models/core.models.js';
import { LogSpinnerData, Logger } from '../models/log.models.js';
import { extractErrorData } from './error.utils.js';

type ProcessSetAction =
    | 'Fetching assets'
    | 'Downloading assets'
    | 'Fetching content items'
    | 'Preparing content items & language variants'
    | 'Importing content items'
    | 'Importing language variants'
    | 'Fetching language variants'
    | 'Upserting assets'
    | 'Uploading assets';

export async function processItemsAsync<InputItem, OutputItem>(data: {
    readonly action: ProcessSetAction;
    readonly logger: Logger;
    readonly items: Readonly<InputItem[]>;
    readonly parallelLimit: number;
    readonly processAsync: (item: Readonly<InputItem>, logSpinner: LogSpinnerData) => Promise<Readonly<OutputItem> | '404'>;
    readonly itemInfo: (item: Readonly<InputItem>) => ItemInfo;
}): Promise<readonly ItemProcessingResult<InputItem, OutputItem>[]> {
    if (!data.items.length) {
        return [];
    }

    const firstItemInfo = data.itemInfo(data.items[0]);

    return await data.logger.logWithSpinnerAsync(async (logSpinner) => {
        const limit = pLimit(data.parallelLimit);
        let processedItemsCount: number = 1;

        const requests: Promise<ItemProcessingResult<InputItem, OutputItem>>[] = data.items.map((item) =>
            limit(() => {
                return data
                    .processAsync(item, logSpinner)
                    .then<OutputItem | '404'>((output) => {
                        const itemInfo = data.itemInfo(item);
                        const prefix = getPercentagePrefix(processedItemsCount, data.items.length);

                        logSpinner({
                            prefix: prefix,
                            message: itemInfo.title,
                            type: itemInfo.itemType
                        });
                        return output;
                    })
                    .then<ItemProcessingResult<InputItem, OutputItem>>((outputItem) => {
                        if (outputItem === '404') {
                            return {
                                state: '404',
                                inputItem: item
                            };
                        }

                        return {
                            inputItem: item,
                            outputItem: outputItem,
                            state: 'valid'
                        };
                    })
                    .catch<ItemProcessingResult<InputItem, OutputItem>>((error) => {
                        const errorData = extractErrorData(error);
                        const itemInfo = data.itemInfo(item);
                        const codename = 'codename' in itemInfo ? `(${itemInfo.codename as string})` : '';
                    
                        logSpinner({
                            type: 'processingError',
                            message: `Failed to process item: '${itemInfo.title}' ${codename}. Message: ${errorData.message}`,
                            itemCodename: 'codename' in itemInfo ? itemInfo.codename as string : undefined,
                            itemName: itemInfo.title,
                            languageCodename: itemInfo.languageCodename,
                            data: item
                        });
    
                        return {
                            state: 'error',
                            inputItem: item,
                            error: error
                        };
                    })
                    .finally(() => {
                        processedItemsCount++;
                    });
            })
        );

        // log processing of first item as progress is set after each item finishes
        logSpinner({
            prefix: getPercentagePrefix(0, data.items.length),
            message: firstItemInfo.title,
            type: firstItemInfo.itemType
        });

        // Only '<parallelLimit>' promises at a time
        const resultItems = await Promise.all(requests);

        const failedItemsCount = resultItems.filter((m) => m.state === 'error').length;
        const failedText = failedItemsCount ? ` Failed '${chalk.red(failedItemsCount)}' items` : ``;

        logSpinner({
            type: 'info',
            message: `Completed '${chalk.yellow(data.action)}'. Successfully processed '${chalk.green(
                resultItems.filter((m) => m.state === 'valid').length
            )}' items.${failedText}`
        });

        return resultItems;
    });
}

function getPercentagePrefix(processedItems: number, totalCount: number): string {
    return chalk.gray(`${Math.round((processedItems / totalCount) * 100)}%`);
}
