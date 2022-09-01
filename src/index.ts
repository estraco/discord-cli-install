#! /usr/bin/env node
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';

import tar from 'tar';

const chars = [
    '⡀',
    '⡄',
    '⡆',
    '⡇',
    '⡏',
    '⡟',
    '⡿',
    '⣿'
];

const updatesPerSecond = 333;

if (process.platform !== 'linux') {
    console.error('This script only works on Linux');
    process.exit(1);
}

function parseArgs(args: string[]) {
    const obj: {
        double: {
            [key: string]: string | boolean;
        };
        single: {
            [key: string]: string | boolean;
        };
    } = {
        double: {},
        single: {},
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);

            if (key.includes('=')) {
                const [k, ...v] = key.split('=');
                obj.double[k] = v.join('=');
            } else if (args[i + 1] && !args[i + 1].startsWith('-')) {
                obj.double[key] = args[i + 1];
                i++;
            } else {
                obj.double[key] = true;
            }
        } else if (arg.startsWith('-')) {
            const key = arg.slice(1);

            if (key.includes('=')) {
                const [k, ...v] = key.split('=');
                obj.single[k] = v.join('=');
            } else if (args[i + 1] && !args[i + 1].startsWith('-')) {
                obj.single[key] = args[i + 1];
                i++;
            } else {
                obj.single[key] = true;
            }
        }
    }

    return obj;
}

function handleRes(response: http.IncomingMessage, filename: string, file: fs.WriteStream) {
    const maxLength = parseInt(response.headers['content-length'] || '0', 10);

    console.log(`Downloading ${filename} (${maxLength} bytes)`);

    let maxDownloadStatusLen = Math.round(process.stdout.columns - `Downloading ${filename}... `.length) - (3 + (`${maxLength} `.length * 2) + ' 100%'.length);

    const resizeFn = () => {
        maxDownloadStatusLen = Math.round(process.stdout.columns - `Downloading ${filename}... `.length) - (3 + (`${maxLength} `.length * 2) + ' 100%'.length);
        process.stdout.cursorTo(0);
        process.stdout.clearLine(1);
        process.stdout.write(`Downloading ${filename}... [`);
    };

    process.stdout.on('resize', resizeFn);

    response.pipe(file);

    process.stdout.write(`Downloading ${filename}... [`);

    let progress = 0;
    const dlen = `Downloading ${filename}... [`.length;
    const chunkSize = Math.floor(maxLength / maxDownloadStatusLen);
    const finalchar = chars[chars.length - 1];

    const progressInterval = setInterval(() => {
        if (maxDownloadStatusLen < 10) {
            process.stdout.cursorTo(0);
            process.stdout.clearLine(1);

            process.stdout.write(`Downloading ${filename}... ${Math.round(progress * 100)}% (${file.bytesWritten}/${maxLength})`);
        } else {
            process.stdout.cursorTo(dlen);

            const char = chars[Math.floor(((file.bytesWritten % chunkSize) / chunkSize) * chars.length)];

            process.stdout.write(`${finalchar.repeat(Math.max(0, (progress * maxDownloadStatusLen) - 1))}${char}${'-'.repeat(maxDownloadStatusLen - progress * maxDownloadStatusLen)}] ${Math.round(progress * 100)}% (${file.bytesWritten}/${maxLength})`);
        }
    }, 1000 / updatesPerSecond);

    response.on('data', () => {
        progress = (file.bytesWritten / maxLength);
    });

    response.on('end', () => {
        clearInterval(progressInterval);
        process.stdout.removeListener('resize', resizeFn);
        process.stdout.cursorTo(0);
        process.stdout.clearLine(1);
        process.stdout.write(`Downloaded ${filename} (${maxLength} bytes)

`);
    });
}

const args = parseArgs(process.argv.slice(2));

const { double, single } = args;

const action =
    double['download']
        ? 'download' :
        double['install']
            ? 'install' :
            double['link']
                ? 'link' :
                double['help']
                    ? 'help' :
                    double['action'] || single['a'] || 'download';

if (typeof action !== 'string') {
    console.error('Invalid action');
    process.exit(1);
}

if (![
    'download',
    'install',
    'link',
    'update',
    'help',
    'versions'
].includes(action)) {
    console.error(`Invalid action: ${action}`);
    process.exit(1);
}

type Section = {
    keys: string[];
    description: string | (() => string);
    required?: boolean;
    default?: string;
}[];

