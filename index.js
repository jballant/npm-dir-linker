/*jslint node:true,vars:true */

"use strict";

var commander = require('commander');
var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;
var npm = require('npm');
var currentDir = process.cwd();
var pkg = require('./package.json');
var ignoredTopPaths = [];
var pathToInstalled;
var pathToRepo;
var verbose;

commander
    .version(pkg.version)
    .option('-m, --module <m>', 'Package module name to install [module]')
    .option('-d, --dir <path>', 'Directory to install and link [dir]')
    .option('-s, --linkSelf', 'Link installed module to itself in its own node_modules, if using a resolve function that encounters problems with symlinks')
    .option('-i, --useIgnoreFile', 'Don\'t create symlinks for for top level files in the root .npmignore/.gitignore file of the local dir')
    .option('-v, --verbose', 'Log more information')
    .parse(process.argv);

if (!commander.module && !commander.dir) {
    commander.help();
    return;
}

if (!commander.dir) {
    throw new Error('The --dir argument is required');
}

if (!commander.module) {
    throw new Error('The --module argument is required');
}

function resolveHome(filepath) {
    if (filepath.charAt(0) === '~') {
        return path.join(process.env.HOME, filepath.slice(1));
    }
    return filepath;
}

pathToRepo = path.resolve(currentDir, resolveHome(commander.dir));
pathToInstalled = currentDir + '/node_modules/' + commander.module;
verbose = commander.verbose;

function debug() {
    if (verbose && arguments[0]) {
        var args = [].slice.call(arguments, 0);
        args[0] = pkg.name + ": VERBOSE: " + args[0];
        console.log.apply(console, args);
    }
}

function log() {
    var args = [].slice.call(arguments, 0);
    args[0] = pkg.name + ": " + args[0];
    console.log.apply(console, args);
}

function isNodeModulesOrHidden(path) {
    return path.indexOf('.') === 0 || path.substr(-1 * ('node_modules'.length)) === 'node_modules';
}

function shouldIgnorePath(path) {
    return isNodeModulesOrHidden(path) || ignoredTopPaths.indexOf(path) > -1;
}

function removeDir(path, callback) {
    debug('removing directory', path);
    exec('rm -r ' + path, function (err, stdout, stderr) {
        if (err) { throw err; }
        if (stderr) {
            console.error('%s error removing directory %s', pkg.name, path);
            throw new Error(stderr);
        }
        debug('removed directory %s', path);
        callback();
    });
}

function execNpmInstall(path, callback) {
    log('installing "%s" as node module\n', path);
    npm.load(function (err) {
        if (err) {
            throw err;
        }
        npm.install(path, function (e) {
            if (e) {
                throw e;
            }
            log('installed node_module "%s" successfully, proceeding to replace top-level files/folders with symlinks', commander.module);
            callback();
        });
    });
}

function execLinking(path, type, onCreateSymlink) {
    var fileName = path.split('/').pop();
    var dest = pathToInstalled + '/' + fileName;
    fs.symlink(path, dest, type, function (err) {
        if (err) { throw err; }
        debug('created symlink from %s to %s', path, dest);
        onCreateSymlink();
    });
}

function findTopLevelFiles(path, onFile, onDone) {
    fs.readdir(path, function (err, files) {
        if (err) { throw err; }
        var filesInfo = [];
        var i = 0;
        var pathsToCheck = 0;
        var findStats = function (fileName) {
            var p = path + '/' + fileName;
            pathsToCheck++;
            fs.stat(p, function (err, stats) {
                pathsToCheck--;
                if (err) { throw err; }
                filesInfo.push({ path: p, stats: stats });
                if (onFile) {
                    onFile(p, stats);
                }
                if (pathsToCheck === 0 && onDone) {
                    onDone(filesInfo);
                }
            });
        };
        for (i; i < files.length; i++) {
            if (!isNodeModulesOrHidden(files[i])) {
                findStats(files[i]);
            }
        }
    });
}

function removeDirsExceptNodeModules(dirs, callback) {
    var i = 0;
    var dirsToRemove = 0;
    var onRemove = function (err) {
        if (err) { throw err; }
        dirsToRemove--;
        if (dirsToRemove === 0) {
            callback();
        }
    };
    var dir;
    for (i; i < dirs.length; i++) {
        dir = dirs[i];
        if (!isNodeModulesOrHidden(dir)) {
            dirsToRemove++;
            removeDir(dir, onRemove);
        }
    }
}

