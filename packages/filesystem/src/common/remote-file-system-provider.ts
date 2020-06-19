/********************************************************************************
 * Copyright (C) 2020 TypeFox and others.
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
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { injectable, inject, postConstruct } from 'inversify';
import URI from '@theia/core/lib/common/uri';
import { Emitter } from '@theia/core/lib/common/event';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { TextBuffer } from './buffer';
import {
    FileWriteOptions, FileOpenOptions, FileChangeType,
    FileSystemProviderCapabilities, FileChange, Stat, FileOverwriteOptions, WatchOptions, FileType, FileSystemProvider, FileDeleteOptions,
    hasOpenReadWriteCloseCapability, hasFileFolderCopyCapability, hasReadWriteCapability, hasAccessCapability
} from './files';
import { JsonRpcServer, JsonRpcProxy } from '@theia/core/lib/common/messaging/proxy-factory';

export const remoteFileSystemPath = '/services/remote-filesystem';

export const RemoteFileSystemServer = Symbol('RemoteFileSystemServer');
export interface RemoteFileSystemServer extends JsonRpcServer<RemoteFileSystemClient> {
    getCapabilities(): Promise<FileSystemProviderCapabilities>
    stat(resource: string): Promise<Stat>;
    access(resource: string, mode?: number): Promise<void>;
    fsPath(resource: string): Promise<string>;
    open(resource: string, opts: FileOpenOptions): Promise<number>;
    close(fd: number): Promise<void>;
    read(fd: number, pos: number, length: number): Promise<{ bytes: Uint8Array; bytesRead: number; }>;
    readFile(resource: string): Promise<Uint8Array>;
    write(fd: number, pos: number, content: Uint8Array, offset: number, length: number): Promise<number>;
    writeFile(resource: string, content: Uint8Array, opts: FileWriteOptions): Promise<void>;
    delete(resource: string, opts: FileDeleteOptions): Promise<void>;
    mkdir(resource: string): Promise<void>;
    readdir(resource: string): Promise<[string, FileType][]>;
    rename(source: string, target: string, opts: FileOverwriteOptions): Promise<void>;
    copy(source: string, target: string, opts: FileOverwriteOptions): Promise<void>;
    watch(watcher: number, resource: string, opts: WatchOptions): Promise<void>;
    unwatch(watcher: number): Promise<void>;
}

export interface RemoteFileChange {
    readonly type: FileChangeType;
    readonly resource: string;
}

export interface RemoteFileSystemClient {
    notifyDidChangeFile(changes: RemoteFileChange[]): void;
    notifyDidChangeCapabilities(capabilities: FileSystemProviderCapabilities): void;
}

@injectable()
export class RemoteFileSystemProvider implements Required<FileSystemProvider>, Disposable {

    private readonly onDidChangeFileEmitter = new Emitter<readonly FileChange[]>();
    readonly onDidChangeFile = this.onDidChangeFileEmitter.event;

    private readonly onDidChangeCapabilitiesEmitter = new Emitter<void>();
    readonly onDidChangeCapabilities = this.onDidChangeCapabilitiesEmitter.event;

    protected readonly toDispose = new DisposableCollection(
        this.onDidChangeFileEmitter,
        this.onDidChangeCapabilitiesEmitter
    );

    protected watcherSequence = 0;
    protected readonly watchOptions = new Map<number, {
        uri: string;
        options: WatchOptions
    }>();

    private _capabilities: FileSystemProviderCapabilities;
    get capabilities(): FileSystemProviderCapabilities { return this._capabilities; }

    constructor(
        @inject(RemoteFileSystemServer)
        protected readonly server: JsonRpcProxy<RemoteFileSystemServer>
    ) {
        this._capabilities = FileSystemProviderCapabilities.FileReadWrite
            | FileSystemProviderCapabilities.FileOpenReadWriteClose
            | FileSystemProviderCapabilities.FileFolderCopy
            | FileSystemProviderCapabilities.Access;
        server.getCapabilities().then(capabilities => this.setCapabilities(capabilities));
        server.setClient({
            notifyDidChangeFile: changes => {
                this.onDidChangeFileEmitter.fire(changes.map(event => ({ resource: new URI(event.resource), type: event.type })));
            },
            notifyDidChangeCapabilities: capabilities => this.setCapabilities(capabilities)
        });
        const onInitialized = this.server.onDidOpenConnection(() => {
            // skip reconnection on the first connection
            onInitialized.dispose();
            this.toDispose.push(this.server.onDidOpenConnection(() => this.reconnect()));
        });
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    protected setCapabilities(capabilities: FileSystemProviderCapabilities): void {
        this._capabilities = capabilities;
        this.onDidChangeCapabilitiesEmitter.fire(undefined);
    }

    // --- forwarding calls

    stat(resource: URI): Promise<Stat> {
        return this.server.stat(resource.toString());
    }

    access(resource: URI, mode?: number): Promise<void> {
        return this.server.access(resource.toString(), mode);
    }

    fsPath(resource: URI): Promise<string> {
        return this.server.fsPath(resource.toString());
    }

    open(resource: URI, opts: FileOpenOptions): Promise<number> {
        return this.server.open(resource.toString(), opts);
    }

    close(fd: number): Promise<void> {
        return this.server.close(fd);
    }

    async read(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {
        const { bytes: buffer, bytesRead } = await this.server.read(fd, pos, length);

        // copy back the data that was written into the buffer on the remote
        // side. we need to do this because buffers are not referenced by
        // pointer, but only by value and as such cannot be directly written
        // to from the other process.
        data.set(buffer.slice(0, bytesRead), offset);

        return bytesRead;
    }

    async readFile(resource: URI): Promise<Uint8Array> {
        return this.server.readFile(resource.toString());
    }

    write(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {
        return this.server.write(fd, pos, data, offset, length);
    }

    writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void> {
        return this.server.writeFile(resource.toString(), content, opts);
    }

    delete(resource: URI, opts: FileDeleteOptions): Promise<void> {
        return this.server.delete(resource.toString(), opts);
    }

    mkdir(resource: URI): Promise<void> {
        return this.server.mkdir(resource.toString());
    }

    readdir(resource: URI): Promise<[string, FileType][]> {
        return this.server.readdir(resource.toString());
    }

    rename(resource: URI, target: URI, opts: FileOverwriteOptions): Promise<void> {
        return this.server.rename(resource.toString(), target.toString(), opts);
    }

    copy(resource: URI, target: URI, opts: FileOverwriteOptions): Promise<void> {
        return this.server.copy(resource.toString(), target.toString(), opts);
    }

    watch(resource: URI, opts: WatchOptions): Disposable {
        const watcher = this.watcherSequence++;
        this.server.watch(watcher, resource.toString(), opts);

        const toUnwatch = Disposable.create(() => {
            this.watchOptions.delete(watcher);
            this.server.unwatch(watcher);
        });
        this.toDispose.push(toUnwatch);
        return toUnwatch;
    }

    protected reconnect(): void {
        for (const [watcher, { uri, options }] of this.watchOptions.entries()) {
            this.server.watch(watcher, uri, options);
        }
    }

}

@injectable()
export class FileSystemProviderServer implements RemoteFileSystemServer {

    private readonly BUFFER_SIZE = 64 * 1024;

    protected readonly toDispose = new DisposableCollection();
    dispose(): void {
        this.toDispose.dispose();
    }

    protected client: RemoteFileSystemClient | undefined;
    setClient(client: RemoteFileSystemClient | undefined): void {
        this.client = client;
    }

    @inject(FileSystemProvider)
    protected readonly provider: FileSystemProvider & Partial<Disposable>;

    @postConstruct()
    protected init(): void {
        if (this.provider.dispose) {
            this.toDispose.push(Disposable.create(() => this.provider.dispose!()));
        }
        this.toDispose.push(this.provider.onDidChangeCapabilities(() => {
            if (this.client) {
                this.client.notifyDidChangeCapabilities(this.provider.capabilities);
            }
        }));
        this.toDispose.push(this.provider.onDidChangeFile(changes => {
            if (this.client) {
                this.client.notifyDidChangeFile(changes.map(({ resource, type }) => ({ resource: resource.toString(), type })));
            }
        }));
    }

    async getCapabilities(): Promise<FileSystemProviderCapabilities> {
        return this.provider.capabilities;
    }

    stat(resource: string): Promise<Stat> {
        return this.provider.stat(new URI(resource));
    }

    access(resource: string, mode?: number): Promise<void> {
        if (hasAccessCapability(this.provider)) {
            this.provider.access(new URI(resource), mode);
        }
        throw new Error('not supported');
    }

    async fsPath(resource: string): Promise<string> {
        if (hasAccessCapability(this.provider)) {
            this.provider.fsPath(new URI(resource));
        }
        throw new Error('not supported');
    }

    open(resource: string, opts: FileOpenOptions): Promise<number> {
        if (hasOpenReadWriteCloseCapability(this.provider)) {
            return this.provider.open(new URI(resource), opts);
        }
        throw new Error('not supported');
    }

    close(fd: number): Promise<void> {
        if (hasOpenReadWriteCloseCapability(this.provider)) {
            return this.provider.close(fd);
        }
        throw new Error('not supported');
    }

    async read(fd: number, pos: number, length: number): Promise<{ bytes: Uint8Array; bytesRead: number; }> {
        if (hasOpenReadWriteCloseCapability(this.provider)) {
            const buffer = TextBuffer.alloc(this.BUFFER_SIZE);
            const bytes = buffer.buffer;
            const bytesRead = await this.provider.read(fd, pos, bytes, 0, length);
            return { bytes, bytesRead };
        }
        throw new Error('not supported');
    }

    write(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {
        if (hasOpenReadWriteCloseCapability(this.provider)) {
            return this.provider.write(fd, pos, data, offset, length);
        }
        throw new Error('not supported');
    }

    readFile(resource: string): Promise<Uint8Array> {
        if (hasReadWriteCapability(this.provider)) {
            return this.provider.readFile(new URI(resource));
        }
        throw new Error('not supported');
    }

    writeFile(resource: string, data: Uint8Array, opts: FileWriteOptions): Promise<void> {
        if (hasReadWriteCapability(this.provider)) {
            return this.provider.writeFile(new URI(resource), data, opts);
        }
        throw new Error('not supported');
    }

    delete(resource: string, opts: FileDeleteOptions): Promise<void> {
        return this.provider.delete(new URI(resource), opts);
    }

    mkdir(resource: string): Promise<void> {
        return this.provider.mkdir(new URI(resource));
    }

    readdir(resource: string): Promise<[string, FileType][]> {
        return this.provider.readdir(new URI(resource));
    }

    rename(source: string, target: string, opts: FileOverwriteOptions): Promise<void> {
        return this.provider.rename(new URI(source), new URI(target), opts);
    }

    copy(source: string, target: string, opts: FileOverwriteOptions): Promise<void> {
        if (hasFileFolderCopyCapability(this.provider)) {
            return this.provider.copy(new URI(source), new URI(target), opts);
        }
        throw new Error('not supported');
    }

    protected watchers = new Map<number, Disposable>();

    async watch(req: number, resource: string, opts: WatchOptions): Promise<void> {
        const watcher = this.provider.watch(new URI(resource), opts);
        this.watchers.set(req, watcher);
        this.toDispose.push(Disposable.create(() => this.unwatch(req)));
    }

    async unwatch(req: number): Promise<void> {
        const watcher = this.watchers.get(req);
        if (watcher) {
            this.watchers.delete(req);
            watcher.dispose();
        }
    }

}