const sections: {
    sections: Section;
    main: Section;
    download: Section;
    install: Section;
    link: Section;
    update: Section;
    versions: Section;
} = {
    sections: [
        {
            keys: ['--help', '-h'],
            description: 'Show this help message',
        },
        {
            keys: ['--section', '-s'],
            description: () => 'Show a specific section. Can be one of: ' + Object.keys(sections).join(', '),
        },
    ],
    main: [
        {
            keys: [
                '--action',
                '-a'
            ],
            description: 'The action to perform. Can be one of download, install, link, update, or help',
            required: false,
            default: 'download'
        }
    ],
    download: [
        {
            keys: [
                '--build',
                '-b'
            ],
            description: 'The build to download. Can either be stable, canary, or ptb',
            required: false,
            default: 'stable'
        },
        {
            keys: [
                '--filename',
                '-f'
            ],
            description: 'The filename to download to',
            required: false,
            default: 'discord-{build}.tar.gz'
        },
        {
            keys: [
                '--download-directory',
                '-d'
            ],
            description: 'The directory the file will be downloaded to',
            required: false,
            default: 'cwd/downloads'
        }
    ],
    install: [
        {
            keys: [
                '--file',
                '-f'
            ],
            description: 'The file to install from',
            required: true
        },
        {
            keys: [
                '--build',
                '-b'
            ],
            description: 'The build to install. Can either be stable, canary, or ptb',
            required: false,
            default: 'stable'
        },
        {
            keys: [
                '--install-directory',
                '-d'
            ],
            description: 'The directory to install to',
            required: false,
            default: '/opt/discord'
        }
    ],
    link: [
        {
            keys: [
                '--build',
                '-b'
            ],
            description: 'The build to link. Can either be stable or insiders',
            required: false,
            default: 'stable'
        },
        {
            keys: [
                '--install-directory',
                '-d'
            ],
            description: 'The directory to link from',
            required: false,
            default: '/opt/discord'
        },
        {
            keys: [
                '--symlink-directory',
                '-s'
            ],
            description: 'The directory to link to',
            required: false,
            default: '/usr/bin'
        }
    ],
    update: [
        {
            keys: [
                '--build',
                '-b'
            ],
            description: 'The build to update. Can either be stable, canary, or ptb',
            required: false,
            default: 'stable'
        },
        {
            keys: [
                '--install-directory',
                '-d'
            ],
            description: 'The directory to update',
            required: false,
            default: '/opt/discord'
        }
    ],
    versions: [
        {
            keys: [
                '--build',
                '-b'
            ],
            description: 'The build to get versions for. Can either be stable, canary, ptb, or all',
            required: false,
            default: 'all'
        }
    ]
};

function printSection(sectionName: keyof typeof sections) {
    const section = sections[sectionName];

    console.log(sectionName);

    for (const { keys, description, required, default: def } of section) {
        console.log(`  ${keys.join(', ')}:${required ? ' (required)' : ''}${def ? ` (default: ${def})` : ''}`);

        for (const line of (
            typeof description === 'string'
                ? description
                : description()
        ).split('\n')) {
            console.log(`    ${line}`);
        }
    }

    console.log();
}

async function helpAction(double: {
    [key: string]: string | boolean
}, single: {
    [key: string]: string | boolean
}) {
    const section = double['section'] || single['s'] || 'all';

    if (typeof section !== 'string') {
        console.error('Invalid section. If you want to see the sections, use --section=sections, -s=sections, or don\'t specify a section');
        process.exit(1);
    }

    switch (section) {
        case 'all':
            console.log('All sections:');
            console.log();

            for (const sectionName of Object.keys(sections)) {
                printSection(sectionName as keyof typeof sections);
            }

            break;
        case 'sections':
            printSection('sections');
            break;
        case 'main':
            printSection('main');
            break;
        case 'download':
            printSection('download');
            break;
        case 'install':
            printSection('install');
            break;
        case 'link':
            printSection('link');
            break;
        case 'update':
            printSection('update');
            break;
        case 'versions':
            printSection('versions');
            break;
        default:
            console.error(`Invalid section: ${section}`);
            process.exit(1);
    }

    process.exit(0);
}

