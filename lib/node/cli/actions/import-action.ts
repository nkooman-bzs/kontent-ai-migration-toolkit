import { confirmImportAsync, getDefaultFilename, getDefaultLogAsync } from '../../../core/index.js';
import { extractAsync, importAsync } from '../../../toolkit/index.js';
import { CliArgs } from '../args/cli-args.class.js';

export async function importActionAsync(cliArgs: CliArgs): Promise<void> {
    const log = await getDefaultLogAsync();

    const environmentId = await cliArgs.getRequiredArgumentValueAsync('targetEnvironmentId');
    const apiKey = await cliArgs.getRequiredArgumentValueAsync('targetApiKey');
    const baseUrl = await cliArgs.getOptionalArgumentValueAsync('baseUrl');
    const force = await cliArgs.getBooleanArgumentValueAsync('force', false);
    const skipFailedItems = await cliArgs.getBooleanArgumentValueAsync('skipFailedItems', false);
    const itemsFilename = (await cliArgs.getOptionalArgumentValueAsync('itemsFilename')) ?? getDefaultFilename('items');
    const assetsFilename =
        (await cliArgs.getOptionalArgumentValueAsync('assetsFilename')) ?? getDefaultFilename('assets');

    await confirmImportAsync({
        force: force,
        apiKey: apiKey,
        environmentId: environmentId,
        log: log
    });

    const importData = await extractAsync({
        log: log,
        zipContext: 'node.js',
        files: {
            items: {
                filename: itemsFilename,
                format: 'json'
            },
            assets: {
                filename: assetsFilename,
                format: 'json'
            }
        }
    });

    await importAsync({
        log: log,
        data: importData,
        adapterConfig: {
            skipFailedItems: skipFailedItems,
            baseUrl: baseUrl,
            environmentId: environmentId,
            apiKey: apiKey,
            canImport: {
                contentItem: (item) => {
                    return true;
                },
                asset: (asset) => {
                    return true;
                }
            }
        }
    });

    log.default({ type: 'completed', message: `Import has been successful` });
}