function parseGitIgnoreTopLayer(gitIgnoreStr, onFoundTopFile, onDone) {
    var re = /([^\n]+)/g;
    var tailReg = /(\/\*?$)/;
    var matches = gitIgnoreStr.match(re);
    var i = 1;
    var pathStr;
    var unCheckedPathsCount = 0;
    var topLevelPaths = [];
    var statFn = function (path) {
        unCheckedPathsCount++;
        debug('checking if ignore file path exists: ', path);
        fs.access(path, fs.R_OK, function (err) {
            if (err) {
                debug('ignore file path does not exist: ', path);
                unCheckedPathsCount--;
                return;
            }
            fs.lstat(path, function (err, stat) {
                if (err) { throw err; }
                unCheckedPathsCount--;
                topLevelPaths.push({ path: path, stat: stat });
                debug('found top level file to exclude from symlink replacement: ', path);
                if (onFoundTopFile) {
                    onFoundTopFile(path, stat);
                }
                if (unCheckedPathsCount === 0 && onDone) {
                    onDone(topLevelPaths);
                }
            });
        });
    };
    for (i; i < matches.length; i++) {
        pathStr = matches[i];
        pathStr = pathStr.replace(tailReg, '');
        if (pathStr.indexOf('/') === -1) {
            pathStr = pathToRepo + '/' + pathStr;
            pathStr = path.resolve(pathStr);
            statFn(pathStr);
        }
    }
}

function loadIgnoredTopPaths(onDone) {

    var ignorePath = pathToRepo + '/.npmignore';
    fs.access(ignorePath, fs.R_OK, function (err) {
        if (err) {
            ignorePath = pathToRepo + '/.gitignore';
        }
        fs.readFile(ignorePath, { encoding: 'utf-8' }, function (err, data) {
            if (err) {
                if (err.code === 'ENOENT') {
                    debug('.gitignore file not found, will link every top level file except "node_modules"');
                    data = '';
                } else {
                    throw err;
                }
            }
            parseGitIgnoreTopLayer(data, null, function (pathInfoArr) {
                ignoredTopPaths = pathInfoArr;
                onDone();
            });
        });
    });

}

function linkRepoFiles(callback) {
    var pathsToLink = 0;
    findTopLevelFiles(pathToRepo, function (filePath) {
        if (!shouldIgnorePath(filePath)) {
            debug('creating symlink for path', filePath);
            pathsToLink++;
            fs.lstat(filePath, function (err, stats) {
                if (err) { throw err; }
                if (!stats.isSymbolicLink()) {
                    execLinking(filePath, stats.isDirectory() ? 'junction' : 'file', function () {
                        pathsToLink--;
                        if (pathsToLink === 0) {
                            callback();
                        }
                    });
                } else {
                    pathsToLink--;
                    if (pathsToLink === 0) {
                        callback();
                    }
                }
            });
        } else {
            debug('will not create symlink for path', filePath);
        }
    });
}

function onLoadedIgnoredTopPaths() {
    var onRemovedFiles = function () {
        linkRepoFiles(function () {
            log("successfully created symlinks for top level module files for %s!\n", commander.module);
            if (commander.linkSelf) {
                var pathToSelfLink = pathToInstalled + '/node_modules/' + commander.module;
                fs.symlink(pathToInstalled, pathToSelfLink, 'dir', function (err) {
                    if (err) { throw err; }
                    log('created symlink in "%s" node_modules dir to itself', pathToInstalled);
                });
            }
        });
    };
    var filesToRemove = 0;
    debug('Finding top level files and directories in %s', pathToInstalled);
    findTopLevelFiles(
        pathToInstalled,
        function (filePath, stats) {
            debug('found top level file', filePath);
            if (!isNodeModulesOrHidden(filePath)) {
                filesToRemove++;
                if (stats.isDirectory()) {
                    removeDir(filePath, function (err) {
                        filesToRemove--;
                        if (err) { throw err; }
                        if (filesToRemove === 0) {
                            onRemovedFiles();
                        }
                    });
                } else {
                    debug('removing path %s', filePath);
                    fs.unlink(filePath, function (err) {
                        filesToRemove--;
                        if (err) { throw err; }
                        if (verbose) {
                            log('removed file ' + filePath);
                        }
                        if (filesToRemove === 0) {
                            onRemovedFiles();
                        }
                    });
                }
            } else {
                debug('path %s will not be symlinked', filePath);
            }
        }
    );
}

function onNpmInstall() {
    if (commander.useIgnoreFile) {
        debug('ignore file will be used to find additional top-level ' +
            'files/directories to exclude from symlink replacement');
        loadIgnoredTopPaths(onLoadedIgnoredTopPaths);
    } else {
        debug('ignore file will not be used for finding additional ' +
            'top-level files/directories to exclude from symlink replacement');
        onLoadedIgnoredTopPaths();
    }
}

execNpmInstall(pathToRepo, onNpmInstall);