function version(build?: 'all'): {
    stable: string;
    canary: string;
    ptb: string;
}
function version(build: 'stable'): string;
function version(build: 'canary'): string;
function version(build: 'ptb'): string;
function version(build: 'stable' | 'canary' | 'ptb' | 'all' = 'all') {
    if (build === 'all') {
        return {
            stable: version('stable'),
            canary: version('canary'),
            ptb: version('ptb')
        };
    }

    if (build !== 'stable' && build !== 'canary' && build !== 'ptb') {
        throw new Error(`Invalid build: ${build}`);
    }

    if (build === 'stable') {
        const fpath = path.join('/opt/discord', 'resources', 'build_info.json');

        if (!fs.existsSync(fpath)) {
            return 'Not installed';
        }

        const data = JSON.parse(fs.readFileSync(fpath, 'utf8'));

        return data.version;
    } else if (build === 'canary') {
        const fpath = path.join('/opt/discordcanary', 'resources', 'build_info.json');

        if (!fs.existsSync(fpath)) {
            return 'Not installed';
        }

        const data = JSON.parse(fs.readFileSync(fpath, 'utf8'));

        return data.version;
    } else if (build === 'ptb') {
        const fpath = path.join('/opt/discordptb', 'resources', 'build_info.json');

        if (!fs.existsSync(fpath)) {
            return 'Not installed';
        }

        const data = JSON.parse(fs.readFileSync(fpath, 'utf8'));

        return data.version;
    }
}

async function downloadAction(double: {
    [key: string]: string | boolean
}, single: {
    [key: string]: string | boolean
}): Promise<string> {
    return new Promise((resolve) => {
        const build = double['build'] || single['b'] || 'stable';

        if (typeof build !== 'string') {
            console.error(`Invalid build: ${build}`);
            process.exit(1);
        }

        if (!['stable', 'canary', 'ptb'].includes(build)) {
            console.error(`Invalid build: ${build}`);
            process.exit(1);
        }

        const url = `https://discord.com/api/download/${build}?platform=linux&format=tar.gz`;
        const filename = double['filename'] || single['f'] || `discord-${build}-${Date.now()}.tar.gz`;
        const downloadDir = double['download-directory'] || single['d'] || path.join(process.cwd(), 'downloads');

        if (typeof filename !== 'string') {
            console.error(`Invalid filename: ${filename}`);
            process.exit(1);
        }
        if (typeof downloadDir !== 'string') {
            console.error(`Invalid download directory: ${downloadDir}`);
            process.exit(1);
        }

        const downloadPath = path.join(downloadDir, filename);

        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
        }

        console.log(`Downloading ${url} to ${downloadPath}`);

        const file = fs.createWriteStream(downloadPath);

        const request = https.get(url, response => {
            if (response.statusCode === 302) {
                console.log(`Redirecting to ${response.headers.location}`);
                request.abort();
                https.get(response.headers.location, response => {
                    handleRes(response, filename, file);
                }).on('error', error => {
                    console.error(error);
                    process.exit(1);
                }).on('end', () => {
                    console.log(`Downloaded ${filename}`);
                    process.exit(0);
                });
            } else {
                handleRes(response, filename, file);
            }
        });

        file.on('finish', () => {
            file.close();
            console.log(`\nDownloaded ${filename} to ${downloadDir}`);
            resolve(path.join(downloadDir, filename));
        });

        request.on('error', error => {
            console.error(error);
            process.exit(1);
        });
    });
}

async function installAction(double: {
    [key: string]: string | boolean
}, single: {
    [key: string]: string | boolean
}) {
    const file = double['file'] || single['f'];
    const build = double['build'] || single['b'] || 'stable';

    const dir = double['directory'] || single['d'] || path.join('/opt', build === 'stable' ? 'discord' : build === 'canary' ? 'discordcanary' : 'discordptb');

    if (typeof file !== 'string') {
        console.error(`Invalid file: ${file}`);
        process.exit(1);
    }

    if (typeof build !== 'string') {
        console.error(`Invalid build: ${build}`);
        process.exit(1);
    }

    if (!['stable', 'canary', 'ptb'].includes(build)) {
        console.error(`Invalid build: ${build}`);
        process.exit(1);
    }

    if (typeof dir !== 'string') {
        console.error(`Invalid install directory: ${dir}`);
        process.exit(1);
    }

    if (!file) {
        console.error('Missing file');
        process.exit(1);
    }

    if (!fs.existsSync(file)) {
        console.error(`File ${file} does not exist`);
        process.exit(1);
    }

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    try {
        fs.accessSync(dir, fs.constants.W_OK);
    } catch (error) {
        console.error(`Directory ${dir} is not writable, please run as root (sudo)`);
        process.exit(1);
    }

    console.log(`Installing ${file} to ${dir}`);

    tar.x({
        file: file,
        cwd: dir,
        strip: 1
    }).then(() => {
        console.log(`Installed ${file} to ${dir}`);

        // cp.execSync(`mv ${path.join(dir, `Discord${build === 'stable' ? '' : build === 'canary' ? 'Canary' : 'PTB'}`, '*')} ${dir}`);

        process.exit(0);
    });
}

