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

import * as iconv from 'iconv-lite';
import { Buffer } from 'safer-buffer';
import { injectable, inject } from 'inversify';
import URI from '@theia/core/lib/common/uri';
import { FileSystemPreferences } from './filesystem-preferences';
import { TextBuffer } from '../common/buffer';
import { FileService } from './file-service';

export const UTF8 = 'utf8';
export const UTF8_with_bom = 'utf8bom';
export const UTF16be = 'utf16be';
export const UTF16le = 'utf16le';

export const UTF16be_BOM = [0xFE, 0xFF];
export const UTF16le_BOM = [0xFF, 0xFE];
export const UTF8_BOM = [0xEF, 0xBB, 0xBF];

const ZERO_BYTE_DETECTION_BUFFER_MAX_LEN = 512; 	// number of bytes to look at to decide about a file being binary or not
const AUTO_ENCODING_GUESS_MAX_BYTES = 512 * 128; 	// set an upper limit for the number of bytes we pass on to jschardet

// we explicitly ignore a specific set of encodings from auto guessing
// - ASCII: we never want this encoding (most UTF-8 files would happily detect as
//          ASCII files and then you could not type non-ASCII characters anymore)
// - UTF-16: we have our own detection logic for UTF-16
// - UTF-32: we do not support this encoding in VSCode
const IGNORE_ENCODINGS = ['ascii', 'utf-16', 'utf-32'];

export interface ResourceEncoding {
    encoding: string
    hasBOM: boolean
}

export interface EncodingOverride {
    parent?: URI;
    extension?: string;
    encoding: string;
}

export interface ReadEncodingOptions {

    /**
     * The optional encoding parameter allows to specify the desired encoding when resolving
     * the contents of the file.
     */
    encoding?: string;

	/**
	 * The optional guessEncoding parameter allows to guess encoding from content of the file.
	 */
    autoGuessEncoding?: boolean;
}

export interface WriteEncodingOptions {

    /**
     * The encoding to use when updating a file.
     */
    encoding?: string;

	/**
	 * If set to true, will enforce the selected encoding and not perform any detection using BOMs.
	 */
    overwriteEncoding?: boolean;
}

export interface DetectedEncoding {
    encoding?: string
    seemsBinary?: boolean
}

@injectable()
export class EncodingService {

    // TODO support encoding overrides
    protected readonly encodingOverrides: EncodingOverride[] = [];

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(FileSystemPreferences)
    protected readonly preferences: FileSystemPreferences;

    encode(value: string, options?: ResourceEncoding): TextBuffer {
        let encoding = options?.encoding;
        const addBOM = options?.hasBOM;
        encoding = this.toIconvEncoding(encoding);
        if (encoding === UTF8 && !addBOM) {
            return TextBuffer.fromString(value);
        }
        const buffer = iconv.encode(value, encoding, { addBOM });
        return TextBuffer.wrap(buffer);
    }

    decode(value: TextBuffer, encoding?: string): string {
        const buffer = Buffer.from(value.buffer);
        encoding = this.toIconvEncoding(encoding);
        return iconv.decode(buffer, encoding);
    }

    async getWriteEncoding(resource: URI, options?: WriteEncodingOptions): Promise<ResourceEncoding> {
        const { encoding, hasBOM } = this.getPreferredWriteEncoding(resource, options ? options.encoding : undefined);

        // Some encodings come with a BOM automatically
        if (hasBOM) {
            return { encoding, hasBOM: true };
        }

        // Ensure that we preserve an existing BOM if found for UTF8
        // unless we are instructed to overwrite the encoding
        const overwriteEncoding = options?.overwriteEncoding;
        if (!overwriteEncoding && encoding === UTF8) {
            try {
                const buffer = (await this.fileService.readFile(resource, { length: UTF8_BOM.length })).value;
                if (this.detectEncodingByBOMFromBuffer(Buffer.from(buffer.buffer), buffer.byteLength) === UTF8_with_bom) {
                    return { encoding, hasBOM: true };
                }
            } catch (error) {
                // ignore - file might not exist
            }
        }

        return { encoding, hasBOM: false };
    }

    getPreferredWriteEncoding(resource: URI, preferredEncoding?: string): ResourceEncoding {
        const resourceEncoding = this.getEncodingForResource(resource, preferredEncoding);

        return {
            encoding: resourceEncoding,
            hasBOM: resourceEncoding === UTF16be || resourceEncoding === UTF16le || resourceEncoding === UTF8_with_bom // enforce BOM for certain encodings
        };
    }

    getReadEncoding(resource: URI, options?: ReadEncodingOptions, detectedEncoding?: string): string {
        let preferredEncoding: string | undefined;

        // Encoding passed in as option
        if (options?.encoding) {
            if (detectedEncoding === UTF8_with_bom && options.encoding === UTF8) {
                preferredEncoding = UTF8_with_bom; // indicate the file has BOM if we are to resolve with UTF 8
            } else {
                preferredEncoding = options.encoding; // give passed in encoding highest priority
            }
        } else if (detectedEncoding) {
            preferredEncoding = detectedEncoding;
        } else if (this.preferences.get('files.encoding', undefined, resource.toString()) === UTF8_with_bom) {
            preferredEncoding = UTF8; // if we did not detect UTF 8 BOM before, this can only be UTF 8 then
        }

        return this.getEncodingForResource(resource, preferredEncoding);
    }

    private getEncodingForResource(resource: URI, preferredEncoding?: string): string {
        let fileEncoding: string;

        const override = this.getEncodingOverride(resource);
        if (override) {
            fileEncoding = override; // encoding override always wins
        } else if (preferredEncoding) {
            fileEncoding = preferredEncoding; // preferred encoding comes second
        } else {
            fileEncoding = this.preferences.get('files.encoding', undefined, resource.toString());
        }

        if (!fileEncoding || !this.exists(fileEncoding)) {
            return UTF8; // the default is UTF 8
        }

        return this.toIconvEncoding(fileEncoding);
    }

