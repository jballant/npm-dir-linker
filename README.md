npm-dir-linker
==============

If you are developing a node module that you want to test in another node project, this command line tool can be used to install that node_module from your local machine into your other project and then symlink all top-level files/directories.

Instead of just symlinking the entire repo directly into node_modules for your other project like `npm link`, this tool leaves the copies of top level files/folders in `.npmignore`/`.gitignore` from `npm install`, as well as "node_modules". The rest of the top-level files or directories are symlinked. That way, the "installation" looks more like a regular `npm install` would. As a result, you don't have to deal with potential issues cropping from having multiple copies of modules.

Currently designed for npm 2.x.x.

Install
-------
```
npm install -g npm-dir-linker
```


Usage
-----
```
npm-dir-linker --module=test-module-name --dir=~~/path/to/testModule --useIgnoreFile
```
