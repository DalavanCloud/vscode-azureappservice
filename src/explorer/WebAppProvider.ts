/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebSiteManagementClient } from 'azure-arm-website';
import { Site, WebAppCollection } from 'azure-arm-website/lib/models';
import { workspace, WorkspaceConfiguration } from 'vscode';
import { createWebApp, SiteClient } from 'vscode-azureappservice';
import { addExtensionUserAgent, IActionContext, IAzureNode, IAzureTreeItem, IChildProvider, parseError, UserCancelledError } from 'vscode-azureextensionui';
import { configurationSettings, extensionPrefix } from '../constants';
import { InvalidWebAppTreeItem } from './InvalidWebAppTreeItem';
import { WebAppTreeItem } from './WebAppTreeItem';

export class WebAppProvider implements IChildProvider {
    public readonly childTypeLabel: string = 'Web App';

    private _nextLink: string | undefined;

    public hasMoreChildren(): boolean {
        return this._nextLink !== undefined;
    }

    public async loadMoreChildren(node: IAzureNode, clearCache: boolean): Promise<IAzureTreeItem[]> {
        if (clearCache) {
            this._nextLink = undefined;
        }

        const client: WebSiteManagementClient = new WebSiteManagementClient(node.credentials, node.subscriptionId, node.environment.resourceManagerEndpointUrl);
        addExtensionUserAgent(client);

        let webAppCollection: WebAppCollection;
        try {
            webAppCollection = this._nextLink === undefined ?
                await client.webApps.list() :
                await client.webApps.listNext(this._nextLink);
        } catch (error) {
            if (parseError(error).errorType.toLowerCase() === 'notfound') {
                // This error type means the 'Microsoft.Web' provider has not been registered in this subscription
                // In that case, we know there are no web apps, so we can return an empty array
                // (The provider will be registered automatically if the user creates a new web app)
                return [];
            } else {
                throw error;
            }
        }

        this._nextLink = webAppCollection.nextLink;

        const treeItems: IAzureTreeItem[] = [];
        await Promise.all(webAppCollection
            .map(async (s: Site) => {
                try {
                    const siteClient: SiteClient = new SiteClient(s, node);
                    if (!siteClient.isFunctionApp) {
                        treeItems.push(new WebAppTreeItem(siteClient));
                    }
                } catch (error) {
                    if (s.name) {
                        treeItems.push(new InvalidWebAppTreeItem(s.name, error));
                    }
                }
            }));
        return treeItems;
    }

    public async createChild(node: IAzureNode<IAzureTreeItem>, showCreatingNode: (label: string) => void, actionContext: IActionContext): Promise<IAzureTreeItem> {
        const workspaceConfig: WorkspaceConfiguration = workspace.getConfiguration(extensionPrefix);
        const advancedCreation: boolean | undefined = workspaceConfig.get(configurationSettings.advancedCreation);
        const newSite: Site | undefined = await createWebApp(actionContext, node, { advancedCreation }, showCreatingNode);
        if (newSite === undefined) {
            throw new UserCancelledError();
        } else {
            const siteClient: SiteClient = new SiteClient(newSite, node);
            return new WebAppTreeItem(siteClient);
        }
    }
}