    private getEncodingOverride(resource: URI): string | undefined {
        if (this.encodingOverrides && this.encodingOverrides.length) {
            for (const override of this.encodingOverrides) {

                // check if the resource is child of encoding override path
                if (override.parent && resource.isEqualOrParent(override.parent)) {
                    return override.encoding;
                }

                // check if the resource extension is equal to encoding override
                if (override.extension && resource.path.ext === `.${override.extension}`) {
                    return override.encoding;
                }
            }
        }

        return undefined;
    }

    protected exists(encoding: string): boolean {
        encoding = this.toIconvEncoding(encoding);
        return iconv.encodingExists(encoding);
    }

    protected toIconvEncoding(encoding?: string): string {
        if (encoding === UTF8_with_bom || !encoding) {
            return UTF8; // iconv does not distinguish UTF 8 with or without BOM, so we need to help it
        }
        return encoding;
    }

    protected detectEncodingByBOMFromBuffer(buffer: Buffer, bytesRead: number): typeof UTF8_with_bom | typeof UTF16le | typeof UTF16be | undefined {
        if (!buffer || bytesRead < UTF16be_BOM.length) {
            return undefined;
        }

        const b0 = buffer.readUInt8(0);
        const b1 = buffer.readUInt8(1);

        // UTF-16 BE
        if (b0 === UTF16be_BOM[0] && b1 === UTF16be_BOM[1]) {
            return UTF16be;
        }

        // UTF-16 LE
        if (b0 === UTF16le_BOM[0] && b1 === UTF16le_BOM[1]) {
            return UTF16le;
        }

        if (bytesRead < UTF8_BOM.length) {
            return undefined;
        }

        const b2 = buffer.readUInt8(2);

        // UTF-8
        if (b0 === UTF8_BOM[0] && b1 === UTF8_BOM[1] && b2 === UTF8_BOM[2]) {
            return UTF8_with_bom;
        }

        return undefined;
    }

    async detectEncoding(data: TextBuffer, options?: ReadEncodingOptions): Promise<DetectedEncoding> {
        const buffer = Buffer.from(data.buffer);
        const bytesRead = data.byteLength;
        // Always first check for BOM to find out abouÏt encoding
        let encoding = this.detectEncodingByBOMFromBuffer(buffer, bytesRead);

        // Detect 0 bytes to see if file is binary or UTF-16 LE/BEÏ
        // unless we already know that this file has a UTF-16 encoding
        let seemsBinary = false;
        if (encoding !== UTF16be && encoding !== UTF16le && buffer) {
            let couldBeUTF16LE = true; // e.g. 0xAA 0x00
            let couldBeUTF16BE = true; // e.g. 0x00 0xAA
            let containsZeroByte = false;

            // This is a simplified guess to detect UTF-16 BE or LE by just checking if
            // the first 512 bytes have the 0-byte at a specific location. For UTF-16 LE
            // this would be the odd byte index and for UTF-16 BE the even one.
            // Note: this can produce false positives (a binary file that uses a 2-byte
            // encoding of the same format as UTF-16) and false negatives (a UTF-16 file
            // that is using 4 bytes to encode a character).
            for (let i = 0; i < bytesRead && i < ZERO_BYTE_DETECTION_BUFFER_MAX_LEN; i++) {
                const isEndian = (i % 2 === 1); // assume 2-byte sequences typical for UTF-16
                const isZeroByte = (buffer.readUInt8(i) === 0);

                if (isZeroByte) {
                    containsZeroByte = true;
                }

                // UTF-16 LE: expect e.g. 0xAA 0x00
                if (couldBeUTF16LE && (isEndian && !isZeroByte || !isEndian && isZeroByte)) {
                    couldBeUTF16LE = false;
                }

                // UTF-16 BE: expect e.g. 0x00 0xAA
                if (couldBeUTF16BE && (isEndian && isZeroByte || !isEndian && !isZeroByte)) {
                    couldBeUTF16BE = false;
                }

                // Return if this is neither UTF16-LE nor UTF16-BE and thus treat as binary
                if (isZeroByte && !couldBeUTF16LE && !couldBeUTF16BE) {
                    break;
                }
            }

            // Handle case of 0-byte included
            if (containsZeroByte) {
                if (couldBeUTF16LE) {
                    encoding = UTF16le;
                } else if (couldBeUTF16BE) {
                    encoding = UTF16be;
                } else {
                    seemsBinary = true;
                }
            }
        }

        // Auto guess encoding if configured
        if (options?.autoGuessEncoding && !seemsBinary && !encoding && buffer) {
            const guessedEncoding = await this.guessEncodingByBuffer(buffer.slice(0, bytesRead));
            return {
                seemsBinary: false,
                encoding: guessedEncoding
            };
        }

        return { seemsBinary, encoding };
    }

    protected async guessEncodingByBuffer(buffer: Buffer): Promise<string | undefined> {
        const jschardet = await import('jschardet');

        const guessed = jschardet.detect(buffer.slice(0, AUTO_ENCODING_GUESS_MAX_BYTES)); // ensure to limit buffer for guessing due to https://github.com/aadsm/jschardet/issues/53
        if (!guessed || !guessed.encoding) {
            return undefined;
        }

        const enc = guessed.encoding.toLowerCase();
        if (0 <= IGNORE_ENCODINGS.indexOf(enc)) {
            return undefined; // see comment above why we ignore some encodings
        }

        return this.toIconvEncoding(guessed.encoding);
    }

}
