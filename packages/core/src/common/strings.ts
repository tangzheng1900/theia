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
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from './char-code';
import { Constants } from './uint';

/**
 * Determines if haystack ends with needle.
 */
export function endsWith(haystack: string, needle: string): boolean {
    const diff = haystack.length - needle.length;
    if (diff > 0) {
        return haystack.indexOf(needle, diff) === diff;
    } else if (diff === 0) {
        return haystack === needle;
    } else {
        return false;
    }
}
export function isLowerAsciiLetter(code: number): boolean {
    return code >= CharCode.a && code <= CharCode.z;
}

export function isUpperAsciiLetter(code: number): boolean {
    return code >= CharCode.A && code <= CharCode.Z;
}

function isAsciiLetter(code: number): boolean {
    return isLowerAsciiLetter(code) || isUpperAsciiLetter(code);
}
export function equalsIgnoreCase(a: string, b: string): boolean {
    const len1 = a ? a.length : 0;
    const len2 = b ? b.length : 0;

    if (len1 !== len2) {
        return false;
    }

    return doEqualsIgnoreCase(a, b);
}

function doEqualsIgnoreCase(a: string, b: string, stopAt = a.length): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') {
        return false;
    }

    for (let i = 0; i < stopAt; i++) {
        const codeA = a.charCodeAt(i);
        const codeB = b.charCodeAt(i);

        if (codeA === codeB) {
            continue;
        }

        // a-z A-Z
        if (isAsciiLetter(codeA) && isAsciiLetter(codeB)) {
            const diff = Math.abs(codeA - codeB);
            if (diff !== 0 && diff !== 32) {
                return false;
            }
        }

        // Any other charcode
        // tslint:disable-next-line:one-line
        else {
            if (String.fromCharCode(codeA).toLowerCase() !== String.fromCharCode(codeB).toLowerCase()) {
                return false;
            }
        }
    }

    return true;
}

/**
 * @returns the length of the common prefix of the two strings.
 */
export function commonPrefixLength(a: string, b: string): number {

    let i: number;
    const len = Math.min(a.length, b.length);

    for (i = 0; i < len; i++) {
        if (a.charCodeAt(i) !== b.charCodeAt(i)) {
            return i;
        }
    }

    return len;
}

/**
 * Escapes regular expression characters in a given string
 */
