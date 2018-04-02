
"use strict";

var commander = require('commander');
var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;
var npm = require('npm');
var currentDir = process.cwd();
var pkg = require('./package.json');
var chokidar = require('chokidar');
var Promise = require('es6-promise').Promise;
var assert = require('assert');
var ignoredTopPaths = [];
var pathToInstalled;
var pathToRepo;
var verbose;

// map of top level paths to a chokidar watcher
var watchers = {};

commander
    .version(pkg.version)
    .option('-d, --dir <path>', 'Directory to install and "watch" (i.e. set up watchers for) [dir]')
    .option('-i, --useIgnoreFile', 'Don\'t create watchers for for top level files in the root .npmignore/.gitignore file of the local dir')
    .option('-v, --verbose', 'Log more information')
    .parse(process.argv);

if (!commander.dir) {
    commander.help();
    return process.exit(0);
}

function resolveHome(filepath) {
    if (filepath.charAt(0) === '~') {
        return path.join(process.env.HOME, filepath.slice(1));
    }
    return filepath;
}

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

function errorLog() {
    var args = [].slice.call(arguments, 0);
    args[0] = pkg.name + ": " + args[0];
    console.error.apply(console, args);
}

pathToRepo = path.resolve(currentDir, resolveHome(commander.dir));

var modulePackage;
try {
    modulePackage = require(pathToRepo + '/package.json');    
} catch (e) {
    errorLog('directory "' + pathToRepo + '" does not contain a "package.json" file');
    return process.exit(1);
}

if (!modulePackage.name) {
    errorLog('Module "package.json" file does not contain a "name"');
    return process.exit(1);
}

pathToInstalled = currentDir + '/node_modules/' + modulePackage.name;
verbose = commander.verbose;


function isNodeModulesOrHidden(path) {
    return path.indexOf('.') === 0 || path.substr(-1 * ('node_modules'.length)) === 'node_modules';
}

function shouldIgnorePath(path) {
    return isNodeModulesOrHidden(path) || ignoredTopPaths.indexOf(path) > -1;
}

var dirCreationPromises = {};

/**
 * Make a directory at the provided path. Assumes that a
 * directory at the specified path does not exist (otherwise,
 * the promise will be rejected. If there is already a promise
 * to create the directory underway, this will just return
 * the existing promise.
 * @param {string} newDirPath
 */
