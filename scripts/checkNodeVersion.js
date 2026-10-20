/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

// keep in sync with the "engines.node" field of package.json
const MIN_NODE_MAJOR = 22;

const major = Number(process.versions.node.split(".")[0]);

if (major < MIN_NODE_MAJOR)
    throw new Error(`Your node version (${process.version}) is too old, please update to v${MIN_NODE_MAJOR} or higher https://nodejs.org/en/download/`);