export function escapeRegExpCharacters(value: string): string {
    return value.replace(/[\-\\\{\}\*\+\?\|\^\$\.\[\]\(\)\#]/g, '\\$&');
}

export function startsWithIgnoreCase(str: string, candidate: string): boolean {
    const candidateLength = candidate.length;
    if (candidate.length > str.length) {
        return false;
    }

    return doEqualsIgnoreCase(str, candidate, candidateLength);
}

export function* split(s: string, splitter: string): IterableIterator<string> {
    let start = 0;
    while (start < s.length) {
        let end = s.indexOf(splitter, start);
        if (end === -1) {
            end = s.length;
        }

        yield s.substring(start, end);
        start = end + splitter.length;
    }
}

export function escapeInvisibleChars(value: string): string {
    return value.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

export function unescapeInvisibleChars(value: string): string {
    return value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
}

export function compare(a: string, b: string): number {
    if (a < b) {
        return -1;
    } else if (a > b) {
        return 1;
    } else {
        return 0;
    }
}

export function compareSubstring(a: string, b: string, aStart: number = 0, aEnd: number = a.length, bStart: number = 0, bEnd: number = b.length): number {
    for (; aStart < aEnd && bStart < bEnd; aStart++, bStart++) {
        const codeA = a.charCodeAt(aStart);
        const codeB = b.charCodeAt(bStart);
        if (codeA < codeB) {
            return -1;
        } else if (codeA > codeB) {
            return 1;
        }
    }
    const aLen = aEnd - aStart;
    const bLen = bEnd - bStart;
    if (aLen < bLen) {
        return -1;
    } else if (aLen > bLen) {
        return 1;
    }
    return 0;
}

export function compareIgnoreCase(a: string, b: string): number {
    return compareSubstringIgnoreCase(a, b, 0, a.length, 0, b.length);
}

export function compareSubstringIgnoreCase(a: string, b: string, aStart: number = 0, aEnd: number = a.length, bStart: number = 0, bEnd: number = b.length): number {

    for (; aStart < aEnd && bStart < bEnd; aStart++, bStart++) {

        const codeA = a.charCodeAt(aStart);
        const codeB = b.charCodeAt(bStart);

        if (codeA === codeB) {
            // equal
            continue;
        }

        const diff = codeA - codeB;
        if (diff === 32 && isUpperAsciiLetter(codeB)) { // codeB =[65-90] && codeA =[97-122]
            continue;

        } else if (diff === -32 && isUpperAsciiLetter(codeA)) {  // codeB =[97-122] && codeA =[65-90]
            continue;
        }

        if (isLowerAsciiLetter(codeA) && isLowerAsciiLetter(codeB)) {
            //
            return diff;

        } else {
            return compareSubstring(a.toLowerCase(), b.toLowerCase(), aStart, aEnd, bStart, bEnd);
        }
    }

    const aLen = aEnd - aStart;
    const bLen = bEnd - bStart;

    if (aLen < bLen) {
        return -1;
    } else if (aLen > bLen) {
        return 1;
    }

    return 0;
}

/**
 * See http://en.wikipedia.org/wiki/Surrogate_pair
 */
export function isHighSurrogate(charCode: number): boolean {
    return (0xD800 <= charCode && charCode <= 0xDBFF);
}

/**
 * See http://en.wikipedia.org/wiki/Surrogate_pair
 */
export function isLowSurrogate(charCode: number): boolean {
    return (0xDC00 <= charCode && charCode <= 0xDFFF);
}

/**
 * See http://en.wikipedia.org/wiki/Surrogate_pair
 */
export function computeCodePoint(highSurrogate: number, lowSurrogate: number): number {
    return ((highSurrogate - 0xD800) << 10) + (lowSurrogate - 0xDC00) + 0x10000;
}

/**
 * get the code point that begins at offset `offset`
 */
export function getNextCodePoint(str: string, len: number, offset: number): number {
    const charCode = str.charCodeAt(offset);
    if (isHighSurrogate(charCode) && offset + 1 < len) {
        const nextCharCode = str.charCodeAt(offset + 1);
        if (isLowSurrogate(nextCharCode)) {
            return computeCodePoint(charCode, nextCharCode);
        }
    }
    return charCode;
}

/**
 * A manual encoding of `str` to UTF8.
 * Use only in environments which do not offer native conversion methods!
 *
 * TODO replace with iconv.encode
 */
export function encodeUTF8(str: string): Uint8Array {
    const strLen = str.length;

    // See https://en.wikipedia.org/wiki/UTF-8

    // first loop to establish needed buffer size
    let neededSize = 0;
    let strOffset = 0;
    while (strOffset < strLen) {
        const codePoint = getNextCodePoint(str, strLen, strOffset);
        strOffset += (codePoint >= Constants.UNICODE_SUPPLEMENTARY_PLANE_BEGIN ? 2 : 1);

        if (codePoint < 0x0080) {
            neededSize += 1;
        } else if (codePoint < 0x0800) {
            neededSize += 2;
        } else if (codePoint < 0x10000) {
            neededSize += 3;
        } else {
            neededSize += 4;
        }
    }

    // second loop to actually encode
    const arr = new Uint8Array(neededSize);
    strOffset = 0;
    let arrOffset = 0;
    while (strOffset < strLen) {
        const codePoint = getNextCodePoint(str, strLen, strOffset);
        strOffset += (codePoint >= Constants.UNICODE_SUPPLEMENTARY_PLANE_BEGIN ? 2 : 1);

        if (codePoint < 0x0080) {
            arr[arrOffset++] = codePoint;
        } else if (codePoint < 0x0800) {
            arr[arrOffset++] = 0b11000000 | ((codePoint & 0b00000000000000000000011111000000) >>> 6);
            arr[arrOffset++] = 0b10000000 | ((codePoint & 0b00000000000000000000000000111111) >>> 0);
        } else if (codePoint < 0x10000) {
            arr[arrOffset++] = 0b11100000 | ((codePoint & 0b00000000000000001111000000000000) >>> 12);
            arr[arrOffset++] = 0b10000000 | ((codePoint & 0b00000000000000000000111111000000) >>> 6);
            arr[arrOffset++] = 0b10000000 | ((codePoint & 0b00000000000000000000000000111111) >>> 0);
        } else {
            arr[arrOffset++] = 0b11110000 | ((codePoint & 0b00000000000111000000000000000000) >>> 18);
            arr[arrOffset++] = 0b10000000 | ((codePoint & 0b00000000000000111111000000000000) >>> 12);
            arr[arrOffset++] = 0b10000000 | ((codePoint & 0b00000000000000000000111111000000) >>> 6);
            arr[arrOffset++] = 0b10000000 | ((codePoint & 0b00000000000000000000000000111111) >>> 0);
        }
    }

    return arr;
}

/**
 * A manual decoding of a UTF8 string.
 * Use only in environments which do not offer native conversion methods!
 *
 * TODO replace with iconv.decode
 */
export function decodeUTF8(buffer: Uint8Array): string {
    // https://en.wikipedia.org/wiki/UTF-8

    const len = buffer.byteLength;
    const result: string[] = [];
    let offset = 0;
    while (offset < len) {
        const v0 = buffer[offset];
        let codePoint: number;
        if (v0 >= 0b11110000 && offset + 3 < len) {
            // 4 bytes
            codePoint = (
                (((buffer[offset++] & 0b00000111) << 18) >>> 0)
                | (((buffer[offset++] & 0b00111111) << 12) >>> 0)
                | (((buffer[offset++] & 0b00111111) << 6) >>> 0)
                | (((buffer[offset++] & 0b00111111) << 0) >>> 0)
            );
        } else if (v0 >= 0b11100000 && offset + 2 < len) {
            // 3 bytes
            codePoint = (
                (((buffer[offset++] & 0b00001111) << 12) >>> 0)
                | (((buffer[offset++] & 0b00111111) << 6) >>> 0)
                | (((buffer[offset++] & 0b00111111) << 0) >>> 0)
            );
        } else if (v0 >= 0b11000000 && offset + 1 < len) {
            // 2 bytes
            codePoint = (
                (((buffer[offset++] & 0b00011111) << 6) >>> 0)
                | (((buffer[offset++] & 0b00111111) << 0) >>> 0)
            );
        } else {
            // 1 byte
            codePoint = buffer[offset++];
        }

        if ((codePoint >= 0 && codePoint <= 0xD7FF) || (codePoint >= 0xE000 && codePoint <= 0xFFFF)) {
            // Basic Multilingual Plane
            result.push(String.fromCharCode(codePoint));
        } else if (codePoint >= 0x010000 && codePoint <= 0x10FFFF) {
            // Supplementary Planes
            const uPrime = codePoint - 0x10000;
            const w1 = 0xD800 + ((uPrime & 0b11111111110000000000) >>> 10);
            const w2 = 0xDC00 + ((uPrime & 0b00000000001111111111) >>> 0);
            result.push(String.fromCharCode(w1));
            result.push(String.fromCharCode(w2));
        } else {
            // illegal code point
            result.push(String.fromCharCode(0xFFFD));
        }
    }

    return result.join('');
}

