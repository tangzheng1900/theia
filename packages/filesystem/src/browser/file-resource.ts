/********************************************************************************
 * Copyright (C) 2018 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import { injectable, inject } from 'inversify';
import { Resource, ResourceVersion, ResourceResolver, ResourceError, ResourceSaveOptions } from '@theia/core/lib/common/resource';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { Emitter, Event } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { FileOperation, FileOperationError, FileOperationResult } from '../common/files';
import { FileService, TextFileContent } from './file-service';

export interface FileResourceVersion extends ResourceVersion {
    readonly stat: TextFileContent
}
export namespace FileResourceVersion {
    export function is(version: ResourceVersion | undefined): version is FileResourceVersion {
        return !!version && ('mtime' in version || 'etag' in version);
    }
}

export class FileResource implements Resource {

    protected readonly toDispose = new DisposableCollection();
    protected readonly onDidChangeContentsEmitter = new Emitter<void>();
    readonly onDidChangeContents: Event<void> = this.onDidChangeContentsEmitter.event;

    protected _version: FileResourceVersion | undefined;
    get version(): FileResourceVersion | undefined {
        return this._version;
    }

    protected uriString: string;

    constructor(
        readonly uri: URI,
        protected readonly fileService: FileService
    ) {
        this.uriString = this.uri.toString();
        this.toDispose.push(this.onDidChangeContentsEmitter);
    }

    async init(): Promise<void> {
        const stat = await this.fileService.resolve(this.uri, { resolveMetadata: true });
        if (stat && stat.isDirectory) {
            throw new Error('The given uri is a directory: ' + this.uriString);
        }

        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            if (event.contains(this.uri)) {
                this.sync();
            }
        }));
        this.fileService.onDidRunOperation(e => {
            if ((e.isOperation(FileOperation.DELETE) || e.isOperation(FileOperation.MOVE)) && e.resource.isEqualOrParent(this.uri)) {
                this.sync();
            }
        });
        try {
            this.toDispose.push(this.fileService.watch(this.uri));
        } catch (e) {
            console.error(e);
        }
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    async readContents(options?: { encoding?: string }): Promise<string> {
        try {
            const etag = this._version?.stat.etag;
            const stat = await this.fileService.read(this.uri, { ...options, etag });
            this._version = { stat };
            return stat.value;
        } catch (e) {
            if (e instanceof FileOperationError && e.fileOperationResult === FileOperationResult.FILE_NOT_MODIFIED_SINCE) {
                return this._version?.stat.value || '';
            }
            if (e instanceof FileOperationError && e.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
                this._version = undefined;
                const { message, stack } = e;
                throw ResourceError.NotFound({
                    message, stack,
                    data: {
                        uri: this.uri
                    }
                });
            }
            throw e;
        }
    }

    async saveContents(content: string, options?: ResourceSaveOptions): Promise<void> {
        try {
            const version = options?.version || this._version;
            const current = FileResourceVersion.is(version) ? version.stat : undefined;
            const stat = await this.fileService.write(this.uri, content, {
                encoding: options?.encoding,
                overwriteEncoding: options?.overwriteEncoding,
                etag: current?.etag,
                mtime: current?.mtime
            });
            this._version = { stat };
        } catch (e) {
            if (e instanceof FileOperationError && e.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE) {
                const { message, stack } = e;
                throw ResourceError.OutOfSync({ message, stack, data: { uri: this.uri } });
            }
            throw e;
        }
    }

    // TODO encoding?
    // async guessEncoding(): Promise<string | undefined> {
    //     return this.fileService.guessEncoding(this.uriString);
    // }

    protected async sync(): Promise<void> {
        this.onDidChangeContentsEmitter.fire(undefined);
    }

}

@injectable()
export class FileResourceResolver implements ResourceResolver {

    @inject(FileService)
    protected readonly fileService: FileService;

    async resolve(uri: URI): Promise<FileResource> {
        if (this.fileService.canHandleResource(uri)) {
            throw new Error('The given uri is not supported: ' + uri);
        }
        const resource = new FileResource(uri, this.fileService);
        await resource.init();
        return resource;
    }

}
