import chalk from 'chalk';
import pLimit from 'p-limit';
import { ItemInfo } from '../models/core.models.js';
import { LogSpinnerData, Logger } from '../models/log.models.js';
import { extractErrorData } from '../utils/error.utils.js';

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
    readonly processAsync: (item: Readonly<InputItem>, logSpinner: LogSpinnerData) => Promise<Readonly<OutputItem>>;
    readonly itemInfo: (item: Readonly<InputItem>) => ItemInfo;
    readonly failOnError?: boolean;
}): Promise<readonly OutputItem[]> {
    if (!data.items.length) {
        return [];
    }

    const firstItemInfo = data.itemInfo(data.items[0]);

    return await data.logger.logWithSpinnerAsync(async (logSpinner) => {
        const limit = pLimit(data.parallelLimit);
        let processedItemsCount: number = 1;

        const requests = data.items.map((item) =>
            limit(() => {
                return data.processAsync(item, logSpinner).then((output) => {
                    const itemInfo = data.itemInfo(item);
                    const prefix = getPercentagePrefix(processedItemsCount, data.items.length);

                    logSpinner({
                        prefix: prefix,
                        message: itemInfo.title,
                        type: itemInfo.itemType
                    });

                    processedItemsCount++;
                    return output;
                }).catch(error => {
                    if (data.failOnError ?? true) {
                        throw error;
                    }

                    const errorData = extractErrorData(error);
                    const itemInfo = data.itemInfo(item);

                    data.logger.log({
                        type: 'error',
                        message: `Failed to process item: '${itemInfo.title}'`
                    });
                    data.logger.log({
                        type: 'error',
                        message: errorData.message
                    })

                    return null;
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
        const outputItems: OutputItem[] = (await Promise.all(requests)).filter((item) => item !== null);

        logSpinner({ type: 'info', message: `Completed '${chalk.yellow(data.action)}' (${outputItems.length})` });

        return outputItems;
    });
}

function getPercentagePrefix(processedItems: number, totalCount: number): string {
    return chalk.gray(`${Math.round((processedItems / totalCount) * 100)}%`);
}