function mkDirPromise(newDirPath) {
    if (dirCreationPromises[newDirPath]) {
        debug('Found promise to create directory, for path ' + newDirPath + ' in progress');
        return dirCreationPromises[newDirPath];
    }
    var prom = new Promise(function (resolve, reject) {
        debug('Making directory', newDirPath);
        fs.access(newDirPath, fs.F_OK, function (err) {
            if (!err) {
                debug('directory already exists', newDirPath);
                resolve();
            } else if (err.code === 'ENOENT') {
                fs.mkdir(newDirPath, function (err) {
                    if (err) {
                        errorLog(err);
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            } else {
                errorLog(err);
                reject(err);
            }
        });
    });
    dirCreationPromises[newDirPath] = prom;
    var deleteCachedProm = function () {
        delete dirCreationPromises[newDirPath];
    };
    prom.then(deleteCachedProm, deleteCachedProm);
    return prom;
}

/**
 * Recursively creates ancestor directories
 * for a file path if it doesn't exist already
 * @param filePath
 * @returns {Promise<>}
 */
function createParentDirsIfNotExist(filePath) {
    assert.ok(path.isAbsolute(filePath), 'filePath must be absolute path');
    var parentDir = path.dirname(filePath);
    return new Promise(function (resolve, reject) {
        fs.access(parentDir, fs.F_OK, function (err) {
            if (err) {
                // only create the directory if we have the correct access err code
                if (err.code === 'ENOENT') {
                    debug('Parent dir ' + parentDir + ' does not exist, will create');
                    createParentDirsIfNotExist(parentDir)
                        .then(function () {
                            return mkDirPromise(parentDir)
                        })
                        .then(resolve, reject);
                } else {
                    debug('Encountered unexpected error creating directory:' + err.message);
                    reject(err);
                }
            } else {
                // if the directory already exists, resolve the promise
                resolve();
            }
        });
    });
}

/**
 * Copies a file
 * @param {string} readFilePath
 * @param {string} writeFilePath
 * @returns {Promise<string>}
 */
function promiseCopyFile(readFilePath, writeFilePath) {
    assert.ok(path.isAbsolute(readFilePath), 'readFilePath must be absolute path');
    assert.ok(path.isAbsolute(writeFilePath), 'writeFilePath must be absolute path');
    return new Promise(function (resolve, reject) {
        debug('reading file to copy:', readFilePath);
        return promiseReadFile(readFilePath)
            .then(function (contents) {
                return createParentDirsIfNotExist(writeFilePath)
                    .then(function () {
                        return Promise.resolve(contents);
                    });
            })
            .then(function (contents) {
                return promiseWriteFile(writeFilePath, contents);
            })
            .then(function () {
                debug('wrote copied file:', writeFilePath);
                resolve('Successfully wrote ' + writeFilePath);
            }).catch(function (err) {
                console.error(err);
                reject(err);
            });
    });
}

/**
 * Promisified fs.readFile
 * @param {string} readFilePath
 * @returns {Promise<string>}
 */
function promiseReadFile(readFilePath) {
    assert.ok(path.isAbsolute(readFilePath), 'readFilePath must be absolute path');
    return new Promise(function (resolve, reject) {
        fs.readFile(readFilePath, 'utf-8', function (err, contents) {
            if (err) {
                reject(err);
            } else {
                resolve(contents);
            }
        });
    });
}

/**
 * Promisified fs.writeFile
 * @param {string} writeFilePath
 * @param {string} contents
 * @returns {Promise<string>}
 */
function promiseWriteFile(writeFilePath, contents) {
    assert.ok(path.isAbsolute(writeFilePath), 'writeFilePath must be absolute path');
    return new Promise(function (resolve, reject) {
        fs.writeFile(writeFilePath, contents, function (err) {
            if (err) {
                console.error(err);
                reject(err);
            } else {
                resolve('Successfully wrote ' + writeFilePath);
            }
        });
    });
}

/**
 * Executes `rm -r <path>` to remove the directory
 * @param path
 * @param callback
 */
function removeDir(path, callback) {
    debug('removing directory', path);
    exec('rm -r ' + path, function (err, stdout, stderr) {
        if (err) { throw err; }
        if (stderr) {
            errorLog('%s error removing directory %s', pkg.name, path);
            throw new Error(stderr);
        }
        debug('removed directory %s', path);
        callback();
    });
}

/**
 * Install a local directory copy of an npm project
 * by using 'npm pack' and then 'npm install' on the
 * resulting tarball from npm pack.
 */
function npmLocalPackInstall(pathToPkg, callback) {
    debug('loading npm in current working directory project');
    npm.load({
        prefix: currentDir
    }, function (err) {
        if (err) {
            return callback(err);
        }
        debug('executing "npm pack" on path ' + path); 
        npm.commands.pack([pathToPkg], function (err) {
            if (err) {
                return callback(err);
            }
            try {
                debug('loading local package directory package.json');
                var localModulePkg = require(pathToPkg + '/package.json');
            } catch (requireErr) {
                return callback(requireErr);
            }
            if (!localModulePkg.name || !localModulePkg.version) {
                return callback(new Error('Local npm project repo must specify version and name in package.json'));
            }
            var tarballPath = './' + localModulePkg.name + '-' + localModulePkg.version + '.tgz'
            debug('installing packed local repo directory');
            npm.install(tarballPath, function (err) {
                if (err) {
                    return callback(err);
                }
                return callback();
            });
        });        
    })

}

/**
 * Install a local node module from a path. Avoids
 * creating a symlink installing a packed version of 
 * the module.
 * @param {string} path
 * @param {function} callback
 */
function execNpmInstall(pathToPkg, callback) {
    log('installing "%s" as node module\n', pathToPkg);
    npmLocalPackInstall(pathToPkg, function (err) {
        if (err) {
            errorLog('error installing local package repo from path %s', pathToPkg);
            throw err;
        } else {
            log('installed node_module "%s" successfully, creating watchers for top-level files/folders', modulePackage.name);
            callback();
        }
    });
}

function getPathFromPackageRoot(filePath) {
    var relativePath = path.relative(pathToRepo, filePath);
    return path.resolve(pathToInstalled, relativePath);
}

function copyChangedFile(filePath) {
    debug('file changed/added in repo -> updating in package', filePath);
    return promiseCopyFile(filePath, getPathFromPackageRoot(filePath))
        .then(function () {
            log('updated file in package:', path.basename(filePath))
        })
        .catch(function (error) {
            errorLog('Error copying file:', filePath);
            throw error;
        });
}

function removeDeletedFile(filePath) {
    var fileToRemove = getPathFromPackageRoot(filePath);
    debug('removed file in repo -> adding in package', filePath);
    fs.unlink(fileToRemove, function (err) {
        if (err && err.code !== 'ENOENT') {
            errorLog('Error removing file', filePath);
            throw err;
        } else {
            log('file deleted repo, removed in package:', path.basename(filePath));
        }
    });
}

function makeAddedDirectory(dirPath) {
    var dirPathToAdd = getPathFromPackageRoot(dirPath);
    debug('added directory in repo -> adding in package', dirPath);
    return mkDirPromise(dirPathToAdd)
        .then(function () {
            log('directory added in repo, added in package:', dirPath);
        })
        .catch(function (err) {
            errorLog('Error adding newly added directory to package', dirPathToAdd);
            throw err;
        });
}

function removeDeletedDir(srcDir) {
    debug('removed directory in repo -> removing in package', srcDir);
    var dirToRemove = getPathFromPackageRoot(srcDir);
    removeDir(dirToRemove, function (err) {
        if (err) {
            errorLog('Error removing directory that was removed in source repo', dirToRemove);
            throw err;
        } else {
            log('directory deleted in repo, deleted matching directory in package:', srcDir);
        }
    })
}

function createWatcher(pathToWatch, additionalOpts) {
    if (watchers[pathToWatch]) {
        errorLog('already watching path:', pathToWatch);
        return null;
    }
    var opts = {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        followSymlinks: false,
        ignoreInitial: true
    };
    Object.keys(additionalOpts || {}).forEach(function (key) {
        opts[key] = additionalOpts[key];
    });
    var watcher = chokidar.watch(pathToWatch, opts);
    watcher.on('error', function (error) {
        delete watchers[path];
        errorLog('Error encountered watching path ', pathToWatch);
        throw error;
    });
    watchers[pathToWatch] = watcher;
    return watcher;
}

/**
 * Create a file watcher that will copy over any
 * added/changed files and remove any deleted files.
 * Recursively watches from the provided path
 * @param {string} path
 * @param {function} onLinked
 */
function execWatchingForChanges(path, onLinked) {
    var fileName = path.split('/').pop();
    var src = pathToRepo + '/' + fileName;
    debug('setting up watcher for path:', path);
    var watcher = createWatcher(src);
    if (!watcher) {
        onLinked();
        return;
    }
    watcher
        .on('add', copyChangedFile)
        .on('change', copyChangedFile)
        .on('unlink', removeDeletedFile)
        .on('addDir', makeAddedDirectory)
        .on('unlinkDir', removeDeletedDir)
        .on('ready', function () {
            debug('Scanned "%s", watching for changes', src);
            onLinked();
        });
    return watcher;
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
        debug('checking if ignore file path exists:', path);
        fs.access(path, fs.R_OK, function (err) {
            if (err) {
                debug('ignore file path does not exist:', path);
                unCheckedPathsCount--;
                return;
            }
            fs.lstat(path, function (err, stat) {
                if (err) { throw err; }
                unCheckedPathsCount--;
                topLevelPaths.push({ path: path, stat: stat });
                debug('found top level file to exclude from symlink replacement:', path);
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

function loadIgnoredTopPaths() {
    var ignorePath = pathToRepo + '/.npmignore';
    return new Promise(function (resolve, reject) {
        fs.access(ignorePath, fs.R_OK, function (err) {
            if (err) {
                ignorePath = pathToRepo + '/.gitignore';
            }
            promiseReadFile(ignorePath)
                .catch(function (err) {
                    if (err.code === 'ENOENT') {
                        return Promise.resolve('');
                    }
                    return Promise.reject(err);
                })
                .then(function (data) {
                    parseGitIgnoreTopLayer(data, null, function (pathInfoArr) {
                        ignoredTopPaths = pathInfoArr;
                        resolve(ignoredTopPaths);
                    });
                }).catch(function (err) {
                    reject(err);
                });
        });
    });
}

/**
 * Creates a watcher for the path to the repo we
 * are installing locally. The watcher will copy
 * over any added files/directories and also
 * create a recursive watcher on those new
 * files/directories.
 * @param {function} onReady
 */
function createTopLevelAddWatcher(onReady) {
    createWatcher(pathToRepo, {
        ignored: function (fileOrDirPath) {
            // ignore any paths not in the top of the source repo directory
            return fileOrDirPath !== pathToRepo;
        }
    })
        .on('add', function (filePath) {
            copyChangedFile(filePath).then(function () {
                execWatchingForChanges(filePath, function () {
                    log('added watcher for new top level file:', filePath);
                });
            });
        })
        .on('addDir', function (dirPath) {
            makeAddedDirectory(dirPath).then(function () {
                execWatchingForChanges(dirPath, function () {
                    log('added watcher for new top level directory:', dirPath);
                });
            });
        })
        .on('ready', onReady);
}

function watchRepoPathsForChanges(callback) {
    var pathsToWatch = 0;
    debug('Finding top level files and directories in %s', pathToRepo);

    pathsToWatch++;
    createTopLevelAddWatcher(function () {
        debug('watching root directory for added files/directories');
        pathsToWatch--;
    });
    // create a watcher for the root of the source repo to watch
    // for new top level files or directories
    findTopLevelFiles(pathToRepo, function (filePath) {
        if (!shouldIgnorePath(filePath)) {
            pathsToWatch++;
            fs.lstat(filePath, function (err, stats) {
                if (err) { throw err; }
                if (!stats.isSymbolicLink()) {
                    execWatchingForChanges(filePath, function () {
                        pathsToWatch--;
                        if (pathsToWatch === 0) {
                            callback();
                        }
                    });
                } else {
                    pathsToWatch--;
                    if (pathsToWatch === 0) {
                        callback();
                    }
                }
            });
        } else {
            debug('will not create watcher for path', filePath);
        }
    });
}

function onLoadedIgnoredTopPaths() {
    watchRepoPathsForChanges(function () {
        log('Created watchers for source repo');
    });
}

function onNpmInstall() {
    if (commander.useIgnoreFile) {
        debug('ignore file will be used to find additional top-level ' +
            'files/directories to exclude from setting up a watcher');
        loadIgnoredTopPaths()
            .then(onLoadedIgnoredTopPaths)
            .catch(function (err) {
                throw err;
            });
    } else {
        debug('ignore file will not be used for finding additional ' +
            'top-level files/directories to exclude from setting up a watcher');
        onLoadedIgnoredTopPaths();
    }
}

execNpmInstall(pathToRepo, onNpmInstall);

