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
    .option('-v, --verbose', 'Logs more information')
    .option('-s, --linkSelf', 'Link installed module to itself in its own node_modules, if using a resolve function that encounters problems with symlinks')
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


pathToRepo = path.resolve(commander.dir);
pathToInstalled = currentDir + '/node_modules/' + commander.module;
verbose = commander.verbose;

function isNodeModulesOrHidden(path) {
    return path.indexOf('.') === 0 || path.substr(-1 * ('node_modules'.length)) === 'node_modules';
}

function shouldIgnorePath(path) {
    return isNodeModulesOrHidden(path) || ignoredTopPaths.indexOf(path) > -1;
}

function removeDir(path, callback) {
    exec('rm -r ' + path, function (err) {
        if (err) { throw err; }
        if (verbose) {
            console.log('Removed directory %s', path);
        }
        callback();
    });
}

function execNpmInstall(path, callback) {
    console.log('%s: installing "%s" as node module\n', pkg.name, path);
    npm.load(function (err) {
        if (err) {
            throw err;
        }
        npm.install(path, function (e) {
            if (e) {
                throw e;
            }
            console.log('%s: installed node_module "%s" successfully, proceeding to replace top-level files/folders with symlinks', pkg.name, commander.module);
            callback();
        });
    });
}

function execLinking(path, type, onCreateSymlink) {
    var fileName = path.split('/').pop();
    var dest = pathToInstalled + '/' + fileName;
    fs.symlink(path, dest, type, function (err) {
        if (err) { throw err; }
        if (verbose) {
            console.log('Created symlink from %s to %s', path, dest);
        }
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
        fs.exists(path, function (exists) {
            if (!exists) {
                unCheckedPathsCount--;
                return;
            }
            fs.lstat(path, function (err, stat) {
                if (err) { throw err; }
                unCheckedPathsCount--;
                topLevelPaths.push({ path: path, stat: stat });
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
    var ignorePath = currentDir + '/.gitignore';
    fs.readFile(ignorePath, { encoding: 'utf-8' }, function (err, data) {
        if (err) { throw err; }
        parseGitIgnoreTopLayer(data, null, function (pathInfoArr) {
            ignoredTopPaths = pathInfoArr;
            onDone(ignoredTopPaths);
        });
    });
}

function linkRepoFiles(callback) {
    var pathsToLink = 0;
    findTopLevelFiles(pathToRepo, function (filePath) {
        if (!shouldIgnorePath(filePath)) {
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
        }
    });
}

function onLoadedIgnoredTopPaths() {
    var onRemovedFiles = function () {
        linkRepoFiles(function () {
            console.log("%s: successfully created symlinks for top level module files for %s!\n", pkg.name, commander.module);
            if (commander.linkSelf) {
                var pathToSelfLink = pathToInstalled + '/node_modules/' + commander.module;
                fs.symlink(pathToInstalled, pathToSelfLink, 'dir', function (err) {
                    if (err) { throw err; }
                    console.log('%s: created symlink in "%s" node_modules dir to itself', pkg.name, pathToInstalled);
                });
            }
        });
    };
    var filesToRemove = 0;
    findTopLevelFiles(
        pathToInstalled,
        function (filePath, stats) {
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
                    fs.unlink(filePath, function (err) {
                        filesToRemove--;
                        if (err) { throw err; }
                        if (verbose) {
                            console.log('Removed file ' + filePath);
                        }
                        if (filesToRemove === 0) {
                            onRemovedFiles();
                        }
                    });
                }
            }
        }
    );
}

function onNpmInstall() {
    loadIgnoredTopPaths(onLoadedIgnoredTopPaths);
}

execNpmInstall(pathToRepo, onNpmInstall);

