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

export const enum Constants {
	/**
	 * Max unsigned integer that fits on 8 bits.
	 */
    MAX_UINT_8 = 255, // 2^8 - 1

    UNICODE_SUPPLEMENTARY_PLANE_BEGIN = 0x010000
}

export function toUint8(v: number): number {
    if (v < 0) {
        return 0;
    }
    if (v > Constants.MAX_UINT_8) {
        return Constants.MAX_UINT_8;
    }
    return v | 0;
}