async function linkAction(double: {
    [key: string]: string | boolean
}, single: {
    [key: string]: string | boolean
}) {
    const build = double['build'] || single['b'] || 'stable';

    if (typeof build !== 'string') {
        console.error(`Invalid build: ${build}`);
        process.exit(1);
    }

    const dir = double['install-directory'] || single['d'] || path.join('/opt', build === 'stable' ? 'discord' : build === 'canary' ? 'discordcanary' : 'discordptb');

    if (typeof dir !== 'string') {
        console.error(`Invalid install directory: ${dir}`);
        process.exit(1);
    }

    if (!fs.existsSync(dir)) {
        console.error(`Install directory ${dir} does not exist`);
        process.exit(1);
    }

    const symlinkdir = double['symlink-directory']
        ? double['symlink-directory'] :
        single['s']
            ? single['s'] :
            (process.platform === 'linux' ? '/usr/bin' : path.join(process.env.HOME, 'bin'));

    if (typeof symlinkdir !== 'string') {
        console.error(`Invalid symlink directory: ${symlinkdir}`);
        process.exit(1);
    }

    if (!fs.existsSync(symlinkdir)) {
        console.error(`Directory ${symlinkdir} does not exist`);
        process.exit(1);
    }

    const exefile = path.join(dir, `Discord${build === 'stable' ? '' : build === 'canary' ? 'Canary' : 'PTB'}`);

    console.log(`Linking ${exefile} to ${symlinkdir}`);

    try {
        fs.accessSync(dir, fs.constants.R_OK);
    } catch (error) {
        console.error(`Directory ${dir} is not readable, please run as root (sudo)`);
        process.exit(1);
    }

    if (!fs.existsSync(exefile)) {
        console.error(`Executable ${exefile} does not exist`);
        process.exit(1);
    }

    const linkname = build === 'stable' ? 'discord' : build === 'canary' ? 'discordcanary' : 'discordptb';

    fs.symlinkSync(exefile, path.join(symlinkdir, linkname), 'file');

    console.log(`Linked ${exefile} to ${symlinkdir}`);
}

async function updateAction(double: {
    [key: string]: string | boolean
}, single: {
    [key: string]: string | boolean
}) {
    const build = double['build'] || single['b'] || 'stable';

    if (typeof build !== 'string') {
        console.error(`Invalid build: ${build}`);
        process.exit(1);
    }

    const dir = double['install-directory'] || single['d'] || path.join('/opt', build === 'stable' ? 'discord' : build === 'canary' ? 'discordcanary' : 'discordptb');

    if (typeof dir !== 'string') {
        console.error(`Invalid install directory: ${dir}`);
        process.exit(1);
    }

    if (!fs.existsSync(dir)) {
        console.error(`Directory ${dir} does not exist`);
        process.exit(1);
    }

    const bindir = path.join(dir, 'bin');

    if (!fs.existsSync(bindir)) {
        console.error(`Directory ${bindir} does not exist`);
        process.exit(1);
    }

    try {
        fs.accessSync(bindir, fs.constants.W_OK);
    } catch (error) {
        console.error(`Directory ${bindir} is not writable, please run as root (sudo)`);
        process.exit(1);
    }

    console.log(`Updating ${bindir}`);

    const filename = await downloadAction(double, single);

    double.file = filename;

    await installAction(double, single);
}

async function versionsAction(double: {
    [key: string]: string | boolean
}, single: {
    [key: string]: string | boolean
}) {
    const build = double['build'] || single['b'] || 'all';

    if (typeof build !== 'string') {
        console.error(`Invalid build: ${build}`);
        process.exit(1);
    }

    if (build !== 'all' && build !== 'stable' && build !== 'canary' && build !== 'ptb') {
        console.error(`Invalid build: ${build}`);
        process.exit(1);
    }

    if (build === 'all') {
        const {
            stable,
            canary,
            ptb
        } = version();

        console.log(`Current Stable Version: ${stable}`);
        console.log(`Current Canary Version: ${canary}`);
        console.log(`Current PTB Version: ${ptb}`);
    }
}

async function main() {
    if (action === 'help') {
        helpAction(double, single);
    } else if (action === 'download') {
        downloadAction(double, single);
    } else if (action === 'install') {
        installAction(double, single);
    } else if (action === 'link') {
        linkAction(double, single);
    } else if (action === 'update') {
        updateAction(double, single);
    } else if (action === 'versions') {
        versionsAction(double, single);
    }
}

main();
